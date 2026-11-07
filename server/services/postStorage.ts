import path from 'path';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import { query } from '../db';
import { writeFileAtomic, Mutex } from '../utils/atomicFile';

// Serialises every read-modify-write against posts.json/feed.json (prevents lost updates, e.g. concurrent likes).
const postsMutex = new Mutex();

export interface PhotoFrame {
  imagePath: string;
  thumbnailPath: string;
  width?: number;
  height?: number;
}

export interface PostRecord {
  id: string;
  userId: string;
  siteId?: string;
  siteName?: string;
  siteSlug?: string;
  imagePath: string;
  thumbnailPath: string;
  imageUrl?: string;
  thumbnailUrl?: string;
  photos: PhotoFrame[];
  caption: string;
  filterApplied: string;
  mood?: string | null;
  webring?: string | null;
  location?: string | null;
  likes: number;
  createdAt: string;
  email?: string;
  handle?: string;
  author?: string;
  commentsCount?: number;
  comments?: any[];
  commentsUrl?: string;
  actions?: {
    likeUrl?: string;
    commentUrl?: string;
  };
}

const GALLERIES_ROOT = path.join(process.cwd(), 'dist', 'static-galleries');

function getSitePostsJsonPath(siteIdOrUserId: string): string {
  return path.join(GALLERIES_ROOT, siteIdOrUserId, 'posts.json');
}

function getSiteFeedJsonPath(siteIdOrUserId: string): string {
  return path.join(GALLERIES_ROOT, siteIdOrUserId, 'feed.json');
}

/**
 * Normalizes a post record so that all fields (photos array, image URLs, etc.) are valid.
 */
function normalizePost(raw: any): PostRecord {
  let parsedPhotos: PhotoFrame[] = [];
  if (Array.isArray(raw.photos) && raw.photos.length > 0) {
    parsedPhotos = raw.photos;
  } else if (typeof raw.photos === 'string' && raw.photos.startsWith('[')) {
    try {
      parsedPhotos = JSON.parse(raw.photos);
    } catch (_e) {
      parsedPhotos = [];
    }
  }

  const primaryImage = raw.imagePath || raw.image_path || (parsedPhotos[0]?.imagePath ?? '');
  const primaryThumb = raw.thumbnailPath || raw.thumbnail_path || (parsedPhotos[0]?.thumbnailPath ?? primaryImage);

  if (!parsedPhotos || parsedPhotos.length === 0) {
    parsedPhotos = [{ imagePath: primaryImage, thumbnailPath: primaryThumb }];
  }

  const comments = Array.isArray(raw.comments) ? raw.comments : [];

  return {
    id: String(raw.id),
    userId: raw.userId || raw.user_id || '',
    siteId: raw.siteId || raw.site_id || undefined,
    siteName: raw.siteName || raw.site_name || undefined,
    siteSlug: raw.siteSlug || raw.site_slug || undefined,
    imagePath: primaryImage,
    thumbnailPath: primaryThumb,
    imageUrl: raw.imageUrl || raw.image_url || primaryImage,
    thumbnailUrl: raw.thumbnailUrl || raw.thumbnail_url || primaryThumb,
    photos: parsedPhotos,
    caption: raw.caption ?? '',
    filterApplied: raw.filterApplied || raw.filter_applied || 'none',
    mood: raw.mood ?? null,
    webring: raw.webring ?? null,
    location: raw.location ?? null,
    likes: typeof raw.likes === 'number' ? raw.likes : (raw.likes_count ? parseInt(raw.likes_count, 10) : 0),
    createdAt: raw.createdAt || raw.created_at || new Date().toISOString(),
    email: raw.email,
    handle: raw.handle,
    author: raw.author || raw.handle || (raw.email ? raw.email.split('@')[0] : 'surfer'),
    commentsCount: typeof raw.commentsCount === 'number' ? raw.commentsCount : comments.length,
    comments,
    commentsUrl: raw.commentsUrl,
    actions: raw.actions,
  };
}

/**
 * Reads and parses posts.json for a specific site or user folder.
 */
export async function getPostsForSite(siteId: string): Promise<PostRecord[]> {
  const filePath = getSitePostsJsonPath(siteId);
  if (!existsSync(filePath)) {
    return [];
  }
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(content);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizePost);
  } catch (_e) {
    return [];
  }
}

/**
 * Retrieves all posts for a user across all mounted static sites.
 */
