# 📟 Neogram: 90s Retro Social Publishing Engine

> A lightweight, privacy-first SaaS suite bridging mobile photo creation with 90s web nostalgia. Snap photos from your phone, apply vintage CRT and halftone shaders, and publish them directly to your personal static site (Neocities, GitHub Pages, or self-hosted) with zero permanent media storage on the server.

---

## ⚡ Core Architecture

- **Backend & Workstation:** Node.js (Express) + TypeScript / ESM (Port 4000)
- **Database:** PostgreSQL (Docker or managed) with automated migrations
- **Image Processing:** Sharp (1200px max, 400px thumbnails, WebP compression, EXIF auto-rotation)
- **Static Site Engine:** Eleventy (11ty v3) with FIFO `BuildQueue` serialization & multi-tenant isolation (`dist/static-galleries/<userId>/`)
- **Design System:** Zero Tailwind. Pure Vanilla CSS compiled from Dart Sass (`public/css/neogram.css`) with strict BEM tokens
- **Audio Engine:** Web Audio API synthesized 8-bit clicks, camera shutters, success chimes, and dial-up tones
- **Social & Widgets:** Dynamic SVG hit counters (`/counter/:handle.svg`), visitor guestbook, and JSONFeed 1.1 feeds
- **Instant Messenger:** WebSockets (`/ws/chat`) with ephemeral offline queue, client-side retention, and Manifest V3 browser extension

---

## 🛡️ Key Safety & Privacy Invariants

1. **Zero Server Media Retention (0 MB):** Image uploads are processed into ephemeral staging, uploaded directly to the creator's remote static site (Neocities), and immediately wiped from local disk upon confirmation. The Neogram server stores 0 bytes of user media.
2. **Safe Subdirectory Publishing:** By default, Neogram publishes to `/neogram/` (e.g. `https://<user>.neocities.org/neogram/`). Existing homepages (`index.html`), personal blogs, or custom styling are **never modified or overwritten**.
3. **Non-Destructive Deletion Invariant:** Remote deletions to Neocities are strictly restricted to `uploads/` matching the user's `deploy_path`. Non-Neogram files cannot be deleted.
4. **Permanent Node UIN (ICQ-Style):** Accounts receive an immutable numeric node ID (`users.uin`, sequence starting at `#100101`). Creators can freely edit their `@handle` without breaking third-party static site embeds or counters.

---

## 🚀 Local Development Setup

### Prerequisites
- Node.js 20+
- PostgreSQL running locally (or via Docker)

### 1. Clone & Install Dependencies
```bash
git clone https://github.com/your-username/neogram.git
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
- Runs 43 automated end-to-end integration tests in under 1 second.
- Validates OTP dispatch, sliding rate limiting, session auth, Sharp WebP compression, isolated 11ty static builds, dynamic SVG hit counters, comment ledgers, and safe post purge.

---

## 🌊 1-Click Production Deployment (DigitalOcean / VPS)

Neogram is fully containerized with Docker Compose. You can run it on a **$4–$6/month DigitalOcean Droplet** (Ubuntu 24.04 LTS).

### 1. On your Droplet:
```bash
# Install Docker & Docker Compose
curl -fsSL https://get.docker.com -o get-docker.sh && sh get-docker.sh

# Clone repository
git clone https://github.com/your-username/neogram.git
cd neogram
```

### 2. Configure `.env`:
```bash
cp .env.example .env
nano .env
```
Fill in your production secrets, domain, and optional transactional auth keys:
- `APP_URL=https://yourdomain.com`
- `RESEND_API_KEY=` (Free tier at resend.com for emails)
- `TWILIO_ACCOUNT_SID=` & `TWILIO_AUTH_TOKEN=` (Optional for SMS)

### 3. Launch with Docker Compose:
```bash
docker compose up -d --build
```
- Starts both `neogram_app` and `neogram_postgres` with automated database migrations and healthchecks.
- App listens on port `4000`. Set up Nginx or Caddy with SSL (`certbot`) as a reverse proxy.

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