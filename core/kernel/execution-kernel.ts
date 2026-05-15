import { createHash } from "node:crypto";
import { runAtomicStaffLoop } from "../staff-loop/atomic-runner.js";
import { runArbiter } from "../arbiter/index.js";
import { getCanonicalIdentity } from "../identity/index.js";
import { TelemetryManager } from "../telemetry/index.js";
import { notifyFounder } from "../founder/control-plane.js";
import { ExecutionRequest, StaffLoopInput, StaffLoopResult, ExecutionState } from "../contracts/index.js";

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
  private static MAX_CONCURRENT_EXECUTIONS = 50;

  static async execute(
    input: Omit<StaffLoopInput, 'state'>,
    sql: any,
    config: { apiKey: string; provider: string; model: string },
    telemetry: TelemetryManager
  ): Promise<StaffLoopResult> {
    const startTime = Date.now();
    this.activeExecutions++;

    try {
      const state = await this.computeState(input, sql, config, telemetry);
      telemetry.record("STATE_COMPUTED", { 
        status: state.execution.status, 
        mode: state.intent.mode,
        identity: state.identity.identityId 
      });

      const enrichedInput: StaffLoopInput = { ...input, state };

      switch (state.execution.status) {
        case "BLOCKED":
          return this.handleBlocked(state, startTime, input.correlationId);

        case "DEGRADED":
          return this.degradedFallback(startTime, input.correlationId, state.execution.reason);

        case "READY":
        default:
          const result = await runAtomicStaffLoop(enrichedInput, sql, config, telemetry);
          return {
            ...result,
            latencyBreakdown: { totalMs: Date.now() - startTime }
          };
      }
    } catch (err: any) {
      telemetry.record("KERNEL_PANIC", { error: err.message });
      return this.degradedFallback(startTime, input.correlationId, "INTERNAL_KERNEL_FAULT");
    } finally {
      this.activeExecutions--;
    }
  }

  private static async computeState(
    input: Omit<StaffLoopInput, 'state'>,
    sql: any,
    config: any,
    telemetry: TelemetryManager
  ): Promise<ExecutionState> {
    const identityId = await getCanonicalIdentity(sql, input.tenantId, input.senderPhone);
    const isResolved = !!input.instanceId;

    const [commitmentData] = await sql`
      SELECT count(*)::int as active_count, 
             EXISTS(SELECT 1 FROM public.commitments WHERE tenant_id = ${input.tenantId} AND aggregate_id = ${`conv_${input.senderPhone}`} AND status = 'PENDING') as has_pending,
             EXISTS(SELECT 1 FROM public.customer_memory WHERE tenant_id = ${input.tenantId} AND customer_phone = ${input.senderPhone}) as has_memory
      FROM public.commitments 
      WHERE tenant_id = ${input.tenantId} AND aggregate_id = ${`conv_${input.senderPhone}`} AND status = 'PENDING'
    `;

    const [onboardingStatus] = await sql`SELECT onboarding_completed FROM employer_profiles WHERE tenant_id = ${input.tenantId}`;
    const needsOnboarding = onboardingStatus && !onboardingStatus.onboarding_completed;
    
    const isBriefCommand = input.messageText.toLowerCase().trim() === "/daily brief";
    const [activeBriefSession] = await sql`SELECT 1 FROM public.daily_brief_sessions WHERE tenant_id = ${input.tenantId} AND status = 'AWAITING_INPUT' LIMIT 1`;

    const isGreeting = isSimpleGreeting(input.messageText);
    let mode: ExecutionState['intent']['mode'] = "GREETING_ALLOWED";

    if (needsOnboarding) mode = "ONBOARDING";
    else if (isBriefCommand || activeBriefSession) mode = "DAILY_BRIEF";
    else if (commitmentData?.has_pending) mode = "COMMITMENT_RESOLUTION";
    else if (commitmentData?.has_memory || !isGreeting) mode = "CONTINUATION_ONLY";

    const fingerprint = createHash("sha256")
      .update(input.tenantId + input.instanceId + input.messageText)
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
      schedulerConflict: false
    };

    const verdict = await runArbiter(arbiterRequest, sql, config.apiKey);

    let status: ExecutionState['execution']['status'] = "READY";
    if (verdict.outcome === 'BLOCK_RESPONSE') status = "BLOCKED";
    else if (verdict.outcome === 'DEGRADE_RESPONSE' || this.activeExecutions > this.MAX_CONCURRENT_EXECUTIONS) {
      status = "DEGRADED";
    }

    return {
      identity: { 
        tenantId: input.tenantId, 
        instanceId: input.instanceId, 
        isResolved,
        identityId 
      },
      intent: { 
        active: commitmentData?.has_memory || commitmentData?.has_pending,
        mode,
        currentGoal: null, 
        lastUserNeed: null 
      },
      execution: { 
        status, 
        reason: verdict.reason || null,
        controllerTriggered: verdict.controllerTriggered,
        fingerprint,
        contextOverride: verdict.contextOverride,
        recoveryPayload: verdict.recoveryPayload
      }
    };
  }

  private static handleBlocked(state: ExecutionState, start: number, correlationId: string): StaffLoopResult {
    const text = state.execution.reason === 'INSUFFICIENT_CREDITS'
      ? "Your CHIOMA service requires a top-up to continue. Please contact your business owner."
      : "Your account requires attention. Please contact support.";
    
    return {
      responseText: text,
      responseType: "conversation",
      delivered: false,
      latencyMs: Date.now() - start,
      correlationId
    };
  }

  private static degradedFallback(start: number, correlationId: string, reason?: string | null): StaffLoopResult {
    return {
      responseText: "I'm still pulling that together for you — one moment.",
      responseType: "error_degraded",
      delivered: false,
      latencyMs: Date.now() - start,
      correlationId,
    };
  }
}

async function runStaffLoopSimplified(input: StaffLoopInput, sql: any, config: any, telemetry: TelemetryManager): Promise<StaffLoopResult> {
    return await runAtomicStaffLoop(input, sql, config, telemetry);
}
