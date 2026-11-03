import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import sharp from 'sharp';

export const GREEN = '\x1b[32m';
export const RED = '\x1b[31m';
export const YELLOW = '\x1b[33m';
export const CYAN = '\x1b[36m';
export const MAGENTA = '\x1b[35m';
export const RESET = '\x1b[0m';
export const BOLD = '\x1b[1m';

export interface QaSite {
  id: string;
  name: string;
  slug: string;
  siteUrl: string;
  deploymentType: string;
  deployPath: string;
  buildHtml: boolean;
  autoDeploy: boolean;
  hasApiKey: boolean;
  isDefault: boolean;
}

export interface QaAgent {
  userId: string;
  handle: string;
  email: string;
  uin: number;
  token: string;
  cookie: string;
  sites: QaSite[];
}

export interface QaFleet {
  baseUrl: string;
  isLocal: boolean;
  agents: QaAgent[];
  alice: QaAgent;
  bob: QaAgent;
  friend: QaAgent;
  surfer: QaAgent;
  headless: QaAgent;
}

export interface PollOptions {
  maxAttempts?: number;
  intervalMs?: number;
  cacheBust?: boolean;
  headers?: Record<string, string>;
  validate?: (bodyText: string, status: number, headers: Headers) => boolean;
}

export interface PollResult {
  ok: boolean;
  status: number;
  attempts: number;
  elapsedMs: number;
  body: string;
  contentType: string;
  error?: string;
}

export interface TestRecord {
  category: string;
  name: string;
  status: 'PASS' | 'FAIL' | 'WARN';
  durationMs: number;
  details?: string;
}

/**
 * 1. Session Loader (`loadQaFleet()`)
 * Reads `qa-sessions.json` from `process.cwd()`, resolves `baseUrl`, and extracts named personas.
 * Automatically falls back to local DB provisioning if `--local` or `TARGET_URL=http://localhost:4000` is used
 * and the remote tokens are not valid on the local workstation instance.
 */
export async function loadQaFleet(): Promise<QaFleet> {
  const args = process.argv.slice(2);
  const forceLocal = args.includes('--local');
  const bundlePath = path.resolve(process.cwd(), 'qa-sessions.json');

  let bundle: any = { targetUrl: 'https://neogram.club', agents: [] };
  if (existsSync(bundlePath)) {
    const raw = await fs.readFile(bundlePath, 'utf-8');
    bundle = JSON.parse(raw);
  }

  const resolvedBaseUrl = (
    forceLocal
      ? 'http://localhost:4000'
      : process.env.TARGET_URL || bundle.targetUrl || 'https://neogram.club'
  ).replace(/\/+$/, '');

  const isLocal =
    resolvedBaseUrl.includes('localhost') || resolvedBaseUrl.includes('127.0.0.1');

  let agents: QaAgent[] = Array.isArray(bundle.agents) ? bundle.agents : [];

  // Check if tokens work against the target server; if local and unprovisioned, auto-provision
  let needsProvisioning = agents.length < 5;
  if (!needsProvisioning && isLocal) {
    try {
      const checkRes = await fetch(`${resolvedBaseUrl}/api/auth/me`, {
        headers: { Authorization: `Bearer ${agents[0].token}`, 'X-Test-Suite': 'true' },
      });
      if (checkRes.status !== 200) {
        needsProvisioning = true;
      } else {
        const meData = (await checkRes.json().catch(() => ({}))) as any;
        if (!meData.user) needsProvisioning = true;
      }
    } catch {
      needsProvisioning = true;
    }
  }

  if (needsProvisioning && isLocal) {
    agents = await provisionLocalQaPersonas(resolvedBaseUrl);
  }

  const findByHandle = (handle: string): QaAgent => {
    const clean = handle.replace(/^@/, '').toLowerCase();
    const found = agents.find((a) => a.handle.toLowerCase() === clean);
    if (!found) {
      throw new Error(`Required QA persona "@${clean}" not found in qa-sessions.json fleet.`);
    }
    return found;
  };

  return {
    baseUrl: resolvedBaseUrl,
    isLocal,
    agents,
    alice: findByHandle('qa_alice'),
    bob: findByHandle('qa_bob'),
    friend: findByHandle('qa_friend'),
    surfer: findByHandle('qa_surfer'),
    headless: findByHandle('qa_headless'),
  };
}

