/**
 * supabase/migrations/20260531000000_fix_delivery_ledger.sql
 * FAILURE-002: Hardening the Delivery Ledger.
 */

-- 1. Add missing delivered_at column
ALTER TABLE public.delivery_queue 
ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMP WITH TIME ZONE;

-- 2. Add index for performance reporting
CREATE INDEX IF NOT EXISTS idx_delivery_queue_delivered_at ON public.delivery_queue(delivered_at);

COMMENT ON COLUMN public.delivery_queue.delivered_at IS 'The exact timestamp the gateway confirmed delivery.';
