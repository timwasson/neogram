# Multi-Site Architecture & Target Switching (1 User : N Sites)

This manual explains how to configure, switch between, and deploy to multiple independent static site targets using Neogram's **Multi-Site Architecture**.

---

## 1. The 1 User : N Sites Paradigm

Traditionally, publishing to multiple static websites (e.g. personal homepages, fan shrines, retro portfolios, or art logs) required creating separate accounts with different email addresses and constantly logging in and out.

Neogram solves this with **Identity Decoupling**:

```
                  ┌─────────────────────────────────────────────────────────┐
                  │                 CREATOR STATION IDENTITY                 │
                  │   @handle (Callsign)  |  #100109 (Permanent Node UIN)    │
                  │   Friends Network     |  NIM Instant Messenger          │
                  └────────────────────────────┬────────────────────────────┘
                                               │
               ┌───────────────────────────────┼───────────────────────────────┐
               ▼                               ▼                               ▼
     ┌──────────────────┐            ┌──────────────────┐            ┌──────────────────┐
     │  Primary Site    │            │  Cyber Shrine    │            │  Retro Art Blog  │
     │  Slug: "main"    │            │  Slug: "shrine"  │            │  Slug: "art"     │
     │  you.neocities   │            │  shrine.neocities│            │  art.neocities   │
     │  /neogram/       │            │  /shrine/        │            │  /photos/        │
     │  Hit Counter     │            │  Hit Counter     │            │  Hit Counter     │
     │  Guestbook       │            │  Guestbook       │            │  Guestbook       │
     └──────────────────┘            └──────────────────┘            └──────────────────┘
```

Your creator identity (`@handle`, numeric ICQ `#uin`, avatar, and friends network) remains constant, while each static site target operates as an independent publishing pipeline with its own credentials, deploy subfolder, hit counters, and visitor ledgers.

---

## 2. Global Identity vs. Site Targets

| Property | Creator Identity (Global) | Mounted Site Target (1 to N) |
|---|---|---|
| **Callsign / Handle** | `@handle` (Across Cyberspace) | Inherits `@handle` in attribution & feeds |
| **Node Identity** | Permanent Numeric UIN (`#100101+`) | Anchors per-site counters (`/counter/:uin/:slug.svg`) |
| **Authentication** | One passwordless OTP login session | Managed seamlessly without re-logging in |
| **Static Host** | N/A | Neocities, Nekoweb, GitHub Pages, SFTP |
| **Host Credentials** | N/A | AES-256-GCM encrypted API key per target |
| **Deploy Subfolder** | N/A | Custom path (e.g. `/neogram/`, `/shrine/`, or `/`) |
| **Web Hit Counter** | Main station counter | Isolated hits per site (`/counter/:uin/:slug.svg`) |
| **Visitor Guestbook** | Main station guestbook | Isolated ledger per site (`/embed/guestbook/:handle/:slug`) |
| **Published Photos** | Aggregate profile transmission stream | Filtered stream per target site |

---

## 3. Step-by-Step Setup Guide

### Step 1: Provisioning a New Site Target
1. Open the Neogram Workstation dashboard.
2. Navigate to the **⚙ Settings** tab.
3. Locate the window **`[:> SITES_MANAGER.SYS — Mounted Static Targets]`**.
4. Click **`[ ➕ PROVISION NEW STATIC SITE TARGET ]`** to open the drawer.
5. Enter your configuration:
   - **Target Site Name:** A friendly label (e.g. `Cyber Shrine 1999` or `Pixel Art Portfolio`).
   - **Unique Site Slug:** Lowercase identifier used in URLs (e.g. `shrine`, `portfolio`).
   - **Target Provider:** `Neocities` or `Nekoweb` (with GitHub Pages & SFTP on roadmap).
   - **Host Subdomain:** Your remote site name (e.g. `shrine` for `shrine.neocities.org` or `shrine.nekoweb.org`).
   - **Host API Key:** The private API key for that specific host account.
   - **Target Subfolder:** The subfolder on your host (e.g. `shrine` or `neogram`).
6. Click **`[ 🚀 PROVISION TARGET :> ]`**. Neogram saves and encrypts your target.

---

### Step 2: Instant 1-Click Target Switching
You can switch your active workstation session between mounted sites at any time:

