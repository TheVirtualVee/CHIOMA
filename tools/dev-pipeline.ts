import { createAppendOnlyLog, createAuthorityBus, createSupabaseEventLog, createSupabaseProjectionStore, createInMemoryProjectionStore, createSupabaseConsumerStore, EventConsumerWorker, createConsoleLogger, createMetrics } from "@chioma/infrastructure";
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

import dotenv from "dotenv";
dotenv.config();

const logger = createConsoleLogger("dev-pipeline");
const metrics = createMetrics("dev-pipeline");

async function main(): Promise<void> {
  const dbUrl = process.env.DATABASE_URL;
  const tenantId = "tenant_demo";
  
  /** contract: Event Source Authority Model Wiring */
  const log = dbUrl ? createSupabaseEventLog(dbUrl) : createAppendOnlyLog();
  const projectionStore = dbUrl ? createSupabaseProjectionStore(dbUrl) : createInMemoryProjectionStore();
  
  logger.info("BOOTSTRAP_AUTHORITY", { source: dbUrl ? "SUPABASE_CLOUD" : "LOCAL_VOLATILE" });
  
  const bus = createAuthorityBus(log, undefined, projectionStore);

  /** side-effect: Consumer Layer Initialization */
  let consumerWorker: EventConsumerWorker | null = null;
  if (dbUrl) {
    const consumerStore = createSupabaseConsumerStore(dbUrl);
    /** constraint: DB source required for worker */
    consumerWorker = new EventConsumerWorker(log as any, consumerStore, bus, "chioma_core_services", [tenantId], 1000);
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

  const types = log.all ? (await log.all()).map((e: any) => e.type) : ["REMOTE_EVENT_STREAM"];
  logger.info("EXECUTION_TRACE", { sequence: types });

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
