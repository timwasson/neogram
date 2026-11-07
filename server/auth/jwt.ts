import jwt from 'jsonwebtoken';
import { Request, Response } from 'express';
import { config } from '../config';

export interface UserSessionPayload {
  userId: string;
  email: string;
  handle: string;
  uin?: number;
  /**
   * Token scope. Absent/'session' = full workstation session.
   * 'pass' = Cyber-Pass issued to third-party static sites: short-lived and ONLY accepted by
   * social endpoints (like, comment, follow, guestbook, pager, chat) that opt in with allowPass.
   */
  scope?: 'session' | 'pass';
}

export const COOKIE_NAME = 'neogram_session';

export function signSessionToken(payload: UserSessionPayload, expiresIn: string = '7d'): string {
  return jwt.sign(payload, config.jwtSecret, {
    algorithm: 'HS256',
    expiresIn: expiresIn as any,
  });
}

export function verifySessionToken(token: string, allowPass: boolean = false): UserSessionPayload | null {
  try {
    const payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] }) as UserSessionPayload;
    if (payload.scope === 'pass' && !allowPass) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Issues a scoped, short-lived (1h) Cyber-Pass token for third-party static sites. */
export function signPassToken(payload: Omit<UserSessionPayload, 'scope'>): string {
  return jwt.sign({ ...payload, scope: 'pass' }, config.jwtSecret, { expiresIn: '1h', algorithm: 'HS256' });
}

export function extractToken(req: Request): string | null {
  if (req.cookies && req.cookies[COOKIE_NAME]) {
    return req.cookies[COOKIE_NAME];
  }
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7).trim();
  }
  // NOTE: tokens are intentionally NOT accepted from the URL query string (they leak via logs,
  // history and Referer). The WebSocket upgrade handler has its own explicit fallback.
  return null;
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: config.env === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    path: '/',
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    secure: config.env === 'production',
    sameSite: 'lax',
    path: '/',
  });
}

