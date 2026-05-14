import { createHash } from "node:crypto";
import type { ChiomaEvent } from "./types.js";

export function buildContentHash(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export function verifyContentHash(event: ChiomaEvent): boolean {
  const recomputed = buildContentHash(event.payload);
  return recomputed === event.contentHash;
}

export async function appendEvent(sql: any, event: ChiomaEvent): Promise<void> {
  if (!verifyContentHash(event)) {
    throw new Error(`IMMUTABILITY_VIOLATION: Content hash mismatch for event ${event.eventId}`);
  }

  await sql`
    INSERT INTO core.events (
      id,
      aggregate_id,
      aggregate_type,
      sequence_number,
      type,
      payload,
      causation_id,
      correlation_id,
      ledger_entry_id,
      occurred_at,
      schema_version,
      content_hash
    ) VALUES (
      ${event.eventId},
      ${event.aggregateId},
      ${event.aggregateType},
      ${event.sequenceNumber},
      ${event.type},
      ${sql.json(event.payload)},
      ${event.causationId},
      ${event.correlationId},
      ${event.ledgerEntryId},
      ${event.occurredAt},
      ${event.schemaVersion},
      ${event.contentHash}
    )
  `;
}

export async function loadEventsAfter(
  sql: any,
  aggregateId: string,
  afterSequence: number,
  upToSequence?: number
): Promise<ChiomaEvent[]> {
  const rows = upToSequence
    ? await sql`
        SELECT * FROM core.events
        WHERE aggregate_id = ${aggregateId}
          AND sequence_number > ${afterSequence}
          AND sequence_number <= ${upToSequence}
        ORDER BY sequence_number ASC
      `
    : await sql`
        SELECT * FROM core.events
        WHERE aggregate_id = ${aggregateId}
          AND sequence_number > ${afterSequence}
        ORDER BY sequence_number ASC
      `;

  return rows.map((row: any) => ({
    eventId: row.id,
    aggregateId: row.aggregate_id,
    aggregateType: row.aggregate_type,
    sequenceNumber: row.sequence_number,
    type: row.type,
    payload: row.payload,
    causationId: row.causation_id,
    correlationId: row.correlation_id,
    ledgerEntryId: row.ledger_entry_id,
    occurredAt: row.occurred_at,
    schemaVersion: row.schema_version,
    contentHash: row.content_hash,
  })) as ChiomaEvent[];
}

export async function getNextSequenceNumber(
  sql: any,
  aggregateId: string
): Promise<number> {
  const [row] = await sql`
    SELECT COALESCE(MAX(sequence_number), 0) + 1 AS next_seq
    FROM core.events
    WHERE aggregate_id = ${aggregateId}
  `;
  return row.next_seq as number;
}
