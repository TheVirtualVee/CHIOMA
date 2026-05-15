import "dotenv/config";
import crypto from "node:crypto";
import { createDatabaseClient } from "../infrastructure/database/index.js";

/**
 * CHIOMA Tenant Bootstrapper
 * Purpose: Registers a new phone number ID into the CHIOMA database.
 * Usage: npx tsx tools/bootstrap-tenant.ts <TENANT_ID> <PHONE_NUMBER_ID> <PHONE_NUMBER> <BUSINESS_NAME>
 */

async function bootstrap() {
  const [,, tenantId, phoneId, phoneNumber, businessName] = process.argv;

  if (!tenantId || !phoneId || !phoneNumber || !businessName) {
    console.error("❌ Missing arguments!");
    console.log("Usage: npx tsx tools/bootstrap-tenant.ts <TENANT_ID> <PHONE_NUMBER_ID> <PHONE_NUMBER> <BUSINESS_NAME>");
    console.log("Example: npx tsx tools/bootstrap-tenant.ts my-first-biz 1108692132327986 +234800000000 'My Store'");
    process.exit(1);
  }

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("❌ Missing DATABASE_URL in environment.");
    process.exit(1);
  }
  const sql = createDatabaseClient(dbUrl, { max: 1 });

  console.log(`🚀 Bootstrapping Tenant: ${tenantId} [Phone ID: ${phoneId}]`);

  try {
    // 1. Create/Update Instance
    const instanceId = crypto.randomUUID();
    await sql`DELETE FROM public.chioma_instances WHERE tenant_id = ${tenantId}`;
    await sql`
      INSERT INTO public.chioma_instances (
        instance_id,
        tenant_id, 
        whatsapp_phone_number, 
        whatsapp_phone_number_id, 
        llm_provider,
        llm_model,
        memory_namespace,
        billing_state,
        credit_units
      ) VALUES (
        ${instanceId},
        ${tenantId}, 
        ${phoneNumber}, 
        ${phoneId}, 
        'groq',
        'llama-3.3-70b-versatile',
        ${`mem_${tenantId}`},
        'ACTIVE',
        100
      );
    `;

    // 2. Create/Update Employer Profile
    await sql`DELETE FROM public.employer_profiles WHERE tenant_id = ${tenantId}`;
    await sql`
      INSERT INTO public.employer_profiles (
        tenant_id, 
        business_name,
        onboarding_status,
        tone_profile
      ) VALUES (
        ${tenantId}, 
        ${businessName},
        'COMPLETED',
        'friendly-shopkeeper'
      );
    `;

    console.log("✅ Tenant bootstrap complete. CHIOMA now recognizes this phone number ID.");
  } catch (err: any) {
    console.error("❌ Bootstrap failed:", err.message);
  } finally {
    await sql.end();
  }
}

bootstrap().catch(console.error);
