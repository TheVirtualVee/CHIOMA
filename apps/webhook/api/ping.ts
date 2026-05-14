/**
 * api/ping.ts — Minimal liveness probe.
 * Returns immediately with no DB or external calls.
 * Used by Vercel/Render health checks for cold-start verification.
 */
export default function handler(_req: any, res: any) {
  res.status(200).json({ ok: true, ts: Date.now() });
}
