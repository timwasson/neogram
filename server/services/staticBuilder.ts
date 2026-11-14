import path from 'path';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import Eleventy from '@11ty/eleventy';
import { query, initDatabase } from '../db';
import { config } from '../config';
import { resolveAvatarPath } from '../utils/avatar';

export interface StaticBuildOptions {
  userId?: string;
  siteId?: string;
  outputDir?: string;
  skipFriendsFeed?: boolean;
}

export interface StaticBuildResult {
  ok: boolean;
  postsCount: number;
  outputDir: string;
  error?: string;
  durationMs?: number;
}

export interface BuildJobRecord {
  id: string;
  taskName: string;
  priority?: 'HIGH' | 'LOW';
  enqueuedAt?: string;
  startedAt: string;
  completedAt?: string;
  queueWaitMs?: number;
  durationMs?: number;
  totalTurnaroundMs?: number;
  status: 'RUNNING' | 'SUCCESS' | 'ERROR' | 'CANCELLED';
  error?: string;
}

export interface SweepTelemetry {
  isActive: boolean;
  mode: 'assets' | 'full' | null;
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  currentSite: string | null;
  startedAt: string | null;
  completedAt: string | null;
  errors: Array<{ siteName: string; handle: string; error: string }>;
}

export interface BuildPipelineTelemetry {
  isBusy: boolean;
  activeCount: number;
  highPendingCount: number;
  lowPendingCount: number;
  peakQueueDepth: number;
  totalProcessed: number;
  currentJob: BuildJobRecord | null;
  history: BuildJobRecord[];
  sweep: SweepTelemetry;
}

interface QueuedTask<T = any> {
  id: string;
  taskName: string;
  priority: 'HIGH' | 'LOW';
  task: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: any) => void;
  enqueueTime: number;
  enqueuedAtIso: string;
  throttleDelayMs?: number;
  isSweepJob?: boolean;
  siteInfo?: { siteName: string; handle: string };
}

/**
 * In-memory prioritized build queue (HIGH priority for live user activity,
 * LOW priority for background emergency sweeps / maintenance with paced throttling).
 * Ensures builds execute without collision on shared Eleventy data files.
 */
class BuildQueue {
  private highQueue: QueuedTask[] = [];
  private lowQueue: QueuedTask[] = [];
  private isProcessing: boolean = false;
  private peakQueueDepth: number = 0;
  private totalProcessed: number = 0;
  private currentActiveJob: BuildJobRecord | null = null;
  private jobHistory: BuildJobRecord[] = [];
  private wakeSleep: (() => void) | null = null;

  private sweepTelemetry: SweepTelemetry = {
    isActive: false,
    mode: null,
    total: 0,
    processed: 0,
    succeeded: 0,
    failed: 0,
    currentSite: null,
    startedAt: null,
    completedAt: null,
    errors: [],
  };

