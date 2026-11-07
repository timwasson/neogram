/**
 * Purges all test posts created by QA personas (@qa.neogram.club)
 * across https://neogram.club using their pre-authenticated session tokens.
 *
 * Usage:
 *   npx tsx scripts/purge-qa-posts.ts
 *   npx tsx scripts/purge-qa-posts.ts --local
 */

import { loadQaFleet, GREEN, RED, YELLOW, CYAN, RESET, BOLD } from '../server/tests/helpers/qaHarness';

async function main() {
  console.log(`\n${CYAN}${BOLD}================================================================================${RESET}`);
  console.log(`${CYAN}${BOLD}  [:> QA FLEET] PURGING STALE TEST TRANSMISSIONS FROM PRODUCTION                ${RESET}`);
  console.log(`${CYAN}${BOLD}================================================================================${RESET}`);

  const fleet = await loadQaFleet();
  const baseUrl = fleet.baseUrl;
  const agents = fleet.agents;

  console.log(`${CYAN}Target Host    :${RESET} ${YELLOW}${baseUrl}${RESET}`);
  console.log(`${CYAN}Total Personas :${RESET} ${BOLD}${agents.length}${RESET}\n`);

  // 1. Fetch all public posts from /api/posts
  const allRes = await fetch(`${baseUrl}/api/posts`);
  const allData = (await allRes.json()) as any;
  const allPosts = Array.isArray(allData.posts) ? allData.posts : [];

  console.log(`Found ${BOLD}${allPosts.length}${RESET} total posts across cyberspace.\n`);

  let totalDeleted = 0;
  const qaUserIds = new Set(agents.map((a) => a.userId));
  const qaHandles = new Set(agents.map((a) => a.handle.toLowerCase()));

  for (const post of allPosts) {
    const isQaUser = post.userId && qaUserIds.has(post.userId);
    const isQaAuthor = (post.author && (post.author.toLowerCase().startsWith('qa_') || qaHandles.has(post.author.toLowerCase()))) ||
                       (post.authorHandle && (post.authorHandle.toLowerCase().startsWith('qa_') || qaHandles.has(post.authorHandle.toLowerCase())));
    const isProbe = typeof post.caption === 'string' && (
      post.caption.startsWith('[:> CONCURRENCY_PROBE') ||
      post.caption.startsWith('[:> QA_') ||
      post.caption.startsWith('[:> THREAD_SEED') ||
      post.caption.startsWith('[:> CONCURRENT_BURST')
    );
    const isQaHost = typeof post.imageUrl === 'string' && (
      post.imageUrl.includes('chemicalmachine.neocities.org') ||
      post.imageUrl.includes('qa-neo-test.nekoweb.org') ||
      post.imageUrl.includes('qa-neogram--1.neocities.org') ||
      post.imageUrl.includes('hive210.neocities.org')
    );

    if (!isQaUser && !isQaAuthor && !isProbe && !isQaHost) {
      continue; // Skip user posts (e.g. @wasson)
    }

    // Pick token: either the matching agent or the first agent token
    const agent = agents.find((a) => a.userId === post.userId) || agents[0];
    const authorLabel = post.author || agent.handle;

    process.stdout.write(`  Purging post ${post.id.slice(0, 8)} (@${authorLabel})... `);

    try {
      const delRes = await fetch(`${baseUrl}/api/posts/${post.id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${agent.token}`,
          'X-Test-Suite': 'true',
        },
      });

      if (delRes.ok) {
        totalDeleted++;
        console.log(`${GREEN}[PURGED]${RESET} "${(post.caption || '').slice(0, 35)}"`);
      } else {
        const errText = await delRes.text();
        console.log(`${RED}[FAILED]${RESET} (${delRes.status}: ${errText.slice(0, 50)})`);
      }
    } catch (err: any) {
      console.log(`${RED}Error:${RESET} ${err.message || err}`);
    }
  }

  console.log(`\n${CYAN}${BOLD}--------------------------------------------------------------------------------${RESET}`);
  console.log(`  ${BOLD}Total QA Posts Purged:${RESET} ${GREEN}${totalDeleted}${RESET}`);
  console.log(`${CYAN}${BOLD}================================================================================${RESET}\n`);

  // Verify remaining posts
  const verifyRes = await fetch(`${baseUrl}/api/posts`);
  const verifyData = (await verifyRes.json()) as any;
  const remaining = Array.isArray(verifyData.posts) ? verifyData.posts : [];
  console.log(`${CYAN}Remaining Cyberspace Posts:${RESET} ${BOLD}${remaining.length}${RESET}`);
  for (const [idx, p] of remaining.entries()) {
    console.log(`  [${idx + 1}] @${p.author || 'unknown'} - "${(p.caption || '').slice(0, 40)}" (${p.imageUrl?.slice(0, 45)}...)`);
  }
}

main().catch((err) => {
  console.error(`${RED}Fatal error:${RESET}`, err);
  process.exit(1);
});
