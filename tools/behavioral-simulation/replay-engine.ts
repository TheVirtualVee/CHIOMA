import { runAtomicStaffLoop } from "../../core/staff-loop/atomic-runner.js";
import { createDatabaseClient } from "../../infrastructure/database/index.js";
import { validateConfig } from "../../infrastructure/config/index.js";
import { TelemetryManager, createTraceContext } from "../../core/telemetry/index.js";
import { resolveInstanceByTenant } from "../../core/routing/instance-router.js";

/**
 * CHIOMA Behavioral Replay Engine
 * Phase 3.3 — Simulating real-world "Lagos-style" conversation patterns.
 */

interface BehavioralStep {
  sender: string;
  text: string;
  waitMs?: number;
}

const LAGOS_SPAM_PATTERN: BehavioralStep[] = [
  { sender: "+234_USER_1", text: "Hello??" },
  { sender: "+234_USER_1", text: "Are you there?? I want to buy hair", waitMs: 100 },
  { sender: "+234_USER_1", text: "Reply me now!", waitMs: 200 },
];

const PAYMENT_AMBIGUITY_PATTERN: BehavioralStep[] = [
  { sender: "+234_USER_2", text: "I have paid o. Check your account." },
  { sender: "+234_USER_2", text: "Send me the lace now." },
];

const UNCERTAINTY_PATTERNS: BehavioralStep[] = [
  { sender: "+234_USER_3", text: "I want the blue one. No wait, maybe red?" }, // Contradiction
  { sender: "+234_USER_3", text: "Actually, forget it. Or just send both.", waitMs: 100 },
  { sender: "+234_USER_4", text: "Your service is too slow! I'm reporting you!" }, // Emotional Drift
  { sender: "+234_USER_5", text: "How much?" }, // Ambiguity (Incomplete)
];


export async function runBehavioralSimulation() {
  const config = validateConfig();
  const sql = createDatabaseClient(config.DATABASE_URL, { max: 5 });
  const tenantId = `tenant_behavioral_${Date.now()}`;
  
  console.log(`🚀 STARTING BEHAVIORAL SIMULATION [Tenant: ${tenantId}]`);

  // Bootstrap Instance
  await sql`
    INSERT INTO chioma_instances (instance_id, tenant_id, whatsapp_phone_number, whatsapp_phone_number_id, billing_state, credit_units, llm_provider, llm_model)
    VALUES (${`inst_beh_${tenantId}`}, ${tenantId}, '12345', '12345', 'ACTIVE', 100, 'groq', 'llama-3.3-70b-versatile')
  `;
  await sql`INSERT INTO employer_profiles (tenant_id, onboarding_status, tone_profile) VALUES (${tenantId}, 'COMPLETED', 'friendly-shopkeeper')`;

  const patterns = [LAGOS_SPAM_PATTERN, PAYMENT_AMBIGUITY_PATTERN, UNCERTAINTY_PATTERNS];
  const traces: any[] = [];


  for (const pattern of patterns) {
    console.log(`\n--- Pattern Execution ---`);
    const instance = await resolveInstanceByTenant(sql, tenantId);
    if (!instance) {
      throw new Error(`SIMULATION_ERROR: No instance found for tenant ${tenantId}`);
    }

    // Run pattern steps in parallel to simulate real-world burst
    await Promise.all(pattern.map(async (step) => {
      if (step.waitMs) await new Promise(r => setTimeout(r, step.waitMs));

      const messageId = `beh_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;
      const trace = createTraceContext("behavioral_sim");
      const telemetry = new TelemetryManager(messageId, trace.traceId);

      console.log(`[SENDING]: ${step.text}`);
      try {
        const result = await runAtomicStaffLoop({
          messageId,
          tenantId,
          instanceId: instance.instance_id,
          senderPhone: step.sender,
          messageText: step.text,
          correlationId: `corr_beh_${messageId}`,
          causationId: messageId,
          eventId: `evt_beh_${messageId}`,
          channel: "simulation",
          traceContext: trace,
          instance
        }, sql, {
          apiKey: config.LLM_API_KEY,
          provider: instance.llm_config.provider,
          model: instance.llm_config.model
        }, telemetry);

        console.log(`[RESULT]: ${result.responseType} -> ${result.responseText.slice(0, 50)}...`);
      } catch (err: any) {
        console.error(`[CRASH]: ${err.message}`);
      }
    }));
  }

  // 🧠 FAILURE-MODE SELF-CORRECTION (Analysis)
  console.log(`\n--- Execution Governance Analysis ---`);
  const logs = await sql`
    SELECT outcome, controller_triggered, count(*) 
    FROM public.cea_execution_logs 
    WHERE tenant_id = ${tenantId}
    GROUP BY 1, 2
  `;
  console.table(logs);


  await sql.end();
  console.log("\n✅ BEHAVIORAL SIMULATION COMPLETE.");
}
