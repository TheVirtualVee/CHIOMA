import { validateConfig } from "@chioma/infrastructure/config/index.js";
import { createDatabaseClient } from "@chioma/infrastructure/database/index.js";
import { RuntimeEvent } from "../runtime/ingress/event-bus.js";
import { processEvent } from "../runtime/orchestrator.js";
import { randomUUID } from "node:crypto";
import { resolveTenantFromTelegram } from "../core/arbitration/engine.js";

// CRITICAL FIX: Do NOT use setImmediate() in Vercel serverless.
// Vercel terminates the process after res.json() — async work gets killed.
// Instead: complete all DB + LLM + Telegram work BEFORE sending 200.
// Telegram allows up to 60s for a response; this is within our maxDuration.

export default async function handler(req: any, res: any) {
  console.log("[ENTRYPOINT] BOOT", { method: req.method });

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  let config: any;
  try {
    config = validateConfig();
  } catch (err) {
    console.error("[ENTRYPOINT] CONFIG_INVALID:", String(err).slice(0, 100));
    return res.status(200).json({ ok: true }); // Always 200 to Telegram
  }

  // Validate webhook secret (skip in dev)
  const secretHeader = req.headers["x-telegram-bot-api-secret-token"];
  if (process.env.NODE_ENV === "production" && process.env.TELEGRAM_WEBHOOK_SECRET && secretHeader !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    console.warn("[ENTRYPOINT] INVALID_SECRET — rejected");
    return res.status(200).json({ ok: true }); // Still 200 so Telegram doesn't retry
  }

  const event = normalizeRequest(req.body);
  if (!event) {
    console.log("[ENTRYPOINT] NO_TEXT_MESSAGE: ignored");
    return res.status(200).json({ ok: true });
  }

  console.log("[ENTRYPOINT] EVENT_RECEIVED:", { chatId: event.channelChatId, msg: event.message?.slice(0, 40) });

  let sql: any;
  try {
    sql = createDatabaseClient(config.DATABASE_URL, { max: 1 });

    // Resolve tenant before processing
    if (event.tenantId === "PENDING_RESOLUTION") {
      const tenantId = await resolveTenantFromTelegram(sql, event.channelChatId, config.TELEGRAM_BOT_TOKEN ?? "");
      if (!tenantId) {
        console.error("[ENTRYPOINT] NO_TENANT for chat", event.channelChatId);
        await sql.end();
        return res.status(200).json({ ok: true });
      }
      event.tenantId = tenantId;
    }

    // Insert inbound event BEFORE processing
    await sql`
      INSERT INTO conversation_events (tenant_id, channel, channel_chat_id, channel_user_id, sender_actor, message)
      VALUES (${event.tenantId}, ${event.source}, ${event.channelChatId}, ${event.channelUserId}, 'customer', ${event.message})
      ON CONFLICT DO NOTHING
    `.catch((e: unknown) => console.warn("[ENTRYPOINT] EVENT_INSERT_WARN:", String(e).slice(0, 80)));

    // EXECUTE SYNCHRONOUSLY — Vercel kills setImmediate after res.send()
    await processEvent(sql, event, config);
    console.log("[ENTRYPOINT] PROCESS_COMPLETE for", event.channelChatId);

  } catch (err: unknown) {
    console.error("[ENTRYPOINT] FATAL:", String(err).slice(0, 200));
  } finally {
    await sql?.end().catch(() => {});
  }

  // Return 200 after processing — Telegram will have already received the reply
  return res.status(200).json({ ok: true });
}

function normalizeRequest(body: any): (RuntimeEvent & { tenantId: string }) | null {
  if (body?.message?.text && body?.message?.chat?.id) {
    return {
      id: `tg_${body.message.message_id ?? randomUUID()}`,
      tenantId: "PENDING_RESOLUTION",
      source: "telegram",
      channelChatId: String(body.message.chat.id),
      channelUserId: String(body.message.from?.id ?? body.message.chat.id),
      message: String(body.message.text).trim(),
      timestamp: Date.now(),
    };
  }
  return null;
}