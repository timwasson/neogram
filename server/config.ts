import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

export interface AppConfig {
  env: string;
  port: number;
  databaseUrl: string;
  jwtSecret: string;
  storageDir: string;
  appUrl: string;
  enableMemoryDbFallback: boolean;
}

export const config: AppConfig = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '4000', 10),
  databaseUrl: process.env.DATABASE_URL || 'postgres://neogram:neogram_secret@localhost:5432/neogram_db',
  jwtSecret: process.env.JWT_SECRET || 'neogram_retro_super_secret_jwt_key_1996',
  storageDir: process.env.STORAGE_DIR || path.resolve(process.cwd(), 'public/uploads'),
  appUrl: process.env.APP_URL || 'http://localhost:4000',
  enableMemoryDbFallback: process.env.USE_MEMORY_DB === 'true' || !process.env.DATABASE_URL,
};
