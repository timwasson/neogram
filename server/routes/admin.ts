import { Router, Request, Response, NextFunction } from 'express';
import { query } from '../db';
import { requireAdmin, requireAdminApi, validateAdminMutationHeader, AdminRequest } from '../middleware/adminGuard';
import { getTickerAnnouncement, setTickerAnnouncement, logAdminAction } from '../services/systemSettings';
import { buildQueue } from '../services/staticBuilder';
import { initiateFleetSweep, cancelActiveFleetSweep } from '../services/fleetSweepService';
import { activeSockets } from '../services/chatSocket';
import { getUserSites, createSite, updateSite, Site } from '../services/siteService';
import { signSessionToken, COOKIE_NAME } from '../auth/jwt';
import { config } from '../config';

export const adminRouter = Router();

export interface QaFleetUser {
  id: string;
  email: string;
  handle: string;
  uin: number;
  statusMessage: string;
  postCount: number;
  sites: Site[];
}

async function getQaFleetUsers(): Promise<QaFleetUser[]> {
  const res = await query(`
    SELECT 
      u.id,
      u.email,
      u.handle,
      u.uin,
      u.status_message as "statusMessage",
      (SELECT COUNT(*) FROM posts p WHERE p.user_id = u.id) as "postCount"
    FROM users u
    WHERE u.email LIKE '%@qa.neogram.club'
    ORDER BY u.handle ASC
  `);

  const fleet: QaFleetUser[] = [];
  for (const row of res.rows) {
    const sites = await getUserSites(row.id);
    fleet.push({
      id: row.id,
      email: row.email,
      handle: row.handle,
      uin: Number(row.uin),
      statusMessage: row.statusMessage || 'QA Test Persona',
      postCount: parseInt(row.postCount || '0', 10),
      sites,
    });
  }
  return fleet;
}

/**
 * 1. GET /admin - SysOp Admin Workstation Terminal View
 */
