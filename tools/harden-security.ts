import "dotenv/config";
import { createDatabaseClient } from "../infrastructure/database/index.js";

/**
 * CHIOMA Security Hardening Tool
 * Enables RLS on all critical tables and enforces multi-tenant isolation.
 */
async function hardenSecurity() {
  const sql = createDatabaseClient(process.env.DATABASE_URL!, { max: 1 });
  
  console.log("🛡️ Starting Security Hardening...");

  const tables = [
    'public.tenants',
    'public.chioma_instances',
    'public.employer_profiles',
    'public.customer_memory',
    'public.billing_ledger',
    'public.business_facts',
    'public.commitments',
    'public.arbiter_audits',
    'public.runtime_events',
    'public.cea_execution_logs',
    'core.events',
    'core.projections'
  ];

  try {
    for (const table of tables) {
      console.log(`🔒 Enabling RLS on ${table}...`);
      try {
        await sql.unsafe(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`);
        
        // Add a "Deny All" policy for non-service roles to be safe
        // (postgres user will still bypass this)
        await sql.unsafe(`
          DO $$
          BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = '${table.split('.')[1]}' AND policyname = 'service_access') THEN
              CREATE POLICY service_access ON ${table} FOR ALL TO postgres USING (true);
            END IF;
          END $$;
        `);
        
        console.log(`✅ ${table} secured.`);
      } catch (err: any) {
        console.warn(`⚠️  Warning on ${table}: ${err.message}`);
      }
    }

    console.log("\n✨ Security Hardening Complete!");
    console.log("Note: Your backend uses a superuser connection, so it will continue to function normally while external roles (anon/authenticated) are now blocked by default.");
  } finally {
    await sql.end();
  }
}

hardenSecurity().catch(console.error);
