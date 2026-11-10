import path from 'path';
import fs from 'fs/promises';
import { query } from '../db';
import { decryptCredentials, GitHubCredentials } from '../utils/crypto';
import { buildStaticGallery, executeStaticBuild } from './staticBuilder';
import { DeltaFile, DeployResult } from './neocitiesPublisher';

export type { DeltaFile, DeployResult };

export interface GitHubSiteInfo {
  owner: string;
  repo: string;
  branch: string;
  fullName: string;
  description?: string;
  isPrivate: boolean;
  defaultBranch: string;
  pagesUrl?: string;
  updatedAt: string;
}

/**
 * Standardized fetch wrapper for the GitHub REST API
 */
async function githubFetch(
  endpoint: string,
  token: string,
  options: RequestInit = {}
): Promise<{ ok: boolean; status: number; data: any; headers: Headers }> {
  const url = endpoint.startsWith('https://') ? endpoint : `https://api.github.com${endpoint}`;
  const headers = new Headers(options.headers || {});

  headers.set('Authorization', `Bearer ${token.trim()}`);
  headers.set('User-Agent', 'Neogram-Retro-Social/1.0');
  headers.set('Accept', 'application/vnd.github+json');
  headers.set('X-GitHub-Api-Version', '2022-11-28');

  if (options.body && typeof options.body === 'string' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(url, {
    ...options,
    headers,
  });

  let data: any = null;
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    data = await res.json().catch(() => null);
  } else {
    data = await res.text().catch(() => null);
  }

  return { ok: res.ok, status: res.status, data, headers: res.headers };
}

/**
 * Helper to parse repository input into [owner, repoName]
 * Supports:
 * - "owner/repo"
 * - "username.github.io/repo" or "https://username.github.io/repo/"
 * - "https://github.com/owner/repo"
 * - "username.github.io" (root user pages repo)
 * - "repo" (uses fallbackOwner)
 */
