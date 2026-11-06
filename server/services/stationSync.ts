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
    `SELECT id, handle, email, site_url as "siteUrl", deploy_path as "deployPath",
            deployment_type as "deploymentType", last_deployed_at as "lastDeployedAt"
     FROM users WHERE id = $1`,
    [userId]
  );

  if (userRes.rows.length === 0) {
    return { checked: false, wiped: false, reason: 'User not found' };
  }

  const user = userRes.rows[0];

  // If station is in sandbox mode (never deployed to an external static host), skip
  if (!user.deploymentType || user.deploymentType === 'none' || !user.lastDeployedAt) {
    return { checked: false, wiped: false, reason: 'No active deployment on external host' };
  }

  const feedUrl = resolveFeedUrl(user);

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3500);

    const res = await fetch(feedUrl, {
      method: 'GET',
      headers: { 'Cache-Control': 'no-cache' },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

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
        const data = await res.json();
        if (!data || typeof data !== 'object') {
          throw new Error('Invalid JSON structure');
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
  // 1. Purge posts from database
  await query('DELETE FROM posts WHERE user_id = $1', [userId]);

  // 2. Reset deployment tracking
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

