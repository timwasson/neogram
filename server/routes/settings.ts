import { Router, Request, Response, NextFunction } from 'express';
import { query } from '../db';
import { COOKIE_NAME, verifySessionToken } from '../auth/jwt';
import { encryptCredentials, decryptCredentials, maskApiKey, NeocitiesCredentials } from '../utils/crypto';
import { testNeocitiesConnection, deployToNeocities } from '../services/neocitiesPublisher';

export const settingsRouter = Router();

/**
 * Authentication middleware for settings routes
 */
function requireSession(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies[COOKIE_NAME];
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

settingsRouter.use(requireSession);

/**
 * 1. GET /api/settings - Retrieve authenticated user's hosting & deployment configuration
 */
settingsRouter.get('/settings', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.userId;

    const userRes = await query(
      `SELECT id, email, handle, site_url, deployment_type, deployment_credentials, auto_deploy, last_deployed_at
       FROM users
       WHERE id = $1`,
      [userId]
    );

    if (userRes.rows.length === 0) {
      res.status(404).json({ ok: false, error: 'User node not found.' });
      return;
    }

    const user = userRes.rows[0];
    const creds = decryptCredentials<NeocitiesCredentials>(user.deployment_credentials);

    const hasApiKey = !!(creds && creds.apiKey);
    const maskedKey = hasApiKey ? maskApiKey(creds!.apiKey) : '';
    const siteName = creds?.siteName || (user.site_url ? user.site_url.replace(/https?:\/\//, '').replace(/\.neocities\.org.*$/, '') : (user.handle || ''));

    res.json({
      ok: true,
      settings: {
        siteUrl: user.site_url || `https://${user.handle || 'user'}.neocities.org`,
        siteName: siteName,
        deploymentType: user.deployment_type || 'neocities',
        hasApiKey,
        maskedApiKey: maskedKey,
        autoDeploy: !!user.auto_deploy,
        lastDeployedAt: user.last_deployed_at,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * 2. PUT /api/settings - Update authenticated user's hosting & deployment configuration
 */
settingsRouter.put('/settings', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.userId;
    const { siteUrl, siteName, apiKey, deploymentType, autoDeploy } = req.body;

    // Fetch existing user to preserve existing apiKey if user didn't change it
    const existingRes = await query(
      `SELECT id, deployment_credentials, site_url, deployment_type, auto_deploy
       FROM users
       WHERE id = $1`,
      [userId]
    );

    if (existingRes.rows.length === 0) {
      res.status(404).json({ ok: false, error: 'User node not found.' });
      return;
    }

    const existingUser = existingRes.rows[0];
    let creds = decryptCredentials<NeocitiesCredentials>(existingUser.deployment_credentials) || { apiKey: '' };

    // If a new API key was provided (and not just masked stars)
    if (apiKey && typeof apiKey === 'string' && !apiKey.startsWith('••••') && apiKey.trim().length > 0) {
      creds.apiKey = apiKey.trim();
    }

    if (siteName && typeof siteName === 'string') {
      creds.siteName = siteName.trim();
    }

    const encryptedCreds = encryptCredentials(creds);

    const finalSiteUrl = siteUrl && typeof siteUrl === 'string'
      ? siteUrl.trim()
      : (creds.siteName ? `https://${creds.siteName}.neocities.org` : existingUser.site_url);

    const finalDeployType = deploymentType || existingUser.deployment_type || 'neocities';
    const finalAutoDeploy = typeof autoDeploy === 'boolean' ? autoDeploy : !!existingUser.auto_deploy;

    await query(
      `UPDATE users
       SET site_url = $1,
           deployment_type = $2,
           deployment_credentials = $3,
           auto_deploy = $4,
           updated_at = NOW()
       WHERE id = $5`,
      [finalSiteUrl, finalDeployType, encryptedCreds, finalAutoDeploy, userId]
    );

    console.log(`[:> SETTINGS] Updated deployment settings for user ${userId}`);

    res.json({
      ok: true,
      message: 'Deployment settings saved and encrypted in database.',
      settings: {
        siteUrl: finalSiteUrl,
        siteName: creds.siteName || '',
        deploymentType: finalDeployType,
        hasApiKey: !!creds.apiKey,
        maskedApiKey: maskApiKey(creds.apiKey),
        autoDeploy: finalAutoDeploy,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * 3. POST /api/settings/test-neocities - Test Neocities connection with either provided key or stored key
 */
settingsRouter.post('/settings/test-neocities', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.userId;
    const { apiKey } = req.body;

    let keyToTest: string | null = null;

    if (apiKey && typeof apiKey === 'string' && !apiKey.startsWith('••••') && apiKey.trim().length > 0) {
      keyToTest = apiKey.trim();
    } else {
      // Look up stored key in database
      const userRes = await query(
        `SELECT deployment_credentials FROM users WHERE id = $1`,
        [userId]
      );
      if (userRes.rows.length > 0) {
        const creds = decryptCredentials<NeocitiesCredentials>(userRes.rows[0].deployment_credentials);
        keyToTest = creds?.apiKey || null;
      }
    }

    if (!keyToTest) {
      res.status(400).json({
        ok: false,
        error: 'No Neocities API key provided or found in your stored profile.',
      });
      return;
    }

    const testResult = await testNeocitiesConnection(keyToTest);

    if (!testResult.ok) {
      res.status(400).json({
        ok: false,
        error: testResult.error || 'Connection failed.',
      });
      return;
    }

    res.json({
      ok: true,
      message: `Verified connection with Neocities site: "${testResult.info?.sitename}"`,
      info: testResult.info,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * 4. POST /api/deploy/neocities - Trigger immediate live deployment of user's 11ty static gallery
 */
settingsRouter.post('/deploy/neocities', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.userId;
    const deployResult = await deployToNeocities(userId);
    res.json({
      ok: true,
      message: deployResult.message,
      filesCount: deployResult.filesCount,
      durationMs: deployResult.durationMs,
      siteUrl: deployResult.siteUrl,
    });
  } catch (err: any) {
    res.status(400).json({
      ok: false,
      error: err.message || 'Deployment to Neocities failed.',
    });
  }
});
