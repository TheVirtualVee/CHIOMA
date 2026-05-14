-- CHIOMA Atomic Execution Layer (v1.3)
-- Purpose: Support state-aware idempotency and crash-safe execution boundaries.

-- 1. Create message status enum
DO $$ BEGIN
    CREATE TYPE message_processing_status AS ENUM ('STARTED', 'COMPLETED', 'FAILED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 2. Upgrade processed_messages to a state machine
ALTER TABLE processed_messages 
ADD COLUMN IF NOT EXISTS status message_processing_status DEFAULT 'STARTED',
ADD COLUMN IF NOT EXISTS error_log TEXT,
ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;

-- 3. Ensure core.events exists and has index for correlation search
CREATE INDEX IF NOT EXISTS idx_events_correlation_id ON core.events (correlation_id);
CREATE INDEX IF NOT EXISTS idx_events_tenant_type ON core.events (tenant_id, type);
