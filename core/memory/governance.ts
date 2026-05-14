export type MemoryCategory = 
  | "TRANSACTIONAL"    // Permanent: Order IDs, Booking dates
  | "PREFERENCE"       // Medium: Style preferences, address
  | "EMOTIONAL_CONTEXT" // Short: Current mood (hurried, frustrated)
  | "REVENUE_CONTEXT"   // Permanent: Customer lifetime value
  | "EPHEMERAL"         // Volatile: Current conversation thread state
  | "FORBIDDEN";        // Speculative inference, attachment

export interface GovernedMemory {
  key: string;
  value: any;
  category: MemoryCategory;
  lastUpdated: string;
  expiresAt?: string;
  replaySafe: boolean;
}

export interface MemorySnapshot {
  tenantId: string;
  customerPhone: string;
  memories: GovernedMemory[];
}

const CATEGORY_TTLS = {
  TRANSACTIONAL: null,
  PREFERENCE: 1000 * 60 * 60 * 24 * 90, // 90 days
  EMOTIONAL_CONTEXT: 1000 * 60 * 60 * 2, // 2 hours
  REVENUE_CONTEXT: null,
  EPHEMERAL: 1000 * 60 * 30, // 30 minutes
  FORBIDDEN: 0
};

export function classifyMemory(key: string, value: any): MemoryCategory {
  const k = key.toLowerCase();
  const v = String(value).toLowerCase();

  const attachmentPatterns = [
    /\blove\b/, /\bfriend\b/, /\bclose\b/, /\battach\b/, 
    /\blike me\b/, /\bpersonal connection\b/, /\brelationship\b/
  ];

  if (attachmentPatterns.some(p => p.test(v))) return "FORBIDDEN";

  if (k.includes("order") || k.includes("booking") || k.includes("id")) return "TRANSACTIONAL";
  if (k.includes("pref") || k.includes("style") || k.includes("address")) return "PREFERENCE";
  if (k.includes("mood") || k.includes("tone") || k.includes("emotion")) return "EMOTIONAL_CONTEXT";
  if (k.includes("spend") || k.includes("value") || k.includes("revenue")) return "REVENUE_CONTEXT";

  return "EPHEMERAL";
}

export function scrubEmotionalAccumulation(memories: GovernedMemory[]): GovernedMemory[] {
  return memories.filter(m => m.category !== "FORBIDDEN");
}

export function enforceMemoryGovernance(memories: GovernedMemory[]): GovernedMemory[] {
  const now = new Date();
  return scrubEmotionalAccumulation(memories).filter(m => {
    if (!m.expiresAt) return true;
    return new Date(m.expiresAt) > now;
  });
}

export function createGovernedMemory(key: string, value: any): GovernedMemory {
  const category = classifyMemory(key, value);
  const ttl = CATEGORY_TTLS[category];
  
  return {
    key,
    value,
    category,
    lastUpdated: new Date().toISOString(),
    expiresAt: ttl ? new Date(Date.now() + ttl).toISOString() : undefined,
    replaySafe: category !== "EPHEMERAL" && category !== "FORBIDDEN"
  };
}
