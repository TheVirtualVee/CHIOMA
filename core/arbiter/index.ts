import { z } from "zod";
import { ExecutionRequest, ArbiterVerdict, GateTraceEntry } from "../contracts/index.js";

export function evaluateGates(request: ExecutionRequest): { 
  outcome: ArbiterVerdict['outcome']; 
  controllerTriggered: string; 
  reason: string;
  gateTrace: GateTraceEntry[];
} {
  const gateTrace: GateTraceEntry[] = [];

  if (request.schedulerConflict) {
    gateTrace.push({ gate: 'scheduler_arbitration', decision: 'blocked', reason: 'COMPETING_SCHEDULER_ACTIVE' });
    return { outcome: 'BLOCK_RESPONSE', controllerTriggered: 'Gate0_Arbitration', reason: 'COMPETING_SCHEDULER_ACTIVE', gateTrace };
  }

  // P0: Pre-check billing status (active/suspended) but skip pre-fetched balance check.
  // The actual credit lease is now atomic via RPC in runArbiter.
  const tenantValid = !['suspended', 'trial_expired'].includes(request.tenantStatus);
  gateTrace.push({ gate: 'tenant', decision: tenantValid ? 'passed' : 'blocked', reason: tenantValid ? undefined : `TENANT_STATUS_${request.tenantStatus.toUpperCase()}` });
  if (!tenantValid) {
    return { outcome: 'BLOCK_RESPONSE', controllerTriggered: 'Gate1_TenantValidity', reason: `TENANT_STATUS_${request.tenantStatus.toUpperCase()}`, gateTrace };
  }

  const safetyPassed = request.safetyFlags.length === 0;
  gateTrace.push({ gate: 'safety', decision: safetyPassed ? 'passed' : 'blocked', reason: safetyPassed ? undefined : `SAFETY_VIOLATION: ${request.safetyFlags.join(', ')}` });
  if (!safetyPassed) {
    return { outcome: 'BLOCK_RESPONSE', controllerTriggered: 'Gate3_Safety', reason: `SAFETY_VIOLATION: ${request.safetyFlags.join(', ')}`, gateTrace };
  }

  if (request.commitmentPending && request.activeCommitmentCount >= 1) {
    gateTrace.push({ gate: 'commitment_throttling', decision: 'triggered', reason: 'MAX_ACTIVE_COMMITMENTS_EXCEEDED' });
    return { outcome: 'ALLOW', controllerTriggered: 'Gate4_Throttling', reason: 'COMMITMENT_THROTTLED', gateTrace };
  }

  if (request.commitmentPending) {
    gateTrace.push({ gate: 'commitment', decision: 'triggered', reason: 'PENDING_COMMITMENT_PRIORITY' });
    return { outcome: 'ALLOW_WITH_CONTEXT_OVERRIDE', controllerTriggered: 'Gate5_Commitment', reason: 'PENDING_COMMITMENT_PRIORITY', gateTrace };
  }

  if (['abm_schedule', 'daily_brief'].includes(request.triggeredBy)) {
    gateTrace.push({ gate: 'business_routing', decision: 'passed', reason: `ROUTED_BY_${request.triggeredBy.toUpperCase()}` });
    return { outcome: 'ALLOW', controllerTriggered: 'Gate6_BusinessLogic', reason: `ROUTED_BY_${request.triggeredBy.toUpperCase()}`, gateTrace };
  }

  gateTrace.push({ gate: 'default', decision: 'passed', reason: 'ALL_GATES_PASSED' });
  return { outcome: 'ALLOW', controllerTriggered: 'Gate7_Default', reason: 'ALL_GATES_PASSED', gateTrace };
}

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

export async function runArbiter(request: ExecutionRequest, sql: any, apiKey: string): Promise<ArbiterVerdict> {
  const start = Date.now();
  let gateResult = evaluateGates(request);

  // FAILURE-002: Atomic Credit Lease
  // If gates passed, we attempt to lease credits atomically.
  if (gateResult.outcome === 'ALLOW' || gateResult.outcome === 'ALLOW_WITH_CONTEXT_OVERRIDE') {
    try {
      const [lease] = await sql`SELECT public.lease_credit(${request.tenantId}, ${request.creditRequired}) as result`;
      if (!lease.result.success) {
        gateResult = {
          outcome: 'BLOCK_RESPONSE',
          controllerTriggered: 'Gate1_AtomicBilling',
          reason: 'INSUFFICIENT_CREDITS',
          gateTrace: [...gateResult.gateTrace, { gate: 'atomic_billing', decision: 'blocked', reason: 'INSUFFICIENT_CREDITS' }]
        };
      } else {
        gateResult.gateTrace.push({ gate: 'atomic_billing', decision: 'passed' });
      }
    } catch (err) {
      console.error("[ARBITER] ATOMIC_LEASE_FAILED:", err);
      // Fail-safe: if DB lease fails, we block to prevent overdraft
      gateResult = {
        outcome: 'BLOCK_RESPONSE',
        controllerTriggered: 'Gate1_AtomicBilling_Error',
        reason: 'BILLING_SERVICE_UNAVAILABLE',
        gateTrace: [...gateResult.gateTrace, { gate: 'atomic_billing', decision: 'blocked', reason: 'DB_ERROR' }]
      };
    }
  }

  const verdict = await enrichVerdict(request, gateResult, apiKey);
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

