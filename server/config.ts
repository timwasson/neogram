import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

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
}

export const config: AppConfig = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '4000', 10),
  databaseUrl: process.env.DATABASE_URL || 'postgres://neogram:neogram_secret@localhost:5432/neogram_db',
  jwtSecret: process.env.JWT_SECRET || 'neogram_retro_super_secret_jwt_key_1996',
  encryptionSecret: process.env.ENCRYPTION_SECRET || 'neogram_retro_aes256_vault_key_1996_master_secret',
  storageDir: process.env.STORAGE_DIR || path.resolve(process.cwd(), 'public/uploads'),
  appUrl: process.env.APP_URL || 'http://localhost:4000',
  enableMemoryDbFallback: process.env.NODE_ENV !== 'production' && (process.env.USE_MEMORY_DB === 'true' || !process.env.DATABASE_URL),
  resendApiKey: process.env.RESEND_API_KEY,
  emailFrom: process.env.EMAIL_FROM || 'Neogram <auth@neogram.retro>',
  twilioAccountSid: process.env.TWILIO_ACCOUNT_SID,
  twilioAuthToken: process.env.TWILIO_AUTH_TOKEN,
  twilioPhoneNumber: process.env.TWILIO_PHONE_NUMBER,
};

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
