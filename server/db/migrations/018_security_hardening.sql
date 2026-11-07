-- 018_security_hardening.sql
-- (1) OTP challenges: hashed codes + persisted attempt counters; accounts are only created after a
--     successful verification (no unverified user rows from request-otp spam).
-- (2) Post likes: de-duplication ledger (one like per authenticated user or hashed visitor IP per post).
-- Idempotent: migrations run on every boot.

CREATE TABLE IF NOT EXISTS otp_challenges (
    identifier VARCHAR(255) PRIMARY KEY,
    code_hash VARCHAR(128) NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_otp_challenges_expires ON otp_challenges(expires_at);

CREATE TABLE IF NOT EXISTS post_likes (
    post_id VARCHAR(64) NOT NULL,
    voter_key VARCHAR(128) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (post_id, voter_key)
);
