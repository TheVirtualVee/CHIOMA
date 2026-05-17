-- Migration: Webhook & Ingress Resolution Hardening
-- 1. Bindings for Telegram Bot Token, owner seen timestamp, and response locks in chioma_instances
ALTER TABLE public.chioma_instances 
ADD COLUMN IF NOT EXISTS telegram_bot_token TEXT,
ADD COLUMN IF NOT EXISTS owner_last_seen TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS response_lock_until TIMESTAMP WITH TIME ZONE;

-- 2. Bindings for Telegram Owner Chat IDs and timing settings in tenants
ALTER TABLE public.tenants 
ADD COLUMN IF NOT EXISTS owner_telegram_ids TEXT[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS auto_respond_threshold_minutes INTEGER DEFAULT 5,
ADD COLUMN IF NOT EXISTS slow_response_threshold_seconds INTEGER DEFAULT 30,
ADD COLUMN IF NOT EXISTS override_lock_seconds INTEGER DEFAULT 10;

-- 3. Timing markers in customer_memory
ALTER TABLE public.customer_memory 
ADD COLUMN IF NOT EXISTS last_chioma_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS last_owner_at TIMESTAMP WITH TIME ZONE;

-- 4. Idempotency unique constraint on delivery_queue trace_id
ALTER TABLE public.delivery_queue 
ADD CONSTRAINT uniq_delivery_queue_trace_id UNIQUE (trace_id);

-- 5. Ingress Event Logging Table
CREATE TABLE IF NOT EXISTS public.conversation_events (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          TEXT        NOT NULL,
  channel            TEXT,
  channel_chat_id    TEXT,
  channel_user_id    TEXT,
  sender_actor       TEXT,
  resolved_actor     TEXT,
  arbitration_reason TEXT,
  message            TEXT        NOT NULL,
  created_at         TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_conversation_events_tenant_chat 
  ON public.conversation_events(tenant_id, channel_chat_id, created_at DESC);
