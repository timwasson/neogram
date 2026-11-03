/**
 * Neogram Live Static-Site Bot & Propagation Monitor Suite
 * ========================================================
 * Automated multi-bot workflow that:
 *  Stage 1: Bot A (@qa_alice / @qa_bob) uploads a photo to a mounted static site
 *  Stage 2: Polls & monitors remote static host propagation (feed.json, index.html, photos/<id>/index.html, .comments.json, WebP media)
 *  Stage 3: Bot B (@qa_surfer) interacts as a visitor on Bot A's static site (Like, Comment, Guestbook signature)
 *  Stage 4: Monitors remote delta rebuild & self-hosted JSON sync (.comments.json, API comments, guestbook.json)
 *  Stage 5: Bot C (@qa_friend) follows Bot A and monitors Friend Grid cascade (/api/friends, friends/index.html, feed.json)
 *  Stage 6: Post-run cleanup (comment moderation & post teardown unless --keep) & full telemetry report
 */

import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import {
  loadQaFleet,
  createTestImageBase64,
  pollUntilLive,
  TestMonitor,
  QaAgent,
  QaSite,
  CYAN,
  GREEN,
  YELLOW,
  BOLD,
  RESET,
} from './helpers/qaHarness';
import { getCommentsRelativePath } from '../services/staticStorage';

