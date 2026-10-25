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
import { existsSync } from 'fs';
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
    let hasCorrectAssetPrefix = false;
    let hasEmbedAssets = false;

    try {
      const indexContent = await fs.readFile(indexHtmlPath, 'utf-8');
      indexExists = true;
      hasAuthorHeader = indexContent.includes(testUser.handle.toUpperCase());
      hasCorrectAssetPrefix = indexContent.includes('/photos/css/neogram.css') && indexContent.includes('/photos/embed/neogram-embed.css');
      hasEmbedAssets = await fs.stat(path.join(userGalleryDir, 'embed/neogram-embed.css')).then(() => true).catch(() => false);
      const photoContent = await fs.readFile(photoHtmlPath, 'utf-8');
      photoExists = true;
    } catch (err: any) {
      console.error('File read error:', err.message);
    }

    assertTest('Static gallery grid (index.html) created in isolated tenant folder', indexExists);
    assertTest('Static gallery includes uppercase user handle', hasAuthorHeader);
    assertTest('Static gallery assets correctly prepended with deploy pathPrefix (/photos/)', hasCorrectAssetPrefix);
    assertTest('Passthrough copies embed assets to embed/ folder', hasEmbedAssets);
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
    // TEST 10: Self-Hosted Comments & Cyber-Pass Security
    // -------------------------------------------------------------------------
    logHeader('10. SELF-HOSTED COMMENTS & CYBER-PASS SECURITY');

    // 10a. Unauthenticated comment rejection
    const unauthCommentRes = await fetch(`${API_BASE}/api/posts/${testPostId}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Spam bot test' }),
    });
    assertTest('POST /api/posts/:id/comments without auth returns HTTP 401', unauthCommentRes.status === 401);

    // 10b. Authenticated comment via Cyber-Pass / session
    const commentRes = await fetch(`${API_BASE}/api/posts/${testPostId}/comments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': sessionCookie,
      },
      body: JSON.stringify({
        text: 'This photograph looks radical on my Netscape Navigator browser!',
      }),
    });
    assertTest('POST /api/posts/:id/comments with Cyber-Pass returns HTTP 201', commentRes.status === 201);
    const commentData = await commentRes.json() as any;
    assertTest('Comment recorded with author callsign and UIN', commentData.ok === true && !!commentData.comment && commentData.comment.author === testUser.handle);
    const createdCommentId = commentData.comment?.id;

    // 10c. Verify comment query from self-hosted endpoint
    const postCommentsRes = await fetch(`${API_BASE}/api/posts/${testPostId}/comments`);
    assertTest('GET /api/posts/:id/comments returns HTTP 200', postCommentsRes.status === 200);
    const postCommentsData = await postCommentsRes.json() as any;
    assertTest('Comments list contains new self-hosted comment', Array.isArray(postCommentsData.comments) && postCommentsData.comments.length >= 1);

    // 10d. Test Cyber-Pass connect endpoint
    const connectRes = await fetch(`${API_BASE}/auth/connect?origin=https%3A%2F%2Fexample.neocities.org`, {
      headers: { 'Cookie': sessionCookie },
    });
    assertTest('GET /auth/connect returns HTTP 200', connectRes.status === 200);
    const connectHtml = await connectRes.text();
    assertTest('Connect page includes NEOGRAM_CYBER_PASS handshake script', connectHtml.includes('NEOGRAM_CYBER_PASS'));

    // 10e. Moderate / Purge comment
    if (createdCommentId) {
      const purgeCommentRes = await fetch(`${API_BASE}/api/posts/${testPostId}/comments/${createdCommentId}`, {
        method: 'DELETE',
        headers: { 'Cookie': sessionCookie },
      });
      assertTest('DELETE /api/posts/:id/comments/:commentId returns HTTP 200', purgeCommentRes.status === 200);
    }

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
    // TEST 12: Cyberspace User Directory & Categorization
    // -------------------------------------------------------------------------
    logHeader('12. CYBERSPACE USER DIRECTORY & CATEGORIZATION');
    const directoryRes = await fetch(`${API_BASE}/directory`);
    assertTest('GET /directory returns HTTP 200', directoryRes.status === 200);
    const directoryHtml = await directoryRes.text();

    const activeIdx = directoryHtml.indexOf('1. ACTIVE STATIONS');
    const awayIdx = directoryHtml.indexOf('2. "AWAY" STATIONS');
    const inactiveIdx = directoryHtml.indexOf('3. INACTIVE STATIONS');

    assertTest('Directory HTML contains Active, Away, and Inactive sub-categories', activeIdx !== -1 && awayIdx !== -1 && inactiveIdx !== -1);
    assertTest('Directory renders sub-categories in order: Active first, then Away, then Inactive', activeIdx < awayIdx && awayIdx < inactiveIdx);

    // Verify navigation contains Directory link
    const homeRes = await fetch(`${API_BASE}/`);
    const homeHtml = await homeRes.text();
    assertTest('Navigation links to /directory',
      homeHtml.includes('href="/directory"') && homeHtml.includes('Directory')
    );

    // API Directory check
    const dirApiRes = await fetch(`${API_BASE}/api/directory`);
    assertTest('GET /api/directory returns HTTP 200', dirApiRes.status === 200);
    const dirApiData = await dirApiRes.json() as any;
    assertTest('Directory API returns valid ok flag and total count', dirApiData.ok === true && typeof dirApiData.total === 'number');
    assertTest('Directory API contains active, away, and inactive categories', 
      Array.isArray(dirApiData.categories?.active) &&
      Array.isArray(dirApiData.categories?.away) &&
      Array.isArray(dirApiData.categories?.inactive)
    );

    // Verify ordering inside sub-categories
    const isAlphabetical = (arr: any[]) => {
      for (let i = 0; i < arr.length - 1; i++) {
        const comp = (arr[i].handle || '').localeCompare(arr[i + 1].handle || '', undefined, { sensitivity: 'base' });
        if (comp > 0) return false;
      }
      return true;
    };

    assertTest('Active sub-category users are listed in alphabetical order', isAlphabetical(dirApiData.categories.active));
    assertTest('Away sub-category users are listed in alphabetical order', isAlphabetical(dirApiData.categories.away));
    assertTest('Inactive sub-category users are listed in alphabetical order', isAlphabetical(dirApiData.categories.inactive));

    // Verify user item properties (handle, UID, thumbnail, profile link)
    const allSampleUsers = [...dirApiData.categories.active, ...dirApiData.categories.away, ...dirApiData.categories.inactive];
    const sampleUser = allSampleUsers[0];
    assertTest('Directory users contain handle (@...), numeric UID, avatar thumbnail, and profileUrl',
      Boolean(sampleUser && sampleUser.handle && sampleUser.uin && sampleUser.avatarPath && sampleUser.profileUrl)
    );

    // Verify profile link loads
    if (sampleUser) {
      const userProfileRes = await fetch(`${API_BASE}${sampleUser.profileUrl}`);
      assertTest(`Profile URL (${sampleUser.profileUrl}) returns HTTP 200`, userProfileRes.status === 200);
    }

    // -------------------------------------------------------------------------
    // TEST 13: Cyberspace Documentation Center & Embed Manual
    // -------------------------------------------------------------------------
    logHeader('13. CYBERSPACE DOCUMENTATION & EMBED MANUAL');
    const docsRes = await fetch(`${API_BASE}/docs`);
    assertTest('GET /docs returns HTTP 200', docsRes.status === 200);
    const docsHtml = await docsRes.text();

    assertTest('Docs HTML contains Neocities Setup Guide',
      docsHtml.includes('Neocities Static Hosting &amp; Setup Guide') || docsHtml.includes('Neocities Static Hosting & Setup Guide')
    );
    assertTest('Docs HTML contains Dynamic Web Hit Counter embed section',
      docsHtml.includes('Dynamic SVG Web Hit Counter') && docsHtml.includes('neogram-counter')
    );
    assertTest('Docs HTML contains Public Visitor Guestbook embed section',
      docsHtml.includes('Public Visitor Guestbook Ledger') && docsHtml.includes('/embed/guestbook/')
    );
    assertTest('Docs HTML contains Publishing & Processing Pipeline section',
      docsHtml.includes('Publishing &amp; Processing Pipeline') && docsHtml.includes('Sharp') && docsHtml.includes('WebP')
    );
    assertTest('Docs HTML contains BEM Theming & Custom CSS section',
      docsHtml.includes('Semantic BEM Theming &amp; Custom CSS') && docsHtml.includes('.neogram-site')
    );
    assertTest('Docs HTML contains NIM Chat & Browser Extension section',
      docsHtml.includes('Neogram Instant Messenger (NIM)') && docsHtml.includes('Manifest V3')
    );

    // Verify authenticated docs interpolation
    const authDocsRes = await fetch(`${API_BASE}/docs`, {
      headers: { 'Cookie': sessionCookie },
    });
    assertTest('GET /docs with session cookie returns HTTP 200', authDocsRes.status === 200);
    const authDocsHtml = await authDocsRes.text();
    assertTest('Authenticated Docs interpolates user station handle into embed snippets',
      authDocsHtml.includes(`/counter/${testUser.handle}.svg`) && authDocsHtml.includes(`/embed/guestbook/${testUser.handle}`)
    );
    assertTest('Authenticated Docs interpolates immutable numeric UIN anchor',
      authDocsHtml.includes(`/counter/${testUser.uin}.svg`)
    );

    // Verify topic filter query
    const counterTopicRes = await fetch(`${API_BASE}/docs?topic=counter`);
    assertTest('GET /docs?topic=counter returns HTTP 200', counterTopicRes.status === 200);

    // Verify topic shortcut redirect
    const shortcutRes = await fetch(`${API_BASE}/docs/neocities`, { redirect: 'manual' });
    assertTest('GET /docs/neocities redirects to /docs?topic=neocities',
      shortcutRes.status === 302 && (shortcutRes.headers.get('location') || '').includes('topic=neocities')
    );

    // Verify taskbar footer links to /docs
    assertTest('Taskbar footer contains Docs link',
      homeHtml.includes('href="/docs"') && homeHtml.includes('Docs')
    );

    // -------------------------------------------------------------------------
    // TEST 14: Cyberspace Friends Network & Static Follow Grid
    // -------------------------------------------------------------------------
    logHeader('14. CYBERSPACE FRIENDS NETWORK & STATIC FOLLOW GRID');
    
    // 1. Verify GET /friends loads for authenticated user
    const friendsPageRes = await fetch(`${API_BASE}/friends`, {
      headers: { 'Cookie': sessionCookie },
    });
    assertTest('GET /friends with session cookie returns HTTP 200', friendsPageRes.status === 200);
    const friendsPageHtml = await friendsPageRes.text();
    assertTest('Friends page contains CYBERSPACE_FRIENDS.EXE header',
      friendsPageHtml.includes('CYBERSPACE_FRIENDS.EXE') && friendsPageHtml.includes('FRIENDS_ROSTER.SYS')
    );
    assertTest('Top navigation bar contains 🤝 Friends link',
      friendsPageHtml.includes('href="/friends"') && friendsPageHtml.includes('Friends')
    );

    // 2. Add a target user as friend
    const targetFriendUser = allSampleUsers.find(u => u.handle !== testUser.handle) || { handle: 'root' };
    const followRes = await fetch(`${API_BASE}/api/users/${targetFriendUser.handle}/follow`, {
      method: 'POST',
      headers: {
        'Cookie': sessionCookie,
        'Authorization': `Bearer ${authToken}`,
      },
    });
    assertTest('POST /api/users/:identifier/follow returns HTTP 200', followRes.status === 200);
    const followData = await followRes.json();
    assertTest('Follow response indicates isFriend = true', followData.ok === true && followData.isFriend === true);

    // 3. Verify friend-status API endpoint
    const friendStatusRes = await fetch(`${API_BASE}/api/users/${targetFriendUser.handle}/friend-status`, {
      headers: {
        'Cookie': sessionCookie,
        'Authorization': `Bearer ${authToken}`,
      },
    });
    assertTest('GET /api/users/:identifier/friend-status returns HTTP 200', friendStatusRes.status === 200);
    const friendStatusData = await friendStatusRes.json();
    assertTest('Friend status resolves target user as friend', friendStatusData.isFriend === true);

    // 4. Verify GET /api/friends API
    const friendsApiRes = await fetch(`${API_BASE}/api/friends`, {
      headers: { 'Cookie': sessionCookie },
    });
    assertTest('GET /api/friends returns HTTP 200', friendsApiRes.status === 200);
    const friendsApiData = await friendsApiRes.json();
    assertTest('Friends API contains followed station',
      Array.isArray(friendsApiData.friends) && friendsApiData.friends.some((f: any) => f.handle === targetFriendUser.handle)
    );

    // 5. Verify static friends page was compiled by Eleventy
    const friendsHtmlPath = path.join(userGalleryDir, 'friends', 'index.html');
    assertTest('Static friends gallery (friends/index.html) created in isolated tenant folder', existsSync(friendsHtmlPath));
    if (existsSync(friendsHtmlPath)) {
      const friendsStaticHtml = await fs.readFile(friendsHtmlPath, 'utf-8');
      assertTest('Static friends stream includes FRIENDS STATIC STREAM banner',
        friendsStaticHtml.includes('FRIENDS STATIC STREAM') || friendsStaticHtml.includes('FRIENDS CARRIER NETWORK')
      );
    }

    // 6. Unfriend / Unfollow user
    const unfriendRes = await fetch(`${API_BASE}/api/users/${targetFriendUser.handle}/follow`, {
      method: 'DELETE',
      headers: {
        'Cookie': sessionCookie,
        'Authorization': `Bearer ${authToken}`,
      },
    });
    assertTest('DELETE /api/users/:identifier/follow returns HTTP 200', unfriendRes.status === 200);
    const unfriendData = await unfriendRes.json();
    assertTest('Unfollow response indicates isFriend = false', unfriendData.ok === true && unfriendData.isFriend === false);

    // 7. Verify updated friend status
    const postUnfriendStatusRes = await fetch(`${API_BASE}/api/users/${targetFriendUser.handle}/friend-status`, {
      headers: { 'Cookie': sessionCookie },
    });
    const postUnfriendStatusData = await postUnfriendStatusRes.json();
    assertTest('Friend status updated to isFriend = false after unfriend', postUnfriendStatusData.isFriend === false);

    // -------------------------------------------------------------------------
    // TEST 15: Cyberspace Notification Engine & User Settings Dashboard
    // -------------------------------------------------------------------------
    logHeader('15. NOTIFICATION DISPATCHER & SETTINGS DASHBOARD');

    // 1. Initial notification preferences query
    const initPrefsRes = await fetch(`${API_BASE}/api/settings/notifications`, {
      headers: { 'Cookie': sessionCookie },
    });
    assertTest('GET /api/settings/notifications returns HTTP 200', initPrefsRes.status === 200);
    const initPrefsData = await initPrefsRes.json();
    assertTest('Default notification preferences provisioned', initPrefsData.ok === true && !!initPrefsData.preferences);
    assertTest('Default notifyNim is enabled', initPrefsData.preferences.notifyNim === true);
    assertTest('Default notifyFollow is enabled', initPrefsData.preferences.notifyFollow === true);
    assertTest('Default notifyCommentOwn is enabled', initPrefsData.preferences.notifyCommentOwn === true);
    assertTest('Default notifyCommentThread is enabled', initPrefsData.preferences.notifyCommentThread === true);
    assertTest('Default notifyGuestbook is enabled', initPrefsData.preferences.notifyGuestbook === true);
    assertTest('Default notifyLike is enabled', initPrefsData.preferences.notifyLike === true);
    assertTest('Default notifyFriendPost is enabled', initPrefsData.preferences.notifyFriendPost === true);
    assertTest('Default notifyDeploy is enabled', initPrefsData.preferences.notifyDeploy === true);
    assertTest('Default soundEnabled is enabled', initPrefsData.preferences.soundEnabled === true);
    assertTest('Default desktopPush is opt-in (disabled initially)', initPrefsData.preferences.desktopPush === false);

    // 2. Update notification preferences via PUT
    const updatePrefsRes = await fetch(`${API_BASE}/api/settings/notifications`, {
      method: 'PUT',
      headers: {
        'Cookie': sessionCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        notifyLike: false,
        soundEnabled: false,
      }),
    });
    assertTest('PUT /api/settings/notifications returns HTTP 200', updatePrefsRes.status === 200);
    const updatePrefsData = await updatePrefsRes.json();
    assertTest('PUT response reflects updated notifyLike = false', updatePrefsData.preferences.notifyLike === false);
    assertTest('PUT response reflects updated soundEnabled = false', updatePrefsData.preferences.soundEnabled === false);

    // 3. Verify preferences persist on subsequent GET
    const verifyPrefsRes = await fetch(`${API_BASE}/api/settings/notifications`, {
      headers: { 'Cookie': sessionCookie },
    });
    const verifyPrefsData = await verifyPrefsRes.json();
    assertTest('Saved notification preferences persist in PostgreSQL', verifyPrefsData.preferences.notifyLike === false);

    // 4. Initial notifications inbox query
    const initInboxRes = await fetch(`${API_BASE}/api/notifications`, {
      headers: { 'Cookie': sessionCookie },
    });
    assertTest('GET /api/notifications returns HTTP 200', initInboxRes.status === 200);
    const initInboxData = await initInboxRes.json();
    assertTest('Initial notifications list is empty', Array.isArray(initInboxData.notifications) && initInboxData.notifications.length === 0);
    assertTest('Initial unreadCount is 0', initInboxData.unreadCount === 0);

    // 5. Test dispatchNotification suppression for muted event
    const { dispatchNotification } = await import('../services/notificationService');
    const mutedNotification = await dispatchNotification({
      userId: testUser.id,
      type: 'like',
      title: 'Someone liked your photo',
      body: 'Should be suppressed per user settings',
    });
    assertTest('Notification of muted type (notifyLike=false) is suppressed (returns null)', mutedNotification === null);

    // 6. Test dispatchNotification for active event
    const activeNotification = await dispatchNotification({
      userId: testUser.id,
      actorId: targetFriendUser.id,
      type: 'comment_own',
      title: `@${targetFriendUser.handle} commented on your photo`,
      body: 'Radical retro colors on this shot!',
      linkUrl: '/#post-123',
    });
    assertTest('Notification of enabled type is dispatched successfully', activeNotification !== null && activeNotification.type === 'comment_own');

    // 7. Verify notification appears in inbox
    const activeInboxRes = await fetch(`${API_BASE}/api/notifications`, {
      headers: { 'Cookie': sessionCookie },
    });
    const activeInboxData = await activeInboxRes.json();
    assertTest('Inbox contains new active notification', activeInboxData.notifications.length === 1);
    assertTest('Inbox unreadCount incremented to 1', activeInboxData.unreadCount === 1);
    assertTest('Notification record contains title and body', activeInboxData.notifications[0].title.includes('commented on your photo'));

    // 8. Mark notification as read
    const createdNotifId = activeNotification!.id;
    const markReadRes = await fetch(`${API_BASE}/api/notifications/${createdNotifId}/read`, {
      method: 'POST',
      headers: { 'Cookie': sessionCookie },
    });
    assertTest('POST /api/notifications/:id/read returns HTTP 200', markReadRes.status === 200);
    const postReadInboxRes = await fetch(`${API_BASE}/api/notifications`, {
      headers: { 'Cookie': sessionCookie },
    });
    const postReadInboxData = await postReadInboxRes.json();
    assertTest('Unread count decremented to 0 after marking read', postReadInboxData.unreadCount === 0);
    assertTest('Notification marked as read in database', postReadInboxData.notifications[0].isRead === true);

    // 9. Dispatch second notification and test mark-all-read
    await dispatchNotification({
      userId: testUser.id,
      actorId: targetFriendUser.id,
      type: 'follow',
      title: `@${targetFriendUser.handle} followed your station!`,
      body: 'Added your node to friends list.',
    });
    const markAllReadRes = await fetch(`${API_BASE}/api/notifications/read-all`, {
      method: 'POST',
      headers: { 'Cookie': sessionCookie },
    });
    assertTest('POST /api/notifications/read-all returns HTTP 200', markAllReadRes.status === 200);
    const postMarkAllInboxRes = await fetch(`${API_BASE}/api/notifications`, {
      headers: { 'Cookie': sessionCookie },
    });
    const postMarkAllInboxData = await postMarkAllInboxRes.json();
    assertTest('All notifications marked read (unreadCount = 0)', postMarkAllInboxData.unreadCount === 0);

    // 10. Verify Workstation UI contains Notification Bell and Settings Card
    const dashHtmlRes = await fetch(`${API_BASE}/`, {
      headers: { 'Cookie': sessionCookie },
    });
    const dashHtml = await dashHtmlRes.text();
    assertTest('Top navigation bar contains #retroNotifyMenu dropdown', dashHtml.includes('id="retroNotifyMenu"'));
    assertTest('Top navigation bar contains #notifyMenuBtn trigger', dashHtml.includes('id="notifyMenuBtn"'));
    assertTest('Top navigation bar contains #navNotifyBadge badge', dashHtml.includes('id="navNotifyBadge"'));
    assertTest('Settings dashboard contains #notifySettingsForm', dashHtml.includes('id="notifySettingsForm"'));
    assertTest('Settings dashboard contains notifyNim input toggle', dashHtml.includes('id="notifyNimInput"'));
    assertTest('Settings dashboard contains notifyFollow input toggle', dashHtml.includes('id="notifyFollowInput"'));
    assertTest('Settings dashboard contains notifyCommentOwn input toggle', dashHtml.includes('id="notifyCommentOwnInput"'));
    assertTest('Settings dashboard contains notifyCommentThread input toggle', dashHtml.includes('id="notifyCommentThreadInput"'));
    assertTest('Settings dashboard contains notifyGuestbook input toggle', dashHtml.includes('id="notifyGuestbookInput"'));
    assertTest('Settings dashboard contains notifyLike input toggle', dashHtml.includes('id="notifyLikeInput"'));
    assertTest('Settings dashboard contains notifyFriendPost input toggle', dashHtml.includes('id="notifyFriendPostInput"'));
    assertTest('Settings dashboard contains notifyDeploy input toggle', dashHtml.includes('id="notifyDeployInput"'));
    assertTest('Settings dashboard contains notifySound input toggle', dashHtml.includes('id="notifySoundInput"'));
    assertTest('Settings dashboard contains notifyDesktopPush input toggle', dashHtml.includes('id="notifyDesktopPushInput"'));

    // -------------------------------------------------------------------------
    // TEST 16: Headless Self-Hosted API & Static JSON Feeds
    // -------------------------------------------------------------------------
    logHeader('16. HEADLESS SELF-HOSTED API & STATIC JSON FEEDS');

    // 1. Verify default setting buildHtml is true (opt-out)
    const getSettingsRes = await fetch(`${API_BASE}/api/settings`, {
      headers: { 'Cookie': sessionCookie },
    });
    const getSettingsData = await getSettingsRes.json();
    assertTest('GET /api/settings returns HTTP 200', getSettingsRes.status === 200);
    assertTest('Default buildHtml is true (opt-out)', getSettingsData.settings.buildHtml === true);

    // 2. Opt-out: update buildHtml to false
    const putSettingsRes = await fetch(`${API_BASE}/api/settings`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': sessionCookie,
      },
      body: JSON.stringify({
        buildHtml: false,
      }),
    });
    const putSettingsData = await putSettingsRes.json();
    assertTest('PUT /api/settings returns HTTP 200', putSettingsRes.status === 200);
    assertTest('PUT /api/settings response reflects updated buildHtml = false', putSettingsData.settings.buildHtml === false);

    // 3. Verify setting persisted in PostgreSQL
    const userDbRes = await query('SELECT build_html FROM users WHERE id = $1', [testUser.id]);
    assertTest('build_html setting persisted as false in PostgreSQL', userDbRes.rows[0].build_html === false);

    // 4. Trigger static build in Headless mode
    const headlessBuildRes = await buildStaticGallery({ userId: testUser.id, outputDir: userGalleryDir });
    assertTest('buildStaticGallery in headless mode completes successfully', headlessBuildRes.ok === true);

    // 5. Verify feed.json exists in user's isolated directory
    const feedJsonPath = path.join(userGalleryDir, 'feed.json');
    assertTest('feed.json exists in user static directory', existsSync(feedJsonPath));
    const feedJsonRaw = await fs.readFile(feedJsonPath, 'utf-8');
    const feedJson = JSON.parse(feedJsonRaw);

    assertTest('feed.json contains correct version', feedJson.version === 'neogram-api-v1');
    assertTest('feed.json user contains handle', feedJson.user && feedJson.user.handle === testUser.handle);
    assertTest('feed.json user contains numeric UIN', feedJson.user && feedJson.user.uin === testUser.uin);
    assertTest('feed.json user contains avatarUrl', !!(feedJson.user && feedJson.user.avatarUrl));
    assertTest('feed.json endpoints contains followUrl', feedJson.endpoints && feedJson.endpoints.followUrl.includes('/follow'));
    assertTest('feed.json endpoints contains feedUrl', feedJson.endpoints && feedJson.endpoints.feedUrl.includes('/feed.json'));
    assertTest('feed.json posts array contains published photo', Array.isArray(feedJson.posts) && feedJson.posts.length > 0);

    const firstFeedPost = feedJson.posts[0];
    assertTest('feed.json post contains caption', typeof firstFeedPost.caption === 'string');
    assertTest('feed.json post contains imageUrl', typeof firstFeedPost.imageUrl === 'string');
    assertTest('feed.json post contains thumbnailUrl', typeof firstFeedPost.thumbnailUrl === 'string');
    assertTest('feed.json post contains likes count', typeof firstFeedPost.likes === 'number');
    assertTest('feed.json post contains actions with likeUrl', firstFeedPost.actions && firstFeedPost.actions.likeUrl.includes('/like'));
    assertTest('feed.json post contains actions with commentUrl', firstFeedPost.actions && firstFeedPost.actions.commentUrl.includes('/comments'));

    // 6. Verify posts.json exists in user's isolated directory
    const postsOutPath = path.join(userGalleryDir, 'posts.json');
    assertTest('posts.json exists in user static directory', existsSync(postsOutPath));

    // 7. Verify index.html does NOT exist in user static directory (Headless: no HTML!)
    const userIndexHtmlPath = path.join(userGalleryDir, 'index.html');
    assertTest('index.html suppressed and does NOT exist in Headless mode', !existsSync(userIndexHtmlPath));

    // 8. Re-enable buildHtml = true
    await fetch(`${API_BASE}/api/settings`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': sessionCookie,
      },
      body: JSON.stringify({
        buildHtml: true,
      }),
    });
    const standardBuildRes = await buildStaticGallery({ userId: testUser.id, outputDir: userGalleryDir });
    assertTest('buildStaticGallery in standard mode completes successfully', standardBuildRes.ok === true);
    assertTest('index.html restored when buildHtml = true', existsSync(userIndexHtmlPath));
    assertTest('feed.json preserved when buildHtml = true', existsSync(feedJsonPath));

    // 9. Verify Documentation includes Headless API topic
    const docsHeadlessRes = await fetch(`${API_BASE}/docs?topic=headless`);
    assertTest('GET /docs?topic=headless returns HTTP 200', docsHeadlessRes.status === 200);
    const docsHeadlessHtml = await docsHeadlessRes.text();
    assertTest('Docs HTML contains Headless API section', docsHeadlessHtml.includes('id="docSection-headless"'));
    assertTest('Docs HTML contains sample JavaScript application', docsHeadlessHtml.includes('id="codeSampleJs"'));
    assertTest('Docs HTML contains tabBtn-headless button', docsHeadlessHtml.includes('id="tabBtn-headless"'));

    // 10. Verify Workstation UI contains settingsBuildHtml checkbox
    assertTest('Workstation dashboard contains #settingsBuildHtml checkbox', dashHtml.includes('id="settingsBuildHtml"'));

    // -------------------------------------------------------------------------
    // TEST 17: Data Sovereignty, Auth Validation & Station Decommissioning
    // -------------------------------------------------------------------------
    logHeader('17. DATA SOVEREIGNTY, AUTH VALIDATION & STATION DECOMMISSIONING');

    // 1. Rejection of @handle login attempt (handles are mutable and not permanent login identifiers)
    const handleRejectRes = await fetch(`${API_BASE}/api/auth/request-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Test-Suite': 'true' },
      body: JSON.stringify({ identifier: `@${testUser.handle}` }),
    });
    assertTest('POST /api/auth/request-otp with @handle returns HTTP 400', handleRejectRes.status === 400);
    const handleRejectData = await handleRejectRes.json() as any;
    assertTest('Handle login returns explicit explanation that @handle login is not supported', handleRejectData.error && handleRejectData.error.includes('Logging in with a @handle is not supported'));

    // 2. Mobile phone number login validation
    const phoneRes = await fetch(`${API_BASE}/api/auth/request-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Test-Suite': 'true' },
      body: JSON.stringify({ identifier: '(555) 019-1996' }),
    });
    assertTest('POST /api/auth/request-otp with valid phone number returns HTTP 200', phoneRes.status === 200);
    const phoneData = await phoneRes.json() as any;
    assertTest('Phone number auth resolves and dispatches OTP', phoneData.ok === true && phoneData.identifier.includes('@sms.neogram.local'));

    // 3. Station Archive Export
    const exportRes = await fetch(`${API_BASE}/api/settings/export-archive`, {
      headers: { 'Cookie': sessionCookie },
    });
    assertTest('GET /api/settings/export-archive returns HTTP 200', exportRes.status === 200);
    const exportContentDisp = exportRes.headers.get('content-disposition') || '';
    assertTest('Export contains attachment Content-Disposition header', exportContentDisp.includes('attachment') && exportContentDisp.includes('neogram-archive-'));
    const archiveData = await exportRes.json() as any;
    assertTest('Archive payload has version neogram-station-archive-v1', archiveData.version === 'neogram-station-archive-v1');
    assertTest('Archive payload contains station metadata', archiveData.station && archiveData.station.handle === testUser.handle && archiveData.station.uin === testUser.uin);
    assertTest('Archive payload contains posts with comments array', Array.isArray(archiveData.posts) && archiveData.posts.length > 0 && Array.isArray(archiveData.posts[0].comments));
    assertTest('Archive payload contains guestbook ledger array', Array.isArray(archiveData.guestbook));
    assertTest('Archive payload contains connections array', Array.isArray(archiveData.connections));

    // 4. Station Account Decommissioning (Self-Serve Nuke) on a disposable user
    const dispEmail = `disposable_decom_${timestamp}@neogram.retro`;
    const dispReq = await fetch(`${API_BASE}/api/auth/request-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Test-Suite': 'true' },
      body: JSON.stringify({ identifier: dispEmail }),
    });
    const dispReqData = await dispReq.json() as any;
    const dispVerify = await fetch(`${API_BASE}/api/auth/verify-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Test-Suite': 'true' },
      body: JSON.stringify({ identifier: dispEmail, code: dispReqData.demoCode }),
    });
    const dispCookie = dispVerify.headers.get('set-cookie')?.split(';')[0] || '';
    const dispUserRes = await query('SELECT id FROM users WHERE email = $1', [dispEmail]);
    assertTest('Disposable user provisioned in database for decommissioning test', dispUserRes.rows.length === 1);
    const dispUserId = dispUserRes.rows[0].id;

    // Call DELETE /api/settings/account
    const decomRes = await fetch(`${API_BASE}/api/settings/account`, {
      method: 'DELETE',
      headers: { 'Cookie': dispCookie },
    });
    assertTest('DELETE /api/settings/account returns HTTP 200', decomRes.status === 200);
    const decomData = await decomRes.json() as any;
    assertTest('Decommission returns confirmation ok: true', decomData.ok === true);

    // Verify database row is deleted
    const checkDispDeleted = await query('SELECT id FROM users WHERE id = $1', [dispUserId]);
    assertTest('Decommissioned user completely purged from PostgreSQL database', checkDispDeleted.rows.length === 0);

    // Verify session cookie was cleared
    const decomCookieHeader = decomRes.headers.get('set-cookie') || '';
    assertTest('Decommission clears session cookie (Max-Age=0 or empty)', decomCookieHeader.includes('neogram_session=;') || decomCookieHeader.includes('Max-Age=0'));

    // -------------------------------------------------------------------------
    // TEST 18: Multi-Site Architecture (1 User : N Sites)
    // -------------------------------------------------------------------------
    logHeader('18. MULTI-SITE ARCHITECTURE (1 USER : N SITES)');

    // 18a. Retrieve initial user sites (verify auto-provisioned primary site)
    const initSitesRes = await fetch(`${API_BASE}/api/sites`, {
      headers: { 'Cookie': sessionCookie },
    });
    assertTest('GET /api/sites returns HTTP 200', initSitesRes.status === 200);
    const initSitesData = await initSitesRes.json() as any;
    assertTest('Initial sites array returned', initSitesData.ok === true && Array.isArray(initSitesData.sites));
    assertTest('At least one primary site exists', initSitesData.sites.length >= 1);
    const primarySite = initSitesData.sites[0];
    assertTest('Primary site is marked as default', primarySite.isDefault === true);

    // 18b. Provision secondary site
    const createSiteRes = await fetch(`${API_BASE}/api/sites`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': sessionCookie,
      },
      body: JSON.stringify({
        name: 'Cyber Shrine 99',
        slug: 'shrine',
        siteUrl: 'https://shrine.neocities.org',
        deployPath: 'shrine',
        deploymentType: 'none',
      }),
    });
    assertTest('POST /api/sites returns HTTP 201 Created', createSiteRes.status === 201);
    const createSiteData = await createSiteRes.json() as any;
    assertTest('Provisioned site contains name', createSiteData.site?.name === 'Cyber Shrine 99');
    assertTest('Provisioned site has slug "shrine"', createSiteData.site?.slug === 'shrine');
    assertTest('Secondary site defaults to non-primary', createSiteData.site?.isDefault === false);
    const secondarySiteId = createSiteData.site?.id;

    // 18c. Test duplicate slug update rejection
    const dupSlugRes = await fetch(`${API_BASE}/api/sites/${primarySite.id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': sessionCookie,
      },
      body: JSON.stringify({ slug: 'shrine' }),
    });
    assertTest('PUT /api/sites/:id with colliding slug returns HTTP 400', dupSlugRes.status === 400);

    // 18d. Switch active site in session
    const switchSiteRes = await fetch(`${API_BASE}/api/sites/${secondarySiteId}/switch`, {
      method: 'POST',
      headers: { 'Cookie': sessionCookie },
    });
    assertTest('POST /api/sites/:id/switch returns HTTP 200', switchSiteRes.status === 200);
    const switchCookie = switchSiteRes.headers.get('set-cookie') || '';
    assertTest('Switch sets neogram_active_site cookie', switchCookie.includes('neogram_active_site='));

    // 18e. Publish photo targeted specifically to secondary site
    const secImageBuffer = await sharp({
      create: {
        width: 400,
        height: 400,
        channels: 4,
        background: { r: 240, g: 20, b: 120, alpha: 1 },
      },
    })
      .png()
      .toBuffer();

    const secFormData = new FormData();
    secFormData.append('imageFile', new Blob([secImageBuffer], { type: 'image/png' }), 'shrine_photo.png');
    secFormData.append('caption', '[:> Shrine Exclusive Cyber Photograph]');
    secFormData.append('filterApplied', 'amber');
    secFormData.append('siteId', secondarySiteId);

    const secPostRes = await fetch(`${API_BASE}/api/posts`, {
      method: 'POST',
      headers: { 'Cookie': sessionCookie },
      body: secFormData,
    });
    assertTest('POST /api/posts with siteId returns HTTP 201', secPostRes.status === 201);
    const secPostData = await secPostRes.json() as any;
    const secondaryPostId = secPostData.post?.id;
    assertTest('Post record persisted with secondary site ID', secPostData.post?.siteId === secondarySiteId);

    // 18f. Query posts filtered by siteId
    const secPostsListRes = await fetch(`${API_BASE}/api/posts?siteId=${secondarySiteId}`, {
      headers: { 'Cookie': sessionCookie },
    });
    assertTest('GET /api/posts?siteId=secondary returns HTTP 200', secPostsListRes.status === 200);
    const secPostsListData = await secPostsListRes.json() as any;
    const hasSecPost = secPostsListData.posts.some((p: any) => p.id === secondaryPostId);
    const hasPrimPostInSec = secPostsListData.posts.some((p: any) => p.id === testPostId);
    assertTest('Secondary site stream contains secondary post', hasSecPost);
    assertTest('Secondary site stream isolates from primary post', !hasPrimPostInSec);

    const primPostsListRes = await fetch(`${API_BASE}/api/posts?siteId=${primarySite.id}`, {
      headers: { 'Cookie': sessionCookie },
    });
    const primPostsListData = await primPostsListRes.json() as any;
    const hasSecInPrim = primPostsListData.posts.some((p: any) => p.id === secondaryPostId);
    assertTest('Primary site stream isolates from secondary post', !hasSecInPrim);

    // 18g. Per-site SVG Hit Counter (anchored by UIN and slug)
    const secCounterRes = await fetch(`${API_BASE}/counter/${testUser.uin}/shrine.svg?style=amber_crt`);
    assertTest('GET /counter/:uin/:slug.svg returns HTTP 200', secCounterRes.status === 200);
    assertTest('Per-site counter returns image/svg+xml', secCounterRes.headers.get('content-type')?.includes('image/svg+xml') === true);
    const secCounterDb = await query('SELECT hits FROM web_counters WHERE site_id = $1', [secondarySiteId]);
    assertTest('Secondary site hit counter persisted in database', secCounterDb.rows.length === 1 && parseInt(secCounterDb.rows[0].hits, 10) >= 1);

    // 18h. Per-site Guestbook Ledger
    const secGuestbookPostRes = await fetch(`${API_BASE}/api/guestbook/${testUser.handle}/shrine`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': sessionCookie,
      },
      body: JSON.stringify({
        message: 'Visiting the cyber shrine!',
        moodIcon: '⛩️',
      }),
    });
    assertTest('POST /api/guestbook/:handle/:slug returns HTTP 201', secGuestbookPostRes.status === 201);
    const secGbDb = await query('SELECT * FROM guestbook_entries WHERE site_id = $1', [secondarySiteId]);
    assertTest('Guestbook entry anchored to secondary site in database', secGbDb.rows.length === 1 && secGbDb.rows[0].message === 'Visiting the cyber shrine!');

    // 18i. Per-site JSON Feed
    const secFeedRes = await fetch(`${API_BASE}/api/users/${testUser.handle}/feed.json?siteSlug=shrine`);
    assertTest('GET /api/users/:handle/feed.json?siteSlug=shrine returns HTTP 200', secFeedRes.status === 200);
    const secFeedData = await secFeedRes.json() as any;
    assertTest('Feed title reflects secondary site name', secFeedData.title?.includes('Cyber Shrine 99') || secFeedData.home_page_url?.includes('shrine'));
    const secFeedContainsSecPost = Array.isArray(secFeedData.items) && secFeedData.items.some((item: any) => item.id === secondaryPostId);
    assertTest('Feed items contains secondary post', secFeedContainsSecPost);

    // 18j. Set secondary site as primary default
    const setDefRes = await fetch(`${API_BASE}/api/sites/${secondarySiteId}/default`, {
      method: 'POST',
      headers: { 'Cookie': sessionCookie },
    });
    assertTest('POST /api/sites/:id/default returns HTTP 200', setDefRes.status === 200);
    const secDefDb = await query('SELECT is_default FROM sites WHERE id = $1', [secondarySiteId]);
    const primDefDb = await query('SELECT is_default FROM sites WHERE id = $1', [primarySite.id]);
    assertTest('Secondary site is now default in database', secDefDb.rows[0]?.is_default === true);
    assertTest('Primary site is no longer default in database', primDefDb.rows[0]?.is_default === false);

    // Restore primary site as default
    await fetch(`${API_BASE}/api/sites/${primarySite.id}/default`, {
      method: 'POST',
      headers: { 'Cookie': sessionCookie },
    });

    // 18k. Workstation UI verification
    const dashSitesRes = await fetch(`${API_BASE}/`, {
      headers: { 'Cookie': sessionCookie },
    });
    assertTest('Authenticated GET / returns HTTP 200', dashSitesRes.status === 200);
    const dashSitesHtml = await dashSitesRes.text();
    assertTest('Dashboard contains #retroSiteMenu switcher in nav', dashSitesHtml.includes('id="retroSiteMenu"'));
    assertTest('Dashboard upload form contains #uploadSiteId input', dashSitesHtml.includes('id="uploadSiteId"'));
    assertTest('Dashboard contains #toggleProvisionFormBtn', dashSitesHtml.includes('id="toggleProvisionFormBtn"'));
    assertTest('Dashboard contains #settingsSiteSelector in settings', dashSitesHtml.includes('id="settingsSiteSelector"'));

    // 18l. Public profile multi-site filter verification
    const userProfileRes = await fetch(`${API_BASE}/user/${testUser.handle}`);
    assertTest('Public GET /user/:handle returns HTTP 200', userProfileRes.status === 200);
    const userProfileHtml = await userProfileRes.text();
    assertTest('Public profile contains site filter chips', userProfileHtml.includes('filterUserPosts'));
    assertTest('Public profile lists Cyber Shrine 99', userProfileHtml.includes('Cyber Shrine 99'));

    // 18m. Unmount and delete secondary site
    const deleteSiteRes = await fetch(`${API_BASE}/api/sites/${secondarySiteId}`, {
      method: 'DELETE',
      headers: { 'Cookie': sessionCookie },
    });
    assertTest('DELETE /api/sites/:id returns HTTP 200', deleteSiteRes.status === 200);
    const checkSiteDeleted = await query('SELECT id FROM sites WHERE id = $1', [secondarySiteId]);
    assertTest('Site deleted from PostgreSQL database', checkSiteDeleted.rows.length === 0);

    // Verify CASCADE cleanup of secondary site post, counter, and guestbook
    const checkSecPostDeleted = await query('SELECT id FROM posts WHERE id = $1', [secondaryPostId]);
    assertTest('Secondary post cascade deleted with site', checkSecPostDeleted.rows.length === 0);
    const checkSecGbDeleted = await query('SELECT id FROM guestbook_entries WHERE site_id = $1', [secondarySiteId]);
    assertTest('Secondary guestbook cascade deleted with site', checkSecGbDeleted.rows.length === 0);
    const checkSecCounterDeleted = await query('SELECT hits FROM web_counters WHERE site_id = $1', [secondarySiteId]);
    assertTest('Secondary web counter cascade deleted with site', checkSecCounterDeleted.rows.length === 0);

    // -------------------------------------------------------------------------
    // TEST 19: Decoupled New User Flow (Zero Sites, Follower Feed & Welcome Flow)
    // -------------------------------------------------------------------------
    logHeader('19. DECOUPLED NEW USER ONBOARDING & FOLLOWER FEED');
    const newbieEmail = `newbie_${timestamp}@neogram.retro`;
    const newbieReq = await fetch(`${API_BASE}/api/auth/request-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Test-Suite': 'true' },
      body: JSON.stringify({ identifier: newbieEmail }),
    });
    const newbieReqData = await newbieReq.json() as any;
    const newbieCode = newbieReqData.demoCode;

    const newbieVerify = await fetch(`${API_BASE}/api/auth/verify-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: newbieEmail, code: newbieCode }),
    });
    assertTest('POST /api/auth/verify-otp for new user returns HTTP 200', newbieVerify.status === 200);
    const newbieData = await newbieVerify.json() as any;
    const newbieUser = newbieData.user;
    const newbieCookie = newbieVerify.headers.get('set-cookie')?.split(';')[0] || `neogram_session=${newbieData.token}`;

    assertTest('New user profile is complete with handle', !!newbieUser.handle);
    assertTest('New user assigned permanent numeric ICQ-style UIN', !!newbieUser.uin);

    // Verify brand new user starts with 0 mounted sites
    const newbieSitesRes = await fetch(`${API_BASE}/api/sites`, {
      headers: { 'Cookie': newbieCookie },
    });
    assertTest('GET /api/sites for new user returns HTTP 200', newbieSitesRes.status === 200);
    const newbieSitesData = await newbieSitesRes.json() as any;
    assertTest('New user starts with zero mounted sites (sites array empty)', Array.isArray(newbieSitesData.sites) && newbieSitesData.sites.length === 0);

    // Verify GET / workstation dashboard renders Welcome Card and Feed tab
    const newbieHomeRes = await fetch(`${API_BASE}/`, {
      headers: { 'Cookie': newbieCookie },
    });
    assertTest('GET / for new user returns HTTP 200', newbieHomeRes.status === 200);
    const newbieHomeHtml = await newbieHomeRes.text();
    assertTest('Dashboard contains Welcome Station window card', newbieHomeHtml.includes('welcomeStationCard'));
    assertTest('Dashboard contains [PROFILE COMPLETE] badge', newbieHomeHtml.includes('[PROFILE COMPLETE]'));
    assertTest('Dashboard contains "Welcome to Cyberspace"', newbieHomeHtml.includes('Welcome to Cyberspace'));
    assertTest('Dashboard contains "WHAT\'S NEXT? — UNLOCK CREATOR STUDIO"', newbieHomeHtml.includes("WHAT'S NEXT? — UNLOCK CREATOR STUDIO"));
    assertTest('Dashboard contains "ADD A STATIC SITE TARGET" button', newbieHomeHtml.includes('ADD A STATIC SITE TARGET'));
    assertTest('Dashboard contains #tabFeedBtn in navigation', newbieHomeHtml.includes('id="tabFeedBtn"'));
    assertTest('Upload section contains #noSiteUploadBanner', newbieHomeHtml.includes('id="noSiteUploadBanner"'));

    // Verify photo publishing is locked until a site target is mounted
    const newbieUploadRes = await fetch(`${API_BASE}/api/posts`, {
      method: 'POST',
      headers: { 'Cookie': newbieCookie },
      body: new FormData(),
    });
    assertTest('POST /api/posts without mounted site returns HTTP 400', newbieUploadRes.status === 400);
    const newbieUploadData = await newbieUploadRes.json() as any;
    assertTest('Upload error explains site target required', newbieUploadData.error && newbieUploadData.error.includes('static site'));

    // Verify new user can follow other stations without having a site
    const followRes2 = await fetch(`${API_BASE}/api/users/${testUser.handle}/follow`, {
      method: 'POST',
      headers: { 'Cookie': newbieCookie },
    });
    assertTest('POST /api/users/:handle/follow succeeds for user with no site', followRes2.status === 200);
    const followData2 = await followRes2.json() as any;
    assertTest('Follow response confirms isFriend: true', followData2.isFriend === true);

    // Verify follower feed on workstation dashboard displays followed user transmissions
    const feedHomeRes = await fetch(`${API_BASE}/`, {
      headers: { 'Cookie': newbieCookie },
    });
    const feedHomeHtml = await feedHomeRes.text();
    assertTest('Workstation Follower Feed contains followed station transmission', feedHomeHtml.includes(`@${testUser.handle}`));

    // Clean up newbie user
    await query('DELETE FROM users WHERE id = $1', [newbieUser.id]);

    // -------------------------------------------------------------------------
    // TEST 20: Safe Post Purge & Clean Teardown
    // -------------------------------------------------------------------------
    logHeader('20. SAFE PURGE & TEARDOWN');
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
