-- CHIOMA Staff Loop Schema Alignment (v1.2.1)
-- Purpose: Add missing columns required by the Staff Loop and Onboarding Service.

-- 1. Align Employer Profiles
ALTER TABLE employer_profiles 
ADD COLUMN IF NOT EXISTS business_name TEXT,
ADD COLUMN IF NOT EXISTS response_style TEXT DEFAULT 'helpful',
ADD COLUMN IF NOT EXISTS escalation_contact TEXT,
ADD COLUMN IF NOT EXISTS working_hours JSONB DEFAULT '{"mon": "09:00-17:00", "tue": "09:00-17:00", "wed": "09:00-17:00", "thu": "09:00-17:00", "fri": "09:00-17:00", "sat": "closed", "sun": "closed"}';

-- 2. Align Customer Memory
ALTER TABLE customer_memory
ADD COLUMN IF NOT EXISTS last_customer_need TEXT,
ADD COLUMN IF NOT EXISTS current_goal TEXT;

-- 3. Ensure Onboarding Service doesn't crash on missing metadata
-- (No SQL change needed here, but keeping notes for the code fix)
