export interface ExecutionLease {
  readonly leaseId: string;
  readonly aggregateId: string;
  readonly workerId: string;
  readonly acquiredAt: string;
  readonly expiresAt: string;
  readonly fencingToken: number;
}

export async function acquireLease(
  sql: any,
  aggregateId: string,
  workerId: string,
  leaseDurationSeconds: number = 30
): Promise<ExecutionLease | null> {
  const [row] = await sql`
    INSERT INTO execution_leases (aggregate_id, worker_id, expires_at, fencing_token)
    VALUES (
      ${aggregateId},
      ${workerId},
      NOW() + ${leaseDurationSeconds} * interval '1 second',
      nextval('lease_fence_seq')
    )
    ON CONFLICT (aggregate_id) DO UPDATE
      SET worker_id = EXCLUDED.worker_id,
          expires_at = EXCLUDED.expires_at,
          fencing_token = EXCLUDED.fencing_token
    WHERE execution_leases.expires_at < NOW()
    RETURNING *
  `;

  if (!row) return null;

  return {
    leaseId: row.lease_id,
    aggregateId: row.aggregate_id,
    workerId: row.worker_id,
    acquiredAt: row.acquired_at,
    expiresAt: row.expires_at,
    fencingToken: row.fencing_token,
  };
}

export async function renewLease(
  sql: any,
  aggregateId: string,
  workerId: string,
  currentFencingToken: number,
  extensionSeconds: number = 30
): Promise<boolean> {
  const result = await sql`
    UPDATE execution_leases
    SET expires_at = NOW() + ${extensionSeconds} * interval '1 second'
    WHERE aggregate_id = ${aggregateId}
      AND worker_id = ${workerId}
      AND fencing_token = ${currentFencingToken}
      AND expires_at > NOW()
  `;
  return result.count > 0;
}

export async function releaseLease(
  sql: any,
  aggregateId: string,
  workerId: string,
  currentFencingToken: number
): Promise<void> {
  await sql`
    DELETE FROM execution_leases
    WHERE aggregate_id = ${aggregateId}
      AND worker_id = ${workerId}
      AND fencing_token = ${currentFencingToken}
  `;
}

export interface WorkerOwnershipModel {
  maxConcurrentAggregates: 1;
  maxWorkerInstances: number;
  leaseRenewalIntervalMs: number;
  staleLeaseSweepIntervalMs: number;
}
