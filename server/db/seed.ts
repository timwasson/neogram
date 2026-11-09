import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { query } from './index';
import { getAllPosts, savePost } from '../services/postStorage';
import { encryptCredentials } from '../utils/crypto';

export async function seedSnapshotIfEmpty(client?: { query: (text: string, params?: any[]) => Promise<any> }) {
  const dbQuery = client ? client.query.bind(client) : query;
  try {
    const userCountRes = await dbQuery('SELECT COUNT(*) as count FROM users');
    const userCount = parseInt(userCountRes.rows[0]?.count || '0', 10);
    if (userCount > 0) return;

    const snapshotPath = path.resolve(process.cwd(), 'db-snapshot.json');
    if (!fs.existsSync(snapshotPath)) return;

    console.log('[:> DB SEED] Empty database detected. Auto-loading snapshot from db-snapshot.json...');
    const raw = await fs.promises.readFile(snapshotPath, 'utf-8');
    const snapshot = JSON.parse(raw);
    const { users, sites, follows, web_counters, guestbook_entries, notification_preferences } = snapshot.tables || {};

    if (Array.isArray(users)) {
      for (const u of users) {
        await dbQuery(
          `INSERT INTO users (
            id, email, handle, uin, site_url, deploy_path, deployment_type,
            deployment_credentials, custom_css_url, avatar_path, auto_deploy,
            build_html, status_message, is_away, is_banned, ban_reason, banned_at,
            created_at, updated_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19
          )
          ON CONFLICT (id) DO UPDATE SET
            email = EXCLUDED.email,
            handle = EXCLUDED.handle,
            uin = EXCLUDED.uin,
            updated_at = NOW()`,
          [
            u.id, u.email, u.handle, u.uin, u.site_url, u.deploy_path || 'neogram',
            u.deployment_type || 'none',
            u.deployment_credentials ? Buffer.from(u.deployment_credentials.replace(/^\\x/, ''), 'hex') : null,
            u.custom_css_url, u.avatar_path, !!u.auto_deploy, u.build_html !== false,
            u.status_message || 'Surfing cyberspace', !!u.is_away, !!u.is_banned,
            u.ban_reason, u.banned_at, u.created_at || new Date(), u.updated_at || new Date()
          ]
        );
      }
      await dbQuery(`SELECT setval('user_uin_seq', (SELECT GREATEST(COALESCE(MAX(uin), 100100), 100100) FROM users) + 1, false)`).catch(() => {});
    }

    if (Array.isArray(sites)) {
      for (const s of sites) {
        let encryptedCreds = null;
        if (s.credentials && s.credentials.apiKey) {
          encryptedCreds = encryptCredentials(s.credentials);
        } else if (s.deployment_credentials) {
          encryptedCreds = Buffer.from(s.deployment_credentials.replace(/^\\x/, ''), 'hex');
        }
        await dbQuery(
          `INSERT INTO sites (
            id, user_id, name, slug, site_url, deployment_type, deployment_credentials,
            deploy_path, auto_deploy, build_html, custom_css_url, is_default,
            allow_anon_chat, allow_anon_guestbook, last_deployed_at, created_at, updated_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17
          )
          ON CONFLICT (id) DO NOTHING`,
          [
            s.id, s.user_id, s.name, s.slug, s.site_url, s.deployment_type, encryptedCreds,
            s.deploy_path || 'neogram', !!s.auto_deploy, s.build_html !== false, s.custom_css_url,
            !!s.is_default, s.allow_anon_chat !== false, s.allow_anon_guestbook !== false,
            s.last_deployed_at, s.created_at || new Date(), s.updated_at || new Date()
          ]
        );
      }
    }

    if (Array.isArray(follows)) {
      for (const f of follows) {
        await dbQuery(
          `INSERT INTO follows (follower_id, following_id, created_at)
           VALUES ($1, $2, $3)
           ON CONFLICT (follower_id, following_id) DO NOTHING`,
          [f.follower_id, f.following_id, f.created_at || new Date()]
        );
      }
    }

    // Invariant A: @wasson mutually followed by all QA personas
    const wassonRes = await dbQuery(`SELECT id FROM users WHERE LOWER(handle) = 'wasson' OR LOWER(email) = 'wasson@gmail.com' LIMIT 1`);
    const qaUsersRes = await dbQuery(`SELECT id FROM users WHERE email LIKE '%@qa.neogram.club'`);
    if (wassonRes.rows.length > 0) {
      const wassonId = wassonRes.rows[0].id;
      for (const qa of qaUsersRes.rows) {
        await dbQuery(
          `INSERT INTO follows (follower_id, following_id) VALUES ($1, $2), ($2, $1) ON CONFLICT DO NOTHING`,
          [wassonId, qa.id]
        );
      }
    }

    // Invariant B: @sheavanlan isolated from QA follows
    await dbQuery(`
      DELETE FROM follows 
      WHERE (follower_id IN (SELECT id FROM users WHERE LOWER(handle) = 'sheavanlan' OR LOWER(email) = 'sheavanlan@gmail.com')
             AND following_id IN (SELECT id FROM users WHERE email LIKE '%@qa.neogram.club'))
         OR (following_id IN (SELECT id FROM users WHERE LOWER(handle) = 'sheavanlan' OR LOWER(email) = 'sheavanlan@gmail.com')
             AND follower_id IN (SELECT id FROM users WHERE email LIKE '%@qa.neogram.club'))
    `);

    if (Array.isArray(web_counters)) {
      for (const c of web_counters) {
        if (c.site_id) {
          await dbQuery(
            `INSERT INTO web_counters (user_id, site_id, hits, style, updated_at)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (site_id) DO UPDATE SET hits = EXCLUDED.hits, style = EXCLUDED.style, updated_at = EXCLUDED.updated_at`,
            [c.user_id, c.site_id, c.hits || 0, c.style || 'green_led', c.updated_at || new Date()]
          );
        }
      }
    }

    if (Array.isArray(guestbook_entries)) {
      for (const g of guestbook_entries) {
        await dbQuery(
          `INSERT INTO guestbook_entries (
            id, user_id, site_id, visitor_name, visitor_website, visitor_location,
            mood_icon, message, is_anonymous, is_moderated, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          ON CONFLICT (id) DO NOTHING`,
          [
            g.id, g.user_id, g.site_id, g.visitor_name, g.visitor_website, g.visitor_location,
            g.mood_icon || '😎', g.message, !!g.is_anonymous, !!g.is_moderated, g.created_at || new Date()
          ]
        );
      }
    }

    if (Array.isArray(notification_preferences)) {
      for (const p of notification_preferences) {
        await dbQuery(
          `INSERT INTO notification_preferences (
            user_id, notify_nim, notify_follow, notify_comment_own, notify_comment_thread,
            notify_guestbook, notify_like, notify_friend_post, notify_deploy,
            sound_enabled, desktop_push, allow_anon_chat, allow_anon_guestbook, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
          ON CONFLICT (user_id) DO UPDATE SET updated_at = NOW()`,
          [
            p.user_id, p.notify_nim !== false, p.notify_follow !== false, p.notify_comment_own !== false,
            p.notify_comment_thread !== false, p.notify_guestbook !== false, p.notify_like !== false,
            p.notify_friend_post !== false, p.notify_deploy !== false, p.sound_enabled !== false,
            !!p.desktop_push, p.allow_anon_chat !== false, p.allow_anon_guestbook !== false, p.updated_at || new Date()
          ]
        );
      }
    }

    console.log(`[:> DB SEED] Successfully auto-seeded ${users.length} users, ${sites.length} sites, and ${follows.length} friend connections from db-snapshot.json.`);
  } catch (err) {
    console.warn('[:> DB SEED NOTE] Could not auto-seed from snapshot:', err);
  }
}

