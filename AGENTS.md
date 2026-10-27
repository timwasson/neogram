# AGENTS.md: Neogram Project Guide & Specification

> **Notice for AI Agents:**
> The migration from the initial Google AI Studio React prototype to the target production system is **100% complete**. Neogram is an API-first, decoupled monolith built with Node.js (Express), Nunjucks server-rendered views, 11ty v3 static site generation, PostgreSQL, Sharp image processing, embeddable vanilla JS widgets, and a Manifest V3 browser extension.
> **All styling is strictly Pure Vanilla CSS / Sass with BEM classes. Tailwind CSS is strictly prohibited.**

---

## 1. Project Overview & Vision

**Neogram** is a lightweight SaaS suite designed for retro web enthusiasts (Neocities, GitHub Pages, self-hosted static site owners) that bridges mobile-first creation with 90s web nostalgia.

It provides:
1. **Mobile-to-Static Publishing Engine (PWA):** Snap or upload a photo, apply retro filters/shaders, write a caption, and publish it directly to personal static sites (via Neocities API, Nekoweb API, GitHub Pages commits, or SFTP).
2. **Centralized & Self-Hosted Social Layer:** Embeddable async JS/iframes that inject styled feeds, guestbook ledgers, and zero-retention self-hosted comment files onto static sites with 1-click Cyber-Pass authentication.
3. **Legacy Retro Widgets:** Dynamic web hit counter images (LED/Nixie/Odometer/VFD) and guestbook ledgers permanently anchored to immutable numeric node UINs.
4. **Retro Chat Browser Extension:** A Chrome/Firefox Manifest V3 sidebar/popup emulating classic 90s AIM/ICQ mechanics with buddy lists, DMs, sound chimes, and status messages.
5. **Cyberspace Friends Network & Static Follow Grid:** Simple "Friends" engine with reciprocal 1-click adding, dedicated workstation Friends console (`/friends`), static `/friends/index.html` photo grid on Neocities/Nekoweb, and concurrency-safe cascading FIFO rebuilds when friends broadcast new photographs.
6. **Cyberspace Station Directory & Presence Hub (`/directory`):** Public station white-pages categorizing registered nodes by live presence (Active 🟢, Away 🟡, Inactive ⚪) with deterministic alphabetical sorting and instant search filtering.
7. **Interactive Cyberspace Documentation Center (`/docs`):** Complete user manuals, setup guides, and live session-interpolated embed snippets.
8. **Configurable Cyberspace Notification Engine & In-App Alert Center (`[:> NOTIFY_CENTER.SYS]`):** Real-time WebSocket transmission alerts (`/ws/chat`), 8-bit synthesized audio chimes, native desktop/PWA service worker pushes, and a user dashboard configuration console (`[:> NOTIFICATION_DISPATCHER.CFG]`) to toggle delivery across 8 event types.
9. **Headless Self-Hosted API & Static JSON Feeds:** Opt-out capability allowing users to disable 11ty static HTML generation (`users.build_html`) and compile/push strictly `feed.json`, `posts.json`, per-photo comment JSONs, and optimized media to their personal static host (Neocities or Nekoweb), enabling custom bespoke frontends in Vanilla JavaScript, React, or Vue.
10. **Cold-Start Sandbox Publishing Mode:** Instant photo snaps and publication directly to station profiles (`/user/:handle`) without requiring an external Neocities account or API key first, giving creators immediate gratification and zero-friction onboarding.
11. **Mobile Cyber-Pass & Cross-Domain SSO:** 1-click cross-domain authentication for static sites supporting desktop pop-up postMessage and mobile return URL redirect with `#neogram_pass=` hash token ingestion.
12. **Indie Web Data Sovereignty & Account Decommissioning:** 1-click JSON station archive export (`GET /api/settings/export-archive`) and self-serve station wipe (`DELETE /api/settings/account`) enforcing zero data lock-in.
13. **Multi-Site Architecture (1 User : N Sites):** Complete decoupling of user login identity (callsign `@handle`, permanent numeric `#uin`) from static site deployments. A single authenticated creator can provision, manage, switch between, and deploy to multiple independent static targets (e.g. Neocities, Nekoweb, GitHub Pages), each with dedicated deploy paths, isolated photo streams, per-site SVG hit counters (`/counter/:uin/:slug.svg`), guestbooks (`/embed/guestbook/:handle/:slug`), and static feeds.
14. **Embeddable Retro Chat & Pager Widget (`embed/pager.js`):** Lightweight client widget allowing static site owners to embed a floating dock or inline retro chat window on Neocities, Nekoweb, or GitHub Pages. Features live operator presence (Active 🟢, Idle 🟡, Signed Out ⚪), strict destination station locking (can *only* message the host station owner), 1-click Cyber-Pass authentication with automatic random `@guest_XXXX` fallback for unauthenticated visitors, 24-hour store-and-forward queueing (`ephemeral_chat_queue`) with zero permanent database retention, and station owner controls to toggle widget enablement and anonymous messaging.

---

## 2. Target Technical Stack

| Component | Technology | Rationale / Purpose |
|---|---|---|
| **Backend & Workstation Runtime** | **Node.js (Express)** on Port 4000 | Single-server decoupled monolith serving authenticated workstation, API, and static publishing pipeline |
| **Database** | **PostgreSQL** (Docker / Native) | Relational integrity for users, sites, posts, comments, follows, guestbook, counters |
| **Image Processing** | **Sharp** | High-performance image resizing (1200px), WebP compression, square thumbnailing (400px) |
| **Static Site Generator** | **Eleventy (11ty v3)** | Compiles multi-tenant static photo galleries (`dist/static-galleries/<siteId>`) via FIFO BuildQueue |
| **Server Templating** | **Nunjucks** | Fast, secure server-rendered dashboard & embed markup templates |
| **Styling & Design System** | **Dart Sass + Vanilla CSS (NO TAILWIND)** | Modular SCSS (`src/styles/`), CSS variables, BEM components (`pixel-box`, `pixel-btn`, `retro-alert`, `baud-progress-bar`), CRT phosphor glow, and utility classes. **Tailwind CSS is strictly prohibited.** |
| **Static Deploy Pipeline** | **Neocities API / Nekoweb API / GitHub API / SFTP** | Automated pushes of generated 11ty HTML & media to the user's static host |
| **Client Embeds** | **Vanilla JS + BEM Hooks** | Zero-dependency async embed scripts with strict BEM CSS hooks for user customization |
| **Audio Synthesis** | **Web Audio API (`retroAudio`)** | Synthesized 8-bit beeps, shutter sounds, dial-up handshakes, click SFX |
| **Chat Extension** | **WebExtension (Manifest V3)** | AIM/ICQ-style popup/sidebar chat client |

---

## 3. Database Schema (PostgreSQL)

```sql
-- Users & Station Node Identity
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    handle VARCHAR(50) UNIQUE,
    uin INTEGER UNIQUE NOT NULL, -- ICQ-style immutable numeric ID (sequence starting at 100101)
    auth_token VARCHAR(255),
    auth_token_expires_at TIMESTAMPTZ,
    site_url VARCHAR(500),
    deploy_path VARCHAR(200) DEFAULT 'neogram',
    deployment_type VARCHAR(50) DEFAULT 'none' CHECK (deployment_type IN ('neocities', 'nekoweb', 'github', 'sftp', 'none')),
    deployment_credentials BYTEA, -- Encrypted credentials (AES-256-GCM)
    custom_css_url VARCHAR(500),
    avatar_path VARCHAR(500), -- 128x128 WebP profile avatar
    auto_deploy BOOLEAN DEFAULT FALSE,
    build_html BOOLEAN DEFAULT TRUE,
    last_deployed_at TIMESTAMPTZ,
    status_message VARCHAR(150) DEFAULT 'Surfing cyberspace',
    is_away BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Mounted Static Site Targets (1 User : N Sites)
CREATE TABLE sites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(60) NOT NULL,
    site_url VARCHAR(500),
    deployment_type VARCHAR(50) DEFAULT 'neocities' CHECK (deployment_type IN ('neocities', 'nekoweb', 'github', 'sftp', 'none')),
    deployment_credentials BYTEA, -- Encrypted credentials (AES-256-GCM)
    deploy_path VARCHAR(200) DEFAULT 'neogram',
    auto_deploy BOOLEAN DEFAULT FALSE,
    build_html BOOLEAN DEFAULT TRUE,
    custom_css_url VARCHAR(500),
    is_default BOOLEAN DEFAULT FALSE,
    last_deployed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, slug)
);

CREATE INDEX idx_sites_user_id ON sites(user_id);

-- Posts Published to Static Sites & Social Feed
CREATE TABLE posts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    site_id UUID REFERENCES sites(id) ON DELETE CASCADE,
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
    site_id UUID REFERENCES sites(id) ON DELETE CASCADE,
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
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    site_id UUID REFERENCES sites(id) ON DELETE CASCADE,
    hits BIGINT DEFAULT 0,
    style VARCHAR(50) DEFAULT 'green_led',
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX idx_web_counters_site_id ON web_counters(site_id);

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

-- Notification Preferences per Station Node
CREATE TABLE notification_preferences (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    notify_nim BOOLEAN DEFAULT TRUE,
    notify_follow BOOLEAN DEFAULT TRUE,
    notify_comment_own BOOLEAN DEFAULT TRUE,
    notify_comment_thread BOOLEAN DEFAULT TRUE,
    notify_guestbook BOOLEAN DEFAULT TRUE,
    notify_like BOOLEAN DEFAULT TRUE,
    notify_friend_post BOOLEAN DEFAULT TRUE,
    notify_deploy BOOLEAN DEFAULT TRUE,
    sound_enabled BOOLEAN DEFAULT TRUE,
    desktop_push BOOLEAN DEFAULT FALSE,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- In-App Persistent Notifications Inbox
CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
    type VARCHAR(50) NOT NULL,
    title VARCHAR(200) NOT NULL,
    body TEXT,
    link_url VARCHAR(500),
    icon VARCHAR(20) DEFAULT '🔔',
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_notifications_user_unread ON notifications(user_id, is_read, created_at DESC);
```