export async function getPostsForUser(userId: string): Promise<PostRecord[]> {
  const postsMap = new Map<string, PostRecord>();

  // 1. Check user-level fallback directory
  const userFallbackPosts = await getPostsForSite(userId);
  for (const p of userFallbackPosts) {
    postsMap.set(p.id, p);
  }

  // 2. Query all sites belonging to the user
  try {
    const sitesRes = await query('SELECT id FROM sites WHERE user_id = $1', [userId]);
    for (const siteRow of sitesRes.rows) {
      const sitePosts = await getPostsForSite(siteRow.id);
      for (const p of sitePosts) {
        postsMap.set(p.id, p);
      }
    }
  } catch (_e) {}

  // 3. Return sorted reverse-chronologically
  const posts = Array.from(postsMap.values());
  posts.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return posts;
}

/**
 * Retrieves all posts across all sites in the entire system.
 */
export async function getAllPosts(): Promise<PostRecord[]> {
  const postsMap = new Map<string, PostRecord>();
  if (!existsSync(GALLERIES_ROOT)) {
    return [];
  }

  try {
    const entries = await fs.readdir(GALLERIES_ROOT, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const posts = await getPostsForSite(entry.name);
        for (const p of posts) {
          const existing = postsMap.get(p.id);
          if (!existing) {
            postsMap.set(p.id, p);
          } else {
            const mergedComments = (p.comments && p.comments.length >= (existing.comments?.length || 0))
              ? p.comments
              : existing.comments;
            const maxLikes = Math.max(p.likes || 0, existing.likes || 0);
            const commentsCount = Math.max(
              p.commentsCount || (p.comments?.length || 0),
              existing.commentsCount || (existing.comments?.length || 0)
            );
            postsMap.set(p.id, {
              ...existing,
              ...p,
              siteId: p.siteId || existing.siteId,
              siteName: p.siteName || existing.siteName,
              siteSlug: p.siteSlug || existing.siteSlug,
              likes: maxLikes,
              comments: mergedComments,
              commentsCount,
            });
          }
        }
      }
    }
  } catch (_e) {}

  const all = Array.from(postsMap.values());
  all.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return all;
}

/**
 * Retrieves a single post by ID.
 */
export async function getPostById(postId: string): Promise<PostRecord | null> {
  if (!postId) return null;
  const all = await getAllPosts();
  return all.find((p) => p.id === postId) || null;
}

/**
 * Saves (inserts or updates) a post in its site's posts.json and updates feed.json.
 */
export async function savePost(post: PostRecord): Promise<void> {
  return postsMutex.run(() => savePostUnlocked(post));
}

async function savePostUnlocked(post: PostRecord): Promise<void> {
  const targetIds = new Set<string>();
  if (post.siteId) targetIds.add(post.siteId);
  if (post.userId) targetIds.add(post.userId);
  if (targetIds.size === 0) return;

  for (const targetId of targetIds) {
    const targetDir = path.join(GALLERIES_ROOT, targetId);
    await fs.mkdir(targetDir, { recursive: true });

    const posts = await getPostsForSite(targetId);
    const existingIdx = posts.findIndex((p) => p.id === post.id);

    if (existingIdx >= 0) {
      posts[existingIdx] = { ...posts[existingIdx], ...post };
    } else {
      posts.unshift(post);
    }

    posts.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const postsJsonPath = getSitePostsJsonPath(targetId);
    await writeFileAtomic(postsJsonPath, JSON.stringify(posts, null, 2));

    // Also sync feed.json if present or initialize it
    const feedJsonPath = getSiteFeedJsonPath(targetId);
    try {
      let feedData: any = {};
      if (existsSync(feedJsonPath)) {
        const feedRaw = await fs.readFile(feedJsonPath, 'utf-8');
        feedData = JSON.parse(feedRaw);
      }
      feedData.version = feedData.version || 'neogram-feed-v1';
      feedData.updatedAt = new Date().toISOString();
      feedData.posts = posts;
      await writeFileAtomic(feedJsonPath, JSON.stringify(feedData, null, 2));
    } catch (_feedErr) {}
  }
}

/**
 * Updates a post record using an updater function.
 */
export async function updatePost(
  postId: string,
  updater: (post: PostRecord) => PostRecord
): Promise<PostRecord | null> {
  return postsMutex.run(async () => {
    const post = await getPostById(postId);
    if (!post) return null;

    const updated = updater(post);
    await savePostUnlocked(updated);
    return updated;
  });
}

