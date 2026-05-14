import { validateConfig } from "../../../infrastructure/config/index.js";
import { createDatabaseClient } from "../../../infrastructure/database/index.js";
import { runStaffLoop } from "../../../core/staff-loop/index.js";

/**
 * api/debug-loop.ts
 *
 * TEMPORARY diagnostic endpoint — tests the full staff loop + WhatsApp send
 * and returns every step in the response body.
 * REMOVE AFTER DEBUGGING.
 */

export default async function handler(req: any, res: any) {
  const trace: string[] = [];
  const t = (msg: string) => { trace.push(msg); };

  try {
    t("ENTER");

    const config = validateConfig();
    t("CONFIG_OK");

    const tenantId = "tenant_1108692132327986";
    const senderPhone = "2348083000771";
    const messageText = "Hello";

    const sql = createDatabaseClient(config.DATABASE_URL, { max: 1 });

    try {
      t("RUNNING_STAFF_LOOP");
      const result = await runStaffLoop(
        {
          tenantId,
          senderPhone,
          messageText,
          correlationId: "debug_" + Date.now(),
          causationId: "debug_cause_" + Date.now(),
          eventId: "debug_evt_" + Date.now(),
          channel: "debug" as any
        },
        sql,
        { apiKey: config.LLM_API_KEY, provider: config.LLM_PROVIDER }
      );

      t("STAFF_LOOP_RESULT_TYPE:" + result.responseType);
      t("STAFF_LOOP_RESPONSE:" + (result.responseText || "(empty)").substring(0, 200));

      if (result.responseText) {
        t("ATTEMPTING_WHATSAPP_SEND");
        try {
          const { sendWhatsAppMessage } = await import("../../../infrastructure/whatsapp/index.js");
          const phoneNumberId = config.WHATSAPP_PHONE_NUMBER_ID || "1108692132327986";
          t("PHONE_NUMBER_ID:" + phoneNumberId);
          t("TOKEN_LENGTH:" + (config.WHATSAPP_ACCESS_TOKEN?.length || 0));

          await sendWhatsAppMessage(phoneNumberId, config.WHATSAPP_ACCESS_TOKEN, senderPhone, result.responseText);
          t("WHATSAPP_SEND_OK");
        } catch (waErr) {
          t("WHATSAPP_SEND_FAILED:" + String(waErr));
        }
      }

      t("DONE");
      return res.status(200).json({ ok: true, trace, result: { type: result.responseType, text: result.responseText } });

    } catch (err) {
      t("LOOP_CRASH:" + String(err));
      return res.status(200).json({ ok: false, trace });
    } finally {
      await sql.end();
    }

  } catch (err) {
    t("FATAL:" + String(err));
    return res.status(500).json({ ok: false, trace });
  }
}
