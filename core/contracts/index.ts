/**
 * core/contracts/index.ts
 *
 * CHIOMA — The Single Employability Contract.
 * Collapses all architectural complexity into a single behavioral staff model.
 */

export interface StaffLoopInput {
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
}

/**
 * The only personalization source allowed for the Digital Employee.
 */
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

/**
 * The deterministic staff action resulting from an interaction.
 */
export interface StaffAction {
  type: "REPLY" | "ESCALATE" | "SCHEDULE_FOLLOWUP" | "IGNORE";
  urgency: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  revenue_weight: number; // 0.0 to 1.0
  need_classification: "REVENUE_NOW" | "REVENUE_SOON" | "NO_REVENUE" | "ESCALATION_REQUIRED";
}

/**
 * The inferred knowledge from social links before owner validation.
 */
export interface BusinessDraft {
  name_guess: string;
  products_guess: string[];
  pricing_guess?: string;
  tone_guess: string;
  location_guess?: string;
  working_pattern_guess?: string;
  confidence_scores: Record<string, number>;
}

/**
 * The suggested staff action from the conversational layer (LLM).
 */
export interface ProposedStaffDecision {
  response: string;
  customer_need: string;
  suggested_action: {
    type: "REPLY" | "ESCALATE" | "SCHEDULE_FOLLOWUP" | "IGNORE";
    urgency: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
    revenue_weight: number;
    need_classification: "REVENUE_NOW" | "REVENUE_SOON" | "NO_REVENUE" | "ESCALATION_REQUIRED";
  };
  confidence: number;
}

/**
 * The validated staff decision from the deterministic layer.
 */
export interface StaffDecision {
  response: string;
  customer_need: string;
  action: StaffAction;
  confidence: number;
}


