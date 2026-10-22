-- 005_user_uin.sql
-- Add ICQ-style static UIN (Universal Internet Number) for immutable identity and permanent embed anchors

CREATE SEQUENCE IF NOT EXISTS user_uin_seq START WITH 100101;

ALTER TABLE users ADD COLUMN IF NOT EXISTS uin INTEGER DEFAULT nextval('user_uin_seq');

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_uin ON users(uin);

-- Backfill any existing users without a UIN
UPDATE users SET uin = nextval('user_uin_seq') WHERE uin IS NULL;
