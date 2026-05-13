# CHIOMATIC FIREWALL SPEC v1.0

This document defines the **Absolute Operational Invariants** for CHIOMA. 
These rules are deterministic, code-driven, and mathematically enforced. 
The LLM (Response Service) has ZERO authority over these constraints.

## 1. REVENUE PROTECTION INVARIANTS
- **Rule R1**: If `need_classification` is `REVENUE_NOW` or `REVENUE_SOON`, the action `IGNORE` is FORBIDDEN. System will force a `REPLY`.
- **Rule R2**: If `revenue_weight > 0.75`, the system must either `REPLY` or `ESCALATE`. It cannot `IGNORE`.

## 2. ESCALATION INVARIANTS
- **Rule E1**: If `need_classification` is `ESCALATION_REQUIRED`, the action MUST be `ESCALATE`.
- **Rule E2**: If `ESCALATE` is proposed but no `escalation_contact` exists, fallback to `REPLY` with an apology and a request for patience.
- **Rule E3**: Any message containing "human", "boss", "owner", or "complain" (case insensitive) triggers a mandatory `ESCALATE` suggestion to the rule engine.

## 3. FACTUAL INTEGRITY (PRICE LOCK)
- **Rule F1**: If the staff reply contains a currency symbol (₦, $, £) followed by numbers, and those numbers do NOT match a verified price in the `Business Knowledge`, the price must be redacted and the action changed to `ESCALATE`.

## 4. CONFIDENCE GATES
- **Rule C1**: If LLM confidence is `< 0.4` and the message is NOT a revenue signal, the action is forced to `IGNORE` or `ESCALATE` to prevent hallucinated engagement.

## 5. ZERO-MUTATION CONTRACT
- The LLM cannot directly trigger database state changes. 
- It can only return a `ProposedStaffDecision`.
- Only the `core/staff-rules` can promote a proposal to a `StaffDecision`.