/**
 * Deletes a post from its site's posts.json and feed.json across all directories.
 */
export async function deletePost(postId: string): Promise<PostRecord | null> {
  return postsMutex.run(() => deletePostUnlocked(postId));
}

async function deletePostUnlocked(postId: string): Promise<PostRecord | null> {
  if (!existsSync(GALLERIES_ROOT)) return null;

  let deletedRecord: PostRecord | null = null;
  try {
    const entries = await fs.readdir(GALLERIES_ROOT, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const posts = await getPostsForSite(entry.name);
        const matchIdx = posts.findIndex((p) => p.id === postId);
        if (matchIdx >= 0) {
          const [removed] = posts.splice(matchIdx, 1);
          deletedRecord = deletedRecord || removed;
          const postsJsonPath = getSitePostsJsonPath(entry.name);
          await writeFileAtomic(postsJsonPath, JSON.stringify(posts, null, 2));

          const feedJsonPath = getSiteFeedJsonPath(entry.name);
          if (existsSync(feedJsonPath)) {
            try {
              const feedRaw = await fs.readFile(feedJsonPath, 'utf-8');
              const feedData = JSON.parse(feedRaw);
              feedData.posts = posts;
              feedData.updatedAt = new Date().toISOString();
              await writeFileAtomic(feedJsonPath, JSON.stringify(feedData, null, 2));
            } catch (_e) {}
          }
        }
      }
    }
  } catch (_e) {}

  return deletedRecord;
}

/**
 * Deletes all posts belonging to a given siteId across all galleries.
 */
export async function deletePostsForSite(siteId: string): Promise<void> {
  return postsMutex.run(() => deletePostsForSiteUnlocked(siteId));
}

async function deletePostsForSiteUnlocked(siteId: string): Promise<void> {
  if (!existsSync(GALLERIES_ROOT)) return;
  try {
    const siteDir = path.join(GALLERIES_ROOT, siteId);
    if (existsSync(siteDir)) {
      await fs.rm(siteDir, { recursive: true, force: true });
    }

    const entries = await fs.readdir(GALLERIES_ROOT, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const posts = await getPostsForSite(entry.name);
        const filtered = posts.filter((p) => p.siteId !== siteId);
        if (filtered.length !== posts.length) {
          const postsJsonPath = getSitePostsJsonPath(entry.name);
          await writeFileAtomic(postsJsonPath, JSON.stringify(filtered, null, 2));

          const feedJsonPath = getSiteFeedJsonPath(entry.name);
          if (existsSync(feedJsonPath)) {
            try {
              const feedRaw = await fs.readFile(feedJsonPath, 'utf-8');
              const feedData = JSON.parse(feedRaw);
              feedData.posts = filtered;
              feedData.updatedAt = new Date().toISOString();
              await writeFileAtomic(feedJsonPath, JSON.stringify(feedData, null, 2));
            } catch (_e) {}
          }
        }
      }
    }
  } catch (_e) {}
}

/**
 * Returns the count of posts for a specific site.
 */
export async function getPostCountForSite(siteId: string): Promise<number> {
  const posts = await getPostsForSite(siteId);
  return posts.length;
}

/**
 * Returns the total count of posts for a user across all sites.
 */
export async function getPostCountForUser(userId: string): Promise<number> {
  const posts = await getPostsForUser(userId);
  return posts.length;
}

/**
 * Migration helper: Reads any existing posts from the PostgreSQL `posts` table
 * (if the table still exists) and ensures they are safely saved to their respective
 * static galleries' posts.json before the database table is dropped.
 */
export async function exportDbPostsToDisk(): Promise<number> {
  try {
    const checkTable = await query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'posts'
      ) as exists;
    `);

    if (!checkTable.rows[0]?.exists) {
      return 0;
    }

    const postsRes = await query(`
      SELECT 
        p.*,
        u.email,
        u.handle,
        s.name as "siteName",
        s.slug as "siteSlug"
      FROM posts p
      JOIN users u ON p.user_id = u.id
      LEFT JOIN sites s ON p.site_id = s.id
      ORDER BY p.created_at ASC
    `);

    let exported = 0;
    for (const row of postsRes.rows) {
      const normalized = normalizePost(row);
      await savePost(normalized);
      exported++;
    }

    return exported;
  } catch (_err) {
    return 0;
  }
}
