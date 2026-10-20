import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import nunjucks from 'nunjucks';
import path from 'path';
import { requestLogger } from './middleware/logger';
import { errorHandler } from './middleware/errorHandler';
import { apiRouter } from './routes/api';
import { COOKIE_NAME, verifySessionToken, clearSessionCookie } from './auth/jwt';
import { getUserById } from './auth/service';

export function createApp(): Express {
  const app = express();

  // 1. Template Engine (Nunjucks)
  const viewsPath = path.resolve(process.cwd(), 'views');
  nunjucks.configure(viewsPath, {
    autoescape: true,
    express: app,
    noCache: process.env.NODE_ENV !== 'production',
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

  // 4. API Endpoints
  app.use('/api', apiRouter);

  // Attach session user to res.locals for templates
  app.use(async (req: Request, res: Response, next: NextFunction) => {
    try {
      const token = req.cookies[COOKIE_NAME];
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
  app.get('/', (_req: Request, res: Response) => {
    res.render('index', {
      title: 'Neogram - 90s Retro Social Publishing Engine',
      systemPrompt: ':> SYSTEM 7 WORKSTATION ONLINE',
      version: '2.0.0',
      activeView: 'dashboard',
    });
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
