import { createDatabaseClient } from "../../infrastructure/database/index.js";
import { validateConfig } from "../../infrastructure/config/index.js";
import { TelemetryManager, createTraceContext } from "../../core/telemetry/index.js";
import { runAtomicStaffLoop } from "../../core/staff-loop/atomic-runner.js";

/**
 * tools/chaos-simulation/harness.ts
 */

interface ChaosScenario {
  name: string;
  steps: Array<{
    sender: string;
    text: string;
    delayMs?: number;
    expectedBehavior?: string;
  }>;
}

const SCENARIOS: ChaosScenario[] = [
  {
    name: "The Double-Clicker (Idempotency Stress)",
    steps: [
      { sender: "+2341", text: "How much is the blue lace?", expectedBehavior: "Pricing response" },
      { sender: "+2341", text: "How much is the blue lace?", expectedBehavior: "Idempotent ignore/repeat" },
      { sender: "+2341", text: "Hello??", expectedBehavior: "Consistent follow-up" }
    ]
  },
  {
    name: "The Pivot (Mixed Intent Resolution)",
    steps: [
      { sender: "+2342", text: "I want to buy 10 yards.", expectedBehavior: "Buy intent detection" },
      { sender: "+2342", text: "Actually, do you have hair extensions too?", expectedBehavior: "Context shift resolution" },
      { sender: "+2342", text: "Forget it, just give me the price for the 10 yards.", expectedBehavior: "State anchor recovery" }
    ]
  }
];

export async function runChaosSimulation() {
  const config = validateConfig();
  const sql = createDatabaseClient(config.DATABASE_URL, { max: 1 });
  const workerId = `worker_chaos_local`;
  
  console.log("🚀 STARTING CHIOMA CHAOS SIMULATION...");
  
  for (const scenario of SCENARIOS) {
    console.log(`\n--- SCENARIO: ${scenario.name} ---`);
    const tenantId = `tenant_chaos_${Date.now()}`;
    
    // Bootstrap
    const instanceId = `inst_chaos_${tenantId}`;
    await sql`INSERT INTO chioma_instances (instance_id, tenant_id, whatsapp_phone_number, whatsapp_phone_number_id, billing_state, credit_units, llm_provider, llm_model) 
              VALUES (${instanceId}, ${tenantId}, '12345', '12345', 'ACTIVE', 1000, 'groq', 'llama-3.3-70b-versatile') 
              ON CONFLICT DO NOTHING`;
    await sql`INSERT INTO employer_profiles (tenant_id, onboarding_status, tone_profile) VALUES (${tenantId}, 'COMPLETED', 'friendly-shopkeeper') ON CONFLICT DO NOTHING`;
    await sql`INSERT INTO business_facts (tenant_id, key, value) VALUES (${tenantId}, 'products', ${sql.json(['Blue Ankara Lace'])}) ON CONFLICT DO NOTHING`;

    for (const step of scenario.steps) {
      const trace = createTraceContext(workerId);
      const messageId = `msg_chaos_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const telemetry = new TelemetryManager(messageId, trace.traceId);

      const input = {
        messageId,
        tenantId,
        instanceId,
        senderPhone: step.sender,
        messageText: step.text,
        correlationId: `chaos_${Date.now()}`,
        eventId: `evt_chaos_${Date.now()}`,
        causationId: `evt_chaos_${Date.now()}`,
        channel: "simulation" as const,
        traceContext: trace,
        state: {
          identity: { tenantId, instanceId, isResolved: true, identityId: "ident_chaos" },
          intent: { active: true, lastUserNeed: null, currentGoal: null, mode: "CONTINUATION_ONLY" as const , toneState: "CALM", messageCount: 0},
          execution: { status: "READY" as const, reason: null, controllerTriggered: "mock", fingerprint: "mock" }
        }
      };

      try {
        const result = await runAtomicStaffLoop(input, sql, { 
          apiKey: config.LLM_API_KEY, 
          provider: config.LLM_PROVIDER,
          model: 'llama-3.3-70b-versatile'
        }, telemetry);
        telemetry.complete("COMPLETED");
        
        console.log(`[INPUT]: ${step.text}`);
        console.log(`[OUTPUT]: ${result.responseText}`);
        console.log(`[TRACE]: ${trace.traceId}`);
        
        if (step.delayMs) await new Promise(r => setTimeout(r, step.delayMs));
      } catch (err) {
        telemetry.record("CHAOS_STEP_FAILED", { error: String(err) });
        telemetry.complete("FAILED");
        console.error(`❌ CRASH IN STEP: ${step.text}`, err);
      }
    }
  }

  await sql.end();
  console.log("\n✅ CHAOS SIMULATION COMPLETE.");
}

runChaosSimulation().catch(console.error);
