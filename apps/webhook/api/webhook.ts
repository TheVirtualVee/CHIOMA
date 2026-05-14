import { randomUUID, createHmac, timingSafeEqual } from "node:crypto";

/**
 * api/webhook.ts
 *
 * CHIOMA WhatsApp Webhook Handler.
 * IRONCLAD BUILD — 100% Self-Contained.
 * Goal: Prove connectivity by sending a hardcoded reply.
 */

export default async function handler(req: any, res: any) {
  const t = Date.now();
  const log: string[] = [];
  const l = (m: string) => { 
    const msg = `[${t}] ${m}`;
    log.push(msg);
    console.error(msg); 
  };

  try {
    l("IRONCLAD_ENTER");
    
    // GET: Verification
    if (req.method === "GET") {
      const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;
      if (req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === verifyToken) {
        return res.status(200).send(req.query["hub.challenge"]);
      }
      return res.status(403).send("Forbidden");
    }

    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    // 1. Raw Config Access (No Zod)
    const ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
    const APP_SECRET = process.env.WHATSAPP_APP_SECRET;
    const PHONE_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || "1108692132327986";

    l("CONFIG_CHECK_" + (!!ACCESS_TOKEN && !!APP_SECRET));

    // 2. Raw Signature Validation
    const signature = req.headers["x-hub-signature-256"] as string;
    const rawBody = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
    
    if (APP_SECRET && signature) {
      const expected = createHmac("sha256", APP_SECRET).update(rawBody, "utf8").digest("hex");
      const received = signature.slice(7);
      const sigValid = expected.length === received.length && timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(received, "hex"));
      l("SIG_VALID_" + sigValid);
      if (!sigValid) return res.status(401).json({ error: "Invalid signature" });
    }

    // 3. Raw Payload Extraction
    const entry = req.body?.entry?.[0];
    const value = entry?.changes?.[0]?.value;
    const messages = value?.messages;

    if (!messages || messages.length === 0) {
      l("EXIT_NO_MSG");
      return res.status(200).json({ ok: true });
    }

    const from = messages[0].from;
    const text = messages[0].text?.body || "";
    l("MSG_FROM_" + from);

    // 4. IRONCLAD REPLY (No DB, No LLM, No Imports)
    const replyText = `[IRONCLAD] CHIOMA received your message: "${text}". The digital employee is coming online!`;

    if (ACCESS_TOKEN) {
      l("ATTEMPTING_RAW_SEND");
      const url = `https://graph.facebook.com/v21.0/${PHONE_ID}/messages`;
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: from,
          type: "text",
          text: { body: replyText },
        }),
      });

      const result = await response.json();
      l("SEND_RESULT_STATUS_" + response.status);
      l("SEND_RESULT_BODY_" + JSON.stringify(result));
    }

    l("FLOW_COMPLETE");
    return res.status(200).json({ ok: true, log });

  } catch (err: any) {
    l("FATAL_ERROR_" + err?.message);
    return res.status(500).json({ error: "Internal server error", message: err?.message, log });
  }
}
