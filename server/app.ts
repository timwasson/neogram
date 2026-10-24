import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import nunjucks from 'nunjucks';
import path from 'path';
import { requestLogger } from './middleware/logger';
import { errorHandler } from './middleware/errorHandler';
import { apiRouter } from './routes/api';
import { embedsRouter } from './routes/embeds';
import { directoryRouter } from './routes/directory';
import { docsRouter } from './routes/docs';
import { COOKIE_NAME, verifySessionToken, clearSessionCookie, extractToken, signSessionToken } from './auth/jwt';
import { getUserById } from './auth/service';
import { config } from './config';

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
  nunjucksEnv.addFilter('formatDateTime', (dateStr: any) => {
    if (!dateStr) return '';
    try {
      const d = new Date(dateStr);
      return (
        d.toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        }) +
        ', ' +
        d.toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
        })
      );
    } catch {
      return String(dateStr);
    }
  });
  app.set('view engine', 'njk');

  // 2. Security Headers & Clickjacking Protections
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-XSS-Protection', '1; mode=block');

    // Allow iframe embedding strictly for public widget embed routes; defend workstation dashboard from Clickjacking
    if (req.path.startsWith('/embed') || req.path.startsWith('/counter')) {
      res.setHeader('Content-Security-Policy', "frame-ancestors *");
    } else {
      res.setHeader('X-Frame-Options', 'SAMEORIGIN');
      res.setHeader('Content-Security-Policy', "frame-ancestors 'self'");
    }
    next();
  });

  // Targeted CORS: Public embeds are cross-origin accessible from ANY external site (Neocities, GitHub Pages, etc.)
  // Private workstation settings / deploy routes are protected against unauthorized cross-origin access.
  const publicEmbedPaths = [
    '/counter',
    '/feed',
    '/embed',
    '/api/posts',
    '/api/guestbook',
    '/api/users',
    '/api/network',
  ];

  const isPublicEmbed = (reqPath: string) =>
    publicEmbedPaths.some((prefix) => reqPath.startsWith(prefix));

  app.use(
    cors((req, callback) => {
      const origin = req.headers.origin;
      if (isPublicEmbed(req.path)) {
        // Cross-domain static site widgets need access to public comment/like/guestbook APIs
        callback(null, { origin: true, credentials: true });
      } else {
        // Private workstation routes only permit appUrl, local workstation, or browser extensions
        const isAllowedOrigin =
          !origin ||
          origin === config.appUrl ||
          origin.startsWith('http://localhost:') ||
          origin.startsWith('http://127.0.0.1:') ||
          origin.startsWith('chrome-extension://') ||
          origin.startsWith('moz-extension://');

        if (isAllowedOrigin) {
          callback(null, { origin: true, credentials: true });
        } else {
          callback(null, { origin: false, credentials: false });
        }
      }
    })
  );

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());
  app.use(requestLogger);

  // 3. Static Assets
  app.use(express.static(path.resolve(process.cwd(), 'public')));
  app.use('/embed', express.static(path.resolve(process.cwd(), 'embed')));
  app.use('/extension', express.static(path.resolve(process.cwd(), 'extension')));

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
  app.use(directoryRouter);
  app.use(docsRouter);

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

      // Filter personal archive posts to the authenticated user so other users' posts are isolated
      const currentUser = res.locals.currentUser;
      const userArchivePosts = currentUser
        ? postsQuery.rows.filter((p: any) => p.userId === currentUser.id)
        : postsQuery.rows;

      res.render('index', {
        title: 'Neogram - 90s Retro Social Publishing Engine',
        systemPrompt: ':> SYSTEM 7 WORKSTATION ONLINE',
        version: '2.0.0',
        activeView: 'dashboard',
        posts: userArchivePosts,
        allPosts: postsQuery.rows,
      });
    } catch (err) {
      next(err);
    }
  });

  app.get('/login', (_req: Request, res: Response) => {
    if (res.locals.currentUser) {
      res.redirect('/');
      return;
    }
    res.render('login', {
      title: 'Neogram - Terminal Login',
      activeView: 'login',
    });
  });

  app.get('/auth/connect', (req: Request, res: Response) => {
    const rawOrigin = (req.query.origin as string) || '*';
    const targetOrigin = rawOrigin.replace(/[^\w.:\/-]/g, '');
    const user = res.locals.currentUser;

    if (user) {
      const token = signSessionToken({
        userId: user.id,
        email: user.email,
        handle: user.handle,
        uin: user.uin,
      });
      res.render('auth/connect', {
        authenticated: true,
        user,
        token,
        targetOrigin,
      });
    } else {
      res.render('auth/connect', {
        authenticated: false,
        targetOrigin,
      });
    }
  });

  app.get('/logout', (_req: Request, res: Response) => {
    clearSessionCookie(res);
    res.redirect('/login');
  });

  app.get('/user/:identifier', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { identifier } = req.params;
      const { findUserByHandleOrId } = await import('./routes/embeds');
      const user = await findUserByHandleOrId(identifier);

      if (!user) {
        res.status(404).render('404', {
          title: 'Neogram - Station Node Not Found',
          url: req.originalUrl,
          message: `[:> Station node "${identifier}" not found in Neogram Cyberspace Directory.]`,
        });
        return;
      }

      const { query } = await import('./db');
      // Fetch public transmissions from this user
      const postsRes = await query(
        `SELECT id, image_path as "imagePath", thumbnail_path as "thumbnailPath", caption,
                filter_applied as "filterApplied", mood, webring, location, likes_count as "likes",
                created_at as "createdAt"
         FROM posts
         WHERE user_id = $1
         ORDER BY created_at DESC`,
        [user.id]
      );

      // Clean root personal site URL (strips any deploy_path subdirectory)
      let cleanRootSiteUrl = '';
      if (user.site_url && user.site_url.trim()) {
        try {
          const parsed = new URL(user.site_url);
          cleanRootSiteUrl = `${parsed.protocol}//${parsed.host}`;
        } catch (_err) {
          cleanRootSiteUrl = user.site_url.replace(/\/+$/, '');
        }
      } else if (user.handle) {
        cleanRootSiteUrl = `https://${user.handle}.neocities.org`;
      }

      // Static photo gallery URL
      const deployPath = (user.deploy_path !== null && user.deploy_path !== undefined)
        ? String(user.deploy_path).trim().replace(/^\/+|\/+$/g, '')
        : 'neogram';
      const galleryUrl = cleanRootSiteUrl
        ? (deployPath ? `${cleanRootSiteUrl}/${deployPath}/` : `${cleanRootSiteUrl}/`)
        : '';

      // Hit counter telemetry
      const counterRes = await query('SELECT hits, style FROM web_counters WHERE user_id = $1', [user.id]);
      const hits = counterRes.rows.length > 0 ? parseInt(counterRes.rows[0].hits, 10) : 0;
      const counterStyle = counterRes.rows.length > 0 ? counterRes.rows[0].style : 'green_led';

      // Aggregate likes
      const totalLikes = postsRes.rows.reduce((sum: number, p: any) => sum + (p.likes || 0), 0);

      const stationHandle = user.handle || user.email.split('@')[0] || 'surfer';

      res.render('user', {
        title: `Neogram - Station @${stationHandle} [#${user.uin}]`,
        activeView: 'profile',
        profileUser: {
          id: user.id,
          handle: stationHandle,
          uin: user.uin,
          email: user.email,
          siteUrl: user.site_url,
          cleanRootSiteUrl,
          galleryUrl,
          avatarPath: user.avatar_path || '/icons/default-avatar.svg',
          statusMessage: user.status_message || 'Surfing cyberspace',
          isAway: !!user.is_away,
          createdAt: user.created_at,
          lastDeployedAt: user.last_deployed_at,
          hits,
          counterStyle,
          totalLikes,
        },
        posts: postsRes.rows,
      });
    } catch (err) {
      next(err);
    }
  });

  app.get('/terms', (_req: Request, res: Response) => {
    res.render('terms', {
      title: 'Neogram - Terms of Service & SMS Program Terms',
      activeView: 'terms',
    });
  });

  app.get('/privacy', (_req: Request, res: Response) => {
    res.render('privacy', {
      title: 'Neogram - Privacy Policy & Cyberspace Data Protection',
      activeView: 'privacy',
    });
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
