import type postgres from "postgres";
import { runAtomicStaffLoop } from "../staff-loop/atomic-runner.js";
import { createDatabaseClient } from "../../infrastructure/database/index.js";
import { validateConfig } from "../../infrastructure/config/index.js";

const MAX_RETRIES = 3;

/**
 * core/replay-engine/index.ts
 *
 * CHIOMA REPLAY ENGINE.
 * Recovers failed interactions by re-executing the staff loop from the ledger.
 */

export async function replayFailedMessages(sql: postgres.Sql) {
  console.log("[REPLAY_ENGINE] CHECKING_FOR_FAILED_MESSAGES");

  // 1. Identify candidates for recovery
  // We look for FAILED messages or PROCESSING messages that have hung for > 10 minutes.
  const failed = await sql`
    SELECT * FROM message_ledger
    WHERE (status = 'FAILED' OR (status = 'PROCESSING' AND updated_at < NOW() - INTERVAL '10 minutes'))
    AND attempt_count < ${MAX_RETRIES}
    LIMIT 10
  `;

  if (failed.length === 0) return;

  console.log(`[REPLAY_ENGINE] REPLAYING_${failed.length}_MESSAGES`);

  const config = validateConfig();

  for (const msg of failed) {
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
      // The payload in the ledger should already be the StaffLoopInput
      const input = msg.payload;
      
      const result = await runAtomicStaffLoop(input, sql, { 
        apiKey: config.LLM_API_KEY, 
        provider: config.LLM_PROVIDER 
      });

      // 4. Mark Complete
      await sql`
        UPDATE message_ledger
        SET status = 'COMPLETED',
            updated_at = NOW()
        WHERE message_id = ${msg.message_id}
      `;

      console.log(`[REPLAY_ENGINE] SUCCESS: ${msg.message_id}`);

    } catch (err: any) {
      console.error(`[REPLAY_ENGINE] FAILURE: ${msg.message_id}`, err);
      
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
