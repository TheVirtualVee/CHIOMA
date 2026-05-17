import postgres from "postgres";

/**
 * api/health.ts — Operational health check.
 * Static import of postgres — dynamic import causes bundler resolution issues.
 */
export default async function handler(_req: any, res: any) {
  const DATABASE_URL = process.env.DATABASE_URL;
  let dbStatus = "unknown";

  if (DATABASE_URL) {
    let sql: ReturnType<typeof postgres> | null = null;
    try {
      sql = postgres(DATABASE_URL, { max: 1, ssl: "require", connect_timeout: 5 });
      await sql`SELECT 1`;
      dbStatus = "connected";
    } catch {
      dbStatus = "error";
    } finally {
      if (sql) await sql.end().catch(() => {});
    }
  } else {
    dbStatus = "missing_config";
  }

  res.status(dbStatus === "connected" ? 200 : 503).json({
    ok: dbStatus === "connected",
    whatsappConfigured: !!process.env.WHATSAPP_APP_SECRET,
    tokenPresent: !!process.env.WHATSAPP_ACCESS_TOKEN,
    verifyTokenPresent: !!process.env.WHATSAPP_VERIFY_TOKEN,
    llmConfigured: !!process.env.LLM_API_KEY,
    telegramBotTokenPresent: !!process.env.TELEGRAM_BOT_TOKEN,
    telegramFounderIdPresent: !!process.env.TELEGRAM_FOUNDER_ID,
    telegramAdminUserIdPresent: !!process.env.TELEGRAM_ADMIN_USER_ID,
    telegramTenantIdPresent: !!process.env.TELEGRAM_TENANT_ID,
    db: dbStatus,
    version: "v1.3-stable",
    ts: new Date().toISOString(),
  });
}
