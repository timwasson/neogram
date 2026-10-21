# AGENTS.md: Neogram Project Guide & Specification

> **Notice for AI Agents:**
> The existing frontend code in this repository was generated as a **look-and-feel prototype** in Google AI Studio (React 19 + Vite + Tailwind CSS). It establishes the retro aesthetic, CSS tokens, sound effects, BEM class conventions, and screen flows.
> **Do not treat the existing React prototype as the final architecture.** The target production system is an API-first, decoupled monolith built with Node.js (Express), Nunjucks/server-rendered views, PostgreSQL, Sharp image processing, embeddable vanilla JS widgets, and a Manifest V3 browser extension.

---

## 1. Project Overview & Vision

**Neogram** is a lightweight SaaS suite designed for retro web enthusiasts (Neocities, GitHub Pages, self-hosted static site owners) that bridges mobile-first creation with 90s web nostalgia.

It provides:
1. **Mobile-to-Static Publishing Engine (PWA):** Snap or upload a photo, apply retro filters/shaders, write a caption, and publish it directly to personal static sites (via Neocities API, GitHub Pages commits, or SFTP).
2. **Centralized Social Layer (Embeddable Widgets):** Embeddable async JS/iframes that inject styled, interactive feeds, comment ledgers, and like/reaction buttons onto static sites.
3. **Legacy Retro Widgets:** Public guestbook (with moderation) and dynamic web hit counter images (LED/Nixie/Odometer/VFD).
4. **Retro Chat Browser Extension:** A Chrome/Firefox Manifest V3 sidebar/popup emulating classic 90s AIM/ICQ mechanics with buddy lists, DMs, sound chimes, and status messages.

---

## 2. Target Technical Stack

| Component | Technology | Rationale / Purpose |
|---|---|---|
| **Backend & Workstation Runtime** | **Node.js (Express)** on Port 4000 | Single-server decoupled monolith serving authenticated workstation, API, and static publishing pipeline |
| **Database** | **PostgreSQL** (Docker / Native) | Relational integrity for users, posts, comments, follows, guestbook, counters |
| **Image Processing** | **Sharp** | High-performance image resizing (1200px), WebP compression, square thumbnailing (400px) |
| **Static Site Generator** | **Eleventy (11ty v3)** | Compiles multi-tenant static photo galleries (`dist/static-galleries/<userId>`) via FIFO BuildQueue |
| **Server Templating** | **Nunjucks** | Fast, secure server-rendered dashboard & embed markup templates |
| **Styling & Design System** | **Dart Sass + Vanilla CSS (NO TAILWIND)** | Modular SCSS (`src/styles/`), CSS variables, BEM components (`pixel-box`, `pixel-btn`, `retro-alert`, `baud-progress-bar`), CRT phosphor glow, and utility classes. **Tailwind CSS is strictly prohibited.** |
| **Static Deploy Pipeline** | **Neocities API / GitHub API / SFTP** | Automated pushes of generated 11ty HTML & media to the user's static host |
| **Client Embeds** | **Vanilla JS + BEM Hooks** | Zero-dependency async embed scripts with strict BEM CSS hooks for user customization |
| **Audio Synthesis** | **Web Audio API (`retroAudio`)** | Synthesized 8-bit beeps, shutter sounds, dial-up handshakes, click SFX |
| **Chat Extension** | **WebExtension (Manifest V3)** | AIM/ICQ-style popup/sidebar chat client |

---

## 3. Database Schema (PostgreSQL)

