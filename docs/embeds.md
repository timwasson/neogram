# Static Site Embeds & Retro Widgets Manual

One of Neogram's core superpowers is allowing you to embed live, interactive social widgets directly into your static websites (Neocities, GitHub Pages, or self-hosted servers) using zero-dependency HTML snippets, iframes, and dynamic SVGs.

---

## 1. Dynamic SVG Web Hit Counter

The Neogram Web Hit Counter is a lightweight, dynamic SVG image that automatically increments your station visit count every time a browser renders it.

```
+--------------------------------------------------------------------------+
|  NEOGRAM HARDWARE HIT COUNTER (LIVE PREVIEW STYLES)                     |
+--------------------------------------------------------------------------+
|  🟢 Green Phosphor:  [ 0 4 2 9 8 1 ]  (VT323 / High-contrast Matrix)    |
|  🔴 Red Nixie Tube:  [ 0 4 2 9 8 1 ]  (Warm glowing ionized gas)        |
|  ⚪ Mechanical B&W:  [ 0 4 2 9 8 1 ]  (Odometer rolling digit drums)    |
|  🔵 Cyan VFD Tube:   [ 0 4 2 9 8 1 ]  (Vacuum Fluorescent VFD glow)     |
+--------------------------------------------------------------------------+
```

### Key Technical Properties:
- **Zero Third-Party Trackers & Zero Cookies:** Privacy-friendly, pure vector graphic served as `image/svg+xml`.
- **Instant Live Increments:** Configured with `Cache-Control: no-cache, no-store, must-revalidate` so every legitimate page view registers.
- **Dual Identifier & Per-Site Slug Resolution:** You can embed your counter using either your cyber call-sign (`@handle`) or your immutable numeric node ID (`UIN`), and optionally anchor it to a specific mounted site target (`slug`):
  - *Handle URL (Default Site):* `https://neogram.club/counter/cyber_surfer.svg?style=green_led`
  - *UIN URL (Default Site):* `https://neogram.club/counter/100109.svg?style=green_led` *(Permanent anchor: will never break even if you change your handle!)*
  - *Per-Site Slug URL:* `https://neogram.club/counter/100109/shrine.svg?style=green_led` *(Tracks visits independently for that specific site target!)*

---

### Hardware Palettes & Styles:

| Style Code | Palette Name | Aesthetic Description |
|---|---|---|
| `green_led` | **Green Phosphor** *(Default)* | Classic Apple II / VT100 phosphor green CRT matrix |
| `red_nixie` | **Red Nixie Tube** | Warm neon amber/red glowing digit discharge tube |
| `odometer` | **B&W Mechanical** | Vintage mechanical automotive rolling drum counter |
| `blue_vfd` | **Cyan VFD Tube** | Futuristic 80s VCR/Stereo vacuum fluorescent blue-cyan |

---

### Hit Counter Embed Code Samples:

#### Option A: Direct HTML Image Tag (Recommended)
Place this snippet anywhere in your site's HTML (footer, sidebar, or bio box):

```html
<!-- Neogram Dynamic Web Hit Counter -->
<div class="neogram-counter">
  <img 
    src="https://neogram.club/counter/your_handle.svg?style=green_led" 
    alt="You are visitor number" 
    loading="eager"
  />
</div>
```

#### Option B: Immutable Numeric UIN Tag (Guaranteed Never to Break)
```html
<!-- Neogram UIN Hit Counter (#100101) -->
<div class="neogram-counter">
  <img 
    src="https://neogram.club/counter/100101.svg?style=green_led" 
    alt="Station Visitor Count" 
  />
</div>
```

#### Option C: Linked Counter with Workstation Telemetry
```html
<!-- Clickable Hit Counter linking to your Station Profile -->
<a href="https://neogram.club/user/@your_handle" target="_blank" title="View Station Telemetry on Neogram">
  <img src="https://neogram.club/counter/your_handle.svg?style=red_nixie" alt="Hit Counter" />
</a>
```

---

## 2. Public Visitor Guestbook Ledger

