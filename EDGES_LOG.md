# CHIOMA — Edge cases & invariants log

Append-only operational notes for agents and humans. Update when new edges are discovered.

## Logged edge cases (bootstrap)

1. **Multi-intent message** — A single customer message may encode several intents. The system must classify, split, or escalate; it must never silently pick one intent without an explicit policy path or human escalation.

2. **Proposed commitment fails validation** — LLM output may include `proposed_commitments` that fail ambiguity/confidence/business-feasibility gates. The commitment engine must reject creation, emit no `COMMITMENT_CREATED`, and force a regeneration path with stricter constraints (never persist a hallucinated promise).

3. **Event idempotency / replay** — The same logical event may be retried or replayed during recovery. Projections and handlers must be idempotent on `event.id` (or an explicit idempotency key) to avoid double state transitions.

4. **Delivery without business mutation** — WhatsApp send failures, retries, or duplicate delivery acks must not mutate commitments or customer memory directly; only delivery-related events and audit entries.

5. **Safety layer ordering** — Context compiler must never drop or compress the safety layer or active commitments to satisfy token budget; only warm/cold memory may be compressed when over budget.

6. **Single event type, multiple lifecycle stages** — The scaffold chains `MEMORY_UPDATED` with payload `kind` (`CONTEXT_SNAPSHOT` → `LLM_COMPLETED`) because the SSOT lists only eight top-level event types. Production should either keep this contract explicit in `core/contracts` or introduce additional immutable event types with a migration plan; handlers must never mis-handle `kind` or they will double-trigger LLM or delivery.

7. **v1.1 tenant + provenance** — `tenantId` on envelopes is mandatory for production projections; synthesis/training proposals carry `provenance[].verified_by_owner === false` until `BUSINESS_STATE_OWNER_CONFIRMED` (or equivalent) events apply patches. Cross-tenant reads are a severity-1 incident: always scope retrieval by tenant.

8. **AGENTS.md as universal entrant** — All agentic tools must treat root `AGENTS.md` as the single front door; the Engineering Constitution is the behavioral governor for the whole repo. Forks that drop `AGENTS.md` lose mandatory governance until restored.
