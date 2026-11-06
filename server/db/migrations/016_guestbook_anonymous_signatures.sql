-- 016_guestbook_anonymous_signatures.sql
-- Support for anonymous guestbook signatures and station toggle

-- 1. Add is_anonymous flag to guestbook_entries table
ALTER TABLE guestbook_entries ADD COLUMN IF NOT EXISTS is_anonymous BOOLEAN DEFAULT FALSE;

-- 2. Add allow_anon_guestbook toggle to notification_preferences
ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS allow_anon_guestbook BOOLEAN DEFAULT TRUE;

-- 3. Add allow_anon_guestbook toggle to sites table
ALTER TABLE sites ADD COLUMN IF NOT EXISTS allow_anon_guestbook BOOLEAN DEFAULT TRUE;

