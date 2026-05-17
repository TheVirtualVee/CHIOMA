import { randomUUID } from "node:crypto";
import { validateConfig } from "@chioma/infrastructure/config/index.js";
import { createDatabaseClient, commitEvent } from "@chioma/infrastructure/database/index.js";
import { runAtomicStaffLoop } from "@chioma/core/staff-loop/atomic-runner.js";
import { TelemetryManager, createTraceContext } from "@chioma/core/telemetry/index.js";
import { resolveInstanceByTenant } from "@chioma/core/routing/instance-router.js";

/**
 * api/simulate-message.ts — Dev simulation endpoint.
 */

export default async function handler(req: any, res: any) {
  // P0: Admin gate — this endpoint is NOT for production customer traffic
  const adminKey = process.env.CHIOMA_ADMIN_KEY;
  const providedKey = req.headers["x-admin-key"] as string | undefined;
  if (!adminKey || providedKey !== adminKey) {
    return res.status(401).json({ error: "Unauthorized: simulate-message requires x-admin-key header" });
  }

  const workerId = `worker_sim_${process.env.VERCEL_REGION || "local"}`;
  const trace = createTraceContext(workerId);
  
  try {
    const config = validateConfig();

    if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

    const { tenantId, from, text } = req.body ?? {};
    if (!tenantId || !from || !text) return res.status(400).json({ error: "Missing required fields" });

    const normalisedTenantId = tenantId.startsWith("tenant_") ? tenantId : `tenant_${tenantId}`;
    const messageId = `sim_${Date.now()}`;
    const eventId = randomUUID();
    const correlationId = `corr_${messageId}`;
    const causationId = `root_${eventId}`;

    const telemetry = new TelemetryManager(messageId, trace.traceId);
    telemetry.record("SIMULATION_STARTED", { tenantId: normalisedTenantId, from, traceId: trace.traceId });

    const sql = createDatabaseClient(config.DATABASE_URL, { max: 1 });

    try {
      // Ensure ledger row
      await sql`
        INSERT INTO message_ledger (message_id, tenant_id, status)
        VALUES (${messageId}, ${normalisedTenantId}, 'RECEIVED')
        ON CONFLICT (message_id) DO NOTHING
      `;

      await commitEvent(sql, {
        id: eventId,
        type: "MESSAGE_RECEIVED",
        payload: { channel: "simulation", from, text: text.trim(), waMessageId: messageId, simulated: true },
        tenantId: normalisedTenantId,
        correlationId,
        causationId,
      });

      telemetry.record("LEDGER_WRITTEN", { status: "INSERTED" });

      const instance = await resolveInstanceByTenant(sql, normalisedTenantId);
      if (!instance) {
        throw new Error(`SIMULATION_ERROR: No instance found for tenant ${normalisedTenantId}`);
      }

      const result = await runAtomicStaffLoop(
        {
          messageId,
          tenantId: normalisedTenantId,
          instanceId: instance.instance_id,
          senderPhone: from,
          messageText: text.trim(),
          correlationId,
          causationId,
          eventId,
          channel: "simulation",
          traceContext: trace,
          instance,
          state: {
            identity: { tenantId: tenantId as string, instanceId: "sim_instance", isResolved: true, identityId: "ident_sim" },
            intent: { active: true, mode: "CONTINUATION_ONLY", currentGoal: "Simulation", lastUserNeed: null , toneState: "CALM", messageCount: 0},
            execution: { status: "READY", reason: null, controllerTriggered: "simulation", fingerprint: "simulation" }
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
        correlationId,
        response: result.responseText,
        responseType: result.responseType,
        traceId: trace.traceId,
      });

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      telemetry.record("SIMULATION_FAILED", { error: msg });
      telemetry.complete("FAILED");
      return res.status(200).json({ ok: false, error: msg });
    } finally {
      await sql.end();
    }

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(200).json({ ok: false, error: msg });
  }
}
