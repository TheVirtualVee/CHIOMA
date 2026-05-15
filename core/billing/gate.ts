import { ChiomaInstance } from "../contracts/index.js";

export type BillingGateResult = {
  allowed: boolean;
  response?: string;
};

export function billingGate(instance: ChiomaInstance): BillingGateResult {
  if (instance.billing_state !== "ACTIVE") {
    return {
      allowed: false,
      response: "Your CHIOMA service is currently paused. Please top up to continue."
    };
  }

  if (instance.credit_units <= 0) {
    return {
      allowed: false,
      response: "Insufficient credits. Please recharge to continue using CHIOMA."
    };
  }

  return { allowed: true };
}

export async function deductCredit(
  sql: any,
  instanceId: string,
  tenantId: string,
  correlationId: string,
  units: number = 1
): Promise<void> {
  const execute = async (tx: any) => {
    const [instance] = await tx`
      UPDATE public.chioma_instances
      SET credit_units = credit_units - ${units}
      WHERE instance_id = ${instanceId} AND credit_units >= ${units}
      RETURNING credit_units
    `;

    if (!instance) {
      throw new Error("BILLING_FAILURE: Insufficient credits or instance not found during deduction.");
    }

    await tx`
      INSERT INTO public.billing_ledger (
        tenant_id,
        instance_id,
        event_type,
        credit_delta,
        balance_after,
        correlation_id
      ) VALUES (
        ${tenantId},
        ${instanceId},
        'LLM_DEBIT',
        ${-units},
        ${instance.credit_units},
        ${correlationId}
      )
    `;
  };

  // 🧠 TRANSACTION AWARENESS: If 'sql' is already a transaction (tx), it won't have .begin()
  if (typeof sql.begin === 'function') {
    await sql.begin(execute);
  } else {
    await execute(sql);
  }
}
