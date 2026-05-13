import postgres from "postgres";

/**
 * infrastructure/database/index.ts
 *
 * Primary database client for CHIOMA.
 * Ensures consistent connection parameters and SSL requirements.
 */

export function createDatabaseClient(url: string, options: { max?: number } = {}) {
  if (!url || !url.startsWith("postgres")) {
    throw new Error("DATABASE_URL_INVALID");
  }

  return postgres(url, {
    max: options.max ?? 10,
    ssl: "require",
    idle_timeout: 20,
    connect_timeout: 10,
  });
}

/**
 * Event Log persistence contract.
 * Supports both standard Sql and TransactionSql.
 */
export async function commitEvent(
  sql: any,
  event: {
    id: string;
    type: string;
    payload: any;
    tenantId: string;
    correlationId: string;
  }
) {
  await sql`
    INSERT INTO core.events (id, type, payload, tenant_id, correlation_id)
    VALUES (
      ${event.id},
      ${event.type},
      ${sql.json(event.payload)},
      ${event.tenantId},
      ${event.correlationId}
    )
  `;
}

/**
 * Retrieve recent events for a tenant.
 */
export async function getEventsForTenant(sql: any, tenantId: string, limit: number = 50) {
  return await sql`
    SELECT * FROM core.events 
    WHERE tenant_id = ${tenantId} 
    ORDER BY created_at DESC 
    LIMIT ${limit}
  `;
}
