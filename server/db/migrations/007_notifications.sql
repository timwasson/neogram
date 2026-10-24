-- 007_notifications.sql
-- Notification Preferences & Persistent In-App Notifications Inbox

CREATE TABLE IF NOT EXISTS notification_preferences (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    notify_nim BOOLEAN DEFAULT TRUE,
    notify_follow BOOLEAN DEFAULT TRUE,
    notify_comment_own BOOLEAN DEFAULT TRUE,
    notify_comment_thread BOOLEAN DEFAULT TRUE,
    notify_guestbook BOOLEAN DEFAULT TRUE,
    notify_like BOOLEAN DEFAULT TRUE,
    notify_friend_post BOOLEAN DEFAULT TRUE,
    notify_deploy BOOLEAN DEFAULT TRUE,
    sound_enabled BOOLEAN DEFAULT TRUE,
    desktop_push BOOLEAN DEFAULT FALSE,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
    type VARCHAR(50) NOT NULL,
    title VARCHAR(200) NOT NULL,
    body TEXT,
    link_url VARCHAR(500),
    icon VARCHAR(20) DEFAULT '🔔',
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id, is_read, created_at DESC);
