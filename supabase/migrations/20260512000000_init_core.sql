-- CHIOMA Unified Bootstrap SQL (v1.0)
-- Domain: Core Execution & Infrastructure

-- 1. Schema Definition
CREATE SCHEMA IF NOT EXISTS core;

-- 2. Events Table (Append-only Log)
CREATE TABLE IF NOT EXISTS core.events (
  id UUID PRIMARY KEY,
  type TEXT NOT NULL,
  payload JSONB NOT NULL,
  correlation_id TEXT NOT NULL,
  causation_id TEXT,
  tenant_id TEXT NOT NULL,
  occurred_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_events_tenant_id ON core.events(tenant_id);
CREATE INDEX IF NOT EXISTS idx_events_correlation_id ON core.events(correlation_id);

-- 3. Projections Table (Idempotency & State Tracking)
CREATE TABLE IF NOT EXISTS core.projections (
  tenant_id TEXT NOT NULL,
  event_id UUID NOT NULL REFERENCES core.events(id),
  applied_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, event_id)
);

-- 4. ECB Registry (Versioned Execution Contract Bundles)
CREATE TABLE IF NOT EXISTS core.ecb_registry (
  version TEXT PRIMARY KEY,
  bundle JSONB NOT NULL,
  is_active BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 5. Tenant Isolation Layer (RLS)
ALTER TABLE core.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.projections ENABLE ROW LEVEL SECURITY;

-- Default Policy: Access restricted to service_role by default 
-- (Infrastructure agents use service_role to manage multi-tenant streams)
CREATE POLICY tenant_isolation_policy ON core.events
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY projection_isolation_policy ON core.projections
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- 6. Helper Functions
CREATE OR REPLACE FUNCTION core.apply_event_projection(t_id TEXT, e_id UUID)
RETURNS VOID AS $$
BEGIN
  INSERT INTO core.projections (tenant_id, event_id)
  VALUES (t_id, e_id)
  ON CONFLICT DO NOTHING;
END;
$$ LANGUAGE plpgsql;
