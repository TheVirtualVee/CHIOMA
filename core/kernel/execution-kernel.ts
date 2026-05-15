import { createHash } from "node:crypto";
import { runAtomicStaffLoop } from "../staff-loop/atomic-runner.js";
import { runArbiter } from "../arbiter/index.js";
import { getCanonicalIdentity } from "../identity/index.js";
import { TelemetryManager } from "../telemetry/index.js";
import { notifyFounder } from "../founder/control-plane.js";
import { ExecutionRequest, StaffLoopInput, StaffLoopResult } from "../contracts/index.js";

/**
 * CHIOMA EXECUTION KERNEL
 * Phase 5 — Execution Resilience & Adaptive Governance
 */

// ── GREETING BYPASS ────────────────────────────────────────────────────
// These are state-neutral inputs. They must NEVER enter the arbiter or
// enricher pipeline. Routing them through arbitration adds latency and
// creates an unnecessary enrichment failure surface.
const SIMPLE_GREETINGS = new Set([
  "hello", "hi", "hey", "good morning", "good afternoon", "good evening",
  "good day", "howdy", "greetings", "sup", "what's up", "whats up",
  "morning", "afternoon", "evening", "hello there", "hi there"
]);

function isSimpleGreeting(text: string): boolean {
  const normalized = text.trim().toLowerCase().replace(/[!?.]+$/, "");
  return SIMPLE_GREETINGS.has(normalized);
}

class LoadMonitor {
  private latencies: number[] = [];
  private windowSize = 20;

  record(ms: number) {
    this.latencies.push(ms);
    if (this.latencies.length > this.windowSize) this.latencies.shift();
  }

  getAverage(): number {
    if (this.latencies.length === 0) return 0;
    return this.latencies.reduce((a, b) => a + b, 0) / this.latencies.length;
  }
}

const monitor = new LoadMonitor();

export class ExecutionKernel {
  private static activeExecutions = 0;
  private static MAX_CONCURRENT_EXECUTIONS = 50; // Initial cap
  private static LATENCY_THRESHOLD_MS = 15000; // 15s P95 target

