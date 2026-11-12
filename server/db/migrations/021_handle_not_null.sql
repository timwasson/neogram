-- 021_handle_not_null.sql
-- Every station has a public handle. Without one, queries and views fell back to the email local-part
-- (COALESCE(handle, split_part(email, '@', 1))), which published part of the member's login email.
-- Backfill any missing handle from the row id, then enforce NOT NULL so that fallback can never be
-- reached again. 'station_' + the 36-char UUID = 44 chars, longer than any user-chosen handle (max 30),
-- so the backfill can never collide with an existing handle.
-- Idempotent: safe to run on every boot.

UPDATE users
SET handle = 'station_' || id::text
WHERE handle IS NULL OR handle = '';

ALTER TABLE users ALTER COLUMN handle SET NOT NULL;
