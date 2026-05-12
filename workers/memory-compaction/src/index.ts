import { createConsoleLogger } from "@chioma/infrastructure";

export function startMemoryCompactionWorker(): () => void {
  const log = createConsoleLogger("worker.memory-compaction");
  const t = setInterval(() => {
    log.info("TICK", { note: "stub — wire cold tier compaction + MEMORY_UPDATED archival policy" });
  }, 60_000);
  return () => clearInterval(t);
}
