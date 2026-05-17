export type Actor = "CHIOMA" | "OWNER" | "SYSTEM" | "NONE";

export type ArbitrationInput = {
  // Identity Layer (Article 4.1)
  tenantId: string;
  channelUserId: string;
  channelChatId: string;
  
  // Temporal State (Article 4.2)
  ownerLastSeen: number | null;
  lastOwnerAt: number | null;
  lastChiomaAt: number | null;
  responseLockUntil: number | null;
  
  // Configuration Layer (Article 4.3)
  autoResponseThresholdMinutes: number;
  slowResponseThresholdSeconds: number;
  overrideLockSeconds: number;
  
  // Actor Classification (Article 4.4)
  actorClassification: 'owner' | 'customer' | 'system' | 'unknown';
  
  // Escalation Check (Added for completeness within the state machine)
  escalationActive?: boolean;
};

export type ArbitrationOutput = {
  actor: 'CHIOMA' | 'OWNER' | 'NONE' | 'SYSTEM';
  reason: string;
  confidence: 0 | 1;
};

// ============================================
// TENANT RESOLUTION
// ============================================

export async function resolveTenantFromTelegram(
  sql: any,
  chatId: string,
  botToken: string
): Promise<string | null> {
  const [instance] = await sql`
    SELECT tenant_id FROM chioma_instances
    WHERE telegram_bot_token = ${botToken}
  `;
  if (instance) return instance.tenant_id;
  
  const [ownerTenant] = await sql`
    SELECT tenant_id FROM tenants
    WHERE ${chatId} = ANY(owner_telegram_ids)
  `;
  if (ownerTenant) return ownerTenant.tenant_id;
  
  const [defaultTenant] = await sql`
    SELECT tenant_id FROM chioma_instances
    WHERE billing_state = 'ACTIVE'
    LIMIT 1
  `;
  return defaultTenant?.tenant_id || null;
}

// ============================================
// ACTOR DETECTION
// ============================================

export async function detectActor(
  sql: any,
  tenantId: string,
  channelUserId: string
): Promise<'owner' | 'customer' | 'system' | 'unknown'> {
  const [tenant] = await sql`
    SELECT owner_telegram_ids FROM tenants
    WHERE tenant_id = ${tenantId}
  `;
  if (tenant && tenant.owner_telegram_ids && tenant.owner_telegram_ids.includes(channelUserId)) {
    return 'owner';
  }
  
  const [customer] = await sql`
    SELECT customer_phone FROM customer_memory
    WHERE tenant_id = ${tenantId} AND customer_phone = ${channelUserId}
  `;
  if (customer) return 'customer';
  
  return 'unknown';
}

// ============================================
// STATE BUILDER (DB as source of truth)
// ============================================

export async function getConversationState(
  sql: any,
  tenantId: string,
  customerPhone: string
): Promise<Partial<ArbitrationInput>> {
  const [tenant] = await sql`
    SELECT auto_respond_threshold_minutes, slow_response_threshold_seconds, override_lock_seconds
    FROM tenants
    WHERE tenant_id = ${tenantId}
  `;
  
  const [instance] = await sql`
    SELECT owner_last_seen, response_lock_until
    FROM chioma_instances
    WHERE tenant_id = ${tenantId}
  `;
  
  const [memory] = await sql`
    SELECT last_chioma_at, last_owner_at
    FROM customer_memory
    WHERE tenant_id = ${tenantId} AND customer_phone = ${customerPhone}
  `;
  
  return {
    ownerLastSeen: instance?.owner_last_seen?.getTime() || null,
    responseLockUntil: instance?.response_lock_until?.getTime() || null,
    lastChiomaAt: memory?.last_chioma_at?.getTime() || null,
    lastOwnerAt: memory?.last_owner_at?.getTime() || null,
    autoResponseThresholdMinutes: tenant?.auto_respond_threshold_minutes ?? 5,
    slowResponseThresholdSeconds: tenant?.slow_response_threshold_seconds ?? 30,
    overrideLockSeconds: tenant?.override_lock_seconds ?? 10
  };
}

// ============================================
// SPEAKER ARBITER (CORE LOGIC)
// ============================================

export function ARBITRATE(input: ArbitrationInput): ArbitrationOutput {
  const now = Date.now();

  // RULE 1 — OWNER IS ABSOLUTE PRIORITY
  if (input.actorClassification === 'owner') {
    return { actor: 'OWNER', reason: 'owner_identity_event', confidence: 1 };
  }

  // SYSTEM EMERGENCY ESCALATION OVERRIDE
  if (input.escalationActive) {
    return { actor: 'OWNER', reason: 'emergency_escalation', confidence: 1 };
  }

  // RULE 2 — OWNER OVERRIDE LOCK IS GLOBAL SUPPRESSION FIELD
  if (input.responseLockUntil !== null && now < input.responseLockUntil) {
    return { actor: 'NONE', reason: 'owner_override_lock_active', confidence: 1 };
  }

  // RULE 7 — SYSTEM EVENTS ARE PASS-THROUGH ONLY
  if (input.actorClassification === 'system') {
    return { actor: 'SYSTEM', reason: 'system_event_pass_through', confidence: 1 };
  }

  // RULE 6 — SUPPRESSION RULE (NONE STATE)
  if (input.actorClassification === 'unknown') {
    return { actor: 'NONE', reason: 'unknown_actor_suppression', confidence: 1 };
  }

  // CUSTOMER PATH ARBITRATION
  if (input.actorClassification === 'customer') {
    // RULE 3 — OWNER RECENCY DOMINANCE
    const OWNER_RECENCY_WINDOW_MS = 10_000;
    const ownerRecentlySpoke = input.lastOwnerAt !== null && (now - input.lastOwnerAt) < OWNER_RECENCY_WINDOW_MS;
    if (ownerRecentlySpoke) {
      return { actor: 'NONE', reason: 'owner_recently_spoke_suppression', confidence: 1 };
    }

    // Determine Owner Online Status
    const isOwnerOnline = input.ownerLastSeen !== null && (now - input.ownerLastSeen) < (input.autoResponseThresholdMinutes * 60 * 1000);

    // RULE 5 — COLLABORATIVE MODE
    if (isOwnerOnline) {
      return { actor: 'CHIOMA', reason: 'owner_online_collaborative_assist', confidence: 1 };
    }

    // RULE 4 — AUTONOMOUS MODE ACTIVATION
    if (!isOwnerOnline) {
      return { actor: 'CHIOMA', reason: 'owner_offline_autonomous_mode', confidence: 1 };
    }
  }

  // FINAL AXIOM (SYSTEM CLOSURE CONDITION)
  return { actor: 'NONE', reason: 'default_suppression_no_decision', confidence: 1 };
}

// ============================================
// ESCALATION KEYWORD CHECK
// ============================================

const ESCALATION_KEYWORDS = [
  "refund", "complaint", "manager", "escalate", "lawsuit",
  "lawyer", "sue", "legal", "threat", "violence", "urgent",
  "emergency", "supervisor", "owner", "terrible", "awful",
  "fake", "scam", "fraud", "chargeback"
];

export function checkEscalation(message: string): { isEscalation: boolean; keyword: string | null } {
  const lowerMsg = message.toLowerCase();
  const found = ESCALATION_KEYWORDS.find(kw => lowerMsg.includes(kw));
  return {
    isEscalation: !!found,
    keyword: found || null
  };
}
