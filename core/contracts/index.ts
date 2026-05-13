/**
 * core/contracts/index.ts
 *
 * CHIOMA — The Single Employability Contract.
 * Collapses all architectural complexity into a single behavioral staff model.
 */

export interface SyncPipelineInput {
  tenantId: string;
  senderPhone: string;
  messageText: string;
  correlationId: string;
  eventId: string;
  channel: "whatsapp" | "simulation";
}

export interface SyncPipelineResult {
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
  intent_classification: "REVENUE_NOW" | "REVENUE_SOON" | "NO_REVENUE" | "ESCALATION_REQUIRED";
}

export interface LlmOutput {
  response: string;
  intent: string;
  action: StaffAction;
  confidence: number;
}
