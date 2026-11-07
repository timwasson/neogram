import { safeGet } from '../utils/safeFetch';
import path from 'path';
import fs from 'fs/promises';
import { query } from '../db';
import { resolveFeedUrl } from './federatedFriends';

export interface StationSyncResult {
  checked: boolean;
  wiped: boolean;
  reason?: string;
}

/**
 * Checks if the remote station feed.json on Neocities/Nekoweb is missing or corrupt.
 * The remote feed.json is the single source of truth:
 * If the user has deployed before and feed.json returns 404, the site was wiped via FTP.
 * Neogram purges any local post records and resets the station to a clean slate.
 */
export async function checkAndSyncStationFeed(userId: string): Promise<StationSyncResult> {
  const userRes = await query(
    `SELECT u.id, u.handle, u.email,
            COALESCE(s.site_url, u.site_url) as "siteUrl",
            COALESCE(s.deploy_path, u.deploy_path) as "deployPath",
            COALESCE(s.deployment_type, u.deployment_type) as "deploymentType",
            COALESCE(s.last_deployed_at, u.last_deployed_at) as "lastDeployedAt",
            s.id as "siteId"
     FROM users u
     LEFT JOIN sites s ON s.user_id = u.id AND s.is_default = TRUE
     WHERE u.id = $1`,
    [userId]
  );

  if (userRes.rows.length === 0) {
    return { checked: false, wiped: false, reason: 'User not found' };
  }

  const user = userRes.rows[0];

  // QA accounts are strictly immune to automated station wiping
  if (user.email && user.email.toLowerCase().endsWith('@qa.neogram.club')) {
    return { checked: false, wiped: false, reason: 'QA accounts are immune to automated wipe' };
  }

  // If station is in sandbox mode (never deployed to an external static host), skip
  if (!user.deploymentType || user.deploymentType === 'none' || !user.lastDeployedAt) {
    return { checked: false, wiped: false, reason: 'No active deployment on external host' };
  }

  const feedUrl = resolveFeedUrl(user);

  try {
    const res = await safeGet(feedUrl, { timeoutMs: 3500, headers: { 'Cache-Control': 'no-cache' } });

    // If HTTP 404: Station was wiped remotely via FTP!
    if (res.status === 404) {
      console.log(`[:> STATION SYNC] Remote feed.json missing (HTTP 404) at ${feedUrl}. Station wiped via FTP; purging local post cache...`);
      await wipeStationData(userId);
      return {
        checked: true,
        wiped: true,
        reason: 'Remote feed.json returned HTTP 404. Station wiped on remote host and reset to clean slate.',
      };
    }

    if (res.ok) {
      try {
        const data = res.json();
        if (!data || typeof data !== 'object') {
          throw new Error('Invalid JSON structure');
        }
        // Hydrate local post storage from remote live feed.json
        if (Array.isArray(data.posts) && data.posts.length > 0) {
          const { savePost } = await import('./postStorage');
          for (const post of data.posts) {
            const rawPhotos = post.photos || [{
              imagePath: post.imagePath || post.imageUrl,
              thumbnailPath: post.thumbnailPath || post.thumbnailUrl || post.imagePath || post.imageUrl,
            }];
            // SECURITY: ownership comes from the local station record, never from remote JSON.
            if (typeof post.id !== 'string' || !/^[0-9a-zA-Z_-]{1,64}$/.test(post.id)) continue;
            await savePost({
              id: post.id,
              userId,
              siteId: user.siteId,
              siteName: post.siteName,
              siteSlug: post.siteSlug,
              imagePath: post.imagePath || post.imageUrl,
              thumbnailPath: post.thumbnailPath || post.thumbnailUrl || post.imagePath || post.imageUrl,
              imageUrl: post.imageUrl || post.imagePath,
              thumbnailUrl: post.thumbnailUrl || post.thumbnailPath,
              photos: rawPhotos,
              caption: post.caption || '',
              filterApplied: post.filterApplied || post.filter || 'none',
              mood: post.mood ?? null,
              webring: post.webring ?? null,
              location: post.location ?? null,
              likes: post.likes || 0,
              createdAt: post.createdAt,
              comments: post.comments || [],
              commentsCount: post.commentsCount ?? (post.comments || []).length,
              commentsUrl: post.commentsUrl,
              actions: post.actions,
            });
          }
        }
        return { checked: true, wiped: false };
      } catch (_parseErr) {
        console.warn(`[:> STATION SYNC] Remote feed.json at ${feedUrl} is corrupt/unparseable. Purging local post cache to start clean...`);
        await wipeStationData(userId);
        return {
          checked: true,
          wiped: true,
          reason: 'Remote feed.json was corrupt or unparseable. Station reset to start from scratch.',
        };
      }
    }

    return { checked: true, wiped: false, reason: `HTTP status ${res.status}` };
  } catch (err: any) {
    // Network timeout or unreachable; do not wipe if it could just be a temporary network hiccup
    return { checked: false, wiped: false, reason: err.message };
  }
}

/**
 * Clears all local post records, resets deployment timestamps, and cleans up local static build files.
 */
export async function wipeStationData(userId: string): Promise<void> {
  // Never wipe QA fleet test accounts
  const checkUser = await query('SELECT email FROM users WHERE id = $1', [userId]);
  if (checkUser.rows[0]?.email?.toLowerCase().endsWith('@qa.neogram.club')) {
    console.log(`[:> STATION SYNC] Refusing to wipe QA account ${checkUser.rows[0].email}`);
    return;
  }

  // 1. Reset deployment tracking
  await query('UPDATE users SET last_deployed_at = NULL WHERE id = $1', [userId]);
  await query('UPDATE sites SET last_deployed_at = NULL WHERE user_id = $1', [userId]);

  // 3. Remove local static gallery files
  try {
    const userDir = path.join(process.cwd(), 'dist/static-galleries', userId);
    await fs.rm(userDir, { recursive: true, force: true });
  } catch (_e) {}

  try {
    const sitesRes = await query('SELECT id FROM sites WHERE user_id = $1', [userId]);
    for (const siteRow of sitesRes.rows) {
      const siteDir = path.join(process.cwd(), 'dist/static-galleries', siteRow.id);
      await fs.rm(siteDir, { recursive: true, force: true });
    }
  } catch (_e) {}
}

