import { validateConfig } from "@chioma/infrastructure/config/index.js";
import { createDatabaseClient } from "@chioma/infrastructure/database/index.js";
import { RuntimeEvent } from "../runtime/ingress/event-bus.js";
import { processEvent } from "../runtime/orchestrator.js";
import { randomUUID } from "node:crypto";
import { resolveTenantFromTelegram } from "../core/arbitration/engine.js";

export default async function handler(req: any, res: any) {
  res.status(200).json({ ok: true });

  const config = validateConfig();

  // Validate webhook secret
  const secretHeader = req.headers['x-telegram-bot-api-secret-token'];
  if (process.env.NODE_ENV === 'production' && secretHeader !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    console.warn("[ENTRYPOINT] INVALID_SECRET from", req.headers['x-forwarded-for']);
    return res.status(200).json({ ok: true });
  }

  const event = await normalizeRequest(req.body);
  if (!event) return;

  setImmediate(async () => {
    let sql: any;
    try {
      sql = createDatabaseClient(config.DATABASE_URL, { max: 1 });
      
      // Complete tenant resolution
      if (event.tenantId === 'PENDING_RESOLUTION') {
        const tenantId = await resolveTenantFromTelegram(sql, event.channelChatId, config.TELEGRAM_BOT_TOKEN ?? "");
        if (!tenantId) {
          console.error(`[ENTRYPOINT] No tenant found for chat ${event.channelChatId}`);
          return;
        }
        event.tenantId = tenantId;
      }

      await sql`
        INSERT INTO conversation_events (tenant_id, channel, channel_chat_id, channel_user_id, sender_actor, message)
        VALUES (${event.tenantId}, ${event.source}, ${event.channelChatId}, ${event.channelUserId}, 'customer', ${event.message})
      `;

      await processEvent(sql, event, config);
    } catch (err) {
      console.error(`[ENTRYPOINT] Fatal kernel error:`, err);
    } finally {
      await sql?.end().catch(() => {});
    }
  });
}

async function normalizeRequest(body: any): Promise<RuntimeEvent | null> {
  // Simple Telegram normalization
  if (body?.message?.text && body?.message?.chat?.id) {
    return {
      id: `tg_${body.message.message_id || randomUUID()}`,
      tenantId: 'PENDING_RESOLUTION',
      source: 'telegram',
      channelChatId: String(body.message.chat.id),
      channelUserId: String(body.message.from.id),
      message: body.message.text.trim(),
      timestamp: Date.now()
    };
  }
  return null;
}
