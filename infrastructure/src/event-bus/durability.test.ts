import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { FileAppendOnlyLog } from "./file-log.js";
import { devEvent } from "./in-memory.js";
import { EVENT_TYPES } from "@chioma/core";

describe("Event Bus Durability", () => {
  const testDir = path.join(process.cwd(), "tmp-test-events");

  beforeEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("persists events to disk and recovers them on restart", async () => {
    const log1 = new FileAppendOnlyLog(testDir, "events.jsonl");
    const event = devEvent(
      "e1",
      EVENT_TYPES.MESSAGE_RECEIVED,
      { text: "hello" },
      "c1",
      null,
      "tenant1"
    );

    await log1.append(event);
    expect(await log1.all()).toHaveLength(1);

    // Simulate service restart by creating a new instance
    const log2 = new FileAppendOnlyLog(testDir, "events.jsonl");
    expect(await log2.all()).toHaveLength(1);
    expect((await log2.all())[0].id).toBe("e1");
    expect((await log2.all())[0].tenantId).toBe("tenant1");
  });

  it("fails explicitly on log corruption", () => {
    const logFile = path.join(testDir, "events.jsonl");
    fs.mkdirSync(testDir, { recursive: true });
    fs.writeFileSync(logFile, "invalid json\n");

    expect(() => new FileAppendOnlyLog(testDir, "events.jsonl")).toThrow(/CRITICAL_BOOT_FAILURE/);
  });
});
