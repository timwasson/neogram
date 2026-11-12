/**
 * Hermetic test sandbox.
 *
 * - chdir()s into a throw-away temp directory (symlinking the read-only app assets) so NOTHING is
 *   written to the real dist/ or public/uploads and NO .env (real secrets / real DATABASE_URL) is loaded.
 * - Forces the in-memory pg-mem database.
 * - Boots the real Express app on an ephemeral port.
 *
 * MUST be imported (and `bootSandbox()` awaited) BEFORE any server module, because server config reads
 * process.env / process.cwd() at import time. Server modules are therefore imported dynamically.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import dns from 'dns';
import { AddressInfo } from 'net';

export const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');

export interface Sandbox {
  base: string;
  dir: string;
  close(): Promise<void>;
}

export const ADMIN_EMAIL = 'sysop@test.local';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
let networkGuardInstalled = false;

/**
 * Blocks every outbound network call that is not loopback, so the hermetic suites can never reach
 * neogram.club, Neocities, Nekoweb, picsum.photos or any other real host (DNS included).
 * Opt out with NEOGRAM_TEST_ALLOW_NETWORK=true for the explicitly-live suites.
 */
function installNetworkGuard(): void {
  if (networkGuardInstalled || process.env.NEOGRAM_TEST_ALLOW_NETWORK === 'true') return;
  networkGuardInstalled = true;

  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: any, init?: any) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url;
    const host = new URL(String(raw)).hostname;
    if (!LOOPBACK_HOSTS.has(host)) {
      throw new TypeError(`fetch failed: [hermetic sandbox] outbound request to ${host} blocked`);
    }
    return realFetch(input, init);
  }) as typeof fetch;

  const blocked = (hostname: string) => {
    const err: NodeJS.ErrnoException = new Error(`[hermetic sandbox] DNS lookup for ${hostname} blocked`);
    err.code = 'ENOTFOUND';
    return err;
  };
  const realLookup = dns.lookup;
  (dns as any).lookup = (hostname: string, options: any, callback?: any) => {
    const cb = typeof options === 'function' ? options : callback;
    if (!LOOPBACK_HOSTS.has(hostname)) {
      process.nextTick(() => cb(blocked(hostname)));
      return;
    }
    return (realLookup as any)(hostname, options, callback);
  };
  const realPromiseLookup = dns.promises.lookup;
  (dns.promises as any).lookup = async (hostname: string, options?: any) => {
    if (!LOOPBACK_HOSTS.has(hostname)) throw blocked(hostname);
    return (realPromiseLookup as any)(hostname, options);
  };
}

export async function bootSandbox(extraEnv: Record<string, string> = {}): Promise<Sandbox> {
  installNetworkGuard();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neogram-test-'));
  for (const name of ['views', 'eleventy', 'embed', 'extension']) {
    fs.symlinkSync(path.join(REPO_ROOT, name), path.join(dir, name));
  }
  // public/: assets are linked, uploads are private to the sandbox
  fs.mkdirSync(path.join(dir, 'public', 'uploads'), { recursive: true });
  for (const name of ['css', 'js', 'icons', 'sw.js', 'manifest.json', 'offline.html']) {
    const src = path.join(REPO_ROOT, 'public', name);
    if (fs.existsSync(src)) fs.symlinkSync(src, path.join(dir, 'public', name));
  }
  fs.mkdirSync(path.join(dir, 'dist', 'static-galleries'), { recursive: true });
  process.chdir(dir);

  Object.assign(process.env, {
    NODE_ENV: 'development',
    DATABASE_URL: '',
    USE_MEMORY_DB: 'true',
    JWT_SECRET: 'test-jwt-secret-0123456789-0123456789-abcdef',
    ENCRYPTION_SECRET: 'test-encryption-secret-0123456789-abcdef-xyz',
    ALLOW_DEMO_OTP: 'true',
    ADMIN_EMAILS: ADMIN_EMAIL,
    APP_URL: 'http://localhost:4000',
    RESEND_API_KEY: '',
    TWILIO_ACCOUNT_SID: '',
    TWILIO_AUTH_TOKEN: '',
    ...extraEnv,
  });

  const { initDatabase } = await import('../../db');
  await initDatabase();
  const { createApp } = await import('../../app');
  const app = createApp();
  const server: http.Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as AddressInfo).port;

  return {
    base: `http://127.0.0.1:${port}`,
    dir,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          try {
            process.chdir(REPO_ROOT);
            fs.rmSync(dir, { recursive: true, force: true });
          } catch {
            /* best effort */
          }
          resolve();
        });
        (server as any).closeAllConnections?.();
      }),
  };
}

export interface Session {
  email: string;
  userId: string;
  handle: string;
  token: string;
  cookie: string;
}

/** Full OTP login against a running sandbox (uses the test-suite header to skip IP rate limits). */
export async function login(base: string, email: string): Promise<Session> {
  const h = { 'Content-Type': 'application/json', 'x-test-suite': 'true' };
  const r1 = await fetch(`${base}/api/auth/request-otp`, { method: 'POST', headers: h, body: JSON.stringify({ identifier: email }) });
  const j1: any = await r1.json();
  if (!j1.demoCode) throw new Error(`No demoCode returned for ${email}: ${JSON.stringify(j1)}`);
  const r2 = await fetch(`${base}/api/auth/verify-otp`, { method: 'POST', headers: h, body: JSON.stringify({ identifier: email, code: j1.demoCode }) });
  const j2: any = await r2.json();
  if (!j2.ok) throw new Error(`Login failed for ${email}: ${JSON.stringify(j2)}`);
  const setCookie = r2.headers.getSetCookie().find((c) => c.startsWith('neogram_session=')) || '';
  return {
    email,
    userId: j2.user.id,
    handle: j2.user.handle,
    token: j2.token,
    cookie: setCookie.split(';')[0],
  };
}
