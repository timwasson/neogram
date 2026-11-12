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

async function ensureSiteFor(sess: Session, slug: string): Promise<any> {
  const existing: any = await (await fetch(`${sb.base}/api/sites`, { headers: bearer(sess.token) })).json();
  const found = (existing.sites || [])[0];
  if (found) return found;
  const r = await fetch(`${sb.base}/api/sites`, {
    method: 'POST',
    headers: bearer(sess.token),
    body: JSON.stringify({ name: `${slug} site`, slug, siteUrl: `https://${slug}.example.test`, isDefault: true }),
  });
  const body: any = await r.json();
  if (!body.site) throw new Error(`could not create site: ${JSON.stringify(body)}`);
  return body.site;
}

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
    // Friend-graph changes and the friends roster need a full session (pass = likes/comments/guestbook/pager only)
    const follow = await fetch(`${sb.base}/api/users/${bob.handle}/follow`, { method: 'POST', headers: bearer(pass) });
    assert.equal(follow.status, 401, await follow.clone().text());
    const friends = await fetch(`${sb.base}/api/friends`, { headers: bearer(pass) });
    assert.equal(friends.status, 401);
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
    assert.ok(create.status === 200 || create.status === 201, await create.clone().text());
    const siteJson: any = await create.json();
    const siteId = siteJson.site.id;

    const svg = async () => (await fetch(`${sb.base}/counter/${alice.handle}.svg`)).text();
    await svg();
    await svg();
    await svg();
    const row = (await q('SELECT hits FROM web_counters WHERE site_id = $1', [siteId])).rows[0];
    assert.equal(parseInt(row.hits, 10), 1, 'three views from the same IP count once');

    const bump = await fetch(`${sb.base}/api/counter`, {
      method: 'PUT',
      headers: bearer(alice.token),
      body: JSON.stringify({ siteId, action: 'increment', amount: -999999 }),
    });
    assert.equal(bump.status, 200);
    const after = (await q('SELECT hits FROM web_counters WHERE site_id = $1', [siteId])).rows[0];
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


describe('Smart Handoff (/auth/handoff)', () => {
  const target = 'https://friend.example.test/neogram/';

  test('a logged-in cookie WITHOUT a ticket never yields a Cyber-Pass (consent screen instead)', async () => {
    const r = await fetch(`${sb.base}/auth/handoff?target=${encodeURIComponent('https://evil.example.test/steal')}`, {
      headers: { Cookie: alice.cookie },
      redirect: 'manual',
    });
    assert.equal(r.status, 302);
    const loc = r.headers.get('location') || '';
    assert.ok(loc.startsWith('/auth/connect?'), `expected consent redirect, got ${loc}`);
    assert.ok(!loc.includes('neogram_pass'));
    assert.ok(!(r.headers.getSetCookie().join(';').includes('neogram_session=')));
  });

  test('a ticket minted for one target cannot be redeemed for another', async () => {
    const t = await fetch(`${sb.base}/api/auth/handoff-ticket`, { method: 'POST', headers: bearer(alice.token), body: JSON.stringify({ target }) });
    const { ticket }: any = await t.json();
    const r = await fetch(`${sb.base}/auth/handoff?ticket=${encodeURIComponent(ticket)}&target=${encodeURIComponent('https://evil.example.test/')}`, { redirect: 'manual' });
    assert.equal(r.status, 302);
    assert.ok(!(r.headers.get('location') || '').includes('neogram_pass'));
  });

  test('a handoff ticket is not accepted as a session token', async () => {
    const t = await fetch(`${sb.base}/api/auth/handoff-ticket`, { method: 'POST', headers: bearer(alice.token), body: JSON.stringify({ target }) });
    const { ticket }: any = await t.json();
    const me = await fetch(`${sb.base}/api/auth/me`, { headers: bearer(ticket) });
    assert.equal(me.status, 401);
  });
});

