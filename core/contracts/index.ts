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

export interface EmployabilityProfile {
  tone_profile: "casual" | "formal" | "street-smart" | "luxury" | "friendly-shopkeeper";
  response_aggressiveness: "low" | "medium" | "high";
  follow_up_policy: "disabled" | "soft" | "aggressive";
  availability_mode: "always-on" | "business-hours-aware" | "owner-away-priority";
  conversion_bias: "low" | "medium" | "high";
  owner_preference_memory: Record<string, any>;
}

export interface CustomerMemory {
  last_intent?: string;
  unresolved_count: number;
  conversion_status: "PROSPECT" | "CUSTOMER" | "LOST";
  metadata: Record<string, any>;
}

export interface EmployabilityDecision {
  response_type: "reply" | "escalate" | "follow_up" | "hold";
  tone: string;
  urgency_level: number;
  should_notify_owner: boolean;
  revenue_weight: number;
  next_action: string;
}
