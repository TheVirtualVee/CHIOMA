import { createConsoleLogger } from "@chioma/infrastructure";

/** contract: MemoryCompactionWorker */
export function startMemoryCompactionWorker(): () => void {
  const logger = createConsoleLogger("worker.memory-compaction");
  const interval = setInterval(() => {
    logger.info("TICK", { operation: "ARCHIVE_COLD_MEMORY" });
  }, 3600_000);
  return () => clearInterval(interval);
}