---

## 4. Key Architectural Patterns & Constraints

### 4.1 Strict BEM Embed & Static Site Deliverable Contract

#### Dual Styling Strategy: Workstation Utilities vs. Static Deliverable BEM
- **Neogram Workstation App (`views/index.njk`):** Built for rapid internal UI assembly using custom zero-dependency utility classes (`flex`, `p-4`, `text-xs`, etc.) and retro components (`.pixel-box`, `.pixel-btn`).
- **Static Gallery Output (`eleventy/src/` delivered to Neocities):** Must **never** use ad-hoc utility classes. Static sites delivered to end users must use standard, semantic BEM classes (`.neogram-*`).
- **End-User Customization Rationale:** Static site owners (Neocities, GitHub Pages, self-hosted) need complete flexibility to attach custom stylesheets or `<style>` blocks and override elements without fighting utility class specificity or needing `!important`. All default styling is encapsulated in `src/styles/components/_static-gallery.scss` at base class specificity `(0, 1, 0)`.
- **Custom CSS Injection (`custom_css_url`):** `users.custom_css_url` is queried in `server/services/staticBuilder.ts`, passed to `site.json` as `site.customCssUrl`, and automatically linked in `eleventy/src/_includes/layouts/base.njk`.

#### 1. Static Gallery BEM Hierarchy (`eleventy/src/`)
| Block | Elements / Modifiers | Description |
|---|---|---|
| **`.neogram-site`** | `__taskbar`, `__branding`, `__logo`, `__title`, `__tag`, `__nav`, `__main`, `__footer`, `__footer-inner`, `__footer-info`, `__footer-host`, `__footer-url`, `__footer-sub`, `__footer-badges` | Overall site shell layout (`base.njk`) with nav toggles between `[🏠 Gallery Grid]` and `[👥 Friends Grid]` |
| **`.neogram-banner`** | `__header`, `__title`, `__status`, `__body`, `__info`, `__desc`, `__node`, `__actions` | Header info window card on gallery index & static friends stream; hosts `#staticFriendBtn` |
| **`.neogram-grid`** | *(Container)* | Multi-column responsive CSS grid for photos (`index.html` and `friends/index.html`) |
| **`.neogram-card`** | `__header`, `__author`, `__shader`, `__media`, `__image`, `__overlay`, `__overlay-btn`, `__body`, `__content`, `__meta`, `__location`, `__date`, `__caption`, `__tags`, `__footer`, `__likes` | Individual photo window card (`index.njk` & `friends.njk`) |
| **`.neogram-detail`** | `__header`, `__title`, `__status`, `__status-shader`, `__status-sub`, `__body`, `__layout`, `__media-col`, `__viewport`, `__image`, `__tags`, `__info-col`, `__author-box`, `__author-meta`, `__author-handle`, `__author-date`, `__caption`, `__reactions` | Detail photo page (`photos/<id>/index.html`) |
| **`.neogram-comments`** | `__header`, `__title`, `__status`, `__ledger`, `__empty`, `__item`, `__item-header`, `__item-author`, `__item-time`, `__item-body`, `__form`, `__form-row`, `__input`, `__submit` | Live comments ledger & form (`photo.njk`) |
| **`.neogram-btn`** | `--sm`, `--lg`, `--primary`, `--yellow`, `--accent`, `--cyan`, `--success`, `--green`, `--danger`, `--red` | Reusable retro push button (`(0, 1, 0)` specificity) |
| **`.neogram-badge`** | `--cyan`, `--magenta`, `--amber`, `--green` | 88x31 / micro status pills |
| **`.neogram-empty`** | `__icon`, `__title`, `__desc`, `__action` | Empty photo stream state (used in both personal gallery and friends stream) |

#### 2. Embeddable Widgets BEM Contract (`embed/`)
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
- `.neogram-pager-dock`: Floating bottom-right/left trigger button with live operator LED
- `.neogram-pager-window`: Standalone retro pager dialog (`__header`, `__title`, `__actions`, `__body`, `__station-strip`, `__station-avatar`, `__station-info`, `__station-handle`, `__station-away`, `__auth-strip`, `__auth-tag`, `__auth-btn`, `__feed`, `__msg`, `__msg--out`, `__msg--in`, `__msg--sys`, `__form`, `__textarea`, `__footer`, `__counter`, `__btn-send`)
- `.pager-led`: Status indicator dot (`--online` green, `--away` amber, `--offline` grey)

### 4.2 Credential Security & Dual-Channel Authentication
- **Encryption at Rest:** Static hosting credentials (GitHub PATs, Neocities API keys, SFTP passwords) must be **encrypted at rest** using AES-256-GCM (`users.deployment_credentials`). Never return sensitive credentials in API responses.
- **Dual-Channel Authentication Standard (`extractToken(req)`):**
  - Web workstation dashboard uses HTTP-only, SameSite cookies (`neogram_session`).
  - Browser extensions (`chrome-extension://`) and headless API clients use `Authorization: Bearer <token>` headers.
  - Real-time WebSockets (`/ws/chat`) inspect cookies first, falling back to the `?token=<jwt>` URL query parameter.
  - Authentication endpoints (`/api/auth/verify-otp`, `/api/auth/magic-login`) return both `Set-Cookie` and JSON responses `{ success: true, token, user }` to support programmatic consumers.

### 4.3 Static Publishing Pipeline (Dual-Tier: Eleventy Full Builds + High-Speed Delta Engine)
1. User uploads photo payload and post metadata in Neogram Creator Studio (`POST /api/posts`).
2. Server validates session and processes image via `sharp` (scale to max 1200px, create 400px thumbnail, optimize to WebP).
3. Server commits record to PostgreSQL `posts` table.
4. **Dual-Tier Static Site Engine:**
   - **Tier 1 — Eleventy Full Multi-Tenant Builds (`server/services/staticBuilder.ts`):** Used for initial site provisioning, full manual re-syncs (`POST /api/build-static`), or structural template modifications. Serialized through `buildQueue.enqueue` with template caching disabled.
   - **Tier 2 — High-Speed Incremental Delta Builder (`server/services/incrementalBuilder.ts`):** Used for high-frequency operations:
     - **New Photo Snaps:** Compiles *only* the new photo HTML (`photos/<id>/index.html`), updates the main gallery grid (`index.html`), and updates `feed.json` / `posts.json` in **~10–25ms**. Existing photo pages and static assets are untouched.
     - **Comment & Like Reactions:** Re-renders *only* the single affected photo's HTML page (`photos/<id>/index.html`), comment ledger JSON (`<file>.comments.json`), and feeds in **~15ms**. Zero full rebuilds.
     - **Friends Network Cascade:** Re-renders *only* the follower's `friends/index.html` and `friendsPosts.json` in **~10ms**. Follower's friend grid strictly references the original author's host URL for image and thumbnail assets (**0 bytes of media copied or uploaded to follower's site**).
5. **Deployment Adapters & Delta Uploader (`neocitiesPublisher.ts` & `nekowebPublisher.ts`):**
   - **Neocities Delta Upload (`deployFilesToNeocities`):** Direct multipart POST to `https://neocities.org/api/upload` transferring strictly the delta files (e.g. 1–5 files), bypassing full-directory scans.
   - **Nekoweb Delta Upload (`deployFilesToNekoweb`):** Uploads individual files or folder batches directly via `POST https://nekoweb.org/api/files/upload`. **Does NOT require a ZIP archive for incremental updates**, reducing deployment latency from 2.5s+ down to ~100–200ms. Bulk ZIP import (`/api/files/big/*` + `/api/files/import/:id`) is strictly reserved as an initial site setup fallback.
   - Initial site deployment seeds base assets (`css/`, `js/`, `icons/`, `embed/`), after which all publishing operations utilize the lightning-fast delta pipeline.
6. Centralized social layer: Visitors to static sites react and comment; comments post back to `/api/posts/:id/comments` and trigger an automated background delta rebuild and deploy.


