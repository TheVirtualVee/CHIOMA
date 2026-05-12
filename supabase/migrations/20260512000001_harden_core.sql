-- CHIOMA Supabase Hardening Patch (v2.0)
-- Domain: Core Execution & Infrastructure Invariants

-- 1. HARD EVENT IMMUTABILITY
-- Prevents any modification or deletion of historical events to guarantee audit integrity.
CREATE OR REPLACE FUNCTION core.prevent_event_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'EVENTS_IMMUTABLE: Cannot modify or delete historical events';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER enforce_event_immutability
BEFORE UPDATE OR DELETE ON core.events
FOR EACH ROW EXECUTE FUNCTION core.prevent_event_mutation();


-- 2. SINGLE ACTIVE ECB ENFORCEMENT
-- Guarantees that only ONE Execution Contract Bundle can govern the system at any given time.
CREATE UNIQUE INDEX single_active_ecb_idx ON core.ecb_registry (is_active) WHERE is_active = true;


-- 3. EVENT ORDERING GUARANTEE
-- Adds a strict global sequence to ensure deterministic replay, independent of clock drift.
ALTER TABLE core.events ADD COLUMN global_position BIGSERIAL UNIQUE NOT NULL;
CREATE INDEX idx_events_global_position ON core.events(global_position ASC);


-- 4. STRICT TENANT ISOLATION
-- Replaces the no-op 'allow all' RLS with strict JWT claim binding.
-- Note: While service_role bypasses this, this enforces the contract for all standard connections.
DROP POLICY IF EXISTS tenant_isolation_policy ON core.events;
DROP POLICY IF EXISTS projection_isolation_policy ON core.projections;

CREATE POLICY strict_tenant_isolation_events ON core.events
  FOR ALL
  USING (tenant_id = current_setting('request.jwt.claims', true)::json->>'tenant_id')
  WITH CHECK (tenant_id = current_setting('request.jwt.claims', true)::json->>'tenant_id');

CREATE POLICY strict_tenant_isolation_projections ON core.projections
  FOR ALL
  USING (tenant_id = current_setting('request.jwt.claims', true)::json->>'tenant_id')
  WITH CHECK (tenant_id = current_setting('request.jwt.claims', true)::json->>'tenant_id');
