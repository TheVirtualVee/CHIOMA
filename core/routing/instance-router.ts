import { ChiomaInstance } from "../contracts/index.js";

export async function resolveInstance(
  sql: any,
  phoneNumberId: string
): Promise<ChiomaInstance | null> {
  const [row] = await sql`
    SELECT 
      instance_id,
      tenant_id,
      whatsapp_phone_number,
      whatsapp_phone_number_id,
      billing_state,
      credit_units,
      business_model_version,
      llm_provider,
      llm_model,
      memory_namespace
    FROM public.chioma_instances
    WHERE whatsapp_phone_number_id = ${phoneNumberId}
  `;

  return mapRowToInstance(row);
}

export async function resolveInstanceByTenant(
  sql: any,
  tenantId: string
): Promise<ChiomaInstance | null> {
  const [row] = await sql`
    SELECT 
      instance_id,
      tenant_id,
      whatsapp_phone_number,
      whatsapp_phone_number_id,
      billing_state,
      credit_units,
      business_model_version,
      llm_provider,
      llm_model,
      memory_namespace
    FROM public.chioma_instances
    WHERE tenant_id = ${tenantId}
  `;

  if (!row) {
    console.error(`[ROUTER] NO_INSTANCE_FOUND for tenant_id: ${tenantId}`);
    return null;
  }

  return mapRowToInstance(row);
}

function mapRowToInstance(row: any): ChiomaInstance {
  return {
    instance_id: row.instance_id,
    tenant_id: row.tenant_id,
    whatsapp_phone_number: row.whatsapp_phone_number,
    whatsapp_phone_number_id: row.whatsapp_phone_number_id,
    billing_state: row.billing_state as "ACTIVE" | "PAUSED" | "EXPIRED",
    credit_units: row.credit_units,
    business_model_version: row.business_model_version,
    llm_config: {
      provider: row.llm_provider,
      model: row.llm_model,
    },
    memory_namespace: row.memory_namespace,
  };
}

