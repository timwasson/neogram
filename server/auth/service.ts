import { query } from '../db';

export interface AuthUser {
  id: string;
  email: string;
  handle: string;
  siteUrl?: string;
  deploymentType?: string;
  avatarPath?: string;
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

export async function requestOtp(rawIdentifier: string): Promise<{ ok: boolean; identifier: string; code: string; message: string }> {
  if (!rawIdentifier || !rawIdentifier.trim()) {
    throw new Error('Please provide a valid email address or phone number.');
  }

  const normalized = normalizeIdentifier(rawIdentifier);
  const handle = extractDisplayHandle(normalized);

  // 1. Check or create user
  const existing = await query('SELECT id, email, handle FROM users WHERE email = $1', [normalized]);

  let userId: string;
  if (existing.rows.length > 0) {
    userId = existing.rows[0].id;
  } else {
    const newUser = await query(
      `INSERT INTO users (email, handle, site_url, deployment_type)
       VALUES ($1, $2, $3, 'none')
       RETURNING id, email, handle`,
      [normalized, handle, `http://${handle}.neocities.org`]
    );
    userId = newUser.rows[0].id;
    console.log(`[:> AUTH] Registered new Neogram user: ${handle} (${normalized})`);
  }

  // 2. Generate 6-digit OTP code
  const code = Math.floor(100000 + Math.random() * 900000).toString();

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
  console.log(`[:> 6-DIGIT OTP AUTH CODE]: ${code}`);
  console.log('====================================================');

  return {
    ok: true,
    identifier: normalized,
    code,
    message: 'Carrier handshake established. 6-digit OTP code dispatched.',
  };
}

export async function verifyOtp(rawIdentifier: string, code: string): Promise<AuthUser> {
  const normalized = normalizeIdentifier(rawIdentifier);

  const res = await query(
    `SELECT id, email, handle, auth_token, auth_token_expires_at, site_url, deployment_type
     FROM users
     WHERE email = $1`,
    [normalized]
  );

  if (res.rows.length === 0) {
    throw new Error('User node not found in network registry.');
  }

  const user = res.rows[0];

  if (!user.auth_token || user.auth_token !== code.trim()) {
    throw new Error('Invalid authorization key. Code does not match.');
  }

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

  console.log(`[:> AUTH SUCCESS] User node authenticated: ${user.handle} (${user.id})`);

  return {
    id: user.id,
    email: user.email,
    handle: user.handle,
    siteUrl: user.site_url,
    deploymentType: user.deployment_type,
    avatarPath: user.avatar_path,
  };
}

export async function getUserById(id: string): Promise<AuthUser | null> {
  const res = await query('SELECT id, email, handle, site_url, deployment_type, avatar_path as "avatarPath" FROM users WHERE id = $1', [id]);
  return res.rows[0] || null;
}
