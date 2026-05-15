# CHIOMA — EDGES_LOG.md

## Material Edge Cases & Discovered Boundaries

### 1. Recovery Ledger Idempotency [DISCOVERED: 2026-05-15]
- **Risk**: If a message turn fails and is ledgered, but the recovery worker succeeds and then crashes before marking the ledger as 'RECOVERED', the message may be sent twice.
- **Guard**: Execution Kernel must check for `message_id` deduplication at the start of `execute`.
- **Status**: Monitored.

### 2. Billing Desync during Bursts [DISCOVERED: 2026-05-15]
- **Risk**: The Arbiter checks credits in the Kernel (Pre-inference), but the actual deduction happens in the Staff Loop (Post-inference). A rapid burst of messages could allow a tenant to exceed their credit limit before the first deduction is persisted.
- **Guard**: Implement a "Pending Credit" lease in the Arbiter or move deduction to Gate 1.
- **Status**: Risk accepted for Pilot phase.

### 3. State Computation DB Dependency [DISCOVERED: 2026-05-15]
- **Risk**: The `computeState` function in the Kernel is heavily dependent on the database. If the DB is under load, state computation fails, triggering a `DEGRADED` response even for simple greetings.
- **Guard**: Implement a lightweight local cache for Tenant/Instance metadata to allow greeting bypass even during DB brownouts.
- **Status**: TBD.
