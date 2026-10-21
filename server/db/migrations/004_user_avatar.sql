-- 004_user_avatar.sql
-- Add avatar_path column to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_path VARCHAR(500);
