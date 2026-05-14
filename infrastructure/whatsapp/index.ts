/**
 * infrastructure/whatsapp/index.ts
 *
 * Direct transport for Meta WhatsApp Cloud API.
 * Uses the Graph API to send messages back to customers.
 */

export async function sendWhatsAppMessage(
  phoneNumberId: string,
  accessToken: string,
  to: string,
  text: string
): Promise<void> {
  const url = `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`;

  // Phase 6: Ensure recipient format uses 234... NOT +234...
  const sanitizedTo = to.replace("+", "").trim();

  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: sanitizedTo,
    type: "text",
    text: { body: text },
  };

  console.log("[WHATSAPP] SENDING_MESSAGE_ATTEMPT", { 
    to: sanitizedTo, 
    tokenExists: !!accessToken,
    tokenLength: accessToken?.length 
  });

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  console.log("[WHATSAPP] STATUS", response.status);
  const raw = await response.text();
  console.log("[WHATSAPP] RESPONSE", raw);

  if (!response.ok) {
    console.error("[WHATSAPP] DELIVERY_FAILED", raw);
    throw new Error(`WHATSAPP_API_FAILURE [${response.status}]: ${raw}`);
  }
}