```sql
-- Users & Hosting Integration
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    handle VARCHAR(50) UNIQUE,
    auth_token VARCHAR(255),
    auth_token_expires_at TIMESTAMPTZ,
    site_url VARCHAR(500),
    deployment_type VARCHAR(50) DEFAULT 'none' CHECK (deployment_type IN ('neocities', 'github', 'sftp', 'none')),
    deployment_credentials BYTEA, -- Encrypted credentials (AES-256-GCM)
    custom_css_url VARCHAR(500),
    avatar_path VARCHAR(500), -- 128x128 WebP profile avatar
    auto_deploy BOOLEAN DEFAULT FALSE,
    last_deployed_at TIMESTAMPTZ,
    status_message VARCHAR(150) DEFAULT 'Surfing cyberspace',
    is_away BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Posts Published to Static Sites & Social Feed
CREATE TABLE posts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    image_path VARCHAR(500) NOT NULL,
    thumbnail_path VARCHAR(500) NOT NULL,
    caption TEXT,
    filter_applied VARCHAR(50) DEFAULT 'none',
    mood VARCHAR(100), -- Optional legacy field (default NULL)
    webring VARCHAR(100), -- Optional legacy field (default NULL)
    location VARCHAR(200), -- Optional legacy field (default NULL)
    likes_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Centralized Comments on Static Site Embeds
CREATE TABLE comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    author_name VARCHAR(100) NOT NULL,
    author_avatar VARCHAR(50) DEFAULT '💬',
    body TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Social Following
CREATE TABLE follows (
    follower_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    following_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (follower_id, following_id)
);

-- Retro Guestbook Entries
CREATE TABLE guestbook_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    visitor_name VARCHAR(100) NOT NULL,
    visitor_website VARCHAR(500),
    visitor_location VARCHAR(200),
    mood_icon VARCHAR(50) DEFAULT '😎',
    message TEXT NOT NULL,
    is_moderated BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Dynamic Web Counters
CREATE TABLE web_counters (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    hits BIGINT DEFAULT 0,
    style VARCHAR(50) DEFAULT 'green_led',
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Ephemeral Chat Store-and-Forward Queue (Offline Delivery ONLY)
-- INVARIANT: Hard-deleted immediately upon transmission to recipient
CREATE TABLE ephemeral_chat_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    receiver_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMPTZ DEFAULT (CURRENT_TIMESTAMP + INTERVAL '24 hours')
);

CREATE INDEX idx_chat_queue_receiver ON ephemeral_chat_queue(receiver_id);
CREATE INDEX idx_chat_queue_expires ON ephemeral_chat_queue(expires_at);
```

---

## 4. Key Architectural Patterns & Constraints

### 4.1 Strict BEM Embed Contract
All embeddable widgets must render standard HTML markup with consistent BEM classes so users can inject custom CSS without breaking structure:
- `.neogram-feed`: Container for the entire feed
- `.neogram-post`: Individual card wrapper
- `.neogram-post__header`: User avatar, handle, timestamp
- `.neogram-post__media`: Image with optional retro filter shader
- `.neogram-post__caption`: User caption text
- `.neogram-post__tags`: Mood & webring metadata
- `.neogram-post__actions`: Like / radical / bookmark buttons
- `.neogram-comment`: Individual comment item
- `.neogram-guestbook`: Guestbook container and form
- `.neogram-counter`: Hit counter widget
- `.neogram-button`: Brutalist retro push button

### 4.2 Credential Security & Dual-Channel Authentication
- **Encryption at Rest:** Static hosting credentials (GitHub PATs, Neocities API keys, SFTP passwords) must be **encrypted at rest** using AES-256-GCM (`users.deployment_credentials`). Never return sensitive credentials in API responses.
- **Dual-Channel Authentication Standard (`extractToken(req)`):**
  - Web workstation dashboard uses HTTP-only, SameSite cookies (`neogram_session`).
  - Browser extensions (`chrome-extension://`) and headless API clients use `Authorization: Bearer <token>` headers.
  - Real-time WebSockets (`/ws/chat`) inspect cookies first, falling back to the `?token=<jwt>` URL query parameter.
  - Authentication endpoints (`/api/auth/verify-otp`, `/api/auth/magic-login`) return both `Set-Cookie` and JSON responses `{ success: true, token, user }` to support programmatic consumers.

### 4.3 Static Publishing Pipeline (11ty + Neocities)
1. User uploads photo payload and post metadata in Neogram Creator Studio (`POST /api/posts`).
2. Server validates session and processes image via `sharp` (scale to max 1200px, create 400px thumbnail, optimize to WebP).
3. Server commits record to PostgreSQL `posts` table.
4. **11ty Static Site Generation (`server/services/staticBuilder.ts`):**
   - **Multi-Tenant Isolated Builds:** Compiles personal static photo galleries strictly into isolated user folders (`dist/static-galleries/<userId>/`).
   - **FIFO BuildQueue Serialization:** All static build and compile requests are queued through an in-memory sequential FIFO queue (`buildQueue.enqueue(...)`). This guarantees that concurrent user operations (uploads, comments, edits, or deploys) run one at a time, completely eliminating race conditions on shared template data files (`posts.json` and `site.json`).
   - **Direct Static Focus (No `/preview/` Bloat):** The redundant `/preview/` and `/photos/<id>/` preview routes have been removed in favor of clean static deployments directly to Neocities and embeddable widgets.
   - Generates responsive gallery grid (`index.html`) and paginated photo pages (`photos/<id>/index.html`).
   - Copies stylesheets (`css/neogram.css`), uploads, and embed scripts into the user's static bundle.