adminRouter.get('/admin', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const adminUser = (req as AdminRequest).adminUser!;

    // 1. User Registration Telemetry
    const totalUsersRes = await query('SELECT COUNT(*) as count FROM users');
    const totalUsers = parseInt(totalUsersRes.rows[0]?.count || '0', 10);

    const reg24hRes = await query(
      "SELECT COUNT(*) as count FROM users WHERE created_at >= NOW() - INTERVAL '24 hours'"
    );
    const reg24h = parseInt(reg24hRes.rows[0]?.count || '0', 10);

    const reg7dRes = await query(
      "SELECT COUNT(*) as count FROM users WHERE created_at >= NOW() - INTERVAL '7 days'"
    );
    const reg7d = parseInt(reg7dRes.rows[0]?.count || '0', 10);

    const reg30dRes = await query(
      "SELECT COUNT(*) as count FROM users WHERE created_at >= NOW() - INTERVAL '30 days'"
    );
    const reg30d = parseInt(reg30dRes.rows[0]?.count || '0', 10);

    const bannedRes = await query('SELECT COUNT(*) as count FROM users WHERE is_banned = TRUE');
    const totalBanned = parseInt(bannedRes.rows[0]?.count || '0', 10);

    // 2. Deployment Target Breakdown
    const deployRes = await query(`
      SELECT 
        COALESCE(deployment_type, 'none') as type,
        COUNT(*) as count
      FROM users
      GROUP BY deployment_type
    `);
    const deployBreakdown: Record<string, number> = {
      neocities: 0,
      nekoweb: 0,
      github: 0,
      sftp: 0,
      none: 0,
    };
    for (const r of deployRes.rows) {
      deployBreakdown[r.type] = parseInt(r.count, 10);
    }
    deployBreakdown.sandbox = deployBreakdown.none;

    // 3. System Load & Counters
    const postsRes = await query('SELECT COUNT(*) as count FROM posts');
    const totalPosts = parseInt(postsRes.rows[0]?.count || '0', 10);

    const hitsRes = await query('SELECT COALESCE(SUM(hits), 0) as total FROM web_counters');
    const totalHits = parseInt(hitsRes.rows[0]?.total || '0', 10);

    const guestbookRes = await query('SELECT COUNT(*) as count FROM guestbook_entries');
    const totalGuestbook = parseInt(guestbookRes.rows[0]?.count || '0', 10);

    // 4. Station Nodes Moderation Roster (Ordered by registration date desc)
    const usersListRes = await query(`
      SELECT 
        u.id,
        u.email,
        u.handle,
        u.uin,
        u.site_url as "siteUrl",
        u.deployment_type as "deploymentType",
        u.created_at as "createdAt",
        u.is_banned as "isBanned",
        u.ban_reason as "banReason",
        u.banned_at as "bannedAt",
        (SELECT COUNT(*) FROM posts p WHERE p.user_id = u.id) as "postCount",
        (SELECT COUNT(*) FROM sites s WHERE s.user_id = u.id) as "siteCount"
      FROM users u
      ORDER BY u.created_at DESC
      LIMIT 100
    `);

    // Attach real-time connection status
    const users = usersListRes.rows.map((u) => {
      const isOnline = activeSockets.has(u.id);
      return {
        ...u,
        isOnline,
        postCount: parseInt(u.postCount || '0', 10),
        siteCount: parseInt(u.siteCount || '0', 10),
      };
    });

    // 5. Active Marquee Announcement Ticker
    const currentTicker = await getTickerAnnouncement();

    // 6. Build Pipeline Telemetry
    const pipelineTelemetry = buildQueue.getTelemetry();

    // 7. Audit Log History
    const auditRes = await query(`
      SELECT id, admin_email as "adminEmail", action, target_id as "targetId", details, ip_address as "ipAddress", created_at as "createdAt"
      FROM admin_audit_logs
      ORDER BY created_at DESC
      LIMIT 25
    `);

    // 8. QA Test Fleet Accounts & Mounted Sites
    const qaFleet = await getQaFleetUsers();

    res.render('admin', {
      title: 'Neogram - SysOp Control Terminal [:> ROOT_CONSOLE.SYS]',
      activeView: 'admin',
      adminUser,
      telemetry: {
        totalUsers,
        reg24h,
        reg7d,
        reg30d,
        totalBanned,
        activeSocketsCount: activeSockets.size,
        deployBreakdown,
        totalPosts,
        totalHits,
        totalGuestbook,
      },
      users,
      qaFleet,
      currentTicker,
      pipelineTelemetry,
      auditLogs: auditRes.rows,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * 2. GET /api/admin/pipeline - Live Build Pipeline Status Polling
 */
adminRouter.get('/api/admin/pipeline', requireAdminApi, (_req: Request, res: Response) => {
  res.json({
    ok: true,
    telemetry: buildQueue.getTelemetry(),
  });
});

/**
 * 2B. POST /api/admin/pipeline/sweep - Initiate Fleet Deployment Sweep
 */
adminRouter.post(
  '/api/admin/pipeline/sweep',
  requireAdminApi,
  validateAdminMutationHeader,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const adminUser = (req as AdminRequest).adminUser!;
      const mode = req.body.mode === 'full' ? 'full' : 'assets';
      const throttleDelayMs = typeof req.body.throttleDelayMs === 'number' ? req.body.throttleDelayMs : 2500;

      const result = await initiateFleetSweep({
        mode,
        throttleDelayMs,
        adminEmail: adminUser.email,
        adminId: adminUser.id,
        ipAddress: req.ip,
      });

      res.json({
        ok: true,
        message: result.message,
        totalSites: result.totalSites,
        telemetry: buildQueue.getTelemetry(),
      });
    } catch (err: any) {
      next(err);
    }
  }
);

/**
 * 2C. POST /api/admin/pipeline/sweep/cancel - Abort Active Fleet Sweep
 */
adminRouter.post(
  '/api/admin/pipeline/sweep/cancel',
  requireAdminApi,
  validateAdminMutationHeader,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const adminUser = (req as AdminRequest).adminUser!;
      const result = await cancelActiveFleetSweep(adminUser.email, adminUser.id, req.ip);

      res.json({
        ok: true,
        message: result.message,
        cancelledCount: result.cancelledCount,
        telemetry: buildQueue.getTelemetry(),
      });
    } catch (err: any) {
      next(err);
    }
  }
);

/**
 * 3. POST /api/admin/marquee - Modify System Marquee Ticker
 */
