import { Router, Request, Response, NextFunction } from 'express';
import { query } from '../db';
import { activeSockets } from '../services/chatSocket';

export const directoryRouter = Router();

export interface DirectoryUser {
  id: string;
  handle: string;
  uin: number;
  email: string;
  avatarPath: string;
  status: 'active' | 'away' | 'inactive';
  statusMessage: string;
  postCount: number;
  profileUrl: string;
  siteUrl?: string;
  createdAt: string | Date;
}

export interface CategorizedDirectory {
  active: DirectoryUser[];
  away: DirectoryUser[];
  inactive: DirectoryUser[];
  total: number;
}

/**
 * Fetches and categorizes all Neogram users:
 * 1. Active: Currently connected via WebSocket and marked online
 * 2. Away: Currently connected and marked away OR disconnected with is_away flag
 * 3. Inactive: Offline / standby carrier
 *
 * Each sub-category is strictly ordered alphabetically by handle, then by UIN.
 */
export async function fetchCategorizedDirectory(): Promise<CategorizedDirectory> {
  const usersRes = await query(`
    SELECT 
      u.id, 
      u.email, 
      COALESCE(u.handle, split_part(u.email, '@', 1)) as handle,
      u.uin,
      u.avatar_path as "avatarPath",
      u.status_message as "statusMessage",
      u.is_away as "isAway",
      u.site_url as "siteUrl",
      u.deploy_path as "deployPath",
      u.created_at as "createdAt",
      (SELECT COUNT(*) FROM posts p WHERE p.user_id = u.id) as "postCount"
    FROM users u
    ORDER BY LOWER(COALESCE(u.handle, split_part(u.email, '@', 1))) ASC, u.uin ASC
  `);

  const activeUsers: DirectoryUser[] = [];
  const awayUsers: DirectoryUser[] = [];
  const inactiveUsers: DirectoryUser[] = [];

  for (const row of usersRes.rows) {
    const handle = (row.handle || row.email.split('@')[0] || 'surfer').trim();
    const uin = row.uin ? parseInt(row.uin, 10) : 100101;
    const avatarPath = row.avatarPath && row.avatarPath.trim() ? row.avatarPath : '/icons/default-avatar.svg';
    const postCount = parseInt(row.postCount, 10) || 0;

    const socketSession = activeSockets.get(row.id);
    let status: 'active' | 'away' | 'inactive' = 'inactive';
    let statusMessage = row.statusMessage || 'Surfing cyberspace';

    if (socketSession) {
      if (socketSession.status === 'away') {
        status = 'away';
      } else {
        status = 'active';
      }
      if (socketSession.awayMessage) {
        statusMessage = socketSession.awayMessage;
      }
    } else if (row.isAway) {
      status = 'away';
    } else {
      status = 'inactive';
    }

    const directoryEntry: DirectoryUser = {
      id: row.id,
      handle,
      uin,
      email: row.email,
      avatarPath,
      status,
      statusMessage,
      postCount,
      profileUrl: `/user/@${encodeURIComponent(handle)}`,
      siteUrl: row.siteUrl,
      createdAt: row.createdAt,
    };

    if (status === 'active') {
      activeUsers.push(directoryEntry);
    } else if (status === 'away') {
      awayUsers.push(directoryEntry);
    } else {
      inactiveUsers.push(directoryEntry);
    }
  }

  // Deterministic sorting in each sub-category: alphabetical by handle, then UIN
  const sortComparator = (a: DirectoryUser, b: DirectoryUser) => {
    const comp = a.handle.localeCompare(b.handle, undefined, { sensitivity: 'base' });
    if (comp !== 0) return comp;
    return a.uin - b.uin;
  };

  activeUsers.sort(sortComparator);
  awayUsers.sort(sortComparator);
  inactiveUsers.sort(sortComparator);

  return {
    active: activeUsers,
    away: awayUsers,
    inactive: inactiveUsers,
    total: usersRes.rows.length,
  };
}

/**
 * GET /directory & GET /users
 * Server-rendered Cyberspace Directory View (or JSON if requested via API)
 */
directoryRouter.get(['/directory', '/users'], async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await fetchCategorizedDirectory();

    if (
      req.path.startsWith('/api') ||
      req.baseUrl.startsWith('/api') ||
      req.xhr ||
      req.headers.accept?.includes('application/json')
    ) {
      res.json({
        ok: true,
        total: data.total,
        categories: {
          active: data.active,
          away: data.away,
          inactive: data.inactive,
        },
      });
      return;
    }

    res.render('directory', {
      title: 'Neogram - Cyberspace Station Directory',
      activeView: 'directory',
      activeUsers: data.active,
      awayUsers: data.away,
      inactiveUsers: data.inactive,
      totalCount: data.total,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/directory & GET /api/users
 * Headless JSON API endpoint returning categorized station directory
 */
directoryRouter.get(['/api/directory', '/api/users'], async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await fetchCategorizedDirectory();
    res.json({
      ok: true,
      total: data.total,
      categories: {
        active: data.active,
        away: data.away,
        inactive: data.inactive,
      },
    });
  } catch (err) {
    next(err);
  }
});
