-- 019_guestbook_visitor_number.sql
-- Add visitor_number to guestbook_entries table to record visitor milestone hits alongside signatures

ALTER TABLE guestbook_entries ADD COLUMN IF NOT EXISTS visitor_number BIGINT;