describe('Chat WebSocket token scoping', () => {
  let wsBase = '';
  let server: http.Server;
  let WebSocketCtor: any;

  before(async () => {
    WebSocketCtor = (await import('ws')).WebSocket;
    const { createApp } = await import('../app');
    const { initChatWebSocketServer } = await import('../services/chatSocket');
    server = http.createServer(createApp());
    initChatWebSocketServer(server);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    wsBase = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/ws/chat`;
  });

  after(async () => {
    (server as any).closeAllConnections?.();
    await new Promise<void>((r) => server.close(() => r()));
  });

  /** Opens a socket, optionally sends packets after the first frame, and collects frames for `ms`. */
  function collect(url: string, send: any[] = [], ms = 400, origin: string | null = 'https://friend.example.test'): Promise<{ frames: any[]; closeCode: number | null }> {
    return new Promise((resolve) => {
      const frames: any[] = [];
      let closeCode: number | null = null;
      const ws = new WebSocketCtor(url, origin ? { headers: { Origin: origin } } : {});
      let sent = false;
      ws.on('message', (d: any) => {
        frames.push(JSON.parse(d.toString()));
        if (!sent) {
          sent = true;
          for (const p of send) ws.send(JSON.stringify(p));
        }
      });
      ws.on('close', (code: number) => { closeCode = code; });
      ws.on('error', () => {});
      setTimeout(() => { try { ws.close(); } catch { /* noop */ } resolve({ frames, closeCode }); }, ms);
    });
  }

  async function passTokenFor(s: Session) {
    const { signPassToken } = await import('../auth/jwt');
    return signPassToken({ userId: s.userId, email: s.email, handle: s.handle });
  }

  test('a Cyber-Pass token cannot open a full NIM session', async () => {
    const pass = await passTokenFor(alice);
    // No Origin header (like the extension / a script): reaches token validation, which must refuse.
    const { frames, closeCode } = await collect(`${wsBase}?token=${encodeURIComponent(pass)}`, [], 400, null);
    assert.ok(!frames.some((f) => f.type === 'init_state'), 'no buddy list for pass tokens');
    assert.equal(closeCode, 4001);
  });

  test('a Cyber-Pass pager socket is bound to its station: no buddy dump, no DMs elsewhere', async () => {
    const pass = await passTokenFor(alice);
    const url = `${wsBase}?pager=true&station=${encodeURIComponent(bob.handle)}&token=${encodeURIComponent(pass)}`;
    const { frames } = await collect(url, [
      { type: 'request_buddies' },
      { type: 'direct_message', to: 'someone_else', text: 'hi', id: 'x1' },
    ]);
    assert.ok(frames.some((f) => f.type === 'pager_init'), 'pager handshake received');
    assert.ok(!frames.some((f) => f.type === 'init_state'), 'request_buddies ignored');
    assert.ok(frames.some((f) => f.type === 'message_error' && f.id === 'x1'), 'DM to non-station refused');
  });

  test('anonymous pager visitors cannot dump the member list or claim a member handle', async () => {
    const url = `${wsBase}?pager=true&station=${encodeURIComponent(bob.handle)}&anonHandle=${encodeURIComponent(alice.handle)}`;
    const { frames } = await collect(url, [{ type: 'request_buddies' }]);
    const init = frames.find((f) => f.type === 'pager_init');
    assert.ok(init, 'pager handshake received');
    assert.notEqual(init.anonHandle, alice.handle, 'anon handle must not equal a real member handle');
    assert.ok(!frames.some((f) => f.type === 'init_state'));
  });

  test('NIM buddy list never contains email addresses', async () => {
    const ws = new WebSocketCtor(`${wsBase}?token=${encodeURIComponent(alice.token)}`);
    const init: any = await new Promise((resolve, reject) => {
      ws.on('message', (d: any) => {
        const f = JSON.parse(d.toString());
        if (f.type === 'init_state') resolve(f);
      });
      ws.on('error', reject);
      setTimeout(() => reject(new Error('no init_state')), 2000);
    });
    ws.close();
    assert.ok(init.buddies.length > 0);
    assert.ok(init.buddies.every((b: any) => b.email === undefined));
  });
});

describe('Site URL / avatar canonicalisation (stored XSS)', () => {
  test('site URLs are stored canonicalised: no quotes or angle brackets survive', async () => {
    const r = await fetch(`${sb.base}/api/sites`, {
      method: 'POST',
      headers: bearer(alice.token),
      body: JSON.stringify({ name: 'XSS Probe', slug: 'xss-probe', siteUrl: `https://probe.example.test/a"><img src=x onerror=alert(1)>'b/` }),
    });
    assert.ok(r.ok, await r.clone().text());
    const row = (await q(`SELECT site_url FROM sites WHERE user_id = $1 AND slug = 'xss-probe'`, [alice.userId])).rows[0];
    assert.ok(row);
    assert.doesNotMatch(row.site_url, /["'<> ]/);
    assert.ok(!row.site_url.endsWith('/'));
  });

  test('hostnames with quote characters are refused', async () => {
    const r = await fetch(`${sb.base}/api/sites`, {
      method: 'POST',
      headers: bearer(alice.token),
      body: JSON.stringify({ name: 'Bad Host', slug: 'bad-host', siteUrl: 'https://a"onerror=alert(1)".example.test' }),
    });
    assert.ok(r.status >= 400);
  });

  test('custom CSS URL must be https (no javascript:/data:)', async () => {
    for (const customCssUrl of ['javascript:alert(1)', 'data:text/css,body{}', 'https://x.example.test/a"onload="alert(1)']) {
      const r = await fetch(`${sb.base}/api/sites`, {
        method: 'POST',
        headers: bearer(alice.token),
        body: JSON.stringify({ name: 'Css Probe', slug: `css-${crypto.randomBytes(3).toString('hex')}`, siteUrl: 'https://css.example.test', customCssUrl }),
      });
      if (customCssUrl.startsWith('https://')) {
        const body: any = await r.json();
        assert.doesNotMatch(String(body.site?.customCssUrl ?? ''), /"/);
      } else {
        assert.ok(r.status >= 400, `${customCssUrl} must be rejected`);
      }
    }
  });

  test('legacy stored avatar values are re-canonicalised or dropped on output', async () => {
    const { resolveAvatarPath } = await import('../utils/avatar');
    const out = resolveAvatarPath({ avatarPath: `https://x.example.test/"><svg onload=alert(1)>'/avatar.webp`, deploymentType: 'neocities', siteUrl: 'https://x.example.test', uin: 1 });
    assert.doesNotMatch(out, /["'<>]/);
    const bad = resolveAvatarPath({ avatarPath: `https://a"b.example.test/avatar.webp`, deploymentType: 'neocities', siteUrl: 'https://x.example.test', uin: 1 });
    assert.ok(bad.startsWith('/icons/default-avatar'));
  });
});

describe('Privacy: member emails are never exposed', () => {
  test('public directory / network / posts APIs and the friends API carry no emails', async () => {
    await fetch(`${sb.base}/api/users/${bob.handle}/follow`, { method: 'POST', headers: bearer(alice.token) });
    for (const [path, headers] of [
      ['/api/directory', JSON_H],
      ['/api/users', JSON_H],
      ['/api/network/users', JSON_H],
      ['/api/posts', JSON_H],
      ['/api/friends', bearer(alice.token)],
    ] as const) {
      const r = await fetch(`${sb.base}${path}`, { headers });
      const text = await r.text();
      assert.ok(!/@test\.local/i.test(text), `${path} leaks an email address`);
    }
  });
});

describe('Extension pass exchange & token contents', () => {
  test('POST /api/auth/pass-token: Bearer session only, returns a scoped pass without email', async () => {
    const ok = await fetch(`${sb.base}/api/auth/pass-token`, { method: 'POST', headers: bearer(alice.token), body: JSON.stringify({ origin: 'https://friend.example.test' }) });
    assert.equal(ok.status, 200);
    const body: any = await ok.json();
    const payload = JSON.parse(Buffer.from(body.token.split('.')[1], 'base64url').toString());
    assert.equal(payload.scope, 'pass');
    assert.ok(!payload.email, 'pass tokens must not carry the email');

    const viaCookie = await fetch(`${sb.base}/api/auth/pass-token`, { method: 'POST', headers: { ...JSON_H, Cookie: alice.cookie }, body: JSON.stringify({ origin: 'https://friend.example.test' }) });
    assert.equal(viaCookie.status, 401, 'cookies are not accepted');

    const viaPass = await fetch(`${sb.base}/api/auth/pass-token`, { method: 'POST', headers: bearer(body.token), body: JSON.stringify({ origin: 'https://friend.example.test' }) });
    assert.equal(viaPass.status, 401, 'a pass cannot mint another pass');

    const badOrigin = await fetch(`${sb.base}/api/auth/pass-token`, { method: 'POST', headers: bearer(alice.token), body: JSON.stringify({ origin: 'javascript:alert(1)' }) });
    assert.equal(badOrigin.status, 400);
  });

  test('extension content script never posts with a wildcard target origin', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const { REPO_ROOT } = await import('./helpers/sandbox');
    const src = fs.readFileSync(path.join(REPO_ROOT, 'extension', 'content', 'auth-bridge.js'), 'utf8');
    assert.ok(!/postMessage\([\s\S]*?,\s*['"]\*['"]\s*\)/.test(src));
    assert.ok(!src.includes('neogram_token'), 'content script must not read the session JWT');
  });
});

describe('Deploy target ownership (IDOR)', () => {
  test("a user cannot deploy another user's site or userId", async () => {
    const bobSiteId = (await ensureSiteFor(bob, 'bob-deploy')).id;
    assert.ok(bobSiteId);
    for (const provider of ['neocities', 'nekoweb', 'github']) {
      for (const siteId of [bobSiteId, bob.userId].filter(Boolean)) {
        const r = await fetch(`${sb.base}/api/deploy/${provider}`, { method: 'POST', headers: bearer(alice.token), body: JSON.stringify({ siteId }) });
        assert.equal(r.status, 404, `${provider} with foreign id ${siteId} must be refused`);
      }
    }
  });
});

describe('Federated feed URL validation (javascript: links)', () => {
  test('isValidStaticSiteUrl rejects non-http schemes instead of prefixing https://', async () => {
    const { isValidStaticSiteUrl } = await import('../services/federatedFriends');
    assert.equal(isValidStaticSiteUrl('javascript://x.neocities.org/photos/%0aalert(1)'), false);
    assert.equal(isValidStaticSiteUrl('data:text/html,<script>alert(1)</script>'), false);
    assert.equal(isValidStaticSiteUrl('JaVaScRiPt:alert(1)'), false);
    assert.equal(isValidStaticSiteUrl('https://friend.neocities.org/neogram/photos/1/'), true);
    assert.equal(isValidStaticSiteUrl('friend.neocities.org'), true);
  });
});

describe('Banned stations lose access immediately', () => {
  test('a banned user with a still-valid JWT is refused on private and social routes', async () => {
    const mallory = await login(sb.base, 'mallory@test.local');
    await q('UPDATE users SET is_banned = TRUE WHERE id = $1', [mallory.userId]);
    try {
      for (const [method, path] of [
        ['GET', '/api/settings'],
        ['GET', '/api/sites'],
        ['GET', '/api/notifications'],
        ['POST', `/api/users/${bob.handle}/follow`],
        ['GET', '/api/friends'],
      ] as const) {
        const r = await fetch(`${sb.base}${path}`, { method, headers: bearer(mallory.token) });
        assert.ok([401, 403].includes(r.status), `${method} ${path} must refuse a banned user, got ${r.status}`);
      }
    } finally {
      await q('UPDATE users SET is_banned = FALSE WHERE id = $1', [mallory.userId]);
    }
  });
});

describe('Tenant path traversal', () => {
  test('GET /api/posts refuses non-UUID siteId/userId', async () => {
    for (const qs of ['siteId=../../eleventy/src/_data', 'userId=..%2F..%2Fetc', 'siteId=%2e%2e']) {
      const r = await fetch(`${sb.base}/api/posts?${qs}`, { headers: JSON_H });
      assert.equal(r.status, 400, qs);
    }
  });
  test('storage layer refuses traversal ids', async () => {
    const { tenantDir, getPostsForSite } = await import('../services/postStorage');
    assert.throws(() => tenantDir('../x'));
    assert.deepEqual(await getPostsForSite('../../eleventy/src/_data'), []);
  });
});

describe('Push subscription endpoints (SSRF)', () => {
  test('only https endpoints on known browser push services are accepted', async () => {
    const keys = { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' };
    for (const endpoint of ['http://fcm.googleapis.com/x', 'https://10.0.0.5:8443/x', 'https://169.254.169.254/latest', 'https://evil.example.test/fcm.googleapis.com', 'https://fcm.googleapis.com.evil.test/x']) {
      const r = await fetch(`${sb.base}/api/notifications/push-subscription`, { method: 'POST', headers: bearer(alice.token), body: JSON.stringify({ endpoint, keys }) });
      assert.equal(r.status, 400, endpoint);
    }
    const ok = await fetch(`${sb.base}/api/notifications/push-subscription`, { method: 'POST', headers: bearer(alice.token), body: JSON.stringify({ endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys }) });
    assert.equal(ok.status, 200);
  });
});

describe('Guestbook storage target', () => {
  test("signatures are read/written via the host site's own URL and credentials, and only the owner can delete", async () => {
    const { getSiteStorageTarget } = await import('../services/staticStorage');
    const site = await ensureSiteFor(bob, 'bob-guestbook');
    const target = await getSiteStorageTarget(bob.userId, site.id);
    assert.equal(target.id, site.id);
    assert.equal(target.site_url, site.siteUrl, 'raw site_url must be present (no fallback to user.neocities.org)');
    assert.equal(target.handle, bob.handle);
    assert.equal(await getSiteStorageTarget(alice.userId, site.id), null, "cannot build a target for someone else's site");

    const sign = await fetch(`${sb.base}/api/guestbook/${bob.handle}`, {
      method: 'POST',
      headers: bearer(alice.token),
      body: JSON.stringify({ message: 'hello from alice', visitorName: 'alice' }),
    });
    assert.ok(sign.ok, await sign.clone().text());
    const { entry }: any = await sign.json();
    assert.ok(entry?.id);

    const list: any = await (await fetch(`${sb.base}/api/guestbook/${bob.handle}`, { headers: JSON_H })).json();
    assert.ok(JSON.stringify(list).includes(entry.id), 'GET reads the same ledger the signature was written to');

    const foreign: any = await (await fetch(`${sb.base}/api/guestbook/${entry.id}`, { method: 'DELETE', headers: bearer(alice.token) })).json();
    assert.equal(foreign.deleted, false, "alice cannot delete from bob's guestbook");

    const own: any = await (await fetch(`${sb.base}/api/guestbook/${entry.id}`, { method: 'DELETE', headers: bearer(bob.token) })).json();
    assert.equal(own.deleted, true, 'owner moderation removes the entry from the ledger it was written to');
    const after: any = await (await fetch(`${sb.base}/api/guestbook/${bob.handle}`, { headers: JSON_H })).json();
    assert.ok(!JSON.stringify(after).includes(entry.id));
  });
});

describe('Station wipe safety (remote feed.json 404)', () => {
  test('anonymous profile views never trigger it; one 404 or a broken body never wipes; wipe is site-scoped', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const { checkAndSyncStationFeed, __setStationSyncClockForTests } = await import('../services/stationSync');

    let mode: '404' | 'html' = '404';
    let hits = 0;
    const mock = http.createServer((_req, res) => {
      hits++;
      if (mode === '404') { res.writeHead(404); res.end('not found'); }
      else { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<html>maintenance</html>'); }
    });
    await new Promise<void>((r) => mock.listen(0, '127.0.0.1', () => r()));
    const port = (mock.address() as AddressInfo).port;

    const carol = await login(sb.base, 'carol@test.local');
    const mkSite = async (slug: string, isDefault: boolean) => {
      const r: any = await (await fetch(`${sb.base}/api/sites`, {
        method: 'POST', headers: bearer(carol.token),
        body: JSON.stringify({ name: slug, slug, siteUrl: `http://127.0.0.1:${port}`, isDefault }),
      })).json();
      return r.site.id as string;
    };
    const mainId = await mkSite('carol-main', true);
    const otherId = await mkSite('carol-other', false);
    const longAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    await q(`UPDATE sites SET deployment_type = 'neocities', last_deployed_at = $2 WHERE user_id = $1`, [carol.userId, longAgo]);
    await q(`UPDATE users SET deployment_type = 'neocities', last_deployed_at = $2 WHERE id = $1`, [carol.userId, longAgo]);
    const galleries = path.join(sb.dir, 'dist', 'static-galleries');
    // Background 11ty builds (queued by site creation) may re-create a site's directory at any time, so
    // wipes are observed through a sentinel file that no build ever writes.
    const sentinel = (id: string) => path.join(galleries, id, 'wipe-sentinel.txt');
    for (const id of [mainId, otherId]) {
      fs.mkdirSync(path.join(galleries, id), { recursive: true });
      fs.writeFileSync(sentinel(id), 'x');
    }
    try {
      // 1. Public profile view: no outbound check at all
      await fetch(`${sb.base}/user/${carol.handle}`);
      assert.equal(hits, 0, 'anonymous views must not trigger the remote wipe check');

      // 2. First 404: pending only
      let r = await checkAndSyncStationFeed(carol.userId);
      assert.equal(r.wiped, false);
      assert.ok(fs.existsSync(sentinel(mainId)));

      // 3. Immediate second 404: still within the confirmation interval
      r = await checkAndSyncStationFeed(carol.userId);
      assert.equal(r.wiped, false);

      // 4. Unparseable 200 never wipes (and cancels the pending 404)
      mode = 'html';
      r = await checkAndSyncStationFeed(carol.userId);
      assert.equal(r.wiped, false);
      mode = '404';

      // 5. 404, then 404 again 11 minutes later: confirmed wipe of the checked (default) site ONLY
      r = await checkAndSyncStationFeed(carol.userId);
      assert.equal(r.wiped, false);
      __setStationSyncClockForTests(() => Date.now() + 11 * 60 * 1000);
      r = await checkAndSyncStationFeed(carol.userId);
      assert.equal(r.wiped, true);
      assert.ok(!fs.existsSync(sentinel(mainId)), 'checked site cache removed');
      assert.ok(fs.existsSync(sentinel(otherId)), "the user's other sites are untouched");

      // 6. Grace period right after a deploy
      __setStationSyncClockForTests(null);
      await q(`UPDATE sites SET last_deployed_at = NOW() WHERE id = $1`, [mainId]);
      r = await checkAndSyncStationFeed(carol.userId);
      assert.equal(r.checked, false);
    } finally {
      __setStationSyncClockForTests(null);
      mock.close();
    }
  });
});

describe('Cyber-Pass verification for static sites (login CSRF / spoofed identity)', () => {
  test('GET /api/pass/verify vouches only for real, scoped, non-banned passes', async () => {
    const { signPassToken } = await import('../auth/jwt');
    const pass = signPassToken({ userId: alice.userId, email: '', handle: alice.handle });

    const ok = await fetch(`${sb.base}/api/pass/verify`, { headers: { Authorization: `Bearer ${pass}`, Origin: 'https://friend.example.test' } });
    assert.equal(ok.status, 200);
    const body: any = await ok.json();
    assert.equal(body.handle, alice.handle);
    assert.equal(ok.headers.get('access-control-allow-origin'), 'https://friend.example.test');
    assert.notEqual(ok.headers.get('access-control-allow-credentials'), 'true', 'never credentialed');
    assert.ok(!JSON.stringify(body).includes('@test.local'), 'no email in the response');

    const session = await fetch(`${sb.base}/api/pass/verify`, { headers: { Authorization: `Bearer ${alice.token}` } });
    assert.equal(session.status, 401, 'full session tokens are refused (they must never be put in pages)');

    const forged = pass.split('.').slice(0, 2).join('.') + '.AAAA';
    const bad = await fetch(`${sb.base}/api/pass/verify`, { headers: { Authorization: `Bearer ${forged}` } });
    assert.equal(bad.status, 401);

    const viaCookie = await fetch(`${sb.base}/api/pass/verify`, { headers: { Cookie: alice.cookie } });
    assert.equal(viaCookie.status, 401, 'cookies are ignored');

    const dave = await login(sb.base, 'dave@test.local');
    const davePass = signPassToken({ userId: dave.userId, email: '', handle: dave.handle });
    await q('UPDATE users SET is_banned = TRUE WHERE id = $1', [dave.userId]);
    try {
      const banned = await fetch(`${sb.base}/api/pass/verify`, { headers: { Authorization: `Bearer ${davePass}` } });
      assert.equal(banned.status, 401);
    } finally {
      await q('UPDATE users SET is_banned = FALSE WHERE id = $1', [dave.userId]);
    }
  });

  test('static templates and widgets verify passes server-side and trust no localhost origins', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const { REPO_ROOT } = await import('./helpers/sandbox');
    for (const rel of ['eleventy/src/index.njk', 'eleventy/src/photo.njk', 'eleventy/src/friends.njk', 'views/embeds/guestbook.njk', 'views/embeds/pager.njk', 'embed/pager.js']) {
      const src = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
      assert.ok(src.includes('/api/pass/verify'), `${rel} must verify passes with the server`);
      assert.ok(!/localhost\|127\\\.0\\\.0\\\.1/.test(src), `${rel} must not trust localhost pass origins`);
      assert.ok(!/atob\(currentToken/.test(src), `${rel} must not decode identity from the JWT client-side`);
      assert.ok(!/neogram_pass=[\s\S]{0,300}localStorage\.setItem\('neogram_pass', JSON\.stringify\(parsed/.test(src), `${rel} must not store raw hash passes`);
    }
  });
});

describe('Anonymous pager guest identities', () => {
  test('guessed guest handles get a fresh identity and never receive queued station replies', async () => {
    const { issueAnonIdentity, verifyAnonIdentity, resolveAnonIdentity } = await import('../auth/anonIdentity');
    const real = issueAnonIdentity();
    assert.match(real.handle, /^guest_[0-9a-f]{10}$/);
    assert.ok(verifyAnonIdentity(real.handle, real.key));
    assert.ok(!verifyAnonIdentity(real.handle, real.key.slice(0, -1) + (real.key.endsWith('A') ? 'B' : 'A')));
    assert.ok(!verifyAnonIdentity('guest_1234', 'anything'));
    assert.equal(resolveAnonIdentity(real.handle, '').reused, false, 'a handle without its key is not reused');

    // A reply queued by the station for the real guest
    await q(
      `INSERT INTO ephemeral_chat_queue (sender_id, sender_handle, receiver_id, receiver_handle, is_anonymous, body)
       VALUES ($1, $2, NULL, $3, FALSE, 'secret reply')`,
      [bob.userId, bob.handle, real.handle]
    );

    const { WebSocket } = await import('ws');
    const { createApp } = await import('../app');
    const { initChatWebSocketServer } = await import('../services/chatSocket');
    const server = http.createServer(createApp());
    initChatWebSocketServer(server);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const base = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/ws/chat?pager=true&station=${encodeURIComponent(bob.handle)}`;
    const collect = (url: string) => new Promise<any[]>((resolve) => {
      const frames: any[] = [];
      const ws = new WebSocket(url);
      ws.on('message', (d) => frames.push(JSON.parse(d.toString())));
      ws.on('error', () => {});
      setTimeout(() => { ws.close(); resolve(frames); }, 400);
    });
    try {
      // Impostor knows the handle but not the key
      const impostor = await collect(`${base}&anonHandle=${real.handle}`);
      const init = impostor.find((f) => f.type === 'pager_init');
      assert.ok(init && init.anonHandle !== real.handle, 'impostor is issued a different identity');
      assert.ok(!impostor.some((f) => f.type === 'direct_message'), 'impostor receives no queued replies');
      const still = await q('SELECT 1 FROM ephemeral_chat_queue WHERE receiver_handle = $1', [real.handle]);
      assert.equal(still.rows.length, 1, 'queued reply is not consumed by the impostor');

      // The real guest (handle + key) gets it
      const owner = await collect(`${base}&anonHandle=${real.handle}&anonKey=${encodeURIComponent(real.key)}`);
      assert.ok(owner.find((f) => f.type === 'pager_init')?.anonHandle === real.handle);
      assert.ok(owner.some((f) => f.type === 'direct_message' && f.text === 'secret reply'));
    } finally {
      (server as any).closeAllConnections?.();
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});

describe('Remote delete paths (non-destructive invariant)', () => {
  test('only Neogram assets under the deploy path can be deleted on a member host', async () => {
    const { isSafeRemoteDeletePath } = await import('../utils/remotePaths');
    const allowed = ['neogram/uploads/images/a.webp', 'neogram/uploads/images/a.comments.json', 'neogram/photos/abc/index.html', 'neogram/avatar.webp'];
    for (const p of allowed) assert.equal(isSafeRemoteDeletePath(p, 'neogram'), true, p);
    assert.equal(isSafeRemoteDeletePath('uploads/thumbs/a.webp', ''), true, 'root deploy path');
    const refused = [
      'neogram/uploads/../../index.html',
      'neogram/uploads/..%2F..%2Findex.html',
      'neogram/uploads/%2e%2e/index.html',
      'neogram/uploads\\..\\index.html',
      'neogram//uploads/a.webp',
      'neogram/index.html',
      'neogram/uploads',
      'blog/uploads/a.webp',
      'index.html',
      'uploads/a.webp', // outside the configured deploy path
      'neogram/css/neogram.css',
    ];
    for (const p of refused) assert.equal(isSafeRemoteDeletePath(p, 'neogram'), false, p);
  });
});

describe('Admin & QA tooling guardrails', () => {
  test('admin handle edits are validated; QA site tooling refuses real members; qa_ prefix is reserved', async () => {
    const sysop = await login(sb.base, ADMIN_EMAIL);
    const H = { ...bearer(sysop.token), 'x-neogram-sysop-op': '1' };
    const victim = await login(sb.base, 'erin@test.local');

    for (const handle of ['<img src=x onerror=alert(1)>', 'a', 'Has Spaces', bob.handle, 'qa_erin']) {
      const r = await fetch(`${sb.base}/api/admin/users/${victim.userId}/profile`, { method: 'POST', headers: H, body: JSON.stringify({ handle }) });
      assert.ok(r.status >= 400, `handle ${handle} must be refused (got ${r.status})`);
    }
    const ok = await fetch(`${sb.base}/api/admin/users/${victim.userId}/profile`, { method: 'POST', headers: H, body: JSON.stringify({ handle: 'erin-renamed' }) });
    assert.equal(ok.status, 200);

    const qaSites = await fetch(`${sb.base}/api/admin/qa-fleet/${victim.userId}/sites`, {
      method: 'POST', headers: H,
      body: JSON.stringify({ name: 'hijack', slug: 'hijack', siteUrl: 'https://evil.example.test', apiKey: 'attacker-key' }),
    });
    assert.equal(qaSites.status, 404, 'QA site tooling must not touch real members');

    const selfQa = await fetch(`${sb.base}/api/settings/profile`, { method: 'POST', headers: bearer(victim.token), body: JSON.stringify({ handle: 'qa_alice' }) });
    assert.equal(selfQa.status, 400, 'members cannot claim the reserved qa_ prefix');

    const { generateUniqueHandle } = await import('../auth/service');
    assert.ok(!(await generateUniqueHandle('qa_mallory')).startsWith('qa_'), 'auto-generated handles never get the qa_ prefix');
  });

  test('PUT /api/posts/:id rejects non-string fields and caps lengths', async () => {
    const { savePost, getPostsForUser } = await import('../services/postStorage');
    const id = crypto.randomUUID();
    await savePost({ id, userId: alice.userId, imagePath: '/uploads/images/y.webp', thumbnailPath: '/uploads/thumbs/y.webp', caption: 'orig', filterApplied: 'none', likes: 0, createdAt: new Date().toISOString(), comments: [] } as any);

    const bad = await fetch(`${sb.base}/api/posts/${id}`, { method: 'PUT', headers: bearer(alice.token), body: JSON.stringify({ caption: { evil: true } }) });
    assert.equal(bad.status, 400);

    const long = await fetch(`${sb.base}/api/posts/${id}`, { method: 'PUT', headers: bearer(alice.token), body: JSON.stringify({ caption: 'x'.repeat(5000), mood: 'm'.repeat(500) }) });
    assert.equal(long.status, 200, await long.clone().text());
    const saved = (await getPostsForUser(alice.userId)).find((p) => p.id === id)!;
    assert.equal(saved.caption.length, 1000);
    assert.equal(String(saved.mood).length, 50);

    const foreign = await fetch(`${sb.base}/api/posts/${id}`, { method: 'PUT', headers: bearer(bob.token), body: JSON.stringify({ caption: 'hijack' }) });
    assert.ok(foreign.status >= 400, "another user cannot edit alice's post");
  });
});

describe('Email local-part is never an identifier', () => {
  test('profiles / chat status do not resolve by email prefix, and handles cannot be NULL', async () => {
    const frank = await login(sb.base, 'frank.secret@test.local');
    const rename = await fetch(`${sb.base}/api/settings/profile`, { method: 'POST', headers: bearer(frank.token), body: JSON.stringify({ handle: 'frank-public' }) });
    assert.equal(rename.status, 200, await rename.clone().text());

    assert.equal((await fetch(`${sb.base}/user/frank.secret`)).status, 404, 'email local-part must not resolve a profile');
    assert.equal((await fetch(`${sb.base}/api/chat/status/frank.secret`, { headers: JSON_H })).status, 404);
    assert.equal((await fetch(`${sb.base}/user/frank-public`)).status, 200, 'the public handle still resolves');

    await assert.rejects(
      q(`INSERT INTO users (email, handle) VALUES ('nohandle@test.local', NULL)`),
      'users.handle is NOT NULL'
    );
  });
});

describe('Federated feed field allowlist', () => {
  test('only known, type-coerced fields from a remote feed.json reach Neogram responses', async () => {
    const { aggregateFederatedFriendsFeed } = await import('../services/federatedFriends');
    const hostileFeed = {
      version: '1',
      user: { handle: 'impostor', uin: 1, avatarUrl: 'javascript:alert(1)' },
      posts: [{
        id: 'p-hostile',
        userId: alice.userId,
        siteId: 'victim-site',
        caption: 'hi',
        likes: '<img src=x onerror=alert(1)>',
        filter: 'crt" onmouseover="alert(1)',
        createdAt: 'not a date',
        imageUrl: 'https://friend.example.test/uploads/images/a.webp',
        photos: [{ imageUrl: 'javascript:alert(1)' }, { imageUrl: 'https://friend.example.test/uploads/images/b.webp' }],
        comments: [{ author: 'x', text: '<script>alert(1)</script>' }],
        __proto__evil: { polluted: true },
        adminNote: 'should not be echoed',
      }],
    };
    const mock = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(hostileFeed));
    });
    await new Promise<void>((r) => mock.listen(0, '127.0.0.1', () => r()));
    const port = (mock.address() as AddressInfo).port;
    try {
      const posts: any[] = await aggregateFederatedFriendsFeed(
        [{ id: bob.userId, handle: bob.handle, uin: 4242, avatarPath: '', siteUrl: `http://127.0.0.1:${port}`, deployPath: '' } as any],
        10
      );
      const post = posts.find((p) => p.id === 'p-hostile');
      assert.ok(post, 'hostile post still listed (content is fine, fields are not)');
      assert.equal(post.likes, 0);
      assert.equal(post.filter, 'none');
      assert.equal(post.author, bob.handle, 'identity comes from the local friend record');
      assert.equal(post.authorUin, 4242);
      for (const key of ['userId', 'siteId', 'comments', 'adminNote', '__proto__evil']) {
        assert.equal(Object.prototype.hasOwnProperty.call(post, key), false, `${key} must not be copied`);
      }
      assert.deepEqual(post.photos.map((ph: any) => ph.imageUrl), ['https://friend.example.test/uploads/images/b.webp']);
      assert.ok(!Number.isNaN(Date.parse(post.createdAt)));
    } finally {
      mock.close();
    }
  });
});

describe('Client-side sinks for handles and numeric ids', () => {
  test('NIM clients escape quotes; workstation & photo pages never splice raw uin / ids into markup or inline JS', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const { REPO_ROOT } = await import('./helpers/sandbox');
    const read = (rel: string) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

    for (const rel of ['public/js/aimMessenger.js', 'extension/popup/popup.js']) {
      const src = read(rel);
      assert.ok(!/div\.textContent = str;\s*return div\.innerHTML;/.test(src), `${rel}: escapeHtml must escape quotes`);
      assert.ok(!/Conversation opened with @' \+ buddy\.handle/.test(src), `${rel}: buddy handle must be escaped`);
    }
    assert.ok(!/New IM from @' \+ fromHandle/.test(read('public/js/aimMessenger.js')));

    const index = read('views/index.njk');
    assert.ok(!/\[#' \+ (entry|c)\.uin/.test(index), 'index.njk: uin must be digit-checked');
    assert.ok(!/onclick="(deleteGuestbookEntry|purgeComment|toggleFollowUser)\(\\'' \+/.test(index), 'index.njk: no ids spliced into inline JS');
    assert.ok(!/\[#' \+ c\.uin/.test(read('eleventy/src/photo.njk')), 'photo.njk: uin must be digit-checked');
  });
});
