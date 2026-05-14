/**
 * api/health.ts — Institutional Health Check
 * Returns deployment state, DB connectivity, and runtime version.
 */
export default async function handler(_req: any, res: any) {
  const DATABASE_URL = process.env.DATABASE_URL;
  let dbStatus = "unknown";
  
  if (DATABASE_URL) {
    try {
      const { default: postgres } = await import("postgres");
      const sql = postgres(DATABASE_URL, { max: 1, ssl: "require", connect_timeout: 5 });
      await sql`SELECT 1`;
      dbStatus = "connected";
      await sql.end();
    } catch (err) {
      dbStatus = "error";
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
    db: dbStatus,
    version: "v1.2-diagnostics",
    ts: new Date().toISOString(),
  });
}
