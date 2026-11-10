import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

// Decompression-bomb guard + bounded CPU/RAM: at most 2 images are decoded concurrently
// (container is memory-limited) and inputs are capped at 50 megapixels.
const MAX_INPUT_PIXELS = 50_000_000;
const MAX_CONCURRENT_JOBS = 2;
sharp.concurrency(2);
let activeJobs = 0;
const jobWaiters: Array<() => void> = [];
async function acquireImageSlot(): Promise<void> {
  if (activeJobs < MAX_CONCURRENT_JOBS) {
    activeJobs++;
    return;
  }
  await new Promise<void>((resolve) => jobWaiters.push(resolve));
}
function releaseImageSlot(): void {
  const next = jobWaiters.shift();
  if (next) next(); // hand the slot straight to the next waiter
  else activeJobs--;
}

const UPLOADS_DIR = path.resolve(process.cwd(), 'public', 'uploads');
const IMAGES_DIR = path.join(UPLOADS_DIR, 'images');
const THUMBS_DIR = path.join(UPLOADS_DIR, 'thumbs');
const AVATARS_DIR = path.join(UPLOADS_DIR, 'avatars');

// Ensure upload directories exist
export function ensureUploadDirs() {
  if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  if (!fs.existsSync(IMAGES_DIR)) fs.mkdirSync(IMAGES_DIR, { recursive: true });
  if (!fs.existsSync(THUMBS_DIR)) fs.mkdirSync(THUMBS_DIR, { recursive: true });
  if (!fs.existsSync(AVATARS_DIR)) fs.mkdirSync(AVATARS_DIR, { recursive: true });
}

export interface ProcessedImageResult {
  imagePath: string;
  thumbnailPath: string;
  imageFileName: string;
  thumbFileName: string;
  width: number;
  height: number;
}

/**
 * High-performance image processing pipeline using Sharp.
 * Converts input buffer or base64 into optimized WebP images (1200px main + 400px thumb).
 * If targetUploadsDir is provided (e.g. user isolated static directory), writes there.
 * Otherwise defaults to public/uploads.
 */
export async function processImageBuffer(
  inputBuffer: Buffer,
  filterName: string = 'none',
  targetUploadsDir?: string
): Promise<ProcessedImageResult> {
  await acquireImageSlot();
  try {
    return await processImageBufferInner(inputBuffer, filterName, targetUploadsDir);
  } finally {
    releaseImageSlot();
  }
}

async function processImageBufferInner(
  inputBuffer: Buffer,
  filterName: string,
  targetUploadsDir?: string
): Promise<ProcessedImageResult> {
  const fileId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  const imageFileName = `${fileId}.webp`;
  const thumbFileName = `${fileId}-thumb.webp`;

  let imagesDir: string;
  let thumbsDir: string;

  if (targetUploadsDir) {
    imagesDir = path.join(targetUploadsDir, 'images');
    thumbsDir = path.join(targetUploadsDir, 'thumbs');
    await fs.promises.mkdir(imagesDir, { recursive: true });
    await fs.promises.mkdir(thumbsDir, { recursive: true });
  } else {
    ensureUploadDirs();
    imagesDir = IMAGES_DIR;
    thumbsDir = THUMBS_DIR;
  }

  const imageDiskPath = path.join(imagesDir, imageFileName);
  const thumbDiskPath = path.join(thumbsDir, thumbFileName);

  // Initialize Sharp pipeline with auto-rotation based on EXIF orientation tags
  let pipeline = sharp(inputBuffer, { limitInputPixels: MAX_INPUT_PIXELS }).rotate();

  // Get image metadata
  const metadata = await pipeline.metadata();

  // If specific Sharp backend filter effects are desired:
  if (filterName === 'sepia') {
    pipeline = pipeline.modulate({ saturation: 0.6, brightness: 1.05 }).tint({ r: 240, g: 200, b: 160 });
  } else if (filterName === 'gameboy') {
    pipeline = pipeline.grayscale().threshold(128).tint({ r: 155, g: 188, b: 15 });
  }

  // 1. Full-size optimized web image (max 1200px)
  const mainImageBuffer = await pipeline
    .clone()
    .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 85 })
    .toBuffer();

  await fs.promises.writeFile(imageDiskPath, mainImageBuffer);

  // 2. Chunky square thumbnail (400x400)
  const thumbBuffer = await sharp(mainImageBuffer)
    .resize(400, 400, { fit: 'cover', position: 'center' })
    .webp({ quality: 80 })
    .toBuffer();

  await fs.promises.writeFile(thumbDiskPath, thumbBuffer);

  return {
    imagePath: `/uploads/images/${imageFileName}`,
    thumbnailPath: `/uploads/thumbs/${thumbFileName}`,
    imageFileName,
    thumbFileName,
    width: metadata.width || 800,
    height: metadata.height || 600,
  };
}

