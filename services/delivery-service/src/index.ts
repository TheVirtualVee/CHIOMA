/**
 * delivery-service/src/index.ts
 *
 * INTENT: Listen for LLM_COMPLETED events, send the response via WhatsApp
 * Cloud API with retry, then emit RESPONSE_SENT + EXECUTION_COMPLETED events.
 *
 * SIDE EFFECT: WhatsApp HTTP call. Why necessary and unavoidable:
 * This is the only surface where domain events become external messages.
 * Retry policy ensures delivery without duplicating commitment state.
 *
 * Invariant: side-effect never mutates event log state. Only emits audit events.
 */

import { EVENT_TYPES, type EventBus, type LlmStructuredOutput } from "@chioma/core";
import { createConsoleLogger, devEvent, metrics } from "@chioma/infrastructure";

const WHATSAPP_API_VERSION = "v17.0";
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;
const SEND_TIMEOUT_MS = 8000;

/** contract: WhatsAppSendResult */
type SendResult =
  | { ok: true; waMessageId: string }
  | { ok: false; error: string; retryable: boolean };

/**
 * Send a WhatsApp text message with retry.
 * SIDE EFFECT: external HTTP call to Meta Graph API.
 */
async function sendWhatsAppMessage(
  phoneNumberId: string,
  accessToken: string,
  to: string,
  text: string,
  logger: ReturnType<typeof createConsoleLogger>,
): Promise<SendResult> {
  const url = `https://graph.facebook.com/${WHATSAPP_API_VERSION}/${phoneNumberId}/messages`;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    // ASSERT: timeout enforced — hung Meta API must not stall the execution chain
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to,
          type: "text",
          text: { body: text, preview_url: false },
        }),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (response.ok) {
        const data = await response.json() as { messages?: Array<{ id: string }> };
        return { ok: true, waMessageId: data.messages?.[0]?.id ?? "unknown" };
      }

      const errBody = await response.json().catch(() => ({}));
      const retryable = response.status >= 500 || response.status === 429;

      logger.warn("WHATSAPP_SEND_FAILED", {
        attempt,
        status: response.status,
        retryable,
        error: JSON.stringify(errBody),
      });

      if (!retryable || attempt === MAX_RETRIES) {
        return { ok: false, error: `HTTP_${response.status}: ${JSON.stringify(errBody)}`, retryable };
      }

    } catch (err) {
      clearTimeout(timer);
      const isAbort = err instanceof Error && err.name === "AbortError";
      const msg = isAbort ? "SEND_TIMEOUT" : String(err);
      logger.warn("WHATSAPP_SEND_ERROR", { attempt, error: msg });

      if (attempt === MAX_RETRIES) {
        return { ok: false, error: msg, retryable: isAbort };
      }
    }

    // Exponential backoff between retries
    await new Promise(r => setTimeout(r, RETRY_DELAY_MS * attempt));
  }

  return { ok: false, error: "MAX_RETRIES_EXHAUSTED", retryable: false };
}

/** contract: DeliveryService */
export function registerDeliveryService(bus: EventBus): void {
  const logger = createConsoleLogger("delivery-service");

  // Resolve WhatsApp config from env at handler registration time.
  // ASSERT: If missing, log and skip send — do NOT throw (would crash the worker loop).
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;

  if (!phoneNumberId || !accessToken) {
    logger.warn("DELIVERY_CONFIG_MISSING", {
      reason: "WHATSAPP_PHONE_NUMBER_ID or WHATSAPP_ACCESS_TOKEN not set — delivery will log only",
    });
  }

  bus.subscribe(EVENT_TYPES.MEMORY_UPDATED, async (event) => {
    const payload = event.payload as { kind?: string; structured?: LlmStructuredOutput; recipientPhone?: string } | null;
    if (payload?.kind !== "LLM_COMPLETED" || !payload.structured) return;

    const { tenantId, correlationId, id: causationId } = event;
    const responseText = payload.structured.response;
    // recipientPhone: set by ingestion service when normalising the inbound message
    const recipientPhone = payload.recipientPhone;

    logger.info("DELIVERY_ATTEMPT", { correlationId, tenantId, hasPhone: !!recipientPhone });
    metrics.emit("delivery_attempt", { correlationId, tenantId, service: "delivery-service" });

    let deliveryStatus: "SENT" | "FAILED" | "SKIPPED" = "SKIPPED";
    let waMessageId: string | undefined;
    let deliveryError: string | undefined;

    // SIDE EFFECT: WhatsApp Cloud API call
    if (phoneNumberId && accessToken && recipientPhone) {
      const result = await sendWhatsAppMessage(
        phoneNumberId,
        accessToken,
        recipientPhone,
        responseText,
        logger,
      );

      if (result.ok) {
        deliveryStatus = "SENT";
        waMessageId = result.waMessageId;
        metrics.emit("delivery_sent", { correlationId, tenantId, service: "delivery-service" });
        logger.info("DELIVERY_SENT", { correlationId, tenantId, waMessageId });
      } else {
        deliveryStatus = "FAILED";
        deliveryError = result.error;
        metrics.emit("delivery_failed", { correlationId, tenantId, service: "delivery-service" });
        logger.error("DELIVERY_FAILED", { correlationId, tenantId, error: result.error });
      }
    } else {
      logger.warn("DELIVERY_SKIPPED", {
        correlationId,
        reason: !recipientPhone ? "no_recipient_phone" : "no_whatsapp_config",
      });
    }

    // Emit RESPONSE_SENT regardless of delivery status — audit trail is always written
    await bus.publish(
      devEvent(
        `del_${event.id}`,
        EVENT_TYPES.RESPONSE_SENT,
        {
          channel: "whatsapp",
          text: responseText,
          deliveryStatus,
          waMessageId,
          deliveryError,
        },
        correlationId,
        causationId,
        tenantId,
      ),
    );

    await bus.publish(
      devEvent(
        `done_${event.id}`,
        EVENT_TYPES.EXECUTION_COMPLETED,
        {
          service: "delivery-service",
          action: "MESSAGE_SENT",
          deliveryStatus,
        },
        correlationId,
        event.id,
        tenantId,
      ),
    );
  });
}
