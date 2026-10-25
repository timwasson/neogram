# Publishing & Image Processing Pipeline Deep-Dive

This document details the internal architecture of Neogram's **Publishing & Image Processing Pipeline**. It explains how a photo moves from a mobile camera snap or desktop dropzone, through the high-performance Sharp transformation engine, into an isolated Eleventy (11ty) multi-tenant static compilation, and finally to your personal static website with a **Zero-Retention Local Storage** guarantee.

---

## 1. Pipeline Overview & Flowchart

```
[ User Device: Mobile Camera or Desktop Drag-and-Drop ]
                       │
                       ▼ (HTTP Multipart POST /api/posts, max 25MB)
[ Multer Memory Storage Buffer ]
                       │
                       ▼
[ Sharp Image Transformation Engine ]
  ├── 1. EXIF Auto-Orientation (.rotate())
  ├── 2. Proportional Downscale (Max 1200px)
  ├── 3. WebP Lossy Compression (Quality: 85)
  └── 4. Square WebP Thumbnail Generation (400x400px)
                       │
                       ▼
[ Ephemeral Staging Directory: dist/static-galleries/<userId>/uploads/ ]
                       │
                       ▼
[ FIFO Sequential BuildQueue (buildQueue.enqueue) ]
  ├── eleventyConfig.setUseTemplateCache(false)
  ├── Multi-Tenant Path Prefix (/neogram/ or /custom/)
  └── Eleventy v3 Static HTML & CSS Compilation
                       │
                       ▼
[ Neocities Publisher Adapter (POST https://neocities.org/api/upload) ]
                       │
                       ▼
[ Post-Deploy Disk Purge: fs.rm(uploadsDir, { recursive: true }) ]
                       │
                       ▼
[ Neogram Server Retention: 0 BYTES — Remote Static Host Verified ]
```

---

## 2. Ingestion & Mobile Camera Snapping

### Native Hardware Camera Capture
Neogram uses standard HTML5 hardware integration:
```html
<input type="file" id="imageInput" accept="image/*" capture="environment" />
```
- **Mobile Devices (iOS / Android):** Directly summons the phone's native hardware camera viewfinder. You snap a real photo and it immediately transfers to the workstation stage.
- **Desktop Browsers:** Opens the native system file selector and supports drag-and-drop onto the CRT viewfinder.
- **No WebRTC Overhead:** Avoids heavy video streams, battery drain, and browser permission modals.

### 25MB Streaming Allowance
Modern smartphones take photos exceeding 15–20MB. Neogram's upload middleware (`handleUploadMiddleware`) configures Multer to ingest up to **25MB in memory**:
```typescript
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
});
```
Photos buffer directly into RAM and stream immediately into Sharp without intermediate temp files on the OS filesystem.

---

## 3. High-Performance Sharp Image Transformation

The transformation pipeline is defined in `server/services/imageProcessor.ts` using the libvips C-library bindings via `sharp`.

### Step 1: EXIF Auto-Orientation (`.rotate()`)
```typescript
const pipeline = sharp(inputBuffer).rotate();
```
*Why this matters:* When users take a portrait photo on an iPhone or Android device, the raw pixel buffer is stored sideways and oriented using EXIF metadata tags. Without `.rotate()`, mobile photos would appear rotated 90 degrees on static sites. Sharp reads the EXIF orientation tag, rotates the physical raster, and strips the EXIF header.

### Step 2: High-Resolution Display Image (Max 1200px WebP)
```typescript
const processedImageBuffer = await pipeline
  .clone()
  .resize(1200, 1200, {
    fit: 'inside',
    withoutEnlargement: true,
  })
  .webp({ quality: 85 })
  .toBuffer();
```
- **1200px Dimension Cap:** Large enough to look crisp on Retina displays, desktop monitors, and tablets while keeping total file size under 180 KB.
- **WebP Compression:** Offers 70–80% smaller file sizes than standard JPEG with superior color fidelity.

### Step 3: Square Thumbnail Generation (400x400px WebP)
```typescript
const thumbnailBuffer = await sharp(inputBuffer)
  .rotate()
  .resize(400, 400, {
    fit: 'cover',
    position: 'center',
  })
  .webp({ quality: 80 })
  .toBuffer();
```
- Creates a cropped square thumbnail matching 90s contact sheet photo grids.

### Step 4: Retro CSS Shaders & Canvas Filters
Neogram lets users apply vintage visual filters before transmission:
- `crt-phosphor`: Vibrant green phosphor CRT matrix with scanlines
- `sepia-1999`: Warm turn-of-the-millennium amber print
- `matrix-green`: High-contrast green phosphor computer terminal
- `high-contrast-1bit`: Dithered Apple System 7 monochrome bitmap
- `scanlines`: Interlaced television monitor cathode ray lines
- `glitch`: Chromatic aberration and RGB channel offset

---

## 4. Multi-Tenant Isolated Eleventy (11ty v3) Static Generation