adminRouter.post(
  '/api/admin/marquee',
  requireAdminApi,
  validateAdminMutationHeader,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const adminUser = (req as AdminRequest).adminUser!;
      const text = String(req.body.text || '').trim();

      if (!text) {
        res.status(400).json({ ok: false, error: 'Marquee text cannot be empty.' });
        return;
      }

      if (text.length > 500) {
        res.status(400).json({ ok: false, error: 'Marquee text exceeds maximum length of 500 characters.' });
        return;
      }

      const updated = await setTickerAnnouncement(text, adminUser, req.ip);

      res.json({
        ok: true,
        message: 'Terminal marquee ticker broadcasted across cyberspace.',
        ticker: updated,
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * 4. POST /api/admin/users/:id/ban - Soft-Ban User Station Node
 */
adminRouter.post(
  '/api/admin/users/:id/ban',
  requireAdminApi,
  validateAdminMutationHeader,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const adminUser = (req as AdminRequest).adminUser!;
      const targetUserId = req.params.id;
      const reason = String(req.body.reason || 'Violated terms of service').slice(0, 255);

      // Prevent SysOp from banning themselves
      if (adminUser.id === targetUserId) {
        res.status(400).json({ ok: false, error: 'Self-ban operation refused: SysOps cannot ban their own account.' });
        return;
      }

      const targetCheck = await query('SELECT id, email, handle, uin FROM users WHERE id = $1', [targetUserId]);
      if (targetCheck.rows.length === 0) {
        res.status(404).json({ ok: false, error: 'Target user node not found.' });
        return;
      }

      const targetUser = targetCheck.rows[0];

      // Soft-ban user in PostgreSQL (Preserves external files; freezes account and hides from social feeds)
      await query(
        `UPDATE users
         SET is_banned = TRUE,
             banned_at = NOW(),
             ban_reason = $1,
             updated_at = NOW()
         WHERE id = $2`,
        [reason, targetUserId]
      );

      // Disconnect active WebSocket if online
      const activeSession = activeSockets.get(targetUserId);
      if (activeSession) {
        try {
          activeSession.ws.send(
            JSON.stringify({
              type: 'sys:ban',
              message: `Carrier connection terminated: Station node suspended by network administrator (${reason}).`,
            })
          );
          activeSession.ws.close(4003, 'Node banned');
        } catch (_wsErr) {}
        activeSockets.delete(targetUserId);
      }

      // Record immutable audit log
      await logAdminAction({
        adminId: adminUser.id,
        adminEmail: adminUser.email,
        action: 'BAN_USER',
        targetId: targetUserId,
        details: {
          targetEmail: targetUser.email,
          targetHandle: targetUser.handle,
          targetUin: targetUser.uin,
          reason,
        },
        ipAddress: req.ip,
      });

      console.log(`[:> SYSOP] Soft-banned node @${targetUser.handle} (#${targetUser.uin}) by ${adminUser.email}`);

      res.json({
        ok: true,
        message: `Station node @${targetUser.handle} has been soft-banned. Remote site files were preserved.`,
        userId: targetUserId,
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * 5. POST /api/admin/users/:id/unban - Reinstate Soft-Banned User Station Node
 */
adminRouter.post(
  '/api/admin/users/:id/unban',
  requireAdminApi,
  validateAdminMutationHeader,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const adminUser = (req as AdminRequest).adminUser!;
      const targetUserId = req.params.id;

      const targetCheck = await query('SELECT id, email, handle, uin, is_banned FROM users WHERE id = $1', [targetUserId]);
      if (targetCheck.rows.length === 0) {
        res.status(404).json({ ok: false, error: 'Target user node not found.' });
        return;
      }

      const targetUser = targetCheck.rows[0];

      await query(
        `UPDATE users
         SET is_banned = FALSE,
             banned_at = NULL,
             ban_reason = NULL,
             updated_at = NOW()
         WHERE id = $1`,
        [targetUserId]
      );

      // Record audit log
      await logAdminAction({
        adminId: adminUser.id,
        adminEmail: adminUser.email,
        action: 'UNBAN_USER',
        targetId: targetUserId,
        details: {
          targetEmail: targetUser.email,
          targetHandle: targetUser.handle,
          targetUin: targetUser.uin,
        },
        ipAddress: req.ip,
      });

      console.log(`[:> SYSOP] Reinstated node @${targetUser.handle} (#${targetUser.uin}) by ${adminUser.email}`);

      res.json({
        ok: true,
        message: `Station node @${targetUser.handle} reinstated successfully.`,
        userId: targetUserId,
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * 6. POST /api/admin/qa-fleet/provision - Provision Core QA Personas or 20-Agent Load Fleet
 */
adminRouter.post(
  '/api/admin/qa-fleet/provision',
  requireAdminApi,
  validateAdminMutationHeader,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const adminUser = (req as AdminRequest).adminUser!;
      const mode = String(req.body.mode || 'core');
      const provisionedHandles: string[] = [];

      const ensureQaAccount = async (
        handle: string,
        statusMessage: string,
        defaultSites: Array<{
          name: string;
          slug: string;
          deploymentType: 'neocities' | 'nekoweb' | 'none';
          siteUrl: string;
          deployPath: string;
          buildHtml: boolean;
          autoDeploy: boolean;
        }>
      ) => {
        const cleanHandle = handle.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 40);
        const email = `${cleanHandle}@qa.neogram.club`;
        const existing = await query('SELECT id FROM users WHERE email = $1 OR handle = $2', [email, cleanHandle]);
        let userId: string;

        if (existing.rows.length > 0) {
          userId = existing.rows[0].id;
        } else {
          const primary = defaultSites[0] || {
            deploymentType: 'none',
            siteUrl: `https://${cleanHandle}.neocities.org`,
            deployPath: 'neogram',
            buildHtml: true,
            autoDeploy: false,
          };
          const ins = await query(
            `INSERT INTO users (email, handle, status_message, site_url, deploy_path, deployment_type, build_html, auto_deploy)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING id`,
            [
              email,
              cleanHandle,
              statusMessage,
              primary.siteUrl,
              primary.deployPath,
              primary.deploymentType,
              primary.buildHtml,
              primary.autoDeploy,
            ]
          );
          userId = ins.rows[0].id;
          provisionedHandles.push(`@${cleanHandle}`);
        }

        const existingSites = await getUserSites(userId);
        if (existingSites.length === 0) {
          for (let i = 0; i < defaultSites.length; i++) {
            const s = defaultSites[i];
            await createSite(userId, {
              name: s.name,
              slug: s.slug,
              siteUrl: s.siteUrl,
              deploymentType: s.deploymentType,
              deployPath: s.deployPath,
              buildHtml: s.buildHtml,
              autoDeploy: s.autoDeploy,
              isDefault: i === 0,
            });
          }
        }
        return userId;
      };

      if (mode === 'core') {
        const aliceId = await ensureQaAccount('qa_alice', 'QA Multi-Site Neocities Persona', [
          {
            name: 'Alice Primary Neocities',
            slug: 'main',
            deploymentType: 'neocities',
            siteUrl: 'https://qa-alice-1.neocities.org',
            deployPath: 'neogram',
            buildHtml: true,
            autoDeploy: true,
          },
          {
            name: 'Alice Secondary Zine',
            slug: 'zine',
            deploymentType: 'neocities',
            siteUrl: 'https://qa-alice-2.neocities.org',
            deployPath: 'zine',
            buildHtml: true,
            autoDeploy: true,
          },
        ]);

        const bobId = await ensureQaAccount('qa_bob', 'QA Nekoweb Publisher & Friend', [
          {
            name: 'Bob Nekoweb Station',
            slug: 'main',
            deploymentType: 'nekoweb',
            siteUrl: 'https://qa-bob.nekoweb.org',
            deployPath: 'neogram',
            buildHtml: true,
            autoDeploy: true,
          },
        ]);

        await ensureQaAccount('qa_headless', 'QA Headless JSON API Persona', [
          {
            name: 'Headless JSON Feed Target',
            slug: 'json-api',
            deploymentType: 'nekoweb',
            siteUrl: 'https://qa-headless.nekoweb.org',
            deployPath: 'neogram-api',
            buildHtml: false,
            autoDeploy: true,
          },
        ]);

        const friendId = await ensureQaAccount('qa_friend', 'QA Static Friend Grid Follower', [
          {
            name: 'Friend Cascade Receiver',
            slug: 'main',
            deploymentType: 'neocities',
            siteUrl: 'https://qa-friend.neocities.org',
            deployPath: 'neogram',
            buildHtml: true,
            autoDeploy: true,
          },
        ]);

        await ensureQaAccount('qa_surfer', 'QA Cyber-Pass SSO & Guestbook Visitor', [
          {
            name: 'Surfer Sandbox Station',
            slug: 'main',
            deploymentType: 'none',
            siteUrl: 'https://neogram.club/user/@qa_surfer',
            deployPath: 'neogram',
            buildHtml: true,
            autoDeploy: false,
          },
        ]);

        // Wire reciprocal friend relationships between qa_alice, qa_bob, and qa_friend
        await query(
          `INSERT INTO follows (follower_id, following_id) VALUES ($1, $2), ($2, $1), ($3, $1), ($3, $2) ON CONFLICT DO NOTHING`,
          [aliceId, bobId, friendId]
        );
      } else if (mode === 'load20') {
        for (let i = 1; i <= 20; i++) {
          const num = String(i).padStart(2, '0');
          const handle = `qa_agent_${num}`;
          const hostType: 'neocities' | 'nekoweb' | 'none' =
            i % 3 === 0 ? 'nekoweb' : i % 2 === 0 ? 'neocities' : 'none';
          await ensureQaAccount(handle, `Concurrent Load Agent #${num}`, [
            {
              name: `Load Agent #${num} Site`,
              slug: 'main',
              deploymentType: hostType,
              siteUrl:
                hostType === 'nekoweb'
                  ? `https://${handle}.nekoweb.org`
                  : `https://${handle}.neocities.org`,
              deployPath: 'neogram',
              buildHtml: i % 5 !== 0,
              autoDeploy: true,
            },
          ]);
        }
      } else if (mode === 'custom' && req.body.handle) {
        const rawHandle = String(req.body.handle).trim().replace(/^@/, '');
        const finalHandle = rawHandle.startsWith('qa_') ? rawHandle : `qa_${rawHandle}`;
        await ensureQaAccount(finalHandle, 'Custom QA Persona', [
          {
            name: `${finalHandle} Site`,
            slug: 'main',
            deploymentType: 'neocities',
            siteUrl: `https://${finalHandle}.neocities.org`,
            deployPath: 'neogram',
            buildHtml: true,
            autoDeploy: true,
          },
        ]);
      }

      await logAdminAction({
        adminId: adminUser.id,
        adminEmail: adminUser.email,
        action: 'PROVISION_QA_FLEET',
        details: { mode, provisionedHandles },
        ipAddress: req.ip,
      });

      const qaFleet = await getQaFleetUsers();
      res.json({
        ok: true,
        message:
          provisionedHandles.length > 0
            ? `Provisioned ${provisionedHandles.length} QA test account(s): ${provisionedHandles.join(', ')}`
            : 'QA Fleet verified (all requested accounts already exist).',
        qaFleet,
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * 7. POST /api/admin/qa-fleet/:userId/sites - Add or Update a Mounted Site & API Key on a QA User
 */
adminRouter.post(
  '/api/admin/qa-fleet/:userId/sites',
  requireAdminApi,
  validateAdminMutationHeader,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const adminUser = (req as AdminRequest).adminUser!;
      const { userId } = req.params;
      const { siteId, name, slug, siteUrl, deploymentType, deployPath, apiKey, buildHtml, autoDeploy, isDefault } = req.body;

      // Ensure target user is a QA fleet account
      const userCheck = await query('SELECT id, email, handle FROM users WHERE id = $1', [userId]);
      if (userCheck.rows.length === 0) {
        res.status(404).json({ ok: false, error: 'QA user account not found.' });
        return;
      }

      let updatedSite: Site;
      if (siteId) {
        updatedSite = await updateSite(String(siteId), userId, {
          name,
          slug,
          siteUrl,
          deploymentType,
          deployPath,
          apiKey: apiKey && String(apiKey).trim() ? String(apiKey).trim() : undefined,
          buildHtml: buildHtml !== undefined ? Boolean(buildHtml) : undefined,
          autoDeploy: autoDeploy !== undefined ? Boolean(autoDeploy) : undefined,
          isDefault: isDefault !== undefined ? Boolean(isDefault) : undefined,
        });
      } else {
        updatedSite = await createSite(userId, {
          name: name || 'QA Additional Site',
          slug: slug || 'site-2',
          siteUrl,
          deploymentType: deploymentType || 'neocities',
          deployPath: deployPath !== undefined ? deployPath : 'neogram',
          apiKey: apiKey && String(apiKey).trim() ? String(apiKey).trim() : undefined,
          buildHtml: buildHtml !== false,
          autoDeploy: autoDeploy !== false,
          isDefault: Boolean(isDefault),
        });
      }

      await logAdminAction({
        adminId: adminUser.id,
        adminEmail: adminUser.email,
        action: 'UPDATE_QA_SITE_CREDENTIALS',
        targetId: userId,
        details: {
          handle: userCheck.rows[0].handle,
          siteId: updatedSite.id,
          slug: updatedSite.slug,
          deploymentType: updatedSite.deploymentType,
          siteUrl: updatedSite.siteUrl,
          hasApiKey: updatedSite.hasApiKey,
        },
        ipAddress: req.ip,
      });

      res.json({
        ok: true,
        message: `Saved site "${updatedSite.name}" (${updatedSite.deploymentType.toUpperCase()}) for @${userCheck.rows[0].handle}.`,
        site: updatedSite,
      });
    } catch (err: any) {
      res.status(400).json({ ok: false, error: err.message || 'Failed to update QA site.' });
    }
  }
);

/**
 * 8. GET /api/admin/qa-fleet/export-sessions - Download 30-Day Pre-Authenticated Session Bundle for QA Agents
 */
adminRouter.get(
  '/api/admin/qa-fleet/export-sessions',
  requireAdminApi,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const qaFleet = await getQaFleetUsers();
      const targetUrl = config.appUrl || `${req.protocol}://${req.get('host')}`;

      const agents = qaFleet.map((u) => {
        const token = signSessionToken({
          userId: u.id,
          email: u.email,
          handle: u.handle,
          uin: u.uin,
        });
        return {
          userId: u.id,
          handle: u.handle,
          email: u.email,
          uin: u.uin,
          token,
          cookie: `${COOKIE_NAME}=${token}`,
          sites: u.sites.map((s) => ({
            id: s.id,
            name: s.name,
            slug: s.slug,
            siteUrl: s.siteUrl,
            deploymentType: s.deploymentType,
            deployPath: s.deployPath,
            buildHtml: s.buildHtml,
            autoDeploy: s.autoDeploy,
            hasApiKey: s.hasApiKey,
            isDefault: s.isDefault,
          })),
        };
      });

      const payload = {
        version: 'neogram-qa-fleet-v1',
        exportedAt: new Date().toISOString(),
        targetUrl,
        agentsCount: agents.length,
        agents,
      };

      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="qa-sessions.json"');
      res.send(JSON.stringify(payload, null, 2));
    } catch (err) {
      next(err);
    }
  }
);

/**
 * 9. POST /api/admin/qa-fleet/purge-posts - Clean Up Test Posts/Comments While Preserving QA Users & API Keys
 */
adminRouter.post(
  '/api/admin/qa-fleet/purge-posts',
  requireAdminApi,
  validateAdminMutationHeader,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const adminUser = (req as AdminRequest).adminUser!;
      const delPosts = await query(
        `DELETE FROM posts WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@qa.neogram.club') RETURNING id`
      );
      await query(
        `DELETE FROM guestbook_entries WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@qa.neogram.club')`
      );

      await logAdminAction({
        adminId: adminUser.id,
        adminEmail: adminUser.email,
        action: 'PURGE_QA_POSTS',
        details: { deletedPostsCount: delPosts.rowCount || 0 },
        ipAddress: req.ip,
      });

      res.json({
        ok: true,
        message: `Purged ${delPosts.rowCount || 0} QA test post(s) and comments. All QA users, sites, and encrypted API keys were preserved.`,
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * 10. POST /api/admin/qa-fleet/wipe - Completely Remove All QA Test Accounts
 */
adminRouter.post(
  '/api/admin/qa-fleet/wipe',
  requireAdminApi,
  validateAdminMutationHeader,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const adminUser = (req as AdminRequest).adminUser!;
      const delUsers = await query(
        `DELETE FROM users WHERE email LIKE '%@qa.neogram.club' RETURNING id`
      );

      await logAdminAction({
        adminId: adminUser.id,
        adminEmail: adminUser.email,
        action: 'WIPE_QA_FLEET',
        details: { deletedUsersCount: delUsers.rowCount || 0 },
        ipAddress: req.ip,
      });

      res.json({
        ok: true,
        message: `Wiped ${delUsers.rowCount || 0} QA test account(s) from database.`,
      });
    } catch (err) {
      next(err);
    }
  }
);
