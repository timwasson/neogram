/**
 * Neogram Profile Image & Avatar Upload Test Suite
 * =================================================
 * Validates full lifecycle and edge-case coverage for user profile avatars:
 *  1. Multipart/form-data upload (`avatarFile`) using Pravatar (`fetchPravatarTestImage`)
 *  2. Remote static host deployment verification (`https://.../avatar.webp`) & Sharp 128x128 WebP check
 *  3. Base64 data-URI upload (`avatarBase64`) via application/json
 *  4. Settings persistence (`GET /api/settings` -> `avatarPath` & `hasCustomAvatar`)
 *  5. Station directory reflection (`GET /api/directory`)
 *  6. Station profile view reflection (`GET /user/@handle`)
 *  7. Security & validation: Rejection of corrupt / non-image payloads (HTTP 400)
 *  8. Avatar removal (`removeAvatar: true`) resetting to colored default avatar (`/icons/default-avatar*.svg`)
 *  9. Headless / non-remote user invariant (`@qa_surfer` always receives default profile image)
 * 10. Pravatar seeding across remote-publishing QA Fleet (`@qa_alice`, `@qa_bob`, `@qa_friend`)
 */

import sharp from 'sharp';
import path from 'path';
import {
  loadQaFleet,
  fetchPravatarTestImage,
  GREEN,
  RED,
  YELLOW,
  CYAN,
  RESET,
  BOLD,
} from './helpers/qaHarness';

