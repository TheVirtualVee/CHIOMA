-- CHIOMA Baseline Migration (v1.1)
-- Purpose: Establish core event-sourced infrastructure, tenant isolation, and distributed coordination.

CREATE SCHEMA IF NOT EXISTS core;

-- 1. IMMUTABLE EVENT LOG
CREATE TABLE IF NOT EXISTS core.events (
  global_position BIGSERIAL PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  payload JSONB NOT NULL,
  correlation_id TEXT NOT NULL,
  causation_id TEXT,
  tenant_id TEXT NOT NULL,
  occurred_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_events_tenant_id ON core.events(tenant_id);
CREATE INDEX IF NOT EXISTS idx_events_correlation_id ON core.events(correlation_id);
CREATE INDEX IF NOT EXISTS idx_events_occurred_at ON core.events(occurred_at);

-- 2. IDEMPOTENCY PROJECTIONS
CREATE TABLE IF NOT EXISTS core.projections (
  tenant_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  applied_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, event_id)
);

-- 3. CONSUMER OFFSETS (Distributed Leases & Fencing)
CREATE TABLE IF NOT EXISTS core.consumer_offsets (
  tenant_id TEXT NOT NULL,
  consumer_group TEXT NOT NULL,
  last_position BIGINT NOT NULL DEFAULT 0,
  generation_id BIGINT NOT NULL DEFAULT 0,
  leased_by TEXT,
  leased_until TIMESTAMP WITH TIME ZONE,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, consumer_group)
);

-- 4. SIDE-EFFECT EXECUTION (Idempotency Tracking)
CREATE TABLE IF NOT EXISTS core.side_effect_execution (
  event_id TEXT NOT NULL REFERENCES core.events(id),
  service_name TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'COMPLETED', 'FAILED')),
  result JSONB,
  executed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (event_id, service_name)
);

CREATE INDEX IF NOT EXISTS idx_side_effect_tenant ON core.side_effect_execution(tenant_id);

-- 5. COORDINATION FUNCTIONS

-- Atomic Fenced Offset Update
CREATE OR REPLACE FUNCTION core.update_offset_fenced(
  t_id TEXT, 
  c_group TEXT, 
  new_pos BIGINT, 
  w_id TEXT
)
RETURNS BOOLEAN AS $$
DECLARE
  update_success BOOLEAN;
BEGIN
  UPDATE core.consumer_offsets
  SET 
    last_position = new_pos,
    updated_at = CURRENT_TIMESTAMP
  WHERE 
    tenant_id = t_id AND 
    consumer_group = c_group AND 
    leased_by = w_id AND 
    leased_until >= CURRENT_TIMESTAMP;
  
  GET DIAGNOSTICS update_success = ROW_COUNT;
  RETURN update_success > 0;
END;
$$ LANGUAGE plpgsql;

-- Atomic Claim Upgrade (Increment Generation)
CREATE OR REPLACE FUNCTION core.try_claim_tenant_lease_v2(
  t_id TEXT, 
  c_group TEXT, 
  worker_id TEXT, 
  lease_duration INTERVAL
)
RETURNS BIGINT AS $$
DECLARE
  new_gen BIGINT;
BEGIN
  -- Upsert ensuring the consumer group exists for the tenant
  INSERT INTO core.consumer_offsets (tenant_id, consumer_group)
  VALUES (t_id, c_group)
  ON CONFLICT (tenant_id, consumer_group) DO NOTHING;

  UPDATE core.consumer_offsets
  SET 
    leased_by = worker_id,
    leased_until = CURRENT_TIMESTAMP + lease_duration,
    generation_id = generation_id + 1,
    updated_at = CURRENT_TIMESTAMP
  WHERE 
    tenant_id = t_id AND 
    consumer_group = c_group AND 
    (leased_until IS NULL OR leased_until < CURRENT_TIMESTAMP OR leased_by = worker_id)
  RETURNING generation_id INTO new_gen;
  
  RETURN COALESCE(new_gen, 0);
END;
$$ LANGUAGE plpgsql;

-- Voluntary Lease Release
CREATE OR REPLACE FUNCTION core.release_tenant_lease(
  t_id TEXT, 
  c_group TEXT, 
  worker_id TEXT
)
RETURNS VOID AS $$
BEGIN
  UPDATE core.consumer_offsets
  SET 
    leased_by = NULL,
    leased_until = NULL,
    updated_at = CURRENT_TIMESTAMP
  WHERE 
    tenant_id = t_id AND 
    consumer_group = c_group AND 
    leased_by = worker_id;
END;
$$ LANGUAGE plpgsql;
