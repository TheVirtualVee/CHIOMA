-- Add retry tracking to delivery_queue
ALTER TABLE delivery_queue ADD COLUMN IF NOT EXISTS retry_count INTEGER DEFAULT 0;
ALTER TABLE delivery_queue ADD COLUMN IF NOT EXISTS last_error TEXT;

-- Add processed tracking to commitments
ALTER TABLE commitments ADD COLUMN IF NOT EXISTS retry_count INTEGER DEFAULT 0;
ALTER TABLE commitments ADD COLUMN IF NOT EXISTS processed_at TIMESTAMP;

-- Add escalation tracking
CREATE TABLE IF NOT EXISTS escalation_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  customer_message TEXT NOT NULL,
  trigger_keyword TEXT,
  emergency_contact_notified BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  notified_at TIMESTAMP,
  resolved_at TIMESTAMP
);

-- Add leases table if not exists
CREATE TABLE IF NOT EXISTS execution_leases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  worker_id TEXT NOT NULL,
  status TEXT DEFAULT 'ACTIVE',
  acquired_at TIMESTAMP DEFAULT NOW(),
  released_at TIMESTAMP,
  expires_at TIMESTAMP DEFAULT NOW() + INTERVAL '10 minutes'
);