/**
 * Process a base64 data URL, SVG data, or existing uploaded file path.
 */
export async function processBase64Image(
  source: string,
  filterName: string = 'none',
  targetUploadsDir?: string
): Promise<ProcessedImageResult> {
  let buffer: Buffer;

  // Handle local uploaded file paths (e.g. /uploads/images/xyz.webp or http://localhost:4000/uploads/...)
  if (source.includes('/uploads/')) {
    const rawRel = source.substring(source.indexOf('/uploads/')).replace(/^\/+/, '');
    const cleanRel = path.normalize(rawRel).replace(/^(\.\.(\/|\\|$))+/, '');
    const safeUploadsRoot = path.resolve(process.cwd(), 'public', 'uploads');
    const diskPath = path.resolve(process.cwd(), 'public', cleanRel);

    // Verify resolved path strictly resides within the public/uploads boundary
    if (diskPath.startsWith(safeUploadsRoot) && fs.existsSync(diskPath)) {
      buffer = await fs.promises.readFile(diskPath);
      return processImageBuffer(buffer, filterName, targetUploadsDir);
    }
  }

  const matches = source.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
  if (matches && matches.length === 3) {
    buffer = Buffer.from(matches[2], 'base64');
  } else if (source.startsWith('data:image/svg+xml')) {
    // URL encoded SVG
    const svgContent = decodeURIComponent(source.split(',')[1]);
    buffer = Buffer.from(svgContent);
  } else {
    buffer = Buffer.from(source, 'base64');
  }

  return processImageBuffer(buffer, filterName, targetUploadsDir);
}

/**
 * Process and optimize user avatar.
 * Creates a 128x128 square cover WebP image.
 * If the user has a configured remote static site host (Neocities, Nekoweb, or GitHub),
 * deploys the optimized avatar directly to their remote site (`avatar.webp`),
 * updates their static `feed.json`, cleans up any local staging files, and returns
 * the remote canonical static URL.
 * Users without remote publishing configured (headless / sandbox users) never store
 * avatars on Neogram and always use their deterministic default profile image.
 */
