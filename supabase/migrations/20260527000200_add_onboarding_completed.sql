-- Migration: 20260527000200_add_onboarding_completed.sql
-- Phase 4.1 — Execution Kernel State Recovery

ALTER TABLE public.employer_profiles 
ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN DEFAULT false;
