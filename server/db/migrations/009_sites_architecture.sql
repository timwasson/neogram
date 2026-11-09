-- 009_sites_architecture.sql
-- Decouple User Identity from Static Sites: 1 User -> N Sites

CREATE TABLE IF NOT EXISTS sites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(50) NOT NULL,
    site_url VARCHAR(500) NOT NULL,
    deployment_type VARCHAR(50) DEFAULT 'neocities',
    deployment_credentials BYTEA,
    deploy_path VARCHAR(200) DEFAULT 'neogram',
    auto_deploy BOOLEAN DEFAULT FALSE,
    build_html BOOLEAN DEFAULT TRUE,
    custom_css_url VARCHAR(500),
    is_default BOOLEAN DEFAULT FALSE,
    last_deployed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sites_user_id ON sites(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sites_user_slug ON sites(user_id, slug);

-- Add site_id to posts, web_counters, and guestbook_entries
ALTER TABLE posts ADD COLUMN IF NOT EXISTS site_id UUID REFERENCES sites(id) ON DELETE CASCADE;
ALTER TABLE web_counters ADD COLUMN IF NOT EXISTS site_id UUID REFERENCES sites(id) ON DELETE CASCADE;
ALTER TABLE guestbook_entries ADD COLUMN IF NOT EXISTS site_id UUID REFERENCES sites(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_posts_site_id ON posts(site_id);
ALTER TABLE web_counters DROP CONSTRAINT IF EXISTS web_counters_pkey;
CREATE UNIQUE INDEX IF NOT EXISTS idx_web_counters_site_id ON web_counters(site_id);
CREATE INDEX IF NOT EXISTS idx_guestbook_site_id ON guestbook_entries(site_id);

-- Backfill default site for all existing users who do not have one
INSERT INTO sites (
    user_id,
    name,
    slug,
    site_url,
    deployment_type,
    deployment_credentials,
    deploy_path,
    auto_deploy,
    build_html,
    custom_css_url,
    is_default,
    last_deployed_at
)
SELECT 
    id,
    COALESCE(handle, split_part(email, '@', 1), 'Default') || ' Site',
    'default',
    COALESCE(site_url, 'https://' || COALESCE(handle, 'user') || '.neocities.org'),
    COALESCE(deployment_type, 'neocities'),
    deployment_credentials,
    COALESCE(deploy_path, 'neogram'),
    COALESCE(auto_deploy, FALSE),
    COALESCE(build_html, TRUE),
    custom_css_url,
    TRUE,
    last_deployed_at
FROM users
WHERE id NOT IN (SELECT user_id FROM sites WHERE user_id IS NOT NULL)
  AND (SELECT COUNT(*) FROM sites) = 0;

-- Backfill site_id on existing posts
UPDATE posts
SET site_id = sites.id
FROM sites
WHERE sites.user_id = posts.user_id AND posts.site_id IS NULL;

-- Backfill site_id on existing web_counters
UPDATE web_counters
SET site_id = sites.id
FROM sites
WHERE sites.user_id = web_counters.user_id AND web_counters.site_id IS NULL;

-- Backfill site_id on existing guestbook_entries
UPDATE guestbook_entries
SET site_id = sites.id
FROM sites
WHERE sites.user_id = guestbook_entries.user_id AND guestbook_entries.site_id IS NULL;
