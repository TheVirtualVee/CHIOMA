import type postgres from "postgres";

/**
 * services/onboarding-engine/index.ts
 *
 * The 90-Second Chat-Only Onboarding Contract.
 * Ensures the digital employee is hired and ready in < 4 questions.
 */

const ONBOARDING_STEPS = [
  { key: "business_name", question: "Hello! I'm CHIOMA, your new digital staff. What is the name of your business?" },
  { key: "products", question: "Nice to meet you! What exactly do you sell or provide?" },
  { key: "working_hours", question: "Got it. What are your business hours? (e.g., 8am-6pm Mon-Sat)" },
  { key: "escalation_contact", question: "Last thing: If a customer has an urgent request, what phone number should I notify?" }
];

export async function processOnboardingStep(
  sql: postgres.Sql,
  tenantId: string,
  messageText: string
): Promise<{ completed: boolean; response: string }> {
  
  const [profile] = await sql`
    SELECT onboarding_status, current_onboarding_step FROM employer_profiles WHERE tenant_id = ${tenantId}
  `;

  if (profile?.onboarding_status === 'COMPLETED') {
    return { completed: true, response: "" };
  }

  // 1. Initial Greeting
  if (!profile) {
    await sql`
      INSERT INTO employer_profiles (tenant_id, onboarding_status, current_onboarding_step)
      VALUES (${tenantId}, 'STARTED', ${ONBOARDING_STEPS[0].key})
    `;
    return { completed: false, response: ONBOARDING_STEPS[0].question };
  }

  // 2. Process Answer & Advance
  const currentIndex = ONBOARDING_STEPS.findIndex(s => s.key === profile.current_onboarding_step);
  const currentStep = ONBOARDING_STEPS[currentIndex];

  // Save the fact
  await sql`
    INSERT INTO business_facts (tenant_id, key, value)
    VALUES (${tenantId}, ${currentStep.key}, ${sql.json({ value: messageText })})
    ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value
  `;

  // Advance to next step
  const nextStep = ONBOARDING_STEPS[currentIndex + 1];
  if (nextStep) {
    await sql`
      UPDATE employer_profiles 
      SET current_onboarding_step = ${nextStep.key},
          business_name = CASE WHEN ${currentStep.key} = 'business_name' THEN ${messageText} ELSE business_name END
      WHERE tenant_id = ${tenantId}
    `;
    return { completed: false, response: nextStep.question };
  }

  // 3. Finalize
  await sql`
    UPDATE employer_profiles 
    SET onboarding_status = 'COMPLETED', 
        current_onboarding_step = NULL,
        tone_profile = 'friendly-shopkeeper',
        response_style = 'helpful'
    WHERE tenant_id = ${tenantId}
  `;

  return { 
    completed: true, 
    response: "Perfect! I'm now ready to handle your customers. I'll stay active on this line and notify you if anything urgent comes up. 👍" 
  };
}
