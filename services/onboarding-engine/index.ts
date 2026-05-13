import type postgres from "postgres";
import { generateBusinessDraft, formatDraftForOwner } from "../business-understanding-engine/index.js";

/**
 * services/onboarding-engine/index.ts
 *
 * The Employability Lock-In Onboarding.
 * 1. Collect Links -> 2. Generate Draft -> 3. Validate Loop -> 4. Lock Profile.
 */

const ONBOARDING_STEPS = [
  { key: "business_name", question: "Hello! I'm CHIOMA. What is the name of your business?" },
  { key: "social_links", question: "Nice! Please send me links to your Instagram, TikTok, or Website so I can learn about your products." },
  { key: "validate_draft", question: "GENERATED_DYNAMICALLY" },
  { key: "escalation_contact", question: "Almost done. If a customer has an urgent request, what phone number should I notify?" }
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

  // SPECIAL LOGIC: Link Ingestion -> Draft Generation
  if (currentStep.key === "social_links") {
    // In a real system, we'd fetch the links here. For MVP, we simulate with a dummy text.
    const draft = await generateBusinessDraft([`Simulated content from: ${messageText}`]);
    const validationMessage = formatDraftForOwner(draft);
    
    await sql`
      UPDATE employer_profiles 
      SET current_onboarding_step = 'validate_draft'
      WHERE tenant_id = ${tenantId}
    `;
    return { completed: false, response: validationMessage };
  }

  // SPECIAL LOGIC: Validation Confirmation
  if (currentStep.key === "validate_draft") {
    // If they said something like "yes" or "correct", proceed.
    // If they corrected it, we would update the facts here.
  }

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
    response: "Perfect! I've locked in your business profile. I'm now ready to manage your customers like a pro. 👍" 
  };
}
