/**
 * CHIOMA EXECUTION CONTRACTS
 * SINGLE SOURCE OF TRUTH — STRICT LAYERED MODEL
 */

/* =========================================================
   1. CORE RUNTIME MODELS (SYSTEM TRUTH)
   ========================================================= */

export type ChiomaInstance = {
  instance_id: string;
  tenant_id: string;
  whatsapp_phone_number: string;
  whatsapp_phone_number_id: string;
  billing_state: "ACTIVE" | "PAUSED" | "EXPIRED";
  credit_units: number;
  business_model_version: string;
  llm_config: {
    provider: "openai" | "groq" | "anthropic" | "openrouter";
    model: string;
  };
  memory_namespace: string;
};

/**
 * EXECUTION STATE (SINGLE SOURCE OF TRUTH PER TURN)
 * This is the ONLY object the runtime reasoning layer should trust.
 */
export type ExecutionState = {
  identity: {
    tenantId: string;
    instanceId: string;
    isResolved: boolean;
    identityId: string;
  };

  intent: {
    active: boolean;
    mode:
      | "GREETING_ALLOWED"
      | "CONTINUATION_ONLY"
      | "COMMITMENT_RESOLUTION"
      | "ONBOARDING"
      | "DAILY_BRIEF";
    currentGoal: string | null;
    lastUserNeed: string | null;
    toneState: string;
    messageCount: number;
  };

  execution: {
    status: "READY" | "DEGRADED" | "BLOCKED";
    reason: string | null;
    controllerTriggered: string;
    fingerprint: string;

    contextOverride?: string;
    recoveryPayload?: any;
    businessContext?: string;
  };
};

/**
 * INGRESS DTO (NOT A SOURCE OF TRUTH)
 * Only used to build ExecutionState
 */
export type ExecutionRequest = {
  tenantId: string;
  instanceId: string;

  triggeredBy:
    | "whatsapp_message"
    | "abm_schedule"
    | "commitment_recovery"
    | "daily_brief";

  commitmentPending: boolean;
  creditBalance: number;
  creditRequired: number;

  tenantStatus: "active" | "suspended" | "trial_expired";

  safetyFlags: string[];
  requestedAt: number;
  fingerprint: string;

  activeCommitmentCount: number;
  identityId: string;
  schedulerConflict: boolean;
};

/* =========================================================
   2. ARBITRATION LAYER
   ========================================================= */

export type GateTraceEntry = {
  gate: string;
  decision: "passed" | "triggered" | "blocked";
  reason?: string;
};

export type ArbiterVerdict = {
  outcome:
    | "ALLOW"
    | "ALLOW_WITH_CONTEXT_OVERRIDE"
    | "DEGRADE_RESPONSE"
    | "BLOCK_RESPONSE"
    | "QUEUE_FOR_RECOVERY";

  reason: string;
  controllerTriggered: string;
  gateTrace: GateTraceEntry[];

  contextOverride?: string;
  recoveryPayload?: object;

  resolvedAt: number;
  fingerprint: string;

  latencyBreakdown?: LatencyBreakdown;
};

/* =========================================================
   3. DELIVERY LAYER
   ========================================================= */

export type DeliveryContract = {
  traceId: string;
  tenantId: string;
  instanceId: string;

  intent: "SEND" | "NO_SEND";

  payload?: {
    to: string;
    text: string;
  };

  deliveryState:
    | "PENDING"
    | "SENT"
    | "FAILED"
    | "QUEUED"
    | "SKIPPED";

  reason?: string;
};

/* =========================================================
   4. STAFF LOOP OUTPUT
   ========================================================= */

export type StaffLoopResult = {
  responseText: string;
  responseType:
    | "conversation"
    | "error_degraded"
    | "internal_failure"
    | "onboarding";

  delivered: boolean;
  latencyMs: number;
  correlationId: string;

  decision?: StaffDecision;
  latencyBreakdown?: LatencyBreakdown;
};

/* =========================================================
   5. DOMAIN MODEL (BUSINESS INTELLIGENCE)
   ========================================================= */

export type StaffAction = {
  type:
    | "REPLY"
    | "ESCALATE"
    | "SCHEDULE_FOLLOWUP"
    | "IGNORE"
    | "PROMISE_MADE";

  urgency: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  revenue_weight: number;

  need_classification:
    | "REVENUE_NOW"
    | "REVENUE_SOON"
    | "NO_REVENUE"
    | "ESCALATION_REQUIRED";

  commitment_type?:
    | "AVAILABILITY_LOOKUP"
    | "PRICING_CLARIFICATION"
    | "OWNER_CONSULTATION"
    | "GENERAL_FOLLOWUP";
};

export type StaffDecision = {
  intent_type: "SALES" | "SUPPORT" | "COMPLAINT" | "INQUIRY" | "UNKNOWN";

  confidence: number;
  response_payload: string;

  required_actions: StaffAction[];
  safety_flags: string[];

  source: "LLM" | "RULE_OVERRIDE" | "REPLAY";

  decision_hash: string;
  customer_need: string;
};

export type Commitment = {
  id: string;
  tenantId: string;
  aggregateId: string;

  type: string;

  status:
    | "PENDING"
    | "IN_PROGRESS"
    | "RESOLVED"
    | "EXPIRED"
    | "ESCALATED"
    | "FAILED";

  context: any;

  deadlineAt: string;
  createdAt: string;
  resolvedAt?: string;

  correlationId: string;
  workerId?: string;
  leaseExpiresAt?: string;
};

/* =========================================================
   6. SUPPORT MODELS
   ========================================================= */

export type LatencyBreakdown = {
  identityMs?: number;
  arbitrationMs?: number;
  inferenceMs?: number;
  dispatchMs?: number;
  totalMs: number;
};