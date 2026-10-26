# 📟 Neogram: 90s Retro Social Publishing Engine

> A lightweight, privacy-first SaaS suite bridging mobile photo creation with 90s web nostalgia. Snap photos from your phone, apply vintage CRT and halftone shaders, and publish them directly to your personal static site (Neocities, Nekoweb, or self-hosted) with zero permanent media storage on the server.

---

## ⚡ Core Architecture

- **Backend & Workstation:** Node.js (Express) + TypeScript / ESM (Port 4000)
- **Database:** PostgreSQL (Docker or managed) with automated migrations
- **Image Processing:** Sharp (1200px max, 400px thumbnails, WebP compression, EXIF auto-rotation)
- **Static Site Engine:** Eleventy (11ty v3) with FIFO `BuildQueue` serialization & multi-tenant isolation (`dist/static-galleries/<userId>/`)
- **Static Publishers:** Direct REST API automated deploy adapters for both **Neocities** (`POST /api/upload`) and **Nekoweb** (`/files/big/create`, `/files/big/append`, `/files/import/:id`)
- **Design System:** Zero Tailwind. Pure Vanilla CSS compiled from Dart Sass (`public/css/neogram.css`). Dual-layer styling: workstation UI uses modular utility classes; static gallery output delivered to Neocities/Nekoweb uses strict BEM classes for 1-click end-user CSS overrides
- **Audio Engine:** Web Audio API synthesized 8-bit clicks, camera shutters, success chimes, and dial-up tones
- **Social & Widgets:** Dynamic SVG hit counters (`/counter/:handle.svg`), public station cyber-profiles (`/user/:id`), visitor guestbook, and JSONFeed 1.1 feeds
- **Friends & Static Follow Grid:** Dedicated workstation `/friends` page, static `/friends/` photo gallery grid on Neocities/Nekoweb, cascading follower rebuilds on post publication, and 1-click "Add Friend" on profiles and static site banners
- **User Directory & Presence:** Cyberspace white-pages directory (`/directory` & `/api/directory`) with presence categorization (Active, Away, Inactive), search filtering, and profile linking
- **Documentation Center:** Complete user guides and interactive embed manual (`/docs` & `docs/`) with step-by-step setup guides, sample embed codes for hit counters and guestbooks, and publishing pipeline deep-dives
- **Instant Messenger:** WebSockets (`/ws/chat`) with ephemeral offline queue, client-side retention, categorized online/offline Friends and Cyberspace Stations buddy list, and Manifest V3 browser extension
- **Cyber Notification Dispatcher:** Real-time multi-channel alerts (WebSockets, topnav notification drawer, 8-bit Web Audio chimes, and native desktop/PWA push) for DMs, follows, comments, replies, guestbook entries, likes, friend broadcasts, and deploy status with a user settings dashboard

---

## 🛡️ Key Safety & Privacy Invariants

