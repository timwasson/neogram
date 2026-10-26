import path from 'path';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import { decryptCredentials, NeocitiesCredentials } from '../utils/crypto';

/**
 * Mutex lock map to serialize reads, mutations, and re-uploads
 * for the same post comments or guestbook file. Eliminates race conditions.
 */
const fileLocks = new Map<string, Promise<any>>();

export async function withFileLock<T>(lockKey: string, task: () => Promise<T>): Promise<T> {
  const currentLock = fileLocks.get(lockKey) || Promise.resolve();
  const nextLock = currentLock
    .catch(() => {}) // Continue even if prior task failed
    .then(task);

  fileLocks.set(lockKey, nextLock);
  try {
    return await nextLock;
  } finally {
    if (fileLocks.get(lockKey) === nextLock) {
      fileLocks.delete(lockKey);
    }
  }
}

/**
 * Returns clean relative file path for a photo's comments JSON within the static gallery root.
 * Always resolves to: "uploads/images/<filename>.comments.json"
 * Strips any full URLs, domain names, or deploy path prefixes (e.g. "neogram/").
 */
export function getCommentsRelativePath(imagePath: string): string {
  if (!imagePath) return 'uploads/images/unknown.comments.json';
  // Strip protocol and hostname if full URL
  const clean = imagePath.replace(/^https?:\/\/[^\/]+/, '');
  // Isolate path from 'uploads/' onward so deploy_path prefixes are never duplicated
  const uploadsIndex = clean.indexOf('uploads/');
  const normalized = uploadsIndex !== -1 ? clean.substring(uploadsIndex) : clean.replace(/^\/+/, '');
  return normalized.replace(/\.[a-zA-Z0-9]+$/, '.comments.json');
}

/**
 * Returns clean relative file path for a user's visitor guestbook JSON.
 */
export function getGuestbookRelativePath(): string {
  return 'data/guestbook.json';
}

/**
 * Helper to resolve the clean deploy path prefix configured for a user.
 */
export function getDeployPathPrefix(user: any): string {
  if (user.deploy_path !== null && user.deploy_path !== undefined) {
    return String(user.deploy_path).trim().replace(/^\/+|\/+$/g, '');
  }
  return 'neogram';
}

/**
 * Reads a JSON file from the user's remote static host (Neocities / Nekoweb),
 * falling back to the local static build directory in development.
 */
export async function readRemoteJson<T>(user: any, relPath: string, defaultValue: T): Promise<T> {
  const deployPrefix = getDeployPathPrefix(user);
  let baseSiteUrl = user.site_url ? user.site_url.replace(/\/+$/, '') : '';
  if (!baseSiteUrl) {
    if (user.deployment_type === 'nekoweb') {
      baseSiteUrl = `https://${user.handle || 'user'}.nekoweb.org`;
    } else {
      baseSiteUrl = `https://${user.handle || 'user'}.neocities.org`;
    }
  }

  const remoteUrl = deployPrefix
    ? `${baseSiteUrl}/${deployPrefix}/${relPath}`
    : `${baseSiteUrl}/${relPath}`;

  // 1. Try reading live JSON from the user's static host via HTTPS
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000); // 4s timeout

    const res = await fetch(remoteUrl, {
      method: 'GET',
      headers: { 'Cache-Control': 'no-cache' },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      const data = (await res.json()) as T;
      return data;
    } else if (res.status === 404 && deployPrefix) {
      // Legacy auto-migration: check if file was previously uploaded under duplicated deploy prefix
      try {
        const legacyDoubleUrl = `${baseSiteUrl}/${deployPrefix}/${deployPrefix}/${relPath}`;
        const legacyRes = await fetch(legacyDoubleUrl, {
          method: 'GET',
          headers: { 'Cache-Control': 'no-cache' },
        });
        if (legacyRes.ok) {
          const legacyData = (await legacyRes.json()) as T;
          console.log(`[:> AUTO-MIGRATION] Migrating legacy double-path file to correct location: ${relPath}`);
          writeRemoteJson(user, relPath, legacyData).catch(() => {});
          return legacyData;
        }
      } catch (_legacyErr) {}
    }
  } catch (_err) {
    // Network failure or host not yet published; proceed to local fallback
  }

  // 2. Fallback to local user static compilation directory
  try {
    const localPath = path.join(process.cwd(), 'dist/static-galleries', user.id, relPath);
    if (existsSync(localPath)) {
      const content = await fs.readFile(localPath, 'utf-8');
      return JSON.parse(content) as T;
    }
  } catch (_err) {
    // Local file error; proceed to default
  }

  return defaultValue;
}