The Neogram Guestbook brings back the legendary 90s web tradition of visitor guestbooks, enhanced with modern spam prevention and self-hosted static persistence.

```
+--------------------------------------------------------------------------+
|  [:> guestbook_daemon.cgi - PUBLIC VISITOR LEDGER]                       |
+--------------------------------------------------------------------------+
|  ✍️  Leave your signature in our cyberspace ledger:                      |
|  [ Name / Callsign ] [ Location ] [ Personal Website ] [ Mood Icon: 😎 ] |
|  [ Message / Comments: "Radical site! Adding you to my webring!"       ] |
|                                                                          |
|  [ SUBMIT SIGNATURE TO LEDGER :> ]                                       |
+--------------------------------------------------------------------------+
```

### Key Technical Properties:
- **Self-Hosted Storage on Static Host:** Signatures are stored in `data/guestbook.json` on your Neocities space. You own 100% of your guestbook data.
- **Spam Sliding-Window Protection:** In-memory rate limiting strictly blocks excessive submissions (maximum 6 signatures per 5-minute window per IP).
- **Owner Moderation:** You can inspect and delete any inappropriate signatures directly from the Neogram Station Workstation under the **Embeds** tab.
- **Verified Cyber-Pass Identity:** Signers connect with their Neogram handle or numeric UIN.

---

### Guestbook Embed Code Samples:

#### Option A: Responsive Iframe Window (Drop-In)
Add this iframe into your guestbook page (e.g. `guestbook.html` on Neocities):

```html
<!-- Neogram Public Visitor Guestbook (Default Site) -->
<iframe
  src="https://neogram.club/embed/guestbook/your_handle"
  width="100%"
  height="650"
  frameborder="0"
  style="border: 3px solid #000000; box-shadow: 4px 4px 0px 0px rgba(0,0,0,0.9); background: #161b22;"
  title="Public Visitor Guestbook"
></iframe>

<!-- Per-Site Guestbook for Secondary Target (e.g. "shrine") -->
<iframe
  src="https://neogram.club/embed/guestbook/your_handle/shrine"
  width="100%"
  height="650"
  frameborder="0"
  style="border: 3px solid #000000; box-shadow: 4px 4px 0px 0px rgba(0,0,0,0.9); background: #161b22;"
  title="Public Visitor Guestbook — Cyber Shrine"
></iframe>
```

#### Option B: Direct Station Link Button
If you prefer not to embed an iframe, place a retro button linking to your live hosted guestbook:

```html
<a 
  href="https://neogram.club/embed/guestbook/your_handle" 
  target="_blank" 
  style="display: inline-block; padding: 6px 12px; background: #ffff00; color: #000; font-family: monospace; font-weight: bold; border: 2px solid #000; text-decoration: none;"
>
  ✍️ Sign My Guestbook :&gt;
</a>
```

---

## 3. Headless JSONFeed 1.1 & Photo Streams