1. **Zero Server Media Retention (0 MB):** Image uploads are processed into ephemeral staging, uploaded directly to the creator's remote static site (Neocities or Nekoweb), and immediately wiped from local disk upon confirmation. The Neogram server stores 0 bytes of user media.
2. **Safe Subdirectory Publishing:** By default, Neogram publishes to `/neogram/` (e.g. `https://<user>.neocities.org/neogram/` or `https://<user>.nekoweb.org/neogram/`). Existing homepages (`index.html`), personal blogs, or custom styling are **never modified or overwritten**.
3. **Non-Destructive Deletion Invariant:** Remote deletions to Neocities and Nekoweb are strictly restricted to `uploads/` matching the user's `deploy_path`. Non-Neogram files cannot be deleted.
4. **Permanent Node UIN (ICQ-Style):** Accounts receive an immutable numeric node ID (`users.uin`, sequence starting at `#100101`). Creators can freely edit their `@handle` without breaking third-party static site embeds or counters.
5. **Semantic BEM Static Deliverables & Custom CSS:** The Eleventy static site engine compiles galleries using pure BEM markup (`.neogram-*`) with zero inline utility classes. Static site owners can link custom stylesheets (`users.custom_css_url`) or inject custom CSS on Neocities to effortlessly override any component's look without fighting specificity or needing `!important`.
6. **Public Station Cyber-Identity (`/user/:id`):** Public station profiles resolve by UUID, `@handle`, or immutable `#uin`. Features avatar, live hit counter, status broadcast, photo stream, reciprocal "Add Friend" action, and clean links directly to the creator's root personal website without subdirectories.
7. **Cyberspace Station Directory & Presence Categorization (`/directory`):** Public station white-pages listing all registered nodes in hierarchical carrier order: Active transmitters first (🟢), then "Away" stations (🟡), then Inactive nodes (⚪). Each sub-category is strictly ordered alphabetically by handle, displaying handle, numeric UID (`#uin`), small thumbnail, and link to profile. Real-time client-side instant filtering enables rapid searching by `@handle` or `#UID`, with instant access from the top navigation bar and user account menu.
8. **Cyberspace Documentation Center & Interactive Manual (`/docs`):** Complete self-hosted guides and embed manual covering Neocities setup, dynamic SVG hit counters, guestbook ledgers, Sharp processing pipeline, and BEM theming. Interpolates active creator credentials and immutable numeric UINs directly into embed snippets for 1-click deployment.
9. **Friends Network & Static Follow Grid (`/friends` & static `/friends/`):** Connect with fellow creators using simple "Friends". View a creator's profile or static site banner to add them as a friend. Features a dedicated workstation `/friends` page to browse friends' photo feeds and manage connections, a static `/friends/` photo grid on your personal Neocities site, NIM buddy list prioritization (Friends at the top), and automatic cascading FIFO background rebuilds across all follower static sites whenever a friend broadcasts a new photograph.
10. **Configurable Cyber Notifications & Zero-Retention DM Alerts:** Complete user preferences dashboard (`[:> NOTIFICATION_DISPATCHER.CFG]`) in Workstation Settings to customize notifications across 8 event categories, synthesized 8-bit audio chimes, and browser desktop/PWA push. NIM direct message alerts strictly record sender handle metadata ("@handle sent you a transmission") without message text, preserving zero-retention chat privacy.
11. **Headless Self-Hosted API & Custom Frontend:** For creators who prefer to build a custom frontend from scratch using Vanilla JavaScript, React, Vue, or Svelte, Neogram includes an opt-out setting in the dashboard (`users.build_html`). When unchecked, Neogram suppresses 11ty HTML generation entirely—uploading only `feed.json`, `posts.json`, per-photo comments JSONs, and optimized media to your static host. Feeds include full creator profile data, published photo arrays, like counts, and interaction endpoints (`likeUrl`, `commentUrl`, `followUrl`).
12. **Hardened Cyberspace Cybersecurity Architecture:** Production-ready defense including strict production secrets verification (refusing startup on default keys), authenticated AES-256-GCM vault encryption for API keys, universal URL protocol whitelisting (Stored XSS elimination), filesystem boundary shields against path traversal, adaptive rate limiting via `express-rate-limit`, reverse-proxy trust (`trust proxy`), container health probes, 5-second database statement timeouts, and 64KB WebSocket DoS ceilings.
13. **Cold-Start Sandbox Publishing Mode:** Creators can immediately snap photos, apply retro filters, and publish directly to their public station profile (`/user/:handle`) without needing an external Neocities account or API key first. When ready, connecting Neocities in Settings deploys their gallery live to their personal static site.
14. **Mobile Cyber-Pass SSO Handshake:** Cross-domain 1-click authentication on static sites works flawlessly across desktop and mobile. Automatically handles mobile Safari popup restrictions via seamless return URL redirect and `#neogram_pass=` hash token ingestion.
15. **Indie Web Data Sovereignty & Station Decommissioning:** Download a complete, offline JSON archive of all posts, high-res photos, comments, guestbook signatures, and friend connections (`GET /api/settings/export-archive`), or permanently decommission and wipe all server records (`DELETE /api/settings/account`) with zero data lock-in.
16. **Multi-Site Architecture (1 User : N Sites):** Manage and publish to multiple independent static sites (Neocities, Nekoweb, GitHub Pages) from a single account without logging in or out. Each site target maintains its own API credentials, deploy folder, isolated photo stream, per-site SVG hit counter (`/counter/:uin/:slug.svg`), visitor guestbook (`/embed/guestbook/:handle/:slug`), and static feed (`/api/users/:handle/feed.json?siteSlug=...`). Instant target swapping is available directly from the desktop workstation topbar (`#retroSiteMenu`).
17. **Embeddable Static Site Chat & Pager Widget (`embed/pager.js`):** Embed an expandable retro chat window or floating pager dock on any static site. Visitors can message you with their Cyber-Pass or as an anonymous guest (`@guest_XXXX`). Transmissions route directly to your workstation NIM with live operator status (🟢 Online, 🟡 Away, ⚪ Offline) and 24-hour store-and-forward queueing with zero permanent server retention. Station owners can toggle anonymous chat acceptance or disable the widget anytime in Settings.

