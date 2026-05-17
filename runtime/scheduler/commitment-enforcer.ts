export type Commitment = {
  id: string;
  tenant_id: string;
  aggregate_id: string;
  status: string;
  due_at: Date;
  retry_count: number;
};

export async function getOverdueCommitments(sql: any): Promise<Commitment[]> {
  return await sql`
    SELECT * FROM commitments
    WHERE status = 'PENDING'
      AND due_at < NOW()
      AND retry_count < 3
    ORDER BY due_at ASC
    LIMIT 50
  `;
}

export async function enforceCommitment(sql: any, commitment: Commitment): Promise<void> {
  // In a real implementation we would generate a message via LLM or templates
  // using something like `executeStaffLoop`
  console.log(`[SCHEDULER] Enforcing commitment ${commitment.id}`);
  
  // Mark as processed
  await sql`
    UPDATE commitments
    SET status = 'PROCESSED', processed_at = NOW()
    WHERE id = ${commitment.id}
  `;
}
