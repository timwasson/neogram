import { getSiteById } from './siteService';
import { buildStaticGallery } from './staticBuilder';
import type { DeployResult } from './neocitiesPublisher';

export type HostProvider = 'neocities' | 'nekoweb' | 'github';

export function providerLabel(type: string | null | undefined): string {
  if (type === 'nekoweb') return 'Nekoweb';
  if (type === 'github') return 'GitHub Pages';
  return 'Neocities';
}

/**
 * Full build + upload of one site, to that site's own provider only.
 * (Each publisher compiles the gallery itself, so callers must not run a separate build first.)
 */
export async function deploySite(
  siteId: string,
  deploymentType: string | null | undefined,
  options: { directBuild?: boolean; skipFriendsFeed?: boolean } = {}
): Promise<DeployResult> {
  if (deploymentType === 'nekoweb') {
    const { deployToNekoweb } = await import('./nekowebPublisher');
    return deployToNekoweb(siteId, true, options);
  }
  if (deploymentType === 'github') {
    const { deployToGitHub } = await import('./githubPublisher');
    return deployToGitHub(siteId, true, options);
  }
  const { deployToNeocities } = await import('./neocitiesPublisher');
  return deployToNeocities(siteId, true, options);
}

/**
 * After a post is edited or deleted: republish the site if it has credentials (same rule as new
 * photos), otherwise just refresh the local build cache. Fire-and-forget; errors are logged.
 */
export function republishSiteInBackground(siteId: string | null | undefined, userId: string, reason: string): void {
  (async () => {
    const site = siteId ? await getSiteById(siteId, userId) : null;
    if (site && site.hasApiKey && site.siteUrl && site.deploymentType !== 'none') {
      const result = await deploySite(site.id, site.deploymentType);
      console.log(`[:> REPUBLISH] ${reason}: ${result.filesCount} files to ${providerLabel(site.deploymentType)} in ${result.durationMs}ms`);
      return;
    }
    await buildStaticGallery({ siteId: siteId || undefined, userId });
  })().catch((err) => console.error(`[:> REPUBLISH ERROR] ${reason}:`, err?.message || err));
}
