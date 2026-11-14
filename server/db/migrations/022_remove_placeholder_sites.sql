-- 022_remove_placeholder_sites.sql
-- ensureDefaultSite() used to invent a "default" site pointing at https://<handle>.neocities.org for
-- every member, even ones who never connected a host (it ran when the counter or guestbook embed was
-- first loaded). Those rows made profiles, the directory and guestbooks point at a Neocities site the
-- member may not own. Remove only rows that are unmistakably that placeholder: no credentials, never
-- deployed, the exact invented URL, and no guestbook signatures attached.
-- Idempotent: safe to run on every boot.

DELETE FROM sites
WHERE slug = 'default'
  AND deployment_credentials IS NULL
  AND last_deployed_at IS NULL
  AND (user_id::text || '|' || site_url) IN (
    SELECT id::text || '|https://' || handle || '.neocities.org' FROM users
  )
  AND id NOT IN (SELECT site_id FROM guestbook_entries WHERE site_id IS NOT NULL);
