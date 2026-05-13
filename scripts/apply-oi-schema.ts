import postgres from 'postgres';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const sql = postgres(process.env.DATABASE_URL!, { ssl: 'require' });

async function applySchema() {
  console.log("Applying Operational Intelligence schema...");
  const schemaPath = path.resolve('infrastructure/src/database/supabase-schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  
  try {
    // Split by semicolons for basic parsing, but be careful with functions
    // Better yet, just run the whole blob
    await sql.unsafe(schema);
    console.log("Schema applied successfully.");
  } catch (err) {
    console.error("Failed to apply schema:", err);
  } finally {
    await sql.end();
  }
}

applySchema();
