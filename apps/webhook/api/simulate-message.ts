import { randomUUID } from "node:crypto";
import { validateConfig } from "../../../infrastructure/config/index.js";
import { createDatabaseClient, commitEvent } from "../../../infrastructure/database/index.js";
import { runAtomicStaffLoop } from "../../../core/staff-loop/atomic-runner.js";

/**
 * api/simulate-message.ts — Dev simulation endpoint.
 *
 * All imports STATIC — dynamic import of atomic-runner was causing silent
 * failures in Vercel's bundler (module not resolved at bundle time).
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
      // Ensure ledger row so atomic-runner can update it
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

      console.log("[SIMULATION] CALLING_ATOMIC_STAFF_LOOP");

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

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[SIMULATION] INNER_ERROR", msg);
      return res.status(200).json({ ok: false, error: msg });
    } finally {
      await sql.end();
    }

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[SIMULATION] OUTER_ERROR", msg);
    return res.status(200).json({ ok: false, error: msg });
  }
}
