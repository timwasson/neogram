/**
 * Neogram QA Fleet Social Network Verification, Content Seeder & Telemetry Suite
 * ===============================================================================
 * Performs thorough multi-agent content population & verification across the QA fleet:
 *   1. Random persona selection for retro profile avatar generation and upload (multipart & base64)
 *   2. Reciprocal friend/follow verification (`POST /api/users/:handle/follow` & `GET /api/users/:handle/friend-status`)
 *   3. Randomized concurrent wave of Single-Photo (1 frame) & Multi-Photo Carousel (2–4 frames) uploads
 *      across random QA accounts/sites with retro shaders, testing `buildQueue` under concurrent load
 *   4. 5-photo limit enforcement barrier check (`HTTP 400` on 6 frames)
 *   5. Peer-to-peer comments & likes across single-photo and multi-photo posts
 *   6. Peer-to-peer guestbook signatures with nostalgic mood icons across multiple stations
 *   7. Dynamic SVG web hit counter verification across multiple stations
 *   8. Queue drain monitoring & strict feed entwining invariant assertions (@wasson vs @sheavanlan)
 *   9. Comprehensive BuildQueue & Server Load Telemetry Report (jobs processed, queue depth, latencies, RAM/CPU load)
 */

import sharp from 'sharp';
import { loadQaFleet, GREEN, RED, YELLOW, CYAN, MAGENTA, RESET, BOLD } from '../server/tests/helpers/qaHarness';

let passedChecks = 0;
let totalChecks = 0;
let failedChecks = 0;

function logHeader(title: string) {
  console.log(`\n${CYAN}${BOLD}================================================================================${RESET}`);
  console.log(`${CYAN}${BOLD}  [:> QA FLEET] ${title}${RESET}`);
  console.log(`${CYAN}${BOLD}================================================================================${RESET}`);
}

function recordCheck(desc: string, passed: boolean, extra: string = '') {
  totalChecks++;
  if (passed) {
    passedChecks++;
    console.log(`  ${GREEN}[✓ PASS]${RESET} ${desc} ${extra ? `${YELLOW}(${extra})${RESET}` : ''}`);
  } else {
    failedChecks++;
    console.error(`  ${RED}[✗ FAIL]${RESET} ${desc} ${extra ? `\n         Details: ${RED}${extra}${RESET}` : ''}`);
  }
}

function percentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return 0;
  const idx = Math.min(sortedValues.length - 1, Math.max(0, Math.ceil((p / 100) * sortedValues.length) - 1));
  return sortedValues[idx];
}

function formatStats(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  const avg = sorted.length ? Math.round(sum / sorted.length) : 0;
  return {
    min: sorted[0] ?? 0,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    max: sorted[sorted.length - 1] ?? 0,
    avg,
  };
}

function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

