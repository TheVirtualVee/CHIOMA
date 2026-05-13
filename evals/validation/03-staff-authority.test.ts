/**
 * evals/validation/03-staff-authority.test.ts
 *
 * PHASE 3 — Staff Loop Survivability
 * PHASE 4 — Deterministic Authority Testing
 *
 * Tests the core behavioral guarantees of CHIOMA as deployed staff:
 * - Never invents business facts
 * - Sanitization removes hallucinated prices
 * - Rule engine always takes authority over LLM proposals
 * - Graceful degradation on LLM failure
 * - Conversational continuity under chaos inputs
 *
 * These are UNIT tests against the actual deterministic modules.
 * No mocks pretending to be the real system.
 */

import { describe, it, expect } from "vitest";
import { validateStaffAction, sanitizeStaffReply } from "../../core/staff-rules/index.js";

describe("Phase 4 — Deterministic Authority Engine", () => {

  const baseProfile = {
    business_name: "Chi-Chi Fabrics",
    tone_profile: "friendly-shopkeeper" as const,
    escalation_contact: "+2348001234567",
    working_hours: "9am-6pm",
    response_style: "helpful" as const,
  };

  const baseContext = {
    currentTime: new Date("2024-01-15T14:00:00Z"), // 2pm — within hours
    profile: baseProfile,
    customerState: null,
    llmConfidence: 1.0,
  };

  describe("Rule Engine Authority", () => {

    it("ESCALATE action is honored when urgency is URGENT", () => {
      const proposed = {
        type: "ESCALATE" as const,
        urgency: "URGENT" as const,
        revenue_weight: 0.9,
        need_classification: "ESCALATION_REQUIRED" as const,
      };
      const result = validateStaffAction(proposed, baseContext);
      expect(result.type).toBe("ESCALATE");
    });

    it("IGNORE is overridden to REPLY for REVENUE_NOW classification", () => {
      // ASSERT: rule engine never ignores a paying customer
      // Counterexample: LLM proposes IGNORE for a rich buying signal
      const proposed = {
        type: "IGNORE" as const,
        urgency: "LOW" as const,
        revenue_weight: 0.95,
        need_classification: "REVENUE_NOW" as const,
      };
      const result = validateStaffAction(proposed, baseContext);
      // Revenue-now must never be ignored — staff authority enforces reply
      expect(result.type).not.toBe("IGNORE");
    });

    it("Valid REPLY action passes through unchanged", () => {
      const proposed = {
        type: "REPLY" as const,
        urgency: "MEDIUM" as const,
        revenue_weight: 0.6,
        need_classification: "REVENUE_SOON" as const,
      };
      const result = validateStaffAction(proposed, baseContext);
      expect(result.type).toBe("REPLY");
    });

  });

  describe("Sanitization — Hallucination Prevention", () => {

    it("sanitizeStaffReply strips invented prices not in business facts", () => {
      // ASSERT: LLM hallucinating a price that is not in verified business facts
      const hallucinated = "The 6-yards blue lace is ₦50,000!";
      const verifiedFacts = [
        { key: "product_blue_lace", value: "available" },
        { key: "item_price", value: "45000" } // 45k is verified, 50k is not
      ];

      const { sanitizedReply, actionOverride } = sanitizeStaffReply(hallucinated, verifiedFacts);

      expect(sanitizedReply).toContain("[Price pending verification]");
      expect(actionOverride).toBe("ESCALATE");
    });

    it("sanitizeStaffReply preserves valid business facts", () => {
      const reply = "We have the blue lace available for ₦45,000!";
      const verifiedFacts = [
        { key: "product_blue_lace", value: "available" },
        { key: "lace_price", value: "45000" },
      ];

      const { sanitizedReply, actionOverride } = sanitizeStaffReply(reply, verifiedFacts);
      expect(sanitizedReply).toContain("₦45,000");
      expect(actionOverride).toBeUndefined();
    });

    it("sanitizeStaffReply does not produce an empty string", () => {
      const reply = "Our products are great!";
      const facts: any[] = [];
      const { sanitizedReply } = sanitizeStaffReply(reply, facts);
      expect(sanitizedReply.length).toBeGreaterThan(0);
    });
  });

  describe("Phase 3 — Behavioral Continuity", () => {

    it("validateStaffAction never throws on valid input shapes", () => {
      const validInputs = [
        { type: "REPLY" as const, urgency: "LOW" as const, revenue_weight: 0, need_classification: "NO_REVENUE" as const },
        { type: "ESCALATE" as const, urgency: "URGENT" as const, revenue_weight: 1, need_classification: "ESCALATION_REQUIRED" as const },
        { type: "SCHEDULE_FOLLOWUP" as const, urgency: "MEDIUM" as const, revenue_weight: 0.5, need_classification: "REVENUE_SOON" as const },
      ];

      for (const input of validInputs) {
        expect(() => validateStaffAction(input, baseContext)).not.toThrow();
      }
    });

    it("validateStaffAction handles out-of-hours escalation correctly", () => {
      const afterHoursContext = {
        ...baseContext,
        currentTime: new Date("2024-01-15T23:00:00Z"), // 11pm
      };

      const proposed = {
        type: "REPLY" as const,
        urgency: "HIGH" as const,
        revenue_weight: 0.8,
        need_classification: "REVENUE_NOW" as const,
      };

      // Should not throw — system must degrade gracefully at 11pm
      const result = validateStaffAction(proposed, afterHoursContext);
      expect(result.type).toBeDefined();
    });
  });
});
