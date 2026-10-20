import jwt from 'jsonwebtoken';
import { Response } from 'express';
import { config } from '../config';

export interface UserSessionPayload {
  userId: string;
  email: string;
  handle: string;
}

export const COOKIE_NAME = 'neogram_session';

export function signSessionToken(payload: UserSessionPayload): string {
  return jwt.sign(payload, config.jwtSecret, {
    expiresIn: '7d',
  });
}

export function verifySessionToken(token: string): UserSessionPayload | null {
  try {
    return jwt.verify(token, config.jwtSecret) as UserSessionPayload;
  } catch {
    return null;
  }
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
