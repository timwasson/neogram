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
 * Wipe safety policy. The local cache is the only copy of comments/likes Neogram holds, so a wipe
 * must reflect a deliberate remote deletion, not a hiccup:
 *  - a single 404 is never enough: it must be seen again at least CONFIRM_DELAY_MS later (and within
 *    CONFIRM_WINDOW_MS); any successful fetch in between cancels the pending wipe
 *  - never within DEPLOY_GRACE_MS of a deploy (hosts like GitHub Pages take minutes to publish)
 *  - a 200 with an unparseable body (maintenance / CDN error pages) never wipes
 *  - only the site whose feed.json was checked is reset, never the user's other sites
 * Callers must be the station owner (never anonymous profile views).
 */
const CONFIRM_DELAY_MS = 10 * 60 * 1000;
const CONFIRM_WINDOW_MS = 24 * 60 * 60 * 1000;
const DEPLOY_GRACE_MS = 30 * 60 * 1000;
const first404At = new Map<string, number>();

// Injectable clock (tests advance it without faking the global Date.now, which Node internals use)
let clock: () => number = () => Date.now();
export function __setStationSyncClockForTests(fn: (() => number) | null): void {
  clock = fn || (() => Date.now());
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
  if (
    (user.email && user.email.toLowerCase().endsWith('@qa.neogram.club')) ||
    (user.handle && user.handle.toLowerCase().startsWith('qa_'))
  ) {
    return { checked: false, wiped: false, reason: 'QA accounts are immune to automated wipe' };
  }

  // If station is in sandbox mode (never deployed to an external static host), skip
  if (!user.deploymentType || user.deploymentType === 'none' || !user.lastDeployedAt) {
    return { checked: false, wiped: false, reason: 'No active deployment on external host' };
  }

  const deployedAt = new Date(user.lastDeployedAt).getTime();
  if (Number.isFinite(deployedAt) && clock() - deployedAt < DEPLOY_GRACE_MS) {
    return { checked: false, wiped: false, reason: 'Recently deployed: remote host may still be publishing' };
  }

  const pendingKey = user.siteId || userId;
  const rawFeedUrl = resolveFeedUrl(user);
  const feedUrl = `${rawFeedUrl}${rawFeedUrl.includes('?') ? '&' : '?'}t=${Date.now()}`;

  try {
    const res = await safeGet(feedUrl, { timeoutMs: 3500, headers: { 'Cache-Control': 'no-cache' } });

    // If HTTP 404: Station was wiped remotely via FTP!
    if (res.status === 404) {
      const now = clock();
      const firstSeen = first404At.get(pendingKey);
      if (!firstSeen || now - firstSeen > CONFIRM_WINDOW_MS) {
        first404At.set(pendingKey, now);
        return { checked: true, wiped: false, reason: 'Remote feed.json returned HTTP 404 once; wipe pending confirmation.' };
      }
      if (now - firstSeen < CONFIRM_DELAY_MS) {
        return { checked: true, wiped: false, reason: 'Remote feed.json still 404; waiting for the confirmation interval.' };
      }
      first404At.delete(pendingKey);
      console.log(`[:> STATION SYNC] Remote feed.json missing (HTTP 404, confirmed) at ${rawFeedUrl}. Purging local cache for site ${pendingKey}...`);
      await wipeStationData(userId, user.siteId || null);
      return {
        checked: true,
        wiped: true,
        reason: 'Remote feed.json returned HTTP 404 (confirmed). Station wiped on remote host and reset to clean slate.',
      };
    }

    if (res.ok) {
      first404At.delete(pendingKey);
      try {
        const data = res.json();
        if (!data || typeof data !== 'object') {
          throw new Error('Invalid JSON structure');
        }
        return { checked: true, wiped: false };
      } catch (_parseErr) {
        // A 200 with a broken body is far more likely a maintenance/CDN page than a deliberate wipe
        console.warn(`[:> STATION SYNC] Remote feed.json at ${rawFeedUrl} is unparseable; leaving local cache untouched.`);
        return { checked: true, wiped: false, reason: 'Remote feed.json was unparseable; no action taken.' };
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
export async function wipeStationData(userId: string, siteId: string | null = null): Promise<void> {
  // Never wipe QA fleet test accounts
  const checkUser = await query('SELECT email FROM users WHERE id = $1', [userId]);
  if (checkUser.rows[0]?.email?.toLowerCase().endsWith('@qa.neogram.club')) {
    console.log(`[:> STATION SYNC] Refusing to wipe QA account ${checkUser.rows[0].email}`);
    return;
  }

  // Scoped wipe: only the site whose remote feed is gone
  if (siteId) {
    const owned = await query('SELECT id, is_default FROM sites WHERE id = $1 AND user_id = $2', [siteId, userId]);
    if (owned.rows.length === 0) return;
    await query('UPDATE sites SET last_deployed_at = NULL WHERE id = $1 AND user_id = $2', [siteId, userId]);
    if (owned.rows[0].is_default) {
      // The default site's posts may also live in the legacy per-user cache dir
      await query('UPDATE users SET last_deployed_at = NULL WHERE id = $1', [userId]);
      await fs.rm(path.join(process.cwd(), 'dist/static-galleries', userId), { recursive: true, force: true }).catch(() => {});
    }
    await fs.rm(path.join(process.cwd(), 'dist/static-galleries', siteId), { recursive: true, force: true }).catch(() => {});
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

