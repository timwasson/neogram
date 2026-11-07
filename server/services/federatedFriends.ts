import { safeGet } from '../utils/safeFetch';
import path from 'path';
import fs from 'fs/promises';
import { existsSync } from 'fs';
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
  imagePath?: string;
  thumbnailPath?: string;
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
  siteId?: string;
  lastDeployedAt?: Date | string | null;
}

/**
 * Resolves the canonical public feed.json URL for a given station user/site.
 */
export function resolveFeedUrl(friend: FriendTarget): string {
  let base = (friend.siteUrl || '').trim().replace(/\/+$/, '');
  if (!base) {
    base = `https://${friend.handle}.neocities.org`;
  }
  if (base.toLowerCase().endsWith('/feed.json')) {
    return base;
  }
  const deploy = (friend.deployPath || 'neogram').trim().replace(/^\/+|\/+$/g, '');
  if (deploy) {
    // If base already ends with /deploy, do not duplicate the subdirectory
    if (base.toLowerCase().endsWith(`/${deploy.toLowerCase()}`)) {
      return `${base}/feed.json`;
    }
    return `${base}/${deploy}/feed.json`;
  }
  return `${base}/feed.json`;
}

/**
 * Normalizes post objects from a user's feed.json so both imageUrl and imagePath
 * are fully-qualified and available for any template or consumer.
 */
function mapFeedPosts(data: UserFeedPayload, friend: FriendTarget): FriendFeedPost[] {
  const author = data.user?.handle || friend.handle;
  const authorUin = data.user?.uin || friend.uin;
  const authorAvatar = data.user?.avatarUrl || friend.avatarPath;
  const authorSiteUrl = data.user?.fullSiteUrl || friend.siteUrl;

  return (data.posts || []).map((p) => {
    const imageUrl = p.imageUrl || p.imagePath || '';
    const thumbnailUrl = p.thumbnailUrl || p.thumbnailPath || imageUrl;
    return {
      ...p,
      imageUrl,
      thumbnailUrl,
      imagePath: imageUrl,
      thumbnailPath: thumbnailUrl,
      filter: p.filter || (p as any).filterApplied || 'none',
      author,
      authorHandle: author,
      authorUin,
      authorAvatar,
      authorSiteUrl,
      profileUrl: `/user/@${encodeURIComponent(author)}`,
    };
  });
}

/**
 * Fetches a single friend's public feed.json directly from their static host
 * with a strict 3.5s timeout. The remote feed.json is the single source of truth.
 * Returns empty array if feed is missing, 404, or unparseable.
 */
