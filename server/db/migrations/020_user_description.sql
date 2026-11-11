-- 020_user_description.sql
-- Add description column for user station bio (displayed on static sites and Admin UI)

ALTER TABLE users ADD COLUMN IF NOT EXISTS description TEXT DEFAULT '';

