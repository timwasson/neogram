import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { query } from '../db';
import { COOKIE_NAME, verifySessionToken, extractToken, signSessionToken, setSessionCookie } from '../auth/jwt';
import { encryptCredentials, decryptCredentials, maskApiKey, NeocitiesCredentials } from '../utils/crypto';
import { testNeocitiesConnection, deployToNeocities } from '../services/neocitiesPublisher';
import { processAvatarBuffer } from '../services/imageProcessor';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

export const settingsRouter = Router();

/**
 * Authentication middleware for settings routes
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

settingsRouter.use(['/settings', '/deploy'], requireSession);

/**
 * 1. GET /api/settings - Retrieve authenticated user's hosting & deployment configuration
 */
settingsRouter.get('/settings', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.userId;

    const userRes = await query(
      `SELECT id, email, handle, uin, site_url, deploy_path, deployment_type, deployment_credentials, auto_deploy, last_deployed_at, avatar_path, build_html
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
    const deployPath = user.deploy_path !== null && user.deploy_path !== undefined ? user.deploy_path : 'neogram';

    res.json({
      ok: true,
      settings: {
        id: user.id,
        uin: user.uin ? parseInt(user.uin, 10) : undefined,
        handle: user.handle,
        email: user.email,
        avatarPath: user.avatar_path || '/icons/default-avatar.svg',
        hasCustomAvatar: !!user.avatar_path,
        siteUrl: user.site_url || `https://${user.handle || 'user'}.neocities.org`,
        siteName: siteName,
        deployPath: deployPath,
        deploymentType: user.deployment_type || 'neocities',
        hasApiKey,
        maskedApiKey: maskedKey,
        autoDeploy: !!user.auto_deploy,
        buildHtml: user.build_html !== false,
        lastDeployedAt: user.last_deployed_at,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * 2. POST /api/settings/profile - Update user handle and avatar image
 */
settingsRouter.post('/settings/profile', upload.single('avatarFile'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.userId;
    const { handle, removeAvatar } = req.body;

    const userRes = await query('SELECT id, email, handle, uin, avatar_path FROM users WHERE id = $1', [userId]);
    if (userRes.rows.length === 0) {
      res.status(404).json({ ok: false, error: 'User not found.' });
      return;
    }
    const user = userRes.rows[0];
    let newHandle = user.handle;

    // 1. Handle validation & update if provided
    if (handle && typeof handle === 'string') {
      const cleanHandle = handle.trim().toLowerCase().replace(/^@+/, '');
      if (!/^[a-z0-9_-]{3,30}$/.test(cleanHandle)) {
        res.status(400).json({
          ok: false,
          error: 'Handle must be between 3 and 30 characters and only contain lowercase letters, numbers, underscores, and hyphens.',
        });
        return;
      }

      // Check handle uniqueness across other users
      const dupRes = await query('SELECT id FROM users WHERE handle = $1 AND id != $2', [cleanHandle, userId]);
      if (dupRes.rows.length > 0) {
        res.status(400).json({
          ok: false,
          error: `Call-sign "@${cleanHandle}" is already registered by another station. Please choose another handle.`,
        });
        return;
      }

      newHandle = cleanHandle;
      await query('UPDATE users SET handle = $1, updated_at = NOW() WHERE id = $2', [newHandle, userId]);

      // Re-issue updated session cookie with new handle and uin
      const newToken = signSessionToken({
        userId: user.id,
        email: user.email,
        handle: newHandle,
        uin: user.uin ? parseInt(user.uin, 10) : undefined,
      });
      setSessionCookie(res, newToken);
    }

    // 2. Avatar processing / removal
    let newAvatarPath = user.avatar_path;
    if (removeAvatar === 'true' || removeAvatar === true) {
      newAvatarPath = null;
      await query('UPDATE users SET avatar_path = NULL, updated_at = NOW() WHERE id = $1', [userId]);
    } else if (req.file) {
      const processed = await processAvatarBuffer(req.file.buffer, userId);
      newAvatarPath = processed.avatarPath;
      await query('UPDATE users SET avatar_path = $1, updated_at = NOW() WHERE id = $2', [newAvatarPath, userId]);
    }

    // Background 11ty static rebuild
    import('../services/staticBuilder')
      .then((m) => m.buildStaticGallery({ userId }))
      .catch((err) => console.error('[:> 11ty] Profile rebuild error:', err));

    res.json({
      ok: true,
      message: 'Cyber identity and avatar updated successfully.',
      user: {
        id: userId,
        uin: user.uin ? parseInt(user.uin, 10) : undefined,
        handle: newHandle,
        avatarPath: newAvatarPath || '/icons/default-avatar.svg',
        hasCustomAvatar: !!newAvatarPath,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * 3. PUT /api/settings - Update authenticated user's hosting & deployment configuration
 */
settingsRouter.put('/settings', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.userId;
    const { siteUrl, siteName, apiKey, deploymentType, autoDeploy, deployPath, buildHtml } = req.body;

    // Fetch existing user to preserve existing apiKey if user didn't change it
    const existingRes = await query(
      `SELECT id, deployment_credentials, site_url, deployment_type, auto_deploy, deploy_path, build_html
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

    let finalSiteUrl = existingUser.site_url;
    if (siteUrl && typeof siteUrl === 'string') {
      const trimmed = siteUrl.trim();
      if (trimmed.length > 0) {
        if (!/^https?:\/\/[a-zA-Z0-9\-._~:/?#[\]@!$&'()*+,;=]+$/i.test(trimmed)) {
          res.status(400).json({
            ok: false,
            error: 'Site URL must be a valid HTTP or HTTPS address (e.g. https://yoursite.neocities.org).',
          });
          return;
        }
        finalSiteUrl = trimmed.slice(0, 500);
      }
    } else if (creds.siteName) {
      finalSiteUrl = `https://${creds.siteName}.neocities.org`;
    }

    const finalDeployType = deploymentType || existingUser.deployment_type || 'neocities';
    const finalAutoDeploy = typeof autoDeploy === 'boolean' ? autoDeploy : !!existingUser.auto_deploy;
    const finalBuildHtml = typeof buildHtml === 'boolean' ? buildHtml : (existingUser.build_html !== false);

    // Sanitize deploy_path (alphanumeric/hyphen/underscore whitelist, max 50 chars, or empty for root)
    let finalDeployPath = existingUser.deploy_path !== null ? existingUser.deploy_path : 'neogram';
    if (deployPath !== undefined && deployPath !== null) {
      const cleanPath = String(deployPath).trim().replace(/^\/+|\/+$/g, '');
      if (cleanPath.length > 0) {
        if (!/^[a-zA-Z0-9_-]{1,50}$/.test(cleanPath)) {
          res.status(400).json({
            ok: false,
            error: 'Target subfolder must only contain letters, numbers, underscores, and hyphens (max 50 chars).',
          });
          return;
        }
        finalDeployPath = cleanPath;
      } else {
        finalDeployPath = ''; // Root deploy
      }
    }

    await query(
      `UPDATE users
       SET site_url = $1,
           deployment_type = $2,
           deployment_credentials = $3,
           auto_deploy = $4,
           deploy_path = $5,
           build_html = $6,
           updated_at = NOW()
       WHERE id = $7`,
      [finalSiteUrl, finalDeployType, encryptedCreds, finalAutoDeploy, finalDeployPath, finalBuildHtml, userId]
    );

    console.log(`[:> SETTINGS] Updated deployment settings for user ${userId} (deployPath: "${finalDeployPath}", buildHtml: ${finalBuildHtml})`);

    // Trigger static gallery rebuild in background with new settings
    import('../services/staticBuilder')
      .then((m) => m.buildStaticGallery({ userId }))
      .catch((err) => console.error('[:> 11ty] Settings rebuild error:', err));

    res.json({
      ok: true,
      message: 'Deployment settings saved and encrypted in database.',
      settings: {
        siteUrl: finalSiteUrl,
        siteName: creds.siteName || '',
        deployPath: finalDeployPath,
        deploymentType: finalDeployType,
        hasApiKey: !!creds.apiKey,
        maskedApiKey: maskApiKey(creds.apiKey),
        autoDeploy: finalAutoDeploy,
        buildHtml: finalBuildHtml,
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
