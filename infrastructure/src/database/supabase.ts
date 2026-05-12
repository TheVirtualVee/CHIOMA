import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { DomainEvent } from "@chioma/core";
import type { EventProjectionStore } from "./stores.js";
import type { AppendOnlyEventLog } from "../event-bus/in-memory.js";

/**
 * Production-ready Supabase implementation of the AppendOnlyEventLog.
 * Enforces Priority 1: Persistent event store, tenant-scoped.
 */
export class SupabaseEventLog implements AppendOnlyEventLog {
  constructor(private readonly client: SupabaseClient) {}

  async append(event: DomainEvent): Promise<void> {
    const { error } = await this.client.from("events").insert({
      id: event.id,
      type: event.type,
      occurred_at: event.occurredAt,
      payload: event.payload,
      correlation_id: event.correlationId,
      causation_id: event.causationId,
      tenant_id: event.tenantId,
    });

    if (error) {
      throw new Error(`SUPABASE_WRITE_FAILURE: Failed to append event ${event.id}. Error: ${error.message}`);
    }
  }

  async all(): Promise<readonly DomainEvent[]> {
    // NOTE: In production, we should probably paginate or filter by tenant.
    // For replay-safe reconstruction, we fetch all in order.
    const { data, error } = await this.client
      .from("events")
      .select("*")
      .order("created_at", { ascending: true });

    if (error) {
      throw new Error(`SUPABASE_READ_FAILURE: Failed to fetch events. Error: ${error.message}`);
    }

    return data.map((row) => ({
      id: row.id,
      type: row.type,
      occurredAt: row.occurred_at,
      payload: row.payload,
      correlationId: row.correlation_id,
      causationId: row.causation_id,
      tenantId: row.tenant_id,
    }));
  }

  async tenantEvents(tenantId: string): Promise<DomainEvent[]> {
    const { data, error } = await this.client
      .from("events")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: true });

    if (error) {
      throw new Error(`SUPABASE_READ_FAILURE: Failed to fetch tenant events. Error: ${error.message}`);
    }

    return data.map((row) => ({
      id: row.id,
      type: row.type,
      occurredAt: row.occurred_at,
      payload: row.payload,
      correlationId: row.correlation_id,
      causationId: row.causation_id,
      tenantId: row.tenant_id,
    }));
  }
}

/**
 * Production-ready Supabase implementation of the EventProjectionStore.
 * Enforces Priority 1: Tenant-scoped projections, idempotency guard.
 */
export class SupabaseProjectionStore implements EventProjectionStore {
  constructor(private readonly client: SupabaseClient) {}

  async recordApplied(tenantId: string, eventId: string): Promise<void> {
    const { error } = await this.client.from("projections_applied").upsert({
      tenant_id: tenantId,
      event_id: eventId,
    });

    if (error) {
      throw new Error(`SUPABASE_WRITE_FAILURE: Failed to record applied event ${eventId}. Error: ${error.message}`);
    }
  }

  async hasApplied(tenantId: string, eventId: string): Promise<boolean> {
    const { data, error } = await this.client
      .from("projections_applied")
      .select("event_id")
      .eq("tenant_id", tenantId)
      .eq("event_id", eventId)
      .maybeSingle();

    if (error) {
      throw new Error(`SUPABASE_READ_FAILURE: Failed to check applied event ${eventId}. Error: ${error.message}`);
    }

    return !!data;
  }
}

/**
 * Production-ready Supabase implementation of the DeadLetterStore.
 */
export class SupabaseDeadLetterStore {
  constructor(private readonly client: SupabaseClient) {}

  async store(entry: {
    event: DomainEvent;
    error: string;
    failedAt: string;
    service: string;
  }): Promise<void> {
    const { error } = await this.client.from("dead_letter_queue").insert({
      event_id: entry.event.id,
      tenant_id: entry.event.tenantId,
      error: entry.error,
      service: entry.service,
      failed_at: entry.failedAt,
      event_payload: entry.event,
    });

    if (error) {
      console.error(`SUPABASE_DLQ_FAILURE: Failed to store dead letter. Error: ${error.message}`);
    }
  }

  async all(): Promise<any[]> {
    const { data, error } = await this.client.from("dead_letter_queue").select("*");
    if (error) throw new Error(`SUPABASE_READ_FAILURE: ${error.message}`);
    return data;
  }
}

export function createSupabaseClient(url: string, key: string): SupabaseClient {
  return createClient(url, key, {
    auth: { persistSession: false },
  });
}
