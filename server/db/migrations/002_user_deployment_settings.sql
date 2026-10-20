-- 002_user_deployment_settings.sql
-- Add auto-deploy and last-deployed telemetry columns to users table

ALTER TABLE users ADD COLUMN IF NOT EXISTS auto_deploy BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_deployed_at TIMESTAMPTZ;
