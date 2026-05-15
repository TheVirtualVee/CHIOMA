import { z } from "zod";
import { ExecutionRequest, ArbiterVerdict, GateTraceEntry } from "../contracts/index.js";

/**
 * CHIOMA EXECUTION ARBITER (CEA)
 * Phase 3.1 — Deterministic Control Layer
 */

/**
 * Step 1 — Pure Gate Engine (Deterministic Logic)
 */
export function evaluateGates(request: ExecutionRequest): { 
  outcome: ArbiterVerdict['outcome']; 
  controllerTriggered: string; 
  reason: string;
  gateTrace: GateTraceEntry[];
} {
  const gateTrace: GateTraceEntry[] = [];

  // Scheduler Arbitration
  if (request.schedulerConflict) {
    gateTrace.push({ gate: 'scheduler_arbitration', decision: 'blocked', reason: 'COMPETING_SCHEDULER_ACTIVE' });
    return { outcome: 'BLOCK_RESPONSE', controllerTriggered: 'Gate0_Arbitration', reason: 'COMPETING_SCHEDULER_ACTIVE', gateTrace };
  }

  // Billing & Tenant Status
  const credits = request.creditBalance ?? 0;
  const billingPassed = !(credits < request.creditRequired && request.tenantStatus !== 'active');
  gateTrace.push({ gate: 'billing', decision: billingPassed ? 'passed' : 'blocked', reason: billingPassed ? undefined : 'INSUFFICIENT_CREDITS' });
  if (!billingPassed) {
     return { outcome: 'BLOCK_RESPONSE', controllerTriggered: 'Gate1_Billing', reason: 'INSUFFICIENT_CREDITS', gateTrace };
  }

  const tenantValid = !['suspended', 'trial_expired'].includes(request.tenantStatus);
  gateTrace.push({ gate: 'tenant', decision: tenantValid ? 'passed' : 'blocked', reason: tenantValid ? undefined : `TENANT_STATUS_${request.tenantStatus.toUpperCase()}` });
  if (!tenantValid) {
    return { outcome: 'BLOCK_RESPONSE', controllerTriggered: 'Gate2_TenantValidity', reason: `TENANT_STATUS_${request.tenantStatus.toUpperCase()}`, gateTrace };
  }

  // Safety
  const safetyPassed = request.safetyFlags.length === 0;
  gateTrace.push({ gate: 'safety', decision: safetyPassed ? 'passed' : 'blocked', reason: safetyPassed ? undefined : `SAFETY_VIOLATION: ${request.safetyFlags.join(', ')}` });
  if (!safetyPassed) {
    return { outcome: 'BLOCK_RESPONSE', controllerTriggered: 'Gate3_Safety', reason: `SAFETY_VIOLATION: ${request.safetyFlags.join(', ')}`, gateTrace };
  }

  // Commitment Throttling & Priority
  if (request.commitmentPending && request.activeCommitmentCount >= 1) {
    gateTrace.push({ gate: 'commitment_throttling', decision: 'triggered', reason: 'MAX_ACTIVE_COMMITMENTS_EXCEEDED' });
    return { outcome: 'ALLOW', controllerTriggered: 'Gate4_Throttling', reason: 'COMMITMENT_THROTTLED', gateTrace };
  }

  if (request.commitmentPending) {
    gateTrace.push({ gate: 'commitment', decision: 'triggered', reason: 'PENDING_COMMITMENT_PRIORITY' });
    return { outcome: 'ALLOW_WITH_CONTEXT_OVERRIDE', controllerTriggered: 'Gate5_Commitment', reason: 'PENDING_COMMITMENT_PRIORITY', gateTrace };
  }

  // Business Routing & Default
  if (['abm_schedule', 'daily_brief'].includes(request.triggeredBy)) {
    gateTrace.push({ gate: 'business_routing', decision: 'passed', reason: `ROUTED_BY_${request.triggeredBy.toUpperCase()}` });
    return { outcome: 'ALLOW', controllerTriggered: 'Gate6_BusinessLogic', reason: `ROUTED_BY_${request.triggeredBy.toUpperCase()}`, gateTrace };
  }

  gateTrace.push({ gate: 'default', decision: 'passed', reason: 'ALL_GATES_PASSED' });
  return { outcome: 'ALLOW', controllerTriggered: 'Gate7_Default', reason: 'ALL_GATES_PASSED', gateTrace };
}


/**
 * Step 2 — Enrichment Layer (Gemini Flash)
 */
