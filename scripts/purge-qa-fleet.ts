/**
 * Neogram SysOp QA Fleet Purge CLI
 * =================================
 * Safely purges stale test posts and comments created by QA personas (@qa.neogram.club):
 *   1. Deletes all QA posts across all static galleries.
 *   2. Removes remote uploaded photo assets from Neocities, Nekoweb, and GitHub.
 *   3. Cleans QA comments from other cyberspace users' posts.
 *   4. Purges QA guestbook entries, notifications, and post likes.
 *   5. Rebuilds clean baseline empty static galleries (posts: [], feed.json: []).
 *   6. Queues throttled, rate-paced background deploy jobs to update remote hosts to empty state.
 *   7. Rebuilds remaining creators' static galleries (e.g. @wasson).
 *
 * STRICT SAFETY INVARIANT:
 *   NEVER wipes or resets QA user accounts, friend graph connections (follows),
 *   or mounted site credentials (sites). Only test content is purged.
 *
 * Usage:
 *   npm run qa:purge                   # Purge QA content on local dev server (http://localhost:4000)
 *   npm run qa:purge -- --prod         # Purge QA content on production cluster (https://neogram.club)
 *   npm run qa:purge -- --token=<jwt>  # Specify explicit SysOp admin JWT
 */

import fs from 'fs';
import path from 'path';
import http from 'http';
import jwt from 'jsonwebtoken';
import { config } from '../server/config';

// Retro ANSI colors
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

function parseArgs() {
  const args = process.argv.slice(2);
  const options: Record<string, string | boolean> = {};
  for (const arg of args) {
    if (arg.startsWith('--')) {
      const clean = arg.slice(2);
      if (clean.includes('=')) {
        const [k, ...v] = clean.split('=');
        options[k] = v.join('=');
      } else {
        options[clean] = true;
      }
    }
  }
  return options;
}

async function isLocalPortOpen(port = 4000): Promise<boolean> {
  try {
    const res = await fetch(`http://localhost:${port}/api/health`, { signal: AbortSignal.timeout(1200) });
    return res.ok;
  } catch {
    return false;
  }
}

