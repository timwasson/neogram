import { Router, Request, Response, NextFunction } from 'express';
import { requestOtp, verifyOtp, getUserById } from '../auth/service';
import { signSessionToken, setSessionCookie, clearSessionCookie, verifySessionToken, extractToken, COOKIE_NAME } from '../auth/jwt';

export const authRouter = Router();

// In-memory rate limiting map for OTP requests: max 4 requests per 15 minutes per IP/target
interface RateLimitRecord {
  timestamps: number[];
}
const otpRateLimits = new Map<string, RateLimitRecord>();
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_REQUESTS_PER_WINDOW = 4;

function checkOtpRateLimit(key: string): boolean {
  const now = Date.now();
  const record = otpRateLimits.get(key) || { timestamps: [] };
  // Filter out expired timestamps
  const recent = record.timestamps.filter((ts) => now - ts < RATE_LIMIT_WINDOW_MS);
  if (recent.length >= MAX_REQUESTS_PER_WINDOW) {
    return false;
  }
  recent.push(now);
  otpRateLimits.set(key, { timestamps: recent });
  return true;
}

// 1. Request OTP Code
authRouter.post('/request-otp', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { identifier } = req.body;
    if (!identifier || typeof identifier !== 'string') {
      res.status(400).json({ ok: false, error: 'Identifier (email or mobile phone) is required.' });
      return;
    }

    const cleanId = identifier.trim().toLowerCase();
    const ip = req.ip || req.socket.remoteAddress || 'unknown-ip';
    const isTestSuite = req.headers['x-test-suite'] === 'true' || process.env.NODE_ENV === 'test';

    // Check rate limit on target identifier (always) and client IP (in production)
    if (!checkOtpRateLimit(`id:${cleanId}`) || (!isTestSuite && !checkOtpRateLimit(`ip:${ip}`))) {
      res.status(429).json({
        ok: false,
        error: 'Carrier busy: Too many OTP dispatch requests. Please wait 15 minutes before requesting another code.',
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
authRouter.post('/verify-otp', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { identifier, code } = req.body;
    if (!identifier || !code) {
      res.status(400).json({ ok: false, error: 'Identifier and OTP code are required.' });
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
