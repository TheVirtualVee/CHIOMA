-- CHIOMA Migration: Missing operational tables (v1.5)
-- Fixes: employment-logic/index.ts references owner_notifications and
-- customer_opportunities which were never created. Any ESCALATE or REVENUE_NOW
-- action crashed the atomic transaction, producing silent 200 failures.

-- 1. OWNER NOTIFICATIONS
-- Created when staff engine detects an ESCALATE action.
CREATE TABLE IF NOT EXISTS owner_notifications (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       TEXT        NOT NULL,
  correlation_id  TEXT        NOT NULL,
  urgency         TEXT        NOT NULL,  -- LOW | MEDIUM | HIGH | URGENT
  message_text    TEXT        NOT NULL,
  notified        BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_owner_notif_tenant
  ON owner_notifications(tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_owner_notif_unread
  ON owner_notifications(tenant_id)
  WHERE notified = FALSE;

-- 2. CUSTOMER OPPORTUNITIES
-- Created for REVENUE_NOW / REVENUE_SOON signals. Tracks hot leads.
CREATE TABLE IF NOT EXISTS customer_opportunities (
  id                  UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           TEXT    NOT NULL,
  correlation_id      TEXT    NOT NULL,
  customer_need       TEXT    NOT NULL,
  urgency             TEXT    NOT NULL,
  recommended_action  TEXT    NOT NULL,
  confidence          NUMERIC(4,3) NOT NULL,
  status              TEXT    NOT NULL DEFAULT 'OPEN',  -- OPEN | CONVERTED | LOST
  created_at          TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_opportunity_correlation UNIQUE (correlation_id)
);

CREATE INDEX IF NOT EXISTS idx_opportunities_tenant
  ON customer_opportunities(tenant_id, status, created_at DESC);
