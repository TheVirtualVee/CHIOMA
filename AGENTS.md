# CHIOMA — Agent entry and universal governance

All agentic coding systems (Cursor, Claude Code, Codex, other IDE agents, automation that edits this repo) MUST use this file as the **single front door** before making any change.

## Universal governor (behavior and execution)

The **Engineering Execution Constitution** is the universal behavioral governor for the entire codebase. It overrides convenience, style preferences, and speculative features when they conflict with reliability, trust continuity, or architectural discipline.

Canonical copy:

- `.cursor/rules/chioma-engineering-constitution.mdc`

## Mandatory reading order (do not skip)

Read in this order before planning or editing:

1. `.cursor/rules/chioma-engineering-constitution.mdc` — reliability, no silent failure, event sourcing, LLM non-authority, commitments first, observability, solo-founder operability, production vs stub discipline.
2. `.cursor/rules/chioma-system-ssot.mdc` — product and system architecture source of truth.
3. `.cursor/rules/chioma-continuation-v1-1.mdc` — v1.1 additive evolution (no re-engineering stable foundations).
4. `.cursor/rules/llm-coding-directive.mdc` — contract-first, tests, surgical edits, audit trace expectations.

### If rules appear to conflict

- **Safety, reliability, observability, “never guess”** — follow the **Constitution**.
- **What CHIOMA is and service boundaries** — follow the **SSOT**.
- **Agreed v1.1 evolution** — follow **continuation v1.1**.
- **How to write and verify code** — follow the **LLM coding directive**.

If still ambiguous: stop, ask the human, or open a minimal design note in the PR description; do not invent resolution silently.

## Hard gates (never violate)

- No silent failures: errors must be observable, explainable, and not swallowed.
- Event-sourced boundaries: no hidden cross-service state coupling; state transitions via events and contracts.
- LLMs are non-authoritative: proposals only until validation and event-driven truth.
- Commitments and tenant isolation are protected; never weaken validation gates for speed.
- Do not redesign stable foundations without explicit human approval.

## Repo quick map

- Packages: `core/`, `infrastructure/`, `services/*`, `workers/*`, `cli/chioma-init/`, `evals/`, `config/`, `tools/`.
- Trust and CI: `npm test`, `npm run build`; evals under `evals/trust/`.

## EDGES and operational memory

- `EDGES_LOG.md` — append material edge cases discovered during work (multi-tenant, replay, synthesis provenance, etc.).
