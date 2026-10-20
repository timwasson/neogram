import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import nunjucks from 'nunjucks';
import path from 'path';
import { requestLogger } from './middleware/logger';
import { errorHandler } from './middleware/errorHandler';
import { apiRouter } from './routes/api';
import { embedsRouter } from './routes/embeds';
import { COOKIE_NAME, verifySessionToken, clearSessionCookie, extractToken } from './auth/jwt';
import { getUserById } from './auth/service';

export function createApp(): Express {
  const app = express();

  // 1. Template Engine (Nunjucks)
  const viewsPath = path.resolve(process.cwd(), 'views');
  const nunjucksEnv = nunjucks.configure(viewsPath, {
    autoescape: true,
    express: app,
    noCache: process.env.NODE_ENV !== 'production',
  });
  nunjucksEnv.addFilter('formatDate', (dateStr: any) => {
    if (!dateStr) return '';
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    } catch {
      return String(dateStr);
    }
  });
  app.set('view engine', 'njk');

  // 2. Standard Middleware
  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());
  app.use(requestLogger);

  // 3. Static Assets
  app.use(express.static(path.resolve(process.cwd(), 'public')));
  app.use('/embed', express.static(path.resolve(process.cwd(), 'embed')));
  app.use('/extension', express.static(path.resolve(process.cwd(), 'extension')));

  // 3b. 11ty Static Gallery Preview
  const staticGalleryPath = path.resolve(process.cwd(), 'dist/static-gallery');
  app.use('/preview', express.static(staticGalleryPath));
  app.use('/photos', express.static(path.join(staticGalleryPath, 'photos')));

  // 4. API Endpoints & Dynamic Embeds
  app.use('/api', apiRouter);
  app.use(embedsRouter);

  // Attach session user to res.locals for templates
  app.use(async (req: Request, res: Response, next: NextFunction) => {
    try {
      const token = extractToken(req);
      if (token) {
        const payload = verifySessionToken(token);
        if (payload) {
          const user = await getUserById(payload.userId);
          res.locals.currentUser = user;
        }
      }
    } catch {
      // Ignore session decode error
    }
    next();
  });

  // 5. Server-rendered Web Views
  app.get('/', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const { query } = await import('./db');
      const postsQuery = await query(`
        SELECT 
          p.id,
          p.user_id as "userId",
          p.image_path as "imagePath",
          p.thumbnail_path as "thumbnailPath",
          p.caption,
          p.filter_applied as "filterApplied",
          p.mood,
          p.webring,
          p.location,
          p.likes_count as "likes",
          p.created_at as "createdAt",
          u.email,
          split_part(u.email, '@', 1) as author,
          (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) as "commentCount"
        FROM posts p
        JOIN users u ON p.user_id = u.id
        ORDER BY p.created_at DESC
      `);

      res.render('index', {
        title: 'Neogram - 90s Retro Social Publishing Engine',
        systemPrompt: ':> SYSTEM 7 WORKSTATION ONLINE',
        version: '2.0.0',
        activeView: 'dashboard',
        posts: postsQuery.rows,
      });
    } catch (err) {
      next(err);
    }
  });

  app.get('/login', (_req: Request, res: Response) => {
    res.render('login', {
      title: 'Neogram - Terminal Login',
      activeView: 'login',
    });
  });

  app.get('/logout', (_req: Request, res: Response) => {
    clearSessionCookie(res);
    res.redirect('/login');
  });

  // 6. 404 Handler
  app.use((req: Request, res: Response) => {
    if (req.accepts('html') && !req.path.startsWith('/api')) {
      res.status(404).render('404', { url: req.originalUrl });
      return;
    }
    res.status(404).json({ ok: false, error: 'Endpoint Not Found', path: req.originalUrl });
  });

  // 7. Global Error Handler
  app.use(errorHandler);

  return app;
}
