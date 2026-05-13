/**
 * api/health.ts — Operational health check
 * Returns runtime readiness signal. Used by Render, Vercel, and monitoring.
 */

export default function handler(_req: Request): Response {
  return new Response(
    JSON.stringify({
      status: "ok",
      service: "chioma-webhook",
      ts: new Date().toISOString(),
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    },
  );
}