async function getAdminToken(baseUrl: string, adminEmail = 'wasson@gmail.com', opts: Record<string, any> = {}): Promise<{ token?: string; cookie?: string }> {
  // 1. Check if token or cookie passed via options or environment
  const cliToken = (typeof opts.token === 'string' ? opts.token : null) || process.env.ADMIN_TOKEN || process.env.SYSOP_TOKEN;
  if (cliToken) return { token: cliToken };

  const cliCookie = (typeof opts.cookie === 'string' ? opts.cookie : null) || process.env.ADMIN_COOKIE || process.env.SYSOP_COOKIE;
  if (cliCookie) return { cookie: cliCookie };

  // 2. In local mode or dev mode: obtain via demo OTP or direct JWT sign
  if (baseUrl.includes('localhost') || baseUrl.includes('127.0.0.1')) {
    try {
      const r1 = await fetch(`${baseUrl}/api/auth/request-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Test-Suite': 'true' },
        body: JSON.stringify({ identifier: adminEmail }),
      });
      const j1 = (await r1.json()) as any;
      if (j1 && j1.demoCode) {
        const r2 = await fetch(`${baseUrl}/api/auth/verify-otp`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Test-Suite': 'true' },
          body: JSON.stringify({ identifier: adminEmail, code: j1.demoCode }),
        });
        const j2 = (await r2.json()) as any;
        if (j2 && j2.token) return { token: j2.token };
      }
    } catch {}

    // Fallback: mint local JWT token for wasson@gmail.com
    try {
      const { initDatabase, query } = await import('../server/db');
      await initDatabase();
      let wassonRes = await query(`SELECT id FROM users WHERE LOWER(email) = $1 OR LOWER(handle) = 'wasson'`, [adminEmail.toLowerCase()]);
      let adminUserId = wassonRes.rows[0]?.id || '40ac5144-308d-4c30-92f2-5fb612a632e8';
      const token = jwt.sign(
        { userId: adminUserId, email: adminEmail, scope: 'full' },
        config.jwtSecret,
        { expiresIn: '7d' }
      );
      return { token };
    } catch {
      const token = jwt.sign(
        { userId: '40ac5144-308d-4c30-92f2-5fb612a632e8', email: adminEmail, scope: 'full' },
        config.jwtSecret,
        { expiresIn: '7d' }
      );
      return { token };
    }
  }

  // 3. Fallback: check qa-sessions.json for existing token if valid
  const bundlePath = path.resolve(process.cwd(), 'qa-sessions.json');
  if (fs.existsSync(bundlePath)) {
    try {
      const bundle = JSON.parse(fs.readFileSync(bundlePath, 'utf-8'));
      const adminAgent = (bundle.agents || []).find(
        (a: any) => (a.email && a.email.toLowerCase() === adminEmail.toLowerCase()) || a.handle === 'qa_admin'
      );
      if (adminAgent && adminAgent.token) return { token: adminAgent.token };
    } catch {}
  }

  // 4. Production OTP Verification via --code=<6-digit>
  if (opts.code && typeof opts.code === 'string') {
    const res = await fetch(`${baseUrl}/api/auth/verify-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: adminEmail, code: opts.code.trim() }),
    });
    const data = (await res.json()) as any;
    if (res.ok && data.token) {
      return { token: data.token };
    }
    throw new Error(`Failed to verify OTP code on ${baseUrl}: ${data.error || 'Invalid code'}`);
  }

  // 5. Production OTP Request via --request-otp
  if (opts['request-otp']) {
    const res = await fetch(`${baseUrl}/api/auth/request-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: adminEmail }),
    });
    const data = (await res.json()) as any;
    if (res.ok) {
      console.log(`\n${GREEN}✓ Dispatched 6-digit OTP login code to ${adminEmail}.${RESET}`);
      console.log(`Check your email and re-run with:`);
      console.log(`  ${YELLOW}npm run qa:purge -- --prod --code=YOUR_6_DIGIT_CODE${RESET}\n`);
      process.exit(0);
    }
    throw new Error(`Failed to dispatch OTP: ${data.error || 'Unknown error'}`);
  }

  throw new Error(`Could not obtain SysOp admin authentication token for ${adminEmail}.\nPass --token=<jwt>, --cookie="...", or run with --request-otp to receive a code.`);
}

async function main() {
  const opts = parseArgs();

  console.log(`\n${CYAN}${BOLD}================================================================================${RESET}`);
  console.log(`${CYAN}${BOLD}  [:> SYSOP CONTROL] NEOGRAM QA FLEET CONTENT PURGE CONTROLLER                  ${RESET}`);
  console.log(`${CYAN}${BOLD}================================================================================${RESET}\n`);

  // Target resolution: default to local unless --prod is specified
  let targetUrl: string;
  if (opts.prod) {
    targetUrl = 'https://neogram.club';
  } else if (opts.local || process.env.NODE_ENV !== 'production' || !opts.prod) {
    targetUrl = 'http://localhost:4000';
  } else {
    targetUrl = 'https://neogram.club';
  }

  targetUrl = targetUrl.replace(/\/+$/, '');
  const isLocal = targetUrl.includes('localhost') || targetUrl.includes('127.0.0.1');

  console.log(`${CYAN}Target Workstation :${RESET} ${YELLOW}${BOLD}${targetUrl}${RESET} ${isLocal ? '(Local Dev Server)' : '(Production Cluster)'}`);
  
  const adminEmail = (typeof opts.admin === 'string' ? opts.admin : null) || 'wasson@gmail.com';
  console.log(`${CYAN}SysOp Operator     :${RESET} ${BOLD}${adminEmail}${RESET}`);

  // If targeting local and server is not running, boot it automatically
  let localServer: http.Server | null = null;
  if (isLocal && !(await isLocalPortOpen(4000))) {
    console.log(`${CYAN}Local Server       :${RESET} Starting server on port 4000...`);
    const { initDatabase } = await import('../server/db');
    await initDatabase();
    const { createApp } = await import('../server/app');
    const app = createApp();
    localServer = await new Promise((resolve) => {
      const s = app.listen(4000, '0.0.0.0', () => resolve(s));
    });
    console.log(`${GREEN}✓ Local server ready on http://localhost:4000${RESET}`);
  }

  try {
    // 1. Check existing posts before purge
    console.log(`${CYAN}Scanning Posts     :${RESET} Fetching active cyberspace transmissions...`);
    let initialCount = 0;
    try {
      const allRes = await fetch(`${targetUrl}/api/posts`);
      if (allRes.ok) {
        const allData = (await allRes.json()) as any;
        initialCount = Array.isArray(allData.posts) ? allData.posts.length : 0;
      }
    } catch {}
    console.log(`Found ${BOLD}${initialCount}${RESET} total cyberspace posts before purge.`);

    // 2. Obtain admin auth token
    console.log(`${CYAN}Authenticating     :${RESET} Resolving SysOp permissions for ${adminEmail}...`);
    const auth = await getAdminToken(targetUrl, adminEmail, opts);
    console.log(`${GREEN}✓ Authenticated as SysOp Admin.${RESET}\n`);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-neogram-sysop-op': '1',
      'X-Test-Suite': 'true',
    };
    if (auth.token) headers['Authorization'] = `Bearer ${auth.token}`;
    if (auth.cookie) headers['Cookie'] = auth.cookie.includes('=') ? auth.cookie : `neogram_session=${auth.cookie}`;

    // 3. Trigger Purge API
    process.stdout.write(`[:> EXEC] Purging QA posts, comments, remote files, and rebuilding baseline... `);
    const purgeRes = await fetch(`${targetUrl}/api/admin/qa-fleet/purge-posts`, {
      method: 'POST',
      headers,
    });
    const purgeData = (await purgeRes.json()) as any;
    if (!purgeRes.ok || !purgeData.ok) {
      console.log(`${RED}[FAIL]${RESET} ${purgeData.error || purgeRes.statusText}`);
      throw new Error(`Purge step failed: ${JSON.stringify(purgeData)}`);
    }
    console.log(`${GREEN}[PURGED]${RESET}\n`);
    console.log(`  ${BOLD}Message:${RESET} ${purgeData.message || 'Purge completed successfully.'}`);
    if (typeof purgeData.deletedCount === 'number') {
      console.log(`  ${BOLD}Deleted Posts:${RESET} ${GREEN}${purgeData.deletedCount}${RESET}`);
    }
    if (typeof purgeData.remoteSitesEnqueued === 'number') {
      console.log(`  ${BOLD}Remote Sites Queued:${RESET} ${CYAN}${purgeData.remoteSitesEnqueued}${RESET} (throttled deployment via buildQueue)`);
    }

    // 4. Verify remaining posts
    const verifyRes = await fetch(`${targetUrl}/api/posts`);
    if (verifyRes.ok) {
      const verifyData = (await verifyRes.json()) as any;
      const remaining = Array.isArray(verifyData.posts) ? verifyData.posts : [];
      console.log(`\n${CYAN}Remaining Cyberspace Posts:${RESET} ${BOLD}${remaining.length}${RESET}`);
      for (const [idx, p] of remaining.entries()) {
        console.log(`  [${idx + 1}] @${p.author || 'unknown'} - "${(p.caption || '').slice(0, 40)}" (${p.imageUrl?.slice(0, 45)}...)`);
      }
    }

    console.log(`\n${GREEN}${BOLD}================================================================================${RESET}`);
    console.log(`${GREEN}${BOLD}  ✓ QA FLEET CONTENT PURGE COMPLETED SUCCESSFULLY                               ${RESET}`);
    console.log(`${GREEN}${BOLD}    (Accounts, friend graph, and site configs preserved 100%)                   ${RESET}`);
    console.log(`${GREEN}${BOLD}================================================================================${RESET}\n`);
  } finally {
    if (localServer) {
      localServer.close();
    }
  }
}

main().catch((err) => {
  console.error(`\n${RED}Fatal error:${RESET}`, err.message || err);
  process.exit(1);
});
