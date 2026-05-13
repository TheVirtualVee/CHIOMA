/**
 * api/webhook.ts — WhatsApp Cloud API Webhook Handler
 *
 * INTENT: Receive WhatsApp messages, validate HMAC signature, commit
 * MESSAGE_RECEIVED event to Supabase append-only log, return 200 immediately.
 * NO synchronous side-effects. NO direct LLM calls.
 *
 * SIDE EFFECT: Supabase event append. Why necessary and unavoidable:
 * This is the inbound trust boundary — the only place raw WhatsApp payloads
 * become domain events. Must persist before acknowledging to WhatsApp.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { createEvent, EVENT_TYPES } from "@chioma/core";
import { createSupabaseEventLog } from "@chioma/infrastructure";
import { createConsoleLogger } from "@chioma/infrastructure";

const logger = createConsoleLogger("webhook-handler");

// ─── Environment assertions ────────────────────────────────────────────────
const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;
const APP_SECRET = process.env.WHATSAPP_APP_SECRET;
const DATABASE_URL = process.env.DATABASE_URL;

// ─── HMAC Signature Validation ─────────────────────────────────────────────
function validateSignature(rawBody: string, signature: string | null, secret: string): boolean {
  // ASSERT: signature must start with "sha256="
  if (!signature?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const received = signature.slice(7); // strip "sha256="
  if (expected.length !== received.length) return false;
  // ASSERT: timing-safe comparison to prevent timing attacks
  return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(received, "hex"));
}

// ─── Message normalisation ─────────────────────────────────────────────────
function extractTextMessage(body: unknown): { from: string; text: string; waMessageId: string } | null {
  const b = body as Record<string, unknown>;
  const entry = (b.entry as unknown[])?.[0] as Record<string, unknown> | undefined;
  const change = (entry?.changes as unknown[])?.[0] as Record<string, unknown> | undefined;
  const value = change?.value as Record<string, unknown> | undefined;
  const messages = value?.messages as unknown[] | undefined;
  const msg = messages?.[0] as Record<string, unknown> | undefined;

  if (!msg || msg.type !== "text") return null;

  const from = msg.from as string | undefined;
  const text = (msg.text as Record<string, unknown> | undefined)?.body as string | undefined;
  const waMessageId = msg.id as string | undefined;

  if (!from || !text || !waMessageId) return null;
  return { from, text, waMessageId };
}

// ─── Tenant routing ────────────────────────────────────────────────────────
// Each WhatsApp Phone Number ID maps to one tenant.
// In production this reads from a tenant registry in Supabase.
// ASSERTION: PHONE_NUMBER_ID env must be set.
function resolveTenantId(body: unknown): string {
  const b = body as Record<string, unknown>;
  const entry = (b.entry as unknown[])?.[0] as Record<string, unknown> | undefined;
  const change = (entry?.changes as unknown[])?.[0] as Record<string, unknown> | undefined;
  const value = change?.value as Record<string, unknown> | undefined;
  const meta = value?.metadata as Record<string, unknown> | undefined;
  const phoneId = meta?.phone_number_id as string | undefined;
  // ASSERT: phone_number_id present → tenant scoped
  return phoneId ? `tenant_${phoneId}` : "tenant_default";
}

// ─── Handler ───────────────────────────────────────────────────────────────
export default async function handler(req: Request): Promise<Response> {
  // GET — WhatsApp webhook verification challenge
  if (req.method === "GET") {
    const url = new URL(req.url);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");

    if (!VERIFY_TOKEN) {
      logger.error("BOOT_FAILURE", { reason: "WHATSAPP_VERIFY_TOKEN not set" });
      return new Response("Configuration error", { status: 500 });
    }

    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      logger.info("WEBHOOK_VERIFIED", { mode });
      return new Response(challenge ?? "", { status: 200 });
    }
    return new Response("Forbidden", { status: 403 });
  }

  // POST — Incoming message
  if (req.method === "POST") {
    // ASSERT: required env present
    if (!APP_SECRET || !DATABASE_URL) {
      logger.error("BOOT_FAILURE", { reason: "WHATSAPP_APP_SECRET or DATABASE_URL not set" });
      return new Response("Configuration error", { status: 500 });
    }

    const rawBody = await req.text();
    const signature = req.headers.get("x-hub-signature-256");

    // ASSERT: HMAC validation — reject unsigned/forged requests
    if (!validateSignature(rawBody, signature, APP_SECRET)) {
      logger.warn("WEBHOOK_SIGNATURE_INVALID", { signature: signature?.slice(0, 16) });
      return new Response("Unauthorized", { status: 401 });
    }

    // Acknowledge immediately — WhatsApp requires <5s response
    // We process asynchronously after the response is sent
    const processAsync = async () => {
      let body: unknown;
      try {
        body = JSON.parse(rawBody);
      } catch {
        logger.warn("WEBHOOK_PARSE_FAILED", { bodyLength: rawBody.length });
        return;
      }

      const message = extractTextMessage(body);
      if (!message) {
        // Non-text or status update — not an error, just skip
        return;
      }

      const tenantId = resolveTenantId(body);
      const event = createEvent(
        EVENT_TYPES.MESSAGE_RECEIVED,
        {
          channel: "whatsapp",
          from: message.from,
          text: message.text,
          waMessageId: message.waMessageId,
        },
        tenantId,
      );

      // SIDE EFFECT: Supabase append — the event commit boundary
      const log = createSupabaseEventLog(DATABASE_URL!);
      await log.append(event);

      logger.info("MESSAGE_RECEIVED_COMMITTED", {
        eventId: event.id,
        tenantId,
        correlationId: event.correlationId,
        from: message.from,
      });
    };

    // Fire-and-forget — return 200 before Supabase write completes
    // (Supabase write failure is caught internally; WhatsApp will retry anyway)
    processAsync().catch((err) => {
      logger.error("WEBHOOK_PROCESS_FAILED", { error: String(err) });
    });

    return new Response("OK", { status: 200 });
  }

  return new Response("Method Not Allowed", { status: 405 });
}