/**
 * Writes and uploads a JSON file to the user's remote static host,
 * and maintains the file in the local static build directory so 11ty picks it up.
 */
export async function writeRemoteJson(user: any, relPath: string, data: any): Promise<boolean> {
  const jsonString = JSON.stringify(data, null, 2);
  const deployPrefix = getDeployPathPrefix(user);
  const remotePath = deployPrefix
    ? path.posix.join(deployPrefix, relPath)
    : relPath;

  // 1. Persist to local static gallery directory (dist/static-galleries/<userId>/...)
  const localPath = path.join(process.cwd(), 'dist/static-galleries', user.id, relPath);
  try {
    await fs.mkdir(path.dirname(localPath), { recursive: true });
    await fs.writeFile(localPath, jsonString, 'utf-8');
  } catch (err) {
    console.warn('[:> STATIC-STORAGE] Could not write local static file:', err);
  }

  // 2. Push directly to remote static host (Neocities / Nekoweb)
  const creds = decryptCredentials<NeocitiesCredentials>(user.deployment_credentials);
  const deploymentType = user.deployment_type || 'neocities';

  if (creds && creds.apiKey && creds.apiKey.trim()) {
    const apiKey = creds.apiKey.trim();

    if (deploymentType === 'neocities') {
      try {
        const formData = new FormData();
        const blob = new Blob([Buffer.from(jsonString)], { type: 'application/json' });
        formData.append(remotePath, blob, path.basename(remotePath));

        const res = await fetch('https://neocities.org/api/upload', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
          },
          body: formData,
        });

        const resData = (await res.json()) as any;
        if (!res.ok || resData.result !== 'success') {
          console.warn(`[:> NEOCITIES UPLOAD] Warning for ${remotePath}:`, resData);
          return false;
        }

        console.log(`[:> NEOCITIES UPLOAD] Successfully updated remote JSON: ${remotePath}`);
        return true;
      } catch (uploadErr) {
        console.error(`[:> NEOCITIES UPLOAD] Failure uploading ${remotePath}:`, uploadErr);
        return false;
      }
    } else if (deploymentType === 'nekoweb') {
      try {
        const formData = new FormData();
        const blob = new Blob([Buffer.from(jsonString)], { type: 'application/json' });
        const dirPath = path.posix.dirname(remotePath);
        const normalizedDirPath = dirPath === '.' ? '/' : (dirPath.startsWith('/') ? dirPath : `/${dirPath}`);
        formData.append('pathname', normalizedDirPath);
        formData.append('files', blob, path.basename(remotePath));

        const res = await fetch('https://nekoweb.org/api/files/upload', {
          method: 'POST',
          headers: {
            'Authorization': apiKey,
          },
          body: formData,
        });

        const resData = (await res.json().catch(() => ({}))) as any;
        if (!res.ok) {
          console.warn(`[:> NEKOWEB UPLOAD] Warning for ${remotePath}:`, resData);
          return false;
        }

        console.log(`[:> NEKOWEB UPLOAD] Successfully updated remote JSON: ${remotePath}`);
        return true;
      } catch (nekoErr) {
        console.error(`[:> NEKOWEB UPLOAD] Failure uploading ${remotePath}:`, nekoErr);
        return false;
      }
    }
  }

  // If no API key configured (local dev mode), local write suffices
  return true;
}

export interface PostCommentItem {
  id: string;
  userId?: string;
  author: string;
  uin: number;
  avatar?: string;
  text: string;
  timestamp: string;
  siteUrl?: string;
}

export interface PostCommentsPayload {
  version: string;
  postId: string;
  updatedAt: string;
  comments: PostCommentItem[];
}

/**
 * Appends a verified comment to a post's self-hosted comments JSON file.
 * Returns the created comment item.
 */
export async function appendPostComment(
  ownerUser: any,
  post: any,
  commenter: { id?: string; handle: string; uin: number; avatar?: string; siteUrl?: string },
  text: string
): Promise<PostCommentItem> {
  const relPath = getCommentsRelativePath(post.image_path || post.imagePath);
  const lockKey = `comments:${post.id}`;

  return withFileLock(lockKey, async () => {
    const existing = await readRemoteJson<PostCommentsPayload>(ownerUser, relPath, {
      version: 'neogram-comments-v1',
      postId: post.id,
      updatedAt: new Date().toISOString(),
      comments: [],
    });

    const newComment: PostCommentItem = {
      id: `c_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`,
      userId: commenter.id,
      author: commenter.handle,
      uin: commenter.uin,
      avatar: commenter.avatar || '💬',
      text: text.trim().slice(0, 1000),
      timestamp: new Date().toISOString(),
      siteUrl: commenter.siteUrl,
    };

    const updatedComments = Array.isArray(existing.comments) ? existing.comments : [];
    updatedComments.push(newComment);

    const payload: PostCommentsPayload = {
      version: 'neogram-comments-v1',
      postId: post.id,
      updatedAt: new Date().toISOString(),
      comments: updatedComments,
    };

    await writeRemoteJson(ownerUser, relPath, payload);
    return newComment;
  });
}

