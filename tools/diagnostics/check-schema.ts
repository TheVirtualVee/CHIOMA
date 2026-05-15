import "dotenv/config";
import { createDatabaseClient } from "../../infrastructure/database/index.js";

async function checkSchema() {
  const sql = createDatabaseClient(process.env.DATABASE_URL!, { max: 1 });
  
  try {
    const tables = await sql`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
    `;
    console.log("Tables in public:", tables.map((t: any) => t.table_name).join(", "));

    const chioma_instances_cols = await sql`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'chioma_instances'
    `;
    console.log("\nchioma_instances columns:", chioma_instances_cols);

    const billing_ledger_cols = await sql`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'billing_ledger'
    `;
    console.log("\nbilling_ledger columns:", billing_ledger_cols);

  } finally {
    await sql.end();
  }
}

checkSchema().catch(console.error);
