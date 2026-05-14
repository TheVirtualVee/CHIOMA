import { randomUUID } from "node:crypto";
import { runStaffLoop } from "./index.js";
import { commitEvent } from "../../infrastructure/database/index.js";
import { executeStaffDecision } from "../../services/employment-logic/index.js";
import { processOnboardingStep } from "../../services/onboarding-service/index.js";
import { StaffLoopInput, StaffLoopResult, EmployabilityProfile } from "../contracts/index.js";

export async function runAtomicStaffLoop(
  input: StaffLoopInput,
  sql: any,
  config: { apiKey: string; provider: string }
): Promise<StaffLoopResult> {
  const start = Date.now();

  try {
    const result = await sql.begin(async (tx: any) => {
      await tx`
        UPDATE message_ledger 
        SET status = 'PROCESSING', 
            updated_at = NOW(),
            payload = ${tx.json({ ...input })}
        WHERE message_id = ${input.messageId}
      `;

      const onboarding = await processOnboardingStep(tx, input.tenantId, input.messageText);
      if (!onboarding.completed) {
        await tx`UPDATE message_ledger SET status = 'COMPLETED', updated_at = NOW() WHERE message_id = ${input.messageId}`;
        return {
          responseText: onboarding.response,
          responseType: "onboarding",
          delivered: false,
          latencyMs: Date.now() - start,
          correlationId: input.correlationId,
        };
      }

      const [profile]: (EmployabilityProfile | undefined)[] = await tx`
        SELECT business_name, tone_profile, response_style, escalation_contact, working_hours 
        FROM employer_profiles WHERE tenant_id = ${input.tenantId}
      `;

      if (!profile) throw new Error("STATE_INCONSISTENCY: Onboarding complete but profile missing.");

      const existingEvent = await tx`
        SELECT payload FROM core.events 
        WHERE correlation_id = ${input.correlationId} 
        AND type = 'STAFF_ACTION_TAKEN' 
        LIMIT 1
      `;

      let loopResult: StaffLoopResult;

      if (existingEvent.length > 0) {
        const cached = existingEvent[0].payload;
        loopResult = {
          responseText: cached.response_payload || cached.text,
          responseType: "conversation",
          delivered: false,
          latencyMs: Date.now() - start,
          correlationId: input.correlationId,
          decision: { ...cached, source: "REPLAY" }
        };
      } else {
        loopResult = await runStaffLoop(input, tx, config, profile);
        
        if (loopResult.decision) {
          if (loopResult.decision.confidence < 0.7) {
            await tx`
              INSERT INTO failure_logs (message_id, tenant_id, input_text, actual_behavior, failure_type)
              VALUES (${input.messageId}, ${input.tenantId}, ${input.messageText}, ${tx.json(loopResult.decision)}, 'LOW_CONFIDENCE')
            `;
          }

          await commitEvent(tx, {
            id: randomUUID(),
            type: "STAFF_ACTION_TAKEN",
            payload: loopResult.decision,
            tenantId: input.tenantId,
            correlationId: input.correlationId,
            causationId: input.eventId,
          });
        }
      }

      if (loopResult.decision) {
        await executeStaffDecision(tx, input.tenantId, input.senderPhone, loopResult.decision, input.correlationId);
      }

      await tx`
        UPDATE message_ledger SET status = 'COMPLETED', updated_at = NOW() WHERE message_id = ${input.messageId}
      `;

      return loopResult;
    });

    return result;

  } catch (error: any) {
    console.error(`[ATOMIC_RUNNER] TRANSACTION_FAILURE: ${error.message}`);
    
    await sql`
      INSERT INTO failure_logs (message_id, tenant_id, input_text, failure_type, metadata)
      VALUES (${input.messageId}, ${input.tenantId}, ${input.messageText}, 'LOGIC_ERROR', ${sql.json({ error: error.message })})
    `;

    try {
      await sql`
        UPDATE message_ledger SET status = 'FAILED', last_error = ${error.message}, updated_at = NOW() WHERE message_id = ${input.messageId}
      `;
    } catch (ledgerErr) {}

    return {
      responseText: "I'm having a bit of trouble. Let me check that for you.",
      responseType: "error_degraded",
      delivered: false,
      latencyMs: Date.now() - start,
      correlationId: input.correlationId,
    };
  }
}
