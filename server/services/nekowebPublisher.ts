import path from 'path';
import fs from 'fs/promises';
import { ZipArchive } from 'archiver';
import { query } from '../db';
import { decryptCredentials, NekowebCredentials } from '../utils/crypto';
import { buildStaticGallery } from './staticBuilder';
import { DeltaFile } from './neocitiesPublisher';
export type { DeltaFile };


export interface DeployResult {
  ok: boolean;
  message: string;
  filesCount: number;
  durationMs: number;
  siteUrl?: string;
  error?: string;
}


export interface NekowebSiteInfo {
  domain: string;
  title: string;
  views: number;
  followers?: number;
  updates?: number;
  created_at?: string;
  last_updated?: string;
}

/**
 * Validates a Nekoweb API key by querying the /site/info endpoint.
 */
export async function testNekowebConnection(apiKey: string): Promise<{ ok: boolean; info?: NekowebSiteInfo; error?: string }> {
  try {
    if (!apiKey || !apiKey.trim()) {
      return { ok: false, error: 'API key cannot be empty.' };
    }

    const res = await fetch('https://nekoweb.org/api/site/info', {
      method: 'GET',
      headers: {
        'Authorization': apiKey.trim(),
      },
    });

    const data = (await res.json().catch(() => ({}))) as any;

    if (!res.ok || data.error) {
      return {
        ok: false,
        error: data.message || data.error || `Nekoweb rejected authentication (HTTP ${res.status}).`,
      };
    }

    return {
      ok: true,
      info: {
        domain: data.domain || data.username || 'unknown',
        title: data.title || data.domain || 'Nekoweb Site',
        views: data.views || 0,
        followers: data.followers || 0,
        updates: data.updates || 0,
        created_at: data.created_at || data.createdAt,
        last_updated: data.updated_at || data.last_updated,
      },
    };
  } catch (err: any) {
    return {
      ok: false,
      error: `Network failure connecting to nekoweb.org: ${err.message}`,
    };
  }
}

/**
 * Creates an in-memory ZIP archive buffer of the specified directory.
 */
export async function zipDirectoryToBuffer(sourceDir: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const archive = new ZipArchive({ zlib: { level: 9 } });
    const chunks: Buffer[] = [];

    archive.on('data', (chunk: Buffer) => chunks.push(chunk));
    archive.on('end', () => resolve(Buffer.concat(chunks)));
    archive.on('error', (err: any) => reject(err));

    archive.directory(sourceDir, false);
    archive.finalize();
  });
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
      if (entry.name.startsWith('.') || entry.name === 'Thumbs.db') continue;
      const relPath = path.relative(baseDir, fullPath).replace(/\\/g, '/');
      results.push({ absolutePath: fullPath, relativePath: relPath });
    }
  }

  return results;
}

/**
 * Builds the user's static 11ty gallery and deploys all files directly to their Nekoweb site
 * using Nekoweb's official Big File + ZIP Import API.
 */
