-- Migration 003: Social Media Integration — House of Jreym
-- IBRAHIM agent tables

-- Platform credentials (encrypted at rest via Supabase RLS)
CREATE TABLE IF NOT EXISTS social_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform TEXT NOT NULL UNIQUE, -- 'instagram' | 'facebook' | 'tiktok'
  access_token TEXT,
  refresh_token TEXT,
  token_expires_at TIMESTAMPTZ,
  page_id TEXT,          -- Facebook page ID / Instagram business account ID
  account_id TEXT,       -- TikTok open ID
  username TEXT,
  connected BOOLEAN DEFAULT false,
  scopes TEXT[],
  meta JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Content drafts + scheduled posts
CREATE TABLE IF NOT EXISTS social_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform TEXT NOT NULL,           -- 'instagram' | 'facebook' | 'tiktok' | 'all'
  status TEXT NOT NULL DEFAULT 'draft', -- draft | pending_approval | approved | scheduled | published | failed | rejected
  created_by TEXT DEFAULT 'IBRAHIM', -- agent name
  caption TEXT,
  hashtags TEXT[],
  media_urls TEXT[],
  media_type TEXT DEFAULT 'image',   -- image | video | carousel | reel
  scheduled_for TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  platform_post_id TEXT,            -- ID returned by platform after publish
  platform_post_url TEXT,
  etsy_listing_id TEXT,             -- links post to a specific listing
  keyword TEXT,                     -- SEO keyword that inspired this post
  approved_by TEXT,                 -- 'CEO' | agent name
  approved_at TIMESTAMPTZ,
  rejection_reason TEXT,
  error TEXT,
  meta JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Analytics per post per platform (tracked daily)
CREATE TABLE IF NOT EXISTS social_analytics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID REFERENCES social_posts(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  recorded_at TIMESTAMPTZ DEFAULT NOW(),
  views INTEGER DEFAULT 0,
  likes INTEGER DEFAULT 0,
  comments INTEGER DEFAULT 0,
  shares INTEGER DEFAULT 0,
  saves INTEGER DEFAULT 0,
  reach INTEGER DEFAULT 0,
  impressions INTEGER DEFAULT 0,
  clicks INTEGER DEFAULT 0,
  profile_visits INTEGER DEFAULT 0,
  followers_at_time INTEGER DEFAULT 0,
  engagement_rate NUMERIC(6,4) DEFAULT 0,
  meta JSONB DEFAULT '{}'
);

-- Account-level follower snapshots (daily)
CREATE TABLE IF NOT EXISTS social_account_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform TEXT NOT NULL,
  recorded_at TIMESTAMPTZ DEFAULT NOW(),
  followers INTEGER DEFAULT 0,
  following INTEGER DEFAULT 0,
  total_posts INTEGER DEFAULT 0,
  total_reach INTEGER DEFAULT 0,
  total_impressions INTEGER DEFAULT 0,
  avg_engagement_rate NUMERIC(6,4) DEFAULT 0,
  meta JSONB DEFAULT '{}'
);

-- Daily CEO reports
CREATE TABLE IF NOT EXISTS social_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_date DATE NOT NULL UNIQUE,
  generated_by TEXT DEFAULT 'IBRAHIM',
  summary TEXT,
  top_post_id UUID REFERENCES social_posts(id),
  total_posts_published INTEGER DEFAULT 0,
  total_reach INTEGER DEFAULT 0,
  total_engagement INTEGER DEFAULT 0,
  follower_delta JSONB DEFAULT '{}',  -- {instagram: +12, facebook: +3, tiktok: +88}
  best_performing JSONB DEFAULT '{}',
  recommendations TEXT[],
  full_report JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_social_posts_status ON social_posts(status);
CREATE INDEX IF NOT EXISTS idx_social_posts_platform ON social_posts(platform);
CREATE INDEX IF NOT EXISTS idx_social_posts_scheduled ON social_posts(scheduled_for);
CREATE INDEX IF NOT EXISTS idx_social_analytics_post ON social_analytics(post_id);
CREATE INDEX IF NOT EXISTS idx_social_analytics_platform ON social_analytics(platform, recorded_at);
CREATE INDEX IF NOT EXISTS idx_social_account_stats_platform ON social_account_stats(platform, recorded_at);

-- Enable RLS
ALTER TABLE social_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_analytics ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_account_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_reports ENABLE ROW LEVEL SECURITY;

-- Service role has full access
CREATE POLICY "service_all_social_credentials" ON social_credentials FOR ALL USING (true);
CREATE POLICY "service_all_social_posts" ON social_posts FOR ALL USING (true);
CREATE POLICY "service_all_social_analytics" ON social_analytics FOR ALL USING (true);
CREATE POLICY "service_all_social_account_stats" ON social_account_stats FOR ALL USING (true);
CREATE POLICY "service_all_social_reports" ON social_reports FOR ALL USING (true);
