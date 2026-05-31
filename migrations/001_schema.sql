-- SWARM OS Schema Migration 001
-- Run in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent TEXT NOT NULL,
  task_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  priority INT NOT NULL DEFAULT 5,
  payload JSONB NOT NULL DEFAULT '{}',
  result JSONB,
  error TEXT,
  parent_task_id UUID REFERENCES tasks(id),
  scheduled_for TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_agent ON tasks(agent);
CREATE INDEX idx_tasks_scheduled ON tasks(scheduled_for);
CREATE INDEX idx_tasks_priority ON tasks(priority, scheduled_for);

CREATE TABLE IF NOT EXISTS agent_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID REFERENCES tasks(id),
  agent TEXT NOT NULL,
  level TEXT NOT NULL DEFAULT 'info',
  message TEXT NOT NULL,
  data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_agent_logs_agent ON agent_logs(agent);
CREATE INDEX idx_agent_logs_created ON agent_logs(created_at DESC);

CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id TEXT,
  platform TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  tags TEXT[],
  price NUMERIC(10,2),
  status TEXT DEFAULT 'draft',
  performance JSONB DEFAULT '{}',
  ai_score NUMERIC(3,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(external_id, platform)
);

CREATE TABLE IF NOT EXISTS trends (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  keyword TEXT NOT NULL UNIQUE,
  category TEXT,
  score NUMERIC(5,2),
  source TEXT,
  data JSONB DEFAULT '{}',
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ
);
CREATE INDEX idx_trends_score ON trends(score DESC);

CREATE TABLE IF NOT EXISTS campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  platform TEXT NOT NULL,
  status TEXT DEFAULT 'draft',
  content JSONB DEFAULT '{}',
  performance JSONB DEFAULT '{}',
  budget NUMERIC(10,2),
  spent NUMERIC(10,2) DEFAULT 0,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS customer_segments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  criteria JSONB NOT NULL DEFAULT '{}',
  size INT DEFAULT 0,
  ltv_avg NUMERIC(10,2),
  last_synced TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS inventory_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID REFERENCES products(id),
  platform TEXT NOT NULL,
  quantity INT NOT NULL DEFAULT 0,
  snapshot_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent TEXT NOT NULL,
  decision_type TEXT NOT NULL,
  reasoning TEXT,
  data JSONB DEFAULT '{}',
  approved BOOLEAN,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS revenue_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform TEXT NOT NULL,
  order_id TEXT UNIQUE,
  amount NUMERIC(10,2) NOT NULL,
  currency TEXT DEFAULT 'USD',
  product_id UUID REFERENCES products(id),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS health_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service TEXT NOT NULL,
  status TEXT NOT NULL,
  latency_ms INT,
  detail JSONB,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS oauth_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform TEXT NOT NULL UNIQUE,
  access_token TEXT,
  refresh_token TEXT,
  scope TEXT,
  shop TEXT,
  expires_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS scheduler_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name TEXT NOT NULL UNIQUE,
  last_run TIMESTAMPTZ,
  next_run TIMESTAMPTZ,
  run_count INT DEFAULT 0,
  last_status TEXT DEFAULT 'never_run'
);

INSERT INTO scheduler_state (job_name) VALUES
  ('hourly_trend_scan'),('hourly_inventory_check'),('hourly_order_monitor'),
  ('daily_seo_generation'),('daily_analytics_report'),('daily_customer_sync'),
  ('weekly_campaign_review'),('weekly_product_audit')
ON CONFLICT (job_name) DO NOTHING;

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_tasks_updated BEFORE UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_products_updated BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION update_updated_at();
