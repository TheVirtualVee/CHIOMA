import "dotenv/config";
import { createDatabaseClient } from "../infrastructure/database/index.js";

/**
 * CHIOMA Brute Force Schema Fixer
 * Repairs type mismatches and missing tables in the production DB.
 */
async function fixSchema() {
  const sql = createDatabaseClient(process.env.DATABASE_URL!, { max: 1 });
  
  console.log("🛠️ Starting Brute Force Schema Repair...");

  try {
    // 0. Purge non-UUID instances that block the type change
    console.log("🧹 Purging non-UUID legacy instances...");
    await sql`
      DELETE FROM public.chioma_instances 
      WHERE instance_id::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
    `;

    // 1. Fix chioma_instances types
    console.log("📏 Fixing chioma_instances column types...");
    await sql`
      ALTER TABLE public.chioma_instances 
      ALTER COLUMN instance_id TYPE UUID USING instance_id::uuid;
    `;
    
    // 2. Ensure Primary Key
    console.log("🔑 Checking Primary Key on chioma_instances...");
    try {
        await sql`ALTER TABLE public.chioma_instances ADD PRIMARY KEY (instance_id);`;
    } catch (e: any) {
        console.log(`   (PK Note: ${e.message.slice(0, 50)} - Continuing anyway)`);
    }

    // 3. Create billing_ledger
    console.log("🧾 Creating billing_ledger...");
    await sql`
      CREATE TABLE IF NOT EXISTS public.billing_ledger (
        id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id       TEXT        NOT NULL,
        instance_id     UUID        NOT NULL REFERENCES public.chioma_instances(instance_id),
        event_type      TEXT        NOT NULL,
        credit_delta    INTEGER     NOT NULL,
        balance_after   INTEGER     NOT NULL,
        correlation_id  TEXT,
        created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT chk_event_type CHECK (event_type IN ('LLM_DEBIT', 'TOPUP', 'ADJUSTMENT', 'SYSTEM'))
      );
    `;

    console.log("✨ Schema Repair Complete!");
  } catch (err: any) {
    console.error("❌ Repair failed:", err.message);
  } finally {
    await sql.end();
  }
}

function msg(e: any) { return (e.message || "").toLowerCase(); }

fixSchema().catch(console.error);