Once the image is staged, Neogram triggers Eleventy compilation via `server/services/staticBuilder.ts`.

### 1. Isolated User Directories
Each station owner compiles strictly inside their own isolated tenant folder:
```
dist/static-galleries/<userId>/
```
No user's build artifacts or temporary files can ever collide with or overwrite another user's files.

### 2. FIFO Sequential BuildQueue
```typescript
class BuildQueue {
  async enqueue<T>(jobName: string, task: () => Promise<T>): Promise<T> { ... }
}
```
All static builds are serialized through an in-memory First-In, First-Out (FIFO) queue. If a creator uploads three photos in rapid succession while a visitor posts a comment, each build executes one at a time. This guarantees zero file lock contention on `posts.json` and `site.json`.

### 3. Cross-Tenant Template Cache Isolation
Eleventy v3 caches compiled template functions in memory by default. In a multi-tenant SaaS where User A publishes to `/neogram/` and User B publishes to `/photos/`, in-memory template caching could bleed User A's path prefix into User B's templates.

Neogram explicitly disables template caching in `eleventy/eleventy.config.js`:
```javascript
export default function (eleventyConfig) {
  eleventyConfig.setUseTemplateCache(false);
  // ...
}
```

### 4. Semantic BEM HTML Output
Eleventy renders:
- `index.html`: Responsive photo gallery grid using standard BEM classes (`.neogram-site`, `.neogram-grid`, `.neogram-card`)
- `photos/<id>/index.html`: Deep photo detail view with live comment ledger and reaction counters
- Embed assets passthrough: Copies `embed/` scripts and styles into `dist/static-galleries/<userId>/embed/`

---

## 5. Zero-Retention Local Media Storage Policy

> [!IMPORTANT]
> **The Neogram Zero-Retention Guarantee:**
> The Neogram server is **not a media host**. It does not retain or hoard your personal photos in local disk storage buckets or databases.

```typescript
// server/services/neocitiesPublisher.ts (lines 178-185)
const uploadsDir = path.join(userOutputDir, 'uploads');
try {
  await fs.rm(uploadsDir, { recursive: true, force: true });
  console.log(`[:> ZERO-RETENTION PIPELINE] Purged local uploads directory for user ${userId}.`);
} catch (_rmErr) { ... }
```

### How Zero Retention Works:
1. When you transmit a photo, files stage ephemerally in `dist/static-galleries/<userId>/uploads/`.
2. Neocities deployment adapter uploads the multipart archive to `POST https://neocities.org/api/upload`.
3. The instant Neocities responds with `result: "success"`, the entire `uploads/` directory is **immediately wiped from the local hard drive**.
4. Local server media storage returns to **0 bytes**.
5. Your personal static site becomes the permanent home of your images.

---

## 6. Safe Subdirectory Publishing & Remote Deletion Filtering

### Subdirectory Isolation (`deploy_path`)
Neogram defaults to compiling under the `/neogram/` subfolder. This ensures your existing Neocities files (`index.html`, `about.html`, CSS, images) remain 100% untouched.

### Non-Destructive Remote Deletion Filter
When you delete a photo in Neogram:
```typescript
// server/services/neocitiesPublisher.ts (deleteFromNeocities)
if (!remotePath.startsWith(`${deployPath}/uploads/`)) {
  console.warn(`[:> SECURITY] Blocked attempt to delete path outside uploads: "${remotePath}"`);
  return;
}
```
Neogram strictly refuses to delete any remote files on Neocities outside of `uploads/` within your configured `deploy_path`. Your personal website files are completely protected from accidental deletion.

---

## 7. Zero-Barrier Sandbox Publishing Mode

To eliminate activation friction for new creators, Neogram features a **Sandbox Publishing Mode**:
- **Immediate Transmission:** Creators can snap photos, apply CRT/phosphor filter shaders, write captions, and publish immediately—even before configuring a Neocities API key.
- **Central Cyberspace Station:** Posts published in Sandbox mode are instantly live on the user's central Cyberspace Station profile (`/user/:handle`) and in public feeds (`feed.json`).
- **Seamless Upgrade:** When the creator connects their Neocities API key later, clicking `[ ⚡ Force Static Rebuild & Deploy ]` automatically builds the 11ty static bundle and publishes all previous posts directly to their static site.

---

## 8. Data Sovereignty, Portability & Decommissioning

In alignment with cyberspace freedom and GDPR compliance:
- **Station Archive Export (`GET /api/settings/export-archive`):** Station operators can export their complete profile, posts, comments, guestbook ledger, and connections as a single structured JSON archive at any time from the workstation Settings tab (`[:> DATA_SOVEREIGNTY.EXE]`).
- **Self-Serve Node Decommissioning (`DELETE /api/settings/account`):** Users can permanently delete their account with single-click confirmation (`[:> DECOMMISSION_NODE.EXE]`). This triggers a cascading deletion of all user records, posts, comments, guestbook entries, follower links, and isolated static build folders from the database and disk, immediately terminating their session cookie.
