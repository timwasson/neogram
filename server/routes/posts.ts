import { Router, Request, Response } from 'express';
import multer from 'multer';
import { query } from '../db';
import { COOKIE_NAME, verifySessionToken, extractToken } from '../auth/jwt';
import { getUserById } from '../auth/service';
import { processImageBuffer, processBase64Image } from '../services/imageProcessor';

export const postsRouter = Router();

// In-memory multer storage to stream directly to Sharp (25MB limit for high-res camera snaps)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

function handleUploadMiddleware(req: Request, res: Response, next: any) {
  upload.single('imageFile')(req, res, (err: any) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        res.status(400).json({ ok: false, error: 'Photo exceeds maximum allowed size (25MB limit).' });
        return;
      }
      res.status(400).json({ ok: false, error: `Upload error: ${err.message}` });
      return;
    } else if (err) {
      res.status(400).json({ ok: false, error: err.message });
      return;
    }
    next();
  });
}

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
postsRouter.post('/posts', handleUploadMiddleware, async (req: Request, res: Response, next) => {
  try {
    const user = await getSessionUser(req);

    if (!user) {
      res.status(401).json({ ok: false, error: 'Authentication required. Please dial into your terminal session to publish photos.' });
      return;
    }

    // 1. Check user static host configuration
    const userDbRes = await query('SELECT deployment_credentials, site_url, handle, auto_deploy, deploy_path FROM users WHERE id = $1', [user.id]);
    const userRow = userDbRes.rows[0];
    const { decryptCredentials } = await import('../utils/crypto');
    const creds = decryptCredentials<any>(userRow?.deployment_credentials);
    const hasApiKey = !!(creds && creds.apiKey);

    if (!hasApiKey && process.env.NODE_ENV === 'production') {
      res.status(400).json({
        ok: false,
        error: 'Neocities host not connected. Please connect your Neocities API key in Settings so Neogram can publish your photos directly to your personal site.'
      });
      return;
    }

    const { caption, filterApplied, mood, webring, location, imageBase64 } = req.body;
    let processed;

    // 2. Ephemeral staging directly in the user's isolated static build directory
    const path = await import('path');
    const userStaticDir = path.join(process.cwd(), 'dist', 'static-galleries', user.id);
    const targetUploadsDir = hasApiKey ? path.join(userStaticDir, 'uploads') : undefined;

    if (req.file) {
      // Multipart file upload from disk or mobile camera
      processed = await processImageBuffer(req.file.buffer, filterApplied, targetUploadsDir);
    } else if (imageBase64) {
      // Base64 data URL from canvas or preset sprites
      processed = await processBase64Image(imageBase64, filterApplied, targetUploadsDir);
    } else {
      res.status(400).json({ ok: false, error: 'No image provided. Please select an image or photo.' });
      return;
    }

    // 3. Resolve live Neocities image URLs with deploy_path subdirectory if host connected
    const siteBase = creds?.siteName
      ? `https://${creds.siteName}.neocities.org`
      : (userRow.site_url ? userRow.site_url.replace(/\/+$/, '') : `https://${user.handle || 'user'}.neocities.org`);

    const rawDeployPath = userRow?.deploy_path !== null && userRow?.deploy_path !== undefined
      ? String(userRow.deploy_path).trim().replace(/^\/+|\/+$/g, '')
      : 'neogram';
    const deployPrefix = rawDeployPath ? `/${rawDeployPath}` : '';

    const finalImagePath = hasApiKey
      ? `${siteBase}${deployPrefix}${processed.imagePath}`
      : processed.imagePath;

    const finalThumbPath = hasApiKey
      ? `${siteBase}${deployPrefix}${processed.thumbnailPath}`
      : processed.thumbnailPath;

    // 4. Commit post record to PostgreSQL
    const insertResult = await query(
      `
      INSERT INTO posts (user_id, image_path, thumbnail_path, caption, filter_applied, mood, webring, location)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `,
      [
        user.id,
        finalImagePath,
        finalThumbPath,
        caption || ':> Snapshot transmitted via Neogram workstation.',
        filterApplied || 'none',
        mood || null,
        webring || null,
        location || null,
      ]
    );

    const newPost = insertResult.rows[0];

    // 5. Build static gallery and deploy immediately to Neocities if connected
    if (hasApiKey) {
      const { deployToNeocities } = await import('../services/neocitiesPublisher');
      // deployToNeocities automatically builds 11ty, uploads all assets (HTML, CSS, WebP images),
      // and purges the local uploads directory upon confirmation!
      await deployToNeocities(user.id);
      console.log(`[:> ZERO-RETENTION PIPELINE] Deployed live to Neocities and purged local disk assets for user ${user.id}`);
    } else {
      const { buildStaticGallery } = await import('../services/staticBuilder');
      await buildStaticGallery({ userId: user.id });
    }

    res.status(201).json({
      ok: true,
      message: hasApiKey
        ? 'Photo published live to your Neocities site!'
        : 'Photo published successfully via Neogram pipeline.',
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
    const user = await getSessionUser(req);
    if (!user) {
      res.status(401).json({ ok: false, error: 'Authentication required to modify records.' });
      return;
    }

    const { id } = req.params;

    // Check post exists and verify ownership
    const postCheck = await query('SELECT user_id FROM posts WHERE id = $1', [id]);
    if (postCheck.rows.length === 0) {
      res.status(404).json({ ok: false, error: 'Post not found in terminal registry.' });
      return;
    }

    if (postCheck.rows[0].user_id !== user.id) {
      res.status(403).json({ ok: false, error: 'Access denied: You are not authorized to edit this station post.' });
      return;
    }

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
    const user = await getSessionUser(req);
    if (!user) {
      res.status(401).json({ ok: false, error: 'Authentication required to purge records.' });
      return;
    }

    const { id } = req.params;

    // 1. Fetch post to verify ownership and get image and thumbnail paths for disk cleanup
    const postQuery = await query('SELECT user_id, image_path, thumbnail_path FROM posts WHERE id = $1', [id]);
    if (postQuery.rows.length === 0) {
      res.status(404).json({ ok: false, error: 'Post not found in terminal registry.' });
      return;
    }

    const { user_id, image_path, thumbnail_path } = postQuery.rows[0];

    if (user_id !== user.id) {
      res.status(403).json({ ok: false, error: 'Access denied: You are not authorized to delete this station post.' });
      return;
    }

    // 2. Delete post row from PostgreSQL (comments cascade delete)
    await query('DELETE FROM posts WHERE id = $1', [id]);

    // 3. Purge remote files from Neocities if post was hosted on Neocities
    if (image_path && (image_path.includes('.neocities.org') || image_path.includes('/uploads/'))) {
      const { deleteFromNeocities } = await import('../services/neocitiesPublisher');
      const cleanRel = (p: string) => p.replace(/^https?:\/\/[^\/]+\//, '').replace(/^\/+/, '');
      const filesToDelete = [
        image_path ? cleanRel(image_path) : null,
        thumbnail_path ? cleanRel(thumbnail_path) : null
      ].filter(Boolean) as string[];

      deleteFromNeocities(user.id, filesToDelete).catch((err) => {
        console.warn('[:> NEOCITIES DELETE] Warning: could not purge remote files:', err);
      });
    }

    // Remove legacy local files from public/uploads if they exist
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
