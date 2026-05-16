/**
 * core/adapters/telegram/index.ts
 *
 * TELEGRAM DELIVERY ADAPTER (TDA)
 *
 * Secondary delivery channel — additive only.
 * ExecutionKernel, StaffLoop, AtomicRunner: UNCHANGED.
 * DGL contract shape: UNCHANGED.
 *
 * Routing: DELIVERY_PROVIDER env var
 *   "telegram"  → this adapter
 *   "whatsapp"  → existing WhatsApp pipeline (untouched)
 *   (default)   → "telegram" for MVP mode
 *
 * SIDE EFFECT: Telegram Bot API POST.
 * Why necessary: delivers the staff response to the customer.
 */

const TELEGRAM_API_BASE = "https://api.telegram.org";
const SEND_TIMEOUT_MS = 8_000;

export type TelegramSendResult =
  | { ok: true; messageId: number; chatId: string }
  | { ok: false; error: string; retryable: boolean };

/**
 * Sends a text message via the Telegram Bot API.
 * Uses AbortController timeout — never hangs.
 *
 * @param botToken  - TELEGRAM_BOT_TOKEN env var
 * @param chatId    - Telegram chat_id (the customer's ID)
 * @param text      - message to send
 * @param traceId   - used for logging only
 */
export async function sendTelegramMessage(
  botToken: string,
  chatId: string,
  text: string,
  traceId: string
): Promise<TelegramSendResult> {
  if (!botToken) {
    return { ok: false, error: "TELEGRAM_BOT_TOKEN not set", retryable: false };
  }
  if (!chatId) {
    return { ok: false, error: "Missing chatId (recipient)", retryable: false };
  }
  if (!text?.trim()) {
    return { ok: false, error: "Empty message text", retryable: false };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);

  try {
    const url = `${TELEGRAM_API_BASE}/bot${botToken}/sendMessage`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: text.trim(),
        parse_mode: "HTML", // allows <b>bold</b> for product names etc.
      }),
      signal: controller.signal,
    });

    clearTimeout(timer);

    const data = await response.json() as {
      ok: boolean;
      result?: { message_id: number };
      error_code?: number;
      description?: string;
    };

    if (data.ok && data.result) {
      console.log(`[TDA] SEND_SUCCESS: trace=${traceId} chat=${chatId} msgId=${data.result.message_id}`);
      return { ok: true, messageId: data.result.message_id, chatId };
    }

    const retryable = (data.error_code ?? 0) >= 500;
    const error = `TELEGRAM_API_ERROR ${data.error_code}: ${data.description ?? "unknown"}`;
    console.error(`[TDA] SEND_FAILED: trace=${traceId} — ${error}`);
    return { ok: false, error, retryable };

  } catch (err: unknown) {
    clearTimeout(timer);
    const isTimeout = err instanceof Error && err.name === "AbortError";
    const msg = isTimeout ? "TELEGRAM_SEND_TIMEOUT (8s)" : String(err).slice(0, 100);
    console.error(`[TDA] SEND_ERROR: trace=${traceId} — ${msg}`);
    return { ok: false, error: msg, retryable: isTimeout };
  }
}

/**
 * Delivery confirmation hook.
 * Writes SEND_ATTEMPTED → SEND_CONFIRMED → DELIVERED to delivery_queue.
 * Mirrors the same states as the WhatsApp DGL.
 *
 * @param sql       - postgres client
 * @param traceId   - delivery_queue trace key
 * @param tenantId
 * @param instanceId
 * @param chatId    - Telegram chat_id
 * @param text      - message text for queue record
 * @param result    - outcome of sendTelegramMessage()
 */
export async function confirmTelegramDelivery(
  sql: any,
  traceId: string,
  tenantId: string,
  instanceId: string,
  chatId: string,
  text: string,
  result: TelegramSendResult
): Promise<void> {
  const status = result.ok ? "DELIVERED" : "FAILED";
  const lastError = result.ok ? null : result.error;

  try {
    await sql`
      INSERT INTO public.delivery_queue
        (trace_id, tenant_id, instance_id, recipient, payload_json, status,
         last_error, delivered_at)
      VALUES
        (${traceId}, ${tenantId}, ${instanceId}, ${chatId},
         ${sql.json({ channel: "telegram", to: chatId, text })},
         ${status}, ${lastError},
         ${result.ok ? sql`NOW()` : sql`NULL`})
      ON CONFLICT (trace_id) DO UPDATE SET
        status       = EXCLUDED.status,
        last_error   = EXCLUDED.last_error,
        delivered_at = EXCLUDED.delivered_at,
        updated_at   = NOW()
    `;
  } catch (dbErr: unknown) {
    // Non-fatal — delivery ledger write must never mask the actual send result
    console.error(`[TDA] LEDGER_WRITE_FAILED: ${String(dbErr).slice(0, 100)}`);
  }
}
