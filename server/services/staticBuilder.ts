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
 * Builds the static 11ty gallery from PostgreSQL posts.
 * Can filter to a specific user's posts for their personal Neocities site,
 * or build all posts for the global studio preview.
 */
export async function buildStaticGallery(options: StaticBuildOptions = {}): Promise<StaticBuildResult> {
  const startTime = Date.now();
  try {
    // 0. Ensure database is connected
    await initDatabase();

    const { userId } = options;
    const defaultOutputDir = path.join(process.cwd(), 'dist/static-gallery');
    const targetOutputDir = options.outputDir || defaultOutputDir;

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

    // 3. Update site.json metadata if building for specific user
    if (userId) {
      const userRes = await query('SELECT id, email, handle, site_url FROM users WHERE id = $1', [userId]);
      if (userRes.rows.length > 0) {
        const u = userRes.rows[0];
        const author = u.handle || u.email.split('@')[0];
        const siteData = {
          title: `@${author.toUpperCase()}'S STATIC PHOTO STREAM`,
          author: author,
          description: `Personal 90s retro static photo stream published via Neogram`,
          neocitiesUrl: u.site_url || `https://${author}.neocities.org`,
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

    // 5. Invoke Eleventy builder to target output directory
    const inputDir = path.join(process.cwd(), 'eleventy/src');
    const configPath = path.join(process.cwd(), 'eleventy/eleventy.config.js');

    const elev = new Eleventy(inputDir, targetOutputDir, {
      configPath: configPath,
    });

    await elev.write();

    // If targetOutputDir was a custom user folder, also compile/refresh default dist/static-gallery
    if (targetOutputDir !== defaultOutputDir) {
      const defaultElev = new Eleventy(inputDir, defaultOutputDir, {
        configPath: configPath,
      });
      await defaultElev.write();
    }

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
      outputDir: options.outputDir || 'dist/static-gallery',
      error: err.message || String(err),
      durationMs: Date.now() - startTime,
    };
  }
}
