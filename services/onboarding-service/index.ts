import type postgres from "postgres";
import { generateBusinessDraft, formatDraftForEmployer } from "../business-learning/index.js";

const ONBOARDING_STEPS = [
  { key: "business_name", question: "Hello! I'm CHIOMA. What is the name of your business?" },
  { key: "social_learning", question: "Nice! Please send me links to your Instagram, TikTok, or Website so I can learn about your products, tone, and pricing." },
  { key: "validate_draft", question: "Does this look correct to you? Please tell me what I should fix or add!" },
  { key: "escalation_contact", question: "Almost done. If a customer has an urgent request, what phone number should I notify?" }
];

export async function processOnboardingStep(
  sql: any,
  tenantId: string,
  messageText: string
): Promise<{ completed: boolean; response: string }> {
  try {
    const [profile] = await sql`
      SELECT onboarding_status, current_onboarding_step FROM employer_profiles WHERE tenant_id = ${tenantId}
    `;

    if (profile?.onboarding_status === 'COMPLETED') {
      return { completed: true, response: "" };
    }

    if (!profile) {
      await sql`
        INSERT INTO employer_profiles (tenant_id, onboarding_status, current_onboarding_step)
        VALUES (${tenantId}, 'STARTED', ${ONBOARDING_STEPS[0].key})
      `;
      return { completed: false, response: ONBOARDING_STEPS[0].question };
    }

  const currentIndex = ONBOARDING_STEPS.findIndex(s => s.key === profile.current_onboarding_step);
  const currentStep = ONBOARDING_STEPS[currentIndex];

  await sql`
    INSERT INTO business_facts (tenant_id, key, value)
    VALUES (${tenantId}, ${currentStep.key}, ${sql.json({ value: messageText })})
    ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value
  `;

  if (currentStep.key === "social_learning") {
    const draft = await generateBusinessDraft([`Simulated learning from: ${messageText}`]);
    const validationMessage = formatDraftForEmployer(draft);
    
    await sql`
      UPDATE employer_profiles 
      SET current_onboarding_step = 'validate_draft'
      WHERE tenant_id = ${tenantId}
    `;
    return { completed: false, response: validationMessage };
  }

  if (currentStep.key === "validate_draft") {
    const isAffirmative = /^(yes|correct|good|perfect|yep|ok)/i.test(messageText);
    if (!isAffirmative) {
      await sql`
        INSERT INTO business_facts (tenant_id, key, value)
        VALUES (${tenantId}, 'employer_correction', ${sql.json({ correction: messageText, timestamp: new Date() })})
        ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value
      `;
      return { completed: false, response: "Got it! I've updated my understanding. Anything else I should know, or are we good to go?" };
    }
  }

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

  await sql`
    UPDATE employer_profiles 
    SET onboarding_status = 'COMPLETED', 
        current_onboarding_step = NULL,
        tone_profile = 'friendly-shopkeeper',
        response_style = 'helpful',
        version = 1
    WHERE tenant_id = ${tenantId}
  `;

    return { 
      completed: true, 
      response: "Perfect! I've locked in your business knowledge. I'm now ready to manage your customers as your digital staff. 👍" 
    };
  } catch (err) {
    console.error("[ONBOARDING] FATAL_ERROR", err);
    throw err;
  }
}
