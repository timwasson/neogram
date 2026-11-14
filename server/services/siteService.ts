import { isSafePublicUrl, normalizePublicSiteUrl, normalizeHttpsResourceUrl } from '../utils/safeFetch';
import path from 'path';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import { query } from '../db';
import { encryptCredentials, decryptCredentials, maskApiKey, NeocitiesCredentials } from '../utils/crypto';
import { getPostCountForSite } from './postStorage';

export interface Site {
  id: string;
  userId: string;
  name: string;
  slug: string;
  siteUrl: string;
  deploymentType: string;
  deployPath: string;
  autoDeploy: boolean;
  buildHtml: boolean;
  customCssUrl: string | null;
  isDefault: boolean;
  lastDeployedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  hasApiKey: boolean;
  maskedApiKey: string;
  siteName: string;
  postCount?: number;
  allowAnonChat?: boolean;
  allowAnonGuestbook?: boolean;
}

export interface CreateSiteInput {
  name: string;
  slug?: string;
  siteUrl?: string;
  deploymentType?: string;
  deployPath?: string;
  apiKey?: string;
  siteName?: string;
  repo?: string;
  branch?: string;
  autoDeploy?: boolean;
  buildHtml?: boolean;
  customCssUrl?: string;
  isDefault?: boolean;
  allowAnonChat?: boolean;
  allowAnonGuestbook?: boolean;
}

export interface UpdateSiteInput {
  name?: string;
  slug?: string;
  siteUrl?: string;
  deploymentType?: string;
  deployPath?: string;
  apiKey?: string;
  siteName?: string;
  repo?: string;
  branch?: string;
  autoDeploy?: boolean;
  buildHtml?: boolean;
  customCssUrl?: string;
  isDefault?: boolean;
  allowAnonChat?: boolean;
  allowAnonGuestbook?: boolean;
}

/**
 * Format a database row into a public Site object with decrypted/masked credentials
 */
