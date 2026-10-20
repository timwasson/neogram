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
| **Backend & Workstation Runtime** | **Node.js (Express)** on Port 4000 | Single-server decoupled monolith serving authenticated workstation, API, and static previews |
| **Database** | **PostgreSQL** (Docker / Native) | Relational integrity for users, posts, comments, follows, guestbook, counters |
| **Image Processing** | **Sharp** | High-performance image resizing (1200px), WebP compression, square thumbnailing (400px) |
| **Static Site Generator** | **Eleventy (11ty v3)** | Compiles static photo gallery (`dist/static-gallery`) using Nunjucks templates with live preview at `/preview/` |
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
    auth_token VARCHAR(255),
    auth_token_expires_at TIMESTAMPTZ,
    site_url VARCHAR(500),
    deployment_type VARCHAR(50) CHECK (deployment_type IN ('neocities', 'github', 'sftp', 'none')),
    deployment_credentials BYTEA, -- Encrypted credentials (AES-256-GCM)
    custom_css_url VARCHAR(500),
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
    mood VARCHAR(100),
    webring VARCHAR(100),
    location VARCHAR(200),
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

### 4.2 Credential Security
- Static hosting credentials (GitHub PATs, Neocities API keys, SFTP passwords) must be **encrypted at rest** using AES-256-GCM.
- Never return sensitive deployment credentials in client-facing API responses.
- Authentication must use passwordless magic link / 6-digit OTP codes with HTTP-only, SameSite cookies for JWT session management.

### 4.3 Static Publishing Pipeline (11ty + Neocities)
1. User uploads photo payload and post metadata in Neogram Creator Studio (`POST /api/posts`).
2. Server validates session and processes image via `sharp` (scale to max 1200px, create 400px thumbnail, optimize to WebP).
3. Server commits record to PostgreSQL `posts` table.
4. **11ty Static Site Generation (`server/services/staticBuilder.ts`):**
   - Reads all posts and comments from PostgreSQL into `eleventy/src/_data/posts.json`.
   - Compiles static photo gallery grid (`index.html`) and paginated dedicated photo pages (`photos/<id>/index.html`) into `dist/static-gallery/`.
   - Passes through pure Sass stylesheets (`css/neogram.css`), uploads, and embed scripts.
   - Serves immediate live preview at `/preview/` and `/photos/<id>/` on Port 4000.
5. **Deployment Adapter:**
   - **NeocitiesAdapter:** Pushes compiled `dist/static-gallery/` bundle directly to Neocities via `POST https://neocities.org/api/upload`.
   - **GitHubAdapter / SftpAdapter:** Fallback deployment targets.
6. Centralized social layer: Visitors to the static site react (like) and submit comments, which post back to `POST /api/posts/:id/comments` and trigger an automated background 11ty rebuild.

### 4.4 Styling Architecture: Pure Custom Utilities & BEM (Strictly NO Tailwind)
- **Tailwind CSS is prohibited:** Do not introduce Tailwind CLI, Tailwind directives, or Tailwind dependencies for views or embeds.
- **Custom Utility Library:** Styling is powered by a zero-dependency Vanilla CSS framework ([public/css/neogram.css](file:///Users/timwasson/antigravity/Neogram---90s-Retro-Social-Publishing/public/css/neogram.css)).
- **CSS Variables First:** Colors, surfaces, borders, and typography must resolve through `--bg-desktop`, `--surface-window`, `--surface-title`, `--text-main`, `--border-main`, `--accent-prompt`, `--accent-mac`, `--accent-amber`, and `--code-bg`.
- **Reusable Component Classes:** Buttons (`.pixel-btn`, `.pixel-btn--yellow`, `.pixel-btn--green`, etc.), boxes (`.pixel-box`, `.window-header`), alerts (`.retro-alert`, `.retro-alert--error`, `.retro-alert--success`, `.retro-alert--info`), and telemetry (`.baud-progress-bar`).
- **Standardized Utility Classes:** Layout (`flex`, `flex-col`, `flex-row`, `items-center`, `justify-between`, `gap-1` through `gap-4`), spacing (`p-*`, `m-*`), text (`text-xs`, `text-sm`, `font-mono`, `text-bold`, `text-center`), and widths (`w-full`, `max-w-*`).
- **No Inline Styles:** Template markup must avoid inline `style="..."` attributes; all layout, spacing, and colors must be composed using the utility library and component classes.

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
4. **[x] Step 4: 11ty Static Gallery Generator & In-App Preview**
   - `@11ty/eleventy` integration, Nunjucks templates in `eleventy/`, automated compilation to `dist/static-gallery`, live preview at `/preview/` and `/photos/<id>/`, real-time comment synchronization.
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
9. **[ ] Step 9 (Milestone 5B): Retro Chat Browser Extension**
   - Manifest V3 browser extension (Chrome/Firefox) with buddy list popup/sidebar connecting to the Neogram chat router.

