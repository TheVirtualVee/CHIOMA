import type postgres from "postgres";
import { runAtomicStaffLoop } from "../staff-loop/atomic-runner.js";
import { createDatabaseClient } from "../../infrastructure/database/index.js";
import { validateConfig } from "../../infrastructure/config/index.js";
import { TelemetryManager, createTraceContext } from "../telemetry/index.js";
import { randomUUID } from "node:crypto";
import { resolveInstanceByTenant } from "../routing/instance-router.js";

const MAX_RETRIES = 3;

/**
 * core/replay-engine/index.ts
 *
 * CHIOMA REPLAY ENGINE.
 * Recovers failed interactions by re-executing the staff loop from the ledger.
 */

export async function replayFailedMessages(sql: postgres.Sql) {
  const workerId = `worker_replay_${process.env.VERCEL_REGION || "local"}`;
  
  // 1. Identify candidates for recovery
  const failed = await sql`
    SELECT * FROM message_ledger
    WHERE (status = 'FAILED' OR (status = 'PROCESSING' AND updated_at < NOW() - INTERVAL '10 minutes'))
    AND attempt_count < ${MAX_RETRIES}
    LIMIT 10
  `;

  if (failed.length === 0) return;

  const config = validateConfig();

  for (const msg of failed) {
    const trace = createTraceContext(workerId);
    trace.replayId = `rpl_${randomUUID()}`;
    const telemetry = new TelemetryManager(msg.message_id, trace.traceId);
    
    telemetry.record("REPLAY_STARTED", { messageId: msg.message_id, attempt: msg.attempt_count + 1 });

    try {
      // 2. Lock for re-processing
      await sql`
        UPDATE message_ledger
        SET status = 'RETRYING',
            attempt_count = attempt_count + 1,
            updated_at = NOW()
        WHERE message_id = ${msg.message_id}
      `;

      // 3. Re-run the atomic staff loop
      const instance = await resolveInstanceByTenant(sql, msg.tenant_id);
      if (!instance) {
        throw new Error(`REPLAY_ERROR: Instance not found for tenant ${msg.tenant_id}`);
      }

      const input = {
        ...msg.payload,
        instanceId: instance.instance_id,
        tenantId: msg.tenant_id,
        traceContext: trace,
        instance,
      };
      
      await runAtomicStaffLoop(input, sql, { 
        apiKey: config.LLM_API_KEY, 
        provider: instance.llm_config.provider,
        model: instance.llm_config.model
      }, telemetry);

      // 4. Mark Complete
      await sql`
        UPDATE message_ledger
        SET status = 'COMPLETED',
            updated_at = NOW()
        WHERE message_id = ${msg.message_id}
      `;

      telemetry.complete("REPLAYED");

    } catch (err: any) {
      telemetry.record("REPLAY_FAILED", { error: err.message });
      telemetry.complete("FAILED");
      
      await sql`
        UPDATE message_ledger
        SET status = 'FAILED',
            last_error = ${err.message},
            updated_at = NOW()
        WHERE message_id = ${msg.message_id}
      `;
    }
  }
}

/**
 * Trigger function for external runners (cron/webhook)
 */
export async function triggerReplay() {
  const config = validateConfig();
  const sql = createDatabaseClient(config.DATABASE_URL, { max: 1 });
  try {
    await replayFailedMessages(sql);
  } finally {
    await sql.end();
  }
}