export function parseRepoString(input: string, fallbackOwner: string = ''): { owner: string; repo: string } {
  if (!input || !input.trim()) {
    return { owner: fallbackOwner, repo: '' };
  }
  let cleaned = input.trim();
  cleaned = cleaned.replace(/^https?:\/\//i, '');
  cleaned = cleaned.replace(/\/+$/, '');
  cleaned = cleaned.replace(/^github\.com\//i, '');
  cleaned = cleaned.replace(/\.git$/i, '');

  const ghPagesMatch = cleaned.match(/^([a-zA-Z0-9_\-\.]+)\.github\.io\/(.+)$/i);
  if (ghPagesMatch) {
    const owner = ghPagesMatch[1].replace(/\.github\.io$/i, '');
    const repoPart = ghPagesMatch[2].split('/')[0].trim();
    return { owner, repo: repoPart };
  }

  if (cleaned.toLowerCase().endsWith('.github.io')) {
    const owner = cleaned.slice(0, -10).trim();
    return { owner, repo: `${owner}.github.io` };
  }

  if (cleaned.includes('/')) {
    const parts = cleaned.split('/');
    let owner = parts[0].trim();
    if (owner.toLowerCase().endsWith('.github.io')) {
      owner = owner.slice(0, -10);
    }
    const repo = parts[1].trim();
    return { owner, repo };
  }

  return { owner: fallbackOwner, repo: cleaned };
}

/**
 * Validates a GitHub Personal Access Token and verifies repository permissions.
 */
export async function testGitHubConnection(
  token: string,
  repoInput?: string,
  branchInput: string = 'gh-pages'
): Promise<{ ok: boolean; info?: GitHubSiteInfo; error?: string }> {
  try {
    if (!token || !token.trim()) {
      return { ok: false, error: 'GitHub Personal Access Token (PAT) cannot be empty.' };
    }

    if (/\s|\||\bauth\b/i.test(token.trim())) {
      return {
        ok: false,
        error:
          'Invalid GitHub token format: It appears a shell command (e.g. "gh auth token") was entered instead of the token value. Please paste the Personal Access Token string itself (e.g. ghp_... or gho_...).',
      };
    }

    // 1. Verify user authentication
    const userRes = await githubFetch('/user', token);
    if (!userRes.ok) {
      if (userRes.status === 401) {
        return { ok: false, error: 'Invalid or expired GitHub Personal Access Token.' };
      }
      return {
        ok: false,
        error: userRes.data?.message || `GitHub rejected authentication (HTTP ${userRes.status}).`,
      };
    }

    const authUser = userRes.data;
    const login = authUser.login;

    // 2. If a repository was provided, verify access and permissions
    if (repoInput && repoInput.trim()) {
      const { owner, repo } = parseRepoString(repoInput, login);
      if (!owner || !repo) {
        return { ok: false, error: 'Repository must be in "owner/repo" or "repo" format.' };
      }

      const repoRes = await githubFetch(`/repos/${owner}/${repo}`, token);
      if (!repoRes.ok) {
        if (repoRes.status === 404) {
          return { ok: false, error: `Repository "${owner}/${repo}" was not found or is inaccessible with this token.` };
        }
        return {
          ok: false,
          error: repoRes.data?.message || `Failed to access repository "${owner}/${repo}" (HTTP ${repoRes.status}).`,
        };
      }

      const repoData = repoRes.data;
      const canPush = repoData.permissions ? repoData.permissions.push : true;
      if (!canPush) {
        return {
          ok: false,
          error: `Your GitHub token does not have write / push permissions to repository "${owner}/${repo}".`,
        };
      }

      // Check GitHub Pages URL if Pages is active
      let pagesUrl = `https://${owner}.github.io/${repo}/`;
      const pagesRes = await githubFetch(`/repos/${owner}/${repo}/pages`, token);
      if (pagesRes.ok && pagesRes.data?.html_url) {
        pagesUrl = pagesRes.data.html_url;
      }

      return {
        ok: true,
        info: {
          owner,
          repo,
          branch: branchInput || 'gh-pages',
          fullName: repoData.full_name,
          description: repoData.description || '',
          isPrivate: !!repoData.private,
          defaultBranch: repoData.default_branch || 'main',
          pagesUrl,
          updatedAt: repoData.updated_at,
        },
      };
    }

    // Fallback if no repo was provided yet
    return {
      ok: true,
      info: {
        owner: login,
        repo: '',
        branch: branchInput || 'gh-pages',
        fullName: login,
        isPrivate: false,
        defaultBranch: 'main',
        pagesUrl: `https://${login}.github.io/`,
        updatedAt: new Date().toISOString(),
      },
    };
  } catch (err: any) {
    return {
      ok: false,
      error: `Network failure connecting to api.github.com: ${err.message}`,
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
      const subResults = await getFilesRecursively(fullPath, baseDir);
      results.push(...subResults);
    } else if (entry.isFile()) {
      const relativePath = path.relative(baseDir, fullPath).replace(/\\/g, '/');
      results.push({ absolutePath: fullPath, relativePath });
    }
  }

  return results;
}

/**
 * Executes a Git commit via the GitHub Git Database REST API.
 * This atomically pushes files or deltas directly to the target branch.
 */
async function commitFilesToGitHubRepo(
  token: string,
  owner: string,
  repo: string,
  branch: string,
  deployPathPrefix: string,
  files: DeltaFile[],
  commitMessage: string,
  options: { pruneStalePhotos?: boolean } = {}
): Promise<{ ok: boolean; commitSha?: string; filesCount: number; error?: string }> {
  // 1. Resolve current branch ref and parent commit
  let parentCommitSha: string | null = null;
  let baseTreeSha: string | null = null;

  const branchRefRes = await githubFetch(`/repos/${owner}/${repo}/git/ref/heads/${branch}`, token);

  if (branchRefRes.ok && branchRefRes.data?.object?.sha) {
    parentCommitSha = branchRefRes.data.object.sha;
    // Fetch commit object to obtain tree sha
    const parentCommitRes = await githubFetch(`/repos/${owner}/${repo}/git/commits/${parentCommitSha}`, token);
    if (parentCommitRes.ok && parentCommitRes.data?.tree?.sha) {
      baseTreeSha = parentCommitRes.data.tree.sha;
    }
  } else {
    // Branch does not exist yet. Check if repo has a default branch we can branch off of.
    const repoInfoRes = await githubFetch(`/repos/${owner}/${repo}`, token);
    if (repoInfoRes.ok && repoInfoRes.data?.default_branch) {
      const defaultBranch = repoInfoRes.data.default_branch;
      const defaultRefRes = await githubFetch(`/repos/${owner}/${repo}/git/ref/heads/${defaultBranch}`, token);
      if (defaultRefRes.ok && defaultRefRes.data?.object?.sha) {
        parentCommitSha = defaultRefRes.data.object.sha;
        const defaultCommitRes = await githubFetch(`/repos/${owner}/${repo}/git/commits/${parentCommitSha}`, token);
        if (defaultCommitRes.ok && defaultCommitRes.data?.tree?.sha) {
          // If target is gh-pages and deploying root or separate branch, we can choose whether to base off default
          baseTreeSha = defaultCommitRes.data.tree.sha;
        }
      }
    }
  }

  // 2. Upload Blobs concurrently (in batches of 10)
  const treeEntries: Array<{ path: string; mode: string; type: string; sha: string }> = [];
  const cleanPrefix = deployPathPrefix.replace(/^\/+|\/+$/g, '');

  const batchSize = 10;
  for (let i = 0; i < files.length; i += batchSize) {
    const chunk = files.slice(i, i + batchSize);
    await Promise.all(
      chunk.map(async (file) => {
        let contentBuffer: Buffer;
        if (file.content !== undefined) {
          contentBuffer = Buffer.isBuffer(file.content) ? file.content : Buffer.from(file.content, 'utf-8');
        } else if (file.absolutePath) {
          contentBuffer = await fs.readFile(file.absolutePath);
        } else {
          return;
        }

        const base64Content = contentBuffer.toString('base64');
        const blobRes = await githubFetch(`/repos/${owner}/${repo}/git/blobs`, token, {
          method: 'POST',
          body: JSON.stringify({
            content: base64Content,
            encoding: 'base64',
          }),
        });

        if (!blobRes.ok || !blobRes.data?.sha) {
          throw new Error(
            `Failed to upload Git blob for ${file.relativePath}: ${blobRes.data?.message || 'Unknown error'}`
          );
        }

        const normalizedRel = path.posix.normalize(file.relativePath).replace(/^(\.\.(\/|\\|$))+/, '');
        const targetRepoPath = cleanPrefix ? path.posix.join(cleanPrefix, normalizedRel) : normalizedRel;

        treeEntries.push({
          path: targetRepoPath,
          mode: '100644',
          type: 'blob',
          sha: blobRes.data.sha,
        });
      })
    );
  }

  // Ensure root .nojekyll exists on GitHub Pages branch so Jekyll doesn't ignore assets
  if (!cleanPrefix && !treeEntries.some((e) => e.path === '.nojekyll')) {
    try {
      const noJekyllBlobRes = await githubFetch(`/repos/${owner}/${repo}/git/blobs`, token, {
        method: 'POST',
        body: JSON.stringify({
          content: '',
          encoding: 'utf-8',
        }),
      });
      if (noJekyllBlobRes.ok && noJekyllBlobRes.data?.sha) {
        treeEntries.push({
          path: '.nojekyll',
          mode: '100644',
          type: 'blob',
          sha: noJekyllBlobRes.data.sha,
        });
      }
    } catch {
      // Non-critical, continue
    }
  }

  // 2.5 Prune stale photo pages and deleted media blobs if performing a full gallery deployment
  if (options.pruneStalePhotos && baseTreeSha) {
    try {
      const existingTreeRes = await githubFetch(
        `/repos/${owner}/${repo}/git/trees/${baseTreeSha}?recursive=1`,
        token
      );
      if (existingTreeRes.ok && Array.isArray(existingTreeRes.data?.tree)) {
        const uploadedPaths = new Set(treeEntries.map((e) => e.path));
        const photosPrefix = cleanPrefix ? `${cleanPrefix}/photos/` : 'photos/';
        for (const item of existingTreeRes.data.tree) {
          if (
            item.type === 'blob' &&
            typeof item.path === 'string' &&
            item.path.startsWith(photosPrefix) &&
            !uploadedPaths.has(item.path)
          ) {
            treeEntries.push({
              path: item.path,
              mode: '100644',
              type: 'blob',
              sha: null as any,
            });
          }
        }
      }
    } catch {
      // Non-critical, continue
    }
  }

  // 3. Create Git Tree
  const treePayload: any = {
    tree: treeEntries,
  };
  if (baseTreeSha) {
    treePayload.base_tree = baseTreeSha;
  }

  const treeRes = await githubFetch(`/repos/${owner}/${repo}/git/trees`, token, {
    method: 'POST',
    body: JSON.stringify(treePayload),
  });

  if (!treeRes.ok || !treeRes.data?.sha) {
    throw new Error(`Failed to create Git tree on ${owner}/${repo}: ${treeRes.data?.message || 'Unknown error'}`);
  }

  const newTreeSha = treeRes.data.sha;

  // 4. Create Git Commit
  const commitPayload: any = {
    message: commitMessage,
    tree: newTreeSha,
    parents: parentCommitSha ? [parentCommitSha] : [],
  };

  const commitRes = await githubFetch(`/repos/${owner}/${repo}/git/commits`, token, {
    method: 'POST',
    body: JSON.stringify(commitPayload),
  });

  if (!commitRes.ok || !commitRes.data?.sha) {
    throw new Error(`Failed to create Git commit on ${owner}/${repo}: ${commitRes.data?.message || 'Unknown error'}`);
  }

  const newCommitSha = commitRes.data.sha;

  // 5. Update or Create Branch Ref
  if (branchRefRes.ok) {
    // Update existing ref
    const updateRefRes = await githubFetch(`/repos/${owner}/${repo}/git/refs/heads/${branch}`, token, {
      method: 'PATCH',
      body: JSON.stringify({
        sha: newCommitSha,
        force: false,
      }),
    });

    if (!updateRefRes.ok) {
      throw new Error(`Failed to update branch ref heads/${branch}: ${updateRefRes.data?.message || 'Unknown error'}`);
    }
  } else {
    // Create new ref
    const createRefRes = await githubFetch(`/repos/${owner}/${repo}/git/refs`, token, {
      method: 'POST',
      body: JSON.stringify({
        ref: `refs/heads/${branch}`,
        sha: newCommitSha,
      }),
    });

    if (!createRefRes.ok) {
      throw new Error(`Failed to create branch ref refs/heads/${branch}: ${createRefRes.data?.message || 'Unknown error'}`);
    }
  }

  return { ok: true, commitSha: newCommitSha, filesCount: treeEntries.length };
}

/**
 * Full static gallery deployment to GitHub Pages via Git Database API.
 */
export async function deployToGitHub(
  targetId: string,
  isSiteId: boolean = false,
  deployOptions: { directBuild?: boolean; skipFriendsFeed?: boolean } = {}
): Promise<DeployResult> {
  const startTime = Date.now();

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

  const creds = decryptCredentials<GitHubCredentials>(site.deployment_credentials || user.deployment_credentials);

  if (!creds || !creds.apiKey || !creds.apiKey.trim()) {
    throw new Error(
      `No GitHub Personal Access Token configured for site "${site.name || 'Personal Site'}". Please configure your PAT in Settings & Deploy.`
    );
  }

  const token = creds.apiKey.trim();
  const rawRepoInput = creds.repo || creds.siteName || user.handle || 'site';
  const { owner, repo } = parseRepoString(rawRepoInput, user.handle);

  if (!owner || !repo) {
    throw new Error('GitHub repository name is missing. Please set owner/repo in Settings & Deploy.');
  }

  const branch = creds.branch || 'gh-pages';
  const rawDeployPath = site.deploy_path !== null && site.deploy_path !== undefined
    ? String(site.deploy_path).trim().replace(/^\/+|\/+$/g, '')
    : 'neogram';

  const fsSync = await import('fs');
  const siteDir = path.join(process.cwd(), 'dist/static-galleries', site.id);
  const userDir = path.join(process.cwd(), 'dist/static-galleries', user.id);
  const userOutputDir = fsSync.existsSync(siteDir) ? siteDir : (fsSync.existsSync(userDir) ? userDir : siteDir);

  console.log(
    `[:> GITHUB DEPLOY] Initiating deployment for @${user.handle || user.email} -> ${owner}/${repo} (branch: "${branch}", folder: "${rawDeployPath || 'root'}")...`
  );

  // 1. Compile static gallery via 11ty
  const buildOptions = {
    siteId: site.id,
    userId: user.id,
    outputDir: userOutputDir,
    skipFriendsFeed: deployOptions.skipFriendsFeed,
  };
  const buildResult = deployOptions.directBuild
    ? await executeStaticBuild(buildOptions)
    : await buildStaticGallery(buildOptions);

  if (!buildResult.ok) {
    throw new Error(`Static compilation failed: ${buildResult.error}`);
  }

  // 2. Collect files from compilation directory
  const filesToUpload = await getFilesRecursively(userOutputDir);
  if (filesToUpload.length === 0) {
    throw new Error('No static assets generated in output directory.');
  }

  console.log(`[:> GITHUB DEPLOY] Packaging ${filesToUpload.length} static assets for Git Database commit...`);

  const deltaFiles: DeltaFile[] = filesToUpload.map((f) => ({
    relativePath: f.relativePath,
    absolutePath: f.absolutePath,
  }));

  const commitRes = await commitFilesToGitHubRepo(
    token,
    owner,
    repo,
    branch,
    rawDeployPath,
    deltaFiles,
    `[:> NEOGRAM] Full Static Gallery Deployment (${deltaFiles.length} files)`,
    { pruneStalePhotos: true }
  );

  const durationMs = Date.now() - startTime;

  // 3. Zero-retention disk purge of temporary media uploads
  try {
    const uploadsDir = path.join(userOutputDir, 'uploads');
    if (fsSync.existsSync(uploadsDir)) {
      await fs.rm(uploadsDir, { recursive: true, force: true });
      console.log(`[:> ZERO-RETENTION PURGE] Purged local media directory: ${uploadsDir}`);
    }
  } catch (purgeErr) {
    console.warn('[:> ZERO-RETENTION WARNING] Could not purge local uploads dir:', purgeErr);
  }

  // 4. Update deployment records in database
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

  const baseSiteUrl = site.site_url || user.site_url || `https://${owner}.github.io/${repo}`;
  const deployedSiteUrl = rawDeployPath ? `${baseSiteUrl.replace(/\/+$/, '')}/${rawDeployPath}/` : `${baseSiteUrl.replace(/\/+$/, '')}/`;

  console.log(
    `[:> GITHUB DEPLOY SUCCESS] Committed ${commitRes.filesCount} files in ${durationMs}ms (Commit: ${commitRes.commitSha?.slice(0, 7)})`
  );

  // Dispatch deploy notification to user
  import('./notificationService')
    .then((m) => {
      m.dispatchNotification({
        userId: user.id,
        type: 'deploy',
        title: '🚀 GitHub Pages Deployment Complete!',
        body: `Committed ${commitRes.filesCount} files to ${owner}/${repo} (${durationMs}ms).`,
        linkUrl: deployedSiteUrl,
        icon: '🚀',
      }).catch(() => {});
    })
    .catch(() => {});

  return {
    ok: true,
    message: `Successfully committed ${commitRes.filesCount} files to GitHub repository "${owner}/${repo}" on branch "${branch}".`,
    filesCount: commitRes.filesCount,
    durationMs,
    siteUrl: deployedSiteUrl,
  };
}

/**
 * High-speed incremental delta deployment to GitHub Pages.
 */
export async function deployFilesToGitHub(
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

  const creds = decryptCredentials<GitHubCredentials>(site.deployment_credentials || user.deployment_credentials);
  if (!creds || !creds.apiKey || !creds.apiKey.trim()) {
    throw new Error(`No GitHub Personal Access Token configured for site "${site.name || 'Personal Site'}".`);
  }

  const token = creds.apiKey.trim();
  const rawRepoInput = creds.repo || creds.siteName || user.handle || 'site';
  const { owner, repo } = parseRepoString(rawRepoInput, user.handle);
  const branch = creds.branch || 'gh-pages';
  const rawDeployPath = site.deploy_path !== null && site.deploy_path !== undefined
    ? String(site.deploy_path).trim().replace(/^\/+|\/+$/g, '')
    : 'neogram';

  const commitRes = await commitFilesToGitHubRepo(
    token,
    owner,
    repo,
    branch,
    rawDeployPath,
    files,
    `[:> NEOGRAM] Delta Snap / Reaction Update (${files.length} delta files)`
  );

  const durationMs = Date.now() - startTime;

  await query(
    `UPDATE sites SET last_deployed_at = NOW(), updated_at = NOW() WHERE id = $1`,
    [site.id]
  );

  return {
    ok: true,
    message: `Delta files committed to GitHub (${files.length} files in ${durationMs}ms).`,
    filesCount: files.length,
    durationMs,
  };
}

/**
 * Deletes remote files from the GitHub branch by setting tree entries with sha: null.
 */
export async function deleteFromGitHub(targetId: string, filenames: string[]): Promise<boolean> {
  if (!filenames || filenames.length === 0) return true;

  try {
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
        `SELECT id, email, handle, deployment_credentials, deploy_path FROM users WHERE id = $1`,
        [targetId]
      );
      if (userRes.rows.length === 0) return false;
      user = userRes.rows[0];
      const { getDefaultSite } = await import('./siteService');
      site = await getDefaultSite(user.id);
    }

    const creds = decryptCredentials<GitHubCredentials>(site.deployment_credentials || user.deployment_credentials);
    if (!creds || !creds.apiKey || !creds.apiKey.trim()) return false;

    const token = creds.apiKey.trim();
    const rawRepoInput = creds.repo || creds.siteName || user.handle || 'site';
    const { owner, repo } = parseRepoString(rawRepoInput, user.handle);
    const branch = creds.branch || 'gh-pages';
    const rawDeployPath = site.deploy_path !== null && site.deploy_path !== undefined
      ? String(site.deploy_path).trim().replace(/^\/+|\/+$/g, '')
      : 'neogram';

    const branchRefRes = await githubFetch(`/repos/${owner}/${repo}/git/ref/heads/${branch}`, token);
    if (!branchRefRes.ok || !branchRefRes.data?.object?.sha) return false;

    const parentCommitSha = branchRefRes.data.object.sha;
    const parentCommitRes = await githubFetch(`/repos/${owner}/${repo}/git/commits/${parentCommitSha}`, token);
    if (!parentCommitRes.ok || !parentCommitRes.data?.tree?.sha) return false;

    const baseTreeSha = parentCommitRes.data.tree.sha;

    // Build tree entries that delete paths (sha: null)
    const treeEntries = filenames.map((file) => {
      const normalizedRel = path.posix.normalize(file).replace(/^(\.\.(\/|\\|$))+/, '');
      const remotePath = rawDeployPath ? path.posix.join(rawDeployPath, normalizedRel) : normalizedRel;
      return {
        path: remotePath,
        mode: '100644',
        type: 'blob',
        sha: null as any,
      };
    });

    const treeRes = await githubFetch(`/repos/${owner}/${repo}/git/trees`, token, {
      method: 'POST',
      body: JSON.stringify({
        base_tree: baseTreeSha,
        tree: treeEntries,
      }),
    });

    if (!treeRes.ok || !treeRes.data?.sha) return false;

    const commitRes = await githubFetch(`/repos/${owner}/${repo}/git/commits`, token, {
      method: 'POST',
      body: JSON.stringify({
        message: `[:> NEOGRAM] Purged ${filenames.length} deleted post assets`,
        tree: treeRes.data.sha,
        parents: [parentCommitSha],
      }),
    });

    if (!commitRes.ok || !commitRes.data?.sha) return false;

    await githubFetch(`/repos/${owner}/${repo}/git/refs/heads/${branch}`, token, {
      method: 'PATCH',
      body: JSON.stringify({
        sha: commitRes.data.sha,
        force: false,
      }),
    });

    console.log(`[:> GITHUB DELETE] Successfully purged ${filenames.length} files from ${owner}/${repo}`);
    return true;
  } catch (err) {
    console.warn('[:> GITHUB DELETE WARNING] Failed to purge files from GitHub:', err);
    return false;
  }
}