export const PLACEHOLDER_IMAGES = [
  {
    imagePath: 'https://picsum.photos/id/250/800/800',
    thumbnailPath: 'https://picsum.photos/id/250/400/400',
    filter: 'sepia',
    caption: ':> Testing the manual lens on my vintage 1996 mechanical camera. Analog tactile dials and film grain are unbeatable.',
    mood: '[:> CODING IN THE DARK]',
    webring: 'unix.hackers.retro',
    location: 'Tokyo // Darkroom Lab #3',
    likes: 42,
    comments: [
      { author: 'sysadmin_claire', text: ':> Beautiful retro optics! The warmth on that brass shutter ring is gorgeous.' },
      { author: 'pixel_monk', text: ':> Analog mechanical gear is timeless.' }
    ]
  },
  {
    imagePath: 'https://picsum.photos/id/1/800/800',
    thumbnailPath: 'https://picsum.photos/id/1/400/400',
    filter: 'crt',
    caption: ':> Midnight compile session. Late night coffee, terminal buffers, and dial-up tones humming through the modem.',
    mood: '[:> COMPILING KERNEL]',
    webring: 'unix.hackers.retro',
    location: 'Sparcstation // Node #4',
    likes: 88,
    comments: [
      { author: 'cyber_deck', text: ':> Late night hacking sessions hit different.' },
      { author: 'retro_gazer', text: ':> Love the phosphor glow!' }
    ]
  },
  {
    imagePath: 'https://picsum.photos/id/338/800/800',
    thumbnailPath: 'https://picsum.photos/id/338/400/400',
    filter: 'cyberpunk',
    caption: ':> Electric Town after dark. Neon reflections on wet asphalt while listening to city pop tapes.',
    mood: '[:> VIBING TO CITY POP]',
    webring: 'neocities.cyberpunk',
    location: 'Electric Town // Chome 4',
    likes: 67,
    comments: [
      { author: 'lofi_surfer', text: ':> City pop vibe is 10/10.' }
    ]
  },
  {
    imagePath: 'https://placebear.com/800/800',
    thumbnailPath: 'https://placebear.com/400/400',
    filter: 'vga',
    caption: ':> Node mascot spotted guarding the server rack. High-five for 99.9% uptime on the static webring!',
    mood: '[:> SURFING WEBRINGS]',
    webring: 'x11.underground.90s',
    location: 'Pacific Northwest // Node HQ',
    likes: 95,
    comments: [
      { author: 'arcade_queen', text: ':> The best server admin in cyberspace.' }
    ]
  }
];