  public enqueue<T>(
    taskName: string,
    task: () => Promise<T>,
    options: {
      priority?: 'HIGH' | 'LOW';
      throttleDelayMs?: number;
      isSweepJob?: boolean;
      dedupe?: boolean;
      siteInfo?: { siteName: string; handle: string };
    } = {}
  ): Promise<T> {
    const priority = options.priority || 'HIGH';

    // Coalesce duplicate LOW-priority background cascade jobs (e.g., IncrementalFriends:<userId>)
    if (options.dedupe && priority === 'LOW') {
      const existing = this.lowQueue.find((t) => t.taskName === taskName);
      if (existing) {
        return new Promise<T>((resolve, reject) => {
          const prevResolve = existing.resolve;
          const prevReject = existing.reject;
          existing.resolve = (val: any) => {
            prevResolve(val);
            resolve(val);
          };
          existing.reject = (err: any) => {
            prevReject(err);
            reject(err);
          };
        });
      }
    }

    const enqueueTime = Date.now();
    const enqueuedAtIso = new Date(enqueueTime).toISOString();
    const id = `build_${enqueueTime}_${Math.random().toString(36).substring(2, 7)}`;

    return new Promise<T>((resolve, reject) => {
      const queuedTask: QueuedTask<T> = {
        id,
        taskName,
        priority,
        task,
        resolve,
        reject,
        enqueueTime,
        enqueuedAtIso,
        throttleDelayMs: options.throttleDelayMs,
        isSweepJob: options.isSweepJob,
        siteInfo: options.siteInfo,
      };

      if (priority === 'HIGH') {
        this.highQueue.push(queuedTask);
        // Wake low-priority throttling delay immediately if high-priority job arrives
        if (this.wakeSleep) {
          this.wakeSleep();
        }
      } else {
        this.lowQueue.push(queuedTask);
      }

      const totalPending = this.activeCount;
      if (totalPending > this.peakQueueDepth) {
        this.peakQueueDepth = totalPending;
      }

      console.log(`[:> BUILD QUEUE] Enqueued [${priority}] job '${taskName}'. Pending (H:${this.highQueue.length}, L:${this.lowQueue.length})`);

      if (!this.isProcessing) {
        this.processQueue();
      }
    });
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    while (this.highQueue.length > 0 || this.lowQueue.length > 0) {
      let currentTask: QueuedTask;
      let isLow = false;

      // High priority items ALWAYS jump ahead of low priority maintenance
      if (this.highQueue.length > 0) {
        currentTask = this.highQueue.shift()!;
      } else {
        currentTask = this.lowQueue.shift()!;
        isLow = true;
      }

      const startTime = Date.now();
      const queueWaitMs = startTime - currentTask.enqueueTime;
      const jobRecord: BuildJobRecord = {
        id: currentTask.id,
        taskName: currentTask.taskName,
        priority: currentTask.priority,
        enqueuedAt: currentTask.enqueuedAtIso,
        startedAt: new Date(startTime).toISOString(),
        queueWaitMs,
        status: 'RUNNING',
      };
      this.currentActiveJob = jobRecord;
      console.log(`[:> BUILD QUEUE] Starting [${currentTask.priority}] job '${currentTask.taskName}' (waited ${queueWaitMs}ms in queue)...`);

      try {
        const result = await currentTask.task();
        const finishTime = Date.now();
        const durationMs = finishTime - startTime;
        jobRecord.completedAt = new Date(finishTime).toISOString();
        jobRecord.durationMs = durationMs;
        jobRecord.totalTurnaroundMs = finishTime - currentTask.enqueueTime;
        jobRecord.status = 'SUCCESS';
        this.totalProcessed++;
        this.recordHistory(jobRecord);

        if (currentTask.isSweepJob) {
          this.sweepTelemetry.succeeded++;
          this.sweepTelemetry.processed++;
        }

        currentTask.resolve(result);
      } catch (err: any) {
        const finishTime = Date.now();
        const durationMs = finishTime - startTime;
        jobRecord.completedAt = new Date(finishTime).toISOString();
        jobRecord.durationMs = durationMs;
        jobRecord.totalTurnaroundMs = finishTime - currentTask.enqueueTime;
        jobRecord.status = 'ERROR';
        jobRecord.error = err?.message || String(err);
        this.totalProcessed++;
        this.recordHistory(jobRecord);

        if (currentTask.isSweepJob) {
          this.sweepTelemetry.failed++;
          this.sweepTelemetry.processed++;
          if (currentTask.siteInfo) {
            this.sweepTelemetry.errors.push({
              siteName: currentTask.siteInfo.siteName,
              handle: currentTask.siteInfo.handle,
              error: err?.message || String(err),
            });
          }
        }

        currentTask.reject(err);
      } finally {
        this.currentActiveJob = null;
        if (currentTask.isSweepJob && this.sweepTelemetry.processed >= this.sweepTelemetry.total) {
          this.sweepTelemetry.isActive = false;
          this.sweepTelemetry.completedAt = new Date().toISOString();
          this.sweepTelemetry.currentSite = null;
          console.log(`[:> FLEET SWEEP COMPLETE] Processed: ${this.sweepTelemetry.processed}, Succeeded: ${this.sweepTelemetry.succeeded}, Failed: ${this.sweepTelemetry.failed}`);
        }
      }

      // If this was a low-priority job with throttle delay, and items remain in either queue, throttle pacing!
      if (isLow && currentTask.throttleDelayMs && currentTask.throttleDelayMs > 0 && (this.highQueue.length > 0 || this.lowQueue.length > 0)) {
        await this.sleepWithInterrupt(currentTask.throttleDelayMs);
      }
    }

    this.isProcessing = false;
  }

