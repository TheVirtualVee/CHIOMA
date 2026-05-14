import { randomUUID, createHmac, timingSafeEqual } from "node:crypto";
import { validateConfig } from "../../../infrastructure/config/index.js";
import { createDatabaseClient, commitEvent } from "../../../infrastructure/database/index.js";

export default async function handler(req: any, res: any) {
  const start = Date.now();
  const l = (m: string) => console.error(`[WEBHOOK] [${Date.now() - start}ms] ${m}`);

  l("REQUEST_RECEIVED");

  if (req.method === "GET") {
    const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;
    if (req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === verifyToken) {
      return res.status(200).send(req.query["hub.challenge"]);
    }
    return res.status(403).send("Forbidden");
  }

  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const config = validateConfig();
    const signature = req.headers["x-hub-signature-256"] as string;
    const rawBody = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
    
    if (!validateSignature(rawBody, signature, config.WHATSAPP_APP_SECRET || "")) {
      l("INVALID_SIGNATURE");
      return res.status(401).json({ error: "Invalid signature" });
    }

    const entry = req.body?.entry?.[0];
    const value = entry?.changes?.[0]?.value;
    const messages = value?.messages;

    if (!messages || messages.length === 0) {
      return res.status(200).json({ ok: true, ignored: true });
    }

    const message = messages[0];
    const from = message.from;
    const text = message.text?.body || "";
    const messageId = message.id;

    l("IDEMPOTENCY_INIT: " + messageId);

    const tenantId = `tenant_${value.metadata?.phone_number_id || "default"}`;
    const correlationId = `corr_${messageId}`;

    const sql = createDatabaseClient(config.DATABASE_URL, { max: 1 });

    try {
      const [existing] = await sql`SELECT status, updated_at FROM message_ledger WHERE message_id = ${messageId}`;

      if (existing) {
        if (existing.status === "COMPLETED") {
          l("LEDGER_BLOCK: COMPLETED");
          return res.status(200).json({ ok: true, duplicate: true });
        }
        
        const lastUpdate = new Date(existing.updated_at).getTime();
        if (existing.status === "PROCESSING" && (Date.now() - lastUpdate < 30000)) {
          l("LEDGER_BLOCK: IN_PROGRESS");
          return res.status(200).json({ ok: true, retry_ignored: true });
        }
        
        await sql`UPDATE message_ledger SET status = 'PROCESSING', updated_at = NOW() WHERE message_id = ${messageId}`;
      } else {
        await sql`INSERT INTO message_ledger (message_id, tenant_id, status) VALUES (${messageId}, ${tenantId}, 'RECEIVED')`;
      }
      l("LEDGER_LOCKED");

      const eventId = randomUUID();
      const staffLoopInput = { 
        messageId,
        tenantId, 
        senderPhone: from, 
        messageText: text, 
        correlationId, 
        causationId: eventId, 
        eventId, 
        channel: "whatsapp" as const 
      };

      l("INVOKING_ATOMIC_STAFF_LOOP");
      
      const { runAtomicStaffLoop } = await import("../../../core/staff-loop/atomic-runner.js");
      const result = await runAtomicStaffLoop(staffLoopInput, sql, { 
        apiKey: config.LLM_API_KEY, 
        provider: config.LLM_PROVIDER 
      });

      if (result.responseText) {
        const { sendWhatsAppMessage } = await import("../../../infrastructure/whatsapp/index.js");
        const phoneNumberId = value.metadata?.phone_number_id;
        
        if (phoneNumberId) {
          l("WHATSAPP_DISPATCH_START");
          try {
            await sendWhatsAppMessage(phoneNumberId, config.WHATSAPP_ACCESS_TOKEN, from, result.responseText);
            l("WHATSAPP_DISPATCH_SUCCESS");
          } catch (waErr: any) {
            l("WHATSAPP_DISPATCH_FAILED: " + waErr.message);
          }
        }
      }

      return res.status(200).json({ ok: true });

    } catch (innerErr) {
      l("INNER_SHELL_FAILURE: " + String(innerErr));
      return res.status(200).json({ ok: false, error: "Internal processing failure" });
    } finally {
      await sql.end();
    }

  } catch (outerErr) {
    l("OUTER_SHELL_FAILURE: " + String(outerErr));
    return res.status(200).json({ ok: false, error: "Ingress failure" });
  }
}

function validateSignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const received = signature.slice(7);
  return expected.length === received.length && timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(received, "hex"));
}
