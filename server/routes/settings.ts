import fs from 'fs';
import { createRequireSession } from '../auth/requireSession';
import path from 'path';
import { isSafePublicUrl, normalizePublicSiteUrl } from '../utils/safeFetch';
import { deploySite, providerLabel } from '../services/deployDispatcher';
import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { query } from '../db';
import { COOKIE_NAME, verifySessionToken, extractToken, signSessionToken, setSessionCookie, clearSessionCookie } from '../auth/jwt';
import { encryptCredentials, decryptCredentials, maskApiKey, NeocitiesCredentials } from '../utils/crypto';
import { testNeocitiesConnection } from '../services/neocitiesPublisher';
import { testNekowebConnection } from '../services/nekowebPublisher';
import { testGitHubConnection } from '../services/githubPublisher';
import { processAvatarBuffer } from '../services/imageProcessor';
import { getDefaultAvatarPath, isRemoteAvatarUrl, resolveAvatarPath } from '../utils/avatar';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => cb(null, /^image\/(jpeg|png|webp|gif|avif)$/i.test(file.mimetype)),
});

export const settingsRouter = Router();

/**
 * Authentication middleware for settings routes
 */
const requireSession = createRequireSession({
  missing: 'Authentication required. Please log in.',
  expired: 'Session expired. Please log in again.',
});

settingsRouter.use(['/settings', '/deploy'], requireSession);

/**
 * 1. GET /api/settings - Retrieve authenticated user's hosting & deployment configuration
 */
