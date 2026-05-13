/**
 * api/admin/events.ts — Internal operator surface: event inspection
 *
 * INTENT: Allow operator to inspect the event log for a tenant.
 * Protected by ADMIN_SECRET header. Internal only — never customer-facing.
 *
 * SIDE EFFECT: Supabase read. Why necessary: operational visibility.
 */

import { createSupabaseEventLog } from "@chioma/infrastructure";
import { createConsoleLogger } from "@chioma/infrastructure";

const logger = createConsoleLogger("admin-events");
const ADMIN_SECRET = process.env.CHIOMA_ADMIN_SECRET;
const DATABASE_URL = process.env.DATABASE_URL;

export default async function handler(req: Request): Promise<Response> {
  // ASSERT: admin secret must match — this is internal tooling only
  const authHeader = req.headers.get("x-admin-secret");
  if (!ADMIN_SECRET || authHeader !== ADMIN_SECRET) {
    logger.warn("ADMIN_UNAUTHORIZED", { path: "/admin/events" });
    return new Response("Unauthorized", { status: 401 });
  }

  if (!DATABASE_URL) {
    return new Response(JSON.stringify({ error: "DATABASE_URL not configured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const url = new URL(req.url);
  const tenantId = url.searchParams.get("tenantId");
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50", 10), 200);

  if (!tenantId) {
    return new Response(JSON.stringify({ error: "tenantId query param required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // ASSERT: tenant isolation enforced — only requested tenant's events returned
  const log = createSupabaseEventLog(DATABASE_URL);
  const events = await log.getHistory(tenantId);
  const sliced = events.slice(-limit);

  return new Response(
    JSON.stringify({ tenantId, count: sliced.length, events: sliced }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}
