/**
 * api/health.ts — Operational health check
 * Returns runtime readiness signal. Used by Render, Vercel, and monitoring.
 */

export default function handler(_req: any, res: any) {
  res.status(200).json({
    status: "ok",
    service: "chioma-webhook",
    ts: new Date().toISOString(),
  });
}