### 4.4 Styling Architecture: Pure Custom Utilities & BEM (Strictly NO Tailwind)
- **Tailwind CSS is prohibited:** Do not introduce Tailwind CLI, Tailwind directives, or Tailwind dependencies for views or embeds.
- **Custom Utility Library:** Styling is powered by a zero-dependency Vanilla CSS framework (`public/css/neogram.css`) compiled from Dart Sass (`src/styles/main.scss`).
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
- **Service Worker Caching & Cache Versioning Protocol (`public/sw.js`):** Cache-first strategy for static retro assets/fonts, network-first for HTML pages, with automated fallback to `public/offline.html` during disconnects. Modifications to the application shell or base assets require incrementing `CACHE_NAME` (e.g., `'neogram-shell-v2'`).
- **Zero-Stale-Shell Invalidation:** In `public/sw.js`, the `activate` event purges all obsolete cache stores (`key !== CACHE_NAME`), immediately claims clients (`self.clients.claim()`), and broadcasts `postMessage({ type: 'CACHE_UPDATED' })` to all connected windows.
- **Strict No-Cache Service Worker Route (`server/app.ts`):** `GET /sw.js` must always be served explicitly with `Cache-Control: no-cache, no-store, must-revalidate`, `Pragma: no-cache`, and `Expires: 0`. This prevents mobile Safari and standalone iOS PWAs from pinning stale service worker scripts in persistent HTTP disk cache.
- **Client Auto-Update Dispatch (`public/js/pwa.js`):** On every page load, `pwa.js` triggers `reg.update()`. When a `CACHE_UPDATED` message is received from the newly activated service worker, the client automatically reloads (`window.location.reload()`), ensuring mobile standalone users transition to clean app shells without manual cache clearing.
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

### 4.11 ICQ-Style Permanent Node UIN & Handle Mutability
- **Immutable Embed Anchor (`users.uin`):** Every station is provisioned a permanent, immutable numeric node ID (e.g. `#100109`, generated from a PostgreSQL sequence starting at `100101`).
- **Handle Mutability Without Broken Embeds:** Users can freely edit their cyber call-sign / handle (`@handle`) in Settings without breaking third-party static site embeds, guestbook ledgers, or dynamic web counters, which resolve permanently against `uin`.
- **Anti-Impersonation:** Station handles are strictly unique, lowercase alphanumeric (3-30 chars).

### 4.12 Dual-Channel OTP Dispatcher & Sliding Rate Limiting
- **Dual Providers:** Passwordless authentication dispatches 6-digit numeric OTP tokens via:
  1. **Resend Email API:** Free tier (3,000 emails/month) delivering cyber-themed verification emails with ASCII art.
  2. **Twilio Programmable SMS:** Budget-conscious mobile verification ($1.15/mo local number + $0.0079/text) delivering immediate SMS alerts to E.164 phone numbers.
- **Graceful Dev Fallback:** When API credentials are left unconfigured, codes safely output directly to the local Node development terminal.
- **In-Memory Rate Limiting:** `POST /api/auth/request-otp` enforces a sliding window rate limit of maximum 4 requests per 15 minutes per IP and per target identifier, eliminating credential spamming and protecting API quotas.

### 4.13 Zero-Retention User Image Pipeline (0 MB Server Storage)
- **Zero Local Retention Contract:** The Neogram host server **never** acts as a permanent media host or storage bucket for user photos.
- **Ephemeral Build Staging:** Image uploads stream into memory via Multer and are processed by Sharp directly into the user's isolated static build directory (`dist/static-galleries/<userId>/uploads/`).
- **Post-Deploy Disk Purge:** The moment `deployToNeocities` completes uploading the multipart bundle to the user's remote Neocities site, the local `uploads/` directory is **immediately wiped from disk** (`fs.rm(uploadsDir, { recursive: true, force: true })`). Local disk retention returns to `0 bytes`.

### 4.14 Safe Subdirectory Publishing & Non-Destructive Invariant
- **Safe Subfolder (`users.deploy_path`):** Neogram defaults to publishing to `/neogram/` (e.g., `https://<user>.neocities.org/neogram/`). Users can customize the subfolder name in Settings or leave it blank for root.
- **Root Site Non-Destruction:** Existing Neocities homepages (`index.html`), personal blogs, styling, or custom files are **never overwritten or modified** because all Neogram files compile and upload strictly under the `deploy_path` prefix.
- **Non-Destructive Deletion Filter:** In `deleteFromNeocities()`, remote deletion requests to Neocities are strictly filtered: only paths located within `uploads/` that match `deploy_path` are permitted to be deleted. Any attempt to delete files outside the upload folder is immediately refused with `[:> NEOCITIES DELETE REFUSED]`.
- **Eleventy `pathPrefix` Integration:** Compilations pass `process.env.ELEVENTY_PATH_PREFIX`, and all templates wrap stylesheet links, scripts, and internal page routes in Eleventy's built-in `| url` filter.

### 4.15 Production Containerization (Docker & DigitalOcean)
- **Multi-Stage Dockerfile:** Node 22 Alpine runner with native Sharp/Postgres build dependencies, automated Sass stylesheet compilation (`npm run sass:build`), and non-interactive `tsx` runner.
- **1-Click Docker Compose:** `docker-compose.yml` orchestrates both the `neogram_app` Node service and `neogram_postgres` database container with automated migration mounting, container healthchecks, and volume persistence for instant deployment on DigitalOcean Droplets or VPS hosts.

### 4.16 Mobile Ergonomics & Responsive Dual-Mode Navigation
- **Dual-Mode Ergonomics:**
  - **Desktop ($\ge$ 768px):** Preserves authentic Unix / Mac-System 7 desktop workstation with 48px top bar, workstation window frames, and fixed bottom BSD/X11 taskbar (`.retro-taskbar`).
  - **Mobile (< 768px):** Adapts to a high-contrast, thumb-accessible **Retro Mobile Bottom Bar** (`.retro-mobile-nav`) with 5 touch tabs: Studio (`#upload`), Archive (`#edit`), Config (`#settings`), Embeds (`#embeds`), and NIM (`#aimMessengerWindow`).
- **Screen Space Recovery:** Desktop taskbar and redundant top navigation links are hidden on `< 768px`, recovering over 120px of vertical space. `<main>` enforces `padding-bottom: 74px` on mobile to prevent content clipping.
- **Mobile NIM Drawer Sheet:** On mobile viewports, the NIM chat window (`.aim-window`) dynamically converts from a floating corner card to a centered slide-up drawer between the top header and bottom tab bar (`bottom: 58px; left: 8px; right: 8px; height: 75dvh`), preventing horizontal overflow.

### 4.17 Decoupled User Onboarding, Zero-Site Participation & "What's Next?" Flow
- **Immediate Profile Completion:** When a new user registers via email/SMS OTP, their Neogram identity is 100% complete immediately (`@handle` and immutable `#UIN` assigned). No site mounting is required to be an active member of Cyberspace.
- **Zero-Site Capabilities:** Users with 0 mounted static sites can immediately:
  - Chat via NIM instant messaging (`/ws/chat`) with buddy list and away status.
  - Sign retro guestbooks on remote member stations using 1-click Cyber-Pass SSO.
  - Browse and search the public Station Directory (`/directory`).
  - Follow other creator stations (`POST /api/users/:handle/follow`) and consume transmissions in their live Workstation Follower Feed (`[📰 Feed]` tab at `/#feed`).
- **Welcoming Station Onboarding & "What's Next?":**
  - **Station Welcome Card (`#welcomeStationCard`):** Displays `[PROFILE COMPLETE]`, welcoming the creator by handle and UIN, confirming their active capabilities.
  - **"What's Next? — Unlock Creator Studio":** Contextual card explaining why a user would want to mount a static site target (enables photo transmissions, retro shaders, profile avatars, personal 11ty static photo grids, and SVG web hit counters) with a direct button `[ ➕ ADD A STATIC SITE TARGET :> ]` that opens the provisioning modal.
  - **Zero-Site Creator Studio Guard (`#noSiteUploadBanner`):** When accessing Creator Studio (`#upload`), an informative banner guides the user to mount a site rather than throwing cryptic upload failures.

### 4.18 Archive Quick-Share Actions & Visual Filter Swatches
- **One-Tap Static Sharing:** Every post card in the `#edit` archive ledger includes:
  - `[ 🔗 View Live ↗ ]`: Opens the published static photo page directly on Neocities in a new tab.
  - `[ 📋 Copy Link ]`: Copies the photo's live URL to the clipboard with retro click audio and visual `[ ✓ COPIED! ]` feedback.
- **Visual Filter Swatch Carousel:** The 6 retro shaders (`CRT Phosphor`, `16-Color VGA`, `GameBoy 1-Bit`, `Neon Cyber`, `1996 Polaroid`, `Raw 24-Bit`) are displayed as tactile swatch tiles with mini preview boxes and horizontal touch scrolling on mobile.

