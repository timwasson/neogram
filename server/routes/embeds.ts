import { Router, Request, Response, NextFunction } from 'express';
import { query } from '../db';
import { generateCounterSvg, CounterStyle } from '../services/counterSvg';
import { COOKIE_NAME, verifySessionToken, extractToken } from '../auth/jwt';
import { getUserById } from '../auth/service';

export const embedsRouter = Router();

/**
 * Helper to optionally extract authenticated user
 */
async function getAuthUser(req: Request) {
  const token = extractToken(req);
  if (!token) return null;
  const payload = verifySessionToken(token);
  if (!payload) return null;
  return getUserById(payload.userId);
}

/**
 * Helper to lookup user by handle, numeric UIN, or UUID
 */
export async function findUserByHandleOrId(identifier: string) {
  if (!identifier) return null;
  const cleanId = identifier.trim();

  // 1. Check if identifier is a valid UUID
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cleanId);
  if (isUuid) {
    const res = await query('SELECT * FROM users WHERE id = $1', [cleanId]);
    if (res.rows.length > 0) return res.rows[0];
  }

  // 2. Check if identifier is a numeric UIN (e.g. 100101, 749210)
  if (/^\d{3,10}$/.test(cleanId)) {
    const byUin = await query('SELECT * FROM users WHERE uin = $1', [parseInt(cleanId, 10)]);
    if (byUin.rows.length > 0) return byUin.rows[0];
  }

  // 3. Lookup by handle or email prefix
  const cleanHandle = cleanId.replace(/^@/, '').toLowerCase();
  const byHandle = await query('SELECT * FROM users WHERE handle = $1 OR split_part(email, \'@\', 1) = $1', [cleanHandle]);
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
 * Returns guestbook signatures for a user from self-hosted data/guestbook.json
 */
