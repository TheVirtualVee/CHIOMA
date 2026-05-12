/** contract: ExecutionIntent */
export type ExecutionIntent =
  | "CREATE_EVENT"
  | "UPDATE_COMMITMENT"
  | "QUERY_STATE"
  | "SEND_MESSAGE"
  | "REPLAY_EVENTS"
  | "NO_OP";

export function mapInstruction(input: string): ExecutionIntent {
  const normalized = input.toLowerCase().trim();

  if (normalized.includes("send") || normalized.includes("message")) {
    return "SEND_MESSAGE";
  }
  
  if (normalized.includes("commitment")) {
    return "UPDATE_COMMITMENT";
  }
  
  if (normalized.includes("event")) {
    return "CREATE_EVENT";
  }
  
  if (normalized.includes("replay")) {
    return "REPLAY_EVENTS";
  }
  
  if (normalized.includes("status") || normalized.includes("state")) {
    return "QUERY_STATE";
  }

  return "NO_OP";
}
