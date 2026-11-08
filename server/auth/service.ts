import crypto from 'crypto';
import { query } from '../db';
import { sendOtpNotification } from '../services/notifier';
import { config } from '../config';

export interface AuthUser {
  id: string;
  email: string;
  handle: string;
  uin?: number;
  siteUrl?: string;
  galleryUrl?: string;
  deployPath?: string;
  deploymentType?: string;
  avatarPath?: string;
  hasApiKey?: boolean;
  isBanned?: boolean;
  isAdmin?: boolean;
  banReason?: string;
  bannedAt?: Date;
}

export function normalizeIdentifier(input: string): string {
  const trimmed = input.trim();
  if (trimmed.includes('@') && !trimmed.startsWith('@')) {
    return trimmed.toLowerCase();
  }
  // Strip non-digits for phone numbers
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length >= 7) {
    return `${digits}@sms.neogram.local`;
  }
  return trimmed.toLowerCase();
}

export function extractDisplayHandle(email: string): string {
  const parts = email.split('@');
  return parts[0] || 'surfer';
}

/**
 * Generates a unique, sanitized handle for a new user.
 * If the base handle is already taken, automatically appends a random retro number suffix.
 */
export async function generateUniqueHandle(rawPrefix: string): Promise<string> {
  let candidate = rawPrefix
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 20);

  if (!candidate || candidate.length < 3) {
    candidate = 'surfer';
  }

  // 1. Try base candidate
  const check = await query('SELECT id FROM users WHERE handle = $1', [candidate]);
  if (check.rows.length === 0) {
    return candidate;
  }

  // 2. If collision, append random retro numbers
  for (let i = 0; i < 20; i++) {
    const suffix = Math.floor(100 + Math.random() * 900); // 3-digit suffix e.g. 196, 404, 782
    const suffixed = `${candidate.slice(0, 15)}_${suffix}`;
    const dupCheck = await query('SELECT id FROM users WHERE handle = $1', [suffixed]);
    if (dupCheck.rows.length === 0) {
      return suffixed;
    }
  }

  return `${candidate.slice(0, 12)}_${Date.now().toString(36).slice(-4)}`;
}

const OTP_MAX_ATTEMPTS = 5;
const OTP_TTL_MINUTES = 10;

/** HMAC-SHA256 of the code, bound to the identifier, so DB read access alone does not reveal valid codes. */
function hashOtp(identifier: string, code: string): string {
  return crypto.createHmac('sha256', config.jwtSecret).update(`${identifier}:${code}`).digest('hex');
}

function normalizeLoginIdentifier(rawIdentifier: string): { normalized: string; dispatchTarget: string; isPhoneNumber: boolean } {
  const trimmed = rawIdentifier.trim();
  const digits = trimmed.replace(/\D/g, '');
  const isPhoneNumber = digits.length >= 7 && digits.length <= 15 && !trimmed.includes('@');
  const isEmail = trimmed.includes('@') && trimmed.indexOf('@') > 0 && trimmed.indexOf('@') < trimmed.length - 1;
  if (!isEmail && !isPhoneNumber) {
    throw new Error('Please provide a valid email address or mobile phone number.');
  }
  const normalized = isEmail ? trimmed.toLowerCase() : `${digits}@sms.neogram.local`;
  return { normalized, dispatchTarget: isPhoneNumber ? digits : normalized, isPhoneNumber };
}