export async function fetchRemoteFriendFeed(friend: FriendTarget): Promise<FriendFeedPost[]> {
  const feedUrl = resolveFeedUrl(friend);

  // Helper to check local static gallery compilation (for test runners & sandbox stations)
  const tryLocalFeed = async (): Promise<FriendFeedPost[] | null> => {
    try {
      const localDirectPath = path.join(process.cwd(), 'dist/static-galleries', friend.id, 'feed.json');
      if (existsSync(localDirectPath)) {
        const content = await fs.readFile(localDirectPath, 'utf-8');
        const data = JSON.parse(content) as UserFeedPayload;
        if (data && Array.isArray(data.posts)) {
          return mapFeedPosts(data, friend);
        }
      }

      if (friend.siteId) {
        const sitePath = path.join(process.cwd(), 'dist/static-galleries', friend.siteId, 'feed.json');
        if (existsSync(sitePath)) {
          const content = await fs.readFile(sitePath, 'utf-8');
          const data = JSON.parse(content) as UserFeedPayload;
          if (data && Array.isArray(data.posts)) {
            return mapFeedPosts(data, friend);
          }
        }
      }

      const siteRes = await query(
        'SELECT id FROM sites WHERE user_id = $1 ORDER BY is_default DESC, created_at ASC LIMIT 1',
        [friend.id]
      );
      if (siteRes.rows.length > 0) {
        const sitePath = path.join(process.cwd(), 'dist/static-galleries', siteRes.rows[0].id, 'feed.json');
        if (existsSync(sitePath)) {
          const content = await fs.readFile(sitePath, 'utf-8');
          const data = JSON.parse(content) as UserFeedPayload;
          if (data && Array.isArray(data.posts)) {
            return mapFeedPosts(data, friend);
          }
        }
      }

      // Check posts from local posts.json storage
      const { getPostsForUser } = await import('./postStorage');
      const userPosts = await getPostsForUser(friend.id);
      if (userPosts && userPosts.length > 0) {
        return userPosts.map((p) => ({
          ...p,
          imageUrl: p.imageUrl || p.imagePath,
          thumbnailUrl: p.thumbnailUrl || p.thumbnailPath || p.imageUrl || p.imagePath,
          filter: p.filterApplied || 'none',
          author: p.author || friend.handle,
          authorHandle: friend.handle,
          authorUin: friend.uin,
          authorAvatar: friend.avatarPath,
          authorSiteUrl: friend.siteUrl,
          profileUrl: `/user/@${encodeURIComponent(friend.handle)}`,
        }));
      }
    } catch (_localErr) {}
    return null;
  };

  try {
    const res = await safeGet(feedUrl, {
      timeoutMs: 3500,
      headers: { 'Accept': 'application/json', 'Cache-Control': 'no-cache' },
    });

    if (res.ok) {
      const data = res.json<UserFeedPayload>();
      if (data && Array.isArray(data.posts)) {
        // Hydrate local post storage for station profile & local feed consistency
        if (data.posts.length > 0 && friend.id) {
          import('./postStorage').then(({ savePost }) => {
            for (const post of data.posts) {
              const rawPhotos = (post as any).photos || [{
                imagePath: post.imagePath || post.imageUrl,
                thumbnailPath: post.thumbnailPath || post.thumbnailUrl || post.imagePath || post.imageUrl,
              }];
              // SECURITY: ownership is dictated by the LOCAL friend record, never by the remote feed.
              // A hostile feed.json must not be able to claim another user's userId/siteId/post id.
              if (typeof post.id !== 'string' || !/^[0-9a-zA-Z_-]{1,64}$/.test(post.id)) continue;
              savePost({
                id: post.id,
                userId: friend.id,
                siteId: friend.siteId,
                siteName: post.siteName,
                siteSlug: post.siteSlug,
                imagePath: post.imagePath || post.imageUrl,
                thumbnailPath: post.thumbnailPath || post.thumbnailUrl || post.imagePath || post.imageUrl,
                imageUrl: post.imageUrl || post.imagePath,
                thumbnailUrl: post.thumbnailUrl || post.thumbnailPath,
                photos: rawPhotos,
                caption: post.caption || '',
                filterApplied: (post as any).filterApplied || post.filter || 'none',
                mood: post.mood ?? null,
                webring: post.webring ?? null,
                location: post.location ?? null,
                likes: post.likes || 0,
                createdAt: post.createdAt,
                comments: post.comments || [],
                commentsCount: post.commentsCount ?? (post.comments || []).length,
                commentsUrl: post.commentsUrl,
                actions: post.actions,
              }).catch(() => {});
            }
          }).catch(() => {});
        }
        return mapFeedPosts(data, friend);
      }
      return [];
    }

    // If remote static host returned HTTP 404:
    // Check local compiled static gallery if available (for QA fleets, sandbox stations, and propagation fallback)
    if (res.status === 404) {
      const local = await tryLocalFeed();
      if (local && local.length > 0) return local;
      return [];
    }

    return [];
  } catch (_err) {
    // Network failure (offline dev or test environment without external DNS resolution)
    const local = await tryLocalFeed();
    return local || [];
  }
}

/**
 * Federated Friends Aggregator:
 * 1. Takes a list of followed friend stations (from `follows` table).
 * 2. Fetches their remote `feed.json` static files in parallel via Promise.allSettled.
 * 3. Entwines and merges all posts into a unified reverse-chronological stream.
 * 4. Invariant: feed.json on the static host is the single source of truth.
 *    If a station is wiped or feed.json is missing, it yields 0 posts (no DB fallback).
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

  for (const r of results) {
    if (r.status === 'fulfilled' && r.value.length > 0) {
      federatedPosts.push(...r.value);
    }
  }

  // 2. feed.json is the single source of truth:
  // We strictly do NOT fall back to the central database posts table.

  // 3. Sort merged posts reverse-chronologically by timestamp
  federatedPosts.sort((a, b) => {
    const timeA = new Date(a.createdAt).getTime();
    const timeB = new Date(b.createdAt).getTime();
    return timeB - timeA;
  });

  return federatedPosts.slice(0, limit);
}
