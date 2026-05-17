-- SECTION 2: DATABASE SCHEMA (CLEAN BOUNDARIES)

-- 2.1 Tenant Identity Table (Core)
CREATE TABLE IF NOT EXISTS tenants (
  tenant_id TEXT PRIMARY KEY,
  business_name TEXT NOT NULL,
  business_model_version TEXT DEFAULT 'v1',
  
  -- Brand & Tone
  tone_profile TEXT DEFAULT 'professional',
  response_style TEXT DEFAULT 'friendly',
  business_description TEXT,
  
  -- Owner(s) - multiple allowed
  owner_telegram_ids TEXT[] DEFAULT '{}',
  owner_whatsapp_numbers TEXT[] DEFAULT '{}',
  owner_emails TEXT[] DEFAULT '{}',
  
  -- Escalation
  emergency_telegram_id TEXT,
  emergency_phone TEXT,
  emergency_email TEXT,
  
  -- CHIOMA Behavior
  auto_respond_threshold_minutes INTEGER DEFAULT 5,
  slow_response_threshold_seconds INTEGER DEFAULT 30,
  override_lock_seconds INTEGER DEFAULT 10,
  
  -- State
  onboarding_status TEXT DEFAULT 'STARTED',
  onboarding_completed BOOLEAN DEFAULT FALSE,
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- 2.2 Tenant Instance Table (Runtime Config)
CREATE TABLE IF NOT EXISTS tenant_instances (
  instance_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT REFERENCES tenants(tenant_id),
  
  -- Channel bindings
  telegram_bot_token TEXT,
  telegram_bot_username TEXT,
  whatsapp_phone_number TEXT,
  whatsapp_phone_number_id TEXT,
  
  -- Runtime state (arbitration)
  owner_last_seen TIMESTAMP,
  owner_online_status TEXT DEFAULT 'offline',
  response_lock_until TIMESTAMP,
  
  -- Billing & Credits
  billing_state TEXT DEFAULT 'ACTIVE',
  credit_units INTEGER DEFAULT 50,
  
  -- LLM Config
  llm_provider TEXT DEFAULT 'groq',
  llm_model TEXT DEFAULT 'llama-3.3-70b-versatile',
  memory_namespace TEXT,
  
  created_at TIMESTAMP DEFAULT NOW()
);

-- 2.3 Conversation Events (Immutable Log)
-- Add channel fields and sender_actor/resolved_actor to conversation_events
ALTER TABLE conversation_events ADD COLUMN IF NOT EXISTS channel TEXT;
ALTER TABLE conversation_events ADD COLUMN IF NOT EXISTS channel_chat_id TEXT;
ALTER TABLE conversation_events ADD COLUMN IF NOT EXISTS channel_user_id TEXT;
ALTER TABLE conversation_events ADD COLUMN IF NOT EXISTS sender_actor TEXT;
ALTER TABLE conversation_events ADD COLUMN IF NOT EXISTS resolved_actor TEXT;
ALTER TABLE conversation_events ADD COLUMN IF NOT EXISTS arbitration_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_conversation_events_tenant_chat 
ON conversation_events(tenant_id, channel_chat_id, created_at DESC);

-- 2.4 Customer Memory (Per Tenant)
CREATE TABLE IF NOT EXISTS customer_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT REFERENCES tenants(tenant_id),
  
  -- Customer identity (channel-agnostic)
  customer_phone TEXT NOT NULL,  -- Normalized E.164 or Telegram ID as string
  customer_name TEXT,
  
  -- Conversation state
  last_customer_need TEXT,
  current_goal TEXT,
  message_count INTEGER DEFAULT 0,
  tone_state TEXT DEFAULT 'neutral',
  
  -- Arbitration per customer
  last_chioma_at TIMESTAMP,
  last_owner_at TIMESTAMP,
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  UNIQUE(tenant_id, customer_phone)
);

-- SECTION 7: MIGRATION PATH (From Current State)

-- Step 1: Create tenants table and migrate existing data
INSERT INTO tenants (tenant_id, business_name, owner_telegram_ids)
SELECT DISTINCT tenant_id, 'Business', ARRAY[telegram_owner_chat_id]
FROM employer_profiles 
WHERE tenant_id IS NOT NULL
ON CONFLICT (tenant_id) DO NOTHING;

-- Step 2: Link tenant_instances
INSERT INTO tenant_instances (instance_id, tenant_id, telegram_bot_token, billing_state, credit_units, whatsapp_phone_number, whatsapp_phone_number_id, llm_provider, llm_model, memory_namespace)
SELECT instance_id, tenant_id, telegram_bot_token, billing_state, credit_units, whatsapp_phone_number, whatsapp_phone_number_id, llm_provider, llm_model, memory_namespace
FROM chioma_instances
ON CONFLICT (instance_id) DO NOTHING;

-- Step 3: Deprecate old tables (keep for backward compatibility during transition)
