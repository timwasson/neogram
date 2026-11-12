import crypto from 'crypto';
import { config } from '../config';

/**
 * Server-issued identities for anonymous pager visitors.
 *
 * Replies a station sends to a guest are queued under the guest's handle and handed to whichever socket
 * presents that handle. Client-chosen handles (e.g. `guest_` + 4 digits) were trivially guessable, so
 * anyone could claim a guest's identity and receive (and thereby delete) the station's replies.
 * Now the server mints `guest_<10 hex>` plus a key = HMAC(server secret, handle); a handle is honoured
 * only together with its key. The key is stateless, so no table is needed.
 */
const ANON_HANDLE_RE = /^guest_[0-9a-f]{10}$/;

function keyFor(handle: string): string {
  return crypto.createHmac('sha256', config.jwtSecret).update(`neogram-anon-v1:${handle}`).digest('base64url').slice(0, 32);
}

export function issueAnonIdentity(): { handle: string; key: string } {
  const handle = `guest_${crypto.randomBytes(5).toString('hex')}`;
  return { handle, key: keyFor(handle) };
}

export function verifyAnonIdentity(handle: unknown, key: unknown): boolean {
  if (typeof handle !== 'string' || typeof key !== 'string' || !ANON_HANDLE_RE.test(handle)) return false;
  const expected = Buffer.from(keyFor(handle));
  const actual = Buffer.from(key);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

/** Reuses a proven identity, or issues a fresh one. */
export function resolveAnonIdentity(handle: unknown, key: unknown): { handle: string; key: string; reused: boolean } {
  if (verifyAnonIdentity(handle, key)) return { handle: handle as string, key: key as string, reused: true };
  return { ...issueAnonIdentity(), reused: false };
}
