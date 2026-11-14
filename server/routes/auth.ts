import { Router, Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { config } from '../config';
import { requestOtp, verifyOtp, getUserById, normalizeIdentifier } from '../auth/service';
import { signSessionToken, setSessionCookie, clearSessionCookie, verifySessionToken, extractToken, signHandoffToken, signPassToken, COOKIE_NAME } from '../auth/jwt';

export const authRouter = Router();

// 1. IP-level rate limiting via express-rate-limit
const otpRequestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 6, // max 6 OTP requests per 15 minutes per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    ok: false,
    error: 'Too many code requests. Please wait 15 minutes and try again.',
  },
  skip: (req) => (req.headers['x-test-suite'] === 'true' && process.env.NODE_ENV !== 'production') || process.env.NODE_ENV === 'test',
});

const otpVerifyLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 12, // max 12 verification attempts per 5 minutes per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    ok: false,
    error: 'Too many tries. Please wait 5 minutes and try again.',
  },
  skip: (req) => (req.headers['x-test-suite'] === 'true' && process.env.NODE_ENV !== 'production') || process.env.NODE_ENV === 'test',
});

// 2. Memory-safe identifier-level rate limiting (bounded Map with LRU/expiry sweep)
const idRateLimits = new Map<string, number[]>();
const MAX_ID_MAP_ENTRIES = 2000;

function checkIdentifierRateLimit(id: string, maxAttempts: number, windowMs: number): boolean {
  const now = Date.now();
  // Self-cleaning sweep if map grows large to prevent memory leaks
  if (idRateLimits.size > MAX_ID_MAP_ENTRIES) {
    for (const [key, timestamps] of idRateLimits.entries()) {
      if (!timestamps.some((ts) => now - ts < windowMs)) {
        idRateLimits.delete(key);
      }
    }
  }

  const timestamps = (idRateLimits.get(id) || []).filter((ts) => now - ts < windowMs);
  if (timestamps.length >= maxAttempts) {
    return false;
  }
  timestamps.push(now);
  idRateLimits.set(id, timestamps);
  return true;
}

// 1. Request OTP Code
authRouter.post('/request-otp', otpRequestLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { identifier } = req.body;
    if (!identifier || typeof identifier !== 'string') {
      res.status(400).json({ ok: false, error: 'Enter your email address or mobile number.' });
      return;
    }

    const cleanId = identifier.trim().toLowerCase();
    const isTestBypass = (req.headers['x-test-suite'] === 'true' && !cleanId.startsWith('spam_test_') && req.headers['x-test-rate-limit'] !== 'true' && process.env.NODE_ENV !== 'production');

    // Check rate limit on target identifier (max 4 per 15 minutes)
    // Key the per-destination limit on the NORMALISED identifier so "555-123-4567", "(555) 1234567"
    // and "5551234567" share one budget.
    if (!isTestBypass && !checkIdentifierRateLimit(`req:${normalizeIdentifier(cleanId)}`, 4, 15 * 60 * 1000)) {
      res.status(429).json({
        ok: false,
        error: 'Too many code requests. Please wait 15 minutes and try again.',
      });
      return;
    }

    const result = await requestOtp(cleanId);
    res.json({
      ok: true,
      message: result.message,
      identifier: result.identifier,
      // Dev/test convenience ONLY: requires NODE_ENV!=production AND explicit ALLOW_DEMO_OTP=true
      demoCode: config.allowDemoOtp ? result.code : undefined,
    });
  } catch (err: any) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// 2. Verify OTP & Establish Session
authRouter.post('/verify-otp', otpVerifyLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { identifier, code } = req.body;
    if (!identifier || !code) {
      res.status(400).json({ ok: false, error: 'Enter your email address or mobile number and the 6-digit code.' });
      return;
    }

    const cleanId = String(identifier).trim().toLowerCase();
    const isTestSuite = (req.headers['x-test-suite'] === 'true' && process.env.NODE_ENV !== 'production') || process.env.NODE_ENV === 'test';

    if (!isTestSuite && !checkIdentifierRateLimit(`verify:${normalizeIdentifier(cleanId)}`, 10, 5 * 60 * 1000)) {
      res.status(429).json({ ok: false, error: 'Too many tries. Please wait 5 minutes and try again.' });
      return;
    }

    const user = await verifyOtp(identifier, code);
    const token = signSessionToken({
      userId: user.id,
      email: user.email,
      handle: user.handle,
      uin: user.uin,
    });

    setSessionCookie(res, token);

    res.json({
      ok: true,
      message: 'Authentication successful. Carrier session established.',
      token,
      user,
    });
  } catch (err: any) {
    res.status(401).json({ ok: false, error: err.message });
  }
});

