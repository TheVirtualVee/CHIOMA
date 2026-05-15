import { createHash } from "node:crypto";
import { runAtomicStaffLoop } from "../staff-loop/atomic-runner.js";
import { runArbiter } from "../arbiter/index.js";
import { getCanonicalIdentity } from "../identity/index.js";
import { TelemetryManager } from "../telemetry/index.js";
import { ExecutionRequest, StaffLoopInput, StaffLoopResult } from "../contracts/index.js";

/**
 * CHIOMA EXECUTION KERNEL
 * Phase 4 — Execution Governance Consolidation
 * 
 * The single authoritative "Decision Spine" for all CHIOMA runtime actions.
 */

export class ExecutionKernel {
  private static activeExecutions = 0;
  private static MAX_CONCURRENT_EXECUTIONS = 50; // System-wide budget

  static async execute(
    input: StaffLoopInput,
    sql: any,
    config: { apiKey: string; provider: string; model: string },
    telemetry: TelemetryManager
  ): Promise<StaffLoopResult> {
    const start = Date.now();
    
    // 1. GLOBAL BUDGET GOVERNOR
    if (this.activeExecutions >= this.MAX_CONCURRENT_EXECUTIONS) {
      telemetry.record("SYSTEM_CONGESTED", { active: this.activeExecutions });
      return this.degradedFallback(start, input.correlationId, "System is under heavy load. Please try again in a moment.");
    }

    this.activeExecutions++;
    try {
      // 2. IDENTITY CANONICALIZATION
      const identityId = await getCanonicalIdentity(sql, input.tenantId, input.senderPhone);
      telemetry.record("IDENTITY_RESOLVED", { identityId });

      // 3. SCHEDULER ARBITRATION
      const aggregateId = `conv_${input.senderPhone}`;
      const [activeLease] = await sql`
        SELECT worker_id FROM public.concurrency_leases 
        WHERE aggregate_id = ${aggregateId} 
          AND expires_at > NOW()
          AND worker_id != ${input.traceContext?.workerId ?? 'unknown'}
        LIMIT 1
      `;

      const [commitmentData] = await sql`
        SELECT count(*)::int as active_count, 
               EXISTS(SELECT 1 FROM public.commitments WHERE tenant_id = ${input.tenantId} AND aggregate_id = ${aggregateId} AND status = 'PENDING') as has_pending
        FROM public.commitments 
        WHERE tenant_id = ${input.tenantId} 
          AND aggregate_id = ${aggregateId} 
          AND status = 'PENDING'
      `;

      const normalizedBody = (input.messageText || "").trim().toLowerCase();
      const fingerprint = createHash("sha256")
        .update(input.tenantId + input.instanceId + (input.messageId || "internal") + normalizedBody)
        .digest("hex");

      const arbiterRequest: ExecutionRequest = {
        tenantId: input.tenantId,
        instanceId: input.instanceId,
        triggeredBy: input.channel === 'simulation' ? 'commitment_recovery' : 'whatsapp_message',
        commitmentPending: commitmentData?.has_pending ?? false,
        activeCommitmentCount: commitmentData?.active_count ?? 0,
        creditBalance: input.instance?.credit_units ?? 0,
        creditRequired: 1,
        tenantStatus: (input.instance?.billing_state.toLowerCase() as any) || "active",
        safetyFlags: [],
        requestedAt: Date.now(),
        fingerprint,
        identityId,
        schedulerConflict: !!activeLease
      };

      // 4. GOVERNANCE ARBITRATION
      const verdict = await runArbiter(arbiterRequest, sql, config.apiKey);
      telemetry.record("KERNEL_ARBITRATION_COMPLETE", { outcome: verdict.outcome, trace: verdict.gateTrace });

      if (verdict.outcome === 'BLOCK_RESPONSE') {
        const isConflict = verdict.controllerTriggered === 'Gate0_Arbitration';
        return {
          responseText: isConflict 
            ? "I'm already working on your request. Just a moment!"
            : "Your account requires attention. Please contact support.",
          responseType: "conversation",
          delivered: false,
          latencyMs: Date.now() - start,
          correlationId: input.correlationId,
        };
      }

      if (verdict.outcome === 'DEGRADE_RESPONSE') {
        return this.degradedFallback(start, input.correlationId);
      }

      // 5. ATOMIC EXECUTION
      // Pass enriched context from arbiter if applicable
      const enrichedInput = {
        ...input,
        messageText: input.messageText + (verdict.contextOverride ? `\n\n[KERNEL_OVERRIDE]: ${verdict.contextOverride}` : "")
      };

      return await runStaffLoopSimplified(enrichedInput, sql, config, telemetry);

    } finally {
      this.activeExecutions--;
    }
  }

  private static degradedFallback(start: number, correlationId: string, customText?: string): StaffLoopResult {
    return {
      responseText: customText || "I'm having a bit of trouble right now. Please try again later.",
      responseType: "error_degraded",
      delivered: false,
      latencyMs: Date.now() - start,
      correlationId,
    };
  }
}

/**
 * Simplified wrapper for the final decision execution path.
 * In a real consolidation, this would absorb the AtomicRunner's core logic.
 */
async function runStaffLoopSimplified(input: StaffLoopInput, sql: any, config: any, telemetry: TelemetryManager): Promise<StaffLoopResult> {
    // This calls the hardened runAtomicStaffLoop which we've already stabilized
    return await runAtomicStaffLoop(input, sql, config, telemetry);
}
