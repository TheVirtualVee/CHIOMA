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
    telemetry.record("DELIVERY_ATTEMPTED", { to: contract.payload?.to });

    try {
      const result = await sendWhatsAppMessage(
        config.phoneNumberId,
        config.accessToken,
        contract.payload!.to,
        contract.payload!.text,
        { traceId: contract.traceId, workerId: "DGL", executionId: `dgl_${contract.traceId}` }
      );

      contract.deliveryState = "SENT";
      telemetry.record("DELIVERY_CONFIRMED", { channel: "whatsapp" });
      return contract;

    } catch (err: any) {
      console.error(`[DGL] Delivery failed, queuing: ${err.message}`);
      await this.persistToQueue(contract, sql, err.message);
      
      contract.deliveryState = "QUEUED";
      telemetry.record("DELIVERY_FAILED", { error: err.message, queued: true });
      return contract;
    }
  }

  private static async persistToQueue(contract: DeliveryContract, sql: any, error: string) {
    await sql`
      INSERT INTO public.delivery_queue (
        trace_id, tenant_id, instance_id, recipient, payload_json, status, last_error
      ) VALUES (
        ${contract.traceId}, 
        ${contract.tenantId}, 
        ${contract.instanceId}, 
        ${contract.payload!.to}, 
        ${sql.json(contract.payload!)}, 
        'PENDING', 
        ${error}
      )
    `;
  }
}
