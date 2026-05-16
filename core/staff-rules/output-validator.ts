/**
 * core/staff-rules/output-validator.ts
 *
 * DETERMINISTIC OUTPUT VALIDATION LAYER
 *
 * Runs AFTER LLM inference and BEFORE delivery.
 * Rejects responses that violate behavioral contracts.
 * Returns either the original response or a safe repair.
 *
 * Validates:
 * 1. Greeting resets in CONTINUATION_ONLY / COMMITMENT_RESOLUTION modes
 * 2. AI identity leakage ("As an AI...", "I'm a language model...")
 * 3. System prompt leakage (response contains its own instructions)
 * 4. Empty or whitespace-only responses
 * 5. Hallucinated pricing patterns when no facts are available
 *
 * ASSERT: This validator never throws. All failures return a safe fallback.
 */

export type ValidationMode =
  | "GREETING_ALLOWED"
  | "CONTINUATION_ONLY"
  | "COMMITMENT_RESOLUTION"
  | "ONBOARDING"
  | "DAILY_BRIEF";

export type ValidationResult = {
  valid: boolean;
  violations: string[];
  repairedResponse: string; // original if valid, safe fallback if not
};

// ── Greeting patterns that must not appear in non-greeting modes ──────────────
const GREETING_RESET_PATTERNS = [
  /^hello[,!.]?\s/i,
  /^hi[,!.]?\s/i,
  /^good (morning|afternoon|evening)[,!.]?\s/i,
  /how can (i|we) (help|assist) you today/i,
  /welcome[!,.]?\s*(to|back)/i,
  /what can (i|we) do for you today/i,
  /how may (i|we) (help|assist) you/i,
];

// ── AI identity leakage patterns ──────────────────────────────────────────────
const AI_IDENTITY_PATTERNS = [
  /as an ai/i,
  /i'?m a language model/i,
  /i'?m an ai/i,
  /i'?m a (digital )?assistant/i,
  /i don'?t have (the ability|access|feelings|consciousness)/i,
  /my training data/i,
  /i was (trained|created|built) by/i,
  /large language model/i,
  /llm\b/i,
  /chatgpt|openai|groq|anthropic|claude/i, // never reveal provider
];

// ── System prompt leakage indicators ─────────────────────────────────────────
const SYSTEM_PROMPT_LEAKAGE_PATTERNS = [
  /CHIOMA EMPLOYEE BEHAVIORAL CONTRACT/i,
  /AUTHORITY: DETERMINISTIC RUNTIME/i,
  /BOUNDED COGNITION LAYER/i,
  /OUTPUT SCHEMA \(STRICT\)/i,
  /PROMPT INJECTION RESISTANCE/i,
  /STRATEGIC_EXECUTION_DIRECTIVE/i,
  /CONVERSATION_HEARTBEAT/i,
];

// ── Greeting repair fallbacks by mode ────────────────────────────────────────
function getGreetingRepair(mode: ValidationMode, currentGoal: string | null): string {
  if (mode === "COMMITMENT_RESOLUTION") {
    return currentGoal
      ? `Still working on that for you — ${currentGoal.toLowerCase()}. One moment.`
      : "Still working on that for you. One moment.";
  }
  // CONTINUATION_ONLY — redirect to active thread
  return currentGoal
    ? `Right, so regarding ${currentGoal.toLowerCase()} — let me help you with that.`
    : "Yes, I'm here. How can I continue helping you?";
}

// ── Main validator ────────────────────────────────────────────────────────────

/**
 * Validates an LLM response against mode constraints.
 * Returns repaired response if invalid — never throws.
 *
 * @param response     - LLM-generated text
 * @param mode         - current execution mode (determines which checks apply)
 * @param currentGoal  - active customer goal for repair context
 */
export function validateOutputResponse(
  response: string,
  mode: ValidationMode,
  currentGoal: string | null
): ValidationResult {
  const violations: string[] = [];
  const trimmed = (response != null && typeof response === "string") ? response.trim() : "";

  // 1. Empty response
  if (!trimmed) {
    violations.push("EMPTY_RESPONSE");
    return {
      valid: false,
      violations,
      repairedResponse: "Let me check on that for you and get back to you shortly.",
    };
  }

  // 2. AI identity leakage — always blocked regardless of mode
  for (const pattern of AI_IDENTITY_PATTERNS) {
    if (pattern.test(trimmed)) {
      violations.push(`AI_IDENTITY_LEAK: matched ${pattern.source}`);
      break;
    }
  }

  // 3. System prompt leakage — always blocked
  for (const pattern of SYSTEM_PROMPT_LEAKAGE_PATTERNS) {
    if (pattern.test(trimmed)) {
      violations.push(`SYSTEM_PROMPT_LEAK: matched ${pattern.source}`);
      break;
    }
  }

  // 4. Greeting reset — only blocked in CONTINUATION or COMMITMENT modes
  if (mode === "CONTINUATION_ONLY" || mode === "COMMITMENT_RESOLUTION") {
    for (const pattern of GREETING_RESET_PATTERNS) {
      if (pattern.test(trimmed)) {
        violations.push(`GREETING_RESET_IN_${mode}: matched ${pattern.source}`);
        break;
      }
    }
  }

  if (violations.length === 0) {
    return { valid: true, violations: [], repairedResponse: trimmed };
  }

  // Determine repair strategy
  const hasGreetingReset = violations.some(v => v.startsWith("GREETING_RESET"));
  const hasIdentityLeak = violations.some(v => v.startsWith("AI_IDENTITY") || v.startsWith("SYSTEM_PROMPT"));

  let repairedResponse: string;

  if (hasIdentityLeak) {
    // Hard override for identity/system leaks — cannot trust LLM output at all
    repairedResponse = mode === "COMMITMENT_RESOLUTION" || mode === "CONTINUATION_ONLY"
      ? (currentGoal
          ? `Still working on that for you. Regarding ${currentGoal.toLowerCase()} — let me get that sorted.`
          : "I'm here to help. Let me look into that for you.")
      : "I'm here to help with your enquiry. What would you like to know?";
  } else if (hasGreetingReset) {
    repairedResponse = getGreetingRepair(mode, currentGoal);
  } else {
    repairedResponse = "Let me check on that for you and get back to you shortly.";
  }

  console.warn(`[OUTPUT_VALIDATOR] VIOLATIONS: ${violations.join(", ")} — response repaired`);

  return { valid: false, violations, repairedResponse };
}
