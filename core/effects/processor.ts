import type { SideEffectRecord, ExecutionReceipt, SendWhatsAppPayload } from "./types.js";
import { computeNextAttemptDelay } from "./retry.js";

export class SideEffectProcessor {
  private instanceId: string;

  constructor(instanceId: string) {
    this.instanceId = instanceId;
  }

  async claimAndExecute(sql: any): Promise<ExecutionReceipt | null> {
    // We attempt to claim an effect directly.
    const [effect] = await sql`
        UPDATE side_effects
        SET status = 'IN_FLIGHT',
            worker_instance_id = ${this.instanceId},
            attempt_count = attempt_count + 1,
            updated_at = NOW()
        WHERE side_effect_id = (
          SELECT side_effect_id FROM side_effects
          WHERE status = 'PENDING'
            AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())
          ORDER BY created_at ASC
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        )
        RETURNING *
    `;

    if (!effect) return null;

    const [existingReceipt] = await sql`
      SELECT * FROM execution_receipts
      WHERE side_effect_id = ${effect.sideEffectId}
        AND outcome = 'SUCCESS'
      LIMIT 1
    `;

    if (existingReceipt) {
      await sql`
        UPDATE side_effects
        SET status = 'SUCCEEDED',
            execution_receipt_id = ${existingReceipt.receipt_id},
            updated_at = NOW()
        WHERE side_effect_id = ${effect.sideEffectId}
      `;
      return existingReceipt as ExecutionReceipt;
    }

    const start = Date.now();
    let outcome: "SUCCESS" | "FAILURE";
    let externalCorrelationId: string | null = null;
    let responsePayload: unknown = null;

    try {
      const result = await this.dispatch(effect);
      outcome = "SUCCESS";
      externalCorrelationId = result.externalCorrelationId;
      responsePayload = result.responsePayload;
    } catch (err: any) {
      outcome = "FAILURE";
      responsePayload = { error: err.message };
    }

    const durationMs = Date.now() - start;

    const [receipt] = await sql`
        INSERT INTO execution_receipts (
          side_effect_id, attempt_number, executed_at, outcome,
          external_correlation_id, response_payload, duration_ms, worker_instance_id
        ) VALUES (
          ${effect.sideEffectId}, ${effect.attemptCount + 1}, NOW(), ${outcome},
          ${externalCorrelationId}, ${sql.json(responsePayload)}, ${durationMs}, ${this.instanceId}
        ) RETURNING *
    `;

    if (outcome === "SUCCESS") {
      await sql`
          UPDATE side_effects
          SET status = 'SUCCEEDED',
              execution_receipt_id = ${receipt.receipt_id},
              updated_at = NOW()
          WHERE side_effect_id = ${effect.sideEffectId}
      `;
    } else {
      const nextDelay = computeNextAttemptDelay(effect.attemptCount + 1);
      if (nextDelay === null) {
        await sql`
            UPDATE side_effects
            SET status = 'DEAD_LETTERED',
                dead_letter_at = NOW(),
                updated_at = NOW()
            WHERE side_effect_id = ${effect.sideEffectId}
        `;
      } else {
        await sql`
            UPDATE side_effects
            SET status = 'FAILED_RETRYABLE',
                next_attempt_at = NOW() + ${nextDelay / 1000.0} * interval '1 second',
                updated_at = NOW()
            WHERE side_effect_id = ${effect.sideEffectId}
        `;
      }
    }

    return receipt;
  }

  private async dispatch(
    effect: SideEffectRecord
  ): Promise<{ externalCorrelationId: string | null; responsePayload: unknown }> {
    switch (effect.effectType) {
      case "SEND_WHATSAPP_MESSAGE": {
        const payload = effect.payload as SendWhatsAppPayload;
        const response = await fetch(
          `https://graph.facebook.com/v21.0/${payload.phoneNumberId}/messages`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${payload.accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              messaging_product: "whatsapp",
              to: payload.recipientPhone,
              type: "text",
              text: { body: payload.messageText },
            }),
          }
        );
        const data = (await response.json()) as any;
        if (!response.ok) {
          throw new Error(`WHATSAPP_API_FAILURE [${response.status}]: ${JSON.stringify(data)}`);
        }
        return {
          externalCorrelationId: data.messages?.[0]?.id || null,
          responsePayload: data,
        };
      }

      case "SEND_EMAIL_NOTIFICATION":
      case "TRIGGER_WEBHOOK":
      case "WRITE_AUDIT_LOG":
        return { externalCorrelationId: null, responsePayload: { status: "NOT_IMPLEMENTED" } };

      default: {
        const _exhaustive: never = effect.effectType;
        throw new Error(`Unhandled effect type: ${_exhaustive}`);
      }
    }
  }
}