settingsRouter.get('/settings', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.userId;

    const userRes = await query(
      `SELECT id, email, handle, uin, site_url, deploy_path, deployment_type, deployment_credentials, auto_deploy, last_deployed_at, avatar_path, build_html, description, status_message
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

    const hasRemotePublishing = Boolean(activeSite ? (activeSite.hasApiKey && activeSite.deploymentType !== 'none') : false);
    const resolvedAvatar = resolveAvatarPath({
      avatarPath: user.avatar_path,
      hasRemotePublishing,
      deploymentType: activeSite?.deploymentType || user.deployment_type,
      siteUrl: activeSite?.siteUrl || user.site_url,
      uin: user.uin,
      handle: user.handle,
    });

    res.json({
      ok: true,
      settings: {
        id: user.id,
        uin: user.uin ? parseInt(user.uin, 10) : undefined,
        handle: user.handle,
        email: user.email,
        description: user.description || user.status_message || '',
        avatarPath: resolvedAvatar,
        hasCustomAvatar: isRemoteAvatarUrl(resolvedAvatar),
        siteId: activeSite ? activeSite.id : null,
        siteSlug: activeSite ? activeSite.slug : null,
        siteUrl: activeSite ? (activeSite.siteUrl || '') : '',
        siteName: activeSite ? (activeSite.siteName || '') : '',
        siteDisplayName: activeSite ? activeSite.name : '',
        deployPath: activeSite ? activeSite.deployPath : (user.deploy_path || 'neogram'),
        deploymentType: activeSite ? (activeSite.deploymentType || 'neocities') : 'neocities',
        hasApiKey: activeSite ? activeSite.hasApiKey : false,
        maskedApiKey: activeSite ? activeSite.maskedApiKey : '',
        autoDeploy: activeSite ? activeSite.autoDeploy : (user.auto_deploy || false),
        buildHtml: activeSite ? activeSite.buildHtml : (user.build_html !== false),
        customCssUrl: activeSite ? (activeSite.customCssUrl || '') : '',
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
    const { handle, removeAvatar, description } = req.body;

    const userRes = await query('SELECT id, email, handle, uin, avatar_path, description, status_message FROM users WHERE id = $1', [userId]);
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

      const { isReservedHandleFor } = await import('../auth/service');
      if (isReservedHandleFor(cleanHandle, user.email)) {
        res.status(400).json({ ok: false, error: 'Handles starting with "qa_" are reserved for Neogram QA test stations.' });
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

    // 1b. Optional description / statusMessage update if provided
    let newDescription = user.description || '';
    if (typeof description === 'string') {
      newDescription = description.trim().slice(0, 500);
      await query('UPDATE users SET description = $1, updated_at = NOW() WHERE id = $2', [
        newDescription,
        userId,
      ]);
    }
    if (typeof req.body.statusMessage === 'string' && req.body.statusMessage.trim()) {
      await query('UPDATE users SET status_message = $1, updated_at = NOW() WHERE id = $2', [
        req.body.statusMessage.trim().slice(0, 150),
        userId,
      ]);
    }

    const { getDefaultSite } = await import('../services/siteService');
    const defaultSite = await getDefaultSite(userId);
    const hasRemotePublishing = Boolean(defaultSite && defaultSite.hasApiKey && defaultSite.deploymentType !== 'none');

    // 2. Avatar processing / removal
    let newAvatarPath: string | null = isRemoteAvatarUrl(user.avatar_path) && hasRemotePublishing ? user.avatar_path : null;
    if (removeAvatar === 'true' || removeAvatar === true) {
      newAvatarPath = null;
      await query('UPDATE users SET avatar_path = NULL, updated_at = NOW() WHERE id = $1', [userId]);

      // Clean up local avatar files if any exist
      try {
        const uploadsDir = path.resolve(process.cwd(), 'public', 'uploads', 'avatars');
        if (fs.existsSync(uploadsDir)) {
          const files = await fs.promises.readdir(uploadsDir);
          for (const file of files) {
            if (file.startsWith(`${userId}-`)) {
              await fs.promises.unlink(path.join(uploadsDir, file)).catch(() => {});
            }
          }
        }
      } catch (_e) {}

      // If user has a mounted remote site, also delete avatar.webp from remote host
      try {
        if (defaultSite && defaultSite.deploymentType !== 'none') {
          if (defaultSite.deploymentType === 'neocities') {
            const { deleteFromNeocities } = await import('../services/neocitiesPublisher');
            deleteFromNeocities(defaultSite.id, ['avatar.webp']).catch(() => {});
          } else if (defaultSite.deploymentType === 'nekoweb') {
            const { deleteFromNekoweb } = await import('../services/nekowebPublisher');
            deleteFromNekoweb(defaultSite.id, ['avatar.webp']).catch(() => {});
          } else if (defaultSite.deploymentType === 'github') {
            const { deleteFromGitHub } = await import('../services/githubPublisher');
            deleteFromGitHub(defaultSite.id, ['avatar.webp']).catch(() => {});
          }
          const localStaging = path.join(process.cwd(), 'dist', 'static-galleries', defaultSite.id, 'avatar.webp');
          if (fs.existsSync(localStaging)) {
            await fs.promises.unlink(localStaging).catch(() => {});
          }
        }
      } catch (_e) {}
    } else if (req.file || req.body.avatarBase64 || req.body.imageBase64) {
      try {
        let bufferToProcess: Buffer;
        if (req.file) {
          bufferToProcess = req.file.buffer;
        } else {
          const raw = String(req.body.avatarBase64 || req.body.imageBase64);
          const cleanB64 = raw.replace(/^data:image\/[a-z0-9+]+;base64,/, '');
          bufferToProcess = Buffer.from(cleanB64, 'base64');
        }
        const processed = await processAvatarBuffer(bufferToProcess, userId);
        if (processed.deployedRemote && processed.avatarPath) {
          newAvatarPath = processed.avatarPath;
          await query('UPDATE users SET avatar_path = $1, updated_at = NOW() WHERE id = $2', [newAvatarPath, userId]);
        } else {
          newAvatarPath = null;
          await query('UPDATE users SET avatar_path = NULL, updated_at = NOW() WHERE id = $1', [userId]);
        }
      } catch (imgErr: any) {
        res.status(400).json({
          ok: false,
          error: 'Invalid or corrupt image file. Supported formats: WebP, JPEG, PNG, GIF, AVIF.',
        });
        return;
      }
    }

    // Background 11ty static rebuild
    import('../services/staticBuilder')
      .then((m) => m.buildStaticGallery({ siteId: defaultSite?.id, userId }))
      .catch((err) => console.error('[:> 11ty] Profile rebuild error:', err));

    const finalAvatarPath = resolveAvatarPath({
      avatarPath: newAvatarPath,
      hasRemotePublishing,
      deploymentType: defaultSite?.deploymentType,
      siteUrl: defaultSite?.siteUrl,
      uin: user.uin,
      handle: newHandle,
    });

    res.json({
      ok: true,
      message: 'Cyber identity and avatar updated successfully.',
      user: {
        id: userId,
        uin: user.uin ? parseInt(user.uin, 10) : undefined,
        handle: newHandle,
        description: newDescription,
        avatarPath: finalAvatarPath,
        hasCustomAvatar: isRemoteAvatarUrl(finalAvatarPath),
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

    const userRes = await query('SELECT id, handle FROM users WHERE id = $1', [userId]);
    if (userRes.rows.length === 0) {
      res.status(404).json({ ok: false, error: 'Account not found.' });
      return;
    }
    const handle: string = userRes.rows[0].handle || 'user';

    // All hosting settings belong to one site row. The legacy users.* deployment columns are no
    // longer written: they drifted out of sync with the sites table and leaked between sites.
    const { getDefaultSite, getSiteById, updateSite, createSite, getUserSites } = await import('../services/siteService');
    const targetSiteId = typeof req.body.siteId === 'string' && req.body.siteId ? req.body.siteId : '';
    const existing = targetSiteId ? await getSiteById(targetSiteId, userId) : await getDefaultSite(userId);
    if (targetSiteId && !existing) {
      res.status(404).json({ ok: false, error: 'Site not found.' });
      return;
    }

    const allowedTypes = ['neocities', 'nekoweb', 'github'];
    const finalDeployType: string = allowedTypes.includes(deploymentType)
      ? deploymentType
      : (existing?.deploymentType && allowedTypes.includes(existing.deploymentType) ? existing.deploymentType : 'neocities');

    const cleanSiteName = typeof siteName === 'string' ? siteName.trim() : '';
    const repo = typeof req.body.repo === 'string' ? req.body.repo.trim() : '';
    const branch = typeof req.body.branch === 'string' ? req.body.branch.trim() : '';

    let finalSiteUrl: string | undefined;
    if (typeof siteUrl === 'string' && siteUrl.trim()) {
      const trimmed = siteUrl.trim();
      if (!/^https?:\/\/[a-zA-Z0-9\-._~:/?#[\]@!$&'()*+,;=]+$/i.test(trimmed)) {
        res.status(400).json({ ok: false, error: 'Site URL must start with https:// (for example https://yoursite.neocities.org).' });
        return;
      }
      if (!isSafePublicUrl(trimmed)) {
        res.status(400).json({ ok: false, error: 'Site URL must be a public https:// address.' });
        return;
      }
      finalSiteUrl = normalizePublicSiteUrl(trimmed).slice(0, 500);
    } else if (!existing?.siteUrl && (cleanSiteName || repo)) {
      let derived = '';
      if (finalDeployType === 'github') {
        const { parseRepoString } = await import('../services/githubPublisher');
        const parsed = parseRepoString(repo || cleanSiteName, handle);
        if (parsed.repo) derived = `https://${parsed.owner}.github.io/${parsed.repo}`;
      } else {
        derived = `https://${cleanSiteName}.${finalDeployType === 'nekoweb' ? 'nekoweb.org' : 'neocities.org'}`;
      }
      if (derived) {
        try {
          finalSiteUrl = normalizePublicSiteUrl(derived).slice(0, 500);
        } catch {
          res.status(400).json({ ok: false, error: 'That site name makes an invalid address. Use letters, numbers and hyphens only.' });
          return;
        }
      }
    }

    let finalDeployPath: string | undefined;
    if (deployPath !== undefined && deployPath !== null) {
      const cleanPath = String(deployPath).trim().replace(/^\/+|\/+$/g, '');
      if (cleanPath.length > 0 && !/^[a-zA-Z0-9_-]{1,50}$/.test(cleanPath)) {
        res.status(400).json({ ok: false, error: 'Folder name can only use letters, numbers, underscores and hyphens (max 50).' });
        return;
      }
      finalDeployPath = cleanPath;
    }

    const newKey = typeof apiKey === 'string' && apiKey.trim() && !apiKey.startsWith('••••') ? apiKey.trim() : undefined;
    const common = {
      siteUrl: finalSiteUrl,
      deploymentType: finalDeployType,
      deployPath: finalDeployPath,
      apiKey: newKey,
      siteName: cleanSiteName || undefined,
      repo: repo || undefined,
      branch: branch || undefined,
      autoDeploy: typeof autoDeploy === 'boolean' ? autoDeploy : undefined,
      buildHtml: typeof buildHtml === 'boolean' ? buildHtml : undefined,
      // '' clears it; undefined leaves it unchanged. updateSite enforces https.
      customCssUrl: typeof req.body.customCssUrl === 'string' ? req.body.customCssUrl.trim() : undefined,
    };

    let updatedSite: any;
    if (existing) {
      updatedSite = await updateSite(existing.id, userId, common);
    } else if (finalSiteUrl || newKey) {
      updatedSite = await createSite(userId, { ...common, name: `@${handle}'s site`, isDefault: true });
    } else {
      res.status(400).json({ ok: false, error: 'Enter your site address or API key to connect a site.' });
      return;
    }

    import('../services/staticBuilder')
      .then((m) => m.buildStaticGallery({ siteId: updatedSite.id, userId }))
      .catch((err) => console.error('[:> 11ty] Settings rebuild error:', err));

    res.json({
      ok: true,
      message: 'Settings saved.',
      settings: {
        siteId: updatedSite.id,
        siteSlug: updatedSite.slug,
        siteUrl: updatedSite.siteUrl,
        siteName: updatedSite.siteName || '',
        siteDisplayName: updatedSite.name,
        deployPath: updatedSite.deployPath,
        deploymentType: updatedSite.deploymentType,
        hasApiKey: updatedSite.hasApiKey,
        maskedApiKey: updatedSite.maskedApiKey,
        autoDeploy: updatedSite.autoDeploy,
        buildHtml: updatedSite.buildHtml,
        customCssUrl: updatedSite.customCssUrl || '',
        sites: await getUserSites(userId),
      },
    });
  } catch (err: any) {
    if (err && typeof err.message === 'string' && /Site URL|slug|CSS/.test(err.message)) {
      res.status(400).json({ ok: false, error: err.message });
      return;
    }
    next(err);
  }
});

