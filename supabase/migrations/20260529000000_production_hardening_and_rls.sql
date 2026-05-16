-- 20260529000000_production_hardening_and_rls.sql
-- FAILURE-002: Atomic Credit Leasing
-- FAILURE-009: Tenant Isolation via Row Level Security

-- 1. ATOMIC CREDIT LEASING FUNCTION
-- Purpose: Ensures credit deduction is atomic and prevents overdrafts during bursts.
CREATE OR REPLACE FUNCTION public.lease_credit(t_id TEXT, amount INTEGER)
RETURNS JSONB AS $$
DECLARE
    new_balance INTEGER;
    instance_uuid UUID;
BEGIN
    UPDATE public.chioma_instances
    SET credit_units = credit_units - amount
    WHERE tenant_id = t_id AND credit_units >= amount
    RETURNING credit_units, instance_id INTO new_balance, instance_uuid;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'INSUFFICIENT_CREDITS');
    END IF;

    -- Log to billing ledger
    INSERT INTO public.billing_ledger (tenant_id, instance_id, event_type, credit_delta, balance_after)
    VALUES (t_id, instance_uuid, 'LLM_DEBIT', -amount, new_balance);

    RETURN jsonb_build_object('success', true, 'new_balance', new_balance);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 2. ENABLE ROW LEVEL SECURITY
-- We use current_setting('app.tenant_id') to enforce isolation.

DO $$
DECLARE
    t TEXT;
    s TEXT;
BEGIN
    FOR t IN 
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema IN ('public', 'core') 
          AND table_name IN (
            'chioma_instances', 'billing_ledger', 'daily_brief_sessions', 
            'commitments', 'customer_memory', 'delivery_queue', 
            'execution_failures', 'cea_execution_logs', 'employer_profiles',
            'events', 'projections', 'consumer_offsets', 'side_effect_execution',
            'tenant_social_profiles', 'social_posts', 'tenant_knowledge'
          )
    LOOP
        s := CASE WHEN t IN ('events', 'projections', 'consumer_offsets', 'side_effect_execution') THEN 'core' ELSE 'public' END;
        
        EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', s, t);
        EXECUTE format('ALTER TABLE %I.%I FORCE ROW LEVEL SECURITY', s, t);
        
        EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_policy ON %I.%I', s, t);
            
        EXECUTE format('CREATE POLICY tenant_isolation_policy ON %I.%I USING (tenant_id = current_setting(''app.tenant_id'', true))', s, t);
    END LOOP;
END $$;

-- 4. SOCIAL LEARNING INFRASTRUCTURE
CREATE TABLE IF NOT EXISTS public.tenant_social_profiles (
  tenant_id          TEXT        PRIMARY KEY,
  instagram_handle   TEXT,
  tiktok_handle      TEXT,
  website_url        TEXT,
  last_sync_at       TIMESTAMP WITH TIME ZONE,
  created_at         TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.social_posts (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          TEXT        NOT NULL,
  platform           TEXT        NOT NULL, -- 'instagram' | 'tiktok'
  external_id        TEXT        NOT NULL,
  content            TEXT        NOT NULL,
  published_at       TIMESTAMP WITH TIME ZONE,
  created_at         TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id, platform, external_id)
);

CREATE TABLE IF NOT EXISTS public.tenant_knowledge (
  tenant_id          TEXT        PRIMARY KEY,
  business_context   TEXT        NOT NULL, -- The learned summarization
  last_updated_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE public.chioma_instances 
  ADD COLUMN IF NOT EXISTS last_instagram_fetch TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS last_tiktok_fetch TIMESTAMP WITH TIME ZONE;

-- 5. PERMISSIONS FOR ANON ROLE (used by app with tenant client)
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA core TO anon;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO anon;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA core TO anon;
GRANT EXECUTE ON FUNCTION public.lease_credit TO anon;
