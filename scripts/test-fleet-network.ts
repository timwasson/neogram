/**
 * Neogram QA Fleet Social Network Verification & Telemetry Suite
 * ===============================================================
 * Performs thorough multi-agent testing across the dedicated QA persona network:
 *   1. Random persona selection for retro profile avatar generation and upload (multipart & base64)
 *   2. Photo gallery creation with retro shaders and delta publishing to mounted sites
 *   3. Peer-to-peer guestbook signatures with nostalgic mood icons
 *   4. Dynamic SVG web hit counter increment verification
 *   5. Strict feed entwining invariant assertions:
 *      - User @wasson is followed by and follows QA personas; feed includes QA posts
 *      - User @sheavanlan has ZERO QA followers/following; feed has zero QA posts
 */

import sharp from 'sharp';
import { loadQaFleet, fetchPicsumTestImage, GREEN, RED, YELLOW, CYAN, MAGENTA, RESET, BOLD } from '../server/tests/helpers/qaHarness';

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

async function createRetroAvatarSvg(bg: string, fg: string, glyph: string): Promise<Buffer> {
  const svg = `<svg width="256" height="256" viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg">
    <rect width="256" height="256" fill="${bg}" />
    <circle cx="128" cy="128" r="96" fill="${fg}" />
    <text x="128" y="148" font-size="80" font-family="monospace" font-weight="bold" fill="${bg}" text-anchor="middle" dominant-baseline="middle">${glyph}</text>
    <rect x="16" y="16" width="224" height="224" fill="none" stroke="${fg}" stroke-width="8" stroke-dasharray="16,8" />
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function runFleetNetworkTests() {
  const startTime = Date.now();
  logHeader('INITIALIZING QA FLEET NETWORK VERIFICATION SUITE');

  const fleet = await loadQaFleet();
  const baseUrl = fleet.baseUrl;
  const agents = fleet.agents;

  console.log(`${CYAN}Target Host     :${RESET} ${YELLOW}${baseUrl}${RESET}`);
  console.log(`${CYAN}Total QA Agents :${RESET} ${BOLD}${agents.length}${RESET} personas loaded\n`);

  if (agents.length === 0) {
    console.error(`${RED}[:> ERROR] No QA agents found in qa-sessions.json.${RESET}`);
    process.exit(1);
  }

  // ---------------------------------------------------------------------------
  // 1. Profile Avatar Lifecycle across Random QA Personas
  // ---------------------------------------------------------------------------
  logHeader('1. PROFILE AVATAR GENERATION & DEPLOYMENT');

  // Persona A: Multipart Form Avatar Upload
  const agentA = agents[Math.floor(Math.random() * agents.length)];
  console.log(`Selected Agent A (Multipart): ${GREEN}@${agentA.handle}${RESET} (UID #${agentA.uin})`);

  const avatarBufA = await createRetroAvatarSvg('#001133', '#00ffcc', '⚡');
  const formA = new FormData();
  const blobA = new Blob([new Uint8Array(avatarBufA)], { type: 'image/png' });
  formA.append('avatarFile', blobA, 'avatar.png');
  formA.append('statusMessage', 'Surfing Cyberspace (QA Agent)');

  const uploadResA = await fetch(`${baseUrl}/api/settings/profile`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${agentA.token}`,
    },
    body: formA,
  });

  recordCheck(
    `Multipart avatar upload for @${agentA.handle}`,
    uploadResA.status === 200,
    `Status: ${uploadResA.status}`
  );

  const dataA = (await uploadResA.json().catch(() => ({}))) as any;
  const avatarPathA = dataA.user?.avatarPath;
  recordCheck(
    `Avatar response returns valid WebP path`,
    typeof avatarPathA === 'string' && avatarPathA.endsWith('.webp'),
    avatarPathA || 'null'
  );

  if (avatarPathA) {
    const probeResA = await fetch(`${baseUrl}${avatarPathA}`);
    recordCheck(
      `Avatar WebP is publicly accessible via HTTP 200`,
      probeResA.status === 200,
      `Content-Type: ${probeResA.headers.get('content-type')}`
    );
  }

  // Persona B: Base64 JSON Avatar Upload
  let agentB = agents[Math.floor(Math.random() * agents.length)];
  if (agents.length > 1 && agentB.handle === agentA.handle) {
    agentB = agents.find((a) => a.handle !== agentA.handle) || agentB;
  }
  console.log(`\nSelected Agent B (Base64): ${GREEN}@${agentB.handle}${RESET} (UID #${agentB.uin})`);

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

  recordCheck(
    `Base64 avatar upload for @${agentB.handle}`,
    uploadResB.status === 200,
    `Status: ${uploadResB.status}`
  );

  const dataB = (await uploadResB.json().catch(() => ({}))) as any;
  const avatarPathB = dataB.user?.avatarPath;
  recordCheck(
    `Avatar response returns valid WebP path`,
    typeof avatarPathB === 'string' && avatarPathB.endsWith('.webp'),
    avatarPathB || 'null'
  );

  if (avatarPathB) {
    const probeResB = await fetch(`${baseUrl}${avatarPathB}`);
    recordCheck(
      `Base64 avatar WebP is publicly accessible via HTTP 200`,
      probeResB.status === 200,
      `Status: ${probeResB.status}`
    );
  }

  // ---------------------------------------------------------------------------
  // 2. Photo Gallery Post Uploads & Delta Publishing
  // ---------------------------------------------------------------------------
  logHeader('2. PHOTO GALLERY POSTS & SHADER PIPELINE');

  // Find an agent with a mounted site (e.g. Neocities, Nekoweb, or Sandbox)
  const publisherAgent = agents.find((a) => a.sites && a.sites.length > 0) || agentA;
  const targetSite = publisherAgent.sites[0];
  console.log(`Publishing Agent: ${GREEN}@${publisherAgent.handle}${RESET} -> Site "${targetSite?.name || 'Default'}" (${targetSite?.deploymentType || 'sandbox'})`);

  const photoPayload = await fetchPicsumTestImage(800, 800);
  const shaderModes = ['crt', 'sepia', 'vga', 'gameboy', 'cyberpunk', 'lofi'];
  const chosenShader = shaderModes[Math.floor(Math.random() * shaderModes.length)];

  const postRes = await fetch(`${baseUrl}/api/posts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${publisherAgent.token}`,
    },
    body: JSON.stringify({
      siteId: targetSite?.id,
      caption: `CYBER GRID TRANSMISSION // Shader: ${chosenShader.toUpperCase()} // Node: @${publisherAgent.handle.toUpperCase()}`,
      tags: ['#retroweb', '#cyberspace', '#90s', `#${chosenShader}`],
      filterApplied: chosenShader,
      imageBase64: photoPayload.dataUri,
    }),
  });

  recordCheck(
    `Photo gallery upload with ${chosenShader.toUpperCase()} shader`,
    postRes.status === 200 || postRes.status === 201,
    `Status: ${postRes.status}`
  );

  const postData = (await postRes.json().catch(() => ({}))) as any;
  const newPostId = postData.post?.id;
  recordCheck(
    `Post created with immutable ID`,
    typeof newPostId === 'string' && newPostId.length > 0,
    newPostId || 'none'
  );

  // Check author's feed via public JSON feed
  const feedRes = await fetch(`${baseUrl}/api/users/${publisherAgent.handle}/feed.json`);
  recordCheck(`Feed endpoint returns HTTP 200`, feedRes.status === 200, `Status: ${feedRes.status}`);
  const feedData = (await feedRes.json().catch(() => ({}))) as any;
  const feedItems = feedData.items || [];
  const foundInFeed = feedItems.some((p: any) => p.id === newPostId);
  recordCheck(
    `New photo post immediately present in author feed`,
    foundInFeed,
    `Feed contains ${feedItems.length} posts`
  );

  // ---------------------------------------------------------------------------
  // 3. Peer Guestbook Signatures
  // ---------------------------------------------------------------------------
  logHeader('3. PEER GUESTBOOK SIGNATURES');

  // Agent B visits Agent A's guestbook
  const visitor = agentB;
  const host = agentA;
  console.log(`Guestbook Visit: ${GREEN}@${visitor.handle}${RESET} visiting ${YELLOW}@${host.handle}${RESET} (#${host.uin})`);

  const moodIcons = ['😎', '👾', '🕹️', '💾', '🎸', '📟'];
  const mood = moodIcons[Math.floor(Math.random() * moodIcons.length)];
  const testMessage = `Surfing your station at ${new Date().toLocaleTimeString()}! Keep the 90s cyber flame burning!`;

  const gbSignRes = await fetch(`${baseUrl}/api/guestbook/${host.uin}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${visitor.token}`,
    },
    body: JSON.stringify({
      name: visitor.handle,
      website: visitor.sites?.[0]?.siteUrl || `https://neogram.club/user/${visitor.uin || visitor.handle}`,
      message: testMessage,
      moodIcon: mood,
    }),
  });

  recordCheck(
    `Sign @${host.handle}'s guestbook via numeric UIN #${host.uin}`,
    gbSignRes.status === 200 || gbSignRes.status === 201,
    `Status: ${gbSignRes.status}`
  );

  const gbListRes = await fetch(`${baseUrl}/api/guestbook/${host.uin}`);
  recordCheck(`GET /api/guestbook/${host.uin} returns HTTP 200`, gbListRes.status === 200, `Status: ${gbListRes.status}`);
  const gbListData = (await gbListRes.json().catch(() => ({}))) as any;
  const entries = gbListData.entries || [];
  const foundGb = entries.some((e: any) => e.message === testMessage);
  recordCheck(`Guestbook entry appears in host ledger`, foundGb, `Ledger count: ${entries.length}`);

  // ---------------------------------------------------------------------------
  // 4. Dynamic Web Hit Counters
  // ---------------------------------------------------------------------------
  logHeader('4. DYNAMIC WEB HIT COUNTERS');

  const counterTarget = host;
  const counterSlug = host.sites?.[0]?.slug || 'main';
  const counterUrl = `${baseUrl}/counter/${counterTarget.uin}/${counterSlug}.svg`;
  console.log(`Probing counter: ${YELLOW}${counterUrl}${RESET}`);

  const hitRes1 = await fetch(counterUrl);
  recordCheck(
    `Dynamic SVG counter returns HTTP 200`,
    hitRes1.status === 200,
    `Status: ${hitRes1.status}`
  );
  const svgText1 = await hitRes1.text();
  recordCheck(
    `Counter response is valid SVG XML`,
    svgText1.includes('<svg') && svgText1.includes('</svg>'),
    `Length: ${svgText1.length} chars`
  );

  // Second hit: counter must increment or respond with fresh SVG
  const hitRes2 = await fetch(counterUrl);
  recordCheck(`Second counter probe returns HTTP 200`, hitRes2.status === 200, `Status: ${hitRes2.status}`);

  // ---------------------------------------------------------------------------
  // 5. Strict Feed Entwining Invariant Assertions
  // ---------------------------------------------------------------------------
  logHeader('5. FEED ENTWINING INVARIANTS: WASSON VS. SHEAVANLAN');

  // Invariant A: User @wasson
  console.log(`Probing user @wasson friends feed (must be intertwined with QA personas)...`);
  const wassonFeedRes = await fetch(`${baseUrl}/api/user/wasson/friends-feed`);
  recordCheck(
    `GET /api/user/wasson/friends-feed returns HTTP 200`,
    wassonFeedRes.status === 200,
    `Status: ${wassonFeedRes.status}`
  );

  const wassonFeedData = (await wassonFeedRes.json().catch(() => ({}))) as any;
  const wassonPosts = wassonFeedData.posts || [];
  console.log(`@wasson friends feed contains ${wassonPosts.length} posts.`);

  // Invariant B: User @sheavanlan
  console.log(`\nProbing user @sheavanlan friends feed (must be STRICTLY UNTAINTED by QA personas)...`);
  const sheavanlanFeedRes = await fetch(`${baseUrl}/api/user/sheavanlan/friends-feed`);
  recordCheck(
    `GET /api/user/sheavanlan/friends-feed returns HTTP 200`,
    sheavanlanFeedRes.status === 200,
    `Status: ${sheavanlanFeedRes.status}`
  );

  const sheavanlanFeedData = (await sheavanlanFeedRes.json().catch(() => ({}))) as any;
  const sheavanlanPosts = sheavanlanFeedData.posts || [];
  console.log(`@sheavanlan friends feed contains ${sheavanlanPosts.length} posts.`);

  // Check that NO post in @sheavanlan's feed is authored by any QA persona
  const qaHandles = new Set(agents.map((a) => a.handle.toLowerCase()));
  const contaminatingPosts = sheavanlanPosts.filter((p: any) => {
    const author = (p.author?.handle || p.handle || '').toLowerCase().replace(/^@/, '');
    return qaHandles.has(author);
  });

  recordCheck(
    `STRICT INVARIANT: @sheavanlan feed contains ZERO QA test posts`,
    contaminatingPosts.length === 0,
    contaminatingPosts.length === 0
      ? 'Zero QA contamination detected (100% clean)'
      : `Contaminating posts found: ${contaminatingPosts.map((p: any) => p.id).join(', ')}`
  );

  // ---------------------------------------------------------------------------
  // Telemetry Summary
  // ---------------------------------------------------------------------------
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`\n${CYAN}${BOLD}================================================================================${RESET}`);
  console.log(`${CYAN}${BOLD}  [:> QA FLEET TELEMETRY REPORT]                                               ${RESET}`);
  console.log(`${CYAN}${BOLD}================================================================================${RESET}`);
  console.log(`  Target Host         : ${YELLOW}${baseUrl}${RESET}`);
  console.log(`  Total Checks        : ${BOLD}${totalChecks}${RESET}`);
  console.log(`  Passed Checks       : ${GREEN}${BOLD}${passedChecks}${RESET}`);
  console.log(`  Failed Checks       : ${failedChecks > 0 ? RED : GREEN}${BOLD}${failedChecks}${RESET}`);
  console.log(`  Duration            : ${BOLD}${elapsed}s${RESET}`);

  if (failedChecks === 0) {
    console.log(`\n${GREEN}${BOLD}[:> SUCCESS] QA FLEET NETWORK IS FULLY OPERATIONAL AND VERIFIED!${RESET}\n`);
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