  private sleepWithInterrupt(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      let timer: NodeJS.Timeout | null = null;
      const done = () => {
        if (timer) clearTimeout(timer);
        this.wakeSleep = null;
        resolve();
      };
      this.wakeSleep = done;
      timer = setTimeout(done, ms);
    });
  }

  public cancelSweep(): { cancelledCount: number } {
    let cancelledCount = 0;
    const remainingLow: QueuedTask[] = [];

    for (const task of this.lowQueue) {
      if (task.isSweepJob) {
        cancelledCount++;
        task.reject(new Error('Fleet sweep cancelled by SysOp administrator.'));
      } else {
        remainingLow.push(task);
      }
    }

    this.lowQueue = remainingLow;

    if (this.sweepTelemetry.isActive) {
      this.sweepTelemetry.isActive = false;
      this.sweepTelemetry.completedAt = new Date().toISOString();
      this.sweepTelemetry.currentSite = 'Cancelled by SysOp';
    }

    console.log(`[:> FLEET SWEEP CANCELLED] Cancelled ${cancelledCount} queued sweep jobs.`);
    return { cancelledCount };
  }

  public startSweep(mode: 'assets' | 'full', total: number): void {
    this.sweepTelemetry = {
      isActive: true,
      mode,
      total,
      processed: 0,
      succeeded: 0,
      failed: 0,
      currentSite: 'Initializing sweep...',
      startedAt: new Date().toISOString(),
      completedAt: null,
      errors: [],
    };
  }

  public updateSweepCurrentSite(siteLabel: string): void {
    if (this.sweepTelemetry.isActive) {
      this.sweepTelemetry.currentSite = siteLabel;
    }
  }

  public getSweepTelemetry(): SweepTelemetry {
    return { ...this.sweepTelemetry, errors: [...this.sweepTelemetry.errors] };
  }

  private recordHistory(record: BuildJobRecord) {
    this.jobHistory.unshift(record);
    if (this.jobHistory.length > 100) {
      this.jobHistory.pop();
    }
  }

  public resetTelemetry() {
    this.peakQueueDepth = this.activeCount;
    this.totalProcessed = 0;
    this.jobHistory = [];
  }

  public get pending(): number {
    return this.highQueue.length + this.lowQueue.length;
  }

  public get highPending(): number {
    return this.highQueue.length;
  }

  public get lowPending(): number {
    return this.lowQueue.length;
  }

  public get activeCount(): number {
    return (this.currentActiveJob ? 1 : 0) + this.pending;
  }

  public getTelemetry(): BuildPipelineTelemetry {
    return {
      isBusy: this.currentActiveJob !== null || this.pending > 0,
      activeCount: this.activeCount,
      highPendingCount: this.highQueue.length,
      lowPendingCount: this.lowQueue.length,
      peakQueueDepth: this.peakQueueDepth,
      totalProcessed: this.totalProcessed,
      currentJob: this.currentActiveJob,
      history: [...this.jobHistory],
      sweep: this.getSweepTelemetry(),
    };
  }
}

export const buildQueue = new BuildQueue();

/**
 * Cleans up HTML, CSS, and JS static site bundle assets from the output directory
 * when running in Headless API mode. Strictly preserves uploads/ and data/ directories.
 */
async function cleanHtmlArtifacts(dir: string): Promise<void> {
  const itemsToRemove = [
    'index.html',
    'friends',
    'photos',
    'css',
    'js',
    'embed',
    'icons',
    'favicon.ico',
    'favicon-32x32.png',
    'favicon-16x16.png',
    'apple-touch-icon.png',
    'embed.js',
    'pager.js',
    'neogram-embed.css',
    'id',
    '800',
  ];

  for (const item of itemsToRemove) {
    const itemPath = path.join(dir, item);
    try {
      if (existsSync(itemPath)) {
        await fs.rm(itemPath, { recursive: true, force: true });
      }
    } catch (_err) {}
  }
}

/**
 * Executes a static 11ty gallery compilation.
 * Internal worker function dispatched exclusively through buildQueue.
 */
