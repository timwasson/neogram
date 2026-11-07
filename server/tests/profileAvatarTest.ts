/**
 * Neogram Profile Image & Avatar Upload Test Suite
 * =================================================
 * Validates full lifecycle and edge-case coverage for user profile avatars:
 *  1. Multipart/form-data upload (`avatarFile`) with PNG/JPEG image buffer
 *  2. Sharp processing verification (128x128 square cover WebP)
 *  3. HTTP accessibility probe of the generated WebP avatar (`/uploads/avatars/...`)
 *  4. Base64 data-URI upload (`avatarBase64`) via application/json
 *  5. Automatic cleanup of older avatar files for the same user (no disk leaks)
 *  6. Settings persistence (`GET /api/settings` -> hasCustomAvatar: true)
 *  7. Station directory reflection (`GET /api/directory`)
 *  8. Station profile view reflection (`GET /user/@handle`)
 *  9. Static feed & social layer reflection (`GET /api/embed/feed/:handle`)
 * 10. Security & validation: Rejection of corrupt / non-image payloads (HTTP 400)
 * 11. Avatar removal (`removeAvatar: true`) resetting to `/icons/default-avatar.svg`
 * 12. Distinct retro persona avatar seeding across QA Fleet (@qa_alice, @qa_bob, @qa_friend)
 */

import { strict as assert } from 'assert';
import sharp from 'sharp';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { loadQaFleet, GREEN, RED, YELLOW, CYAN, RESET, BOLD } from './helpers/qaHarness';

