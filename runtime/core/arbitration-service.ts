import { ARBITRATE, getConversationState, checkEscalation, detectActor, ArbitrationInput, ArbitrationOutput } from "../../core/arbitration/engine.js";
import { RuntimeEvent } from "../ingress/event-bus.js";

export async function runArbitration(sql: any, event: RuntimeEvent): Promise<ArbitrationOutput> {
  // If it's a cron or learning trigger, we can treat it as SYSTEM
  if (event.source === 'cron' || event.source === 'system') {
    return { actor: 'SYSTEM', reason: 'system_event_pass_through', confidence: 1 };
  }
  
  const actor = await detectActor(sql, event.tenantId, event.channelUserId);
  const partialState = await getConversationState(sql, event.tenantId, event.channelUserId);
  
  const escalation = event.message ? checkEscalation(event.message) : { isEscalation: false };

  const input: ArbitrationInput = {
    tenantId: event.tenantId,
    channelUserId: event.channelUserId,
    channelChatId: event.channelChatId,
    ownerLastSeen: partialState.ownerLastSeen ?? null,
    lastOwnerAt: partialState.lastOwnerAt ?? null,
    lastChiomaAt: partialState.lastChiomaAt ?? null,
    responseLockUntil: partialState.responseLockUntil ?? null,
    autoResponseThresholdMinutes: partialState.autoResponseThresholdMinutes ?? 5,
    slowResponseThresholdSeconds: partialState.slowResponseThresholdSeconds ?? 30,
    overrideLockSeconds: partialState.overrideLockSeconds ?? 10,
    actorClassification: actor,
    escalationActive: escalation.isEscalation
  };

  return ARBITRATE(input);
}
