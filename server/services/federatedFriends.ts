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
  galleryUrl?: string;
  livePhotoUrl?: string;
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
  galleryUrl?: string;
  livePhotoUrl?: string;
  profileUrl?: string;
}

export interface FriendTarget {
  id: string;
  handle: string;
  email?: string;
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
  // Ignore handle-based neocities guesses that contain invalid characters like underscores
  if (base.endsWith('.neocities.org')) {
    const sub = base.replace(/^https?:\/\//, '').replace(/\.neocities\.org$/, '');
    if (sub.includes('_')) {
      base = '';
    }
  }
  if (!base) {
    const cleanHandle = (friend.handle || 'user').replace(/[^a-zA-Z0-9-]/g, '');
    base = `https://${cleanHandle || 'user'}.neocities.org`;
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
 * Validates that a URL is a real configured static hosting destination,
 * not a generic image CDN (picsum, placebear), localhost, or invalid neocities handle.
 */
export function isValidStaticSiteUrl(urlStr?: string): boolean {
  if (!urlStr || typeof urlStr !== 'string' || !urlStr.trim()) return false;
  try {
    const u = new URL(urlStr.startsWith('http') ? urlStr.trim() : `https://${urlStr.trim()}`);
    const h = u.hostname.toLowerCase();
    if (h === 'neogram.club' || h === 'localhost' || h === '127.0.0.1' || h.includes('app.github.dev')) return false;
    // Exclude generic placeholder / image hosting / dummy domains / known redirects
    if (
      h === 'user.neocities.org' ||
      h === 'wasson.neocities.org' ||
      h === 'picsum.photos' ||
      h.includes('placebear') ||
      h.includes('placeholder') ||
      h.includes('unsplash.com') ||
      h.includes('dummyimage')
    ) {
      return false;
    }
    // Neocities sites: subdomains must be alphanumeric/hyphens without underscores and not 'user'
    if (h.endsWith('.neocities.org')) {
      const sub = h.replace(/\.neocities\.org$/, '');
      if (sub === 'user' || sub.includes('_')) return false;
      return true;
    }
    // Nekoweb sites
    if (h.endsWith('.nekoweb.org')) {
      const sub = h.replace(/\.nekoweb\.org$/, '');
      if (sub.includes('_')) return false;
      return true;
    }
    // GitHub Pages sites
    if (h.endsWith('.github.io')) return true;
    // Custom domains are allowed if http/https
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Resolves the canonical external static photo PAGE URL for any post.
 * Always resolves to the HTML photo page (e.g. https://<author>.neocities.org/<deploy>/photos/<id>/),
 * never a raw image asset.
 */
export function resolvePhotoPageUrl(
  postId: string,
  author: string,
  galleryUrl?: string,
  siteUrl?: string,
  imageUrl?: string,
  authorUin?: number | string
): string {
  // 1. Primary Ground Truth: Extract from imageUrl or imagePath if it points to an external static host with /uploads/
  // e.g. https://chemicalmachine.neocities.org/neogram/uploads/images/1794197165547-qslfc2v.webp
  if (imageUrl && (imageUrl.startsWith('http://') || imageUrl.startsWith('https://'))) {
    try {
      const parsed = new URL(imageUrl);
      const parts = parsed.pathname.split('/').filter(Boolean);
      const uploadsIdx = parts.indexOf('uploads');

      if (uploadsIdx !== -1 && isValidStaticSiteUrl(parsed.origin)) {
        let deployPrefix = '';
        if (uploadsIdx > 0) {
          deployPrefix = '/' + parts.slice(0, uploadsIdx).join('/');
        }
        return `${parsed.protocol}//${parsed.host}${deployPrefix}/photos/${postId}/`;
      }
    } catch (_e) {}
  }

  // 2. Configured galleryUrl
  if (galleryUrl && isValidStaticSiteUrl(galleryUrl)) {
    const clean = galleryUrl.trim().replace(/\/+$/, '').replace(/\/photos$/, '');
    return `${clean}/photos/${postId}/`;
  }

  // 3. Configured siteUrl
  if (siteUrl && isValidStaticSiteUrl(siteUrl)) {
    const clean = siteUrl.trim().replace(/\/+$/, '').replace(/\/photos$/, '');
    return `${clean}/photos/${postId}/`;
  }

  // 4. Default fallback: Station profile on Neogram
  const cleanAuthor = (author || 'user').trim().replace(/^@/, '');
  const profileTarget = authorUin ? String(authorUin) : cleanAuthor;
  return `/user/${encodeURIComponent(profileTarget)}#photo-${postId}`;
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

  const rawBase = (data.user?.fullSiteUrl || friend.siteUrl || '').trim().replace(/\/+$/, '');
  const deploy = (friend.deployPath || data.user?.deployPath || '').trim().replace(/^\/+|\/+$/g, '');
  let defaultGalleryUrl = '';
  if (rawBase) {
    if (deploy && !rawBase.toLowerCase().endsWith(`/${deploy.toLowerCase()}`)) {
      defaultGalleryUrl = `${rawBase}/${deploy}/`;
    } else {
      defaultGalleryUrl = `${rawBase}/`;
    }
  }

  return (data.posts || []).map((p) => {
    const imageUrl = p.imageUrl || p.imagePath || '';
    const thumbnailUrl = p.thumbnailUrl || p.thumbnailPath || imageUrl;
    const galleryUrl = (p as any).galleryUrl || defaultGalleryUrl || friend.siteUrl;
    let livePhotoUrl = (p as any).livePhotoUrl;
    if (livePhotoUrl && (livePhotoUrl.endsWith('.webp') || livePhotoUrl.endsWith('.jpg') || livePhotoUrl.endsWith('.png') || !livePhotoUrl.includes('/photos/') || !isValidStaticSiteUrl(livePhotoUrl))) {
      livePhotoUrl = '';
    }
    if (!livePhotoUrl) {
      livePhotoUrl = resolvePhotoPageUrl(p.id, author, galleryUrl, authorSiteUrl, imageUrl, authorUin);
    } else {
      livePhotoUrl = livePhotoUrl.replace(/\/photos\/photos\//g, '/photos/');
    }

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
      galleryUrl,
      livePhotoUrl,
      profileUrl: authorUin ? `/user/${authorUin}` : `/user/${encodeURIComponent(author)}`,
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

  const isQaFriend = Boolean(
    (friend.email && friend.email.toLowerCase().endsWith('@qa.neogram.club')) ||
    (friend.handle && friend.handle.toLowerCase().startsWith('qa_'))
  );

  // Helper to check local static gallery compilation (for QA fleet & sandbox stations)
  const tryLocalFeed = async (): Promise<FriendFeedPost[] | null> => {
    try {
      // For QA fleet accounts managed on this node, check local postStorage first.
      // If local posts exist on this node, they take precedence over remote CDN caches.
      if (isQaFriend && friend.id) {
        const { getPostsForUser } = await import('./postStorage');
        const qaPosts = await getPostsForUser(friend.id);
        if (qaPosts && qaPosts.length > 0) {
          return qaPosts.map((p) => {
            const author = p.author || friend.handle;
            const galleryUrl = p.galleryUrl || friend.siteUrl;
            let livePhotoUrl = p.livePhotoUrl;
            if (livePhotoUrl && (livePhotoUrl.endsWith('.webp') || livePhotoUrl.endsWith('.jpg') || livePhotoUrl.endsWith('.png') || !livePhotoUrl.includes('/photos/'))) {
              livePhotoUrl = '';
            }
            if (!livePhotoUrl) {
              livePhotoUrl = resolvePhotoPageUrl(p.id, author, galleryUrl, friend.siteUrl, p.imageUrl || p.imagePath);
            } else {
              livePhotoUrl = livePhotoUrl.replace(/\/photos\/photos\//g, '/photos/');
            }
            return {
              ...p,
              imageUrl: p.imageUrl || p.imagePath,
              thumbnailUrl: p.thumbnailUrl || p.thumbnailPath || p.imageUrl || p.imagePath,
              filter: p.filterApplied || 'none',
              author,
              authorHandle: friend.handle,
              authorUin: friend.uin,
              authorAvatar: friend.avatarPath,
              authorSiteUrl: friend.siteUrl,
              galleryUrl,
              livePhotoUrl,
              profileUrl: friend.uin ? `/user/${friend.uin}` : `/user/${encodeURIComponent(friend.handle)}`,
            };
          });
        }
      }

      if (friend.siteId) {
        const sitePath = path.join(process.cwd(), 'dist/static-galleries', friend.siteId, 'feed.json');
        if (existsSync(sitePath)) {
          const content = await fs.readFile(sitePath, 'utf-8');
          const data = JSON.parse(content) as UserFeedPayload;
          if (data && Array.isArray(data.posts) && data.posts.length > 0) {
            return mapFeedPosts(data, friend);
          }
        }
      }

      const localDirectPath = path.join(process.cwd(), 'dist/static-galleries', friend.id, 'feed.json');
      if (existsSync(localDirectPath)) {
        const content = await fs.readFile(localDirectPath, 'utf-8');
        const data = JSON.parse(content) as UserFeedPayload;
        if (data && Array.isArray(data.posts) && data.posts.length > 0) {
          return mapFeedPosts(data, friend);
        }
      }

      const siteRes = await query(
        'SELECT id, site_url, deploy_path FROM sites WHERE user_id = $1 ORDER BY is_default DESC, last_deployed_at DESC NULLS LAST, created_at ASC LIMIT 1',
        [friend.id]
      );
      if (siteRes.rows.length > 0) {
        if (siteRes.rows[0].site_url) friend.siteUrl = siteRes.rows[0].site_url;
        if (siteRes.rows[0].deploy_path) friend.deployPath = siteRes.rows[0].deploy_path;
        if (siteRes.rows[0].id) friend.siteId = siteRes.rows[0].id;
        const sitePath = path.join(process.cwd(), 'dist/static-galleries', siteRes.rows[0].id, 'feed.json');
        if (existsSync(sitePath)) {
          const content = await fs.readFile(sitePath, 'utf-8');
          const data = JSON.parse(content) as UserFeedPayload;
          if (data && Array.isArray(data.posts) && data.posts.length > 0) {
            return mapFeedPosts(data, friend);
          }
        }
      }

      // Check posts from local posts.json storage
      const { getPostsForUser } = await import('./postStorage');
      const userPosts = await getPostsForUser(friend.id);
      if (userPosts && userPosts.length > 0) {
        return userPosts.map((p) => {
          const author = p.author || friend.handle;
          const galleryUrl = p.galleryUrl || friend.siteUrl;
          let livePhotoUrl = p.livePhotoUrl;
          if (livePhotoUrl && (livePhotoUrl.endsWith('.webp') || livePhotoUrl.endsWith('.jpg') || livePhotoUrl.endsWith('.png') || !livePhotoUrl.includes('/photos/'))) {
            livePhotoUrl = '';
          }
          if (!livePhotoUrl) {
            livePhotoUrl = resolvePhotoPageUrl(p.id, author, galleryUrl, friend.siteUrl, p.imageUrl || p.imagePath);
          } else {
            livePhotoUrl = livePhotoUrl.replace(/\/photos\/photos\//g, '/photos/');
          }
          return {
            ...p,
            imageUrl: p.imageUrl || p.imagePath,
            thumbnailUrl: p.thumbnailUrl || p.thumbnailPath || p.imageUrl || p.imagePath,
            filter: p.filterApplied || 'none',
            author,
            authorHandle: friend.handle,
            authorUin: friend.uin,
            authorAvatar: friend.avatarPath,
            authorSiteUrl: friend.siteUrl,
            galleryUrl,
            livePhotoUrl,
            profileUrl: friend.uin ? `/user/${friend.uin}` : `/user/${encodeURIComponent(friend.handle)}`,
          };
        });
      }
    } catch (_localErr) {}
    return null;
  };

  // Prioritize local authoritative state for QA fleet accounts if local posts exist on disk;
  // otherwise fall through to fetching their live feed.json from their external static host over WAN.
  if (isQaFriend) {
    const local = await tryLocalFeed();
    if (local && local.length > 0) return local;
  }

  try {
    const cacheBustedUrl = `${feedUrl}${feedUrl.includes('?') ? '&' : '?'}t=${Date.now()}`;
    const res = await safeGet(cacheBustedUrl, {
      timeoutMs: 3500,
      headers: { 'Accept': 'application/json', 'Cache-Control': 'no-cache' },
    });

    if (res.ok) {
      const data = res.json<UserFeedPayload>();
      if (data && Array.isArray(data.posts)) {
        // NOTE: Never write remote feed.json posts back into local postStorage!
        // Remote feed reading is strictly a pure read operation. Writing remote posts
        // to local disk causes zombie post resurrection when remote CDNs serve cached feeds.
        return mapFeedPosts(data, friend);
      }
      return [];
    }

    // If remote static host returned HTTP 404:
    // Check local compiled static gallery if available (for sandbox stations and propagation fallback)
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
