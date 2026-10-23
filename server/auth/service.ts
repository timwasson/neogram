import crypto from 'crypto';
import { query } from '../db';
import { sendOtpNotification } from '../services/notifier';

// In-memory failed attempt counter: max 5 failed attempts before burning code
const failedOtpAttempts = new Map<string, number>();

export interface AuthUser {
  id: string;
  email: string;
  handle: string;
  uin?: number;
  siteUrl?: string;
  deployPath?: string;
  deploymentType?: string;
  avatarPath?: string;
  hasApiKey?: boolean;
}

export function normalizeIdentifier(input: string): string {
  const trimmed = input.trim();
  if (trimmed.includes('@')) {
    return trimmed.toLowerCase();
  }
  // Strip non-digits for phone numbers
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length >= 7) {
    return `${digits}@sms.neogram.local`;
  }
  // Otherwise treat as handle/username
  return `${trimmed.toLowerCase()}@user.neogram.local`;
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

export async function requestOtp(rawIdentifier: string): Promise<{ ok: boolean; identifier: string; code: string; message: string; uin?: number }> {
  if (!rawIdentifier || !rawIdentifier.trim()) {
    throw new Error('Please provide a valid email address or phone number.');
  }

  const normalized = normalizeIdentifier(rawIdentifier);

  // 1. Check or create user
  const existing = await query('SELECT id, email, handle, uin FROM users WHERE email = $1', [normalized]);

  let userId: string;
  let userHandle: string;
  let userUin: number;

  if (existing.rows.length > 0) {
    userId = existing.rows[0].id;
    userHandle = existing.rows[0].handle;
    userUin = existing.rows[0].uin ? parseInt(existing.rows[0].uin, 10) : 100101;
  } else {
    userHandle = await generateUniqueHandle(extractDisplayHandle(normalized));
    const newUser = await query(
      `INSERT INTO users (email, handle, site_url, deployment_type)
       VALUES ($1, $2, $3, 'none')
       RETURNING id, email, handle, uin`,
      [normalized, userHandle, `https://${userHandle}.neocities.org`]
    );
    userId = newUser.rows[0].id;
    userUin = parseInt(newUser.rows[0].uin, 10);
    console.log(`[:> AUTH] Registered new Neogram node: @${userHandle} (UIN: #${userUin}, ${normalized})`);
  }

  // 2. Generate cryptographically secure 6-digit OTP code
  const code = crypto.randomInt(100000, 1000000).toString();

  // 3. Save OTP with 10-minute expiry
  await query(
    `UPDATE users
     SET auth_token = $1,
         auth_token_expires_at = NOW() + INTERVAL '10 minutes',
         updated_at = NOW()
     WHERE id = $2`,
    [code, userId]
  );

  console.log('====================================================');
  console.log(`[:> DIAL-UP CARRIER TRANSMISSION]`);
  console.log(`[:> TARGET]: ${rawIdentifier} (${normalized})`);
  console.log(`[:> NODE UIN]: #${userUin}`);
  console.log(`[:> 6-DIGIT OTP AUTH CODE]: ${code}`);
  console.log('====================================================');

  // 4. Dispatch notification via Email (Resend) or SMS (Twilio)
  const notifyResult = await sendOtpNotification({
    destination: rawIdentifier,
    code,
    handle: userHandle,
    uin: userUin,
  });

  return {
    ok: true,
    identifier: normalized,
    code,
    message: notifyResult.message || 'Carrier handshake established. 6-digit OTP code dispatched.',
    uin: userUin,
  };
}

export async function verifyOtp(rawIdentifier: string, code: string): Promise<AuthUser> {
  const normalized = normalizeIdentifier(rawIdentifier);

  const res = await query(
    `SELECT id, email, handle, uin, auth_token, auth_token_expires_at, site_url, deploy_path, deployment_type, avatar_path
     FROM users
     WHERE email = $1`,
    [normalized]
  );

  if (res.rows.length === 0) {
    throw new Error('User node not found in network registry.');
  }

  const user = res.rows[0];

  if (!user.auth_token || user.auth_token !== code.trim()) {
    const attempts = (failedOtpAttempts.get(user.id) || 0) + 1;
    if (attempts >= 5) {
      // Invalidate code after 5 failed attempts to prevent brute force
      await query(
        `UPDATE users
         SET auth_token = NULL,
             auth_token_expires_at = NULL,
             updated_at = NOW()
         WHERE id = $1`,
        [user.id]
      );
      failedOtpAttempts.delete(user.id);
      throw new Error('Too many invalid attempts. Authorization key has been burned. Please request a new carrier signal.');
    }
    failedOtpAttempts.set(user.id, attempts);
    throw new Error(`Invalid authorization key. Code does not match. (${5 - attempts} attempts remaining)`);
  }

  // Clear failed attempts counter on success
  failedOtpAttempts.delete(user.id);

  if (user.auth_token_expires_at && new Date(user.auth_token_expires_at) < new Date()) {
    throw new Error('Authorization key has expired. Please request a new carrier signal.');
  }

  // Clear OTP token once consumed
  await query(
    `UPDATE users
     SET auth_token = NULL,
         auth_token_expires_at = NULL,
         updated_at = NOW()
     WHERE id = $1`,
    [user.id]
  );

  console.log(`[:> AUTH SUCCESS] User node authenticated: @${user.handle} (UIN: #${user.uin}, ${user.id})`);

  return {
    id: user.id,
    email: user.email,
    handle: user.handle,
    uin: user.uin ? parseInt(user.uin, 10) : undefined,
    siteUrl: user.site_url,
    deployPath: user.deploy_path || 'neogram',
    deploymentType: user.deployment_type,
    avatarPath: user.avatar_path,
  };
}

export async function getUserById(id: string): Promise<AuthUser | null> {
  const res = await query(
    'SELECT id, email, handle, uin, site_url as "siteUrl", deploy_path as "deployPath", deployment_type as "deploymentType", deployment_credentials, avatar_path as "avatarPath" FROM users WHERE id = $1',
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
  const rawDeploy = user.deployPath !== null && user.deployPath !== undefined
    ? String(user.deployPath).trim().replace(/^\/+|\/+$/g, '')
    : 'neogram';
  const baseSite = user.siteUrl || (user.handle ? `https://${user.handle}.neocities.org` : undefined);
  const fullSiteUrl = baseSite && rawDeploy ? `${baseSite.replace(/\/+$/, '')}/${rawDeploy}/` : (baseSite ? `${baseSite.replace(/\/+$/, '')}/` : undefined);

  return {
    id: user.id,
    email: user.email,
    handle: user.handle,
    uin: user.uin ? parseInt(user.uin, 10) : undefined,
    siteUrl: fullSiteUrl,
    deployPath: rawDeploy,
    deploymentType: user.deploymentType,
    avatarPath: user.avatarPath,
    hasApiKey,
  };
}
