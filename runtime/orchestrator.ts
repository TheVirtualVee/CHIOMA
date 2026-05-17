import { RuntimeEvent } from "./ingress/event-bus.js";
import { runArbitration } from "./core/arbitration-service.js";
import { executeDecision } from "./executor/execution-engine.js";
import { runLearningCycle } from "./learning/learning-loop.js";

export async function processEvent(sql: any, event: RuntimeEvent, config: any) {
  // STEP 1: ARBITRATION
  const decision = await runArbitration(sql, event);

  // STEP 2: EXECUTION
  const response = await executeDecision(sql, event, decision, config);

  // STEP 3: LEARNING (always runs, even on NONE)
  await runLearningCycle(sql, event, response);

  return response;
}
