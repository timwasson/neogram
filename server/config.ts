import dotenv from 'dotenv';
import path from 'path';
import crypto from 'crypto';

dotenv.config();

// Fail closed: an unset NODE_ENV is treated as production so that dev-only conveniences
// (demo OTP codes, test-suite rate-limit bypass, well-known fallback secrets) can never
// be enabled by a missing/typo'd environment variable on a real server.
if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = 'production';
}

export interface AppConfig {
  env: string;
  port: number;
  databaseUrl: string;
  jwtSecret: string;
  encryptionSecret: string;
  storageDir: string;
  appUrl: string;
  enableMemoryDbFallback: boolean;
  resendApiKey?: string;
  emailFrom: string;
  twilioAccountSid?: string;
  twilioAuthToken?: string;
  twilioPhoneNumber?: string;
  adminEmails: string[];
  vapidPublicKey?: string;
  vapidPrivateKey?: string;
  vapidSubject: string;
  allowDemoOtp: boolean;
  encryptionSecretPrevious?: string;
}

export const config: AppConfig = {
  env: process.env.NODE_ENV || 'production',
  port: parseInt(process.env.PORT || '4000', 10),
  databaseUrl: process.env.DATABASE_URL || 'postgres://neogram:neogram_secret@localhost:5432/neogram_db',
  jwtSecret: process.env.JWT_SECRET || 'neogram_retro_super_secret_jwt_key_1996',
  encryptionSecret: process.env.ENCRYPTION_SECRET || 'neogram_retro_aes256_vault_key_1996_master_secret',
  storageDir: process.env.STORAGE_DIR || path.resolve(process.cwd(), 'public/uploads'),
  appUrl: process.env.APP_URL || 'http://localhost:4000',
  enableMemoryDbFallback: process.env.NODE_ENV !== 'production' && process.env.FORCE_EXTERNAL_DB !== 'true',
  resendApiKey: process.env.RESEND_API_KEY,
  emailFrom: process.env.EMAIL_FROM || 'Neogram <auth@neogram.retro>',
  twilioAccountSid: process.env.TWILIO_ACCOUNT_SID,
  twilioAuthToken: process.env.TWILIO_AUTH_TOKEN,
  twilioPhoneNumber: process.env.TWILIO_PHONE_NUMBER,
  vapidPublicKey: process.env.VAPID_PUBLIC_KEY,
  vapidPrivateKey: process.env.VAPID_PRIVATE_KEY,
  vapidSubject: process.env.VAPID_SUBJECT || 'mailto:sysop@neogram.club',
  // Parsed ONCE at boot (no per-request disk I/O, no runtime privilege changes via .env edits).
  // Restart the process to change SysOp membership.
  adminEmails: (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
  allowDemoOtp: process.env.NODE_ENV !== 'production' && process.env.ALLOW_DEMO_OTP === 'true',
  encryptionSecretPrevious: process.env.ENCRYPTION_SECRET_PREVIOUS || undefined,
};

if (config.env !== 'production') {
  if (!process.env.JWT_SECRET) {
    // Ephemeral per-process secret in dev: sessions reset on restart, no publicly-known key is ever used.
    config.jwtSecret = crypto.randomBytes(48).toString('hex');
    console.warn('[:> SECURITY] JWT_SECRET not set: using an ephemeral random secret (sessions reset on restart).');
  }
  if (!process.env.ENCRYPTION_SECRET) {
    console.warn('[:> SECURITY] ENCRYPTION_SECRET not set: using the well-known DEV-ONLY vault key. Never use this outside local development.');
  }
}

// Strict security hygiene validation for production environments
if (config.env === 'production') {
  if (
    !process.env.JWT_SECRET ||
    config.jwtSecret === 'neogram_retro_super_secret_jwt_key_1996' ||
    config.jwtSecret.length < 32
  ) {
    throw new Error(
      '[:> FATAL SECURITY ERROR] Refusing to start in production: JWT_SECRET must be set to a secure custom secret of at least 32 characters in production .env'
    );
  }
  if (
    !process.env.ENCRYPTION_SECRET ||
    config.encryptionSecret === 'neogram_retro_aes256_vault_key_1996_master_secret' ||
    config.encryptionSecret.length < 32
  ) {
    throw new Error(
      '[:> FATAL SECURITY ERROR] Refusing to start in production: ENCRYPTION_SECRET must be set to a secure custom secret of at least 32 characters in production .env'
    );
  }
}