1. **Top Taskbar Dropdown:** Click the **`Mounted Target Site`** selector in the top desktop taskbar (marked with 💾).
2. **Settings Roster:** In **Settings**, each site card includes a **`[ ⇄ Switch Target ]`** button.

Once switched:
- The active workstation session updates immediately via the `neogram_active_site` cookie.
- The **Upload Studio** targets this site for upcoming photo transmissions.
- The **Archive Gallery** filters to this site's published stream.
- The **Embeds Studio** interpolates this site's slug into dynamic SVG counter and guestbook snippets.

---

### Step 3: Transmitting Photos to Specific Targets
1. Open the **↑ Studio** tab in the Workstation.
2. Look at the top **`TARGET SITE`** bar right above the CRT viewfinder.
3. If you want to publish to a different site, click **`[ ⇄ Switch Target ]`** and select the destination.
4. Snap or select your photo, apply vintage filters/shaders, write your caption, and click **`[ TRANSMIT PHOTO TO STATIC HOST :> ]`**.
5. Neogram processes the image via Sharp and uploads it directly to the selected target site!

---

## 4. Per-Site Embeddable Widgets

Each mounted site target features its own isolated hit counters, guestbooks, and feeds.

### 1. Dynamic SVG Web Hit Counter
Track visits independently for each of your sites using the site's unique slug:

```html
<!-- Primary Default Site Counter -->
<img src="https://neogram.club/counter/100109.svg?style=green_led" alt="Hits" />

<!-- Specific Secondary Site Counter (e.g. "shrine") -->
<img src="https://neogram.club/counter/100109/shrine.svg?style=green_led" alt="Shrine Hits" />
```

- Visits to your fan shrine will increment only the shrine's counter.
- Supports all hardware palettes (`green_led`, `red_nixie`, `odometer`, `blue_vfd`).

---

### 2. Public Visitor Guestbook Ledger
Embed dedicated guestbooks for each of your static sites:

```html
<!-- Primary Site Guestbook -->
<iframe
  src="https://neogram.club/embed/guestbook/your_handle"
  width="100%"
  height="650"
  frameborder="0"
  title="Public Visitor Guestbook"
></iframe>

<!-- Specific Secondary Site Guestbook (e.g. "shrine") -->
<iframe
  src="https://neogram.club/embed/guestbook/your_handle/shrine"
  width="100%"
  height="650"
  frameborder="0"
  title="Visitor Guestbook — Cyber Shrine"
></iframe>
```

---

### 3. Headless JSON Feed (JSONFeed 1.1)
Fetch photo streams for a specific site target:

- **Primary Site Feed:**
  `https://neogram.club/api/users/your_handle/feed.json`
- **Specific Site Target Feed:**
  `https://neogram.club/api/users/your_handle/feed.json?siteSlug=shrine`

---

## 5. Site Management Actions

Inside **`[:> SITES_MANAGER.SYS]`** in Settings, each mounted site provides quick-action controls:

- **`[ ⇄ Switch Target ]`**: Switches the active workstation context to this site.
- **`[ ★ Set Primary ]`**: Promotes this site to your default primary site target.
- **`[ ✏️ Edit Config ]`**: Loads this site's credentials, deploy subfolder, and styling options into the config editor.
- **`[ 🚀 Deploy ]`**: Triggers a background static rebuild and pushes live to the host.
- **`[ ✕ Delete ]`**: Unmounts and deletes the site target.

> [!NOTE]
> **Zero-Site Flexibility:**
> Because user accounts and static sites are decoupled, you can unmount all site targets and operate in Cyberspace with 0 sites (chatting on NIM, signing guestbooks, and consuming follower feeds). Deleting a site target CASCADE-deletes its associated posts and static build cache while strictly leaving your creator identity, friends network, and other sites untouched.

---

## 6. Public Profile Integration

Visitors to your central Cyberspace Station profile (`https://neogram.club/user/@your_handle`) can browse your transmissions across all your mounted sites:

- Multi-site filter chips at the top of your transmission ledger allow visitors to filter by site (e.g. `[ ALL TRANSMISSIONS ]`, `[ 💾 Main Site ]`, `[ 💾 Cyber Shrine ]`).
- Every photo transmission displays a high-contrast badge indicating which static site target it was published to.
