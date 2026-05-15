import { randomUUID } from "node:crypto";
import { TelemetryManager, createTraceContext } from "../telemetry/index.js";
import { resolveInstanceByTenant } from "../routing/instance-router.js";
import { ExecutionKernel } from "../kernel/execution-kernel.js";

/**
 * CHIOMA Commitment Recovery Worker
 * Phase 4 — Consolidated via Execution Kernel
 */
export async function processOverdueCommitments(sql: any, config: { apiKey: string; provider: string }) {
  const workerId = `recovery_worker_${process.env.VERCEL_REGION || "local"}_${Math.random().toString(36).slice(2, 7)}`;
  const trace = createTraceContext(workerId);
  const telemetry = new TelemetryManager("SYSTEM_WORKER", trace.traceId);

  telemetry.record("RECOVERY_SCAN_STARTED");

  try {
    // 1. ATOMIC LEASE ACQUISITION (Still handled here to ensure worker isolation)
    const claimedCommitments = await sql`
      UPDATE public.commitments
      SET 
        status = 'IN_PROGRESS',
        worker_id = ${workerId},
        lease_expires_at = NOW() + INTERVAL '5 minutes',
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

    if (claimedCommitments.length === 0) return { processed: 0 };

    for (const commitment of claimedCommitments) {
      try {
        const instance = await resolveInstanceByTenant(sql, commitment.tenant_id);
        if (!instance) throw new Error(`RECOVERY_FAILURE: Instance not found`);

        const messageId = `recovery_${commitment.id}_${Date.now()}`;
        const recoveryInput = {
          messageId,
          tenantId: commitment.tenant_id,
          instanceId: instance.instance_id,
          senderPhone: commitment.aggregate_id.replace("conv_", ""),
          messageText: `[SYSTEM_RECOVERY_TRIGGER] Resolve ${commitment.type} promise.`,
          correlationId: commitment.correlation_id,
          causationId: commitment.originating_event_id || commitment.id,
          eventId: `evt_recov_${randomUUID()}`,
          channel: "simulation" as const,
          traceContext: { ...trace, workerId },
          instance,
        };

        // 🧠 KERNEL EXECUTION (The single decision spine)
        const result = await ExecutionKernel.execute(recoveryInput, sql, {
          apiKey: config.apiKey,
          provider: instance.llm_config.provider,
          model: instance.llm_config.model,
        }, telemetry);

        // Update commitment based on kernel result
        await sql`
          UPDATE public.commitments
          SET status = ${result.responseType === 'error_degraded' ? 'FAILED' : 'RESOLVED'},
              resolved_at = ${result.responseType === 'error_degraded' ? null : 'NOW()'},
              lease_expires_at = NULL
          WHERE id = ${commitment.id}
        `;

      } catch (err: any) {
        await sql`
          UPDATE public.commitments
          SET status = 'FAILED', lease_expires_at = NULL, last_error = ${err.message}
          WHERE id = ${commitment.id}
        `;
      }
    }

    return { processed: claimedCommitments.length };

  } catch (outerErr: any) {
    telemetry.record("RECOVERY_SCAN_CRASHED", { error: outerErr.message });
    throw outerErr;
  }
}
