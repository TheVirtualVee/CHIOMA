-- Migration: 20260527000300_delivery_guarantee_layer.sql
-- Phase 4.2 — Delivery Guarantee Layer (DGL)

CREATE TABLE IF NOT EXISTS public.delivery_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trace_id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    instance_id TEXT NOT NULL,
    recipient TEXT NOT NULL,
    payload_json JSONB NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('PENDING', 'RETRYING', 'FAILED', 'SENT')),
    retry_count INTEGER DEFAULT 0,
    last_error TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_delivery_queue_status ON public.delivery_queue(status);
CREATE INDEX IF NOT EXISTS idx_delivery_queue_tenant ON public.delivery_queue(tenant_id);
