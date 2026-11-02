import { Request, Response, NextFunction } from 'express';
import { extractToken, verifySessionToken } from '../auth/jwt';
import { getUserById, AuthUser } from '../auth/service';
import { config } from '../config';

export interface AdminRequest extends Request {
  adminUser?: AuthUser;
}

/**
 * Validates that an incoming HTTP request is from an authenticated SysOp admin.
 * If unauthorized, returns HTTP 404 (Not Found) rather than 403 (Forbidden)
 * to prevent automated scanners or unauthorized users from probing admin surfaces.
 */
export async function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const token = extractToken(req);
    if (!token) {
      res.status(404).render('404', {
        title: 'Neogram - Page Not Found',
        url: req.originalUrl,
      });
      return;
    }

    const payload = verifySessionToken(token);
    if (!payload || !payload.userId) {
      res.status(404).render('404', {
        title: 'Neogram - Page Not Found',
        url: req.originalUrl,
      });
      return;
    }

    const user = await getUserById(payload.userId);
    if (!user || user.isBanned) {
      res.status(404).render('404', {
        title: 'Neogram - Page Not Found',
        url: req.originalUrl,
      });
      return;
    }

    const isAuthorizedAdmin =
      config.adminEmails.length > 0 &&
      config.adminEmails.includes(user.email.toLowerCase());

    if (!isAuthorizedAdmin) {
      console.warn(`[:> SYSOP SECURITY REJECTION] Non-admin @${user.handle} (${user.email}) attempted to access ${req.originalUrl}`);
      res.status(404).render('404', {
        title: 'Neogram - Page Not Found',
        url: req.originalUrl,
      });
      return;
    }

    (req as AdminRequest).adminUser = user;
    res.locals.currentUser = user;
    res.locals.isAdmin = true;
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Validates SysOp admin authentication for JSON API routes.
 * Returns JSON 404 if unauthorized to prevent API fingerprinting.
 */
export async function requireAdminApi(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const token = extractToken(req);
    if (!token) {
      res.status(404).json({ ok: false, error: 'Endpoint Not Found' });
      return;
    }

    const payload = verifySessionToken(token);
    if (!payload || !payload.userId) {
      res.status(404).json({ ok: false, error: 'Endpoint Not Found' });
      return;
    }

    const user = await getUserById(payload.userId);
    if (!user || user.isBanned) {
      res.status(404).json({ ok: false, error: 'Endpoint Not Found' });
      return;
    }

    const isAuthorizedAdmin =
      config.adminEmails.length > 0 &&
      config.adminEmails.includes(user.email.toLowerCase());

    if (!isAuthorizedAdmin) {
      console.warn(`[:> SYSOP SECURITY REJECTION] API call to ${req.originalUrl} refused for @${user.handle}`);
      res.status(404).json({ ok: false, error: 'Endpoint Not Found' });
      return;
    }

    (req as AdminRequest).adminUser = user;
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * CSRF mitigation header validation for all mutating SysOp endpoints (POST, PUT, DELETE).
 */
export function validateAdminMutationHeader(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const method = req.method.toUpperCase();
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
    const header = req.headers['x-neogram-sysop-op'];
    if (header !== '1' && header !== 'true') {
      res.status(400).json({
        ok: false,
        error: 'Missing or invalid SysOp operation header (x-neogram-sysop-op). Request refused.',
      });
      return;
    }
  }
  next();
}
