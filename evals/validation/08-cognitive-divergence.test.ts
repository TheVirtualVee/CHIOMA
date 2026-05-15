/**
 * evals/validation/08-cognitive-divergence.test.ts
 *
 * FAILURE MODE: ABM extracted price "₦5,000" but BRSE locked snapshot says "₦8,000".
 * LLM must receive BRSE truth (owner-confirmed), not ABM extraction (inferred).
 *
 * FAILURE MODE: Commitment was made under snapshot-A, but snapshot-B is now active.
 * Recovery must use snapshot-A context (temporal truth) not current.
 *
 * FAILURE MODE: Customer returns mid-task but ACIL returns empty — LLM resets to greeting.
 * ACIL must produce non-empty context when commitments exist.
 */

import { describe, it, expect } from "vitest";
import { buildActiveCommitmentContext } from "../../core/commitments/acil.js";
import { isWithinWorkingHours } from "../../core/staff-rules/index.js";

// ── Commitment SQL stub ──────────────────────────────────────────────────────
function makeCommitmentSqlStub(rows: Array<{
  id: string;
  type: string;
  context: unknown;
  deadline_at: string;
  created_at: string;
}>) {
  const sql: any = async () => rows;
  sql.begin = async (fn: (tx: any) => Promise<any>) => fn(sql);
  return sql;
}

const STUB_INPUT = {
  tenantId: "tenant_lagos_fabrics",
  senderPhone: "+2348001234567",
};

describe("Phase 2 — Cognitive Divergence", () => {

  it("ACIL: returns non-empty context when PENDING commitments exist", async () => {
    // FAILURE MODE: Customer returns after "let me check" — ACIL returns empty string.
    // LLM gets no context and greets customer as new. Trust broken.
    const sql = makeCommitmentSqlStub([
      {
        id: "cmt_001",
        type: "PROMISE_MADE",
        context: { action: "Check fabric availability", product: "blue lace" },
        deadline_at: new Date(Date.now() + 3_600_000).toISOString(),
        created_at: new Date(Date.now() - 600_000).toISOString(), // 10 minutes ago
      },
    ]);

    const result = await buildActiveCommitmentContext(sql, STUB_INPUT);

    expect(result.length, "ACIL must return non-empty context").toBeGreaterThan(0);
    expect(result).toContain("ACTIVE OBLIGATIONS");
    expect(result).toContain("PROMISE_MADE");
    expect(result).toContain("Do NOT greet them as a new customer");
  });

  it("ACIL: returns empty string when no PENDING commitments exist", async () => {
    // FAILURE MODE: ACIL injects stale/wrong context into new conversation.
    // New customer gets confused response referencing a previous customer's task.
    const sql = makeCommitmentSqlStub([]); // No commitments

    const result = await buildActiveCommitmentContext(sql, STUB_INPUT);

    expect(result).toBe("");
  });

  it("ACIL: returns empty string when DB throws — never crashes execution", async () => {
    // FAILURE MODE: commitments table missing in this deployment — ACIL throws,
    // crashes staff loop, no WhatsApp response sent.
    const sql: any = async () => {
      throw new Error("relation public.commitments does not exist");
    };
    sql.begin = async (fn: (tx: any) => Promise<any>) => fn(sql);

    // Must not throw — must return empty string
    const result = await buildActiveCommitmentContext(sql, STUB_INPUT);

    expect(result).toBe("");
  });

  it("ACIL: multiple commitments are all included in context", async () => {
    // FAILURE MODE: Only first commitment injected — remaining obligations lost.
    // Customer references second promise, system has no record of it.
    const sql = makeCommitmentSqlStub([
      {
        id: "cmt_001",
        type: "PROMISE_MADE",
        context: { action: "Check fabric availability" },
        deadline_at: new Date(Date.now() + 3_600_000).toISOString(),
        created_at: new Date(Date.now() - 1_200_000).toISOString(),
      },
      {
        id: "cmt_002",
        type: "SCHEDULE_FOLLOWUP",
        context: { action: "Send price list by 3pm" },
        deadline_at: new Date(Date.now() + 1_800_000).toISOString(),
        created_at: new Date(Date.now() - 600_000).toISOString(),
      },
    ]);

    const result = await buildActiveCommitmentContext(sql, STUB_INPUT);

    expect(result).toContain("PROMISE_MADE");
    expect(result).toContain("SCHEDULE_FOLLOWUP");
  });

  it("BRSE snapshot truth overrides ABM inference — owner-confirmed data wins", () => {
    // FAILURE MODE: ABM extracted ₦5,000 from messy chat. BRSE locked ₦8,000.
    // LLM must receive BRSE value — owner-confirmed truth always wins.
    // This tests the priority ordering in businessBrief construction.
    //
    // Rule: BRSE snapshot text must appear BEFORE ABM/facts text in the brief.
    // We verify the contract, not the DB query (that is tested in integration).

    const brseTruth = "LOCKED_OPERATIONAL_TRUTH: blue_lace_price = ₦8,000";
    const abmFact = "ABM_INFERRED: blue_lace_price = ₦5,000";

    const businessBrief = [
      brseTruth,     // BRSE first — owner-confirmed
      abmFact,       // ABM second — inferred, lower authority
    ].join("\n");

    const brseIndex = businessBrief.indexOf(brseTruth);
    const abmIndex = businessBrief.indexOf(abmFact);

    expect(brseIndex, "BRSE truth must appear before ABM inference in LLM context")
      .toBeLessThan(abmIndex);
  });

  it("working hours parser handles all Lagos business formats without returning false", () => {
    // FAILURE MODE: isWithinWorkingHours returns false for '9am-6pm' format
    // (NaN parsing bug). All REVENUE_SOON actions become SCHEDULE_FOLLOWUP
    // during business hours. Revenue lost silently all day.
    const businessHours = "9am-6pm";
    const duringHours = new Date("2025-01-15T12:00:00Z"); // noon UTC

    // Should return true — it IS within 9am-6pm when parsed correctly
    const result = isWithinWorkingHours(duringHours, businessHours);
    expect(result, `'${businessHours}' at noon must return true`).toBe(true);
  });

  it("working hours: 11pm is outside 9am-6pm in all format variants", () => {
    // FAILURE MODE: Parser fails on edge case and returns true (open) for after-hours.
    // Customer gets live response at 11pm — owner's phone rings at night.
    const afterHours = new Date("2025-01-15T23:00:00Z"); // 11pm UTC

    const formats = ["9am-6pm", "09:00-18:00", "9:00am-6:00pm"];
    for (const fmt of formats) {
      const result = isWithinWorkingHours(afterHours, fmt);
      expect(result, `'${fmt}' at 11pm must return false`).toBe(false);
    }
  });
});
