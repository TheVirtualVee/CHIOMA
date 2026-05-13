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

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: to,
      type: "text",
      text: { body: text },
    }),
  });

  if (!response.ok) {
    const errorData = await response.json();
    console.error("WHATSAPP_SEND_ERROR", {
      status: response.status,
      error: errorData,
      to,
      phoneNumberId
    });
    throw new Error(`WHATSAPP_API_FAILURE: ${response.status}`);
  }
}
