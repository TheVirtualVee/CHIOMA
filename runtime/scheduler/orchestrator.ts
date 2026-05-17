import { getOverdueCommitments, enforceCommitment } from "./commitment-enforcer.js";
import { getPendingDeliveries, retryDelivery } from "./delivery-retry.js";
import { getStaleEscalations, escalateToEmergencyContact } from "./escalation-monitor.js";
import { getStaleLeases, releaseLease } from "./lease-releaser.js";

export type SchedulerReport = {
  commitmentsProcessed: number;
  deliveriesRetried: number;
  escalationsTriggered: number;
  locksReleased: number;
  errors: string[];
};

export async function runSchedulerCycle(sql: any, config: any): Promise<SchedulerReport> {
  const report: SchedulerReport = {
    commitmentsProcessed: 0,
    deliveriesRetried: 0,
    escalationsTriggered: 0,
    locksReleased: 0,
    errors: []
  };
  
  // Phase 1: Process overdue commitments
  try {
    const commitments = await getOverdueCommitments(sql);
    for (const commitment of commitments) {
      await enforceCommitment(sql, commitment);
      report.commitmentsProcessed++;
    }
  } catch (err) { report.errors.push(`Commitments: ${err}`); }
  
  // Phase 2: Retry failed deliveries
  try {
    const failedDeliveries = await getPendingDeliveries(sql, { olderThanMinutes: 5 });
    for (const delivery of failedDeliveries) {
      await retryDelivery(sql, delivery);
      report.deliveriesRetried++;
    }
  } catch (err) { report.errors.push(`Deliveries: ${err}`); }
  
  // Phase 3: Check escalations
  try {
    const staleEscalations = await getStaleEscalations(sql, { olderThanMinutes: 30 });
    for (const escalation of staleEscalations) {
      await escalateToEmergencyContact(sql, escalation, config.TELEGRAM_BOT_TOKEN ?? "");
      report.escalationsTriggered++;
    }
  } catch (err) { report.errors.push(`Escalations: ${err}`); }
  
  // Phase 4: Release stale leases
  try {
    const staleLeases = await getStaleLeases(sql, { olderThanMinutes: 10 });
    for (const lease of staleLeases) {
      await releaseLease(sql, lease);
      report.locksReleased++;
    }
  } catch (err) { report.errors.push(`Leases: ${err}`); }
  
  console.log(`[SCHEDULER] Report:`, report);
  return report;
}
