import { createDatabaseClient } from '../infrastructure/src/database/client.js';
import { config } from 'dotenv';
config();

async function run() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL missing");
    return;
  }
  const sql = await createDatabaseClient(process.env.DATABASE_URL);
  const tables = await sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`;
  console.log("Tables in public schema:", tables.map(t => t.table_name));
  
  if (tables.some(t => t.table_name === 'events')) {
    const columns = await sql`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'events'`;
    console.log("Columns in 'events' table:", columns);
  } else {
    console.warn("WARNING: 'events' table is MISSING.");
  }

  await sql.end();
}

run().catch(console.error);
