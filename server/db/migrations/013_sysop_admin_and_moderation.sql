-- Migration 013: SysOp Admin, Moderation (Soft-Banning), System Settings, and Audit Logging

-- 1. Extend Users table with moderation flags
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_banned BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS banned_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS ban_reason VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_users_is_banned ON users(is_banned);

-- 2. System Settings key-value store (dynamic marquee ticker, feature toggles)
CREATE TABLE IF NOT EXISTS system_settings (
    key VARCHAR(100) PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Seed default terminal marquee announcement ticker
INSERT INTO system_settings (key, value)
VALUES ('ticker_announcement', ':> NEOGRAM UNIX WORKSTATION // HYBRID MAC-SYSTEM7 + BSD-X11 // RETRO PHOTO PUBLISHING ENGINE FOR NEOCITIES & PERSONAL SITES // NO SAAS SLOP // 28.8K V.34 DIAL-UP OK // SYSTEM PROMPT READY_')
ON CONFLICT (key) DO NOTHING;

-- 3. SysOp Audit Ledger
CREATE TABLE IF NOT EXISTS admin_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id UUID REFERENCES users(id) ON DELETE SET NULL,
    admin_email VARCHAR(255) NOT NULL,
    action VARCHAR(100) NOT NULL,
    target_id VARCHAR(255),
    details JSONB,
    ip_address VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_created ON admin_audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_action ON admin_audit_logs(action);
