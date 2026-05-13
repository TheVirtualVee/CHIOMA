-- CHIOMA Behavioral Consistency Layer (BCL) Upgrade (v1.3)
-- Purpose: Enforce temporal consistency and "Conversation State Authority".

-- 1. Expand Customer Memory into a Full Behavioral State machine
ALTER TABLE customer_memory
ADD COLUMN IF NOT EXISTS current_goal TEXT DEFAULT 'IDENTIFY_NEED', -- The target outcome of the current thread
ADD COLUMN IF NOT EXISTS last_action TEXT, -- The last staff action taken (RESPONDED, ESCALATED, etc.)
ADD COLUMN IF NOT EXISTS revenue_status TEXT DEFAULT 'COLD', -- COLD | WARM | HOT | WON | LOST
ADD COLUMN IF NOT EXISTS escalation_status TEXT DEFAULT 'NONE', -- NONE | PENDING | RESOLVED
ADD COLUMN IF NOT EXISTS interaction_sequence JSONB DEFAULT '[]'; -- Circular buffer of last 5 [intent, action] pairs

-- 2. Behavioral Constraint View (for easy operator inspection)
CREATE OR REPLACE VIEW core.view_conversation_health AS
SELECT 
  tenant_id,
  customer_phone,
  current_goal,
  revenue_status,
  unresolved_count,
  updated_at
FROM customer_memory
WHERE updated_at > (CURRENT_TIMESTAMP - INTERVAL '7 days');
