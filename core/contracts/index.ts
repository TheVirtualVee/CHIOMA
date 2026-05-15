import { TraceContext } from "./telemetry.js";

export interface StaffLoopInput {
  messageId: string;
  tenantId: string;
  senderPhone: string;
  messageText: string;
  correlationId: string;
  causationId: string;
  eventId: string;
  channel: "whatsapp" | "simulation";
  traceContext?: TraceContext; // Optional — fallback created if absent
  snapshotId?: string; // Temporal grounding key
}

export interface StaffLoopResult {
  responseText: string;
  responseType: "onboarding" | "conversation" | "error_degraded";
  delivered: boolean;
  latencyMs: number;
  correlationId: string;
  decision?: StaffDecision;
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