/**
 * Purges all remote files inside <deploy_path>/photos/ and <deploy_path>/uploads/ on GitHub Pages
 * by setting their Git tree entries to sha: null.
 */
export async function purgeRemoteGitHubPhotos(targetId: string): Promise<number> {
  try {
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
        `SELECT id, email, handle, deployment_credentials, deploy_path FROM users WHERE id = $1`,
        [targetId]
      );
      if (userRes.rows.length === 0) return 0;
      user = userRes.rows[0];
      const { getDefaultSite } = await import('./siteService');
      site = await getDefaultSite(user.id);
    }

    const creds = decryptCredentials<GitHubCredentials>(site.deployment_credentials || user.deployment_credentials);
    if (!creds || !creds.apiKey || !creds.apiKey.trim()) return 0;

    const token = creds.apiKey.trim();
    const rawRepoInput = creds.repo || creds.siteName || user.handle || 'site';
    const { owner, repo } = parseRepoString(rawRepoInput, user.handle);
    if (!owner || !repo) return 0;

    const branch = creds.branch || 'gh-pages';
    const cleanPrefix = site.deploy_path !== null && site.deploy_path !== undefined
      ? String(site.deploy_path).trim().replace(/^\/+|\/+$/g, '')
      : 'neogram';

    const branchRefRes = await githubFetch(`/repos/${owner}/${repo}/git/ref/heads/${branch}`, token);
    if (!branchRefRes.ok || !branchRefRes.data?.object?.sha) return 0;

    const parentCommitSha = branchRefRes.data.object.sha;
    const parentCommitRes = await githubFetch(`/repos/${owner}/${repo}/git/commits/${parentCommitSha}`, token);
    if (!parentCommitRes.ok || !parentCommitRes.data?.tree?.sha) return 0;

    const baseTreeSha = parentCommitRes.data.tree.sha;
    const treeListRes = await githubFetch(`/repos/${owner}/${repo}/git/trees/${baseTreeSha}?recursive=1`, token);
    if (!treeListRes.ok || !Array.isArray(treeListRes.data?.tree)) return 0;

    const photosPrefix = cleanPrefix ? `${cleanPrefix}/photos/` : 'photos/';
    const uploadsPrefix = cleanPrefix ? `${cleanPrefix}/uploads/` : 'uploads/';

    const toDelete = treeListRes.data.tree.filter((item: any) =>
      item.type === 'blob' &&
      typeof item.path === 'string' &&
      (item.path.startsWith(photosPrefix) || item.path.startsWith(uploadsPrefix))
    );

    if (toDelete.length === 0) return 0;

    const treeEntries = toDelete.map((item: any) => ({
      path: item.path,
      mode: '100644',
      type: 'blob',
      sha: null as any,
    }));

    const treeRes = await githubFetch(`/repos/${owner}/${repo}/git/trees`, token, {
      method: 'POST',
      body: JSON.stringify({
        base_tree: baseTreeSha,
        tree: treeEntries,
      }),
    });
    if (!treeRes.ok || !treeRes.data?.sha) return 0;

    const commitRes = await githubFetch(`/repos/${owner}/${repo}/git/commits`, token, {
      method: 'POST',
      body: JSON.stringify({
        message: `[:> NEOGRAM] Purged ${toDelete.length} QA test photo/upload assets`,
        tree: treeRes.data.sha,
        parents: [parentCommitSha],
      }),
    });
    if (!commitRes.ok || !commitRes.data?.sha) return 0;

    await githubFetch(`/repos/${owner}/${repo}/git/refs/heads/${branch}`, token, {
      method: 'PATCH',
      body: JSON.stringify({
        sha: commitRes.data.sha,
        force: false,
      }),
    });

    console.log(`[:> GITHUB PURGE] Purged ${toDelete.length} remote photo/upload files from ${owner}/${repo}`);
    return toDelete.length;
  } catch (err) {
    console.warn('[:> GITHUB PURGE WARNING] Failed to purge photos from GitHub:', err);
    return 0;
  }
}

/**
 * Triggers deployment if auto_deploy is enabled for site or user.
 */
export async function triggerGitHubAutoDeployIfEnabled(targetId: string): Promise<void> {
  try {
    const siteRes = await query('SELECT auto_deploy FROM sites WHERE id = $1', [targetId]);
    if (siteRes.rows.length > 0 && siteRes.rows[0].auto_deploy) {
      deployToGitHub(targetId, true).catch((err) =>
        console.error(`[:> GITHUB AUTO-DEPLOY] Error deploying site ${targetId}:`, err)
      );
      return;
    }

    const userRes = await query('SELECT auto_deploy FROM users WHERE id = $1', [targetId]);
    if (userRes.rows.length > 0 && userRes.rows[0].auto_deploy) {
      deployToGitHub(targetId, false).catch((err) =>
        console.error(`[:> GITHUB AUTO-DEPLOY] Error deploying user ${targetId}:`, err)
      );
    }
  } catch (err) {
    console.error('[:> GITHUB AUTO-DEPLOY CHECK ERROR]', err);
  }
}
