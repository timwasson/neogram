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
| **Backend Runtime** | **Node.js (Express)** | API-first architecture, async queue handling, pipeline integration |
| **Database** | **PostgreSQL** (Docker / Managed) | Relational integrity for users, posts, comments, follows, guestbook, counters |
| **Image Processing** | **Sharp** | High-performance image resizing, compression, thumbnailing, WebP conversion |
| **Server Templating** | **Nunjucks** (or Twig for Node) | Fast, secure server-rendered dashboard & embed markup templates |
| **Styling & Design System** | **Custom Vanilla CSS (NO TAILWIND)** | Custom retro CSS framework (`public/css/neogram.css`), CSS variables, BEM components (`pixel-box`, `pixel-btn`, `retro-alert`, `baud-progress-bar`), and custom utility classes. **Tailwind CSS is strictly prohibited.** |
| **Static Deploy Pipeline** | **Neocities API / GitHub API / SFTP** | Automated pushes of generated HTML/media to the user's static host |
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

### 4.3 Static Publishing Pipeline
1. PWA uploads image payload and post metadata.
2. Server validates session and processes image via `sharp` (scale to max 1200px, create 400px thumbnail, optimize to WebP/JPEG).
3. Server generates or updates the static feed bundle (e.g., `feed.json` or `feed.html`).
4. Server uses the configured deployment adapter:
   - **NeocitiesAdapter:** Uploads file buffers via `POST https://neocities.org/api/upload`.
   - **GitHubAdapter:** Commits files via GitHub Octokit / Contents API.
   - **SftpAdapter:** Connects via `ssh2-sftp-client` and puts files in the designated directory.
5. Server records post in PostgreSQL for the central social layer (comments, likes).

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
- **Audio Synthesis Engine:** [src/utils/audio.ts](file:///Users/timwasson/antigravity/Neogram---90s-Retro-Social-Publishing/src/utils/audio.ts) (Web Audio API sound generator for clicks, shutters, success chimes, and dial-up tones).
- **CSS Tokens & Design System:** [src/index.css](file:///Users/timwasson/antigravity/Neogram---90s-Retro-Social-Publishing/src/index.css) (`.pixel-box`, `.pixel-btn`, `.mac-pinstripes`, CRT scanline shaders, color tokens).
- **SVG Graphics & 88x31 Badges:** [src/utils/sampleData.ts](file:///Users/timwasson/antigravity/Neogram---90s-Retro-Social-Publishing/src/utils/sampleData.ts) (Retro workstation SVGs, pixel art icons, badge definitions).
- **Embed Code Formats:** [src/components/EmbedModal.tsx](file:///Users/timwasson/antigravity/Neogram---90s-Retro-Social-Publishing/src/components/EmbedModal.tsx) (HTML snippets, iframe fallbacks, and CSS inclusion patterns).

---

## 6. Migration Roadmap

1. **Step 1: Project Structuring & Backend Foundation**
   - Establish server directory (`server/` or root workspace restructuring) with Express, TypeScript/ESM, environment configuration, and Docker Compose for PostgreSQL.
   - Set up database migrations and connection pool.
2. **Step 2: Authentication & User Accounts**
   - Passwordless magic link / OTP flow, JWT cookies, session validation middleware.
3. **Step 3: Asset Storage & Sharp Processing Pipeline**
   - Multer upload handling, Sharp processing (resizing, WebP compression, thumbnails), local/cloud storage adapter.
4. **Step 4: Deployment Adapters (Static Publishing)**
   - Neocities API client, GitHub API client, and SFTP connector with encrypted credential storage.
5. **Step 5: Embeddable Widgets & Public API**
   - Vanilla JS embed script (`embed.js`), public REST endpoints for fetching post feeds, posting comments, signing guestbooks, and serving counter SVGs/images.
6. **Step 6: PWA Dashboard & Template Porting**
   - Server-rendered Nunjucks views and mobile-friendly PWA client leveraging the prototype's retro UI tokens and audio.
7. **Step 7: Retro Chat Browser Extension**
   - Manifest V3 browser extension for AIM/ICQ-style instant messaging.
