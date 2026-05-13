/**
 * core/contracts/index.ts
 *
 * The non-executable source of truth for CHIOMA's system shape.
 * Contains only interfaces and types used in the live runtime.
 */

export interface ChiomaEvent {
  id: string;
  type: string;
  tenantId: string;
  payload: any;
  timestamp: number;
}

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

export interface OnboardingState {
  tenantId: string;
  status: "PENDING" | "STARTED" | "COMPLETED";
  currentStep: string | null;
}

export interface LlmOutput {
  response: string;
  intent: string;
  is_revenue_intent: boolean;
  revenue_classification?: {
    type: "BUY_INTENT" | "INQUIRY" | "SUPPORT" | "OTHER";
    urgency: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
    value_estimate?: number;
    recommended_action: "RESPOND_IMMEDIATELY" | "ESCALATE_TO_OWNER" | "SCHEDULE_FOLLOWUP" | "IGNORE";
  };
  proposed_commitments: any[];
  confidence: number;
}
