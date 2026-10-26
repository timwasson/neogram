# Connecting Neogram to Nekoweb (Direct REST API v1.0)

This guide walks you through connecting your personal **Nekoweb** static website (`https://<username>.nekoweb.org`) to Neogram's automated publishing pipeline.

---

## 1. Overview & Advantages

**Nekoweb** is a popular modern retro-web personal site host. With Neogram's official Nekoweb integration:

* **Zero-Retention Pipeline:** Snap or upload photos from your phone or desktop workstation; Neogram optimizes images into modern WebP with retro CRT/sepia/cyberpunk shaders and pushes them directly to Nekoweb via their official REST API.
* **Safe Folder Isolation:** Photos and static galleries deploy directly to an isolated subfolder (e.g. `/neogram/` or `/photos/`), guaranteeing your existing Nekoweb homepage, shrines, and HTML files are **never overwritten or altered**.
* **Self-Hosted JSON Feeds & Comments:** Neogram uploads zero-dependency JSON feeds (`feed.json`, `posts.json`, and per-photo `comments.json`) directly to your Nekoweb site, giving you total data ownership and zero lock-in.
* **Multi-Site Switching:** You can mount your Nekoweb site alongside your Neocities or personal domains and switch between targets with 1 click.

---

## 2. Step-by-Step Connection Instructions

### Step 1: Retrieve Your Nekoweb API Key
1. Log into your account at [nekoweb.org](https://nekoweb.org).
2. Click your avatar or navigate to **Settings** (`https://nekoweb.org/settings`).
3. Scroll to the **API** section and locate your **API Key**.
4. Click **Copy Key** (keep this key secret—it grants programmatic access to manage your site's files).

### Step 2: Configure Nekoweb in Neogram
1. Open the Neogram Workstation dashboard.
2. Click the **⚙ Settings & Deploy** tab.
3. In the window card **`[:> NEKOWEB & DEPLOYMENT SETTINGS SECTION]`**:
   * **Target Hosting Provider:** Select **`Nekoweb (Direct REST API v1.0 — Live)`**.
   * **Nekoweb Site Subdomain / Name:** Enter your Nekoweb subdomain (e.g. if your site is `https://cybercat.nekoweb.org`, enter `cybercat`).
   * **Target Site URL:** Confirms as `https://cybercat.nekoweb.org`.
   * **📁 Publish Subdirectory / Folder:** Enter `neogram` (recommended) or your preferred folder name. Leave empty if you wish to deploy to the root of your Nekoweb domain.
   * **Nekoweb API Key:** Paste the API key copied from Nekoweb.
   * **Auto-Deploy on Transmit:** Toggle to **Enabled** if you want your static site to automatically rebuild and push live whenever you broadcast a new photo.
4. Click **`[ 🧪 TEST CONNECTION ]`**:
   * Neogram pings `https://nekoweb.org/api/site/info`.
   * The status indicator will switch to **`ONLINE [VERIFIED]`** and display your remote page views and followers.
5. Click **`[ 💾 SAVE SETTINGS :> ]`**. Neogram encrypts your API key in PostgreSQL with AES-256-GCM.

---

## 3. Deploying Your Static Gallery

Once connected, you can deploy your 11ty static photo gallery live to Nekoweb:

1. Click **`[ 🚀 DEPLOY TO NEKOWEB NOW :> ]`** in the Telemetry section.
2. Watch the live 28.8k baud carrier log as Neogram:
   * Compiles your photos into 11ty responsive HTML and JSON feeds.
   * Packages static assets into an optimized ZIP payload.
   * Transfers the archive to Nekoweb's Big File API (`/files/big/create` & `/files/big/append`).
   * Triggers native extraction into your target subfolder via `/files/import/:id`.
3. Open your live gallery URL (e.g. `https://cybercat.nekoweb.org/neogram/`) to view your retro photo gallery!

---

## 4. Embedding Widgets on Existing Nekoweb Pages

Want to embed your Neogram photo feed, visitor guestbook, or retro hit counter onto your custom Nekoweb homepage?

Head to the **`<> Embeds`** tab in the Workstation to copy ready-to-paste HTML snippets:
* **Web Hit Counter:** `<img src="https://neogram.club/counter/100101/default.svg?style=green_led" alt="Hit Counter" />`
* **Guestbook Ledger:** Embedded iframe or zero-dependency script widget.
* **Photo Stream:** Responsive retro CRT feed that pulls live from your Nekoweb `feed.json`.
