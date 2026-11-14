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
import { adminRouter } from './routes/admin';
import { getTickerAnnouncement } from './services/systemSettings';
import { COOKIE_NAME, verifySessionToken, clearSessionCookie, extractToken, signSessionToken, signPassToken, signHandoffToken, verifyHandoffToken, setSessionCookie, UserSessionPayload } from './auth/jwt';
import { getUserById } from './auth/service';
import { getFriendsRoster } from './services/friendsRoster';
import { ensureVapidKeys, getVapidPublicKey } from './services/webPushService';
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
    // Legacy XSS auditor is deprecated and can itself introduce vulnerabilities: explicitly disabled.
    res.setHeader('X-XSS-Protection', '0');

    // Baseline Content-Security-Policy. The workstation views still contain inline <script>/<style>
    // (tracked tech debt: migrate to nonces), so 'unsafe-inline' remains for script/style, but this
    // already blocks: plugin/object content, <base> hijacking, form exfiltration to foreign hosts,
    // and framing by foreign sites. connect-src permits https because friend feeds are aggregated
    // client-side from arbitrary static hosts.
    const isEmbedSurface = req.path.startsWith('/embed') || req.path.startsWith('/counter');
    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' data: https://fonts.gstatic.com",
      "img-src 'self' data: blob: https:",
      "media-src 'self' data: blob: https:",
      "connect-src 'self' https: wss: ws://localhost:* ws://127.0.0.1:*",
      "frame-src 'self' https:",
      "worker-src 'self' blob:",
      "manifest-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      isEmbedSurface ? 'frame-ancestors *' : "frame-ancestors 'self'",
    ].join('; ');
    res.setHeader('Content-Security-Policy', csp);

    // Allow iframe embedding strictly for public widget embed routes; defend workstation dashboard from Clickjacking
    if (isEmbedSurface) {
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    } else {
      res.setHeader('X-Frame-Options', 'SAMEORIGIN');
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
    '/api/pass',
  ];

  const isPublicEmbed = (reqPath: string) =>
    publicEmbedPaths.some((prefix) => reqPath.startsWith(prefix));

  // Credentialed (cookie) CORS is first-party only. Loopback dev servers and arbitrary browser
  // extensions are trusted outside production only: in production any page served from a visitor's
  // localhost, or any installed extension, would otherwise get to read their workstation APIs.
  // (The Neogram extension authenticates with Bearer tokens + host_permissions, so it needs neither.)
  const isProduction = config.env === 'production';
  const isTrustedOrigin = (origin: string | undefined) =>
    !origin ||
    origin === config.appUrl ||
    (!isProduction &&
      (origin.startsWith('http://localhost:') ||
        origin.startsWith('http://127.0.0.1:') ||
        origin.startsWith('chrome-extension://') ||
        origin.startsWith('moz-extension://')));

  app.use(
    cors((req, callback) => {
      const origin = req.headers.origin;
      if (isTrustedOrigin(origin)) {
        // First-party workstation, local dev and the browser extension: credentialed access allowed
        callback(null, { origin: true, credentials: true });
      } else if (isPublicEmbed(req.path)) {
        // Third-party static sites (Neocities, GitHub Pages, ...) may call the public embed APIs,
        // but NEVER with ambient credentials (cookies). They authenticate with a scoped Cyber-Pass
        // Bearer token, so a hostile origin can never ride a visitor's neogram.club session.
        callback(null, { origin: true, credentials: false });
      } else {
        callback(null, { origin: false, credentials: false });
      }
    })
  );

  // CSRF defence for cookie-authenticated mutations: browsers always send Origin on cross-origin
  // unsafe requests. If a session cookie is present (and no explicit Bearer token) the Origin must
  // be first-party. Non-browser API clients (no Origin) and Bearer-token clients are unaffected.
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const origin = req.headers.origin;
    const hasBearer = !!req.headers.authorization;
    const hasSessionCookie = !!(req.headers.cookie && req.headers.cookie.includes(`${COOKIE_NAME}=`));
    const crossSite = req.headers['sec-fetch-site'] === 'cross-site';
    if (hasSessionCookie && !hasBearer && ((origin && !isTrustedOrigin(origin)) || (!origin && crossSite))) {
      res.status(403).json({ ok: false, error: 'Cross-site request blocked.' });
      return;
    }
    next();
  });

  app.use(express.json({ limit: '15mb' }));
  app.use(express.urlencoded({ extended: true, limit: '15mb' }));
  app.use(cookieParser());
  app.use(requestLogger);

  // Global API rate limiting: 180 requests per minute per IP (500 in dev/test)
  const globalApiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: process.env.NODE_ENV === 'production' ? 180 : 500,
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

  // Attach session user, dynamic marquee announcement, and default public appUrl to res.locals for templates
  app.use(async (req: Request, res: Response, next: NextFunction) => {
    const rawAppUrl = config.appUrl || process.env.APP_URL || '';
    // For external embed snippets, always default to https://neogram.club unless a custom non-localhost domain is set
    res.locals.appUrl = (rawAppUrl && !rawAppUrl.includes('localhost') && !rawAppUrl.includes('127.0.0.1'))
      ? rawAppUrl
      : 'https://neogram.club';

    try {
      res.locals.tickerAnnouncement = await getTickerAnnouncement();
    } catch {
      // Fallback handled in Nunjucks template
    }

    try {
      const vapid = await ensureVapidKeys();
      res.locals.vapidPublicKey = vapid.publicKey;
    } catch {
      try {
        res.locals.vapidPublicKey = getVapidPublicKey();
      } catch {
        res.locals.vapidPublicKey = '';
      }
    }

    try {
      const token = extractToken(req);
      if (token) {
        const payload = verifySessionToken(token);
        if (payload) {
          const user = await getUserById(payload.userId);
          if (user && !user.isBanned) {
            res.locals.currentUser = user;
            res.locals.isAdmin = !!user.isAdmin;
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
          } else {
            res.locals.currentUser = null;
            res.locals.isAdmin = false;
          }
        }
      }
    } catch {
      // Ignore session decode error
    }
    next();
  });

  // 5. Server-rendered Web Views & Admin Terminal
  app.use(adminRouter);
  app.use(directoryRouter);
  app.use(docsRouter);

  app.get('/', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const { query } = await import('./db');
      const { getPostsForUser } = await import('./services/postStorage');

      // Fetch personal archive posts from static JSON for authenticated user
      const currentUser = res.locals.currentUser;
      const userArchivePosts = currentUser ? await getPostsForUser(currentUser.id) : [];

      // Query Follower Feed, Friends Roster, & Station Directory for authenticated user
      let followerFeedPosts: any[] = [];
      let followedCount = 0;
      let friends: any[] = [];
      let activeUsers: any[] = [];
      let awayUsers: any[] = [];
      let inactiveUsers: any[] = [];
      let totalDirectoryCount = 0;

      if (currentUser) {
        const followsRes = await query(
          `SELECT COUNT(*) as count
           FROM follows f
           JOIN users u ON f.following_id = u.id
           WHERE f.follower_id = $1 AND COALESCE(u.is_banned, false) = false`,
          [currentUser.id]
        );
        followedCount = parseInt(followsRes.rows[0]?.count || '0', 10);

        const { aggregateFederatedFriendsFeed } = await import('./services/federatedFriends');
        const { fetchCategorizedDirectory } = await import('./routes/directory');

        friends = await getFriendsRoster(currentUser.id, { withPostCounts: true });

        const friendTargets = friends.map((r: any) => ({
          id: r.id,
          handle: r.handle,
          uin: r.uin,
          avatarPath: r.avatarPath,
          siteUrl: r.siteUrl,
          deployPath: r.deployPath,
          lastDeployedAt: r.lastDeployedAt,
          siteId: r.siteId,
        }));

        const [feedResult, directoryData] = await Promise.all([
          aggregateFederatedFriendsFeed(friendTargets, 50),
          fetchCategorizedDirectory(),
        ]);

        followerFeedPosts = feedResult;
        activeUsers = directoryData.active;
        awayUsers = directoryData.away;
        inactiveUsers = directoryData.inactive;
        totalDirectoryCount = directoryData.total;
      }

      res.render('index', {
        title: 'Neogram - 90s Retro Social Publishing Engine',
        systemPrompt: ':> SYSTEM 7 WORKSTATION ONLINE',
        version: '2.0.0',
        activeView: 'dashboard',
        appUrl: res.locals.appUrl,
        tickerAnnouncement: res.locals.tickerAnnouncement,
        posts: userArchivePosts,
        followerFeedPosts,
        followedCount,
        friends,
        activeUsers,
        awayUsers,
        inactiveUsers,
        totalDirectoryCount,
        userSites: res.locals.userSites || [],
        activeSite: res.locals.activeSite || null,
      });
    } catch (err) {
      next(err);
    }
  });

  app.get('/login', (_req: Request, res: Response) => {
    if (res.locals.currentUser) {
      res.redirect('/#feed');
      return;
    }
    res.render('login', {
      title: 'Neogram - Terminal Login',
      activeView: 'login',
    });
  });

  /**
   * Cyber-Pass SSO handshake for third-party static sites.
   * Security model:
   *  - The destination origin is parsed + normalised server-side (http/https only, no credentials, no wildcard).
   *  - If both `origin` and `return_url` are supplied they MUST agree.
   *  - The page NEVER auto-dispatches: the user must see the destination host and click to approve.
   *  - The token handed out is a scoped, 1-hour `pass` token (social actions only), NOT the session JWT.
   */
  app.get('/auth/connect', (req: Request, res: Response) => {
    const parseOrigin = (value: unknown): { origin: string; url: string } | null => {
      if (typeof value !== 'string' || !value.trim() || value.length > 2000) return null;
      try {
        const u = new URL(value.trim());
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
        if (u.username || u.password) return null;
        return { origin: u.origin, url: u.toString() };
      } catch {
        return null;
      }
    };

    const rawOrigin = req.query.origin;
    const rawReturn = req.query.return_url;
    const originParsed = parseOrigin(rawOrigin);
    const returnParsed = parseOrigin(rawReturn);

    let destination = '';
    let returnUrl = '';
    let error = '';

    if ((rawOrigin && !originParsed) || (rawReturn && !returnParsed)) {
      error = 'Invalid destination. Only plain http(s) site addresses are allowed.';
    } else if (originParsed && returnParsed && originParsed.origin !== returnParsed.origin) {
      error = 'Destination mismatch between origin and return URL.';
    } else {
      destination = (originParsed || returnParsed)?.origin || '';
      returnUrl = returnParsed?.url || '';
      if (!destination) error = 'No destination site specified for this Cyber-Pass.';
    }

    const user = res.locals.currentUser;
    res.setHeader('Cache-Control', 'no-store');

    if (user && !error) {
      const token = signPassToken({
        userId: user.id,
        email: user.email,
        handle: user.handle,
        uin: user.uin,
      });
      res.render('auth/connect', { authenticated: true, user, token, destination, returnUrl, error: '' });
    } else if (user) {
      res.render('auth/connect', { authenticated: true, user, token: '', destination: '', returnUrl: '', error });
    } else {
      res.render('auth/connect', { authenticated: false, destination, returnUrl, error });
    }
  });

  // Smart Handoff: Bridges PWA session into native browser (Safari/Chrome) and static site
  app.get('/auth/handoff', async (req: Request, res: Response) => {
    const rawTarget = req.query.target;
    const rawTicket = req.query.ticket;

    if (!rawTarget || typeof rawTarget !== 'string') {
      res.status(400).send('[:> HANDOFF ERROR] Missing destination target URL.');
      return;
    }

    let parsedTarget: URL;
    try {
      parsedTarget = new URL(rawTarget.trim());
      if (parsedTarget.protocol !== 'http:' && parsedTarget.protocol !== 'https:') {
        res.status(400).send('[:> HANDOFF ERROR] Invalid protocol. Only http(s) destinations are permitted.');
        return;
      }
      if (parsedTarget.username || parsedTarget.password) {
        res.status(400).send('[:> HANDOFF ERROR] Embedded credentials not permitted.');
        return;
      }
    } catch {
      res.status(400).send('[:> HANDOFF ERROR] Malformed target URL.');
      return;
    }

    const cleanTarget = parsedTarget.toString();
    res.setHeader('Cache-Control', 'no-store');

    // 1. A valid single-use handoff ticket, minted for exactly this target, is REQUIRED.
    //    There is deliberately no session-cookie fallback: otherwise any site could bounce a logged-in
    //    visitor through /auth/handoff?target=<attacker> and receive a Cyber-Pass without consent.
    let userPayload: UserSessionPayload | null = null;
    if (rawTicket && typeof rawTicket === 'string') {
      const ticket = verifyHandoffToken(rawTicket);
      let ticketTarget = '';
      try {
        ticketTarget = ticket ? new URL(ticket.target.trim()).toString() : '';
      } catch {
        ticketTarget = '';
      }
      if (ticket && ticketTarget === cleanTarget) {
        const dbUser = await getUserById(ticket.userId);
        if (dbUser && !dbUser.isBanned) {
          userPayload = { userId: dbUser.id, email: dbUser.email, handle: dbUser.handle, uin: dbUser.uin };
        }
      }
    }

    // 2. No (valid) ticket: send the visitor to the consent-gated Cyber-Pass connect screen
    if (!userPayload) {
      res.redirect(`/auth/connect?origin=${encodeURIComponent(parsedTarget.origin)}&return_url=${encodeURIComponent(cleanTarget)}`);
      return;
    }

    // 4. Established / verified identity:
    // Ensure Safari / native browser gets the persistent 7-day session cookie for neogram.club!
    const sessionToken = signSessionToken({
      userId: userPayload.userId,
      email: userPayload.email,
      handle: userPayload.handle,
      uin: userPayload.uin,
    });
    setSessionCookie(res, sessionToken);

    // 5. Mint a short-lived, scoped 1-hour Cyber-Pass token for the destination static site
    const passToken = signPassToken({
      userId: userPayload.userId,
      email: userPayload.email,
      handle: userPayload.handle,
      uin: userPayload.uin,
    });

    let avatar = '';
    try {
      const dbUser = await getUserById(userPayload.userId);
      avatar = dbUser?.avatarPath || '';
    } catch {}

    const passData = {
      type: 'NEOGRAM_CYBER_PASS',
      token: passToken,
      handle: userPayload.handle,
      uin: userPayload.uin || null,
      avatar,
    };

    // 6. Build the destination URL with the #neogram_pass= payload attached
    const baseUrlNoHash = cleanTarget.split('#')[0];
    const existingHash = cleanTarget.includes('#') ? cleanTarget.split('#')[1] : '';
    let preservedHash = '';
    if (existingHash) {
      const hashParams = existingHash.split('&').filter(p => !p.startsWith('neogram_pass='));
      if (hashParams.length > 0) preservedHash = '#' + hashParams.join('&');
    }

    const passParam = 'neogram_pass=' + encodeURIComponent(JSON.stringify(passData));
    const finalHash = preservedHash ? `${preservedHash}&${passParam}` : `#${passParam}`;
    const destinationWithPass = baseUrlNoHash + finalHash;

    // 302 Redirect Safari into the destination site with Cyber-Pass
    res.redirect(302, destinationWithPass);
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

      // Fetch friends roster (shared service)
      const friends = await getFriendsRoster(currentUser.id);

      // Fetch friends' latest broadcasted photographs
      // Federated aggregation: merge friends' remote feeds directly over WAN
      const { aggregateFederatedFriendsFeed } = await import('./services/federatedFriends');
      const posts = await aggregateFederatedFriendsFeed(
        friends.map((f) => ({
          id: f.id,
          handle: f.handle,
          uin: f.uin,
          avatarPath: f.avatarPath,
          siteUrl: f.siteUrl ?? undefined,
          deployPath: f.deployPath ?? undefined,
          lastDeployedAt: f.lastDeployedAt ?? undefined,
          siteId: f.siteId ?? undefined,
        })) as any,
        100
      );

      res.render('friends', {
        title: 'Neogram - Friends Roster & Live Network Feed',
        activeView: 'friends',
        friends,
        posts,
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

      if (!user || user.is_banned) {
        res.status(404).render('404', {
          title: 'Neogram - Station Node Not Found',
          url: req.originalUrl,
          message: user?.is_banned
            ? `[:> Station node "${identifier}" is currently suspended by network administrator.]`
            : `[:> Station node "${identifier}" not found in Neogram Cyberspace Directory.]`,
        });
        return;
      }

      const { query } = await import('./db');

      // NOTE: the remote-wipe check (checkAndSyncStationFeed) is deliberately NOT run on public
      // profile views: it can delete local data and makes outbound requests, so only the station owner
      // triggers it (POST /api/build-static).

      // Fetch public sites for this station node
      const sitesRes = await query(
        `SELECT id, name, slug, site_url as "siteUrl", deploy_path as "deployPath",
                deployment_type as "deploymentType",
                is_default as "isDefault", last_deployed_at as "lastDeployedAt"
         FROM sites
         WHERE user_id = $1
         ORDER BY is_default DESC, created_at ASC`,
        [user.id]
      );

      // Fetch public transmissions from static JSON for this user
      const { getPostsForUser } = await import('./services/postStorage');
      const userPosts = await getPostsForUser(user.id);

      // Primary / default site priority for station profile
      const primarySite = sitesRes.rows[0];
      const targetSiteUrl = primarySite?.siteUrl || user.site_url || '';
      const targetDeployPath = (primarySite?.deployPath !== null && primarySite?.deployPath !== undefined)
        ? String(primarySite.deployPath).trim().replace(/^\/+|\/+$/g, '')
        : ((user.deploy_path !== null && user.deploy_path !== undefined)
          ? String(user.deploy_path).trim().replace(/^\/+|\/+$/g, '')
          : 'neogram');

      // Clean root personal site URL & gallery URL (preserves repository/subpath for GitHub Pages)
      let cleanRootSiteUrl = '';
      let cleanBaseUrl = '';
      if (targetSiteUrl && targetSiteUrl.trim()) {
        try {
          const parsed = new URL(targetSiteUrl.startsWith('http') ? targetSiteUrl : `https://${targetSiteUrl}`);
          if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
            const basePath = parsed.pathname.replace(/\/+$/, '');
            cleanRootSiteUrl = `${parsed.protocol}//${parsed.host}`;
            cleanBaseUrl = `${parsed.protocol}//${parsed.host}${basePath}`;
          }
        } catch (_err) {
          cleanRootSiteUrl = '';
          cleanBaseUrl = '';
        }
      }

      // Static photo gallery URL
      const galleryUrl = cleanBaseUrl
        ? (targetDeployPath ? `${cleanBaseUrl}/${targetDeployPath}/` : `${cleanBaseUrl}/`)
        : '';

      // Hit counter telemetry
      const counterRes = await query('SELECT hits, style FROM web_counters WHERE user_id = $1', [user.id]);
      const hits = counterRes.rows.length > 0 ? parseInt(counterRes.rows[0].hits, 10) : 0;
      const counterStyle = counterRes.rows.length > 0 ? counterRes.rows[0].style : 'green_led';

      // Aggregate likes
      const totalLikes = userPosts.reduce((sum: number, p: any) => sum + (p.likes || 0), 0);

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

      const { resolveAvatarPath } = await import('./utils/avatar');
      const resolvedProfileAvatar = resolveAvatarPath({
        avatarPath: user.avatar_path,
        deploymentType: primarySite?.deploymentType || user.deployment_type,
        siteUrl: targetSiteUrl || user.site_url,
        uin: user.uin,
        handle: stationHandle,
      });

      res.render('user', {
        title: `Neogram - Station @${stationHandle} [#${user.uin}]`,
        activeView: 'profile',
        isFriend,
        isSelf: currentUser ? currentUser.id === user.id : false,
        profileUser: {
          id: user.id,
          handle: stationHandle,
          uin: user.uin,
          siteUrl: targetSiteUrl || user.site_url,
          cleanRootSiteUrl,
          galleryUrl,
          avatarPath: resolvedProfileAvatar,
          statusMessage: user.status_message || 'Surfing cyberspace',
          isAway: !!user.is_away,
          createdAt: user.created_at,
          lastDeployedAt: user.last_deployed_at,
          hits,
          counterStyle,
          totalLikes,
        },
        sites: sitesRes.rows,
        posts: userPosts,
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