  static async execute(
    input: StaffLoopInput,
    sql: any,
    config: { apiKey: string; provider: string; model: string },
    telemetry: TelemetryManager
  ): Promise<StaffLoopResult> {
    const startTime = Date.now();
    const breakdown: any = {};
    
    // 1. ADAPTIVE BUDGET GOVERNOR
    const avgLatency = monitor.getAverage();
    if (avgLatency > this.LATENCY_THRESHOLD_MS && this.MAX_CONCURRENT_EXECUTIONS > 5) {
      this.MAX_CONCURRENT_EXECUTIONS -= 1; // Back off
      console.warn(`[KERNEL] ADAPTIVE_BACKOFF: Lowering budget to ${this.MAX_CONCURRENT_EXECUTIONS} due to latency (${avgLatency}ms)`);
    } else if (avgLatency < (this.LATENCY_THRESHOLD_MS / 2) && this.MAX_CONCURRENT_EXECUTIONS < 100) {
      this.MAX_CONCURRENT_EXECUTIONS += 1; // Scale up
    }

    if (this.activeExecutions >= this.MAX_CONCURRENT_EXECUTIONS) {
      telemetry.record("SYSTEM_CONGESTED", { active: this.activeExecutions, cap: this.MAX_CONCURRENT_EXECUTIONS });
      return this.degradedFallback(startTime, input.correlationId, "System is under heavy load. Please try again in a moment.");
    }

    this.activeExecutions++;
    try {
    // 2. GREETING BYPASS — short-circuit before arbiter
      // Simple greetings are state-neutral. They skip arbitration entirely.
      if (isSimpleGreeting(input.messageText)) {
        telemetry.record("GREETING_BYPASS", { message: input.messageText.slice(0, 20) });
        
        // 🧠 THREAD AWARENESS: Check if we should greet or continue
        let bypassMode = "GREETING_ALLOWED";
        try {
          const [state]: any[] = await sql`
            SELECT 1 FROM public.customer_memory 
            WHERE tenant_id = ${input.tenantId} AND customer_phone = ${input.senderPhone}
            LIMIT 1
          `;
          if (state) bypassMode = "CONTINUATION_ONLY";
        } catch { /* Default to greeting if DB fails */ }

        const greetResult = await runStaffLoopSimplified(
          { ...input, executionMode: bypassMode as any },
          sql, config, telemetry
        );
        monitor.record(greetResult.latencyMs);
        return { ...greetResult, latencyBreakdown: { totalMs: Date.now() - startTime } };
      }

      // 3. IDENTITY CANONICALIZATION
      const identityStart = Date.now();
      const identityId = await getCanonicalIdentity(sql, input.tenantId, input.senderPhone);
      breakdown.identityMs = Date.now() - identityStart;
      telemetry.record("IDENTITY_RESOLVED", { identityId });

      // 4. SCHEDULER ARBITRATION
      const arbStart = Date.now();
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
      breakdown.arbitrationMs = Date.now() - arbStart;
      telemetry.record("KERNEL_ARBITRATION_COMPLETE", { outcome: verdict.outcome, trace: verdict.gateTrace });

      if (verdict.outcome === 'BLOCK_RESPONSE') {
        const isConflict = verdict.controllerTriggered === 'Gate0_Arbitration';
        const isBillingBlock = verdict.controllerTriggered === 'Gate1_Billing';

        // Persist arbiter audit — non-fatal
        try {
          await sql`
            INSERT INTO public.arbiter_audits
              (tenant_id, instance_id, message_id, correlation_id, outcome,
               controller_triggered, reason, gate_trace, latency_ms)
            VALUES (
              ${input.tenantId}, ${input.instanceId ?? null}, ${input.messageId},
              ${input.correlationId}, ${verdict.outcome},
              ${verdict.controllerTriggered}, ${verdict.reason},
              ${sql.json(verdict.gateTrace)}, ${Date.now() - startTime}
            )
          `;
        } catch (auditErr: unknown) {
          console.error("[KERNEL] ARBITER_AUDIT_FAILED:", String(auditErr).slice(0, 80));
        }

        // Notify founder on billing exhaustion
        if (isBillingBlock) {
          const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID ?? "";
          const token = process.env.WHATSAPP_ACCESS_TOKEN ?? "";
          notifyFounder(
            {
              type: "BILLING_EXHAUSTED",
              tenantId: input.tenantId,
              instanceId: input.instanceId,
              summary: `Tenant ${input.tenantId} ran out of credits. Messages are blocked.`,
              detail: { reason: verdict.reason, controllerTriggered: verdict.controllerTriggered }
            },
            phoneId, token
          ).catch((e: unknown) => console.error("[KERNEL] FOUNDER_NOTIFY_FAILED:", String(e).slice(0,80)));
        }

        const result = {
          responseText: isConflict 
            ? "I'm already working on your request. Just a moment!"
            : isBillingBlock
            ? "Your CHIOMA service requires a top-up to continue. Please contact your business owner."
            : "Your account requires attention. Please contact support.",
          responseType: "conversation" as const,
          delivered: false,
          latencyMs: Date.now() - startTime,
          correlationId: input.correlationId,
          latencyBreakdown: { ...breakdown, totalMs: Date.now() - startTime }
        };
        monitor.record(result.latencyMs);
        return result;
      }

      if (verdict.outcome === 'DEGRADE_RESPONSE') {
        const result = this.degradedFallback(startTime, input.correlationId);
        monitor.record(result.latencyMs);
        return result;
      }

      // 5. ATOMIC EXECUTION
      const inferenceStart = Date.now();
      const enrichedInput = {
        ...input,
        messageText: input.messageText + (verdict.contextOverride ? `\n\n[KERNEL_OVERRIDE]: ${verdict.contextOverride}` : "")
      };

      const result = await runStaffLoopSimplified(enrichedInput, sql, config, telemetry);
      breakdown.inferenceMs = Date.now() - inferenceStart;
      
      const finalResult = {
        ...result,
        latencyBreakdown: { ...breakdown, totalMs: Date.now() - startTime }
      };
      
      monitor.record(finalResult.latencyMs);
      return finalResult;

    } finally {
      this.activeExecutions--;
    }
  }


  private static degradedFallback(start: number, correlationId: string, customText?: string): StaffLoopResult {
    return {
      responseText: customText || "I'm still pulling that together for you — one moment.",
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
