import postgres from "postgres";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ── ENVIRONMENT SETUP ──────────────────────────────────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, "..", ".env");
const env = fs.readFileSync(envPath, "utf-8");
const databaseUrl = env.match(/DATABASE_URL=(.+)/)?.[1]?.replace(/"/g, "").trim();
const apiKey = env.match(/GROQ_API_KEY=(.+)/)?.[1]?.replace(/"/g, "").trim();
const provider = env.match(/LLM_PROVIDER=(.+)/)?.[1]?.replace(/"/g, "").trim();
const model = "llama-3.3-70b-versatile"; // Default for simulation

if (!databaseUrl || !apiKey) {
  console.error("Missing critical environment variables (DATABASE_URL or GROQ_API_KEY)");
  process.exit(1);
}

// Force DRY_RUN mode for safety
process.env.WHATSAPP_DRY_RUN = "true";
process.env.LLM_API_KEY = apiKey;
process.env.LLM_PROVIDER = provider;

const sql = postgres(databaseUrl, { ssl: "require" });

async function runTrustSimulation() {
  console.log("🛡️ STARTING FULL-FIDELITY TRUST SIMULATION HARNESS");
  
  const testTenant = "tenant_default";
  const testPhone = "simulation_user"; // Triggers Dry Run
  const aggregateId = `conv_${testPhone}`;

  try {
    // 🎭 STAGE 1: INGRESS COGNITION
    console.log("\n[STAGE 1] SIMULATING CUSTOMER INQUIRY...");
    const { runAtomicStaffLoop } = await import("../core/staff-loop/atomic-runner.js");
    const { TelemetryManager } = await import("../core/telemetry/index.js");

    const messageId = `msg_${randomUUID()}`;
    const telemetry = new TelemetryManager("TEST_HARNESS", `trace_${randomUUID()}`);
    
    // We prime the ledger
    await sql`INSERT INTO public.message_ledger (message_id, tenant_id, status) VALUES (${messageId}, ${testTenant}, 'RECEIVED')`;

    const { resolveInstanceByTenant } = await import("../core/routing/instance-router.js");
    const instance = await resolveInstanceByTenant(sql, testTenant);
    if (!instance) {
      throw new Error(`SIMULATION_ERROR: No instance found for tenant ${testTenant}`);
    }

    const initialInput: any = {
      messageId,
      tenantId: testTenant,
      instanceId: instance.instance_id,
      senderPhone: testPhone,
      messageText: "Hi! Can you tell me the price for a deluxe room? Also, I want to know if you have any available for this weekend.",
      correlationId: `corr_${messageId}`,
      causationId: messageId,
      eventId: `evt_${randomUUID()}`,
      channel: "whatsapp",
      instance,
    };

    const ingressResult = await runAtomicStaffLoop(initialInput, sql, { 
      apiKey: apiKey as string, 
      provider: instance.llm_config.provider,
      model: instance.llm_config.model
    }, telemetry);
    console.log(`✅ INGRESS COMPLETE. Response: "${ingressResult.responseText}"`);

    // 🎭 STAGE 2: COMMITMENT VERIFICATION
    console.log("\n[STAGE 2] VERIFYING COMMITMENT LEDGER...");
    const commitments = await sql`SELECT * FROM public.commitments WHERE aggregate_id = ${aggregateId} AND status = 'PENDING'`;
    
    if (commitments.length === 0) {
      console.warn("⚠️ No commitment was created. (This might happen if the LLM didn't tag a promise)");
      console.log("🔧 Injecting manual commitment for recovery loop validation...");
      await sql`
        INSERT INTO public.commitments (tenant_id, aggregate_id, type, status, deadline_at, correlation_id)
        VALUES (${testTenant}, ${aggregateId}, 'AVAILABILITY_LOOKUP', 'PENDING', NOW(), ${`test_corr_${randomUUID()}`})
      `;
    } else {
      const commitment = commitments[0];
      console.log(`✅ COMMITMENT CAPTURED: ${commitment.type} (ID: ${commitment.id})`);
    }

    // 🎭 STAGE 3: TEMPORAL AGING (Manual Overdue)
    console.log("\n[STAGE 3] AGING COMMITMENT TO OVERDUE STATUS...");
    const overdueDeadline = new Date();
    overdueDeadline.setMinutes(overdueDeadline.getMinutes() - 60);
    await sql`UPDATE public.commitments SET deadline_at = ${overdueDeadline.toISOString()} WHERE aggregate_id = ${aggregateId} AND status = 'PENDING'`;
    console.log("✅ COMMITMENT IS NOW OVERDUE.");

    // 🎭 STAGE 4: RECOVERY PULSE
    console.log("\n[STAGE 4] TRIGGERING RECOVERY WORKER...");
    const { processOverdueCommitments } = await import("../core/commitments/worker.js");
    const recoveryResult = await processOverdueCommitments(sql, { apiKey: apiKey as string, provider: provider as string });
    console.log(`✅ RECOVERY PULSE FINISHED. Processed: ${recoveryResult.processed}`);

    // 🎭 STAGE 5: FINAL VALIDATION
    console.log("\n[STAGE 5] FINAL FIDELITY CHECK...");
    const [finalState] = await sql`SELECT status, resolved_at FROM public.commitments WHERE aggregate_id = ${aggregateId} AND status = 'RESOLVED' ORDER BY resolved_at DESC LIMIT 1`;
    
    if (finalState && finalState.status === 'RESOLVED') {
      console.log("🏆 TRUST LOOP CLOSED SUCCESSFULLY.");
      console.log(`✨ Obligation Resolved at: ${finalState.resolved_at}`);
    } else {
      console.error(`❌ TRUST FAILURE: Commitment was not resolved correctly.`);
    }

  } catch (err) {
    console.error("💥 SIMULATION CRASHED:", err);
  } finally {
    // Cleanup
    await sql`DELETE FROM public.commitments WHERE aggregate_id = ${aggregateId}`;
    await sql`DELETE FROM public.message_ledger WHERE tenant_id = ${testTenant} AND message_id LIKE 'msg_%'`;
    await sql.end();
  }
}

runTrustSimulation();
