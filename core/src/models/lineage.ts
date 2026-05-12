import type { DomainEvent } from "../contracts/events.js";

/**
 * Utility to reconstruct the causation chain and correlation tree for events.
 * Enforces Phase B Rule 3: Correlation & Lineage Visualization.
 */
export type EventNode = {
  event: DomainEvent;
  children: EventNode[];
};

export function buildCorrelationTree(events: DomainEvent[], correlationId: string): EventNode[] {
  const correlated = events.filter((e) => e.correlationId === correlationId);
  const nodeMap = new Map<string, EventNode>();

  // Initialize nodes
  for (const e of correlated) {
    nodeMap.set(e.id, { event: e, children: [] });
  }

  const roots: EventNode[] = [];

  for (const node of nodeMap.values()) {
    const causationId = node.event.causationId;
    if (causationId && nodeMap.has(causationId)) {
      nodeMap.get(causationId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

export function getCausationChain(events: DomainEvent[], targetEventId: string): DomainEvent[] {
  const chain: DomainEvent[] = [];
  let currentId: string | null = targetEventId;

  while (currentId) {
    const e = events.find((x) => x.id === currentId);
    if (!e) break;
    chain.unshift(e);
    currentId = e.causationId;
  }

  return chain;
}
