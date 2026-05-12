import { createConsoleLogger } from "@chioma/infrastructure";

/** contract: CommitmentRecoveryWorker */
export function startCommitmentRecoveryWorker(): () => void {
  const logger = createConsoleLogger("worker.commitment-recovery");
  const interval = setInterval(() => {
    logger.info("TICK", { operation: "SCAN_OVERDUE_COMMITMENTS" });
  }, 60_000);
  return () => clearInterval(interval);
}
