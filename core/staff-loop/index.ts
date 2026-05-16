import { createHash } from "node:crypto";
import { 
  StaffLoopInput, 
  StaffLoopResult,
  EmployabilityProfile,
  StaffDecision,
  StaffAction,
  ExecutionState
} from "../contracts/index.js";
import { validateStaffAction, sanitizeStaffReply } from "../staff-rules/index.js";
import { enforceEmployeePsychology } from "../staff-rules/behavioral-enforcer.js";
import { generateStaffReply } from "../../services/response-service/index.js";
import { enforceMemoryGovernance, createGovernedMemory } from "../memory/governance.js";

function buildStrategicDirective(
  state: ExecutionState
): string {
  const mode = state.intent.mode;
  const currentGoal = state.intent.currentGoal || "Resolve customer inquiry";
  if (mode === "COMMITMENT_RESOLUTION") {
    return `## STRATEGIC_EXECUTION_DIRECTIVE [MODE: COMMITMENT_RESOLUTION]
- STATUS: You have an ACTIVE, UNFULFILLED commitment to this customer.
- CONSTRAINT: Do NOT greet. Do NOT reset. Do NOT start a new topic.
- ACTION: Your ONLY job is to follow through on your pending commitment.
- CURRENT COMMITMENT: "${currentGoal}"`;
  }

  if (mode === "CONTINUATION_ONLY") {
    return `## STRATEGIC_EXECUTION_DIRECTIVE [MODE: CONTINUATION_ONLY]
- STATUS: This is an ONGOING conversation. The customer has already been greeted.
- CONSTRAINT: Do NOT say "Hello", "Hi", "How can I assist you", or any greeting.
- ACTION: Respond directly to the current message as a continuation of the active thread.
- THREAD CONTEXT: "${currentGoal}"`;
  }

  return `## STRATEGIC_EXECUTION_DIRECTIVE [MODE: GREETING_ALLOWED]
- STATUS: New session or distinct new intent detected.
- ACTION: Greet the customer professionally and identify their need.`;
}

function buildConversationHeartbeat(
  state: ExecutionState
): string {
  if (!state.intent.lastUserNeed && !state.intent.currentGoal && (state.intent.messageCount ?? 0) === 0) {
    return "## SESSION: New customer — first interaction on record.";
  }
  const toneInstruction = state.intent.toneState === "FRUSTRATED"
    ? "IMPORTANT: This customer was frustrated in their previous message. Acknowledge empathetically before addressing their current request."
    : state.intent.toneState === "URGENT"
    ? "IMPORTANT: This customer has signalled urgency. Respond promptly and directly."
    : "";
  return [`## CONVERSATION_HEARTBEAT [ACTIVE SESSION]:
- Previous Interaction Count: ${state.intent.messageCount ?? 0}
- Last Declared Need: "${state.intent.lastUserNeed || "Not explicitly stated"}"
- Current Active Goal: "${state.intent.currentGoal || "Not set"}"
- Customer Tone: ${state.intent.toneState ?? "CALM"}
- NOTE: This customer has an existing thread. Continue it directly.`,
    toneInstruction
  ].filter(Boolean).join("\n");
}

function buildSystemBrief(
  state: ExecutionState,
  activeCommitmentContext: string,
  realityGrounding: string,
  facts: { key: string; value: any }[],
  isRecovery: boolean
): string {
  return [
    buildStrategicDirective(state),
    buildConversationHeartbeat(state),
    activeCommitmentContext || null,
    isRecovery ? "CRITICAL: You are in a recovery scenario. Acknowledge and stabilize." : null,
    realityGrounding,
    ...facts.map(f => `${f.key}: ${JSON.stringify(f.value)}`)
  ].filter(Boolean).join("\n\n");
}

