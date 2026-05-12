import type { DomainEvent } from "@chioma/core";

export type EventProjectionStore = {
  /** Append-only projection of applied events (ids only for scaffold). */
  recordApplied: (eventId: string) => void;
  hasApplied: (eventId: string) => boolean;
};

export function createInMemoryProjectionStore(): EventProjectionStore {
  const applied = new Set<string>();
  return {
    recordApplied(id) {
      applied.add(id);
    },
    hasApplied(id) {
      return applied.has(id);
    },
  };
}

export type ReadModelStore = {
  getLastEvent: () => DomainEvent | undefined;
  setLastEvent: (e: DomainEvent) => void;
};

export function createReadModelStore(): ReadModelStore {
  let last: DomainEvent | undefined;
  return {
    getLastEvent: () => last,
    setLastEvent: (e) => {
      last = e;
    },
  };
}
