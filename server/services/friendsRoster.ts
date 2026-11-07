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
        status,
        statusMessage,
        postCount: opts.withPostCounts ? await getPostCountForUser(r.id) : 0,
        avatarPath: r.avatarPath && r.avatarPath.trim() ? r.avatarPath : '/icons/default-avatar.svg',
        profileUrl: `/user/@${encodeURIComponent(r.handle)}`,
        cleanRootSiteUrl: cleanRootUrl(r.siteUrl),
      } as RosterFriend;
    })
  );
}
