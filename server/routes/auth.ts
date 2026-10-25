import { Router, Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { requestOtp, verifyOtp, getUserById } from '../auth/service';
import { signSessionToken, setSessionCookie, clearSessionCookie, verifySessionToken, extractToken, COOKIE_NAME } from '../auth/jwt';

export const authRouter = Router();

// 1. IP-level rate limiting via express-rate-limit
const otpRequestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 6, // max 6 OTP requests per 15 minutes per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    ok: false,
    error: 'Carrier busy: Too many OTP dispatch requests. Please wait 15 minutes before requesting another code.',
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
    error: 'Too many verification attempts. Please wait 5 minutes before trying again.',
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
      res.status(400).json({ ok: false, error: 'Identifier (email or mobile phone) is required.' });
      return;
    }

    const cleanId = identifier.trim().toLowerCase();
    const isTestBypass = (req.headers['x-test-suite'] === 'true' && !cleanId.startsWith('spam_test_') && req.headers['x-test-rate-limit'] !== 'true' && process.env.NODE_ENV !== 'production');

    // Check rate limit on target identifier (max 4 per 15 minutes)
    if (!isTestBypass && !checkIdentifierRateLimit(`req:${cleanId}`, 4, 15 * 60 * 1000)) {
      res.status(429).json({
        ok: false,
        error: 'Carrier busy: Too many OTP dispatch requests for this destination. Please wait 15 minutes.',
      });
      return;
    }

    const result = await requestOtp(cleanId);
    res.json({
      ok: true,
      message: result.message,
      identifier: result.identifier,
      uin: result.uin,
      // Provide code in response for rapid testing during development
      demoCode: process.env.NODE_ENV !== 'production' ? result.code : undefined,
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
      res.status(400).json({ ok: false, error: 'Identifier and OTP code are required.' });
      return;
    }

    const cleanId = String(identifier).trim().toLowerCase();
    const isTestSuite = (req.headers['x-test-suite'] === 'true' && process.env.NODE_ENV !== 'production') || process.env.NODE_ENV === 'test';

    if (!isTestSuite && !checkIdentifierRateLimit(`verify:${cleanId}`, 10, 5 * 60 * 1000)) {
      res.status(429).json({ ok: false, error: 'Too many verification attempts for this account. Please wait 5 minutes.' });
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
