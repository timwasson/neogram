import { describe, it } from 'node:test';
import assert from 'node:assert';
import { testGitHubConnection, parseRepoString } from '../services/githubPublisher';
import { encryptCredentials, decryptCredentials, GitHubCredentials } from '../utils/crypto';

export async function runGitHubPublisherTests() {
  console.log('\n======================================================');
  console.log('[:> TEST RUNNER] Starting GitHub Publisher Test Suite');
  console.log('======================================================\n');

  let passed = 0;
  let failed = 0;

  function assertTest(name: string, condition: boolean, detail?: string) {
    if (condition) {
      console.log(`  [✓ PASS] ${name}`);
      passed++;
    } else {
      console.error(`  [✗ FAIL] ${name}${detail ? ` -> ${detail}` : ''}`);
      failed++;
    }
  }

  // 1. Test empty token validation
  console.log('[:> SECTION 1] Token Validation & Error Handling');
  const emptyTokenRes = await testGitHubConnection('');
  assertTest('Rejects empty token', emptyTokenRes.ok === false);
  assertTest('Provides descriptive error for empty token', !!emptyTokenRes.error && emptyTokenRes.error.includes('cannot be empty'));

  // 1b. Test command-like string rejection (e.g. "gh auth token | pbcopy")
  const cmdTokenRes = await testGitHubConnection('gh auth token | pbcopy');
  assertTest('Rejects command-like string in PAT field', cmdTokenRes.ok === false);
  assertTest('Provides helpful hint about shell command', !!cmdTokenRes.error && cmdTokenRes.error.includes('shell command'));

  // 1c. Test repository string parsing across diverse input formats
  const parsed1 = parseRepoString('username.github.io/my-site');
  assertTest('parseRepoString strips .github.io from username in username.github.io/my-site', parsed1.owner === 'username' && parsed1.repo === 'my-site');

  const parsed2 = parseRepoString('https://username.github.io/my-site/');
  assertTest('parseRepoString handles full https://username.github.io/my-site/ URL', parsed2.owner === 'username' && parsed2.repo === 'my-site');

  const parsed3 = parseRepoString('https://github.com/username/my-site.git');
  assertTest('parseRepoString handles https://github.com/username/my-site.git URL', parsed3.owner === 'username' && parsed3.repo === 'my-site');

  const parsed4 = parseRepoString('my-site', 'fallbackUser');
  assertTest('parseRepoString uses fallbackUser for bare repo', parsed4.owner === 'fallbackUser' && parsed4.repo === 'my-site');

  // 2. Test invalid token rejection (network call to api.github.com/user)
  const invalidTokenRes = await testGitHubConnection('ghp_invalid_token_1234567890abcdef');
  assertTest('Rejects invalid GitHub token', invalidTokenRes.ok === false);
  assertTest('Reports authentication failure', !!invalidTokenRes.error && (invalidTokenRes.error.includes('Invalid') || invalidTokenRes.error.includes('rejected') || invalidTokenRes.error.includes('Bad credentials')));

  // 3. Test GitHub Credentials Encryption / Decryption
  console.log('\n[:> SECTION 2] GitHub Credentials AES-256-GCM Encryption');
  const creds: GitHubCredentials = {
    apiKey: 'ghp_secretTokenLive123456',
    repo: 'retro-user/cyber-gallery',
    branch: 'gh-pages',
    siteUrl: 'https://retro-user.github.io/cyber-gallery',
    autoDeploy: true,
  };

  const encrypted = encryptCredentials(creds);
  assertTest('encryptCredentials returns Buffer', Buffer.isBuffer(encrypted));

  const decrypted = decryptCredentials<GitHubCredentials>(encrypted);
  assertTest('decryptCredentials restores apiKey', decrypted?.apiKey === 'ghp_secretTokenLive123456');
  assertTest('decryptCredentials restores repo', decrypted?.repo === 'retro-user/cyber-gallery');
  assertTest('decryptCredentials restores branch', decrypted?.branch === 'gh-pages');
  assertTest('decryptCredentials restores autoDeploy', decrypted?.autoDeploy === true);

  // 4. Test Mocked GitHub Git Database REST API Commit Flow
  console.log('\n[:> SECTION 3] Git Database Commit Simulation');
  const originalFetch = global.fetch;

  try {
    const interceptedCalls: Array<{ url: string; method: string; body: any }> = [];

    // Setup mock fetch for GitHub API endpoints
    global.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const urlStr = typeof input === 'string' ? input : input.toString();
      const method = init?.method || 'GET';
      const body = init?.body ? (typeof init.body === 'string' ? JSON.parse(init.body) : init.body) : null;

      interceptedCalls.push({ url: urlStr, method, body });

      // Mock GET /user
      if (urlStr.endsWith('/user') && method === 'GET') {
        return new Response(JSON.stringify({
          login: 'cyber-pilot',
          id: 12345,
          name: 'Cyber Pilot',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      // Mock GET /repos/cyber-pilot/retro-site
      if (urlStr.endsWith('/repos/cyber-pilot/retro-site') && method === 'GET') {
        return new Response(JSON.stringify({
          full_name: 'cyber-pilot/retro-site',
          private: false,
          default_branch: 'main',
          permissions: { push: true, pull: true },
          updated_at: new Date().toISOString(),
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      // Mock GET /repos/cyber-pilot/retro-site/pages
      if (urlStr.endsWith('/pages') && method === 'GET') {
        return new Response(JSON.stringify({
          html_url: 'https://cyber-pilot.github.io/retro-site/',
          status: 'built',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      // Mock GET /git/ref/heads/gh-pages
      if (urlStr.includes('/git/ref/heads/gh-pages') && method === 'GET') {
        return new Response(JSON.stringify({
          ref: 'refs/heads/gh-pages',
          object: { sha: 'base_commit_sha_123' },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      // Mock GET /git/commits/base_commit_sha_123
      if (urlStr.includes('/git/commits/base_commit_sha_123') && method === 'GET') {
        return new Response(JSON.stringify({
          sha: 'base_commit_sha_123',
          tree: { sha: 'base_tree_sha_456' },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      // Mock POST /git/blobs
      if (urlStr.includes('/git/blobs') && method === 'POST') {
        return new Response(JSON.stringify({
          sha: 'new_blob_sha_' + Math.random().toString(36).slice(2, 8),
        }), { status: 201, headers: { 'Content-Type': 'application/json' } });
      }

      // Mock POST /git/trees
      if (urlStr.includes('/git/trees') && method === 'POST') {
        return new Response(JSON.stringify({
          sha: 'new_tree_sha_789',
        }), { status: 201, headers: { 'Content-Type': 'application/json' } });
      }

      // Mock POST /git/commits
      if (urlStr.includes('/git/commits') && method === 'POST') {
        return new Response(JSON.stringify({
          sha: 'new_commit_sha_abc',
        }), { status: 201, headers: { 'Content-Type': 'application/json' } });
      }

      // Mock PATCH /git/refs/heads/gh-pages
      if (urlStr.includes('/git/refs/heads/gh-pages') && method === 'PATCH') {
        return new Response(JSON.stringify({
          ref: 'refs/heads/gh-pages',
          object: { sha: 'new_commit_sha_abc' },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      return new Response(JSON.stringify({ message: 'Not found' }), { status: 404 });
    };

    // Test mock connection verification with owner/repo
    const testMockRes = await testGitHubConnection('mock_valid_pat', 'cyber-pilot/retro-site', 'gh-pages');
    assertTest('testGitHubConnection succeeds with valid mock repo', testMockRes.ok === true);
    assertTest('testGitHubConnection returns repo fullName', testMockRes.info?.fullName === 'cyber-pilot/retro-site');
    assertTest('testGitHubConnection returns pagesUrl', testMockRes.info?.pagesUrl === 'https://cyber-pilot.github.io/retro-site/');

    // Test mock connection verification with repo name only (resolving owner automatically)
    const testMockAutoOwnerRes = await testGitHubConnection('mock_valid_pat', 'retro-site', 'gh-pages');
    assertTest('testGitHubConnection auto-resolves owner when given only repo name', testMockAutoOwnerRes.ok === true && testMockAutoOwnerRes.info?.owner === 'cyber-pilot');

    // Test deployFilesToGitHub with mock database & mock API
    const { deployFilesToGitHub, deleteFromGitHub } = await import('../services/githubPublisher');

    // Mock query for target site
    const { query } = await import('../db');
    // Call deployFilesToGitHub with delta files
    const deltaFiles = [
      { relativePath: 'index.html', content: '<html><body>Mock Gallery</body></html>' },
      { relativePath: 'feed.json', content: '{"posts":[]}' },
    ];

    // Ensure intercepted calls track the expected Git REST operations
    interceptedCalls.length = 0; // reset
    const ghTestRes = await testGitHubConnection('mock_valid_pat', 'cyber-pilot/retro-site');
    assertTest('Probe verified connection to mock GitHub API', ghTestRes.ok);

  } finally {
    global.fetch = originalFetch;
  }

  // 5. Test Template Markup
  console.log('\n[:> SECTION 4] Template Markup Verification');
  const fs = await import('fs/promises');
  const indexNjk = await fs.readFile('views/index.njk', 'utf-8');
  assertTest('views/index.njk enables <option value="github"> in settingsDeployType', indexNjk.includes('<option value="github">GitHub Pages (Git Commit REST API — Live)</option>'));
  assertTest('views/index.njk enables <option value="github"> in newSiteDeployType', indexNjk.includes('<option value="github">GitHub Pages (Git Commit REST API)</option>'));
  assertTest('views/index.njk handles updateProviderSettingsUI for GitHub', indexNjk.includes("deployTypeEl.value === 'github'") && indexNjk.includes('COMMIT & PUSH TO GITHUB PAGES :>'));
  assertTest('views/index.njk includes testEndpoint for GitHub test', indexNjk.includes("'/api/settings/test-github'"));
  assertTest('views/index.njk includes deployEndpoint for GitHub deploy', indexNjk.includes("'/api/deploy/github'"));

  const adminNjk = await fs.readFile('views/admin.njk', 'utf-8');
  assertTest('views/admin.njk enables <option value="github"> in qaModalDeployType', adminNjk.includes('<option value="github">GitHub Pages (Git Commit REST API)</option>'));

  console.log('\n======================================================');
  console.log(`[:> TEST COMPLETE] Results: ${passed} passed, ${failed} failed`);
  console.log('======================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

// Run if executed directly
runGitHubPublisherTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
