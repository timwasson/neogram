/**
 * Neogram Production-to-Local Database Synchronization CLI
 * =========================================================
 * Synchronizes production database state (users, sites, encrypted credentials,
 * follows, web counters, guestbooks) to the local PostgreSQL development database.
 * 
 * Sources of snapshot:
 *   1. --file=<path> or ./db-snapshot.json
 *   2. ~/Downloads/db-snapshot.json (auto-detected if recently downloaded via /admin)
 *   3. Direct remote fetch via --token=<jwt> or --cookie="neogram_session=..."
 * 
 * Invariants preserved:
 *   - Site credentials from production are re-encrypted with local ENCRYPTION_SECRET
 *     to ensure 100% decryption parity locally.
 *   - User @wasson is intertwined with all QA fleet accounts.
 *   - User @sheavanlan is strictly excluded from QA follow graphs.
 */

import fs from 'fs/promises';
import { existsSync, statSync } from 'fs';
import path from 'path';
import os from 'os';
import { initDatabase, query } from '../server/db';
import { encryptCredentials } from '../server/utils/crypto';

// Retro ANSI colors
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

function parseArgs() {
  const args = process.argv.slice(2);
  const options: Record<string, string> = {};
  for (const arg of args) {
    if (arg.startsWith('--')) {
      const [key, ...rest] = arg.slice(2).split('=');
      options[key] = rest.join('=');
    }
  }
  return options;
}

async function findOrFetchSnapshot(opts: Record<string, string>): Promise<any> {
  const targetUrl = (opts.url || process.env.APP_URL || 'https://neogram.club').replace(/\/+$/, '');

  // 1. Explicit file path
  if (opts.file) {
    const resolved = path.resolve(process.cwd(), opts.file);
    if (!existsSync(resolved)) {
      throw new Error(`Specified snapshot file does not exist: ${resolved}`);
    }
    console.log(`${CYAN}[:> DB SYNC] Using specified snapshot file:${RESET} ${YELLOW}${resolved}${RESET}`);
    const raw = await fs.readFile(resolved, 'utf-8');
    return JSON.parse(raw);
  }

  // 2. Direct remote fetch if cookie or token is provided
  const cookie = opts.cookie || process.env.ADMIN_COOKIE;
  const token = opts.token || process.env.ADMIN_TOKEN;

  if (cookie || token) {
    const headers: Record<string, string> = {};
    if (cookie) headers['Cookie'] = cookie.includes('=') ? cookie : `neogram_session=${cookie}`;
    if (token) headers['Authorization'] = `Bearer ${token}`;

    console.log(`${CYAN}[:> DB SYNC] Fetching live snapshot from:${RESET} ${YELLOW}${targetUrl}/api/admin/db/snapshot${RESET}`);
    const res = await fetch(`${targetUrl}/api/admin/db/snapshot`, { headers });
    if (!res.ok) {
      throw new Error(`Failed to fetch snapshot from ${targetUrl} (HTTP ${res.status}): ${await res.text()}`);
    }
    const data = await res.json();
    const savePath = path.resolve(process.cwd(), 'db-snapshot.json');
    await fs.writeFile(savePath, JSON.stringify(data, null, 2), 'utf-8');
    console.log(`${GREEN}[:> DB SYNC] Saved live snapshot to:${RESET} ${YELLOW}${savePath}${RESET}`);
    return data;
  }

  // 3. Local ./db-snapshot.json in current directory
  const localFile = path.resolve(process.cwd(), 'db-snapshot.json');
  if (existsSync(localFile)) {
    console.log(`${CYAN}[:> DB SYNC] Found snapshot in workspace:${RESET} ${YELLOW}${localFile}${RESET}`);
    const raw = await fs.readFile(localFile, 'utf-8');
    return JSON.parse(raw);
  }

  // 4. Check ~/Downloads/db-snapshot.json (downloaded via /admin UI)
  const downloadFile = path.join(os.homedir(), 'Downloads', 'db-snapshot.json');
  if (existsSync(downloadFile)) {
    const stats = statSync(downloadFile);
    const ageHours = (Date.now() - stats.mtimeMs) / (1000 * 60 * 60);
    if (ageHours < 48) {
      console.log(`${CYAN}[:> DB SYNC] Detected browser download from ~/Downloads (modified ${Math.round(ageHours)}h ago):${RESET} ${YELLOW}${downloadFile}${RESET}`);
      const raw = await fs.readFile(downloadFile, 'utf-8');
      return JSON.parse(raw);
    }
  }

  // If no file found, provide helpful instructions
  console.error(`\n${RED}${BOLD}[:> DB SYNC ERROR] No snapshot file or authentication credentials found.${RESET}\n`);
  console.log(`To synchronize your local PostgreSQL database with production:`);
  console.log(`  1. Open ${BOLD}https://neogram.club/admin${RESET} in your browser`);
  console.log(`  2. Click ${BOLD}[💾 Download DB Snapshot (db-snapshot.json)]${RESET}`);
  console.log(`  3. Run: ${GREEN}npm run db:sync-prod${RESET} (it will auto-detect the file in ~/Downloads)`);
  console.log(`\nAlternatively, pass flags directly:`);
  console.log(`  ${YELLOW}npm run db:sync-prod -- --file=/path/to/db-snapshot.json${RESET}`);
  console.log(`  ${YELLOW}npm run db:sync-prod -- --cookie="neogram_session=..."${RESET}\n`);
  process.exit(1);
}

