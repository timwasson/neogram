import path from 'path';
import fs from 'fs/promises';
import Eleventy from '@11ty/eleventy';
import { query, initDatabase } from '../db';

export interface StaticBuildOptions {
  userId?: string;
  outputDir?: string;
}

export interface StaticBuildResult {
  ok: boolean;
  postsCount: number;
  outputDir: string;
  error?: string;
  durationMs?: number;
}

/**
 * In-memory sequential FIFO build queue to prevent concurrency race conditions.
 * Ensures builds execute in strict order without collision on shared Eleventy data files.
 */
class BuildQueue {
  private queue: Promise<any> = Promise.resolve();
  private activeCount: number = 0;

  public enqueue<T>(taskName: string, task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.activeCount++;
      console.log(`[:> BUILD QUEUE] Enqueued job '${taskName}'. Pending in queue: ${this.activeCount}`);

      this.queue = this.queue
        .then(async () => {
          console.log(`[:> BUILD QUEUE] Starting job '${taskName}'...`);
          try {
            const result = await task();
            resolve(result);
          } catch (err) {
            reject(err);
          }
        })
        .catch((err) => {
          console.error(`[:> BUILD QUEUE] Job '${taskName}' failed:`, err);
          reject(err);
        })
        .finally(() => {
          this.activeCount--;
          console.log(`[:> BUILD QUEUE] Job '${taskName}' finalized. Remaining in queue: ${this.activeCount}`);
        });
    });
  }

  public get pending(): number {
    return this.activeCount;
  }
}

export const buildQueue = new BuildQueue();

/**
 * Executes a static 11ty gallery compilation.
 * Internal worker function dispatched exclusively through buildQueue.
 */
