import path from 'path';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import Eleventy from '@11ty/eleventy';
import { query, initDatabase } from '../db';
import { config } from '../config';

export interface StaticBuildOptions {
  userId?: string;
  siteId?: string;
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
 * Cleans up HTML, CSS, and JS static site bundle assets from the output directory
 * when running in Headless API mode. Strictly preserves uploads/ and data/ directories.
 */
async function cleanHtmlArtifacts(dir: string): Promise<void> {
  const itemsToRemove = [
    'index.html',
    'friends',
    'photos',
    'css',
    'js',
    'embed',
    'icons',
    'embed.js',
    'pager.js',
    'neogram-embed.css',
    'id',
    '800',
  ];

  for (const item of itemsToRemove) {
    const itemPath = path.join(dir, item);
    try {
      if (existsSync(itemPath)) {
        await fs.rm(itemPath, { recursive: true, force: true });
      }
    } catch (_err) {}
  }
}

/**
 * Executes a static 11ty gallery compilation.
 * Internal worker function dispatched exclusively through buildQueue.
 */
async function executeStaticBuild(options: StaticBuildOptions = {}): Promise<StaticBuildResult> {
  const startTime = Date.now();
  try {
    // 0. Ensure database is connected
    await initDatabase();

    const { userId, siteId } = options;
    let targetSite: any = null;
    let effectiveUserId = userId;

    if (siteId) {
      const siteRes = await query(
        `SELECT s.*, u.id as user_owner_id, u.email, u.handle, u.uin, u.avatar_path, u.status_message
         FROM sites s
         JOIN users u ON s.user_id = u.id
         WHERE s.id = $1`,
        [siteId]
      );
      if (siteRes.rows.length > 0) {
        targetSite = siteRes.rows[0];
        effectiveUserId = targetSite.user_owner_id;
      }
    } else if (userId) {
      const siteRes = await query(
        `SELECT s.*, u.id as user_owner_id, u.email, u.handle, u.uin, u.avatar_path, u.status_message
         FROM sites s
         JOIN users u ON s.user_id = u.id
         WHERE s.user_id = $1 AND s.is_default = TRUE
         LIMIT 1`,
        [userId]
      );
      if (siteRes.rows.length > 0) {
        targetSite = siteRes.rows[0];
      }
    }

    // Multi-tenant isolated output folder per site or user
    const targetOutputDir = options.outputDir || (
      siteId
        ? path.join(process.cwd(), 'dist/static-galleries', siteId)
        : (userId 
            ? path.join(process.cwd(), 'dist/static-galleries', userId)
            : path.join(process.cwd(), 'dist/static-galleries/default'))
    );

    // 1. Fetch posts from PostgreSQL (filtered by site or user)
    let postsQuery;
    if (siteId) {
      postsQuery = await query(
        `SELECT 
          p.id,
          p.user_id as "userId",
          p.site_id as "siteId",
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
        WHERE p.site_id = $1
        ORDER BY p.created_at DESC`,
        [siteId]
      );
    } else if (userId) {
      postsQuery = await query(
        `SELECT 
          p.id,
          p.user_id as "userId",
          p.site_id as "siteId",
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
        ORDER BY p.created_at DESC`,
        [userId]
      );
    } else {
      postsQuery = await query(`
        SELECT 
          p.id,
          p.user_id as "userId",
          p.site_id as "siteId",
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

    // 2. Fetch comments from self-hosted comments.json files (with fallback to database)
    const { getCommentsRelativePath } = await import('./staticStorage');
    const commentsByPost: Record<string, any[]> = {};

    // Group database comments first as baseline
    for (const comment of commentsQuery.rows) {
      if (!commentsByPost[comment.postId]) {
        commentsByPost[comment.postId] = [];
      }
      commentsByPost[comment.postId].push(comment);
    }

    // Overlay or populate from self-hosted comments.json files
    for (const post of postsQuery.rows) {
      if (post.imagePath) {
        const relPath = getCommentsRelativePath(post.imagePath);
        const jsonFilePath = path.join(targetOutputDir, relPath);

        // Check if old legacy double-path file exists on disk and migrate it
        const legacyPath = path.join(targetOutputDir, 'neogram', relPath);
        try {
          if (existsSync(legacyPath) && !existsSync(jsonFilePath)) {
            await fs.mkdir(path.dirname(jsonFilePath), { recursive: true });
            await fs.copyFile(legacyPath, jsonFilePath);
            await fs.unlink(legacyPath).catch(() => {});
          }
        } catch (_migErr) {}

        try {
          if (!existsSync(jsonFilePath)) {
            // Write initial comments JSON to ensure static host serves 200 OK without 404
            await fs.mkdir(path.dirname(jsonFilePath), { recursive: true });
            const initialData = {
              version: 'neogram-comments-v1',
              postId: post.id,
              updatedAt: new Date().toISOString(),
              comments: commentsByPost[post.id] || [],
            };
            await fs.writeFile(jsonFilePath, JSON.stringify(initialData, null, 2), 'utf-8');
          } else {
            const raw = await fs.readFile(jsonFilePath, 'utf-8');
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed.comments) && parsed.comments.length > 0) {
              commentsByPost[post.id] = parsed.comments;
            }
          }
        } catch (_err) {
          // File error; keeps DB comments or empty array
        }
      }
    }

    const posts = postsQuery.rows.map((post) => ({
      ...post,
      comments: commentsByPost[post.id] || [],
    }));

    // 3. User metadata & Headless API configuration
    let author = 'user';
    let authorUin: number | undefined = undefined;
    let baseSiteUrl = 'https://user.neocities.org';
    let rawDeployPath = 'neogram';
    let fullSiteUrl = `${baseSiteUrl}/${rawDeployPath}`;
    let avatarUrl = '/icons/default-avatar.svg';
    let statusMessage = 'Surfing cyberspace';
    let customCssUrl: string | null = null;
    let shouldBuildHtml = true;
    let pathPrefix = '/';

    if (targetSite) {
      author = targetSite.handle || targetSite.email.split('@')[0];
      authorUin = targetSite.uin ? parseInt(targetSite.uin, 10) : undefined;
      rawDeployPath = targetSite.deploy_path !== null && targetSite.deploy_path !== undefined
        ? String(targetSite.deploy_path).trim().replace(/^\/+|\/+$/g, '')
        : 'neogram';
      pathPrefix = rawDeployPath ? `/${rawDeployPath}/` : '/';
      baseSiteUrl = targetSite.site_url ? targetSite.site_url.replace(/\/+$/, '') : `https://${author}.neocities.org`;
      fullSiteUrl = rawDeployPath ? `${baseSiteUrl}/${rawDeployPath}` : baseSiteUrl;
      avatarUrl = targetSite.avatar_path || '/icons/default-avatar.svg';
      statusMessage = targetSite.status_message || 'Surfing cyberspace';
      customCssUrl = targetSite.custom_css_url || null;
      shouldBuildHtml = targetSite.build_html !== false;

      const siteData = {
        title: `${(targetSite.name || 'STATIC PHOTO STREAM').toUpperCase()} // @${author.toUpperCase()}`,
        siteName: targetSite.name,
        siteSlug: targetSite.slug,
        author: author,
        avatarUrl: avatarUrl,
        description: `Personal 90s retro static photo stream published via Neogram`,
        neocitiesUrl: fullSiteUrl,
        pathPrefix: pathPrefix,
        apiUrl: config.appUrl || 'http://localhost:4000',
        systemMood: '[:> SURFING THE RETRO STATIC WEBRING]',
        customCssUrl: customCssUrl,
        chatWidgetEnabled: targetSite.chat_widget_enabled !== false,
      };
      const siteJsonPath = path.join(process.cwd(), 'eleventy/src/_data/site.json');
      await fs.writeFile(siteJsonPath, JSON.stringify(siteData, null, 2), 'utf-8');
    } else if (userId) {
      const userRes = await query(
        'SELECT id, email, handle, uin, site_url, deploy_path, avatar_path, custom_css_url, build_html, status_message FROM users WHERE id = $1',
        [userId]
      );
      if (userRes.rows.length > 0) {
        const u = userRes.rows[0];
        author = u.handle || u.email.split('@')[0];
        authorUin = u.uin ? parseInt(u.uin, 10) : undefined;
        rawDeployPath = u.deploy_path !== null && u.deploy_path !== undefined
          ? String(u.deploy_path).trim().replace(/^\/+|\/+$/g, '')
          : 'neogram';
        pathPrefix = rawDeployPath ? `/${rawDeployPath}/` : '/';
        baseSiteUrl = u.site_url ? u.site_url.replace(/\/+$/, '') : `https://${author}.neocities.org`;
        fullSiteUrl = rawDeployPath ? `${baseSiteUrl}/${rawDeployPath}` : baseSiteUrl;
        avatarUrl = u.avatar_path || '/icons/default-avatar.svg';
        statusMessage = u.status_message || 'Surfing cyberspace';
        customCssUrl = u.custom_css_url || null;
        shouldBuildHtml = u.build_html !== false;

        const prefRes = await query(
          'SELECT chat_widget_enabled FROM notification_preferences WHERE user_id = $1',
          [userId]
        );
        const chatWidgetEnabled = prefRes.rows.length > 0 ? prefRes.rows[0].chat_widget_enabled !== false : true;

        const siteData = {
          title: `@${author.toUpperCase()}'S STATIC PHOTO STREAM`,
          author: author,
          avatarUrl: avatarUrl,
          description: `Personal 90s retro static photo stream published via Neogram`,
          neocitiesUrl: fullSiteUrl,
          pathPrefix: pathPrefix,
          apiUrl: config.appUrl || 'http://localhost:4000',
          systemMood: '[:> SURFING THE RETRO STATIC WEBRING]',
          customCssUrl: customCssUrl,
          chatWidgetEnabled: chatWidgetEnabled,
        };
        const siteJsonPath = path.join(process.cwd(), 'eleventy/src/_data/site.json');
        await fs.writeFile(siteJsonPath, JSON.stringify(siteData, null, 2), 'utf-8');
      }
    }

    // 4. Fetch friends' posts for static /friends/ grid
    let friendsPosts: any[] = [];
    const targetFollowerId = effectiveUserId || userId;
    if (targetFollowerId) {
      const friendsQuery = await query(`
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
          u.uin,
          u.avatar_path as "avatarPath",
          u.site_url as "siteUrl",
          u.deploy_path as "deployPath",
          COALESCE(u.handle, split_part(u.email, '@', 1)) as author
        FROM posts p
        JOIN follows f ON p.user_id = f.following_id
        JOIN users u ON p.user_id = u.id
        WHERE f.follower_id = $1
        ORDER BY p.created_at DESC
      `, [userId]);

      const baseNeogramUrl = config.appUrl || 'http://localhost:4000';
      friendsPosts = friendsQuery.rows.map((row) => {
        let imagePath = row.imagePath;
        let thumbnailPath = row.thumbnailPath;
        const authorSite = row.siteUrl ? row.siteUrl.replace(/\/+$/, '') : '';
        const authorDeploy = (row.deployPath !== null && row.deployPath !== undefined)
          ? String(row.deployPath).trim().replace(/^\/+|\/+$/g, '')
          : 'neogram';
        const authorBase = authorSite 
          ? (authorDeploy ? `${authorSite}/${authorDeploy}` : authorSite)
          : baseNeogramUrl;

        if (imagePath && !imagePath.startsWith('http://') && !imagePath.startsWith('https://')) {
          imagePath = `${authorBase}${imagePath.startsWith('/') ? '' : '/'}${imagePath}`;
        }
        if (thumbnailPath && !thumbnailPath.startsWith('http://') && !thumbnailPath.startsWith('https://')) {
          thumbnailPath = `${authorBase}${thumbnailPath.startsWith('/') ? '' : '/'}${thumbnailPath}`;
        }

        return {
          ...row,
          imagePath,
          thumbnailPath,
          profileUrl: `${baseNeogramUrl}/user/@${encodeURIComponent(row.author)}`,
        };
      });
    }

    const friendsPostsPath = path.join(process.cwd(), 'eleventy/src/_data/friendsPosts.json');
    await fs.writeFile(friendsPostsPath, JSON.stringify(friendsPosts, null, 2), 'utf-8');

    // 5. Write data to eleventy/src/_data/posts.json
    const postsDataPath = path.join(process.cwd(), 'eleventy/src/_data/posts.json');
    await fs.writeFile(postsDataPath, JSON.stringify(posts, null, 2), 'utf-8');

    // 6. Build Comprehensive JSON Feeds for Self-Hosted Static API
    const baseNeogramUrl = config.appUrl || 'http://localhost:4000';
    let fullAvatarUrl = avatarUrl;
    if (fullAvatarUrl && !fullAvatarUrl.startsWith('http://') && !fullAvatarUrl.startsWith('https://')) {
      fullAvatarUrl = `${baseNeogramUrl}${fullAvatarUrl.startsWith('/') ? '' : '/'}${fullAvatarUrl}`;
    }

    const formattedPosts = posts.map((post) => {
      let imageUrl = post.imagePath;
      let thumbnailUrl = post.thumbnailPath;
      if (imageUrl && !imageUrl.startsWith('http://') && !imageUrl.startsWith('https://')) {
        imageUrl = `${fullSiteUrl}${imageUrl.startsWith('/') ? '' : '/'}${imageUrl}`;
      }
      if (thumbnailUrl && !thumbnailUrl.startsWith('http://') && !thumbnailUrl.startsWith('https://')) {
        thumbnailUrl = `${fullSiteUrl}${thumbnailUrl.startsWith('/') ? '' : '/'}${thumbnailUrl}`;
      }

      return {
        id: post.id,
        userId: post.userId,
        caption: post.caption,
        imagePath: post.imagePath,
        thumbnailPath: post.thumbnailPath,
        imageUrl: imageUrl,
        thumbnailUrl: thumbnailUrl,
        filterApplied: post.filterApplied || 'none',
        mood: post.mood || null,
        webring: post.webring || null,
        location: post.location || null,
        likes: parseInt(post.likes, 10) || 0,
        createdAt: post.createdAt,
        commentsCount: (post.comments || []).length,
        comments: post.comments || [],
        commentsUrl: getCommentsRelativePath(post.imagePath),
        actions: {
          likeUrl: `${baseNeogramUrl}/api/posts/${post.id}/like`,
          commentUrl: `${baseNeogramUrl}/api/posts/${post.id}/comments`,
        },
      };
    });

    const feedData = {
      version: 'neogram-api-v1',
      generatedAt: new Date().toISOString(),
      user: {
        id: userId || 'station',
        uin: authorUin,
        handle: author,
        author: author,
        avatarUrl: fullAvatarUrl,
        siteUrl: baseSiteUrl,
        deployPath: rawDeployPath,
        fullSiteUrl: fullSiteUrl,
        statusMessage: statusMessage,
        customCssUrl: customCssUrl,
      },
      endpoints: {
        apiUrl: baseNeogramUrl,
        followUrl: `${baseNeogramUrl}/api/users/${author}/follow`,
        unfollowUrl: `${baseNeogramUrl}/api/users/${author}/follow`,
        guestbookUrl: `${baseNeogramUrl}/api/guestbook/${authorUin || author}`,
        counterUrl: `${baseNeogramUrl}/api/counter/${author}.svg`,
        feedUrl: `${fullSiteUrl}/feed.json`,
      },
      posts: formattedPosts,
      friends: friendsPosts,
    };

    await fs.mkdir(targetOutputDir, { recursive: true });
    const feedJsonOutPath = path.join(targetOutputDir, 'feed.json');
    const postsJsonOutPath = path.join(targetOutputDir, 'posts.json');
    await fs.writeFile(feedJsonOutPath, JSON.stringify(feedData, null, 2), 'utf-8');
    await fs.writeFile(postsJsonOutPath, JSON.stringify(formattedPosts, null, 2), 'utf-8');

    // 7. Invoke Eleventy builder or Headless API mode
    if (shouldBuildHtml) {
      const inputDir = path.join(process.cwd(), 'eleventy/src');
      const configPath = path.join(process.cwd(), 'eleventy/eleventy.config.js');

      process.env.ELEVENTY_OUTPUT_DIR = path.relative(process.cwd(), targetOutputDir);
      process.env.ELEVENTY_PATH_PREFIX = pathPrefix;

      const elev = new Eleventy(inputDir, targetOutputDir, {
        configPath: configPath,
        pathPrefix: pathPrefix,
      });

      await elev.write();

      // Re-ensure self-hosted feed.json and posts.json are preserved in targetOutputDir
      await fs.writeFile(feedJsonOutPath, JSON.stringify(feedData, null, 2), 'utf-8');
      await fs.writeFile(postsJsonOutPath, JSON.stringify(formattedPosts, null, 2), 'utf-8');

      const durationMs = Date.now() - startTime;
      console.log(`[:> 11ty] Static gallery compiled (HTML + JSON): ${posts.length} photos in ${durationMs}ms -> ${targetOutputDir}`);

      return {
        ok: true,
        postsCount: posts.length,
        outputDir: targetOutputDir,
        durationMs,
      };
    } else {
      // Headless API mode: clean up HTML pages/assets, strictly preserving uploads/ and JSON feeds
      await cleanHtmlArtifacts(targetOutputDir);

      // Re-write feed.json and posts.json in targetOutputDir
      await fs.writeFile(feedJsonOutPath, JSON.stringify(feedData, null, 2), 'utf-8');
      await fs.writeFile(postsJsonOutPath, JSON.stringify(formattedPosts, null, 2), 'utf-8');

      const durationMs = Date.now() - startTime;
      console.log(`[:> STATIC-BUILD] Headless API mode active for ${userId || 'station'}: ${posts.length} photos in JSON feeds (${durationMs}ms) -> ${targetOutputDir} (HTML generation skipped)`);

      return {
        ok: true,
        postsCount: posts.length,
        outputDir: targetOutputDir,
        durationMs,
      };
    }
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
  const jobLabel = options.siteId ? `Site:${options.siteId}` : (options.userId ? `User:${options.userId}` : 'Global');
  return buildQueue.enqueue(jobLabel, () => executeStaticBuild(options));
}
