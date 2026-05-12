import { describe, test, expect } from "vitest";
import { mapInstruction } from "./execution-mapper.js";

/** contract: ExecutionMapperTests */
describe("ExecutionMapper", () => {
  test("should map 'send' to SEND_MESSAGE", () => {
    expect(mapInstruction("please send a message")).toBe("SEND_MESSAGE");
  });

  test("should map 'commitment' to UPDATE_COMMITMENT", () => {
    expect(mapInstruction("update my commitment")).toBe("UPDATE_COMMITMENT");
  });

  test("should map 'event' to CREATE_EVENT", () => {
    expect(mapInstruction("create new event")).toBe("CREATE_EVENT");
  });

  test("should map 'replay' to REPLAY_EVENTS", () => {
    expect(mapInstruction("replay the log")).toBe("REPLAY_EVENTS");
  });

  test("should map 'status' or 'state' to QUERY_STATE", () => {
    expect(mapInstruction("show system status")).toBe("QUERY_STATE");
    expect(mapInstruction("current state?")).toBe("QUERY_STATE");
  });

  test("should fallback to NO_OP for unknown input", () => {
    expect(mapInstruction("hello world")).toBe("NO_OP");
    expect(mapInstruction("")).toBe("NO_OP");
  });

  test("should normalize input (lowercase and trim)", () => {
    expect(mapInstruction("  SEND  ")).toBe("SEND_MESSAGE");
  });
});
