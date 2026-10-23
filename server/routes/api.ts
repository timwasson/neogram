import { Router, Request, Response } from 'express';
import { healthRouter } from './health';
import { authRouter } from './auth';
import { postsRouter } from './posts';
import { settingsRouter } from './settings';
import { query } from '../db';

export const apiRouter = Router();

apiRouter.use(healthRouter);
apiRouter.use('/auth', authRouter);
apiRouter.use(postsRouter);
apiRouter.use(settingsRouter);

// Temporary test route to verify database queries execute properly
apiRouter.get('/stats', async (_req: Request, res: Response, next) => {
  try {
    const usersCount = await query('SELECT COUNT(*) as count FROM users');
    const postsCount = await query('SELECT COUNT(*) as count FROM posts');
    const guestbookCount = await query('SELECT COUNT(*) as count FROM guestbook_entries');

    res.json({
      ok: true,
      stats: {
        users: parseInt(usersCount.rows[0].count, 10),
        posts: parseInt(postsCount.rows[0].count, 10),
        guestbookEntries: parseInt(guestbookCount.rows[0].count, 10),
      },
    });
  } catch (err) {
    next(err);
  }
});

// Trigger Eleventy static site rebuild (requires session)
apiRouter.post('/build-static', async (req: Request, res: Response, next) => {
  try {
    const { buildStaticGallery } = await import('../services/staticBuilder');
    const { extractToken, verifySessionToken } = await import('../auth/jwt');
    const token = extractToken(req);
    const payload = token ? verifySessionToken(token) : null;
    if (!payload) {
      res.status(401).json({ ok: false, error: 'Authentication required to trigger static builds.' });
      return;
    }
    const userId = payload.userId;
    const result = await buildStaticGallery({ userId });
    res.json(result);
  } catch (err) {
    next(err);
  }
});
