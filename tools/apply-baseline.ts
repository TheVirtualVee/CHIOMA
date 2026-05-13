import { createDatabaseClient } from '../infrastructure/src/database/client.js';
import { config } from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';

config();

async function run() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL missing");
  const sql = await createDatabaseClient(process.env.DATABASE_URL);
  
  const migrationPath = path.resolve('supabase/migrations/20260515000000_baseline_v1_1.sql');
  const sqlContent = fs.readFileSync(migrationPath, 'utf8');

  console.log("Applying CHIOMA v1.1 Baseline Migration...");
  
  await sql`DROP SCHEMA IF EXISTS core CASCADE`;
  
  // Use multi-statement execution
  await sql.unsafe(sqlContent);
  
  console.log("SUCCESS: Baseline established.");
  await sql.end();
}

run().catch(err => {
  console.error("MIGRATION_FAILED:", err);
  process.exit(1);
});
