import postgres from "postgres";
import type { DomainEvent } from "@chioma/core";
import type { EventProjectionStore } from "./stores.js";

/** contract: SupabaseProjectionStore */
export function createSupabaseProjectionStore(connectionString: string): EventProjectionStore {
  const sql = postgres(connectionString, {
    ssl: "require",
    max: 10,
  });

  return {
    async recordApplied(tenantId: string, eventId: string) {
      if (!tenantId) throw new Error("TENANT_ISOLATION_FAILURE: tenantId required");
      
      try {
        await sql`
          INSERT INTO core.projections (tenant_id, event_id)
          VALUES (${tenantId}, ${eventId})
          ON CONFLICT DO NOTHING
        `;
      } catch (err) {
        throw new Error(`EXECUTION_FAILED: Failed to record projection for ${tenantId} / ${eventId}`);
      }
    },
    
    async hasApplied(tenantId: string, eventId: string) {
      if (!tenantId) throw new Error("TENANT_ISOLATION_FAILURE: tenantId required");

      try {
        const result = await sql`
          SELECT 1 FROM core.projections 
          WHERE tenant_id = ${tenantId} AND event_id = ${eventId}
        `;
        return result.length > 0;
      } catch (err) {
        throw new Error(`EXECUTION_FAILED: Failed to check projection for ${tenantId} / ${eventId}`);
      }
    },
  };
}

export function createSupabaseEventLog(connectionString: string) {
  const sql = postgres(connectionString, {
    ssl: "require",
  });

  return {
    async append(event: DomainEvent) {
      if (!event.tenantId) throw new Error("TENANT_ISOLATION_FAILURE: tenantId required");
      
      try {
        await sql`
          INSERT INTO core.events (id, type, payload, correlation_id, causation_id, tenant_id, occurred_at)
          VALUES (
            ${event.id}, 
            ${event.type}, 
            ${sql.json(event.payload as any)}, 
            ${event.correlationId}, 
            ${event.causationId ?? null}, 
            ${event.tenantId}, 
            ${event.occurredAt}
          )
        `;
      } catch (err) {
        throw new Error(`EXECUTION_FAILED: Failed to append event ${event.id}`);
      }
    },
    
    async getHistory(tenantId: string): Promise<DomainEvent[]> {
      if (!tenantId) throw new Error("TENANT_ISOLATION_FAILURE: tenantId required");

      try {
        const rows = await sql`
          SELECT id, type, payload, correlation_id, causation_id, tenant_id, occurred_at
          FROM core.events
          WHERE tenant_id = ${tenantId}
          ORDER BY occurred_at ASC
        `;
        
        return rows.map(r => ({
          id: r.id,
          type: r.type,
          payload: r.payload,
          correlationId: r.correlation_id,
          causationId: r.causation_id,
          tenantId: r.tenant_id,
          occurredAt: r.occurred_at
        }));
      } catch (err) {
        throw new Error(`EXECUTION_FAILED: Failed to load event history for ${tenantId}`);
      }
    },
    
    async getSince(tenantId: string, lastPosition: number): Promise<{ event: DomainEvent, position: number }[]> {
      if (!tenantId) throw new Error("TENANT_ISOLATION_FAILURE: tenantId required");

      try {
        const rows = await sql`
          SELECT id, type, payload, correlation_id, causation_id, tenant_id, occurred_at, global_position
          FROM core.events
          WHERE tenant_id = ${tenantId} AND global_position > ${lastPosition}
          ORDER BY global_position ASC
          LIMIT 100
        `;
        
        return rows.map(r => ({
          event: {
            id: r.id,
            type: r.type,
            payload: r.payload,
            correlationId: r.correlation_id,
            causationId: r.causation_id,
            tenantId: r.tenant_id,
            occurredAt: r.occurred_at
          },
          position: parseInt(r.global_position, 10)
        }));
      } catch (err) {
        throw new Error(`EXECUTION_FAILED: Failed to load unread events for ${tenantId}`);
      }
    }
  };
}

/** contract: SupabaseConsumerStore */
export function createSupabaseConsumerStore(connectionString: string) {
  const sql = postgres(connectionString, { ssl: "require", max: 5 });

  // Initialize table if it doesn't exist (useful for bootstrap)
  sql`
    CREATE TABLE IF NOT EXISTS core.consumer_offsets (
      tenant_id TEXT NOT NULL,
      consumer_group TEXT NOT NULL,
      last_position BIGINT NOT NULL DEFAULT 0,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, consumer_group)
    );
  `.catch(() => {});

  return {
    async getOffset(tenantId: string, consumerGroup: string): Promise<number> {
      if (!tenantId) throw new Error("TENANT_ISOLATION_FAILURE: tenantId required");
      const rows = await sql`
        SELECT last_position FROM core.consumer_offsets 
        WHERE tenant_id = ${tenantId} AND consumer_group = ${consumerGroup}
      `;
      return rows.length > 0 ? parseInt(rows[0].last_position, 10) : 0;
    },
    async updateOffset(tenantId: string, consumerGroup: string, position: number): Promise<void> {
      if (!tenantId) throw new Error("TENANT_ISOLATION_FAILURE: tenantId required");
      await sql`
        INSERT INTO core.consumer_offsets (tenant_id, consumer_group, last_position)
        VALUES (${tenantId}, ${consumerGroup}, ${position})
        ON CONFLICT (tenant_id, consumer_group) 
        DO UPDATE SET last_position = EXCLUDED.last_position, updated_at = CURRENT_TIMESTAMP
      `;
    }
  };
}
