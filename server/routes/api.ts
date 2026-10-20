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

// Trigger Eleventy static site rebuild
apiRouter.post('/build-static', async (_req: Request, res: Response, next) => {
  try {
    const { buildStaticGallery } = await import('../services/staticBuilder');
    const result = await buildStaticGallery();
    res.json(result);
  } catch (err) {
    next(err);
  }
});
