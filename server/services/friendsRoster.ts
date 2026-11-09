import { query } from '../db';
import { activeSockets } from './chatSocket';
import { getPostCountForUser } from './postStorage';

export interface RosterFriend {
  id: string;
  email: string;
  handle: string;
  uin: number;
  avatarPath: string;
  statusMessage: string;
  isAway: boolean;
  siteUrl: string | null;
  deployPath: string | null;
  lastDeployedAt: Date | null;
  siteId: string | null;
  friendedAt: Date;
  status: 'active' | 'away' | 'inactive' | string;
  postCount: number;
  profileUrl: string;
  cleanRootSiteUrl: string;
  [key: string]: any;
}

/** Strips any deploy sub-path, keeping only http(s)://host of a station URL. */
export function cleanRootUrl(raw: string | null | undefined): string {
  if (!raw || !raw.trim()) return '';
  try {
    const parsed = new URL(raw);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return `${parsed.protocol}//${parsed.host}`;
    }
  } catch {
    // fall through
  }
  return '';
}

/**
 * Single source of truth for the "friends roster" used by the dashboard (`/`) and `/friends`.
 * (Previously this SQL + presence-resolution logic was duplicated in two route handlers.)
 * Banned stations are excluded. Presence is resolved from live sockets, then the persisted away flag.
 */
export async function getFriendsRoster(userId: string, opts: { withPostCounts?: boolean } = {}): Promise<RosterFriend[]> {
  const friendsRes = await query(
    `SELECT
       u.id,
       u.email,
       COALESCE(u.handle, split_part(u.email, '@', 1)) as handle,
       u.uin,
       u.avatar_path as "avatarPath",
       u.status_message as "statusMessage",
       u.is_away as "isAway",
       COALESCE(s.site_url, u.site_url) as "siteUrl",
       COALESCE(s.deploy_path, u.deploy_path) as "deployPath",
       COALESCE(s.last_deployed_at, u.last_deployed_at) as "lastDeployedAt",
       s.id as "siteId",
       f.created_at as "friendedAt"
     FROM follows f
     JOIN users u ON f.following_id = u.id
     LEFT JOIN sites s ON s.user_id = u.id AND s.is_default = TRUE
     WHERE f.follower_id = $1 AND COALESCE(u.is_banned, false) = false
     ORDER BY LOWER(COALESCE(u.handle, split_part(u.email, '@', 1))) ASC`,
    [userId]
  );

  return Promise.all(
    friendsRes.rows.map(async (r: any) => {
      let siteUrl = r.siteUrl;
      let deployPath = r.deployPath;
      let siteId = r.siteId;
      let lastDeployedAt = r.lastDeployedAt;

      // If default site wasn't matched or has an invalid neocities guess with underscores, find user's primary configured site
      const hasInvalidNeocitiesSubdomain = siteUrl && siteUrl.includes('.neocities.org') && siteUrl.replace(/^https?:\/\//, '').split('.neocities.org')[0].includes('_');
      if (!siteUrl || hasInvalidNeocitiesSubdomain) {
        try {
          const fallbackSite = await query(
            'SELECT id, site_url, deploy_path, last_deployed_at FROM sites WHERE user_id = $1 ORDER BY is_default DESC, last_deployed_at DESC NULLS LAST, created_at ASC LIMIT 1',
            [r.id]
          );
          if (fallbackSite.rows.length > 0 && fallbackSite.rows[0].site_url) {
            siteId = fallbackSite.rows[0].id;
            siteUrl = fallbackSite.rows[0].site_url;
            deployPath = fallbackSite.rows[0].deploy_path || 'neogram';
            lastDeployedAt = fallbackSite.rows[0].last_deployed_at;
          }
        } catch (_e) {}
      }

      const active = activeSockets.get(r.id);
      let status: string = 'inactive';
      let statusMessage: string = r.statusMessage || 'Surfing cyberspace';
      if (active) {
        status = active.status;
        if (active.awayMessage) statusMessage = active.awayMessage;
      } else if (r.isAway) {
        status = 'away';
      }

      return {
        ...r,
        siteUrl,
        deployPath,
        siteId,
        lastDeployedAt,
        status,
        statusMessage,
        postCount: opts.withPostCounts ? await getPostCountForUser(r.id) : 0,
        avatarPath: r.avatarPath && r.avatarPath.trim() ? r.avatarPath : '/icons/default-avatar.svg',
        profileUrl: `/user/@${encodeURIComponent(r.handle)}`,
        cleanRootSiteUrl: cleanRootUrl(siteUrl),
      } as RosterFriend;
    })
  );
}
