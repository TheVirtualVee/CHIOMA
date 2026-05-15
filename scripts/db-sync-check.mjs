import postgres from 'postgres';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
dotenv.config();

const sql = postgres(process.env.DATABASE_URL, { ssl: 'require' });

async function check() {
  try {
    const liveTables = (await sql`
      SELECT table_name FROM information_schema.tables 
      WHERE table_schema IN ('public', 'core')
    `).map(t => t.table_name);

    const migDir = 'supabase/migrations';
    const localTables = new Map();
    if (fs.existsSync(migDir)) {
      fs.readdirSync(migDir).forEach(file => {
        const content = fs.readFileSync(path.join(migDir, file), 'utf8');
        const matches = content.matchAll(/CREATE TABLE IF NOT EXISTS (?:public\.|core\.)?(\w+)/g);
        for (const match of matches) {
          localTables.set(match[1], file);
        }
      });
    }

    console.log('\n--- CHIOMA DB SYNC AUDIT (Multi-Schema) ---\n');

    const phantoms = Array.from(localTables.keys()).filter(t => !liveTables.includes(t));
    if (phantoms.length > 0) {
      console.log('PHANTOM TABLES (In code, but missing in DB):');
      phantoms.forEach(t => console.log(`  - ${t} (Source: ${localTables.get(t)})`));
    } else {
      console.log('✅ ALL LOCAL MIGRATIONS PRESENT IN DB (Public/Core).');
    }

    const orphans = liveTables.filter(t => !localTables.has(t));
    if (orphans.length > 0) {
      console.log('\nORPHAN TABLES (In DB, but no local .sql file found):');
      orphans.forEach(t => console.log(`  - ${t}`));
    }

    if (liveTables.includes('concurrency_leases') && liveTables.includes('execution_leases')) {
      console.log('\n⚠️  LEASING REDUNDANCY DETECTED:');
      console.log('   Recommendation: Drop "public.concurrency_leases". Code targets "execution_leases".');
    }

  } catch (err) {
    console.error('ERROR:', err.message);
  } finally {
    await sql.end();
  }
}

check();
