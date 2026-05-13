import { createHmac, timingSafeEqual } from "node:crypto";
import { createEvent, EVENT_TYPES } from "@chioma/core";
import { createSupabaseEventLog, createConsoleLogger, createDatabaseClient } from "@chioma/infrastructure";
const logger = createConsoleLogger("webhook-handler");
function validateSignature(rawBody, signature, secret) {
    if (!signature?.startsWith("sha256="))
        return false;
    const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
    const received = signature.slice(7);
    if (expected.length !== received.length)
        return false;
    /** constraint: timing-safe comparison to prevent timing attacks */
    return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(received, "hex"));
}
function extractTextMessage(body) {
    const b = body;
    const entry = b.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const msg = value?.messages?.[0];
    if (!msg || msg.type !== "text")
        return null;
    const from = msg.from;
    const text = msg.text?.body;
    const waMessageId = msg.id;
    if (!from || !text || !waMessageId)
        return null;
    return { from, text, waMessageId };
}
function resolveTenantId(body) {
    const b = body;
    const phoneId = b.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id;
    return phoneId ? `tenant_${phoneId}` : "tenant_default";
}
/** contract: WhatsAppWebhookHandler */
export default async function handler(req) {
    const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;
    const APP_SECRET = process.env.WHATSAPP_APP_SECRET;
    const DATABASE_URL = process.env.DATABASE_URL;
    if (req.method === "GET") {
        const url = new URL(req.url);
        const mode = url.searchParams.get("hub.mode");
        const token = url.searchParams.get("hub.verify_token");
        const challenge = url.searchParams.get("hub.challenge");
        if (!VERIFY_TOKEN) {
            logger.error("BOOT_FAILURE", { reason: "WHATSAPP_VERIFY_TOKEN missing" });
            return new Response("Configuration error", { status: 500 });
        }
        if (mode === "subscribe" && token === VERIFY_TOKEN) {
            logger.info("WEBHOOK_VERIFIED", { mode });
            return new Response(challenge ?? "", { status: 200 });
        }
        return new Response("Forbidden", { status: 403 });
    }
    if (req.method === "POST") {
        if (!APP_SECRET || !DATABASE_URL) {
            logger.error("BOOT_FAILURE", { reason: "WHATSAPP_APP_SECRET or DATABASE_URL missing" });
            return new Response("Configuration error", { status: 500 });
        }
        const rawBody = await req.text();
        const signature = req.headers.get("x-hub-signature-256");
        if (!validateSignature(rawBody, signature, APP_SECRET)) {
            logger.warn("WEBHOOK_SIGNATURE_INVALID", { signature: signature?.slice(0, 16) });
            return new Response("Unauthorized", { status: 401 });
        }
        const processAsync = async () => {
            let body;
            try {
                body = JSON.parse(rawBody);
            }
            catch {
                logger.warn("WEBHOOK_PARSE_FAILED", { bodyLength: rawBody.length });
                return;
            }
            const message = extractTextMessage(body);
            if (!message)
                return;
            const tenantId = resolveTenantId(body);
            const event = createEvent(EVENT_TYPES.MESSAGE_RECEIVED, {
                channel: "whatsapp",
                from: message.from,
                text: message.text,
                waMessageId: message.waMessageId,
            }, tenantId);
            /** side-effect: Commit to append-only event log */
            const sql = await createDatabaseClient(DATABASE_URL, { max: 1 });
            try {
                const log = createSupabaseEventLog(sql);
                await log.append(event);
                logger.info("MESSAGE_RECEIVED_COMMITTED", {
                    eventId: event.id,
                    tenantId,
                    correlationId: event.correlationId,
                });
            }
            finally {
                await sql.end();
            }
        };
        processAsync().catch((err) => {
            logger.error("WEBHOOK_PROCESS_FAILED", { error: String(err) });
        });
        return new Response("OK", { status: 200 });
    }
    return new Response("Method Not Allowed", { status: 405 });
}
//# sourceMappingURL=webhook.js.map