-- CHIOMA Phase 1 Production Hardening (v1.1.1)
-- Purpose: Lock the single-runtime schema and enable revenue signal capture.

-- 1. Idempotency Guard (Ingress)
CREATE TABLE IF NOT EXISTS processed_messages (
  message_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  processed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Business Onboarding State
CREATE TABLE IF NOT EXISTS employer_profiles (
  tenant_id TEXT PRIMARY KEY,
  onboarding_status TEXT NOT NULL DEFAULT 'PENDING', -- PENDING, STARTED, COMPLETED
  current_onboarding_step TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. Business Knowledge Base (Facts)
CREATE TABLE IF NOT EXISTS business_facts (
  tenant_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, key)
);

-- 4. Revenue Signal Capture (Expanded)
CREATE TABLE IF NOT EXISTS revenue_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  correlation_id TEXT NOT NULL UNIQUE,
  intent TEXT NOT NULL,
  urgency TEXT DEFAULT 'LOW',
  recommended_action TEXT,
  confidence FLOAT NOT NULL,
  message_text TEXT,
  detected_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 5. Owner Escalation & Action Loop
CREATE TABLE IF NOT EXISTS escalation_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  correlation_id TEXT NOT NULL REFERENCES revenue_signals(correlation_id),
  urgency TEXT NOT NULL,
  message_text TEXT,
  sent_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS follow_up_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  correlation_id TEXT NOT NULL REFERENCES revenue_signals(correlation_id),
  status TEXT NOT NULL DEFAULT 'PENDING',
  scheduled_for TIMESTAMP WITH TIME ZONE DEFAULT (CURRENT_TIMESTAMP + INTERVAL '24 hours'),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_revenue_tenant ON revenue_signals(tenant_id);
CREATE INDEX IF NOT EXISTS idx_escalation_tenant ON escalation_signals(tenant_id);
