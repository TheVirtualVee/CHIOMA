import { validateConfig } from "../../../infrastructure/config/index.js";
import { createDatabaseClient } from "../../../infrastructure/database/index.js";
import { processOverdueCommitments } from "../../../core/commitments/worker.js";

/**
 * apps/webhook/api/recovery-cron.ts
 * Purpose: Scheduled entry point for the Commitment Recovery Worker.
 */
export default async function handler(req: any, res: any) {
  // 🧠 CRITICAL: Only allow POST or GET depending on cron config
  // In production, verify the CRON_SECRET header from Vercel.
  
  try {
    const config = validateConfig();
    const sql = createDatabaseClient(config.DATABASE_URL, { max: 1 });

    try {
      console.log(`[RECOVERY_CRON] Starting pulse...`);
      const result = await processOverdueCommitments(sql, {
        apiKey: config.LLM_API_KEY,
        provider: config.LLM_PROVIDER
      });

      console.log(`[RECOVERY_CRON] Finished. Processed: ${result.processed}`);
      
      return res.status(200).json({ 
        ok: true, 
        processed: result.processed,
        timestamp: new Date().toISOString() 
      });

    } finally {
      // Ensure DB client is closed to prevent pool leakage in serverless
      await sql.end();
    }
  } catch (err: any) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[RECOVERY_CRON_FATAL]`, err);
    return res.status(500).json({ ok: false, error: msg });
  }
}
