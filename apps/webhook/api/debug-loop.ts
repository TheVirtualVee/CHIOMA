/**
 * api/debug-loop.ts — Internal execution trace endpoint.
 *
 * INTENT: Expose the full staff loop execution path without WhatsApp delivery.
 * Allows operators to inspect CHIOMA's cognition and decision chain.
 * Protected: requires CHIOMA_ADMIN_SECRET header.
 *
 * SIDE EFFECT: Supabase read + LLM call. Why: operator debugging only.
 */
import { validateConfig } from "../../../infrastructure/config/index.js";
import { createDatabaseClient } from "../../../infrastructure/database/index.js";
import { runAtomicStaffLoop } from "../../../core/staff-loop/atomic-runner.js";
import { randomUUID } from "node:crypto";

export default async function handler(req: any, res: any) {
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
    const start = Date.now();
    const result = await runAtomicStaffLoop(
      {
        messageId,
        tenantId,
        senderPhone: from,
        messageText: text,
        correlationId: `debug_corr_${messageId}`,
        causationId: eventId,
        eventId,
        channel: "simulation",
      },
      sql,
      { apiKey: config.LLM_API_KEY, provider: config.LLM_PROVIDER }
    );

    return res.status(200).json({
      ok: true,
      latencyMs: Date.now() - start,
      responseText: result.responseText,
      responseType: result.responseType,
      decision: result.decision ?? null,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) });
  } finally {
    await sql.end();
  }
}
