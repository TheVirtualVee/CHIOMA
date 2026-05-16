import postgres from "postgres";

export function createDatabaseClient(url: string, options: { max?: number } = {}) {
  if (!url || !url.startsWith("postgres")) {
    throw new Error("DATABASE_URL_INVALID");
  }

  console.log(`[DB_INFRA] Creating client [max=${options.max ?? 10}]`);
  const client = postgres(url, {
    max: options.max ?? 10,
    ssl: "require",
    idle_timeout: 20,
    connect_timeout: 10,
  });

  return client;
}

/**
 * FAILURE-009: Tenant-scoped client factory.
 * Enforces RLS by setting 'app.tenant_id'.
 * 
 * To avoid transaction nesting collisions with the AtomicRunner,
 * we use a reserved connection for the duration of the request context.
 */
export async function createTenantClient(url: string, tenantId: string, options: { max?: number } = {}) {
  const sql = createDatabaseClient(url, { ...options, max: 1 });
  
  // 🛡️ CRITICAL HARDENING:
  // 1. Downgrade session from superuser (postgres) to chioma_runtime (NOBYPASSRLS)
  // 2. Set the tenant boundary
  await sql.begin(async tx => {
    await tx`SET ROLE chioma_runtime`;
    await tx`SELECT set_config('app.tenant_id', ${tenantId}, false)`;
  });
  
  return sql;
}

export async function commitEvent(
  sql: any,
  event: {
    id: string;
    type: string;
    payload: any;
    tenantId: string;
    correlationId: string;
    causationId: string;
  }
) {
  await sql`
    INSERT INTO core.events (id, type, payload, tenant_id, correlation_id, causation_id)
    VALUES (
      ${event.id},
      ${event.type},
      ${sql.json(event.payload)},
      ${event.tenantId},
      ${event.correlationId},
      ${event.causationId}
    )
  `;
}

export async function updateEvent(sql: any, eventId: string, payload: any) {
  await sql`
    UPDATE core.events 
    SET payload = payload || ${sql.json(payload)},
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ${eventId}
  `;
}

export async function getEventsForTenant(sql: any, tenantId: string, limit: number = 50) {
  return await sql`
    SELECT * FROM core.events 
    WHERE tenant_id = ${tenantId} 
    ORDER BY created_at DESC 
    LIMIT ${limit}
  `;
}
export async function deductCredit(
  sql: any,
  instanceId: string,
  tenantId: string,
  correlationId: string,
  units: number = 1
): Promise<void> {
  const [instance] = await sql`
    UPDATE public.chioma_instances
    SET credit_units = credit_units - ${units}
    WHERE instance_id = ${instanceId} AND credit_units >= ${units}
    RETURNING credit_units
  `;

  if (!instance) {
    throw new Error("BILLING_FAILURE: Insufficient credits or instance not found.");
  }

  await sql`
    INSERT INTO public.billing_ledger (
      tenant_id, instance_id, event_type, credit_delta, balance_after, correlation_id
    ) VALUES (
      ${tenantId}, ${instanceId}, 'LLM_DEBIT', ${-units}, ${instance.credit_units}, ${correlationId}
    )
  `;
}
