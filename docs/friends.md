# Cyberspace Friends Network & Static Follow Grid Guide

> **Quick Summary:** Neogram bridges personal static sites with a centralized retro social layer using simple "Friends". Creators can follow fellow cyberspace stations, browse friends' photo transmissions from their workstation, and automatically publish a static photo stream to their Neocities site at `/friends/`.

---

## 1. Friends Philosophy

Traditional social media platforms lock your friends list and photo feed inside proprietary algorithms and centralized databases.

Neogram restores the authentic spirit of the 90s webring:
1. **Decentralized Static Deliverable:** Your friends' photos compile directly into your personal static site at `/friends/index.html` (or `/<deploy_path>/friends/index.html`). Even if Neogram goes offline, your static friends archive remains alive on Neocities.
2. **Simple Reciprocal Actions:** No complex follow-request hierarchies. Simply click **"Add Friend"** on any station profile or static gallery banner.
3. **NIM Buddy Prioritization:** Friends automatically pin to the top of your Neogram Instant Messenger buddy list (`🤝 Friends`), with live presence LEDs (🟢 Online / 🟡 Away / ⚪ Offline).

---

## 2. 1-Click "Add Friend" Integration

### A. From Public Station Profiles (`/user/:identifier`)
Every station profile in the Cyberspace Directory features a dedicated action button:
- Logged-in visitors can click `[🤝 Add Friend]` to instantly follow that creator.
- If already friends, the button renders as `[✓ Friends (Click to Unfriend)]`.

### B. From Static Neocities Gallery Banners (`index.html`)
Every Neogram-generated static gallery banner embeds an `[🤝 Add Friend]` button:
- When a fellow Neogram creator browses your static site, their local Cyber-Pass detects their station and lets them add you as a friend directly from your Neocities page.
- If they aren't logged in, clicking the button pops open the 1-click Cyber-Pass handshake window (`/auth/connect`) to authenticate and establish the friendship.

---

## 3. Workstation Friends Console (`/friends`)

The Neogram authenticated workstation provides a dedicated **Friends** console:

1. **Friends Roster (`FRIENDS_ROSTER.SYS`):**
   - Displays all followed creators with live status LED dots.
   - Quick links to their root personal website (`🌐 Site`) and Neogram profile.
   - 1-click `[✕ Unfriend]` button with instantaneous UI feedback and static site update.
2. **Friends Transmission Feed (`BROADCAST_FEED.EXE`):**
   - Reverse-chronological stream of all photographs published by your friends.
   - Preserves CRT scanlines and vintage retro shaders applied by the author.
   - Includes like counts, comment counts, timestamps, and geolocation tags.

---

## 4. Static Friends Grid (`/friends/index.html`)

When Eleventy generates your static site:
- It compiles `eleventy/src/friends.njk` to `dist/static-galleries/<userId>/friends/index.html`.
- Adheres strictly to your configured `deploy_path` (e.g. `https://<user>.neocities.org/neogram/friends/`).
- Image and thumbnail paths are resolved to fully qualified absolute URLs (`https://<friend>.neocities.org/...`) to ensure cross-domain static asset compatibility.
- Top navigation bar provides seamless switching between `[🏠 Gallery Grid]` and `[👥 Friends Grid]`.

---

## 5. Cascading Follower Rebuild Architecture

To ensure your `/friends/` static site always shows the latest photographs without manual rebuilding, Neogram features a **Cascading Rebuild Engine**:

```
[Author Station]
       │
       ▼
[POST /api/posts]  ───▶  [Publish to Author's Neocities]
       │
       ▼
[Find All Followers]  (SELECT follower_id FROM follows WHERE following_id = author)
       │
       ├───▶ [buildQueue.enqueue("CascadeFollower:Follower_1")]
       ├───▶ [buildQueue.enqueue("CascadeFollower:Follower_2")]
       └───▶ [buildQueue.enqueue("CascadeFollower:Follower_N")]
```

### Invariants:
1. **FIFO BuildQueue Serialization:** All rebuilds execute one at a time sequentially. This completely eliminates concurrency collisions on shared Eleventy template data files.
2. **Zero Resource Exhaustion:** Rebuilds run asynchronously in the background. If a creator with 50 friends publishes a photo, the 50 static sites rebuild one by one without freezing the server or hitting Neocities rate limits.
3. **Auto-Deploy Live Pushes:** For any follower with encrypted Neocities credentials, the rebuild is automatically deployed live to their Neocities space.
