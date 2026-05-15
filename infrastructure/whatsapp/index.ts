import type { TraceContext } from "../../core/contracts/telemetry.js";

export async function sendWhatsAppMessage(
  phoneNumberId: string,
  accessToken: string,
  to: string,
  text: string,
  trace?: TraceContext
): Promise<void> {
  const sanitizedTo = to.replace("+", "").trim();
  const contextTag = trace ? ` [execId=${trace.executionId}]` : "";
  const url = `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`;

  // 🧪 DRY_RUN / SIMULATION MODE
  if (process.env.WHATSAPP_DRY_RUN === "true" || to === "simulation_user") {
    console.log(`[WHATSAPP_DRY_RUN]${contextTag} to=${sanitizedTo} body="${text}"`);
    return;
  }

  console.log(`[WHATSAPP_INFRA] SEND_ATTEMPT${contextTag} to=${sanitizedTo}`);

  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: sanitizedTo,
    type: "text",
    text: { body: text },
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    const isTimeout = err instanceof Error && err.name === "AbortError";
    const errorMsg = isTimeout ? "WHATSAPP_SEND_TIMEOUT" : `WHATSAPP_FETCH_ERROR: ${String(err)}`;
    console.error(`[WHATSAPP_INFRA] SEND_FAILED${contextTag} reason=${errorMsg}`);
    throw new Error(errorMsg);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const raw = await response.text();
    console.error(`[WHATSAPP_INFRA] SEND_FAILED${contextTag} status=${response.status} body=${raw}`);
    throw new Error(`WHATSAPP_API_FAILURE [${response.status}]: ${raw}`);
  }

  console.log(`[WHATSAPP_INFRA] SEND_SUCCESS${contextTag}`);
}
