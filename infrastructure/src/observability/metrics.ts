import { createConsoleLogger } from "./logger.js";

const logger = createConsoleLogger("metrics");

/** contract: CsrSnapshot */
export type CsrSnapshot = {
  commitmentSurvivalRate: number | null;
  trustContinuityIndex: number | null;
};

/** contract: ChiomaMetrics */
export type ChiomaMetrics = {
  recordCsr: (tenantId: string, v: number) => void;
  snapshot: (tenantId: string) => CsrSnapshot;
  emit: (
    name: string,
    ctx: {
      tenantId: string;
      service: string;
      correlationId?: string;
      [key: string]: unknown;
    },
  ) => void;
  recordReplayDuration: (tenantId: string, ms: number) => void;
  recordHydrationTime: (tenantId: string, ms: number) => void;
  recordDlqVolume: (tenantId: string, count: number) => void;
  recordTokenUsage: (tenantId: string, model: string, promptTokens: number, completionTokens: number) => void;
};

export function createMetricsSink(): ChiomaMetrics {
  const csrStorage = new Map<string, number>();
  const replayDurations = new Map<string, number[]>();
  const hydrationTimes = new Map<string, number>();
  const dlqVolumes = new Map<string, number>();
  const tokenUsage = new Map<string, { prompt: number; completion: number }>();

  return {
    recordCsr(tenantId, v) {
      if (!tenantId) throw new Error("METRICS_FAILURE: tenantId required");
      csrStorage.set(tenantId, v);
    },
    snapshot: (tenantId) => ({
      commitmentSurvivalRate: csrStorage.get(tenantId) ?? null,
      trustContinuityIndex: null,
    }),
    emit: (name, ctx) => {
      if (!ctx.tenantId || !ctx.service) {
        // side-effect: log malformed metric
        logger.warn("METRICS_MALFORMED", { metric: name, ...ctx });
        return;
      }
    },
    recordReplayDuration: (tenantId, ms) => {
      const list = replayDurations.get(tenantId) ?? [];
      list.push(ms);
      replayDurations.set(tenantId, list);
    },
    recordHydrationTime: (tenantId, ms) => {
      hydrationTimes.set(tenantId, ms);
    },
    recordDlqVolume: (tenantId, count) => {
      dlqVolumes.set(tenantId, count);
    },
    recordTokenUsage: (tenantId, model, prompt, completion) => {
      const current = tokenUsage.get(tenantId) ?? { prompt: 0, completion: 0 };
      current.prompt += prompt;
      current.completion += completion;
      tokenUsage.set(tenantId, current);
    },
  };
}

export const metrics = createMetricsSink();
