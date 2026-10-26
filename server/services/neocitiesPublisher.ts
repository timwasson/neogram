import path from 'path';
import fs from 'fs/promises';
import { query } from '../db';
import { decryptCredentials, NeocitiesCredentials } from '../utils/crypto';
import { buildStaticGallery } from './staticBuilder';

export interface DeltaFile {
  relativePath: string;
  absolutePath?: string;
  content?: string | Buffer;
  contentType?: string;
}

export interface DeployResult {
  ok: boolean;
  message: string;
  filesCount: number;
  durationMs: number;
  siteUrl?: string;
  error?: string;
}

export interface NeocitiesSiteInfo {
  sitename: string;
  views: number;
  hits: number;
  created_at: string;
  last_updated: string;
  domain?: string;
  tags?: string[];
}


/**
 * Validates a Neocities API key by querying the /api/info endpoint.
 */
export async function testNeocitiesConnection(apiKey: string): Promise<{ ok: boolean; info?: NeocitiesSiteInfo; error?: string }> {
  try {
    if (!apiKey || !apiKey.trim()) {
      return { ok: false, error: 'API key cannot be empty.' };
    }

    const res = await fetch('https://neocities.org/api/info', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey.trim()}`,
      },
    });

    const data = (await res.json()) as any;

    if (!res.ok || data.result !== 'success' || !data.info) {
      return {
        ok: false,
        error: data.message || `Neocities rejected authentication (HTTP ${res.status}).`,
      };
    }

    return {
      ok: true,
      info: {
        sitename: data.info.sitename,
        views: data.info.views || 0,
        hits: data.info.hits || 0,
        created_at: data.info.created_at,
        last_updated: data.info.last_updated,
        domain: data.info.domain,
        tags: data.info.tags || [],
      },
    };
  } catch (err: any) {
    return {
      ok: false,
      error: `Network failure connecting to neocities.org: ${err.message}`,
    };
  }
}

/**
 * Recursively scans a directory and collects all files with relative paths.
 */
async function getFilesRecursively(
  dir: string,
  baseDir: string = dir
): Promise<{ absolutePath: string; relativePath: string }[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const results: { absolutePath: string; relativePath: string }[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await getFilesRecursively(fullPath, baseDir);
      results.push(...nested);
    } else {
      // Ignore hidden files and system temp files
      if (entry.name.startsWith('.') || entry.name === 'Thumbs.db') continue;
      const relPath = path.relative(baseDir, fullPath).replace(/\\/g, '/');
      results.push({ absolutePath: fullPath, relativePath: relPath });
    }
  }

  return results;
}

/**
 * Builds the user's static 11ty gallery and deploys all files directly to their Neocities site.
 */
export async function deployToNeocities(targetId: string, isSiteId: boolean = false): Promise<DeployResult> {
  const startTime = Date.now();

  // 1. Fetch site or user and encrypted credentials from database
  let site: any = null;
  let user: any = null;

  const siteRes = await query(
    `SELECT s.*, u.id as user_owner_id, u.email, u.handle
     FROM sites s
     JOIN users u ON s.user_id = u.id
     WHERE s.id = $1`,
    [targetId]
  );

  if (siteRes.rows.length > 0) {
    site = siteRes.rows[0];
    user = { id: site.user_owner_id, email: site.email, handle: site.handle };
  } else {
    // Fallback: targetId was a userId
    const userRes = await query(
      `SELECT id, email, handle, site_url, deployment_type, deployment_credentials, auto_deploy, deploy_path
       FROM users
       WHERE id = $1`,
      [targetId]
    );

    if (userRes.rows.length === 0) {
      throw new Error('User node or site target not found in database.');
    }

    user = userRes.rows[0];
    const { getDefaultSite } = await import('./siteService');
    site = await getDefaultSite(user.id);
  }

  const creds = decryptCredentials<NeocitiesCredentials>(site.deployment_credentials || user.deployment_credentials);

  if (!creds || !creds.apiKey || !creds.apiKey.trim()) {
    throw new Error(
      `No Neocities API key configured for site "${site.name || 'Personal Site'}". Please set up your key in Settings & Deploy.`
    );
  }

  const apiKey = creds.apiKey.trim();
  const fsSync = await import('fs');
  const siteDir = path.join(process.cwd(), 'dist/static-galleries', site.id);
  const userDir = path.join(process.cwd(), 'dist/static-galleries', user.id);
  const userOutputDir = fsSync.existsSync(siteDir) ? siteDir : (fsSync.existsSync(userDir) ? userDir : siteDir);

  const rawDeployPath = site.deploy_path !== null && site.deploy_path !== undefined
    ? String(site.deploy_path).trim().replace(/^\/+|\/+$/g, '')
    : 'neogram';

  console.log(`[:> NEOCITIES DEPLOY] Initiating deployment for @${user.handle || user.email} (site: "${site.name}", target folder: "${rawDeployPath || 'root'}")...`);

  // 2. Compile static gallery via 11ty
  const buildResult = await buildStaticGallery({
    siteId: site.id,
    userId: user.id,
    outputDir: userOutputDir,
  });

  if (!buildResult.ok) {
    throw new Error(`Static compilation failed: ${buildResult.error}`);
  }

  // 3. Collect files from compilation directory
  const filesToUpload = await getFilesRecursively(userOutputDir);
  if (filesToUpload.length === 0) {
    throw new Error('No static assets generated in output directory.');
  }

  console.log(`[:> NEOCITIES DEPLOY] Uploading ${filesToUpload.length} static assets to Neocities...`);

  // 4. Construct multipart/form-data payload with deploy_path prefix
  const formData = new FormData();
  for (const file of filesToUpload) {
    const fileBytes = await fs.readFile(file.absolutePath);
    const blob = new Blob([fileBytes]);
    const sanitizedDeploy = rawDeployPath.replace(/[^a-zA-Z0-9_-]/g, '');
    const cleanRel = path.posix.normalize(file.relativePath).replace(/^(\.\.(\/|\\|$))+/, '');
    const remotePath = sanitizedDeploy
      ? path.posix.join(sanitizedDeploy, cleanRel)
      : cleanRel;
    formData.append(remotePath, blob, path.basename(remotePath));
  }

  // 5. POST to https://neocities.org/api/upload
  const res = await fetch('https://neocities.org/api/upload', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
    },
    body: formData,
  });

  const data = (await res.json()) as any;

  if (!res.ok || data.result !== 'success') {
    const msg = (data.message || '').toLowerCase();
    if (res.status === 429 || msg.includes('rate limit') || msg.includes('too many')) {
      throw new Error('Neocities API rate limit reached. Please wait a few minutes before deploying again.');
    }
    if (res.status === 413 || msg.includes('quota') || msg.includes('storage') || msg.includes('space') || msg.includes('limit')) {
      throw new Error('Neocities storage quota exceeded (1GB limit on free accounts). Please remove unused files from your Neocities account dashboard.');
    }
    throw new Error(data.message || `Neocities upload rejected (HTTP ${res.status}).`);
  }

  const durationMs = Date.now() - startTime;

  // 6. Zero-Retention Disk Purge:
  // Purge any uploaded media from the local disk so the Neogram server stores 0 bytes of user media
  try {
    const fsSync = await import('fs');
    const uploadsDir = path.join(userOutputDir, 'uploads');
    if (fsSync.existsSync(uploadsDir)) {
      await fs.rm(uploadsDir, { recursive: true, force: true });
      console.log(`[:> ZERO-RETENTION PURGE] Purged local media directory: ${uploadsDir}`);
    }
  } catch (purgeErr) {
    console.warn('[:> ZERO-RETENTION WARNING] Could not purge local uploads dir:', purgeErr);
  }

  // 7. Record last deployment in database
  await query(
    `UPDATE sites
     SET last_deployed_at = NOW(),
         updated_at = NOW()
     WHERE id = $1`,
    [site.id]
  );
  await query(
    `UPDATE users
     SET last_deployed_at = NOW(),
         updated_at = NOW()
     WHERE id = $1`,
    [user.id]
  );

  const baseSiteUrl = user.site_url ? user.site_url.replace(/\/+$/, '') : `https://${user.handle || 'user'}.neocities.org`;
  const deployedSiteUrl = rawDeployPath ? `${baseSiteUrl}/${rawDeployPath}/` : `${baseSiteUrl}/`;

  console.log(
    `[:> NEOCITIES DEPLOY SUCCESS] Uploaded ${filesToUpload.length} files in ${durationMs}ms: ${data.message}`
  );

  // Dispatch deploy notification to user
  import('./notificationService').then((m) => {
    m.dispatchNotification({
      userId: user.id,
      type: 'deploy',
      title: '🚀 Neocities Deployment Complete!',
      body: `Synchronized ${filesToUpload.length} files to your static host (${durationMs}ms).`,
      linkUrl: deployedSiteUrl,
      icon: '🚀',
    }).catch(() => {});
  }).catch(() => {});

  return {
    ok: true,
    message: data.message || 'Files successfully uploaded to Neocities.',
    filesCount: filesToUpload.length,
    durationMs,
    siteUrl: deployedSiteUrl,
  };
}

/**
 * Deletes remote files from the user's Neocities site (e.g. when a post is deleted).
 * Strictly non-destructive: only permits purging files inside uploads/ and matching deploy_path.
 */
export async function deleteFromNeocities(targetId: string, filenames: string[]): Promise<boolean> {
  if (!filenames || filenames.length === 0) return true;

  try {
    let credsRaw: any;
    let rawDeployPath: any;

    const siteRes = await query(
      `SELECT deployment_credentials, deploy_path FROM sites WHERE id = $1`,
      [targetId]
    );

    if (siteRes.rows.length > 0) {
      credsRaw = siteRes.rows[0].deployment_credentials;
      rawDeployPath = siteRes.rows[0].deploy_path;
    } else {
      const userRes = await query(
        `SELECT deployment_credentials, deploy_path FROM users WHERE id = $1`,
        [targetId]
      );
      if (userRes.rows.length === 0) return false;
      credsRaw = userRes.rows[0].deployment_credentials;
      rawDeployPath = userRes.rows[0].deploy_path;
    }

    const creds = decryptCredentials<NeocitiesCredentials>(credsRaw);
    if (!creds || !creds.apiKey) return false;

    const cleanDeployPath = rawDeployPath !== null && rawDeployPath !== undefined
      ? String(rawDeployPath).trim().replace(/^\/+|\/+$/g, '')
      : 'neogram';

    const formData = new FormData();
    let validCount = 0;

    for (const file of filenames) {
      // Strip any full URL or leading slashes for Neocities relative path
      const cleanPath = file.replace(/^https?:\/\/[^\/]+\//, '').replace(/^\/+/, '');

      // STRICT NON-DESTRUCTIVE SAFETY INVARIANT:
      // Neogram must NEVER delete non-Neogram user files!
      if (!cleanPath.includes('uploads/')) {
        console.warn(`[:> NEOCITIES DELETE REFUSED] Unsafe deletion path rejected (not in uploads/): ${cleanPath}`);
        continue;
      }
      if (cleanDeployPath && !cleanPath.startsWith(cleanDeployPath + '/')) {
        console.warn(`[:> NEOCITIES DELETE REFUSED] Unsafe path rejected (outside deploy directory ${cleanDeployPath}): ${cleanPath}`);
        continue;
      }

      formData.append('filenames[]', cleanPath);
      validCount++;
    }

    if (validCount === 0) {
      console.log(`[:> NEOCITIES DELETE] No safe files matching delete criteria.`);
      return true;
    }

    const res = await fetch('https://neocities.org/api/delete', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${creds.apiKey.trim()}`,
      },
      body: formData,
    });

    const data = (await res.json()) as any;
    console.log(`[:> NEOCITIES DELETE] Remote purge for target ${targetId} (${validCount} files):`, data.message || data.result);
    return data.result === 'success';
  } catch (err: any) {
    console.warn(`[:> NEOCITIES DELETE ERROR] Failed to purge remote files:`, err.message);
    return false;
  }
}

/**
 * Triggers automated background deployment if the target has auto_deploy enabled.
 */
export async function triggerAutoDeployIfEnabled(targetId: string): Promise<void> {
  try {
    const siteRes = await query(
      `SELECT id, auto_deploy, deployment_credentials FROM sites WHERE id = $1`,
      [targetId]
    );

    if (siteRes.rows.length > 0) {
      const site = siteRes.rows[0];
      if (!site.auto_deploy) return;
      const creds = decryptCredentials<NeocitiesCredentials>(site.deployment_credentials);
      if (!creds || !creds.apiKey) return;
      console.log(`[:> AUTO-DEPLOY] Auto-deploy triggered for site ${site.id}. Processing in background...`);
      deployToNeocities(site.id, true)
        .then((res) => console.log(`[:> AUTO-DEPLOY FINISHED] Deployed ${res.filesCount} files in ${res.durationMs}ms.`))
        .catch((err) => console.error('[:> AUTO-DEPLOY ERROR]', err.message));
      return;
    }

    const userRes = await query(
      `SELECT id, auto_deploy, deployment_credentials FROM users WHERE id = $1`,
      [targetId]
    );

    if (userRes.rows.length === 0) return;
    const user = userRes.rows[0];

    if (!user.auto_deploy) return;

    const creds = decryptCredentials<NeocitiesCredentials>(user.deployment_credentials);
    if (!creds || !creds.apiKey) return;

    console.log(`[:> AUTO-DEPLOY] Auto-deploy triggered for user ${targetId}. Processing in background...`);
    deployToNeocities(targetId)
      .then((res) => {
        console.log(`[:> AUTO-DEPLOY FINISHED] Deployed ${res.filesCount} files in ${res.durationMs}ms.`);
      })
      .catch((err) => {
        console.error('[:> AUTO-DEPLOY ERROR]', err.message);
      });
  } catch (err: any) {
    console.error('[:> AUTO-DEPLOY HOOK ERROR]', err.message);
  }
}

/**
 * Deploys an explicit list of delta files directly to Neocities without full directory scan.
 * Drastically speeds up photo uploads, comments, and friend feed updates.
 */
export async function deployFilesToNeocities(
  targetId: string,
  files: DeltaFile[],
  isSiteId: boolean = false
): Promise<DeployResult> {
  const startTime = Date.now();
  if (!files || files.length === 0) {
    return { ok: true, message: 'No delta files to deploy.', filesCount: 0, durationMs: 0 };
  }

  let site: any = null;
  let user: any = null;

  const siteRes = await query(
    `SELECT s.*, u.id as user_owner_id, u.email, u.handle
     FROM sites s
     JOIN users u ON s.user_id = u.id
     WHERE s.id = $1`,
    [targetId]
  );

  if (siteRes.rows.length > 0) {
    site = siteRes.rows[0];
    user = { id: site.user_owner_id, email: site.email, handle: site.handle };
  } else {
    const userRes = await query(
      `SELECT id, email, handle, site_url, deployment_type, deployment_credentials, auto_deploy, deploy_path
       FROM users
       WHERE id = $1`,
      [targetId]
    );

    if (userRes.rows.length === 0) {
      throw new Error('User node or site target not found in database.');
    }

    user = userRes.rows[0];
    const { getDefaultSite } = await import('./siteService');
    site = await getDefaultSite(user.id);
  }

  const creds = decryptCredentials<NeocitiesCredentials>(site.deployment_credentials || user.deployment_credentials);
  if (!creds || !creds.apiKey || !creds.apiKey.trim()) {
    throw new Error(
      `No Neocities API key configured for site "${site.name || 'Personal Site'}".`
    );
  }

  const apiKey = creds.apiKey.trim();
  const rawDeployPath = site.deploy_path !== null && site.deploy_path !== undefined
    ? String(site.deploy_path).trim().replace(/^\/+|\/+$/g, '')
    : 'neogram';

  const formData = new FormData();
  let validCount = 0;

  for (const file of files) {
    let fileBytes: Buffer;
    if (file.content !== undefined) {
      fileBytes = Buffer.isBuffer(file.content) ? file.content : Buffer.from(file.content, 'utf-8');
    } else if (file.absolutePath) {
      fileBytes = await fs.readFile(file.absolutePath);
    } else {
      continue;
    }

    const blob = new Blob([new Uint8Array(fileBytes)]);
    const sanitizedDeploy = rawDeployPath.replace(/[^a-zA-Z0-9_-]/g, '');
    const cleanRel = path.posix.normalize(file.relativePath).replace(/^(\.\.(\/|\\|$))+/, '');
    const remotePath = sanitizedDeploy
      ? path.posix.join(sanitizedDeploy, cleanRel)
      : cleanRel;

    formData.append(remotePath, blob, path.basename(remotePath));
    validCount++;
  }

  if (validCount === 0) {
    return { ok: true, message: 'No valid files provided.', filesCount: 0, durationMs: 0 };
  }

  const res = await fetch('https://neocities.org/api/upload', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
    },
    body: formData,
  });

  const data = (await res.json()) as any;
  if (!res.ok || data.result !== 'success') {
    const msg = (data.message || '').toLowerCase();
    if (res.status === 429 || msg.includes('rate limit') || msg.includes('too many')) {
      throw new Error('Neocities API rate limit reached. Please wait a few minutes before deploying again.');
    }
    if (res.status === 413 || msg.includes('quota') || msg.includes('storage') || msg.includes('space')) {
      throw new Error('Neocities storage quota exceeded.');
    }
    throw new Error(data.message || `Neocities upload rejected (HTTP ${res.status}).`);
  }

  const durationMs = Date.now() - startTime;
  const baseSiteUrl = user.site_url ? user.site_url.replace(/\/+$/, '') : `https://${user.handle || 'user'}.neocities.org`;
  const deployedSiteUrl = rawDeployPath ? `${baseSiteUrl}/${rawDeployPath}/` : `${baseSiteUrl}/`;

  console.log(`[:> NEOCITIES DELTA DEPLOY] Uploaded ${validCount} delta files in ${durationMs}ms`);

  return {
    ok: true,
    message: data.message || 'Delta files uploaded successfully to Neocities.',
    filesCount: validCount,
    durationMs,
    siteUrl: deployedSiteUrl,
  };
}

