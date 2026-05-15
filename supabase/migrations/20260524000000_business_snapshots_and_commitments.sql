-- CHIOMA Migration v6 — Business Snapshots & Commitments
-- CRITICAL: business_snapshots and commitments are referenced throughout
-- atomic-runner.ts, reality/governor.ts, and the recovery worker, but
-- neither table existed in any prior migration. Every INSERT into commitments
-- and every SELECT from business_snapshots was silently failing with a
-- PostgreSQL "relation does not exist" error, causing EXECUTION_HALTED.

-- ── Business Snapshots (BRSE — Reality Source of Truth) ──────────────────────
-- Stores daily owner-confirmed business state snapshots.
-- 'LOCKED' = active truth used for all new conversations.
-- 'HISTORICAL' = used to resolve commitment context at time-of-promise.

CREATE TABLE IF NOT EXISTS public.business_snapshots (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       TEXT        NOT NULL,
  snapshot_data   JSONB       NOT NULL DEFAULT '{}',
  status          TEXT        NOT NULL DEFAULT 'DRAFT',  -- DRAFT | LOCKED | HISTORICAL
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  locked_at       TIMESTAMP WITH TIME ZONE,
  notes           TEXT,
  CONSTRAINT chk_snapshot_status CHECK (status IN ('DRAFT', 'LOCKED', 'HISTORICAL'))
);

CREATE INDEX IF NOT EXISTS idx_snapshots_tenant_locked
  ON public.business_snapshots(tenant_id, locked_at DESC)
  WHERE status = 'LOCKED';

CREATE INDEX IF NOT EXISTS idx_snapshots_tenant_status
  ON public.business_snapshots(tenant_id, status);

-- ── Commitments (Accountability Ledger) ──────────────────────────────────────
-- Stores PROMISE_MADE and SCHEDULE_FOLLOWUP obligations.
-- Linked to the snapshot that was active when the promise was made.
-- Recovery worker monitors this table for overdue commitments.

CREATE TABLE IF NOT EXISTS public.commitments (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           TEXT        NOT NULL,
  aggregate_id        TEXT        NOT NULL,   -- conversation aggregate (conv_+phone)
  type                TEXT        NOT NULL,   -- PROMISE_MADE | SCHEDULE_FOLLOWUP
  status              TEXT        NOT NULL DEFAULT 'PENDING',  -- PENDING | FULFILLED | OVERDUE | CANCELLED
  deadline_at         TIMESTAMP WITH TIME ZONE NOT NULL,
  correlation_id      TEXT        NOT NULL,
  context             JSONB       NOT NULL DEFAULT '{}',
  originating_event_id TEXT,
  snapshot_id         UUID        REFERENCES public.business_snapshots(id) ON DELETE SET NULL,
  recovery_attempts   INTEGER     NOT NULL DEFAULT 0,
  last_recovery_at    TIMESTAMP WITH TIME ZONE,
  fulfilled_at        TIMESTAMP WITH TIME ZONE,
  created_at          TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_commitment_status CHECK (status IN ('PENDING', 'FULFILLED', 'OVERDUE', 'CANCELLED')),
  CONSTRAINT chk_commitment_type   CHECK (type   IN ('PROMISE_MADE', 'SCHEDULE_FOLLOWUP'))
);

CREATE INDEX IF NOT EXISTS idx_commitments_tenant_status
  ON public.commitments(tenant_id, status, deadline_at);

CREATE INDEX IF NOT EXISTS idx_commitments_overdue
  ON public.commitments(tenant_id, deadline_at)
  WHERE status = 'PENDING';

CREATE INDEX IF NOT EXISTS idx_commitments_aggregate
  ON public.commitments(aggregate_id, tenant_id);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_commitments_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_commitments_updated_at ON public.commitments;
CREATE TRIGGER trg_commitments_updated_at
  BEFORE UPDATE ON public.commitments
  FOR EACH ROW EXECUTE FUNCTION update_commitments_updated_at();