export async function requestOtp(rawIdentifier: string): Promise<{ ok: boolean; identifier: string; code: string; message: string }> {
  if (!rawIdentifier || !rawIdentifier.trim()) {
    throw new Error('Please provide a valid email address or phone number.');
  }

  const trimmed = rawIdentifier.trim();

  // Reject @handle logins because handles are changeable and non-unique permanent identifiers
  if (trimmed.startsWith('@')) {
    throw new Error('Logging in with a @handle is not supported because callsigns can be changed. Please enter your email address or mobile phone number.');
  }

  const { normalized, dispatchTarget } = normalizeLoginIdentifier(trimmed);

  // 1. Check if existing user node is banned
  const existing = await query(
    'SELECT id, handle, uin, is_banned as "isBanned" FROM users WHERE email = $1',
    [normalized]
  );
  if (existing.rows.length > 0 && existing.rows[0].isBanned) {
    throw new Error('This station node has been suspended by the network administrator.');
  }

  const existingUser = existing.rows[0];
  const userHandle = existingUser ? existingUser.handle : extractDisplayHandle(normalized);
  const userUin = existingUser ? (existingUser.uin ? parseInt(existingUser.uin, 10) : undefined) : undefined;

  // 2. Generate cryptographically secure 6-digit OTP code
  const code = crypto.randomInt(100000, 1000000).toString();

  // 3. Persist ONLY a hash of the code (10-minute expiry, attempt counter reset)
  await query(
    `INSERT INTO otp_challenges (identifier, code_hash, attempts, expires_at)
     VALUES ($1, $2, 0, NOW() + INTERVAL '${OTP_TTL_MINUTES} minutes')
     ON CONFLICT (identifier) DO UPDATE
       SET code_hash = EXCLUDED.code_hash, attempts = 0, expires_at = EXCLUDED.expires_at, created_at = NOW()`,
    [normalized, hashOtp(normalized, code)]
  );
  // Opportunistic cleanup of expired challenges
  await query('DELETE FROM otp_challenges WHERE expires_at < NOW()').catch(() => {});

  // Plaintext codes are NEVER logged in production. Dev console echo requires explicit opt-in.
  if (config.allowDemoOtp) {
    console.log(`[:> DEV OTP] ${dispatchTarget}: ${code}`);
  }

  // 4. Dispatch notification via Email (Resend) or SMS (Twilio)
  const notifyResult = await sendOtpNotification({
    destination: dispatchTarget,
    code,
    handle: userHandle,
    uin: userUin ?? 0,
  });

  if (!notifyResult.ok && !config.allowDemoOtp) {
    await query('DELETE FROM otp_challenges WHERE identifier = $1', [normalized]).catch(() => {});
    throw new Error('Could not deliver the authorization code right now. Please try again shortly.');
  }

  return {
    ok: true,
    identifier: normalized,
    code,
    message: notifyResult.message || 'Carrier handshake established. 6-digit OTP code dispatched.',
  };
}

const GENERIC_OTP_FAILURE = 'Invalid or expired authorization key. Please request a new carrier signal.';

export async function verifyOtp(rawIdentifier: string, code: string): Promise<AuthUser> {
  const { normalized } = normalizeLoginIdentifier(String(rawIdentifier));
  const submitted = String(code || '').trim();

  const challengeRes = await query(
    'SELECT code_hash, attempts, expires_at FROM otp_challenges WHERE identifier = $1',
    [normalized]
  );
  const challenge = challengeRes.rows[0];

  // Single generic message for unknown identifier / expired / burned codes (no account enumeration)
  if (!challenge || new Date(challenge.expires_at) < new Date() || challenge.attempts >= OTP_MAX_ATTEMPTS) {
    throw new Error(GENERIC_OTP_FAILURE);
  }

  const expected = Buffer.from(challenge.code_hash, 'hex');
  const actual = Buffer.from(hashOtp(normalized, submitted), 'hex');
  const matches = expected.length === actual.length && crypto.timingSafeEqual(expected, actual);

  if (!matches) {
    // Atomic, persisted attempt counter (survives restarts, shared across instances)
    const upd = await query(
      'UPDATE otp_challenges SET attempts = attempts + 1 WHERE identifier = $1 RETURNING attempts',
      [normalized]
    );
    const attempts = upd.rows[0]?.attempts ?? OTP_MAX_ATTEMPTS;
    if (attempts >= OTP_MAX_ATTEMPTS) {
      await query('DELETE FROM otp_challenges WHERE identifier = $1', [normalized]);
      throw new Error('Too many invalid attempts. Authorization key has been burned. Please request a new carrier signal.');
    }
    throw new Error(`Invalid authorization key. Code does not match. (${OTP_MAX_ATTEMPTS - attempts} attempts remaining)`);
  }

  // Consume the challenge (single use)
  await query('DELETE FROM otp_challenges WHERE identifier = $1', [normalized]);

  // Find or register the account now that ownership of the identifier is proven
  let res = await query(
    `SELECT id, email, handle, uin, site_url, deploy_path, deployment_type, avatar_path, is_banned as "isBanned"
     FROM users WHERE email = $1`,
    [normalized]
  );
  if (res.rows.length === 0) {
    const handle = await generateUniqueHandle(extractDisplayHandle(normalized));
    await query(
      `INSERT INTO users (email, handle, site_url, deployment_type) VALUES ($1, $2, $3, 'none')`,
      [normalized, handle, null]
    );
    res = await query(
      `SELECT id, email, handle, uin, site_url, deploy_path, deployment_type, avatar_path, is_banned as "isBanned"
       FROM users WHERE email = $1`,
      [normalized]
    );
    console.log(`[:> AUTH] Registered new Neogram node: @${handle} (UIN: #${res.rows[0]?.uin})`);
  }

  const user = res.rows[0];
  if (user.isBanned) {
    throw new Error('This station node has been suspended by the network administrator.');
  }

  await query('UPDATE users SET updated_at = NOW() WHERE id = $1', [user.id]);
  console.log(`[:> AUTH SUCCESS] User node authenticated: @${user.handle} (UIN: #${user.uin})`);

  const isAdmin = config.adminEmails.includes(user.email.toLowerCase());

  return {
    id: user.id,
    email: user.email,
    handle: user.handle,
    uin: user.uin ? parseInt(user.uin, 10) : undefined,
    siteUrl: user.site_url,
    deployPath: user.deploy_path || 'neogram',
    deploymentType: user.deployment_type,
    avatarPath: user.avatar_path,
    isBanned: false,
    isAdmin,
  };
}

