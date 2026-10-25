import { Router, Request, Response, NextFunction } from 'express';
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
function requireSession(req: Request, res: Response, next: NextFunction) {
  const token = extractToken(req);
  if (!token) {
    res.status(401).json({ ok: false, error: 'Authentication required. Please log in.' });
    return;
  }
  const payload = verifySessionToken(token);
  if (!payload) {
    res.status(401).json({ ok: false, error: 'Session expired. Please log in again.' });
    return;
  }
  (req as any).user = payload;
  next();
}

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

    if (site.hasApiKey) {
      const deployRes = await deployToNeocities(site.id, true);
      res.json({
        ok: true,
        message: `Site "${site.name}" published live to Neocities!`,
        deploy: deployRes,
      });
    } else {
      const buildRes = await buildStaticGallery({ siteId: site.id });
      res.json({
        ok: true,
        message: `Static gallery built locally for site "${site.name}". (Connect API key in settings to push live).`,
        build: buildRes,
      });
    }
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message || 'Deployment error.' });
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
