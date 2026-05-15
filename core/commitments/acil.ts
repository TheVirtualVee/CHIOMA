// core/commitments/acil.ts

import type { StaffLoopInput } from "../contracts/index.js";

export interface ActiveCommitment {
  id: string;
  type: string;        // PROMISE_MADE | SCHEDULE_FOLLOWUP
  context: unknown;    // JSONB payload from commitments table
  deadline_at: string;
  created_at: string;
}

/**
 * Queries PENDING commitments for this tenant+conversation.
 * Returns a formatted injection string for the LLM system prompt.
 * Returns empty string on failure — never throws.
 *
 * @param sql    - postgres client (or transaction)
 * @param input  - StaffLoopInput (provides tenantId + senderPhone)
 */
export async function buildActiveCommitmentContext(
  sql: any,
  input: Pick<StaffLoopInput, "tenantId" | "senderPhone">
): Promise<string> {
  const aggregateId = `conv_${input.senderPhone}`;

  let rows: ActiveCommitment[] = [];
  try {
    rows = await sql<ActiveCommitment[]>`
      SELECT id, type, context, deadline_at, created_at
      FROM public.commitments
      WHERE tenant_id   = ${input.tenantId}
        AND aggregate_id = ${aggregateId}
        AND status       = 'PENDING'
      ORDER BY created_at ASC
      LIMIT 5
    `;
  } catch (err: unknown) {
    // Table may not exist for this tenant — non-fatal, continue without context
    console.error("[ACIL] COMMITMENT_LOOKUP_FAILED:", String(err).slice(0, 120));
    return "";
  }

  if (!rows || rows.length === 0) return "";

  const lines = rows.map((c) => {
    const ctx = typeof c.context === "object" && c.context !== null
      ? JSON.stringify(c.context)
      : String(c.context ?? "");
    return `- [${c.type}] Promised at ${c.created_at}, due ${c.deadline_at}: ${ctx}`;
  });

  return [
    "ACTIVE OBLIGATIONS (YOU MADE THESE COMMITMENTS — DO NOT FORGET THEM):",
    "You are currently mid-task for this customer. Do NOT greet them as a new customer.",
    "Do NOT say 'How can I help you'. Continue your pending obligation.",
    ...lines,
  ].join("\n");
}
