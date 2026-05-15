/**
 * evals/validation/06-concurrency-stress.test.ts
 *
 * FAILURE MODE: Two WhatsApp webhooks arrive for the same messageId within
 * milliseconds (Meta retry behavior). Both must not produce duplicate responses.
 *
 * FAILURE MODE: Two messages from the same phone number arrive simultaneously.
 * The lease system must serialize them — second must wait or return "in progress".
 *
 * FAILURE MODE: Recovery worker fires while customer is actively typing.
 * Worker and live message must not produce conflicting state.
 */

import { describe, it, expect } from "vitest";
import { acquireLease, releaseLease } from "../../core/concurrency/index.js";

// ── In-memory SQL stub ──────────────────────────────────────────────────────
// Simulates Supabase lease table behaviour without a live DB.
// ONLY used here because leasing logic is pure table operations.

function makeLeaseSqlStub() {
  const leases: Record<string, {
    aggregate_id: string;
    worker_id: string;
    expires_at: Date;
    fencing_token: number;
    lease_id: string;
    acquired_at: string;
  }> = {};
  let seq = 0;

  // Tagged template literal stub — matches the postgres.js API shape
  const sql: any = async (strings: TemplateStringsArray, ...values: any[]) => {
    const query = strings.join("?").toLowerCase();

    if (query.includes("insert into execution_leases")) {
      const [aggregateId, workerId] = values;
      const existing = leases[aggregateId];

      // ON CONFLICT DO UPDATE WHERE expires_at < NOW()
      if (existing && existing.expires_at > new Date()) {
        return []; // Lease held — INSERT returns nothing
      }

      seq++;
      const record = {
        aggregate_id: aggregateId,
        worker_id: workerId,
        expires_at: new Date(Date.now() + 30_000),
        fencing_token: seq,
        lease_id: `lease_${seq}`,
        acquired_at: new Date().toISOString(),
      };
      leases[aggregateId] = record;
      return [record];
    }

    if (query.includes("delete from execution_leases")) {
      const [aggregateId, workerId, fencingToken] = values;
      const existing = leases[aggregateId];
      if (existing && existing.worker_id === workerId && existing.fencing_token === fencingToken) {
        delete leases[aggregateId];
        return [{ count: 1 }];
      }
      return [{ count: 0 }];
    }

    return [];
  };

  // Give the stub a .begin() that passes itself through (leasing doesn't use transactions)
  sql.begin = async (fn: (tx: any) => Promise<any>) => fn(sql);

  return sql;
}

describe("Phase 2 — Concurrency Stress", () => {

  it("duplicate messageId: second acquireLease returns null (not a second execution)", async () => {
    // FAILURE MODE: Meta sends same webhook twice. Both enter acquireLease for same aggregateId.
    // Only the first must succeed. The second must get null — no execution, no duplicate send.
    const sql = makeLeaseSqlStub();
    const aggregateId = "conv_+2348001234567";
    const worker1 = "worker_vercel_1";
    const worker2 = "worker_vercel_2";

    const lease1 = await acquireLease(sql, aggregateId, worker1);
    const lease2 = await acquireLease(sql, aggregateId, worker2);

    expect(lease1).not.toBeNull();
    expect(lease1?.fencingToken).toBe(1);
    // Second worker must be denied — lease is held
    expect(lease2).toBeNull();
  });

  it("fencing token increments monotonically — no rollback possible", async () => {
    // FAILURE MODE: Worker crash and restart re-acquires a stale lease with
    // an old fencing token, allowing a zombie worker to corrupt state.
    // Fencing tokens must always increase — never reuse.
    const sql = makeLeaseSqlStub();
    const aggregateId = "conv_+2347001111111";
    const workerId = "worker_vercel_1";

    const lease1 = await acquireLease(sql, aggregateId, workerId);
    expect(lease1).not.toBeNull();

    // Release the lease (simulates successful completion)
    await releaseLease(sql, aggregateId, workerId, lease1!.fencingToken);

    // Re-acquire (simulates next message)
    const lease2 = await acquireLease(sql, aggregateId, workerId);
    expect(lease2).not.toBeNull();

    // Token must be strictly greater — no rollback
    expect(lease2!.fencingToken).toBeGreaterThan(lease1!.fencingToken);
  });

  it("concurrent acquireLease calls for different aggregates are independent", async () => {
    // FAILURE MODE: Two customers message simultaneously. Their conversations
    // must be isolated — no cross-contamination of lease state.
    const sql = makeLeaseSqlStub();

    const [lease1, lease2] = await Promise.all([
      acquireLease(sql, "conv_+2348001111111", "worker_1"),
      acquireLease(sql, "conv_+2348002222222", "worker_2"),
    ]);

    // Both must succeed — they are independent aggregates
    expect(lease1).not.toBeNull();
    expect(lease2).not.toBeNull();
    expect(lease1!.fencingToken).not.toBe(lease2!.fencingToken);
  });

  it("recovery worker cannot acquire lease held by live conversation", async () => {
    // FAILURE MODE: Recovery worker fires for a customer who is actively messaging.
    // Worker must be blocked — live conversation takes precedence.
    const sql = makeLeaseSqlStub();
    const aggregateId = "conv_+2349001234567";

    // Live conversation acquires lease
    const liveLease = await acquireLease(sql, aggregateId, "worker_live");
    expect(liveLease).not.toBeNull();

    // Recovery worker tries to acquire same aggregate
    const recoveryLease = await acquireLease(sql, aggregateId, "worker_recovery_cron");
    expect(recoveryLease).toBeNull(); // Must be blocked
  });
});