function formatSiteRow(row: any): Site {
  const creds = decryptCredentials<NeocitiesCredentials>(row.deployment_credentials);
  const hasApiKey = !!(creds && creds.apiKey);
  const maskedKey = hasApiKey ? maskApiKey(creds!.apiKey) : '';
  const siteName = creds?.siteName || (row.site_url ? row.site_url.replace(/https?:\/\//, '').replace(/\.(neocities|nekoweb)\.org.*$/, '') : '');
  const deployPath = row.deploy_path !== null && row.deploy_path !== undefined ? row.deploy_path : 'neogram';

  return {
    id: row.id,
    userId: row.user_id,
    name: row.name || 'Personal Static Site',
    slug: row.slug || 'default',
    siteUrl: row.site_url || '',
    deploymentType: row.deployment_type || 'neocities',
    deployPath,
    autoDeploy: !!row.auto_deploy,
    buildHtml: row.build_html !== false,
    customCssUrl: row.custom_css_url || null,
    isDefault: !!row.is_default,
    lastDeployedAt: row.last_deployed_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    hasApiKey,
    maskedApiKey: maskedKey,
    siteName,
    postCount: row.post_count !== undefined ? parseInt(row.post_count, 10) : undefined,
    allowAnonChat: row.allow_anon_chat !== false,
    allowAnonGuestbook: row.allow_anon_guestbook !== false,
  };
}

/**
 * Generates a clean URL-safe slug
 */
export function sanitizeSlug(input: string, fallback: string = 'site'): string {
  const clean = input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 30);
  return clean || fallback;
}

/**
 * Retrieve all sites belonging to a user
 */
export async function getUserSites(userId: string): Promise<Site[]> {
  const res = await query(
    `SELECT s.*, 0 as post_count
     FROM sites s
     WHERE s.user_id = $1
     ORDER BY s.is_default DESC, s.created_at ASC`,
    [userId]
  );

  const sites = res.rows.map(formatSiteRow);
  for (const s of sites) {
    s.postCount = await getPostCountForSite(s.id);
  }
  return sites;
}

/**
 * Retrieve single site by ID, optionally validating user ownership
 */
export async function getSiteById(siteId: string, userId?: string): Promise<Site | null> {
  let res;
  if (userId) {
    res = await query(
      `SELECT s.*, 0 as post_count
       FROM sites s
       WHERE s.id = $1 AND s.user_id = $2`,
      [siteId, userId]
    );
  } else {
    res = await query(
      `SELECT s.*, 0 as post_count
       FROM sites s
       WHERE s.id = $1`,
      [siteId]
    );
  }

  if (res.rows.length === 0) return null;
  const site = formatSiteRow(res.rows[0]);
  site.postCount = await getPostCountForSite(site.id);
  return site;
}

/**
 * Retrieve site by slug for a specific user
 */
export async function getSiteBySlug(userId: string, slug: string): Promise<Site | null> {
  const cleanSlug = sanitizeSlug(slug);
  const res = await query(
    `SELECT s.*, 0 as post_count
     FROM sites s
     WHERE s.user_id = $1 AND s.slug = $2`,
    [userId, cleanSlug]
  );
  if (res.rows.length === 0) return null;
  const site = formatSiteRow(res.rows[0]);
  site.postCount = await getPostCountForSite(site.id);
  return site;
}

/**
 * Retrieve the user's default site (returns null if user has no sites mounted)
 */
export async function getDefaultSite(userId: string): Promise<Site | null> {
  const res = await query(
    `SELECT s.*, 0 as post_count
     FROM sites s
     WHERE s.user_id = $1 AND s.is_default = TRUE
     LIMIT 1`,
    [userId]
  );

  if (res.rows.length > 0) {
    const site = formatSiteRow(res.rows[0]);
    site.postCount = await getPostCountForSite(site.id);
    return site;
  }

  // Fallback: Check if user has ANY site
  const anySiteRes = await query(
    `SELECT s.*, 0 as post_count
     FROM sites s
     WHERE s.user_id = $1
     ORDER BY s.created_at ASC
     LIMIT 1`,
    [userId]
  );

  if (anySiteRes.rows.length > 0) {
    // Mark this first site as default
    await query('UPDATE sites SET is_default = TRUE WHERE id = $1', [anySiteRes.rows[0].id]);
    anySiteRes.rows[0].is_default = true;
    const site = formatSiteRow(anySiteRes.rows[0]);
    site.postCount = await getPostCountForSite(site.id);
    return site;
  }

  return null;
}

/**
 * Return the user's default site. For legacy accounts that configured a host on
 * the users table before multi-site existed, a site row is provisioned from that
 * config. Users who never connected a site get null; we never invent a URL.
 */
export async function ensureDefaultSite(userId: string): Promise<Site | null> {
  const existing = await getDefaultSite(userId);
  if (existing) return existing;

  // Auto-provision a default site from the users table
  const userRes = await query(
    'SELECT id, handle, email, site_url, deploy_path, deployment_type, deployment_credentials, auto_deploy, build_html, custom_css_url, last_deployed_at FROM users WHERE id = $1',
    [userId]
  );

  if (userRes.rows.length === 0) {
    throw new Error('User node not found in network registry.');
  }

  const u = userRes.rows[0];
  if (!u.site_url) return null;
  const userHandle = u.handle || 'user';
  const siteName = `@${userHandle}'s site`;
  const defaultUrl = u.site_url;

  const insertRes = await query(
    `INSERT INTO sites (
       user_id, name, slug, site_url, deployment_type, deployment_credentials,
       deploy_path, auto_deploy, build_html, custom_css_url, is_default, last_deployed_at
     )
     VALUES ($1, $2, 'default', $3, $4, $5, $6, $7, $8, $9, TRUE, $10)
     RETURNING *`,
    [
      u.id,
      siteName,
      defaultUrl,
      u.deployment_type || 'neocities',
      u.deployment_credentials,
      u.deploy_path || 'neogram',
      u.auto_deploy || false,
      u.build_html !== false,
      u.custom_css_url || null,
      u.last_deployed_at || null,
    ]
  );

  const newSite = insertRes.rows[0];

  // Backfill any orphaned counters or guestbooks for this user
  await query('UPDATE web_counters SET site_id = $1 WHERE user_id = $2 AND site_id IS NULL', [newSite.id, userId]).catch(() => {});
  await query('UPDATE guestbook_entries SET site_id = $1 WHERE user_id = $2 AND site_id IS NULL', [newSite.id, userId]).catch(() => {});

  return formatSiteRow(newSite);
}

/**
 * Create a new site for authenticated user
 */
export async function createSite(userId: string, input: CreateSiteInput): Promise<Site> {
  const userRes = await query('SELECT id, handle, email FROM users WHERE id = $1', [userId]);
  if (userRes.rows.length === 0) {
    throw new Error('User node not found.');
  }
  const user = userRes.rows[0];
  const handle = user.handle || user.email.split('@')[0] || 'user';

  const name = (input.name && input.name.trim()) ? input.name.trim().slice(0, 100) : 'Personal Site';
  let slug = input.slug ? sanitizeSlug(input.slug) : sanitizeSlug(name);
  if (!slug) slug = 'site-' + Math.floor(100 + Math.random() * 900);

  // Check slug uniqueness for this user
  const dup = await query('SELECT id FROM sites WHERE user_id = $1 AND slug = $2', [userId, slug]);
  if (dup.rows.length > 0) {
    slug = `${slug}-${Math.floor(100 + Math.random() * 900)}`;
  }

  const deploymentType = input.deploymentType || 'neocities';
  const defaultBaseDomain = deploymentType === 'nekoweb' ? 'nekoweb.org' : (deploymentType === 'github' ? 'github.io' : 'neocities.org');
  let siteUrl = input.siteUrl && input.siteUrl.trim() ? input.siteUrl.trim() : `https://${handle}.${defaultBaseDomain}`;
  if (!/^https?:\/\//i.test(siteUrl)) {
    siteUrl = `https://${siteUrl}`;
  }
  if (!isSafePublicUrl(siteUrl)) {
    throw new Error('Site URL must be a public https:// address (private/internal hosts are not allowed).');
  }
  siteUrl = normalizePublicSiteUrl(siteUrl).slice(0, 500);

  const deployPath = input.deployPath !== undefined ? sanitizeSlug(input.deployPath, '') : 'neogram';
  const autoDeploy = !!input.autoDeploy;
  const buildHtml = input.buildHtml !== false;
  const customCssUrl = input.customCssUrl ? normalizeHttpsResourceUrl(input.customCssUrl) : null;
  if (input.customCssUrl && !customCssUrl) {
    throw new Error('Custom CSS URL must be a valid https:// address.');
  }

  // Check if user has any existing sites to determine isDefault
  const countRes = await query('SELECT COUNT(*) as count FROM sites WHERE user_id = $1', [userId]);
  const hasExistingSites = parseInt(countRes.rows[0].count, 10) > 0;
  const isDefault = !hasExistingSites || !!input.isDefault;

  // If new site is default, unset existing default
  if (isDefault) {
    await query('UPDATE sites SET is_default = FALSE WHERE user_id = $1', [userId]);
  }

  // Encrypt credentials if apiKey provided
  let encryptedCreds: Buffer | null = null;
  if (input.apiKey && input.apiKey.trim()) {
    let resolvedSiteName = input.siteName || (input.siteUrl ? input.siteUrl.replace(/https?:\/\//, '').replace(/\.(neocities|nekoweb)\.org.*$/, '') : handle);
    let resolvedRepo = input.repo || input.siteName;

    if (deploymentType === 'github') {
      const { parseRepoString } = await import('./githubPublisher');
      const parsed = parseRepoString(input.repo || input.siteName || input.siteUrl || handle, handle);
      resolvedRepo = parsed.repo ? `${parsed.owner}/${parsed.repo}` : `${handle}/${slug}`;
      resolvedSiteName = resolvedRepo;
    }

    const creds: any = {
      apiKey: input.apiKey.trim(),
      siteName: resolvedSiteName,
      repo: resolvedRepo,
      branch: input.branch || 'gh-pages',
    };
    encryptedCreds = encryptCredentials(creds);
  }

  const insertRes = await query(
    `INSERT INTO sites (
       user_id, name, slug, site_url, deployment_type, deployment_credentials,
       deploy_path, auto_deploy, build_html, custom_css_url, is_default
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING *`,
    [
      userId,
      name,
      slug,
      siteUrl,
      deploymentType,
      encryptedCreds,
      deployPath,
      autoDeploy,
      buildHtml,
      customCssUrl,
      isDefault,
    ]
  );

  const newSite = formatSiteRow(insertRes.rows[0]);

  if (isDefault) {
    await query(
      `UPDATE users SET site_url = $1, deploy_path = $2, deployment_type = $3 WHERE id = $4`,
      [newSite.siteUrl, newSite.deployPath, newSite.deploymentType, userId]
    );
  }

  // Trigger background 11ty static compilation for this new site
  import('./staticBuilder')
    .then((m) => m.buildStaticGallery({ siteId: newSite.id }))
    .catch((err) => console.error('[:> 11ty] Initial site build error:', err));

  return newSite;
}

/**
 * Update an existing site
 */
export async function updateSite(siteId: string, userId: string, input: UpdateSiteInput): Promise<Site> {
  const existingRes = await query(
    'SELECT * FROM sites WHERE id = $1 AND user_id = $2',
    [siteId, userId]
  );

  if (existingRes.rows.length === 0) {
    throw new Error('Site target not found or access denied.');
  }

  const existing = existingRes.rows[0];

  const name = input.name !== undefined ? (input.name.trim().slice(0, 100) || existing.name) : existing.name;
  let slug = existing.slug;
  if (input.slug !== undefined && input.slug.trim()) {
    const clean = sanitizeSlug(input.slug);
    // Check uniqueness across other sites of this user
    const dup = await query('SELECT id FROM sites WHERE user_id = $1 AND slug = $2 AND id != $3', [userId, clean, siteId]);
    if (dup.rows.length > 0) {
      throw new Error(`Site slug "${clean}" is already in use by another of your sites.`);
    }
    slug = clean;
  }

  let siteUrl = existing.site_url;
  if (input.siteUrl !== undefined && input.siteUrl.trim()) {
    siteUrl = input.siteUrl.trim();
    if (!/^https?:\/\//i.test(siteUrl)) {
      siteUrl = `https://${siteUrl}`;
    }
    if (!isSafePublicUrl(siteUrl)) {
      throw new Error('Site URL must be a public https:// address (private/internal hosts are not allowed).');
    }
    siteUrl = normalizePublicSiteUrl(siteUrl).slice(0, 500);
  }

  const deploymentType = input.deploymentType !== undefined ? input.deploymentType : existing.deployment_type;
  const deployPath = input.deployPath !== undefined ? sanitizeSlug(input.deployPath, '') : existing.deploy_path;
  const autoDeploy = input.autoDeploy !== undefined ? !!input.autoDeploy : !!existing.auto_deploy;
  const buildHtml = input.buildHtml !== undefined ? !!input.buildHtml : (existing.build_html !== false);
  const customCssUrl = input.customCssUrl !== undefined ? (input.customCssUrl ? normalizeHttpsResourceUrl(input.customCssUrl) : null) : existing.custom_css_url;
  if (input.customCssUrl && !customCssUrl) {
    throw new Error('Custom CSS URL must be a valid https:// address.');
  }

  // Handle credentials
  let encryptedCreds = existing.deployment_credentials;
  let creds: any = decryptCredentials<any>(existing.deployment_credentials) || { apiKey: '' };

  let credsChanged = false;
  if (input.apiKey && typeof input.apiKey === 'string' && !input.apiKey.startsWith('••••') && input.apiKey.trim().length > 0) {
    creds.apiKey = input.apiKey.trim();
    credsChanged = true;
  }
  if (input.siteName) {
    creds.siteName = input.siteName.trim();
    credsChanged = true;
  }
  if (input.repo) {
    creds.repo = input.repo.trim();
    credsChanged = true;
  }
  if (input.branch) {
    creds.branch = input.branch.trim();
    credsChanged = true;
  }

  if (deploymentType === 'github' && (creds.repo || creds.siteName)) {
    const { parseRepoString } = await import('./githubPublisher');
    const parsed = parseRepoString(creds.repo || creds.siteName, existing.handle || 'user');
    if (parsed.repo) {
      const canonicalRepo = parsed.owner ? `${parsed.owner}/${parsed.repo}` : parsed.repo;
      if (creds.repo !== canonicalRepo || creds.siteName !== canonicalRepo) {
        creds.repo = canonicalRepo;
        creds.siteName = canonicalRepo;
        credsChanged = true;
      }
    }
  }

  if (credsChanged) {
    encryptedCreds = encryptCredentials(creds);
  }

  let isDefault = !!existing.is_default;
  if (input.isDefault === true && !existing.is_default) {
    // Unset other defaults
    await query('UPDATE sites SET is_default = FALSE WHERE user_id = $1', [userId]);
    isDefault = true;
  }

  const updateRes = await query(
    `UPDATE sites
     SET name = $1,
         slug = $2,
         site_url = $3,
         deployment_type = $4,
         deployment_credentials = $5,
         deploy_path = $6,
         auto_deploy = $7,
         build_html = $8,
         custom_css_url = $9,
         is_default = $10,
         updated_at = NOW()
     WHERE id = $11
     RETURNING *`,
    [
      name,
      slug,
      siteUrl,
      deploymentType,
      encryptedCreds,
      deployPath,
      autoDeploy,
      buildHtml,
      customCssUrl,
      isDefault,
      siteId,
    ]
  );

  const updatedSite = formatSiteRow(updateRes.rows[0]);

  if (isDefault) {
    await query(
      `UPDATE users SET site_url = $1, deploy_path = $2, deployment_type = $3 WHERE id = $4`,
      [updatedSite.siteUrl, updatedSite.deployPath, updatedSite.deploymentType, userId]
    );
  }

  // Trigger background static rebuild
  import('./staticBuilder')
    .then((m) => m.buildStaticGallery({ siteId }))
    .catch((err) => console.error('[:> 11ty] Site update rebuild error:', err));

  return updatedSite;
}

/**
 * Delete a site target
 */
export async function deleteSite(siteId: string, userId: string): Promise<{ ok: boolean; message: string }> {
  // Check ownership
  const siteRes = await query('SELECT * FROM sites WHERE id = $1 AND user_id = $2', [siteId, userId]);
  if (siteRes.rows.length === 0) {
    throw new Error('Site target not found or access denied.');
  }

  const site = siteRes.rows[0];

  // If this site was default, promote another site to default (if another exists)
  if (site.is_default) {
    await query(
      `UPDATE sites 
       SET is_default = TRUE 
       WHERE id = (SELECT id FROM sites WHERE user_id = $1 AND id != $2 ORDER BY created_at ASC LIMIT 1)`,
      [userId, siteId]
    );
  }

  // Delete site from database (CASCADE deletes associated counters, guestbooks)
  await query('DELETE FROM sites WHERE id = $1', [siteId]);

  // Clean up static build directory and purge site posts from static storage
  try {
    const { deletePostsForSite } = await import('./postStorage');
    await deletePostsForSite(siteId);
  } catch (_e) {}

  return { ok: true, message: `Site "${site.name}" unmounted and deleted successfully.` };
}
