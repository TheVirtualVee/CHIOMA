/**
 * contract: DRCL
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// 1. IDENTITY & TRACEABILITY
// ---------------------------------------------------------------------------

export const ExecutionContextSchema = z.object({
  /** tenantId */
  tenantId: z.string().min(1),
  /** correlationId */
  correlationId: z.string().min(1),
  /** causationId */
  causationId: z.string().nullable(),
});

export type ExecutionContext = z.infer<typeof ExecutionContextSchema>;

// ---------------------------------------------------------------------------
// 2. OBSERVABILITY INJECTION
// ---------------------------------------------------------------------------

/** contract: ChiomaLogger */
export interface ChiomaLogger {
  info: (msg: string, ctx?: Record<string, unknown>) => void;
  warn: (msg: string, ctx?: Record<string, unknown>) => void;
  error: (msg: string, ctx?: Record<string, unknown>) => void;
}

/** contract: ChiomaMetrics */
export interface ChiomaMetrics {
  emit: (name: string, ctx: Record<string, unknown> & ExecutionContext) => void;
}

/** contract: ChiomaTracer */
export interface ChiomaTracer {
  startSpan: (name: string, ctx: ExecutionContext) => { end: () => void };
}

// ---------------------------------------------------------------------------
// 3. SERVICE CONTEXT
// ---------------------------------------------------------------------------

/** contract: ServiceContext */
export type ServiceContext = ExecutionContext & {
  logger: ChiomaLogger;
  metrics: ChiomaMetrics;
  tracer: ChiomaTracer;
};

// ---------------------------------------------------------------------------
// 4. DETERMINISTIC ID FACTORY
// ---------------------------------------------------------------------------

/** contract: DeterministicIdFactory */
export interface DeterministicIdFactory {
  nextId: (prefix?: string) => string;
}

/** constraint: crypto-safe determinism */
export const DefaultIdFactory: DeterministicIdFactory = {
  nextId: (prefix = "id") => {
    // side-effect: generates crypto-safe UUID
    const uuid = crypto.randomUUID();
    return `${prefix}_${uuid}`;
  }
};
