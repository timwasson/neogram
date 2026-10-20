import { Router, Request, Response } from 'express';
import multer from 'multer';
import { query } from '../db';
import { COOKIE_NAME, verifySessionToken } from '../auth/jwt';
import { getUserById } from '../auth/service';
import { processImageBuffer, processBase64Image } from '../services/imageProcessor';

export const postsRouter = Router();

// In-memory multer storage to stream directly to Sharp
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
});

/**
 * Helper to get the authenticated user from the session cookie
 */
async function getSessionUser(req: Request) {
  const token = req.cookies[COOKIE_NAME];
  if (!token) return null;
  const payload = verifySessionToken(token);
  if (!payload) return null;
  return getUserById(payload.userId);
}

/**
 * 1. GET /api/posts - Fetch all posts with user metadata & comments
 */
postsRouter.get('/posts', async (_req: Request, res: Response, next) => {
  try {
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

    // Fetch comments for all posts
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

    // Group comments by postId
    const commentsByPost: Record<string, any[]> = {};
    for (const c of commentsQuery.rows) {
      if (!commentsByPost[c.postId]) commentsByPost[c.postId] = [];
      commentsByPost[c.postId].push(c);
    }

    const posts = postsQuery.rows.map((post) => ({
      ...post,
      comments: commentsByPost[post.id] || [],
    }));

    res.json({ ok: true, posts });
  } catch (err) {
    next(err);
  }
});

/**
 * 2. GET /api/posts/:id - Fetch single post with full comments
 */
postsRouter.get('/posts/:id', async (req: Request, res: Response, next) => {
  try {
    const { id } = req.params;
    const postQuery = await query(
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
        split_part(u.email, '@', 1) as author
      FROM posts p
      JOIN users u ON p.user_id = u.id
      WHERE p.id = $1
    `,
      [id]
    );

    if (postQuery.rows.length === 0) {
      res.status(404).json({ ok: false, error: 'Post not found.' });
      return;
    }

    const post = postQuery.rows[0];

    const commentsQuery = await query(
      `
      SELECT 
        id,
        author_name as "author",
        author_avatar as "avatar",
        body as "text",
        created_at as "timestamp"
      FROM comments
      WHERE post_id = $1
      ORDER BY created_at ASC
    `,
      [id]
    );

    post.comments = commentsQuery.rows;

    res.json({ ok: true, post });
  } catch (err) {
    next(err);
  }
});

/**
 * 3. POST /api/posts - Authenticated Direct Photo Upload & Publishing
 */
postsRouter.post('/posts', upload.single('imageFile'), async (req: Request, res: Response, next) => {
  try {
    let user = await getSessionUser(req);

    // Fallback: if not logged in via cookie, find or create the root demo user
    if (!user) {
      const existing = await query('SELECT * FROM users ORDER BY created_at ASC LIMIT 1');
      if (existing.rows.length > 0) {
        user = existing.rows[0];
      }
    }

    if (!user) {
      res.status(401).json({ ok: false, error: 'Authentication required to publish photos.' });
      return;
    }

    const { caption, filterApplied, mood, webring, location, imageBase64 } = req.body;
    let processed;

    if (req.file) {
      // Multipart file upload from disk or mobile camera
      processed = await processImageBuffer(req.file.buffer, filterApplied);
    } else if (imageBase64) {
      // Base64 data URL from canvas or preset sprites
      processed = await processBase64Image(imageBase64, filterApplied);
    } else {
      res.status(400).json({ ok: false, error: 'No image provided. Please select an image or photo.' });
      return;
    }

    const insertResult = await query(
      `
      INSERT INTO posts (user_id, image_path, thumbnail_path, caption, filter_applied, mood, webring, location)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `,
      [
        user.id,
        processed.imagePath,
        processed.thumbnailPath,
        caption || ':> Snapshot transmitted via Neogram workstation.',
        filterApplied || 'none',
        mood || '[:> VIBING IN 90s CYBERSPACE]',
        webring || 'unix.hackers.retro',
        location || 'Neogram Node // 1996',
      ]
    );

    const newPost = insertResult.rows[0];

    // Trigger 11ty static compilation in background
    import('../services/staticBuilder')
      .then((m) => m.buildStaticGallery())
      .catch((err) => console.error('[:> 11ty] Background build error:', err));

    res.status(201).json({
      ok: true,
      message: 'Photo published successfully via Neogram pipeline.',
      post: {
        id: newPost.id,
        userId: newPost.user_id,
        imagePath: newPost.image_path,
        thumbnailPath: newPost.thumbnail_path,
        caption: newPost.caption,
        filterApplied: newPost.filter_applied,
        mood: newPost.mood,
        webring: newPost.webring,
        location: newPost.location,
        likes: newPost.likes_count,
        createdAt: newPost.created_at,
        author: user.email.split('@')[0],
        comments: [],
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * 4. POST /api/posts/:id/like - Increment Like / Radical Counter
 */
postsRouter.post('/posts/:id/like', async (req: Request, res: Response, next) => {
  try {
    const { id } = req.params;
    const result = await query(
      `
      UPDATE posts 
      SET likes_count = likes_count + 1 
      WHERE id = $1 
      RETURNING likes_count as "likes"
    `,
      [id]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ ok: false, error: 'Post not found.' });
      return;
    }

    // Trigger 11ty static update in background
    import('../services/staticBuilder')
      .then((m) => m.buildStaticGallery())
      .catch(() => {});

    res.json({ ok: true, likes: result.rows[0].likes });
  } catch (err) {
    next(err);
  }
});

/**
 * 5. POST /api/posts/:id/comments - Post a centralized comment from static embeds / gallery
 */
postsRouter.post('/posts/:id/comments', async (req: Request, res: Response, next) => {
  try {
    const { id } = req.params;
    const { authorName, author, text } = req.body;
    const finalAuthor = (authorName || author || 'guest_surfer').trim();

    if (!text || !text.trim()) {
      res.status(400).json({ ok: false, error: 'Comment body cannot be empty.' });
      return;
    }

    const insertResult = await query(
      `
      INSERT INTO comments (post_id, author_name, body)
      VALUES ($1, $2, $3)
      RETURNING id, author_name as "author", author_avatar as "avatar", body as "text", created_at as "timestamp"
    `,
      [id, finalAuthor, text.trim()]
    );

    // Trigger 11ty static update in background
    import('../services/staticBuilder')
      .then((m) => m.buildStaticGallery())
      .catch(() => {});

    res.status(201).json({
      ok: true,
      message: 'Comment committed to centralized ledger.',
      comment: insertResult.rows[0],
    });
  } catch (err) {
    next(err);
  }
});
