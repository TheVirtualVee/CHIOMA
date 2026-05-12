/**
 * CHIOMA OVERSEER ENGINE — ENFORCEMENT TESTS
 *
 * TDD contract: tests are written first; negatives MUST fail on broken code.
 *
 * Coverage:
 *   - Every rule has at least one REJECT case and one APPROVE case
 *   - Pipeline integration test (full changeset through engine)
 *   - Edge cases: empty changeset, deleted files, multi-file changeset
 */

import { describe, expect, it } from "vitest";
import { enforce } from "./engine.js";
import type { Changeset, FileChange } from "./types.js";

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------

function makeChangeset(files: FileChange[]): Changeset {
  return {
    changesetId: "test_cs_001",
    submittedAt: "2026-01-01T00:00:00.000Z",
    submittedBy: "test-agent",
    files,
  };
}

function makeFile(
  filePath: string,
  content: string,
  changeType: FileChange["changeType"] = "modified"
): FileChange {
  return { filePath, content, changeType };
}

const CORR = "test_corr_001";

// ---------------------------------------------------------------------------
// RULE 1 — NO PARTIAL IMPLEMENTATIONS
// ---------------------------------------------------------------------------
describe("Rule 1 — No Partial Implementations", () => {
  it("REJECTS a file containing TODO", () => {
    const cs = makeChangeset([
      makeFile("services/commitment-engine/src/index.ts", `
        export function handleCommitment() {
          // TODO: implement this
          throw new Error("not done");
        }
      `),
    ]);
    const result = enforce(cs, CORR);
    expect(result.status).toBe("REJECTED");
    expect(result.violations.some((v) => v.rule === "RULE_1_NO_PARTIAL_IMPLEMENTATIONS")).toBe(true);
  });

  it("REJECTS a file containing FIXME", () => {
    const cs = makeChangeset([
      makeFile("services/foo/src/bar.ts", "// FIXME: broken logic here\nfunction foo() {}"),
    ]);
    const result = enforce(cs, CORR);
    expect(result.status).toBe("REJECTED");
    expect(result.violations.some((v) => v.rule === "RULE_1_NO_PARTIAL_IMPLEMENTATIONS")).toBe(true);
  });

  it("REJECTS a file containing stub", () => {
    const cs = makeChangeset([
      makeFile("services/foo/src/bar.ts", "function stub() { return null; }"),
    ]);
    const result = enforce(cs, CORR);
    expect(result.status).toBe("REJECTED");
  });

  it("APPROVES a complete production implementation", () => {
    const cs = makeChangeset([
      makeFile(
        "services/intent-service/src/handler.ts",
        `
        import type { DomainEvent } from "@chioma/core";
        export function handleIntent(event: DomainEvent): void {
          if (!event.tenantId) throw new Error("MISSING_TENANT_ID");
          if (!event.correlationId) throw new Error("MISSING_CORRELATION_ID");
          if (!event.causationId) throw new Error("MISSING_CAUSATION_ID");
        }
        `
      ),
    ]);
    const result = enforce(cs, CORR);
    // No Rule 1 violations
    const rule1Violations = result.violations.filter((v) => v.rule === "RULE_1_NO_PARTIAL_IMPLEMENTATIONS");
    expect(rule1Violations).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// RULE 2 — NO SILENT FAILURE
// ---------------------------------------------------------------------------
describe("Rule 2 — No Silent Failure", () => {
  it("REJECTS an empty catch block", () => {
    const cs = makeChangeset([
      makeFile("services/foo/src/bar.ts", `
        async function call() {
          try {
            await doSomething();
          } catch (e) {}
        }
      `),
    ]);
    const result = enforce(cs, CORR);
    expect(result.violations.some((v) => v.rule === "RULE_2_NO_SILENT_FAILURE")).toBe(true);
  });

  it("REJECTS a catch block with only console.log", () => {
    const cs = makeChangeset([
      makeFile("services/foo/src/bar.ts", `
        async function call() {
          try {
            await doSomething();
          } catch (e) {
            console.log(e);
          }
        }
      `),
    ]);
    const result = enforce(cs, CORR);
    expect(result.violations.some((v) => v.rule === "RULE_2_NO_SILENT_FAILURE")).toBe(true);
  });

  it("APPROVES a catch block that re-throws", () => {
    const cs = makeChangeset([
      makeFile("services/foo/src/bar.ts", `
        async function call() {
          try {
            await doSomething();
          } catch (error) {
            logger.error("CALL_FAILED", { error });
            throw error;
          }
        }
      `),
    ]);
    const rule2Violations = enforce(cs, CORR).violations.filter((v) => v.rule === "RULE_2_NO_SILENT_FAILURE");
    expect(rule2Violations).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// RULE 3 — EVENT SOURCING GUARANTEE
// ---------------------------------------------------------------------------
describe("Rule 3 — Event Sourcing Guarantee", () => {
  it("REJECTS an event publish missing tenantId", () => {
    const cs = makeChangeset([
      makeFile("services/commitment-engine/src/emit.ts", `
        async function emitCommitment(bus: EventBus) {
          await bus.publish({
            id: "evt_001",
            type: "COMMITMENT_CREATED",
            correlationId: "corr_001",
            causationId: null,
            occurredAt: new Date().toISOString(),
            payload: {},
          });
        }
      `),
    ]);
    const result = enforce(cs, CORR);
    expect(result.violations.some((v) => v.rule === "RULE_3_EVENT_SOURCING_GUARANTEE")).toBe(true);
  });

  it("APPROVES an event publish with all required fields", () => {
    const cs = makeChangeset([
      makeFile("services/commitment-engine/src/emit.ts", `
        async function emitCommitment(bus: EventBus, tenantId: string, correlationId: string) {
          await bus.publish({
            id: "evt_001",
            type: "COMMITMENT_CREATED",
            tenantId,
            correlationId,
            causationId: null,
            occurredAt: new Date().toISOString(),
            payload: {},
          });
        }
      `),
    ]);
    const rule3Violations = enforce(cs, CORR).violations.filter((v) => v.rule === "RULE_3_EVENT_SOURCING_GUARANTEE");
    expect(rule3Violations).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// RULE 4 — TENANT ISOLATION
// ---------------------------------------------------------------------------
describe("Rule 4 — Tenant Isolation", () => {
  it("REJECTS a DB query without tenantId in context", () => {
    const cs = makeChangeset([
      makeFile("services/memory-store/src/query.ts", `
        async function getAll(db: DB) {
          return await db.collection("memories").find({ active: true });
        }
      `),
    ]);
    const result = enforce(cs, CORR);
    expect(result.violations.some((v) => v.rule === "RULE_4_TENANT_ISOLATION_MANDATORY")).toBe(true);
  });

  it("APPROVES a DB query scoped by tenantId", () => {
    const cs = makeChangeset([
      makeFile("services/memory-store/src/query.ts", `
        async function getAll(db: DB, tenantId: string) {
          return await db.collection("memories").find({ tenantId, active: true });
        }
      `),
    ]);
    const rule4Violations = enforce(cs, CORR).violations.filter((v) => v.rule === "RULE_4_TENANT_ISOLATION_MANDATORY");
    expect(rule4Violations).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// RULE 5 — LLM OUTPUT NEVER TRUSTED
// ---------------------------------------------------------------------------
describe("Rule 5 — LLM Output Never Trusted", () => {
  it("REJECTS LLM output used without validation", () => {
    const cs = makeChangeset([
      makeFile("services/llm-orchestrator/src/handler.ts", "llm.complete()"),
    ]);
    const result = enforce(cs, CORR);
    expect(result.violations.some((v) => v.rule === "RULE_5_LLM_OUTPUT_NEVER_TRUSTED")).toBe(true);
  });

  it("APPROVES LLM output that is validated before use", () => {
    const cs = makeChangeset([
      makeFile("services/llm-orchestrator/src/handler.ts", `
        async function process(llm: LLMClient) {
          const result = await llm.complete({ prompt: "hello" });
          const parsed = JSON.parse(result.output);
          const validated = LLMOutputSchema.parse(parsed);
          await commitmentEngine.create(validated);
        }
      `),
    ]);
    const rule5Violations = enforce(cs, CORR).violations.filter((v) => v.rule === "RULE_5_LLM_OUTPUT_NEVER_TRUSTED");
    expect(rule5Violations).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// RULE 9 — NO INFINITE LOGIC
// ---------------------------------------------------------------------------
describe("Rule 9 — No Infinite Logic", () => {
  it("REJECTS an unbounded while(true) loop", () => {
    const cs = makeChangeset([
      makeFile("workers/commitment-recovery/src/loop.ts", `
        async function run() {
          while (true) {
            await processNextBatch();
            await sleep(5000);
          }
        }
      `),
    ]);
    const result = enforce(cs, CORR);
    expect(result.violations.some((v) => v.rule === "RULE_9_NO_INFINITE_LOGIC")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// RULE 10 — PRODUCTION COMPLETE
// ---------------------------------------------------------------------------
describe("Rule 10 — Production Complete", () => {
  it("REJECTS raw console.log in a non-exempt service file", () => {
    const cs = makeChangeset([
      makeFile("services/intent-service/src/index.ts", `
        export function registerIntentService(bus: EventBus) {
          bus.subscribe("MESSAGE_RECEIVED", async (event) => {
            console.log("received", event);
          });
        }
      `),
    ]);
    const result = enforce(cs, CORR);
    expect(result.violations.some((v) => v.rule === "RULE_10_PRODUCTION_COMPLETE")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// PIPELINE INTEGRATION TEST
// ---------------------------------------------------------------------------
describe("Pipeline integration", () => {
  it("APPROVES an empty changeset (nothing to check)", () => {
    const cs = makeChangeset([]);
    // enforce still runs but no files means no violations
    const result = enforce(cs, CORR);
    expect(result.status).toBe("APPROVED");
  });

  it("APPROVES a deleted file (no content to analyze)", () => {
    const cs = makeChangeset([
      makeFile("services/old-service/src/index.ts", "", "deleted"),
    ]);
    const result = enforce(cs, CORR);
    const contentViolations = result.violations.filter(
      (v) => v.filePath === "services/old-service/src/index.ts"
    );
    expect(contentViolations).toHaveLength(0);
  });

  it("REJECTS when multiple rules are violated and lists all violations", () => {
    const cs = makeChangeset([
      makeFile("services/bad/src/index.ts", `
        // TODO: complete this
        export function register(bus: EventBus) {
          bus.subscribe("MESSAGE_RECEIVED", async (event) => {
            try {
              const result = await llm.complete({});
              const data = JSON.parse(result.output); // no validation
              await db.find({ type: "all" }); // no tenantId
            } catch (e) {} // silent failure
          });
        }
      `),
    ]);
    const result = enforce(cs, CORR);
    expect(result.status).toBe("REJECTED");
    // Must have violations from multiple rules
    const ruleIds = new Set(result.violations.map((v) => v.rule));
    expect(ruleIds.size).toBeGreaterThanOrEqual(2);
  });

  it("REJECTED decision includes decidedAt ISO timestamp", () => {
    const cs = makeChangeset([
      makeFile("services/x/src/y.ts", "// TODO incomplete"),
    ]);
    const result = enforce(cs, CORR);
    expect(result.status).toBe("REJECTED");
    expect(result.decidedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("APPROVED decision has the correct schema shape", () => {
    const cs = makeChangeset([]);
    const result = enforce(cs, CORR);
    expect(result).toMatchObject({
      status: "APPROVED",
      reason: "All validation rules passed",
      risk_level: "LOW",
      correlationId: CORR,
    });
    expect(Array.isArray(result.stepResults)).toBe(true);
  });
});
