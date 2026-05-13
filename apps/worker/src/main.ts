/**
 * apps/worker/src/main.ts — Render Worker Runtime Entrypoint
 *
 * INTENT: Boot the CHIOMA consumer worker runtime deterministically.
 * Validates schema, ECB, and env before accepting any events.
 * Runs long-lived polling loop. Gracefully shuts down on SIGTERM/SIGINT.
 *
 * Boot sequence:
 *   1. Validate required env
 *   2. Validate Supabase schema integrity (hard gate)
 *   3. Validate active ECB exists
 *   4. Register all service handlers on in-memory bus
 *   5. Start EventConsumerWorker (polls Supabase, dispatches to bus)
 *   6. Start background workers (escalation, recovery, compaction)
 *   7. Signal ready
 */

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

  // PHASE 1: env gate — fail fast before any I/O
  const envResult = validateRequiredEnv(REQUIRED_ENV);
  if (!envResult.valid) {
    logger.error("BOOT_FAILURE_ENV", { missing: envResult.missing });
    process.exit(1);
  }

  const DATABASE_URL = process.env.DATABASE_URL!;
  const TENANT_IDS = (process.env.CHIOMA_TENANT_IDS ?? "tenant_default").split(",").map(s => s.trim());
  const CONSUMER_GROUP = process.env.CONSUMER_GROUP ?? "chioma_core";
  const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS ?? "1000", 10);

  // PHASE 2: schema integrity gate — hard fail if DB not ready
  logger.info("SCHEMA_VALIDATION_START");
  const schemaResult = await validateSchemaIntegrity(DATABASE_URL);
  if (!schemaResult.valid) {
    logger.error("BOOT_FAILURE_SCHEMA", { issues: schemaResult.issues });
    process.exit(1);
  }
  logger.info("SCHEMA_VALIDATION_PASSED", { tables: schemaResult.tables });

  // PHASE 3: wire event infrastructure
  // In-memory bus for local dispatch within this worker process
  const localLog = createAppendOnlyLog();
  const projectionStore = createSupabaseProjectionStore(DATABASE_URL);
  const bus = createAuthorityBus(localLog, undefined, projectionStore);

  // PHASE 4: register all service handlers on local bus
  registerMemoryStore(bus);
  registerIntentService(bus);
  registerContextCompiler(bus);
  registerLlmOrchestrator(bus);
  registerCommitmentEngine(bus);
  registerReliabilityEngine(bus);
  registerDeliveryService(bus);
  registerEscalationService(bus);
  logger.info("SERVICE_HANDLERS_REGISTERED");

  // PHASE 5: start consumer worker — polls Supabase, dispatches to local bus
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
      30, // lease duration seconds
    );
    worker.start();
    logger.info("CONSUMER_WORKER_STARTED", { tenantId, consumerGroup: CONSUMER_GROUP });
    return worker;
  });

  // PHASE 6: start background workers
  const stopRecovery = startCommitmentRecoveryWorker();
  const stopEscalation = startEscalationLoopWorker();
  const stopCompaction = startMemoryCompactionWorker();
  logger.info("BACKGROUND_WORKERS_STARTED");

  // PHASE 7: register graceful shutdown
  lifecycle.onShutdown(async () => {
    logger.info("GRACEFUL_SHUTDOWN_START");
    workers.forEach(w => w.stop());
    stopRecovery();
    stopEscalation();
    stopCompaction();
    logger.info("GRACEFUL_SHUTDOWN_COMPLETE");
  });

  lifecycle.setReady();
  logger.info("WORKER_BOOT_COMPLETE", {
    tenants: TENANT_IDS,
    consumerGroup: CONSUMER_GROUP,
    pollIntervalMs: POLL_INTERVAL_MS,
  });
}

boot().catch((err) => {
  const logger = createConsoleLogger("worker-boot");
  logger.error("BOOT_CRASH", { error: String(err) });
  process.exit(1);
});
