import path from 'path';
import fs from 'fs/promises';
import { query } from '../db';
import { decryptCredentials, NeocitiesCredentials } from '../utils/crypto';
import { buildStaticGallery } from './staticBuilder';

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
export async function deployToNeocities(userId: string): Promise<DeployResult> {
  const startTime = Date.now();

  // 1. Fetch user and encrypted credentials from database
  const userRes = await query(
    `SELECT id, email, handle, site_url, deployment_type, deployment_credentials, auto_deploy, deploy_path
     FROM users
     WHERE id = $1`,
    [userId]
  );

  if (userRes.rows.length === 0) {
    throw new Error('User node not found in database.');
  }

  const user = userRes.rows[0];
  const creds = decryptCredentials<NeocitiesCredentials>(user.deployment_credentials);

  if (!creds || !creds.apiKey || !creds.apiKey.trim()) {
    throw new Error(
      'No Neocities API key configured for your account. Please set up your key in Settings & Deploy.'
    );
  }

  const apiKey = creds.apiKey.trim();
  const userOutputDir = path.join(process.cwd(), 'dist/static-galleries', user.id);
  const rawDeployPath = user.deploy_path !== null && user.deploy_path !== undefined
    ? String(user.deploy_path).trim().replace(/^\/+|\/+$/g, '')
    : 'neogram';

  console.log(`[:> NEOCITIES DEPLOY] Initiating deployment for @${user.handle || user.email} (target folder: "${rawDeployPath || 'root'}")...`);

  // 2. Compile user's static gallery via 11ty
  const buildResult = await buildStaticGallery({
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
    const remotePath = rawDeployPath
      ? path.posix.join(rawDeployPath, file.relativePath)
      : file.relativePath;
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
    `UPDATE users
     SET last_deployed_at = NOW(),
         updated_at = NOW()
     WHERE id = $1`,
    [userId]
  );

  const baseSiteUrl = user.site_url ? user.site_url.replace(/\/+$/, '') : `https://${user.handle || 'user'}.neocities.org`;
  const deployedSiteUrl = rawDeployPath ? `${baseSiteUrl}/${rawDeployPath}/` : `${baseSiteUrl}/`;

  console.log(
    `[:> NEOCITIES DEPLOY SUCCESS] Uploaded ${filesToUpload.length} files in ${durationMs}ms: ${data.message}`
  );

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
export async function deleteFromNeocities(userId: string, filenames: string[]): Promise<boolean> {
  if (!filenames || filenames.length === 0) return true;

  try {
    const userRes = await query(
      `SELECT deployment_credentials, deploy_path FROM users WHERE id = $1`,
      [userId]
    );
    if (userRes.rows.length === 0) return false;

    const user = userRes.rows[0];
    const creds = decryptCredentials<NeocitiesCredentials>(user.deployment_credentials);
    if (!creds || !creds.apiKey) return false;

    const rawDeployPath = user.deploy_path !== null && user.deploy_path !== undefined
      ? String(user.deploy_path).trim().replace(/^\/+|\/+$/g, '')
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
      if (rawDeployPath && !cleanPath.startsWith(rawDeployPath + '/')) {
        console.warn(`[:> NEOCITIES DELETE REFUSED] Unsafe path rejected (outside deploy directory ${rawDeployPath}): ${cleanPath}`);
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
    console.log(`[:> NEOCITIES DELETE] Remote purge for user ${userId} (${validCount} files):`, data.message || data.result);
    return data.result === 'success';
  } catch (err: any) {
    console.warn(`[:> NEOCITIES DELETE ERROR] Failed to purge remote files:`, err.message);
    return false;
  }
}

/**
 * Triggers automated background deployment if the user has auto_deploy enabled.
 */
export async function triggerAutoDeployIfEnabled(userId: string): Promise<void> {
  try {
    const userRes = await query(
      `SELECT id, auto_deploy, deployment_credentials FROM users WHERE id = $1`,
      [userId]
    );

    if (userRes.rows.length === 0) return;
    const user = userRes.rows[0];

    if (!user.auto_deploy) return;

    const creds = decryptCredentials<NeocitiesCredentials>(user.deployment_credentials);
    if (!creds || !creds.apiKey) return;

    console.log(`[:> AUTO-DEPLOY] Auto-deploy triggered for user ${userId}. Processing in background...`);
    deployToNeocities(userId)
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