embedsRouter.get('/api/guestbook/:identifier', async (req: Request, res: Response) => {
  try {
    const user = await findUserByHandleOrId(req.params.identifier);
    if (!user) {
      res.status(404).json({ ok: false, error: 'User node not found' });
      return;
    }

    const { readRemoteJson, getGuestbookRelativePath } = await import('../services/staticStorage');
    const gbData = await readRemoteJson<any>(user, getGuestbookRelativePath(), { entries: [] });
    let entries = Array.isArray(gbData.entries) ? gbData.entries : [];

    // Fallback to legacy SQL records if self-hosted file not populated yet
    if (entries.length === 0) {
      const entriesRes = await query(
        `SELECT id, visitor_name as "visitorName", visitor_website as "visitorWebsite", 
                visitor_location as "visitorLocation", mood_icon as "moodIcon", 
                message, is_moderated as "isModerated", created_at as "createdAt"
         FROM guestbook_entries
         WHERE user_id = $1
         ORDER BY created_at DESC`,
        [user.id]
      );
      entries = entriesRes.rows;
    }

    res.json({
      ok: true,
      handle: user.handle || user.email.split('@')[0],
      entries,
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// In-memory rate limiting map for guestbook submissions (max 6 per 5 min per IP)
const guestbookRateLimits = new Map<string, number[]>();
const GB_LIMIT_WINDOW_MS = 5 * 60 * 1000;
const MAX_GB_REQUESTS = 6;

function checkGbRateLimit(ip: string): boolean {
  const now = Date.now();
  const timestamps = (guestbookRateLimits.get(ip) || []).filter((ts) => now - ts < GB_LIMIT_WINDOW_MS);
  if (timestamps.length >= MAX_GB_REQUESTS) return false;
  timestamps.push(now);
  guestbookRateLimits.set(ip, timestamps);
  return true;
}

/**
 * POST /api/guestbook/:handle
 * Verified signature submission to a user's self-hosted visitor ledger on static host
 */
embedsRouter.post('/api/guestbook/:identifier', async (req: Request, res: Response) => {
  try {
    const ip = req.ip || req.socket.remoteAddress || 'unknown-ip';
    if (!checkGbRateLimit(ip)) {
      res.status(429).json({ ok: false, error: 'Carrier busy: Too many signatures submitted. Please wait 5 minutes.' });
      return;
    }

    // Require verified Neogram user
    const visitorUser = await getAuthUser(req);
    if (!visitorUser) {
      res.status(401).json({
        ok: false,
        error: 'Authentication required. Please connect your Neogram Cyber-Pass to sign the guestbook.',
      });
      return;
    }

    const hostUser = await findUserByHandleOrId(req.params.identifier);
    if (!hostUser) {
      res.status(404).json({ ok: false, error: 'User node not found' });
      return;
    }

    const { visitorLocation, visitorWebsite, moodIcon, message } = req.body;

    if (!message || !message.trim()) {
      res.status(400).json({ ok: false, error: 'Message is required.' });
      return;
    }

    // Strictly validate website protocol: only http:// and https:// allowed
    let cleanWebsite: string | null = null;
    if (visitorWebsite && typeof visitorWebsite === 'string') {
      const trimmed = visitorWebsite.trim();
      if (/^https?:\/\//i.test(trimmed) && trimmed !== 'http://' && trimmed !== 'https://') {
        cleanWebsite = trimmed.slice(0, 500);
      }
    }

    const { appendGuestbookEntry } = await import('../services/staticStorage');
    const entry = await appendGuestbookEntry(hostUser, {
      visitorName: visitorUser.handle || visitorUser.email.split('@')[0],
      uin: visitorUser.uin,
      visitorLocation: visitorLocation || 'Cyberspace',
      visitorWebsite: cleanWebsite || undefined,
      moodIcon: moodIcon || '😎',
      message: message.trim(),
    });

    // Mirror to database table for backwards compatibility
    await query(
      `INSERT INTO guestbook_entries (id, user_id, visitor_name, visitor_website, visitor_location, mood_icon, message)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6)
       ON CONFLICT DO NOTHING`,
      [
        hostUser.id,
        visitorUser.handle || 'visitor',
        cleanWebsite ? cleanWebsite.slice(0, 500) : null,
        (visitorLocation || 'Cyberspace').trim().slice(0, 200),
        (moodIcon || '😎').slice(0, 10),
        message.trim().slice(0, 1000),
      ]
    ).catch(() => {});

    // Dispatch in-app notification to host if signer is another station
    if (visitorUser.id !== hostUser.id) {
      import('../services/notificationService').then((m) => {
        m.dispatchNotification({
          userId: hostUser.id,
          actorId: visitorUser.id,
          type: 'guestbook',
          title: `@${visitorUser.handle || 'visitor'} signed your guestbook!`,
          body: message.trim().slice(0, 150),
          linkUrl: `/docs?topic=guestbook`,
          icon: '📖',
        }).catch(() => {});
      }).catch(() => {});
    }

    res.status(201).json({
      ok: true,
      message: 'Signature committed to self-hosted ledger on static host!',
      entry,
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * DELETE /api/guestbook/:id
 * Allows authenticated owner to delete a guestbook signature from self-hosted JSON
 */
embedsRouter.delete('/api/guestbook/:id', async (req: Request, res: Response) => {
  try {
    const user = await getAuthUser(req);
    if (!user) {
      res.status(401).json({ ok: false, error: 'Authentication required' });
      return;
    }

    const entryId = req.params.id;

    const { deleteGuestbookEntry } = await import('../services/staticStorage');
    const deleted = await deleteGuestbookEntry(user, entryId);

    // Also remove from legacy database table
    await query('DELETE FROM guestbook_entries WHERE id::text = $1 AND user_id = $2', [entryId, user.id]).catch(() => {});

    res.json({ ok: true, deleted, deletedId: entryId });
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
      home_page_url: user.site_url || `${baseUrl}/embed/feed/${handle}`,
      feed_url: `${baseUrl}/api/users/${handle}/feed.json`,
      author: {
        name: `@${handle}`,
        url: user.site_url || `${baseUrl}/embed/feed/${handle}`,
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
 * Helper to trigger background static rebuild & deploy for follower
 */
async function syncFollowerStaticSite(userId: string) {
  try {
    const { buildQueue, buildStaticGallery } = await import('../services/staticBuilder');
    buildQueue.enqueue(`FollowerSync:${userId}`, async () => {
      const credsRes = await query(
        'SELECT deployment_type, deployment_credentials, auto_deploy FROM users WHERE id = $1',
        [userId]
      );
      const u = credsRes.rows[0];
      const hasApiKey = u && u.deployment_type === 'neocities' && !!u.deployment_credentials;

      if (hasApiKey) {
        const { deployToNeocities } = await import('../services/neocitiesPublisher');
        await deployToNeocities(userId);
      } else {
        await buildStaticGallery({ userId });
      }
    }).catch((err) => {
      console.warn(`[:> FOLLOWER SYNC ERROR] Rebuild failed for follower ${userId}:`, err);
    });
  } catch (err) {
    console.error('[:> SYNC FOLLOWER QUEUE ERROR]', err);
  }
}

/**
 * GET /api/users/:identifier/friend-status
 * Query friendship status between logged-in user and target station
 */
embedsRouter.get('/api/users/:identifier/friend-status', async (req: Request, res: Response) => {
  try {
    const currentUser = await getAuthUser(req);
    const targetUser = await findUserByHandleOrId(req.params.identifier);
    if (!targetUser) {
      res.status(404).json({ ok: false, error: 'Target user not found' });
      return;
    }

    let isFriend = false;
    if (currentUser) {
      const followRes = await query(
        'SELECT 1 FROM follows WHERE follower_id = $1 AND following_id = $2',
        [currentUser.id, targetUser.id]
      );
      isFriend = followRes.rows.length > 0;
    }

    const countsRes = await query(`
      SELECT 
        (SELECT COUNT(*) FROM follows WHERE following_id = $1) as "followersCount",
        (SELECT COUNT(*) FROM follows WHERE follower_id = $1) as "followingCount"
    `, [targetUser.id]);

    res.json({
      ok: true,
      isFriend,
      isSelf: currentUser ? currentUser.id === targetUser.id : false,
      followersCount: parseInt(countsRes.rows[0].followersCount, 10),
      followingCount: parseInt(countsRes.rows[0].followingCount, 10),
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/friends
 * Returns current user's friends list and friends' latest photos feed
 */
embedsRouter.get('/api/friends', async (req: Request, res: Response) => {
  try {
    const currentUser = await getAuthUser(req);
    if (!currentUser) {
      res.status(401).json({ ok: false, error: 'Authentication required' });
      return;
    }

    const friendsRes = await query(`
      SELECT 
        u.id, 
        u.email, 
        COALESCE(u.handle, split_part(u.email, '@', 1)) as handle,
        u.uin,
        u.avatar_path as "avatarPath",
        u.status_message as "statusMessage",
        u.is_away as "isAway",
        u.site_url as "siteUrl",
        u.deploy_path as "deployPath",
        f.created_at as "friendedAt",
        (SELECT COUNT(*) FROM posts p WHERE p.user_id = u.id) as "postCount"
      FROM follows f
      JOIN users u ON f.following_id = u.id
      WHERE f.follower_id = $1
      ORDER BY LOWER(COALESCE(u.handle, split_part(u.email, '@', 1))) ASC
    `, [currentUser.id]);

    const postsRes = await query(`
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
        COALESCE(u.handle, split_part(u.email, '@', 1)) as author,
        (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) as "commentCount"
      FROM posts p
      JOIN follows f ON p.user_id = f.following_id
      JOIN users u ON p.user_id = u.id
      WHERE f.follower_id = $1
      ORDER BY p.created_at DESC
      LIMIT 100
    `, [currentUser.id]);

    res.json({
      ok: true,
      friends: friendsRes.rows,
      posts: postsRes.rows,
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/users/:identifier/follow
 * Follow / Add Friend
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
      res.status(400).json({ ok: false, error: 'Cannot add yourself as a friend' });
      return;
    }

    await query(
      `INSERT INTO follows (follower_id, following_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [currentUser.id, targetUser.id]
    );

    // 1. Rebuild & deploy follower's static site so /friends/ page updates
    syncFollowerStaticSite(currentUser.id);

    // 2. Refresh NIM buddy list in real-time
    try {
      const { refreshUserBuddyList } = await import('../services/chatSocket');
      await refreshUserBuddyList(currentUser.id);
    } catch (_wsErr) {}

    // 3. Dispatch follow notification to target station
    import('../services/notificationService').then((m) => {
      m.dispatchNotification({
        userId: targetUser.id,
        actorId: currentUser.id,
        type: 'follow',
        title: `@${currentUser.handle || 'user'} followed your station!`,
        body: 'Added your station to their Cyberspace Friends network.',
        linkUrl: `/user/@${currentUser.handle || currentUser.id}`,
        icon: '🤝',
      }).catch(() => {});
    }).catch(() => {});

    res.json({
      ok: true,
      following: true,
      isFriend: true,
      targetHandle: targetUser.handle || targetUser.email.split('@')[0],
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * DELETE /api/users/:identifier/follow
 * Unfollow / Remove Friend
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

    // 1. Rebuild & deploy follower's static site so /friends/ page updates
    syncFollowerStaticSite(currentUser.id);

    // 2. Refresh NIM buddy list in real-time
    try {
      const { refreshUserBuddyList } = await import('../services/chatSocket');
      await refreshUserBuddyList(currentUser.id);
    } catch (_wsErr) {}

    res.json({
      ok: true,
      following: false,
      isFriend: false,
      targetHandle: targetUser.handle || targetUser.email.split('@')[0],
    });
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
