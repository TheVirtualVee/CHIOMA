import { z } from "zod";
import { EVENT_TYPES, createFollowupEvent, type EventBus, type LlmStructuredOutput, type ExecutionIntent } from "@chioma/core";
import { createConsoleLogger, devEvent, metrics, overseer, createLlmProviderFromEnv } from "@chioma/infrastructure";

const LlmOutputSchema = z.object({
  response: z.string(),
  intent: z.string(),
  proposed_commitments: z.array(z.any()),
  confidence: z.number(),
});

export function registerLlmOrchestrator(bus: EventBus): void {
  const logger = createConsoleLogger("llm-orchestrator");
  const llm = createLlmProviderFromEnv();

  bus.subscribe(EVENT_TYPES.MEMORY_UPDATED, async (event) => {
    const payload = event.payload as { kind?: string; text?: string } | null;
    if (payload?.kind !== "CONTEXT_SNAPSHOT") return;

    const input = payload.text ?? (payload as any).activeConversation?.[0]?.text ?? "";
    
    const { tenantId, correlationId, id: causationId } = event;
    let resolvedIntent: ExecutionIntent = "assist" as any;

    try {
      const facts = (payload as any).businessFacts ?? [];
      const factsStr = facts.map((f: any) => `${f.key}: ${JSON.stringify(f.value)}`).join("\n");

      // ─── LLM Bounded Cognition Call ───────────────────────────────────────
      const llmResult = await llm.complete({
        systemPrompt: `You are CHIOMA, a trusted operational employee for a business in Nigeria.
Respond like a professional, helpful local assistant. 

BUSINESS CONTEXT:
${factsStr}

Use short, natural, and emotionally intelligent language. 
Avoid robotic or corporate AI-style phrasing.
Tolerate and adapt to local slang, shorthand, or pidgin if appropriate for the context.
If the boss (employer) is away, reassure the customer naturally (e.g., 'Madam is away currently but she has been notified').
DO NOT invent facts. DO NOT make promises the business hasn't authorized.
Return ONLY a JSON object: { "response": string, "intent": string, "proposed_commitments": [], "confidence": number }`,
        prompt: input,
        temperature: 0,
      });

      // ASSERT: LLM output never trusted — validated via Zod schema
      const structured = LlmOutputSchema.parse(JSON.parse(llmResult.content)) as LlmStructuredOutput;
      resolvedIntent = structured.intent as ExecutionIntent;

      // ─── Safe Response Mode (Phase 0) ─────────────────────────────────────
      if (structured.confidence < 0.7) {
        logger.warn("LOW_CONFIDENCE_FALLBACK", { correlationId, confidence: structured.confidence });
        structured.response = "I'm not exactly sure about that, but I have notified Madam. She will confirm everything for you shortly.";
        structured.proposed_commitments = [];
      }

      // ─── Governance Check ─────────────────────────────────────────────────
      const validated = overseer.validate(resolvedIntent, input);
      if (!validated.ok) {
        logger.warn("GOVERNANCE_BLOCKED", { correlationId: event.correlationId, reason: validated.reason });
        await bus.publish(createFollowupEvent(EVENT_TYPES.EXECUTION_FAILED, { type: "GOVERNANCE_BLOCKED", detail: validated.reason }, event));
        return;
      }

      logger.info("LLM_COMPLETED", { correlationId, tenantId, causationId, intent: resolvedIntent });
      metrics.emit("llm_generation_completed", { correlationId, tenantId, causationId, service: "llm-orchestrator" });

      await bus.publish(
        devEvent(
          `llm_${event.id}`,
          EVENT_TYPES.MEMORY_UPDATED,
          { kind: "LLM_COMPLETED", structured },
          correlationId,
          event.id,
          tenantId,
        ),
      );

      await bus.publish(createFollowupEvent(EVENT_TYPES.EXECUTION_COMPLETED, { intent: resolvedIntent, status: "SUCCESS" }, event));

    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("LLM_ORCHESTRATION_FAILED", { correlationId, error: message });
      
      if (message?.includes("CONFIG_INVALID")) {
        await bus.publish(createFollowupEvent(EVENT_TYPES.EXECUTION_FAILED, { type: "CONFIG_INVALID", detail: message }, event));
      } else {
        await bus.publish(createFollowupEvent(EVENT_TYPES.EXECUTION_FAILED, { type: "EXECUTION_FAILED", detail: message }, event));
      }
    }
  });
}