async function executeStaticBuild(options: StaticBuildOptions = {}): Promise<StaticBuildResult> {
  const startTime = Date.now();
  try {
    // 0. Ensure database is connected
    await initDatabase();

    const { userId } = options;
    // Multi-tenant isolated output folder per user
    const targetOutputDir = options.outputDir || (
      userId 
        ? path.join(process.cwd(), 'dist/static-galleries', userId)
        : path.join(process.cwd(), 'dist/static-galleries/default')
    );

    // 1. Fetch posts from PostgreSQL (filtered by user if requested)
    let postsQuery;
    if (userId) {
      postsQuery = await query(
        `
        SELECT 
          p.id,
          p.user_id as "userId",
          p.image_path as "imagePath",
          p.thumbnail_path as "thumbnailPath",
          p.caption,
          p.filter_applied as "filterApplied",
          p.mood,
          p.webring,
          p.location,
          p.likes_count as "likes",
          p.created_at as "createdAt",
          u.email,
          u.handle,
          COALESCE(u.handle, split_part(u.email, '@', 1)) as author
        FROM posts p
        JOIN users u ON p.user_id = u.id
        WHERE p.user_id = $1
        ORDER BY p.created_at DESC
      `,
        [userId]
      );
    } else {
      postsQuery = await query(`
        SELECT 
          p.id,
          p.user_id as "userId",
          p.image_path as "imagePath",
          p.thumbnail_path as "thumbnailPath",
          p.caption,
          p.filter_applied as "filterApplied",
          p.mood,
          p.webring,
          p.location,
          p.likes_count as "likes",
          p.created_at as "createdAt",
          u.email,
          u.handle,
          COALESCE(u.handle, split_part(u.email, '@', 1)) as author
        FROM posts p
        JOIN users u ON p.user_id = u.id
        ORDER BY p.created_at DESC
      `);
    }

    // 2. Fetch comments
    const commentsQuery = await query(`
      SELECT 
        c.id,
        c.post_id as "postId",
        c.author_name as "author",
        c.author_avatar as "avatar",
        c.body as "text",
        c.created_at as "timestamp"
      FROM comments c
      ORDER BY c.created_at ASC
    `);

    // Group comments by post
    const commentsByPost: Record<string, any[]> = {};
    for (const comment of commentsQuery.rows) {
      if (!commentsByPost[comment.postId]) {
        commentsByPost[comment.postId] = [];
      }
      commentsByPost[comment.postId].push(comment);
    }

    const posts = postsQuery.rows.map((post) => ({
      ...post,
      comments: commentsByPost[post.id] || [],
    }));

    // 3. Update site.json metadata for this specific user's compilation
    let pathPrefix = '/';
    if (userId) {
      const userRes = await query('SELECT id, email, handle, site_url, deploy_path, avatar_path FROM users WHERE id = $1', [userId]);
      if (userRes.rows.length > 0) {
        const u = userRes.rows[0];
        const author = u.handle || u.email.split('@')[0];
        const rawDeployPath = u.deploy_path !== null && u.deploy_path !== undefined
          ? String(u.deploy_path).trim().replace(/^\/+|\/+$/g, '')
          : 'neogram';
        pathPrefix = rawDeployPath ? `/${rawDeployPath}/` : '/';
        const baseSiteUrl = u.site_url ? u.site_url.replace(/\/+$/, '') : `https://${author}.neocities.org`;
        const fullSiteUrl = rawDeployPath ? `${baseSiteUrl}/${rawDeployPath}` : baseSiteUrl;

        const siteData = {
          title: `@${author.toUpperCase()}'S STATIC PHOTO STREAM`,
          author: author,
          avatarUrl: u.avatar_path || '/icons/default-avatar.svg',
          description: `Personal 90s retro static photo stream published via Neogram`,
          neocitiesUrl: fullSiteUrl,
          pathPrefix: pathPrefix,
          apiUrl: 'http://localhost:4000',
          systemMood: '[:> SURFING THE RETRO STATIC WEBRING]',
        };
        const siteJsonPath = path.join(process.cwd(), 'eleventy/src/_data/site.json');
        await fs.writeFile(siteJsonPath, JSON.stringify(siteData, null, 2), 'utf-8');
      }
    }

    // 4. Write data to eleventy/src/_data/posts.json
    const postsDataPath = path.join(process.cwd(), 'eleventy/src/_data/posts.json');
    await fs.writeFile(postsDataPath, JSON.stringify(posts, null, 2), 'utf-8');

    // 5. Invoke Eleventy builder strictly to this user's isolated output directory
    const inputDir = path.join(process.cwd(), 'eleventy/src');
    const configPath = path.join(process.cwd(), 'eleventy/eleventy.config.js');

    await fs.mkdir(targetOutputDir, { recursive: true });
    process.env.ELEVENTY_OUTPUT_DIR = path.relative(process.cwd(), targetOutputDir);
    process.env.ELEVENTY_PATH_PREFIX = pathPrefix;

    const elev = new Eleventy(inputDir, targetOutputDir, {
      configPath: configPath,
    });

    await elev.write();

    const durationMs = Date.now() - startTime;
    console.log(`[:> 11ty] Static gallery compiled: ${posts.length} photos in ${durationMs}ms -> ${targetOutputDir}`);

    return {
      ok: true,
      postsCount: posts.length,
      outputDir: targetOutputDir,
      durationMs,
    };
  } catch (err: any) {
    console.error('[:> 11ty ERROR] Static build failed:', err);
    return {
      ok: false,
      postsCount: 0,
      outputDir: options.outputDir || (options.userId ? `dist/static-galleries/${options.userId}` : 'dist/static-galleries/default'),
      error: err.message || String(err),
      durationMs: Date.now() - startTime,
    };
  }
}

/**
 * Builds the static 11ty gallery from PostgreSQL posts.
 * Automatically dispatched through the FIFO BuildQueue to serialize execution,
 * guarantee per-user directory isolation, and eliminate concurrency collisions.
 */
export async function buildStaticGallery(options: StaticBuildOptions = {}): Promise<StaticBuildResult> {
  const jobLabel = options.userId ? `User:${options.userId}` : 'Global';
  return buildQueue.enqueue(jobLabel, () => executeStaticBuild(options));
}
