import { type ExecutionIntent } from "./execution-mapper.js";

/** contract: IntentDefinition */
export type IntentDefinition = {
  id: ExecutionIntent;
  version: string;
  priority: number;
  deprecated: boolean;
  patterns: string[];
};

/** contract: IntentRegistry */
export const intentRegistry: IntentDefinition[] = [
  {
    id: "PRICE_INQUIRY",
    version: "1.0.0",
    priority: 100,
    deprecated: false,
    patterns: ["how much", "price", "cost", "buy"],
  },
  {
    id: "RETENTION_SIGNAL",
    version: "1.0.0",
    priority: 90,
    deprecated: false,
    patterns: ["expensive", "too much", "not sure"],
  },
  {
    id: "REPEAT_LAST_ACTION",
    version: "1.0.0",
    priority: 80,
    deprecated: false,
    patterns: ["usual", "again", "repeat"],
  },
  {
    id: "SEND_MESSAGE",
    version: "1.0.0",
    priority: 70,
    deprecated: false,
    patterns: ["send", "message"],
  },
  {
    id: "UPDATE_COMMITMENT",
    version: "1.0.0",
    priority: 60,
    deprecated: false,
    patterns: ["commitment"],
  },
  {
    id: "CREATE_EVENT",
    version: "1.0.0",
    priority: 50,
    deprecated: false,
    patterns: ["event"],
  },
  {
    id: "REPLAY_EVENTS",
    version: "1.0.0",
    priority: 40,
    deprecated: false,
    patterns: ["replay"],
  },
  {
    id: "QUERY_STATE",
    version: "1.0.0",
    priority: 30,
    deprecated: false,
    patterns: ["status", "state"],
  },
  {
    id: "ESCALATE_TO_LLM",
    version: "1.0.0",
    priority: 10,
    deprecated: false,
    patterns: ["but", "maybe", "depends", "?"],
  },
];
