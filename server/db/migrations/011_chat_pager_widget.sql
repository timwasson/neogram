-- 011_chat_pager_widget.sql
-- Support for Static Site Chat / Pager Widget and Anonymous Transmissions

-- 1. Ephemeral chat queue updates for anonymous messages
ALTER TABLE ephemeral_chat_queue ALTER COLUMN sender_id DROP NOT NULL;
ALTER TABLE ephemeral_chat_queue ADD COLUMN IF NOT EXISTS sender_handle VARCHAR(50);
ALTER TABLE ephemeral_chat_queue ADD COLUMN IF NOT EXISTS is_anonymous BOOLEAN DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_chat_queue_sender_handle ON ephemeral_chat_queue(sender_handle);

-- 2. Notification Preferences for Pager Widget
ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS allow_anon_chat BOOLEAN DEFAULT TRUE;
ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS chat_widget_enabled BOOLEAN DEFAULT TRUE;

-- 3. Per-Site Pager Widget Configurations
ALTER TABLE sites ADD COLUMN IF NOT EXISTS allow_anon_chat BOOLEAN DEFAULT TRUE;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS chat_widget_enabled BOOLEAN DEFAULT TRUE;