export async function executeStaticBuild(options: StaticBuildOptions = {}): Promise<StaticBuildResult> {
  const startTime = Date.now();
  try {
    // 0. Ensure database is connected
    await initDatabase();

    const { userId, siteId } = options;
    let targetSite: any = null;
    let effectiveUserId = userId;

    if (siteId) {
      const siteRes = await query(
        `SELECT s.*, u.id as user_owner_id, u.email, u.handle, u.uin, u.avatar_path, u.status_message, u.description
         FROM sites s
         JOIN users u ON s.user_id = u.id
         WHERE s.id = $1`,
        [siteId]
      );
      if (siteRes.rows.length > 0) {
        targetSite = siteRes.rows[0];
        effectiveUserId = targetSite.user_owner_id;
      }
    } else if (userId) {
      const siteRes = await query(
        `SELECT s.*, u.id as user_owner_id, u.email, u.handle, u.uin, u.avatar_path, u.status_message, u.description
         FROM sites s
         JOIN users u ON s.user_id = u.id
         WHERE s.user_id = $1 AND s.is_default = TRUE
         LIMIT 1`,
        [userId]
      );
      if (siteRes.rows.length > 0) {
        targetSite = siteRes.rows[0];
      }
    }

    // Multi-tenant isolated output folder per site or user
    const targetOutputDir = options.outputDir || (
      siteId
        ? path.join(process.cwd(), 'dist/static-galleries', siteId)
        : (userId 
            ? path.join(process.cwd(), 'dist/static-galleries', userId)
            : path.join(process.cwd(), 'dist/static-galleries/default'))
    );

    // 1. Fetch posts from static storage
    const { getPostsForSite, getPostsForUser, getAllPosts, snapshotPostsFile, writeBuildJsonIfUnchanged } = await import('./postStorage');
    const { getCommentsRelativePath } = await import('./staticStorage');
    // Snapshot before reading so a post saved mid-build is never overwritten by this build's copy.
    let postsSnapshot = await snapshotPostsFile(targetOutputDir);

    const rawPosts = siteId
      ? await getPostsForSite(siteId)
      : (userId ? await getPostsForUser(userId) : await getAllPosts());

    // If siteId is the user's default/primary site, adopt any unassigned posts belonging to effectiveUserId
    if (siteId && effectiveUserId && (targetSite?.is_default || rawPosts.length === 0)) {
      const { getPostsForSite: getFallbackPosts, savePost } = await import('./postStorage');
      const fallbackPosts = await getFallbackPosts(effectiveUserId);
      const unassigned = fallbackPosts.filter((p) => !p.siteId);
      if (unassigned.length > 0) {
        const existingIds = new Set(rawPosts.map((p) => p.id));
        for (const unassignedPost of unassigned) {
          if (!existingIds.has(unassignedPost.id)) {
            const adoptedPost = {
              ...unassignedPost,
              siteId: siteId,
              siteName: targetSite?.name || unassignedPost.siteName,
              siteSlug: targetSite?.slug || unassignedPost.siteSlug,
            };
            await savePost(adoptedPost);
            rawPosts.push(adoptedPost);
            existingIds.add(adoptedPost.id);
          }
        }
        rawPosts.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      }
    }

    const commentsByPost: Record<string, any[]> = {};
    for (const post of rawPosts) {
      if (post.imagePath) {
        const relPath = getCommentsRelativePath(post.imagePath);
        const jsonFilePath = path.join(targetOutputDir, relPath);

        // Check if old legacy double-path file exists on disk and migrate it
        const legacyPath = path.join(targetOutputDir, 'neogram', relPath);
        try {
          if (existsSync(legacyPath) && !existsSync(jsonFilePath)) {
            await fs.mkdir(path.dirname(jsonFilePath), { recursive: true });
            await fs.copyFile(legacyPath, jsonFilePath);
            await fs.unlink(legacyPath).catch(() => {});
          }
        } catch (_migErr) {}

        try {
          if (!existsSync(jsonFilePath)) {
            await fs.mkdir(path.dirname(jsonFilePath), { recursive: true });
            const initialData = {
              version: 'neogram-comments-v1',
              postId: post.id,
              updatedAt: new Date().toISOString(),
              comments: post.comments || [],
            };
            await fs.writeFile(jsonFilePath, JSON.stringify(initialData, null, 2), 'utf-8');
            commentsByPost[post.id] = post.comments || [];
          } else {
            const raw = await fs.readFile(jsonFilePath, 'utf-8');
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed.comments)) {
              commentsByPost[post.id] = parsed.comments;
            } else {
              commentsByPost[post.id] = post.comments || [];
            }
          }
        } catch (_err) {
          commentsByPost[post.id] = post.comments || [];
        }
      }
    }

    const posts = rawPosts.map((post) => ({
      ...post,
      comments: commentsByPost[post.id] || post.comments || [],
    }));

    // 3. User metadata & Headless API configuration
    let author = 'user';
    let authorUin: number | undefined = undefined;
    let baseSiteUrl = 'https://user.neocities.org';
    let rawDeployPath = 'neogram';
    let fullSiteUrl = `${baseSiteUrl}/${rawDeployPath}`;
    let avatarUrl = '/icons/default-avatar.svg';
    let statusMessage = 'Surfing cyberspace';
    let customCssUrl: string | null = null;
    let shouldBuildHtml = true;
    let pathPrefix = '/';

    if (targetSite) {
      author = targetSite.handle || targetSite.email.split('@')[0];
      authorUin = targetSite.uin ? parseInt(targetSite.uin, 10) : undefined;
      rawDeployPath = targetSite.deploy_path !== null && targetSite.deploy_path !== undefined
        ? String(targetSite.deploy_path).trim().replace(/^\/+|\/+$/g, '')
        : 'neogram';
      baseSiteUrl = targetSite.site_url ? targetSite.site_url.replace(/\/+$/, '') : `https://${author}.neocities.org`;
      fullSiteUrl = rawDeployPath ? `${baseSiteUrl}/${rawDeployPath}` : baseSiteUrl;
      try {
        const parsedUrl = new URL(fullSiteUrl.startsWith('http') ? fullSiteUrl : `https://${fullSiteUrl}`);
        const pathname = parsedUrl.pathname.replace(/\/+$/, '');
        pathPrefix = pathname ? `${pathname}/` : '/';
      } catch (_e) {
        pathPrefix = rawDeployPath ? `/${rawDeployPath}/` : '/';
      }
      avatarUrl = resolveAvatarPath({
        avatarPath: targetSite.avatar_path,
        deploymentType: targetSite.deployment_type,
        siteUrl: targetSite.site_url,
        uin: authorUin,
        handle: author,
      });
      statusMessage = targetSite.status_message || 'Surfing cyberspace';
      customCssUrl = targetSite.custom_css_url || null;
      shouldBuildHtml = targetSite.build_html !== false;

      const siteData = {
        title: `${(targetSite.name || 'STATIC PHOTO STREAM').toUpperCase()} // @${author.toUpperCase()}`,
        siteName: targetSite.name,
        siteSlug: targetSite.slug,
        author: author,
        avatarUrl: avatarUrl,
        description: targetSite.description || targetSite.status_message || 'Personal photo stream published via Neogram',
        neocitiesUrl: fullSiteUrl,
        baseSiteUrl: baseSiteUrl,
        authorSiteUrl: baseSiteUrl,
        pathPrefix: pathPrefix,
        apiUrl: config.appUrl || 'http://localhost:4000',
        systemMood: '[:> SURFING THE RETRO STATIC WEBRING]',
        customCssUrl: customCssUrl,
        // The workstation toggle is per member (notification_preferences), not per site.
        chatWidgetEnabled: (await (await import('./notificationService')).getNotificationPreferences(targetSite.user_id)).chatWidgetEnabled !== false,
      };
      const siteJsonPath = path.join(process.cwd(), 'eleventy/src/_data/site.json');
      await fs.writeFile(siteJsonPath, JSON.stringify(siteData, null, 2), 'utf-8');
    } else if (userId) {
      const userRes = await query(
        'SELECT id, email, handle, uin, site_url, deploy_path, avatar_path, custom_css_url, build_html, status_message, description FROM users WHERE id = $1',
        [userId]
      );
      if (userRes.rows.length > 0) {
        const u = userRes.rows[0];
        author = u.handle || u.email.split('@')[0];
        authorUin = u.uin ? parseInt(u.uin, 10) : undefined;
        rawDeployPath = u.deploy_path !== null && u.deploy_path !== undefined
          ? String(u.deploy_path).trim().replace(/^\/+|\/+$/g, '')
          : 'neogram';
        baseSiteUrl = u.site_url ? u.site_url.replace(/\/+$/, '') : `https://${author}.neocities.org`;
        fullSiteUrl = rawDeployPath ? `${baseSiteUrl}/${rawDeployPath}` : baseSiteUrl;
        try {
          const parsedUrl = new URL(fullSiteUrl.startsWith('http') ? fullSiteUrl : `https://${fullSiteUrl}`);
          const pathname = parsedUrl.pathname.replace(/\/+$/, '');
          pathPrefix = pathname ? `${pathname}/` : '/';
        } catch (_e) {
          pathPrefix = rawDeployPath ? `/${rawDeployPath}/` : '/';
        }
        avatarUrl = resolveAvatarPath({
          avatarPath: u.avatar_path,
          deploymentType: u.deployment_type,
          siteUrl: u.site_url,
          uin: authorUin,
          handle: author,
        });
        statusMessage = u.status_message || 'Surfing cyberspace';
        customCssUrl = u.custom_css_url || null;
        shouldBuildHtml = u.build_html !== false;

        const prefRes = await query(
          'SELECT chat_widget_enabled FROM notification_preferences WHERE user_id = $1',
          [userId]
        );
        const chatWidgetEnabled = prefRes.rows.length > 0 ? prefRes.rows[0].chat_widget_enabled !== false : true;

        const siteData = {
          title: `@${author.toUpperCase()}'S STATIC PHOTO STREAM`,
          author: author,
          avatarUrl: avatarUrl,
          description: u.description || u.status_message || 'Personal photo stream published via Neogram',
          neocitiesUrl: fullSiteUrl,
          baseSiteUrl: baseSiteUrl,
          authorSiteUrl: baseSiteUrl,
          pathPrefix: pathPrefix,
          apiUrl: config.appUrl || 'http://localhost:4000',
          systemMood: '[:> SURFING THE RETRO STATIC WEBRING]',
          customCssUrl: customCssUrl,
          chatWidgetEnabled: chatWidgetEnabled,
        };
        const siteJsonPath = path.join(process.cwd(), 'eleventy/src/_data/site.json');
        await fs.writeFile(siteJsonPath, JSON.stringify(siteData, null, 2), 'utf-8');
      }
    }

    // 4. Fetch friends' posts for static /friends/ grid strictly from friends' live feed.json
    let friendsPosts: any[] = [];
    const targetFollowerId = effectiveUserId || userId;
    if (targetFollowerId && !options.skipFriendsFeed) {
      const { aggregateFederatedFriendsFeed } = await import('./federatedFriends');
      const friendsRes = await query(`
        SELECT 
          u.id, 
          u.email, 
          COALESCE(u.handle, split_part(u.email, '@', 1)) as handle,
          u.uin,
          u.avatar_path as "avatarPath",
          COALESCE(s.site_url, u.site_url) as "siteUrl",
          COALESCE(s.deploy_path, u.deploy_path) as "deployPath",
          COALESCE(s.last_deployed_at, u.last_deployed_at) as "lastDeployedAt",
          s.id as "siteId"
        FROM follows f
        JOIN users u ON f.following_id = u.id
        LEFT JOIN sites s ON s.user_id = u.id AND s.is_default = TRUE
        WHERE f.follower_id = $1
        ORDER BY LOWER(COALESCE(u.handle, split_part(u.email, '@', 1))) ASC
      `, [targetFollowerId]);

      const friendTargets = friendsRes.rows.map((r: any) => ({
        id: r.id,
        email: r.email,
        handle: r.handle,
        uin: r.uin,
        avatarPath: resolveAvatarPath({
          avatarPath: r.avatarPath,
          siteUrl: r.siteUrl,
          uin: r.uin,
          handle: r.handle,
        }),
        siteUrl: r.siteUrl,
        deployPath: r.deployPath,
        lastDeployedAt: r.lastDeployedAt,
        siteId: r.siteId,
      }));

      const federatedPosts = await aggregateFederatedFriendsFeed(friendTargets, 100);
      friendsPosts = federatedPosts.map((p) => ({
        id: p.id,
        caption: p.caption,
        imagePath: p.imageUrl || p.imagePath,
        thumbnailPath: p.thumbnailUrl || p.thumbnailPath || p.imageUrl || p.imagePath,
        imageUrl: p.imageUrl,
        thumbnailUrl: p.thumbnailUrl,
        filterApplied: p.filter || (p as any).filterApplied || 'none',
        mood: p.mood || null,
        webring: p.webring || null,
        location: p.location || null,
        likes: p.likes || 0,
        createdAt: p.createdAt,
        author: p.author,
        authorHandle: p.authorHandle || p.author,
        authorUin: p.authorUin,
        authorAvatar: p.authorAvatar,
        authorSiteUrl: p.authorSiteUrl,
        profileUrl: p.profileUrl,
      }));
    }

    const friendsPostsPath = path.join(process.cwd(), 'eleventy/src/_data/friendsPosts.json');
    await fs.writeFile(friendsPostsPath, JSON.stringify(friendsPosts, null, 2), 'utf-8');

    // 5. Write data to eleventy/src/_data/posts.json
    const postsDataPath = path.join(process.cwd(), 'eleventy/src/_data/posts.json');
    await fs.writeFile(postsDataPath, JSON.stringify(posts, null, 2), 'utf-8');

    // 6. Build Comprehensive JSON Feeds for Self-Hosted Static API
    const baseNeogramUrl = config.appUrl || 'http://localhost:4000';
    let fullAvatarUrl = avatarUrl;
    if (fullAvatarUrl && !fullAvatarUrl.startsWith('http://') && !fullAvatarUrl.startsWith('https://')) {
      fullAvatarUrl = `${baseNeogramUrl}${fullAvatarUrl.startsWith('/') ? '' : '/'}${fullAvatarUrl}`;
    }

    const formattedPosts = posts.map((post) => {
      let imageUrl = post.imagePath;
      let thumbnailUrl = post.thumbnailPath;
      if (imageUrl && !imageUrl.startsWith('http://') && !imageUrl.startsWith('https://')) {
        imageUrl = `${fullSiteUrl}${imageUrl.startsWith('/') ? '' : '/'}${imageUrl}`;
      }
      if (thumbnailUrl && !thumbnailUrl.startsWith('http://') && !thumbnailUrl.startsWith('https://')) {
        thumbnailUrl = `${fullSiteUrl}${thumbnailUrl.startsWith('/') ? '' : '/'}${thumbnailUrl}`;
      }

      const postPhotos = (post.photos || []).map((pic: any) => {
        let pImg = pic.imagePath;
        let pThumb = pic.thumbnailPath || pic.imagePath;
        if (pImg && !pImg.startsWith('http://') && !pImg.startsWith('https://')) {
          pImg = `${fullSiteUrl}${pImg.startsWith('/') ? '' : '/'}${pImg}`;
        }
        if (pThumb && !pThumb.startsWith('http://') && !pThumb.startsWith('https://')) {
          pThumb = `${fullSiteUrl}${pThumb.startsWith('/') ? '' : '/'}${pThumb}`;
        }
        return {
          imagePath: pImg,
          thumbnailPath: pThumb,
        };
      });

      return {
        id: post.id,
        userId: post.userId,
        siteId: post.siteId,
        siteName: post.siteName,
        siteSlug: post.siteSlug,
        caption: post.caption,
        imagePath: post.imagePath,
        thumbnailPath: post.thumbnailPath,
        photos: postPhotos.length > 0 ? postPhotos : [{ imagePath: imageUrl, thumbnailPath: thumbnailUrl }],
        imageUrl: imageUrl,
        thumbnailUrl: thumbnailUrl,
        filterApplied: post.filterApplied || 'none',
        mood: post.mood || null,
        webring: post.webring || null,
        location: post.location || null,
        likes: typeof post.likes === 'number' ? post.likes : (parseInt(String(post.likes || '0'), 10) || 0),
        createdAt: post.createdAt,
        commentsCount: (post.comments || []).length,
        comments: post.comments || [],
        commentsUrl: getCommentsRelativePath(post.imagePath),
        actions: {
          likeUrl: `${baseNeogramUrl}/api/posts/${post.id}/like`,
          commentUrl: `${baseNeogramUrl}/api/posts/${post.id}/comments`,
        },
        siteUrl: post.siteUrl || baseSiteUrl,
        galleryUrl: post.galleryUrl || `${fullSiteUrl}/`,
        livePhotoUrl: post.livePhotoUrl || `${fullSiteUrl}/photos/${post.id}/`,
      };
    });

    const feedData = {
      version: 'neogram-api-v1',
      generatedAt: new Date().toISOString(),
      user: {
        id: userId || 'station',
        uin: authorUin,
        handle: author,
        author: author,
        avatarUrl: fullAvatarUrl,
        siteUrl: baseSiteUrl,
        deployPath: rawDeployPath,
        fullSiteUrl: fullSiteUrl,
        statusMessage: statusMessage,
        customCssUrl: customCssUrl,
      },
      endpoints: {
        apiUrl: baseNeogramUrl,
        followUrl: `${baseNeogramUrl}/api/users/${author}/follow`,
        unfollowUrl: `${baseNeogramUrl}/api/users/${author}/follow`,
        guestbookUrl: `${baseNeogramUrl}/api/guestbook/${authorUin || author}`,
        counterUrl: `${baseNeogramUrl}/counter/${author}.svg`,
        feedUrl: `${fullSiteUrl}/feed.json`,
      },
      posts: formattedPosts,
      friends: friendsPosts,
    };

    await fs.mkdir(targetOutputDir, { recursive: true });
    const writeJsonOutputs = async () => {
      const r = await writeBuildJsonIfUnchanged(targetOutputDir, postsSnapshot, feedData, formattedPosts);
      postsSnapshot = r.snapshot;
    };
    await writeJsonOutputs();

    // Capture counter snapshot to data/counter.json if user has a counter configured
    const { getCounterRelativePath, getCounterSnapshot } = await import('./staticStorage');
    const counterSnapshot = await getCounterSnapshot(targetSite?.id || siteId, effectiveUserId);
    if (counterSnapshot) {
      const relCounterPath = getCounterRelativePath();
      const counterLocalPath = path.join(targetOutputDir, relCounterPath);
      await fs.mkdir(path.dirname(counterLocalPath), { recursive: true });
      await fs.writeFile(counterLocalPath, JSON.stringify(counterSnapshot, null, 2), 'utf-8');
      console.log(`[:> STATIC-BUILD] Counter snapshot written (${counterSnapshot.hits} hits) -> ${relCounterPath}`);
    }

    // 7. Invoke Eleventy builder or Headless API mode
    if (shouldBuildHtml) {
      const inputDir = path.join(process.cwd(), 'eleventy/src');
      const configPath = path.join(process.cwd(), 'eleventy/eleventy.config.js');

      process.env.ELEVENTY_OUTPUT_DIR = path.relative(process.cwd(), targetOutputDir);
      process.env.ELEVENTY_PATH_PREFIX = pathPrefix;

      const elev = new Eleventy(inputDir, targetOutputDir, {
        configPath: configPath,
        pathPrefix: pathPrefix,
      });

      await elev.write();

      // Re-ensure self-hosted feed.json and posts.json are preserved in targetOutputDir
      await writeJsonOutputs();

      const durationMs = Date.now() - startTime;
      console.log(`[:> 11ty] Static gallery compiled (HTML + JSON): ${posts.length} photos in ${durationMs}ms -> ${targetOutputDir}`);

      return {
        ok: true,
        postsCount: posts.length,
        outputDir: targetOutputDir,
        durationMs,
      };
    } else {
      // Headless API mode: clean up HTML pages/assets, strictly preserving uploads/ and JSON feeds
      await cleanHtmlArtifacts(targetOutputDir);

      // Re-write feed.json and posts.json in targetOutputDir
      await writeJsonOutputs();

      const durationMs = Date.now() - startTime;
      console.log(`[:> STATIC-BUILD] Headless API mode active for ${userId || 'station'}: ${posts.length} photos in JSON feeds (${durationMs}ms) -> ${targetOutputDir} (HTML generation skipped)`);

      return {
        ok: true,
        postsCount: posts.length,
        outputDir: targetOutputDir,
        durationMs,
      };
    }
  } catch (err: any) {
    console.error('[:> 11ty ERROR] Static build failed:', err);
    return {
      ok: false,
      postsCount: 0,
      outputDir: options.outputDir || (options.userId ? `dist/static-galleries/${options.userId}` : 'dist/static-galleries/default'),
      error: err.message || String(err),
      durationMs: Date.now() - startTime,
    };
  }
}

/**
 * Builds the static 11ty gallery from PostgreSQL posts.
 * Automatically dispatched through the FIFO BuildQueue to serialize execution,
 * guarantee per-user directory isolation, and eliminate concurrency collisions.
 */
export async function buildStaticGallery(options: StaticBuildOptions = {}): Promise<StaticBuildResult> {
  const jobLabel = options.siteId ? `Site:${options.siteId}` : (options.userId ? `User:${options.userId}` : 'Global');
  return buildQueue.enqueue(jobLabel, () => executeStaticBuild(options));
}
