-- Add arbitration columns to chioma_instances
ALTER TABLE chioma_instances ADD COLUMN IF NOT EXISTS owner_last_seen TIMESTAMP;
ALTER TABLE chioma_instances ADD COLUMN IF NOT EXISTS response_lock_until TIMESTAMP;
ALTER TABLE chioma_instances ADD COLUMN IF NOT EXISTS owner_online_status TEXT DEFAULT 'offline';
ALTER TABLE chioma_instances ADD COLUMN IF NOT EXISTS emergency_telegram_id TEXT;

-- Create conversation_events table
CREATE TABLE IF NOT EXISTS conversation_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  actor TEXT NOT NULL CHECK (actor IN ('customer', 'chioma', 'owner', 'system')),
  message TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Create escalation_logs table
CREATE TABLE IF NOT EXISTS escalation_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  customer_message TEXT,
  trigger_keyword TEXT,
  emergency_contact_notified BOOLEAN DEFAULT FALSE,
  resolved BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_conversation_events_lookup 
ON conversation_events(tenant_id, chat_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_conversation_events_actor 
ON conversation_events(tenant_id, actor, created_at DESC);
