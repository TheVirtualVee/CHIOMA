-- Migration: 20260527000100_concurrency_leases.sql
-- Phase 3.3/4 — Cross-Scheduler Arbitration Table

CREATE TABLE IF NOT EXISTS public.concurrency_leases (
    aggregate_id TEXT PRIMARY KEY,       -- Format: 'conv_+234XXXXXXXXXX'
    worker_id    TEXT NOT NULL,          -- Unique ID of the executing worker/lambda
    expires_at   TIMESTAMPTZ NOT NULL,   -- Lease expiry (usually +30s)
    created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Index for garbage collection of expired leases
CREATE INDEX IF NOT EXISTS idx_leases_expiry ON public.concurrency_leases(expires_at);

-- Add safety index to chioma_instances if not exists (for faster routing)
CREATE INDEX IF NOT EXISTS idx_instances_tenant_id ON public.chioma_instances(tenant_id);
