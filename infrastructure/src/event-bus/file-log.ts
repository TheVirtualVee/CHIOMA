import * as fs from "fs";
import * as path from "path";
import { assertDomainEvent, type DomainEvent } from "@chioma/core";
import type { AppendOnlyEventLog } from "./in-memory.js";

/**
 * Production-grade file-based event log.
 * Ensures event durability by appending to a JSONL file.
 * Recovers state by reading the file on startup.
 */
export class FileAppendOnlyLog implements AppendOnlyEventLog {
  private readonly filePath: string;
  private readonly events: DomainEvent[] = [];

  constructor(storageDir: string, fileName: string = "events.jsonl") {
    if (!fs.existsSync(storageDir)) {
      // SIDE EFFECT: creating storage directory. Why necessary and unavoidable: ensure persistence location exists.
      fs.mkdirSync(storageDir, { recursive: true });
    }
    this.filePath = path.join(storageDir, fileName);
    this.hydrate();
  }

  private hydrate(): void {
    if (!fs.existsSync(this.filePath)) return;

    const data = fs.readFileSync(this.filePath, "utf-8");
    const lines = data.split("\n").filter((l) => l.trim().length > 0);

    for (const line of lines) {
      try {
        const raw = JSON.parse(line);
        const event = assertDomainEvent(raw);
        this.events.push(event);
      } catch (e) {
        // Rule 2: No silent failures. However, if a single line is corrupt, 
        // we might want to log it and continue or fail the whole boot.
        // For CHIOMA, boot failure is safer than silent data loss.
        throw new Error(`CRITICAL_BOOT_FAILURE: Event log corruption detected at ${this.filePath}. Error: ${String(e)}`);
      }
    }
  }

  async append(event: DomainEvent): Promise<void> {
    // Rule 15: Preserve event lineage.
    this.events.push(event);
    
    // SIDE EFFECT: Disk write. Why necessary and unavoidable: enforce durability.
    const line = JSON.stringify(event) + "\n";
    // We use appendFileSync for durability guarantee in this simple implementation,
    // but the interface is now async for future-proofing.
    fs.appendFileSync(this.filePath, line);
  }

  async all(): Promise<readonly DomainEvent[]> {
    return Object.freeze([...this.events]);
  }
}

export function createFileLog(storageDir: string): FileAppendOnlyLog {
  return new FileAppendOnlyLog(storageDir);
}
