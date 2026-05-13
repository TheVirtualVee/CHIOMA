-- CHIOMA Production Schema (Supabase/Postgres)
-- Enforces tenant isolation, event durability, and auditability.

-- 1. Events table (Immutable Log)
CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    payload JSONB NOT NULL,
    correlation_id TEXT NOT NULL,
    causation_id TEXT,
    tenant_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for tenant-scoped replay and audit
CREATE INDEX IF NOT EXISTS idx_events_tenant_id ON events(tenant_id);
CREATE INDEX IF NOT EXISTS idx_events_correlation_id ON events(correlation_id);

-- 2. Projections Applied (Idempotency Guard)
CREATE TABLE IF NOT EXISTS projections_applied (
    tenant_id TEXT NOT NULL,
    event_id TEXT NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, event_id)
);

-- 3. Commitments (Read Model)
CREATE TABLE IF NOT EXISTS commitments (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    type TEXT NOT NULL,
    status TEXT NOT NULL,
    severity TEXT NOT NULL,
    deadline_iso TIMESTAMPTZ NOT NULL,
    data JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_commitments_tenant_id ON commitments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_commitments_status ON commitments(status);

-- 4. Dead Letter Queue
CREATE TABLE IF NOT EXISTS dead_letter_queue (
    id BIGSERIAL PRIMARY KEY,
    event_id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    error TEXT NOT NULL,
    service TEXT NOT NULL,
    failed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    event_payload JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_dlq_tenant_id ON dead_letter_queue(tenant_id);

-- 5. Employer Profiles (Operational Intelligence)
CREATE TABLE IF NOT EXISTS employer_profiles (
    tenant_id TEXT PRIMARY KEY,
    business_name TEXT,
    category TEXT,
    working_hours TEXT,
    delivery_capability BOOLEAN DEFAULT FALSE,
    escalation_contact TEXT,
    onboarding_status TEXT DEFAULT 'PENDING', -- PENDING, STARTED, COMPLETED
    current_onboarding_step TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. Operational Memory (Behavioral Intelligence)
CREATE TABLE IF NOT EXISTS operational_memory (
    tenant_id TEXT PRIMARY KEY,
    tone_profile JSONB NOT NULL DEFAULT '{}',
    high_value_items JSONB NOT NULL DEFAULT '[]',
    preferred_languages JSONB NOT NULL DEFAULT '["English"]',
    urgency_rules JSONB NOT NULL DEFAULT '{}',
    away_mode_enabled BOOLEAN DEFAULT FALSE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. Failed Ingestion (Dead Letter Ingress)
CREATE TABLE IF NOT EXISTS failed_events (
    id BIGSERIAL PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    raw_payload JSONB NOT NULL,
    headers JSONB NOT NULL,
    error TEXT NOT NULL,
    failed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. Message Deduplication (Idempotency)
CREATE TABLE IF NOT EXISTS processed_messages (
    message_id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_processed_tenant_id ON processed_messages(tenant_id);

-- Enable RLS (Row Level Security) for Tenant Isolation
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE projections_applied ENABLE ROW LEVEL SECURITY;
ALTER TABLE commitments ENABLE ROW LEVEL SECURITY;
ALTER TABLE dead_letter_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE employer_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE operational_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE failed_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE processed_messages ENABLE ROW LEVEL SECURITY;

-- Rule: Policies should be created during bootstrap based on tenant authentication.
-- For now, we enforce tenant_id in all queries at the application layer as well.
