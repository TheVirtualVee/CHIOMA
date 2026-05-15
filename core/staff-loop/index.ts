import { createHash } from "node:crypto";
import { 
  StaffLoopInput, 
  StaffLoopResult,
  EmployabilityProfile,
  StaffDecision,
  StaffAction
} from "../contracts/index.js";
import { validateStaffAction, sanitizeStaffReply } from "../staff-rules/index.js";
import { enforceEmployeePsychology } from "../staff-rules/behavioral-enforcer.js";
import { generateStaffReply } from "../../services/response-service/index.js";
import { enforceMemoryGovernance, createGovernedMemory } from "../memory/governance.js";
import { buildActiveCommitmentContext } from "../commitments/acil.js";

export async function runStaffLoop(
  input: StaffLoopInput,
  sql: any,
  config: { apiKey: string; provider: string },
  profile: EmployabilityProfile
): Promise<StaffLoopResult> {
  const start = Date.now();
  const t = (m: string) => console.log(`[STAFF_LOOP_TRACE] [${Date.now() - start}ms] ${m}`);
  
  try {
    // ASSERT: customer_memory and business_facts may not exist yet for new tenants.
    // Wrap reads in try/catch — missing tables must never block LLM inference.
    let state: any = null;
    let facts: { key: string; value: any }[] = [];
    try {
      const [stateRow]: any[] = await sql`SELECT last_customer_need, current_goal FROM customer_memory WHERE tenant_id = ${input.tenantId} AND customer_phone = ${input.senderPhone}`;
      state = stateRow ?? null;
    } catch { /* Table may not exist for this tenant yet */ }
    try {
      facts = await sql`SELECT key, value FROM business_facts WHERE tenant_id = ${input.tenantId} LIMIT 20`;
    } catch { /* Table may not exist for this tenant yet */ }
    
    // Governed Memory Scrubbing
    const rawMemories = [
      createGovernedMemory("last_customer_need", state?.last_customer_need || ""),
      createGovernedMemory("current_goal", state?.current_goal || "")
    ];
    const governedMemories = enforceMemoryGovernance(rawMemories);

    const isRecovery = input.messageText.includes("[SYSTEM_RECOVERY_TRIGGER]");

    // ── BRSE Reality Injection ─────────────────────────────────────
    // ASSERT: business_snapshots may not exist for pre-BRSE tenants — degrade gracefully
    let lockedSnapshot: any = null;
    try {
      const [snap] = await sql`
        SELECT snapshot_data, locked_at FROM public.business_snapshots 
        WHERE tenant_id = ${input.tenantId} AND status = 'LOCKED'
        ORDER BY locked_at DESC LIMIT 1
      `;
      lockedSnapshot = snap ?? null;
    } catch { /* Table may not exist yet — continue without snapshot */ }

    const realityGrounding = lockedSnapshot 
      ? `LOCKED_OPERATIONAL_TRUTH (Confirmed by owner at ${lockedSnapshot.locked_at}):\n${JSON.stringify(lockedSnapshot.snapshot_data)}`
      : "No daily briefing locked for today. Rely on general business knowledge.";

    // ACIL — Active Commitment Injection
    // Must be called before businessBrief assembly. Failure returns empty string.
    let activeCommitmentContext = "";
    try {
      activeCommitmentContext = await buildActiveCommitmentContext(sql, input);
      if (activeCommitmentContext) {
        console.log("[ACIL] COMMITMENT_CONTEXT_INJECTED for", input.tenantId);
      }
    } catch (err: unknown) {
      console.error("[ACIL] UNEXPECTED_ACIL_ERROR:", String(err).slice(0, 120));
    }

    const lastNeed = governedMemories.find(m => m.key === 'last_customer_need')?.value || "";
    const currentGoal = governedMemories.find(m => m.key === 'current_goal')?.value || "";

    const conversationHeartbeat = lastNeed || currentGoal 
      ? `## CONVERSATION_HEARTBEAT (STRICT CONTINUITY):
- The user is RETURNING. This is NOT a new session.
- Last Customer Need: "${lastNeed}"
- Current Active Goal: "${currentGoal}"
- INSTRUCTION: Do NOT greet the user. Skip "Hello" or "How can I help". 
- ACTION: Respond DIRECTLY to the message within the context of the goal above.`
      : "## CONVERSATION_HEARTBEAT: New session started.";

    const businessBrief = [
      conversationHeartbeat,                                                   // ← Anchor the brain first
      activeCommitmentContext,                                                 // ← Obligations second
      isRecovery ? "CRITICAL: You are recovering..." : "",
      realityGrounding,
      ...facts.map((f: { key: string; value: any }) => `${f.key}: ${JSON.stringify(f.value)}`)
    ].filter(Boolean).join("\n\n");

    t("LLM_INVOCATION_START");
    const proposed = await generateStaffReply(input.messageText, businessBrief, profile, config);
    
    const validatedAction = validateStaffAction(
      { 
        type: proposed.suggested_action.type,
        urgency: proposed.suggested_action.urgency,
        revenue_weight: proposed.suggested_action.revenue_weight,
        need_classification: proposed.suggested_action.need_classification
      },
      { 
        currentTime: new Date(), 
        profile, 
        customerState: state, 
        llmConfidence: proposed.confidence 
      }
    );

    const { sanitizedReply, actionOverride } = sanitizeStaffReply(proposed.response, facts);

    const behavioralAudit = enforceEmployeePsychology(sanitizedReply);
    
    let finalReply = behavioralAudit.correctedResponse;
    let finalConfidence = proposed.confidence;

    if (behavioralAudit.mode === "REWRITE") {
      console.log(`[BEHAVIORAL_ENFORCER] REWRITE_MODE: Repairing response. Original violations: ${behavioralAudit.violations.length}`);
      finalConfidence = Math.max(0.76, proposed.confidence - 0.1); // Ensure it stays above the 0.75 threshold
    } else if (behavioralAudit.mode === "BLOCK") {
      console.warn(`[BEHAVIORAL_ENFORCER] BLOCK_MODE: Fatal violation detected. Using safe fallback.`);
      finalReply = behavioralAudit.safeFallback;
      finalConfidence = 0.9; // High confidence for the fallback message to ensure it's delivered
    }

    const finalAction: StaffAction = actionOverride ? {
      type: "ESCALATE",
      urgency: "HIGH",
      revenue_weight: validatedAction.revenue_weight,
      need_classification: "ESCALATION_REQUIRED"
    } : {
      ...validatedAction,
      type: behavioralAudit.mode === "BLOCK" ? "REPLY" as const : validatedAction.type
    };

    const decision: StaffDecision = {
      intent_type: proposed.intent_type,
      confidence: finalConfidence,
      response_payload: finalReply,
      required_actions: [finalAction],
      safety_flags: behavioralAudit.violations.map(v => v.rule),
      source: "LLM",
      customer_need: proposed.customer_need,
      decision_hash: createHash("sha256").update(finalReply + JSON.stringify(finalAction)).digest("hex")
    };

    return {
      responseText: decision.response_payload,
      responseType: "conversation",
      delivered: false,
      latencyMs: Date.now() - start,
      correlationId: input.correlationId,
      decision
    };

  } catch (err) {
    console.error(`[STAFF_LOOP] COGNITION_FAILURE: ${err}`);
    return {
      responseText: "I'm having a bit of trouble. Let me check that for you.",
      responseType: "error_degraded",
      delivered: false,
      latencyMs: Date.now() - start,
      correlationId: input.correlationId,
    };
  }
}
