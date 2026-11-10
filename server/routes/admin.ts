import path from 'path';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import { Router, Request, Response, NextFunction } from 'express';
import { query } from '../db';
import { requireAdmin, requireAdminApi, validateAdminMutationHeader, AdminRequest } from '../middleware/adminGuard';
import { getTickerAnnouncement, setTickerAnnouncement, logAdminAction } from '../services/systemSettings';
import { buildQueue, buildStaticGallery } from '../services/staticBuilder';
import { initiateFleetSweep, cancelActiveFleetSweep } from '../services/fleetSweepService';
import { activeSockets } from '../services/chatSocket';
import { getUserSites, createSite, updateSite, Site } from '../services/siteService';
import { decryptCredentials } from '../utils/crypto';
import { getAllPosts, getPostCountForUser, getPostsForUser, deletePost, updatePost } from '../services/postStorage';
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
      0 as "postCount"
    FROM users u
    WHERE u.email LIKE '%@qa.neogram.club'
    ORDER BY u.handle ASC
  `);

  const fleet: QaFleetUser[] = [];
  for (const row of res.rows) {
    const sites = await getUserSites(row.id);
    const postCount = await getPostCountForUser(row.id);
    fleet.push({
      id: row.id,
      email: row.email,
      handle: row.handle,
      uin: Number(row.uin),
      statusMessage: row.statusMessage || 'QA Test Persona',
      postCount,
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
    const allPosts = await getAllPosts();
    const totalPosts = allPosts.length;

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
        0 as "postCount",
        COUNT(s.id) as "siteCount"
      FROM users u
      LEFT JOIN sites s ON s.user_id = u.id
      GROUP BY u.id, u.email, u.handle, u.uin, u.site_url, u.deployment_type, u.created_at, u.is_banned, u.ban_reason, u.banned_at
      ORDER BY u.created_at DESC
      LIMIT 100
    `);

    // Attach real-time connection status
    const users = await Promise.all(usersListRes.rows.map(async (u) => {
      const isOnline = activeSockets.has(u.id);
      const postCount = await getPostCountForUser(u.id);
      return {
        ...u,
        isOnline,
        postCount,
        siteCount: parseInt(u.siteCount || '0', 10),
      };
    }));

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
      const target = req.body.target === 'qa' ? 'qa' : 'all';
      const throttleDelayMs = typeof req.body.throttleDelayMs === 'number' && req.body.throttleDelayMs >= 1000
        ? req.body.throttleDelayMs
        : 3500;

      const result = await initiateFleetSweep({
        mode,
        target,
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
          deploymentType: 'neocities' | 'nekoweb' | 'github' | 'none';
          siteUrl: string;
          deployPath: string;
          buildHtml: boolean;
          autoDeploy: boolean;
        }>,
        canonicalUin?: number
      ) => {
        const cleanHandle = handle.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 40);
        const email = `${cleanHandle}@qa.neogram.club`;
        const existing = await query('SELECT id FROM users WHERE email = $1 OR handle = $2', [email, cleanHandle]);
        let userId: string;

        if (existing.rows.length > 0) {
          userId = existing.rows[0].id;
        } else {
          await query(`SELECT setval('user_uin_seq', (SELECT GREATEST(COALESCE(MAX(uin), 100100), 100100) FROM users) + 1, false)`).catch(() => {});
          const primary = defaultSites[0] || {
            deploymentType: 'none',
            siteUrl: `https://${cleanHandle}.neocities.org`,
            deployPath: 'neogram',
            buildHtml: true,
            autoDeploy: false,
          };
          let ins;
          if (canonicalUin) {
            ins = await query(
              `INSERT INTO users (email, handle, uin, status_message, site_url, deploy_path, deployment_type, build_html, auto_deploy)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
               RETURNING id`,
              [
                email,
                cleanHandle,
                canonicalUin,
                statusMessage,
                primary.siteUrl,
                primary.deployPath,
                primary.deploymentType,
                primary.buildHtml,
                primary.autoDeploy,
              ]
            );
          } else {
            ins = await query(
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
          }
          userId = ins.rows[0].id;
          provisionedHandles.push(`@${cleanHandle}`);
          await query(`SELECT setval('user_uin_seq', (SELECT GREATEST(COALESCE(MAX(uin), 100100), 100100) FROM users) + 1, false)`).catch(() => {});
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

      if (mode === 'core' || mode === 'fleet12') {
        const aliceId = await ensureQaAccount('qa_alice', 'QA Multi-Site Neocities Persona', [
          {
            name: 'Alice Primary Neocities',
            slug: 'main',
            deploymentType: 'neocities',
            siteUrl: 'https://chemicalmachine.neocities.org',
            deployPath: 'neogram',
            buildHtml: true,
            autoDeploy: true,
          },
          {
            name: 'Alice Secondary Zine',
            slug: 'zine',
            deploymentType: 'neocities',
            siteUrl: 'https://hive210.neocities.org',
            deployPath: 'neogram',
            buildHtml: true,
            autoDeploy: true,
          },
        ], 100107);

        const bobId = await ensureQaAccount('qa_bob', 'QA Nekoweb Publisher & Friend', [
          {
            name: 'Bob Nekoweb Station',
            slug: 'main',
            deploymentType: 'nekoweb',
            siteUrl: 'https://qa-neo-test.nekoweb.org',
            deployPath: 'neogram',
            buildHtml: true,
            autoDeploy: true,
          },
        ], 100108);

        const headlessId = await ensureQaAccount('qa_headless', 'QA Headless JSON API Persona', [
          {
            name: 'Headless JSON Feed Target',
            slug: 'json-api',
            deploymentType: 'nekoweb',
            siteUrl: 'https://neogram.nekoweb.org',
            deployPath: 'neogram-api',
            buildHtml: false,
            autoDeploy: true,
          },
        ], 100109);

        const friendId = await ensureQaAccount('qa_friend', 'QA Static Friend Grid Follower', [
          {
            name: 'Friend Cascade Receiver',
            slug: 'main',
            deploymentType: 'neocities',
            siteUrl: 'https://qa-neogram--1.neocities.org',
            deployPath: 'neogram',
            buildHtml: true,
            autoDeploy: true,
          },
        ], 100110);

        const surferId = await ensureQaAccount('qa_surfer', 'QA Cyber-Pass SSO & Guestbook Visitor', [
          {
            name: 'Surfer Sandbox Station',
            slug: 'main',
            deploymentType: 'none',
            siteUrl: 'https://neogram.club/user/@qa_surfer',
            deployPath: 'neogram',
            buildHtml: true,
            autoDeploy: false,
          },
        ], 100111);

        const cyberpunkId = await ensureQaAccount('qa_cyberpunk', 'QA Cyberpunk Terminal Hacker', [
          {
            name: 'neogramtest',
            slug: 'main',
            deploymentType: 'neocities',
            siteUrl: 'https://neogramtest.neocities.org',
            deployPath: 'neogram',
            buildHtml: true,
            autoDeploy: true,
          },
        ], 100116);

        const pixelId = await ensureQaAccount('qa_pixel', 'QA Pixel Art Craftsman', [
          {
            name: 'Pixel Arcade Station',
            slug: 'main',
            deploymentType: 'nekoweb',
            siteUrl: 'https://qa-pixel.nekoweb.org',
            deployPath: 'neogram',
            buildHtml: true,
            autoDeploy: true,
          },
        ], 100117);

        const modemId = await ensureQaAccount('qa_modem', 'QA 28.8k Baud Handshake', [
          {
            name: 'Dialup BBS Node',
            slug: 'main',
            deploymentType: 'none',
            siteUrl: 'https://neogram.club/user/@qa_modem',
            deployPath: 'neogram',
            buildHtml: true,
            autoDeploy: false,
          },
        ], 100118);

        const arcadeId = await ensureQaAccount('qa_arcade', 'QA Arcade High Score & CRT Fanatic', [
          {
            name: 'Arcade High Score Grid',
            slug: 'main',
            deploymentType: 'nekoweb',
            siteUrl: 'https://qa-arcade.nekoweb.org',
            deployPath: 'neogram',
            buildHtml: true,
            autoDeploy: true,
          },
        ], 100120);

        const matrixId = await ensureQaAccount('qa_matrix', 'QA Green Phosphor Operator', [
          {
            name: 'Matrix Terminal Node',
            slug: 'main',
            deploymentType: 'none',
            siteUrl: 'https://neogram.club/user/@qa_matrix',
            deployPath: 'neogram',
            buildHtml: true,
            autoDeploy: false,
          },
        ], 100121);

        const synthId = await ensureQaAccount('qa_synth', 'QA GitHub Pages Sound Deck', [
          {
            name: 'Neogram Test Github',
            slug: 'main',
            deploymentType: 'github',
            siteUrl: 'https://timwasson.github.io/neogramtest/',
            deployPath: 'neogram',
            buildHtml: true,
            autoDeploy: true,
          },
        ], 100122);

        const allQaIds = [
          aliceId, bobId, headlessId, friendId, surferId,
          cyberpunkId, pixelId, modemId, arcadeId, matrixId, synthId
        ];

        // 1. Wire reciprocal friend relationships among all QA personas
        for (let i = 0; i < allQaIds.length; i++) {
          for (let j = 0; j < allQaIds.length; j++) {
            if (i !== j) {
              await query(
                `INSERT INTO follows (follower_id, following_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
                [allQaIds[i], allQaIds[j]]
              );
            }
          }
        }

        // 2. Wire mutual follows between user @wasson and all QA personas ONLY
        const wassonRes = await query(
          `SELECT id FROM users WHERE LOWER(handle) = 'wasson' OR LOWER(email) = 'wasson@gmail.com' LIMIT 1`
        );
        if (wassonRes.rows.length > 0) {
          const wassonId = wassonRes.rows[0].id;
          for (const qaId of allQaIds) {
            await query(
              `INSERT INTO follows (follower_id, following_id) VALUES ($1, $2), ($2, $1) ON CONFLICT DO NOTHING`,
              [wassonId, qaId]
            );
          }
        }

        // 3. Strict Invariant: Exclude @sheavanlan from ANY QA account follow graph
        await query(`
          DELETE FROM follows 
          WHERE (follower_id IN (SELECT id FROM users WHERE LOWER(handle) = 'sheavanlan' OR LOWER(email) = 'sheavanlan@gmail.com')
                 AND following_id IN (SELECT id FROM users WHERE email LIKE '%@qa.neogram.club'))
             OR (following_id IN (SELECT id FROM users WHERE LOWER(handle) = 'sheavanlan' OR LOWER(email) = 'sheavanlan@gmail.com')
                 AND follower_id IN (SELECT id FROM users WHERE email LIKE '%@qa.neogram.club'))
        `);
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
        }, '30d');
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
 *
 * Empties all content from QA personas (@qa.neogram.club):
 *   - Purges test posts, comments, likes, guestbook signatures, and notifications.
 *   - Deletes remote photo assets on Neocities, Nekoweb, and GitHub.
 *   - Rebuilds clean baseline empty static galleries (posts: [], feed.json: []).
 *   - Enqueues throttled, rate-paced (3500ms baud delay) background deploy jobs into buildQueue
 *     so remote static sites on Neocities/Nekoweb/GitHub are updated to empty state.
 *   - STRICT INVARIANT: Preserves QA accounts (users), friend graphs (follows), and site configs (sites) 100%.
 */
adminRouter.post(
  '/api/admin/qa-fleet/purge-posts',
  requireAdminApi,
  validateAdminMutationHeader,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const adminUser = (req as AdminRequest).adminUser!;
      const qaUsersRes = await query(`SELECT id, email, handle FROM users WHERE email LIKE '%@qa.neogram.club' OR handle LIKE 'qa_%'`);
      const qaUserIds = new Set(qaUsersRes.rows.map((r: any) => r.id));
      const qaHandles = new Set(qaUsersRes.rows.map((r: any) => (r.handle || '').toLowerCase()));

      // Query mounted sites for all QA personas and test targets (e.g. neogramtest, chemicalmachine, hive210)
      const qaSitesRes = await query(`
        SELECT s.id, s.user_id, s.name, s.slug, s.deployment_type, s.deploy_path, s.deployment_credentials, s.auto_deploy, s.is_default, u.handle, u.email
        FROM sites s
        JOIN users u ON s.user_id = u.id
        WHERE u.email LIKE '%@qa.neogram.club'
           OR u.handle LIKE 'qa_%'
           OR s.name = 'neogramtest'
           OR s.site_url LIKE '%neogramtest%'
           OR s.site_url LIKE '%chemicalmachine%'
           OR s.site_url LIKE '%hive210%'
           OR s.site_url LIKE '%qa-neogram%'
      `);
      const qaSites = qaSitesRes.rows;
      const siteById = new Map<string, any>();
      const defaultSiteByUserId = new Map<string, any>();
      for (const s of qaSites) {
        siteById.set(s.id, s);
        if (s.is_default || !defaultSiteByUserId.has(s.user_id)) {
          defaultSiteByUserId.set(s.user_id, s);
        }
      }

      // Non-QA users who must NEVER have their real content deleted (e.g. @wasson, @sheavanlan)
      const nonQaUsersRes = await query(`SELECT id, handle FROM users WHERE email NOT LIKE '%@qa.neogram.club' AND handle NOT LIKE 'qa_%'`);
      const nonQaUserIds = new Set(nonQaUsersRes.rows.map((r: any) => r.id));
      const nonQaHandles = new Set(nonQaUsersRes.rows.map((r: any) => (r.handle || '').toLowerCase()));

      // 1. Fetch all posts across all static galleries & collect QA / test posts
      const allPosts = await getAllPosts();
      let deletedCount = 0;
      const deletedPostIds: string[] = [];

      for (const post of allPosts) {
        const isQaUserId = Boolean(post.userId && qaUserIds.has(post.userId));
        const isQaAuthor = Boolean(
          (post.author && (post.author.toLowerCase().startsWith('qa_') || qaHandles.has(post.author.toLowerCase()))) ||
          ((post as any).authorHandle && ((post as any).authorHandle.toLowerCase().startsWith('qa_') || qaHandles.has((post as any).authorHandle.toLowerCase())))
        );
        const isKnownMockCaption = Boolean(
          typeof post.caption === 'string' && (
            post.caption.startsWith('[:>') ||
            post.caption.startsWith(':>') ||
            ['nevermind', 'sweet shop.', 'yooooo', 'test for github pages', 'modal manual dismiss test'].includes(post.caption.trim().toLowerCase())
          )
        );
        const isTestSite = Boolean(
          (post.siteName && post.siteName.toLowerCase().includes('neogramtest')) ||
          (post.siteSlug && post.siteSlug.toLowerCase().includes('neogramtest')) ||
          (post.siteUrl && (post.siteUrl.includes('neogramtest') || post.siteUrl.includes('chemicalmachine') || post.siteUrl.includes('hive210') || post.siteUrl.includes('qa-neogram') || post.siteUrl.includes('qa-neo-test'))) ||
          (post.imagePath && (post.imagePath.includes('neogramtest') || post.imagePath.includes('chemicalmachine') || post.imagePath.includes('hive210') || post.imagePath.includes('picsum.photos') || post.imagePath.includes('placebear.com'))) ||
          (post.imageUrl && (post.imageUrl.includes('neogramtest') || post.imageUrl.includes('chemicalmachine') || post.imageUrl.includes('hive210') || post.imageUrl.includes('picsum.photos') || post.imageUrl.includes('placebear.com')))
        );
        const isOrphanUser = Boolean(post.userId && !nonQaUserIds.has(post.userId) && !qaUserIds.has(post.userId));

        // Purge if it belongs to a QA persona, is a test probe / mock caption, is on a test static host, or belongs to an orphan test user
        const shouldPurge = isQaUserId || isQaAuthor || isKnownMockCaption || isTestSite || isOrphanUser;

        if (shouldPurge) {
          deletedPostIds.push(post.id);

          // Delete local upload files if present in public/uploads/
          for (const picPath of [post.imagePath, post.thumbnailPath, ...(post.photos || []).map(p => p.imagePath), ...(post.photos || []).map(p => p.thumbnailPath)]) {
            if (picPath && typeof picPath === 'string' && picPath.startsWith('/uploads/')) {
              const fullLocalPath = path.join(process.cwd(), 'public', picPath);
              await fs.unlink(fullLocalPath).catch(() => {});
            }
          }

          await deletePost(post.id);
          deletedCount++;
        }
      }

      // 2. Purge remote photos and uploads from external static hosts (Neocities / Nekoweb / GitHub)
      const { purgeRemoteNeocitiesPhotos, deployToNeocities } = await import('../services/neocitiesPublisher');
      const { purgeRemoteNekowebPhotos, deployToNekoweb } = await import('../services/nekowebPublisher');
      const { purgeRemoteGitHubPhotos, deployToGitHub } = await import('../services/githubPublisher');

      for (const s of qaSites) {
        if (s.deployment_credentials && s.deployment_type !== 'none') {
          try {
            if (s.deployment_type === 'neocities') {
              console.log(`[:> QA PURGE] Purging remote Neocities photos for site ${s.name} (${s.id})...`);
              await purgeRemoteNeocitiesPhotos(s.id);
            } else if (s.deployment_type === 'nekoweb') {
              console.log(`[:> QA PURGE] Purging remote Nekoweb photos for site ${s.name} (${s.id})...`);
              await purgeRemoteNekowebPhotos(s.id);
            } else if (s.deployment_type === 'github') {
              console.log(`[:> QA PURGE] Purging remote GitHub photos for site ${s.name} (${s.id})...`);
              await purgeRemoteGitHubPhotos(s.id);
            }
          } catch (delErr: any) {
            console.warn(`[:> REMOTE PURGE ERROR] Target ${s.handle}/${s.slug}:`, delErr.message || delErr);
          }
        }
      }

      // 3. Clean QA comments from remaining active posts
      const remainingPosts = await getAllPosts();
      for (const post of remainingPosts) {
        if (Array.isArray(post.comments) && post.comments.length > 0) {
          const hasQaComment = post.comments.some((c: any) => 
            (c.userId && qaUserIds.has(c.userId)) ||
            (c.author && (c.author.toLowerCase().startsWith('qa_') || qaHandles.has(c.author.toLowerCase()))) ||
            (typeof c.text === 'string' && c.text.startsWith('[:> '))
          );
          if (hasQaComment) {
            await updatePost(post.id, (p) => {
              const cleaned = (p.comments || []).filter((c: any) => 
                !(c.userId && qaUserIds.has(c.userId)) &&
                !(c.author && (c.author.toLowerCase().startsWith('qa_') || qaHandles.has(c.author.toLowerCase()))) &&
                !(typeof c.text === 'string' && c.text.startsWith('[:> '))
              );
              return {
                ...p,
                comments: cleaned,
                commentsCount: cleaned.length,
              };
            });
          }
        }
      }

      // 4. Purge QA entries from database tables (guestbooks, notifications, likes, chat queue)
      await query(
        `DELETE FROM guestbook_entries WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@qa.neogram.club' OR handle LIKE 'qa_%') OR visitor_name LIKE 'qa_%' OR message LIKE '[:> %'`
      );
      await query(
        `DELETE FROM notifications WHERE actor_id IN (SELECT id FROM users WHERE email LIKE '%@qa.neogram.club' OR handle LIKE 'qa_%') OR title LIKE '%[:> %' OR body LIKE '%[:> %'`
      );
      await query(`
        DELETE FROM ephemeral_chat_queue 
        WHERE sender_id IN (SELECT id FROM users WHERE email LIKE '%@qa.neogram.club' OR handle LIKE 'qa_%')
           OR receiver_id IN (SELECT id FROM users WHERE email LIKE '%@qa.neogram.club' OR handle LIKE 'qa_%')
      `);
      if (deletedPostIds.length > 0) {
        await query(`DELETE FROM post_likes WHERE post_id = ANY($1)`, [deletedPostIds]);
      }

      // 5. Clean galleries in dist/static-galleries (empty posts/feed and remove stale photo HTML)
      const GALLERIES_ROOT = path.join(process.cwd(), 'dist', 'static-galleries');
      const { writeFileAtomic } = await import('../utils/atomicFile');

      try {
        if (existsSync(GALLERIES_ROOT)) {
          const activeUsers = await query(`SELECT id FROM users`);
          const activeSites = await query(`SELECT id FROM sites`);
          const validIds = new Set([
            'default',
            ...activeUsers.rows.map((r: any) => r.id),
            ...activeSites.rows.map((r: any) => r.id),
          ]);

          const qaFolderSet = new Set([
            'default',
            ...qaSites.map((s: any) => s.id),
            ...qaSites.map((s: any) => s.user_id),
            ...Array.from(qaUserIds),
          ]);

          const entries = await fs.readdir(GALLERIES_ROOT, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.isDirectory()) {
              const folderPath = path.join(GALLERIES_ROOT, entry.name);
              if (!validIds.has(entry.name)) {
                // Delete orphan directory from defunct test runs
                await fs.rm(folderPath, { recursive: true, force: true }).catch(() => {});
              } else if (qaFolderSet.has(entry.name)) {
                // Empty posts.json and feed.json
                const pPath = path.join(folderPath, 'posts.json');
                const fPath = path.join(folderPath, 'feed.json');
                if (existsSync(pPath)) await writeFileAtomic(pPath, JSON.stringify([], null, 2));
                if (existsSync(fPath)) {
                  try {
                    const raw = await fs.readFile(fPath, 'utf-8');
                    const parsed = JSON.parse(raw);
                    parsed.posts = [];
                    parsed.friends = [];
                    parsed.updatedAt = new Date().toISOString();
                    await writeFileAtomic(fPath, JSON.stringify(parsed, null, 2));
                  } catch {}
                }
                // Wipe local photos and uploads directories so 11ty starts completely clean
                await fs.rm(path.join(folderPath, 'photos'), { recursive: true, force: true }).catch(() => {});
                await fs.rm(path.join(folderPath, 'uploads'), { recursive: true, force: true }).catch(() => {});
                await fs.rm(path.join(folderPath, '_site', 'photos'), { recursive: true, force: true }).catch(() => {});
                await fs.rm(path.join(folderPath, '_site', 'uploads'), { recursive: true, force: true }).catch(() => {});
              }
            }
          }
        }
      } catch (_cleanupErr) {}

      // 6. Rebuild clean baseline empty static galleries for QA personas & queue remote deploys
      let remoteSitesEnqueued = 0;
      for (const s of qaSites) {
        // Rebuild local static gallery files with 0 posts and 0 friendsPosts
        try {
          await buildStaticGallery({ siteId: s.id, userId: s.user_id, skipFriendsFeed: true });
        } catch (buildErr: any) {
          console.warn(`[:> QA PURGE REBUILD ERROR] Failed to rebuild local site ${s.id}:`, buildErr.message || buildErr);
        }

        // If credentials exist, enqueue deploy into buildQueue with 3500ms pacing delay
        if (s.deployment_credentials && ['neocities', 'nekoweb', 'github'].includes(s.deployment_type)) {
          remoteSitesEnqueued++;
          buildQueue.enqueue(
            `QAPurgeDeploy:${s.deployment_type.toUpperCase()}:${s.handle || s.user_id}/${s.slug}`,
            async () => {
              console.log(`[:> QA PURGE SYNC] Purging & deploying empty static gallery to ${s.deployment_type.toUpperCase()} for @${s.handle}/${s.slug}...`);
              if (s.deployment_type === 'nekoweb') {
                await purgeRemoteNekowebPhotos(s.id).catch(() => {});
                await deployToNekoweb(s.id, true, { directBuild: true, skipFriendsFeed: true });
              } else if (s.deployment_type === 'github') {
                await purgeRemoteGitHubPhotos(s.id).catch(() => {});
                await deployToGitHub(s.id, true, { directBuild: true, skipFriendsFeed: true });
              } else if (s.deployment_type === 'neocities') {
                await purgeRemoteNeocitiesPhotos(s.id).catch(() => {});
                await deployToNeocities(s.id, true, { directBuild: true, skipFriendsFeed: true });
              }
            },
            {
              priority: 'LOW',
              throttleDelayMs: 3500,
              siteInfo: { siteName: s.name, handle: s.handle || s.email },
            }
          ).catch((err) => {
            console.warn(`[:> QA PURGE SYNC ERROR] ${s.handle}/${s.slug}:`, err.message || err);
          });
        }
      }

      // 7. Trigger static rebuild of non-QA users' sites (e.g. @wasson)
      const nonQaUsers = await query(`SELECT id FROM users WHERE email NOT LIKE '%@qa.neogram.club' AND handle NOT LIKE 'qa_%'`);
      for (const nonQa of nonQaUsers.rows) {
        buildStaticGallery({ userId: nonQa.id }).catch((err) => {
          console.error(`[:> PURGE REBUILD] Error rebuilding user ${nonQa.id}:`, err);
        });
      }

      await logAdminAction({
        adminId: adminUser.id,
        adminEmail: adminUser.email,
        action: 'PURGE_QA_POSTS',
        details: { deletedPostsCount: deletedCount, remoteSitesEnqueued },
        ipAddress: req.ip,
      });

      res.json({
        ok: true,
        message: `Purged ${deletedCount} QA test post(s) and comments. Cleaned remote files, rebuilt baseline static galleries, and enqueued ${remoteSitesEnqueued} remote static sync(s).`,
        deletedCount,
        remoteSitesEnqueued,
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * 10. POST /api/admin/qa-fleet/wipe - Permanently Disabled
 * (Wiping QA fleet accounts is permanently prohibited to protect accounts, friend graph, and site configs)
 */
adminRouter.post(
  '/api/admin/qa-fleet/wipe',
  requireAdminApi,
  validateAdminMutationHeader,
  async (req: Request, res: Response) => {
    res.status(403).json({
      ok: false,
      error: 'Wiping QA accounts is permanently disabled. QA accounts, friend relationships, and site credentials must be preserved. Use POST /api/admin/qa-fleet/purge-posts to clean content.',
    });
  }
);

/**
 * 11. GET /api/admin/db/snapshot - Download Full Production Database Snapshot for Local Sync
 */
adminRouter.get(
  '/api/admin/db/snapshot',
  requireAdminApi,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const usersRes = await query(`SELECT * FROM users ORDER BY created_at ASC`);
      const sitesRes = await query(`SELECT * FROM sites ORDER BY created_at ASC`);
      const followsRes = await query(`SELECT * FROM follows ORDER BY created_at ASC`);
      const countersRes = await query(`SELECT * FROM web_counters ORDER BY updated_at ASC`);
      const guestbookRes = await query(`SELECT * FROM guestbook_entries ORDER BY created_at ASC`);
      const notifyPrefsRes = await query(`SELECT * FROM notification_preferences`);

      const formatBytea = (val: any) => {
        if (!val) return null;
        if (Buffer.isBuffer(val)) return '\\x' + val.toString('hex');
        if (typeof val === 'string') return val.startsWith('\\x') ? val : '\\x' + Buffer.from(val).toString('hex');
        return null;
      };

      const users = usersRes.rows.map((u) => ({
        ...u,
        deployment_credentials: formatBytea(u.deployment_credentials),
      }));

      const sites = sitesRes.rows.map((s) => {
        const decrypted = decryptCredentials<any>(s.deployment_credentials);
        return {
          ...s,
          deployment_credentials: formatBytea(s.deployment_credentials),
          credentials: decrypted
            ? {
                apiKey: decrypted.apiKey || '',
                siteName: decrypted.siteName || '',
                siteUrl: decrypted.siteUrl || '',
                repo: decrypted.repo || '',
                branch: decrypted.branch || '',
              }
            : null,
        };
      });

      const snapshot = {
        version: 'neogram-db-snapshot-v1',
        exportedAt: new Date().toISOString(),
        tables: {
          users,
          sites,
          follows: followsRes.rows,
          web_counters: countersRes.rows,
          guestbook_entries: guestbookRes.rows,
          notification_preferences: notifyPrefsRes.rows,
        },
      };

      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="db-snapshot.json"');
      res.send(JSON.stringify(snapshot, null, 2));
    } catch (err) {
      next(err);
    }
  }
);
