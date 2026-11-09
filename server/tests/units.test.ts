import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { AddressInfo } from 'net';
import { isPrivateAddress, validatePublicUrl, isSafePublicUrl, safeGet, SsrfBlockedError } from '../utils/safeFetch';
import { encryptCredentials, decryptCredentials } from '../utils/crypto';
import { Mutex, writeFileAtomic } from '../utils/atomicFile';
import { config } from '../config';

describe('safeFetch: isPrivateAddress', () => {
  const privateIps = [
    '10.0.0.1',
    '169.254.169.254',
    '172.16.0.1',
    '192.168.1.1',
    '100.64.0.1',
    '::1',
    'fc00::1',
    'fe80::1',
    '::ffff:10.0.0.1',
  ];

  for (const ip of privateIps) {
    test(`blocks private address: ${ip}`, () => {
      assert.equal(isPrivateAddress(ip), true, `${ip} must be identified as private`);
    });
  }

  const publicIps = ['8.8.8.8', '2606:4700::1111'];
  for (const ip of publicIps) {
    test(`allows public address: ${ip}`, () => {
      assert.equal(isPrivateAddress(ip), false, `${ip} must be identified as public`);
    });
  }
});

describe('safeFetch: validatePublicUrl in production mode', () => {
  test('enforces strict public https rules in production', () => {
    const originalEnv = config.env;
    try {
      (config as any).env = 'production';

      // Valid public https
      const valid = validatePublicUrl('https://example.com/feed.json');
      assert.equal(valid.protocol, 'https:');
      assert.equal(valid.hostname, 'example.com');
      assert.equal(isSafePublicUrl('https://example.com/feed.json'), true);

      // http rejected in production
      assert.throws(() => validatePublicUrl('http://example.com/feed.json'), SsrfBlockedError);
      assert.equal(isSafePublicUrl('http://example.com/feed.json'), false);

      // credentials rejected
      assert.throws(() => validatePublicUrl('https://user:pass@example.com/feed.json'), SsrfBlockedError);
      assert.equal(isSafePublicUrl('https://user:pass@example.com/feed.json'), false);

      // localhost rejected
      assert.throws(() => validatePublicUrl('https://localhost/feed.json'), SsrfBlockedError);
      assert.throws(() => validatePublicUrl('https://test.local/feed.json'), SsrfBlockedError);
      assert.equal(isSafePublicUrl('https://localhost/feed.json'), false);

      // IP literals / loopback rejected
      assert.throws(() => validatePublicUrl('https://127.0.0.1/feed.json'), SsrfBlockedError);
      assert.throws(() => validatePublicUrl('https://10.0.0.1/feed.json'), SsrfBlockedError);
      assert.throws(() => validatePublicUrl('https://169.254.169.254/latest/meta-data/'), SsrfBlockedError);
    } finally {
      (config as any).env = originalEnv;
    }
  });
});

describe('safeFetch: safeGet against mock HTTP server', () => {
  let mockServer: http.Server;
  let baseUrl: string;

  test('setup mock server', async () => {
    mockServer = http.createServer((req, res) => {
      if (req.url === '/json') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, source: 'mock' }));
      } else if (req.url === '/big') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('A'.repeat(500));
      } else if (req.url === '/redirect-ssrf') {
        res.writeHead(302, { Location: 'http://169.254.169.254/' });
        res.end();
      } else if (req.url?.startsWith('/loop/')) {
        const count = parseInt(req.url.split('/')[2] || '0', 10);
        res.writeHead(302, { Location: `/loop/${count + 1}` });
        res.end();
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    await new Promise<void>((resolve) => {
      mockServer.listen(0, '127.0.0.1', () => resolve());
    });
    const port = (mockServer.address() as AddressInfo).port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  test('returns JSON in dev mode for valid local endpoint', async () => {
    const res = await safeGet(`${baseUrl}/json`);
    assert.equal(res.ok, true);
    assert.equal(res.status, 200);
    const data = res.json();
    assert.equal(data.ok, true);
    assert.equal(data.source, 'mock');
  });

  test('oversized body throws SsrfBlockedError', async () => {
    await assert.rejects(
      async () => {
        await safeGet(`${baseUrl}/big`, { maxBytes: 100 });
      },
      (err: any) => err instanceof SsrfBlockedError && err.message.includes('too large')
    );
  });

  test('302 redirect to link-local / metadata is blocked', async () => {
    await assert.rejects(
      async () => {
        await safeGet(`${baseUrl}/redirect-ssrf`);
      },
      (err: any) => err instanceof SsrfBlockedError
    );
  });

  test('more than 3 redirects throws SsrfBlockedError', async () => {
    await assert.rejects(
      async () => {
        await safeGet(`${baseUrl}/loop/0`);
      },
      (err: any) => err instanceof SsrfBlockedError && err.message.includes('Too many redirects')
    );
  });

  test('teardown mock server', async () => {
    await new Promise<void>((resolve) => {
      mockServer.close(() => resolve());
    });
  });
});

