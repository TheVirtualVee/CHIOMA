export interface StaffLoopInput {
  messageId: string;
  tenantId: string;
  senderPhone: string;
  messageText: string;
  correlationId: string;
  causationId: string;
  eventId: string;
  channel: "whatsapp" | "simulation";
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
}

export type EmployabilityMode = 
  | "ACTIVE_EMPLOYEE" 
  | "ONBOARDING_EMPLOYEE" 
  | "OFFLINE_ESCALATION_ONLY";

export interface StaffAction {
  type: "REPLY" | "ESCALATE" | "SCHEDULE_FOLLOWUP" | "IGNORE";
  urgency: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  revenue_weight: number;
  need_classification: "REVENUE_NOW" | "REVENUE_SOON" | "NO_REVENUE" | "ESCALATION_REQUIRED";
}

export interface BusinessDraft {
  name_guess: string;
  products_guess: string[];
  pricing_guess?: string;
  tone_guess: string;
  location_guess?: string;
  working_pattern_guess?: string;
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
  decision_hash?: string;
  customer_need: string;
}