export async function processAvatarBuffer(
  inputBuffer: Buffer,
  userId: string
): Promise<{ avatarPath: string; deployedRemote: boolean; siteId?: string }> {
  await acquireImageSlot();
  let avatarBuffer: Buffer;
  try {
    avatarBuffer = await sharp(inputBuffer, { limitInputPixels: MAX_INPUT_PIXELS })
      .rotate()
      .resize(128, 128, { fit: 'cover' })
      .webp({ quality: 90 })
      .toBuffer();
  } finally {
    releaseImageSlot();
  }

  // Clean up any legacy local avatar files on Neogram disk (strict zero retention)
  try {
    if (fs.existsSync(AVATARS_DIR)) {
      const files = await fs.promises.readdir(AVATARS_DIR);
      for (const file of files) {
        if (file.startsWith(`${userId}-`)) {
          await fs.promises.unlink(path.join(AVATARS_DIR, file)).catch(() => {});
        }
      }
    }
  } catch (_e) {}

  // Inspect if user has an active static site target with remote publishing credentials
  try {
    const { query } = await import('../db');

    // Query default site row directly with encrypted credentials
    const siteRes = await query(
      `SELECT s.id, s.name, s.site_url, s.deploy_path, s.deployment_type, s.deployment_credentials
       FROM sites s
       WHERE s.user_id = $1 AND s.is_default = TRUE
       LIMIT 1`,
      [userId]
    );
    let targetSiteRow = siteRes.rows[0];
    if (!targetSiteRow) {
      const anySiteRes = await query(
        `SELECT s.id, s.name, s.site_url, s.deploy_path, s.deployment_type, s.deployment_credentials
         FROM sites s
         WHERE s.user_id = $1
         ORDER BY s.created_at ASC
         LIMIT 1`,
        [userId]
      );
      targetSiteRow = anySiteRes.rows[0];
    }

    const userRes = await query(
      'SELECT id, handle, email, deployment_type, deployment_credentials, site_url, deploy_path FROM users WHERE id = $1',
      [userId]
    );
    const userRow = userRes.rows[0];

    const deploymentType = targetSiteRow?.deployment_type || userRow?.deployment_type || 'none';
    const deploymentCreds = targetSiteRow?.deployment_credentials || userRow?.deployment_credentials;

    let hasValidCredentials = false;
    if (deploymentType && deploymentType !== 'none' && deploymentCreds) {
      try {
        const { decryptCredentials } = await import('../utils/crypto');
        const creds = decryptCredentials<any>(deploymentCreds);
        if (creds && creds.apiKey && creds.apiKey.trim()) {
          hasValidCredentials = true;
        }
      } catch (_e) {}
    }

    if (hasValidCredentials) {
      const author = userRow?.handle || userRow?.email?.split('@')[0] || 'user';
      const hostDomain = deploymentType === 'nekoweb' ? 'nekoweb.org' : 'neocities.org';
      const rawSiteUrl = targetSiteRow?.site_url || userRow?.site_url;
      const siteBase = rawSiteUrl
        ? rawSiteUrl.replace(/\/+$/, '')
        : (targetSiteRow?.name
            ? `https://${targetSiteRow.name}.${hostDomain}`
            : `https://${author}.${hostDomain}`);
      const rawDeployPath = (targetSiteRow?.deploy_path !== null && targetSiteRow?.deploy_path !== undefined)
        ? String(targetSiteRow.deploy_path).trim().replace(/^\/+|\/+$/g, '')
        : (userRow?.deploy_path !== null && userRow?.deploy_path !== undefined
            ? String(userRow.deploy_path).trim().replace(/^\/+|\/+$/g, '')
            : 'neogram');
      const deployPrefix = rawDeployPath
        ? (siteBase.toLowerCase().endsWith(`/${rawDeployPath.toLowerCase()}`) ? '' : `/${rawDeployPath}`)
        : '';
      const timestamp = Date.now();
      const remoteAvatarUrl = `${siteBase}${deployPrefix}/avatar.webp?v=${timestamp}`;

      const targetDeployId = targetSiteRow?.id || userId;
      const isSiteId = Boolean(targetSiteRow?.id);
      const deltaFiles: Array<{ relativePath: string; content?: Buffer | string; absolutePath?: string; contentType?: string }> = [
        {
          relativePath: 'avatar.webp',
          content: avatarBuffer,
          contentType: 'image/webp',
        },
      ];

      // Stage in local static gallery and update feed.json if present so remote feed.json has the new avatarUrl immediately
      if (targetSiteRow?.id) {
        const siteStaticDir = path.join(process.cwd(), 'dist', 'static-galleries', targetSiteRow.id);
        try {
          if (fs.existsSync(siteStaticDir)) {
            await fs.promises.writeFile(path.join(siteStaticDir, 'avatar.webp'), avatarBuffer);
            const feedJsonPath = path.join(siteStaticDir, 'feed.json');
            if (fs.existsSync(feedJsonPath)) {
              const rawFeed = await fs.promises.readFile(feedJsonPath, 'utf-8');
              const parsedFeed = JSON.parse(rawFeed);
              if (parsedFeed && typeof parsedFeed === 'object') {
                parsedFeed.generatedAt = new Date().toISOString();
                parsedFeed.user = {
                  ...(parsedFeed.user || {}),
                  avatarUrl: remoteAvatarUrl,
                };
                const updatedFeedStr = JSON.stringify(parsedFeed, null, 2);
                await fs.promises.writeFile(feedJsonPath, updatedFeedStr, 'utf-8');
                deltaFiles.push({
                  relativePath: 'feed.json',
                  content: updatedFeedStr,
                  contentType: 'application/json',
                });
              }
            }
          }
        } catch (_e) {}
      }

      let deployOk = false;
      if (deploymentType === 'neocities') {
        const { deployFilesToNeocities } = await import('./neocitiesPublisher');
        const res = await deployFilesToNeocities(targetDeployId, deltaFiles, isSiteId);
        deployOk = res.ok;
      } else if (deploymentType === 'nekoweb') {
        const { deployFilesToNekoweb } = await import('./nekowebPublisher');
        const res = await deployFilesToNekoweb(targetDeployId, deltaFiles, isSiteId);
        deployOk = res.ok;
      } else if (deploymentType === 'github') {
        const { deployFilesToGitHub } = await import('./githubPublisher');
        const res = await deployFilesToGitHub(targetDeployId, deltaFiles, isSiteId);
        deployOk = res.ok;
      }

      if (deployOk) {
        console.log(`[:> AVATAR DEPLOY] Placed avatar.webp on remote static host (${deploymentType}) for @${author}: ${remoteAvatarUrl}`);
        return {
          avatarPath: remoteAvatarUrl,
          deployedRemote: true,
          siteId: targetSiteRow?.id,
        };
      }
    }
  } catch (err: any) {
    console.warn('[:> AVATAR WARNING] Remote avatar deployment encountered error:', err?.message || err);
  }

  // Headless / unconfigured user or failed remote deploy: never store avatars on Neogram
  return {
    avatarPath: '',
    deployedRemote: false,
  };
}
