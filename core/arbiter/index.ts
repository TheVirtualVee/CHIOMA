import { ExecutionRequest, ArbiterVerdict } from "../contracts/index.js";

/**
 * CHIOMA EXECUTION ARBITER (CEA)
 * Phase 3.1 — Deterministic Control Layer
 */

/**
 * Step 1 — Pure Gate Engine (Deterministic Logic)
 */
export function evaluateGates(request: ExecutionRequest): { outcome: ArbiterVerdict['outcome']; controllerTriggered: string; reason: string } {
  // Gate 1: Billing Hard Block
  // creditBalance < creditRequired AND tenantStatus != 'active' (active is the non-trial check here)
  if (request.creditBalance < request.creditRequired && request.tenantStatus !== 'active') {
     return { outcome: 'BLOCK_RESPONSE', controllerTriggered: 'Gate1_Billing', reason: 'INSUFFICIENT_CREDITS' };
  }

  // Gate 2: Tenant Validity
  if (['suspended', 'trial_expired'].includes(request.tenantStatus)) {
    return { outcome: 'BLOCK_RESPONSE', controllerTriggered: 'Gate2_TenantValidity', reason: `TENANT_STATUS_${request.tenantStatus.toUpperCase()}` };
  }

  // Gate 3: Safety Gate
  if (request.safetyFlags.length > 0) {
    return { outcome: 'BLOCK_RESPONSE', controllerTriggered: 'Gate3_Safety', reason: `SAFETY_VIOLATION: ${request.safetyFlags.join(', ')}` };
  }


  // Gate 4: Commitment Override
  if (request.commitmentPending) {
    return { outcome: 'ALLOW_WITH_CONTEXT_OVERRIDE', controllerTriggered: 'Gate4_Commitment', reason: 'PENDING_COMMITMENT_PRIORITY' };
  }

  // Gate 5: Business Logic Routing
  if (['abm_schedule', 'daily_brief'].includes(request.triggeredBy)) {
    return { outcome: 'ALLOW', controllerTriggered: 'Gate5_BusinessLogic', reason: `ROUTED_BY_${request.triggeredBy.toUpperCase()}` };
  }

  // Gate 6: Default
  return { outcome: 'ALLOW', controllerTriggered: 'Gate6_Default', reason: 'ALL_GATES_PASSED' };
}

/**
 * Step 2 — Enrichment Layer (Gemini Flash)
 */
async function enrichVerdict(request: ExecutionRequest, gateResult: { outcome: ArbiterVerdict['outcome']; controllerTriggered: string; reason: string }, apiKey: string): Promise<ArbiterVerdict> {
  const needsEnrichment = ['ALLOW_WITH_CONTEXT_OVERRIDE', 'QUEUE_FOR_RECOVERY'].includes(gateResult.outcome);
  
  if (!needsEnrichment) {
    return {
      ...gateResult,
      resolvedAt: Date.now()
    };
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

    // Using Gemini Flash via OpenRouter or direct (configuring for common CHIOMA pattern)
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile", // Using current reliable model, ensuring Flash-like speed/cost
        messages: [{ role: "system", content: prompt }],
        temperature: 0,
        response_format: { type: "json_object" }
      })
    });

    if (!response.ok) throw new Error(`Enrichment API failed: ${response.status}`);

    const data = await response.json() as any;
    const enriched = JSON.parse(data.choices[0].message.content) as ArbiterVerdict;

    // Hard constraint: Immutability of outcome
    return {
      ...enriched,
      outcome: gateResult.outcome, // ENFORCE IMMUTABILITY
      resolvedAt: Date.now()
    };

  } catch (err) {
    console.error("[ARBITER] ENRICHMENT_FAILED", err);
    return {
      outcome: 'DEGRADE_RESPONSE',
      controllerTriggered: 'gemini_failure_fallback',
      reason: 'ENRICHMENT_TIMEOUT_OR_ERROR',
      resolvedAt: Date.now()
    };
  }
}

/**
 * Step 3 — Arbiter Orchestrator
 */
export async function runArbiter(request: ExecutionRequest, apiKey: string): Promise<ArbiterVerdict> {
  const start = Date.now();
  
  // 1. Evaluate deterministic gates
  const gateResult = evaluateGates(request);
  
  // 2. Enrich if needed
  const verdict = await enrichVerdict(request, gateResult, apiKey);
  
  // 3. Log everything (Observability)
  const durationMs = Date.now() - start;
  console.log(`[ARBITER_EXECUTION] ${JSON.stringify({
    tenantId: request.tenantId,
    instanceId: request.instanceId,
    outcome: verdict.outcome,
    controllerTriggered: verdict.controllerTriggered,
    reason: verdict.reason,
    durationMs,
    triggeredBy: request.triggeredBy
  })}`);

  return verdict;
}
