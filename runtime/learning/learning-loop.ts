import { RuntimeEvent } from "../ingress/event-bus.js";
// import { updateTenantKnowledge } from "../../services/business-learning/index.js";

export async function runLearningCycle(sql: any, event: RuntimeEvent, response: any) {
  // Post-interaction background learning goes here.
  // Example from Blueprint:
  // await updateTenantKnowledge(event.tenantId, { input: event.message, output: response, channel: event.source });
  
  if (event.tenantId) {
    // In future iterations, we hook up updateTenantKnowledge and updateBehaviorPatterns here
    // using background queue or immediate setImmediate to avoid blocking the orchestrator if needed.
    console.log(`[LEARNING] Learning cycle ticked for tenant: ${event.tenantId}`);
  }
}
