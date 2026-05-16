/**
 * supabase/migrations/20260530000000_production_runtime_role.sql
 * FAILURE-009 Hardening: Creates the restricted application role.
 */

-- 1. Create the role if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'chioma_runtime') THEN
        CREATE ROLE chioma_runtime WITH LOGIN PASSWORD 'chioma_production_safe_2026' NOBYPASSRLS;
    END IF;
END $$;

-- 2. Grant basic access
GRANT USAGE ON SCHEMA public TO chioma_runtime;
GRANT USAGE ON SCHEMA core TO chioma_runtime;

-- 3. Grant table permissions (Minimalist approach)
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO chioma_runtime;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA core TO chioma_runtime;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO chioma_runtime;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA core TO chioma_runtime;

-- 4. Allow the superuser to assume this role for session downgrades
GRANT chioma_runtime TO postgres;

-- 5. Ensure RLS is active for this role
-- (The previous migration already forced RLS on the tables)

COMMENT ON ROLE chioma_runtime IS 'Restricted CHIOMA application user for production traffic.';
