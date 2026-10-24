# 📟 Neogram: 90s Retro Social Publishing Engine

> A lightweight, privacy-first SaaS suite bridging mobile photo creation with 90s web nostalgia. Snap photos from your phone, apply vintage CRT and halftone shaders, and publish them directly to your personal static site (Neocities, GitHub Pages, or self-hosted) with zero permanent media storage on the server.

---

## ⚡ Core Architecture

- **Backend & Workstation:** Node.js (Express) + TypeScript / ESM (Port 4000)
- **Database:** PostgreSQL (Docker or managed) with automated migrations
- **Image Processing:** Sharp (1200px max, 400px thumbnails, WebP compression, EXIF auto-rotation)
- **Static Site Engine:** Eleventy (11ty v3) with FIFO `BuildQueue` serialization & multi-tenant isolation (`dist/static-galleries/<userId>/`)
- **Design System:** Zero Tailwind. Pure Vanilla CSS compiled from Dart Sass (`public/css/neogram.css`). Dual-layer styling: workstation UI uses modular utility classes; static gallery output delivered to Neocities/GitHub Pages uses strict BEM classes for 1-click end-user CSS overrides
- **Audio Engine:** Web Audio API synthesized 8-bit clicks, camera shutters, success chimes, and dial-up tones
- **Social & Widgets:** Dynamic SVG hit counters (`/counter/:handle.svg`), public station cyber-profiles (`/user/:id`), visitor guestbook, and JSONFeed 1.1 feeds
- **Friends & Static Follow Grid:** Dedicated workstation `/friends` page, static `/friends/` photo gallery grid on Neocities, cascading follower rebuilds on post publication, and 1-click "Add Friend" on profiles and static site banners
- **User Directory & Presence:** Cyberspace white-pages directory (`/directory` & `/api/directory`) with presence categorization (Active, Away, Inactive), search filtering, and profile linking
- **Documentation Center:** Complete user guides and interactive embed manual (`/docs` & `docs/`) with step-by-step setup guides, sample embed codes for hit counters and guestbooks, and publishing pipeline deep-dives
- **Instant Messenger:** WebSockets (`/ws/chat`) with ephemeral offline queue, client-side retention, categorized online/offline Friends and Cyberspace Stations buddy list, and Manifest V3 browser extension
- **Cyber Notification Dispatcher:** Real-time multi-channel alerts (WebSockets, topnav notification drawer, 8-bit Web Audio chimes, and native desktop/PWA push) for DMs, follows, comments, replies, guestbook entries, likes, friend broadcasts, and deploy status with a user settings dashboard

---

## 🛡️ Key Safety & Privacy Invariants

1. **Zero Server Media Retention (0 MB):** Image uploads are processed into ephemeral staging, uploaded directly to the creator's remote static site (Neocities), and immediately wiped from local disk upon confirmation. The Neogram server stores 0 bytes of user media.
2. **Safe Subdirectory Publishing:** By default, Neogram publishes to `/neogram/` (e.g. `https://<user>.neocities.org/neogram/`). Existing homepages (`index.html`), personal blogs, or custom styling are **never modified or overwritten**.
3. **Non-Destructive Deletion Invariant:** Remote deletions to Neocities are strictly restricted to `uploads/` matching the user's `deploy_path`. Non-Neogram files cannot be deleted.
4. **Permanent Node UIN (ICQ-Style):** Accounts receive an immutable numeric node ID (`users.uin`, sequence starting at `#100101`). Creators can freely edit their `@handle` without breaking third-party static site embeds or counters.
5. **Semantic BEM Static Deliverables & Custom CSS:** The Eleventy static site engine compiles galleries using pure BEM markup (`.neogram-*`) with zero inline utility classes. Static site owners can link custom stylesheets (`users.custom_css_url`) or inject custom CSS on Neocities to effortlessly override any component's look without fighting specificity or needing `!important`.
6. **Public Station Cyber-Identity (`/user/:id`):** Public station profiles resolve by UUID, `@handle`, or immutable `#uin`. Features avatar, live hit counter, status broadcast, photo stream, reciprocal "Add Friend" action, and clean links directly to the creator's root personal website without subdirectories.
7. **Cyberspace Station Directory & Presence Categorization (`/directory`):** Public station white-pages listing all registered nodes in hierarchical carrier order: Active transmitters first (🟢), then "Away" stations (🟡), then Inactive nodes (⚪). Each sub-category is strictly ordered alphabetically by handle, displaying handle, numeric UID (`#uin`), small thumbnail, and link to profile. Real-time client-side instant filtering enables rapid searching by `@handle` or `#UID`, with instant access from the top navigation bar and user account menu.
8. **Cyberspace Documentation Center & Interactive Manual (`/docs`):** Complete self-hosted guides and embed manual covering Neocities setup, dynamic SVG hit counters, guestbook ledgers, Sharp processing pipeline, and BEM theming. Interpolates active creator credentials and immutable numeric UINs directly into embed snippets for 1-click deployment.
9. **Friends Network & Static Follow Grid (`/friends` & static `/friends/`):** Connect with fellow creators using simple "Friends". View a creator's profile or static site banner to add them as a friend. Features a dedicated workstation `/friends` page to browse friends' photo feeds and manage connections, a static `/friends/` photo grid on your personal Neocities site, NIM buddy list prioritization (Friends at the top), and automatic cascading FIFO background rebuilds across all follower static sites whenever a friend broadcasts a new photograph.
10. **Configurable Cyber Notifications & Zero-Retention DM Alerts:** Complete user preferences dashboard (`[:> NOTIFICATION_DISPATCHER.CFG]`) in Workstation Settings to customize notifications across 8 event categories, synthesized 8-bit audio chimes, and browser desktop/PWA push. NIM direct message alerts strictly record sender handle metadata ("@handle sent you a transmission") without message text, preserving zero-retention chat privacy.

---

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
- Runs 132 automated end-to-end integration tests in ~2.5 seconds.
- Validates OTP dispatch, sliding rate limiting, session auth, Sharp WebP compression, isolated 11ty static builds, dynamic SVG hit counters, self-hosted comments & Cyber-Pass handshake, JSONFeed 1.1, Cyberspace User Directory presence categorization & ordering, Cyberspace Documentation Center & embed snippets, Cyberspace Friends follow grid & cascading rebuilds, notification preferences & suppression, real-time WebSocket dispatches, and safe post purge.

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