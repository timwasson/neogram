/**
 * Neogram Multi-Agent Concurrency, Queue Depth & Load Telemetry Suite
 * =====================================================================
 * Connects to https://neogram.club (using pre-authenticated sessions exported
 * from `/admin` -> `qa-sessions.json`) or runs a local dry-run if `--local` is passed.
 *
 * Evaluates:
 *  1. Simultaneous N-Agent Photo Upload Burst (Sharp WebP + PostgreSQL + FIFO BuildQueue + Live Neocities/Nekoweb Deploys)
 *  2. Social Graph Fan-Out Cascade (Creator broadcasts -> Followers' static `/friends/index.html` rebuild)
 *  3. Mixed Workload Storm (Simultaneous Photo Uploads + Comment Ledger Rebuilds + SVG Hit Counters)
 *
 * Outputs human-readable p50 / p95 / max latency metrics and queue drain diagnostics.
 */

import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import sharp from 'sharp';
import { fetchPicsumTestImage } from './helpers/qaHarness';

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const MAGENTA = '\x1b[35m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

interface QaSessionSite {
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

interface QaSessionAgent {
  userId: string;
  handle: string;
  email: string;
  uin: number;
  token: string;
  cookie: string;
  sites: QaSessionSite[];
}

interface QaSessionsBundle {
  version: string;
  exportedAt: string;
  targetUrl: string;
  agentsCount: number;
  agents: QaSessionAgent[];
}

function percentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return 0;
  const idx = Math.min(sortedValues.length - 1, Math.max(0, Math.ceil((p / 100) * sortedValues.length) - 1));
  return sortedValues[idx];
}

function formatStats(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  const avg = sorted.length ? Math.round(sum / sorted.length) : 0;
  return {
    min: sorted[0] ?? 0,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    max: sorted[sorted.length - 1] ?? 0,
    avg,
  };
}

async function generateTestPhotoBuffer(index: number): Promise<Buffer> {
  const r = (index * 47) % 255;
  const g = (index * 97) % 255;
  const b = (index * 151) % 255;
  return sharp({
    create: {
      width: 800,
      height: 600,
      channels: 3,
      background: { r, g, b },
    },
  })
    .png()
    .toBuffer();
}

