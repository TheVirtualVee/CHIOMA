import "dotenv/config";
import { createDatabaseClient } from "../infrastructure/database/index.js";

async function patchBrain() {
  const sql = createDatabaseClient(process.env.DATABASE_URL!, { max: 1 });
  
  console.log("🧠 Patching CHIOMA instances to Groq...");

  try {
    const result = await sql`
      UPDATE public.chioma_instances
      SET llm_provider = 'groq',
          llm_model = 'llama-3.3-70b-versatile'
      WHERE llm_provider = 'openai' OR llm_provider IS NULL;
    `;
    
    console.log(`✅ Success! Updated ${result.count} instances to Groq.`);
  } catch (err: any) {
    console.error("❌ Patch failed:", err.message);
  } finally {
    await sql.end();
  }
}

patchBrain().catch(console.error);
