import type { EmployabilityProfile, StaffAction } from "../contracts/index.js";

/**
 * core/staff-rules/index.ts
 *
 * THE CHIOMATIC FIREWALL.
 * Deterministic rules that govern CHIOMA's behavior with absolute authority.
 * This module is the "Governor" — the LLM is merely the "Renderer".
 */

export interface StaffRulesContext {
  currentTime: Date;
  profile: EmployabilityProfile;
  customerState: any;
  llmConfidence: number;
}

export function validateStaffAction(
  proposedAction: StaffAction,
  context: StaffRulesContext
): StaffAction {
  let validatedAction = { ...proposedAction };

  // 1. ESCALATION INVARIANTS (Rule E1)
  if (validatedAction.need_classification === "ESCALATION_REQUIRED") {
    validatedAction.type = "ESCALATE";
    validatedAction.urgency = "HIGH";
  }

  // 2. REVENUE PROTECTION (Rule R1, R2)
  const isRevenueSignal = 
    validatedAction.need_classification === "REVENUE_NOW" || 
    validatedAction.need_classification === "REVENUE_SOON" ||
    validatedAction.revenue_weight > 0.75;

  if (isRevenueSignal && validatedAction.type === "IGNORE") {
    validatedAction.type = "REPLY";
    validatedAction.urgency = "HIGH";
  }

  // 3. CONFIDENCE GATES (Rule C1)
  if (context.llmConfidence < 0.4 && !isRevenueSignal) {
    // If we're not sure what they want and it's not money, don't guess.
    validatedAction.type = "IGNORE";
  }

  // 4. ESCALATION SAFETY (Rule E2)
  if (validatedAction.type === "ESCALATE") {
    if (!context.profile.escalation_contact) {
      // Fallback: If we can't escalate, we MUST reply to keep the customer engaged.
      validatedAction.type = "REPLY"; 
      if (validatedAction.urgency === "URGENT") validatedAction.urgency = "HIGH";
    }
  }

  // 5. BUSINESS HOURS ENFORCEMENT
  if (!isWithinWorkingHours(context.currentTime, context.profile.working_hours)) {
    // Outside hours: promote urgency for next-day followup if it's revenue.
    if (isRevenueSignal && validatedAction.type === "REPLY") {
      validatedAction.type = "SCHEDULE_FOLLOWUP";
    }
  }

  return validatedAction;
}

export function isWithinWorkingHours(now: Date, workingHours: string): boolean {
  try {
    if (!workingHours || workingHours === "Not specified") return true;
    const [start, end] = workingHours.split("-");
    const [startH, startM] = start.split(":").map(Number);
    const [endH, endM] = end.split(":").map(Number);

    const currentH = now.getHours();
    const currentM = now.getMinutes();

    const currentTotalMinutes = currentH * 60 + currentM;
    const startTotalMinutes = startH * 60 + startM;
    const endTotalMinutes = endH * 60 + endM;

    return currentTotalMinutes >= startTotalMinutes && currentTotalMinutes <= endTotalMinutes;
  } catch (err) {
    console.error("WORKING_HOURS_PARSE_ERROR", err);
    return true; 
  }
}

/**
 * FACTUAL INTEGRITY (Rule F1 - PRICE LOCK)
 * Ensures no hallucinated prices reach the customer.
 */
export function sanitizeStaffReply(reply: string, businessKnowledge: any[]): { sanitizedReply: string, actionOverride?: "ESCALATE" } {
  // Regex to detect currency patterns: ₦1,000, $50, etc.
  const priceRegex = /(?:₦|\$|£|GH₵)\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?/g;
  const foundPrices = reply.match(priceRegex);

  if (!foundPrices) return { sanitizedReply: reply };

  // Collect verified prices from business knowledge
  const verifiedPrices = businessKnowledge
    .filter(f => f.key.includes('price') || f.key.includes('cost'))
    .map(f => String(f.value).replace(/[^0-9.]/g, ''));

  for (const priceStr of foundPrices) {
    const numericPrice = priceStr.replace(/[^0-9.]/g, '');
    if (!verifiedPrices.includes(numericPrice)) {
      // HALLUCINATION DETECTED: Price in reply is NOT in business facts.
      console.warn("FIREWALL_BLOCK: Hallucinated price detected", { priceStr, numericPrice });
      
      // Redact and trigger escalation
      const redacted = reply.replace(priceStr, "[Price pending verification]");
      return { 
        sanitizedReply: redacted + "\n\n(I'm checking the exact price with the owner to be 100% sure for you.)",
        actionOverride: "ESCALATE" 
      };
    }
  }

  return { sanitizedReply: reply };
}