export async function seedInitialPostsIfEmpty() {
  try {
    // 0. Seed users and follow relationships from db-snapshot.json if database is empty
    await seedSnapshotIfEmpty();

    // 1. Check if posts already exist on disk
    const existingPosts = await getAllPosts();
    const count = existingPosts.length;

    if (count > 0) {
      console.log(`[:> DB SEED] Found ${count} posts in static storage. Seed check complete.`);
      return;
    }

    // 2. Only if static storage is completely empty, find an existing user or create a seed root user
    let userResult = await query("SELECT id, handle, email FROM users ORDER BY created_at ASC LIMIT 1");
    let userId: string;
    let handle = 'cyber_phantom';
    let email = 'root@neogram.retro';

    if (userResult.rows.length === 0) {
      const newUser = await query(
        `
        INSERT INTO users (email, handle, site_url, deployment_type)
        VALUES ('root@neogram.retro', 'cyber_phantom', 'http://cyber_phantom.neocities.org', 'neocities')
        RETURNING id, handle, email
      `
      );
      userId = newUser.rows[0].id;
      handle = newUser.rows[0].handle || handle;
      email = newUser.rows[0].email || email;
    } else {
      userId = userResult.rows[0].id;
      handle = userResult.rows[0].handle || handle;
      email = userResult.rows[0].email || email;
    }

    console.log('[:> DB SEED] Seeding initial retro posts into static storage JSON...');

    // Look up if user has a default site
    const siteResult = await query("SELECT id, name, slug FROM sites WHERE user_id = $1 AND is_default = TRUE LIMIT 1", [userId]);
    const seedSiteId = siteResult.rows[0]?.id;
    const seedSiteName = siteResult.rows[0]?.name;
    const seedSiteSlug = siteResult.rows[0]?.slug;

    for (let i = 0; i < PLACEHOLDER_IMAGES.length; i++) {
      const p = PLACEHOLDER_IMAGES[i];
      try {
        const postId = crypto.randomUUID();
        await savePost({
          id: postId,
          userId,
          siteId: seedSiteId,
          siteName: seedSiteName,
          siteSlug: seedSiteSlug,
          imagePath: p.imagePath,
          thumbnailPath: p.thumbnailPath,
          photos: [{ imagePath: p.imagePath, thumbnailPath: p.thumbnailPath }],
          caption: p.caption,
          filterApplied: p.filter,
          mood: p.mood,
          webring: p.webring,
          location: p.location,
          likes: p.likes,
          createdAt: new Date(Date.now() - (PLACEHOLDER_IMAGES.length - i) * 3600000).toISOString(),
          handle,
          email,
          author: handle,
          comments: p.comments.map((c) => ({
            id: crypto.randomUUID(),
            postId,
            author: c.author,
            text: c.text,
            timestamp: new Date().toISOString(),
          })),
        });
      } catch (err) {
        console.error('[:> DB SEED ERROR] Failed to seed post:', err);
      }
    }

    console.log('[:> DB SEED] Successfully seeded initial placeholder posts to static JSON.');
  } catch (err) {
    console.error('[:> DB SEED ERROR]', err);
  }
}
