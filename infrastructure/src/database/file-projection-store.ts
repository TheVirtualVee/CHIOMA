import * as fs from "fs";
import * as path from "path";
import type { EventProjectionStore } from "./stores.js";

/**
 * Persistent projection store to track applied event IDs.
 * Ensures idempotency across service restarts.
 */
export class FileEventProjectionStore implements EventProjectionStore {
  private readonly filePath: string;
  private readonly applied = new Map<string, Set<string>>();

  constructor(storageDir: string, fileName: string = "applied_events.json") {
    if (!fs.existsSync(storageDir)) {
      // SIDE EFFECT: creating storage directory.
      fs.mkdirSync(storageDir, { recursive: true });
    }
    this.filePath = path.join(storageDir, fileName);
    this.hydrate();
  }

  private hydrate(): void {
    if (!fs.existsSync(this.filePath)) return;
    try {
      const data = fs.readFileSync(this.filePath, "utf-8");
      const raw = JSON.parse(data);
      if (typeof raw === "object" && raw !== null) {
        for (const [tenantId, ids] of Object.entries(raw)) {
          if (Array.isArray(ids)) {
            this.applied.set(tenantId, new Set(ids));
          }
        }
      }
    } catch (e) {
      // Rule 3: fail explicitly on corruption.
      throw new Error(`CRITICAL_BOOT_FAILURE: Projection store corruption at ${this.filePath}. Error: ${String(e)}`);
    }
  }

  private persist(): void {
    // SIDE EFFECT: Disk write.
    const out: Record<string, string[]> = {};
    for (const [tenantId, ids] of this.applied.entries()) {
      out[tenantId] = Array.from(ids);
    }
    fs.writeFileSync(this.filePath, JSON.stringify(out));
  }

  recordApplied(tenantId: string, eventId: string): void {
    if (!tenantId) throw new Error("TENANT_ISOLATION_FAILURE: tenantId required");
    const set = this.applied.get(tenantId) ?? new Set<string>();
    if (set.has(eventId)) return;
    set.add(eventId);
    this.applied.set(tenantId, set);
    this.persist();
  }

  hasApplied(tenantId: string, eventId: string): boolean {
    if (!tenantId) throw new Error("TENANT_ISOLATION_FAILURE: tenantId required");
    return this.applied.get(tenantId)?.has(eventId) ?? false;
  }
}

export function createFileProjectionStore(storageDir: string): FileEventProjectionStore {
  return new FileEventProjectionStore(storageDir);
}
