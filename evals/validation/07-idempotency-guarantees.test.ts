/**
 * evals/validation/07-idempotency-guarantees.test.ts
 *
 * FAILURE MODE: Same messageId processed twice produces duplicate WhatsApp sends.
 * FAILURE MODE: Same LLM input on retry produces different action type (non-deterministic).
 * FAILURE MODE: validateStaffAction produces different output on repeated identical input.
 * FAILURE MODE: sanitizeStaffReply changes output between calls on same input.
 * FAILURE MODE: buildContentHash produces different hash for same payload (event integrity).
 */

import { describe, it, expect } from "vitest";
import { validateStaffAction, sanitizeStaffReply } from "../../core/staff-rules/index.js";
import { buildContentHash } from "../../core/events/index.js";

const BASE_PROFILE = {
  business_name: "Chi-Chi Fabrics Lagos",
  tone_profile: "friendly-shopkeeper" as const,
  escalation_contact: "+2348001234567",
  working_hours: "9am-6pm",
  response_style: "helpful" as const,
  version: 1,
};

const BASE_CONTEXT = {
  currentTime: new Date("2025-01-15T10:00:00Z"), // 10am — within hours
  profile: BASE_PROFILE,
  customerState: null,
  llmConfidence: 0.9,
};

describe("Phase 2 — Idempotency Guarantees", () => {

  it("validateStaffAction: identical inputs always produce identical outputs", () => {
    // FAILURE MODE: Non-deterministic rule engine produces ESCALATE sometimes
    // and REPLY other times for the same input. Causes inconsistent customer experience.
    const input = {
      type: "REPLY" as const,
      urgency: "HIGH" as const,
      revenue_weight: 0.9,
      need_classification: "REVENUE_NOW" as const,
    };

    const results = Array.from({ length: 10 }, () =>
      validateStaffAction(input, BASE_CONTEXT)
    );

    const firstType = results[0].type;
    for (const result of results) {
      expect(result.type).toBe(firstType);
    }
  });

  it("validateStaffAction: REVENUE_NOW with IGNORE always returns REPLY (100 runs)", () => {
    // FAILURE MODE: Revenue-bearing customer gets ignored. Tested 100x to expose
    // any probabilistic divergence in the rule engine.
    const input = {
      type: "IGNORE" as const,
      urgency: "LOW" as const,
      revenue_weight: 0.95,
      need_classification: "REVENUE_NOW" as const,
    };

    for (let i = 0; i < 100; i++) {
      const result = validateStaffAction(input, BASE_CONTEXT);
      expect(result.type, `Run ${i}: REVENUE_NOW must never be IGNORE`).not.toBe("IGNORE");
    }
  });

  it("sanitizeStaffReply: same reply + same facts always produces same output", () => {
    // FAILURE MODE: Sanitizer has internal state or randomness causing
    // different outputs on retry. Makes behavior unpredictable on LLM parse failure.
    const reply = "We have the item available. Price is affordable.";
    const facts = [{ key: "product_available", value: true }];

    const r1 = sanitizeStaffReply(reply, facts);
    const r2 = sanitizeStaffReply(reply, facts);
    const r3 = sanitizeStaffReply(reply, facts);

    expect(r1.sanitizedReply).toBe(r2.sanitizedReply);
    expect(r2.sanitizedReply).toBe(r3.sanitizedReply);
  });

  it("sanitizeStaffReply: never returns empty string on any input", () => {
    // FAILURE MODE: Aggressive sanitizer strips everything, leaving silence.
    // Customer receives empty WhatsApp message — or worse, no message.
    const cases = [
      { reply: "", facts: [] },
      { reply: "   ", facts: [] },
      { reply: "₦50,000 guaranteed in stock!", facts: [] },
      { reply: "As an AI I cannot confirm that.", facts: [] },
    ];

    for (const { reply, facts } of cases) {
      const result = sanitizeStaffReply(reply, facts);
      expect(
        result.sanitizedReply.trim().length,
        `Empty output for input: "${reply}"`
      ).toBeGreaterThan(0);
    }
  });

  it("buildContentHash: same payload always produces same hash", () => {
    // FAILURE MODE: Event store accepts two events with same payload but
    // different hashes — breaks replay determinism and audit integrity.
    const payload = {
      channel: "whatsapp",
      from: "+2348001234567",
      text: "How much is the lace?",
      waMessageId: "wamid.abc123",
    };

    const h1 = buildContentHash(payload);
    const h2 = buildContentHash(payload);
    const h3 = buildContentHash({ ...payload }); // spread copy

    expect(h1).toBe(h2);
    expect(h2).toBe(h3);
    expect(h1.length).toBeGreaterThan(0);
  });

  it("buildContentHash: different payloads produce different hashes", () => {
    // FAILURE MODE: Hash collision allows duplicate events to appear identical
    // to the replay engine, corrupting the event log.
    const p1 = { text: "How much is the lace?" };
    const p2 = { text: "How much is the fabric?" };

    expect(buildContentHash(p1)).not.toBe(buildContentHash(p2));
  });
});
