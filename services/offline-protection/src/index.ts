import { 
  EVENT_TYPES, 
  type EventBus, 
  type DomainEvent, 
  createFollowupEvent 
} from "@chioma/core";
import { createConsoleLogger } from "@chioma/infrastructure";
import type postgres from "postgres";

const logger = createConsoleLogger("offline-protection");

export function registerOfflineProtection(bus: EventBus, sql: postgres.Sql) {
  
  bus.subscribe(EVENT_TYPES.MESSAGE_RECEIVED, async (event: DomainEvent) => {
    const { tenantId, correlationId } = event;

    try {
      // 1. Get working hours and away status
      const [profile] = await sql`SELECT working_hours, onboarding_status FROM employer_profiles WHERE tenant_id = ${tenantId}`;
      const [memory] = await sql`SELECT away_mode_enabled FROM operational_memory WHERE tenant_id = ${tenantId}`;

      if (!profile || profile.onboarding_status !== 'COMPLETED') return;

      const isManualAway = memory?.away_mode_enabled ?? false;
      const isAfterHours = checkIfAfterHours(profile.working_hours);

      if (isManualAway || isAfterHours) {
        logger.info("AWAY_PROTECTION_TRIGGERED", { tenantId, correlationId, isManualAway, isAfterHours });

        // Emit 'OFFLINE_HANDLER_ACTIVATED' or similar internal event
        await bus.publish(createFollowupEvent(EVENT_TYPES.RESPONSE_SENT, {
          text: "Madam is currently away but I have notified her already. She'll respond to you as soon as she's back online.",
          channel: "whatsapp",
          type: "away_mode"
        }, event));
        
        // Emit event for daily digest
        await bus.publish(createFollowupEvent(EVENT_TYPES.EMPLOYER_MARKED_AWAY, { reason: isAfterHours ? "after_hours" : "manual" }, event));
      }
    } catch (err) {
      logger.error("OFFLINE_PROTECTION_ERROR", { tenantId, error: String(err) });
    }
  });
}

function checkIfAfterHours(workingHours: string | null): boolean {
  if (!workingHours) return false;
  // Simple heuristic for now: check if it's night time (10pm to 7am) if parsing fails
  const now = new Date();
  const hour = now.getUTCHours() + 1; // Approx Nigeria time (WAT is UTC+1)
  
  if (hour >= 21 || hour < 7) return true;
  
  // TODO: Implement robust working hours parsing
  return false;
}
