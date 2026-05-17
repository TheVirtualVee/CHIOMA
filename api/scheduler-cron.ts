import { validateConfig } from "@chioma/infrastructure/config/index.js";
import { createDatabaseClient } from "@chioma/infrastructure/database/index.js";
import { runSchedulerCycle } from "../runtime/scheduler/orchestrator.js";

/**
 * CHIOMA Runtime Scheduler v1
 * Triggered via Vercel Cron Jobs every 5 minutes
 */
export default async function handler(req: any, res: any) {
  // CRON_SECRET verification
  const cronSecret = req.headers['x-cron-secret'];
  if (process.env.NODE_ENV === 'production' && cronSecret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  res.status(200).json({ ok: true, startedAt: new Date().toISOString() });
  
  // Run async
  setImmediate(async () => {
    let sql;
    try {
      const config = validateConfig();
      sql = createDatabaseClient(config.DATABASE_URL, { max: 1 });
      await runSchedulerCycle(sql, config);
    } catch (err) {
      console.error(`[SCHEDULER_CRON] Exec failed:`, err);
    } finally {
      await sql?.end().catch(() => {});
    }
  });
}
