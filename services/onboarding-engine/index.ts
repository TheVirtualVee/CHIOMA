import type postgres from "postgres";

/**
 * services/onboarding-engine/index.ts
 *
 * Manages the multi-step business onboarding conversational flow.
 */

interface OnboardingStep {
  key: string;
  question: string;
  field: string;
}

const ONBOARDING_FLOW: OnboardingStep[] = [
  {
    key: "BUSINESS_PROFILE",
    question: "Hi, I'm CHIOMA. What's your business name and what do you sell?",
    field: "business_name",
  },
  {
    key: "BUSINESS_HOURS",
    question: "Got it. What are your working hours? (e.g., 8am-6pm)",
    field: "working_hours",
  },
  {
    key: "DELIVERY",
    question: "Do you deliver? What are your top products?",
    field: "delivery_capability",
  },
  {
    key: "ESCALATION",
    question: "Who should I alert for serious issues? (Phone number)",
    field: "escalation_contact",
  },
  {
    key: "TONE",
    question: "Final one: What language style should I use? (e.g., Friendly English/Pidgin)",
    field: "tone_preference",
  },
];

export async function processOnboardingStep(
  sql: postgres.Sql,
  tenantId: string,
  messageText: string
): Promise<{ response: string; completed: boolean }> {
  const [profile] = await sql`
    SELECT onboarding_status, current_onboarding_step 
    FROM employer_profiles WHERE tenant_id = ${tenantId}
  `;

  if (!profile) {
    await sql`
      INSERT INTO employer_profiles (tenant_id, onboarding_status, current_onboarding_step)
      VALUES (${tenantId}, 'STARTED', ${ONBOARDING_FLOW[0].key})
    `;
    return { response: ONBOARDING_FLOW[0].question, completed: false };
  }

  if (profile.onboarding_status === "COMPLETED") {
    return { response: "", completed: true };
  }

  const currentIndex = ONBOARDING_FLOW.findIndex(s => s.key === profile.current_onboarding_step);
  const nextStep = ONBOARDING_FLOW[currentIndex + 1];

  if (nextStep) {
    await sql`
      UPDATE employer_profiles SET current_onboarding_step = ${nextStep.key}
      WHERE tenant_id = ${tenantId}
    `;
    return { response: nextStep.question, completed: false };
  }

  await sql`
    UPDATE employer_profiles SET onboarding_status = 'COMPLETED', current_onboarding_step = NULL
    WHERE tenant_id = ${tenantId}
  `;

  return {
    response: "You're all set! I'm now protecting your business 24/7.",
    completed: false,
  };
}
