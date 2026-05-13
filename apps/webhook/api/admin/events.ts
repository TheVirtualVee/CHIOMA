/**
 * api/admin/events.ts — Internal operator surface: event inspection
 *
 * INTENT: Allow operator to inspect the event log for a tenant.
 * Protected by ADMIN_SECRET header. Internal only — never customer-facing.
 *
 * SIDE EFFECT: Supabase read. Why necessary: operational visibility.
 */

import { 
  createSupabaseEventLog, 
  createConsoleLogger, 
  createDatabaseClient 
} from "@chioma/infrastructure";

const logger = createConsoleLogger("admin-events");
const ADMIN_SECRET = process.env.CHIOMA_ADMIN_SECRET;
const DATABASE_URL = process.env.DATABASE_URL;

export default async function handler(req: any, res: any) {
  // ASSERT: admin secret must match — this is internal tooling only
  const authHeader = req.headers["x-admin-secret"];
  if (!ADMIN_SECRET || authHeader !== ADMIN_SECRET) {
    logger.warn("ADMIN_UNAUTHORIZED", { path: "/admin/events" });
    return res.status(401).send("Unauthorized");
  }

  if (!DATABASE_URL) {
    return res.status(500).json({ error: "DATABASE_URL not configured" });
  }

  const tenantId = req.query.tenantId;
  const limit = Math.min(parseInt(req.query.limit ?? "50", 10), 200);

  if (!tenantId) {
    return res.status(400).json({ error: "tenantId query param required" });
  }

  // ASSERT: tenant isolation enforced — only requested tenant's events returned
  const sql = await createDatabaseClient(DATABASE_URL, { max: 1 });
  try {
    const log = createSupabaseEventLog(sql);
    const events = await log.getHistory(tenantId);
    const sliced = events.slice(-limit);

    return res.status(200).json({ tenantId, count: sliced.length, events: sliced });
  } finally {
    await sql.end();
  }
}
