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

// v2 envelope: [4-byte magic "NGv2"][12-byte IV][16-byte AuthTag][Ciphertext]
// Key = scrypt(secret, fixed domain salt). Legacy (v1) ciphertexts lack the magic prefix and
// are still readable (SHA-256 derived key) so existing rows keep working and are upgraded on next write.
const V2_MAGIC = Buffer.from('NGv2');
const keyCache = new Map<string, Buffer>();

function getV2Key(secret: string): Buffer {
  let key = keyCache.get(secret);
  if (!key) {
    key = crypto.scryptSync(secret, 'neogram-credential-vault-v2', 32);
    keyCache.set(secret, key);
  }
  return key;
}

/** Candidate secrets in priority order: current, then previous (key rotation window). */
function candidateSecrets(): string[] {
  const list = [config.encryptionSecret || config.jwtSecret];
  if (config.encryptionSecretPrevious) list.push(config.encryptionSecretPrevious);
  return list;
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

export interface GitHubCredentials {
  apiKey: string; // GitHub PAT (Personal Access Token)
  repo?: string; // "owner/repo" or "repo"
  owner?: string; // repo owner
  branch?: string; // target branch, e.g. "gh-pages" (default) or "main"
  siteName?: string; // optional label/alias
  siteUrl?: string; // e.g. "https://user.github.io/repo"
  autoDeploy?: boolean;
}

/**
 * Encrypt a plaintext string or credentials object into a Buffer for PostgreSQL BYTEA storage.
 * Serialization layout (v2): ["NGv2"][12-byte IV][16-byte AuthTag][Ciphertext]
 */
export function encryptCredentials(data: string | object): Buffer {
  const text = typeof data === 'string' ? data : JSON.stringify(data);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getV2Key(candidateSecrets()[0]), iv);

  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return Buffer.concat([V2_MAGIC, iv, authTag, encrypted]);
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

  const isV2 = buffer.length >= V2_MAGIC.length && buffer.subarray(0, V2_MAGIC.length).equals(V2_MAGIC);
  const body = isV2 ? buffer.subarray(V2_MAGIC.length) : buffer;

  if (body.length < IV_LENGTH + AUTH_TAG_LENGTH) {
    return null;
  }

  const iv = body.subarray(0, IV_LENGTH);
  const authTag = body.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = body.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const keys: Buffer[] = [];
  for (const secret of candidateSecrets()) {
    if (isV2) keys.push(getV2Key(secret));
    else keys.push(crypto.createHash('sha256').update(secret).digest());
  }

  for (const key of keys) {
    try {
      const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
      decipher.setAuthTag(authTag);
      const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      const text = decrypted.toString('utf8');
      try {
        return JSON.parse(text) as T;
      } catch {
        return text as unknown as T;
      }
    } catch {
      // try next candidate key
    }
  }
  console.error('[:> CRYPTO ERROR] Failed to decrypt deployment credentials with any configured key.');
  return null;
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