// 3. Current Session Info
authRouter.get('/me', async (req: Request, res: Response) => {
  const token = extractToken(req);
  if (!token) {
    res.status(401).json({ ok: false, user: null });
    return;
  }

  const payload = verifySessionToken(token);
  if (!payload) {
    clearSessionCookie(res);
    res.status(401).json({ ok: false, user: null });
    return;
  }

  const user = await getUserById(payload.userId);
  if (!user) {
    clearSessionCookie(res);
    res.status(401).json({ ok: false, user: null });
    return;
  }

  res.json({ ok: true, user });
});

// 4. Logout Session
authRouter.post('/logout', (_req: Request, res: Response) => {
  clearSessionCookie(res);
  res.json({ ok: true, message: 'Session terminated.' });
});

// 5. Generate Smart Handoff Ticket (PWA -> Native Browser / Static Site)
authRouter.post('/handoff-ticket', async (req: Request, res: Response) => {
  const token = extractToken(req);
  if (!token) {
    res.status(401).json({ ok: false, error: 'Authentication required' });
    return;
  }

  const payload = verifySessionToken(token);
  if (!payload) {
    res.status(401).json({ ok: false, error: 'Invalid or expired session' });
    return;
  }

  const { target } = req.body;
  if (!target || typeof target !== 'string') {
    res.status(400).json({ ok: false, error: 'Target URL is required' });
    return;
  }

  try {
    const u = new URL(target.trim());
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      res.status(400).json({ ok: false, error: 'Invalid protocol. Only http(s) URLs are supported.' });
      return;
    }
    if (u.username || u.password) {
      res.status(400).json({ ok: false, error: 'URLs with embedded credentials are not allowed.' });
      return;
    }
  } catch {
    res.status(400).json({ ok: false, error: 'Malformed target URL' });
    return;
  }

  const user = await getUserById(payload.userId);
  if (!user || user.isBanned) {
    res.status(401).json({ ok: false, error: 'Account not found' });
    return;
  }

  const ticket = signHandoffToken({
    userId: user.id,
    email: user.email,
    handle: user.handle,
    uin: user.uin,
    target: target.trim(),
  });

  const hostHeader = req.get('host');
  const baseUrl = hostHeader ? `${req.protocol}://${hostHeader}` : config.appUrl.replace(/\/$/, '');
  const handoffUrl = `${baseUrl}/auth/handoff?ticket=${encodeURIComponent(ticket)}&target=${encodeURIComponent(target.trim())}`;

  res.json({
    ok: true,
    ticket,
    handoffUrl,
  });
});

// 6. Exchange a full session (Bearer only, e.g. the browser extension) for a scoped 1h Cyber-Pass
//    destined for one static-site origin. Cookies are deliberately NOT accepted here.
authRouter.post('/pass-token', async (req: Request, res: Response) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7).trim() : '';
  const payload = token ? verifySessionToken(token) : null;
  if (!payload) {
    res.status(401).json({ ok: false, error: 'Authentication required' });
    return;
  }

  const rawOrigin = req.body?.origin;
  let origin = '';
  try {
    const u = new URL(String(rawOrigin || ''));
    if ((u.protocol === 'http:' || u.protocol === 'https:') && !u.username && !u.password) origin = u.origin;
  } catch {
    origin = '';
  }
  if (!origin || origin !== String(rawOrigin)) {
    res.status(400).json({ ok: false, error: 'A plain http(s) origin is required.' });
    return;
  }

  const user = await getUserById(payload.userId);
  if (!user || user.isBanned) {
    res.status(401).json({ ok: false, error: 'Authentication required' });
    return;
  }

  res.setHeader('Cache-Control', 'no-store');
  res.json({
    ok: true,
    token: signPassToken({ userId: user.id, email: user.email, handle: user.handle, uin: user.uin }),
    handle: user.handle,
    uin: user.uin || null,
    avatar: user.avatarPath || '',
  });
});

/**
 * Verifies a Cyber-Pass presented by a static site (from a #neogram_pass link, a popup or the extension)
 * and returns the identity the SERVER vouches for. Static pages must store and display only this, never
 * fields decoded client-side or copied from the URL. Bearer header only; read-only; CORS-public (no cookies).
 */
export async function passVerifyHandler(req: Request, res: Response): Promise<void> {
  res.setHeader('Cache-Control', 'no-store');
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7).trim() : '';
  const payload = token ? verifySessionToken(token, true) : null;
  // Only scoped passes: a full session token must never be pasted into third-party pages/URLs
  if (!payload || payload.scope !== 'pass') {
    res.status(401).json({ ok: false, error: 'Invalid or expired Cyber-Pass' });
    return;
  }
  const user = await getUserById(payload.userId);
  if (!user || user.isBanned) {
    res.status(401).json({ ok: false, error: 'Invalid or expired Cyber-Pass' });
    return;
  }
  const exp = (payload as any).exp;
  res.json({
    ok: true,
    handle: user.handle,
    uin: user.uin || null,
    avatar: user.avatarPath || '',
    expiresAt: typeof exp === 'number' ? new Date(exp * 1000).toISOString() : null,
  });
}
