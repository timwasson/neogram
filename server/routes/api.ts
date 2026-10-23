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

// Trigger Eleventy static site rebuild & deploy (requires session)
apiRouter.post('/build-static', async (req: Request, res: Response, next) => {
  try {
    const { extractToken, verifySessionToken } = await import('../auth/jwt');
    const token = extractToken(req);
    const payload = token ? verifySessionToken(token) : null;
    if (!payload) {
      res.status(401).json({ ok: false, error: 'Authentication required to trigger static builds.' });
      return;
    }
    const userId = payload.userId;

    // Check if user has Neocities credentials linked for live deployment
    const { query } = await import('../db');
    const { decryptCredentials } = await import('../utils/crypto');
    const userRes = await query('SELECT deployment_credentials FROM users WHERE id = $1', [userId]);
    const userRow = userRes.rows[0];
    const creds = userRow?.deployment_credentials
      ? decryptCredentials<{ apiKey?: string }>(userRow.deployment_credentials)
      : null;

    if (creds && creds.apiKey && creds.apiKey.trim()) {
      const { deployToNeocities } = await import('../services/neocitiesPublisher');
      const deployResult = await deployToNeocities(userId);
      res.json({
        ok: true,
        deployed: true,
        siteUrl: deployResult.siteUrl,
        filesCount: deployResult.filesCount,
        durationMs: deployResult.durationMs,
        message: 'Static site compiled and deployed live to Neocities!',
      });
      return;
    }

    const { buildStaticGallery } = await import('../services/staticBuilder');
    const result = await buildStaticGallery({ userId });
    res.json(result);
  } catch (err) {
    next(err);
  }
});
