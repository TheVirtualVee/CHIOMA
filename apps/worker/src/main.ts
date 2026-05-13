import { config } from "dotenv";
config();

import {
  createAppendOnlyLog,
  createAuthorityBus,
  createSupabaseEventLog,
  createSupabaseProjectionStore,
  createSupabaseConsumerStore,
  EventConsumerWorker,
  createConsoleLogger,
  metrics,
  lifecycle,
} from "@chioma/infrastructure";
import { registerCommitmentEngine } from "@chioma/commitment-engine";
import { registerContextCompiler } from "@chioma/context-compiler";
import { registerDeliveryService } from "@chioma/delivery-service";
import { registerEscalationService } from "@chioma/escalation-service";
import { registerIntentService } from "@chioma/intent-service";
import { registerLlmOrchestrator } from "@chioma/llm-orchestrator";
import { registerMemoryStore } from "@chioma/memory-store";
import { registerReliabilityEngine } from "@chioma/reliability-engine";
import { startCommitmentRecoveryWorker } from "@chioma/worker-commitment-recovery";
import { startEscalationLoopWorker } from "@chioma/worker-escalation-loop";
import { startMemoryCompactionWorker } from "@chioma/worker-memory-compaction";
import { validateSchemaIntegrity } from "./schema-validator.js";
import { validateRequiredEnv } from "./env-validator.js";

const logger = createConsoleLogger("worker-runtime");

// ─── Environment validation (hard gate) ───────────────────────────────────
const REQUIRED_ENV = [
  "DATABASE_URL",
  "LLM_PROVIDER",
  "LLM_API_KEY",
  "WHATSAPP_ACCESS_TOKEN",
  "WHATSAPP_PHONE_NUMBER_ID",
];

async function boot(): Promise<void> {
  logger.info("WORKER_BOOT_START", { pid: process.pid });

  const provider = process.env.LLM_PROVIDER ?? "openai";
  const required = [...REQUIRED_ENV];
  
  if (provider === "groq" && !process.env.LLM_API_KEY && process.env.GROQ_API_KEY) {
    required.splice(required.indexOf("LLM_API_KEY"), 1);
  } else if (provider === "groq" && !process.env.LLM_API_KEY) {
    required[required.indexOf("LLM_API_KEY")] = "GROQ_API_KEY";
  }

  const envResult = validateRequiredEnv(required);
  if (!envResult.valid) {
    logger.error("BOOT_FAILURE_ENV", { missing: envResult.missing });
    process.exit(1);
  }

  const DATABASE_URL = process.env.DATABASE_URL!;
  const TENANT_IDS = (process.env.CHIOMA_TENANT_IDS ?? "tenant_default").split(",").map(s => s.trim());
  const CONSUMER_GROUP = process.env.CONSUMER_GROUP ?? "chioma_core";
  const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS ?? "1000", 10);

  logger.info("SCHEMA_VALIDATION_START");
  const schemaResult = await validateSchemaIntegrity(DATABASE_URL);
  if (!schemaResult.valid) {
    logger.error("BOOT_FAILURE_SCHEMA", { issues: schemaResult.issues });
    process.exit(1);
  }
  logger.info("SCHEMA_VALIDATION_PASSED", { tables: schemaResult.tables });

  const localLog = createAppendOnlyLog();
  const projectionStore = createSupabaseProjectionStore(DATABASE_URL);
  const bus = createAuthorityBus(localLog, undefined, projectionStore);

  registerMemoryStore(bus);
  registerIntentService(bus);
  registerContextCompiler(bus);
  registerLlmOrchestrator(bus);
  registerCommitmentEngine(bus);
  registerReliabilityEngine(bus);
  registerDeliveryService(bus);
  registerEscalationService(bus);
  logger.info("SERVICE_HANDLERS_REGISTERED");

  const supabaseLog = createSupabaseEventLog(DATABASE_URL);
  const consumerStore = createSupabaseConsumerStore(DATABASE_URL);

  const workers = TENANT_IDS.map((tenantId) => {
    const worker = new EventConsumerWorker(
      supabaseLog as any,
      consumerStore,
      bus,
      CONSUMER_GROUP,
      [tenantId],
      POLL_INTERVAL_MS,
      30, 
    );
    worker.start();
    logger.info("CONSUMER_WORKER_STARTED", { tenantId, consumerGroup: CONSUMER_GROUP });
    return worker;
  });

  const stopRecovery = startCommitmentRecoveryWorker();
  const stopEscalation = startEscalationLoopWorker();
  const stopCompaction = startMemoryCompactionWorker();
  logger.info("BACKGROUND_WORKERS_STARTED");

  lifecycle.onShutdown(async () => {
    logger.info("GRACEFUL_SHUTDOWN_START");
    workers.forEach(w => w.stop());
    stopRecovery();
    stopEscalation();
    stopCompaction();
    logger.info("GRACEFUL_SHUTDOWN_COMPLETE");
  });

  lifecycle.setReady();
  const bootCorrelationId = `boot_${Date.now().toString(36)}`;
  // ASSERT: causationId is null for root boot events
  metrics.emit("worker_boot_complete", { 
    bootCorrelationId, 
    tenants: TENANT_IDS, 
    causationId: null,
    tenantId: "system",
    service: "worker-runtime"
  });

  logger.info("WORKER_BOOT_COMPLETE", {
    tenants: TENANT_IDS,
    consumerGroup: CONSUMER_GROUP,
    pollIntervalMs: POLL_INTERVAL_MS,
    correlationId: bootCorrelationId,
    causationId: null,
  });
}

boot().catch((err) => {
  const logger = createConsoleLogger("worker-boot");
  logger.error("BOOT_CRASH", { error: String(err) });
  process.exit(1);
});
