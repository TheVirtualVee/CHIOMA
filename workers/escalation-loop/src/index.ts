import { createConsoleLogger } from "@chioma/infrastructure";

/** contract: EscalationLoopWorker */
export function startEscalationLoopWorker(): () => void {
  const logger = createConsoleLogger("worker.escalation-loop");
  const interval = setInterval(() => {
    logger.info("TICK", { operation: "SCAN_STALLED_WORKFLOWS" });
  }, 30_000);
  return () => clearInterval(interval);
}
