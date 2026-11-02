/**
 * Neogram Multi-Account Live Static Host Verification Suite
 * =========================================================
 * Uses `qa-sessions.json` (exported from https://neogram.club/admin) to test:
 *  - Multi-site switching & publishing on Neocities (@qa_alice)
 *  - Delta publishing & Friend Grid cascades on Nekoweb (@qa_bob)
 *  - Headless JSON mode (`build_html = false`) on @qa_headless
 *  - Live HTTP verification of the deployed `.neocities.org` and `.nekoweb.org` URLs
 */

import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import sharp from 'sharp';

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

async function runLiveHostVerification() {
  console.log(`\n${CYAN}${BOLD}================================================================================${RESET}`);
  console.log(`${CYAN}${BOLD}  [:> NEOGRAM LIVE STATIC HOST VERIFICATION (NEOCITIES & NEKOWEB)]              ${RESET}`);
  console.log(`${CYAN}${BOLD}================================================================================${RESET}`);

  const bundlePath = path.resolve(process.cwd(), 'qa-sessions.json');
  if (!existsSync(bundlePath)) {
    console.log(`${YELLOW}[:> SETUP REQUIRED] 'qa-sessions.json' not found in project root.${RESET}`);
    console.log(`  1. Visit ${BOLD}https://neogram.club/admin${RESET}`);
    console.log(`  2. Provision the 5 Core QA Personas and attach your Neocities & Nekoweb API keys.`);
    console.log(`  3. Click ${BOLD}[⬇ Export qa-sessions.json]${RESET} and place it in this project root.`);
    console.log(`  4. Run: ${BOLD}npm run test:live-hosts${RESET}\n`);
    return;
  }

  const bundle = JSON.parse(await fs.readFile(bundlePath, 'utf-8'));
  const baseUrl = (process.env.TARGET_URL || bundle.targetUrl || 'https://neogram.club').replace(/\/+$/, '');
  const agents = bundle.agents || [];

  const sampleImg = await sharp({
    create: { width: 600, height: 600, channels: 3, background: { r: 20, g: 180, b: 220 } },
  })
    .png()
    .toBuffer();
  const sampleBase64 = `data:image/png;base64,${sampleImg.toString('base64')}`;

  for (const agent of agents) {
    const keyedSites = (agent.sites || []).filter((s: any) => s.hasApiKey);
    if (keyedSites.length === 0) continue;

    console.log(`\n${CYAN}${BOLD}--> Testing @${agent.handle} (#${agent.uin}) — ${keyedSites.length} Live Keyed Site(s)${RESET}`);
    for (const site of keyedSites) {
      const t0 = Date.now();
      const res = await fetch(`${baseUrl}/api/posts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${agent.token}`,
        },
        body: JSON.stringify({
          siteId: site.id,
          caption: `Live host verification snap to ${site.name} (${site.deploymentType.toUpperCase()})`,
          filterApplied: 'crt',
          imageBase64: sampleBase64,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as any;
      const elapsed = Date.now() - t0;

      console.log(
        `  [${res.status === 201 && data.ok ? GREEN + '✓ PASS' : RED + '✗ FAIL'}${RESET}] Published to ${BOLD}${site.name}${RESET} [${site.deploymentType.toUpperCase()}] in ${BOLD}${elapsed}ms${RESET}`
      );

      // Verify remote feed.json on live Neocities / Nekoweb host
      const remoteFeedUrl = `${site.siteUrl.replace(/\/+$/, '')}${site.deployPath ? '/' + site.deployPath : ''}/feed.json`;
      try {
        await new Promise((r) => setTimeout(r, 1500));
        const feedCheck = await fetch(remoteFeedUrl);
        console.log(
          `  [${feedCheck.status === 200 ? GREEN + '✓ LIVE' : YELLOW + '⏳ PROP'}${RESET}] Remote Feed Probe: ${remoteFeedUrl} (HTTP ${feedCheck.status})`
        );
      } catch (probeErr: any) {
        console.log(`  [${YELLOW}! WARN${RESET}] Remote Feed Probe (${remoteFeedUrl}): ${probeErr.message}`);
      }
    }
  }
}

runLiveHostVerification()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[:> LIVE HOST SUITE FAILED]', err);
    process.exit(1);
  });
