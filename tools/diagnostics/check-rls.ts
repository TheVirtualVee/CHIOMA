import "dotenv/config";
import { createDatabaseClient } from "../../infrastructure/database/index.js";

async function checkRLS() {
  const sql = createDatabaseClient(process.env.DATABASE_URL!, { max: 1 });
  
  try {
    const tables = await sql`
      SELECT tablename, rowsecurity 
      FROM pg_tables 
      WHERE schemaname = 'public' 
      AND tablename IN ('tenants', 'chioma_instances', 'employer_profiles', 'customer_memory', 'events', 'billing_ledger')
    `;
    console.log("RLS Status:", tables);

    const coreTables = await sql`
      SELECT tablename, rowsecurity 
      FROM pg_tables 
      WHERE schemaname = 'core'
    `;
    console.log("Core Schema RLS Status:", coreTables);

  } finally {
    await sql.end();
  }
}

checkRLS().catch(console.error);
