/**
 * Neogram Social Graph & Adversarial Security Fuzzing Suite
 * =========================================================
 * Part A: Multi-User Social Graph, Notifications & Comment Concurrency
 *   1. Follow lifecycle & lookup polymorphism (by handle, numeric UIN, UUID) + self-follow guard
 *   2. Concurrent comment lock stress (5 simultaneous POST /api/posts/:id/comments via Promise.all)
 *   3. Notification inbox & thread alerts (follow, like, comment_own, comment_thread)
 *
 * Part B: Adversarial Input & Security Fuzzing ("Break Inputs / Hack")
 *   1. Stored XSS & inline script breakout payloads across posts, comments, guestbooks, profiles
 *   2. Malicious URL protocol injection (javascript:, data:, vbscript:)
 *   3. Path traversal & shell injection on deployPath and slug
 *   4. SQL injection & parameter fuzzing across routes
 *   5. Corrupt / polyglot image upload & payload guard
 *   6. IDOR & cross-tenant authorization boundaries (posts, comments, sites, /admin barrier)
 */

import {
  loadQaFleet,
  createTestImageBase64,
  TestMonitor,
  CYAN,
  YELLOW,
  BOLD,
  RESET,
} from './helpers/qaHarness';

async function runSocialAndSecuritySuite() {
  const monitor = new TestMonitor('SOCIAL GRAPH & ADVERSARIAL SECURITY SUITE');
  const runId = Date.now().toString(36).toUpperCase();

  const fleet = await loadQaFleet();
  const { baseUrl, alice, bob, friend, surfer, headless } = fleet;

  console.log(`${CYAN}${BOLD}Target Workstation :${RESET} ${YELLOW}${baseUrl}${RESET}`);
  console.log(`${CYAN}${BOLD}Security Run ID    :${RESET} ${YELLOW}SEC_${runId}${RESET}`);

  let testPostId = '';
  let testCommentId = '';

  try {
    // =========================================================================
    // PART A: SOCIAL GRAPH, NOTIFICATIONS & COMMENT CONCURRENCY
    // =========================================================================
    monitor.section('PART A.1: FOLLOW LIFECYCLE & IDENTIFIER POLYMORPHISM');

    // Ensure notification preferences are enabled on @qa_alice and @qa_bob before social actions
    for (const target of [alice, bob]) {
      await fetch(`${baseUrl}/api/settings/notifications`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${target.token}`,
          'X-Test-Suite': 'true',
        },
        body: JSON.stringify({
          notifyFollow: true,
          notifyLike: true,
          notifyCommentOwn: true,
          notifyCommentThread: true,
          notifyGuestbook: true,
        }),
      }).catch(() => {});
    }

    // 1. Follow @qa_alice by handle
    const followHandleStart = Date.now();
    const followHandleRes = await fetch(`${baseUrl}/api/users/${alice.handle}/follow`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${friend.token}`,
        'X-Test-Suite': 'true',
      },
    });
    const followHandleData = (await followHandleRes.json().catch(() => ({}))) as any;
    monitor.record(
      'SOCIAL-FOLLOW',
      `@${friend.handle} follows @${alice.handle} by handle`,
      followHandleRes.status === 200 && followHandleData.ok === true && followHandleData.isFriend === true,
      Date.now() - followHandleStart,
      `targetHandle: ${followHandleData.targetHandle}`
    );

    // 2. Follow @qa_bob by numeric UIN
    const followUinStart = Date.now();
    const followUinRes = await fetch(`${baseUrl}/api/users/${bob.uin}/follow`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${friend.token}`,
        'X-Test-Suite': 'true',
      },
    });
    const followUinData = (await followUinRes.json().catch(() => ({}))) as any;
    monitor.record(
      'SOCIAL-FOLLOW',
      `@${friend.handle} follows @${bob.handle} by numeric UIN (#${bob.uin})`,
      followUinRes.status === 200 && followUinData.ok === true && followUinData.isFriend === true,
      Date.now() - followUinStart,
      `UIN #${bob.uin} -> @${followUinData.targetHandle}`
    );

    // 3. Follow @qa_headless by UUID
    const followUuidStart = Date.now();
    const followUuidRes = await fetch(`${baseUrl}/api/users/${headless.userId}/follow`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${friend.token}`,
        'X-Test-Suite': 'true',
      },
    });
    const followUuidData = (await followUuidRes.json().catch(() => ({}))) as any;
    monitor.record(
      'SOCIAL-FOLLOW',
      `@${friend.handle} follows @${headless.handle} by UUID (${headless.userId.slice(0, 8)}...)`,
      followUuidRes.status === 200 && followUuidData.ok === true && followUuidData.isFriend === true,
      Date.now() - followUuidStart,
      `UUID -> @${followUuidData.targetHandle}`
    );

    // 4. Verify friend-status endpoint
    const statusRes = await fetch(`${baseUrl}/api/users/${alice.handle}/friend-status`, {
      headers: {
        Authorization: `Bearer ${friend.token}`,
        'X-Test-Suite': 'true',
      },
    });
    const statusData = (await statusRes.json().catch(() => ({}))) as any;
    monitor.record(
      'SOCIAL-FOLLOW',
      `GET /api/users/${alice.handle}/friend-status returns { ok: true, isFriend: true, isSelf: false }`,
      statusRes.status === 200 &&
        statusData.ok === true &&
        statusData.isFriend === true &&
        statusData.isSelf === false,
      0,
      `followersCount: ${statusData.followersCount}`
    );

    // 5. Verify self-follow rejection (HTTP 400)
    const selfFollowRes = await fetch(`${baseUrl}/api/users/${alice.handle}/follow`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${alice.token}`,
        'X-Test-Suite': 'true',
      },
    });
    monitor.record(
      'SOCIAL-FOLLOW',
      `Self-follow (POST /api/users/${alice.handle}/follow as @${alice.handle}) rejected with HTTP 400`,
      selfFollowRes.status === 400,
      0,
      `HTTP ${selfFollowRes.status}`
    );

    // =========================================================================
    // PART A.2: CONCURRENT COMMENT LOCK STRESS (`withFileLock` verification)
    // =========================================================================
    monitor.section('PART A.2: CONCURRENT COMMENT LOCK STRESS (withFileLock)');

    const sampleImg = await createTestImageBase64(`CONCURRENCY_${runId}`, { r: 80, g: 40, b: 160 });
    const postRes = await fetch(`${baseUrl}/api/posts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${alice.token}`,
        'X-Test-Suite': 'true',
      },
      body: JSON.stringify({
        siteId: alice.sites[0]?.id,
        caption: `[:> CONCURRENCY_PROBE_${runId}] Multi-agent comment lock stress target`,
        filterApplied: 'none',
        imageBase64: sampleImg,
      }),
    });
    const postData = (await postRes.json().catch(() => ({}))) as any;
    testPostId = postData.post?.id || '';

    monitor.record(
      'CONCURRENCY',
      `@${alice.handle} creates test post for concurrent comment stress`,
      postRes.status === 201 && !!testPostId,
      0,
      `Post ID: ${testPostId}`
    );

    // Have @qa_surfer like the post so we also trigger a like notification
    await fetch(`${baseUrl}/api/posts/${testPostId}/like`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${surfer.token}`,
        'X-Test-Suite': 'true',
      },
    });

    // First post a comment by @qa_bob so @qa_bob is a prior thread participant for comment_thread notification
    const bobFirstRes = await fetch(`${baseUrl}/api/posts/${testPostId}/comments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${bob.token}`,
        'X-Test-Suite': 'true',
      },
      body: JSON.stringify({ text: `[:> THREAD_SEED_${runId}] Initial comment by @${bob.handle}` }),
    });
    const bobFirstData = (await bobFirstRes.json().catch(() => ({}))) as any;
    if (bobFirstData.comment?.id) {
      testCommentId = bobFirstData.comment.id;
    }

    // Fire simultaneous POST /api/posts/:id/comments requests
    // Rate limit window is 15 requests per 5 min per IP on production.
    // We send requests sequentially with brief pause if running against remote production server, or via Promise.all
    const commenters = [bob, friend, surfer, headless, alice];
    const burstStart = Date.now();
    const burstResponses: Array<{ handle: string; status: number; body: any }> = [];
    
    // Test concurrency with Promise.all
    const promises = commenters.map((agent, idx) =>
      fetch(`${baseUrl}/api/posts/${testPostId}/comments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${agent.token}`,
          'X-Test-Suite': 'true',
        },
        body: JSON.stringify({
          text: `[:> CONCURRENT_BURST_${runId}_${idx}] Simultaneous transmission from @${agent.handle}`,
        }),
      }).then(async (r) => ({
        handle: agent.handle,
        status: r.status,
        body: (await r.json().catch(() => ({}))) as any,
      }))
    );
    const results = await Promise.all(promises);
    burstResponses.push(...results);
    const burstElapsed = Date.now() - burstStart;

    const successfulComments = burstResponses.filter((r) => r.status === 201 && r.body.ok === true);
    const hasRateLimited = burstResponses.some((r) => r.status === 429);
    monitor.record(
      'CONCURRENCY',
      'Concurrent POST /api/posts/:id/comments executed cleanly (201 Created or 429 Carrier Throttled)',
      burstResponses.every((r) => r.status === 201 || r.status === 429),
      burstElapsed,
      burstResponses.map((r) => `@${r.handle}:${r.status}`).join(', ')
    );

    // Query GET /api/posts/:id/comments and assert all admitted burst comments are present in the ledger (0 lost writes)
    const ledgerRes = await fetch(`${baseUrl}/api/posts/${testPostId}/comments`, {
      headers: { 'X-Test-Suite': 'true' },
    });
    const ledgerData = (await ledgerRes.json().catch(() => ({}))) as any;
    const recordedComments: any[] = ledgerData.comments || [];
    const burstMatches = recordedComments.filter((c) =>
      String(c.text).includes(`CONCURRENT_BURST_${runId}_`)
    );

    const noLostWrites =
      successfulComments.length > 0
        ? burstMatches.length === successfulComments.length
        : burstResponses.every((r) => r.status === 429);

    monitor.record(
      'CONCURRENCY',
      'withFileLock serializes admitted comments with 0 lost writes',
      noLostWrites,
      0,
      `Found ${burstMatches.length}/${successfulComments.length} admitted comments in ledger (total in ledger: ${recordedComments.length})`
    );

    // =========================================================================
    // PART A.3: NOTIFICATION INBOX & THREAD ALERTS
    // =========================================================================
    monitor.section('PART A.3: NOTIFICATION INBOX & THREAD ALERTS');

    // Give background notification promises a brief moment to settle in PostgreSQL
    await new Promise((r) => setTimeout(r, 600));

    const aliceNotifRes = await fetch(`${baseUrl}/api/notifications`, {
      headers: {
        Authorization: `Bearer ${alice.token}`,
        'X-Test-Suite': 'true',
      },
    });
    const aliceNotifData = (await aliceNotifRes.json().catch(() => ({}))) as any;
    const aliceNotifs: any[] = aliceNotifData.notifications || [];

    const hasFollowNotif = aliceNotifs.some((n) => n.type === 'follow');
    const hasLikeNotif = aliceNotifs.some((n) => n.type === 'like');
    const hasCommentOwnNotif = aliceNotifs.some((n) => n.type === 'comment_own');

    monitor.record(
      'NOTIFICATIONS',
      `@${alice.handle} inbox contains 'follow', 'like', and 'comment_own' alerts`,
      aliceNotifRes.status === 200 && hasFollowNotif && hasLikeNotif && hasCommentOwnNotif,
      0,
      `follow:${hasFollowNotif}, like:${hasLikeNotif}, comment_own:${hasCommentOwnNotif} (total: ${aliceNotifs.length})`
    );

    const bobNotifRes = await fetch(`${baseUrl}/api/notifications`, {
      headers: {
        Authorization: `Bearer ${bob.token}`,
        'X-Test-Suite': 'true',
      },
    });
    const bobNotifData = (await bobNotifRes.json().catch(() => ({}))) as any;
    const bobNotifs: any[] = bobNotifData.notifications || [];
    const hasThreadNotif = bobNotifs.some((n) => n.type === 'comment_thread');

    monitor.record(
      'NOTIFICATIONS',
      `@${bob.handle} inbox receives 'comment_thread' alert when subsequent users reply`,
      bobNotifRes.status === 200 && hasThreadNotif,
      0,
      `comment_thread:${hasThreadNotif} (total: ${bobNotifs.length})`
    );

    // =========================================================================
    // PART B: ADVERSARIAL INPUT & SECURITY FUZZING ("BREAK INPUTS / HACK")
    // =========================================================================
    monitor.section('PART B.1: STORED XSS & INLINE SCRIPT BREAKOUT PAYLOADS');

    const xssPayloads = [
      '<script>window.__xss=1</script>',
      '<img src=x onerror="window.__xss=2">',
      '"</script><script>alert(1)</script>',
      'javascript:alert(document.cookie)',
    ];

    // 1. Inject XSS payloads into Post fields (PUT /api/posts/:id)
    const xssPostUpdateRes = await fetch(`${baseUrl}/api/posts/${testPostId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${alice.token}`,
        'X-Test-Suite': 'true',
      },
      body: JSON.stringify({
        caption: `XSS Probe ${xssPayloads[0]} ${xssPayloads[1]}`,
        mood: xssPayloads[2],
        webring: xssPayloads[0],
        location: xssPayloads[1],
      }),
    });
    monitor.record(
      'XSS-FUZZ',
      'Inject XSS payloads into post caption/mood/webring/location without HTTP 500',
      xssPostUpdateRes.status < 500,
      0,
      `HTTP ${xssPostUpdateRes.status}`
    );

    // 2. Inject XSS payloads into Comments
    for (const payload of xssPayloads) {
      const cRes = await fetch(`${baseUrl}/api/posts/${testPostId}/comments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${surfer.token}`,
          'X-Test-Suite': 'true',
        },
        body: JSON.stringify({ text: `XSS Comment ${payload}` }),
      });
      if (cRes.status >= 500) {
        monitor.record('XSS-FUZZ', `Comment XSS payload (${payload})`, false, 0, `HTTP ${cRes.status}`);
      }
    }
    monitor.record('XSS-FUZZ', 'Inject all 4 XSS vectors into POST /api/posts/:id/comments', true);

    // 3. Inject XSS payloads into Guestbook
    const xssGbRes = await fetch(`${baseUrl}/api/guestbook/${alice.handle}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${surfer.token}`,
        'X-Test-Suite': 'true',
      },
      body: JSON.stringify({
        visitorName: xssPayloads[0],
        visitorLocation: xssPayloads[1],
        message: `${xssPayloads[0]} ${xssPayloads[2]}`,
      }),
    });
    const xssGbData = (await xssGbRes.json().catch(() => ({}))) as any;
    monitor.record(
      'XSS-FUZZ',
      'Inject XSS payloads into Guestbook visitorName/visitorLocation/message',
      xssGbRes.status === 201 || xssGbRes.status === 429,
      0,
      `HTTP ${xssGbRes.status}`
    );

    // Clean up XSS guestbook entry after checking rendered HTML
    const xssGbEntryId = xssGbData.entry?.id;

    // 4. Fetch rendered HTML pages and assert raw <script>window.__xss NEVER appears unescaped
    const htmlRoutes = [
      `/user/${alice.handle}`,
      `/friends`,
      `/embed/guestbook/${alice.handle}`,
      `/embed/feed/${alice.handle}`,
    ];

    for (const route of htmlRoutes) {
      const pageRes = await fetch(`${baseUrl}${route}`, {
        headers: {
          Cookie: friend.cookie,
          Authorization: `Bearer ${friend.token}`,
          'X-Test-Suite': 'true',
        },
      });
      const htmlBody = await pageRes.text();
      const hasRawXssScript =
        htmlBody.includes('<script>window.__xss=1</script>') ||
        htmlBody.includes('<img src=x onerror="window.__xss=2">');

      monitor.record(
        'XSS-ESCAPING',
        `Rendered HTML on ${route} escapes/neutralizes injected <script> & onerror tags`,
        pageRes.status === 200 && !hasRawXssScript,
        0,
        `HTTP ${pageRes.status}, raw XSS present: ${hasRawXssScript}`
      );
    }

    if (xssGbEntryId) {
      await fetch(`${baseUrl}/api/guestbook/${xssGbEntryId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${alice.token}`, 'X-Test-Suite': 'true' },
      }).catch(() => {});
    }

    // =========================================================================
    // PART B.2: MALICIOUS URL PROTOCOL INJECTION (javascript:, data:, vbscript:)
    // =========================================================================
    monitor.section('PART B.2: MALICIOUS URL PROTOCOL INJECTION');

    const badUrls = [
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
    ];

    for (const badUrl of badUrls) {
      // Guestbook visitorWebsite
      const gbUrlRes = await fetch(`${baseUrl}/api/guestbook/${alice.handle}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${surfer.token}`,
          'X-Test-Suite': 'true',
        },
        body: JSON.stringify({
          visitorName: surfer.handle,
          visitorWebsite: badUrl,
          message: 'Testing malicious website scheme stripping',
        }),
      });
      const gbUrlData = (await gbUrlRes.json().catch(() => ({}))) as any;
      const storedWebsite = gbUrlData.entry?.visitorWebsite;
      const schemeStrippedOrRejected =
        gbUrlRes.status === 400 || !storedWebsite || /^https?:\/\//i.test(storedWebsite);

      monitor.record(
        'URL-SCHEME',
        `Guestbook visitorWebsite strips/rejects "${badUrl.slice(0, 24)}..."`,
        schemeStrippedOrRejected,
        0,
        `storedWebsite: ${storedWebsite ?? 'undefined (stripped)'}`
      );

      if (gbUrlData.entry?.id) {
        await fetch(`${baseUrl}/api/guestbook/${gbUrlData.entry.id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${alice.token}`, 'X-Test-Suite': 'true' },
        }).catch(() => {});
      }
    }

    // PUT /api/settings with javascript: siteUrl
    const badSettingsUrlRes = await fetch(`${baseUrl}/api/settings`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${surfer.token}`,
        'X-Test-Suite': 'true',
      },
      body: JSON.stringify({
        siteUrl: 'javascript:alert(1)',
      }),
    });
    monitor.record(
      'URL-SCHEME',
      'PUT /api/settings rejects siteUrl="javascript:alert(1)" with HTTP 400',
      badSettingsUrlRes.status === 400,
      0,
      `HTTP ${badSettingsUrlRes.status}`
    );

    // POST /api/sites with javascript: siteUrl
    const badSiteCreateRes = await fetch(`${baseUrl}/api/sites`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${surfer.token}`,
        'X-Test-Suite': 'true',
      },
      body: JSON.stringify({
        name: 'Bad Scheme Site',
        siteUrl: 'javascript:alert(1)',
      }),
    });
    const badSiteCreateData = (await badSiteCreateRes.json().catch(() => ({}))) as any;
    // Server either rejects with 400 or prepends http(s):// to prevent execution
    const siteSchemeSafe =
      badSiteCreateRes.status === 400 ||
      (badSiteCreateData.site &&
        !String(badSiteCreateData.site.siteUrl).startsWith('javascript:'));

    monitor.record(
      'URL-SCHEME',
      'POST /api/sites rejects or neutralizes javascript: scheme in siteUrl',
      siteSchemeSafe,
      0,
      `HTTP ${badSiteCreateRes.status}, stored siteUrl: ${badSiteCreateData.site?.siteUrl}`
    );

    if (badSiteCreateData.site?.id) {
      await fetch(`${baseUrl}/api/sites/${badSiteCreateData.site.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${surfer.token}`, 'X-Test-Suite': 'true' },
      }).catch(() => {});
    }

    // =========================================================================
    // PART B.3: PATH TRAVERSAL & SHELL INJECTION ON deployPath AND slug
    // =========================================================================
    monitor.section('PART B.3: PATH TRAVERSAL & SHELL INJECTION GUARDS');

    const traversalPayloads = ['../../../etc/passwd', 'neogram; rm -rf /', 'neogram\0.html'];

    for (const badPath of traversalPayloads) {
      const putSettingsTraversal = await fetch(`${baseUrl}/api/settings`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${surfer.token}`,
          'X-Test-Suite': 'true',
        },
        body: JSON.stringify({ deployPath: badPath }),
      });
      monitor.record(
        'PATH-TRAVERSAL',
        `PUT /api/settings rejects deployPath="${badPath.replace(/\0/g, '\\0')}" with HTTP 400`,
        putSettingsTraversal.status === 400,
        0,
        `HTTP ${putSettingsTraversal.status}`
      );

      const postSiteTraversal = await fetch(`${baseUrl}/api/sites`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${surfer.token}`,
          'X-Test-Suite': 'true',
        },
        body: JSON.stringify({
          name: 'Traversal Test',
          slug: badPath,
          deployPath: badPath,
        }),
      });
      const postSiteData = (await postSiteTraversal.json().catch(() => ({}))) as any;
      const sanitizedOk =
        postSiteTraversal.status === 400 ||
        (postSiteData.site &&
          /^[a-zA-Z0-9_-]{0,50}$/.test(postSiteData.site.deployPath || '') &&
          /^[a-zA-Z0-9_-]{1,50}$/.test(postSiteData.site.slug || ''));

      monitor.record(
        'PATH-TRAVERSAL',
        `POST /api/sites sanitizes/rejects slug & deployPath="${badPath.replace(/\0/g, '\\0')}"`,
        sanitizedOk,
        0,
        postSiteData.site
          ? `Sanitized to deployPath="${postSiteData.site.deployPath}", slug="${postSiteData.site.slug}"`
          : `HTTP ${postSiteTraversal.status}`
      );

      if (postSiteData.site?.id) {
        await fetch(`${baseUrl}/api/sites/${postSiteData.site.id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${surfer.token}`, 'X-Test-Suite': 'true' },
        }).catch(() => {});
      }
    }

    // =========================================================================
    // PART B.4: SQL INJECTION & PARAMETER FUZZING
    // =========================================================================
    monitor.section('PART B.4: SQL INJECTION & PARAMETER FUZZING');

    const sqliProbes = [
      { label: "User profile SQLi (/user/' OR '1'='1)", path: `/user/${encodeURIComponent("' OR '1'='1")}` },
      { label: 'Post comments SQLi (/api/posts/1 OR 1=1--/comments)', path: `/api/posts/${encodeURIComponent("' OR 1=1--")}/comments` },
      { label: 'Guestbook DROP TABLE SQLi (/api/guestbook/...)', path: `/api/guestbook/${encodeURIComponent("'; DROP TABLE users;--")}` },
      { label: 'Hit Counter UNION SQLi (/counter/...svg)', path: `/counter/${encodeURIComponent("100101' UNION SELECT 1--")}.svg` },
    ];

    for (const probe of sqliProbes) {
      const sqliRes = await fetch(`${baseUrl}${probe.path}`, {
        headers: { 'X-Test-Suite': 'true' },
      });
      const sqliText = await sqliRes.text();
      const leakedSqlError = /syntax error at or near|pg_catalog|PostgreSQL|relation ".*" does not exist/i.test(
        sqliText
      );
      // Assert server does not leak SQL syntax errors or database schema in response body
      monitor.record(
        'SQLI-PROBE',
        `${probe.label} handled cleanly without SQL stack trace leak`,
        !leakedSqlError && sqliRes.status !== 502 && sqliRes.status !== 503,
        0,
        `HTTP ${sqliRes.status}, leaked SQL error: ${leakedSqlError}`
      );
    }

    // Verify database tables remain intact via /api/health and /api/directory
    const dbHealthRes = await fetch(`${baseUrl}/api/health`, {
      headers: { 'X-Test-Suite': 'true' },
    });
    const dbHealthData = (await dbHealthRes.json().catch(() => ({}))) as any;
    const dirRes = await fetch(`${baseUrl}/api/directory`, {
      headers: { 'X-Test-Suite': 'true' },
    });
    const dirData = (await dirRes.json().catch(() => ({}))) as any;
    monitor.record(
      'SQLI-PROBE',
      'Database tables remain intact after SQLi fuzzing (/api/health & /api/directory)',
      dbHealthRes.status === 200 && dbHealthData.status === 'healthy' && dirData.ok === true,
      0,
      `DB Status: ${dbHealthData.services?.database?.status}, directory total: ${dirData.total}`
    );

    // =========================================================================
    // PART B.5: CORRUPT / POLYGLOT IMAGE UPLOAD & PAYLOAD GUARD
    // =========================================================================
    monitor.section('PART B.5: CORRUPT / POLYGLOT IMAGE UPLOAD GUARD');

    const polyglotBase64 =
      'data:image/png;base64,' + Buffer.from("<script>alert('polyglot')</script>").toString('base64');

    const corruptRes = await fetch(`${baseUrl}/api/posts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${alice.token}`,
        'X-Test-Suite': 'true',
      },
      body: JSON.stringify({
        siteId: alice.sites[0]?.id,
        caption: 'Corrupt polyglot upload attempt',
        imageBase64: polyglotBase64,
      }),
    });

    monitor.record(
      'IMAGE-GUARD',
      'Sharp rejects corrupt/HTML polyglot image buffer cleanly (HTTP 400/500 JSON)',
      corruptRes.status === 400 || corruptRes.status === 500,
      0,
      `HTTP ${corruptRes.status}`
    );

    // Verify server stays alive and healthy on /api/health
    const healthRes = await fetch(`${baseUrl}/api/health`, {
      headers: { 'X-Test-Suite': 'true' },
    });
    monitor.record(
      'IMAGE-GUARD',
      'Server remains online and healthy on GET /api/health after corrupt upload',
      healthRes.status === 200,
      0,
      `HTTP ${healthRes.status}`
    );

    // =========================================================================
    // PART B.6: IDOR & CROSS-TENANT AUTHORIZATION BOUNDARIES
    // =========================================================================
    monitor.section('PART B.6: IDOR & CROSS-TENANT AUTHORIZATION BOUNDARIES');

    // 1. @qa_surfer attempts to DELETE @qa_alice's post
    const idorDeletePostRes = await fetch(`${baseUrl}/api/posts/${testPostId}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${surfer.token}`,
        'X-Test-Suite': 'true',
      },
    });
    monitor.record(
      'IDOR-GUARD',
      `@${surfer.handle} blocked from deleting @${alice.handle}'s post (DELETE /api/posts/${testPostId})`,
      idorDeletePostRes.status === 403 || idorDeletePostRes.status === 404,
      0,
      `HTTP ${idorDeletePostRes.status}`
    );

    // 2. @qa_surfer attempts to PUT (edit) @qa_alice's post
    const idorEditPostRes = await fetch(`${baseUrl}/api/posts/${testPostId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${surfer.token}`,
        'X-Test-Suite': 'true',
      },
      body: JSON.stringify({ caption: 'Hacked by surfer' }),
    });
    monitor.record(
      'IDOR-GUARD',
      `@${surfer.handle} blocked from editing @${alice.handle}'s post (PUT /api/posts/${testPostId})`,
      idorEditPostRes.status === 403 || idorEditPostRes.status === 404,
      0,
      `HTTP ${idorEditPostRes.status}`
    );

    // 3. @qa_surfer attempts to DELETE a comment on @qa_alice's post
    if (testCommentId) {
      const idorDeleteCommentRes = await fetch(
        `${baseUrl}/api/posts/${testPostId}/comments/${testCommentId}`,
        {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${surfer.token}`,
            'X-Test-Suite': 'true',
          },
        }
      );
      monitor.record(
        'IDOR-GUARD',
        `@${surfer.handle} blocked from moderating @${alice.handle}'s post comments (HTTP 403)`,
        idorDeleteCommentRes.status === 403,
        0,
        `HTTP ${idorDeleteCommentRes.status}`
      );
    }

    // 4. @qa_surfer attempts to DELETE @qa_alice's mounted site
    const aliceSiteId = alice.sites[0]?.id;
    if (aliceSiteId) {
      const idorDeleteSiteRes = await fetch(`${baseUrl}/api/sites/${aliceSiteId}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${surfer.token}`,
          'X-Test-Suite': 'true',
        },
      });
      monitor.record(
        'IDOR-GUARD',
        `@${surfer.handle} blocked from deleting @${alice.handle}'s site (DELETE /api/sites/${aliceSiteId})`,
        idorDeleteSiteRes.status === 400 || idorDeleteSiteRes.status === 403 || idorDeleteSiteRes.status === 404,
        0,
        `HTTP ${idorDeleteSiteRes.status}`
      );
    }

    // 5. @qa_surfer attempts to access /admin and POST /api/admin/qa-fleet/purge-posts (Anti-probing 404 barrier)
    const adminGetRes = await fetch(`${baseUrl}/admin`, {
      headers: {
        Authorization: `Bearer ${surfer.token}`,
        Cookie: surfer.cookie,
        'X-Test-Suite': 'true',
      },
    });
    monitor.record(
      'IDOR-GUARD',
      `Non-SysOp (@${surfer.handle}) receives HTTP 404 anti-probing barrier on GET /admin`,
      adminGetRes.status === 404,
      0,
      `HTTP ${adminGetRes.status}`
    );

    const adminPurgeRes = await fetch(`${baseUrl}/api/admin/qa-fleet/purge-posts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${surfer.token}`,
        'X-Neogram-Admin-Action': 'confirm',
        'X-Test-Suite': 'true',
      },
      body: JSON.stringify({}),
    });
    monitor.record(
      'IDOR-GUARD',
      `Non-SysOp (@${surfer.handle}) receives HTTP 404 anti-probing barrier on POST /api/admin/qa-fleet/purge-posts`,
      adminPurgeRes.status === 404,
      0,
      `HTTP ${adminPurgeRes.status}`
    );
  } catch (err: any) {
    monitor.record('FATAL', 'Unhandled exception in Social & Security Suite', false, 0, err.message || String(err));
  } finally {
    // Cleanup test post created during concurrency/security testing
    if (testPostId) {
      await fetch(`${baseUrl}/api/posts/${testPostId}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${alice.token}`,
          'X-Test-Suite': 'true',
        },
      }).catch(() => {});
    }
  }

  monitor.printSummaryAndExit(true);
}

runSocialAndSecuritySuite();

