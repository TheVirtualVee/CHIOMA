/**
 * evals/validation/11-output-validator.test.ts
 *
 * Tests for the deterministic output validation layer.
 * Every test covers a real failure mode from the audit report.
 */

import { describe, it, expect } from "vitest";
import { validateOutputResponse } from "../../core/staff-rules/output-validator.js";

describe("Output Validator — Greeting Reset Guard", () => {

  it("blocks 'Hello, how can I assist you today?' in CONTINUATION_ONLY", () => {
    // FAILURE MODE: Customer had active thread. CHIOMA greeted them as new.
    const result = validateOutputResponse(
      "Hello, how can I assist you today?",
      "CONTINUATION_ONLY",
      "fabric pricing"
    );
    expect(result.valid).toBe(false);
    expect(result.violations.some(v => v.startsWith("GREETING_RESET"))).toBe(true);
    expect(result.repairedResponse).not.toMatch(/hello|how can I assist/i);
    expect(result.repairedResponse.length).toBeGreaterThan(0);
  });

  it("blocks greeting reset in COMMITMENT_RESOLUTION with active goal", () => {
    // FAILURE MODE: Pending 'check availability' commitment — CHIOMA greeted instead
    const result = validateOutputResponse(
      "Hi! Welcome back, how can I help you today?",
      "COMMITMENT_RESOLUTION",
      "check room availability for Friday"
    );
    expect(result.valid).toBe(false);
    expect(result.repairedResponse.toLowerCase()).toContain("friday");
  });

  it("allows greeting in GREETING_ALLOWED mode", () => {
    // New customer — greeting is correct behavior
    const result = validateOutputResponse(
      "Hello! Welcome to Kalu Hotels. How can I help you today?",
      "GREETING_ALLOWED",
      null
    );
    expect(result.valid).toBe(true);
    expect(result.repairedResponse).toBe("Hello! Welcome to Kalu Hotels. How can I help you today?");
  });

  it("passes non-greeting continuation response in CONTINUATION_ONLY", () => {
    const result = validateOutputResponse(
      "The 6-yard Ankara is available at ₦12,000. Would you like to place an order?",
      "CONTINUATION_ONLY",
      "Ankara pricing"
    );
    expect(result.valid).toBe(true);
  });

  it("repair response references current goal when available", () => {
    const result = validateOutputResponse(
      "Good morning! How may I assist you today?",
      "CONTINUATION_ONLY",
      "blue lace fabric"
    );
    expect(result.valid).toBe(false);
    expect(result.repairedResponse.toLowerCase()).toContain("blue lace");
  });
});

describe("Output Validator — AI Identity Leak Guard", () => {

  it("blocks 'As an AI' regardless of mode", () => {
    // FAILURE MODE: LLM revealed AI nature under adversarial questioning
    const result = validateOutputResponse(
      "As an AI language model, I can help you with your enquiry.",
      "GREETING_ALLOWED",
      null
    );
    expect(result.valid).toBe(false);
    expect(result.violations.some(v => v.startsWith("AI_IDENTITY"))).toBe(true);
    expect(result.repairedResponse).not.toMatch(/as an ai/i);
  });

  it("blocks 'I'm a language model' in any mode", () => {
    const result = validateOutputResponse(
      "I'm a language model and I don't have access to real-time information.",
      "CONTINUATION_ONLY",
      null
    );
    expect(result.valid).toBe(false);
  });

  it("blocks provider name leakage", () => {
    // FAILURE MODE: LLM reveals Groq/OpenAI under probing
    const result = validateOutputResponse(
      "I'm powered by Groq's LLM infrastructure.",
      "GREETING_ALLOWED",
      null
    );
    expect(result.valid).toBe(false);
  });

  it("allows professional staff responses without AI framing", () => {
    const result = validateOutputResponse(
      "I'm not sure about that specific detail — let me check with the team and get back to you.",
      "CONTINUATION_ONLY",
      null
    );
    expect(result.valid).toBe(true);
  });
});

describe("Output Validator — System Prompt Leakage Guard", () => {

  it("blocks response containing system prompt text", () => {
    // FAILURE MODE: LLM echoed its own instructions back to the customer
    const result = validateOutputResponse(
      "CHIOMA EMPLOYEE BEHAVIORAL CONTRACT v2.0 — AUTHORITY: DETERMINISTIC RUNTIME",
      "GREETING_ALLOWED",
      null
    );
    expect(result.valid).toBe(false);
    expect(result.violations.some(v => v.startsWith("SYSTEM_PROMPT_LEAK"))).toBe(true);
  });

  it("blocks STRATEGIC_EXECUTION_DIRECTIVE in output", () => {
    const result = validateOutputResponse(
      "## STRATEGIC_EXECUTION_DIRECTIVE [MODE: CONTINUATION_ONLY] - STATUS: You have an active commitment",
      "CONTINUATION_ONLY",
      null
    );
    expect(result.valid).toBe(false);
  });
});

describe("Output Validator — Edge Cases", () => {

  it("handles empty string — returns non-empty fallback", () => {
    const result = validateOutputResponse("", "GREETING_ALLOWED", null);
    expect(result.valid).toBe(false);
    expect(result.violations).toContain("EMPTY_RESPONSE");
    expect(result.repairedResponse.trim().length).toBeGreaterThan(0);
  });

  it("handles whitespace-only response", () => {
    const result = validateOutputResponse("   \n\t  ", "CONTINUATION_ONLY", null);
    expect(result.valid).toBe(false);
    expect(result.repairedResponse.trim().length).toBeGreaterThan(0);
  });

  it("never throws on any input", () => {
    const adversarialInputs = [
      null as any,
      undefined as any,
      123 as any,
      { object: true } as any,
      "A".repeat(10000),
    ];
    for (const input of adversarialInputs) {
      expect(() => validateOutputResponse(input, "GREETING_ALLOWED", null)).not.toThrow();
    }
  });
});
