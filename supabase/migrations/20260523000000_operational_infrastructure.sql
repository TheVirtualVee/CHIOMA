-- CHIOMA OPERATIONAL INFRASTRUCTURE MIGRATION
-- SCHEMA: core (Event Log), public (Operational Tables)

-- 1. Event Log Immutability Enforcement
-- We assume core.events already exists from previous bootstrap.
-- Ensure sequence_number + aggregate_id uniqueness.
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'idx_event_log_sequence') THEN
        ALTER TABLE core.events ADD CONSTRAINT idx_event_log_sequence UNIQUE (aggregate_id, sequence_number);
    END IF;
END $$;

-- 2. Concurrency Control (Fencing Tokens)
CREATE SEQUENCE IF NOT EXISTS lease_fence_seq;

CREATE TABLE IF NOT EXISTS execution_leases (
  aggregate_id TEXT PRIMARY KEY,
  worker_id TEXT NOT NULL,
  acquired_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  fencing_token BIGINT NOT NULL DEFAULT nextval('lease_fence_seq')
);

CREATE INDEX IF NOT EXISTS idx_lease_expiry ON execution_leases (expires_at);

-- 3. Event Projections (Snapshots)
CREATE TABLE IF NOT EXISTS aggregate_snapshots (
  snapshot_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregate_id TEXT NOT NULL,
  up_to_sequence INT NOT NULL,
  state JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (aggregate_id, up_to_sequence)
);

-- 4. Side-Effect Isolation System
CREATE TABLE IF NOT EXISTS side_effects (
  side_effect_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  originating_event_id UUID NOT NULL,
  idempotency_key TEXT UNIQUE NOT NULL,
  effect_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  max_attempts INT DEFAULT 5,
  attempt_count INT DEFAULT 0,
  next_attempt_at TIMESTAMP WITH TIME ZONE,
  dead_letter_at TIMESTAMP WITH TIME ZONE,
  execution_receipt_id UUID,
  worker_instance_id TEXT,
  lease_expires_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_side_effects_claim ON side_effects (status, next_attempt_at) 
WHERE status = 'PENDING';

-- 5. Execution Receipts (Immutable Proof)
CREATE TABLE IF NOT EXISTS execution_receipts (
  receipt_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  side_effect_id UUID NOT NULL REFERENCES side_effects(side_effect_id),
  attempt_number INT NOT NULL,
  executed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  outcome TEXT NOT NULL,
  external_correlation_id TEXT,
  response_payload JSONB,
  duration_ms INT,
  worker_instance_id TEXT
);

-- 6. Failure Corpus Ingestion
CREATE TABLE IF NOT EXISTS failure_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id TEXT,
  tenant_id TEXT NOT NULL,
  input_text TEXT,
  expected_behavior JSONB,
  actual_behavior JSONB,
  failure_type TEXT NOT NULL,
  metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
