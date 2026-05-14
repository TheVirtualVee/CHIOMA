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

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const raw = await response.text();
    throw new Error(`WHATSAPP_API_FAILURE [${response.status}]: ${raw}`);
  }
}
