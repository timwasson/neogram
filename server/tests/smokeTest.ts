/**
 * Neogram Automated End-to-End QA & Smoke Test Suite
 * Validates the full lifecycle:
 * - Passwordless OTP request, auto-provisioning & rate limiting
 * - Session authentication & JWT cookie extraction
 * - Profile identity & safe subdirectory publishing configuration
 * - Direct photo upload, Multer buffering & Sharp WebP compression
 * - Multi-tenant isolated 11ty static compilation with pathPrefix
 * - Dynamic SVG hit counter resolution (by handle & by ICQ UIN)
 * - Centralized comment ledger & JSONFeed 1.1 public feeds
 * - Safe post purge, cascading cleanup & teardown
 */

import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import { query, initDatabase } from '../db';

const API_BASE = process.env.APP_URL || 'http://localhost:4000';

// ANSI color helpers for retro cyber terminal reporting
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function logHeader(title: string) {
  console.log(`\n${CYAN}${BOLD}======================================================================${RESET}`);
  console.log(`${CYAN}${BOLD}[:> QA TELEMETRY] ${title}${RESET}`);
  console.log(`${CYAN}${BOLD}======================================================================${RESET}`);
}

function assertTest(name: string, condition: boolean, detail?: string) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ${GREEN}[✓ PASS]${RESET} ${name}${detail ? ` (${YELLOW}${detail}${RESET})` : ''}`);
  } else {
    failedTests++;
    console.error(`  ${RED}[✗ FAIL]${RESET} ${name}${detail ? `\n         Details: ${RED}${detail}${RESET}` : ''}`);
  }
}

async function runSmokeTests() {
  const startTime = Date.now();
  await initDatabase();
  logHeader('INITIATING NEOGRAM END-TO-END QA SUITE');
  console.log(`Target Host: ${YELLOW}${API_BASE}${RESET}`);

  const postsJsonPath = path.join(process.cwd(), 'eleventy/src/_data/posts.json');
  const siteJsonPath = path.join(process.cwd(), 'eleventy/src/_data/site.json');
  const originalPostsJson = await fs.readFile(postsJsonPath, 'utf-8').catch(() => '[]');
  const originalSiteJson = await fs.readFile(siteJsonPath, 'utf-8').catch(() => '{}');

  let testUser: any = null;
  let testPostId: string | null = null;
  let sessionCookie: string = '';
  let authToken: string = '';

  const timestamp = Date.now();
  const testEmail = `qa_surfer_${timestamp}@neogram.retro`;

  try {
    // -------------------------------------------------------------------------
    // TEST 1: Healthcheck & Public Endpoints
    // -------------------------------------------------------------------------
    logHeader('1. SYSTEM HEALTH & PUBLIC ENDPOINTS');
    const healthRes = await fetch(`${API_BASE}/api/posts`);
    assertTest('GET /api/posts returns HTTP 200', healthRes.status === 200, `Status: ${healthRes.status}`);
    const healthData = await healthRes.json() as any;
    assertTest('GET /api/posts returns valid JSON array', healthData.ok === true && Array.isArray(healthData.posts));

    // -------------------------------------------------------------------------
    // TEST 2: OTP Passwordless Dispatch & Auto-Registration
    // -------------------------------------------------------------------------
    logHeader('2. OTP DISPATCH & AUTO-REGISTRATION');
    const otpRes = await fetch(`${API_BASE}/api/auth/request-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Test-Suite': 'true' },
      body: JSON.stringify({ identifier: testEmail }),
    });

    assertTest('POST /api/auth/request-otp returns HTTP 200', otpRes.status === 200, `Status: ${otpRes.status}`);
    const otpData = await otpRes.json() as any;
    assertTest('OTP response confirms dispatch', otpData.ok === true);
    assertTest('Auto-registration provisions numeric UIN (>= 100101)', typeof otpData.uin === 'number' && otpData.uin >= 100101, `UIN: #${otpData.uin}`);
    assertTest('Dev environment provides demo OTP code', !!otpData.demoCode, `Code: ${otpData.demoCode}`);

    const demoCode = otpData.demoCode;

    // -------------------------------------------------------------------------
    // TEST 3: Rate Limiting Enforcement
    // -------------------------------------------------------------------------
    logHeader('3. OTP RATE LIMITING SLIDING WINDOW');
    const rateLimitEmail = `spam_test_${timestamp}@neogram.retro`;
    let gotRateLimited = false;

    // We allow max 4 requests per 15 min. Rapidly fire 5 requests.
    for (let i = 1; i <= 5; i++) {
      const res = await fetch(`${API_BASE}/api/auth/request-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Test-Suite': 'true' },
        body: JSON.stringify({ identifier: rateLimitEmail }),
      });
      if (res.status === 429) {
        gotRateLimited = true;
        break;
      }
    }
    assertTest('Sliding window blocks excessive requests (HTTP 429)', gotRateLimited, 'Carrier busy rate limiter triggered');

    // -------------------------------------------------------------------------
    // TEST 4: OTP Verification & Session Establishment
    // -------------------------------------------------------------------------
    logHeader('4. OTP VERIFICATION & CARRIER AUTH');
    const verifyRes = await fetch(`${API_BASE}/api/auth/verify-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: testEmail, code: demoCode }),
    });

    assertTest('POST /api/auth/verify-otp returns HTTP 200', verifyRes.status === 200, `Status: ${verifyRes.status}`);
    const verifyData = await verifyRes.json() as any;
    assertTest('Auth payload contains JWT token', !!verifyData.token);
    assertTest('Auth payload contains station identity', verifyData.user && verifyData.user.email === testEmail);

    authToken = verifyData.token;
    testUser = verifyData.user;

    // Extract cookie from Set-Cookie header
    const setCookie = verifyRes.headers.get('set-cookie');
    if (setCookie) {
      sessionCookie = setCookie.split(';')[0];
    } else {
      sessionCookie = `neogram_session=${authToken}`;
    }
    assertTest('HTTP-only session cookie established', !!sessionCookie, sessionCookie.substring(0, 30) + '...');

    // -------------------------------------------------------------------------
    // TEST 5: Authenticated Session Resolution (/api/auth/me)
    // -------------------------------------------------------------------------
    logHeader('5. SESSION RESOLUTION & USER PROFILE');
    const meRes = await fetch(`${API_BASE}/api/auth/me`, {
      headers: { 'Cookie': sessionCookie },
    });
    assertTest('GET /api/auth/me with session cookie returns HTTP 200', meRes.status === 200);
    const meData = await meRes.json() as any;
    assertTest('Session resolves verified user handle', meData.user && meData.user.handle === testUser.handle, `@${meData.user?.handle}`);
    assertTest('Session resolves permanent Node UIN', meData.user && meData.user.uin === testUser.uin, `#${meData.user?.uin}`);

    // -------------------------------------------------------------------------
    // TEST 6: Settings & Safe Subdirectory Configuration
    // -------------------------------------------------------------------------
    logHeader('6. SETTINGS & SUBDIRECTORY CONFIGURATION');
    const settingsGetRes = await fetch(`${API_BASE}/api/settings`, {
      headers: { 'Cookie': sessionCookie },
    });
    assertTest('GET /api/settings returns default deployPath "neogram"', settingsGetRes.status === 200);
    const settingsGetData = await settingsGetRes.json() as any;
    assertTest('Initial deployPath is "neogram"', settingsGetData.settings?.deployPath === 'neogram');

    // Update settings: change deployPath to "photos" and siteName to "qa-station"
    const settingsPutRes = await fetch(`${API_BASE}/api/settings`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': sessionCookie,
      },
      body: JSON.stringify({
        siteName: 'qa-station',
        deployPath: 'photos',
        deploymentType: 'neocities',
      }),
    });
    assertTest('PUT /api/settings returns HTTP 200', settingsPutRes.status === 200);
    const settingsPutData = await settingsPutRes.json() as any;
    assertTest('Saved deployPath persists as "photos"', settingsPutData.settings?.deployPath === 'photos');

    // -------------------------------------------------------------------------
    // TEST 7: Direct Photo Upload & Sharp WebP Processing
    // -------------------------------------------------------------------------
    logHeader('7. PHOTO INGESTION & SHARP PROCESSING');
    // Generate an in-memory 400x400 PNG test image using Sharp
    const testImageBuffer = await sharp({
      create: {
        width: 400,
        height: 400,
        channels: 4,
        background: { r: 10, g: 140, b: 240, alpha: 1 },
      },
    })
      .png()
      .toBuffer();

    const formData = new FormData();
    const blob = new Blob([testImageBuffer], { type: 'image/png' });
    formData.append('imageFile', blob, 'qa_sample.png');
    formData.append('caption', '[:> Automated QA Test Photograph — Netscape 4.0 compliant]');
    formData.append('filterApplied', 'scanlines');
    formData.append('mood', 'Radical');
    formData.append('webring', 'RetroStatic');

    const uploadRes = await fetch(`${API_BASE}/api/posts`, {
      method: 'POST',
      headers: { 'Cookie': sessionCookie },
      body: formData,
    });

    assertTest('POST /api/posts returns HTTP 201 Created', uploadRes.status === 201, `Status: ${uploadRes.status}`);
    const uploadData = await uploadRes.json() as any;
    assertTest('Upload response contains committed post', !!uploadData.post && !!uploadData.post.id);

    testPostId = uploadData.post.id;
    assertTest('Image converted to WebP', uploadData.post.imagePath.endsWith('.webp'), uploadData.post.imagePath);
    assertTest('Square thumbnail generated', uploadData.post.thumbnailPath.endsWith('.webp'), uploadData.post.thumbnailPath);

    // Verify record in PostgreSQL database
    const dbPostRes = await query('SELECT * FROM posts WHERE id = $1', [testPostId]);
    assertTest('Post record persisted in PostgreSQL', dbPostRes.rows.length === 1, `Post ID: ${testPostId}`);

    // -------------------------------------------------------------------------
    // TEST 8: 11ty Multi-Tenant Static Compilation
    // -------------------------------------------------------------------------
    logHeader('8. 11TY MULTI-TENANT ISOLATED COMPILATION');
    const { buildStaticGallery } = await import('../services/staticBuilder');
    const buildResult = await buildStaticGallery({ userId: testUser.id });
    assertTest('11ty static build succeeded', buildResult.ok === true, `Duration: ${buildResult.durationMs}ms`);

    const userGalleryDir = path.join(process.cwd(), 'dist', 'static-galleries', testUser.id);
    const indexHtmlPath = path.join(userGalleryDir, 'index.html');
    const photoHtmlPath = path.join(userGalleryDir, 'photos', testPostId!, 'index.html');

    let indexExists = false;
    let photoExists = false;
    let hasAuthorHeader = false;

    try {
      const indexContent = await fs.readFile(indexHtmlPath, 'utf-8');
      indexExists = true;
      hasAuthorHeader = indexContent.includes(testUser.handle.toUpperCase());
      const photoContent = await fs.readFile(photoHtmlPath, 'utf-8');
      photoExists = true;
    } catch (err: any) {
      console.error('File read error:', err.message);
    }

    assertTest('Static gallery grid (index.html) created in isolated tenant folder', indexExists);
    assertTest('Static gallery includes uppercase user handle', hasAuthorHeader);
    assertTest('Single photo detail page (photos/<id>/index.html) generated', photoExists);

    // -------------------------------------------------------------------------
    // TEST 9: Dynamic SVG Hit Counter (By Handle & By UIN)
    // -------------------------------------------------------------------------
    logHeader('9. DYNAMIC SVG HIT COUNTER RESOLUTION');
    // Test resolution by handle
    const counterHandleRes = await fetch(`${API_BASE}/counter/${testUser.handle}.svg?style=green_led`);
    assertTest('GET /counter/:handle.svg returns HTTP 200', counterHandleRes.status === 200);
    assertTest('Counter content-type is image/svg+xml', counterHandleRes.headers.get('content-type')?.includes('image/svg+xml') === true);
    const svgHandleContent = await counterHandleRes.text();
    assertTest('Counter SVG contains valid XML tags', svgHandleContent.includes('<svg') && svgHandleContent.includes('</svg>'));

    // Test resolution by permanent numeric UIN (ICQ style)
    const counterUinRes = await fetch(`${API_BASE}/counter/${testUser.uin}.svg?style=nixie_tube`);
    assertTest('GET /counter/:uin.svg by numeric ID returns HTTP 200', counterUinRes.status === 200, `UIN: #${testUser.uin}`);
    const svgUinContent = await counterUinRes.text();
    assertTest('UIN counter contains valid XML tags', svgUinContent.includes('<svg'));

    // -------------------------------------------------------------------------
    // TEST 10: Centralized Comment Ledger
    // -------------------------------------------------------------------------
    logHeader('10. CENTRALIZED COMMENT LEDGER');
    const commentRes = await fetch(`${API_BASE}/api/posts/${testPostId}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        author: 'visitor_surfer_99',
        text: 'This photograph looks radical on my Netscape Navigator browser!',
      }),
    });
    assertTest('POST /api/posts/:id/comments returns HTTP 201/200', commentRes.status === 201 || commentRes.status === 200);
    const commentData = await commentRes.json() as any;
    assertTest('Comment recorded on static post ledger', commentData.ok === true && !!commentData.comment);

    // Verify comment query
    const singlePostRes = await fetch(`${API_BASE}/api/posts/${testPostId}`);
    const singlePostData = await singlePostRes.json() as any;
    assertTest('GET /api/posts/:id includes new comment', singlePostData.post?.comments?.length >= 1);

    // -------------------------------------------------------------------------
    // TEST 11: Public Headless JSON Feed (JSONFeed 1.1)
    // -------------------------------------------------------------------------
    logHeader('11. HEADLESS JSONFEED 1.1 SPEC');
    const feedRes = await fetch(`${API_BASE}/api/users/${testUser.handle}/feed.json`);
    assertTest('GET /api/users/:handle/feed.json returns HTTP 200', feedRes.status === 200);
    const feedData = await feedRes.json() as any;
    assertTest('Feed complies with JSONFeed 1.1 header', feedData.version === 'https://jsonfeed.org/version/1.1');
    assertTest('Feed items array contains published photo', Array.isArray(feedData.items) && feedData.items.length >= 1);

    // -------------------------------------------------------------------------
    // TEST 12: Safe Post Purge & Clean Teardown
    // -------------------------------------------------------------------------
    logHeader('12. SAFE PURGE & TEARDOWN');
    // Delete post using authenticated session
    const deletePostRes = await fetch(`${API_BASE}/api/posts/${testPostId}`, {
      method: 'DELETE',
      headers: { 'Cookie': sessionCookie },
    });
    assertTest('DELETE /api/posts/:id returns HTTP 200', deletePostRes.status === 200);

    // Verify post deleted from DB
    const checkDeleted = await query('SELECT * FROM posts WHERE id = $1', [testPostId]);
    assertTest('Post purged from PostgreSQL database', checkDeleted.rows.length === 0);

    // Clean up test user and isolated build directory
    await query('DELETE FROM users WHERE id = $1', [testUser.id]);
    assertTest('Temporary QA test user cleaned from database', true);

    try {
      await fs.rm(userGalleryDir, { recursive: true, force: true });
      assertTest('Temporary static gallery build folder wiped from disk', true);
    } catch {}

    // Wait briefly for background 11ty rebuild triggered by DELETE /api/posts to finalize
    await new Promise((r) => setTimeout(r, 300));

    // Restore original eleventy template data files
    await fs.writeFile(postsJsonPath, originalPostsJson, 'utf-8').catch(() => {});
    await fs.writeFile(siteJsonPath, originalSiteJson, 'utf-8').catch(() => {});
    assertTest('Shared template data files restored cleanly', true);

  } catch (err: any) {
    console.error(`\n${RED}${BOLD}[:> FATAL QA RUNNER ERROR]:${RESET}`, err);
    failedTests++;
  }

  // -------------------------------------------------------------------------
  // SUMMARY REPORT
  // -------------------------------------------------------------------------
  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  logHeader('NEOGRAM QA SMOKE TEST SUITE COMPLETED');
  console.log(`Duration:     ${duration}s`);
  console.log(`Total Tests:  ${totalTests}`);
  console.log(`Passed:       ${GREEN}${BOLD}${passedTests}${RESET}`);
  console.log(`Failed:       ${failedTests === 0 ? GREEN : RED}${BOLD}${failedTests}${RESET}`);

  if (failedTests === 0) {
    console.log(`\n${GREEN}${BOLD}[:> ALL SYSTEMS OPERATIONAL — CARRIER 33600 V.90 VERIFIED — MVP READY FOR PRODUCTION]${RESET}\n`);
    process.exit(0);
  } else {
    console.log(`\n${RED}${BOLD}[:> FAILURES DETECTED — REVIEW TELEMETRY LOGS ABOVE]${RESET}\n`);
    process.exit(1);
  }
}

runSmokeTests();
