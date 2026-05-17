

export type Actor = "CHIOMA" | "OWNER" | "NONE";
export type ConversationMode =
  | "COLLABORATIVE"
  | "AUTONOMOUS"
  | "OVERRIDE_WINDOW"
  | "ESCALATION_LOCK";

export type ConversationState = {
  tenantId: string;
  chatId: string;
  lastOwnerAt: number | null;
  lastChiomaAt: number | null;
  lastCustomerAt: number;
  responseLockUntil: number | null;
  ownerOnlineStatus: "online" | "away" | "offline";
  escalationActive: boolean;
};

export type ArbitrationDecision = {
  actor: Actor;
  reason: string;
};

// ============================================
// STATE BUILDER (DB as source of truth)
// ============================================

export async function buildConversationState(
  sql: any,
  tenantId: string,
  chatId: string
): Promise<ConversationState> {
  const [instance] = await sql`
    SELECT owner_last_seen,
           response_lock_until,
           owner_online_status
    FROM chioma_instances
    WHERE tenant_id = ${tenantId}
  `;

  const [lastOwner] = await sql`
    SELECT created_at
    FROM conversation_events
    WHERE tenant_id = ${tenantId}
      AND chat_id = ${chatId}
      AND actor = 'owner'
    ORDER BY created_at DESC
    LIMIT 1
  `;

  const [lastChioma] = await sql`
    SELECT created_at
    FROM conversation_events
    WHERE tenant_id = ${tenantId}
      AND chat_id = ${chatId}
      AND actor = 'chioma'
    ORDER BY created_at DESC
    LIMIT 1
  `;

  const [lastCustomer] = await sql`
    SELECT created_at
    FROM conversation_events
    WHERE tenant_id = ${tenantId}
      AND chat_id = ${chatId}
      AND actor = 'customer'
    ORDER BY created_at DESC
    LIMIT 1
  `;

  return {
    tenantId,
    chatId,
    lastOwnerAt: instance?.owner_last_seen
      ? new Date(instance.owner_last_seen).getTime()
      : null,
    lastChiomaAt: lastChioma?.created_at
      ? new Date(lastChioma.created_at).getTime()
      : null,
    lastCustomerAt: lastCustomer?.created_at
      ? new Date(lastCustomer.created_at).getTime()
      : Date.now(),
    responseLockUntil: instance?.response_lock_until
      ? new Date(instance.response_lock_until).getTime()
      : null,
    ownerOnlineStatus: instance?.owner_online_status ?? "offline",
    escalationActive: false, // Will be set by caller after keyword detection
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
// OWNER OVERRIDE LOCK
// ============================================

export async function applyOwnerOverrideLock(
  sql: any,
  tenantId: string,
  lockSeconds: number = 10
): Promise<void> {
  await sql`
    UPDATE chioma_instances
    SET response_lock_until = NOW() + INTERVAL '${lockSeconds} seconds'
    WHERE tenant_id = ${tenantId}
  `;
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