async function runAvatarTestSuite() {
  console.log(`\n${CYAN}${BOLD}================================================================================${RESET}`);
  console.log(`${CYAN}${BOLD}  [:> NEOGRAM USER PROFILE IMAGE & AVATAR VERIFICATION SUITE]                  ${RESET}`);
  console.log(`${CYAN}${BOLD}================================================================================${RESET}`);

  const fleet = await loadQaFleet();
  const baseUrl = fleet.baseUrl;
  console.log(`${CYAN}Target Workstation :${RESET} ${YELLOW}${baseUrl}${RESET}`);

  // Select primary remote-publishing test agent (@qa_alice)
  const agent = fleet.alice?.token ? fleet.alice : (fleet.agents?.[0] || null);
  if (!agent || !agent.token) {
    console.error(`${RED}[:> ERROR] No authenticated QA agent available to test profile avatars.${RESET}`);
    process.exit(1);
  }

  const token = agent.token;
  const cookie = agent.cookie || '';
  const handle = agent.handle;
  const hasRemoteHost = Boolean(
    agent.sites?.some((s) => s.hasApiKey && s.deploymentType && s.deploymentType !== 'none')
  );
  console.log(`Testing Agent      : ${GREEN}@${handle}${RESET} (UID #${agent.uin || 'unknown'}, remoteHost=${hasRemoteHost})\n`);

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
  // STEP 1: Multipart Avatar Upload (`avatarFile`) via Pravatar
  // ---------------------------------------------------------------------------
  console.log(`${CYAN}[:> PART 1: MULTIPART FORM-DATA AVATAR UPLOAD (PRAVATAR)]${RESET}`);
  const pravatar1 = await fetchPravatarTestImage(`${handle}_1_${Date.now()}`, 256);

  const formData1 = new FormData();
  formData1.append('avatarFile', new Blob([new Uint8Array(pravatar1.buffer)], { type: pravatar1.mimeType }), 'alice_pravatar.jpg');

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

  const initialAvatarPath = uploadData1.user?.avatarPath || '';

  if (hasRemoteHost) {
    recordCheck(
      'Uploaded avatarPath points to remote static host WebP URL (never stored on Neogram)',
      typeof initialAvatarPath === 'string' &&
        initialAvatarPath.startsWith('http') &&
        initialAvatarPath.includes('avatar.webp'),
      initialAvatarPath
    );
    recordCheck('User hasCustomAvatar flag is true', uploadData1.user?.hasCustomAvatar === true);

    // ---------------------------------------------------------------------------
    // STEP 2: HTTP Accessibility & Sharp Dimensions Verification on Static Host
    // ---------------------------------------------------------------------------
    console.log(`\n${CYAN}[:> PART 2: STATIC HOST AVATAR HTTP ACCESSIBILITY & SHARP RESIZING (128x128)]${RESET}`);
    const avatarProbeRes = await fetch(initialAvatarPath);
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
      'Sharp cropped and resized avatar to exactly 128x128 WebP on static host',
      avatarMeta.width === 128 && avatarMeta.height === 128 && avatarMeta.format === 'webp',
      `${avatarMeta.width}x${avatarMeta.height} ${avatarMeta.format}`
    );
  } else {
    recordCheck(
      'Unconfigured local agent falls back to colored default avatar SVG',
      initialAvatarPath.startsWith('/icons/default-avatar') && uploadData1.user?.hasCustomAvatar === false,
      initialAvatarPath
    );
  }

  // ---------------------------------------------------------------------------
  // STEP 3: Base64 JSON Avatar Upload (`avatarBase64`) via Pravatar
  // ---------------------------------------------------------------------------
  console.log(`\n${CYAN}[:> PART 3: BASE64 JSON AVATAR UPLOAD (PRAVATAR)]${RESET}`);
  const pravatar2 = await fetchPravatarTestImage(`${handle}_2_${Date.now()}`, 256);

  const uploadRes2 = await fetch(`${baseUrl}/api/settings/profile`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      Cookie: cookie,
    },
    body: JSON.stringify({
      avatarBase64: pravatar2.dataUri,
    }),
  });

  recordCheck('POST /api/settings/profile with avatarBase64 returns HTTP 200', uploadRes2.status === 200);
  const uploadData2 = (await uploadRes2.json()) as any;
  const replacedAvatarPath = uploadData2.user?.avatarPath || '';

  if (hasRemoteHost) {
    recordCheck(
      'Generated new cache-busted static avatar URL distinct from previous version',
      typeof replacedAvatarPath === 'string' && replacedAvatarPath !== initialAvatarPath && replacedAvatarPath.startsWith('http'),
      replacedAvatarPath
    );

    const avatarProbeRes2 = await fetch(replacedAvatarPath);
    recordCheck('Newly replaced static avatar is accessible via HTTP 200', avatarProbeRes2.status === 200);
  }

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
  const currentSettings = settingsData.settings || settingsData.user || {};
  recordCheck(
    'GET /api/settings reflects current avatarPath and hasCustomAvatar state',
    currentSettings.avatarPath === replacedAvatarPath && currentSettings.hasCustomAvatar === hasRemoteHost,
    currentSettings.avatarPath
  );

  // Probe directory
  const dirRes = await fetch(`${baseUrl}/api/directory`);
  recordCheck('GET /api/directory returns HTTP 200', dirRes.status === 200);
  const dirData = (await dirRes.json()) as any;
  const allDirUsers = [
    ...(dirData.users || []),
    ...(dirData.categories?.active || []),
    ...(dirData.categories?.away || []),
    ...(dirData.categories?.inactive || []),
  ];
  const foundInDir = allDirUsers.find((u: any) => u.handle === handle);
  recordCheck(
    `Directory entry for @${handle} lists expected avatarPath (or excluded QA persona)`,
    foundInDir ? foundInDir.avatarPath === replacedAvatarPath : handle.startsWith('qa_'),
    foundInDir?.avatarPath || 'Excluded QA persona from public directory'
  );

  // Probe profile page HTML
  const profileRes = await fetch(`${baseUrl}/user/@${encodeURIComponent(handle)}`);
  recordCheck(`GET /user/@${handle} returns HTTP 200`, profileRes.status === 200);
  const profileHtml = await profileRes.text();
  recordCheck(
    `Profile page HTML renders user avatar reference`,
    profileHtml.includes(replacedAvatarPath) || profileHtml.includes(path.basename(replacedAvatarPath.split('?')[0])),
    'Rendered in DOM'
  );

  // ---------------------------------------------------------------------------
  // STEP 5: Security & Corrupt / Invalid Payload Rejection
  // ---------------------------------------------------------------------------
  console.log(`\n${CYAN}[:> PART 5: SECURITY GUARDS & CORRUPT PAYLOAD VALIDATION]${RESET}`);
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
    'User avatarPath resets to colored default-avatar SVG and hasCustomAvatar is false',
    Boolean(removeData.user?.avatarPath?.startsWith('/icons/default-avatar')) && removeData.user?.hasCustomAvatar === false,
    removeData.user?.avatarPath
  );

  // ---------------------------------------------------------------------------
  // STEP 7: Headless User Invariant & Pravatar Fleet Seeding
  // ---------------------------------------------------------------------------
  console.log(`\n${CYAN}[:> PART 7: HEADLESS DEFAULT INVARIANT & PRAVATAR QA FLEET SEEDING]${RESET}`);

  // Verify @qa_surfer (headless / no remote site) always receives default avatar
  if (fleet.surfer?.token) {
    const surferPravatar = await fetchPravatarTestImage('qa_surfer', 256);
    const surferRes = await fetch(`${baseUrl}/api/settings/profile`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${fleet.surfer.token}`,
      },
      body: JSON.stringify({ avatarBase64: surferPravatar.dataUri }),
    });
    const surferData = (await surferRes.json().catch(() => ({}))) as any;
    recordCheck(
      'Headless / non-remote user @qa_surfer always receives colored default avatar (never custom WebP)',
      surferRes.status === 200 &&
        Boolean(surferData.user?.avatarPath?.startsWith('/icons/default-avatar')) &&
        surferData.user?.hasCustomAvatar === false,
      surferData.user?.avatarPath
    );
  }

  // Seed Pravatar avatars for remote-publishing QA accounts
  const remoteHandles = ['qa_alice', 'qa_bob', 'qa_friend'];
  for (const h of remoteHandles) {
    const targetAgent = (fleet.agents || []).find((a: any) => a.handle === h);
    if (!targetAgent || !targetAgent.token) continue;
    const agentHasRemote = Boolean(
      targetAgent.sites?.some((s: any) => s.hasApiKey && s.deploymentType && s.deploymentType !== 'none')
    );
    if (!agentHasRemote) continue;

    const pravatar = await fetchPravatarTestImage(`${h}_${Date.now()}`, 256);
    const res = await fetch(`${baseUrl}/api/settings/profile`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${targetAgent.token}`,
      },
      body: JSON.stringify({ avatarBase64: pravatar.dataUri }),
    });

    const data = (await res.json().catch(() => ({}))) as any;
    recordCheck(
      `Seeded Pravatar static host avatar for @${h}`,
      res.status === 200 && Boolean(data.user?.avatarPath?.startsWith('http') && data.user?.avatarPath?.includes('avatar.webp')),
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
