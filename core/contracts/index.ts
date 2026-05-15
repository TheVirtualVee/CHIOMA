import { TraceContext } from "./telemetry.js";

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

export type ExecutionMode = 
  | "GREETING_ALLOWED" 
  | "CONTINUATION_ONLY" 
  | "COMMITMENT_RESOLUTION";

export interface StaffLoopInput {
  messageId: string;
  tenantId: string;
  instanceId: string;
  senderPhone: string;
  messageText: string;
  correlationId: string;
  causationId: string;
  eventId: string;
  channel: "whatsapp" | "sms" | "web" | "simulation";
  traceContext?: {
    traceId: string;
    workerId: string;
    executionId?: string;
  };
  snapshotId?: string; // Optional context from a specific snapshot
  instance?: ChiomaInstance;
  executionMode?: ExecutionMode; // ← NEW: Structural constraint
}

export interface StaffLoopResult {
  responseText: string;
  responseType: 'conversation' | 'error_degraded' | 'internal_failure';
  delivered: boolean;
  latencyMs: number;
  correlationId: string;
  decision?: StaffDecision;
  latencyBreakdown?: LatencyBreakdown;
}

export interface EmployabilityProfile {
  business_name: string;
  tone_profile: "casual" | "formal" | "street-smart" | "luxury" | "friendly-shopkeeper";
  escalation_contact: string;
  working_hours: string;
  revenue_goals?: string;
  response_style: "concise" | "helpful" | "sales-driven";
  version: number;
  last_sync_at?: string;
}

export interface BusinessDailyState {
  inventory: Array<{
    item: string;
    count: number;
    price: number;
    metadata?: any;
  }>;
  promotions: string[];
  active_rules: string[];
  effective_date: string;
}

export type EmployabilityMode = 
  | "ACTIVE_EMPLOYEE" 
  | "ONBOARDING_EMPLOYEE" 
  | "OFFLINE_ESCALATION_ONLY";

export interface StaffAction {
  type: "REPLY" | "ESCALATE" | "SCHEDULE_FOLLOWUP" | "IGNORE" | "PROMISE_MADE";
  urgency: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  revenue_weight: number;
  need_classification: "REVENUE_NOW" | "REVENUE_SOON" | "NO_REVENUE" | "ESCALATION_REQUIRED";
  commitment_type?: "AVAILABILITY_LOOKUP" | "PRICING_CLARIFICATION" | "OWNER_CONSULTATION" | "GENERAL_FOLLOWUP";
}

export interface BusinessDraft {
  name_guess: string;
  entities: Array<{
    category: string;
    label: string;
    price_point?: string;
    billing_unit?: string;
  }>;
  workflow_guess: {
    booking_process: string;
    payment_terms: string;
    customer_qualifier: string;
  };
  tone_guess: string;
  confidence_scores: Record<string, number>;
}

export interface ProposedStaffDecision {
  response: string;
  customer_need: string;
  intent_type: "SALES" | "SUPPORT" | "COMPLAINT" | "INQUIRY" | "UNKNOWN";
  suggested_action: StaffAction;
  confidence: number;
}

export interface StaffDecision {
  intent_type: "SALES" | "SUPPORT" | "COMPLAINT" | "INQUIRY" | "UNKNOWN";
  confidence: number;
  response_payload: string;
  required_actions: StaffAction[];
  safety_flags: string[];
  source: "LLM" | "RULE_OVERRIDE" | "REPLAY";
  decision_hash: string;
  customer_need: string;
}

export interface Commitment {
  id: string;
  tenantId: string;
  aggregateId: string;
  type: string;
  status: "PENDING" | "IN_PROGRESS" | "RESOLVED" | "EXPIRED" | "ESCALATED" | "FAILED";
  context: any;
  deadlineAt: string;
  createdAt: string;
  resolvedAt?: string;
  correlationId: string;
  workerId?: string;
  leaseExpiresAt?: string;
}

export type ExecutionRequest = {
  tenantId: string;
  instanceId: string;
  triggeredBy: 'whatsapp_message' | 'abm_schedule' | 'commitment_recovery' | 'daily_brief';
  commitmentPending: boolean;
  creditBalance: number;
  creditRequired: number;
  tenantStatus: 'active' | 'suspended' | 'trial_expired';
  safetyFlags: string[];
  requestedAt: number;
  fingerprint: string; // hash(tenantId + instanceId + messageId + normalizedBody)
  activeCommitmentCount: number;
  identityId: string;
  schedulerConflict: boolean;
};

export type LatencyBreakdown = {
  identityMs?: number;
  arbitrationMs?: number;
  inferenceMs?: number;
  dispatchMs?: number;
  totalMs: number;
};

export type GateTraceEntry = {
  gate: string;
  decision: 'passed' | 'triggered' | 'blocked';
  reason?: string;
};

export type ArbiterVerdict = {
  outcome:
    | 'ALLOW'
    | 'ALLOW_WITH_CONTEXT_OVERRIDE'
    | 'DEGRADE_RESPONSE'
    | 'BLOCK_RESPONSE'
    | 'QUEUE_FOR_RECOVERY';
  reason: string;
  controllerTriggered: string;
  gateTrace: GateTraceEntry[];
  contextOverride?: string; // MAX 1–3 sentences, business-safe only
  recoveryPayload?: object;
  resolvedAt: number;
  fingerprint: string;
  latencyBreakdown?: LatencyBreakdown;
};



