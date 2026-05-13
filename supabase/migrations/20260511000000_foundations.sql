-- CHIOMA Infrastructure Foundation Recovery
-- Domain: Event Consumption & Side-Effect Reliability

-- 1. CONSUMER OFFSETS (Pointer Tracking)
CREATE TABLE IF NOT EXISTS core.consumer_offsets (
  tenant_id TEXT NOT NULL,
  consumer_group TEXT NOT NULL,
  last_position BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, consumer_group)
);

-- 2. SIDE EFFECT EXECUTION (Idempotency Tracking)
CREATE TABLE IF NOT EXISTS core.side_effect_execution (
  event_id UUID NOT NULL REFERENCES core.events(id),
  service_name TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  status TEXT NOT NULL,
  result JSONB,
  executed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (event_id, service_name)
);

CREATE INDEX IF NOT EXISTS idx_side_effect_tenant ON core.side_effect_execution(tenant_id);
