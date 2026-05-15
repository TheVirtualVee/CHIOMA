-- Migration: 20260526000000_reality_stability_layer.sql
-- Phase 3.3 — Identity Canonicalization and Commitment Leasing

-- 1. Identity Canonicalization Table
-- Maps raw phone numbers to stable business identities to prevent identity drift.
CREATE TABLE IF NOT EXISTS public.canonical_identities (
    identity_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id TEXT NOT NULL,
    sender_phone TEXT NOT NULL,
    meta_data JSONB DEFAULT '{}',
    first_seen_at TIMESTAMPTZ DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(tenant_id, sender_phone)
);

-- 2. Commitment Lease & Ownership
-- Moves from simple throttling to strict execution arbitration.
ALTER TABLE public.commitments 
ADD COLUMN IF NOT EXISTS leased_by TEXT,
ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS attempt_count INT DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_error TEXT;

-- 3. Execution Logs for Investor-Grade Telemetry
-- Specialized table for CEA audit trails to keep message_ledger lean.
CREATE TABLE IF NOT EXISTS public.cea_execution_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id TEXT NOT NULL,
    instance_id TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    outcome TEXT NOT NULL,
    controller_triggered TEXT NOT NULL,
    gate_trace JSONB NOT NULL,
    duration_ms INT NOT NULL,
    triggered_by TEXT NOT NULL,
    occurred_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for concurrency and identity lookups
CREATE INDEX IF NOT EXISTS idx_commitments_lease ON public.commitments (lease_expires_at) WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS idx_cea_fingerprint ON public.cea_execution_logs (fingerprint);