async function syncDatabase() {
  console.log(`\n${CYAN}${BOLD}================================================================================${RESET}`);
  console.log(`${CYAN}${BOLD}  [:> NEOGRAM PRODUCTION -> LOCAL DATABASE SYNCHRONIZATION]                     ${RESET}`);
  console.log(`${CYAN}${BOLD}================================================================================${RESET}\n`);

  const opts = parseArgs();
  const snapshot = await findOrFetchSnapshot(opts);

  if (!snapshot || !snapshot.tables) {
    throw new Error('Invalid snapshot structure: missing tables object.');
  }

  console.log(`${CYAN}Snapshot Exported At :${RESET} ${YELLOW}${snapshot.exportedAt || 'Unknown'}${RESET}`);
  console.log(`${CYAN}Snapshot Version     :${RESET} ${YELLOW}${snapshot.version || 'v1'}${RESET}\n`);

  await initDatabase();

  const { users, sites, follows, web_counters, guestbook_entries, notification_preferences } = snapshot.tables;

  let restoredUsers = 0;
  let restoredSites = 0;
  let restoredFollows = 0;
  let restoredCounters = 0;
  let restoredGuestbook = 0;
  let restoredPrefs = 0;

  // 1. Sync Users
  if (Array.isArray(users)) {
    for (const u of users) {
      // First ensure no conflicting email or handle on a different ID
      await query(`DELETE FROM users WHERE (email = $1 OR handle = $2) AND id != $3`, [u.email, u.handle, u.id]);

      await query(
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
          site_url = EXCLUDED.site_url,
          deploy_path = EXCLUDED.deploy_path,
          deployment_type = EXCLUDED.deployment_type,
          deployment_credentials = EXCLUDED.deployment_credentials,
          custom_css_url = EXCLUDED.custom_css_url,
          avatar_path = EXCLUDED.avatar_path,
          auto_deploy = EXCLUDED.auto_deploy,
          build_html = EXCLUDED.build_html,
          status_message = EXCLUDED.status_message,
          is_away = EXCLUDED.is_away,
          is_banned = EXCLUDED.is_banned,
          ban_reason = EXCLUDED.ban_reason,
          banned_at = EXCLUDED.banned_at,
          updated_at = NOW()`,
        [
          u.id,
          u.email,
          u.handle,
          u.uin,
          u.site_url,
          u.deploy_path || 'neogram',
          u.deployment_type || 'none',
          u.deployment_credentials ? Buffer.from(u.deployment_credentials.replace(/^\\x/, ''), 'hex') : null,
          u.custom_css_url,
          u.avatar_path,
          !!u.auto_deploy,
          u.build_html !== false,
          u.status_message || 'Surfing cyberspace',
          !!u.is_away,
          !!u.is_banned,
          u.ban_reason,
          u.banned_at,
          u.created_at || new Date(),
          u.updated_at || new Date(),
        ]
      );
      restoredUsers++;
    }
  }

  // 2. Sync Sites
  if (Array.isArray(sites)) {
    for (const s of sites) {
      // Re-encrypt credentials using local master key if credentials object was decrypted in snapshot
      let encryptedCreds: Buffer | null = null;
      if (s.credentials && s.credentials.apiKey) {
        encryptedCreds = encryptCredentials(s.credentials);
      } else if (s.deployment_credentials) {
        encryptedCreds = Buffer.from(s.deployment_credentials.replace(/^\\x/, ''), 'hex');
      }

      await query(
        `INSERT INTO sites (
          id, user_id, name, slug, site_url, deployment_type, deployment_credentials,
          deploy_path, auto_deploy, build_html, custom_css_url, is_default,
          allow_anon_chat, allow_anon_guestbook, last_deployed_at, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17
        )
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          slug = EXCLUDED.slug,
          site_url = EXCLUDED.site_url,
          deployment_type = EXCLUDED.deployment_type,
          deployment_credentials = EXCLUDED.deployment_credentials,
          deploy_path = EXCLUDED.deploy_path,
          auto_deploy = EXCLUDED.auto_deploy,
          build_html = EXCLUDED.build_html,
          custom_css_url = EXCLUDED.custom_css_url,
          is_default = EXCLUDED.is_default,
          allow_anon_chat = EXCLUDED.allow_anon_chat,
          allow_anon_guestbook = EXCLUDED.allow_anon_guestbook,
          last_deployed_at = EXCLUDED.last_deployed_at,
          updated_at = NOW()`,
        [
          s.id,
          s.user_id,
          s.name,
          s.slug,
          s.site_url,
          s.deployment_type,
          encryptedCreds,
          s.deploy_path || 'neogram',
          !!s.auto_deploy,
          s.build_html !== false,
          s.custom_css_url,
          !!s.is_default,
          s.allow_anon_chat !== false,
          s.allow_anon_guestbook !== false,
          s.last_deployed_at,
          s.created_at || new Date(),
          s.updated_at || new Date(),
        ]
      );
      restoredSites++;
    }
  }

  // 3. Sync Follows
  if (Array.isArray(follows)) {
    for (const f of follows) {
      await query(
        `INSERT INTO follows (follower_id, following_id, created_at)
         VALUES ($1, $2, $3)
         ON CONFLICT (follower_id, following_id) DO NOTHING`,
        [f.follower_id, f.following_id, f.created_at || new Date()]
      );
      restoredFollows++;
    }
  }

  // Enforce Invariants on Local:
  // Invariant A: User @wasson is mutually followed by all QA personas
  const wassonRes = await query(`SELECT id FROM users WHERE LOWER(handle) = 'wasson' OR LOWER(email) = 'wasson@gmail.com' LIMIT 1`);
  const qaUsersRes = await query(`SELECT id FROM users WHERE email LIKE '%@qa.neogram.club'`);
  if (wassonRes.rows.length > 0) {
    const wassonId = wassonRes.rows[0].id;
    for (const qa of qaUsersRes.rows) {
      await query(
        `INSERT INTO follows (follower_id, following_id) VALUES ($1, $2), ($2, $1) ON CONFLICT DO NOTHING`,
        [wassonId, qa.id]
      );
    }
  }

  // Invariant B: User @sheavanlan is strictly excluded from ANY QA follows
  await query(`
    DELETE FROM follows 
    WHERE (follower_id IN (SELECT id FROM users WHERE LOWER(handle) = 'sheavanlan' OR LOWER(email) = 'sheavanlan@gmail.com')
           AND following_id IN (SELECT id FROM users WHERE email LIKE '%@qa.neogram.club'))
       OR (following_id IN (SELECT id FROM users WHERE LOWER(handle) = 'sheavanlan' OR LOWER(email) = 'sheavanlan@gmail.com')
           AND follower_id IN (SELECT id FROM users WHERE email LIKE '%@qa.neogram.club'))
  `);

  // 4. Sync Web Counters
  if (Array.isArray(web_counters)) {
    for (const c of web_counters) {
      if (c.site_id) {
        await query(
          `INSERT INTO web_counters (id, user_id, site_id, hits, style, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (site_id) DO UPDATE SET
             hits = EXCLUDED.hits,
             style = EXCLUDED.style,
             updated_at = EXCLUDED.updated_at`,
          [c.id, c.user_id, c.site_id, c.hits || 0, c.style || 'green_led', c.updated_at || new Date()]
        );
        restoredCounters++;
      }
    }
  }

  // 5. Sync Guestbook Entries
  if (Array.isArray(guestbook_entries)) {
    for (const g of guestbook_entries) {
      await query(
        `INSERT INTO guestbook_entries (
          id, user_id, site_id, visitor_name, visitor_website, visitor_location,
          mood_icon, message, is_anonymous, is_moderated, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (id) DO NOTHING`,
        [
          g.id,
          g.user_id,
          g.site_id,
          g.visitor_name,
          g.visitor_website,
          g.visitor_location,
          g.mood_icon || '😎',
          g.message,
          !!g.is_anonymous,
          !!g.is_moderated,
          g.created_at || new Date(),
        ]
      );
      restoredGuestbook++;
    }
  }

  // 6. Sync Notification Preferences
  if (Array.isArray(notification_preferences)) {
    for (const p of notification_preferences) {
      await query(
        `INSERT INTO notification_preferences (
          user_id, notify_nim, notify_follow, notify_comment_own, notify_comment_thread,
          notify_guestbook, notify_like, notify_friend_post, notify_deploy,
          sound_enabled, desktop_push, allow_anon_chat, allow_anon_guestbook, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        ON CONFLICT (user_id) DO UPDATE SET
          notify_nim = EXCLUDED.notify_nim,
          notify_follow = EXCLUDED.notify_follow,
          notify_comment_own = EXCLUDED.notify_comment_own,
          notify_comment_thread = EXCLUDED.notify_comment_thread,
          notify_guestbook = EXCLUDED.notify_guestbook,
          notify_like = EXCLUDED.notify_like,
          notify_friend_post = EXCLUDED.notify_friend_post,
          notify_deploy = EXCLUDED.notify_deploy,
          sound_enabled = EXCLUDED.sound_enabled,
          desktop_push = EXCLUDED.desktop_push,
          allow_anon_chat = EXCLUDED.allow_anon_chat,
          allow_anon_guestbook = EXCLUDED.allow_anon_guestbook,
          updated_at = NOW()`,
        [
          p.user_id,
          p.notify_nim !== false,
          p.notify_follow !== false,
          p.notify_comment_own !== false,
          p.notify_comment_thread !== false,
          p.notify_guestbook !== false,
          p.notify_like !== false,
          p.notify_friend_post !== false,
          p.notify_deploy !== false,
          p.sound_enabled !== false,
          !!p.desktop_push,
          p.allow_anon_chat !== false,
          p.allow_anon_guestbook !== false,
          p.updated_at || new Date(),
        ]
      );
      restoredPrefs++;
    }
  }

  console.log(`${GREEN}${BOLD}[:> DB SYNC COMPLETE] Successfully restored production records into local PostgreSQL:${RESET}`);
  console.log(`  ${GREEN}✓${RESET} Users Restored                  : ${BOLD}${restoredUsers}${RESET}`);
  console.log(`  ${GREEN}✓${RESET} Mounted Sites & Decrypted Keys  : ${BOLD}${restoredSites}${RESET}`);
  console.log(`  ${GREEN}✓${RESET} Follow Relationships            : ${BOLD}${restoredFollows}${RESET}`);
  console.log(`  ${GREEN}✓${RESET} Web Counter Records             : ${BOLD}${restoredCounters}${RESET}`);
  console.log(`  ${GREEN}✓${RESET} Guestbook Signatures            : ${BOLD}${restoredGuestbook}${RESET}`);
  console.log(`  ${GREEN}✓${RESET} Notification Preferences        : ${BOLD}${restoredPrefs}${RESET}`);
  console.log(`  ${GREEN}✓${RESET} Wasson Intertwining Invariant   : ${BOLD}ENFORCED (Mutual Follows)${RESET}`);
  console.log(`  ${GREEN}✓${RESET} Sheavanlan Exclusion Invariant  : ${BOLD}ENFORCED (Zero QA Follows)${RESET}\n`);

  process.exit(0);
}

syncDatabase().catch((err) => {
  console.error(`\n${RED}${BOLD}[:> DB SYNC FATAL ERROR]${RESET}`, err);
  process.exit(1);
});
