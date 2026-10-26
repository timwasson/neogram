import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { query } from '../db';
import { COOKIE_NAME, verifySessionToken, extractToken, signSessionToken, setSessionCookie, clearSessionCookie } from '../auth/jwt';
import { encryptCredentials, decryptCredentials, maskApiKey, NeocitiesCredentials } from '../utils/crypto';
import { testNeocitiesConnection, deployToNeocities } from '../services/neocitiesPublisher';
import { testNekowebConnection, deployToNekoweb } from '../services/nekowebPublisher';
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
    const { getUserSites, getDefaultSite, getSiteById } = await import('../services/siteService');
    const sites = await getUserSites(userId);
    const reqSiteId = req.query.siteId as string;
    const activeSite = reqSiteId
      ? ((await getSiteById(reqSiteId, userId)) || (await getDefaultSite(userId)))
      : (await getDefaultSite(userId));

    res.json({
      ok: true,
      settings: {
        id: user.id,
        uin: user.uin ? parseInt(user.uin, 10) : undefined,
        handle: user.handle,
        email: user.email,
        avatarPath: user.avatar_path || '/icons/default-avatar.svg',
        hasCustomAvatar: !!user.avatar_path,
        siteId: activeSite ? activeSite.id : null,
        siteSlug: activeSite ? activeSite.slug : null,
        siteUrl: activeSite ? (activeSite.siteUrl || `https://${user.handle || 'user'}.neocities.org`) : (user.site_url || `https://${user.handle || 'user'}.neocities.org`),
        siteName: activeSite ? activeSite.name : '',
        deployPath: activeSite ? activeSite.deployPath : (user.deploy_path || 'neogram'),
        deploymentType: activeSite ? (activeSite.deploymentType || 'neocities') : (user.deployment_type || 'none'),
        hasApiKey: activeSite ? activeSite.hasApiKey : false,
        maskedApiKey: activeSite ? activeSite.maskedApiKey : '',
        autoDeploy: activeSite ? activeSite.autoDeploy : (user.auto_deploy || false),
        buildHtml: activeSite ? activeSite.buildHtml : (user.build_html !== false),
        lastDeployedAt: activeSite ? activeSite.lastDeployedAt : user.last_deployed_at,
        isDefault: activeSite ? activeSite.isDefault : false,
        sites,
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
    }

    const finalDeployType = deploymentType || existingUser.deployment_type || 'neocities';
    if (!finalSiteUrl && creds.siteName) {
      const hostDomain = finalDeployType === 'nekoweb' ? 'nekoweb.org' : 'neocities.org';
      finalSiteUrl = `https://${creds.siteName}.${hostDomain}`;
    }
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

    // Also synchronize corresponding site in sites table
    const { getDefaultSite, getSiteById, updateSite, createSite, getUserSites } = await import('../services/siteService');
    const targetSiteId = req.body.siteId as string;
    let siteToUpdate = targetSiteId ? await getSiteById(targetSiteId, userId) : await getDefaultSite(userId);
    let updatedSite: any = null;
    if (siteToUpdate) {
      updatedSite = await updateSite(siteToUpdate.id, userId, {
        name: siteName || siteToUpdate.name,
        siteUrl: finalSiteUrl,
        deploymentType: finalDeployType,
        deployPath: finalDeployPath,
        apiKey: apiKey && !apiKey.startsWith('••••') ? apiKey : undefined,
        siteName: creds.siteName,
        autoDeploy: finalAutoDeploy,
        buildHtml: finalBuildHtml,
      });
    } else if (siteName || finalSiteUrl || creds.apiKey) {
      // User is configuring their first static site target via settings
      updatedSite = await createSite(userId, {
        name: siteName || `${existingUser.handle ? existingUser.handle.toUpperCase() : 'Personal'} Site`,
        siteUrl: finalSiteUrl,
        deploymentType: finalDeployType,
        deployPath: finalDeployPath,
        apiKey: apiKey && !apiKey.startsWith('••••') ? apiKey : undefined,
        siteName: creds.siteName,
        autoDeploy: finalAutoDeploy,
        buildHtml: finalBuildHtml,
        isDefault: true,
      });
    }

    console.log(`[:> SETTINGS] Updated deployment settings for user ${userId} (deployPath: "${finalDeployPath}", buildHtml: ${finalBuildHtml})`);

    // Trigger static gallery rebuild in background with new settings
    import('../services/staticBuilder')
      .then((m) => m.buildStaticGallery({ siteId: updatedSite ? updatedSite.id : undefined, userId }))
      .catch((err) => console.error('[:> 11ty] Settings rebuild error:', err));

    res.json({
      ok: true,
      message: 'Deployment settings saved and encrypted in database.',
      settings: {
        siteId: updatedSite ? updatedSite.id : undefined,
        siteSlug: updatedSite ? updatedSite.slug : undefined,
        siteUrl: finalSiteUrl,
        siteName: creds.siteName || (updatedSite ? updatedSite.name : ''),
        deployPath: finalDeployPath,
        deploymentType: finalDeployType,
        hasApiKey: !!creds.apiKey,
        maskedApiKey: maskApiKey(creds.apiKey),
        autoDeploy: finalAutoDeploy,
        buildHtml: finalBuildHtml,
        sites: await getUserSites(userId),
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
 * 3b. POST /api/settings/test-nekoweb - Test Nekoweb connection with either provided key or stored key
 */
settingsRouter.post('/settings/test-nekoweb', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.userId;
    const { apiKey, siteId } = req.body;

    let keyToTest: string | null = null;

    if (apiKey && typeof apiKey === 'string' && !apiKey.startsWith('••••') && apiKey.trim().length > 0) {
      keyToTest = apiKey.trim();
    } else {
      // Look up stored key in database
      if (siteId) {
        const siteRes = await query('SELECT deployment_credentials FROM sites WHERE id = $1 AND user_id = $2', [siteId, userId]);
        if (siteRes.rows.length > 0) {
          const creds = decryptCredentials<NeocitiesCredentials>(siteRes.rows[0].deployment_credentials);
          keyToTest = creds?.apiKey || null;
        }
      }
      if (!keyToTest) {
        const userRes = await query(
          `SELECT deployment_credentials FROM users WHERE id = $1`,
          [userId]
        );
        if (userRes.rows.length > 0) {
          const creds = decryptCredentials<NeocitiesCredentials>(userRes.rows[0].deployment_credentials);
          keyToTest = creds?.apiKey || null;
        }
      }
    }

    if (!keyToTest) {
      res.status(400).json({
        ok: false,
        error: 'No Nekoweb API key provided or found in your stored profile.',
      });
      return;
    }

    const testResult = await testNekowebConnection(keyToTest);

    if (!testResult.ok) {
      res.status(400).json({
        ok: false,
        error: testResult.error || 'Nekoweb connection failed.',
      });
      return;
    }

    res.json({
      ok: true,
      message: `Verified connection with Nekoweb domain: "${testResult.info?.domain}"`,
      info: testResult.info,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * 3c. POST /api/settings/test-connection - Unified connection tester for either provider
 */
settingsRouter.post('/settings/test-connection', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.userId;
    const { provider, apiKey, siteId } = req.body;

    const targetProvider = provider === 'nekoweb' ? 'nekoweb' : 'neocities';
    if (targetProvider === 'nekoweb') {
      let keyToTest: string | null = (apiKey && !apiKey.startsWith('••••')) ? apiKey.trim() : null;
      if (!keyToTest) {
        if (siteId) {
          const siteRes = await query('SELECT deployment_credentials FROM sites WHERE id = $1 AND user_id = $2', [siteId, userId]);
          if (siteRes.rows.length > 0) {
            const creds = decryptCredentials<NeocitiesCredentials>(siteRes.rows[0].deployment_credentials);
            keyToTest = creds?.apiKey || null;
          }
        }
        if (!keyToTest) {
          const userRes = await query('SELECT deployment_credentials FROM users WHERE id = $1', [userId]);
          if (userRes.rows.length > 0) {
            const creds = decryptCredentials<NeocitiesCredentials>(userRes.rows[0].deployment_credentials);
            keyToTest = creds?.apiKey || null;
          }
        }
      }

      if (!keyToTest) {
        res.status(400).json({ ok: false, error: 'No Nekoweb API key provided.' });
        return;
      }

      const result = await testNekowebConnection(keyToTest);
      if (!result.ok) {
        res.status(400).json({ ok: false, error: result.error });
        return;
      }
      res.json({ ok: true, provider: 'nekoweb', message: `Verified Nekoweb domain: "${result.info?.domain}"`, info: result.info });
    } else {
      let keyToTest: string | null = (apiKey && !apiKey.startsWith('••••')) ? apiKey.trim() : null;
      if (!keyToTest) {
        if (siteId) {
          const siteRes = await query('SELECT deployment_credentials FROM sites WHERE id = $1 AND user_id = $2', [siteId, userId]);
          if (siteRes.rows.length > 0) {
            const creds = decryptCredentials<NeocitiesCredentials>(siteRes.rows[0].deployment_credentials);
            keyToTest = creds?.apiKey || null;
          }
        }
        if (!keyToTest) {
          const userRes = await query('SELECT deployment_credentials FROM users WHERE id = $1', [userId]);
          if (userRes.rows.length > 0) {
            const creds = decryptCredentials<NeocitiesCredentials>(userRes.rows[0].deployment_credentials);
            keyToTest = creds?.apiKey || null;
          }
        }
      }

      if (!keyToTest) {
        res.status(400).json({ ok: false, error: 'No Neocities API key provided.' });
        return;
      }

      const result = await testNeocitiesConnection(keyToTest);
      if (!result.ok) {
        res.status(400).json({ ok: false, error: result.error });
        return;
      }
      res.json({ ok: true, provider: 'neocities', message: `Verified Neocities site: "${result.info?.sitename}"`, info: result.info });
    }
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

/**
 * 4b. POST /api/deploy/nekoweb - Trigger immediate live deployment to Nekoweb
 */
settingsRouter.post('/deploy/nekoweb', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.userId;
    const deployResult = await deployToNekoweb(userId);
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
      error: err.message || 'Deployment to Nekoweb failed.',
    });
  }
});

/**
 * 5. GET /api/settings/export-archive - Data Portability / Export Station Archive (JSON)
 */
settingsRouter.get('/settings/export-archive', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.userId;

    const userRes = await query('SELECT id, email, handle, uin, site_url, deploy_path, status_message, created_at FROM users WHERE id = $1', [userId]);
    if (userRes.rows.length === 0) {
      res.status(404).json({ ok: false, error: 'User node not found.' });
      return;
    }
    const user = userRes.rows[0];

    const postsRes = await query('SELECT * FROM posts WHERE user_id = $1 ORDER BY created_at DESC', [userId]);
    const commentsRes = await query(
      `SELECT c.* FROM comments c
       JOIN posts p ON c.post_id = p.id
       WHERE p.user_id = $1
       ORDER BY c.created_at ASC`,
      [userId]
    );

    const commentsByPost: Record<string, any[]> = {};
    for (const c of commentsRes.rows) {
      if (!commentsByPost[c.post_id]) commentsByPost[c.post_id] = [];
      commentsByPost[c.post_id].push(c);
    }

    const postsWithComments = postsRes.rows.map((p) => ({
      ...p,
      comments: commentsByPost[p.id] || [],
    }));

    const guestbookRes = await query('SELECT * FROM guestbook_entries WHERE user_id = $1 ORDER BY created_at DESC', [userId]);
    const followsRes = await query('SELECT * FROM follows WHERE follower_id = $1 OR following_id = $1', [userId]);
    const counterRes = await query('SELECT hits, style FROM web_counters WHERE user_id = $1', [userId]);

    const archive = {
      version: 'neogram-station-archive-v1',
      exportedAt: new Date().toISOString(),
      station: {
        id: user.id,
        handle: user.handle,
        uin: user.uin,
        email: user.email,
        siteUrl: user.site_url,
        deployPath: user.deploy_path,
        statusMessage: user.status_message,
        registeredAt: user.created_at,
        webCounter: counterRes.rows[0] || { hits: 0, style: 'green_led' },
      },
      posts: postsWithComments,
      guestbook: guestbookRes.rows,
      connections: followsRes.rows,
    };

    const cleanHandle = (user.handle || 'station').replace(/[^a-z0-9_-]/gi, '');
    const filename = `neogram-archive-${cleanHandle}-${new Date().toISOString().split('T')[0]}.json`;

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(JSON.stringify(archive, null, 2));
  } catch (err) {
    next(err);
  }
});

/**
 * 6. DELETE /api/settings/account - Self-Serve Account Decommissioning (GDPR Right to Be Forgotten)
 */
settingsRouter.delete('/settings/account', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.userId;

    const path = await import('path');
    const fs = await import('fs/promises');
    const staticDir = path.join(process.cwd(), 'dist', 'static-galleries', userId);
    try {
      await fs.rm(staticDir, { recursive: true, force: true });
    } catch (_rmErr) {}

    // Cascade delete user and all related records from PostgreSQL
    await query('DELETE FROM users WHERE id = $1', [userId]);

    clearSessionCookie(res);

    res.json({
      ok: true,
      message: 'Station decommissioned cleanly. All local credentials and database records permanently purged.',
    });
  } catch (err) {
    next(err);
  }
});