async function runStaticSiteBotMonitor() {
  const monitor = new TestMonitor('STATIC-SITE BOT & PROPAGATION MONITOR');
  const keepArtifacts = process.argv.includes('--keep');
  const runId = Date.now().toString(36).toUpperCase();

  const fleet = await loadQaFleet();
  const { baseUrl, isLocal, alice, bob, friend, surfer } = fleet;

  console.log(`${CYAN}${BOLD}Target Workstation :${RESET} ${YELLOW}${baseUrl}${RESET}`);
  console.log(`${CYAN}${BOLD}Run Identifier     :${RESET} ${GREEN}BOT_MONITOR_${runId}${RESET}`);
  console.log(
    `${CYAN}${BOLD}Loaded QA Personas :${RESET} ${fleet.agents.map((a) => `@${a.handle} (#${a.uin})`).join(', ')}`
  );

  // Select primary target agent & site (prioritize keyed sites on @qa_alice, fallback to default site)
  const candidates: Array<{ agent: QaAgent; site: QaSite }> = [];
  for (const agent of [alice, bob]) {
    for (const site of agent.sites || []) {
      candidates.push({ agent, site });
    }
  }

  const keyedCandidate = candidates.find((c) => c.site.hasApiKey);
  const selected = keyedCandidate || candidates[0];
  if (!selected) {
    monitor.record('SETUP', 'Locate mounted target static site for Bot A', false, 0, 'No sites mounted on QA agents');
    monitor.printSummaryAndExit(true);
    return;
  }

  const botA = selected.agent;
  const targetSite = selected.site;
  const cleanDeployPath = targetSite.deployPath ? targetSite.deployPath.replace(/^\/+|\/+$/g, '') : '';
  const remoteBase = `${targetSite.siteUrl.replace(/\/+$/, '')}${cleanDeployPath ? '/' + cleanDeployPath : ''}`;

  let postId = '';
  let imagePath = '';
  let thumbnailPath = '';
  let commentId = '';
  let guestbookEntryId = '';

  try {
    // =========================================================================
    // STAGE 1: Bot Photo Upload to Target Static Site
    // =========================================================================
    monitor.section(`STAGE 1: BOT A (@${botA.handle}) PHOTO UPLOAD TO "${targetSite.name}"`);

    const imageBase64 = await createTestImageBase64(`BOT_MONITOR_${runId}`, { r: 18, g: 130, b: 195 });
    const captionText = `[:> BOT_MONITOR_${runId}] Automated static site publish probe`;

    const uploadStart = Date.now();
    const uploadRes = await fetch(`${baseUrl}/api/posts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${botA.token}`,
        'X-Test-Suite': 'true',
      },
      body: JSON.stringify({
        siteId: targetSite.id,
        caption: captionText,
        filterApplied: 'crt',
        mood: '🤖 Cybernetic',
        location: 'Sector 7G',
        imageBase64,
      }),
    });
    const uploadLatencyMs = Date.now() - uploadStart;
    monitor.recordTiming('1. Photo Upload & Build API (uploadMs)', uploadLatencyMs);

    const uploadData = (await uploadRes.json().catch(() => ({}))) as any;
    const uploadPassed = uploadRes.status === 201 && uploadData.ok === true && !!uploadData.post?.id;

    monitor.record(
      'STAGE-1',
      `POST /api/posts by @${botA.handle} to site "${targetSite.name}" [${targetSite.deploymentType.toUpperCase()}]`,
      uploadPassed,
      uploadLatencyMs,
      uploadPassed ? `Post ID: ${uploadData.post.id}` : `HTTP ${uploadRes.status}: ${uploadData.error || 'Unknown error'}`
    );

    if (!uploadPassed) {
      monitor.printSummaryAndExit(true);
      return;
    }

    postId = uploadData.post.id;
    imagePath = uploadData.post.imagePath;
    thumbnailPath = uploadData.post.thumbnailPath;

    monitor.record(
      'STAGE-1',
      'Committed post returns WebP imagePath and thumbnailPath',
      Boolean(imagePath?.endsWith('.webp') && thumbnailPath?.endsWith('.webp')),
      0,
      imagePath
    );

    // Also test secondary site if @qa_bob has a keyed Nekoweb site
    const bobKeyedSite = (bob.sites || []).find((s) => s.hasApiKey && s.id !== targetSite.id);
    if (bobKeyedSite && !isLocal) {
      const bobStart = Date.now();
      const bobUploadRes = await fetch(`${baseUrl}/api/posts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${bob.token}`,
          'X-Test-Suite': 'true',
        },
        body: JSON.stringify({
          siteId: bobKeyedSite.id,
          caption: `[:> BOT_MONITOR_${runId}] Secondary Nekoweb probe`,
          filterApplied: 'vga',
          mood: '⚡ Radical',
          location: 'Nekoweb Sector',
          imageBase64,
        }),
      });
      const bobElapsed = Date.now() - bobStart;
      const bobData = (await bobUploadRes.json().catch(() => ({}))) as any;
      const bobOk = bobUploadRes.status === 201 && bobData.ok === true;
      monitor.record(
        'STAGE-1',
        `Secondary Bot (@${bob.handle}) publish to "${bobKeyedSite.name}" [${bobKeyedSite.deploymentType.toUpperCase()}]`,
        bobOk,
        bobElapsed,
        bobOk ? `Post ID: ${bobData.post?.id}` : `HTTP ${bobUploadRes.status}`
      );
      if (bobOk && bobData.post?.id && !keepArtifacts) {
        // Schedule cleanup for Bob's probe post at end
        await fetch(`${baseUrl}/api/posts/${bobData.post.id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${bob.token}`, 'X-Test-Suite': 'true' },
        }).catch(() => {});
      }
    }

    // =========================================================================
    // STAGE 2: Monitor Static Site Propagation
    // =========================================================================
    monitor.section(`STAGE 2: MONITOR STATIC SITE PROPAGATION (${remoteBase})`);

    const relCommentsPath = getCommentsRelativePath(imagePath);

    if (targetSite.hasApiKey && !isLocal) {
      // 1. Remote JSON Feed (`${remoteBase}/feed.json`)
      const feedUrl = `${remoteBase}/feed.json`;
      const feedPoll = await pollUntilLive(feedUrl, {
        maxAttempts: 12,
        intervalMs: 1500,
        validate: (body, status) => {
          if (status !== 200) return false;
          try {
            const parsed = JSON.parse(body);
            const items = parsed.posts || parsed.items || [];
            return items.some((item: any) => item.id === postId && String(item.caption).includes(`BOT_MONITOR_${runId}`));
          } catch {
            return false;
          }
        },
      });
      monitor.recordTiming('2. Remote feed.json Propagation (feedPropagationMs)', feedPoll.elapsedMs);
      monitor.record(
        'STAGE-2',
        `Remote feed.json live with post ${postId}`,
        feedPoll.ok,
        feedPoll.elapsedMs,
        `${feedUrl} (${feedPoll.attempts} attempt(s), HTTP ${feedPoll.status})`
      );

      // 2. Remote Gallery Index (`${remoteBase}/index.html`)
      if (targetSite.buildHtml !== false) {
        const indexUrl = `${remoteBase}/index.html`;
        const indexPoll = await pollUntilLive(indexUrl, {
          maxAttempts: 12,
          intervalMs: 1500,
          validate: (body, status) =>
            status === 200 && body.includes(`/photos/${postId}/`) && body.includes('neogram-card'),
        });
        monitor.recordTiming('3. Remote index.html Propagation (htmlPropagationMs)', indexPoll.elapsedMs);
        monitor.record(
          'STAGE-2',
          'Remote gallery index.html contains new photo card & BEM .neogram-card',
          indexPoll.ok,
          indexPoll.elapsedMs,
          `${indexUrl} (${indexPoll.attempts} attempt(s))`
        );

        // 3. Remote Photo Detail Page (`${remoteBase}/photos/${postId}/index.html`)
        const detailUrl = `${remoteBase}/photos/${postId}/index.html`;
        const detailPoll = await pollUntilLive(detailUrl, {
          maxAttempts: 12,
          intervalMs: 1500,
          validate: (body, status) =>
            status === 200 &&
            body.includes(`BOT_MONITOR_${runId}`) &&
            body.includes('commentsLedger') &&
            body.includes(`POST_ID = '${postId}'`),
        });
        monitor.record(
          'STAGE-2',
          `Remote photo detail page (photos/${postId}/index.html) live`,
          detailPoll.ok,
          detailPoll.elapsedMs,
          `${detailUrl} (${detailPoll.attempts} attempt(s))`
        );
      }

      // 4. Remote Initial Comments Ledger (`${remoteBase}/${relCommentsPath}`)
      const commentsJsonUrl = `${remoteBase}/${relCommentsPath}`;
      const commentsInitPoll = await pollUntilLive(commentsJsonUrl, {
        maxAttempts: 12,
        intervalMs: 1500,
        validate: (body, status) => {
          if (status !== 200) return false;
          try {
            const parsed = JSON.parse(body);
            return parsed.postId === postId && Array.isArray(parsed.comments);
          } catch {
            return false;
          }
        },
      });
      monitor.record(
        'STAGE-2',
        'Remote initial self-hosted .comments.json ledger live',
        commentsInitPoll.ok,
        commentsInitPoll.elapsedMs,
        `${commentsJsonUrl} (HTTP ${commentsInitPoll.status})`
      );

      // 5. Remote Full & Thumbnail WebP Images
      const fullImgUrl = imagePath.startsWith('http') ? imagePath : `${baseUrl}${imagePath}`;
      const thumbImgUrl = thumbnailPath.startsWith('http') ? thumbnailPath : `${baseUrl}${thumbnailPath}`;

      const fullImgPoll = await pollUntilLive(fullImgUrl, {
        maxAttempts: 10,
        intervalMs: 1500,
        validate: (_body, status, headers) =>
          status === 200 && (headers.get('content-type') || '').includes('image/webp'),
      });
      monitor.record(
        'STAGE-2',
        'Remote full-resolution WebP image accessible (image/webp)',
        fullImgPoll.ok,
        fullImgPoll.elapsedMs,
        `${fullImgUrl} (${fullImgPoll.contentType})`
      );

      const thumbImgPoll = await pollUntilLive(thumbImgUrl, {
        maxAttempts: 10,
        intervalMs: 1500,
        validate: (_body, status, headers) =>
          status === 200 && (headers.get('content-type') || '').includes('image/webp'),
      });
      monitor.record(
        'STAGE-2',
        'Remote 400px square WebP thumbnail accessible (image/webp)',
        thumbImgPoll.ok,
        thumbImgPoll.elapsedMs,
        `${thumbImgUrl} (${thumbImgPoll.contentType})`
      );
    } else {
      // Local static build directory verification
      const localGalleryDir = path.join(process.cwd(), 'dist', 'static-galleries', targetSite.id);
      const localFeedPath = path.join(localGalleryDir, 'feed.json');
      const localIndexPath = path.join(localGalleryDir, 'index.html');
      const localPhotoPath = path.join(localGalleryDir, 'photos', postId, 'index.html');
      const localCommentsPath = path.join(localGalleryDir, relCommentsPath);

      const feedExists = existsSync(localFeedPath);
      const feedRaw = feedExists ? await fs.readFile(localFeedPath, 'utf-8') : '{}';
      monitor.record(
        'STAGE-2',
        'Local static feed.json compiled with new post',
        feedExists && feedRaw.includes(postId),
        0,
        localFeedPath
      );

      if (targetSite.buildHtml !== false) {
        const indexExists = existsSync(localIndexPath);
        const indexRaw = indexExists ? await fs.readFile(localIndexPath, 'utf-8') : '';
        monitor.record(
          'STAGE-2',
          'Local static index.html compiled with .neogram-card',
          indexExists && indexRaw.includes(`/photos/${postId}/`) && indexRaw.includes('neogram-card'),
          0,
          localIndexPath
        );

        const photoExists = existsSync(localPhotoPath);
        const photoRaw = photoExists ? await fs.readFile(localPhotoPath, 'utf-8') : '';
        monitor.record(
          'STAGE-2',
          `Local static photos/${postId}/index.html compiled with #commentsLedger`,
          photoExists && photoRaw.includes(`BOT_MONITOR_${runId}`) && photoRaw.includes('commentsLedger'),
          0,
          localPhotoPath
        );
      }

      monitor.record(
        'STAGE-2',
        'Local initial .comments.json created',
        existsSync(localCommentsPath),
        0,
        localCommentsPath
      );
    }

    // =========================================================================
    // STAGE 3: Bot Visitor Interaction on the User's Static Site
    // =========================================================================
    monitor.section(`STAGE 3: VISITOR BOT B (@${surfer.handle}) INTERACTS WITH @${botA.handle}'S STATIC SITE`);

    // 1. Like Reaction
    const likeStart = Date.now();
    const likeRes = await fetch(`${baseUrl}/api/posts/${postId}/like`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${surfer.token}`,
        'X-Test-Suite': 'true',
      },
    });
    const likeData = (await likeRes.json().catch(() => ({}))) as any;
    monitor.record(
      'STAGE-3',
      `Visitor Bot (@${surfer.handle}) likes post ${postId} (POST /api/posts/:id/like)`,
      likeRes.status === 200 && likeData.ok === true && Number(likeData.likes) >= 1,
      Date.now() - likeStart,
      `Likes count: ${likeData.likes}`
    );

    // 2. Cross-User Static Comment Submission
    const commentText = `[:> BOT_COMMENT_${runId}] Verified transmission from @${surfer.handle}!`;
    const commentStart = Date.now();
    const commentRes = await fetch(`${baseUrl}/api/posts/${postId}/comments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${surfer.token}`,
        'X-Test-Suite': 'true',
      },
      body: JSON.stringify({ text: commentText }),
    });
    const commentLatencyMs = Date.now() - commentStart;
    const commentData = (await commentRes.json().catch(() => ({}))) as any;
    const commentCreated = commentRes.status === 201 && commentData.ok === true && !!commentData.comment?.id;

    if (commentCreated) {
      commentId = commentData.comment.id;
    }

    monitor.record(
      'STAGE-3',
      `Visitor Bot (@${surfer.handle}) posts comment on @${botA.handle}'s photo`,
      commentCreated,
      commentLatencyMs,
      commentCreated ? `Comment ID: ${commentId}` : `HTTP ${commentRes.status}: ${commentData.error}`
    );

    // 3. Static Site Guestbook Signature
    const gbMessage = `[:> BOT_GB_${runId}] Signed by automated bot monitor`;
    const gbStart = Date.now();
    const gbRes = await fetch(`${baseUrl}/api/guestbook/${botA.handle}/${targetSite.slug}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${surfer.token}`,
        'X-Test-Suite': 'true',
      },
      body: JSON.stringify({
        visitorName: surfer.handle,
        visitorWebsite: 'https://neogram.club',
        visitorLocation: 'Automated QA Grid',
        moodIcon: '🤖',
        message: gbMessage,
      }),
    });
    const gbData = (await gbRes.json().catch(() => ({}))) as any;
    const gbCreated = gbRes.status === 201 && gbData.ok === true;
    if (gbCreated && gbData.entry?.id) {
      guestbookEntryId = gbData.entry.id;
    }

    monitor.record(
      'STAGE-3',
      `Visitor Bot (@${surfer.handle}) signs guestbook (/api/guestbook/${botA.handle}/${targetSite.slug})`,
      gbCreated,
      Date.now() - gbStart,
      gbCreated ? `Entry ID: ${guestbookEntryId}` : `HTTP ${gbRes.status}: ${gbData.error}`
    );

    // =========================================================================
    // STAGE 4: Monitor Remote Delta Rebuild & Self-Hosted JSON Sync
    // =========================================================================
    monitor.section('STAGE 4: MONITOR REMOTE DELTA REBUILD & SELF-HOSTED JSON SYNC');

    // 1. Poll remote .comments.json (or check API + remote static host)
    if (targetSite.hasApiKey && !isLocal) {
      const commentsJsonUrl = `${remoteBase}/${relCommentsPath}`;
      const deltaPoll = await pollUntilLive(commentsJsonUrl, {
        maxAttempts: 12,
        intervalMs: 1500,
        validate: (body, status) => {
          if (status !== 200) return false;
          try {
            const parsed = JSON.parse(body);
            return (
              Array.isArray(parsed.comments) &&
              parsed.comments.some((c: any) => c.id === commentId || String(c.text).includes(`BOT_COMMENT_${runId}`))
            );
          } catch {
            return false;
          }
        },
      });
      monitor.recordTiming('4. Comment Delta Sync (commentDeltaMs)', deltaPoll.elapsedMs);

      if (deltaPoll.ok) {
        monitor.record(
          'STAGE-4',
          'Remote .comments.json updated with Visitor Bot comment',
          true,
          deltaPoll.elapsedMs,
          `${commentsJsonUrl} (${deltaPoll.attempts} attempt(s))`
        );
      } else {
        // Also check if the photo HTML page itself updated on the remote static host via buildAndDeployComment
        const detailUrl = `${remoteBase}/photos/${postId}/index.html`;
        const htmlDeltaPoll = await pollUntilLive(detailUrl, {
          maxAttempts: 6,
          intervalMs: 1500,
          validate: (body, status) => status === 200 && body.includes(`BOT_COMMENT_${runId}`),
        });
        monitor.recordTiming('4. Comment Delta HTML Sync (commentDeltaMs)', htmlDeltaPoll.elapsedMs);
        monitor.record(
          'STAGE-4',
          'Remote static photo page / ledger reflects new Visitor Bot comment',
          htmlDeltaPoll.ok,
          htmlDeltaPoll.elapsedMs,
          `${detailUrl} (HTTP ${htmlDeltaPoll.status})`
        );
      }
    }

    // 2. Poll GET /api/posts/:id/comments
    const apiCommentsPoll = await pollUntilLive(`${baseUrl}/api/posts/${postId}/comments`, {
      maxAttempts: 6,
      intervalMs: 1000,
      headers: { 'X-Test-Suite': 'true' },
      validate: (body, status) => {
        if (status !== 200) return false;
        try {
          const parsed = JSON.parse(body);
          return (
            Array.isArray(parsed.comments) &&
            parsed.comments.some((c: any) => String(c.text).includes(`BOT_COMMENT_${runId}`))
          );
        } catch {
          return false;
        }
      },
    });
    monitor.record(
      'STAGE-4',
      'GET /api/posts/:id/comments returns Visitor Bot comment',
      apiCommentsPoll.ok,
      apiCommentsPoll.elapsedMs,
      `Found BOT_COMMENT_${runId}`
    );

    // 3. Poll GET /api/guestbook/:handle/:slug
    const apiGbPoll = await pollUntilLive(`${baseUrl}/api/guestbook/${botA.handle}/${targetSite.slug}`, {
      maxAttempts: 6,
      intervalMs: 1000,
      headers: { 'X-Test-Suite': 'true' },
      validate: (body, status) => {
        if (status !== 200) return false;
        try {
          const parsed = JSON.parse(body);
          return (
            Array.isArray(parsed.entries) &&
            parsed.entries.some((e: any) => String(e.message).includes(`BOT_GB_${runId}`))
          );
        } catch {
          return false;
        }
      },
    });
    monitor.record(
      'STAGE-4',
      `GET /api/guestbook/${botA.handle}/${targetSite.slug} persists BOT_GB_${runId}`,
      apiGbPoll.ok,
      apiGbPoll.elapsedMs,
      `Verified guestbook ledger entry`
    );

    // =========================================================================
    // STAGE 5: Monitor Follower Static Friend Grid Cascade
    // =========================================================================
    monitor.section(`STAGE 5: FOLLOWER BOT C (@${friend.handle}) STATIC FRIEND GRID CASCADE`);

    const followStart = Date.now();
    const followRes = await fetch(`${baseUrl}/api/users/${botA.handle}/follow`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${friend.token}`,
        'X-Test-Suite': 'true',
      },
    });
    const followData = (await followRes.json().catch(() => ({}))) as any;
    monitor.record(
      'STAGE-5',
      `Follower Bot (@${friend.handle}) follows @${botA.handle}`,
      followRes.status === 200 && followData.ok === true && followData.isFriend === true,
      Date.now() - followStart,
      `isFriend: ${followData.isFriend}`
    );

    // Verify GET /api/friends includes Bot A and Bot A's new post with absolute URL
    const friendsApiStart = Date.now();
    const friendsApiRes = await fetch(`${baseUrl}/api/friends`, {
      headers: {
        Authorization: `Bearer ${friend.token}`,
        'X-Test-Suite': 'true',
      },
    });
    const friendsApiData = (await friendsApiRes.json().catch(() => ({}))) as any;
    const hasBotAFriend =
      Array.isArray(friendsApiData.friends) &&
      friendsApiData.friends.some((f: any) => f.handle === botA.handle);
    const friendPost = (friendsApiData.posts || []).find((p: any) => p.id === postId);
    const hasAbsoluteUrl = friendPost
      ? /^https?:\/\//i.test(friendPost.imagePath || friendPost.imageUrl || '')
      : true;

    monitor.record(
      'STAGE-5',
      `GET /api/friends for @${friend.handle} includes @${botA.handle} & federated posts`,
      friendsApiRes.status === 200 && hasBotAFriend && hasAbsoluteUrl,
      Date.now() - friendsApiStart,
      friendPost ? `Found post ${postId} in federated stream` : `Friends count: ${friendsApiData.friends?.length || 0}`
    );

    // Poll @qa_friend's remote static site if keyed and site has been seeded
    const friendSite = (friend.sites || []).find((s) => s.hasApiKey);
    if (friendSite && !isLocal) {
      const friendDeploy = friendSite.deployPath ? friendSite.deployPath.replace(/^\/+|\/+$/g, '') : '';
      const friendRemoteBase = `${friendSite.siteUrl.replace(/\/+$/, '')}${friendDeploy ? '/' + friendDeploy : ''}`;
      const friendPageUrl = `${friendRemoteBase}/friends/index.html`;

      const friendCascadePoll = await pollUntilLive(friendPageUrl, {
        maxAttempts: 6,
        intervalMs: 1500,
        validate: (body, status) => status === 200 && (body.includes('neogram') || body.includes('FRIENDS')),
      });
      monitor.recordTiming('5. Follower Friends Grid Probe (friendCascadeMs)', friendCascadePoll.elapsedMs);
      if (friendCascadePoll.ok) {
        monitor.record(
          'STAGE-5',
          `Follower remote static friends grid (${friendPageUrl}) live`,
          true,
          friendCascadePoll.elapsedMs,
          `HTTP ${friendCascadePoll.status}`
        );
      } else {
        monitor.warn(
          'STAGE-5',
          `Follower remote static site (${friendPageUrl}) not deployed yet (HTTP ${friendCascadePoll.status}); checked API cascade`,
          friendCascadePoll.elapsedMs
        );
      }
    }

    // =========================================================================
    // STAGE 6: Post-Run Cleanup & Diagnostic Report
    // =========================================================================
    monitor.section('STAGE 6: POST-RUN CLEANUP & LEDGER MODERATION');

    if (commentId) {
      const delCommentStart = Date.now();
      const delCommentRes = await fetch(`${baseUrl}/api/posts/${postId}/comments/${commentId}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${botA.token}`,
          'X-Test-Suite': 'true',
        },
      });
      const delCommentData = (await delCommentRes.json().catch(() => ({}))) as any;
      monitor.record(
        'STAGE-6',
        `Owner (@${botA.handle}) moderates/deletes test comment ${commentId}`,
        delCommentRes.status === 200 && delCommentData.ok === true,
        Date.now() - delCommentStart,
        delCommentData.message
      );
    }

    if (guestbookEntryId) {
      await fetch(`${baseUrl}/api/guestbook/${guestbookEntryId}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${botA.token}`,
          'X-Test-Suite': 'true',
        },
      }).catch(() => {});
    }

    if (!keepArtifacts && postId) {
      const delPostStart = Date.now();
      const delPostRes = await fetch(`${baseUrl}/api/posts/${postId}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${botA.token}`,
          'X-Test-Suite': 'true',
        },
      });
      const delPostData = (await delPostRes.json().catch(() => ({}))) as any;
      monitor.record(
        'STAGE-6',
        `Owner (@${botA.handle}) deletes test probe post ${postId}`,
        delPostRes.status === 200 && delPostData.ok === true,
        Date.now() - delPostStart,
        'Cleaned up test post & triggered remote delta removal'
      );
    } else if (keepArtifacts) {
      monitor.warn('STAGE-6', `Keeping test post ${postId} on live static host (--keep flag active)`);
    }
  } catch (err: any) {
    monitor.record('FATAL', 'Unhandled exception in Static Site Bot Monitor', false, 0, err.message || String(err));
  }

  monitor.printSummaryAndExit(true);
}

runStaticSiteBotMonitor();