export async function getUserById(id: string): Promise<AuthUser | null> {
  const res = await query(
    'SELECT id, email, handle, uin, site_url as "siteUrl", deploy_path as "deployPath", deployment_type as "deploymentType", deployment_credentials, avatar_path as "avatarPath", is_banned as "isBanned", ban_reason as "banReason", banned_at as "bannedAt" FROM users WHERE id = $1',
    [id]
  );
  if (!res.rows[0]) return null;
  const user = res.rows[0];
  let hasApiKey = false;
  if (user.deployment_credentials) {
    try {
      const { decryptCredentials } = await import('../utils/crypto');
      const creds = decryptCredentials<{ apiKey?: string }>(user.deployment_credentials);
      hasApiKey = !!(creds && creds.apiKey);
    } catch {
      hasApiKey = false;
    }
  }
  let baseSite = user.siteUrl ? String(user.siteUrl).trim() : '';
  let rawDeploy = (user.deployPath !== null && user.deployPath !== undefined)
    ? String(user.deployPath).trim().replace(/^\/+|\/+$/g, '')
    : 'neogram';

  if (!baseSite) {
    try {
      const siteRes = await query(
        'SELECT site_url, deploy_path FROM sites WHERE user_id = $1 ORDER BY is_default DESC, created_at ASC LIMIT 1',
        [id]
      );
      if (siteRes.rows[0]?.site_url) {
        baseSite = siteRes.rows[0].site_url.trim();
        if (siteRes.rows[0].deploy_path !== null && siteRes.rows[0].deploy_path !== undefined) {
          rawDeploy = String(siteRes.rows[0].deploy_path).trim().replace(/^\/+|\/+$/g, '');
        }
      }
    } catch (_e) {}
  }

  let cleanBaseSite: string | undefined = undefined;
  if (baseSite) {
    try {
      const parsed = new URL(baseSite.startsWith('http') ? baseSite : `https://${baseSite}`);
      cleanBaseSite = `${parsed.protocol}//${parsed.host}`;
    } catch {
      cleanBaseSite = baseSite.replace(/\/+$/, '');
    }
  }

  const galleryUrl = cleanBaseSite && rawDeploy
    ? `${cleanBaseSite}/${rawDeploy}/`
    : (cleanBaseSite ? `${cleanBaseSite}/` : undefined);

  const isAdmin = config.adminEmails.includes(user.email.toLowerCase());

  return {
    id: user.id,
    email: user.email,
    handle: user.handle,
    uin: user.uin ? parseInt(user.uin, 10) : undefined,
    siteUrl: cleanBaseSite,
    galleryUrl,
    deployPath: rawDeploy,
    deploymentType: user.deploymentType,
    avatarPath: user.avatarPath,
    hasApiKey,
    isBanned: !!user.isBanned,
    banReason: user.banReason,
    bannedAt: user.bannedAt,
    isAdmin,
  };
}
