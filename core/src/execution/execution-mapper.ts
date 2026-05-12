/** contract: ExecutionIntent */
export type ExecutionIntent =
  | "CREATE_EVENT"
  | "UPDATE_COMMITMENT"
  | "QUERY_STATE"
  | "SEND_MESSAGE"
  | "REPLAY_EVENTS"
  | "PRICE_INQUIRY"
  | "RETENTION_SIGNAL"
  | "REPEAT_LAST_ACTION"
  | "ESCALATE_TO_LLM"
  | "UNCLASSIFIED";

import { resolveIntent } from "./resolution-engine.js";

export function mapInstruction(
  input: string,
  context: { tenantId: string; lastIntent?: string } = { tenantId: "default" }
): ExecutionIntent {
  return resolveIntent(input, context);
}