const EnrichmentSchema = z.object({
  contextOverride: z.string().max(300).optional(),
  recoveryPayload: z.record(z.any()).optional(),
});

async function enrichVerdict(
  request: ExecutionRequest, 
  gateResult: { outcome: ArbiterVerdict['outcome']; controllerTriggered: string; reason: string; gateTrace: GateTraceEntry[] }, 
  apiKey: string
): Promise<ArbiterVerdict> {
  const needsEnrichment = ['ALLOW_WITH_CONTEXT_OVERRIDE', 'QUEUE_FOR_RECOVERY'].includes(gateResult.outcome);
  
  const baseVerdict: ArbiterVerdict = {
    ...gateResult,
    resolvedAt: Date.now(),
    fingerprint: request.fingerprint
  };

  if (!needsEnrichment) {
    return baseVerdict;
  }

  try {
    const prompt = `You are the Chioma Execution Arbiter Enricher.

You do NOT decide outcomes.
You ONLY enrich a precomputed verdict.

Return ONLY valid JSON matching ArbiterVerdict.
No markdown. No explanation.

IMPORTANT RULE:
The "outcome" field MUST remain unchanged from input.

ExecutionRequest: ${JSON.stringify(request)}
PrecomputedVerdict: ${JSON.stringify(gateResult)}
Instruction:
Return enriched ArbiterVerdict. Do not modify outcome.
Include contextOverride (Max 1-3 sentences, business-safe only) or recoveryPayload if applicable.`;

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "system", content: prompt }],
        temperature: 0,
        response_format: { type: "json_object" }
      })
    });

    if (!response.ok) throw new Error(`Enrichment API failed: ${response.status}`);

    const data = await response.json() as any;
    const rawEnriched = JSON.parse(data.choices[0].message.content);

    const validated = EnrichmentSchema.safeParse(rawEnriched);
    if (!validated.success) {
      console.warn("[ARBITER] ENRICHMENT_SCHEMA_VIOLATION", validated.error.issues);
      return {
        ...baseVerdict,
        outcome: gateResult.outcome === 'ALLOW_WITH_CONTEXT_OVERRIDE' ? 'ALLOW' : gateResult.outcome,
        controllerTriggered: 'gemini_schema_fallback',
        reason: 'ENRICHMENT_SCHEMA_INVALID'
      };
    }

    return {
      ...baseVerdict,
      contextOverride: validated.data.contextOverride,
      recoveryPayload: validated.data.recoveryPayload,
      resolvedAt: Date.now()
    };

  } catch (err) {
    console.error("[ARBITER] ENRICHMENT_FAILED — falling back to base verdict:", err);
    return {
      ...baseVerdict,
      outcome: gateResult.outcome === 'ALLOW_WITH_CONTEXT_OVERRIDE' ? 'ALLOW' : gateResult.outcome,
      controllerTriggered: 'enrichment_timeout_fallback',
      reason: 'ENRICHMENT_FAILED_SAFE_ALLOW'
    };
  }
}


/**
 * Step 3 — Arbiter Orchestrator
 */
export async function runArbiter(request: ExecutionRequest, sql: any, apiKey: string): Promise<ArbiterVerdict> {
  const start = Date.now();
  
  // 1. Evaluate deterministic gates
  const gateResult = evaluateGates(request);
  
  // 2. Enrich if needed
  const verdict = await enrichVerdict(request, gateResult, apiKey);
  
  // 3. Log everything (Observability & Investor-Grade Telemetry)
  const durationMs = Date.now() - start;
  
  try {
    await sql`
      INSERT INTO public.cea_execution_logs (
        tenant_id, instance_id, fingerprint, outcome, 
        controller_triggered, gate_trace, duration_ms, triggered_by
      ) VALUES (
        ${request.tenantId}, ${request.instanceId}, ${request.fingerprint}, ${verdict.outcome},
        ${verdict.controllerTriggered}, ${sql.json(verdict.gateTrace)}, ${durationMs}, ${request.triggeredBy}
      )
    `;
  } catch (logErr) {
    // Non-fatal, don't block execution if logging fails
    console.error("[ARBITER] TELEMETRY_LOG_FAILED", logErr);
  }

  console.log(`[ARBITER_EXECUTION] ${JSON.stringify({
    tenantId: request.tenantId,
    instanceId: request.instanceId,
    outcome: verdict.outcome,
    durationMs,
    triggeredBy: request.triggeredBy
  })}`);

  return verdict;
}