### 4.19 Carrier Compliance, Legal Endpoints & Transactional Authentication
- **Legal Endpoints (`/terms` & `/privacy`):** Fully rendered retro-styled legal compliance documents required for TCPA/CTIA regulations and Twilio A2P 10DLC carrier registration.
  - `/terms`: Establishes explicit SMS program terms, carrier non-liability clauses, program name ("Neogram Cyber Authentication"), message frequency disclosures ("1 message per login attempt"), and standardized keyword commands (`STOP` to cancel, `HELP` for support).
  - `/privacy`: Features an explicit, uncompromised Mobile Information Non-Disclosure clause: *"No mobile information will be shared with third parties/affiliates for marketing/promotional purposes. All the above categories exclude text messaging originator opt-in data and consent; this information will not be shared with any third parties."*
- **Transactional Auth Delivery:**
  - **Email OTP (Resend):** Verified for `neogram.club` sending cyber-themed login codes from `Neogram <auth@neogram.club>`.
  - **SMS OTP (Twilio):** Configured via Twilio REST API to dispatch single-use 6-digit verification codes to E.164 phone numbers with server log fallback during registration vetting.

### 4.20 Production Infrastructure, Reverse Proxy & Automated CI/CD
- **Production Host:** DigitalOcean Droplet (`104.248.57.128`) running Ubuntu 24.04 LTS, Docker 29, and a 2GB persistent swapfile.
- **Reverse Proxy (Caddy v2):** Handles HTTP/2 and TLS v1.3 with automatic Let's Encrypt certificates for `neogram.club` and `www.neogram.club`, proxying traffic to internal port `127.0.0.1:4000`.
- **Continuous Deployment (GitHub Actions):** `.github/workflows/deploy.yml` triggers on any push to `origin/main`. It executes TypeScript lint checks (`npm run lint`), SSHs into the Droplet, executes `git pull`, rebuilds containers via `docker compose up -d --build`, and polls `/api/health` until healthy.

### 4.21 Security Architecture, CORS Invariants & Content Sanitization
- **The Cross-Domain Invariant (CORS vs. XSS):**
  - **Permissive CORS on Public Routes:** Neogram's core service allows personal static websites (Neocities, GitHub Pages, self-hosted sites) to embed interactive feeds, dynamic SVG hit counters, guestbooks, and comment boxes. All public endpoints (`/counter/*`, `/feed/*`, `/embed/*`, `/api/guestbook/*`, `/api/posts/:id/comments`, `/api/posts/:id/like`, `/api/users/*`, `/api/network`) strictly maintain permissive CORS (`Access-Control-Allow-Origin: *`) and handle preflight `OPTIONS` requests.
  - **Strict Output Sanitization (Stored XSS Elimination):** External visitors can submit text across domains without authentication, so all user-supplied text rendered into templates, embeds, or dynamic DOM insertions (comment author/body, guestbook messages, screen handles, away statuses) must pass through HTML escaping (`escapeHtml()`). Nunjucks templates must **never** use `| safe` on untrusted user strings.
  - **URL Protocol Whitelisting:** User-supplied links (e.g. `visitor_website` in guestbooks) must strictly validate against `^https?://`, rejecting `javascript:`, `data:`, and `vbscript:` schemes.
- **Dual Clickjacking & Frame Ancestors Policy:**
  - **Workstation / Admin App:** Enforces `X-Frame-Options: SAMEORIGIN` and `Content-Security-Policy: frame-ancestors 'self'` to prevent clickjacking attacks against user settings, upload controls, and private galleries.
  - **Public Embeds & Counters:** Embed routes (`/embed/*`) and SVG hit counters explicitly override this policy with `Content-Security-Policy: frame-ancestors *` so third-party static hosts can embed iframes freely.
- **WebSocket (NIM) CSWSH Origin Verification & Chat Flood Control:**
  - Real-time WebSocket upgrades on `/ws/chat` strictly validate the HTTP `Origin` header against `config.appUrl`, `localhost:*`, `127.0.0.1:*`, and browser extension schemes (`chrome-extension://*`), mitigating Cross-Site WebSocket Hijacking (CSWSH).
  - Outgoing direct messages enforce a per-user sliding window limiter (max 30 messages/minute) to prevent spam and socket flooding.
- **Authentication & Verification Hardening:**
  - **Cryptographic OTP PRNG:** Single-use 6-digit OTP tokens are generated with `crypto.randomInt(100000, 1000000)`.
  - **Burnout Invariant:** Stored OTP records self-destruct after 5 consecutive failed verification attempts.
  - **Sliding-Window Verification Limiter:** `POST /api/auth/verify-otp` enforces a sliding-window rate limit of maximum 10 attempts per 5 minutes per IP and identifier.
  - **Restricted Test Suite Bypass:** The `x-test-suite: true` rate limit bypass header is strictly ignored when `NODE_ENV === 'production'`.
  - **Strict Production Secrets Enforcement:** Production boot immediately throws a fatal exception and aborts process execution if `JWT_SECRET` or `ENCRYPTION_SECRET` is unset, uses default development placeholders, or is shorter than 32 characters. In-memory database fallback (`pg-mem`) is strictly forbidden in production.
  - **Reverse Proxy Trust (`trust proxy`):** Express configures `app.set('trust proxy', 1)` so that Caddy reverse-proxy client IP headers (`X-Forwarded-For`) are accurately attributed, preventing shared IP lockout bugs under rate limits.
  - **Comprehensive Multi-Tier Rate Limiting (`express-rate-limit`):** All endpoints are protected by memory-safe, auto-pruning rate limiters: global API (180 req/min), OTP requests (6 per 15 min), OTP verification (12 per 5 min), comment submissions (15 per 5 min), and guestbook signatures (10 per 5 min).
  - **Filesystem Boundary Shields & Path Traversal Prevention:** `processBase64Image` resolves upload paths strictly within the `public/uploads` directory boundary. User-configured `deploy_path` strictly enforces an alphanumeric/hyphen/underscore whitelist (`^[a-zA-Z0-9_-]{0,50}$`), preventing directory breakout during static builds and remote Neocities uploads.
  - **Universal URL Protocol Whitelisting (Stored XSS Elimination):** User-supplied website links (`site_url` in profile and settings, `visitorWebsite` in guestbooks, `c.siteUrl` in comment streams) are validated against strict `^https?://` whitelists on both backend endpoints and template/client rendering. Potentially malicious schemes (`javascript:`, `data:`, `vbscript:`) are rejected.
  - **Database Connection Caps & Statement Timeouts:** The PostgreSQL pool configures `max: 10`, `idleTimeoutMillis: 30000`, and `statement_timeout: 5000` (5-second hard cap), guaranteeing runaway or unindexed queries cannot deadlock database connections.
  - **WebSocket DoS Guard:** The `/ws/chat` server sets `maxPayload: 64 * 1024` (64KB frame ceiling), preventing giant frame floods and memory exhaustion.
  - **Process Crash Traps & Liveness Monitoring:** `server/index.ts` attaches `uncaughtException` and `unhandledRejection` traps to trigger clean restarts under process supervisors. `Dockerfile` defines a Docker `HEALTHCHECK` probing `/api/health`, and `docker-compose.yml` allocates a 700MB container memory ceiling.
- **Production Container Hardening (Non-Root Execution):**
  - The production `Dockerfile` runs as non-root user `node` (UID 1000) with `/app` and subdirectories recursively owned by `node:node`, preventing container breakout.

### 4.22 Zero-Retention Self-Hosted Social Layer (Comments & Guestbook JSON)
- **Self-Hosted Storage on Static Host (0 MB Server Retention):**
  - Comments are stored in self-hosted JSON files directly alongside each photo on the user's connected static host (`uploads/images/<fileId>.comments.json`).
  - Visitor guestbook entries are stored in self-hosted JSON files under `data/guestbook.json`.
  - The Neogram server acts as a **stateless broker/dispatcher**: when an authenticated visitor submits a comment or signature, Neogram validates their JWT, reads the remote JSON from the host, appends the entry, and pushes the updated file directly to Neocities (or Nekoweb) via API. PostgreSQL retains 0 bytes of comments or guestbooks.
  - Concurrency and race conditions are eliminated using an in-memory sequential file lock (`withFileLock`).
- **Neogram Cyber-Pass Handshake (`/auth/connect`):**
  - Cross-domain static photo pages require a verified Neogram identity to prevent anonymous bot spam.
  - Clicking `[⚡ Connect Cyber-Pass]` triggers a lightweight 1-click popup handshake with `neogram.net/auth/connect`, transmitting `{ token, handle, uin }` back via `window.postMessage` and caching to the site's `localStorage.getItem('neogram_pass')`.
  - Token stays valid for 90 days across all photos and guestbooks under that creator's origin without re-prompting.
- **WebExtension Auto-Authentication Bridge:**
  - The Neogram WebExtension includes a content script (`extension/content/auth-bridge.js`) matching `*.neocities.org` and `*.nekoweb.org`.
  - When a user with the extension installed loads any Neogram static gallery, the content script automatically broadcasts their active session pass to the page with 0 clicks.
- **Same-Origin Static Hydration:**
  - On static photo detail pages, client-side JS performs a same-origin fetch of `./uploads/images/<fileId>.comments.json` on page mount, reconciling and appending any fresh comments without waiting for an 11ty redeploy.