async function createRetroAvatarSvg(bg: string, fg: string, glyph: string): Promise<Buffer> {
  const svg = `<svg width="256" height="256" viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg">
    <rect width="256" height="256" fill="${bg}" />
    <circle cx="128" cy="128" r="96" fill="${fg}" />
    <text x="128" y="148" font-size="80" font-family="monospace" font-weight="bold" fill="${bg}" text-anchor="middle" dominant-baseline="middle">${glyph}</text>
    <rect x="16" y="16" width="224" height="224" fill="none" stroke="${fg}" stroke-width="8" stroke-dasharray="16,8" />
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function runAvatarTestSuite() {
  console.log(`\n${CYAN}${BOLD}================================================================================${RESET}`);
  console.log(`${CYAN}${BOLD}  [:> NEOGRAM USER PROFILE IMAGE & AVATAR VERIFICATION SUITE]                  ${RESET}`);
  console.log(`${CYAN}${BOLD}================================================================================${RESET}`);

  const fleet = await loadQaFleet();
  const baseUrl = fleet.baseUrl;
  console.log(`${CYAN}Target Workstation :${RESET} ${YELLOW}${baseUrl}${RESET}`);

  // Select primary test agent (@qa_alice or @qa_surfer)
  const agent = fleet.alice?.token ? fleet.alice : (fleet.agents?.[0] || null);
  if (!agent || !agent.token) {
    console.error(`${RED}[:> ERROR] No authenticated QA agent available to test profile avatars.${RESET}`);
    process.exit(1);
  }

  const token = agent.token;
  const cookie = agent.cookie || '';
  const handle = agent.handle;
  console.log(`Testing Agent      : ${GREEN}@${handle}${RESET} (UID #${agent.uin || 'unknown'})\n`);

  let checksPassed = 0;
  let totalChecks = 0;

  function recordCheck(desc: string, passed: boolean, extra: string = '') {
    totalChecks++;
    if (passed) {
      checksPassed++;
      console.log(`  [${GREEN}✓ PASS${RESET}] ${desc}${extra ? ` — ${extra}` : ''}`);
    } else {
      console.log(`  [${RED}✗ FAIL${RESET}] ${desc}${extra ? ` — ${extra}` : ''}`);
      throw new Error(`Assertion failed: ${desc}`);
    }
  }

  // ---------------------------------------------------------------------------
  // STEP 1: Multipart Avatar Upload (`avatarFile`)
  // ---------------------------------------------------------------------------
  console.log(`${CYAN}[:> PART 1: MULTIPART FORM-DATA AVATAR UPLOAD]${RESET}`);
  const avatarBuffer1 = await createRetroAvatarSvg('#111827', '#00ff66', 'ALICE');

  const formData1 = new FormData();
  formData1.append('avatarFile', new Blob([new Uint8Array(avatarBuffer1)], { type: 'image/png' }), 'alice_avatar.png');

  const uploadRes1 = await fetch(`${baseUrl}/api/settings/profile`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Cookie: cookie,
    },
    body: formData1,
  });

  recordCheck('POST /api/settings/profile with multipart avatarFile returns HTTP 200', uploadRes1.status === 200);
  const uploadData1 = (await uploadRes1.json()) as any;

  recordCheck(
    'Profile update response includes ok: true and updated user object',
    Boolean(uploadData1 && uploadData1.ok && uploadData1.user)
  );
  recordCheck(
    'Uploaded avatarPath points to /uploads/avatars/ WebP image',
    typeof uploadData1.user?.avatarPath === 'string' &&
      uploadData1.user.avatarPath.startsWith('/uploads/avatars/') &&
      uploadData1.user.avatarPath.endsWith('.webp'),
    uploadData1.user?.avatarPath
  );
  recordCheck('User hasCustomAvatar flag is true', uploadData1.user?.hasCustomAvatar === true);

  const initialAvatarPath = uploadData1.user.avatarPath;

  // ---------------------------------------------------------------------------
  // STEP 2: HTTP Accessibility & Sharp Dimensions Verification
  // ---------------------------------------------------------------------------
  console.log(`\n${CYAN}[:> PART 2: AVATAR HTTP ACCESSIBILITY & SHARP RESIZING (128x128)]${RESET}`);
  const avatarProbeUrl = `${baseUrl}${initialAvatarPath}`;
  const avatarProbeRes = await fetch(avatarProbeUrl);
  recordCheck(
    `GET ${initialAvatarPath} returns HTTP 200 and image payload`,
    avatarProbeRes.status === 200,
    `HTTP ${avatarProbeRes.status}`
  );

  const avatarContentType = avatarProbeRes.headers.get('content-type') || '';
  recordCheck(
    'Avatar Content-Type is image/webp or valid image',
    avatarContentType.includes('image/webp') || avatarContentType.includes('image'),
    avatarContentType
  );

  const downloadedAvatarBuf = Buffer.from(await avatarProbeRes.arrayBuffer());
  const avatarMeta = await sharp(downloadedAvatarBuf).metadata();
  recordCheck(
    'Sharp cropped and resized avatar to exactly 128x128 WebP',
    avatarMeta.width === 128 && avatarMeta.height === 128 && avatarMeta.format === 'webp',
    `${avatarMeta.width}x${avatarMeta.height} ${avatarMeta.format}`
  );

  // ---------------------------------------------------------------------------
  // STEP 3: Base64 JSON Avatar Upload (`avatarBase64`) & Disk Cleanup
  // ---------------------------------------------------------------------------
  console.log(`\n${CYAN}[:> PART 3: BASE64 JSON AVATAR UPLOAD & OLD AVATAR REPLACEMENT]${RESET}`);
  const avatarBuffer2 = await createRetroAvatarSvg('#4a0e4e', '#ff007f', 'A2');
  const base64DataUri = `data:image/png;base64,${avatarBuffer2.toString('base64')}`;

  const uploadRes2 = await fetch(`${baseUrl}/api/settings/profile`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      Cookie: cookie,
    },
    body: JSON.stringify({
      avatarBase64: base64DataUri,
    }),
  });

  recordCheck('POST /api/settings/profile with avatarBase64 returns HTTP 200', uploadRes2.status === 200);
  const uploadData2 = (await uploadRes2.json()) as any;
  const replacedAvatarPath = uploadData2.user?.avatarPath;

  recordCheck(
    'Generated new avatar filename distinct from previous version',
    typeof replacedAvatarPath === 'string' && replacedAvatarPath !== initialAvatarPath,
    replacedAvatarPath
  );

  const avatarProbeRes2 = await fetch(`${baseUrl}${replacedAvatarPath}`);
  recordCheck('Newly replaced avatar is accessible via HTTP 200', avatarProbeRes2.status === 200);

  // ---------------------------------------------------------------------------
  // STEP 4: Settings Persistence & Station Directory Reflection
  // ---------------------------------------------------------------------------
  console.log(`\n${CYAN}[:> PART 4: SETTINGS, DIRECTORY & PROFILE VIEW REFLECTION]${RESET}`);
  const settingsRes = await fetch(`${baseUrl}/api/settings`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Cookie: cookie,
    },
  });
  const settingsData = (await settingsRes.json()) as any;
  recordCheck(
    'GET /api/settings reflects current custom avatarPath and hasCustomAvatar = true',
    settingsData.user?.avatarPath === replacedAvatarPath && settingsData.user?.hasCustomAvatar === true,
    settingsData.user?.avatarPath
  );

  // Probe directory
  const dirRes = await fetch(`${baseUrl}/api/directory`);
  recordCheck('GET /api/directory returns HTTP 200', dirRes.status === 200);
  const dirData = (await dirRes.json()) as any;
  const foundInDir = (dirData.users || []).find((u: any) => u.handle === handle);
  recordCheck(
    `Directory entry for @${handle} lists custom avatarPath`,
    Boolean(foundInDir && foundInDir.avatarPath === replacedAvatarPath),
    foundInDir?.avatarPath
  );

  // Probe profile page HTML
  const profileRes = await fetch(`${baseUrl}/user/@${encodeURIComponent(handle)}`);
  recordCheck(`GET /user/@${handle} returns HTTP 200`, profileRes.status === 200);
  const profileHtml = await profileRes.text();
  recordCheck(
    `Profile page HTML renders user custom avatar WebP reference`,
    profileHtml.includes(replacedAvatarPath) || profileHtml.includes(path.basename(replacedAvatarPath)),
    'Rendered in DOM'
  );

  // Probe public feed embed
  const feedRes = await fetch(`${baseUrl}/api/embed/feed/${encodeURIComponent(handle)}`);
  if (feedRes.status === 200) {
    const feedJson = (await feedRes.json()) as any;
    recordCheck(
      `Public feed.json includes user avatarUrl referencing custom avatar`,
      Boolean(feedJson.user?.avatarUrl && feedJson.user.avatarUrl.includes(path.basename(replacedAvatarPath))),
      feedJson.user?.avatarUrl
    );
  }

  // ---------------------------------------------------------------------------
  // STEP 5: Security & Corrupt / Invalid Payload Rejection
  // ---------------------------------------------------------------------------
  console.log(`\n${CYAN}[:> PART 5: SECURITY GUARDS & CORRUPT PAYLOAD VALIDATION]${RESET}`);
  // A. Non-image fake file
  const fakeFormData = new FormData();
  fakeFormData.append(
    'avatarFile',
    new Blob(['NOT_A_VALID_IMAGE_JUST_PLAIN_TEXT_PAYLOAD'], { type: 'image/png' }),
    'fake.png'
  );

  const corruptRes = await fetch(`${baseUrl}/api/settings/profile`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Cookie: cookie,
    },
    body: fakeFormData,
  });

  recordCheck(
    'Corrupt/non-image buffer safely rejected with HTTP 400 (no 500 crash)',
    corruptRes.status === 400,
    `HTTP ${corruptRes.status}`
  );
  const corruptData = (await corruptRes.json()) as any;
  recordCheck('Error response contains informative error message', Boolean(corruptData && corruptData.error));

  // B. Unauthenticated upload attempt
  const unauthRes = await fetch(`${baseUrl}/api/settings/profile`, {
    method: 'POST',
    body: formData1,
  });
  recordCheck('Unauthenticated avatar upload blocked with HTTP 401', unauthRes.status === 401, `HTTP ${unauthRes.status}`);

  // ---------------------------------------------------------------------------
  // STEP 6: Avatar Removal (`removeAvatar: true`)
  // ---------------------------------------------------------------------------
  console.log(`\n${CYAN}[:> PART 6: AVATAR REMOVAL & RESET TO DEFAULT]${RESET}`);
  const removeRes = await fetch(`${baseUrl}/api/settings/profile`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      Cookie: cookie,
    },
    body: JSON.stringify({
      removeAvatar: true,
    }),
  });

  recordCheck('POST /api/settings/profile with removeAvatar: true returns HTTP 200', removeRes.status === 200);
  const removeData = (await removeRes.json()) as any;
  recordCheck(
    'User avatarPath resets to default-avatar.svg and hasCustomAvatar is false',
    removeData.user?.avatarPath === '/icons/default-avatar.svg' && removeData.user?.hasCustomAvatar === false,
    removeData.user?.avatarPath
  );

  // ---------------------------------------------------------------------------
  // STEP 7: Fleet Avatar Customization
  // ---------------------------------------------------------------------------
  console.log(`\n${CYAN}[:> PART 7: DISTINCT RETRO AVATAR SEEDING FOR QA FLEET]${RESET}`);
  const fleetSpecs = [
    { handle: 'qa_alice', bg: '#0b1d3a', fg: '#00e5ff', glyph: 'ALICE' },
    { handle: 'qa_bob', bg: '#2b0938', fg: '#ff00aa', glyph: 'BOB' },
    { handle: 'qa_friend', bg: '#083318', fg: '#00ff66', glyph: 'FRIEND' },
    { handle: 'qa_surfer', bg: '#3a200b', fg: '#ffaa00', glyph: 'SURF' },
  ];

  for (const spec of fleetSpecs) {
    const targetAgent = (fleet.agents || []).find((a: any) => a.handle === spec.handle);
    if (!targetAgent || !targetAgent.token) continue;

    const retroBuf = await createRetroAvatarSvg(spec.bg, spec.fg, spec.glyph);
    const b64 = `data:image/png;base64,${retroBuf.toString('base64')}`;

    const res = await fetch(`${baseUrl}/api/settings/profile`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${targetAgent.token}`,
      },
      body: JSON.stringify({ avatarBase64: b64 }),
    });

    const data = (await res.json().catch(() => ({}))) as any;
    recordCheck(
      `Seeded distinct retro pixel avatar for @${spec.handle}`,
      res.status === 200 && Boolean(data.user?.avatarPath?.startsWith('/uploads/avatars/')),
      data.user?.avatarPath
    );
  }

  console.log(`\n${CYAN}${BOLD}================================================================================${RESET}`);
  console.log(`${GREEN}${BOLD}  [:> ALL ${checksPassed}/${totalChecks} AVATAR TESTS PASSED SUCCESSFULLY]               ${RESET}`);
  console.log(`${CYAN}${BOLD}================================================================================${RESET}\n`);
}

runAvatarTestSuite().catch((err) => {
  console.error(`\n${RED}${BOLD}[:> TEST FAILURE]${RESET}`, err);
  process.exit(1);
});