/**
 * Removes a comment from a post's self-hosted comments JSON file.
 */
export async function deletePostComment(
  ownerUser: any,
  post: any,
  commentId: string
): Promise<boolean> {
  const relPath = getCommentsRelativePath(post.image_path || post.imagePath);
  const lockKey = `comments:${post.id}`;

  return withFileLock(lockKey, async () => {
    const existing = await readRemoteJson<PostCommentsPayload>(ownerUser, relPath, {
      version: 'neogram-comments-v1',
      postId: post.id,
      updatedAt: new Date().toISOString(),
      comments: [],
    });

    const initialLen = existing.comments.length;
    const filtered = existing.comments.filter((c) => c.id !== commentId);

    if (filtered.length === initialLen) {
      return false; // Comment not found
    }

    const payload: PostCommentsPayload = {
      version: 'neogram-comments-v1',
      postId: post.id,
      updatedAt: new Date().toISOString(),
      comments: filtered,
    };

    await writeRemoteJson(ownerUser, relPath, payload);
    return true;
  });
}

export interface GuestbookItem {
  id: string;
  visitorName: string;
  uin?: number;
  visitorLocation?: string;
  visitorWebsite?: string;
  moodIcon: string;
  message: string;
  createdAt: string;
}

export interface GuestbookPayload {
  version: string;
  handle: string;
  updatedAt: string;
  entries: GuestbookItem[];
}

/**
 * Appends an entry to the user's self-hosted visitor guestbook JSON file.
 */
export async function appendGuestbookEntry(
  ownerUser: any,
  entryData: {
    visitorName: string;
    uin?: number;
    visitorLocation?: string;
    visitorWebsite?: string;
    moodIcon?: string;
    message: string;
  }
): Promise<GuestbookItem> {
  const relPath = getGuestbookRelativePath();
  const lockKey = `guestbook:${ownerUser.id}`;

  return withFileLock(lockKey, async () => {
    const existing = await readRemoteJson<GuestbookPayload>(ownerUser, relPath, {
      version: 'neogram-guestbook-v1',
      handle: ownerUser.handle,
      updatedAt: new Date().toISOString(),
      entries: [],
    });

    const newEntry: GuestbookItem = {
      id: `gb_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`,
      visitorName: entryData.visitorName.trim().slice(0, 50),
      uin: entryData.uin,
      visitorLocation: (entryData.visitorLocation || 'Cyberspace').trim().slice(0, 100),
      visitorWebsite: entryData.visitorWebsite ? entryData.visitorWebsite.trim().slice(0, 300) : undefined,
      moodIcon: entryData.moodIcon || '😎',
      message: entryData.message.trim().slice(0, 1000),
      createdAt: new Date().toISOString(),
    };

    const updatedEntries = Array.isArray(existing.entries) ? existing.entries : [];
    updatedEntries.unshift(newEntry); // Newest first

    const payload: GuestbookPayload = {
      version: 'neogram-guestbook-v1',
      handle: ownerUser.handle,
      updatedAt: new Date().toISOString(),
      entries: updatedEntries,
    };

    await writeRemoteJson(ownerUser, relPath, payload);
    return newEntry;
  });
}

/**
 * Deletes a guestbook entry from the user's self-hosted guestbook JSON file.
 */
export async function deleteGuestbookEntry(
  ownerUser: any,
  entryId: string
): Promise<boolean> {
  const relPath = getGuestbookRelativePath();
  const lockKey = `guestbook:${ownerUser.id}`;

  return withFileLock(lockKey, async () => {
    const existing = await readRemoteJson<GuestbookPayload>(ownerUser, relPath, {
      version: 'neogram-guestbook-v1',
      handle: ownerUser.handle,
      updatedAt: new Date().toISOString(),
      entries: [],
    });

    const initialLen = existing.entries.length;
    const filtered = existing.entries.filter((e) => e.id !== entryId);

    if (filtered.length === initialLen) {
      return false;
    }

    const payload: GuestbookPayload = {
      version: 'neogram-guestbook-v1',
      handle: ownerUser.handle,
      updatedAt: new Date().toISOString(),
      entries: filtered,
    };

    await writeRemoteJson(ownerUser, relPath, payload);
    return true;
  });
}
