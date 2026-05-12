import { createEvent, type EventBus, EVENT_TYPES } from "@chioma/core";
import { createConsoleLogger, metrics } from "@chioma/infrastructure";

/** contract: WhatsAppConfig */
export type WhatsAppConfig = {
  phoneNumberId: string;
  accessToken: string;
  verifyToken: string;
};

/** contract: WhatsAppProvider */
export class WhatsAppProvider {
  private readonly logger = createConsoleLogger("whatsapp-provider");

  constructor(private readonly config: WhatsAppConfig, private readonly bus: EventBus) {}

  verifyWebhook(mode: string, token: string, challenge: string): string {
    if (mode === "subscribe" && token === this.config.verifyToken) {
      return challenge;
    }
    throw new Error("WHATSAPP_VERIFICATION_FAILED");
  }

  async handleWebhook(body: any, tenantId: string): Promise<void> {
    const entry = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const message = value?.messages?.[0];

    if (!message) return;

    const from = message.from;
    const text = message.text?.body;

    if (!text) return;

    const event = createEvent(
      EVENT_TYPES.MESSAGE_RECEIVED,
      { channel: "whatsapp", from, text, raw: message },
      tenantId
    );

    const { correlationId, id: causationId } = event;
    
    this.logger.info("WHATSAPP_MESSAGE_RECEIVED", { correlationId, tenantId, causationId });
    metrics.emit("whatsapp_message_received", { correlationId, tenantId, causationId, service: "whatsapp-provider" });

    await this.bus.publish(event);
  }

  async sendMessage(to: string, text: string): Promise<void> {
    // side-effect: external API call
    const url = `https://graph.facebook.com/v17.0/${this.config.phoneNumberId}/messages`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.config.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: text },
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`WHATSAPP_SEND_FAILURE: ${JSON.stringify(errorData)}`);
    }
  }
}
