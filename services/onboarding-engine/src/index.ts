import { 
  EVENT_TYPES, 
  type EventBus, 
  type DomainEvent, 
  createFollowupEvent 
} from "@chioma/core";
import { createConsoleLogger, metrics, createLlmProviderFromEnv } from "@chioma/infrastructure";
import type postgres from "postgres";

const logger = createConsoleLogger("onboarding-engine");

export type OnboardingStep = {
  key: string;
  event: string;
  question: string;
  field: string;
};

export const ONBOARDING_FLOW: OnboardingStep[] = [
  {
    key: "BUSINESS_PROFILE",
    event: EVENT_TYPES.BUSINESS_PROFILE_DEFINED,
    question: "Hi, I’m CHIOMA. I’ll help you never miss customer money again.\n\nWhat’s your business name and what exactly do you sell?",
    field: "business_name",
  },
  {
    key: "BUSINESS_HOURS",
    event: EVENT_TYPES.BUSINESS_HOURS_DEFINED,
    question: "Got it. What are your working hours? (e.g., 8am to 6pm, Mon-Sat)",
    field: "working_hours",
  },
  {
    key: "DELIVERY",
    event: EVENT_TYPES.HIGH_VALUE_ITEM_DEFINED,
    question: "Do you deliver to customers? And what are your most expensive products?",
    field: "delivery_capability",
  },
  {
    key: "ESCALATION",
    event: EVENT_TYPES.ESCALATION_CONTACT_REGISTERED,
    question: "Who should I alert if a serious customer comes while you’re away? Please provide their phone number.",
    field: "escalation_contact",
  },
  {
    key: "TONE",
    event: EVENT_TYPES.TONE_PROFILE_DEFINED,
    question: "Final one: What language or style should I use with customers? (e.g., English, Pidgin, very formal, or friendly local style)",
    field: "tone_preference",
  }
];

export function registerOnboardingEngine(bus: EventBus, sql: postgres.Sql) {
  const llm = createLlmProviderFromEnv();

  bus.subscribe(EVENT_TYPES.MESSAGE_RECEIVED, async (event: DomainEvent) => {
    const { tenantId, correlationId } = event;
    const text = (event.payload as any).text ?? "";

    try {
      // 1. Check current profile status
      const [profile] = await sql`SELECT onboarding_status, current_onboarding_step FROM employer_profiles WHERE tenant_id = ${tenantId}`;
      
      if (!profile || profile.onboarding_status !== 'COMPLETED') {
        logger.info("ONBOARDING_INTERCEPT", { tenantId, correlationId });

        // If PENDING or non-existent, start onboarding
        if (!profile || profile.onboarding_status === 'PENDING') {
          const firstStep = ONBOARDING_FLOW[0];
          
          if (!profile) {
            await sql`INSERT INTO employer_profiles (tenant_id, onboarding_status, current_onboarding_step) VALUES (${tenantId}, 'STARTED', ${firstStep.key})`;
            await bus.publish(createFollowupEvent(EVENT_TYPES.EMPLOYER_ONBOARDING_STARTED, {}, event));
          } else {
            await sql`UPDATE employer_profiles SET onboarding_status = 'STARTED', current_onboarding_step = ${firstStep.key} WHERE tenant_id = ${tenantId}`;
          }

          // Send first question
          await bus.publish(createFollowupEvent(EVENT_TYPES.RESPONSE_SENT, {
            text: firstStep.question,
            channel: "whatsapp",
            type: "onboarding"
          }, event));
          
          return;
        }

        // If STARTED, process the response to the current step
        const currentStep = ONBOARDING_FLOW.find(s => s.key === profile.current_onboarding_step);
        if (currentStep) {
          // Extract data using LLM
          const extraction = await llm.complete({
            systemPrompt: `Extract ${currentStep.field} from the user's message. Return ONLY the value. Message: "${text}"`,
            prompt: text,
            temperature: 0
          });

          const value = extraction.content.trim();
          
          // Emit definition event
          await bus.publish(createFollowupEvent(currentStep.event as any, { [currentStep.field]: value }, event));

          // Move to next step
          const currentIdx = ONBOARDING_FLOW.indexOf(currentStep);
          const nextStep = ONBOARDING_FLOW[currentIdx + 1];

          if (nextStep) {
            await sql`UPDATE employer_profiles SET current_onboarding_step = ${nextStep.key} WHERE tenant_id = ${tenantId}`;
            await bus.publish(createFollowupEvent(EVENT_TYPES.RESPONSE_SENT, {
              text: nextStep.question,
              channel: "whatsapp",
              type: "onboarding"
            }, event));
          } else {
            await sql`UPDATE employer_profiles SET onboarding_status = 'COMPLETED', current_onboarding_step = NULL WHERE tenant_id = ${tenantId}`;
            await bus.publish(createFollowupEvent(EVENT_TYPES.ONBOARDING_COMPLETED, {}, event));
            await bus.publish(createFollowupEvent(EVENT_TYPES.RESPONSE_SENT, {
              text: "You're all set! I'm now protecting your business 24/7. Just chat with me if you need anything.",
              channel: "whatsapp",
              type: "onboarding"
            }, event));
          }
        }
      }
    } catch (err) {
      logger.error("ONBOARDING_ERROR", { tenantId, error: String(err) });
    }
  });
}

/** 
 * contract: determineNextStep
 * Logic for deciding what to ask the business owner next.
 */
export function determineNextStep(completedEvents: string[]): OnboardingStep | null {
  for (const step of ONBOARDING_FLOW) {
    if (!completedEvents.includes(step.event)) {
      return step;
    }
  }
  return null;
}
