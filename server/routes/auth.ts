import { Router, Request, Response, NextFunction } from 'express';
import { requestOtp, verifyOtp, getUserById } from '../auth/service';
import { signSessionToken, setSessionCookie, clearSessionCookie, verifySessionToken, extractToken, COOKIE_NAME } from '../auth/jwt';

export const authRouter = Router();

// 1. Request OTP Code
authRouter.post('/request-otp', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { identifier } = req.body;
    const result = await requestOtp(identifier);
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
