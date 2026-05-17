import { ChiomaInstance } from "../contracts/index.js";

// ── In-process LRU cache for instance metadata ──────────────────────────────
// Warm Vercel instances reuse the same Node.js process. This cache prevents
// a Supabase brownout from cascading into degraded responses / greeting resets.
// TTL: 5 minutes. Max: 100 instances (safe for pilot phase).
// ASSERT: cache is never the source of truth for credit_units — those must
//         always be read atomically from DB in the billing gate.

const INSTANCE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const INSTANCE_CACHE_MAX = 100;

type CacheEntry = { instance: ChiomaInstance; cachedAt: number };
const instanceCache = new Map<string, CacheEntry>();

function cacheGet(key: string): ChiomaInstance | null {
  const entry = instanceCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > INSTANCE_CACHE_TTL_MS) {
    instanceCache.delete(key);
    return null;
  }
  return entry.instance;
}

function cacheSet(key: string, instance: ChiomaInstance): void {
  // Evict oldest entry if at capacity
  if (instanceCache.size >= INSTANCE_CACHE_MAX) {
    const firstKey = instanceCache.keys().next().value;
    if (firstKey) instanceCache.delete(firstKey);
  }
  instanceCache.set(key, { instance, cachedAt: Date.now() });
}



export async function resolveInstance(
  sql: any,
  phoneNumberId: string
): Promise<ChiomaInstance | null> {
  // Check cache first — prevents DB brownout from cascading to degraded responses
  const cacheKey = `phone:${phoneNumberId}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  let row: any;
  try {
    const [r] = await sql`
      SELECT 
        instance_id, tenant_id, whatsapp_phone_number,
        whatsapp_phone_number_id, billing_state, credit_units,
        business_model_version, llm_provider, llm_model, memory_namespace
      FROM public.chioma_instances
      WHERE whatsapp_phone_number_id = ${phoneNumberId}
    `;
    row = r;
  } catch (err: unknown) {
    console.error("[ROUTER] DB_ERROR resolveInstance:", String(err).slice(0, 100));
    return null;
  }

  if (!row) return null;

  const instance = mapRowToInstance(row);
  cacheSet(cacheKey, instance);
  return instance;
}

export async function resolveInstanceByTenant(
  sql: any,
  tenantId: string
): Promise<ChiomaInstance | null> {
  // Check cache first
  const cacheKey = `tenant:${tenantId}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const [row] = await sql`
    SELECT 
      instance_id,
      tenant_id,
      whatsapp_phone_number,
      whatsapp_phone_number_id,
      billing_state,
      credit_units,
      business_model_version,
      llm_provider,
      llm_model,
      memory_namespace
    FROM public.chioma_instances
    WHERE tenant_id = ${tenantId}
  `;

  if (!row) {
    console.error(`[ROUTER] NO_INSTANCE_FOUND for tenant_id: ${tenantId}`);
    return null;
  }

  const instance = mapRowToInstance(row);
  cacheSet(cacheKey, instance);
  return instance;
}

function mapRowToInstance(row: any): ChiomaInstance {
  return {
    instance_id: row.instance_id,
    tenant_id: row.tenant_id,
    whatsapp_phone_number: row.whatsapp_phone_number,
    whatsapp_phone_number_id: row.whatsapp_phone_number_id,
    billing_state: row.billing_state as "ACTIVE" | "PAUSED" | "EXPIRED",
    credit_units: row.credit_units,
    business_model_version: row.business_model_version,
    llm_config: {
      provider: row.llm_provider,
      model: row.llm_model,
    },
    memory_namespace: row.memory_namespace,
  };
}