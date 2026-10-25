# Neocities Static Hosting & Setup Guide

This guide walks you through connecting your **Neocities** personal static website to the **Neogram** workstation.

Neocities is the leading retro web community hosting hundreds of thousands of personal homepages, fan shrines, and artistic static sites. Neogram allows you to use your mobile device or desktop workstation to publish responsive photo galleries, visitor guestbooks, and dynamic hit counters directly to your Neocities space.

---

## 1. How Neogram Works with Neocities

```
+------------------+         +----------------------+         +-----------------------+
|  Mobile / Desktop|         |  Neogram Workstation |         |  Your Neocities Site  |
|  Camera / Photo  | ------> |  - Sharp WebP Resize | ------> |  https://you.neocities|
|  Upload Studio   |         |  - Eleventy 11ty Build|         |  .org/neogram/        |
+------------------+         +----------------------+         +-----------------------+
                                        |                                  |
                                 Immediate Local                     Permanent Home
                                Disk Purge (0 MB)                   For All Your Photos
```

When you hit **"TRANSMIT PHOTO"**:
1. Neogram optimizes your photo into modern WebP format and creates a square thumbnail.
2. Eleventy (11ty) builds your multi-tenant static gallery bundle with HTML, CSS, and metadata.
3. The bundle is uploaded directly to `POST https://neocities.org/api/upload` using your encrypted API key.
4. **Zero-Retention Policy:** As soon as the upload completes, local image copies are **immediately erased** from the Neogram server disk. Your static host becomes the permanent home of your images.

---

## 2. Step-by-Step Setup

