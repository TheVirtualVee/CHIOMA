export type Actor = "CHIOMA" | "OWNER" | "SYSTEM" | "NONE";
export type ConversationMode =
  | "COLLABORATIVE"
  | "AUTONOMOUS"
  | "OVERRIDE_WINDOW"
  | "ESCALATION_LOCK";

export type ConversationState = {
  tenantId: string;
  customerPhone: string;
  ownerLastSeen: number | null;
  ownerOnlineStatus: "online" | "away" | "offline";
  responseLockUntil: number | null;
  lastChiomaAt: number | null;
  lastOwnerAt: number | null;
  messageCount: number;
  escalationActive?: boolean;
};

export type ArbitrationDecision = {
  actor: Actor;
  reason: string;
};

// ============================================
// TENANT RESOLUTION
// ============================================

export async function resolveTenantFromTelegram(
  sql: any,
  chatId: string,
  botToken: string
): Promise<string | null> {
  // Step 1: Does this bot token belong to a tenant?
  // We use chioma_instances for backward compatibility or tenant_instances
  // For now we check tenant_instances
  const [instance] = await sql`
    SELECT tenant_id FROM tenant_instances
    WHERE telegram_bot_token = ${botToken}
  `;
  
  if (instance) return instance.tenant_id;
  
  // Step 2: Is this a direct owner chat (onboarding flow)?
  const [ownerTenant] = await sql`
    SELECT tenant_id FROM tenants
    WHERE ${chatId} = ANY(owner_telegram_ids)
  `;
  
  if (ownerTenant) return ownerTenant.tenant_id;
  
  // Step 3: Customer messaging - need business context
  // For MVP: return first active tenant
  const [defaultTenant] = await sql`
    SELECT tenant_id FROM tenant_instances
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
): Promise<'owner' | 'customer' | 'unknown'> {
  // Check if this user is an owner of this tenant
  const [tenant] = await sql`
    SELECT owner_telegram_ids FROM tenants
    WHERE tenant_id = ${tenantId}
  `;
  
  if (tenant && tenant.owner_telegram_ids && tenant.owner_telegram_ids.includes(channelUserId)) {
    return 'owner';
  }
  
  // Check if this is a known customer
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
): Promise<ConversationState> {
  const [instance] = await sql`
    SELECT owner_last_seen, owner_online_status, response_lock_until
    FROM tenant_instances
    WHERE tenant_id = ${tenantId}
  `;
  
  const [memory] = await sql`
    SELECT last_chioma_at, last_owner_at, message_count
    FROM customer_memory
    WHERE tenant_id = ${tenantId} AND customer_phone = ${customerPhone}
  `;
  
  return {
    tenantId,
    customerPhone,
    ownerLastSeen: instance?.owner_last_seen?.getTime() || null,
    ownerOnlineStatus: instance?.owner_online_status || 'offline',
    responseLockUntil: instance?.response_lock_until?.getTime() || null,
    lastChiomaAt: memory?.last_chioma_at?.getTime() || null,
    lastOwnerAt: memory?.last_owner_at?.getTime() || null,
    messageCount: memory?.message_count || 0,
    escalationActive: false // Set dynamically by checkEscalation
  };
}

// ============================================
// MODE RESOLVER
// ============================================

export function resolveMode(state: ConversationState): ConversationMode {
  const now = Date.now();

  if (state.escalationActive) return "ESCALATION_LOCK";
  
  if (state.responseLockUntil && now < state.responseLockUntil) {
    return "OVERRIDE_WINDOW";
  }
  
  if (state.ownerOnlineStatus === "online") {
    return "COLLABORATIVE";
  }
  
  if (state.ownerOnlineStatus === "away") {
    return "COLLABORATIVE";
  }
  
  return "AUTONOMOUS";
}

// ============================================
// SPEAKER ARBITER (CORE LOGIC)
// ============================================

export function resolveSpeaker(state: ConversationState): ArbitrationDecision {
  const mode = resolveMode(state);
  const now = Date.now();

  // 🔒 HARD OVERRIDE LOCK
  if (mode === "OVERRIDE_WINDOW") {
    return { actor: "NONE", reason: "owner_override_lock" };
  }

  // 🚨 ESCALATION
  if (mode === "ESCALATION_LOCK") {
    return { actor: "OWNER", reason: "emergency_escalation" };
  }

  // 🤝 COLLABORATIVE MODE
  if (mode === "COLLABORATIVE") {
    const ownerRecentlySpoke =
      state.lastOwnerAt && now - state.lastOwnerAt < 10_000; // 10 second priority window
    
    if (ownerRecentlySpoke) {
      return { actor: "OWNER", reason: "owner_priority_window" };
    }
    
    return { actor: "CHIOMA", reason: "ai_assist_active" };
  }

  // 🤖 AUTONOMOUS MODE
  if (mode === "AUTONOMOUS") {
    return { actor: "CHIOMA", reason: "offline_autonomy" };
  }

  // Default fallback (should never reach here)
  return { actor: "CHIOMA", reason: "default_fallback" };
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
