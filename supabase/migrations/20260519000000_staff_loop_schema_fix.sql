-- CHIOMA Staff Loop Schema Alignment (v1.2.1)
-- Purpose: Ensure all tables and columns required by the Staff Loop exist.

-- 1. Ensure Employer Profiles exists and has all required columns
CREATE TABLE IF NOT EXISTS employer_profiles (
  tenant_id TEXT PRIMARY KEY,
  onboarding_status TEXT NOT NULL DEFAULT 'PENDING',
  current_onboarding_step TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE employer_profiles 
ADD COLUMN IF NOT EXISTS business_name TEXT,
ADD COLUMN IF NOT EXISTS tone_profile TEXT DEFAULT 'friendly-shopkeeper',
ADD COLUMN IF NOT EXISTS response_style TEXT DEFAULT 'helpful',
ADD COLUMN IF NOT EXISTS escalation_contact TEXT,
ADD COLUMN IF NOT EXISTS working_hours JSONB DEFAULT '{"mon": "09:00-17:00", "tue": "09:00-17:00", "wed": "09:00-17:00", "thu": "09:00-17:00", "fri": "09:00-17:00", "sat": "closed", "sun": "closed"}',
ADD COLUMN IF NOT EXISTS response_aggressiveness TEXT DEFAULT 'medium',
ADD COLUMN IF NOT EXISTS follow_up_policy TEXT DEFAULT 'soft',
ADD COLUMN IF NOT EXISTS availability_mode TEXT DEFAULT 'always-on',
ADD COLUMN IF NOT EXISTS conversion_bias TEXT DEFAULT 'medium',
ADD COLUMN IF NOT EXISTS owner_preference_memory JSONB DEFAULT '{}';

-- 2. Ensure Customer Memory exists and has all required columns
CREATE TABLE IF NOT EXISTS customer_memory (
  tenant_id TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  last_intent TEXT,
  unresolved_count INTEGER DEFAULT 0,
  conversion_status TEXT DEFAULT 'PROSPECT',
  metadata JSONB DEFAULT '{}',
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, customer_phone)
);

ALTER TABLE customer_memory
ADD COLUMN IF NOT EXISTS last_customer_need TEXT,
ADD COLUMN IF NOT EXISTS current_goal TEXT;

-- 3. Ensure Business Facts exists
CREATE TABLE IF NOT EXISTS business_facts (
  tenant_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, key)
);

-- 4. Ensure Processed Messages exists
CREATE TABLE IF NOT EXISTS processed_messages (
  message_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  processed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
