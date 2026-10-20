import { Router, Request, Response, NextFunction } from 'express';
import { query } from '../db';
import { generateCounterSvg, CounterStyle } from '../services/counterSvg';
import { COOKIE_NAME, verifySessionToken } from '../auth/jwt';
import { getUserById } from '../auth/service';

export const embedsRouter = Router();

/**
 * Helper to optionally extract authenticated user
 */
async function getAuthUser(req: Request) {
  const token = req.cookies[COOKIE_NAME];
  if (!token) return null;
  const payload = verifySessionToken(token);
  if (!payload) return null;
  return getUserById(payload.userId);
}

/**
 * Helper to lookup user by handle or UUID
 */
async function findUserByHandleOrId(identifier: string) {
  // Check if identifier is a valid UUID
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identifier);
  if (isUuid) {
    const res = await query('SELECT * FROM users WHERE id = $1', [identifier]);
    if (res.rows.length > 0) return res.rows[0];
  }

  // Lookup by handle or email prefix
  const byHandle = await query('SELECT * FROM users WHERE handle = $1 OR split_part(email, \'@\', 1) = $1', [identifier]);
  if (byHandle.rows.length > 0) return byHandle.rows[0];

  return null;
}

// ============================================================================
// 1. DYNAMIC SVG HIT COUNTER
// ============================================================================

/**
 * GET /counter/:handle.svg
 * Serves a dynamic SVG hit counter, increments hits in web_counters,
 * and sets no-cache headers.
 */
embedsRouter.get('/counter/:identifier.svg', async (req: Request, res: Response) => {
  try {
    const identifier = req.params.identifier;
    const requestedStyle = (req.query.style as string) || '';

    const user = await findUserByHandleOrId(identifier);
    let hits = 1;
    let style = requestedStyle || 'green_led';

    if (user) {
      // Upsert hit counter
      const updateRes = await query(
        `INSERT INTO web_counters (user_id, hits, style, updated_at)
         VALUES ($1, 1, $2, CURRENT_TIMESTAMP)
         ON CONFLICT (user_id) 
         DO UPDATE SET hits = web_counters.hits + 1, updated_at = CURRENT_TIMESTAMP
         RETURNING hits, style`,
        [user.id, requestedStyle || 'green_led']
      );

      hits = parseInt(updateRes.rows[0].hits, 10);
      if (!requestedStyle) {
        style = updateRes.rows[0].style || 'green_led';
      }
    } else {
      // Fallback demo hits for unrecognized handles
      hits = 42;
    }

    const svg = generateCounterSvg(hits, style);

    res.set({
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0',
      'Pragma': 'no-cache',
      'Expires': '0',
    });

    res.send(svg);
  } catch (err) {
    console.error('[:> COUNTER ERROR]', err);
    // Return a fallback SVG even on error so images never show as broken
    const fallbackSvg = generateCounterSvg(0, 'green_led');
    res.set('Content-Type', 'image/svg+xml').send(fallbackSvg);
  }
});

/**
 * GET /api/counter
 * Retrieves authenticated user's counter stats and embed codes
 */