/**
 * Helper to auto-provision local QA accounts if running against localhost
 */
async function provisionLocalQaPersonas(baseUrl: string): Promise<QaAgent[]> {
  const specs = [
    {
      handle: 'qa_alice',
      email: 'qa_alice@qa.neogram.club',
      siteName: 'Alice Primary Neocities',
      slug: 'main',
      siteUrl: 'https://chemicalmachine.neocities.org',
      deploymentType: 'neocities',
      buildHtml: true,
    },
    {
      handle: 'qa_bob',
      email: 'qa_bob@qa.neogram.club',
      siteName: 'Bob Nekoweb Station',
      slug: 'neogram',
      siteUrl: 'https://qa-neo-test.nekoweb.org',
      deploymentType: 'nekoweb',
      buildHtml: true,
    },
    {
      handle: 'qa_friend',
      email: 'qa_friend@qa.neogram.club',
      siteName: 'Friend Cascade Receiver',
      slug: 'qa-neogram-1-neocities-org',
      siteUrl: 'https://qa-friend.neocities.org',
      deploymentType: 'neocities',
      buildHtml: true,
    },
    {
      handle: 'qa_headless',
      email: 'qa_headless@qa.neogram.club',
      siteName: 'Headless JSON Feed Target',
      slug: 'qa-neo-test',
      siteUrl: 'https://neogram.nekoweb.org',
      deploymentType: 'nekoweb',
      buildHtml: false,
    },
    {
      handle: 'qa_surfer',
      email: 'qa_surfer@qa.neogram.club',
      siteName: 'Surfer Sandbox Station',
      slug: 'main',
      siteUrl: `${baseUrl}/user/@qa_surfer`,
      deploymentType: 'none',
      buildHtml: true,
    },
  ];

  const provisioned: QaAgent[] = [];

  for (const spec of specs) {
    const otpRes = await fetch(`${baseUrl}/api/auth/request-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Test-Suite': 'true' },
      body: JSON.stringify({ identifier: spec.email }),
    });
    const otpData = (await otpRes.json()) as any;
    const verifyRes = await fetch(`${baseUrl}/api/auth/verify-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Test-Suite': 'true' },
      body: JSON.stringify({ identifier: spec.email, code: otpData.demoCode }),
    });
    const verifyData = (await verifyRes.json()) as any;
    const token = verifyData.token;
    const user = verifyData.user;

    // Ensure handle and site
    await fetch(`${baseUrl}/api/settings/profile`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'X-Test-Suite': 'true',
      },
      body: JSON.stringify({ handle: spec.handle }),
    });

    const sitesRes = await fetch(`${baseUrl}/api/sites`, {
      headers: { Authorization: `Bearer ${token}`, 'X-Test-Suite': 'true' },
    });
    const sitesData = (await sitesRes.json()) as any;
    let sites: QaSite[] = sitesData.sites || [];

    if (sites.length === 0) {
      const createRes = await fetch(`${baseUrl}/api/sites`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'X-Test-Suite': 'true',
        },
        body: JSON.stringify({
          name: spec.siteName,
          slug: spec.slug,
          siteUrl: spec.siteUrl,
          deploymentType: spec.deploymentType,
          deployPath: 'neogram',
          buildHtml: spec.buildHtml,
          autoDeploy: true,
          isDefault: true,
        }),
      });
      const createData = (await createRes.json()) as any;
      if (createData.site) sites = [createData.site];
    }

    provisioned.push({
      userId: user.id,
      handle: spec.handle,
      email: spec.email,
      uin: Number(user.uin),
      token,
      cookie: `neogram_session=${token}`,
      sites,
    });
  }

  return provisioned;
}

/**
 * 2. Test Image Generator (`createTestImageBase64(label, color)`)
 * Uses `sharp` to generate a `600x600` PNG buffer with a distinct RGB background
 * and returns `data:image/png;base64,...`.
 */