/**
 * 3. POST /api/settings/test-neocities - Test Neocities connection with either provided key or stored key
 */
settingsRouter.post('/settings/test-neocities', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.userId;
    const { apiKey, siteId } = req.body;

    let keyToTest: string | null = null;

    if (apiKey && typeof apiKey === 'string' && !apiKey.startsWith('••••') && apiKey.trim().length > 0) {
      keyToTest = apiKey.trim();
    } else {
      // Look up stored key in database (check site first if siteId provided, fallback to user)
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
 * 3c. POST /api/settings/test-github - Test GitHub Pages connection and repository permissions
 */
settingsRouter.post('/settings/test-github', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.userId;
    const { apiKey, repo, branch, siteId } = req.body;

    let keyToTest: string | null = null;
    let repoToTest: string | null = repo || null;
    let branchToTest: string = branch || 'gh-pages';

    if (apiKey && typeof apiKey === 'string' && !apiKey.startsWith('••••') && apiKey.trim().length > 0) {
      keyToTest = apiKey.trim();
    } else {
      if (siteId) {
        const siteRes = await query('SELECT deployment_credentials FROM sites WHERE id = $1 AND user_id = $2', [siteId, userId]);
        if (siteRes.rows.length > 0) {
          const creds = decryptCredentials<any>(siteRes.rows[0].deployment_credentials);
          keyToTest = creds?.apiKey || null;
          if (!repoToTest) repoToTest = creds?.repo || creds?.siteName || null;
          if (creds?.branch) branchToTest = creds.branch;
        }
      }
      if (!keyToTest) {
        const userRes = await query('SELECT deployment_credentials, handle FROM users WHERE id = $1', [userId]);
        if (userRes.rows.length > 0) {
          const creds = decryptCredentials<any>(userRes.rows[0].deployment_credentials);
          keyToTest = creds?.apiKey || null;
          if (!repoToTest) repoToTest = creds?.repo || creds?.siteName || null;
          if (creds?.branch) branchToTest = creds.branch || branchToTest;
        }
      }
    }

    if (!keyToTest) {
      res.status(400).json({
        ok: false,
        error: 'No GitHub Personal Access Token provided or found in your stored profile.',
      });
      return;
    }

    const testResult = await testGitHubConnection(keyToTest, repoToTest || undefined, branchToTest);

    if (!testResult.ok) {
      res.status(400).json({
        ok: false,
        error: testResult.error || 'GitHub connection failed.',
      });
      return;
    }

    res.json({
      ok: true,
      message: testResult.info?.repo
        ? `Verified connection to GitHub repository: "${testResult.info.fullName}" (branch: ${testResult.info.branch})`
        : `Verified GitHub authentication for user: "@${testResult.info?.owner}"`,
      info: testResult.info,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Resolves a deploy target strictly within the caller's own stations. A foreign siteId (or a raw
 * userId) is never passed to the publishers, which load and use that target's stored credentials.
 */
/**
 * 4. POST /api/deploy/:provider - Publish one of the caller's sites now.
 * Kept for API compatibility; the workstation uses POST /api/sites/:id/deploy. The provider in the
 * URL must match the site's saved provider so a key is never sent to the wrong host.
 */
settingsRouter.post('/deploy/:provider', async (req: Request, res: Response) => {
  const provider = req.params.provider;
  try {
    if (!['neocities', 'nekoweb', 'github'].includes(provider)) {
      res.status(404).json({ ok: false, error: 'Unknown host provider.' });
      return;
    }
    const userId = (req as any).user.userId;
    const { getSiteById, getDefaultSite } = await import('../services/siteService');
    const rawSiteId = req.body?.siteId || req.query?.siteId;
    let site = null;
    if (rawSiteId) {
      if (typeof rawSiteId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawSiteId)) {
        res.status(404).json({ ok: false, error: 'Site not found.' });
        return;
      }
      site = await getSiteById(rawSiteId, userId);
    } else {
      site = await getDefaultSite(userId);
    }
    if (!site) {
      res.status(404).json({ ok: false, error: 'Site not found.' });
      return;
    }
    if ((site.deploymentType || 'neocities') !== provider) {
      res.status(400).json({ ok: false, error: `This site is set up for ${providerLabel(site.deploymentType)}, not ${providerLabel(provider)}.` });
      return;
    }
    const deployResult = await deploySite(site.id, site.deploymentType);
    res.json({
      ok: true,
      message: deployResult.message,
      filesCount: deployResult.filesCount,
      durationMs: deployResult.durationMs,
      siteUrl: deployResult.siteUrl,
    });
  } catch (err: any) {
    res.status(400).json({ ok: false, error: err.message || `Publishing to ${providerLabel(provider)} failed.` });
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

    const { getPostsForUser } = await import('../services/postStorage');
    const postsWithComments = await getPostsForUser(userId);

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
 * 6. POST /api/settings/reset-station - Wipe station post records and start from scratch
 */
settingsRouter.post('/settings/reset-station', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.userId;
    const { wipeStationData } = await import('../services/stationSync');
    await wipeStationData(userId);

    res.json({
      ok: true,
      message: 'Station post archive purged cleanly. Station reset to a clean slate ready to publish from scratch.',
    });
  } catch (err) {
    next(err);
  }
});

/**
 * 7. DELETE /api/settings/account - Self-Serve Account Decommissioning (GDPR Right to Be Forgotten)
 */
settingsRouter.delete('/settings/account', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.userId;

    const path = await import('path');
    const fs = await import('fs/promises');
    const siteRows = await query('SELECT id FROM sites WHERE user_id = $1', [userId]);
    for (const id of [userId, ...siteRows.rows.map((r: any) => String(r.id))]) {
      if (!/^[0-9a-f-]{36}$/i.test(id)) continue;
      await fs.rm(path.join(process.cwd(), 'dist', 'static-galleries', id), { recursive: true, force: true }).catch(() => {});
    }

    // Cascade delete user and all related records from PostgreSQL
    await query('DELETE FROM users WHERE id = $1', [userId]);

    clearSessionCookie(res);

    res.json({
      ok: true,
      message: 'Your account has been deleted. Files on your own website were not touched.',
    });
  } catch (err) {
    next(err);
  }
});
