/**
 * Neogram QA Fleet Sequential Rebuild & Deploy Tool
 * ==================================================
 * Sequentially rebuilds all QA persona static sites with pacing delays
 * to strictly prevent tripping rate limit flood warnings (HTTP 429) on remote hosts.
 *
 * Usage:
 *   npx tsx scripts/rebuild-qa-fleet.ts [--local] [--delay=3500]
 */

import { loadQaFleet, GREEN, RED, YELLOW, CYAN, RESET, BOLD } from '../server/tests/helpers/qaHarness';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const args = process.argv.slice(2);
  const isLocal = args.includes('--local');
  const delayArg = args.find((a) => a.startsWith('--delay='));
  const delayMs = delayArg ? parseInt(delayArg.split('=')[1], 10) : 3500;

  console.log(`\n${CYAN}${BOLD}================================================================================${RESET}`);
  console.log(`${CYAN}${BOLD}  [:> QA FLEET REBUILD] SEQUENTIAL RATE-PACED PROPAGATION TERMINAL              ${RESET}`);
  console.log(`${CYAN}${BOLD}================================================================================${RESET}`);

  const fleet = await loadQaFleet();
  const baseUrl = fleet.baseUrl;
  const agents = fleet.agents;

  console.log(`${CYAN}Target Host     :${RESET} ${YELLOW}${baseUrl}${RESET}`);
  console.log(`${CYAN}Total Personas  :${RESET} ${BOLD}${agents.length}${RESET}`);
  console.log(`${CYAN}Flood Delay     :${RESET} ${YELLOW}${delayMs}ms between sites${RESET}\n`);

  let succeeded = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < agents.length; i++) {
    const agent = agents[i];
    const indexStr = `[${i + 1}/${agents.length}]`;

    process.stdout.write(`  ${indexStr} Rebuilding @${agent.handle}... `);

    try {
      const res = await fetch(`${baseUrl}/api/build-static`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${agent.token}`,
          'Content-Type': 'application/json',
          'X-Test-Suite': 'true',
        },
      });

      const data = (await res.json()) as any;

      if (!res.ok || !data.ok) {
        failed++;
        console.log(`${RED}[FAIL]${RESET} ${data.error || res.statusText}`);
      } else if (data.deployed) {
        succeeded++;
        console.log(`${GREEN}[DEPLOYED]${RESET} ${data.filesCount || 0} files -> ${data.siteUrl || 'Remote Host'} (${data.durationMs || 0}ms)`);
      } else {
        skipped++;
        console.log(`${YELLOW}[COMPILED]${RESET} Local only (no remote host configured) (${data.durationMs || 0}ms)`);
      }
    } catch (err: any) {
      failed++;
      console.log(`${RED}[ERROR]${RESET} ${err.message || err}`);
    }

    if (i < agents.length - 1) {
      await sleep(delayMs);
    }
  }

  console.log(`\n${CYAN}${BOLD}--------------------------------------------------------------------------------${RESET}`);
  console.log(`  ${BOLD}Results:${RESET} Succeeded: ${GREEN}${succeeded}${RESET} | Local: ${YELLOW}${skipped}${RESET} | Failed: ${RED}${failed}${RESET}`);
  console.log(`${CYAN}${BOLD}================================================================================${RESET}\n`);
}

main().catch((err) => {
  console.error(`${RED}Fatal error:${RESET}`, err);
  process.exit(1);
});