export async function createTestImageBase64(
  label: string = 'NEOGRAM_QA_PROBE',
  color: { r: number; g: number; b: number } = { r: 24, g: 160, b: 210 }
): Promise<string> {
  const safeLabel = label.replace(/[<>&"']/g, '').slice(0, 36);
  const svgOverlay = Buffer.from(`
    <svg width="600" height="600" xmlns="http://www.w3.org/2000/svg">
      <rect x="20" y="20" width="560" height="560" fill="none" stroke="#00ffcc" stroke-width="6"/>
      <rect x="40" y="220" width="520" height="160" fill="#000000" fill-opacity="0.78" stroke="#ffcc00" stroke-width="3"/>
      <text x="300" y="285" font-family="monospace" font-size="26" font-weight="bold" fill="#00ffcc" text-anchor="middle">
        [:&gt; NEOGRAM BOT PROBE]
      </text>
      <text x="300" y="335" font-family="monospace" font-size="20" fill="#ffcc00" text-anchor="middle">
        ${safeLabel}
      </text>
    </svg>
  `);

  const pngBuffer = await sharp({
    create: {
      width: 600,
      height: 600,
      channels: 3,
      background: color,
    },
  })
    .composite([{ input: svgOverlay, top: 0, left: 0 }])
    .png()
    .toBuffer();

  return `data:image/png;base64,${pngBuffer.toString('base64')}`;
}

/**
 * 3. Propagation Poller (`pollUntilLive(url, options)`)
 * Polls a target URL up to `maxAttempts` (default 12, interval 1500ms = 18s max window)
 * with cache-busting query `?t=${Date.now()}`.
 */
export async function pollUntilLive(url: string, options: PollOptions = {}): Promise<PollResult> {
  const maxAttempts = options.maxAttempts ?? 12;
  const intervalMs = options.intervalMs ?? 1500;
  const cacheBust = options.cacheBust !== false;
  const startTime = Date.now();

  let lastStatus = 0;
  let lastBody = '';
  let lastContentType = '';
  let lastError: string | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const separator = url.includes('?') ? '&' : '?';
    const probeUrl = cacheBust ? `${url}${separator}t=${Date.now()}_${attempt}` : url;

    try {
      const res = await fetch(probeUrl, {
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          Pragma: 'no-cache',
          ...(options.headers || {}),
        },
      });

      lastStatus = res.status;
      lastContentType = res.headers.get('content-type') || '';

      // If binary image, don't corrupt by reading as UTF-8 unless needed
      if (lastContentType.includes('image/') && !lastContentType.includes('svg')) {
        const buf = await res.arrayBuffer();
        lastBody = `[Binary Image: ${buf.byteLength} bytes]`;
      } else {
        lastBody = await res.text();
      }

      const isValid = options.validate
        ? options.validate(lastBody, lastStatus, res.headers)
        : lastStatus === 200;

      if (isValid) {
        return {
          ok: true,
          status: lastStatus,
          attempts: attempt,
          elapsedMs: Date.now() - startTime,
          body: lastBody,
          contentType: lastContentType,
        };
      }
    } catch (err: any) {
      lastError = err.message || String(err);
    }

    if (attempt < maxAttempts) {
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }

  return {
    ok: false,
    status: lastStatus,
    attempts: maxAttempts,
    elapsedMs: Date.now() - startTime,
    body: lastBody,
    contentType: lastContentType,
    error: lastError || `Validation failed after ${maxAttempts} attempts (last HTTP ${lastStatus})`,
  };
}

/**
 * 4. Telemetry Reporter (`TestMonitor` class)
 * Tracks every test assertion and remote propagation timing, then prints a retro ASCII summary table.
 */
export class TestMonitor {
  private suiteName: string;
  private records: TestRecord[] = [];
  private timings: Record<string, number> = {};
  private startTime: number = Date.now();

  constructor(suiteName: string) {
    this.suiteName = suiteName;
  }

  public section(title: string) {
    console.log(`\n${CYAN}${BOLD}================================================================================${RESET}`);
    console.log(`${CYAN}${BOLD}  [:> ${title}]${RESET}`);
    console.log(`${CYAN}${BOLD}================================================================================${RESET}`);
  }

  public record(
    category: string,
    name: string,
    passed: boolean,
    durationMs: number = 0,
    details?: string
  ): boolean {
    const status = passed ? 'PASS' : 'FAIL';
    this.records.push({ category, name, status, durationMs, details });

    const badge = passed ? `${GREEN}[✓ PASS]${RESET}` : `${RED}[✗ FAIL]${RESET}`;
    const timingStr = durationMs > 0 ? ` ${CYAN}(${durationMs}ms)${RESET}` : '';
    const detailStr = details ? ` — ${passed ? YELLOW : RED}${details}${RESET}` : '';
    console.log(`  ${badge} ${BOLD}[${category}]${RESET} ${name}${timingStr}${detailStr}`);
    return passed;
  }

  public warn(category: string, name: string, durationMs: number = 0, details?: string) {
    this.records.push({ category, name, status: 'WARN', durationMs, details });
    const timingStr = durationMs > 0 ? ` ${CYAN}(${durationMs}ms)${RESET}` : '';
    const detailStr = details ? ` — ${YELLOW}${details}${RESET}` : '';
    console.log(`  ${YELLOW}[! WARN]${RESET} ${BOLD}[${category}]${RESET} ${name}${timingStr}${detailStr}`);
  }

  public recordTiming(metric: string, elapsedMs: number) {
    this.timings[metric] = elapsedMs;
  }

  public printSummaryAndExit(shouldExit: boolean = true): { passed: number; failed: number; warned: number } {
    const totalDuration = Date.now() - this.startTime;
    const passed = this.records.filter((r) => r.status === 'PASS').length;
    const failed = this.records.filter((r) => r.status === 'FAIL').length;
    const warned = this.records.filter((r) => r.status === 'WARN').length;

    console.log(`\n${CYAN}${BOLD}╔══════════════════════════════════════════════════════════════════════════════╗${RESET}`);
    console.log(`${CYAN}${BOLD}║  [:> TELEMETRY REPORT] ${this.suiteName.padEnd(54, ' ')}║${RESET}`);
    console.log(`${CYAN}${BOLD}╠══════════════════════════════════════════════════════════════════════════════╣${RESET}`);
    console.log(
      `${CYAN}${BOLD}║${RESET}  Total Checks : ${BOLD}${String(this.records.length).padEnd(8)}${RESET}` +
        `Passed: ${GREEN}${BOLD}${String(passed).padEnd(8)}${RESET}` +
        `Failed: ${failed > 0 ? RED : GREEN}${BOLD}${String(failed).padEnd(8)}${RESET}` +
        `Warned: ${YELLOW}${BOLD}${String(warned).padEnd(6)}${RESET}` +
        `Time: ${BOLD}${totalDuration}ms${RESET}`
    );

    const timingKeys = Object.keys(this.timings);
    if (timingKeys.length > 0) {
      console.log(`${CYAN}${BOLD}╠══════════════════════════════════════════════════════════════════════════════╣${RESET}`);
      console.log(`${CYAN}${BOLD}║  REMOTE STATIC SITE PROPAGATION & BAUD LATENCY METRICS                       ║${RESET}`);
      console.log(`${CYAN}${BOLD}╟──────────────────────────────────────────────────────┬───────────────────────╢${RESET}`);
      for (const key of timingKeys) {
        const val = `${this.timings[key]} ms`;
        console.log(`${CYAN}${BOLD}║${RESET}  ${key.padEnd(52, ' ')}${CYAN}${BOLD}│${RESET}  ${GREEN}${BOLD}${val.padEnd(21, ' ')}${RESET}${CYAN}${BOLD}║${RESET}`);
      }
    }

    if (failed > 0) {
      console.log(`${CYAN}${BOLD}╠══════════════════════════════════════════════════════════════════════════════╣${RESET}`);
      console.log(`${RED}${BOLD}║  FAILED ASSERTIONS                                                           ║${RESET}`);
      for (const f of this.records.filter((r) => r.status === 'FAIL')) {
        console.log(`  ${RED}✗ [${f.category}] ${f.name}${f.details ? ` (${f.details})` : ''}${RESET}`);
      }
    }

    console.log(`${CYAN}${BOLD}╚══════════════════════════════════════════════════════════════════════════════╝${RESET}\n`);

    if (shouldExit) {
      process.exit(failed > 0 ? 1 : 0);
    }

    return { passed, failed, warned };
  }
}

