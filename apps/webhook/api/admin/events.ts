import { createDatabaseClient, getEventsForTenant } from "../../../../infrastructure/database/index.js";

/**
 * api/admin/events.ts
 *
 * Internal operator surface: event inspection.
 * Protected by ADMIN_SECRET header.
 */

export default async function handler(req: any, res: any) {
  const ADMIN_SECRET = process.env.CHIOMA_ADMIN_SECRET;
  const DATABASE_URL = process.env.DATABASE_URL;
  const authHeader = req.headers["x-admin-secret"];

  if (!ADMIN_SECRET || authHeader !== ADMIN_SECRET) {
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

  const sql = createDatabaseClient(DATABASE_URL, { max: 1 });
  try {
    const events = await getEventsForTenant(sql, tenantId, limit);
    return res.status(200).json({ tenantId, count: events.length, events });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  } finally {
    await sql.end();
  }
}