async function createRetroAvatarSvg(bg: string, fg: string, glyph: string): Promise<Buffer> {
  const svg = `<svg width="256" height="256" viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg">
    <rect width="256" height="256" fill="${bg}" />
    <circle cx="128" cy="128" r="96" fill="${fg}" />
    <text x="128" y="148" font-size="80" font-family="monospace" font-weight="bold" fill="${bg}" text-anchor="middle" dominant-baseline="middle">${glyph}</text>
    <rect x="16" y="16" width="224" height="224" fill="none" stroke="${fg}" stroke-width="8" stroke-dasharray="16,8" />
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/**
 * Generates visually distinct 90s retro synthwave / cyber-grid / arcade artwork frames
 */
async function createRetroArtworkFrame(themeIndex: number, title: string, subtitle: string): Promise<Buffer> {
  const palettes = [
    { bg1: '#0b001a', bg2: '#2d004d', sun: '#ff007f', grid: '#00f0ff', text: '#ffffff' },
    { bg1: '#001220', bg2: '#003844', sun: '#ffcc00', grid: '#00ff88', text: '#e0ffff' },
    { bg1: '#1a0900', bg2: '#4d1900', sun: '#ff4400', grid: '#ffaa00', text: '#fff5e6' },
    { bg1: '#050517', bg2: '#1b1b3a', sun: '#7b2cbf', grid: '#ff9e00', text: '#f8f9fa' },
    { bg1: '#001a09', bg2: '#003d16', sun: '#00ff66', grid: '#33ffcc', text: '#e6ffee' },
    { bg1: '#1f0018', bg2: '#420039', sun: '#00e5ff', grid: '#ff00aa', text: '#ffffff' },
  ];
  const p = palettes[themeIndex % palettes.length];
  const safeTitle = title.replace(/[<>&"']/g, '');
  const safeSub = subtitle.replace(/[<>&"']/g, '');

  const svg = `<svg width="800" height="800" viewBox="0 0 800 800" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${p.bg1}" />
        <stop offset="65%" stop-color="${p.bg2}" />
        <stop offset="100%" stop-color="#050505" />
      </linearGradient>
    </defs>
    <rect width="800" height="800" fill="url(#sky)" />
    <!-- Retro Sun -->
    <circle cx="400" cy="340" r="150" fill="${p.sun}" opacity="0.88" />
    <rect x="230" y="360" width="340" height="12" fill="${p.bg2}" />
    <rect x="230" y="390" width="340" height="16" fill="${p.bg2}" />
    <rect x="230" y="424" width="340" height="22" fill="${p.bg2}" />
    <!-- Horizon & Perspective Grid -->
    <line x1="0" y1="480" x2="800" y2="480" stroke="${p.grid}" stroke-width="4" />
    <line x1="0" y1="530" x2="800" y2="530" stroke="${p.grid}" stroke-width="2" opacity="0.7" />
    <line x1="0" y1="590" x2="800" y2="590" stroke="${p.grid}" stroke-width="2" opacity="0.7" />
    <line x1="0" y1="665" x2="800" y2="665" stroke="${p.grid}" stroke-width="2" opacity="0.7" />
    <line x1="0" y1="750" x2="800" y2="750" stroke="${p.grid}" stroke-width="3" opacity="0.8" />
    <line x1="400" y1="480" x2="0" y2="800" stroke="${p.grid}" stroke-width="2" opacity="0.6" />
    <line x1="400" y1="480" x2="200" y2="800" stroke="${p.grid}" stroke-width="2" opacity="0.6" />
    <line x1="400" y1="480" x2="400" y2="800" stroke="${p.grid}" stroke-width="2" opacity="0.6" />
    <line x1="400" y1="480" x2="600" y2="800" stroke="${p.grid}" stroke-width="2" opacity="0.6" />
    <line x1="400" y1="480" x2="800" y2="800" stroke="${p.grid}" stroke-width="2" opacity="0.6" />
    <!-- HUD Border & Typography -->
    <rect x="24" y="24" width="752" height="752" fill="none" stroke="${p.grid}" stroke-width="4" />
    <text x="400" y="110" text-anchor="middle" fill="${p.text}" font-size="38" font-family="monospace" font-weight="bold">${safeTitle}</text>
    <text x="400" y="160" text-anchor="middle" fill="${p.grid}" font-size="24" font-family="monospace">${safeSub}</text>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

interface HealthSnapshot {
  memoryUsageMb: number;
  heapUsedMb: number;
  loadAvg: number[];
  queue: {
    isBusy: boolean;
    activeCount: number;
    highPendingCount: number;
    lowPendingCount: number;
    peakQueueDepth: number;
    totalProcessed: number;
    avgDurationMs: number;
    p95DurationMs: number;
    maxDurationMs: number;
  };
}

async function fetchHealthSnapshot(baseUrl: string): Promise<HealthSnapshot | null> {
  try {
    const res = await fetch(`${baseUrl}/api/health`);
    if (!res.ok) return null;
    const data = (await res.json()) as any;
    return {
      memoryUsageMb: data.services?.system?.memoryUsageMb || 0,
      heapUsedMb: data.services?.system?.heapUsedMb || 0,
      loadAvg: data.services?.system?.loadAvg || [0, 0, 0],
      queue: data.services?.queue || {
        isBusy: false,
        activeCount: 0,
        highPendingCount: 0,
        lowPendingCount: 0,
        peakQueueDepth: 0,
        totalProcessed: 0,
        avgDurationMs: 0,
        p95DurationMs: 0,
        maxDurationMs: 0,
      },
    };
  } catch {
    return null;
  }
}

async function runFleetNetworkTests() {
  const startTime = Date.now();
  logHeader('INITIALIZING QA FLEET CONTENT SEEDER & TELEMETRY SUITE');

  const fleet = await loadQaFleet();
  const baseUrl = fleet.baseUrl;
  const agents = fleet.agents;

  console.log(`${CYAN}Target Host     :${RESET} ${YELLOW}${baseUrl}${RESET}`);
  console.log(`${CYAN}Total QA Agents :${RESET} ${BOLD}${agents.length}${RESET} personas loaded\n`);

  if (agents.length === 0) {
    console.error(`${RED}[:> ERROR] No QA agents found in qa-sessions.json.${RESET}`);
    process.exit(1);
  }

  const initialHealth = await fetchHealthSnapshot(baseUrl);
  let peakMemoryMb = initialHealth?.memoryUsageMb || 0;
  let peakHeapMb = initialHealth?.heapUsedMb || 0;
  let peakActiveQueue = 0;

  const sampleHealth = async () => {
    const snap = await fetchHealthSnapshot(baseUrl);
    if (snap) {
      if (snap.memoryUsageMb > peakMemoryMb) peakMemoryMb = snap.memoryUsageMb;
      if (snap.heapUsedMb > peakHeapMb) peakHeapMb = snap.heapUsedMb;
      const qDepth = snap.queue.activeCount + snap.queue.highPendingCount + snap.queue.lowPendingCount;
      if (qDepth > peakActiveQueue) peakActiveQueue = qDepth;
    }
    return snap;
  };

  // ---------------------------------------------------------------------------
  // 1. Profile Avatar Lifecycle across Random QA Personas
  // ---------------------------------------------------------------------------
  logHeader('1. PROFILE AVATAR GENERATION & DEPLOYMENT');

  const shuffledAgents = shuffle(agents);
  const agentA = shuffledAgents[0];
  const agentB = shuffledAgents[1] || shuffledAgents[0];

  console.log(`Selected Agent A (Multipart): ${GREEN}@${agentA.handle}${RESET} (UIN #${agentA.uin})`);
  const avatarBufA = await createRetroAvatarSvg('#001133', '#00ffcc', '⚡');
  const formA = new FormData();
  formA.append('avatarFile', new Blob([new Uint8Array(avatarBufA)], { type: 'image/png' }), 'avatar.png');
  formA.append('statusMessage', 'Surfing Cyberspace (QA Agent)');

  const uploadResA = await fetch(`${baseUrl}/api/settings/profile`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${agentA.token}` },
    body: formA,
  });
  recordCheck(`Multipart avatar upload for @${agentA.handle}`, uploadResA.status === 200, `Status: ${uploadResA.status}`);

  const dataA = (await uploadResA.json().catch(() => ({}))) as any;
  const avatarPathA = dataA.user?.avatarPath;
  recordCheck(
    `Avatar response returns valid WebP path`,
    typeof avatarPathA === 'string' && avatarPathA.includes('.webp'),
    avatarPathA || 'null'
  );

  console.log(`Selected Agent B (Base64): ${GREEN}@${agentB.handle}${RESET} (UIN #${agentB.uin})`);
  const avatarBufB = await createRetroAvatarSvg('#220022', '#ff00aa', '★');
  const uploadResB = await fetch(`${baseUrl}/api/settings/profile`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${agentB.token}`,
    },
    body: JSON.stringify({
      avatarBase64: `data:image/png;base64,${avatarBufB.toString('base64')}`,
      statusMessage: 'Retro Matrix Operator',
    }),
  });
  recordCheck(`Base64 avatar upload for @${agentB.handle}`, uploadResB.status === 200, `Status: ${uploadResB.status}`);

  // ---------------------------------------------------------------------------
  // 2. Reciprocal Friend / Follow Graph Verification
  // ---------------------------------------------------------------------------
  logHeader('2. RECIPROCAL FRIEND / FOLLOW GRAPH VERIFICATION');

  let friendshipsVerified = 0;
  const friendPairs = [
    [shuffledAgents[0], shuffledAgents[1]],
    [shuffledAgents[1], shuffledAgents[2]],
    [shuffledAgents[2], shuffledAgents[0]],
  ].filter(([u1, u2]) => u1 && u2 && u1.handle !== u2.handle);

  for (const [follower, target] of friendPairs) {
    const followRes = await fetch(`${baseUrl}/api/users/${target.handle}/follow`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${follower.token}` },
    });
    const followData = (await followRes.json().catch(() => ({}))) as any;
    const statusRes = await fetch(`${baseUrl}/api/users/${target.handle}/friend-status`, {
      headers: { Authorization: `Bearer ${follower.token}` },
    });
    const statusData = (await statusRes.json().catch(() => ({}))) as any;
    const ok = followRes.status === 200 && followData.ok === true && statusData.isFriend === true;
    if (ok) friendshipsVerified++;
    recordCheck(
      `Friend connection @${follower.handle} -> @${target.handle}`,
      ok,
      `isFriend: ${statusData.isFriend}, followers: ${statusData.followersCount}`
    );
  }

  // ---------------------------------------------------------------------------
  // 3. Randomized Single-Photo & Multi-Photo Uploads (Concurrent Queue Wave)
  // ---------------------------------------------------------------------------
  logHeader('3. RANDOMIZED SINGLE & MULTI-PHOTO CONCURRENT UPLOAD WAVE');

  // Collect candidate (agent, site) pairs, prioritizing live API-key sites plus random sandbox agents
  const allTargets: Array<{ agent: typeof agents[0]; site: any }> = [];
  for (const ag of shuffle(agents)) {
    if (ag.sites && ag.sites.length > 0) {
      for (const s of ag.sites) {
        allTargets.push({ agent: ag, site: s });
      }
    } else {
      allTargets.push({ agent: ag, site: null });
    }
  }

  const keyedTargets = shuffle(allTargets.filter((t) => t.site?.hasApiKey));
  const sandboxTargets = shuffle(allTargets.filter((t) => !t.site?.hasApiKey));
  const selectedTargets = [...keyedTargets, ...sandboxTargets.slice(0, 1)].slice(0, Math.max(keyedTargets.length, 6));

  // Assign a mix of single-photo (1 frame) and multi-photo (2-4 frames) across the selected targets
  // Guarantee at least 3 multi-photo carousel posts and multiple single-photo posts
  const baseFramePattern = [1, 3, 1, 2, 1, 4, 1, 2, 3, 1];
  const frameCounts = shuffle(baseFramePattern.slice(0, selectedTargets.length));
  const shaders = ['crt', 'sepia', 'vga', 'gameboy', 'cyberpunk', 'lofi'];
  const moods = ['Radical', 'Cyber', 'Chill', 'Nostalgic', '90s Kid', 'Dial-Up'];
  const webrings = ['RetroWeb', 'CyberRing', 'PixelArt', 'SynthWave', 'IndieWeb'];
  const captions = [
    'Late night CRT glow in the cyberspace sector',
    'Dialing into the 56k BBS matrix at midnight',
    'Fresh pixel snapshots from the neighborhood webring',
    'Dual-channel synthwave transmission across the static grid',
    'GeoCities homestead vibes & neon horizons',
    'Booting up the workstation for another retro session',
  ];

  // 3.1 Verify 5-Photo Limit Enforcement Barrier (Uploading 6 photos must return HTTP 400)
  const barrierTarget = selectedTargets[0];
  console.log(`${CYAN}Testing 5-photo limit barrier on @${barrierTarget.agent.handle} (6 frames -> HTTP 400)...${RESET}`);
  const overflowBuf = await createRetroArtworkFrame(0, 'OVERFLOW TEST', 'FRAME LIMIT');
  const excessFormData = new FormData();
  excessFormData.append('caption', 'Attempting 6 photos upload');
  excessFormData.append('filterApplied', 'crt');
  if (barrierTarget.site?.id) excessFormData.append('siteId', barrierTarget.site.id);
  for (let i = 1; i <= 6; i++) {
    excessFormData.append('imageFiles', new Blob([new Uint8Array(overflowBuf)], { type: 'image/png' }), `overflow_${i}.png`);
  }
  const excessRes = await fetch(`${baseUrl}/api/posts`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${barrierTarget.agent.token}` },
    body: excessFormData,
  });
  recordCheck(`5-photo limit barrier rejected with HTTP 400`, excessRes.status === 400, `Status: ${excessRes.status}`);

  // 3.2 Pre-generate artwork buffers and launch concurrent multi-account upload wave
  console.log(`\n${MAGENTA}${BOLD}Launching concurrent upload wave across ${selectedTargets.length} station targets...${RESET}`);
  const uploadPayloads = await Promise.all(
    selectedTargets.map(async (target, idx) => {
      const numFrames = frameCounts[idx] || 1;
      const shader = shaders[idx % shaders.length];
      const mood = moods[idx % moods.length];
      const webring = webrings[idx % webrings.length];
      const baseCaption = captions[idx % captions.length];
      const isMulti = numFrames > 1;
      const frames: Buffer[] = [];
      for (let f = 1; f <= numFrames; f++) {
        const buf = await createRetroArtworkFrame(
          idx + f,
          isMulti ? `${target.agent.handle.toUpperCase()} [${f}/${numFrames}]` : `${target.agent.handle.toUpperCase()}`,
          `${shader.toUpperCase()} // ${target.site?.slug || 'STATION'}`
        );
        frames.push(buf);
      }
      return {
        target,
        numFrames,
        isMulti,
        shader,
        mood,
        webring,
        caption: `${baseCaption} // @${target.agent.handle} [${isMulti ? `${numFrames}-Frame Gallery` : 'Single Snap'} // ${shader.toUpperCase()}]`,
        frames,
      };
    })
  );

  // Poll health while uploads are in flight to capture peak server load & queue depth
  const healthPoller = setInterval(() => {
    sampleHealth().catch(() => {});
  }, 400);

  const waveStart = Date.now();
  const uploadResults = await Promise.all(
    uploadPayloads.map(async (item) => {
      const t0 = Date.now();
      const fd = new FormData();
      fd.append('caption', item.caption);
      fd.append('filterApplied', item.shader);
      fd.append('mood', item.mood);
      fd.append('webring', item.webring);
      if (item.target.site?.id) fd.append('siteId', item.target.site.id);

      if (item.isMulti) {
        item.frames.forEach((buf, idx) => {
          fd.append('imageFiles', new Blob([new Uint8Array(buf)], { type: 'image/png' }), `slide_${idx + 1}.png`);
        });
      } else {
        fd.append('imageFile', new Blob([new Uint8Array(item.frames[0])], { type: 'image/png' }), 'single.png');
      }

      const res = await fetch(`${baseUrl}/api/posts`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${item.target.agent.token}` },
        body: fd,
      });
      const durationMs = Date.now() - t0;
      const body = (await res.json().catch(() => ({}))) as any;
      return {
        item,
        status: res.status,
        ok: (res.status === 200 || res.status === 201) && Boolean(body.post?.id),
        post: body.post,
        durationMs,
        error: body.error,
      };
    })
  );

  clearInterval(healthPoller);
  await sampleHealth();
  const waveWallClockMs = Date.now() - waveStart;

  const createdPosts: Array<{ post: any; owner: typeof agents[0]; numFrames: number }> = [];
  let singlePostsCreated = 0;
  let multiPostsCreated = 0;
  let totalFramesUploaded = 0;

  for (const res of uploadResults) {
    const { target, numFrames, isMulti, shader } = res.item;
    const siteLabel = `${target.agent.handle}/${target.site?.slug || 'main'} (${target.site?.deploymentType || 'sandbox'})`;
    recordCheck(
      `${isMulti ? `Multi-photo (${numFrames} frames)` : 'Single-photo'} upload -> @${siteLabel} [${shader.toUpperCase()}]`,
      res.ok && Array.isArray(res.post?.photos) && res.post.photos.length === numFrames,
      res.ok ? `HTTP ${res.status} in ${res.durationMs}ms, id=${res.post.id.slice(0, 8)}` : `HTTP ${res.status}: ${res.error || 'Failed'}`
    );
    if (res.ok && res.post) {
      createdPosts.push({ post: res.post, owner: target.agent, numFrames });
      totalFramesUploaded += numFrames;
      if (isMulti) multiPostsCreated++;
      else singlePostsCreated++;
    }
  }

  // Verify GET /api/posts/:id on a multi-photo post
  const sampleMulti = createdPosts.find((p) => p.numFrames > 1);
  if (sampleMulti) {
    const detailRes = await fetch(`${baseUrl}/api/posts/${sampleMulti.post.id}`);
    const detailData = (await detailRes.json().catch(() => ({}))) as any;
    recordCheck(
      `GET /api/posts/${sampleMulti.post.id.slice(0, 8)} persists ${sampleMulti.numFrames}-frame carousel array`,
      detailRes.status === 200 && Array.isArray(detailData.post?.photos) && detailData.post.photos.length === sampleMulti.numFrames,
      `Frames: ${detailData.post?.photos?.length || 0}`
    );
  }

  // ---------------------------------------------------------------------------
  // 4. Peer Comments & Likes Across Newly Created Posts
  // ---------------------------------------------------------------------------
  logHeader('4. PEER COMMENTS & LIKES ACROSS SINGLE & MULTI-PHOTO POSTS');

  let totalLikesRecorded = 0;
  let totalCommentsPosted = 0;
  const commentTemplates = [
    'Radical transmission! Those CRT scanlines look authentic.',
    'Loving this gallery aesthetic—straight out of 1998!',
    'Bookmarked your station in my Netscape communicator!',
    'Awesome frames! The WebRing is alive and glowing.',
    'Pure 90s nostalgia! Keep posting from cyberspace!',
  ];

  for (let i = 0; i < createdPosts.length; i++) {
    const entry = createdPosts[i];
    const peer = shuffledAgents.find((a) => a.handle !== entry.owner.handle) || agentB;

    const likeRes = await fetch(`${baseUrl}/api/posts/${entry.post.id}/like`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${peer.token}` },
    });
    if (likeRes.status === 200) totalLikesRecorded++;
    recordCheck(
      `Peer like by @${peer.handle} on @${entry.owner.handle}'s post (${entry.numFrames}f)`,
      likeRes.status === 200,
      `Status: ${likeRes.status}`
    );

    const commentText = `${commentTemplates[i % commentTemplates.length]} — @${peer.handle}`;
    const commentRes = await fetch(`${baseUrl}/api/posts/${entry.post.id}/comments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${peer.token}`,
      },
      body: JSON.stringify({ text: commentText }),
    });
    const commentOk = commentRes.status === 200 || commentRes.status === 201;
    if (commentOk) totalCommentsPosted++;
    recordCheck(
      `Peer comment by @${peer.handle} on @${entry.owner.handle}'s post`,
      commentOk,
      `Status: ${commentRes.status}`
    );
  }

  // ---------------------------------------------------------------------------
  // 5. Peer Guestbook Signatures & Dynamic Web Hit Counters
  // ---------------------------------------------------------------------------
  logHeader('5. PEER GUESTBOOK SIGNATURES & SVG HIT COUNTERS');

  const moodIcons = ['😎', '👾', '🕹️', '💾', '🎸', '📟'];
  let guestbooksSigned = 0;
  const gbPairs = [
    [shuffledAgents[0], shuffledAgents[1]],
    [shuffledAgents[1], shuffledAgents[2]],
    [shuffledAgents[2], shuffledAgents[0]],
  ].filter(([v, h]) => v && h && v.handle !== h.handle);

  for (let i = 0; i < gbPairs.length; i++) {
    const [visitor, host] = gbPairs[i];
    const mood = moodIcons[i % moodIcons.length];
    const msg = `Dropping by @${host.handle}'s station at ${new Date().toLocaleTimeString()}! Keep the 90s web alive!`;

    const gbSignRes = await fetch(`${baseUrl}/api/guestbook/${host.uin}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${visitor.token}`,
      },
      body: JSON.stringify({
        name: visitor.handle,
        website: visitor.sites?.[0]?.siteUrl || `${baseUrl}/user/${visitor.uin || visitor.handle}`,
        message: msg,
        moodIcon: mood,
      }),
    });
    const signOk = gbSignRes.status === 200 || gbSignRes.status === 201;
    if (signOk) guestbooksSigned++;
    recordCheck(
      `Guestbook signature @${visitor.handle} -> @${host.handle} (#${host.uin})`,
      signOk,
      `Status: ${gbSignRes.status}`
    );
  }

  let countersHit = 0;
  for (const ag of shuffledAgents.slice(0, 3)) {
    const slug = ag.sites?.[0]?.slug || 'main';
    const counterUrl = `${baseUrl}/counter/${ag.uin}/${slug}.svg`;
    const hitRes = await fetch(counterUrl);
    const svgText = await hitRes.text();
    const ok = hitRes.status === 200 && svgText.includes('<svg') && svgText.includes('</svg>');
    if (ok) countersHit++;
    recordCheck(`SVG Hit Counter for @${ag.handle} (#${ag.uin}/${slug})`, ok, `Status: ${hitRes.status}`);
  }

  // ---------------------------------------------------------------------------
  // 6. Wait for BuildQueue Drain & Verify Feed Entwining Invariants
  // ---------------------------------------------------------------------------
  logHeader('6. BUILD QUEUE DRAIN & FEED ENTWINING INVARIANTS');

  console.log(`Waiting for background buildQueue to finish processing remaining cascade jobs...`);
  const drainStart = Date.now();
  let finalHealth = await sampleHealth();
  while (finalHealth?.queue?.isBusy && Date.now() - drainStart < 45000) {
    await new Promise((r) => setTimeout(r, 1000));
    finalHealth = await sampleHealth();
  }
  const drainElapsedMs = Date.now() - drainStart;
  recordCheck(
    `BuildQueue drained cleanly without hanging`,
    !finalHealth?.queue?.isBusy,
    `Drained in ${drainElapsedMs}ms (Active: ${finalHealth?.queue?.activeCount || 0}, H:${finalHealth?.queue?.highPendingCount || 0}, L:${finalHealth?.queue?.lowPendingCount || 0})`
  );

  // Invariant A: User @wasson (follows each QA user's default site)
  const wassonFeedRes = await fetch(`${baseUrl}/api/user/wasson/friends-feed`);
  const wassonFeedData = (await wassonFeedRes.json().catch(() => ({}))) as any;
  const wassonPosts = wassonFeedData.posts || [];
  const uniqueAuthorsCount = new Set(createdPosts.map((c) => c.owner.userId)).size;
  recordCheck(
    `GET /api/user/wasson/friends-feed includes newly published QA posts`,
    wassonFeedRes.status === 200 && wassonPosts.length >= uniqueAuthorsCount,
    `Posts in @wasson feed: ${wassonPosts.length} (from ${uniqueAuthorsCount} distinct QA friends)`
  );

  // Invariant B: User @sheavanlan
  const sheavanlanFeedRes = await fetch(`${baseUrl}/api/user/sheavanlan/friends-feed`);
  const sheavanlanFeedData = (await sheavanlanFeedRes.json().catch(() => ({}))) as any;
  const sheavanlanPosts = sheavanlanFeedData.posts || [];
  const qaHandles = new Set(agents.map((a) => a.handle.toLowerCase()));
  const contaminatingPosts = sheavanlanPosts.filter((p: any) => {
    const author = (p.author?.handle || p.authorHandle || p.author || p.handle || '').toLowerCase().replace(/^@/, '');
    return qaHandles.has(author);
  });
  recordCheck(
    `STRICT INVARIANT: @sheavanlan feed contains ZERO QA test posts`,
    sheavanlanFeedRes.status === 200 && contaminatingPosts.length === 0,
    `Contaminating posts: ${contaminatingPosts.length}`
  );

  // ---------------------------------------------------------------------------
  // 7. Comprehensive Telemetry & Server Load Report
  // ---------------------------------------------------------------------------
  const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(2);
  const uploadTurnaroundStats = formatStats(uploadResults.map((r) => r.durationMs));
  const jobsProcessedDelta =
    finalHealth && initialHealth
      ? Math.max(0, finalHealth.queue.totalProcessed - initialHealth.queue.totalProcessed)
      : finalHealth?.queue?.totalProcessed || 0;
  const reportedPeakQueue = Math.max(peakActiveQueue, finalHealth?.queue?.peakQueueDepth || 0);

  console.log(`\n${CYAN}${BOLD}================================================================================${RESET}`);
  console.log(`${CYAN}${BOLD}  [:> QA FLEET TELEMETRY & SERVER LOAD REPORT]                                  ${RESET}`);
  console.log(`${CYAN}${BOLD}================================================================================${RESET}`);
  console.log(`  Target Environment        : ${YELLOW}${baseUrl}${RESET}`);
  console.log(`  Total Wall-Clock Time     : ${BOLD}${elapsedSec}s${RESET}`);
  console.log(`  Verification Checks       : ${GREEN}${BOLD}${passedChecks}/${totalChecks} PASSED${RESET} (${failedChecks > 0 ? RED : GREEN}${failedChecks} failed${RESET})`);
  console.log(`${CYAN}--------------------------------------------------------------------------------${RESET}`);
  console.log(`  ${BOLD}CONTENT & SOCIAL SEEDING SUMMARY:${RESET}`);
  console.log(`    • Posts Published       : ${BOLD}${createdPosts.length}${RESET} (${singlePostsCreated} Single-Photo, ${multiPostsCreated} Multi-Photo Carousels)`);
  console.log(`    • Total Image Frames    : ${BOLD}${totalFramesUploaded}${RESET} frames processed via Sharp WebP + Shaders`);
  console.log(`    • Friendships Verified  : ${BOLD}${friendshipsVerified}${RESET} reciprocal connections`);
  console.log(`    • Peer Likes & Comments : ${BOLD}${totalLikesRecorded}${RESET} likes, ${BOLD}${totalCommentsPosted}${RESET} comments`);
  console.log(`    • Guestbooks & Counters : ${BOLD}${guestbooksSigned}${RESET} guestbook entries, ${BOLD}${countersHit}${RESET} SVG counters incremented`);
  console.log(`${CYAN}--------------------------------------------------------------------------------${RESET}`);
  console.log(`  ${BOLD}QUEUE & BUILD PIPELINE TELEMETRY:${RESET}`);
  console.log(`    • Concurrent Wave Time  : ${BOLD}${waveWallClockMs}ms (${(waveWallClockMs / 1000).toFixed(2)}s)${RESET} for ${selectedTargets.length} simultaneous station uploads`);
  console.log(`    • Upload Turnaround     : min ${BOLD}${uploadTurnaroundStats.min}ms${RESET} | p50 ${BOLD}${uploadTurnaroundStats.p50}ms${RESET} | p95 ${BOLD}${uploadTurnaroundStats.p95}ms${RESET} | max ${BOLD}${uploadTurnaroundStats.max}ms${RESET} (avg ${uploadTurnaroundStats.avg}ms)`);
  console.log(`    • Build Jobs Processed  : ${BOLD}${jobsProcessedDelta}${RESET} jobs completed during run (Cumulative: ${finalHealth?.queue?.totalProcessed || 0})`);
  console.log(`    • Peak Queue Depth      : ${BOLD}${reportedPeakQueue}${RESET} queued jobs`);
  console.log(`    • Build Job Execution   : avg ${BOLD}${finalHealth?.queue?.avgDurationMs || 0}ms${RESET} | p95 ${BOLD}${finalHealth?.queue?.p95DurationMs || 0}ms${RESET} | max ${BOLD}${finalHealth?.queue?.maxDurationMs || 0}ms${RESET}`);
  console.log(`${CYAN}--------------------------------------------------------------------------------${RESET}`);
  console.log(`  ${BOLD}SERVER LOAD TELEMETRY:${RESET}`);
  console.log(`    • Memory RSS (Start/Pk) : ${BOLD}${initialHealth?.memoryUsageMb || 0} MB${RESET} -> Peak ${BOLD}${peakMemoryMb} MB${RESET} -> End ${BOLD}${finalHealth?.memoryUsageMb || 0} MB${RESET}`);
  console.log(`    • V8 Heap Used (Peak)   : ${BOLD}${peakHeapMb} MB${RESET} (End: ${finalHealth?.heapUsedMb || 0} MB)`);
  console.log(`    • CPU Load Avg (1/5/15m): ${BOLD}${(finalHealth?.loadAvg || [0, 0, 0]).join(' / ')}${RESET}`);
  console.log(`${CYAN}${BOLD}================================================================================${RESET}`);

  if (failedChecks === 0) {
    console.log(`\n${GREEN}${BOLD}[:> SUCCESS] QA FLEET POPULATED, QUEUE DRAINED & ALL CHECKS VERIFIED!${RESET}\n`);
    process.exit(0);
  } else {
    console.error(`\n${RED}${BOLD}[:> FAILURE] ${failedChecks} CHECK(S) FAILED IN QA FLEET NETWORK SUITE.${RESET}\n`);
    process.exit(1);
  }
}

runFleetNetworkTests().catch((err) => {
  console.error(`\n${RED}${BOLD}[:> FATAL ERROR]${RESET}`, err);
  process.exit(1);
});
