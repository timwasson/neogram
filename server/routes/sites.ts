import { Router, Request, Response, NextFunction } from 'express';
import { createRequireSession } from '../auth/requireSession';
import { extractToken, verifySessionToken } from '../auth/jwt';
import {
  getUserSites,
  getSiteById,
  createSite,
  updateSite,
  deleteSite,
  getDefaultSite,
} from '../services/siteService';
import { deployToNeocities } from '../services/neocitiesPublisher';
import { buildStaticGallery } from '../services/staticBuilder';

export const sitesRouter = Router();

/**
 * Authentication middleware for sites routes
 */
const requireSession = createRequireSession({
  missing: 'Authentication required. Please log in.',
  expired: 'Session expired. Please log in again.',
});

sitesRouter.use('/sites', requireSession);

/**
 * 1. GET /api/sites - Retrieve all sites belonging to the authenticated user
 */
sitesRouter.get('/sites', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.userId;
    const sites = await getUserSites(userId);
    res.json({ ok: true, sites });
  } catch (err) {
    next(err);
  }
});

/**
 * 2. POST /api/sites - Provision a new static site target
 */
sitesRouter.post('/sites', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.userId;
    const { name, slug, siteUrl, deploymentType, deployPath, apiKey, siteName, autoDeploy, buildHtml, customCssUrl, isDefault } = req.body;

    if (!name || !name.trim()) {
      res.status(400).json({ ok: false, error: 'Site name is required.' });
      return;
    }

    if (siteUrl && /^(javascript|data|vbscript):/i.test(String(siteUrl).trim())) {
      res.status(400).json({ ok: false, error: 'Invalid URL scheme for siteUrl.' });
      return;
    }

    if (customCssUrl && !/^https?:\/\//i.test(String(customCssUrl).trim())) {
      res.status(400).json({ ok: false, error: 'Custom CSS URL must use HTTP or HTTPS protocol.' });
      return;
    }

    const newSite = await createSite(userId, {
      name,
      slug,
      siteUrl,
      deploymentType,
      deployPath,
      apiKey,
      siteName,
      autoDeploy,
      buildHtml,
      customCssUrl,
      isDefault,
    });

    res.status(201).json({
      ok: true,
      message: `Static site target "${newSite.name}" provisioned successfully.`,
      site: newSite,
    });
  } catch (err: any) {
    res.status(400).json({ ok: false, error: err.message || 'Failed to create site target.' });
  }
});

/**
 * 3. GET /api/sites/:id - Retrieve single site target
 */
sitesRouter.get('/sites/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.userId;
    const siteId = req.params.id;

    let site;
    if (siteId === 'default') {
      site = await getDefaultSite(userId);
    } else {
      site = await getSiteById(siteId, userId);
    }

    if (!site) {
      res.status(404).json({ ok: false, error: 'Site target not found.' });
      return;
    }

    res.json({ ok: true, site });
  } catch (err) {
    next(err);
  }
});

/**
 * 4. PUT /api/sites/:id - Update site target configuration
 */
sitesRouter.put('/sites/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.userId;
    const siteId = req.params.id;

    const updated = await updateSite(siteId, userId, req.body);
    res.json({
      ok: true,
      message: `Site target "${updated.name}" updated successfully.`,
      site: updated,
    });
  } catch (err: any) {
    res.status(400).json({ ok: false, error: err.message || 'Failed to update site target.' });
  }
});

/**
 * 5. DELETE /api/sites/:id - Unmount and delete site target
 */
sitesRouter.delete('/sites/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.userId;
    const siteId = req.params.id;

    const result = await deleteSite(siteId, userId);
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ ok: false, error: err.message || 'Failed to delete site target.' });
  }
});

/**
 * 6. POST /api/sites/:id/deploy - Build and deploy this specific site target
 */
sitesRouter.post('/sites/:id/deploy', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.userId;
    const siteId = req.params.id;

    const site = await getSiteById(siteId, userId);
    if (!site) {
      res.status(404).json({ ok: false, error: 'Site target not found.' });
      return;
    }

    if (!site.hasApiKey || !site.siteUrl) {
      res.status(400).json({ ok: false, needsSite: true, error: `Add an API key for "${site.name}" in Settings before publishing.` });
      return;
    }
    const { deploySite, providerLabel } = await import('../services/deployDispatcher');
    const deployRes = await deploySite(site.id, site.deploymentType);
    res.json({
      ok: true,
      message: `Published "${site.name}" to ${providerLabel(site.deploymentType)}.`,
      filesCount: deployRes.filesCount,
      durationMs: deployRes.durationMs,
      siteUrl: deployRes.siteUrl,
      deploy: deployRes,
    });
  } catch (err: any) {
    console.error('[:> SITE DEPLOY ERROR]', err);
    res.status(500).json({ ok: false, error: 'Deployment error. Check your host credentials and try again.' });
  }
});

/**
 * 7. POST /api/sites/:id/default - Set site as primary/default
 */
sitesRouter.post('/sites/:id/default', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.userId;
    const siteId = req.params.id;

    const updated = await updateSite(siteId, userId, { isDefault: true });
    res.json({
      ok: true,
      message: `"${updated.name}" is now your primary default site.`,
      site: updated,
    });
  } catch (err: any) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

/**
 * 8. POST /api/sites/:id/switch - Switch active site target in session cookie
 */
sitesRouter.post('/sites/:id/switch', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.userId;
    const siteId = req.params.id;

    const site = await getSiteById(siteId, userId);
    if (!site) {
      res.status(404).json({ ok: false, error: 'Site target not found.' });
      return;
    }

    res.cookie('neogram_active_site', site.id, {
      httpOnly: false,
      sameSite: 'lax',
      path: '/',
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });

    res.json({
      ok: true,
      message: `Active workstation site switched to "${site.name}".`,
      site,
    });
  } catch (err: any) {
    res.status(400).json({ ok: false, error: err.message });
  }
});
