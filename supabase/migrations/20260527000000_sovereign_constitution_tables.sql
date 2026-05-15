-- CHIOMA Migration v7 — Sovereign Constitution Tables
-- Creates 5 tables required by the Master Implementation Constitution
-- that did not exist in any prior migration.

-- ── 1. TENANTS (Root authority record per business) ───────────────────────────
-- Every chioma_instance belongs to a tenant.
-- This is the root identity for billing, isolation, and governance.
CREATE TABLE IF NOT EXISTS public.tenants (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       TEXT        NOT NULL UNIQUE,
  business_name   TEXT        NOT NULL,
  owner_phone     TEXT        NOT NULL,              -- E.164 format
  status          TEXT        NOT NULL DEFAULT 'ONBOARDING',  -- ONBOARDING | ACTIVE | SUSPENDED | EXPIRED
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_tenant_status CHECK (status IN ('ONBOARDING','ACTIVE','SUSPENDED','EXPIRED'))
);
CREATE INDEX IF NOT EXISTS idx_tenants_status  ON public.tenants(status);
CREATE INDEX IF NOT EXISTS idx_tenants_phone   ON public.tenants(owner_phone);

-- ── 2. EXECUTION BUDGETS (Runtime spend tracking per tenant) ──────────────────
-- Billing hard supremacy: budget exhaustion blocks ALL execution.
CREATE TABLE IF NOT EXISTS public.execution_budgets (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       TEXT        NOT NULL UNIQUE REFERENCES public.tenants(tenant_id) ON DELETE CASCADE,
  total_credits   NUMERIC(12,2) NOT NULL DEFAULT 0,
  used_credits    NUMERIC(12,2) NOT NULL DEFAULT 0,
  reserved_credits NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency        TEXT        NOT NULL DEFAULT 'NGN',
  hard_limit      NUMERIC(12,2) NOT NULL DEFAULT 0,
  last_recharged_at TIMESTAMP WITH TIME ZONE,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_credits_non_negative CHECK (total_credits >= 0 AND used_credits >= 0)
);

-- ── 3. RUNTIME EVENTS (Immutable append-only audit of all execution events) ───
-- Every execution emits at least one runtime event.
-- Used by founder control plane for observability.
CREATE TABLE IF NOT EXISTS public.runtime_events (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       TEXT        NOT NULL,
  instance_id     TEXT,
  event_type      TEXT        NOT NULL,
  correlation_id  TEXT,
  payload         JSONB       NOT NULL DEFAULT '{}',
  severity        TEXT        NOT NULL DEFAULT 'INFO',  -- INFO | WARN | ERROR | CRITICAL
  occurred_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_runtime_events_tenant    ON public.runtime_events(tenant_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_runtime_events_severity  ON public.runtime_events(severity, occurred_at DESC) WHERE severity IN ('ERROR','CRITICAL');
CREATE INDEX IF NOT EXISTS idx_runtime_events_type      ON public.runtime_events(event_type, tenant_id);

-- ── 4. RECOVERY QUEUE (Overdue commitment work queue for recovery worker) ──────
-- The recovery worker polls this table. Items added when commitments breach deadline.
CREATE TABLE IF NOT EXISTS public.recovery_queue (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       TEXT        NOT NULL,
  commitment_id   UUID        NOT NULL REFERENCES public.commitments(id) ON DELETE CASCADE,
  aggregate_id    TEXT        NOT NULL,
  status          TEXT        NOT NULL DEFAULT 'PENDING',  -- PENDING | IN_FLIGHT | RESOLVED | FAILED
  attempts        INTEGER     NOT NULL DEFAULT 0,
  max_attempts    INTEGER     NOT NULL DEFAULT 3,
  next_attempt_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  last_error      TEXT,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_recovery_status CHECK (status IN ('PENDING','IN_FLIGHT','RESOLVED','FAILED')),
  CONSTRAINT uq_recovery_commitment UNIQUE (commitment_id)
);
CREATE INDEX IF NOT EXISTS idx_recovery_queue_pending ON public.recovery_queue(status, next_attempt_at)
  WHERE status IN ('PENDING','IN_FLIGHT');

-- ── 5. ARBITER AUDITS (Full gate trace log for every CEA decision) ─────────────
-- Every execution verdict is logged here. Founder can inspect why a message
-- was blocked, admitted, or degraded.
CREATE TABLE IF NOT EXISTS public.arbiter_audits (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       TEXT        NOT NULL,
  instance_id     TEXT,
  message_id      TEXT        NOT NULL,
  correlation_id  TEXT,
  outcome         TEXT        NOT NULL,  -- ADMIT | BLOCK_RESPONSE | DEGRADE
  controller_triggered TEXT   NOT NULL,
  reason          TEXT        NOT NULL,
  gate_trace      JSONB       NOT NULL DEFAULT '[]',
  latency_ms      INTEGER,
  occurred_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_arbiter_audits_tenant   ON public.arbiter_audits(tenant_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_arbiter_audits_blocked  ON public.arbiter_audits(tenant_id, occurred_at DESC)
  WHERE outcome = 'BLOCK_RESPONSE';

-- ── Triggers for updated_at ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = CURRENT_TIMESTAMP; RETURN NEW; END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_tenants_updated_at') THEN
    CREATE TRIGGER trg_tenants_updated_at BEFORE UPDATE ON public.tenants FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_budgets_updated_at') THEN
    CREATE TRIGGER trg_budgets_updated_at BEFORE UPDATE ON public.execution_budgets FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_recovery_updated_at') THEN
    CREATE TRIGGER trg_recovery_updated_at BEFORE UPDATE ON public.recovery_queue FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;
