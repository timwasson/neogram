import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import nunjucks from 'nunjucks';
import path from 'path';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
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

  // Trust Caddy/Nginx reverse proxy headers (e.g. X-Forwarded-For) so req.ip reflects real visitor IPs
  app.set('trust proxy', 1);

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
  app.use(
    helmet({
      contentSecurityPolicy: false, // Custom CSP below handles widget framing dynamically
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' }, // Allows external static sites (Neocities, Nekoweb, etc.) to load widgets, SVGs, audio, and embeds
      crossOriginOpenerPolicy: false, // Allows cross-origin popups (Cyber-Pass SSO) to communicate via window.opener.postMessage
      frameguard: false, // Custom frame-ancestors logic below protects dashboard from clickjacking
    })
  );

  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-XSS-Protection', '1; mode=block');

    // Allow iframe embedding strictly for public widget embed routes; defend workstation dashboard from Clickjacking
    if (req.path.startsWith('/embed') || req.path.startsWith('/counter')) {
      res.setHeader('Content-Security-Policy', "frame-ancestors *");
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
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

  app.use(express.json({ limit: '15mb' }));
  app.use(express.urlencoded({ extended: true, limit: '15mb' }));
  app.use(cookieParser());
  app.use(requestLogger);

  // Global API rate limiting: 180 requests per minute per IP
  const globalApiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 180,
    standardHeaders: true,
    legacyHeaders: false,
    message: { ok: false, error: 'Carrier busy: Global rate limit exceeded. Please throttle requests.' },
    skip: (req) => (req.headers['x-test-suite'] === 'true' && process.env.NODE_ENV !== 'production') || process.env.NODE_ENV === 'test',
  });
  app.use('/api', globalApiLimiter);

  // 3. Static Assets
  // Service Worker script must never be HTTP-cached by browsers
  app.get('/sw.js', (_req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.sendFile(path.resolve(process.cwd(), 'public', 'sw.js'));
  });

  app.use(express.static(path.resolve(process.cwd(), 'public')));
  app.use('/embed', express.static(path.resolve(process.cwd(), 'embed')));
  app.use('/extension', express.static(path.resolve(process.cwd(), 'extension')));

  // 4. API Endpoints & Dynamic Embeds
  app.use('/api', apiRouter);
  app.use(embedsRouter);

  // Attach session user and default public appUrl to res.locals for templates
  app.use(async (req: Request, res: Response, next: NextFunction) => {
    const rawAppUrl = config.appUrl || process.env.APP_URL || '';
    // For external embed snippets, always default to https://neogram.club unless a custom non-localhost domain is set
    res.locals.appUrl = (rawAppUrl && !rawAppUrl.includes('localhost') && !rawAppUrl.includes('127.0.0.1'))
      ? rawAppUrl
      : 'https://neogram.club';

    try {
      const token = extractToken(req);
      if (token) {
        const payload = verifySessionToken(token);
        if (payload) {
          const user = await getUserById(payload.userId);
          res.locals.currentUser = user;
          if (user) {
            const { getUserSites } = await import('./services/siteService');
            const userSites = await getUserSites(user.id);
            res.locals.userSites = userSites;

            const requestedSiteId =
              (req.cookies && req.cookies.neogram_active_site) ||
              (req.query && (req.query.siteId as string));
            let activeSite = userSites.find((s) => s.id === requestedSiteId);
            if (!activeSite) {
              activeSite = userSites.find((s) => s.isDefault) || userSites[0] || null;
            }
            res.locals.activeSite = activeSite;
          }
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
          p.site_id as "siteId",
          s.name as "siteName",
          s.slug as "siteSlug",
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
        LEFT JOIN sites s ON p.site_id = s.id
        ORDER BY p.created_at DESC
      `);

      // Filter personal archive posts to the authenticated user so other users' posts are isolated
      const currentUser = res.locals.currentUser;
      const userArchivePosts = currentUser
        ? postsQuery.rows.filter((p: any) => p.userId === currentUser.id)
        : postsQuery.rows;

      // Query Follower Feed for authenticated user (transmissions from stations they follow)
      let followerFeedPosts: any[] = [];
      let followedCount = 0;
      if (currentUser) {
        const followsRes = await query(
          'SELECT COUNT(*) as count FROM follows WHERE follower_id = $1',
          [currentUser.id]
        );
        followedCount = parseInt(followsRes.rows[0]?.count || '0', 10);

        const feedQuery = await query(`
          SELECT 
            p.id,
            p.user_id as "userId",
            p.site_id as "siteId",
            s.name as "siteName",
            s.slug as "siteSlug",
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
            u.handle,
            u.uin,
            u.avatar_path as "avatarPath",
            u.site_url as "siteUrl",
            u.deploy_path as "deployPath",
            COALESCE(u.handle, split_part(u.email, '@', 1)) as author,
            (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) as "commentCount"
          FROM posts p
          JOIN follows f ON p.user_id = f.following_id
          JOIN users u ON p.user_id = u.id
          LEFT JOIN sites s ON p.site_id = s.id
          WHERE f.follower_id = $1
          ORDER BY p.created_at DESC
          LIMIT 50
        `, [currentUser.id]);
        followerFeedPosts = feedQuery.rows;
      }

      res.render('index', {
        title: 'Neogram - 90s Retro Social Publishing Engine',
        systemPrompt: ':> SYSTEM 7 WORKSTATION ONLINE',
        version: '2.0.0',
        activeView: 'dashboard',
        appUrl: res.locals.appUrl,
        posts: userArchivePosts,
        allPosts: postsQuery.rows,
        followerFeedPosts,
        followedCount,
        userSites: res.locals.userSites || [],
        activeSite: res.locals.activeSite || null,
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
    const returnUrl = (req.query.return_url as string) || '';
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
        returnUrl,
      });
    } else {
      res.render('auth/connect', {
        authenticated: false,
        targetOrigin,
        returnUrl,
      });
    }
  });

  app.get('/logout', (_req: Request, res: Response) => {
    clearSessionCookie(res);
    res.redirect('/login');
  });

  app.get('/friends', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const currentUser = res.locals.currentUser;
      if (!currentUser) {
        res.redirect('/?login=required');
        return;
      }

      const { query } = await import('./db');
      const { activeSockets } = await import('./services/chatSocket');

      // Fetch friends roster
      const friendsRes = await query(`
        SELECT 
          u.id, 
          u.email, 
          COALESCE(u.handle, split_part(u.email, '@', 1)) as handle,
          u.uin,
          u.avatar_path as "avatarPath",
          u.status_message as "statusMessage",
          u.is_away as "isAway",
          u.site_url as "siteUrl",
          u.deploy_path as "deployPath",
          f.created_at as "friendedAt",
          (SELECT COUNT(*) FROM posts p WHERE p.user_id = u.id) as "postCount"
        FROM follows f
        JOIN users u ON f.following_id = u.id
        WHERE f.follower_id = $1
        ORDER BY LOWER(COALESCE(u.handle, split_part(u.email, '@', 1))) ASC
      `, [currentUser.id]);

      const friends = friendsRes.rows.map((r: any) => {
        const active = activeSockets.get(r.id);
        let status = 'inactive';
        let statusMsg = r.statusMessage || 'Surfing cyberspace';
        if (active) {
          status = active.status;
          if (active.awayMessage) statusMsg = active.awayMessage;
        } else if (r.isAway) {
          status = 'away';
        }

        let cleanRootSiteUrl = '';
        if (r.siteUrl && r.siteUrl.trim()) {
          try {
            const parsed = new URL(r.siteUrl);
            if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
              cleanRootSiteUrl = `${parsed.protocol}//${parsed.host}`;
            }
          } catch (_e) {
            cleanRootSiteUrl = '';
          }
        }

        return {
          ...r,
          status,
          statusMessage: statusMsg,
          avatarPath: r.avatarPath && r.avatarPath.trim() ? r.avatarPath : '/icons/default-avatar.svg',
          profileUrl: `/user/@${encodeURIComponent(r.handle)}`,
          cleanRootSiteUrl,
        };
      });

      // Fetch friends' latest broadcasted photographs
      const postsRes = await query(`
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
          u.handle,
          u.uin,
          u.avatar_path as "avatarPath",
          u.site_url as "siteUrl",
          u.deploy_path as "deployPath",
          COALESCE(u.handle, split_part(u.email, '@', 1)) as author,
          (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) as "commentCount"
        FROM posts p
        JOIN follows f ON p.user_id = f.following_id
        JOIN users u ON p.user_id = u.id
        WHERE f.follower_id = $1
        ORDER BY p.created_at DESC
        LIMIT 100
      `, [currentUser.id]);

      res.render('friends', {
        title: 'Neogram - Friends Roster & Live Network Feed',
        activeView: 'friends',
        friends,
        posts: postsRes.rows,
      });
    } catch (err) {
      next(err);
    }
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
      // Fetch public sites for this station node
      const sitesRes = await query(
        `SELECT id, name, slug, site_url as "siteUrl", deploy_path as "deployPath",
                is_default as "isDefault", last_deployed_at as "lastDeployedAt"
         FROM sites
         WHERE user_id = $1
         ORDER BY is_default DESC, created_at ASC`,
        [user.id]
      );

      // Fetch public transmissions from this user with site metadata
      const postsRes = await query(
        `SELECT p.id, p.site_id as "siteId", s.name as "siteName", s.slug as "siteSlug",
                p.image_path as "imagePath", p.thumbnail_path as "thumbnailPath", p.caption,
                p.filter_applied as "filterApplied", mood, webring, location, likes_count as "likes",
                p.created_at as "createdAt"
         FROM posts p
         LEFT JOIN sites s ON p.site_id = s.id
         WHERE p.user_id = $1
         ORDER BY p.created_at DESC`,
        [user.id]
      );

      // Clean root personal site URL (strips any deploy_path subdirectory)
      let cleanRootSiteUrl = '';
      if (user.site_url && user.site_url.trim()) {
        try {
          const parsed = new URL(user.site_url);
          if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
            cleanRootSiteUrl = `${parsed.protocol}//${parsed.host}`;
          }
        } catch (_err) {
          cleanRootSiteUrl = '';
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

      const currentUser = res.locals.currentUser;
      let isFriend = false;
      if (currentUser && currentUser.id !== user.id) {
        const followRes = await query(
          'SELECT 1 FROM follows WHERE follower_id = $1 AND following_id = $2',
          [currentUser.id, user.id]
        );
        isFriend = followRes.rows.length > 0;
      }

      res.render('user', {
        title: `Neogram - Station @${stationHandle} [#${user.uin}]`,
        activeView: 'profile',
        isFriend,
        isSelf: currentUser ? currentUser.id === user.id : false,
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
        sites: sitesRes.rows,
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
