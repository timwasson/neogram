import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

// Helper to create an ICO buffer containing multiple PNG sizes (16, 32, 48)
function createIco(pngBuffers: { size: number; buffer: Buffer }[]): Buffer {
  const headerSize = 6;
  const directoryEntrySize = 16;
  const numImages = pngBuffers.length;
  const totalHeaderSize = headerSize + directoryEntrySize * numImages;

  let currentOffset = totalHeaderSize;
  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0); // Reserved
  header.writeUInt16LE(1, 2); // 1 = ICO
  header.writeUInt16LE(numImages, 4);

  const directoryEntries: Buffer[] = [];
  const imageBuffers: Buffer[] = [];

  for (const { size, buffer } of pngBuffers) {
    const entry = Buffer.alloc(directoryEntrySize);
    entry.writeUInt8(size >= 256 ? 0 : size, 0); // Width
    entry.writeUInt8(size >= 256 ? 0 : size, 1); // Height
    entry.writeUInt8(0, 2); // Color count
    entry.writeUInt8(0, 3); // Reserved
    entry.writeUInt16LE(1, 4); // Color planes
    entry.writeUInt16LE(32, 6); // Bits per pixel
    entry.writeUInt32LE(buffer.length, 8); // Image size in bytes
    entry.writeUInt32LE(currentOffset, 12); // Offset to image data

    directoryEntries.push(entry);
    imageBuffers.push(buffer);
    currentOffset += buffer.length;
  }

  return Buffer.concat([header, ...directoryEntries, ...imageBuffers]);
}

async function main() {
  const defaultAssetPath = path.resolve('assets', 'neogram-icon-source.jpg');
  const userUploadFallback = '/Users/timwasson/.gemini/antigravity/brain/391dc79e-cbd9-4484-ab14-7db13551e01f/.user_uploaded/media_1794025751152_fbc81009.jpg';
  const inputPath = process.argv[2] || (fs.existsSync(defaultAssetPath) ? defaultAssetPath : userUploadFallback);
  
  if (!fs.existsSync(inputPath)) {
    console.error(`Input file does not exist: ${inputPath}`);
    process.exit(1);
  }

  console.log(`[:> ICON GENERATOR] Processing source: ${inputPath}`);

  const sizes = [
    { name: 'icon-16', size: 16 },
    { name: 'icon-32', size: 32 },
    { name: 'icon-48', size: 48 },
    { name: 'icon-128', size: 128 },
    { name: 'icon-180', size: 180 },
    { name: 'icon-192', size: 192 },
    { name: 'icon-512', size: 512 },
  ];

  const generatedBuffers: Record<number, Buffer> = {};

  for (const item of sizes) {
    // Generate crisp PNGs with high quality lanczos3 resampling
    const buf = await sharp(inputPath)
      .resize(item.size, item.size, {
        kernel: sharp.kernel.lanczos3,
        fit: 'contain',
        background: { r: 8, g: 12, b: 16, alpha: 1 }
      })
      .png({ compressionLevel: 9 })
      .toBuffer();

    generatedBuffers[item.size] = buf;
  }

  // Generate ICO containing 16, 32, 48
  const icoBuffer = createIco([
    { size: 16, buffer: generatedBuffers[16] },
    { size: 32, buffer: generatedBuffers[32] },
    { size: 48, buffer: generatedBuffers[48] }
  ]);

  // Destination directories
  const publicIconsDir = path.resolve('public', 'icons');
  const publicDir = path.resolve('public');
  const extensionIconsDir = path.resolve('extension', 'icons');

  fs.mkdirSync(publicIconsDir, { recursive: true });
  fs.mkdirSync(extensionIconsDir, { recursive: true });

  // Save to public/
  fs.writeFileSync(path.join(publicDir, 'favicon.ico'), icoBuffer);
  fs.writeFileSync(path.join(publicDir, 'favicon.png'), generatedBuffers[32]);
  fs.writeFileSync(path.join(publicDir, 'favicon-16x16.png'), generatedBuffers[16]);
  fs.writeFileSync(path.join(publicDir, 'favicon-32x32.png'), generatedBuffers[32]);
  fs.writeFileSync(path.join(publicDir, 'apple-touch-icon.png'), generatedBuffers[180]);

  // Save to public/icons/
  fs.writeFileSync(path.join(publicIconsDir, 'icon-16.png'), generatedBuffers[16]);
  fs.writeFileSync(path.join(publicIconsDir, 'icon-32.png'), generatedBuffers[32]);
  fs.writeFileSync(path.join(publicIconsDir, 'icon-48.png'), generatedBuffers[48]);
  fs.writeFileSync(path.join(publicIconsDir, 'icon-128.png'), generatedBuffers[128]);
  fs.writeFileSync(path.join(publicIconsDir, 'icon-180.png'), generatedBuffers[180]);
  fs.writeFileSync(path.join(publicIconsDir, 'icon-192.png'), generatedBuffers[192]);
  fs.writeFileSync(path.join(publicIconsDir, 'icon-512.png'), generatedBuffers[512]);
  fs.writeFileSync(path.join(publicIconsDir, 'apple-touch-icon.png'), generatedBuffers[180]);
  fs.writeFileSync(path.join(publicIconsDir, 'favicon.ico'), icoBuffer);

  // Save to extension/icons/
  fs.writeFileSync(path.join(extensionIconsDir, 'icon-16.png'), generatedBuffers[16]);
  fs.writeFileSync(path.join(extensionIconsDir, 'icon-48.png'), generatedBuffers[48]);
  fs.writeFileSync(path.join(extensionIconsDir, 'icon-128.png'), generatedBuffers[128]);

  console.log('[:> ICON GENERATOR] Successfully generated all favicons, PWA icons, and extension icons!');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
