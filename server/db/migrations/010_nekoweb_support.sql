-- 010_nekoweb_support.sql
-- Expand users.deployment_type CHECK constraint to support 'nekoweb'

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_deployment_type_check;
ALTER TABLE users ADD CONSTRAINT users_deployment_type_check CHECK (deployment_type IN ('neocities', 'nekoweb', 'github', 'sftp', 'none'));