5. **Deployment Adapter (`server/services/neocitiesPublisher.ts`):**
   - Reads decrypted Neocities API key and pushes multipart archive directly to `POST https://neocities.org/api/upload` from the user's isolated directory (`dist/static-galleries/<userId>/`).
   - Probes remote site views and hits via `https://neocities.org/api/info`.
   - Optional automatic deployment on post creation, edit, or deletion (`users.auto_deploy`).
6. Centralized social layer: Visitors to static sites react and comment; comments post back to `/api/posts/:id/comments` and trigger an automated background 11ty rebuild in the queue.

### 4.4 Styling Architecture: Pure Custom Utilities & BEM (Strictly NO Tailwind)
- **Tailwind CSS is prohibited:** Do not introduce Tailwind CLI, Tailwind directives, or Tailwind dependencies for views or embeds.
- **Custom Utility Library:** Styling is powered by a zero-dependency Vanilla CSS framework ([public/css/neogram.css](file:///Users/timwasson/antigravity/Neogram---90s-Retro-Social-Publishing/public/css/neogram.css)) compiled from Dart Sass ([src/styles/main.scss](file:///Users/timwasson/antigravity/Neogram---90s-Retro-Social-Publishing/src/styles/main.scss)).
- **CSS Variables First:** Colors, surfaces, borders, and typography must resolve through `--bg-desktop`, `--surface-window`, `--surface-title`, `--text-main`, `--border-main`, `--accent-prompt`, `--accent-mac`, `--accent-amber`, and `--code-bg`.
- **Reusable Component Classes:** Buttons (`.pixel-btn`, `.pixel-btn--yellow`, `.pixel-btn--green`, etc.), boxes (`.pixel-box`, `.window-header`), alerts (`.retro-alert`, `.retro-alert--error`, `.retro-alert--success`, `.retro-alert--info`), and telemetry (`.baud-progress-bar`).
- **Standardized Utility Classes:** Layout (`flex`, `flex-col`, `flex-row`, `items-center`, `justify-between`, `gap-1` through `gap-4`), spacing (`p-*`, `m-*`), text (`text-xs`, `text-sm`, `font-mono`, `text-bold`, `text-center`), and widths (`w-full`, `max-w-*`).
- **No Inline Styles:** Template markup must avoid inline `style="..."` attributes; all layout, spacing, and colors must be composed using the utility library and component classes.

### 4.5 Chat Engine Architecture & Privacy Invariant (Zero Server Retention)
- **Zero Permanent Archival:** The Neogram server **never** stores chat transcripts permanently in PostgreSQL. 
- **In-Memory WebSockets Router:** Real-time messages route strictly in-memory between active WebSocket connections on `/ws/chat`. Presence and away status are tracked in-memory.
- **Store-and-Forward Ephemeral Queue:** If a recipient is offline, the message is staged in `ephemeral_chat_queue`.
- **Immediate Hard-Deletion Contract:** The instant the recipient establishes a WebSocket connection, queued messages are transmitted and **immediately hard-deleted** (`DELETE FROM ephemeral_chat_queue WHERE id = ANY(...)`). Queue size returns to `0`.
- **Client-Side Message Retention:** 100% of chat history persists in browser client storage (`localStorage.getItem('neogram_im_' + handle)` in the web workstation, or `chrome.storage.local` in the browser extension). Users can clear their logs or export them as JSON at any time.

### 4.6 Browser Extension Architecture & Shared Asset Pipeline
- **WebExtension MV3 Architecture:** Manifest V3 extension in `extension/` connecting to `/ws/chat` with buddy list, instant messaging window, status selectors, and sound chimes.
- **Shared Asset Tooling:**
  - `npm run extension:sync`: Copies compiled stylesheets (`public/css/neogram.css` $\rightarrow$ `extension/shared/neogram.css`) and audio engine (`public/js/retroAudio.js` $\rightarrow$ `extension/shared/retroAudio.js`), preventing code divergence.
  - `npm run extension:package`: Syncs shared assets and packages the extension into `neogram-aim-extension.zip` ready for Chrome Web Store submission.
- **MV3 Stateless Worker Constraint:** Chrome MV3 background service workers terminate on idle. No long-lived in-memory state or WebSocket connections can exist in `background/service-worker.js`. Unread badge counters and notification tracking must be stored in `chrome.storage.local`.

### 4.7 Mobile-to-Static PWA Publishing & Offline Resilience
- **App Shell & Manifest:** Web App Manifest (`public/manifest.json`) supports standalone display mode, orientation, app shortcuts, and mobile Web Share Target (`share_target`).
- **Service Worker Caching (`public/sw.js`):** Cache-first strategy for static retro assets/fonts, network-first for HTML pages, with automated fallback to `public/offline.html` during disconnects.
- **Offline Post Buffering (IndexedDB):** If a user transmits a post while disconnected, `public/js/pwa.js` intercepts submission and buffers the photo Blob, caption, and metadata in IndexedDB (`neogram_pwa_db`, store `pending_posts`).
- **Carrier Telemetry & Auto-Drain:** Real-time COM2 carrier monitor in the desktop taskbar (`#taskbarCom2Panel`) switches between `NO CARRIER // 300 BAUD` and `CARRIER 33600 V.90`. When connectivity is restored, the client automatically drains the IndexedDB queue to `POST /api/posts`.
- **Native Hardware Camera Capture:** Uses standard `<input type="file" capture="environment">` for mobile camera snaps without WebRTC canvas overhead.

### 4.8 User Identity & Profile System (Handle & Avatar)
- **Profile Configuration (`PUT /api/settings/profile`):** Users can edit their cyberspace handle and upload custom profile avatars.
- **Sharp Avatar Pipeline:** Avatars are auto-rotated via EXIF tags (`.rotate()`), resized and cropped to a square 128x128 WebP image, and persisted to `public/uploads/avatars/`.
- **Default Avatar Asset:** When no custom avatar has been uploaded, the system resolves to `/icons/default-avatar.svg` (a stylized retro green phosphor CRT computer monitor).
- **Design Scoping Constraint:** User avatars are strictly displayed in the Settings tab (`CYBER_IDENTITY.SYS`), and intentionally omitted from the top workstation header and navigation bar to maintain a clean, distraction-free retro OS aesthetic.

### 4.9 Camera EXIF Auto-Orientation, 25MB Upload Pipeline & In-Place Stage
- **EXIF Auto-Orientation:** All incoming image uploads and avatar buffers pass through `.rotate()` in Sharp, ensuring mobile phone camera snaps (iOS & Android) preserve proper vertical orientation without sideways rendering.
- **25MB Upload Allowance & Graceful Error Trapping:** Multer file ingestion limit is expanded to 25MB (`handleUploadMiddleware`), with friendly JSON error handling (`Photo exceeds maximum allowed size (25MB limit)`).
- **In-Place Stage Swap:** Dropzone box is immediately hidden upon image selection or camera snap, seamlessly replaced by a dedicated 320px CRT preview viewport, file metadata bar, and quick swap/clear actions.
- **Post-Publish Closure:** Upon successful transmission, the success alert displays actionable navigation buttons (`📂 View in Archive →` and `🌐 View on Neocities ↗`).
- **First-Run Neocities Onboarding:** A non-intrusive notification banner in the Upload Studio alerts creators if they haven't yet linked their Neocities API key in Settings.
- **Fixed 48px Top Navigation Bar:** High-contrast layout with `scrollbar-gutter: stable both-edges` preventing page jitter when switching between dashboard tabs.

### 4.10 Neogram Instant Messenger (NIM) & Floating Window UX
- **Branding & Presence:** Renamed from generic chat to **NIM (Neogram Instant Messenger)** with a 💬 retro chat bubble icon.
- **Elevated Taskbar Safe Zone:** NIM window is positioned at `bottom: 54px`, preventing any overlap with the bottom CRT status bar.
- **Header Popout Launcher:** Top navigation bar features a quick popout toggle to summon NIM from anywhere in the workstation.

---

## 5. Prototype Assets to Preserve & Port

When building the production backend and views, extract and reuse the following tested prototype assets:
- **Audio Synthesis Engine:** [src/utils/audio.ts](file:///Users/timwasson/antigravity/Neogram---90s-Retro-Social-Publishing/src/utils/audio.ts) / [public/js/retroAudio.js](file:///Users/timwasson/antigravity/Neogram---90s-Retro-Social-Publishing/public/js/retroAudio.js) (Web Audio API sound generator for clicks, shutters, success chimes, and dial-up tones).
- **CSS Tokens & Design System:** [src/styles/](file:///Users/timwasson/antigravity/Neogram---90s-Retro-Social-Publishing/src/styles/) (`.pixel-box`, `.pixel-btn`, `.mac-pinstripes`, CRT scanline shaders, color tokens).
- **SVG Graphics & 88x31 Badges:** [src/utils/sampleData.ts](file:///Users/timwasson/antigravity/Neogram---90s-Retro-Social-Publishing/src/utils/sampleData.ts) (Retro workstation SVGs, pixel art icons, badge definitions).
- **Embed Code Formats:** [embed/](file:///Users/timwasson/antigravity/Neogram---90s-Retro-Social-Publishing/embed/) (HTML snippets, iframe fallbacks, and CSS inclusion patterns).

---

## 6. Migration Roadmap

1. **[x] Step 1: Project Structuring & Backend Foundation**
   - Established server directory (`server/`) with Express, TypeScript/ESM, environment configuration, PostgreSQL database connection, and automated schema migrations.
2. **[x] Step 2: Authentication & User Accounts**
   - Passwordless magic link / OTP flow, JWT cookies, session validation middleware, high-contrast baud-rate telemetry UI.
3. **[x] Step 3: Asset Storage & Sharp Processing Pipeline**
   - Multer upload handling, Sharp processing (1200px max, 400px thumbnails, WebP compression), preset sprites, database auto-seeding.
4. **[x] Step 4: 11ty Static Gallery Generator & Concurrency-Safe BuildQueue**
   - `@11ty/eleventy` integration, Nunjucks templates in `eleventy/`, multi-tenant isolated per-user compilation to `dist/static-galleries/<userId>/`.
   - Serialized via an in-memory FIFO `BuildQueue` to prevent race conditions during concurrent builds and deployments.
   - Removed redundant `/preview/` routes in favor of direct Neocities deployment and live embed widgets.
5. **[x] Step 5: Gallery Management (Edit & Delete Uploads)**
   - Dashboard interface for browsing uploaded photos, editing captions/tags/filters, deleting posts, and rebuilding the static gallery.
6. **[x] Step 6 (Milestone 3): Neocities Settings & Deployment Adapter**
   - Per-user encrypted credential storage (`users.deployment_credentials` using AES-256-GCM), masked key display, sitename auto-fetch.
   - Live Neocities connection probe (`https://neocities.org/api/info`) displaying remote views, hits, and last updated time.
   - Per-user 11ty static compilation (`server/services/staticBuilder.ts`) compiling isolated personal galleries to `dist/static-galleries/<userId>/`.
   - REST API deployment pipeline pushing multipart bundle to `POST https://neocities.org/api/upload` with optional auto-deploy on photo changes.
7. **[x] Step 7 (Milestone 4): Embeds Studio (Counter, Guestbook, Comments) & JSON Feeds**
   - Dynamic SVG web hit counters (`/counter/:handle.svg` with green phosphor, red nixie, mechanical odometer, and blue VFD styles).
   - Public JSON feeds (`/api/users/:handle/feed.json` and `/feed/:handle.json`) compliant with JSONFeed 1.1 for headless static sites.
   - Public guestbook ledger (`/api/guestbook/:handle`) with standalone iframe embed (`/embed/guestbook/:handle`) and moderation dashboard.
   - Standalone photo feed embed card (`/embed/feed/:handle`) and creator cyberspace network with follow/unfollow toggle (`/api/network/users`).
8. **[x] Step 8 (Milestone 5A): In-Site AIM/ICQ Retro Chat Engine**
   - WebSockets router at `/ws/chat` for in-memory live presence tracking and real-time message routing.
   - Ephemeral store-and-forward queue (`ephemeral_chat_queue`) for offline delivery with immediate hard-deletion upon transmission.
   - 100% client-side `localStorage` message persistence (`neogram_im_<handle>`), eliminating long-term database storage liability.
   - Classic 90s AIM sound synthesis: door open chime, door slam thump, message received sparkle, send click.
   - Retro floating window UI with buddy list, status/away message selector, typing indicator, live CRT transcript, and chat logs JSON export/clear.
9. **[x] Step 9 (Milestone 5B): Retro Chat Browser Extension**
   - Manifest V3 browser extension (`extension/`) connecting to the Neogram WebSocket chat router (`/ws/chat`).
   - Reusable component architecture sharing pure CSS tokens (`extension/shared/neogram.css`) and audio engine (`extension/shared/retroAudio.js`).
   - AJAX passwordless authentication with Baud rate telemetry and JWT Bearer token authorization.
   - Retro AIM 97 popup interface (`popup.html`) with buddy list, instant messaging CRT transcript, export logs, and clear logs.
   - Background service worker (`service-worker.js`) for unread count badge indicators and notifications.
   - Built automated sync and package scripts (`npm run extension:sync`, `npm run extension:package`) producing `neogram-aim-extension.zip`.
   - Complete store metadata and permissions justification in `CHROMEWEBSTORE.md`.
10. **[x] Step 10 (Milestone 6): Mobile-to-Static Publishing Engine (PWA)**
    - Web App Manifest (`public/manifest.json`) supporting standalone display mode, orientation, app shortcuts, and mobile Web Share Target (`share_target`).
    - PWA Service Worker (`public/sw.js`) with cache-first static asset caching, network-first page navigation, and offline fallback.
    - Retro 90s offline fallback interface (`public/offline.html`) with "MODEM: NO_CARRIER // 300 BAUD" CRT telemetry and retry handshake.
    - Client-side PWA controller (`public/js/pwa.js`) managing `beforeinstallprompt` installation banners and real-time COM2 carrier detection.
    - Hardware camera integration (`capture="environment"`) with "📸 SNAP CAMERA PHOTO" button for mobile device cameras.
    - Offline post resilience: IndexedDB buffering (`neogram_pwa_db`) for photos captured while disconnected, with auto-sync upon carrier restoration.
11. **[x] Step 11: Production Polish, EXIF Orientation, 25MB Ingestion & Settings Identity**
    - Streamlined mobile and desktop uploader workflow focusing on photo + caption.
    - Sharp `.rotate()` integration for mobile camera EXIF orientation preservation.
    - Multer 25MB upload allowance with graceful error trapping.
    - In-place dropzone swap, post-publish closure links (`View in Archive`, `View on Neocities`), and first-run Neocities onboarding banner.
    - User profile handle editing, Sharp avatar processing (128x128 WebP), default CRT avatar graphic, and scoped identity display.
    - Navigation stability with fixed 48px top bar, stable scrollbar gutter, and NIM chat header launcher.

---

## 7. Developer & Operational Runbook

### 7.1 Development Daemons
Neogram requires two long-running processes during development:
```bash
# 1. Start Express API, Workstation UI & WebSockets server (Port 4000)
npm run dev:server

# 2. Start Dart Sass compiler watching src/styles/
npm run sass:watch

# Alternatively, run both concurrently:
npm run dev
```

### 7.2 Extension Tooling & Packaging
```bash
# Sync latest compiled CSS and audio engine into extension/shared/
npm run extension:sync

# Sync assets and bundle extension into zip file for Chrome Web Store:
npm run extension:package
# Output: neogram-aim-extension.zip
```

### 7.3 Database Migrations & Seeding
Migrations run automatically on server start via `server/db/migrate.ts`.
Database connection resolves via `DATABASE_URL` in `.env`:
```bash
# Default development database:
DATABASE_URL=postgres://timwasson@localhost:5432/neogram
```

### 7.4 Required Environment Variables (`.env`)
```env
PORT=4000
DATABASE_URL=postgres://localhost:5432/neogram
SESSION_SECRET=neogram_retro_super_secret_session_jwt_2026
NEOCITIES_ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
```