### Step 1: Obtain your Neocities API Key
1. Log in to your account at [neocities.org](https://neocities.org).
2. Navigate to your site settings: [https://neocities.org/settings#api_key](https://neocities.org/settings#api_key).
3. Scroll to the **API Key** section and copy your private key token.
   - *Example format:* `0123456789abcdef0123456789abcdef`
   - *Note:* Keep this token private. Neogram encrypts this key at rest using AES-256-GCM.

### Step 2: Open Station Settings in Neogram
1. Open the Neogram Workstation dashboard at `http://localhost:4000` (or your live URL).
2. Click the **⚙ Settings** button in the top navigation bar (or press `switchDashboardTab('settings')`).
3. Scroll to the window titled **`[:> CYBER_HOSTING.SYS — STATIC DEPLOY PIPELINE]`**.

### Step 3: Configure Deployment Parameters

| Field | Description | Recommended Setting |
|---|---|---|
| **STATIC HOSTING PROVIDER** | Target static publishing host. | `Neocities API (Primary)` |
| **NEOCITIES API KEY** | The private API token copied from step 1. | `[Your API Key]` |
| **SITE NAME / SUBDOMAIN** | Your Neocities subdomain (without `.neocities.org`). | `your-site` |
| **TARGET SUBFOLDER (`deploy_path`)** | The subfolder on your Neocities site where galleries compile. | `neogram` *(Default)* |
| **AUTO-DEPLOY ON TRANSMIT** | When checked, every new photo upload or comment automatically triggers a background static rebuild and pushes directly to Neocities. | `[x] Enabled` |

### Step 4: Test Your Connection
1. Click the yellow **`[ 🔌 Test Neocities Connection ]`** button.
2. Neogram contacts `https://neocities.org/api/info` with your token.
3. When verified, a green alert will confirm:
   ```
   [:> CONNECTION SUCCESS] Verified station link to "your-site.neocities.org"!
   Remote Views: 1,420 | Remote Hits: 8,940 | Last Updated: Today
   ```
4. Click **`[ 💾 SAVE HOSTING CONFIG ]`** to encrypt and commit your credentials to PostgreSQL.

---

## 3. The Safe Subdirectory Invariant (`deploy_path`)

> [!IMPORTANT]
> **Root Site Non-Destruction Guarantee:**
> Neogram was specifically engineered **never to overwrite** your existing Neocities homepage (`index.html`), personal stylesheets, blogs, fan-listings, or custom artwork.

### How it Works:
- By default, your gallery compiles under `/neogram/`.
- If your site is `https://cyber-samurai.neocities.org`, your Neogram gallery lives safely at:
  ```
  https://cyber-samurai.neocities.org/neogram/
  ```
- All generated HTML, detail pages, thumbnails, and comments are prefixed with `/neogram/`.
- If you ever delete a photo in Neogram, Neogram's remote deletion filter strictly prevents deleting any files outside of the `uploads/` directory located inside your designated `deploy_path`.

### Can I publish to the root directory?
Yes. If your entire Neocities site is dedicated exclusively to your photo gallery, set **Target Subfolder** to blank (empty string). Note: doing this will replace your site's root `index.html`.

---

## 4. What Files Are Uploaded to Neocities?

Inside your `deploy_path` directory (e.g., `/neogram/`), Neogram generates and maintains the following static assets:

```
neogram/
├── index.html                           <- Responsive photo gallery grid
├── css/
│   └── neogram.css                      <- Pure BEM styling (no Tailwind)
├── photos/
│   └── <post-id>/
│       └── index.html                   <- Standalone photo detail page with comments
├── uploads/
│   ├── images/
│   │   ├── 1792863233120-photo.webp     <- High-res 1200px WebP photo
│   │   └── 1792863233120-photo.comments.json <- Self-hosted comment ledger
│   └── thumbs/
│       └── 1792863233120-photo-thumb.webp <- 400x400 square thumbnail WebP
└── data/
    └── guestbook.json                   <- Self-hosted visitor signatures ledger
```

---

## 5. Deployment Triggers: Auto-Deploy vs. Manual

### 1. Automatic Deployment (`auto_deploy: true`)
When enabled in Settings, the following actions automatically initiate a background Eleventy compilation and multipart upload to Neocities:
- Publishing a new photo in the Upload Studio
- Modifying a photo caption, mood, or location in the Edit Studio
- Deleting an archived post
- A visitor submitting a verified comment or guestbook signature

### 2. Manual Rebuild & Deploy
You can manually recompile your entire static site at any time:
1. In the workstation, navigate to the **⚙ Settings** tab.
2. In the right-hand panel **`[:> NEOCITIES SYNC & TELEMETRY]`**, click:
   ```
   [ ⚡ Force Static Rebuild & Deploy ]
   ```
3. Neogram will compile all posts via Eleventy and push any updated or missing files directly to Neocities.

---

## 6. Security Architecture & Encryption at Rest

- Static hosting credentials (API keys and passwords) are encrypted in PostgreSQL using **AES-256-GCM** with a unique initialization vector (`IV`) and authentication tag per entry.
- Credentials are **never** returned in plaintext over the API (`/api/settings` returns masked stars, e.g. `••••••••abcdef12`).
- Communication with Neocities occurs exclusively over encrypted TLS (`https://neocities.org/api/upload`).

---

## 7. Troubleshooting & FAQ

### Q: Neocities returns "403 Forbidden" or "Invalid API Key"
- Verify that you copied the **API Key** (a long alphanumeric string) and not your Neocities login password.
- Make sure there are no accidental spaces before or after the key.
- Verify that your Neocities account is active and verified.

### Q: Can I use Neogram before setting up my Neocities API key? (Sandbox Mode)
- **Yes!** Neogram features a **Zero-Barrier Sandbox Mode**. You can register, snap camera photos, experiment with vintage CRT/phosphor shaders, and publish immediately without supplying Neocities credentials. Your transmissions will be live and browseable on your central Cyberspace Station profile (`/user/:handle`). When you are ready to publish to your personal static site, simply enter your Neocities API key and click **Force Static Rebuild & Deploy**.

### Q: Neocities returns "429 Too Many Requests" (Rate Limit)
- Neocities protects its API against high-frequency automated uploads. If you or your followers broadcast multiple posts in rapid succession, Neogram automatically paces remote follower static grid updates with a 1.2-second safety buffer. If you trigger a manual sync too frequently, wait 60 seconds before initiating another rebuild.

### Q: Neocities returns "413 Payload Too Large" or "Storage Quota Exceeded"
- Free Neocities accounts come with 1 GB of storage. If your account reaches 100% capacity, Neocities rejects further file uploads. You can verify your usage at [neocities.org/dashboard](https://neocities.org/dashboard). Neogram's WebP compression produces lean 80–180 KB files, but if you exceed your host quota, upgrade to Neocities Supporter or prune older static files.

### Q: Images are not loading on my static site
- Check that your Neocities storage quota is not full.
- Verify that your `site_url` matches your actual Neocities address.

### Q: Can I use a custom domain with Neocities?
- Yes! If you have a Neocities Supporter plan with a custom domain (e.g., `https://myphotos.xyz`), enter `https://myphotos.xyz` in the **Custom Site URL** field in Settings. Neogram will generate all absolute URLs and JSON feeds using your custom domain.

---

## 8. Expanding to Other Hosting Providers (Roadmap)

Neogram's deployment engine is built with a modular adapter interface (`StaticPublisherAdapter`). While Neocities is currently the primary supported automated API, the following static targets are planned for release in v1.1:

- **Nekoweb API (v1.1):** Direct REST API v1 upload integration to personal Nekoweb web spaces.
- **GitHub Pages (v1.1):** Automated Git commit and tree push pipeline directly to a `gh-pages` branch or repository via GitHub Personal Access Token (PAT).
- **SFTP / SSH Static Sync (v1.1):** Universal remote directory synchronization to any self-hosted Linux VPS, shared cPanel host, or Raspberry Pi static server.
- **Local Bundle Export (Zip Archive):** Download a complete, self-contained static site ready to drop onto any static host.
