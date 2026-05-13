import { createHmac, timingSafeEqual } from "node:crypto";

/** 
 * INLINED INFRASTRUCTURE (Bypassing Workspace Resolution for Ingress Stability) 
 */

const logger = {
  info: (msg: string, ctx?: any) => console.log(JSON.stringify({ severity: "INFO", message: msg, ...ctx })),
  warn: (msg: string, ctx?: any) => console.log(JSON.stringify({ severity: "WARN", message: msg, ...ctx })),
  error: (msg: string, ctx?: any) => console.log(JSON.stringify({ severity: "ERROR", message: msg, ...ctx })),
};

function createEvent(type: string, payload: any, tenantId: string) {
  return {
    id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    type,
    payload,
    tenantId,
    correlationId: `corr_${Date.now()}`,
    createdAt: new Date().toISOString(),
    version: "1.1",
    metadata: {},
  };
}

function validateSignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const received = signature.slice(7);
  if (expected.length !== received.length) return false;
  return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(received, "hex"));
}

function extractTextMessage(body: any): { from: string; text: string; waMessageId: string } | null {
  const entry = body.entry?.[0];
  const change = entry?.changes?.[0];
  const value = change?.value;
  const msg = value?.messages?.[0];

  if (!msg || msg.type !== "text") return null;

  const from = msg.from;
  const text = msg.text?.body;
  const waMessageId = msg.id;

  if (!from || !text || !waMessageId) return null;
  return { from, text, waMessageId };
}

function resolveTenantId(body: any): string {
  const phoneId = body.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id;
  return phoneId ? `tenant_${phoneId}` : "tenant_default";
}

/** 
 * WEBOOK HANDLER (Hardened Ingress)
 */
export default async function handler(req: any, res: any) {
  try {
    const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;
    const APP_SECRET = process.env.WHATSAPP_APP_SECRET;
    const DATABASE_URL = process.env.DATABASE_URL;

    if (req.method === "GET") {
      const mode = req.query["hub.mode"];
      const token = req.query["hub.verify_token"];
      const challenge = req.query["hub.challenge"];

      if (!VERIFY_TOKEN) {
        logger.error("BOOT_FAILURE", { reason: "WHATSAPP_VERIFY_TOKEN missing" });
        return res.status(500).send("Configuration error");
      }

      if (mode === "subscribe" && token === VERIFY_TOKEN) {
        logger.info("WEBHOOK_VERIFIED", { mode });
        return res.status(200).send(challenge ?? "");
      }
      return res.status(403).send("Forbidden");
    }

    if (req.method === "POST") {
      if (!APP_SECRET || !DATABASE_URL) {
        logger.error("BOOT_FAILURE", { reason: "WHATSAPP_APP_SECRET or DATABASE_URL missing" });
        return res.status(500).send("Configuration error");
      }

      const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
      const signature = req.headers["x-hub-signature-256"];

      if (!validateSignature(rawBody, signature, APP_SECRET)) {
        logger.warn("WEBHOOK_SIGNATURE_INVALID", { signature: signature?.slice(0, 16) });
        return res.status(401).send("Unauthorized");
      }

      const body = req.body;
      const message = extractTextMessage(body);
      
      if (message) {
        const tenantId = resolveTenantId(body);
        const event = createEvent("MESSAGE_RECEIVED", {
          channel: "whatsapp",
          from: message.from,
          text: message.text,
          waMessageId: message.waMessageId,
        }, tenantId);

        // Dynamic import of postgres to avoid top-level resolution issues in some runtimes
        const { default: postgres } = await import("postgres");
        const sql = postgres(DATABASE_URL, { max: 1, ssl: "require" });
        
        try {
          // Direct SQL insert for maximum stability during isolation
          await sql`
            INSERT INTO core.events (id, type, payload, tenant_id, correlation_id, created_at, version, metadata)
            VALUES (${event.id}, ${event.type}, ${sql.json(event.payload)}, ${event.tenantId}, ${event.correlationId}, ${event.createdAt}, ${event.version}, ${sql.json(event.metadata)})
          `;

          logger.info("MESSAGE_RECEIVED_COMMITTED", {
            eventId: event.id,
            tenantId,
            correlationId: event.correlationId,
          });
        } finally {
          await sql.end();
        }
      }

      return res.status(200).send("OK");
    }

    return res.status(405).send("Method Not Allowed");
  } catch (err: any) {
    console.error("WEBHOOK_HANDLER_CRASH", err);
    return res.status(500).json({ error: String(err), stack: err.stack });
  }
}
