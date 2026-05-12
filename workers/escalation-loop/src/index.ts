import { createConsoleLogger } from "@chioma/infrastructure";

export function startEscalationLoopWorker(): () => void {
  const log = createConsoleLogger("worker.escalation-loop");
  const t = setInterval(() => {
    log.info("TICK", { note: "stub — wire stalled workflow detection + ESCALATION_TRIGGERED publishes" });
  }, 60_000);
  return () => clearInterval(t);
}
