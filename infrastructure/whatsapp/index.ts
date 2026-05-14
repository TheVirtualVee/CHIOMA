export async function sendWhatsAppMessage(
  phoneNumberId: string,
  accessToken: string,
  to: string,
  text: string
): Promise<void> {
  const url = `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`;
  const sanitizedTo = to.replace("+", "").trim();

  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: sanitizedTo,
    type: "text",
    text: { body: text },
  };

  // ASSERT: timeout enforced — a hung Meta API must not stall the serverless function
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);

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
    throw new Error(isTimeout ? "WHATSAPP_SEND_TIMEOUT: Meta API did not respond within 8s" : `WHATSAPP_FETCH_ERROR: ${String(err)}`);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const raw = await response.text();
    throw new Error(`WHATSAPP_API_FAILURE [${response.status}]: ${raw}`);
  }
}
