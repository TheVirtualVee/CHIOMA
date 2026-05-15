import { BusinessDailyState } from "../contracts/index.js";

/**
 * CHIOMA REALITY GOVERNOR (v5)
 * Purpose: Coordinate temporal truth across conversation, commitment, and recovery layers.
 */
export class RealityGovernor {
  constructor(private sql: any) {}

  /**
   * Resolves the "Active Truth" for new conversations.
   */
  async getActiveSnapshot(tenantId: string): Promise<{ data: BusinessDailyState; id: string } | null> {
    const [snapshot] = await this.sql`
      SELECT id, snapshot_data 
      FROM public.business_snapshots 
      WHERE tenant_id = ${tenantId} AND status = 'LOCKED'
      ORDER BY locked_at DESC LIMIT 1
    `;

    if (!snapshot) return null;
    return { id: snapshot.id, data: snapshot.snapshot_data };
  }

  /**
   * Resolves the "Historical Truth" for a specific commitment.
   * This ensures we honor the prices/rules that were active when the promise was made.
   */
  async getSnapshotForCommitment(commitmentId: string): Promise<{ data: BusinessDailyState; id: string } | null> {
    const [result] = await this.sql`
      SELECT s.id, s.snapshot_data
      FROM public.commitments c
      JOIN public.business_snapshots s ON c.snapshot_id = s.id
      WHERE c.id = ${commitmentId}
    `;

    if (!result) return null;
    return { id: result.id, data: result.snapshot_data };
  }

  /**
   * Directly retrieves a snapshot by its ID.
   */
  async getSnapshotById(snapshotId: string): Promise<{ data: BusinessDailyState; id: string } | null> {
    const [snapshot] = await this.sql`
      SELECT id, snapshot_data 
      FROM public.business_snapshots 
      WHERE id = ${snapshotId}
    `;

    if (!snapshot) return null;
    return { id: snapshot.id, data: snapshot.snapshot_data };
  }

  /**
   * Identifies the snapshot that was active at a specific point in time.
   */
  async getSnapshotAtTime(tenantId: string, timestamp: Date): Promise<{ data: BusinessDailyState; id: string } | null> {
    const [snapshot] = await this.sql`
      SELECT id, snapshot_data 
      FROM public.business_snapshots 
      WHERE tenant_id = ${tenantId} 
        AND status IN ('LOCKED', 'SUPERSEDED')
        AND locked_at <= ${timestamp}
      ORDER BY locked_at DESC LIMIT 1
    `;

    if (!snapshot) return null;
    return { id: snapshot.id, data: snapshot.snapshot_data };
  }
}
