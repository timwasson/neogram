/**
 * Security regression suite (hermetic: temp sandbox + in-memory DB, no network, no real secrets).
 * Run: npm run test:security
 */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import http from 'http';
import { AddressInfo } from 'net';
import { bootSandbox, login, Sandbox, Session, ADMIN_EMAIL } from './helpers/sandbox';

let sb: Sandbox;
let alice: Session;
let bob: Session;
let q: (text: string, params?: any[]) => Promise<any>;

const JSON_H = { 'Content-Type': 'application/json', 'x-test-suite': 'true' };
const bearer = (t: string) => ({ ...JSON_H, Authorization: `Bearer ${t}` });

before(async () => {
  sb = await bootSandbox();
  q = (await import('../db')).query;
  alice = await login(sb.base, 'alice@test.local');
  bob = await login(sb.base, 'bob@test.local');
});

after(async () => {
  await sb.close();
});

describe('OTP authentication', () => {
  test('request-otp does NOT create an account (registration only after verification)', async () => {
    const email = 'ghost@test.local';
    const r = await fetch(`${sb.base}/api/auth/request-otp`, { method: 'POST', headers: JSON_H, body: JSON.stringify({ identifier: email }) });
    assert.equal(r.status, 200);
    const body: any = await r.json();
    assert.ok(body.ok);
    assert.equal(body.uin, undefined, 'must not leak/issue a UIN before verification');
    const users = await q('SELECT 1 FROM users WHERE email = $1', [email]);
    assert.equal(users.rows.length, 0);
  });

  test('only a keyed hash of the code is stored (never plaintext)', async () => {
    const email = 'hashcheck@test.local';
    const r = await fetch(`${sb.base}/api/auth/request-otp`, { method: 'POST', headers: JSON_H, body: JSON.stringify({ identifier: email }) });
    const { demoCode }: any = await r.json();
    const row = (await q('SELECT code_hash FROM otp_challenges WHERE identifier = $1', [email])).rows[0];
    assert.ok(row);
    assert.notEqual(row.code_hash, demoCode);
    assert.match(row.code_hash, /^[0-9a-f]{64}$/);
  });

  test('demoCode is withheld unless ALLOW_DEMO_OTP is on', async () => {
    const { config } = await import('../config');
    const original = config.allowDemoOtp;
    config.allowDemoOtp = false;
    try {
      const r = await fetch(`${sb.base}/api/auth/request-otp`, { method: 'POST', headers: JSON_H, body: JSON.stringify({ identifier: 'nodemo@test.local' }) });
      // With no mail provider configured and demo mode off, delivery fails closed and never reveals a code.
      const body: any = await r.json();
      assert.equal(body.demoCode, undefined);
      assert.ok(!JSON.stringify(body).match(/\b\d{6}\b/), 'no 6-digit code anywhere in the response');
    } finally {
      config.allowDemoOtp = original;
    }
  });

  test('wrong codes: generic message for unknown/expired, attempts persisted, code burned after 5', async () => {
    const email = 'burn@test.local';
    const r = await fetch(`${sb.base}/api/auth/request-otp`, { method: 'POST', headers: JSON_H, body: JSON.stringify({ identifier: email }) });
    const { demoCode }: any = await r.json();

    const wrong = demoCode === '000000' ? '111111' : '000000';
    let last: any;
    for (let i = 0; i < 5; i++) {
      const v = await fetch(`${sb.base}/api/auth/verify-otp`, { method: 'POST', headers: JSON_H, body: JSON.stringify({ identifier: email, code: wrong }) });
      assert.equal(v.status, 401);
      last = await v.json();
    }
    assert.match(last.error, /burned/i);
    // Even the CORRECT code no longer works
    const ok = await fetch(`${sb.base}/api/auth/verify-otp`, { method: 'POST', headers: JSON_H, body: JSON.stringify({ identifier: email, code: demoCode }) });
    assert.equal(ok.status, 401);
    // Unknown identifier yields the same generic error as an expired challenge (no enumeration)
    const unknown = await fetch(`${sb.base}/api/auth/verify-otp`, { method: 'POST', headers: JSON_H, body: JSON.stringify({ identifier: 'nobody-here@test.local', code: '123456' }) });
    const unknownBody: any = await unknown.json();
    const burnedBody: any = await ok.json();
    assert.equal(unknownBody.error, burnedBody.error);
    assert.doesNotMatch(unknownBody.error, /not found|registry/i);
  });

  test('a code is single-use', async () => {
    const email = 'single@test.local';
    const r = await fetch(`${sb.base}/api/auth/request-otp`, { method: 'POST', headers: JSON_H, body: JSON.stringify({ identifier: email }) });
    const { demoCode }: any = await r.json();
    const first = await fetch(`${sb.base}/api/auth/verify-otp`, { method: 'POST', headers: JSON_H, body: JSON.stringify({ identifier: email, code: demoCode }) });
    assert.equal(first.status, 200);
    const second = await fetch(`${sb.base}/api/auth/verify-otp`, { method: 'POST', headers: JSON_H, body: JSON.stringify({ identifier: email, code: demoCode }) });
    assert.equal(second.status, 401);
  });

  test('session JWT is not accepted from the URL query string', async () => {
    const viaQuery = await fetch(`${sb.base}/api/auth/me?token=${alice.token}`);
    assert.equal(viaQuery.status, 401);
    const viaHeader = await fetch(`${sb.base}/api/auth/me`, { headers: { Authorization: `Bearer ${alice.token}` } });
    assert.equal(viaHeader.status, 200);
  });
});

