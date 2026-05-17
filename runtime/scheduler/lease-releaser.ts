export type Lease = {
  id: string;
  tenant_id: string;
  aggregate_id: string;
  status: string;
  acquired_at: Date;
};

export async function getStaleLeases(sql: any, options: { olderThanMinutes: number }): Promise<Lease[]> {
  // Check if table exists dynamically to prevent crashes before migration
  const [tableExists] = await sql`
    SELECT EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_schema = 'public' 
        AND table_name = 'execution_leases'
    );
  `;
  
  if (!tableExists.exists) return [];

  return await sql`
    SELECT * FROM execution_leases
    WHERE status = 'ACTIVE'
      AND acquired_at < NOW() - INTERVAL '${options.olderThanMinutes} minutes'
    LIMIT 50
  `;
}

export async function releaseLease(sql: any, lease: Lease): Promise<void> {
  await sql`
    UPDATE execution_leases
    SET status = 'EXPIRED', released_at = NOW()
    WHERE id = ${lease.id}
  `;
}