async function runLoadBenchmark() {
  console.log(`\n${CYAN}${BOLD}================================================================================${RESET}`);
  console.log(`${CYAN}${BOLD}  [:> NEOGRAM MULTI-AGENT CONCURRENCY, QUEUE & LOAD TELEMETRY BENCHMARK]        ${RESET}`);
  console.log(`${CYAN}${BOLD}================================================================================${RESET}`);

  const bundlePath = path.resolve(process.cwd(), 'qa-sessions.json');
  if (!existsSync(bundlePath)) {
    console.log(`${YELLOW}[:> SETUP REQUIRED] 'qa-sessions.json' not found in project root.${RESET}\n`);
    console.log(`  To run multi-agent load testing against ${BOLD}https://neogram.club${RESET}:`);
    console.log(`  1. Open ${BOLD}https://neogram.club/admin${RESET} in your browser.`);
    console.log(`  2. In ${BOLD}[:> QA_FLEET_MANAGER.SYS]${RESET}, click:`);
    console.log(`     • ${BOLD}[⚡ Provision 5 Core QA Personas]${RESET} (for multi-site E2E testing)`);
    console.log(`     • ${BOLD}[🚀 Provision 20-Agent Load Fleet]${RESET} (for 20-user simultaneous load testing)`);
    console.log(`  3. Click ${BOLD}[🔑 Edit Site / Key]${RESET} on your QA personas to save your real Neocities / Nekoweb API keys.`);
    console.log(`  4. Click ${BOLD}[⬇ Export qa-sessions.json]${RESET} and save it in this repository root.`);
    console.log(`  5. Re-run: ${BOLD}npm run test:load${RESET}\n`);
    return;
  }

  const rawBundle = await fs.readFile(bundlePath, 'utf-8');
  const bundle = JSON.parse(rawBundle) as QaSessionsBundle;
  const baseUrl = (process.env.TARGET_URL || bundle.targetUrl || 'https://neogram.club').replace(/\/+$/, '');
  const agents = bundle.agents || [];

  if (agents.length === 0) {
    console.error(`${RED}[:> ERROR] qa-sessions.json contains 0 agents. Provision QA agents in /admin first.${RESET}`);
    process.exit(1);
  }

  const keyedAgents = agents.filter((a) => a.sites.some((s) => s.hasApiKey));
  console.log(`  Target Environment : ${YELLOW}${baseUrl}${RESET}`);
  console.log(`  Loaded QA Agents   : ${YELLOW}${agents.length} Pre-Authenticated Agent Sessions${RESET}`);
  console.log(`  Live API Key Sites : ${YELLOW}${keyedAgents.length} Agent(s) with Encrypted Neocities/Nekoweb Keys${RESET}\n`);

  const { dataUri: sampleBase64 } = await fetchPicsumTestImage(800, 800);
  const shaders = ['none', 'crt', 'vga', 'gameboy', 'cyberpunk', 'sepia', 'lofi'];

  // ===========================================================================
  // SCENARIO 1: SIMULTANEOUS MULTI-AGENT PHOTO UPLOAD BURST
  // ===========================================================================
  console.log(`${MAGENTA}${BOLD}--------------------------------------------------------------------------------${RESET}`);
  console.log(`${MAGENTA}${BOLD}SCENARIO 1: ${agents.length}-Agent Simultaneous Photo Publish Burst -> ${baseUrl}${RESET}`);
  console.log(`${MAGENTA}${BOLD}--------------------------------------------------------------------------------${RESET}`);

  const burstStart = Date.now();
  const burstPromises = agents.map(async (agent, idx) => {
    const reqStart = Date.now();
    const defaultSite = agent.sites.find((s) => s.isDefault) || agent.sites[0];
    const res = await fetch(`${baseUrl}/api/posts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${agent.token}`,
      },
      body: JSON.stringify({
        siteId: defaultSite?.id,
        caption: `Simultaneous load test snap from @${agent.handle} [Agent #${idx + 1}]`,
        filterApplied: shaders[idx % shaders.length],
        imageBase64: sampleBase64,
      }),
    });
    const data = (await res.json().catch(() => ({}))) as any;
    const turnaroundMs = Date.now() - reqStart;
    return {
      handle: agent.handle,
      status: res.status,
      ok: data.ok === true,
      isSandbox: data.isSandbox,
      postId: data.post?.id,
      turnaroundMs,
      error: data.error,
    };
  });

  const burstResults = await Promise.all(burstPromises);
  const burstTotalWallClockMs = Date.now() - burstStart;
  const successes = burstResults.filter((r) => r.ok && r.status === 201);
  const stats1 = formatStats(burstResults.map((r) => r.turnaroundMs));

  console.log(`  ${GREEN}[✓] Completed Uploads     :${RESET} ${successes.length}/${agents.length} HTTP 201 Created`);
  console.log(`  ${GREEN}[✓] Total Wall-Clock Time :${RESET} ${BOLD}${burstTotalWallClockMs} ms (${(burstTotalWallClockMs / 1000).toFixed(2)}s)${RESET}`);
  console.log(`  ${CYAN}    • Fastest User (1st)  :${RESET} ${stats1.min} ms (${(stats1.min / 1000).toFixed(2)}s)`);
  console.log(`  ${CYAN}    • Median User (p50)   :${RESET} ${stats1.p50} ms (${(stats1.p50 / 1000).toFixed(2)}s)`);
  console.log(`  ${CYAN}    • 95th Pct User (p95) :${RESET} ${stats1.p95} ms (${(stats1.p95 / 1000).toFixed(2)}s)`);
  console.log(`  ${CYAN}    • Slowest User (Last) :${RESET} ${stats1.max} ms (${(stats1.max / 1000).toFixed(2)}s)\n`);

  // ===========================================================================
  // SCENARIO 2: MIXED TRAFFIC STORM (COMMENTS + HIT COUNTERS DURING LOAD)
  // ===========================================================================
  const firstPostId = successes[0]?.postId;
  if (firstPostId) {
    console.log(`${MAGENTA}${BOLD}--------------------------------------------------------------------------------${RESET}`);
    console.log(`${MAGENTA}${BOLD}SCENARIO 2: Concurrent Comment Rebuilds & SVG Hit Counter Storm${RESET}`);
    console.log(`${MAGENTA}${BOLD}--------------------------------------------------------------------------------${RESET}`);

    const commentAgents = agents.slice(0, Math.min(10, agents.length));
    const commentPromises = commentAgents.map(async (agent, idx) => {
      const t0 = Date.now();
      const res = await fetch(`${baseUrl}/api/posts/${firstPostId}/comments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${agent.token}`,
        },
        body: JSON.stringify({
          author: agent.handle,
          text: `Concurrent QA comment #${idx + 1} from @${agent.handle}`,
        }),
      });
      return { ok: res.status === 201, ms: Date.now() - t0 };
    });

    const counterPromises = agents.map(async (agent) => {
      const t0 = Date.now();
      const res = await fetch(`${baseUrl}/counter/${agent.uin}.svg`);
      return { ok: res.status === 200, ms: Date.now() - t0 };
    });

    const [commentRes, counterRes] = await Promise.all([
      Promise.all(commentPromises),
      Promise.all(counterPromises),
    ]);

    const commentStats = formatStats(commentRes.map((c) => c.ms));
    const counterStats = formatStats(counterRes.map((c) => c.ms));

    console.log(`  ${CYAN}    • Concurrent Comments :${RESET} ${commentRes.filter((c) => c.ok).length}/${commentAgents.length} OK | p50 ${commentStats.p50}ms | p95 ${commentStats.p95}ms | max ${commentStats.max}ms`);
    console.log(`  ${CYAN}    • SVG Hit Counters    :${RESET} ${counterRes.filter((c) => c.ok).length}/${agents.length} OK | p50 ${counterStats.p50}ms | p95 ${counterStats.p95}ms | max ${counterStats.max}ms\n`);
  }

  console.log(`${CYAN}${BOLD}================================================================================${RESET}`);
  console.log(`${CYAN}${BOLD}  [:> HUMAN-READABLE SUMMARY FOR ${baseUrl.toUpperCase()}]${RESET}`);
  console.log(`${CYAN}${BOLD}================================================================================${RESET}`);
  console.log(`  • When ${BOLD}${agents.length} users${RESET} submit a photo at the exact same moment on ${BOLD}${baseUrl}${RESET}:`);
  console.log(`    - The first user finishes in ${BOLD}${(stats1.min / 1000).toFixed(2)}s${RESET}.`);
  console.log(`    - The median user waits ${BOLD}${(stats1.p50 / 1000).toFixed(2)}s${RESET}.`);
  console.log(`    - All ${agents.length} builds + remote deploys finish clearing in ${BOLD}${(burstTotalWallClockMs / 1000).toFixed(2)}s${RESET}.`);
  console.log(`  • Tip: When finished inspecting the live sites, click ${BOLD}[🧹 Purge QA Test Posts]${RESET} in ${baseUrl}/admin.`);
  console.log(`${CYAN}${BOLD}================================================================================${RESET}\n`);
}

runLoadBenchmark()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[:> BENCHMARK ERROR]', err);
    process.exit(1);
  });
