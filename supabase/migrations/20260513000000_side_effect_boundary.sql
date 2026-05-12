-- CHIOMA Side-Effect Boundary Patch (v4.0)
-- Domain: Transactional Side-Effect Deduplication & Fencing

-- 1. SIDE-EFFECT EXECUTION REGISTRY
-- Prevents duplicate execution of non-idempotent side effects.
CREATE TABLE IF NOT EXISTS core.side_effect_execution (
  event_id UUID NOT NULL REFERENCES core.events(id),
  service_name TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'COMPLETED', 'FAILED')),
  result JSONB,
  executed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (event_id, service_name)
);

CREATE INDEX IF NOT EXISTS idx_side_effect_tenant ON core.side_effect_execution(tenant_id);

-- 2. LEASE UPGRADE WITH FENCING (GENERATION ID)
-- Prevents "Zombies" (slow workers) from committing offsets after their lease has expired.
ALTER TABLE core.consumer_offsets 
ADD COLUMN IF NOT EXISTS generation_id BIGINT NOT NULL DEFAULT 0;

-- 3. ATOMIC FENCED OFFSET UPDATE
-- Only allows offset update if the worker still holds the current generation_id.
CREATE OR REPLACE FUNCTION core.update_offset_fenced(
  t_id TEXT, 
  c_group TEXT, 
  new_pos BIGINT, 
  w_id UUID
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

-- 4. ATOMIC CLAIM UPGRADE (INCR GENERATION)
CREATE OR REPLACE FUNCTION core.try_claim_tenant_lease_v2(
  t_id TEXT, 
  c_group TEXT, 
  worker_id UUID, 
  lease_duration INTERVAL
)
RETURNS BIGINT AS $$
DECLARE
  new_gen BIGINT;
BEGIN
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
