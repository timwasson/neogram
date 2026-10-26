import crypto from 'crypto';
import { config } from '../config';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit IV recommended for AES-GCM
const AUTH_TAG_LENGTH = 16; // 128-bit authentication tag

/**
 * Derives a consistent 32-byte key from server encryption secret.
 */
function getMasterKey(): Buffer {
  const secret = config.encryptionSecret || config.jwtSecret;
  return crypto.createHash('sha256').update(secret).digest();
}

export interface NeocitiesCredentials {
  apiKey: string;
  siteName?: string;
  siteUrl?: string;
  autoDeploy?: boolean;
}

export interface NekowebCredentials {
  apiKey: string;
  siteName?: string;
  siteUrl?: string;
  autoDeploy?: boolean;
}

/**
 * Encrypt a plaintext string or credentials object into a Buffer for PostgreSQL BYTEA storage.
 * Serialization layout: [12-byte IV][16-byte AuthTag][Ciphertext]
 */
export function encryptCredentials(data: string | object): Buffer {
  const text = typeof data === 'string' ? data : JSON.stringify(data);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getMasterKey(), iv);

  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return Buffer.concat([iv, authTag, encrypted]);
}

/**
 * Decrypt a Buffer or Bytea string retrieved from PostgreSQL into plaintext or JSON.
 */
export function decryptCredentials<T = NeocitiesCredentials>(raw: Buffer | string | null | undefined): T | null {
  if (!raw) return null;

  let buffer: Buffer;
  if (Buffer.isBuffer(raw)) {
    buffer = raw;
  } else if (typeof raw === 'string') {
    if (raw.startsWith('\\x')) {
      buffer = Buffer.from(raw.slice(2), 'hex');
    } else {
      buffer = Buffer.from(raw, 'base64');
    }
  } else {
    return null;
  }

  if (buffer.length < IV_LENGTH + AUTH_TAG_LENGTH) {
    return null;
  }

  const iv = buffer.subarray(0, IV_LENGTH);
  const authTag = buffer.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = buffer.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  try {
    const decipher = crypto.createDecipheriv(ALGORITHM, getMasterKey(), iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    const text = decrypted.toString('utf8');

    try {
      return JSON.parse(text) as T;
    } catch {
      return text as unknown as T;
    }
  } catch (err) {
    console.error('[:> CRYPTO ERROR] Failed to decrypt deployment credentials:', err);
    return null;
  }
}

/**
 * Utility to mask an API key for safe display in UI/API responses.
 * e.g., "7f8b9c...d4e1" or "••••••••••••••••3a9f"
 */
export function maskApiKey(key: string | null | undefined): string {
  if (!key || key.length < 8) return '';
  const suffix = key.slice(-4);
  return '••••••••••••••••' + suffix;
}
