-- 003_ephemeral_chat_queue.sql
-- Ephemeral Chat Queue (Store-and-forward holding tank ONLY, not an archive)

CREATE TABLE IF NOT EXISTS ephemeral_chat_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    receiver_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMPTZ DEFAULT (CURRENT_TIMESTAMP + INTERVAL '24 hours')
);

CREATE INDEX IF NOT EXISTS idx_chat_queue_receiver ON ephemeral_chat_queue(receiver_id);
CREATE INDEX IF NOT EXISTS idx_chat_queue_expires ON ephemeral_chat_queue(expires_at);

-- User presence / status preferences
ALTER TABLE users ADD COLUMN IF NOT EXISTS status_message VARCHAR(150) DEFAULT 'Surfing cyberspace';
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_away BOOLEAN DEFAULT FALSE;
