import { query } from '../db';
import { readRemoteJson, writeRemoteJson, getDeployPathPrefix } from './staticStorage';
import { getSiteById, getDefaultSite } from './siteService';

export interface FeedPost {
  id: string;
  siteId?: string;
  siteName?: string;
  siteSlug?: string;
  imageUrl: string;
  thumbnailUrl: string;
  caption: string;
  filter: string;
  mood?: string | null;
  webring?: string | null;
  location?: string | null;
  likes: number;
  createdAt: string;
  commentsCount?: number;
  comments?: any[];
  commentsUrl?: string;
  actions?: {
    likeUrl?: string;
    commentUrl?: string;
  };
}

export interface UserFeedPayload {
  version: string;
  generatedAt: string;
  user: {
    id: string;
    uin: number;
    handle: string;
    author: string;
    avatarUrl?: string;
    siteUrl?: string;
    deployPath?: string;
    fullSiteUrl?: string;
    statusMessage?: string;
    customCssUrl?: string;
  };
  endpoints: {
    apiUrl: string;
    followUrl: string;
    unfollowUrl: string;
    guestbookUrl: string;
    counterUrl: string;
    feedUrl: string;
  };
  posts: FeedPost[];
}

export interface FriendFeedPost extends FeedPost {
  author: string;
  authorHandle: string;
  authorUin?: number;
  authorAvatar?: string;
  authorSiteUrl?: string;
  profileUrl?: string;
}

export interface FriendTarget {
  id: string;
  handle: string;
  uin?: number;
  avatarPath?: string;
  siteUrl?: string;
  deployPath?: string;
}

/**
 * Resolves the canonical public feed.json URL for a given station user/site.
 */
export function resolveFeedUrl(friend: FriendTarget): string {
  let base = (friend.siteUrl || '').replace(/\/+$/, '');
  if (!base) {
    base = `https://${friend.handle}.neocities.org`;
  }
  const deploy = (friend.deployPath || 'neogram').trim().replace(/^\/+|\/+$/g, '');
  return deploy ? `${base}/${deploy}/feed.json` : `${base}/feed.json`;
}

/**
 * Fetches a single friend's public feed.json directly from their static host
 * with a strict 3.5s timeout. Returns empty array on timeout/failure.
 */
export async function fetchRemoteFriendFeed(friend: FriendTarget): Promise<FriendFeedPost[]> {
  const feedUrl = resolveFeedUrl(friend);
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3500);

    const res = await fetch(feedUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Cache-Control': 'no-cache',
      },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      return [];
    }

    const data = (await res.json()) as UserFeedPayload;
    if (!data || !Array.isArray(data.posts)) {
      return [];
    }

    const author = data.user?.handle || friend.handle;
    const authorUin = data.user?.uin || friend.uin;
    const authorAvatar = data.user?.avatarUrl || friend.avatarPath;
    const authorSiteUrl = data.user?.fullSiteUrl || friend.siteUrl;

    return data.posts.map((p) => ({
      ...p,
      author,
      authorHandle: author,
      authorUin,
      authorAvatar,
      authorSiteUrl,
      profileUrl: `/user/@${author}`,
    }));
  } catch (_err) {
    return [];
  }
}

/**
 * Federated Friends Aggregator:
 * 1. Takes a list of followed friend stations (from `follows` table).
 * 2. Fetches their remote `feed.json` static files in parallel via Promise.allSettled.
 * 3. Entwines and merges all posts into a unified reverse-chronological stream.
 * 4. Fallback: If remote fetch fails or in dev/sandbox, falls back to local database entries.
 */
export async function aggregateFederatedFriendsFeed(
  friends: FriendTarget[],
  limit: number = 100
): Promise<FriendFeedPost[]> {
  if (!friends || friends.length === 0) {
    return [];
  }

  // 1. Parallel fetch of all friends' static JSON feeds over WAN
  const results = await Promise.allSettled(
    friends.map((friend) => fetchRemoteFriendFeed(friend))
  );

  const federatedPosts: FriendFeedPost[] = [];
  let successfulFeeds = 0;

  for (const r of results) {
    if (r.status === 'fulfilled' && r.value.length > 0) {
      federatedPosts.push(...r.value);
      successfulFeeds++;
    }
  }

  // 2. Fallback to database if remote feeds are unreachable or in test environment
  if (federatedPosts.length === 0) {
    const friendIds = friends.map((f) => f.id);
    const dbFallback = await query(
      `
      SELECT 
        p.id,
        p.user_id as "userId",
        p.image_path as "imageUrl",
        p.thumbnail_path as "thumbnailUrl",
        p.caption,
        p.filter_applied as "filter",
        p.mood,
        p.webring,
        p.location,
        p.likes_count as "likes",
        p.created_at as "createdAt",
        u.handle as "author",
        u.handle as "authorHandle",
        u.uin as "authorUin",
        u.avatar_path as "authorAvatar",
        u.site_url as "authorSiteUrl",
        '/user/@' || COALESCE(u.handle, split_part(u.email, '@', 1)) as "profileUrl"
      FROM posts p
      JOIN users u ON p.user_id = u.id
      WHERE p.user_id = ANY($1::UUID[])
      ORDER BY p.created_at DESC
      LIMIT $2
    `,
      [friendIds, limit]
    );

    return dbFallback.rows.map((row) => ({
      ...row,
      likes: parseInt(row.likes, 10) || 0,
      createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
    }));
  }

  // 3. Sort merged posts reverse-chronologically by timestamp
  federatedPosts.sort((a, b) => {
    const timeA = new Date(a.createdAt).getTime();
    const timeB = new Date(b.createdAt).getTime();
    return timeB - timeA;
  });

  return federatedPosts.slice(0, limit);
}
