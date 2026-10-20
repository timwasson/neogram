import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const UPLOADS_DIR = path.resolve(process.cwd(), 'public', 'uploads');
const IMAGES_DIR = path.join(UPLOADS_DIR, 'images');
const THUMBS_DIR = path.join(UPLOADS_DIR, 'thumbs');

// Ensure upload directories exist
export function ensureUploadDirs() {
  if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  if (!fs.existsSync(IMAGES_DIR)) fs.mkdirSync(IMAGES_DIR, { recursive: true });
  if (!fs.existsSync(THUMBS_DIR)) fs.mkdirSync(THUMBS_DIR, { recursive: true });
}

export interface ProcessedImageResult {
  imagePath: string;
  thumbnailPath: string;
  width: number;
  height: number;
}

/**
 * High-performance image processing pipeline using Sharp.
 * Converts input buffer or base64 into optimized WebP images (1200px main + 400px thumb).
 */
export async function processImageBuffer(
  inputBuffer: Buffer,
  filterName: string = 'none'
): Promise<ProcessedImageResult> {
  ensureUploadDirs();

  const fileId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  const imageFileName = `${fileId}.webp`;
  const thumbFileName = `${fileId}-thumb.webp`;

  const imageDiskPath = path.join(IMAGES_DIR, imageFileName);
  const thumbDiskPath = path.join(THUMBS_DIR, thumbFileName);

  // Initialize Sharp pipeline
  let pipeline = sharp(inputBuffer);

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
    width: metadata.width || 800,
    height: metadata.height || 600,
  };
}

/**
 * Process a base64 data URL, SVG data, or existing uploaded file path.
 */
export async function processBase64Image(
  source: string,
  filterName: string = 'none'
): Promise<ProcessedImageResult> {
  let buffer: Buffer;

  // Handle local uploaded file paths (e.g. /uploads/images/xyz.webp or http://localhost:4000/uploads/...)
  if (source.includes('/uploads/')) {
    const relativePath = source.substring(source.indexOf('/uploads/'));
    const diskPath = path.join(process.cwd(), 'public', relativePath);
    if (fs.existsSync(diskPath)) {
      buffer = await fs.promises.readFile(diskPath);
      return processImageBuffer(buffer, filterName);
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

  return processImageBuffer(buffer, filterName);
}
