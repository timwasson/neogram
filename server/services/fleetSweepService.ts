import path from 'path';
import { query } from '../db';
import { buildQueue, SweepTelemetry } from './staticBuilder';
import { deployFilesToNeocities, deployToNeocities, DeltaFile } from './neocitiesPublisher';
import { deployFilesToNekoweb, deployToNekoweb } from './nekowebPublisher';
import { deployFilesToGitHub, deployToGitHub } from './githubPublisher';
import { logAdminAction } from './systemSettings';

export interface SweepOptions {
  mode: 'assets' | 'full';
  target?: 'all' | 'qa';
  throttleDelayMs?: number;
  adminEmail?: string;
  adminId?: string;
  ipAddress?: string;
}

/**
 * Initiates a throttled, low-priority fleet-wide deployment sweep across active mounted station nodes.
 * Enqueues tasks at 'LOW' priority so real-time creator traffic (snaps, comments, likes) takes precedence,
 * with an enforced pacing delay between remote hosts to strictly respect Neocities/Nekoweb API rate limits.
 */
export async function initiateFleetSweep(options: SweepOptions): Promise<{ totalSites: number; message: string }> {
  const currentSweep = buildQueue.getSweepTelemetry();
  if (currentSweep.isActive) {
    throw new Error('A cyberspace fleet sweep is already active. Cancel it before initiating a new one.');
  }

  const targetFilter = options.target === 'qa'
    ? "AND (u.email LIKE '%@qa.neogram.club' OR u.handle LIKE 'qa_%')"
    : '';

  // 1. Fetch active mounted sites with valid deployment targets (Neocities or Nekoweb)
  const sitesRes = await query(`
    SELECT 
      s.id,
      s.name,
      s.slug,
      s.deployment_type as "deploymentType",
      s.deploy_path as "deployPath",
      s.user_id as "userId",
      u.handle,
      u.email
    FROM sites s
    JOIN users u ON s.user_id = u.id
    WHERE s.deployment_type IN ('neocities', 'nekoweb')
      AND s.deployment_credentials IS NOT NULL
      AND u.is_banned = FALSE
      ${targetFilter}
    ORDER BY s.created_at ASC
  `);

  const sites = sitesRes.rows;
  if (sites.length === 0) {
    return {
      totalSites: 0,
      message: 'No active remote station nodes (Neocities/Nekoweb) configured for propagation sweep.',
    };
  }

  const mode = options.mode === 'full' ? 'full' : 'assets';
  const delayMs = typeof options.throttleDelayMs === 'number' && options.throttleDelayMs >= 500
    ? options.throttleDelayMs
    : 2500;

  // 2. Initialize sweep telemetry
  buildQueue.startSweep(mode, sites.length);

  // 3. Define shared static assets for 'assets' delta sweep mode
  const deltaFiles: DeltaFile[] = [
    { relativePath: 'css/neogram.css', absolutePath: path.join(process.cwd(), 'public/css/neogram.css') },
    { relativePath: 'embed/embed.js', absolutePath: path.join(process.cwd(), 'embed/embed.js') },
    { relativePath: 'embed.js', absolutePath: path.join(process.cwd(), 'embed/embed.js') },
    { relativePath: 'embed/pager.js', absolutePath: path.join(process.cwd(), 'embed/pager.js') },
    { relativePath: 'embed/friends.js', absolutePath: path.join(process.cwd(), 'embed/friends.js') },
    { relativePath: 'pager.js', absolutePath: path.join(process.cwd(), 'embed/pager.js') },
    { relativePath: 'embed/neogram-embed.css', absolutePath: path.join(process.cwd(), 'embed/neogram-embed.css') },
    { relativePath: 'neogram-embed.css', absolutePath: path.join(process.cwd(), 'embed/neogram-embed.css') },
  ];

  console.log(`[:> FLEET SWEEP] Initiating ${mode.toUpperCase()} propagation sweep across ${sites.length} station nodes (Pacing: ${delayMs}ms delay)...`);

  // 4. Enqueue low-priority sweep job for each site
  for (const site of sites) {
    const siteLabel = `@${site.handle || site.email} / ${site.name} (${site.deploymentType.toUpperCase()})`;
    const jobLabel = `FleetSweep:${site.deploymentType.toUpperCase()}:${site.handle || site.userId}/${site.slug}`;

    buildQueue.enqueue(
      jobLabel,
      async () => {
        buildQueue.updateSweepCurrentSite(siteLabel);
        if (mode === 'assets') {
          if (site.deploymentType === 'nekoweb') {
            await deployFilesToNekoweb(site.id, deltaFiles, true);
          } else if (site.deploymentType === 'github') {
            await deployFilesToGitHub(site.id, deltaFiles, true);
          } else {
            await deployFilesToNeocities(site.id, deltaFiles, true);
          }
        } else {
          // 'full' mode: direct compilation and deployment within queue worker
          if (site.deploymentType === 'nekoweb') {
            await deployToNekoweb(site.id, true, { directBuild: true });
          } else if (site.deploymentType === 'github') {
            await deployToGitHub(site.id, true, { directBuild: true });
          } else {
            await deployToNeocities(site.id, true, { directBuild: true });
          }
        }
      },
      {
        priority: 'LOW',
        throttleDelayMs: delayMs,
        isSweepJob: true,
        siteInfo: { siteName: site.name, handle: site.handle || site.email },
      }
    ).catch((err) => {
      // Handled and recorded in buildQueue.sweepTelemetry
      console.warn(`[:> FLEET SWEEP NODE ERROR] ${siteLabel}:`, err.message || err);
    });
  }

  // 5. Immutable SysOp audit record
  if (options.adminEmail) {
    await logAdminAction({
      adminId: options.adminId || undefined,
      adminEmail: options.adminEmail,
      action: 'INITIATE_FLEET_SWEEP',
      details: {
        mode,
        totalSites: sites.length,
        throttleDelayMs: delayMs,
      },
      ipAddress: options.ipAddress,
    });
  }

  return {
    totalSites: sites.length,
    message: `Fleet sweep enqueued for ${sites.length} active stations (${mode.toUpperCase()} mode, ${delayMs}ms baud delay).`,
  };
}

/**
 * Aborts any pending fleet sweep jobs remaining in the low-priority queue.
 */
export async function cancelActiveFleetSweep(
  adminEmail?: string,
  adminId?: string,
  ipAddress?: string
): Promise<{ cancelledCount: number; message: string }> {
  const result = buildQueue.cancelSweep();

  if (adminEmail) {
    await logAdminAction({
      adminId: adminId || undefined,
      adminEmail,
      action: 'CANCEL_FLEET_SWEEP',
      details: {
        cancelledCount: result.cancelledCount,
      },
      ipAddress,
    });
  }

  return {
    cancelledCount: result.cancelledCount,
    message: `Fleet sweep aborted. Cancelled ${result.cancelledCount} pending station jobs.`,
  };
}