export async function deployToNekoweb(targetId: string, isSiteId: boolean = false): Promise<DeployResult> {
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

  const creds = decryptCredentials<NekowebCredentials>(site.deployment_credentials || user.deployment_credentials);

  if (!creds || !creds.apiKey || !creds.apiKey.trim()) {
    throw new Error(
      `No Nekoweb API key configured for site "${site.name || 'Personal Site'}". Please set up your key in Settings & Deploy.`
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

  console.log(`[:> NEKOWEB DEPLOY] Initiating deployment for @${user.handle || user.email} (site: "${site.name}", target folder: "${rawDeployPath || 'root'}")...`);

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

  console.log(`[:> NEKOWEB DEPLOY] Packaging ${filesToUpload.length} static assets into ZIP archive...`);

  // 4. Archive static gallery into ZIP buffer
  const zipBuffer = await zipDirectoryToBuffer(userOutputDir);

  // 5. Nekoweb Multi-Step Deployment Pipeline:
  // Step 5A: Initialize big file upload session
  console.log('[:> NEKOWEB DEPLOY] Requesting big upload session from Nekoweb API...');
  const initRes = await fetch('https://nekoweb.org/api/files/big/create', {
    method: 'GET',
    headers: {
      'Authorization': apiKey,
    },
  });

  const initData = (await initRes.json().catch(() => ({}))) as any;
  if (!initRes.ok || !initData || !initData.id) {
    const errorMsg = initData?.message || `Nekoweb upload initialization rejected (HTTP ${initRes.status}).`;
    throw new Error(errorMsg);
  }

  const bigId = initData.id;
  console.log(`[:> NEKOWEB DEPLOY] Upload session created with ID: ${bigId}`);

  // Step 5B: Append ZIP archive payload to big upload session
  const formData = new FormData();
  formData.append('id', String(bigId));
  const zipBlob = new Blob([new Uint8Array(zipBuffer)], { type: 'application/zip' });
  formData.append('file', zipBlob, 'static-gallery.zip');

  const appendRes = await fetch('https://nekoweb.org/api/files/big/append', {
    method: 'POST',
    headers: {
      'Authorization': apiKey,
    },
    body: formData,
  });

  const appendData = (await appendRes.json().catch(() => ({}))) as any;
  if (!appendRes.ok) {
    throw new Error(appendData?.message || `Failed to transfer static gallery archive to Nekoweb (HTTP ${appendRes.status}).`);
  }

  // Step 5C: Import and extract ZIP archive into destination folder
  const destinationPath = rawDeployPath ? `/${rawDeployPath}` : '/';
  console.log(`[:> NEKOWEB DEPLOY] Extracting static archive into target path: "${destinationPath}"...`);

  const importParams = new URLSearchParams();
  importParams.append('path', destinationPath);

  const importRes = await fetch(`https://nekoweb.org/api/files/import/${bigId}`, {
    method: 'POST',
    headers: {
      'Authorization': apiKey,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: importParams.toString(),
  });

  const importData = (await importRes.json().catch(() => ({}))) as any;
  if (!importRes.ok) {
    throw new Error(importData?.message || `Failed to extract static gallery on Nekoweb (HTTP ${importRes.status}).`);
  }

  const durationMs = Date.now() - startTime;

  // 6. Zero-Retention Disk Purge:
  // Purge any uploaded media from the local disk so the Neogram server stores 0 bytes of user media
  try {
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

  const baseSiteUrl = user.site_url ? user.site_url.replace(/\/+$/, '') : `https://${user.handle || 'user'}.nekoweb.org`;
  const deployedSiteUrl = rawDeployPath ? `${baseSiteUrl}/${rawDeployPath}/` : `${baseSiteUrl}/`;

  console.log(
    `[:> NEKOWEB DEPLOY SUCCESS] Uploaded ${filesToUpload.length} files in ${durationMs}ms.`
  );

  // 8. Dispatch deploy notification to user
  import('./notificationService').then((m) => {
    m.dispatchNotification({
      userId: user.id,
      type: 'deploy',
      title: '🚀 Nekoweb Deployment Complete!',
      body: `Synchronized ${filesToUpload.length} files to your Nekoweb static host (${durationMs}ms).`,
      linkUrl: deployedSiteUrl,
      icon: '🚀',
    }).catch(() => {});
  }).catch(() => {});

  return {
    ok: true,
    message: importData?.message || 'Files successfully uploaded and extracted on Nekoweb.',
    filesCount: filesToUpload.length,
    durationMs,
    siteUrl: deployedSiteUrl,
  };
}

/**
 * Deletes remote files from the user's Nekoweb site (e.g. when a post is deleted).
 * Strictly non-destructive: only permits purging files inside uploads/ and matching deploy_path.
 */
export async function deleteFromNekoweb(targetId: string, filenames: string[]): Promise<boolean> {
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

    const creds = decryptCredentials<NekowebCredentials>(credsRaw);
    if (!creds || !creds.apiKey) return false;

    const cleanDeployPath = rawDeployPath !== null && rawDeployPath !== undefined
      ? String(rawDeployPath).trim().replace(/^\/+|\/+$/g, '')
      : 'neogram';

    let successCount = 0;

    for (const file of filenames) {
      const cleanPath = file.replace(/^https?:\/\/[^\/]+\//, '').replace(/^\/+/, '');

      // STRICT NON-DESTRUCTIVE SAFETY INVARIANT:
      // Neogram must NEVER delete non-Neogram user files!
      if (!cleanPath.includes('uploads/')) {
        console.warn(`[:> NEKOWEB DELETE REFUSED] Unsafe deletion path rejected (not in uploads/): ${cleanPath}`);
        continue;
      }
      if (cleanDeployPath && !cleanPath.startsWith(cleanDeployPath + '/')) {
        console.warn(`[:> NEKOWEB DELETE REFUSED] Unsafe path rejected (outside deploy directory ${cleanDeployPath}): ${cleanPath}`);
        continue;
      }

      const remotePath = cleanPath.startsWith('/') ? cleanPath : `/${cleanPath}`;

      const params = new URLSearchParams();
      params.append('pathname', remotePath);

      try {
        const res = await fetch('https://nekoweb.org/api/files/delete', {
          method: 'POST',
          headers: {
            'Authorization': creds.apiKey.trim(),
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: params.toString(),
        });

        if (res.ok) {
          successCount++;
        }
      } catch (_delErr) {
        console.warn(`[:> NEKOWEB DELETE WARNING] Error deleting remote file ${remotePath}:`, _delErr);
      }
    }

    console.log(`[:> NEKOWEB DELETE] Remote purge finished for target ${targetId} (${successCount} files deleted).`);
    return successCount > 0;
  } catch (err: any) {
    console.warn('[:> NEKOWEB DELETE ERROR] Failed to purge remote files:', err.message);
    return false;
  }
}

/**
 * Triggers automated background deployment to Nekoweb if auto_deploy is enabled.
 */
export async function triggerNekowebAutoDeployIfEnabled(targetId: string): Promise<void> {
  try {
    const siteRes = await query(
      `SELECT id, auto_deploy, deployment_type, deployment_credentials FROM sites WHERE id = $1`,
      [targetId]
    );

    if (siteRes.rows.length > 0) {
      const site = siteRes.rows[0];
      if (!site.auto_deploy || site.deployment_type !== 'nekoweb') return;
      const creds = decryptCredentials<NekowebCredentials>(site.deployment_credentials);
      if (!creds || !creds.apiKey) return;
      console.log(`[:> AUTO-DEPLOY] Nekoweb auto-deploy triggered for site ${site.id}...`);
      deployToNekoweb(site.id, true)
        .then((res) => console.log(`[:> NEKOWEB AUTO-DEPLOY FINISHED] Deployed ${res.filesCount} files in ${res.durationMs}ms.`))
        .catch((err) => console.error('[:> NEKOWEB AUTO-DEPLOY ERROR]', err.message));
      return;
    }

    const userRes = await query(
      `SELECT id, auto_deploy, deployment_type, deployment_credentials FROM users WHERE id = $1`,
      [targetId]
    );

    if (userRes.rows.length === 0) return;
    const user = userRes.rows[0];

    if (!user.auto_deploy || user.deployment_type !== 'nekoweb') return;

    const creds = decryptCredentials<NekowebCredentials>(user.deployment_credentials);
    if (!creds || !creds.apiKey) return;

    console.log(`[:> AUTO-DEPLOY] Nekoweb auto-deploy triggered for user ${targetId}...`);
    deployToNekoweb(targetId)
      .then((res) => {
        console.log(`[:> NEKOWEB AUTO-DEPLOY FINISHED] Deployed ${res.filesCount} files in ${res.durationMs}ms.`);
      })
      .catch((err) => {
        console.error('[:> NEKOWEB AUTO-DEPLOY ERROR]', err.message);
      });
  } catch (err: any) {
    console.error('[:> NEKOWEB AUTO-DEPLOY HOOK ERROR]', err.message);
  }
}

/**
 * Deploys an explicit list of delta files directly to Nekoweb via POST /api/files/upload.
 * Bypasses ZIP creation and big file imports for individual/small updates.
 */
export async function deployFilesToNekoweb(
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

  const creds = decryptCredentials<NekowebCredentials>(site.deployment_credentials || user.deployment_credentials);
  if (!creds || !creds.apiKey || !creds.apiKey.trim()) {
    throw new Error(
      `No Nekoweb API key configured for site "${site.name || 'Personal Site'}".`
    );
  }

  const apiKey = creds.apiKey.trim();
  const rawDeployPath = site.deploy_path !== null && site.deploy_path !== undefined
    ? String(site.deploy_path).trim().replace(/^\/+|\/+$/g, '')
    : 'neogram';

  // Group files by destination folder on Nekoweb
  const filesByDir = new Map<string, Array<{ filename: string; bytes: Buffer }>>();
  const ensuredDirs = new Set<string>();

  for (const file of files) {
    let fileBytes: Buffer;
    if (file.content !== undefined) {
      fileBytes = Buffer.isBuffer(file.content) ? file.content : Buffer.from(file.content, 'utf-8');
    } else if (file.absolutePath) {
      fileBytes = await fs.readFile(file.absolutePath);
    } else {
      continue;
    }

    const cleanRel = path.posix.normalize(file.relativePath).replace(/^(\.\.(\/|\\|$))+/, '');
    const remotePath = rawDeployPath
      ? path.posix.join(rawDeployPath, cleanRel)
      : cleanRel;
    const dir = path.posix.dirname(remotePath);
    const normalizedDir = dir === '.' ? '/' : (dir.startsWith('/') ? dir : `/${dir}`);

    if (!filesByDir.has(normalizedDir)) {
      filesByDir.set(normalizedDir, []);
    }
    filesByDir.get(normalizedDir)!.push({
      filename: path.basename(remotePath),
      bytes: fileBytes,
    });
  }

  // Upload each folder's batch directly via POST /api/files/upload (without ZIP!)
  let uploadedCount = 0;
  for (const [dirPath, folderFiles] of filesByDir.entries()) {
    // Ensure subdirectory exists on Nekoweb if not root
    if (dirPath !== '/' && !ensuredDirs.has(dirPath)) {
      try {
        const createParams = new URLSearchParams();
        createParams.append('isFolder', 'true');
        createParams.append('pathname', dirPath.replace(/^\/+/, ''));
        await fetch('https://nekoweb.org/api/files/create', {
          method: 'POST',
          headers: {
            'Authorization': apiKey,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: createParams.toString(),
        });
        ensuredDirs.add(dirPath);
      } catch (_dirErr) {}
    }

    // Nekoweb /files/upload accepts files for pathname
    const formData = new FormData();
    formData.append('pathname', dirPath);
    for (const f of folderFiles) {
      const blob = new Blob([new Uint8Array(f.bytes)]);
      formData.append('files', blob, f.filename);
    }

    const res = await fetch('https://nekoweb.org/api/files/upload', {
      method: 'POST',
      headers: {
        'Authorization': apiKey,
      },
      body: formData,
    });

    const resData = (await res.json().catch(() => ({}))) as any;
    if (!res.ok) {
      console.warn(`[:> NEKOWEB DELTA UPLOAD WARNING] Failed uploading to ${dirPath}:`, resData);
      throw new Error(resData?.message || `Failed uploading files to Nekoweb directory ${dirPath}`);
    }
    uploadedCount += folderFiles.length;
  }

  const durationMs = Date.now() - startTime;
  const baseSiteUrl = user.site_url ? user.site_url.replace(/\/+$/, '') : `https://${user.handle || 'user'}.nekoweb.org`;
  const deployedSiteUrl = rawDeployPath ? `${baseSiteUrl}/${rawDeployPath}/` : `${baseSiteUrl}/`;

  console.log(`[:> NEKOWEB DELTA DEPLOY SUCCESS] Uploaded ${uploadedCount} delta files in ${durationMs}ms`);

  return {
    ok: true,
    message: `Delta files uploaded successfully to Nekoweb.`,
    filesCount: uploadedCount,
    durationMs,
    siteUrl: deployedSiteUrl,
  };
}

