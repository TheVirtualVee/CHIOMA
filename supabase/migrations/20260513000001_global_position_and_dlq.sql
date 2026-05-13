-- CHIOMA Migration v5.0
-- Adds global_position to core.events for efficient consumer worker polling.
-- Also adds dead_letter_queue table referenced by SupabaseDeadLetterStore.

-- 1. GLOBAL POSITION SEQUENCE
-- Enables consumers to poll "events since position N" efficiently.
-- Using a BIGSERIAL column on a partitioned-style approach for ordering.
ALTER TABLE core.events
  ADD COLUMN IF NOT EXISTS global_position BIGSERIAL;

CREATE INDEX IF NOT EXISTS idx_events_global_position
  ON core.events(global_position);

CREATE INDEX IF NOT EXISTS idx_events_tenant_position
  ON core.events(tenant_id, global_position);

-- 2. DEAD LETTER QUEUE TABLE
-- Referenced by SupabaseDeadLetterStore. Events that failed max retries.
CREATE TABLE IF NOT EXISTS core.dead_letter_queue (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        UUID        NOT NULL,
  tenant_id       TEXT        NOT NULL,
  error           TEXT        NOT NULL,
  service         TEXT        NOT NULL,
  failed_at       TIMESTAMP WITH TIME ZONE NOT NULL,
  event_payload   JSONB       NOT NULL,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_dlq_tenant     ON core.dead_letter_queue(tenant_id);
CREATE INDEX IF NOT EXISTS idx_dlq_failed_at  ON core.dead_letter_queue(failed_at DESC);

ALTER TABLE core.dead_letter_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY dlq_service_role_policy ON core.dead_letter_queue
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 3. CONSUMER OFFSETS — ensure generation_id default is safe for upgrade path
-- (migration 003 adds generation_id — this is a safe no-op if already applied)
ALTER TABLE core.consumer_offsets
  ALTER COLUMN generation_id SET DEFAULT 0;

-- 4. PROJECTION ALIASES
-- supabase.ts references "projections_applied" but migration 001 created "projections".
-- Create a view alias so both code paths work during transition.
CREATE OR REPLACE VIEW core.projections_applied AS
  SELECT tenant_id, event_id, applied_at
  FROM core.projections;
