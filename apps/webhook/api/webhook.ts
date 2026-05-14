import { randomUUID, createHmac, timingSafeEqual } from "node:crypto";

export default async function handler(req: any, res: any) {
  const t = Date.now();
  const log: string[] = [];
  const l = (m: string) => { log.push(`[${Date.now() - t}ms] ${m}`); };

  try {
    l("IRONCLAD_ENTER");
    
    if (req.method === "GET") {
      const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;
      if (req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === verifyToken) {
        return res.status(200).send(req.query["hub.challenge"]);
      }
      return res.status(403).send("Forbidden");
    }

    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
    const APP_SECRET = process.env.WHATSAPP_APP_SECRET;
    const PHONE_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || "1108692132327986";

    l("CONFIG_READY: " + (!!ACCESS_TOKEN && !!APP_SECRET));

    const signature = req.headers["x-hub-signature-256"] as string;
    const rawBody = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
    
    if (APP_SECRET && signature) {
      const expected = createHmac("sha256", APP_SECRET).update(rawBody, "utf8").digest("hex");
      const received = signature.slice(7);
      const sigValid = expected.length === received.length && timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(received, "hex"));
      l("SIG_VALID: " + sigValid);
      if (!sigValid) {
        console.error("[WHATSAPP_MONOLOG] " + log.join(" | "));
        return res.status(401).json({ error: "Invalid signature" });
      }
    }

    const entry = req.body?.entry?.[0];
    const value = entry?.changes?.[0]?.value;
    const messages = value?.messages;

    if (!messages || messages.length === 0) {
      l("EXIT_NO_MSG");
      console.error("[WHATSAPP_MONOLOG] " + log.join(" | "));
      return res.status(200).json({ ok: true });
    }

    const from = messages[0].from;
    const text = messages[0].text?.body || "";
    l("MSG_FROM: " + from);

    const replyText = `[MONOLOG] CHIOMA received: "${text}"`;

    if (ACCESS_TOKEN) {
      l("SEND_START");
      const url = `https://graph.facebook.com/v21.0/${PHONE_ID}/messages`;
      const response = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: from,
          type: "text",
          text: { body: replyText },
        }),
      });

      const result = await response.json();
      l("SEND_STATUS: " + response.status);
      l("SEND_BODY: " + JSON.stringify(result));
    }

    l("FLOW_COMPLETE");
    console.error("[WHATSAPP_MONOLOG] " + log.join(" | "));
    return res.status(200).json({ ok: true });

  } catch (err: any) {
    l("FATAL: " + err?.message);
    console.error("[WHATSAPP_MONOLOG_FATAL] " + log.join(" | "));
    return res.status(500).json({ error: "Internal server error" });
  }
}
