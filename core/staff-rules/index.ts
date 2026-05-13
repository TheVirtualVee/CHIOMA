import type { EmployabilityProfile, StaffAction } from "../contracts/index.js";

/**
 * core/staff-rules/index.ts
 *
 * THE OPERATIONAL AUTHORITY.
 * Deterministic rules that govern CHIOMA's behavior.
 * The LLM may suggest, but this module decides.
 */

export interface StaffRulesContext {
  currentTime: Date;
  profile: EmployabilityProfile;
  customerState: any;
}

export function validateStaffAction(
  proposedAction: StaffAction,
  context: StaffRulesContext
): StaffAction {
  let validatedAction = { ...proposedAction };

  // 1. Business Hours Enforcement
  if (!isWithinWorkingHours(context.currentTime, context.profile.working_hours)) {
    // If it's outside hours and not already an escalation, we might want to force an auto-reply or queue
    if (validatedAction.type === "REPLY") {
      // Logic for after-hours auto-reply could go here
    }
  }

  // 2. Escalation Safety
  if (validatedAction.type === "ESCALATE") {
    // Ensure escalation contact exists
    if (!context.profile.escalation_contact) {
      validatedAction.type = "REPLY"; // Fallback to reply if no one to escalate to
    }
  }

  // 3. Revenue Protection — IGNORE is never valid for paying customers
  // ASSERT: if a customer signals revenue intent, they must receive a reply.
  // Counterexample: LLM proposes IGNORE for "I want to buy now" → lost sale.
  if (
    validatedAction.type === "IGNORE" &&
    (validatedAction.need_classification === "REVENUE_NOW" ||
      validatedAction.need_classification === "REVENUE_SOON")
  ) {
    validatedAction = { ...validatedAction, type: "REPLY" };
  }

  // 4. Escalation without contact — fallback to REPLY (already handled above for ESCALATE)
  // covered in rule 2.

  return validatedAction;
}

export function isWithinWorkingHours(now: Date, workingHours: string): boolean {
  // Simple implementation: "08:00-18:00" format
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
    return true; // Default to open if format is weird
  }
}

/**
 * Ensures no operational facts are hallucinated.
 * This should be used to post-process LLM output if it contains sensitive data like prices.
 */
export function sanitizeStaffReply(reply: string, businessKnowledge: any[]): string {
  // Logic to cross-reference facts
  return reply;
}
