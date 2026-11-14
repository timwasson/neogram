import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import multer from 'multer';
import { config } from '../config';
import rateLimit from 'express-rate-limit';
import { query } from '../db';
import { COOKIE_NAME, verifySessionToken, extractToken } from '../auth/jwt';
import { getUserById } from '../auth/service';
import { processImageBuffer, processBase64Image } from '../services/imageProcessor';
import {
  getAllPosts,
  getPostsForSite,
  getPostsForUser,
  getPostById,
  savePost,
  updatePost,
  deletePost,
  PostRecord,
} from '../services/postStorage';

export const postsRouter = Router();

// In-memory multer storage to stream directly to Sharp (25MB limit per file snap, up to 5 files per gallery)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 5 },
  // Raster images only (SVG excluded: no scriptable/remote-reference formats are ever decoded)
  fileFilter: (_req, file, cb) => {
    if (/^image\/(jpeg|png|webp|gif|heic|heif|avif|bmp|tiff)$/i.test(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', file.fieldname));
    }
  },
});

function handleUploadMiddleware(req: Request, res: Response, next: any) {
  upload.fields([
    { name: 'imageFiles', maxCount: 5 },
    { name: 'imageFile', maxCount: 1 },
    { name: 'photos', maxCount: 5 },
  ])(req, res, (err: any) => {
    if (err && (err instanceof multer.MulterError || err.name === 'MulterError' || err.code?.startsWith('LIMIT_'))) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        res.status(400).json({ ok: false, error: 'Photo exceeds maximum allowed size (25MB limit per file).' });
        return;
      }
      if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE' || err.message?.includes('Unexpected')) {
        res.status(400).json({ ok: false, error: 'Maximum of 5 photos allowed per gallery post.' });
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
async function getSessionUser(req: Request, allowPass: boolean = false) {
  const token = extractToken(req);
  if (!token) return null;
  // Scoped Cyber-Pass tokens (third-party static sites) are only honoured when the route opts in.
  const payload = verifySessionToken(token, allowPass);
  if (!payload) return null;
  return getUserById(payload.userId);
}

const BANNED_ERROR = 'This account has been suspended.';

/**
 * 1. GET /api/posts - Fetch all posts with user metadata & comments from static JSON
 */
postsRouter.get('/posts', async (req: Request, res: Response, next) => {
  try {
    const siteIdFilter = (req.query.siteId as string) || '';
    const userIdFilter = (req.query.userId as string) || '';
    const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if ((siteIdFilter && (typeof siteIdFilter !== 'string' || !ID_RE.test(siteIdFilter))) ||
        (userIdFilter && (typeof userIdFilter !== 'string' || !ID_RE.test(userIdFilter)))) {
      res.status(400).json({ ok: false, error: 'siteId / userId must be a valid identifier.' });
      return;
    }

    let posts: PostRecord[] = [];
    if (siteIdFilter) {
      posts = await getPostsForSite(siteIdFilter);
    } else if (userIdFilter) {
      posts = await getPostsForUser(userIdFilter);
    } else {
      posts = await getAllPosts();
    }

    res.json({ ok: true, posts });
  } catch (err) {
    next(err);
  }
});

/**
 * 2. GET /api/posts/:id - Fetch single post with full comments from static JSON
 */
postsRouter.get('/posts/:id', async (req: Request, res: Response, next) => {
  try {
    const { id } = req.params;
    const post = await getPostById(id);

    if (!post) {
      res.status(404).json({ ok: false, error: 'Post not found.' });
      return;
    }

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

    if (!user || user.isBanned) {
      res.status(user?.isBanned ? 403 : 401).json({
        ok: false,
        error: user?.isBanned
          ? 'This account has been suspended, so posting is turned off.'
          : 'Authentication required. Please dial into your terminal session to publish photos.',
      });
      return;
    }

    // 1. Resolve target site configuration (from siteId parameter or user's default site)
    const reqSiteId = req.body.siteId || (req.headers['x-neogram-site-id'] as string) || (req.query.siteId as string);
    const { getDefaultSite, getSiteById } = await import('../services/siteService');
    let targetSite = reqSiteId ? await getSiteById(reqSiteId, user.id) : null;
    if (!targetSite) {
      targetSite = await getDefaultSite(user.id);
    }

    if (!targetSite) {
      res.status(400).json({
        ok: false,
        error: 'No static site target mounted. Please add a static site target in Settings to publish photos.',
      });
      return;
    }

    const hasApiKey = targetSite.hasApiKey;
    // Photos are only ever stored on the member's own host. Accounts without a
    // connected, credentialed site can like, comment and chat, but not upload.
    if (!hasApiKey || !targetSite.siteUrl || targetSite.deploymentType === 'none') {
      res.status(400).json({
        ok: false,
        needsSite: true,
        error: 'Connect your website (Neocities, Nekoweb or GitHub Pages) in Settings before posting photos. Photos are published to your site, not stored on Neogram.',
      });
      return;
    }

    const { caption, filterApplied, mood, webring, location, imageBase64 } = req.body;
    const allowedFilters = ['none', 'crt', 'sepia', 'vga', 'gameboy', 'cyberpunk'];
    const safeFilter = typeof filterApplied === 'string' && allowedFilters.includes(filterApplied.toLowerCase())
      ? filterApplied.toLowerCase()
      : 'none';
    const safeCaption = typeof caption === 'string' && caption.trim()
      ? caption.trim().slice(0, 1000)
      : ':> Snapshot transmitted via Neogram workstation.';
    const safeMood = typeof mood === 'string' && mood.trim() ? mood.trim().slice(0, 50) : null;
    const safeWebring = typeof webring === 'string' && webring.trim() ? webring.trim().slice(0, 50) : null;
    const safeLocation = typeof location === 'string' && location.trim() ? location.trim().slice(0, 100) : null;

    // 2. Ephemeral staging directly in the site's isolated static build directory
    const path = await import('path');
    const userStaticDir = path.join(process.cwd(), 'dist', 'static-galleries', targetSite.id);
    const targetUploadsDir = hasApiKey ? path.join(userStaticDir, 'uploads') : undefined;

    const uploadedFiles: Express.Multer.File[] = [];
    if (req.files) {
      if (Array.isArray(req.files)) {
        uploadedFiles.push(...req.files);
      } else {
        const filesMap = req.files as Record<string, Express.Multer.File[]>;
        if (filesMap['imageFiles']) uploadedFiles.push(...filesMap['imageFiles']);
        if (filesMap['imageFile']) uploadedFiles.push(...filesMap['imageFile']);
        if (filesMap['photos']) uploadedFiles.push(...filesMap['photos']);
      }
    }
    if (req.file) {
      uploadedFiles.push(req.file);
    }

    if (uploadedFiles.length > 5) {
      res.status(400).json({ ok: false, error: 'Maximum of 5 photos allowed per gallery post.' });
      return;
    }

    const processedList = [];

    if (uploadedFiles.length > 0) {
      // Process up to 5 photos with Sharp (zero server-side filter manipulation)
      for (const file of uploadedFiles) {
        const proc = await processImageBuffer(file.buffer, targetUploadsDir);
        processedList.push(proc);
      }
    } else if (imageBase64) {
      // Base64 data URL from canvas or preset sprites (limit max base64 length to prevent memory attacks: 35MB)
      if (typeof imageBase64 !== 'string' || imageBase64.length > 35 * 1024 * 1024) {
        res.status(400).json({ ok: false, error: 'Base64 image payload exceeds size limits.' });
        return;
      }
      const proc = await processBase64Image(imageBase64, targetUploadsDir);
      processedList.push(proc);
    } else {
      res.status(400).json({ ok: false, error: 'No image provided. Please select an image or photo.' });
      return;
    }

    // 3. Resolve live static host image URLs with deploy_path subdirectory if host connected
    const hostDomain = targetSite.deploymentType === 'nekoweb' ? 'nekoweb.org' : 'neocities.org';
    const siteBase = targetSite.siteUrl
      ? targetSite.siteUrl.replace(/\/+$/, '')
      : (targetSite.siteName
          ? `https://${targetSite.siteName}.${hostDomain}`
          : `https://${user.handle || 'user'}.${hostDomain}`);

    const rawDeployPath = targetSite.deployPath !== null && targetSite.deployPath !== undefined
      ? String(targetSite.deployPath).trim().replace(/^\/+|\/+$/g, '')
      : 'neogram';
    const deployPrefix = rawDeployPath
      ? (siteBase.toLowerCase().endsWith(`/${rawDeployPath.toLowerCase()}`) ? '' : `/${rawDeployPath}`)
      : '';

    const photosList = processedList.map((proc) => {
      const finalImg = hasApiKey
        ? `${siteBase}${deployPrefix}${proc.imagePath}`
        : proc.imagePath;
      const finalThumb = hasApiKey
        ? `${siteBase}${deployPrefix}${proc.thumbnailPath}`
        : proc.thumbnailPath;
      return {
        imagePath: finalImg,
        thumbnailPath: finalThumb,
        width: proc.width,
        height: proc.height,
      };
    });

    const finalImagePath = photosList[0].imagePath;
    const finalThumbPath = photosList[0].thumbnailPath;

    // 4. Save post record to static storage
    const postId = crypto.randomUUID();
    const newPost: PostRecord = {
      id: postId,
      userId: user.id,
      siteId: targetSite.id,
      siteName: targetSite.name,
      siteSlug: targetSite.slug,
      imagePath: finalImagePath,
      thumbnailPath: finalThumbPath,
      photos: photosList,
      caption: safeCaption,
      filterApplied: safeFilter,
      mood: safeMood,
      webring: safeWebring,
      location: safeLocation,
      likes: 0,
      createdAt: new Date().toISOString(),
      handle: user.handle,
      author: user.handle || user.email.split('@')[0],
      comments: [],
    };
    await savePost(newPost);

    // Pre-initialize empty comments JSON on static bundle so client doesn't 404
    try {
      const { getCommentsRelativePath } = await import('../services/staticStorage');
      const commentsRelPath = getCommentsRelativePath(newPost.imagePath);
      const initialCommentsPath = path.join(userStaticDir, commentsRelPath);
      await (await import('fs/promises')).mkdir(path.dirname(initialCommentsPath), { recursive: true });
      await (await import('fs/promises')).writeFile(
        initialCommentsPath,
        JSON.stringify({
          version: 'neogram-comments-v1',
          postId: newPost.id,
          updatedAt: new Date().toISOString(),
          comments: [],
        }, null, 2),
        'utf-8'
      );
    } catch (_initErr) {
      console.warn('[:> STATIC-STORAGE] Could not write initial comments file:', _initErr);
    }

    // 5. High-speed incremental build and delta deploy
    const isFirstDeploy = !targetSite.lastDeployedAt;
    try {
      if (isFirstDeploy && hasApiKey) {
        if (targetSite.deploymentType === 'nekoweb') {
          const { deployToNekoweb } = await import('../services/nekowebPublisher');
          await deployToNekoweb(targetSite.id, true);
          console.log(`[:> INITIAL DEPLOY] Deployed baseline static assets to Nekoweb for site ${targetSite.id}`);
        } else if (targetSite.deploymentType === 'github') {
          const { deployToGitHub } = await import('../services/githubPublisher');
          await deployToGitHub(targetSite.id, true);
          console.log(`[:> INITIAL DEPLOY] Deployed baseline static assets to GitHub Pages for site ${targetSite.id}`);
        } else {
          const { deployToNeocities } = await import('../services/neocitiesPublisher');
          await deployToNeocities(targetSite.id, true);
          console.log(`[:> INITIAL DEPLOY] Deployed baseline static assets to Neocities for site ${targetSite.id}`);
        }
      } else {
        const { buildAndDeployNewPhoto } = await import('../services/incrementalBuilder');
        await buildAndDeployNewPhoto({
          siteId: targetSite.id,
          userId: user.id,
          postId: newPost.id,
          imagePath: newPost.imagePath,
          thumbnailPath: newPost.thumbnailPath,
          photos: photosList,
        });
      }
    } catch (deployErr: any) {
      console.error(`[:> DEPLOY ERROR] Live deployment failed during publish for site ${targetSite.id}:`, deployErr);
      const hostName = targetSite.deploymentType === 'github' ? 'GitHub Pages' : (targetSite.deploymentType === 'nekoweb' ? 'Nekoweb' : 'Neocities');
      res.status(502).json({
        ok: false,
        error: `Photo processed and saved to local station, but deployment to ${hostName} failed: ${deployErr.message || 'Remote carrier error'}. Please check your credentials in Settings & Deploy.`,
      });
      return;
    }

    // 6. Cascading rebuild of all friends/followers who follow this user
    triggerFollowersCascade(user.id);

    // 7. Dispatch friend_post notifications to followers
    query(
      'SELECT follower_id as "followerId" FROM follows WHERE following_id = $1',
      [user.id]
    ).then((followersRes) => {
      if (followersRes.rows.length > 0) {
        import('../services/notificationService').then((m) => {
          for (const row of followersRes.rows) {
            m.dispatchNotification({
              userId: row.followerId,
              actorId: user.id,
              type: 'friend_post',
              title: `Friend @${user.handle || 'friend'} broadcast a new photo!`,
              body: newPost.caption ? newPost.caption.slice(0, 150) : 'Check out the new transmission on your Friends stream.',
              linkUrl: '/friends',
              icon: '📸',
            }).catch(() => {});
          }
        }).catch(() => {});
      }
    }).catch(() => {});

    res.status(201).json({
      ok: true,
      message: `Published to your ${targetSite.deploymentType === 'nekoweb' ? 'Nekoweb' : (targetSite.deploymentType === 'github' ? 'GitHub Pages' : 'Neocities')} site. It may take a few seconds to appear.`,
      post: {
        id: newPost.id,
        userId: newPost.userId,
        siteId: newPost.siteId,
        siteName: targetSite.name,
        siteSlug: targetSite.slug,
        imagePath: newPost.imagePath,
        thumbnailPath: newPost.thumbnailPath,
        photos: photosList,
        caption: newPost.caption,
        filterApplied: newPost.filterApplied,
        mood: newPost.mood,
        webring: newPost.webring,
        location: newPost.location,
        likes: newPost.likes,
        createdAt: newPost.createdAt,
        author: user.handle || user.email.split('@')[0],
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
// Likes: 40 per minute per IP (in addition to the global API limiter) to stop scripted inflation.
const likeRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Carrier busy: Too many reactions. Please slow down.' },
  skip: (req) => (req.headers['x-test-suite'] === 'true' && process.env.NODE_ENV !== 'production') || process.env.NODE_ENV === 'test',
});

// Coalesce static rebuild+deploy for rapid likes on the same post (trailing edge, 20s) so a burst
// of reactions costs ONE remote deploy instead of one per like.
const LIKE_REBUILD_DEBOUNCE_MS = 20_000;
const pendingLikeRebuilds = new Map<string, NodeJS.Timeout>();

function scheduleLikeRebuild(postId: string, siteId: string | undefined, userId: string): void {
  const existing = pendingLikeRebuilds.get(postId);
  if (existing) return; // a rebuild is already queued and will pick up the latest likes count
  const timer = setTimeout(() => {
    pendingLikeRebuilds.delete(postId);
    import('../services/incrementalBuilder')
      .then((m) => m.buildAndDeployComment({ siteId, userId, postId }))
      .catch((err) => console.error('[:> INCREMENTAL LIKE ERROR]', err));
  }, process.env.NODE_ENV === 'test' ? 0 : LIKE_REBUILD_DEBOUNCE_MS);
  timer.unref?.();
  pendingLikeRebuilds.set(postId, timer);
}

/** Stable per-visitor key: authenticated user id, otherwise a keyed hash of the IP (no raw IPs stored). */
function likeVoterKey(req: Request, userId?: string): string {
  if (userId) return `u:${userId}`;
  const h = crypto.createHmac('sha256', config.jwtSecret).update(String(req.ip || 'unknown')).digest('hex');
  return `ip:${h.slice(0, 40)}`;
}

/**
 * 4. POST /api/posts/:id/like - Increment Like / Radical Counter (one per user or visitor IP per post)
 */
postsRouter.post('/posts/:id/like', likeRateLimiter, async (req: Request, res: Response, next) => {
  try {
    const { id } = req.params;
    if (!/^[0-9a-zA-Z_-]{1,64}$/.test(id)) {
      res.status(400).json({ ok: false, error: 'Invalid post id.' });
      return;
    }

    const existingPost = await getPostById(id);
    if (!existingPost) {
      res.status(404).json({ ok: false, error: 'Post not found.' });
      return;
    }

    const liker = await getSessionUser(req, true);
    if (liker?.isBanned) {
      res.status(403).json({ ok: false, error: BANNED_ERROR });
      return;
    }
    const voterKey = likeVoterKey(req, liker?.id);

    const inserted = await query(
      'INSERT INTO post_likes (post_id, voter_key) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING post_id',
      [id, voterKey]
    );
    if (inserted.rows.length === 0) {
      // Duplicate vote: idempotent no-op (no counter bump, no rebuild, no notification)
      res.json({ ok: true, likes: existingPost.likes || 0, alreadyLiked: true });
      return;
    }

    const updatedPost = await updatePost(id, (p) => ({
      ...p,
      likes: (p.likes || 0) + 1,
    }));

    if (!updatedPost) {
      res.status(404).json({ ok: false, error: 'Post not found.' });
      return;
    }

    const postOwnerId = updatedPost.userId;

    // Debounced incremental static update + deploy for the post owner
    scheduleLikeRebuild(id, updatedPost.siteId, postOwnerId);

    // Dispatch like notification to photo owner
    if (!liker || liker.id !== postOwnerId) {
      import('../services/notificationService').then((m) => {
        m.dispatchNotification({
          userId: postOwnerId,
          actorId: liker?.id || null,
          type: 'like',
          title: `${liker?.handle ? '@' + liker.handle : 'A visitor'} thought your photo was RADICAL! ⚡`,
          body: 'Received a new like on your photo transmission.',
          linkUrl: `/#photo-${id}`,
          icon: '⚡',
        }).catch(() => {});
      }).catch(() => {});
    }

    res.json({ ok: true, likes: updatedPost.likes });
  } catch (err) {
    next(err);
  }
});

// Rate limiting for comments (max 15 comments per 5 minutes per IP)
const commentRateLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Carrier busy: Too many comments submitted. Please wait 5 minutes.' },
  skip: (req) => (req.headers['x-test-suite'] === 'true' && process.env.NODE_ENV !== 'production') || process.env.NODE_ENV === 'test',
});

/**
 * 5. POST /api/posts/:id/comments - Post a comment to self-hosted comments.json on static host
 */
postsRouter.post('/posts/:id/comments', commentRateLimiter, async (req: Request, res: Response, next) => {
  try {

    const { id } = req.params;
    const { text } = req.body;

    // Verify authenticated Neogram user (Cyber-Pass token or session)
    const user = await getSessionUser(req, true);
    if (!user || user.isBanned) {
      res.status(user?.isBanned ? 403 : 401).json({
        ok: false,
        error: user?.isBanned
          ? 'This account has been suspended, so commenting is turned off.'
          : 'Authentication required. Please connect your Neogram Cyber-Pass to leave a comment.',
      });
      return;
    }

    if (!text || !text.trim()) {
      res.status(400).json({ ok: false, error: 'Comment body cannot be empty.' });
      return;
    }
    const cleanText = text.trim().slice(0, 1000);

    // Fetch target post from static storage
    const post = await getPostById(id);
    if (!post) {
      res.status(404).json({ ok: false, error: 'Post not found in terminal registry.' });
      return;
    }

    // Fetch post owner and target site to access deployment credentials
    const ownerRes = await query('SELECT * FROM users WHERE id = $1', [post.userId]);
    if (ownerRes.rows.length === 0) {
      res.status(404).json({ ok: false, error: 'Post owner not found.' });
      return;
    }
    const ownerUser = ownerRes.rows[0];
    let storageTarget = ownerUser;
    if (post.siteId) {
      const siteRes = await query('SELECT * FROM sites WHERE id = $1 AND user_id = $2', [post.siteId, post.userId]); // the post's site must belong to the post's owner
      if (siteRes.rows.length > 0) {
        storageTarget = { ...ownerUser, ...siteRes.rows[0], handle: ownerUser.handle };
      }
    }

    // Resolve clean root site URL for commenter
    let cleanCommenterSiteUrl: string | undefined = undefined;
    if (user.siteUrl && user.siteUrl.trim()) {
      try {
        const parsed = new URL(user.siteUrl);
        cleanCommenterSiteUrl = `${parsed.protocol}//${parsed.host}`;
      } catch (_e) {
        cleanCommenterSiteUrl = user.siteUrl.replace(/\/+$/, '');
      }
    } else if (user.handle) {
      cleanCommenterSiteUrl = `https://${user.handle}.neocities.org`;
    }

    // Append comment directly to self-hosted JSON on static host (Neocities / Nekoweb / local static bundle)
    const { appendPostComment } = await import('../services/staticStorage');
    const comment = await appendPostComment(
      storageTarget,
      post,
      {
        id: user.id,
        handle: user.handle || user.email.split('@')[0],
        uin: user.uin || 0,
        avatar: user.avatarPath || undefined,
        siteUrl: cleanCommenterSiteUrl,
      },
      cleanText
    );

    // Save comment into static storage posts.json
    await updatePost(id, (p) => {
      const currentComments = Array.isArray(p.comments) ? p.comments : [];
      return {
        ...p,
        comments: [...currentComments, comment],
        commentsCount: currentComments.length + 1,
      };
    });

    // Trigger incremental static update in background for post owner
    import('../services/incrementalBuilder')
      .then((m) => m.buildAndDeployComment({
        siteId: post.siteId,
        userId: ownerUser.id,
        postId: id,
      }))
      .catch((err) => console.error('[:> INCREMENTAL COMMENT ERROR]', err));

    // 1. Dispatch comment_own notification to photo owner
    if (user.id !== ownerUser.id) {
      import('../services/notificationService').then((m) => {
        m.dispatchNotification({
          userId: ownerUser.id,
          actorId: user.id,
          type: 'comment_own',
          title: `@${user.handle || 'visitor'} commented on your photo`,
          body: cleanText.slice(0, 150),
          linkUrl: `/#photo-${id}`,
          icon: '💬',
        }).catch(() => {});
      }).catch(() => {});
    }

    // 2. Dispatch comment_thread notifications to previous thread participants
    const otherCommenters = (post.comments || [])
      .map((c: any) => c.userId)
      .filter((uId: string) => uId && uId !== user.id && uId !== ownerUser.id);
    const uniqueCommenters = Array.from(new Set(otherCommenters));

    if (uniqueCommenters.length > 0) {
      import('../services/notificationService').then((m) => {
        for (const participantId of uniqueCommenters) {
          m.dispatchNotification({
            userId: participantId as string,
            actorId: user.id,
            type: 'comment_thread',
            title: `@${user.handle || 'visitor'} replied to a photo thread you joined`,
            body: cleanText.slice(0, 150),
            linkUrl: `/#photo-${id}`,
            icon: '🧵',
          }).catch(() => {});
        }
      }).catch(() => {});
    }

    res.status(201).json({
      ok: true,
      message: 'Comment committed to self-hosted ledger on static host.',
      comment: {
        id: comment.id,
        userId: comment.userId,
        author: comment.author,
        uin: comment.uin,
        avatar: comment.avatar,
        text: comment.text,
        timestamp: comment.timestamp,
        siteUrl: comment.siteUrl,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * 5b. GET /api/posts/:id/comments - Retrieve comments from self-hosted comments.json
 */
postsRouter.get('/posts/:id/comments', async (req: Request, res: Response, next) => {
  try {
    const { id } = req.params;
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    if (!isUuid) {
      res.status(404).json({ ok: false, error: 'Post not found.' });
      return;
    }
    const post = await getPostById(id);
    if (!post) {
      res.status(404).json({ ok: false, error: 'Post not found.' });
      return;
    }

    const ownerRes = await query('SELECT * FROM users WHERE id = $1', [post.userId]);
    const ownerUser = ownerRes.rows[0];
    let storageTarget = ownerUser;
    if (post.siteId) {
      const siteRes = await query('SELECT * FROM sites WHERE id = $1 AND user_id = $2', [post.siteId, post.userId]); // the post's site must belong to the post's owner
      if (siteRes.rows.length > 0) {
        storageTarget = { ...ownerUser, ...siteRes.rows[0], handle: ownerUser?.handle };
      }
    }

    const { readRemoteJson, getCommentsRelativePath } = await import('../services/staticStorage');
    const relPath = getCommentsRelativePath(post.imagePath);
    const commentsData = await readRemoteJson<any>(storageTarget, relPath, { comments: [] });

    const comments = Array.isArray(commentsData.comments) && commentsData.comments.length > 0
      ? commentsData.comments
      : (Array.isArray(post.comments) ? post.comments : []);

    res.json({
      ok: true,
      comments,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * 5c. DELETE /api/posts/:postId/comments/:commentId - Delete comment from self-hosted JSON (Owner moderation)
 */
postsRouter.delete('/posts/:postId/comments/:commentId', async (req: Request, res: Response, next) => {
  try {
    const user = await getSessionUser(req);
    if (!user) {
      res.status(401).json({ ok: false, error: 'Authentication required to moderate comments.' });
      return;
    }
    if (user.isBanned) {
      res.status(403).json({ ok: false, error: BANNED_ERROR });
      return;
    }

    const { postId, commentId } = req.params;
    const post = await getPostById(postId);
    if (!post) {
      res.status(404).json({ ok: false, error: 'Post not found.' });
      return;
    }

    if (post.userId !== user.id) {
      res.status(403).json({ ok: false, error: 'Access denied: You can only moderate comments on your own station photos.' });
      return;
    }

    let storageTarget: any = user;
    if (post.siteId) {
      const siteRes = await query('SELECT * FROM sites WHERE id = $1 AND user_id = $2', [post.siteId, post.userId]); // the post's site must belong to the post's owner
      if (siteRes.rows.length > 0) {
        storageTarget = { ...user, ...siteRes.rows[0], handle: user.handle };
      }
    }

    const { deletePostComment } = await import('../services/staticStorage');
    const deleted = await deletePostComment(storageTarget, post, commentId);

    // Update post record in static storage
    await updatePost(postId, (p) => {
      const currentComments = Array.isArray(p.comments) ? p.comments : [];
      const filtered = currentComments.filter((c: any) => c.id !== commentId && c.text !== commentId && c.body !== commentId);
      return {
        ...p,
        comments: filtered,
        commentsCount: filtered.length,
      };
    });

    // Trigger incremental static update in background for post owner
    import('../services/incrementalBuilder')
      .then((m) => m.buildAndDeployComment({
        siteId: post.siteId,
        userId: user.id,
        postId: post.id,
      }))
      .catch((err) => console.error('[:> INCREMENTAL COMMENT DELETE ERROR]', err));

    res.json({
      ok: true,
      message: deleted ? 'Comment purged from static host.' : 'Comment not found in remote ledger.',
      deletedId: commentId,
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
    if (user.isBanned) {
      res.status(403).json({ ok: false, error: BANNED_ERROR });
      return;
    }

    const { id } = req.params;
    const post = await getPostById(id);
    if (!post) {
      res.status(404).json({ ok: false, error: 'Post not found in terminal registry.' });
      return;
    }

    if (post.userId !== user.id) {
      res.status(403).json({ ok: false, error: 'Access denied: You are not authorized to edit this station post.' });
      return;
    }

    const { caption, mood, webring, location, filterApplied } = req.body;
    const allowedFilters = ['none', 'crt', 'sepia', 'vga', 'gameboy', 'cyberpunk'];
    const safeFilterApplied = filterApplied !== undefined
      ? (typeof filterApplied === 'string' && allowedFilters.includes(filterApplied.toLowerCase())
          ? filterApplied.toLowerCase()
          : 'none')
      : undefined;
    // Same type/length rules as POST /posts (these fields are rendered on every static page and feed)
    const textField = (value: unknown, max: number): string | null | undefined => {
      if (value === undefined) return undefined;
      if (value === null) return null;
      if (typeof value !== 'string') return undefined;
      return value.trim() ? value.trim().slice(0, max) : null;
    };
    const fields = { caption: textField(caption, 1000), mood: textField(mood, 50), webring: textField(webring, 50), location: textField(location, 100) };
    for (const [name, raw] of Object.entries({ caption, mood, webring, location })) {
      if (raw !== undefined && raw !== null && typeof raw !== 'string') {
        res.status(400).json({ ok: false, error: `${name} must be a string.` });
        return;
      }
    }
    const updated = await updatePost(id, (p) => ({
      ...p,
      caption: fields.caption !== undefined ? (fields.caption ?? ':> Snapshot transmitted via Neogram workstation.') : p.caption,
      mood: fields.mood !== undefined ? fields.mood : p.mood,
      webring: fields.webring !== undefined ? fields.webring : p.webring,
      location: fields.location !== undefined ? fields.location : p.location,
      filterApplied: safeFilterApplied !== undefined ? safeFilterApplied : p.filterApplied,
    }));

    if (!updated) {
      res.status(500).json({ ok: false, error: 'Failed to update post.' });
      return;
    }

    const { republishSiteInBackground } = await import('../services/deployDispatcher');
    republishSiteInBackground(updated.siteId, updated.userId, `edit post ${updated.id}`);

    res.json({
      ok: true,
      message: 'Post updated successfully.',
      post: updated,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * 7. DELETE /api/posts/:id - Delete post from static storage, remove assets, and rebuild static gallery
 */
postsRouter.delete('/posts/:id', async (req: Request, res: Response, next) => {
  try {
    const user = await getSessionUser(req);
    if (!user) {
      res.status(401).json({ ok: false, error: 'Authentication required to purge records.' });
      return;
    }
    if (user.isBanned) {
      res.status(403).json({ ok: false, error: BANNED_ERROR });
      return;
    }

    const { id } = req.params;
    const existingPost = await getPostById(id);
    if (!existingPost) {
      res.status(404).json({ ok: false, error: 'Post not found in terminal registry.' });
      return;
    }

    if (existingPost.userId !== user.id) {
      res.status(403).json({ ok: false, error: 'Access denied: You are not authorized to delete this station post.' });
      return;
    }

    const deleted = await deletePost(id);
    const { siteId, imagePath, thumbnailPath, photos } = existingPost;

    // Purge remote files from host if post was hosted externally
    const cleanRel = (p: string) => p.replace(/^https?:\/\/[^\/]+\//, '').replace(/^\/+/, '');
    const filesToDelete = new Set<string>();
    if (imagePath) filesToDelete.add(cleanRel(imagePath));
    if (thumbnailPath) filesToDelete.add(cleanRel(thumbnailPath));
    for (const pic of (photos || [])) {
      if (pic.imagePath) filesToDelete.add(cleanRel(pic.imagePath));
      if (pic.thumbnailPath) filesToDelete.add(cleanRel(pic.thumbnailPath));
    }

    const deleteList = Array.from(filesToDelete).filter(Boolean);

    if (deleteList.length > 0) {
      const { deleteFromNeocities } = await import('../services/neocitiesPublisher');
      deleteFromNeocities(siteId || user.id, deleteList).catch((err) => {
        console.warn('[:> NEOCITIES DELETE] Warning: could not purge remote files:', err);
      });

      const { deleteFromNekoweb } = await import('../services/nekowebPublisher');
      deleteFromNekoweb(siteId || user.id, deleteList).catch((err) => {
        console.warn('[:> NEKOWEB DELETE] Warning: could not purge remote files:', err);
      });

      const { deleteFromGitHub } = await import('../services/githubPublisher');
      deleteFromGitHub(siteId || user.id, deleteList).catch((err) => {
        console.warn('[:> GITHUB DELETE] Warning: could not purge remote files:', err);
      });
    }

    // Remove legacy local files from public/uploads if they exist
    const fs = await import('fs/promises');
    const path = await import('path');

    for (const picPath of [imagePath, thumbnailPath, ...(photos || []).map(p => p.imagePath), ...(photos || []).map(p => p.thumbnailPath)]) {
      if (picPath && typeof picPath === 'string' && picPath.startsWith('/uploads/')) {
        const fullLocalPath = path.join(process.cwd(), 'public', picPath);
        fs.unlink(fullLocalPath).catch(() => {});
      }
    }

    const { republishSiteInBackground } = await import('../services/deployDispatcher');
    republishSiteInBackground(siteId, user.id, `delete post ${req.params.id}`);

    triggerFollowersCascade(user.id);

    res.json({
      ok: true,
      message: 'Post and associated static assets purged successfully.',
      deletedPost: deleted || existingPost,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Triggers sequential background static rebuilds & deploys for all users
 * who follow the author whose post was created or deleted.
 * 
 * NOTE (IndieWeb Federated Model):
 * With client-side dynamic hydration (<script src="/embed/friends.js">)
 * and WAN JSON feed aggregation, followers pull directly on read (O(1) on publish).
 * Background static cascades are only dispatched if followers have mounted static sites.
 */
export async function triggerFollowersCascade(authorId: string) {
  try {
    const followersRes = await query(
      'SELECT follower_id as "followerId" FROM follows WHERE following_id = $1',
      [authorId]
    );

    if (followersRes.rows.length === 0) return;

    const { buildAndDeployFriendFeed } = await import('../services/incrementalBuilder');

    for (const row of followersRes.rows) {
      const followerId = row.followerId;
      buildAndDeployFriendFeed(followerId).catch((err) => {
        console.warn(`[:> CASCADE REBUILD ERROR] Incremental build failed for follower ${followerId}:`, err);
      });
    }
  } catch (err) {
    console.error('[:> CASCADE REBUILD QUERY ERROR]', err);
  }
}
