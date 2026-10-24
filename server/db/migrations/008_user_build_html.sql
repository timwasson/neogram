-- 008_user_build_html.sql
-- Add build_html column for headless self-hosted API mode (default: TRUE)

ALTER TABLE users ADD COLUMN IF NOT EXISTS build_html BOOLEAN DEFAULT TRUE;
