import { Router, Request, Response } from 'express';
import multer from 'multer';
import { query } from '../db';
import { COOKIE_NAME, verifySessionToken, extractToken } from '../auth/jwt';
import { getUserById } from '../auth/service';
import { processImageBuffer, processBase64Image } from '../services/imageProcessor';

export const postsRouter = Router();

// In-memory multer storage to stream directly to Sharp
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
});

/**
 * Helper to get the authenticated user from the session cookie or Bearer header
 */
async function getSessionUser(req: Request) {
  const token = extractToken(req);
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

    // Trigger auto-deploy if enabled, otherwise rebuild static gallery in background
    const userRes = await query('SELECT auto_deploy FROM users WHERE id = $1', [user.id]);
    if (userRes.rows.length > 0 && userRes.rows[0].auto_deploy) {
      import('../services/neocitiesPublisher')
        .then((m) => m.triggerAutoDeployIfEnabled(user.id))
        .catch((err) => console.error('[:> AUTO-DEPLOY] Hook error:', err));
    } else {
      import('../services/staticBuilder')
        .then((m) => m.buildStaticGallery({ userId: user.id }))
        .catch((err) => console.error('[:> 11ty] Background build error:', err));
    }

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
      RETURNING likes_count as "likes", user_id as "userId"
    `,
      [id]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ ok: false, error: 'Post not found.' });
      return;
    }

    const postOwnerId = result.rows[0].userId;

    // Trigger 11ty static update in background for post owner
    import('../services/staticBuilder')
      .then((m) => m.buildStaticGallery({ userId: postOwnerId }))
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

    // Trigger 11ty static update in background for post owner
    query('SELECT user_id FROM posts WHERE id = $1', [id]).then((pRes) => {
      const ownerId = pRes.rows[0]?.user_id;
      if (ownerId) {
        import('../services/staticBuilder')
          .then((m) => m.buildStaticGallery({ userId: ownerId }))
          .catch(() => {});
      }
    });

    res.status(201).json({
      ok: true,
      message: 'Comment committed to centralized ledger.',
      comment: insertResult.rows[0],
    });
  } catch (err) {
    next(err);
  }
});

/**
 * 6. PUT /api/posts/:id - Edit an existing post (caption, mood, filter, webring, location)
 */
postsRouter.put('/posts/:id', async (req: Request, res: Response, next) => {
  try {
    const { id } = req.params;
    const { caption, mood, webring, location, filterApplied } = req.body;

    const updateResult = await query(
      `
      UPDATE posts
      SET 
        caption = COALESCE($1, caption),
        mood = COALESCE($2, mood),
        webring = COALESCE($3, webring),
        location = COALESCE($4, location),
        filter_applied = COALESCE($5, filter_applied)
      WHERE id = $6
      RETURNING *
    `,
      [caption, mood, webring, location, filterApplied, id]
    );

    if (updateResult.rows.length === 0) {
      res.status(404).json({ ok: false, error: 'Post not found.' });
      return;
    }

    const updated = updateResult.rows[0];

    // Trigger 11ty static rebuild so static gallery immediately reflects edits
    import('../services/staticBuilder')
      .then((m) => m.buildStaticGallery({ userId: updated.user_id }))
      .catch((err) => console.error('[:> 11ty] Rebuild error after edit:', err));

    // Trigger auto-deploy if enabled
    import('../services/neocitiesPublisher')
      .then((m) => m.triggerAutoDeployIfEnabled(updated.user_id))
      .catch((err) => console.error('[:> AUTO-DEPLOY] Hook error:', err));

    res.json({
      ok: true,
      message: 'Post updated successfully.',
      post: {
        id: updated.id,
        imagePath: updated.image_path,
        thumbnailPath: updated.thumbnail_path,
        caption: updated.caption,
        filterApplied: updated.filter_applied,
        mood: updated.mood,
        webring: updated.webring,
        location: updated.location,
        likes: updated.likes_count,
        createdAt: updated.created_at,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * 7. DELETE /api/posts/:id - Delete post from database, remove assets, and rebuild static gallery
 */
postsRouter.delete('/posts/:id', async (req: Request, res: Response, next) => {
  try {
    const { id } = req.params;

    // 1. Fetch post to get image and thumbnail paths for disk cleanup
    const postQuery = await query('SELECT user_id, image_path, thumbnail_path FROM posts WHERE id = $1', [id]);
    if (postQuery.rows.length === 0) {
      res.status(404).json({ ok: false, error: 'Post not found.' });
      return;
    }

    const { user_id, image_path, thumbnail_path } = postQuery.rows[0];

    // 2. Delete post row from PostgreSQL (comments cascade delete)
    await query('DELETE FROM posts WHERE id = $1', [id]);

    // 3. Remove files from public/uploads if they exist
    const fs = await import('fs/promises');
    const path = await import('path');

    if (image_path && image_path.startsWith('/uploads/')) {
      const fullImgPath = path.join(process.cwd(), 'public', image_path);
      fs.unlink(fullImgPath).catch(() => {});
    }
    if (thumbnail_path && thumbnail_path.startsWith('/uploads/')) {
      const fullThumbPath = path.join(process.cwd(), 'public', thumbnail_path);
      fs.unlink(fullThumbPath).catch(() => {});
    }

    // 4. Trigger 11ty static rebuild so the static gallery no longer contains the deleted post
    if (user_id) {
      import('../services/staticBuilder')
        .then((m) => m.buildStaticGallery({ userId: user_id }))
        .catch((err) => console.error('[:> 11ty] Rebuild error after delete:', err));
    }

    // Trigger auto-deploy if enabled
    if (user_id) {
      import('../services/neocitiesPublisher')
        .then((m) => m.triggerAutoDeployIfEnabled(user_id))
        .catch((err) => console.error('[:> AUTO-DEPLOY] Hook error:', err));
    }

    res.json({
      ok: true,
      message: 'Post deleted successfully from database and static archive.',
      id,
    });
  } catch (err) {
    next(err);
  }
});