describe('crypto: credential vault encryption & rotation', () => {
  const secretA = 'test-secret-alpha-0123456789-abcdef';
  const secretB = 'test-secret-bravo-9876543210-fedcba';

  test('v2 round trip has NGv2 prefix and decrypts', () => {
    const originalSecret = config.encryptionSecret;
    try {
      (config as any).encryptionSecret = secretA;
      const data = { apiKey: 'nc_live_1234567890', siteName: 'my-site' };
      const encrypted = encryptCredentials(data);

      assert.equal(encrypted.subarray(0, 4).toString('utf8'), 'NGv2');
      const decrypted = decryptCredentials<typeof data>(encrypted);
      assert.deepEqual(decrypted, data);
    } finally {
      (config as any).encryptionSecret = originalSecret;
    }
  });

  test('legacy v1 buffer ([iv][tag][ct] with sha256(secret) key) still decrypts', () => {
    const originalSecret = config.encryptionSecret;
    try {
      (config as any).encryptionSecret = secretA;
      const key = crypto.createHash('sha256').update(secretA).digest();
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const plaintext = JSON.stringify({ apiKey: 'legacy-key-v1' });
      const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      const tag = cipher.getAuthTag();

      // Legacy v1 layout: [iv (12)][tag (16)][ciphertext]
      const legacyBuf = Buffer.concat([iv, tag, ct]);

      const decrypted = decryptCredentials<{ apiKey: string }>(legacyBuf);
      assert.deepEqual(decrypted, { apiKey: 'legacy-key-v1' });
    } finally {
      (config as any).encryptionSecret = originalSecret;
    }
  });

  test('secret rotation: data encrypted under secret A decrypts when secret A is previous', () => {
    const origCurr = config.encryptionSecret;
    const origPrev = config.encryptionSecretPrevious;
    try {
      // 1. Encrypt under secret A
      (config as any).encryptionSecret = secretA;
      (config as any).encryptionSecretPrevious = undefined;
      const encrypted = encryptCredentials({ apiKey: 'rotatable-token-123' });

      // 2. Rotate to secret B with secret A as previous
      (config as any).encryptionSecret = secretB;
      (config as any).encryptionSecretPrevious = secretA;

      const decrypted = decryptCredentials<{ apiKey: string }>(encrypted);
      assert.deepEqual(decrypted, { apiKey: 'rotatable-token-123' });
    } finally {
      (config as any).encryptionSecret = origCurr;
      (config as any).encryptionSecretPrevious = origPrev;
    }
  });

  test('wrong key returns null', () => {
    const origCurr = config.encryptionSecret;
    const origPrev = config.encryptionSecretPrevious;
    try {
      (config as any).encryptionSecret = secretA;
      (config as any).encryptionSecretPrevious = undefined;
      const encrypted = encryptCredentials({ apiKey: 'super-secret' });

      (config as any).encryptionSecret = secretB;
      (config as any).encryptionSecretPrevious = undefined;
      const decrypted = decryptCredentials(encrypted);
      assert.equal(decrypted, null);
    } finally {
      (config as any).encryptionSecret = origCurr;
      (config as any).encryptionSecretPrevious = origPrev;
    }
  });

  test('tampered ciphertext returns null', () => {
    const origCurr = config.encryptionSecret;
    try {
      (config as any).encryptionSecret = secretA;
      const encrypted = encryptCredentials({ apiKey: 'untampered' });
      // Flip the last byte
      encrypted[encrypted.length - 1] ^= 0xff;
      const decrypted = decryptCredentials(encrypted);
      assert.equal(decrypted, null);
    } finally {
      (config as any).encryptionSecret = origCurr;
    }
  });
});

describe('atomicFile: Mutex and writeFileAtomic', () => {
  test('Mutex executes async tasks strictly in order', async () => {
    const mutex = new Mutex();
    const executionOrder: number[] = [];

    const task = (id: number, delayMs: number) => async () => {
      await new Promise((r) => setTimeout(r, delayMs));
      executionOrder.push(id);
      return id;
    };

    // Dispatch three tasks with inverse delays
    const p1 = mutex.run(task(1, 40));
    const p2 = mutex.run(task(2, 20));
    const p3 = mutex.run(task(3, 5));

    await Promise.all([p1, p2, p3]);
    assert.deepEqual(executionOrder, [1, 2, 3], 'tasks must execute sequentially');
  });

  test('writeFileAtomic writes atomically and leaves no tmp files', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'neogram-atomic-test-'));
    try {
      const targetPath = path.join(tmpDir, 'feed.json');
      const payload = JSON.stringify({ version: '1.0', posts: [1, 2, 3] }, null, 2);

      await writeFileAtomic(targetPath, payload);

      // Verify file content
      const content = fs.readFileSync(targetPath, 'utf8');
      assert.equal(content, payload);

      // Verify no leftover .tmp files
      const remainingFiles = fs.readdirSync(tmpDir);
      assert.deepEqual(remainingFiles, ['feed.json']);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('staticStorage: getCounterRelativePath', () => {
  test('resolves relative path for counter snapshot in data/ directory', async () => {
    const { getCounterRelativePath, getGuestbookRelativePath } = await import('../services/staticStorage');
    assert.equal(getCounterRelativePath(), 'data/counter.json');
    assert.equal(getGuestbookRelativePath(), 'data/guestbook.json');
  });

  test('appendGuestbookEntry stores and preserves visitorNumber milestone', async () => {
    const { appendGuestbookEntry } = await import('../services/staticStorage');
    const mockUser = {
      id: 'test-user-' + Date.now(),
      handle: 'cyber_voyager',
      deploy_path: 'neogram',
    };

    const entry = await appendGuestbookEntry(mockUser, {
      visitorName: 'GuestSurfer',
      message: 'Greetings from the retro web!',
      visitorNumber: 1337,
    });

    assert.equal(entry.visitorName, 'GuestSurfer');
    assert.equal(entry.visitorNumber, 1337);

    // Clean up test files
    const localDir = path.join(process.cwd(), 'dist/static-galleries', mockUser.id);
    fs.rmSync(localDir, { recursive: true, force: true });
  });
});
