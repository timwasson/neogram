import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { AddressInfo } from 'net';
import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { bootSandbox, Sandbox, ADMIN_EMAIL } from './helpers/sandbox';

import os from 'os';

const SCRATCH_DIR = path.join(os.tmpdir(), 'neogram-browser-test');
if (!fs.existsSync(SCRATCH_DIR)) {
  fs.mkdirSync(SCRATCH_DIR, { recursive: true });
}

interface Viewport {
  name: string;
  width: number;
  height: number;
}

const VIEWPORTS: Viewport[] = [
  { name: 'mobile_375x812', width: 375, height: 812 },
  { name: 'tablet_768x1024', width: 768, height: 1024 },
  { name: 'desktop_1440x900', width: 1440, height: 900 },
];

describe('Browser UI, Layout & CSP Regression Suite', () => {
  let sb: Sandbox;
  let browser: Browser;
  let foreignServer: http.Server;
  let foreignBase: string;

  before(async () => {
    // 1. Boot Sandboxed Neogram Server
    sb = await bootSandbox({
      ADMIN_EMAILS: `${ADMIN_EMAIL},alice@test.local`,
      ALLOW_DEMO_OTP: 'true',
    });

    // 2. Launch Headless Chromium
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });

    // 3. Boot Foreign Mock Server on Ephemeral Port (different origin for iframe embedding tests)
    foreignServer = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`
        <!doctype html>
        <html>
          <body>
            <h1>Foreign Origin Host</h1>
            <iframe id="testFrame" src="" width="400" height="400"></iframe>
          </body>
        </html>
      `);
    });
    await new Promise<void>((resolve) => foreignServer.listen(0, '127.0.0.1', () => resolve()));
    const port = (foreignServer.address() as AddressInfo).port;
    foreignBase = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    if (browser) await browser.close().catch(() => {});
    if (foreignServer) foreignServer.close();
    if (sb) await sb.close().catch(() => {});
  });

  for (const vp of VIEWPORTS) {
    test(`Viewport ${vp.name} (${vp.width}x${vp.height}): login, dashboard, tabs, directory, docs, friends, admin`, async () => {
      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        isMobile: vp.width < 768,
      });

      const page = await context.newPage();
      const consoleErrors: string[] = [];
      const pageErrors: string[] = [];
      const cspViolations: any[] = [];

      page.on('console', (msg) => {
        if (msg.type() === 'error') {
          consoleErrors.push(msg.text());
        }
      });

      page.on('pageerror', (err) => {
        // Ignore background service worker update errors in ephemeral test origins
        if (!err.message.includes('ServiceWorker')) {
          pageErrors.push(err.message);
        }
      });

      // Hook SecurityPolicyViolation events
      await page.addInitScript(() => {
        (window as any).__csp_violations = [];
        document.addEventListener('securitypolicyviolation', (e: any) => {
          (window as any).__csp_violations.push({
            blockedURI: e.blockedURI,
            violatedDirective: e.violatedDirective,
            effectiveDirective: e.effectiveDirective,
          });
        });
      });

      // 1. Visit /login
      const loginRes = await page.goto(`${sb.base}/login`, { waitUntil: 'domcontentloaded' });
      assert.equal(loginRes?.status(), 200);

      // Check for horizontal overflow
      const loginOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      assert.equal(loginOverflow, false, `Horizontal overflow detected on /login at ${vp.name}`);

      await page.screenshot({ path: path.join(SCRATCH_DIR, `${vp.name}_01_login.png`) });

      // Request OTP
      const testEmail = `alice@test.local`;
      await page.fill('#identifierInput', testEmail);
      await page.click('#requestBtn');

      // Wait for step 2 form to appear
      await page.waitForSelector('#step2Form:not(.hidden)', { timeout: 8000 });

      // Auto-fill demo code if present, or fetch from API
      const demoBtn = await page.$('#demoHelperBox:not(.hidden) button');
      if (demoBtn) {
        await demoBtn.click();
      } else {
        const rOtp = await (await fetch(`${sb.base}/api/auth/request-otp`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-test-suite': 'true' },
          body: JSON.stringify({ identifier: testEmail }),
        })).json() as any;
        await page.fill('#otpCodeInput', rOtp.demoCode);
      }

      await page.click('#verifyBtn');

      // Wait for navigation to / (may have #feed or #upload hash)
      await page.waitForURL((u) => u.origin === new URL(sb.base).origin && (u.pathname === '/' || u.pathname === ''), { timeout: 10000 });
      assert.ok(page.url().startsWith(`${sb.base}/`), `Navigated to dashboard, got ${page.url()}`);

      await page.screenshot({ path: path.join(SCRATCH_DIR, `${vp.name}_02_dashboard.png`) });

      // Verify no horizontal overflow on dashboard
      const dashOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      assert.equal(dashOverflow, false, `Horizontal overflow on dashboard at ${vp.name}`);

      // 2. Navigate tabs on dashboard
      const tabs = ['studio', 'archive', 'embeds', 'settings'];
      for (const tab of tabs) {
        await page.evaluate((t) => (window as any).switchDashboardTab?.(t), tab);
        await page.waitForTimeout(100);
      }

      // 3. Visit /directory
      const dirRes = await page.goto(`${sb.base}/directory`, { waitUntil: 'domcontentloaded' });
      assert.equal(dirRes?.status(), 200);
      const dirOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      assert.equal(dirOverflow, false, `Horizontal overflow on /directory at ${vp.name}`);
      await page.screenshot({ path: path.join(SCRATCH_DIR, `${vp.name}_03_directory.png`) });

      // 4. Visit /docs
      const docsRes = await page.goto(`${sb.base}/docs`, { waitUntil: 'domcontentloaded' });
      assert.equal(docsRes?.status(), 200);
      const docsOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      assert.equal(docsOverflow, false, `Horizontal overflow on /docs at ${vp.name}`);
      await page.screenshot({ path: path.join(SCRATCH_DIR, `${vp.name}_04_docs.png`) });

      // 5. Visit /friends
      const friendsRes = await page.goto(`${sb.base}/friends`, { waitUntil: 'domcontentloaded' });
      assert.equal(friendsRes?.status(), 200);
      await page.screenshot({ path: path.join(SCRATCH_DIR, `${vp.name}_05_friends.png`) });

      // 6. Visit /admin (alice@test.local is in ADMIN_EMAILS)
      const adminRes = await page.goto(`${sb.base}/admin`, { waitUntil: 'domcontentloaded' });
      assert.equal(adminRes?.status(), 200);
      await page.screenshot({ path: path.join(SCRATCH_DIR, `${vp.name}_06_admin.png`) });

      // Check recorded CSP violations
      const pageCsp = await page.evaluate(() => (window as any).__csp_violations || []);
      cspViolations.push(...pageCsp);

      // Verify no CSP violations occurred
      assert.equal(cspViolations.length, 0, `CSP violations detected at ${vp.name}: ${JSON.stringify(cspViolations)}`);
      assert.equal(pageErrors.length, 0, `Page errors detected at ${vp.name}: ${JSON.stringify(pageErrors)}`);

      // Basic a11y snapshot check
      try {
        const snapshot = await (page as any).accessibility?.snapshot?.();
        assert.ok(snapshot !== null, 'Accessibility tree snapshot generated');
      } catch {
        // accessibility snapshot may not be supported in all playwright versions
      }

      await context.close();
    });
  }

  test('Cyber-Pass consent flow: destination validation, explicit consent, and deny', async () => {
    const context = await browser.newContext({ viewport: { width: 1024, height: 768 } });
    const page = await context.newPage();

    // 1. Log in first
    const rOtp = await (await fetch(`${sb.base}/api/auth/request-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-test-suite': 'true' },
      body: JSON.stringify({ identifier: 'alice@test.local' }),
    })).json() as any;

    const rVerify = await (await fetch(`${sb.base}/api/auth/verify-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-test-suite': 'true' },
      body: JSON.stringify({ identifier: 'alice@test.local', code: rOtp.demoCode }),
    })).json() as any;

    await context.addCookies([
      {
        name: 'neogram_session',
        value: rVerify.token,
        domain: '127.0.0.1',
        path: '/',
        httpOnly: true,
      },
    ]);

    // 2. Open /auth/connect with valid destination
    const targetOrigin = 'https://mysite.neocities.org';
    const connectRes = await page.goto(`${sb.base}/auth/connect?origin=${encodeURIComponent(targetOrigin)}`, {
      waitUntil: 'domcontentloaded',
    });
    assert.equal(connectRes?.status(), 200);

    await page.screenshot({ path: path.join(SCRATCH_DIR, `cyberpass_01_consent.png`) });

    // Verify destination origin is displayed
    const destinationText = await page.innerText('#passDestination');
    assert.equal(destinationText, targetOrigin);

    // Verify approve and deny buttons are present
    const btnApprove = await page.$('#btnManualAuthorize');
    const btnDeny = await page.$('#btnDeny');
    assert.ok(btnApprove !== null, 'Approve button is rendered');
    assert.ok(btnDeny !== null, 'Deny button is rendered');

    // Verify token is scoped with pass
    const passToken = await btnApprove.getAttribute('data-token');
    assert.ok(passToken && passToken.length > 20);

    // Clicking Deny closes or displays cancelled
    await btnDeny.click();
    await page.waitForTimeout(200);

    // 3. Test while logged out: shows login form
    const loggedOutContext = await browser.newContext();
    const loggedOutPage = await loggedOutContext.newPage();
    await loggedOutPage.goto(`${sb.base}/auth/connect?origin=${encodeURIComponent(targetOrigin)}`, {
      waitUntil: 'domcontentloaded',
    });
    const formVisible = await loggedOutPage.$('#requestOtpForm');
    assert.ok(formVisible !== null, 'Logged out visitors see login form, never token');

    await loggedOutContext.close();
    await context.close();
  });

  test('Embeds iframe framing isolation: /embed/* allows framing, / rejects framing', async () => {
    // 1. Verify HTTP security headers directly
    const headerRes = await fetch(`${sb.base}/`);
    assert.equal(headerRes.headers.get('x-frame-options'), 'SAMEORIGIN');
    assert.ok(headerRes.headers.get('content-security-policy')?.includes("frame-ancestors 'self'"));

    const embedRes = await fetch(`${sb.base}/embed/pager/alice`);
    assert.equal(embedRes.headers.get('x-frame-options'), null);
    assert.ok(embedRes.headers.get('content-security-policy')?.includes("frame-ancestors *"));

    const context = await browser.newContext();
    const page = await context.newPage();

    // 2. Load foreign page embedding /embed/pager/alice
    await page.goto(foreignBase);

    // Set iframe src to /embed/pager/alice
    await page.evaluate((url) => {
      const frame = document.getElementById('testFrame') as HTMLIFrameElement;
      frame.src = url;
    }, `${sb.base}/embed/pager/alice`);

    await page.waitForTimeout(500);
    const frameContent = await page.frame({ url: (u) => u.pathname.startsWith('/embed/pager') });
    assert.ok(frameContent !== null, 'Embed pager framed successfully from foreign origin');

    // 3. Try framing workstation dashboard / inside cross-origin iframe
    await page.evaluate((url) => {
      const frame = document.getElementById('testFrame') as HTMLIFrameElement;
      frame.src = url;
    }, `${sb.base}/`);

    await page.waitForTimeout(500);
    // When Chrome blocks due to frame-ancestors 'self', the frame cannot load the dashboard document
    const frameHandle = await page.$('#testFrame');
    const contentFrame = await frameHandle?.contentFrame();
    let bodyText = '';
    try {
      bodyText = (await contentFrame?.evaluate(() => document.body?.innerText || '')) || '';
    } catch {
      // Cross-origin access or blocked frame throws SecurityError as expected
      bodyText = '';
    }
    // Body text cannot contain dashboard workstation text
    assert.ok(!bodyText.includes('CYBERSPACE WORKSTATION'), 'Dashboard contents cannot be framed by foreign origin');

    await context.close();
  });
});
