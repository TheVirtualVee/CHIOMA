import { DeliveryContract } from "../contracts/index.js";
import { TelemetryManager } from "../telemetry/index.js";
import { sendWhatsAppMessage } from "../../infrastructure/whatsapp/index.js";

export class DeliveryGuaranteeLayer {
  static validate(contract: DeliveryContract): DeliveryContract {
    if (contract.intent === "SEND") {
      if (!contract.payload?.text || contract.payload.text.trim() === "") {
        throw new Error("[DGL_FATAL] Missing payload text");
      }
      if (!contract.payload?.to) {
        throw new Error("[DGL_FATAL] Missing recipient");
      }
    }
    return contract;
  }

  static async execute(
    contract: DeliveryContract,
    sql: any,
    config: { phoneNumberId: string; accessToken: string },
    telemetry: TelemetryManager
  ): Promise<DeliveryContract> {
    if (contract.intent === "NO_SEND") {
      contract.deliveryState = "SKIPPED";
      telemetry.record("DELIVERY_SKIPPED", { reason: contract.reason });
      return contract;
    }

    this.validate(contract);

    // P1: Idempotency check — if traceId was already delivered, skip silently.
    // Prevents duplicate WhatsApp messages on recovery retries.
    // ASSERT: delivery_queue table exists (migration 20260527000300)
    try {
      const [alreadyDelivered] = await sql`
        SELECT trace_id FROM public.delivery_queue
        WHERE trace_id = ${contract.traceId} AND status = 'DELIVERED'
        LIMIT 1
      `;
      if (alreadyDelivered) {
        contract.deliveryState = "SKIPPED";
        telemetry.record("DELIVERY_IDEMPOTENT_SKIP", { traceId: contract.traceId });
        console.log(`[DGL] IDEMPOTENT_SKIP: trace_id=${contract.traceId} already delivered`);
        return contract;
      }
    } catch {
      // Non-fatal: delivery_queue may not exist on cold start — proceed with send
    }

    // Record delivery attempt in queue BEFORE sending
    // This ensures recovery worker sees the attempt even if send crashes mid-flight
    try {
      await sql`
        INSERT INTO public.delivery_queue
          (trace_id, tenant_id, instance_id, recipient, payload_json, status, last_error)
        VALUES
          (${contract.traceId}, ${contract.tenantId}, ${contract.instanceId},
           ${contract.payload!.to}, ${sql.json(contract.payload!)}, 'IN_FLIGHT', NULL)
        ON CONFLICT (trace_id) DO UPDATE SET status = 'IN_FLIGHT', updated_at = NOW()
      `;
    } catch {
      // Non-fatal: proceed with send even if queue write fails
    }

    telemetry.record("DELIVERY_ATTEMPTED", { to: contract.payload?.to });

    try {
      await sendWhatsAppMessage(
        config.phoneNumberId,
        config.accessToken,
        contract.payload!.to,
        contract.payload!.text,
        { traceId: contract.traceId, workerId: "DGL", executionId: `dgl_${contract.traceId}` }
      );

      contract.deliveryState = "SENT";

      // Mark DELIVERED in queue — idempotency key is now set
      try {
        await sql`
          UPDATE public.delivery_queue SET status = 'DELIVERED', delivered_at = NOW()
          WHERE trace_id = ${contract.traceId}
        `;
      } catch { /* Non-fatal */ }

      telemetry.record("DELIVERY_CONFIRMED", { channel: "whatsapp" });
      return contract;

    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[DGL] Delivery failed, queuing: ${errMsg}`);
      await this.persistToQueue(contract, sql, errMsg);

      contract.deliveryState = "QUEUED";
      telemetry.record("DELIVERY_FAILED", { error: errMsg, queued: true });
      return contract;
    }
  }

  private static async persistToQueue(
    contract: DeliveryContract,
    sql: any,
    error: string
  ): Promise<void> {
    try {
      await sql`
        INSERT INTO public.delivery_queue
          (trace_id, tenant_id, instance_id, recipient, payload_json, status, last_error)
        VALUES
          (${contract.traceId}, ${contract.tenantId}, ${contract.instanceId},
           ${contract.payload!.to}, ${sql.json(contract.payload!)}, 'PENDING', ${error})
        ON CONFLICT (trace_id) DO UPDATE SET
          status = 'PENDING', last_error = ${error}, updated_at = NOW()
      `;
    } catch (queueErr: unknown) {
      // If queue write fails, log but don't mask the original delivery error
      console.error(`[DGL] QUEUE_WRITE_FAILED: ${String(queueErr).slice(0, 100)}`);
    }
  }
}