Neogram exposes your photo transmissions through a compliant [JSONFeed 1.1](https://jsonfeed.org/version/1.1) endpoint. This allows you to fetch your latest photos from any static site generator (11ty, Jekyll, Hugo, Astro) or client-side JavaScript script.

### Endpoint URLs:
- **JSON Feed (Default Site):** `https://neogram.club/api/users/your_handle/feed.json`
- **JSON Feed (Specific Site Target):** `https://neogram.club/api/users/your_handle/feed.json?siteSlug=shrine`
- *(Shortcut):* `https://neogram.club/feed/your_handle.json`

### Example JSON Payload:
```json
{
  "version": "https://jsonfeed.org/version/1.1",
  "title": "cyber_surfer's Neogram Photo Feed",
  "home_page_url": "https://cyber_surfer.neocities.org/neogram/",
  "feed_url": "https://neogram.club/api/users/cyber_surfer/feed.json",
  "items": [
    {
      "id": "e121c1a9-4b53-41ad-bcbb-1af12bdf9161",
      "imageUrl": "https://cyber_surfer.neocities.org/neogram/uploads/images/1792863233120-photo.webp",
      "thumbnailUrl": "https://cyber_surfer.neocities.org/neogram/uploads/thumbs/1792863233120-photo-thumb.webp",
      "caption": "Night cruising through Shibuya neon alleys.",
      "filter": "crt-phosphor",
      "likes": 14,
      "commentCount": 3,
      "createdAt": "2026-10-24T12:00:00.000Z"
    }
  ]
}
```

---

### Fetching & Rendering in Vanilla JavaScript:

```html
<div id="my-neogram-feed" class="retro-feed-container">
  <p>Loading photo transmissions...</p>
</div>

<script>
  (async function() {
    try {
      const res = await fetch('https://neogram.club/api/users/your_handle/feed.json');
      const data = await res.json();
      const container = document.getElementById('my-neogram-feed');
      
      if (!data.items || data.items.length === 0) {
        container.innerHTML = '<p>No transmissions logged yet.</p>';
        return;
      }

      container.innerHTML = data.items.map(post => `
        <article class="neogram-card" style="border: 2px solid #000; margin-bottom: 15px; padding: 10px; background: #fff;">
          <a href="${post.imageUrl}" target="_blank">
            <img src="${post.thumbnailUrl}" alt="${post.caption}" style="max-width: 100%; display: block;" />
          </a>
          <p style="font-family: monospace; font-size: 12px; margin-top: 8px;">${post.caption}</p>
          <small style="font-family: monospace; color: #666;">❤️ ${post.likes} Likes | 💬 ${post.commentCount} Comments</small>
        </article>
      `).join('');
    } catch (err) {
      console.error('Failed to load Neogram feed:', err);
    }
  })();
</script>
```

---

### Standalone Feed Iframe Widget:

If you want a pre-styled carousel of your latest photos dropped onto your static homepage:

```html
<!-- Neogram Latest Photos Widget -->
<iframe
  src="https://neogram.club/embed/feed/your_handle"
  width="100%"
  height="480"
  frameborder="0"
  style="border: 2px solid #000; background: #000;"
  title="Recent Photos"
></iframe>
```

---

## 4. Photo Comments & Likes (Self-Hosted + Cyber-Pass SSO)

Neogram solves the hardest challenge of static websites: **interactive comments without ad tracking or heavy bloated widgets.**

### How Comments Work:
1. When visitors view a photo on your Neocities gallery (`photos/<id>/index.html`), the page displays an interactive comments ledger.
2. If the visitor wants to comment, they click **"CONNECT WITH NEOGRAM CYBER-PASS"**.
3. **Mobile-Resilient Dual-Path SSO:**
   - **Desktop Browsers:** Opens a lightweight modal popup (`/auth/connect`) that performs single-click identity verification and relays an ephemeral session token back via `postMessage`.
   - **Mobile Browsers (iOS / Android) & Popup Blockers:** Automatically falls back to a clean full-page redirect to `/auth/connect?return_url=...`. Upon verification, the user is redirected back to the photo page with the ephemeral token in the URL hash fragment (`#neogram_pass=...`). The page reads and stores the token in `localStorage`, cleans the hash fragment from the address bar, and immediately unlocks the comment form—with zero cookie dependencies!
4. The comment is submitted to `POST /api/posts/:id/comments`.
5. **Static File Commit:** The comment is immediately saved into `uploads/images/<photo>.comments.json` directly on your Neocities static host, and an automated background 11ty static rebuild updates the static HTML page!
6. **Zero Tracking:** No cookies, no ad retargeting, and no data harvesting.

---

## 5. Vanilla JS Client Embed Library (`embed.js`)

Neogram provides an embed script (`/embed/embed.js`) and matching stylesheet (`/embed/neogram-embed.css`) that you can include on any external HTML page.

### Including the Assets:
```html
<head>
  <link rel="stylesheet" href="https://neogram.club/embed/neogram-embed.css" />
  <script src="https://neogram.club/embed/embed.js" defer></script>
</head>
```

### Declarative Widget Hooks:
```html
<!-- Automatically renders your dynamic counter -->
<div data-neogram-widget="counter" data-user-id="your_handle" data-style="green_led"></div>

<!-- Automatically renders your visitor guestbook -->
<div data-neogram-widget="guestbook" data-user-id="your_handle"></div>

<!-- Automatically renders your photo feed -->
<div data-neogram-widget="feed" data-user-id="your_handle"></div>
```

---

## 6. Headless Self-Hosted API Mode (JSON Feeds & Custom JavaScript)

For creators who want to use Neogram purely as a photo processing engine and static JSON API for their website:

### How to Enable Headless Mode:
1. Open **Settings** on your Neogram workstation dashboard.
2. Under **DEPLOYMENT INTEGRATION**, uncheck **[ ] Generate Static HTML Pages**.
3. Save settings.

Neogram will automatically clean up all HTML files from your static directory and upload **only** your media and JSON feeds:
- `feed.json`: Master feed containing station node metadata, user profile, action endpoints, and photo array.
- `posts.json`: Direct array of published photo objects with action endpoints.
- `<image>.comments.json`: Self-hosted comments files per photo.

### Feed JSON Schema (`feed.json`):
```json
{
  "version": "neogram-api-v1",
  "generatedAt": "2026-10-24T18:00:00.000Z",
  "user": {
    "id": "uuid",
    "uin": 100109,
    "handle": "your_handle",
    "author": "your_handle",
    "avatarUrl": "https://neogram.club/icons/default-avatar.svg",
    "siteUrl": "https://your_handle.neocities.org",
    "deployPath": "neogram",
    "fullSiteUrl": "https://your_handle.neocities.org/neogram",
    "statusMessage": "Surfing cyberspace"
  },
  "endpoints": {
    "apiUrl": "https://neogram.club",
    "followUrl": "https://neogram.club/api/users/your_handle/follow",
    "unfollowUrl": "https://neogram.club/api/users/your_handle/follow",
    "guestbookUrl": "https://neogram.club/api/guestbook/100109",
    "counterUrl": "https://neogram.club/counter/your_handle.svg",
    "feedUrl": "https://your_handle.neocities.org/neogram/feed.json"
  },
  "posts": [
    {
      "id": "4587aa36-b626-4ebb-b6f1-1e9fbd1481e3",
      "caption": "Sunset from the rooftop",
      "imageUrl": "https://your_handle.neocities.org/neogram/uploads/img.webp",
      "thumbnailUrl": "https://your_handle.neocities.org/neogram/uploads/img_thumb.webp",
      "imagePath": "uploads/img.webp",
      "thumbnailPath": "uploads/img_thumb.webp",
      "filterApplied": "crt-green",
      "likes": 12,
      "createdAt": "2026-10-24T17:30:00.000Z",
      "commentsCount": 2,
      "comments": [
        {
          "id": "c_1",
          "author": "visitor",
          "avatar": "💬",
          "text": "Great photo!",
          "timestamp": "2026-10-24T17:45:00.000Z"
        }
      ],
      "actions": {
        "likeUrl": "https://neogram.club/api/posts/4587aa36-b626-4ebb-b6f1-1e9fbd1481e3/like",
        "commentUrl": "https://neogram.club/api/posts/4587aa36-b626-4ebb-b6f1-1e9fbd1481e3/comments"
      }
    }
  ]
}
```

### Building Your Own Custom Display with Vanilla JS:
```html
<div id="gallery">Loading photos...</div>

<script>
  async function loadFeed() {
    const res = await fetch('./neogram/feed.json');
    const data = await res.json();
    const container = document.getElementById('gallery');
    
    container.innerHTML = data.posts.map(p => `
      <article style="border: 2px solid #000; margin-bottom: 16px; padding: 12px;">
        <img src="${p.thumbnailUrl}" alt="${p.caption}" style="max-width: 100%; display: block;" />
        <p><strong>${p.caption}</strong></p>
        <button onclick="fetch('${p.actions.likeUrl}', { method: 'POST' })">
          ⚡ ${p.likes} Likes
        </button>
      </article>
    `).join('');
  }
  loadFeed();
</script>
```