describe('JWT hardening', () => {
  test('alg=none and foreign-secret tokens are rejected', async () => {
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const noneToken = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ userId: alice.userId, email: alice.email, handle: 'x' })}.`;
    const r1 = await fetch(`${sb.base}/api/auth/me`, { headers: { Authorization: `Bearer ${noneToken}` } });
    assert.equal(r1.status, 401);

    const jwt = (await import('jsonwebtoken')).default;
    const forged = jwt.sign({ userId: alice.userId, email: alice.email, handle: 'x' }, 'attacker-secret-attacker-secret-attacker');
    const r2 = await fetch(`${sb.base}/api/auth/me`, { headers: { Authorization: `Bearer ${forged}` } });
    assert.equal(r2.status, 401);
  });
});

describe('Cyber-Pass SSO (/auth/connect)', () => {
  const connect = (qs: string, s?: Session) =>
    fetch(`${sb.base}/auth/connect${qs}`, { headers: s ? { Cookie: s.cookie } : {} }).then((r) => r.text());

  test('rejects non-http(s) and credentialed destinations', async () => {
    for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'https://user:pw@evil.example/', 'ftp://x.example/']) {
      const html = await connect(`?return_url=${encodeURIComponent(bad)}`, alice);
      assert.match(html, /Invalid destination/);
      assert.doesNotMatch(html, /id="btnManualAuthorize"/, `no authorise button for ${bad}`);
    }
  });

  test('origin / return_url mismatch is refused; missing destination is refused', async () => {
    const html = await connect(`?origin=${encodeURIComponent('https://a.example')}&return_url=${encodeURIComponent('https://b.example/x')}`, alice);
    assert.match(html, /mismatch/i);
    const none = await connect('', alice);
    assert.match(none, /No destination/);
  });

  test('valid destination requires explicit consent: exact origin, no auto-dispatch, no wildcard', async () => {
    const html = await connect(`?return_url=${encodeURIComponent('https://friend.neocities.org/neogram/photos/1/')}`, alice);
    assert.match(html, /data-destination="https:\/\/friend\.neocities\.org"/);
    assert.match(html, /APPROVE/);
    assert.doesNotMatch(html, /setTimeout\(dispatchPass/);
    assert.doesNotMatch(html, /postMessage\([^)]*'\*'/);
    const js = await fetch(`${sb.base}/js/cyberPassConsent.js`).then((r) => r.text());
    assert.doesNotMatch(js, /,\s*'\*'\s*\)/, 'consent script must never postMessage to *');
    assert.match(js, /addEventListener\('click'/);
  });

  test('unauthenticated visitors get the login form, not a token', async () => {
    const html = await connect(`?origin=${encodeURIComponent('https://friend.neocities.org')}`);
    assert.doesNotMatch(html, /data-token=/);
    assert.match(html, /requestOtpForm/);
  });

  test('issued token is a scoped 1h "pass" token', async () => {
    const html = await connect(`?origin=${encodeURIComponent('https://friend.neocities.org')}`, alice);
    const token = /data-token="([^"]+)"/.exec(html)?.[1];
    assert.ok(token, 'pass token present on consent page');
    const payload = JSON.parse(Buffer.from(token!.split('.')[1], 'base64url').toString());
    assert.equal(payload.scope, 'pass');
    assert.ok(payload.exp - payload.iat <= 3600, 'lifetime ≤ 1 hour');
  });

  test('pass token cannot reach privileged endpoints but works on social ones', async () => {
    const html = await connect(`?origin=${encodeURIComponent('https://friend.neocities.org')}`, alice);
    const pass = /data-token="([^"]+)"/.exec(html)![1];

    for (const [method, path] of [
      ['GET', '/api/auth/me'],
      ['GET', '/api/settings'],
      ['GET', '/api/sites'],
      ['GET', '/api/settings/export-archive'],
      ['DELETE', '/api/settings/account'],
      ['POST', '/api/settings/reset-station'],
    ] as const) {
      const r = await fetch(`${sb.base}${path}`, { method, headers: bearer(pass) });
      assert.ok([401, 403, 404].includes(r.status), `${method} ${path} must reject pass token, got ${r.status}`);
    }
    // ...but the same token can follow (social action)
    const follow = await fetch(`${sb.base}/api/users/${bob.handle}/follow`, { method: 'POST', headers: bearer(pass) });
    assert.equal(follow.status, 200, await follow.clone().text());
  });
});

describe('CORS & CSRF', () => {
  test('public embed APIs: hostile origins get NO credentialed access', async () => {
    const r = await fetch(`${sb.base}/api/posts`, { headers: { Origin: 'https://evil.example' } });
    assert.equal(r.headers.get('access-control-allow-origin'), 'https://evil.example');
    assert.notEqual(r.headers.get('access-control-allow-credentials'), 'true');
  });

  test('preflight for a write route from a hostile origin is not credentialed', async () => {
    const r = await fetch(`${sb.base}/api/posts/x/like`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' },
    });
    assert.notEqual(r.headers.get('access-control-allow-credentials'), 'true');
  });

  test('private routes are not CORS-exposed to foreign origins; first-party stays credentialed', async () => {
    const evil = await fetch(`${sb.base}/api/settings`, { headers: { Origin: 'https://evil.example' } });
    assert.equal(evil.headers.get('access-control-allow-origin'), null);
    const local = await fetch(`${sb.base}/api/posts`, { headers: { Origin: 'http://localhost:4000' } });
    assert.equal(local.headers.get('access-control-allow-credentials'), 'true');
  });

  test('cookie-authenticated mutation from a foreign Origin is blocked (CSRF)', async () => {
    const r = await fetch(`${sb.base}/api/settings/reset-station`, {
      method: 'POST',
      headers: { Cookie: alice.cookie, Origin: 'https://evil.example', 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.equal(r.status, 403);
    const sfs = await fetch(`${sb.base}/api/settings/reset-station`, {
      method: 'POST',
      headers: { Cookie: alice.cookie, 'Sec-Fetch-Site': 'cross-site', 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.equal(sfs.status, 403);
  });

  test('Bearer clients and same-origin cookie requests are unaffected by the CSRF guard', async () => {
    const bearerReq = await fetch(`${sb.base}/api/settings/notifications`, {
      method: 'PUT',
      headers: { ...bearer(alice.token), Origin: 'https://friend.neocities.org' },
      body: JSON.stringify({}),
    });
    assert.notEqual(bearerReq.status, 403);
    const same = await fetch(`${sb.base}/api/settings/notifications`, {
      method: 'PUT',
      headers: { Cookie: alice.cookie, Origin: 'http://localhost:4000', 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.notEqual(same.status, 403);
  });
});

describe('Security headers', () => {
  test('workstation pages: CSP baseline, frame-ancestors self, XSS auditor off', async () => {
    const r = await fetch(`${sb.base}/login`);
    const csp = r.headers.get('content-security-policy') || '';
    for (const directive of ["object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'self'", "default-src 'self'"]) {
      assert.ok(csp.includes(directive), `CSP missing ${directive}`);
    }
    assert.equal(r.headers.get('x-xss-protection'), '0');
    assert.equal(r.headers.get('x-frame-options'), 'SAMEORIGIN');
  });

  test('embed surfaces stay frameable', async () => {
    const r = await fetch(`${sb.base}/embed/pager/someone`);
    assert.ok((r.headers.get('content-security-policy') || '').includes('frame-ancestors *'));
  });

  test('/api/stats is no longer public', async () => {
    const anon = await fetch(`${sb.base}/api/stats`);
    assert.notEqual(anon.status, 200);
    const user = await fetch(`${sb.base}/api/stats`, { headers: bearer(alice.token) });
    assert.notEqual(user.status, 200);
  });

  test('SysOp can read /api/stats', async () => {
    const sysop = await login(sb.base, ADMIN_EMAIL);
    const r = await fetch(`${sb.base}/api/stats`, { headers: bearer(sysop.token) });
    assert.equal(r.status, 200);
  });

  test('server faults do not leak internals to embed widgets', async () => {
    const r = await fetch(`${sb.base}/embed/guestbook/%00%00`);
    const text = await r.text();
    assert.doesNotMatch(text, /Error:.*(at |SELECT|pg|postgres)/s);
  });
});

describe('Likes: dedupe, validation, no lost updates', () => {
  let postId: string;

  before(async () => {
    const { savePost } = await import('../services/postStorage');
    postId = crypto.randomUUID();
    await savePost({
      id: postId,
      userId: alice.userId,
      imagePath: '/uploads/images/x.webp',
      thumbnailPath: '/uploads/thumbs/x.webp',
      caption: 'test',
      filterApplied: 'none',
      likes: 0,
      createdAt: new Date().toISOString(),
      comments: [],
    } as any);
  });

  test('rejects malformed ids and unknown posts', async () => {
    assert.equal((await fetch(`${sb.base}/api/posts/..%2F..%2Fetc/like`, { method: 'POST' })).status, 400);
    assert.equal((await fetch(`${sb.base}/api/posts/${crypto.randomUUID()}/like`, { method: 'POST' })).status, 404);
  });

  test('anonymous visitor counts once per post (idempotent)', async () => {
    const a: any = await (await fetch(`${sb.base}/api/posts/${postId}/like`, { method: 'POST' })).json();
    const b: any = await (await fetch(`${sb.base}/api/posts/${postId}/like`, { method: 'POST' })).json();
    const c: any = await (await fetch(`${sb.base}/api/posts/${postId}/like`, { method: 'POST' })).json();
    assert.equal(a.likes, 1);
    assert.equal(b.likes, 1);
    assert.equal(c.alreadyLiked, true);
  });

  test('a distinct authenticated user adds exactly one more', async () => {
    const r: any = await (await fetch(`${sb.base}/api/posts/${postId}/like`, { method: 'POST', headers: bearer(bob.token) })).json();
    assert.equal(r.likes, 2);
    const again: any = await (await fetch(`${sb.base}/api/posts/${postId}/like`, { method: 'POST', headers: bearer(bob.token) })).json();
    assert.equal(again.likes, 2);
    assert.equal(again.alreadyLiked, true);
  });

  test('concurrent read-modify-write updates are never lost (mutex)', async () => {
    const { updatePost, getPostById } = await import('../services/postStorage');
    const before = (await getPostById(postId))!.likes;
    await Promise.all(Array.from({ length: 30 }, () => updatePost(postId, (p) => ({ ...p, likes: (p.likes || 0) + 1 }))));
    assert.equal((await getPostById(postId))!.likes, before + 30);
  });
});

describe('Hit counter', () => {
  test('repeat views from one visitor do not inflate hits; owner bump is clamped', async () => {
    const create = await fetch(`${sb.base}/api/sites`, {
      method: 'POST',
      headers: bearer(alice.token),
      body: JSON.stringify({ name: 'Counter Site', slug: 'counter-site', siteUrl: 'https://alice-test.neocities.org' }),
    });
    assert.equal(create.status, 200, await create.clone().text());

    const svg = async () => (await fetch(`${sb.base}/counter/${alice.handle}.svg`)).text();
    await svg();
    await svg();
    await svg();
    const row = (await q('SELECT hits FROM web_counters ORDER BY updated_at DESC LIMIT 1')).rows[0];
    assert.equal(parseInt(row.hits, 10), 1, 'three views from the same IP count once');

    const bump = await fetch(`${sb.base}/api/counter`, {
      method: 'PUT',
      headers: bearer(alice.token),
      body: JSON.stringify({ action: 'increment', amount: -999999 }),
    });
    assert.equal(bump.status, 200);
    const after = (await q('SELECT hits FROM web_counters ORDER BY updated_at DESC LIMIT 1')).rows[0];
    assert.ok(parseInt(after.hits, 10) >= 1, 'negative amounts are clamped to +1, counter never goes down');
  });
});

describe('Uploads', () => {
  test('non-image and SVG uploads are rejected before processing', async () => {
    for (const [name, type, body] of [
      ['evil.svg', 'image/svg+xml', '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'],
      ['note.txt', 'text/plain', 'hello'],
      ['x.html', 'text/html', '<script>1</script>'],
    ] as const) {
      const form = new FormData();
      form.append('imageFiles', new Blob([body], { type }), name);
      form.append('caption', 'x');
      const r = await fetch(`${sb.base}/api/posts`, { method: 'POST', headers: { Authorization: `Bearer ${alice.token}` }, body: form });
      assert.equal(r.status, 400, `${name} should be rejected (got ${r.status})`);
    }
  });
});

describe('Site URL validation (SSRF at the edge)', () => {
  test('private / metadata / non-http URLs are rejected when saved', async () => {
    const { config } = await import('../config');
    const prev = config.env;
    config.env = 'production';
    try {
      for (const bad of ['http://169.254.169.254/latest/meta-data', 'https://10.0.0.5/', 'https://localhost/', 'https://192.168.1.1/', 'https://[::1]/', 'http://insecure.example/']) {
        const r = await fetch(`${sb.base}/api/sites`, {
          method: 'POST',
          headers: bearer(alice.token),
          body: JSON.stringify({ name: 'Bad', slug: `bad-${Math.floor(Math.random() * 1e6)}`, siteUrl: bad }),
        });
        assert.equal(r.status, 400, `${bad} should be rejected, got ${r.status}`);
      }
    } finally {
      config.env = prev;
    }
  });
});

describe('Federated feed hydration cannot overwrite other users (ownership spoofing)', () => {
  test('hostile feed.json claiming a victim userId/siteId/post is ignored', async () => {
    const { getPostsForUser, savePost } = await import('../services/postStorage');
    const { aggregateFederatedFriendsFeed } = await import('../services/federatedFriends');

    const victimPostId = crypto.randomUUID();
    await savePost({
      id: victimPostId,
      userId: alice.userId,
      imagePath: '/uploads/images/real.webp',
      thumbnailPath: '/uploads/thumbs/real.webp',
      caption: 'ORIGINAL VICTIM CAPTION',
      filterApplied: 'none',
      likes: 0,
      createdAt: new Date().toISOString(),
      comments: [],
    } as any);

    // Malicious "friend" station served from a local mock host
    const evilFeed = {
      version: 'neogram-feed-v1',
      posts: [
        {
          id: victimPostId,
          userId: alice.userId, // claims the victim's identity
          imagePath: 'https://evil.example/pwn.webp',
          thumbnailPath: 'https://evil.example/pwn.webp',
          caption: 'HACKED',
          createdAt: new Date().toISOString(),
        },
        { id: '../../etc/passwd', userId: alice.userId, imagePath: 'x', caption: 'path-ish id' },
      ],
    };
    const mock = http.createServer((_req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(evilFeed));
    });
    await new Promise<void>((r) => mock.listen(0, '127.0.0.1', r));
    const port = (mock.address() as AddressInfo).port;

    try {
      await aggregateFederatedFriendsFeed(
        [{ id: bob.userId, handle: bob.handle, uin: 1, avatarPath: '', siteUrl: `http://127.0.0.1:${port}`, deployPath: '' } as any],
        10
      );
      await new Promise((r) => setTimeout(r, 300)); // hydration is fire-and-forget

      const victimPosts = await getPostsForUser(alice.userId);
      const victim = victimPosts.find((p) => p.id === victimPostId);
      assert.ok(victim, 'victim post still present');
      assert.equal(victim!.caption, 'ORIGINAL VICTIM CAPTION', 'victim post must not be overwritten by a foreign feed');
      assert.equal(victimPosts.find((p) => p.id === '../../etc/passwd'), undefined);
    } finally {
      mock.close();
    }
  });
});

