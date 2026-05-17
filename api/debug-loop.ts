import { validateConfig } from "@chioma/infrastructure/config/index.js";
import { createDatabaseClient } from "@chioma/infrastructure/database/index.js";
import { runAtomicStaffLoop } from "@chioma/core/staff-loop/atomic-runner.js";
import { TelemetryManager, createTraceContext } from "@chioma/core/telemetry/index.js";
import { randomUUID } from "node:crypto";
import { resolveInstanceByTenant } from "@chioma/core/routing/instance-router.js";

export default async function handler(req: any, res: any) {
  // P0: Admin gate — this endpoint is NOT for production customer traffic
  const adminKey = process.env.CHIOMA_ADMIN_KEY;
  const providedKey = req.headers["x-admin-key"] as string | undefined;
  if (!adminKey || providedKey !== adminKey) {
    return res.status(401).json({ error: "Unauthorized: debug-loop requires x-admin-key header" });
  }

  const workerId = `worker_debug_${process.env.VERCEL_REGION || "local"}`;
  const trace = createTraceContext(workerId);

  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const adminSecret = process.env.CHIOMA_ADMIN_SECRET;
  if (!adminSecret || req.headers["x-admin-secret"] !== adminSecret) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  let config;
  try {
    config = validateConfig();
  } catch {
    return res.status(500).json({ error: "Configuration incomplete" });
  }

  const { tenantId, from, text } = req.body ?? {};
  if (!tenantId || !from || !text) {
    return res.status(400).json({ error: "Required: tenantId, from, text" });
  }

  const messageId = `debug_${Date.now()}`;
  const eventId = randomUUID();
  const sql = createDatabaseClient(config.DATABASE_URL, { max: 1 });

  const telemetry = new TelemetryManager(messageId, trace.traceId);
  telemetry.record("DEBUG_LOOP_STARTED", { tenantId, from, traceId: trace.traceId });

  // Ensure ledger row exists for atomic runner
  try {
    await sql`
      INSERT INTO message_ledger (message_id, tenant_id, status)
      VALUES (${messageId}, ${tenantId}, 'RECEIVED')
      ON CONFLICT (message_id) DO NOTHING
    `;
  } catch (err) {
    await sql.end();
    return res.status(500).json({ error: `Ledger init failed: ${String(err)}` });
  }

  try {
    const instance = await resolveInstanceByTenant(sql, tenantId);
    if (!instance) {
      throw new Error(`DEBUG_ERROR: No instance found for tenant ${tenantId}`);
    }

    const result = await runAtomicStaffLoop(
      {
        messageId,
        tenantId,
        instanceId: instance.instance_id,
        senderPhone: from,
        messageText: text,
        correlationId: `debug_corr_${messageId}`,
        causationId: eventId,
        eventId,
        channel: "simulation",
        traceContext: trace,
        instance,
        state: {
          identity: { tenantId, instanceId: "debug_instance", isResolved: true, identityId: "ident_debug" },
          intent: { active: true, mode: "CONTINUATION_ONLY", currentGoal: "Debug Loop", lastUserNeed: null , toneState: "CALM", messageCount: 0},
          execution: { status: "READY", reason: null, controllerTriggered: "debug", fingerprint: "debug" }
        }
      },
      sql,
      { 
        apiKey: config.LLM_API_KEY, 
        provider: instance.llm_config.provider,
        model: instance.llm_config.model
      },
      telemetry
    );

    telemetry.complete("COMPLETED");

    return res.status(200).json({
      ok: true,
      traceId: trace.traceId,
      timeline: telemetry.getTimeline(),
      responseText: result.responseText,
      responseType: result.responseType,
      decision: result.decision ?? null,
    });
  } catch (err) {
    telemetry.record("DEBUG_LOOP_FAILED", { error: String(err) });
    telemetry.complete("FAILED");
    return res.status(500).json({ ok: false, error: String(err), timeline: telemetry.getTimeline() });
  } finally {
    await sql.end();
  }
}
