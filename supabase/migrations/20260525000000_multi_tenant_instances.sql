CREATE TABLE IF NOT EXISTS public.chioma_instances (
  instance_id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            TEXT        NOT NULL UNIQUE,
  whatsapp_phone_number       TEXT        NOT NULL,
  whatsapp_phone_number_id    TEXT        NOT NULL UNIQUE,
  billing_state        TEXT        NOT NULL DEFAULT 'ACTIVE',
  credit_units         INTEGER     NOT NULL DEFAULT 100,
  business_model_version TEXT      NOT NULL DEFAULT '1.0',
  llm_provider         TEXT        NOT NULL DEFAULT 'groq',
  llm_model            TEXT        NOT NULL DEFAULT 'llama-3.3-70b-versatile',
  memory_namespace     TEXT        NOT NULL,
  created_at           TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at           TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_billing_state CHECK (billing_state IN ('ACTIVE', 'PAUSED', 'EXPIRED')),
  CONSTRAINT chk_credit_units  CHECK (credit_units >= 0)
);

CREATE INDEX IF NOT EXISTS idx_instances_phone_number_id
  ON public.chioma_instances(whatsapp_phone_number_id);

CREATE INDEX IF NOT EXISTS idx_instances_tenant
  ON public.chioma_instances(tenant_id);

CREATE TABLE IF NOT EXISTS public.daily_brief_sessions (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       TEXT        NOT NULL,
  status          TEXT        NOT NULL DEFAULT 'AWAITING_INPUT',
  raw_input       TEXT,
  parsed_snapshot JSONB,
  confirmed_at    TIMESTAMP WITH TIME ZONE,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_brief_status CHECK (status IN ('AWAITING_INPUT', 'AWAITING_CONFIRMATION', 'CONFIRMED', 'CANCELLED'))
);

CREATE INDEX IF NOT EXISTS idx_brief_sessions_tenant_status
  ON public.daily_brief_sessions(tenant_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.billing_ledger (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       TEXT        NOT NULL,
  instance_id     UUID        NOT NULL REFERENCES public.chioma_instances(instance_id),
  event_type      TEXT        NOT NULL,
  credit_delta    INTEGER     NOT NULL,
  balance_after   INTEGER     NOT NULL,
  correlation_id  TEXT,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_event_type CHECK (event_type IN ('LLM_DEBIT', 'TOPUP', 'ADJUSTMENT', 'SYSTEM'))
);

CREATE INDEX IF NOT EXISTS idx_billing_ledger_tenant
  ON public.billing_ledger(tenant_id, created_at DESC);

CREATE OR REPLACE FUNCTION update_instance_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_instance_updated_at ON public.chioma_instances;
CREATE TRIGGER trg_instance_updated_at
  BEFORE UPDATE ON public.chioma_instances
  FOR EACH ROW EXECUTE FUNCTION update_instance_updated_at();

ALTER TABLE public.commitments
  ADD COLUMN IF NOT EXISTS worker_id          TEXT,
  ADD COLUMN IF NOT EXISTS lease_expires_at   TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS attempt_count      INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS resolved_at        TIMESTAMP WITH TIME ZONE;