- **Owner Content Editing & Moderation:**
  - In the Neogram Workstation, creators can view and moderate comments directly on each post card via `COMMENTS_MODERATOR.EXE`. Clicking purge sends `DELETE /api/posts/:postId/comments/:commentId`, which removes the entry from the remote JSON file on Neocities and saves the updated ledger.
- **Like Deduping:**
  - Likes are tracked in client-side storage (`localStorage.getItem('neogram_liked_' + postId)`), toggling active state and preventing duplicate increment requests from the same visitor browser.

### 4.23 Public Station Cyber-Profiles & Comment Author Linking
- **Polymorphic Profile Routing (`/user/:identifier`):**
  - Serves an authentic 90s cyber-identity profile page (`views/user.njk`) resolving any of three user identifier formats:
    1. **UUID:** `https://neogram.club/user/4587aa36-b626-4ebb-b6f1-1e9fbd11259f`
    2. **Handle / Callsign:** `https://neogram.club/user/wasson` or `https://neogram.club/user/@wasson`
    3. **Immutable Node UIN:** `https://neogram.club/user/100102`
- **Clean Root Website Derivation:**
  - Extracts the root personal homepage on file using `new URL(siteUrl).origin`, cleanly stripping any configured subdirectories (`/neogram/`, `/photos/`).
