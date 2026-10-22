-- 006_user_deploy_path.sql
-- Add deploy_path column to users table so users can publish to a safe subdirectory (e.g. /neogram/)
-- without overwriting existing Neocities homepages or non-Neogram files.

ALTER TABLE users ADD COLUMN IF NOT EXISTS deploy_path VARCHAR(200) DEFAULT 'neogram';

-- Update existing users to 'neogram' if null
UPDATE users SET deploy_path = 'neogram' WHERE deploy_path IS NULL;
