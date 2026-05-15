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
