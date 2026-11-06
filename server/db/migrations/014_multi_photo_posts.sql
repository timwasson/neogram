-- Migration 014: Multi-Photo Posts Support (Carousels / Photo Galleries)
-- Enables uploading up to 5 photos to a single gallery post with Instagram-style sliding.

ALTER TABLE posts ADD COLUMN IF NOT EXISTS photos JSONB DEFAULT '[]'::jsonb;