---

## ⚡ Headless API & Custom JavaScript Frontend

Want complete design freedom without Neogram's default retro Eleventy templates? Neogram can function as a headless static API.

### 1. Toggle Headless Mode in Dashboard
1. Open **Settings** on your Neogram workstation dashboard.
2. Under **DEPLOYMENT INTEGRATION**, uncheck **[ ] Generate Static HTML Pages**.
3. Click **💾 SAVE SETTINGS :>**.

Neogram will publish only `feed.json`, `posts.json`, and your WebP images to your Neocities account.

### 2. Available Self-Hosted Feeds on Your Site
- `https://<handle>.neocities.org/<deploy_path>/feed.json` (Master feed with profile, endpoints, and posts)
- `https://<handle>.neocities.org/<deploy_path>/posts.json` (Direct photo posts array)
- Relative path from your site: `./<deploy_path>/feed.json`

### 3. Build Your Own App with Vanilla JavaScript:
```html
<div id="app">
  <div id="profile"></div>
  <div id="gallery">Loading photos...</div>
</div>

<script>
async function loadCustomGallery() {
  const res = await fetch('./neogram/feed.json');
  const data = await res.json();

  // 1. Render Profile Header
  document.getElementById('profile').innerHTML = `
    <img src="${data.user.avatarUrl}" width="48" height="48" />
    <h2>@${data.user.handle} (#${data.user.uin})</h2>
    <p>${data.user.statusMessage || ''}</p>
    <button onclick="fetch('${data.endpoints.followUrl}', { method: 'POST' })">Follow</button>
  `;

  // 2. Render Photos Grid with Likes & Comments
  document.getElementById('gallery').innerHTML = data.posts.map(post => `
    <article style="border: 1px solid #ccc; margin: 12px 0; padding: 12px;">
      <img src="${post.thumbnailUrl}" alt="${post.caption}" style="max-width: 100%;" />
      <p>${post.caption}</p>
      <button onclick="fetch('${post.actions.likeUrl}', { method: 'POST' })">
        ⚡ ${post.likes} Likes
      </button>
      <div>Comments: ${(post.comments || []).length}</div>
    </article>
  `).join('');
}
loadCustomGallery();
</script>
```

## 🚀 Local Development Setup

### Prerequisites
- Node.js 20+
- PostgreSQL running locally (or via Docker)

### 1. Clone & Install Dependencies
```bash
git clone https://github.com/timwasson/neogram.git
cd neogram
npm install
```

### 2. Configure Environment (`.env`)
```bash
cp .env.example .env
```
Ensure `DATABASE_URL` points to your PostgreSQL instance:
```env
DATABASE_URL=postgres://neogram:neogram_secret@localhost:5432/neogram
JWT_SECRET=neogram_retro_super_secret_jwt_key_1996
ENCRYPTION_SECRET=neogram_retro_aes256_vault_key_1996_master_secret
```

### 3. Start Development Server
```bash
npm run dev
```
- Open `http://localhost:4000` in your browser.
- Sass watcher and Express server run concurrently.
- Migrations apply automatically on server boot.

### 4. Run Automated QA Smoke Test Suite
```bash
npm test
```
- Runs 219 automated end-to-end integration tests in ~2.5 seconds.
- Validates OTP dispatch, sliding rate limiting, session auth, multi-site target provisioning and 1-click switching, Sharp WebP compression, isolated 11ty static builds, dynamic SVG hit counters (handle, UIN, and per-site slug), self-hosted comments & Cyber-Pass handshake, per-site guestbook ledgers, JSONFeed 1.1, Cyberspace User Directory presence categorization & ordering, Cyberspace Documentation Center & embed snippets, Cyberspace Friends follow grid & cascading rebuilds, notification preferences & suppression, real-time WebSocket dispatches, and safe post purge.

---

## 🌐 Live Production Node

Neogram is deployed live and running at **[https://neogram.club](https://neogram.club)**.
- **Documentation Center & Embed Manual:** [https://neogram.club/docs](https://neogram.club/docs) (or repository [`docs/`](file:///Users/timwasson/antigravity/Neogram---90s-Retro-Social-Publishing/docs/README.md))
- **Terms of Service & SMS Program Terms:** [https://neogram.club/terms](https://neogram.club/terms)
- **Privacy Policy & SMS Disclosure:** [https://neogram.club/privacy](https://neogram.club/privacy)
- **Health Telemetry:** [https://neogram.club/api/health](https://neogram.club/api/health)

---

## 🌊 1-Click Production Deployment (DigitalOcean / VPS)

Neogram is fully containerized with Docker Compose. You can run it on a **$6–$12/month DigitalOcean Droplet** (Ubuntu 24.04 LTS).

### 1. On your Droplet:
```bash
# Add 2GB swap space (recommended for 1GB/2GB droplets)
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# Install Docker & Docker Compose
sudo apt update && sudo apt install -y docker.io docker-compose-v2 caddy

# Clone repository
git clone https://github.com/timwasson/neogram.git /opt/neogram
cd /opt/neogram
```

### 2. Configure `.env`:
```bash
cp .env.example .env
nano .env
```
Fill in your production secrets, domain, and optional transactional auth keys:
- `APP_URL=https://neogram.club`
- `RESEND_API_KEY=` (Free tier at resend.com for emails)
- `TWILIO_ACCOUNT_SID=` & `TWILIO_AUTH_TOKEN=` (Optional for SMS)

### 3. Launch with Docker Compose:
```bash
docker compose up -d --build
```
- Starts both `neogram_app` and `neogram_postgres` with automated database migrations and healthchecks.
- App listens securely on `127.0.0.1:4000`.

### 4. Configure Caddy Reverse Proxy (Automatic SSL)
In `/etc/caddy/Caddyfile`:
```caddyfile
neogram.club, www.neogram.club {
    reverse_proxy localhost:4000
}
```
Reload Caddy:
```bash
sudo systemctl reload caddy
```
Caddy automatically obtains and renews trusted Let's Encrypt certificates with HTTP/2 and auto-redirects HTTP to HTTPS.

### 5. Automated Continuous Deployment (GitHub Actions)
Deployments are fully automated via GitHub Actions (`.github/workflows/deploy.yml`):
- Pushing commits to `main` triggers pre-flight type checking (`npm run lint`).
- Upon success, the workflow connects to the Droplet via SSH, pulls the latest commits, rebuilds the Docker containers, and validates server health.

---

## 📦 Browser Extension Packaging (NIM Chat)

```bash
# Sync shared CSS and Web Audio engine into extension/
npm run extension:sync

# Bundle into production zip for Chrome Web Store:
npm run extension:package
# Output: neogram-aim-extension.zip
```
See `CHROMEWEBSTORE.md` for store listing copy, screenshots, and permission disclosures.