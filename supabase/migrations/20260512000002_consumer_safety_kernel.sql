-- CHIOMA Consumer Safety Kernel Patch (v3.0)
-- Domain: Distributed Execution Coordination & Lease Management

-- 1. COORDINATION LAYER UPGRADE
-- Adds lease-based locking to prevent multi-worker race conditions on the same tenant stream.
ALTER TABLE core.consumer_offsets 
ADD COLUMN IF NOT EXISTS leased_by UUID,
ADD COLUMN IF NOT EXISTS leased_until TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_consumer_offsets_lease ON core.consumer_offsets(leased_until);

-- 2. ATOMIC CLAIM FUNCTION
-- Ensures exactly-one worker can claim a tenant's event stream at a time.
-- Uses 'optimistic locking' via leased_until check.
CREATE OR REPLACE FUNCTION core.try_claim_tenant_lease(
  t_id TEXT, 
  c_group TEXT, 
  worker_id UUID, 
  lease_duration INTERVAL
)
RETURNS BOOLEAN AS $$
DECLARE
  claim_success BOOLEAN;
BEGIN
  UPDATE core.consumer_offsets
  SET 
    leased_by = worker_id,
    leased_until = CURRENT_TIMESTAMP + lease_duration,
    updated_at = CURRENT_TIMESTAMP
  WHERE 
    tenant_id = t_id AND 
    consumer_group = c_group AND 
    (leased_until IS NULL OR leased_until < CURRENT_TIMESTAMP OR leased_by = worker_id);
  
  GET DIAGNOSTICS claim_success = ROW_COUNT;
  RETURN claim_success > 0;
END;
$$ LANGUAGE plpgsql;

-- 3. LEASE RELEASE FUNCTION
CREATE OR REPLACE FUNCTION core.release_tenant_lease(t_id TEXT, c_group TEXT, worker_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE core.consumer_offsets
  SET leased_until = NULL
  WHERE tenant_id = t_id AND consumer_group = c_group AND leased_by = worker_id;
END;
$$ LANGUAGE plpgsql;
