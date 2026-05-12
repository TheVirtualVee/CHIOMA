import { describe, expect, it } from "vitest";
import { buildCorrelationTree, getCausationChain } from "./lineage.js";
import { createEvent, createFollowupEvent } from "../contracts/events.js";
import { EVENT_TYPES } from "../contracts/events.js";

describe("Event Lineage Reconstruction", () => {
  it("builds a correlation tree from flat event list", () => {
    const e1 = createEvent(EVENT_TYPES.MESSAGE_RECEIVED, {}, "t1", "c1");
    const e2 = createFollowupEvent(EVENT_TYPES.INTENT_CLASSIFIED, {}, e1);
    const e3 = createFollowupEvent(EVENT_TYPES.COMMITMENT_CREATED, {}, e2);
    
    const tree = buildCorrelationTree([e1, e2, e3], "c1");
    
    expect(tree).toHaveLength(1);
    expect(tree[0].event.id).toBe(e1.id);
    expect(tree[0].children).toHaveLength(1);
    expect(tree[0].children[0].event.id).toBe(e2.id);
    expect(tree[0].children[0].children[0].event.id).toBe(e3.id);
  });

  it("reconstructs causation chain for a target event", () => {
    const e1 = createEvent(EVENT_TYPES.MESSAGE_RECEIVED, {}, "t1", "c1");
    const e2 = createFollowupEvent(EVENT_TYPES.INTENT_CLASSIFIED, {}, e1);
    const e3 = createFollowupEvent(EVENT_TYPES.COMMITMENT_CREATED, {}, e2);

    const chain = getCausationChain([e1, e2, e3], e3.id);
    
    expect(chain).toHaveLength(3);
    expect(chain[0].id).toBe(e1.id);
    expect(chain[1].id).toBe(e2.id);
    expect(chain[2].id).toBe(e3.id);
  });
});
