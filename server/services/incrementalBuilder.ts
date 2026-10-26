import path from 'path';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import { query } from '../db';
import { config } from '../config';
import { buildQueue } from './staticBuilder';
import { renderPhotoPage, renderGalleryIndex, renderFriendsPage, ensureStaticAssets } from './incrementalRenderer';
import { getCommentsRelativePath } from './staticStorage';
import { deployFilesToNeocities, DeltaFile } from './neocitiesPublisher';
import { deployFilesToNekoweb } from './nekowebPublisher';
import { decryptCredentials, NeocitiesCredentials, NekowebCredentials } from '../utils/crypto';

export interface IncrementalResult {
  ok: boolean;
  message?: string;
  filesCount: number;
  durationMs: number;
  deployedRemote?: boolean;
  error?: string;
}

/**
 * Helper to resolve site and user configuration and output directory.
 */
async function resolveTargetContext(siteId?: string, userId?: string) {
  let targetSite: any = null;
  let effectiveUserId = userId;

  if (siteId) {
    const siteRes = await query(
      `SELECT s.*, u.id as user_owner_id, u.email, u.handle, u.uin, u.avatar_path, u.status_message
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
      `SELECT s.*, u.id as user_owner_id, u.email, u.handle, u.uin, u.avatar_path, u.status_message
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

  let author = 'user';
  let authorUin: number | undefined = undefined;
  let baseSiteUrl = 'https://user.neocities.org';
  let rawDeployPath = 'neogram';
  let fullSiteUrl = `${baseSiteUrl}/${rawDeployPath}`;
  let avatarUrl = '/icons/default-avatar.svg';
  let statusMessage = 'Surfing cyberspace';
  let customCssUrl: string | null = null;
  let shouldBuildHtml = true;
  let chatWidgetEnabled = true;
  let deploymentType = 'none';
  let deploymentCredsRaw: any = null;
  let autoDeploy = false;

  if (targetSite) {
    author = targetSite.handle || targetSite.email.split('@')[0];
    authorUin = targetSite.uin ? parseInt(targetSite.uin, 10) : undefined;
    rawDeployPath = targetSite.deploy_path !== null && targetSite.deploy_path !== undefined
      ? String(targetSite.deploy_path).trim().replace(/^\/+|\/+$/g, '')
      : 'neogram';
    baseSiteUrl = targetSite.site_url ? targetSite.site_url.replace(/\/+$/, '') : `https://${author}.neocities.org`;
    fullSiteUrl = rawDeployPath ? `${baseSiteUrl}/${rawDeployPath}` : baseSiteUrl;
    avatarUrl = targetSite.avatar_path || '/icons/default-avatar.svg';
    statusMessage = targetSite.status_message || 'Surfing cyberspace';
    customCssUrl = targetSite.custom_css_url || null;
    shouldBuildHtml = targetSite.build_html !== false;
    chatWidgetEnabled = targetSite.chat_widget_enabled !== false;
    deploymentType = targetSite.deployment_type || 'none';
    deploymentCredsRaw = targetSite.deployment_credentials;
    autoDeploy = targetSite.auto_deploy === true;
  } else if (userId) {
    const userRes = await query(
      'SELECT id, email, handle, uin, site_url, deploy_path, avatar_path, custom_css_url, build_html, status_message, deployment_type, deployment_credentials, auto_deploy FROM users WHERE id = $1',
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
      avatarUrl = u.avatar_path || '/icons/default-avatar.svg';
      statusMessage = u.status_message || 'Surfing cyberspace';
      customCssUrl = u.custom_css_url || null;
      shouldBuildHtml = u.build_html !== false;
      deploymentType = u.deployment_type || 'none';
      deploymentCredsRaw = u.deployment_credentials;
      autoDeploy = u.auto_deploy === true;

      const prefRes = await query(
        'SELECT chat_widget_enabled FROM notification_preferences WHERE user_id = $1',
        [userId]
      );
      chatWidgetEnabled = prefRes.rows.length > 0 ? prefRes.rows[0].chat_widget_enabled !== false : true;
    }
  }

  const pathPrefix = rawDeployPath ? `/${rawDeployPath}/` : '/';

  const siteData = {
    title: targetSite?.name ? `${targetSite.name.toUpperCase()} // @${author.toUpperCase()}` : `@${author.toUpperCase()}'S STATIC PHOTO STREAM`,
    siteName: targetSite?.name || 'Personal Gallery',
    siteSlug: targetSite?.slug || 'default',
    author,
    avatarUrl,
    description: 'Personal 90s retro static photo stream published via Neogram',
    neocitiesUrl: fullSiteUrl,
    pathPrefix,
    apiUrl: config.appUrl || 'http://localhost:4000',
    systemMood: '[:> SURFING THE RETRO STATIC WEBRING]',
    customCssUrl,
    chatWidgetEnabled,
  };

  const outputDir = siteId
    ? path.join(process.cwd(), 'dist/static-galleries', siteId)
    : (userId
        ? path.join(process.cwd(), 'dist/static-galleries', userId)
        : path.join(process.cwd(), 'dist/static-galleries/default'));

  return {
    targetSite,
    effectiveUserId,
    author,
    authorUin,
    baseSiteUrl,
    rawDeployPath,
    fullSiteUrl,
    pathPrefix,
    avatarUrl,
    statusMessage,
    customCssUrl,
    shouldBuildHtml,
    chatWidgetEnabled,
    deploymentType,
    deploymentCredsRaw,
    autoDeploy,
    siteData,
    outputDir,
  };
}

/**
 * Dispatches a delta deployment to Neocities or Nekoweb if credentials are configured.
 */
async function dispatchDeltaDeploy(
  targetId: string,
  deploymentType: string,
  credsRaw: any,
  files: DeltaFile[],
  isSiteId: boolean = true
): Promise<{ deployed: boolean; durationMs: number }> {
  if (!credsRaw || files.length === 0) return { deployed: false, durationMs: 0 };

  if (deploymentType === 'neocities') {
    const creds = decryptCredentials<NeocitiesCredentials>(credsRaw);
    if (!creds || !creds.apiKey || !creds.apiKey.trim()) return { deployed: false, durationMs: 0 };
    const res = await deployFilesToNeocities(targetId, files, isSiteId);
    return { deployed: res.ok, durationMs: res.durationMs };
  } else if (deploymentType === 'nekoweb') {
    const creds = decryptCredentials<NekowebCredentials>(credsRaw);
    if (!creds || !creds.apiKey || !creds.apiKey.trim()) return { deployed: false, durationMs: 0 };
    const res = await deployFilesToNekoweb(targetId, files, isSiteId);
    return { deployed: res.ok, durationMs: res.durationMs };
  }

  return { deployed: false, durationMs: 0 };
}

/**
 * Helper to fetch and format all posts for a site/user.
 */
async function fetchFormattedPosts(siteId?: string, userId?: string, fullSiteUrl: string = '', baseNeogramUrl: string = '') {
  let postsRes;
  if (siteId) {
    postsRes = await query(
      `SELECT 
        p.id,
        p.user_id as "userId",
        p.site_id as "siteId",
        p.image_path as "imagePath",
        p.thumbnail_path as "thumbnailPath",
        p.caption,
        p.filter_applied as "filterApplied",
        p.mood,
        p.webring,
        p.location,
        p.likes_count as "likes",
        p.created_at as "createdAt",
        u.email,
        u.handle,
        COALESCE(u.handle, split_part(u.email, '@', 1)) as author
      FROM posts p
      JOIN users u ON p.user_id = u.id
      WHERE p.site_id = $1
      ORDER BY p.created_at DESC`,
      [siteId]
    );
  } else {
    postsRes = await query(
      `SELECT 
        p.id,
        p.user_id as "userId",
        p.site_id as "siteId",
        p.image_path as "imagePath",
        p.thumbnail_path as "thumbnailPath",
        p.caption,
        p.filter_applied as "filterApplied",
        p.mood,
        p.webring,
        p.location,
        p.likes_count as "likes",
        p.created_at as "createdAt",
        u.email,
        u.handle,
        COALESCE(u.handle, split_part(u.email, '@', 1)) as author
      FROM posts p
      JOIN users u ON p.user_id = u.id
      WHERE p.user_id = $1
      ORDER BY p.created_at DESC`,
      [userId]
    );
  }

  // Fetch comments from database
  const commentsRes = await query(`
    SELECT id, post_id as "postId", author_name as "author", author_avatar as "avatar", body as "text", created_at as "timestamp"
    FROM comments
    ORDER BY created_at ASC
  `);
  const commentsByPost: Record<string, any[]> = {};
  for (const c of commentsRes.rows) {
    if (!commentsByPost[c.postId]) commentsByPost[c.postId] = [];
    commentsByPost[c.postId].push(c);
  }

  return postsRes.rows.map((post) => {
    let imageUrl = post.imagePath;
    let thumbnailUrl = post.thumbnailPath;
    if (imageUrl && !imageUrl.startsWith('http://') && !imageUrl.startsWith('https://')) {
      imageUrl = `${fullSiteUrl}${imageUrl.startsWith('/') ? '' : '/'}${imageUrl}`;
    }
    if (thumbnailUrl && !thumbnailUrl.startsWith('http://') && !thumbnailUrl.startsWith('https://')) {
      thumbnailUrl = `${fullSiteUrl}${thumbnailUrl.startsWith('/') ? '' : '/'}${thumbnailUrl}`;
    }

    const comments = commentsByPost[post.id] || [];

    return {
      id: post.id,
      userId: post.userId,
      siteId: post.siteId,
      author: post.author,
      caption: post.caption,
      imagePath: post.imagePath,
      thumbnailPath: post.thumbnailPath,
      imageUrl,
      thumbnailUrl,
      filterApplied: post.filterApplied || 'none',
      mood: post.mood || null,
      webring: post.webring || null,
      location: post.location || null,
      likes: parseInt(post.likes, 10) || 0,
      createdAt: post.createdAt,
      commentsCount: comments.length,
      comments,
      commentsUrl: getCommentsRelativePath(post.imagePath),
      actions: {
        likeUrl: `${baseNeogramUrl}/api/posts/${post.id}/like`,
        commentUrl: `${baseNeogramUrl}/api/posts/${post.id}/comments`,
      },
    };
  });
}

/**
 * High-speed incremental build and deploy for a newly uploaded photo:
 * - Builds: index.html (gallery) + photos/<newPhotoId>/index.html (only this photo) + feed.json/posts.json
 * - Deploys ONLY: newly uploaded media + new comments JSON + new photo HTML + gallery HTML + feed JSON
 * - Leaves untouched: all older photo pages, CSS, JS, icons, and embeds
 */
export async function buildAndDeployNewPhoto(options: {
  siteId: string;
  userId: string;
  postId: string;
  imagePath: string;
  thumbnailPath: string;
}): Promise<IncrementalResult> {
  const startTime = Date.now();
  const { siteId, userId, postId, imagePath, thumbnailPath } = options;

  return buildQueue.enqueue(`IncrementalPhoto:${postId}`, async () => {
    console.log(`[:> INCREMENTAL BUILD] Compiling new photo ${postId} for site ${siteId}...`);

    const ctx = await resolveTargetContext(siteId, userId);
    const { siteData, outputDir, shouldBuildHtml, fullSiteUrl, deploymentType, deploymentCredsRaw } = ctx;
    const baseNeogramUrl = config.appUrl || 'http://localhost:4000';

    await fs.mkdir(outputDir, { recursive: true });
    await ensureStaticAssets(outputDir);

    // 1. Fetch all formatted posts
    const formattedPosts = await fetchFormattedPosts(siteId, userId, fullSiteUrl, baseNeogramUrl);
    const newPost = formattedPosts.find((p) => p.id === postId) || formattedPosts[0];

    // 2. Write initial comments JSON for the new photo
    const relCommentsPath = getCommentsRelativePath(imagePath);
    const jsonLocalPath = path.join(outputDir, relCommentsPath);
    await fs.mkdir(path.dirname(jsonLocalPath), { recursive: true });
    const initialCommentsPayload = {
      version: 'neogram-comments-v1',
      postId,
      updatedAt: new Date().toISOString(),
      comments: [],
    };
    await fs.writeFile(jsonLocalPath, JSON.stringify(initialCommentsPayload, null, 2), 'utf-8');

    // 3. Write structured feed.json and posts.json
    const feedData = {
      version: 'neogram-api-v1',
      generatedAt: new Date().toISOString(),
      user: {
        id: ctx.effectiveUserId || userId,
        uin: ctx.authorUin,
        handle: ctx.author,
        siteUrl: ctx.baseSiteUrl,
        deployPath: ctx.rawDeployPath,
        fullSiteUrl: ctx.fullSiteUrl,
        statusMessage: ctx.statusMessage,
      },
      posts: formattedPosts,
    };
    const feedJsonPath = path.join(outputDir, 'feed.json');
    const postsJsonPath = path.join(outputDir, 'posts.json');
    await fs.writeFile(feedJsonPath, JSON.stringify(feedData, null, 2), 'utf-8');
    await fs.writeFile(postsJsonPath, JSON.stringify(formattedPosts, null, 2), 'utf-8');

    // 4. Render HTML templates (only index.html and photos/<newPhotoId>/index.html)
    const deltaFiles: DeltaFile[] = [
      { relativePath: relCommentsPath, absolutePath: jsonLocalPath },
      { relativePath: 'feed.json', absolutePath: feedJsonPath },
      { relativePath: 'posts.json', absolutePath: postsJsonPath },
    ];

    if (shouldBuildHtml && newPost) {
      // A. Render new photo detail page
      const photoHtml = await renderPhotoPage(siteData, newPost);
      const photoDir = path.join(outputDir, 'photos', postId);
      await fs.mkdir(photoDir, { recursive: true });
      const photoFile = path.join(photoDir, 'index.html');
      await fs.writeFile(photoFile, photoHtml, 'utf-8');
      deltaFiles.push({ relativePath: `photos/${postId}/index.html`, absolutePath: photoFile });

      // B. Render updated gallery index
      const galleryHtml = await renderGalleryIndex(siteData, formattedPosts);
      const indexFile = path.join(outputDir, 'index.html');
      await fs.writeFile(indexFile, galleryHtml, 'utf-8');
      deltaFiles.push({ relativePath: 'index.html', absolutePath: indexFile });
    }

    // 5. Include new media files on disk in the delta payload
    const cleanImg = imagePath.replace(/^https?:\/\/[^\/]+/, '').replace(/^\/+/, '');
    const cleanThumb = thumbnailPath.replace(/^https?:\/\/[^\/]+/, '').replace(/^\/+/, '');
    const imgSub = cleanImg.includes('uploads/') ? cleanImg.substring(cleanImg.indexOf('uploads/')) : cleanImg;
    const thumbSub = cleanThumb.includes('uploads/') ? cleanThumb.substring(cleanThumb.indexOf('uploads/')) : cleanThumb;

    const imgLocalPath = path.join(outputDir, imgSub);
    const thumbLocalPath = path.join(outputDir, thumbSub);

    if (existsSync(imgLocalPath)) {
      deltaFiles.push({ relativePath: imgSub, absolutePath: imgLocalPath });
    }
    if (existsSync(thumbLocalPath)) {
      deltaFiles.push({ relativePath: thumbSub, absolutePath: thumbLocalPath });
    }

    // 6. Deploy delta files directly to host
    let deployedRemote = false;
    if (deploymentType === 'neocities' || deploymentType === 'nekoweb') {
      const deployRes = await dispatchDeltaDeploy(siteId, deploymentType, deploymentCredsRaw, deltaFiles, true);
      deployedRemote = deployRes.deployed;

      // Zero-retention disk purge of local media
      try {
        const uploadsDir = path.join(outputDir, 'uploads');
        if (existsSync(uploadsDir)) {
          await fs.rm(uploadsDir, { recursive: true, force: true });
          console.log(`[:> ZERO-RETENTION PURGE] Purged local media directory: ${uploadsDir}`);
        }
      } catch (_purgeErr) {}
    }

    const durationMs = Date.now() - startTime;
    console.log(
      `[:> INCREMENTAL SUCCESS] Built & synchronized ${deltaFiles.length} delta files in ${durationMs}ms (remote deployed: ${deployedRemote})`
    );

    return {
      ok: true,
      filesCount: deltaFiles.length,
      durationMs,
      deployedRemote,
    };
  });
}

/**
 * High-speed incremental build and deploy when a comment is posted:
 * - Rebuilds ONLY: photos/<postId>/index.html + feed.json/posts.json
 * - Updates ONLY: uploads/images/<file>.comments.json + photos/<postId>/index.html + feed.json
 * - Leaves untouched: index.html, other photo pages, media, and static assets
 */
export async function buildAndDeployComment(options: {
  siteId?: string;
  userId: string;
  postId: string;
}): Promise<IncrementalResult> {
  const startTime = Date.now();
  const { siteId, userId, postId } = options;

  return buildQueue.enqueue(`IncrementalComment:${postId}`, async () => {
    console.log(`[:> INCREMENTAL COMMENT] Updating photo detail for ${postId}...`);

    const ctx = await resolveTargetContext(siteId, userId);
    const { siteData, outputDir, shouldBuildHtml, fullSiteUrl, deploymentType, deploymentCredsRaw } = ctx;
    const baseNeogramUrl = config.appUrl || 'http://localhost:4000';

    await fs.mkdir(outputDir, { recursive: true });

    // 1. Fetch updated posts
    const formattedPosts = await fetchFormattedPosts(siteId, userId, fullSiteUrl, baseNeogramUrl);
    const post = formattedPosts.find((p) => p.id === postId);

    if (!post) {
      return { ok: false, filesCount: 0, durationMs: Date.now() - startTime, error: 'Post not found.' };
    }

    // 2. Sync feed.json and posts.json (updating comment count)
    const feedData = {
      version: 'neogram-api-v1',
      generatedAt: new Date().toISOString(),
      user: {
        id: ctx.effectiveUserId || userId,
        uin: ctx.authorUin,
        handle: ctx.author,
        siteUrl: ctx.baseSiteUrl,
        deployPath: ctx.rawDeployPath,
        fullSiteUrl: ctx.fullSiteUrl,
        statusMessage: ctx.statusMessage,
      },
      posts: formattedPosts,
    };
    const feedJsonPath = path.join(outputDir, 'feed.json');
    const postsJsonPath = path.join(outputDir, 'posts.json');
    await fs.writeFile(feedJsonPath, JSON.stringify(feedData, null, 2), 'utf-8');
    await fs.writeFile(postsJsonPath, JSON.stringify(formattedPosts, null, 2), 'utf-8');

    // 3. Comments JSON relative path
    const relCommentsPath = getCommentsRelativePath(post.imagePath);
    const jsonLocalPath = path.join(outputDir, relCommentsPath);

    const deltaFiles: DeltaFile[] = [
      { relativePath: 'feed.json', absolutePath: feedJsonPath },
      { relativePath: 'posts.json', absolutePath: postsJsonPath },
    ];

    if (existsSync(jsonLocalPath)) {
      deltaFiles.push({ relativePath: relCommentsPath, absolutePath: jsonLocalPath });
    }

    // 4. Render ONLY the single photo's HTML page
    if (shouldBuildHtml) {
      const photoHtml = await renderPhotoPage(siteData, post);
      const photoDir = path.join(outputDir, 'photos', postId);
      await fs.mkdir(photoDir, { recursive: true });
      const photoFile = path.join(photoDir, 'index.html');
      await fs.writeFile(photoFile, photoHtml, 'utf-8');
      deltaFiles.push({ relativePath: `photos/${postId}/index.html`, absolutePath: photoFile });
    }

    // 5. Deploy delta files to host (Neocities or Nekoweb)
    let deployedRemote = false;
    const targetDeployId = siteId || ctx.targetSite?.id || userId;
    if (deploymentType === 'neocities' || deploymentType === 'nekoweb') {
      const deployRes = await dispatchDeltaDeploy(targetDeployId, deploymentType, deploymentCredsRaw, deltaFiles, !!siteId);
      deployedRemote = deployRes.deployed;
    }

    const durationMs = Date.now() - startTime;
    console.log(
      `[:> INCREMENTAL COMMENT SUCCESS] Synchronized comment delta (${deltaFiles.length} files in ${durationMs}ms)`
    );

    return {
      ok: true,
      filesCount: deltaFiles.length,
      durationMs,
      deployedRemote,
    };
  });
}

/**
 * High-speed incremental build and deploy for follower friends stream:
 * - Queries posts from followed authors, with image URLs referencing original authors' hosts
 * - Zero bytes of media uploaded to follower's site
 * - Rebuilds ONLY: friends/index.html + friendsPosts.json
 * - Deploys ONLY: friends/index.html + friendsPosts.json (1-2 files)
 * - Duration: ~150-250ms per follower
 */
export async function buildAndDeployFriendFeed(followerUserId: string): Promise<IncrementalResult> {
  const startTime = Date.now();

  return buildQueue.enqueue(`IncrementalFriends:${followerUserId}`, async () => {
    console.log(`[:> INCREMENTAL FRIENDS] Updating friends grid for follower ${followerUserId}...`);

    const ctx = await resolveTargetContext(undefined, followerUserId);
    const { siteData, outputDir, shouldBuildHtml, deploymentType, deploymentCredsRaw } = ctx;
    const baseNeogramUrl = config.appUrl || 'http://localhost:4000';

    await fs.mkdir(outputDir, { recursive: true });

    // 1. Fetch friend posts referencing original authors' sites
    const friendsQuery = await query(`
      SELECT 
        p.id,
        p.user_id as "userId",
        p.image_path as "imagePath",
        p.thumbnail_path as "thumbnailPath",
        p.caption,
        p.filter_applied as "filterApplied",
        p.mood,
        p.webring,
        p.location,
        p.likes_count as "likes",
        p.created_at as "createdAt",
        u.email,
        u.handle,
        u.uin,
        u.avatar_path as "avatarPath",
        u.site_url as "siteUrl",
        u.deploy_path as "deployPath",
        COALESCE(u.handle, split_part(u.email, '@', 1)) as author
      FROM posts p
      JOIN follows f ON p.user_id = f.following_id
      JOIN users u ON p.user_id = u.id
      WHERE f.follower_id = $1
      ORDER BY p.created_at DESC
    `, [followerUserId]);

    const friendsPosts = friendsQuery.rows.map((row) => {
      let imagePath = row.imagePath;
      let thumbnailPath = row.thumbnailPath;
      const authorSite = row.siteUrl ? row.siteUrl.replace(/\/+$/, '') : '';
      const authorDeploy = (row.deployPath !== null && row.deployPath !== undefined)
        ? String(row.deployPath).trim().replace(/^\/+|\/+$/g, '')
        : 'neogram';
      const authorBase = authorSite 
        ? (authorDeploy ? `${authorSite}/${authorDeploy}` : authorSite)
        : baseNeogramUrl;

      if (imagePath && !imagePath.startsWith('http://') && !imagePath.startsWith('https://')) {
        imagePath = `${authorBase}${imagePath.startsWith('/') ? '' : '/'}${imagePath}`;
      }
      if (thumbnailPath && !thumbnailPath.startsWith('http://') && !thumbnailPath.startsWith('https://')) {
        thumbnailPath = `${authorBase}${thumbnailPath.startsWith('/') ? '' : '/'}${thumbnailPath}`;
      }

      return {
        ...row,
        imagePath,
        thumbnailPath,
        profileUrl: `${baseNeogramUrl}/user/@${encodeURIComponent(row.author)}`,
      };
    });

    // 2. Write friendsPosts.json
    const friendsPostsPath = path.join(outputDir, 'friendsPosts.json');
    await fs.writeFile(friendsPostsPath, JSON.stringify(friendsPosts, null, 2), 'utf-8');

    const deltaFiles: DeltaFile[] = [
      { relativePath: 'friendsPosts.json', absolutePath: friendsPostsPath },
    ];

    // 3. Render friends/index.html
    if (shouldBuildHtml) {
      const friendsHtml = await renderFriendsPage(siteData, friendsPosts);
      const friendsDir = path.join(outputDir, 'friends');
      await fs.mkdir(friendsDir, { recursive: true });
      const friendsFile = path.join(friendsDir, 'index.html');
      await fs.writeFile(friendsFile, friendsHtml, 'utf-8');
      deltaFiles.push({ relativePath: 'friends/index.html', absolutePath: friendsFile });
    }

    // 4. Deploy delta files (1-2 files only)
    let deployedRemote = false;
    const targetDeployId = ctx.targetSite?.id || followerUserId;
    if (ctx.autoDeploy && (deploymentType === 'neocities' || deploymentType === 'nekoweb')) {
      const deployRes = await dispatchDeltaDeploy(targetDeployId, deploymentType, deploymentCredsRaw, deltaFiles, !!ctx.targetSite);
      deployedRemote = deployRes.deployed;
    }

    const durationMs = Date.now() - startTime;
    console.log(
      `[:> INCREMENTAL FRIENDS SUCCESS] Synchronized follower friends grid (${deltaFiles.length} files in ${durationMs}ms)`
    );

    return {
      ok: true,
      filesCount: deltaFiles.length,
      durationMs,
      deployedRemote,
    };
  });
}