- **Profile Telemetry & Broadcast State:**
  - Features profile avatar (128x128 WebP or default green CRT monitor), real-time online status LED (`🟢 V.90` / `🟡 AWAY`), status broadcast message, member since date, photo tally, aggregate likes, and live dynamic SVG hit counter widget (`/counter/:uin.svg`).
  - Provides direct one-click buttons to:
    - `🌐 Visit Personal Website: <origin> ↗` (opens the user's primary static homepage)
    - `📷 View Neogram Photo Gallery ↗` (opens their static photo gallery stream on Neocities)
    - `💬 Message Station via NIM ↗` (opens Neogram Instant Messenger to DM the creator)
  - Interactive Transmissions photo stream displaying all published photos, thumbnails, captions, like counts, and links to static photo pages.
- **Comment Author Linking & Timestamps:**
  - Comment records stored in self-hosted JSON include the commenter's `userId` and clean `siteUrl`.
  - Static photo pages (`eleventy/src/photo.njk`) and the workstation comment moderator render author handles as clickable links to `/user/:identifier`, with an adjacent `🌐` globe button opening their root personal website when available.
  - Formatted comment timestamps display both localized date and time (e.g. `Oct 23, 2026, 9:26 PM`).
  - Reaction controls are streamlined to a single `❤️ LIKE` button (removing unused `Radical` and `Bookmark` options).

### 4.24 Cyberspace User Directory & Presence Categorization (`/directory` & `/api/directory`)
- **Cyberspace Station White-Pages Routing (`/directory` & `/users`):**
  - Serves an authentic retro 90s station node directory (`views/directory.njk`) cataloging all registered Neogram station nodes.
  - Headless JSON API available at `/api/directory` and `/api/users` for programmatic consumers, widgets, and browser extensions.
- **Strict Sub-Category Ordering Specification:**
  - All stations are categorized and displayed in exact hierarchical order:
    1. **Active Stations (🟢):** Connected live to the `/ws/chat` WebSocket router with status `'online'`.
    2. **"Away" Stations (🟡):** Connected to WebSocket with status `'away'` OR disconnected users with database flag `is_away = true`.
    3. **Inactive Stations (⚪):** Standby stations currently offline and not marked away.
  - Within **each** sub-category, stations are deterministically ordered in alphabetical sequence by handle (`LOWER(handle) ASC`), with secondary sort by numeric UIN (`uin ASC`).
- **Station Node Card Deliverables:**
  - Every card features:
    - Small thumbnail avatar (`avatarPath` or default CRT SVG) with overlaid status LED dot.
    - User callsign/handle (`@handle`).
    - Immutable numeric Node UID (`UID: #uin`).
    - Station status broadcast message.
    - Public photo transmission count.
    - Clickable profile link to `/user/@handle`.
  - Direct topnav links for both authenticated workstations and logged-out public visitors, plus quick launcher in the user dropdown menu and guest hero section.

### 4.25 Cyberspace Documentation Center & Embed Manual (`/docs` & `docs/`)
- **Dual-Layer Documentation System:**
  - **Interactive Manual & Embed Guide (`views/docs.njk` & `server/routes/docs.ts`):** Serves a comprehensive retro documentation center covering Neocities setup, dynamic hit counters, guestbooks, Sharp image processing pipeline, semantic BEM theming, and NIM chat integration. Topics accessible via direct shortcuts (e.g. `/docs/neocities`, `/docs/counter`, `/docs/guestbook`, `/docs/pipeline`, `/docs/theming`, `/docs/chat`) or query parameters (`/docs?topic=counter`).
  - **Repository Markdown Documentation (`docs/`):** Self-contained markdown guides in the project repository:
    - `docs/README.md`: Central documentation index and architectural overview.
    - `docs/neocities-setup.md`: Step-by-step setup guide for Neocities static hosting, API key encryption, and safe subdirectory publishing.
    - `docs/embeds.md`: Dynamic SVG hit counter styles, visitor guestbook ledger, headless JSONFeed 1.1, and client SDK widgets.
    - `docs/publishing-pipeline.md`: 25MB Multer streaming, Sharp EXIF auto-orientation, WebP compression, 11ty FIFO BuildQueue, and zero-retention local purge.
    - `docs/custom-styling.md`: Semantic BEM static deliverable contract, base specificity `(0, 1, 0)`, and custom CSS injection.
    - `docs/buddylist-chat.md`: NIM real-time chat, zero server retention, and WebExtension MV3 installation.
- **Dynamic Session-Aware Code Interpolation:**
  - Authenticated sessions automatically interpolate the user's live `@handle` and immutable `#uin` directly into embed code snippets for instant 1-click copying.
- **Topnav & Taskbar Integration:**
  - Directly accessible from top navigation (`Docs`), user account dropdown (`Documentation`), and bottom taskbar panel next to Terms and Privacy.

### 4.26 Cyberspace Friends Network & Static Follow Grid (`/friends` & static `/friends/`)
- **Friends Terminology & Concept:**
  - Replaces generic following with simple "Friends".
  - Reciprocal "Add Friend" action on station cyber-profiles (`/user/:identifier`) and static gallery index banners (`index.html`).
- **Neogram Workstation Friends Console (`views/friends.njk` & `/friends`):**
  - Authenticated top navigation button `[🤝 Friends]` linking to `/friends`.
  - Friends Roster (`FRIENDS_ROSTER.SYS`): Cards displaying followed friends with avatar, active/away/offline status LED, call-sign `@handle`, node `#uin`, bio broadcast, root personal website link (`🌐`), and `[✕ Unfriend]` action.
  - Broadcast Feed (`BROADCAST_FEED.EXE`): Reverse-chronological photo stream of photographs published by followed friends, complete with CRT scanlines, filter shaders, tags, likes, and station links.
- **Friends API Endpoints & State Contracts:**
  - `POST /api/users/:identifier/follow`: Authenticated. Looks up target by handle, UIN, or UUID. Inserts record into `follows`. Enqueues follower static rebuild (`syncFollowerStaticSite`) into `buildQueue`. Dispatches real-time WebSocket buddy list refresh (`refreshUserBuddyList`) to both parties. Returns `{ ok: true, isFriend: true, message: "Station added to Friends network" }`.
  - `DELETE /api/users/:identifier/follow`: Authenticated. Removes `follows` record, queues follower static rebuild, refreshes buddy lists, and returns `{ ok: true, isFriend: false, message: "Station unfriended" }`.
  - `GET /api/users/:identifier/friend-status`: Dual-mode (authenticated or public). Evaluates `isFriend` and `isSelf` for the calling session, plus aggregate `followersCount` and `followingCount`.
  - `GET /api/friends`: Authenticated JSON endpoint returning followed friends roster and their chronological posts `{ ok: true, friends, posts }`.
  - `GET /friends`: Authenticated workstation UI rendering `views/friends.njk`.
- **Static Friends Gallery Grid (`eleventy/src/friends.njk` -> `/friends/index.html`):**
  - Generated inside the user's isolated static directory (`dist/static-galleries/<userId>/friends/index.html`).
  - Adheres strictly to the safe subdirectory invariant (e.g. `https://<user>.neocities.org/neogram/friends/`).
  - Top navigation bar on static sites provides 1-click switching between `[🏠 Gallery Grid]` and `[👥 Friends Grid]`.
  - Dynamic template data: `eleventy/src/_data/friendsPosts.json` is synthesized per-tenant during `executeStaticBuild()`.
  - **Cross-Domain Image Resolution Invariant:** In `executeStaticBuild()`, relative media paths (`/uploads/images/...` and `/uploads/thumbs/...`) of friends are dynamically resolved to absolute remote URLs (`https://<friend>.neocities.org/<deploy_path>/uploads/...` or `config.appUrl`), guaranteeing that third-party static host visitors never encounter broken 404 images.
- **Cascading Rebuild Queue on Follow, Unfollow, and Publication:**
  - When user A follows or unfollows user B, user A's static site is queued for rebuild and deployed to Neocities to update `/friends/index.html`.
  - When friend B broadcasts (`POST /api/posts`) or deletes (`DELETE /api/posts/:id`) a photograph, `triggerFollowersCascade(authorId)` queries all active followers (`SELECT follower_id FROM follows WHERE following_id = $1`) and sequentially enqueues each follower into `buildQueue` (`CascadeFollower:<followerId>`).
  - **One-At-A-Time Concurrency Safety:** Because all jobs pass through the single-flight in-memory FIFO `buildQueue`, multi-user follower rebuilds run strictly sequentially. This prevents race conditions on shared template data files (`friendsPosts.json`, `posts.json`, `site.json`) and eliminates CPU exhaustion or Neocities API rate-limit spikes.
- **NIM (Neogram Instant Messenger) Prioritization:**
  - NIM buddy list categorizes confirmed friends at the top under `🤝 Friends (🟢 X Online / ⚪ Y Offline)`, followed by `🌐 Other Stations`.
  - Real-time buddy list refresh dispatched over WebSockets upon follow/unfollow events.

### 4.27 Cyber Notification Dispatcher & User Alert Protocols

Neogram features a centralized, real-time notification engine connecting social activity across personal static websites (Neocities, GitHub Pages, self-hosted sites) and the Neogram Workstation:

- **Configurable Event Matrix & Notification Types:**
  1. `nim`: Incoming Neogram Instant Messenger direct transmission (`notify_nim`).
  2. `follow`: Fellow creator added station to Cyberspace Friends network (`notify_follow`).
  3. `comment_own`: Visitor left a comment on one of the creator's photos (`notify_comment_own`).
  4. `comment_thread`: A photo thread the creator previously commented on received replies (`notify_comment_thread`).
  5. `guestbook`: A visitor signed the creator's station guestbook (`notify_guestbook`).
  6. `like`: Visitor reacted to/liked a published photo (`notify_like`).
  7. `friend_post`: A followed Cyberspace Friend broadcast a new photograph (`notify_friend_post`).
  8. `deploy`: Background static build and Neocities deployment succeeded or failed (`notify_deploy`).

- **User Preferences Dashboard (`[:> NOTIFICATION_DISPATCHER.CFG]`):**
  - Configurable in the authenticated Workstation Settings tab (`#settings`).
  - Provides independent toggle switches for each of the 8 event categories, allowing creators to silence noisy event types while keeping high-priority events active.
  - Controls hardware alert channels:
    - **8-Bit Audio Chimes (`sound_enabled`):** Web Audio API dual-pitch alert tones (`playAlertBeep(880, 0.1)`) synthesized client-side on incoming events.
    - **Native Desktop & PWA Push (`desktop_push`):** Browser `Notification` API with Service Worker fallback for operating system / mobile push alerts when running as an installed PWA.
  - Endpoints: `GET /api/settings/notifications` and `PUT /api/settings/notifications`. Default preferences are automatically provisioned on first fetch.

- **Dual-Channel Delivery Pipeline (WebSockets + Inbox Persistence):**
  - When an event occurs, `dispatchNotification()` first queries the recipient's `notification_preferences`.
  - If the creator disabled that event category, the notification is cleanly suppressed (returns `null`), recording 0 database rows and emitting 0 socket packets.
  - If enabled, the notification is inserted into the `notifications` table (`is_read = FALSE`).
  - **Live WebSocket Dispatch:** If the recipient station is connected to `/ws/chat`, the server immediately routes a real-time `{ type: 'notification', notification: { ... } }` packet over their active socket.
  - The client UI intercepts the packet, increments the unread counter badge (`#navNotifyBadge`), plays the 8-bit chime (if enabled), triggers OS desktop push (if enabled), and prepends the item to the notification dropdown ledger (`#notifyDropdownList`).

- **Workstation Header Notification Center (`[:> NOTIFY_CENTER.SYS]`):**
  - Fixed top navigation bar hosts a dedicated notification bell button (`#notifyMenuBtn`) displaying a high-contrast phosphor badge (`#navNotifyBadge`).
  - Clicking toggles the retro dropdown drawer (`#notifyDropdownMenu`) featuring quick actions:
    - Reverse-chronological list of recent alerts with icon, title, body, and relative timestamp.
    - Click-to-navigate action directing creators straight to the relevant photo, friend profile, or guestbook.
    - `[✓ Mark All Read]` trigger (`POST /api/notifications/read-all`).
    - Individual item read tracking (`POST /api/notifications/:id/read`).

- **Zero-Retention Chat Privacy Invariant:**
  - For NIM direct messages, notification records strictly persist sender metadata (e.g. `title: "New NIM Transmission"`, `body: "@handle sent you a transmission"`).
  - The message body text is **never stored in PostgreSQL**, fully preserving the 0-byte server chat retention invariant.

### 4.28 Multi-Site Architecture & Target Routing (1 User : N Sites)

Neogram fully decouples creator user identity (immutable numeric ICQ `#uin` and `@handle`) from static site deployments:

- **Account Identity vs. Static Host Target Decoupling:**
  - Authenticated creators maintain a single user record with an immutable numeric UIN (`users.uin`) and `@handle`.
  - A user can provision N independent static site targets (`sites` table), each with its own name, unique slug (`/counter/:uin/:slug.svg`), target provider (`neocities`, `nekoweb`, `github`, `sftp`), encrypted deployment credentials, deploy subfolder (`deploy_path`), and styling.
- **Active Workstation Target (`neogram_active_site`):**
  - The workstation tracks the currently mounted site target via the `neogram_active_site` cookie.
  - The top navigation bar features a prominent target switcher dropdown (`#retroSiteMenu`) allowing instant 1-click swapping between sites without re-authenticating.
  - Dashboard panels (Studio upload, gallery filters, settings vault, and embed snippets) automatically synchronize to the active site target.
- **Per-Site Widget Anchoring:**
  - **Dynamic SVG Hit Counters:** Resolved via `/counter/:identifier/:slug.svg` (or default `/counter/:identifier.svg`). Hit tracking is isolated per `site_id` in `web_counters`.
  - **Guestbook Ledgers:** Resolved via `/embed/guestbook/:identifier/:slug` and `/api/guestbook/:identifier/:slug`. Signatures append to the specific site's self-hosted `data/guestbook.json` and are mirrored with `site_id` in PostgreSQL.
  - **Headless JSON Feeds:** Resolved via `/api/users/:identifier/feed.json?siteSlug=<slug>` or `?siteId=<id>`.
- **Isolated Static Multi-Tenant Generation:**
  - The static build pipeline compiles galleries isolated by `siteId` (`dist/static-galleries/<siteId>/`).
  - Deployments push directly to the target host matching the specific site's credentials and deploy path.

---

### 4.29 Consolidated Route & REST API Architecture Matrix

The following matrix documents all server routes, auth requirements, and functional behaviors in the Neogram monolith:

| Domain | Method | Route | Auth / Headers | Purpose / Response |
|---|---|---|---|---|
| **Workstation UI** | `GET` | `/` | Cookie (Optional) | Workstation dashboard (Studio, Archive, Config, Embeds). If logged out, displays cyber login hero. |
| **Workstation UI** | `GET` | `/friends` | Session Cookie | Authenticated Friends console: friends roster (`FRIENDS_ROSTER.SYS`) and friends photo stream (`BROADCAST_FEED.EXE`). |
| **Workstation UI** | `GET` | `/directory` | None (Public) | Cyberspace white-pages directory (`views/directory.njk`) with Active, Away, and Inactive categorization. |
| **Workstation UI** | `GET` | `/user/:identifier` | None (Public) | Public station profile (`views/user.njk`) resolving UUID, `@handle`, or `#uin` with bio, hit counter, photo stream, and Add Friend toggle. |
| **Workstation UI** | `GET` | `/docs` / `/docs/:topic` | None (Public) | Cyberspace Documentation Center & Interactive Embed Manual (`views/docs.njk`) with session credential interpolation. |
| **Workstation UI** | `GET` | `/auth/connect` | Session Cookie | 1-click Cyber-Pass handshake popup for static site visitor authentication (`window.postMessage`). |
| **Workstation UI** | `GET` | `/terms`, `/privacy` | None (Public) | TCPA/CTIA carrier compliance disclosures and mobile information non-disclosure legal documents. |
| **Workstation UI** | `GET` | `/offline.html` | None (Public) | Retro 90s offline fallback shell with 300-baud modem telemetry. |
| **Authentication** | `POST` | `/api/auth/request-otp` | IP Rate Limited | Generates 6-digit numeric OTP; dispatches via Resend (email), Twilio (SMS), or console fallback (dev). Max 4 req / 15 min. |
| **Authentication** | `POST` | `/api/auth/verify-otp` | IP Rate Limited | Verifies OTP, auto-provisions station UIN if new, sets `neogram_session` cookie, and returns `{ success, token, user }`. |
| **Authentication** | `GET` | `/api/auth/magic-login` | Query `?token=` | One-click magic URL authentication link. Sets cookie and redirects to `/`. |
| **Authentication** | `GET` | `/api/auth/logout` | None | Clears `neogram_session` cookie and redirects to `/`. |
| **Site Targets** | `GET` | `/api/sites` | Bearer / Cookie | Retrieves all mounted static site targets for authenticated creator. |
| **Site Targets** | `POST` | `/api/sites` | Bearer / Cookie | Provisions a new static site target (`name`, `slug`, `siteUrl`, `deploymentType`, `deployPath`, `apiKey`, `autoDeploy`, `buildHtml`, `customCssUrl`). |
| **Site Targets** | `GET` | `/api/sites/:id` | Bearer / Cookie | Retrieves single site configuration (or `default` primary site). |
| **Site Targets** | `PUT` | `/api/sites/:id` | Bearer / Cookie | Updates site target credentials, deploy path, auto-deploy, custom CSS, or slug. |
| **Site Targets** | `DELETE` | `/api/sites/:id` | Bearer / Cookie | Unmounts and cascades site, cleans static cache. Refuses deletion if it's the station's only site. |
| **Site Targets** | `POST` | `/api/sites/:id/deploy` | Bearer / Cookie | Triggers isolated static build and direct deployment to the target host. |
| **Site Targets** | `POST` | `/api/sites/:id/default` | Bearer / Cookie | Designates site target as the primary station default. |
| **Site Targets** | `POST` | `/api/sites/:id/switch` | Bearer / Cookie | Switches active workstation session target (`neogram_active_site` cookie). |
| **Posts & Media** | `POST` | `/api/posts` | Bearer / Cookie | 25MB Multer upload. Sharp processes WebP full (1200px) & thumb (400px). Accepts target `siteId`. Enqueues 11ty static build and triggers cascading follower rebuilds. |
| **Posts & Media** | `PUT` | `/api/posts/:id` | Bearer / Cookie | Updates caption, mood, webring, location, and filter. Triggers 11ty rebuild and auto-deploy. |
| **Posts & Media** | `DELETE` | `/api/posts/:id` | Bearer / Cookie | Purges post from PostgreSQL, deletes remote image on Neocities (`deploy_path` safe), triggers cascading follower rebuilds. |
| **Posts & Media** | `POST` | `/api/build-static` | Bearer / Cookie | Manual trigger for 11ty compilation and live Neocities deployment via `buildQueue`. |
| **Comments & Likes** | `POST` | `/api/posts/:id/comments` | Cyber-Pass JWT | Stateless comment submission. Validates JWT, acquires file lock (`withFileLock`), appends to remote `<fileId>.comments.json`, pushes to host. Dispatches notifications to photo author and thread participants. |
| **Comments & Likes** | `GET` | `/api/posts/:id/comments` | None (CORS: *) | Reads remote comment JSON ledger for given photo. |
| **Comments & Likes** | `DELETE` | `/api/posts/:postId/comments/:commentId` | Post Owner | Purges comment from remote self-hosted JSON ledger and saves updated file. |
| **Comments & Likes** | `POST` | `/api/posts/:id/like` | None (CORS: *) | Increments post like counter in PostgreSQL. Deduplicated client-side. Dispatches author like notification. |
| **Friends Network** | `POST` | `/api/users/:identifier/follow` | Bearer / Cookie | Adds target user as Friend. Enqueues follower static rebuild to update `/friends/index.html`, pushes real-time NIM refresh, and dispatches follow notification. |
| **Friends Network** | `DELETE` | `/api/users/:identifier/follow` | Bearer / Cookie | Unfriends target user. Enqueues follower static rebuild and pushes real-time NIM refresh. |
| **Friends Network** | `GET` | `/api/users/:identifier/friend-status` | None (CORS: *) | Checks `isFriend` and `isSelf` state for active caller, plus `followersCount` and `followingCount`. |
| **Friends Network** | `GET` | `/api/friends` | Bearer / Cookie | Returns JSON list of followed friends and chronological photos stream. |
| **Directory & Profiles**| `GET` | `/api/directory`, `/api/users` | None (CORS: *) | Headless directory JSON categorized by presence: Active (🟢), Away (🟡), Inactive (⚪). Alphabetical sequence by handle. |
| **Notifications** | `GET` | `/api/notifications` | Bearer / Cookie | Returns user's notifications inbox (`notifications`) and total unread counter (`unreadCount`). |
| **Notifications** | `POST` | `/api/notifications/:id/read` | Bearer / Cookie | Marks single notification as read (`is_read = TRUE`). |
| **Notifications** | `POST` | `/api/notifications/read-all` | Bearer / Cookie | Marks all notifications for active user as read. |
| **Notifications** | `GET` | `/api/settings/notifications` | Bearer / Cookie | Returns user's notification preferences (all 8 event toggles + audio chime & desktop push booleans). |
| **Notifications** | `PUT` | `/api/settings/notifications` | Bearer / Cookie | Updates user's notification preferences in PostgreSQL. |
| **Settings & Profile** | `GET` | `/api/settings` | Bearer / Cookie | Returns station config: `handle`, `uin`, `siteUrl`, `deployPath`, `autoDeploy`, `hasApiKey`, `sitename`, `remoteViews`, `customCssUrl`. |
| **Settings & Profile** | `PUT` | `/api/settings` | Bearer / Cookie | Updates site URL, deployment subfolder (`deploy_path`), Neocities API key (AES-256-GCM encrypted), auto-deploy, custom CSS URL. |
| **Settings & Profile** | `PUT` | `/api/settings/profile` | Bearer / Cookie | Updates handle and processes custom 128x128 WebP avatar via Sharp `.rotate().resize(128, 128)`. |
| **Settings & Profile** | `GET` | `/api/settings/export-archive` | Bearer / Cookie | Data sovereignty export: packages posts, captions, comments, guestbook, followers, and counters into a JSON attachment. |
| **Settings & Profile** | `DELETE`| `/api/settings/account` | Bearer / Cookie | GDPR account deletion: wipes PostgreSQL records, removes static cache, and clears session cookie. |
| **Widgets & Embeds** | `GET` | `/counter/:identifier.svg`, `/counter/:identifier/:slug.svg` | None (CORS: *) | Generates dynamic SVG web hit counter (Green LED, Red Nixie, Odometer, VFD). Resolves by `@handle` or `#uin`, and optional site slug. |
| **Widgets & Embeds** | `GET` | `/api/users/:handle/feed.json` | None (CORS: *) | JSONFeed 1.1 compliant feed of creator's published photos (supports `?siteSlug=` or `?siteId=`). |
| **Widgets & Embeds** | `GET` | `/api/guestbook/:handle`, `/api/guestbook/:handle/:slug` | None (CORS: *) | Reads remote `data/guestbook.json` ledger for default or slug-specified site. |
| **Widgets & Embeds** | `POST` | `/api/guestbook/:handle`, `/api/guestbook/:handle/:slug` | IP Rate Limited | Stateless guestbook sign. Appends signature to remote `data/guestbook.json` with HTML escaping. Dispatches guestbook notification to station owner. |
| **Widgets & Embeds** | `GET` | `/embed/guestbook/:handle`, `/embed/guestbook/:handle/:slug` | None (Frame: *) | Retro iframe guestbook widget with visitor signature form and moderated entry list. |
| **Widgets & Embeds** | `GET` | `/embed/feed/:handle` | None (Frame: *) | Retro iframe photo stream embed card. |
| **Real-Time WebSockets**| `WS` | `/ws/chat` | JWT Cookie / Param | In-memory NIM chat router and notification carrier. CSWSH origin validation, presence tracking, store-and-forward queue, zero database retention. |

### 4.30 Inline Script HTML Delimiter Escaping Invariant (\x3c Encoding)
- **Root Cause & Critical Parser Invariant:** In server-rendered Nunjucks views (`views/*.njk`) and HTML layouts, the browser's HTML tokenizer evaluates tag delimiter tokens (e.g. `</script>`, `<script`, `<!--`, `<iframe`) **before** JavaScript syntax parsing occurs. If an unescaped tag sequence appears inside a JavaScript string literal within an inline `<script>` tag, the HTML parser terminates the `<script>` element prematurely.
- **Symptom Prevention:** Premature script closing causes trailing JavaScript code to spill onto the viewport as raw text, and turns snippet strings (e.g. `<iframe src="...">`) into actual DOM elements that load relative paths like `/' + iframeUrl + '/` as ghost 404 errors.
- **Strict Coding Standard:** Any HTML markup or tags constructed inside inline `<script>` blocks (such as embed code generators or iframe snippets) **MUST** escape all opening brackets using hexadecimal encoding (`\x3c`, e.g. `\x3cscript\x3e`, `\x3c/script\x3e`, `\x3ciframe\x3e`, `\x3c/iframe\x3e`, `\x3c!--`). Never output literal `<script` or `</script` strings within inline JavaScript.

---

## 5. Prototype Assets to Preserve & Port

When building the production backend and views, extract and reuse the following tested prototype assets:
- **Audio Synthesis Engine:** `src/utils/audio.ts` / `public/js/retroAudio.js` (Web Audio API sound generator for clicks, shutters, success chimes, and dial-up tones).
- **CSS Tokens & Design System:** `src/styles/` (`.pixel-box`, `.pixel-btn`, `.mac-pinstripes`, CRT scanline shaders, color tokens).
- **SVG Graphics & 88x31 Badges:** `src/utils/sampleData.ts` (Retro workstation SVGs, pixel art icons, badge definitions).
- **Embed Code Formats:** `embed/` (HTML snippets, iframe fallbacks, and CSS inclusion patterns).

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
12. **[x] Step 12: Production Hardening, ICQ UIN, Zero-Retention Pipeline & Safe Subdirectories**
    - ICQ-style immutable numeric User ID (`uin`) sequence starting at `100101` for permanent embed anchoring.
    - Dual-channel OTP dispatcher with Resend (email) and Twilio (SMS), plus console fallback.
    - Sliding window rate limiter on OTP requests (max 4 per 15 min).
    - Zero-retention media pipeline: ephemeral staging, direct Neocities upload, and immediate disk purge (`0 bytes` local storage).
    - Safe subdirectory publishing (`deploy_path`, default `'neogram'`) with strict non-destructive deletion safety invariant.
    - Production Dockerfile and docker-compose.yml for 1-click DigitalOcean deployment.
13. **[x] Step 13 (MVP Complete): Mobile UX Ergonomics, First-Run Wizard, Filter Swatches & Quick Sharing**
    - Responsive mobile bottom navigation bar (`.retro-mobile-nav`) on screens `< 768px` with 5 touch tabs (Studio, Archive, Config, Embeds, NIM).
    - Automatic collapse of desktop topnav and bottom BSD/X11 taskbar on mobile to eliminate viewport crowding.
    - Mobile NIM Instant Messenger drawer centered between header and bottom bar.
    - 3-step First-Run Station Setup Wizard (`[:> SETUP_WIZARD.EXE]`) preventing first-time upload roadblocks.
    - Tactile visual filter swatches with horizontal touch scrolling on mobile.
    - One-click `[ 🔗 View Live ↗ ]` and `[ 📋 Copy Link ]` on all archive post cards with instant `[ ✓ COPIED! ]` feedback.
14. **[x] Step 14: Production Droplet Deployment, SSL, Carrier Compliance & Automated CI/CD**
    - Provisioned Ubuntu 24.04 LTS DigitalOcean Droplet (`104.248.57.128`) with Docker 29 and a persistent 2GB swapfile.
    - Configured Caddy v2 reverse proxy with automated Let's Encrypt TLS v1.3 and HTTP/2 for `neogram.club` and `www.neogram.club`.
    - Integrated transactional auth: verified Resend domain for email OTP (`auth@neogram.club`) and configured Twilio for SMS OTP (`+16416364726`).
    - Implemented carrier-compliant `/terms` and `/privacy` pages with full CTIA/TCPA SMS program disclosures and mobile information non-disclosure clauses.
    - Configured automated GitHub Actions CI/CD pipeline (`.github/workflows/deploy.yml`) executing TypeScript lint checks, SSH remote git pull, Docker Compose recreation, and `/api/health` polling.
15. **[x] Step 15: Zero-Retention Self-Hosted Comments, Guestbooks, Cyber-Pass SSO & Extension Bridge**
    - Self-hosted comments storage in plain JSON files (`uploads/images/<fileId>.comments.json`) and guestbooks (`data/guestbook.json`) on the creator's static host (0 MB retention on Neogram host).
    - Stateless dispatching pipeline (`server/services/staticStorage.ts`) with concurrency mutex lock (`withFileLock`) uploading directly to Neocities (and Nekoweb ready).
    - Neogram Cyber-Pass 1-click pop-up handshake (`/auth/connect`) establishing cross-domain scoped JWTs in `localStorage` without third-party cookie dependencies.
    - Browser extension content script (`extension/content/auth-bridge.js`) automatically injecting active sessions across `*.neocities.org` and `*.nekoweb.org` with 0 clicks.
    - Same-origin comments hydration on static photo detail pages (`eleventy/src/photo.njk`), like deduping, and audio chimes.
    - In-workstation comment moderation dialog (`COMMENTS_MODERATOR.EXE`) in `views/index.njk` to review and purge comments directly from the self-hosted JSON.
16. **[x] Step 16: Public Station Cyber-Profiles (`/user/:id`), Comment Author Linking & Timestamping**
    - Public station profile route (`/user/:identifier`) resolving UUID, `@handle`, or `#uin` to retro cyber-identity view (`views/user.njk`).
    - Clean personal root website derivation (`new URL(siteUrl).origin`) stripping publishing subdirectories.
    - Station telemetry card with avatar, presence LED, bio broadcast, hit counter, photo transmissions gallery, and NIM messaging button.
    - Comment author linking to `/user/:identifier` and root website (`🌐`), formatted comment timestamps (date + time), and reaction controls streamlined to `❤️ LIKE`.
17. **[x] Step 17: Cyberspace User Directory & Presence Categorization (`/directory` & `/api/directory`)**
    - Public directory page (`views/directory.njk`) and JSON API (`server/routes/directory.ts`) cataloging all Neogram station nodes.
    - Presence-based sub-category hierarchy: Active first (🟢), then "Away" (🟡), then Inactive (⚪).
    - Deterministic alphabetical order by handle and secondary numeric UIN sort inside each sub-category.
    - Station node cards with small avatar thumbnail, `@handle`, numeric `#uin`, status message, photo tally, and direct profile links.
    - Interactive client-side live search filter by `@handle` or `#UID` with match counters and Web Audio SFX.
    - Integrated reciprocal breadcrumbs, topnav buttons for authenticated and public visitors, and comprehensive automated QA smoke tests.
18. **[x] Step 18: Cyberspace Documentation Center & Embed Manual (`/docs`)**
    - Interactive manual (`views/docs.njk` & `docs/*.md`) covering Neocities setup, dynamic SVG hit counters, guestbook ledgers, Sharp processing pipeline, BEM theming, and NIM chat.
    - Direct topic filter routing with shortcuts (`/docs/:topic`), session-aware live code interpolation, and 75 automated QA smoke tests.
19. **[x] Step 19: Cyberspace Friends Network & Static Follow Grid (`/friends` & `/friends/`)**
    - Friends following engine with "Add Friend" action on profiles (`views/user.njk`) and static gallery banner (`index.html`).
    - Dedicated workstation Friends console (`views/friends.njk` & `/friends`) with buddy roster, unfriend controls, and chronological photo feed.
    - Static photo grid generated by Eleventy at `/friends/index.html` within user's safe deploy path with full URL image resolution.
    - FIFO BuildQueue follower cascading rebuilds upon photo publication/deletion, follower site sync on follow/unfollow, and NIM buddy list prioritization (Friends at top).
    - 89 automated end-to-end QA tests validating the entire lifecycle.

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

### 7.2 Docker Deployment (DigitalOcean / VPS)
```bash
# Build and run Neogram app and PostgreSQL container in the background
docker compose up -d --build

# View real-time logs
docker compose logs -f app
```

### 7.3 Extension Tooling & Packaging
```bash
# Sync latest compiled CSS and audio engine into extension/shared/
npm run extension:sync

# Sync assets and bundle extension into zip file for Chrome Web Store:
npm run extension:package
# Output: neogram-aim-extension.zip
```

### 7.4 Automated QA Smoke Testing
```bash
# Run end-to-end integration assertions against the live backend
npm test
```
- Executes 89 automated assertions across 15 telemetry suites in ~2.9s.
- Verifies: OTP request, auto-provisioning, sliding-window rate limiting, JWT cookies, cyber identity/avatars, Sharp WebP compression & thumbnails, multi-tenant isolated 11ty static compilation, SVG hit counters (handle and UIN), self-hosted comments & Cyber-Pass SSO, JSONFeed 1.1 headless feeds, Cyberspace User Directory & presence categorization (Active, Away, Inactive), Cyberspace Documentation & embed manual, Cyberspace Friends Network & static follow grid lifecycle, and safe post/user teardown.

### 7.5 Database Migrations & Seeding
Migrations run automatically on server start via `server/db/migrate.ts`.
Database connection resolves via `DATABASE_URL` in `.env`:
```bash
# Default development database:
DATABASE_URL=postgres://neogram:neogram_secret@localhost:5432/neogram_db
```

### 7.6 Required Environment Variables (`.env`)
```env
PORT=4000
NODE_ENV=development
APP_URL=http://localhost:4000

# PostgreSQL Database
DATABASE_URL=postgres://neogram:neogram_secret@localhost:5432/neogram

# Security Keys
JWT_SECRET=neogram_retro_super_secret_jwt_key_1996
ENCRYPTION_SECRET=neogram_retro_aes256_vault_key_1996_master_secret

# Transactional Auth Dispatches (Email & SMS)
# Resend Email Delivery (Free Tier: 3,000 emails/month at resend.com)
RESEND_API_KEY=
EMAIL_FROM="Neogram <auth@yourdomain.com>"

# Twilio SMS Delivery ($1.15/mo phone number + $0.0079/text at twilio.com)
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=+15551234567
```


