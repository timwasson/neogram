-- 012_ephemeral_queue_anon_receiver.sql
-- Support store-and-forward delivery for anonymous visitor handles paging stations

ALTER TABLE ephemeral_chat_queue ALTER COLUMN receiver_id DROP NOT NULL;
ALTER TABLE ephemeral_chat_queue ADD COLUMN IF NOT EXISTS receiver_handle VARCHAR(50);
CREATE INDEX IF NOT EXISTS idx_chat_queue_receiver_handle ON ephemeral_chat_queue(receiver_handle);
