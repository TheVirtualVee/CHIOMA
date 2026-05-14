import { randomUUID } from "node:crypto";
import { validateConfig } from "../../../infrastructure/config/index.js";
import { createDatabaseClient, commitEvent } from "../../../infrastructure/database/index.js";
import { runStaffLoop } from "../../../core/staff-loop/index.js";

/**
 * api/simulate-message.ts
 *
 * Dev-only simulation endpoint.
 * Mimics WhatsApp ingress and returns bot response in the HTTP body.
 * UPDATED: Now uses the authoritative runStaffLoop.
 */

export default async function handler(req: any, res: any) {
  const start = Date.now();
  
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

    console.log("[SIMULATION] START", { tenantId: normalisedTenantId, from, text });

    const sql = createDatabaseClient(config.DATABASE_URL, { max: 1 });

    try {
      // 1. Commit Ingress Event (PENDING)
      await commitEvent(sql, {
        id: eventId,
        type: "MESSAGE_RECEIVED",
        payload: { channel: "simulation", from, text: text.trim(), waMessageId: messageId, simulated: true },
        tenantId: normalisedTenantId,
        correlationId,
        causationId,
      });

      console.log("[SIMULATION] CALLING_ATOMIC_STAFF_LOOP");
      const { runAtomicStaffLoop } = await import("../../../core/staff-loop/atomic-runner.js");

      // 2. Execute Atomic Staff Loop
      const result = await runAtomicStaffLoop(
        {
          messageId,
          tenantId: normalisedTenantId,
          senderPhone: from,
          messageText: text.trim(),
          correlationId,
          causationId,
          eventId,
          channel: "simulation",
        },
        sql,
        { apiKey: config.LLM_API_KEY, provider: config.LLM_PROVIDER }
      );

      console.log("[SIMULATION] SUCCESS", { responseType: result.responseType });

      return res.status(200).json({
        ok: true,
        correlationId,
        response: result.responseText,
        responseType: result.responseType,
        latencyMs: Date.now() - start,
      });

    } catch (err) {
      console.error("[SIMULATION] INNER_ERROR", err);
      // Even in simulation, we return 200 with an error object to prevent 500 leakage
      return res.status(200).json({ ok: false, error: "Simulation failed: " + String(err) });
    } finally {
      await sql.end();
    }

  } catch (err) {
    console.error("[SIMULATION] OUTER_ERROR", err);
    return res.status(200).json({ ok: false, error: "Ingress failed: " + String(err) });
  }
}
