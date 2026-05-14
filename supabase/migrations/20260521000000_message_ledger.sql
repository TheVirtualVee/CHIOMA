-- CHIOMA Message Ledger (v1.4)
-- Purpose: Canonical truth layer for exactly-once delivery and failure recovery.

-- 1. Create message_ledger table
CREATE TABLE IF NOT EXISTS message_ledger (
  message_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  status TEXT NOT NULL, -- RECEIVED, PROCESSING, COMPLETED, FAILED, RETRYING
  attempt_count INT DEFAULT 0,
  payload JSONB, -- The original ingress payload for reconstruction
  last_error TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Indexing for the Replay Engine
CREATE INDEX IF NOT EXISTS idx_ledger_status_attempts ON message_ledger (status, attempt_count) 
WHERE status IN ('FAILED', 'PROCESSING');

-- 3. Cleanup: Move data from processed_messages if it exists, then deprecate
DO $$ BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'processed_messages') THEN
    INSERT INTO message_ledger (message_id, tenant_id, status, created_at)
    SELECT message_id, tenant_id, 
           CASE WHEN status = 'STARTED' THEN 'PROCESSING' ELSE status::text END, 
           processed_at 
    FROM processed_messages
    ON CONFLICT (message_id) DO NOTHING;
  END IF;
END $$;
