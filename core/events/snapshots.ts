import type { ProjectedState } from "./types.js";

export interface AggregateSnapshot {
  snapshotId: string;
  aggregateId: string;
  upToSequence: number;
  state: ProjectedState;
  createdAt: string;
}

export async function findNearestSnapshot(
  sql: any,
  aggregateId: string,
  upToSequence?: number
): Promise<AggregateSnapshot | null> {
  const rows = upToSequence
    ? await sql`
        SELECT * FROM aggregate_snapshots
        WHERE aggregate_id = ${aggregateId}
          AND up_to_sequence <= ${upToSequence}
        ORDER BY up_to_sequence DESC
        LIMIT 1
      `
    : await sql`
        SELECT * FROM aggregate_snapshots
        WHERE aggregate_id = ${aggregateId}
        ORDER BY up_to_sequence DESC
        LIMIT 1
      `;

  if (!rows.length) return null;
  const row = rows[0];
  return {
    snapshotId: row.snapshot_id,
    aggregateId: row.aggregate_id,
    upToSequence: row.up_to_sequence,
    state: row.state as ProjectedState,
    createdAt: row.created_at,
  };
}

export async function createSnapshot(
  sql: any,
  aggregateId: string,
  upToSequence: number,
  state: ProjectedState
): Promise<void> {
  await sql`
    INSERT INTO aggregate_snapshots (aggregate_id, up_to_sequence, state, created_at)
    VALUES (${aggregateId}, ${upToSequence}, ${sql.json(state)}, NOW())
    ON CONFLICT (aggregate_id, up_to_sequence) DO NOTHING
  `;
}
