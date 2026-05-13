/**
 * api/health.ts — Operational health check
 * Returns runtime readiness signal. Used by Render, Vercel, and monitoring.
 */
export default function handler(_req) {
    return new Response(JSON.stringify({
        status: "ok",
        service: "chioma-webhook",
        uptime: process.uptime(),
        ts: new Date().toISOString(),
    }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
    });
}
//# sourceMappingURL=health.js.map