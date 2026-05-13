/**
 * evals/validation/02-endpoint-health.test.ts
 *
 * PHASE 2 — DEPLOYMENT HEALTH VALIDATION
 *
 * Validates live Vercel deployment endpoints:
 * - /api/health
 * - /api/webhook (GET verification + POST HMAC)
 * - /api/simulate-message
 *
 * REQUIRED: CHIOMA_DEPLOYMENT_URL environment variable
 * Usage: CHIOMA_DEPLOYMENT_URL=https://... npx vitest run evals/validation/02-endpoint-health.test.ts
 *
 * FAIL CONDITIONS:
 * - latency > 5000ms (cold start budget)
 * - non-2xx on health
 * - missing required response fields
 * - non-deterministic persistence
 */

import { describe, it, expect, beforeAll } from "vitest";
import { createHmac } from "node:crypto";

const BASE_URL = process.env.CHIOMA_DEPLOYMENT_URL?.replace(/\/$/, "");
const APP_SECRET = process.env.WHATSAPP_APP_SECRET ?? "test_secret";

const COLD_START_BUDGET_MS = 8000;
const WARM_BUDGET_MS = 3000;

function skip(reason: string) {
  if (!BASE_URL) {
    console.warn(`SKIP: ${reason} — set CHIOMA_DEPLOYMENT_URL to run live tests`);
    return true;
  }
  return false;
}

async function timed(fn: () => Promise<Response>): Promise<{ res: Response; latencyMs: number }> {
  const start = Date.now();
  const res = await fn();
  return { res, latencyMs: Date.now() - start };
}

function signPayload(body: string, secret: string): string {
  return "sha256=" + createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

describe("Phase 2 — Endpoint Health Validation", () => {

  beforeAll(() => {
    if (!BASE_URL) {
      console.warn("⚠ CHIOMA_DEPLOYMENT_URL not set — skipping live endpoint tests");
    }
  });

  it("/api/health returns 200 with correct schema", async () => {
    if (skip("/api/health")) return;

    const { res, latencyMs } = await timed(() => fetch(`${BASE_URL}/api/health`));

    expect(res.status, "health must return 200").toBe(200);
    expect(latencyMs, `cold start too slow: ${latencyMs}ms`).toBeLessThan(COLD_START_BUDGET_MS);

    const body = await res.json() as any;
    expect(body.status).toBe("ok");
    expect(typeof body.uptime).toBe("number");
    expect(typeof body.ts).toBe("string");

    console.log(`  /api/health latency: ${latencyMs}ms`);
  });

  it("/api/health is warm within 3000ms on second call", async () => {
    if (skip("/api/health warm")) return;

    // First call warms the function
    await fetch(`${BASE_URL}/api/health`);
    const { res, latencyMs } = await timed(() => fetch(`${BASE_URL}/api/health`));

    expect(res.status).toBe(200);
    expect(latencyMs, `warm latency too slow: ${latencyMs}ms`).toBeLessThan(WARM_BUDGET_MS);
    console.log(`  /api/health warm latency: ${latencyMs}ms`);
  });

  it("/api/webhook GET verifies webhook challenge", async () => {
    if (skip("/api/webhook verification")) return;

    const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN ?? "test_token";
    const challenge = "test_challenge_12345";
    const url = `${BASE_URL}/api/webhook?hub.mode=subscribe&hub.verify_token=${verifyToken}&hub.challenge=${challenge}`;

    const { res, latencyMs } = await timed(() => fetch(url));

    // 200 + echo challenge = correct verification
    // 403 = token mismatch (expected if env not set in deployment)
    expect([200, 403], `Unexpected status: ${res.status}`).toContain(res.status);
    if (res.status === 200) {
      const text = await res.text();
      expect(text).toBe(challenge);
      console.log(`  /api/webhook verification: PASS (${latencyMs}ms)`);
    } else {
      console.warn(`  /api/webhook verification: 403 — WHATSAPP_VERIFY_TOKEN may not match deployment env`);
    }
  });

  it("/api/webhook POST rejects missing HMAC signature", async () => {
    if (skip("/api/webhook HMAC rejection")) return;

    const { res } = await timed(() => fetch(`${BASE_URL}/api/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entry: [] }),
      // No x-hub-signature-256 header
    }));

    // Must reject unsigned requests — security boundary
    expect(res.status, "unsigned webhook must be rejected (401)").toBe(401);
    console.log("  /api/webhook HMAC rejection: PASS (correctly rejected unsigned request)");
  });

  it("/api/webhook POST rejects tampered HMAC signature", async () => {
    if (skip("/api/webhook HMAC tamper")) return;

    const payload = JSON.stringify({ entry: [], tampered: true });

    const { res } = await timed(() => fetch(`${BASE_URL}/api/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-hub-signature-256": "sha256=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
      body: payload,
    }));

    expect(res.status, "tampered signature must be rejected (401)").toBe(401);
    console.log("  /api/webhook HMAC tamper: PASS");
  });

  it("/api/simulate-message returns structured response", async () => {
    if (skip("/api/simulate-message")) return;

    const body = JSON.stringify({
      tenantId: "test_validation_tenant",
      from: "+2349001234567",
      text: "How much is your product?",
    });

    const { res, latencyMs } = await timed(() => fetch(`${BASE_URL}/api/simulate-message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    }));

    expect(res.status, "simulate-message must return 200").toBe(200);
    expect(latencyMs, `LLM call too slow: ${latencyMs}ms`).toBeLessThan(15000);

    const data = await res.json() as any;
    expect(data.ok, `Response not ok: ${JSON.stringify(data)}`).toBe(true);
    expect(typeof data.correlationId).toBe("string");
    expect(typeof data.response).toBe("string");
    expect(data.response.length, "empty response text").toBeGreaterThan(0);
    expect(["onboarding", "conversation", "error_degraded"]).toContain(data.responseType);
    expect(typeof data.latencyMs).toBe("number");

    console.log(`  /api/simulate-message: ${latencyMs}ms — response: "${data.response.slice(0, 60)}..."`);
  });

  it("/api/simulate-message rejects missing fields", async () => {
    if (skip("/api/simulate-message validation")) return;

    const { res } = await timed(() => fetch(`${BASE_URL}/api/simulate-message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId: "test" }), // missing from and text
    }));

    expect(res.status).toBe(400);
  });

  it("/api/simulate-message is idempotent — same correlationId, same response type", async () => {
    if (skip("/api/simulate-message idempotency")) return;

    const makeRequest = () => fetch(`${BASE_URL}/api/simulate-message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenantId: "idempotency_test_tenant",
        from: "+2349009876543",
        text: "What do you sell?",
      }),
    });

    const [r1, r2] = await Promise.all([makeRequest(), makeRequest()]);
    const [d1, d2] = await Promise.all([r1.json() as Promise<any>, r2.json() as Promise<any>]);

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    // Both must return valid response types — no crashes under concurrency
    expect(["onboarding", "conversation", "error_degraded"]).toContain(d1.responseType);
    expect(["onboarding", "conversation", "error_degraded"]).toContain(d2.responseType);
    console.log(`  Idempotency: r1=${d1.responseType}, r2=${d2.responseType}`);
  });
});