embedsRouter.get('/api/counter', async (req: Request, res: Response) => {
  try {
    const user = await getAuthUser(req);
    if (!user) {
      res.status(401).json({ ok: false, error: 'Authentication required' });
      return;
    }

    let counterRes = await query('SELECT hits, style FROM web_counters WHERE user_id = $1', [user.id]);
    if (counterRes.rows.length === 0) {
      await query(
        'INSERT INTO web_counters (user_id, hits, style) VALUES ($1, 42, $2) ON CONFLICT DO NOTHING',
        [user.id, 'green_led']
      );
      counterRes = await query('SELECT hits, style FROM web_counters WHERE user_id = $1', [user.id]);
    }

    const row = counterRes.rows[0];
    const handle = user.handle || user.email.split('@')[0];
    const hits = parseInt(row.hits, 10);
    const style = row.style || 'green_led';

    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const counterUrl = `${baseUrl}/counter/${handle}.svg?style=${style}`;
    const embedHtml = `<div class="neogram-counter">\n  <img src="${counterUrl}" alt="You are visitor number" />\n</div>`;

    res.json({
      ok: true,
      counter: {
        hits,
        style,
        handle,
        counterUrl,
        embedHtml,
      },
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * PUT /api/counter
 * Updates authenticated user's preferred counter style or simulates hits
 */
embedsRouter.put('/api/counter', async (req: Request, res: Response) => {
  try {
    const user = await getAuthUser(req);
    if (!user) {
      res.status(401).json({ ok: false, error: 'Authentication required' });
      return;
    }

    const { style, action, amount } = req.body;

    if (action === 'reset') {
      await query(
        `INSERT INTO web_counters (user_id, hits, style, updated_at)
         VALUES ($1, 1, $2, CURRENT_TIMESTAMP)
         ON CONFLICT (user_id) DO UPDATE SET hits = 1, updated_at = CURRENT_TIMESTAMP`,
        [user.id, style || 'green_led']
      );
    } else if (action === 'increment') {
      const inc = parseInt(amount, 10) || 1;
      await query(
        `INSERT INTO web_counters (user_id, hits, style, updated_at)
         VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
         ON CONFLICT (user_id) DO UPDATE SET hits = web_counters.hits + $2, updated_at = CURRENT_TIMESTAMP`,
        [user.id, inc, style || 'green_led']
      );
    } else if (style) {
      await query(
        `INSERT INTO web_counters (user_id, hits, style, updated_at)
         VALUES ($1, 42, $2, CURRENT_TIMESTAMP)
         ON CONFLICT (user_id) DO UPDATE SET style = $2, updated_at = CURRENT_TIMESTAMP`,
        [user.id, style]
      );
    }

    const updated = await query('SELECT hits, style FROM web_counters WHERE user_id = $1', [user.id]);
    res.json({
      ok: true,
      hits: parseInt(updated.rows[0].hits, 10),
      style: updated.rows[0].style,
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ============================================================================
// 2. RETRO GUESTBOOK LEDGER & MODERATION
// ============================================================================

/**
 * GET /api/guestbook/:handle
 * Returns guestbook signatures for a user
 */
embedsRouter.get('/api/guestbook/:identifier', async (req: Request, res: Response) => {
  try {
    const user = await findUserByHandleOrId(req.params.identifier);
    if (!user) {
      res.status(404).json({ ok: false, error: 'User node not found' });
      return;
    }

    const entriesRes = await query(
      `SELECT id, visitor_name as "visitorName", visitor_website as "visitorWebsite", 
              visitor_location as "visitorLocation", mood_icon as "moodIcon", 
              message, is_moderated as "isModerated", created_at as "createdAt"
       FROM guestbook_entries
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [user.id]
    );

    res.json({
      ok: true,
      handle: user.handle || user.email.split('@')[0],
      entries: entriesRes.rows,
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/guestbook/:handle
 * Public signature submission to a user's visitor ledger
 */
embedsRouter.post('/api/guestbook/:identifier', async (req: Request, res: Response) => {
  try {
    const user = await findUserByHandleOrId(req.params.identifier);
    if (!user) {
      res.status(404).json({ ok: false, error: 'User node not found' });
      return;
    }

    const { visitorName, visitorWebsite, visitorLocation, moodIcon, message } = req.body;

    if (!visitorName || !visitorName.trim()) {
      res.status(400).json({ ok: false, error: 'Visitor name is required.' });
      return;
    }

    if (!message || !message.trim()) {
      res.status(400).json({ ok: false, error: 'Message is required.' });
      return;
    }

    const cleanWebsite = visitorWebsite && visitorWebsite.trim() !== 'http://' ? visitorWebsite.trim() : null;

    const insertRes = await query(
      `INSERT INTO guestbook_entries (user_id, visitor_name, visitor_website, visitor_location, mood_icon, message)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, visitor_name as "visitorName", visitor_website as "visitorWebsite",
                 visitor_location as "visitorLocation", mood_icon as "moodIcon",
                 message, is_moderated as "isModerated", created_at as "createdAt"`,
      [
        user.id,
        visitorName.trim().slice(0, 100),
        cleanWebsite ? cleanWebsite.slice(0, 500) : null,
        (visitorLocation || 'Cyberspace').trim().slice(0, 200),
        (moodIcon || '😎').slice(0, 10),
        message.trim().slice(0, 1000),
      ]
    );

    res.status(201).json({
      ok: true,
      message: 'Signature committed to disk!',
      entry: insertRes.rows[0],
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * DELETE /api/guestbook/:id
 * Allows authenticated owner to delete a guestbook signature
 */
embedsRouter.delete('/api/guestbook/:id', async (req: Request, res: Response) => {
  try {
    const user = await getAuthUser(req);
    if (!user) {
      res.status(401).json({ ok: false, error: 'Authentication required' });
      return;
    }

    const entryId = req.params.id;
    const deleteRes = await query(
      'DELETE FROM guestbook_entries WHERE id = $1 AND user_id = $2 RETURNING id',
      [entryId, user.id]
    );

    if (deleteRes.rows.length === 0) {
      res.status(404).json({ ok: false, error: 'Entry not found or unauthorized' });
      return;
    }

    res.json({ ok: true, deletedId: entryId });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ============================================================================
// 3. PUBLIC JSON FEEDS FOR EXTERNAL STATIC SITES
// ============================================================================

/**
 * GET /api/users/:handle/feed.json
 * Public JSON feed of a user's gallery posts, optimized for static sites to fetch
 */
embedsRouter.get(['/api/users/:identifier/feed.json', '/feed/:identifier.json'], async (req: Request, res: Response) => {
  try {
    const user = await findUserByHandleOrId(req.params.identifier);
    if (!user) {
      res.status(404).json({ ok: false, error: 'User node not found' });
      return;
    }

    const handle = user.handle || user.email.split('@')[0];
    const baseUrl = `${req.protocol}://${req.get('host')}`;

    const postsRes = await query(
      `SELECT 
        p.id,
        p.image_path as "imagePath",
        p.thumbnail_path as "thumbnailPath",
        p.caption,
        p.filter_applied as "filterApplied",
        p.mood,
        p.webring,
        p.location,
        p.likes_count as "likes",
        p.created_at as "createdAt",
        (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) as "commentCount"
       FROM posts p
       WHERE p.user_id = $1
       ORDER BY p.created_at DESC`,
      [user.id]
    );

    const posts = postsRes.rows.map((p) => ({
      id: p.id,
      imageUrl: p.imagePath.startsWith('http') ? p.imagePath : `${baseUrl}${p.imagePath}`,
      thumbnailUrl: p.thumbnailPath.startsWith('http') ? p.thumbnailPath : `${baseUrl}${p.thumbnailPath}`,
      caption: p.caption,
      filter: p.filterApplied,
      mood: p.mood,
      webring: p.webring,
      location: p.location,
      likes: parseInt(p.likes, 10),
      commentCount: parseInt(p.commentCount, 10),
      url: `${baseUrl}/photos/${p.id}/`,
      createdAt: p.createdAt,
    }));

    res.json({
      version: 'https://jsonfeed.org/version/1.1',
      title: `${handle}'s Neogram Photo Feed`,
      home_page_url: user.site_url || `${baseUrl}/preview/`,
      feed_url: `${baseUrl}/api/users/${handle}/feed.json`,
      author: {
        name: `@${handle}`,
        url: user.site_url || `${baseUrl}/preview/`,
      },
      items: posts,
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ============================================================================
// 4. SOCIAL FOLLOWING & NETWORK
// ============================================================================

/**
 * GET /api/network/users
 * Lists creators on the Neogram network with follow status
 */
embedsRouter.get('/api/network/users', async (req: Request, res: Response) => {
  try {
    const currentUser = await getAuthUser(req);
    const currentUserId = currentUser ? currentUser.id : null;

    const usersRes = await query(`
      SELECT 
        u.id,
        u.email,
        COALESCE(u.handle, split_part(u.email, '@', 1)) as handle,
        u.site_url as "siteUrl",
        u.created_at as "createdAt",
        (SELECT COUNT(*) FROM posts p WHERE p.user_id = u.id) as "postCount",
        (SELECT COUNT(*) FROM follows f WHERE f.following_id = u.id) as "followersCount",
        CASE 
          WHEN $1::UUID IS NOT NULL AND EXISTS (
            SELECT 1 FROM follows f WHERE f.follower_id = $1::UUID AND f.following_id = u.id
          ) THEN true 
          ELSE false 
        END as "isFollowing"
      FROM users u
      ORDER BY "postCount" DESC, u.created_at ASC
    `, [currentUserId]);

    res.json({
      ok: true,
      users: usersRes.rows.map((u) => ({
        id: u.id,
        handle: u.handle,
        email: u.email,
        siteUrl: u.siteUrl,
        postCount: parseInt(u.postCount, 10),
        followersCount: parseInt(u.followersCount, 10),
        isFollowing: !!u.isFollowing,
        isSelf: currentUserId === u.id,
      })),
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/users/:handle/follow
 * Follow a user
 */
embedsRouter.post('/api/users/:identifier/follow', async (req: Request, res: Response) => {
  try {
    const currentUser = await getAuthUser(req);
    if (!currentUser) {
      res.status(401).json({ ok: false, error: 'Authentication required' });
      return;
    }

    const targetUser = await findUserByHandleOrId(req.params.identifier);
    if (!targetUser) {
      res.status(404).json({ ok: false, error: 'Target user not found' });
      return;
    }

    if (currentUser.id === targetUser.id) {
      res.status(400).json({ ok: false, error: 'Cannot follow yourself' });
      return;
    }

    await query(
      `INSERT INTO follows (follower_id, following_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [currentUser.id, targetUser.id]
    );

    res.json({ ok: true, following: true, targetHandle: targetUser.handle || targetUser.email.split('@')[0] });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * DELETE /api/users/:handle/follow
 * Unfollow a user
 */
embedsRouter.delete('/api/users/:identifier/follow', async (req: Request, res: Response) => {
  try {
    const currentUser = await getAuthUser(req);
    if (!currentUser) {
      res.status(401).json({ ok: false, error: 'Authentication required' });
      return;
    }

    const targetUser = await findUserByHandleOrId(req.params.identifier);
    if (!targetUser) {
      res.status(404).json({ ok: false, error: 'Target user not found' });
      return;
    }

    await query(
      `DELETE FROM follows 
       WHERE follower_id = $1 AND following_id = $2`,
      [currentUser.id, targetUser.id]
    );

    res.json({ ok: true, following: false, targetHandle: targetUser.handle || targetUser.email.split('@')[0] });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ============================================================================
// 5. EMBEDDABLE STANDALONE PAGES (IFRAMES)
// ============================================================================

/**
 * GET /embed/guestbook/:handle
 * Standalone embeddable guestbook page styled for iframe embedding
 */
embedsRouter.get('/embed/guestbook/:identifier', async (req: Request, res: Response) => {
  try {
    const user = await findUserByHandleOrId(req.params.identifier);
    if (!user) {
      res.status(404).render('404', { url: req.originalUrl });
      return;
    }

    const handle = user.handle || user.email.split('@')[0];

    const entriesRes = await query(
      `SELECT id, visitor_name as "visitorName", visitor_website as "visitorWebsite", 
              visitor_location as "visitorLocation", mood_icon as "moodIcon", 
              message, created_at as "createdAt"
       FROM guestbook_entries
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [user.id]
    );

    res.render('embeds/guestbook', {
      title: `${handle}'s Public Guestbook — Neogram`,
      handle,
      userId: user.id,
      entries: entriesRes.rows,
    });
  } catch (err: any) {
    res.status(500).send(`Guestbook Error: ${err.message}`);
  }
});

/**
 * GET /embed/feed/:handle
 * Standalone embeddable photo feed widget for static sites
 */
embedsRouter.get('/embed/feed/:identifier', async (req: Request, res: Response) => {
  try {
    const user = await findUserByHandleOrId(req.params.identifier);
    if (!user) {
      res.status(404).render('404', { url: req.originalUrl });
      return;
    }

    const handle = user.handle || user.email.split('@')[0];

    const postsRes = await query(
      `SELECT 
        p.id,
        p.image_path as "imagePath",
        p.caption,
        p.filter_applied as "filterApplied",
        p.mood,
        p.likes_count as "likes",
        p.created_at as "createdAt",
        (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) as "commentCount"
       FROM posts p
       WHERE p.user_id = $1
       ORDER BY p.created_at DESC
       LIMIT 6`,
      [user.id]
    );

    res.render('embeds/feed', {
      title: `${handle}'s Neogram Feed`,
      handle,
      userId: user.id,
      siteUrl: user.site_url,
      posts: postsRes.rows,
    });
  } catch (err: any) {
    res.status(500).send(`Feed Error: ${err.message}`);
  }
});
