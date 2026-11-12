import { Router, Request, Response } from 'express';
import { healthRouter } from './health';
import { authRouter, passVerifyHandler } from './auth';
import { postsRouter } from './posts';
import { settingsRouter } from './settings';
import { directoryRouter } from './directory';
import { notificationsRouter } from './notifications';
import { sitesRouter } from './sites';
import { query } from '../db';
import { requireAdminApi } from '../middleware/adminGuard';

export const apiRouter = Router();

apiRouter.use(healthRouter);
apiRouter.use('/auth', authRouter);
// Cross-origin (CORS-public, never credentialed) Cyber-Pass verification for static sites
apiRouter.get('/pass/verify', (req: Request, res: Response, next) => {
  passVerifyHandler(req, res).catch(next);
});
apiRouter.use(postsRouter);
apiRouter.use(settingsRouter);
apiRouter.use(sitesRouter);
apiRouter.use(directoryRouter);
apiRouter.use(notificationsRouter);

// SysOp-only telemetry (was a public test route that disclosed user/post counts)
apiRouter.get('/stats', requireAdminApi, async (_req: Request, res: Response, next) => {
  try {
    const usersCount = await query('SELECT COUNT(*) as count FROM users');
    const { getAllPosts } = await import('../services/postStorage');
    const allPosts = await getAllPosts();
    const guestbookCount = await query('SELECT COUNT(*) as count FROM guestbook_entries');

    res.json({
      ok: true,
      stats: {
        users: parseInt(usersCount.rows[0].count, 10),
        posts: allPosts.length,
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
    const { getUserById } = await import('../auth/service');
    const sessionUser = payload ? await getUserById(payload.userId) : null;
    if (!payload || !sessionUser || sessionUser.isBanned) {
      res.status(401).json({ ok: false, error: 'Authentication required to trigger static builds.' });
      return;
    }
    const userId = payload.userId;

    // Verify station status with remote source of truth
    const { checkAndSyncStationFeed } = await import('../services/stationSync');
    const syncStatus = await checkAndSyncStationFeed(userId);
    if (syncStatus.wiped) {
      res.json({
        ok: true,
        reset: true,
        message: 'Remote feed.json was missing (HTTP 404). Station was wiped on remote host; local station has been reset to start from scratch.',
      });
      return;
    }

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
