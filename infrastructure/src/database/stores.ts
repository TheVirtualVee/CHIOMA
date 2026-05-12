import type { DomainEvent } from "@chioma/core";

export type EventProjectionStore = {
  /** constraint: tenant-scoped event idempotency */
  recordApplied: (tenantId: string, eventId: string) => Promise<void>;
  hasApplied: (tenantId: string, eventId: string) => Promise<boolean>;
};

export function createInMemoryProjectionStore(): EventProjectionStore {
  const applied = new Map<string, Set<string>>();
  return {
    async recordApplied(tenantId, eventId) {
      if (!tenantId) throw new Error("TENANT_ISOLATION_FAILURE: tenantId required");
      const set = applied.get(tenantId) ?? new Set<string>();
      set.add(eventId);
      applied.set(tenantId, set);
    },
    async hasApplied(tenantId, eventId) {
      if (!tenantId) throw new Error("TENANT_ISOLATION_FAILURE: tenantId required");
      return applied.get(tenantId)?.has(eventId) ?? false;
    },
  };
}

export type ReadModelStore = {
  getLastEvent: (tenantId: string) => Promise<DomainEvent | undefined>;
  setLastEvent: (tenantId: string, e: DomainEvent) => Promise<void>;
};

export function createReadModelStore(): ReadModelStore {
  const lastEvents = new Map<string, DomainEvent>();
  return {
    getLastEvent: async (tenantId) => {
      if (!tenantId) throw new Error("TENANT_ISOLATION_FAILURE: tenantId required");
      return lastEvents.get(tenantId);
    },
    setLastEvent: async (tenantId, e) => {
      if (!tenantId) throw new Error("TENANT_ISOLATION_FAILURE: tenantId required");
      if (e.tenantId !== tenantId) throw new Error("TENANT_ISOLATION_FAILURE: event tenantId mismatch");
      lastEvents.set(tenantId, e);
    },
  };
}

export type DeadLetterEntry = {
  event: DomainEvent;
  error: string;
  failedAt: string;
  service: string;
};

export type DeadLetterStore = {
  store: (entry: DeadLetterEntry) => void;
  all: () => readonly DeadLetterEntry[];
};

export function createInMemoryDeadLetterStore(): DeadLetterStore {
  const entries: DeadLetterEntry[] = [];
  return {
    store: (e) => entries.push(e),
    all: () => Object.freeze([...entries]),
  };
}
