/**
 * server/tests/multiPhotoGalleryTest.ts
 *
 * Automated test suite for Neogram Multi-Photo Gallery functionality:
 * 1. Verifies multi-photo upload to 1 gallery post (e.g. 3 photos)
 * 2. Verifies single retro filter shader is applied across all photos
 * 3. Verifies strict 5-photo limit (rejecting 6 photos with HTTP 400)
 * 4. Verifies database persistence of the photos JSON array
 * 5. Verifies 11ty static compilation renders the Instagram-style pure CSS slider (.neogram-slider)
 */

import { strict as assert } from 'assert';
import sharp from 'sharp';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:4000';

async function createSampleImage(color: { r: number; g: number; b: number }, text: string): Promise<Buffer> {
  const svg = `<svg width="400" height="400" xmlns="http://www.w3.org/2000/svg">
    <rect width="400" height="400" fill="rgb(${color.r},${color.g},${color.b})" />
    <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#ffffff" font-size="28" font-family="monospace">${text}</text>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function run() {
  console.log('======================================================================');
  console.log('[:> TEST RUNNER] Starting Multi-Photo Gallery & CSS Slider Test Suite');
  console.log('======================================================================');

  // 1. Authenticate a test user
  const email = `qa_multiphoto_${Date.now()}@retro.local`;
  console.log(`[:> AUTH] Dialing carrier for test node: ${email}`);

  const reqOtpRes = await fetch(`${APP_URL}/api/auth/request-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-test-suite': 'true' },
    body: JSON.stringify({ identifier: email }),
  });
  const reqOtpData = await reqOtpRes.json();
  assert.equal(reqOtpRes.status, 200, `OTP request should succeed: ${JSON.stringify(reqOtpData)}`);
  const otpCode = reqOtpData.demoCode || '123456';

  const verifyRes = await fetch(`${APP_URL}/api/auth/verify-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-test-suite': 'true' },
    body: JSON.stringify({ identifier: email, code: otpCode }),
  });
  const verifyData = await verifyRes.json();
  assert.equal(verifyRes.status, 200, 'OTP verification should succeed');
  const token = verifyData.token;
  const cookie = verifyRes.headers.get('set-cookie') || '';

  console.log('  [✓ PASS] Test user authenticated with JWT & session cookie');

  // Mount and configure default site target for test user
  const settingsRes = await fetch(`${APP_URL}/api/settings`, {
    headers: { Authorization: `Bearer ${token}`, Cookie: cookie },
  });
  assert.equal(settingsRes.status, 200, 'GET /api/settings should succeed and mount default site');

  const settingsPutRes = await fetch(`${APP_URL}/api/settings`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      Cookie: cookie,
    },
    body: JSON.stringify({
      siteName: 'qa-multiphoto-station',
      deployPath: 'photos',
      deploymentType: 'neocities',
    }),
  });
  assert.equal(settingsPutRes.status, 200, 'PUT /api/settings should configure site target');

  // 2. Test 5-Photo Limit Enforcement (Uploading 6 photos must fail with HTTP 400)
  console.log('\n[:> TEST] Verifying 5-photo limit barrier (uploading 6 photos)...');
  const sampleBuf = await createSampleImage({ r: 50, g: 100, b: 150 }, 'PHOTO');
  const excessFormData = new FormData();
  excessFormData.append('caption', 'Attempting 6 photos upload');
  excessFormData.append('filterApplied', 'crt');
  for (let i = 1; i <= 6; i++) {
    excessFormData.append('imageFiles', new Blob([new Uint8Array(sampleBuf)], { type: 'image/png' }), `photo_${i}.png`);
  }

  const excessRes = await fetch(`${APP_URL}/api/posts`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Cookie: cookie,
    },
    body: excessFormData,
  });
  assert.equal(excessRes.status, 400, 'Uploading > 5 photos should return HTTP 400');
  const excessData = await excessRes.json();
  assert.ok(
    excessData.error && excessData.error.includes('5 photos'),
    `Error should mention 5 photos limit: ${excessData.error}`
  );
  console.log('  [✓ PASS] HTTP 400 properly returned when exceeding 5-photo limit');

  // 3. Test Valid Multi-Photo Upload (3 photos in 1 gallery)
  console.log('\n[:> TEST] Uploading 3 photos into 1 gallery with single "crt" filter...');
  const img1 = await createSampleImage({ r: 200, g: 40, b: 40 }, 'FRAME 1');
  const img2 = await createSampleImage({ r: 40, g: 200, b: 40 }, 'FRAME 2');
  const img3 = await createSampleImage({ r: 40, g: 40, b: 200 }, 'FRAME 3');

  const multiFormData = new FormData();
  multiFormData.append('caption', 'Multi-photo sunset in cyberspace');
  multiFormData.append('filterApplied', 'crt');
  multiFormData.append('imageFiles', new Blob([new Uint8Array(img1)], { type: 'image/png' }), 'slide_1.png');
  multiFormData.append('imageFiles', new Blob([new Uint8Array(img2)], { type: 'image/png' }), 'slide_2.png');
  multiFormData.append('imageFiles', new Blob([new Uint8Array(img3)], { type: 'image/png' }), 'slide_3.png');

  const uploadRes = await fetch(`${APP_URL}/api/posts`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Cookie: cookie,
    },
    body: multiFormData,
  });

  const uploadData = await uploadRes.json();
  if (uploadRes.status !== 201) {
    console.error('[:> UPLOAD ERROR DATA]:', uploadData);
  }
  assert.equal(uploadRes.status, 201, `Multi-photo upload should return HTTP 201, got ${uploadRes.status}: ${JSON.stringify(uploadData)}`);
  assert.ok(uploadData.ok, 'Upload response ok should be true');
  assert.ok(uploadData.post, 'Upload response should contain post');
  const createdPost = uploadData.post;

  console.log(`  [✓ PASS] Multi-photo post created with ID: ${createdPost.id}`);
  assert.equal(createdPost.photos.length, 3, 'Post should contain exactly 3 photos in photos array');
  assert.ok(createdPost.imagePath, 'Post should have primary imagePath');
  assert.ok(createdPost.thumbnailPath, 'Post should have primary thumbnailPath');
  assert.equal(createdPost.filterApplied, 'crt', 'Single filter "crt" applied across gallery');

  // 4. Verify GET /api/posts and GET /api/posts/:id include photos array
  console.log('\n[:> TEST] Fetching post details via GET /api/posts/:id...');
  const getPostRes = await fetch(`${APP_URL}/api/posts/${createdPost.id}`, {
    headers: { Authorization: `Bearer ${token}`, Cookie: cookie },
  });
  assert.equal(getPostRes.status, 200, 'GET /api/posts/:id should return HTTP 200');
  const getPostData = await getPostRes.json();
  assert.equal(getPostData.post.photos.length, 3, 'Fetched post should contain 3 photos');

  // 5. Verify 11ty Static Site Generation for Multi-Photo Slider
  console.log('\n[:> TEST] Verifying 11ty static output contains pure CSS slider...');
  const siteDir = path.join(process.cwd(), 'dist', 'static-galleries', createdPost.siteId);
  const photoHtmlPath = path.join(siteDir, 'photos', createdPost.id, 'index.html');
  const indexHtmlPath = path.join(siteDir, 'index.html');

  assert.ok(existsSync(photoHtmlPath), `Photo detail HTML must exist at ${photoHtmlPath}`);
  const photoHtml = await fs.readFile(photoHtmlPath, 'utf-8');

  // Assertions for raw CSS Instagram-style slider
  assert.ok(photoHtml.includes('neogram-slider'), 'Photo detail must contain .neogram-slider BEM class');
  assert.ok(photoHtml.includes('neogram-slider__track'), 'Photo detail must contain .neogram-slider__track scroll container');
  assert.ok(photoHtml.includes('neogram-slider__slide'), 'Photo detail must contain .neogram-slider__slide');
  assert.ok(photoHtml.includes('neogram-slider__nav'), 'Photo detail must contain .neogram-slider__nav dots');
  assert.ok(photoHtml.includes('3 PHOTOS'), 'Photo detail badge must display 3 PHOTOS');

  // Assertions for Gallery Grid index.html card slider
  assert.ok(existsSync(indexHtmlPath), `Gallery index HTML must exist at ${indexHtmlPath}`);
  const indexHtml = await fs.readFile(indexHtmlPath, 'utf-8');
  assert.ok(indexHtml.includes('neogram-slider--card'), 'Gallery index card must contain .neogram-slider--card');
  assert.ok(indexHtml.includes('⧉ 3'), 'Gallery index card must display ⧉ 3 indicator badge');

  console.log('  [✓ PASS] 11ty HTML static templates compiled Instagram-style CSS slider (.neogram-slider)');
  console.log('  [✓ PASS] Gallery grid card contains .neogram-slider--card and multi-photo indicator');

  console.log('\n======================================================================');
  console.log('[:> ALL MULTI-PHOTO GALLERY TESTS PASSED SUCCESSFULLY]');
  console.log('======================================================================\n');
}

run().catch((err) => {
  console.error('[:> TEST FAILURE]', err);
  process.exit(1);
});
