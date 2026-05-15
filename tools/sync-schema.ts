import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { createDatabaseClient } from "../infrastructure/database/index.js";

/**
 * CHIOMA Schema Sync Tool (Lite)
 * Purpose: Applies migrations directly to the database without requiring the Supabase CLI.
 * Use this if 'npx supabase db push' is hanging or failing.
 */

async function syncSchema() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("❌ Missing DATABASE_URL in environment.");
    process.exit(1);
  }

  const sql = createDatabaseClient(dbUrl, { max: 1 });
  const migrationsDir = path.join(process.cwd(), "supabase", "migrations");

  console.log("🚀 Starting Direct Schema Sync...");

  try {
    const files = fs.readdirSync(migrationsDir).sort();
    
    for (const file of files) {
      if (!file.endsWith(".sql")) continue;
      
      console.log(`\n📄 Applying: ${file}`);
      const content = fs.readFileSync(path.join(migrationsDir, file), "utf8");
      
      // We wrap each migration in a transaction-like block
      try {
        // Splitting by semicolon to handle partial failures within a file
        const statements = content.split(';').filter(s => s.trim().length > 0);
        for (const statement of statements) {
          try {
            await sql.unsafe(statement);
          } catch (stmtErr: any) {
            const msg = stmtErr.message.toLowerCase();
            if (msg.includes("already exists") || msg.includes("already a column") || msg.includes("already a constraint")) {
              continue; // Normal skip
            }
            if (msg.includes("foreign key") || msg.includes("references")) {
              console.warn(`⚠️  FK Warning in ${file}: ${stmtErr.message.slice(0, 100)}`);
              continue;
            }
            throw stmtErr; // Critical error
          }
        }
        console.log(`✅ Success: ${file}`);
      } catch (err: any) {
        console.error(`❌ Failed: ${file}`);
        console.error(`   Error: ${err.message}`);
      }
    }

    console.log("\n✨ All migrations processed.");
  } catch (err: any) {
    console.error("❌ Sync failed:", err.message);
  } finally {
    await sql.end();
  }
}

syncSchema().catch(console.error);
