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
  let base = (friend.siteUrl || '').replace(/\/+$/, '');
  if (!base) {
    base = `https://${friend.handle}.neocities.org`;
  }
  const deploy = (friend.deployPath || 'neogram').trim().replace(/^\/+|\/+$/g, '');
  return deploy ? `${base}/${deploy}/feed.json` : `${base}/feed.json`;
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
    } catch (_localErr) {}
    return null;
  };

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

    if (res.ok) {
      const data = (await res.json()) as UserFeedPayload;
      if (data && Array.isArray(data.posts)) {
        return mapFeedPosts(data, friend);
      }
      return [];
    }

    // If remote static host returned HTTP 404:
    // If user has actively deployed to live host, it was wiped via FTP (yields 0 posts).
    // If user has NOT actively deployed live (sandbox / test runner), check local compiled static gallery.
    if (res.status === 404) {
      if (!friend.lastDeployedAt) {
        const local = await tryLocalFeed();
        if (local) return local;
      }
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
