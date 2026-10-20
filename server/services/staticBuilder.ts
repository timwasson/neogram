import path from 'path';
import fs from 'fs/promises';
import Eleventy from '@11ty/eleventy';
import { query, initDatabase } from '../db';

export interface StaticBuildResult {
  ok: boolean;
  postsCount: number;
  outputDir: string;
  error?: string;
  durationMs?: number;
}

/**
 * Builds the static 11ty gallery from current PostgreSQL posts.
 * Outputs to `dist/static-gallery`.
 */
export async function buildStaticGallery(): Promise<StaticBuildResult> {
  const startTime = Date.now();
  try {
    // 0. Ensure database is connected
    await initDatabase();

    // 1. Fetch all posts from PostgreSQL
    const postsQuery = await query(`
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
        split_part(u.email, '@', 1) as author
      FROM posts p
      JOIN users u ON p.user_id = u.id
      ORDER BY p.created_at DESC
    `);

    // 2. Fetch comments for all posts
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

    // 3. Write data to eleventy/src/_data/posts.json
    const postsDataPath = path.join(process.cwd(), 'eleventy/src/_data/posts.json');
    await fs.writeFile(postsDataPath, JSON.stringify(posts, null, 2), 'utf-8');

    // 4. Invoke Eleventy builder
    const inputDir = path.join(process.cwd(), 'eleventy/src');
    const outputDir = path.join(process.cwd(), 'dist/static-gallery');
    const configPath = path.join(process.cwd(), 'eleventy/eleventy.config.js');

    const elev = new Eleventy(inputDir, outputDir, {
      configPath: configPath,
    });

    await elev.write();

    const durationMs = Date.now() - startTime;
    console.log(`[:> 11ty] Static gallery compiled: ${posts.length} photos in ${durationMs}ms -> ${outputDir}`);

    return {
      ok: true,
      postsCount: posts.length,
      outputDir,
      durationMs,
    };
  } catch (err: any) {
    console.error('[:> 11ty ERROR] Static build failed:', err);
    return {
      ok: false,
      postsCount: 0,
      outputDir: 'dist/static-gallery',
      error: err.message || String(err),
      durationMs: Date.now() - startTime,
    };
  }
}
