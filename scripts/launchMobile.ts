import { chromium, devices } from 'playwright';
import { signSessionToken } from '../server/auth/jwt';

async function main() {
  const token = signSessionToken({
    userId: '08a2394b-bdfd-42bf-a5f6-44bbe565ee17',
    email: 'wasson@gmail.com',
    handle: 'wasson',
    uin: 100103,
  });

  const device = devices['iPhone 14'];

  const browser = await chromium.launch({
    headless: false,
    channel: 'chrome',
    args: [
      '--window-size=430,932',
      '--no-default-browser-check',
      '--no-first-run',
    ],
  });

  const context = await browser.newContext({
    ...device,
  });

  await context.addCookies([
    {
      name: 'neogram_session',
      value: token,
      domain: '127.0.0.1',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    },
    {
      name: 'neogram_session',
      value: token,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);

  const page = await context.newPage();
  await page.goto('http://127.0.0.1:4000/#upload', { waitUntil: 'domcontentloaded' });

  console.log('[:> MOBILE BROWSER ONLINE] Successfully launched Chrome in mobile mode (iPhone 14) logged in as administrator @wasson on Upload Studio.');

  await new Promise<void>((resolve) => {
    page.on('close', () => resolve());
    browser.on('disconnected', () => resolve());
  });

  console.log('[:> BROWSER CLOSED] Window closed by user.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Launch error:', err);
  process.exit(1);
});

