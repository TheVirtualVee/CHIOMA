import { createAppendOnlyLog, createBus } from "@chioma/infrastructure";
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

async function main(): Promise<void> {
  const log = createAppendOnlyLog();
  const bus = createBus(log);

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
  const tenantId = "tenant_demo";
  await ingestion.receiveWhatsAppText("Hello — I'd like to book next week.", correlationId, tenantId);

  await publishBusinessSynthesisProposal(bus, { correlationId, causationId: null, tenantId });
  await publishBusinessTrainingProposal(bus, { correlationId, causationId: null, tenantId });

  const types = log.all().map((e) => e.type);
  // SIDE EFFECT: stdout for local smoke test. Why necessary and unavoidable: dev-pipeline has no other sink in scaffold.
  console.log("CHIOMA dev pipeline — event sequence:", types.join(" → "));

  stopRecovery();
  stopEscalation();
  stopCompaction();
}
main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
