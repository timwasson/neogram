# Neogram Cyberspace Documentation & User Guide

Welcome to the **Neogram Documentation**. Neogram is a lightweight, privacy-first retro social publishing engine and Progressive Web App (PWA) designed specifically for personal static websites (Neocities, GitHub Pages, self-hosted static servers).

Neogram bridges mobile-first creation with 90s web nostalgia, allowing static site creators to snap photos on their phones, apply vintage CRT/phosphor shaders, and publish them directly to their personal static websites with live interactive feeds, guestbooks, dynamic hit counters, and real-time chat.

---

## Documentation Index

Explore the topic guides below:

1. **[Neocities Static Hosting & Setup Guide](file:///Users/timwasson/antigravity/Neogram---90s-Retro-Social-Publishing/docs/neocities-setup.md)**
   - Connecting your Neocities account with your API key
   - Safe subdirectory publishing (`/neogram/`) & root site non-destruction invariant
   - AES-256-GCM credential encryption at rest
   - Auto-deploy vs. manual compilation triggers
   - Troubleshooting and roadmap for upcoming static hosts (GitHub Pages, Nekoweb, SFTP)

2. **[Multi-Site Architecture & Target Switching Guide](file:///Users/timwasson/antigravity/Neogram---90s-Retro-Social-Publishing/docs/multi-site-setup.md)**
   - The 1 User : N Sites paradigm (decoupling identity from static hosts)
   - Provisioning secondary static site targets in Settings
   - Instant 1-click active target switching via desktop taskbar
   - Targeting specific sites during mobile and desktop uploads
   - Per-site dynamic hit counters, guestbooks, and JSON feeds
   - Safe unmounting, primary default selection, and CASCADE safeguards

3. **[Static Site Embeds & Retro Widgets Manual](file:///Users/timwasson/antigravity/Neogram---90s-Retro-Social-Publishing/docs/embeds.md)**
   - **Dynamic SVG Web Hit Counter**: Hardware palettes (`green_led`, `red_nixie`, `odometer`, `blue_vfd`), zero-tracking dynamic SVG tags, and permanent UIN anchors
   - **Public Visitor Guestbook Ledger**: Embeddable iframes, owner moderation, spam rate limits, and self-hosted JSON storage
   - **Headless JSONFeed 1.1 & Photo Feeds**: Consuming public feeds in vanilla JS, 11ty, Jekyll, or Hugo
   - **Photo Comments & Reactions**: Cyber-Pass popup handshake SSO and self-hosted comments
   - **Vanilla JS Client SDK (`embed.js`)**: Declarative `[data-neogram-widget]` integration

4. **[Publishing & Image Processing Pipeline](file:///Users/timwasson/antigravity/Neogram---90s-Retro-Social-Publishing/docs/publishing-pipeline.md)**
   - Ingestion: Native mobile camera snaps (`capture="environment"`) & 25MB file size streaming
   - High-performance Sharp image processing: EXIF auto-orientation (`.rotate()`), 1200px bounds, 400x400 square thumbnails, and WebP compression
   - Retro filter shaders: CRT Phosphor, Sepia 1999, Matrix Green, Scanlines, Glitch, Cyberpunk
   - Multi-tenant isolated Eleventy (11ty v3) static site generation
   - FIFO sequential BuildQueue serialization (race condition prevention)
   - Zero-Retention Local Media Storage Policy: Ephemeral staging followed by immediate post-deploy disk wipe (0 bytes server retention)

5. **[Semantic BEM Theming & Custom CSS Guide](file:///Users/timwasson/antigravity/Neogram---90s-Retro-Social-Publishing/docs/custom-styling.md)**
   - Dual styling strategy: Workstation utility classes vs. static deliverable BEM
   - BEM class hierarchy (`.neogram-site`, `.neogram-grid`, `.neogram-card`, `.neogram-detail`, `.neogram-comments`, `.neogram-btn`)
   - Custom CSS injection (`custom_css_url` in Settings)
   - Drop-in stylesheet templates (Neon Cyberpunk, Windows 95 Silver, Apple System 7 Platinum)

6. **[Neogram Instant Messenger (NIM) & WebExtension MV3](file:///Users/timwasson/antigravity/Neogram---90s-Retro-Social-Publishing/docs/buddylist-chat.md)**
   - AIM/ICQ-style floating chat window and buddy list
   - WebSockets `/ws/chat` router with presence telemetry
   - Ephemeral store-and-forward queue with immediate hard-deletion upon delivery
   - Zero server retention contract: 100% client storage (`localStorage` / `chrome.storage.local`)
   - Manifest V3 Chrome Extension installation and pairing

7. **[Cyberspace Friends Network & Static Grid Guide](file:///Users/timwasson/antigravity/Neogram---90s-Retro-Social-Publishing/docs/friends.md)**
   - Connect with creators using simple "Friends"
   - 1-click "Add Friend" on station profiles and static Neocities gallery headers
   - Dedicated workstation Friends console (`/friends`) with buddy roster and photo feed
   - Static photo grid compilation at `/friends/index.html` with cross-domain asset resolution
   - Concurrency-safe cascading FIFO rebuild queue when friends broadcast new photographs

8. **[Cyber Notification Dispatcher & Alert Protocols](file:///Users/timwasson/antigravity/Neogram---90s-Retro-Social-Publishing/docs/notifications.md)**
   - Configurable event matrix across 8 retro-social triggers
   - User preferences dashboard (`[:> NOTIFICATION_DISPATCHER.CFG]`) in Workstation Settings
   - 8-bit Web Audio alert chimes & native desktop/PWA push permission request
   - Real-time WebSocket delivery & offline persistent inbox
   - Zero-retention chat privacy invariant for NIM direct messages

---

## Architectural Principles

Neogram was built around three non-negotiable core invariants:

```
+-----------------------------------------------------------------------------+
|                               NEOGRAM PHILOSOPHY                            |
+-----------------------------------------------------------------------------+
|  1. ZERO-RETENTION STORAGE     Neogram never acts as a permanent media host.  |
|                                Photos are processed into WebP, deployed     |
|                                directly to your static host, and wiped      |
|                                immediately from local disk (0 bytes).       |
|                                                                             |
|  2. SAFE SUBDIRECTORIES        Neogram compiles under `/neogram/` by default.|
|                                Your existing homepages, blogs, stylesheets, |
|                                and custom files are never overwritten.      |
|                                                                             |
|  3. PERMANENT NODE UIN         Every station receives an immutable numeric  |
|                                ID (#100101+). You can freely edit your call |
|                                sign (@handle) without breaking external     |
|                                embeds or guestbook signatures.              |
+-----------------------------------------------------------------------------+
```

---

## Workstation Access

- **Live Web Workstation:** [http://localhost:4000](http://localhost:4000) (or your deployment URL)
- **Cyberspace User Directory:** [/directory](http://localhost:4000/directory)
- **Interactive Documentation Portal:** [/docs](http://localhost:4000/docs)
