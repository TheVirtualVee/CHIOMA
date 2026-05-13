import {
  createAppendOnlyLog,
  createAuthorityBus,
  createSupabaseEventLog,
  createSupabaseProjectionStore,
  createInMemoryProjectionStore,
  createSupabaseConsumerStore,
  EventConsumerWorker,
  createConsoleLogger,
  createMetricsSink,
  createDatabaseClient,
} from "@chioma/infrastructure";
import { publishBusinessSynthesisProposal, registerBusinessSynthesisEngine } from "@chioma/business-synthesis-engine";
import { publishBusinessTrainingProposal, registerBusinessTrainingEngine } from "@chioma/business-training-engine";
import { registerCommitmentEngine } from "@chioma/commitment-engine";
import { registerContextCompiler } from "@chioma/context-compiler";
import { registerDeliveryService } from "@chioma/delivery-service";
import { registerEscalationService } from "@chioma/escalation-service";
import { createIngestionApi } from "@chioma/ingestion-service";
import { registerIntentService } from "@chioma/intent-service";
import { registerLlmOrchestrator } from "@chioma/llm-orchestrator";
import { registerMemoryStore } from "@chioma/memory-store";
import { registerReliabilityEngine } from "@chioma/reliability-engine";
import { startCommitmentRecoveryWorker } from "@chioma/worker-commitment-recovery";
import { startEscalationLoopWorker } from "@chioma/worker-escalation-loop";
import { startMemoryCompactionWorker } from "@chioma/worker-memory-compaction";
import type { AppendOnlyEventLog } from "@chioma/infrastructure";

import { config } from "dotenv";
config();

const logger = createConsoleLogger("dev-pipeline");
void createMetricsSink(); // metrics sink wired; suppress unused-var

async function main(): Promise<void> {
  const dbUrl = process.env.DATABASE_URL;
  const tenantId = "tenant_demo";

  let log: AppendOnlyEventLog;
  let projectionStore;

  if (dbUrl) {
    const sql = await createDatabaseClient(dbUrl);
    log = createSupabaseEventLog(sql) as unknown as AppendOnlyEventLog;
    projectionStore = createSupabaseProjectionStore(sql);
  } else {
    log = createAppendOnlyLog();
    projectionStore = createInMemoryProjectionStore();
  }

  logger.info("BOOTSTRAP_AUTHORITY", { source: dbUrl ? "SUPABASE_CLOUD" : "LOCAL_VOLATILE" });

  const bus = createAuthorityBus(log, undefined, projectionStore);

  /** side-effect: Consumer Layer Initialization */
  let consumerWorker: EventConsumerWorker | null = null;
  if (dbUrl) {
    const sql = await createDatabaseClient(dbUrl); // Re-use or share if possible, but for dev tool redundant init is fine or use same sql
    const consumerStore = createSupabaseConsumerStore(sql);
    consumerWorker = new EventConsumerWorker(
      createSupabaseEventLog(sql) as any,
      consumerStore,
      bus,
      "chioma_core_services",
      [tenantId],
      1000,
    );
    consumerWorker.start();
  }

  registerBusinessSynthesisEngine(bus);
  registerBusinessTrainingEngine(bus);
  registerMemoryStore(bus);
  registerIntentService(bus);
  registerContextCompiler(bus);
  registerLlmOrchestrator(bus);
  registerCommitmentEngine(bus);
  registerReliabilityEngine(bus);
  registerDeliveryService(bus);
  registerEscalationService(bus);

  const stopRecovery = startCommitmentRecoveryWorker();
  const stopEscalation = startEscalationLoopWorker();
  const stopCompaction = startMemoryCompactionWorker();

  const ingestion = createIngestionApi(bus);
  const correlationId = `corr_${Date.now().toString(36)}`;
  await ingestion.receiveWhatsAppText("Hello — I'd like to book next week.", correlationId, tenantId);

  await publishBusinessSynthesisProposal(bus, { correlationId, causationId: null, tenantId });
  await publishBusinessTrainingProposal(bus, { correlationId, causationId: null, tenantId });

  // .all() only on local in-memory log; guard for remote deployments
  if ("all" in log && typeof (log as AppendOnlyEventLog).all === "function") {
    const events = await (log as AppendOnlyEventLog).all();
    logger.info("EXECUTION_TRACE", { sequence: events.map((e) => e.type) });
  } else {
    logger.info("EXECUTION_TRACE", { sequence: ["REMOTE_EVENT_STREAM"] });
  }

  stopRecovery();
  stopEscalation();
  stopCompaction();
  if (consumerWorker) {
    consumerWorker.stop();
  }
}

main().catch((err) => {
  logger.error("PIPELINE_CRASH", { error: String(err) });
  process.exitCode = 1;
});
