-- CHIOMA Employability Layer Upgrade (v1.2)
-- Purpose: Support persistent employability profiles, customer memory, and financially accountable staff behavior.

-- 1. Upgrade Employer Profiles with Employability Traits
ALTER TABLE employer_profiles 
ADD COLUMN IF NOT EXISTS tone_profile TEXT DEFAULT 'friendly-shopkeeper', -- casual | formal | street-smart | luxury | friendly-shopkeeper
ADD COLUMN IF NOT EXISTS response_aggressiveness TEXT DEFAULT 'medium', -- low | medium | high
ADD COLUMN IF NOT EXISTS follow_up_policy TEXT DEFAULT 'soft', -- disabled | soft | aggressive
ADD COLUMN IF NOT EXISTS availability_mode TEXT DEFAULT 'always-on', -- always-on | business-hours-aware | owner-away-priority
ADD COLUMN IF NOT EXISTS conversion_bias TEXT DEFAULT 'medium', -- low | medium | high
ADD COLUMN IF NOT EXISTS owner_preference_memory JSONB DEFAULT '{}';

-- 2. Customer Interaction Memory (Persistence of Conversation State)
CREATE TABLE IF NOT EXISTS customer_memory (
  tenant_id TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  last_intent TEXT,
  unresolved_count INTEGER DEFAULT 0,
  conversion_status TEXT DEFAULT 'PROSPECT', -- PROSPECT | CUSTOMER | LOST
  metadata JSONB DEFAULT '{}',
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, customer_phone)
);

-- 3. Employability Audit Trace
CREATE TABLE IF NOT EXISTS employability_traces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  correlation_id TEXT NOT NULL UNIQUE,
  decision_type TEXT NOT NULL, -- reply | escalate | follow_up | hold
  tone_applied TEXT NOT NULL,
  revenue_weight FLOAT DEFAULT 0.0,
  urgency_level INTEGER DEFAULT 1,
  next_action_logic TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_customer_memory_tenant ON customer_memory(tenant_id);
CREATE INDEX IF NOT EXISTS idx_employability_trace_tenant ON employability_traces(tenant_id);
