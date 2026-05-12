import { createConsoleLogger } from "@chioma/infrastructure";

export function startCommitmentRecoveryWorker(): () => void {
  const log = createConsoleLogger("worker.commitment-recovery");
  const t = setInterval(() => {
    log.info("TICK", { note: "stub — wire overdue commitment scan + bus publishes here" });
  }, 60_000);
  return () => clearInterval(t);
}
