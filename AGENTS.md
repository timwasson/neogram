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
    uin INTEGER UNIQUE NOT NULL, -- ICQ-style immutable numeric ID (sequence starting at 100101)
    auth_token VARCHAR(255),
    auth_token_expires_at TIMESTAMPTZ,
    site_url VARCHAR(500),
    deploy_path VARCHAR(200) DEFAULT 'neogram', -- Safe target subfolder on static host (default: /neogram/)
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

### 4.1 Strict BEM Embed & Static Site Deliverable Contract

#### Dual Styling Strategy: Workstation Utilities vs. Static Deliverable BEM
- **Neogram Workstation App (`views/index.njk`):** Built for rapid internal UI assembly using custom zero-dependency utility classes (`flex`, `p-4`, `text-xs`, etc.) and retro components (`.pixel-box`, `.pixel-btn`).
- **Static Gallery Output (`eleventy/src/` delivered to Neocities):** Must **never** use ad-hoc utility classes. Static sites delivered to end users must use standard, semantic BEM classes (`.neogram-*`).
- **End-User Customization Rationale:** Static site owners (Neocities, GitHub Pages, self-hosted) need complete flexibility to attach custom stylesheets or `<style>` blocks and override elements without fighting utility class specificity or needing `!important`. All default styling is encapsulated in `src/styles/components/_static-gallery.scss` at base class specificity `(0, 1, 0)`.
- **Custom CSS Injection (`custom_css_url`):** `users.custom_css_url` is queried in `server/services/staticBuilder.ts`, passed to `site.json` as `site.customCssUrl`, and automatically linked in `eleventy/src/_includes/layouts/base.njk`.

#### 1. Static Gallery BEM Hierarchy (`eleventy/src/`)
| Block | Elements / Modifiers | Description |
|---|---|---|
| **`.neogram-site`** | `__taskbar`, `__branding`, `__logo`, `__title`, `__tag`, `__nav`, `__main`, `__footer`, `__footer-inner`, `__footer-info`, `__footer-host`, `__footer-url`, `__footer-sub`, `__footer-badges` | Overall site shell layout (`base.njk`) |
| **`.neogram-banner`** | `__header`, `__title`, `__status`, `__body`, `__info`, `__desc`, `__node`, `__actions` | Header info window card on gallery index |
| **`.neogram-grid`** | *(Container)* | Multi-column responsive CSS grid for photos |
| **`.neogram-card`** | `__header`, `__author`, `__shader`, `__media`, `__image`, `__overlay`, `__overlay-btn`, `__body`, `__content`, `__meta`, `__location`, `__date`, `__caption`, `__tags`, `__footer`, `__likes` | Individual photo window card (`index.njk`) |
| **`.neogram-detail`** | `__header`, `__title`, `__status`, `__status-shader`, `__status-sub`, `__body`, `__layout`, `__media-col`, `__viewport`, `__image`, `__tags`, `__info-col`, `__author-box`, `__author-meta`, `__author-handle`, `__author-date`, `__caption`, `__reactions` | Detail photo page (`photos/<id>/index.html`) |
| **`.neogram-comments`** | `__header`, `__title`, `__status`, `__ledger`, `__empty`, `__item`, `__item-header`, `__item-author`, `__item-time`, `__item-body`, `__form`, `__form-row`, `__input`, `__submit` | Live comments ledger & form (`photo.njk`) |
| **`.neogram-btn`** | `--sm`, `--lg`, `--primary`, `--yellow`, `--accent`, `--cyan`, `--success`, `--green`, `--danger`, `--red` | Reusable retro push button (`(0, 1, 0)` specificity) |
| **`.neogram-badge`** | `--cyan`, `--magenta`, `--amber`, `--green` | 88x31 / micro status pills |
| **`.neogram-empty`** | `__icon`, `__title`, `__desc`, `__action` | Empty photo stream state |

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
   - **Cross-Tenant Template Cache Isolation:** Eleventy v3 caches compiled template functions in-memory by default. In multi-tenant environments with varying `deploy_path` values (e.g. `/neogram/` vs. `/photos/`), cached template functions would reuse another tenant's prefix. The Eleventy config explicitly sets `eleventyConfig.setUseTemplateCache(false)` to prevent template function bleeding across builds.
   - **Embed Asset Passthrough:** Guarantees that `embed/` stylesheets and scripts are copied into each tenant's static distribution directory (`dist/static-galleries/<userId>/embed/`).
   - **Direct Static Focus (No `/preview/` Bloat):** The redundant `/preview/` and `/photos/<id>/` preview routes have been removed in favor of clean static deployments directly to Neocities and embeddable widgets.
   - Generates responsive gallery grid (`index.html`) and paginated photo pages (`photos/<id>/index.html`).
   - Copies stylesheets (`css/neogram.css`), uploads, and embed scripts into the user's static bundle.
5. **Deployment Adapter (`server/services/neocitiesPublisher.ts`):**
   - Reads decrypted Neocities API key and pushes multipart archive directly to `POST https://neocities.org/api/upload` from the user's isolated directory (`dist/static-galleries/<userId>/`).
   - Probes remote site views and hits via `https://neocities.org/api/info`.
   - Optional automatic deployment on post creation, edit, or deletion (`users.auto_deploy`).
   - The manual rebuild endpoint (`POST /api/build-static`) automatically triggers `deployToNeocities(...)` when credentials exist.
6. Centralized social layer: Visitors to static sites react and comment; comments post back to `/api/posts/:id/comments` and trigger an automated background 11ty rebuild in the queue.

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

### 4.17 First-Run Station Onboarding Setup Wizard
- **Guided Station Initialization (`[:> SETUP_WIZARD.EXE]`):** When a user logs in without a linked Neocities API key (`currentUser.hasApiKey == false`), the Upload Studio displays a 3-step retro checklist:
  1. `[✓] STEP 1:` Station Identity provisioned (`@handle` and immutable `#UIN`).
  2. `[●] STEP 2:` Connect remote Neocities API Key in Settings (`[ ⚙️ Connect in Settings :> ]`).
  3. `[○] STEP 3:` Snap first photo and transmit to static host.
- **Error Elimination:** Prevents 100% of first-run failed upload errors caused by creators attempting to transmit before linking credentials.

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
  - **Production Secrets Enforcement:** Production boot logs warnings if fallback development secrets are detected for `JWT_SECRET` or `ENCRYPTION_SECRET`.
- **API Resource Protection & Multi-Tenant Data Isolation:**
  - **Multi-Tenant Archive Isolation:** The authenticated workstation archive (`GET /`) queries posts filtered strictly by `currentUser.id`.
  - **Static Builder Protection:** `POST /api/build-static` requires an active authenticated session to prevent unauthenticated CPU/disk resource exhaustion.
  - **Public Form Bounds & Throttling:** Comments (`POST /api/posts/:id/comments`) allow max 10 submissions per 5 min per IP (author $\le$ 50 chars, body $\le$ 1000 chars); guestbook submissions allow max 6 submissions per 5 min per IP.
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
- Executes 50 automated assertions in ~2.3s.
- Verifies: OTP request, auto-provisioning, rate limiting, JWT cookies, profile identity, Sharp WebP compression, isolated 11ty static build, SVG counters, self-hosted comments & Cyber-Pass handshake, JSONFeed 1.1, and safe teardown.

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