export async function runStaffLoop(
  input: StaffLoopInput,
  sql: any,
  config: { apiKey: string; provider: string },
  profile: EmployabilityProfile,
  activeCommitmentContext: string = ""
): Promise<StaffLoopResult> {
  const start = Date.now();
  const t = (m: string) => console.log(`[STAFF_LOOP] [${Date.now() - start}ms] ${m}`);

  try {
    let state: any = null;
    let facts: { key: string; value: any }[] = [];

    try {
      const [stateRow]: any[] = await sql`
        SELECT last_customer_need, current_goal 
        FROM public.customer_memory 
        WHERE tenant_id = ${input.tenantId} AND customer_phone = ${input.senderPhone}
      `;
      state = stateRow ?? null;
    } catch { }

    try {
      facts = await sql`SELECT key, value FROM public.business_facts WHERE tenant_id = ${input.tenantId} LIMIT 20`;
    } catch { }

    const rawMemories = [
      createGovernedMemory("last_customer_need", state?.last_customer_need || ""),
      createGovernedMemory("current_goal", state?.current_goal || "")
    ];
    const governedMemories = enforceMemoryGovernance(rawMemories);

    const lastNeed = governedMemories.find(m => m.key === "last_customer_need")?.value || "";
    const currentGoal = governedMemories.find(m => m.key === "current_goal")?.value || "";
    const isRecovery = input.messageText.includes("[SYSTEM_RECOVERY_TRIGGER]");

    let realityGrounding = "No daily briefing locked for today. Rely on general business knowledge.";
    try {
      const [snap] = await sql`
        SELECT snapshot_data, locked_at FROM public.business_snapshots 
        WHERE tenant_id = ${input.tenantId} AND status = 'LOCKED'
        ORDER BY locked_at DESC LIMIT 1
      `;
      if (snap) {
        realityGrounding = `LOCKED_OPERATIONAL_TRUTH (Confirmed by owner at ${snap.locked_at}):\n${JSON.stringify(snap.snapshot_data)}`;
      }
    } catch { }

    const businessBrief = buildSystemBrief(
      input.state,
      activeCommitmentContext,
      realityGrounding,
      facts,
      isRecovery
    );

    t("LLM_INVOCATION_START");
    const proposed = await generateStaffReply(input.messageText, businessBrief, profile, config);
    t("LLM_INVOCATION_COMPLETE");

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
    const behavioralAudit = enforceEmployeePsychology(sanitizedReply, input.state.intent.mode, input.state.intent.currentGoal || currentGoal);

    let finalReply = behavioralAudit.correctedResponse;
    let finalConfidence = proposed.confidence;

    if (behavioralAudit.mode === "REWRITE") {
      t(`BEHAVIORAL_REWRITE: ${behavioralAudit.violations.length} violations corrected`);
      finalConfidence = Math.max(0.76, proposed.confidence - 0.1);
    } else if (behavioralAudit.mode === "BLOCK") {
      t("BEHAVIORAL_BLOCK: Fatal violation — using mode-safe fallback");
      finalReply = (input.state.intent.mode === "CONTINUATION_ONLY" || input.state.intent.mode === "COMMITMENT_RESOLUTION")
        ? "Let me look into that for you right now."
        : behavioralAudit.safeFallback;
      finalConfidence = 0.9;
    }

    const finalAction: StaffAction = actionOverride
      ? { type: "ESCALATE", urgency: "HIGH", revenue_weight: validatedAction.revenue_weight, need_classification: "ESCALATION_REQUIRED" }
      : { ...validatedAction, type: behavioralAudit.mode === "BLOCK" ? "REPLY" as const : validatedAction.type };

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
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[STAFF_LOOP] COGNITION_FAILURE: ${message}`);

    const degradedText = (input.state.intent.mode === "CONTINUATION_ONLY" || input.state.intent.mode === "COMMITMENT_RESOLUTION")
      ? "Still working on that for you — give me just a moment."
      : "I'm still pulling that together for you — one moment.";

    return {
      responseText: degradedText,
      responseType: "error_degraded",
      delivered: false,
      latencyMs: Date.now() - start,
      correlationId: input.correlationId,
    };
  }
}
