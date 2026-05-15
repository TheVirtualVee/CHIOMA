import { ExecutionKernel } from "../../core/kernel/execution-kernel.js";
import { createDatabaseClient } from "../../infrastructure/database/index.js";
import { validateConfig } from "../../infrastructure/config/index.js";
import { TelemetryManager, createTraceContext } from "../../core/telemetry/index.js";
import { resolveInstanceByTenant } from "../../core/routing/instance-router.js";

/**
 * CHIOMA Stress Harness
 * Phase 5 — Adaptive Load Simulation
 */

export async function runStressTest() {
  const config = validateConfig();
  const sql = createDatabaseClient(config.DATABASE_URL, { max: 10 });
  const tenantId = `tenant_stress_${Date.now()}`;
  
  console.log(`🔥 STARTING STRESS TEST [Tenant: ${tenantId}]`);

  // Bootstrap Instance
  await sql`
    INSERT INTO chioma_instances (instance_id, tenant_id, whatsapp_phone_number, whatsapp_phone_number_id, billing_state, credit_units, llm_provider, llm_model)
    VALUES (${`inst_stress_${tenantId}`}, ${tenantId}, '12345', '12345', 'ACTIVE', 1000, 'groq', 'llama-3.3-70b-versatile')
  `;
  await sql`INSERT INTO employer_profiles (tenant_id, onboarding_status, tone_profile) VALUES (${tenantId}, 'COMPLETED', 'friendly-shopkeeper')`;

  const instance = await resolveInstanceByTenant(sql, tenantId);
  if (!instance) throw new Error("Instance bootstrap failed");

  const CONCURRENT_MESSAGES = 60; // Slightly above initial 50 cap to trigger budget gate
  console.log(`\n--- Simulating ${CONCURRENT_MESSAGES} concurrent messages ---`);

  const results = await Promise.all(Array.from({ length: CONCURRENT_MESSAGES }).map(async (_, i) => {
    const messageId = `stress_${i}_${Date.now()}`;
    const trace = createTraceContext("stress_test");
    const telemetry = new TelemetryManager(messageId, trace.traceId);

    try {
      const result = await ExecutionKernel.execute({
        messageId,
        tenantId,
        instanceId: instance.instance_id,
        senderPhone: `+234_STRESS_${i}`,
        messageText: "Test message for load balancing",
        correlationId: `corr_stress_${messageId}`,
        causationId: messageId,
        eventId: `evt_stress_${messageId}`,
        channel: "simulation",
        traceContext: trace,
        instance
      }, sql, {
        apiKey: config.LLM_API_KEY,
        provider: instance.llm_config.provider,
        model: instance.llm_config.model
      }, telemetry);

      return result.responseType;
    } catch (err: any) {
      return "ERROR";
    }
  }));

  const stats = results.reduce((acc: any, type) => {
    acc[type] = (acc[type] || 0) + 1;
    return acc;
  }, {});

  console.log(`\n--- Stress Test Results ---`);
  console.table(stats);

  if (stats['error_degraded'] > 0) {
    console.log("✅ Budget Governor successfully throttled spike traffic.");
  }

  await sql.end();
}
