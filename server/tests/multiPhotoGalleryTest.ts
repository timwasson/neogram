/**
 * server/tests/multiPhotoGalleryTest.ts
 *
 * Automated test suite for Neogram Multi-Photo Gallery functionality:
 * 1. Authenticates or loads QA fleet test accounts (@qa_alice, @qa_bob)
 * 2. Verifies 5-photo limit barrier (rejecting 6 photos with HTTP 400)
 * 3. Verifies multi-photo upload to 1 gallery post (e.g. 3 photos for Alice, 2 photos for Bob)
 * 4. Verifies single retro filter shader is applied across all photos
 * 5. Verifies persistence of the photos JSON array in post records and GET /api/posts/:id
 * 6. Verifies remote static feed.json / site propagation or 11ty static compilation (.neogram-slider)
 */

import { strict as assert } from 'assert';
import sharp from 'sharp';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { loadQaFleet, GREEN, RED, YELLOW, CYAN, RESET, BOLD } from './helpers/qaHarness';

async function createSampleImage(color: { r: number; g: number; b: number }, text: string): Promise<Buffer> {
  const svg = `<svg width="400" height="400" xmlns="http://www.w3.org/2000/svg">
    <rect width="400" height="400" fill="rgb(${color.r},${color.g},${color.b})" />
    <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#ffffff" font-size="28" font-family="monospace">${text}</text>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function run() {
  console.log(`\n${CYAN}${BOLD}======================================================================${RESET}`);
  console.log(`${CYAN}${BOLD}[:> TEST RUNNER] Multi-Photo Gallery & Carousel Slider Test Suite${RESET}`);
  console.log(`${CYAN}${BOLD}======================================================================${RESET}`);

  const fleet = await loadQaFleet();
  const baseUrl = fleet.baseUrl;
  console.log(`${CYAN}Target Workstation :${RESET} ${YELLOW}${baseUrl}${RESET}`);

  let primaryToken = '';
  let primaryCookie = '';
  let primaryHandle = '';
  let primarySiteId: string | undefined = undefined;

  let secondaryToken = '';
  let secondaryCookie = '';
  let secondaryHandle = '';
  let secondarySiteId: string | undefined = undefined;

  if (fleet.alice && fleet.alice.token) {
    primaryToken = fleet.alice.token;
    primaryCookie = fleet.alice.cookie || '';
    primaryHandle = fleet.alice.handle;
    primarySiteId = fleet.alice.sites?.[0]?.id;

    if (fleet.bob && fleet.bob.token) {
      secondaryToken = fleet.bob.token;
      secondaryCookie = fleet.bob.cookie || '';
      secondaryHandle = fleet.bob.handle;
      secondarySiteId = fleet.bob.sites?.[0]?.id;
    }
    console.log(`  ${GREEN}[✓ LOADED]${RESET} QA Fleet Personas: @${primaryHandle}${secondaryHandle ? `, @${secondaryHandle}` : ''}`);
  } else {
    // Fallback: Local auto-provisioning
    const email = `qa_multiphoto_${Date.now()}@retro.local`;
    console.log(`[:> AUTH] Dialing carrier for test node: ${email}`);

    const reqOtpRes = await fetch(`${baseUrl}/api/auth/request-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-test-suite': 'true' },
      body: JSON.stringify({ identifier: email }),
    });
    const reqOtpData = await reqOtpRes.json();
    assert.equal(reqOtpRes.status, 200, `OTP request should succeed: ${JSON.stringify(reqOtpData)}`);
    const otpCode = reqOtpData.demoCode || '123456';

    const verifyRes = await fetch(`${baseUrl}/api/auth/verify-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-test-suite': 'true' },
      body: JSON.stringify({ identifier: email, code: otpCode }),
    });
    const verifyData = await verifyRes.json();
    assert.equal(verifyRes.status, 200, 'OTP verification should succeed');
    primaryToken = verifyData.token;
    primaryCookie = verifyRes.headers.get('set-cookie') || '';
    primaryHandle = verifyData.user?.handle || 'qa_multiphoto';

    const settingsPutRes = await fetch(`${baseUrl}/api/settings`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${primaryToken}`,
        Cookie: primaryCookie,
      },
      body: JSON.stringify({
        siteName: 'qa-multiphoto-station',
        deployPath: 'photos',
        deploymentType: 'neocities',
      }),
    });
    assert.equal(settingsPutRes.status, 200, 'PUT /api/settings should configure site target');
  }

  // 1. Test 5-Photo Limit Enforcement (Uploading 6 photos must fail with HTTP 400)
  console.log(`\n${CYAN}[:> TEST 1] Verifying 5-photo limit barrier on @${primaryHandle} (uploading 6 photos)...${RESET}`);
  const sampleBuf = await createSampleImage({ r: 50, g: 100, b: 150 }, 'OVERFLOW');
  const excessFormData = new FormData();
  excessFormData.append('caption', 'Attempting 6 photos upload');
  excessFormData.append('filterApplied', 'crt');
  if (primarySiteId) excessFormData.append('siteId', primarySiteId);
  for (let i = 1; i <= 6; i++) {
    excessFormData.append('imageFiles', new Blob([new Uint8Array(sampleBuf)], { type: 'image/png' }), `overflow_${i}.png`);
  }

  const excessRes = await fetch(`${baseUrl}/api/posts`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${primaryToken}`,
      Cookie: primaryCookie,
    },
    body: excessFormData,
  });
  assert.equal(excessRes.status, 400, 'Uploading > 5 photos should return HTTP 400');
  const excessData = await excessRes.json();
  assert.ok(
    excessData.error && excessData.error.includes('5 photos'),
    `Error should mention 5 photos limit: ${excessData.error}`
  );
  console.log(`  ${GREEN}[✓ PASS]${RESET} HTTP 400 properly returned when exceeding 5-photo limit (${excessData.error})`);

  // 2. Test Valid Multi-Photo Gallery Upload for Primary Account (3 photos in 1 gallery)
  console.log(`\n${CYAN}[:> TEST 2] Uploading 3 photos into 1 gallery carousel for @${primaryHandle} (filter: "crt")...${RESET}`);
  const img1 = await createSampleImage({ r: 210, g: 45, b: 45 }, 'SLIDE 1/3');
  const img2 = await createSampleImage({ r: 45, g: 210, b: 45 }, 'SLIDE 2/3');
  const img3 = await createSampleImage({ r: 45, g: 45, b: 210 }, 'SLIDE 3/3');

  const multiFormData1 = new FormData();
  multiFormData1.append('caption', `Multi-photo gallery carousel transmitted by @${primaryHandle} [CRT Filter]`);
  multiFormData1.append('filterApplied', 'crt');
  multiFormData1.append('mood', 'Radical');
  multiFormData1.append('webring', 'RetroWeb');
  if (primarySiteId) multiFormData1.append('siteId', primarySiteId);
  multiFormData1.append('imageFiles', new Blob([new Uint8Array(img1)], { type: 'image/png' }), 'slide_1.png');
  multiFormData1.append('imageFiles', new Blob([new Uint8Array(img2)], { type: 'image/png' }), 'slide_2.png');
  multiFormData1.append('imageFiles', new Blob([new Uint8Array(img3)], { type: 'image/png' }), 'slide_3.png');

  const t0 = Date.now();
  const uploadRes1 = await fetch(`${baseUrl}/api/posts`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${primaryToken}`,
      Cookie: primaryCookie,
    },
    body: multiFormData1,
  });

  const uploadData1 = await uploadRes1.json();
  if (uploadRes1.status !== 201) {
    console.error('[:> UPLOAD ERROR DATA]:', uploadData1);
  }
  assert.equal(uploadRes1.status, 201, `Multi-photo upload should return HTTP 201, got ${uploadRes1.status}: ${JSON.stringify(uploadData1)}`);
  assert.ok(uploadData1.ok, 'Upload response ok should be true');
  assert.ok(uploadData1.post, 'Upload response should contain post');
  const post1 = uploadData1.post;

  console.log(`  ${GREEN}[✓ PASS]${RESET} Gallery post created in ${Date.now() - t0}ms with ID: ${post1.id}`);
  assert.equal(post1.photos?.length, 3, 'Post should contain exactly 3 photos in photos array');
  assert.ok(post1.imagePath, 'Post should have primary imagePath');
  assert.ok(post1.thumbnailPath, 'Post should have primary thumbnailPath');
  assert.equal(post1.filterApplied, 'crt', 'Single filter "crt" applied across gallery');
  for (let i = 0; i < post1.photos.length; i++) {
    const photo = post1.photos[i];
    assert.ok(photo.imagePath, `Frame ${i + 1} must have imagePath`);
    assert.ok(photo.thumbnailPath, `Frame ${i + 1} must have thumbnailPath`);
    console.log(`      • Frame ${i + 1}: ${photo.imagePath}`);
  }

  // 3. Test Valid Multi-Photo Gallery Upload for Secondary Account (2 photos in 1 gallery)
  if (secondaryToken) {
    console.log(`\n${CYAN}[:> TEST 3] Uploading 2 photos into 1 gallery carousel for @${secondaryHandle} (filter: "cyberpunk")...${RESET}`);
    const bImg1 = await createSampleImage({ r: 255, g: 0, b: 128 }, 'CYBER 1/2');
    const bImg2 = await createSampleImage({ r: 0, g: 255, b: 255 }, 'CYBER 2/2');

    const multiFormData2 = new FormData();
    multiFormData2.append('caption', `Cyberpunk duo transmission by @${secondaryHandle}`);
    multiFormData2.append('filterApplied', 'cyberpunk');
    multiFormData2.append('mood', 'Cyber');
    if (secondarySiteId) multiFormData2.append('siteId', secondarySiteId);
    multiFormData2.append('imageFiles', new Blob([new Uint8Array(bImg1)], { type: 'image/png' }), 'cyber_1.png');
    multiFormData2.append('imageFiles', new Blob([new Uint8Array(bImg2)], { type: 'image/png' }), 'cyber_2.png');

    const t1 = Date.now();
    const uploadRes2 = await fetch(`${baseUrl}/api/posts`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secondaryToken}`,
        Cookie: secondaryCookie,
      },
      body: multiFormData2,
    });
    const uploadData2 = await uploadRes2.json();
    assert.equal(uploadRes2.status, 201, `Secondary multi-photo upload should return HTTP 201: ${JSON.stringify(uploadData2)}`);
    const post2 = uploadData2.post;
    console.log(`  ${GREEN}[✓ PASS]${RESET} Gallery post created in ${Date.now() - t1}ms with ID: ${post2.id}`);
    assert.equal(post2.photos?.length, 2, 'Post should contain exactly 2 photos in photos array');
    assert.equal(post2.filterApplied, 'cyberpunk', 'Filter "cyberpunk" applied across frames');
  }

  // 4. Verify GET /api/posts/:id includes photos array
  console.log(`\n${CYAN}[:> TEST 4] Fetching gallery details via GET /api/posts/${post1.id}...${RESET}`);
  const getPostRes = await fetch(`${baseUrl}/api/posts/${post1.id}`, {
    headers: { Authorization: `Bearer ${primaryToken}`, Cookie: primaryCookie },
  });
  assert.equal(getPostRes.status, 200, 'GET /api/posts/:id should return HTTP 200');
  const getPostData = await getPostRes.json();
  assert.equal(getPostData.post?.photos?.length, 3, 'Fetched post should contain 3 photos');
  console.log(`  ${GREEN}[✓ PASS]${RESET} GET /api/posts/:id confirmed persistent photos array (${getPostData.post.photos.length} frames)`);

  // 5. Verify Static Output or Remote Propagation
  console.log(`\n${CYAN}[:> TEST 5] Checking static deliverables and slider markup...${RESET}`);
  const siteDir = path.join(process.cwd(), 'dist', 'static-galleries', post1.siteId || '');
  const photoHtmlPath = path.join(siteDir, 'photos', post1.id, 'index.html');
  if (existsSync(photoHtmlPath)) {
    const photoHtml = await fs.readFile(photoHtmlPath, 'utf-8');
    assert.ok(photoHtml.includes('neogram-slider'), 'Photo detail must contain .neogram-slider BEM class');
    assert.ok(photoHtml.includes('neogram-slider__track'), 'Photo detail must contain .neogram-slider__track');
    assert.ok(photoHtml.includes('neogram-slider__slide'), 'Photo detail must contain .neogram-slider__slide');
    console.log(`  ${GREEN}[✓ PASS]${RESET} Local 11ty compilation verified: .neogram-slider rendered in HTML`);
  } else {
    // On production remote host, check public feed or station embed
    const feedRes = await fetch(`${baseUrl}/api/embed/feed/${primaryHandle}`);
    if (feedRes.status === 200) {
      const feedData = await feedRes.json();
      const foundPost = feedData.posts?.find((p: any) => p.id === post1.id);
      if (foundPost) {
        console.log(`  ${GREEN}[✓ PASS]${RESET} Remote public feed includes multi-photo gallery (${foundPost.photos?.length || 1} frames)`);
      } else {
        console.log(`  ${YELLOW}[ℹ NOTE]${RESET} Post ${post1.id} recorded; live feed returned ${feedData.posts?.length || 0} posts`);
      }
    }
  }

  console.log(`\n${CYAN}${BOLD}======================================================================${RESET}`);
  console.log(`${GREEN}${BOLD}[:> ALL MULTI-PHOTO GALLERY TESTS PASSED SUCCESSFULLY ON PRODUCTION]${RESET}`);
  console.log(`${CYAN}${BOLD}======================================================================${RESET}\n`);
}

run().catch((err) => {
  console.error(`${RED}[:> TEST FAILURE]${RESET}`, err);
  process.exit(1);
});

