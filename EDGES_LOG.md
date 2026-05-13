# CHIOMA — Operational Invariants & Edge cases

Append-only log for critical system invariants and discovered edges in the simplified runtime.

## 🧱 Core Invariants

1. **Single-Runtime Synchronicity** — The entire cognition pipeline (Onboarding → Context → LLM → Persist → Deliver) MUST execute within a single HTTP request lifecycle. Background workers and async queues are forbidden.
2. **Event-Sourced Traceability** — Every interaction MUST be committed to `core.events` before a response is delivered. The event log is the authoritative source of business memory.
3. **Institutional Idempotency** — Incoming messages must be checked against `processed_messages` using `messageId` to prevent double-processing during network retries.
4. **Tenant Isolation** — Every database query and LLM prompt MUST be scoped by `tenantId`. Cross-tenant data leakage is a critical failure.

## 🔍 Logged Edges

1. **LLM Timeout/Latency** — In the synchronous pipeline, LLM calls must have strict timeouts (<12s) to prevent the Vercel request from hanging. If an LLM call fails or times out, the system must enter "degraded mode" and notify the user to try again.
2. **Onboarding Interruptions** — Customers may send non-answer messages during onboarding. The engine must handle extraction gracefully and repeat questions if necessary rather than crashing.
3. **WhatsApp Signature Forgery** — All incoming POST requests must be validated using `x-hub-signature-256` HMAC to prevent unauthorized event injection.
4. **Simulation Divergence** — Ensure the `/api/simulate-message` path uses the EXACT same `runSyncPipeline` as the live webhook to prevent "works in simulation only" bugs.
5. **Cold Boot Latency** — First requests to a Vercel lambda may see higher latency. Ensure DB connections are reused and LLM initialization is lazy where possible.
