import { randomUUID } from "node:crypto";
import { runAtomicStaffLoop } from "../staff-loop/atomic-runner.js";
import { TelemetryManager, createTraceContext } from "../telemetry/index.js";
import { Commitment, StaffLoopInput } from "../contracts/index.js";

/**
 * CHIOMA Commitment Recovery Worker
 * Purpose: Detects and fulfills overdue operational obligations autonomously.
 */
export async function processOverdueCommitments(sql: any, config: { apiKey: string; provider: string }) {
  const workerId = `recovery_worker_${process.env.VERCEL_REGION || "local"}_${Math.random().toString(36).slice(2, 7)}`;
  const trace = createTraceContext(workerId);
  const telemetry = new TelemetryManager("SYSTEM_WORKER", trace.traceId);

  telemetry.record("RECOVERY_SCAN_STARTED");

  try {
    // 1. ATOMIC LEASE ACQUISITION
    // We claim up to 5 overdue commitments in a single atomic transaction.
    // This implements the "Fencing" you required to prevent duplicate follow-ups.
    const leaseDuration = "5 minutes";
    const claimedCommitments = await sql`
      UPDATE public.commitments
      SET 
        status = 'IN_PROGRESS',
        worker_id = ${workerId},
        lease_expires_at = NOW() + ${leaseDuration}::interval,
        attempt_count = attempt_count + 1
      WHERE id IN (
        SELECT id FROM public.commitments
        WHERE status IN ('PENDING', 'FAILED')
          AND deadline_at < NOW()
          AND (lease_expires_at IS NULL OR lease_expires_at < NOW())
        LIMIT 5
        FOR UPDATE SKIP LOCKED
      )
      RETURNING *
    `;

    if (claimedCommitments.length === 0) {
      telemetry.record("RECOVERY_SCAN_IDLE");
      return { processed: 0 };
    }

    telemetry.record("RECOVERY_CLAIMS_ACQUIRED", { count: claimedCommitments.length });

    for (const commitment of claimedCommitments) {
      const commitmentId = commitment.id;
      const aggregateId = commitment.aggregate_id;
      const tenantId = commitment.tenant_id;
      const correlationId = commitment.correlation_id;

        telemetry.record("COMMITMENT_RECOVERY_START", { commitmentId, type: commitment.type });

        try {
          // 2. RE-ENTRY INTO CANONICAL COGNITION
          const messageId = `recovery_${commitmentId}_${Date.now()}`;
          
          // Prime the ledger to maintain the canonical execution chain
          await sql`
            INSERT INTO public.message_ledger (message_id, tenant_id, status)
            VALUES (${messageId}, ${tenantId}, 'RECEIVED')
          `;

          const recoveryInput: StaffLoopInput = {
            messageId: messageId,
            tenantId: tenantId,
            senderPhone: aggregateId.replace("conv_", ""),
            messageText: `[SYSTEM_RECOVERY_TRIGGER] You promised a ${commitment.type} follow-up for this customer. The deadline has passed. Resolve this now.`,
            correlationId: correlationId,
            causationId: commitment.originating_event_id || commitmentId,
            eventId: `evt_recov_${randomUUID()}`,
            channel: "simulation",
            traceContext: { ...trace, workerId },
          };

          const result = await runAtomicStaffLoop(recoveryInput, sql, config, telemetry);

        // 3. FINALIZE COMMITMENT
        const resolutionLatencyMs = Date.now() - new Date(commitment.created_at).getTime();
        
        await sql`
          UPDATE public.commitments
          SET 
            status = 'RESOLVED',
            resolved_at = NOW(),
            worker_id = NULL,
            lease_expires_at = NULL
          WHERE id = ${commitmentId}
        `;

        telemetry.record("COMMITMENT_RECOVERY_SUCCESS", { 
          commitmentId, 
          responseType: result.responseType,
          resolutionLatencyMs 
        });

      } catch (err: any) {
        // 4. ESCALATION POLICY
        // If the cognition pipeline fails during recovery, we escalate or mark as FAILED for retry.
        const isLastAttempt = commitment.attempt_count >= 3;
        const newStatus = isLastAttempt ? "ESCALATED" : "FAILED";

        await sql`
          UPDATE public.commitments
          SET 
            status = ${newStatus},
            worker_id = NULL,
            lease_expires_at = NULL
          WHERE id = ${commitmentId}
        `;

        telemetry.record("COMMITMENT_RECOVERY_FAILED", { 
          commitmentId, 
          error: err.message, 
          finalEscalation: isLastAttempt 
        });
      }
    }

    return { processed: claimedCommitments.length };

  } catch (outerErr: any) {
    telemetry.record("RECOVERY_SCAN_CRASHED", { error: outerErr.message });
    throw outerErr;
  }
}
