import { Request, Response, NextFunction } from 'express';
import { extractToken, verifySessionToken } from './jwt';
import { getUserById } from './service';

/**
 * Shared guard for private workstation APIs:
 *  - full session token only (scoped Cyber-Pass / handoff tokens are rejected)
 *  - the account must still exist and must not be banned (bans take effect immediately,
 *    without waiting for the 7-day JWT to expire)
 * Sets `req.user` (token payload, for existing handlers) and `req.authUser` (fresh DB record).
 */
export function createRequireSession(messages: { missing: string; expired: string }) {
  return async function requireSession(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const token = extractToken(req);
      if (!token) {
        res.status(401).json({ ok: false, error: messages.missing });
        return;
      }
      const payload = verifySessionToken(token);
      if (!payload) {
        res.status(401).json({ ok: false, error: messages.expired });
        return;
      }
      const user = await getUserById(payload.userId);
      if (!user) {
        res.status(401).json({ ok: false, error: messages.expired });
        return;
      }
      if (user.isBanned) {
        res.status(403).json({ ok: false, error: 'This account has been suspended.' });
        return;
      }
      (req as any).user = payload;
      (req as any).authUser = user;
      next();
    } catch (err) {
      next(err);
    }
  };
}
