import { Router, Request, Response, NextFunction } from 'express';
import { query } from '../db';
import { activeSockets } from '../services/chatSocket';
import { getPostsForUser } from '../services/postStorage';
import { resolveAvatarPath } from '../utils/avatar';

export const directoryRouter = Router();

export interface DirectoryUser {
  id: string;
  handle: string;
  uin: number;
  email?: never; // never exposed: the directory is public (CORS *)
  avatarPath: string;
  status: 'active' | 'away' | 'inactive';
  statusMessage: string;
  postCount: number;
  latestPostDate?: string | null;
  latestThumbnail?: string | null;
  profileUrl: string;
  siteUrl?: string;
  galleryUrl?: string;
  createdAt: string | Date;
}

export interface CategorizedDirectory {
  active: DirectoryUser[];
  away: DirectoryUser[];
  inactive: DirectoryUser[];
  featured: DirectoryUser[];
  total: number;
}

/**
 * Filter out test/QA personas, internal system accounts, and empty numeric accounts
 * so the public directory showcases genuine human-crafted personal sites.
 */
function isExcludedFromDirectory(handle: string, email: string, postCount: number): boolean {
  const h = (handle || '').toLowerCase().replace(/^@/, '').trim();
  const e = (email || '').toLowerCase().trim();

  // Exclude QA fleet personas (@qa_*, qa_*, *@qa.*)
  if (h.startsWith('qa_') || e.startsWith('qa_') || e.includes('@qa.')) return true;

  // Exclude automated test suites (@test*, test*, spam_test*)
  if (h.startsWith('test') || h.startsWith('spam_test') || e.startsWith('test') || e.startsWith('spam_test')) return true;

  // Exclude system root accounts (@root, root@*)
  if (h === 'root' || e.startsWith('root@') || e === 'root') return true;

  // Exclude automated delivery / webhook runners (@delivered*)
  if (h.startsWith('delivered') || e.startsWith('delivered')) return true;

  // Exclude default raw phone-number handles with 0 photos
  const isPhoneHandle = /^(\+?[0-9_\-\s]{7,20})$/.test(h);
  if (isPhoneHandle && postCount === 0) return true;

  return false;
}

/**
 * Fetches and categorizes all Neogram users:
 * 1. Filters out internal QA, test, root, delivered, and empty phone handles
 * 2. Compiles "Featured Neighborhood Galleries" sorted by most recently updated photos
 * 3. Categorizes live carrier presence (Active, Away, Inactive)
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
      COALESCE(s.site_url, u.site_url) as "siteUrl",
      COALESCE(s.deploy_path, u.deploy_path) as "deployPath",
      COALESCE(s.deployment_type, u.deployment_type) as "deploymentType",
      u.created_at as "createdAt",
      0 as "postCount"
    FROM users u
    LEFT JOIN sites s ON s.user_id = u.id AND s.is_default = TRUE
    WHERE COALESCE(u.is_banned, false) = false
    ORDER BY LOWER(COALESCE(u.handle, split_part(u.email, '@', 1))) ASC, u.uin ASC
  `);

  const activeUsers: DirectoryUser[] = [];
  const awayUsers: DirectoryUser[] = [];
  const inactiveUsers: DirectoryUser[] = [];
  const allEligibleUsers: DirectoryUser[] = [];

  for (const row of usersRes.rows) {
    const handle = (row.handle || row.email.split('@')[0] || 'surfer').trim();
    const uin = row.uin ? parseInt(row.uin, 10) : 100101;
    const avatarPath = resolveAvatarPath({
      avatarPath: row.avatarPath,
      deploymentType: row.deploymentType,
      siteUrl: row.siteUrl,
      uin,
      handle,
    });
    
    // Retrieve posts to inspect latest photo timestamp and count
    const posts = await getPostsForUser(row.id);
    const postCount = posts.length;
    const latestPost = posts.length > 0 ? posts[0] : null;
    const latestPostDate = latestPost?.createdAt ? new Date(latestPost.createdAt).toISOString() : null;
    const latestThumbnail = latestPost?.thumbnailUrl || latestPost?.thumbnailPath || null;

    // Filter out QA personas, test runs, and empty phone accounts from public directory
    if (isExcludedFromDirectory(handle, row.email, postCount)) {
      continue;
    }

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

    let galleryUrl: string | undefined = undefined;
    if (row.siteUrl && row.siteUrl.trim()) {
      const cleanSite = row.siteUrl.trim().replace(/\/+$/, '');
      const cleanDeploy = (row.deployPath !== null && row.deployPath !== undefined)
        ? String(row.deployPath).trim().replace(/^\/+|\/+$/g, '')
        : 'neogram';
      galleryUrl = cleanDeploy ? `${cleanSite}/${cleanDeploy}/` : `${cleanSite}/`;
    }

    const directoryEntry: DirectoryUser = {
      id: row.id,
      handle,
      uin,
      avatarPath,
      status,
      statusMessage,
      postCount,
      latestPostDate,
      latestThumbnail,
      profileUrl: `/user/${uin}`,
      siteUrl: row.siteUrl || undefined,
      galleryUrl,
      createdAt: row.createdAt,
    };

    allEligibleUsers.push(directoryEntry);

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

  // "Featured Neighborhood Galleries" sorted by most recently updated photos
  const featuredUsers = [...allEligibleUsers].sort((a, b) => {
    // 1. Users with posts first
    if (a.postCount > 0 && b.postCount === 0) return -1;
    if (a.postCount === 0 && b.postCount > 0) return 1;

    // 2. Ordered by most recently updated photo timestamp
    if (a.postCount > 0 && b.postCount > 0 && a.latestPostDate && b.latestPostDate) {
      const diff = new Date(b.latestPostDate).getTime() - new Date(a.latestPostDate).getTime();
      if (diff !== 0) return diff;
    }

    // 3. Online status priority (active > away > inactive)
    const statusScore = (s: string) => (s === 'active' ? 2 : s === 'away' ? 1 : 0);
    const scoreDiff = statusScore(b.status) - statusScore(a.status);
    if (scoreDiff !== 0) return scoreDiff;

    // 4. Alphabetical by handle
    return a.handle.localeCompare(b.handle, undefined, { sensitivity: 'base' });
  });

  return {
    active: activeUsers,
    away: awayUsers,
    inactive: inactiveUsers,
    featured: featuredUsers,
    total: allEligibleUsers.length,
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
        featured: data.featured,
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
      featuredUsers: data.featured,
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
