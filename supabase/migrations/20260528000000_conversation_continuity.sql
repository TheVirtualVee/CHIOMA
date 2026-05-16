-- CHIOMA Migration v8 — Conversation Continuity Schema
-- Adds columns required for deterministic state machine:
--   message_count: number of messages this customer has sent (greeting regression guard)
--   tone_state:    last detected customer emotional state (tone persistence)
--   last_tone:     simple tone label for quick injection (CALM | FRUSTRATED | URGENT | HAPPY)

ALTER TABLE public.customer_memory
  ADD COLUMN IF NOT EXISTS message_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tone_state    TEXT    NOT NULL DEFAULT 'CALM',
  ADD COLUMN IF NOT EXISTS last_tone     TEXT;

-- Index: fast lookup for greeting regression guard
-- (is this a returning customer? message_count > 0)
CREATE INDEX IF NOT EXISTS idx_customer_memory_returning
  ON public.customer_memory(tenant_id, customer_phone)
  WHERE message_count > 0;
