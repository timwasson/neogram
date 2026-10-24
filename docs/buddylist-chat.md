# Neogram Instant Messenger (NIM) & Chat Extension

**Neogram Instant Messenger (NIM)** brings back classic 90s instant messaging (emulating legendary platforms like AIM, ICQ, and MSN Messenger) with buddy lists, customizable away status messages, 8-bit sound chimes, and a Manifest V3 browser extension.

---

## 1. NIM Architecture & Privacy Invariant (Zero Server Retention)

Neogram adheres to a strict **Zero Server Retention** contract for all user communications:

```
+-------------------------------------------------------------------------+
|                  NIM ZERO SERVER RETENTION ARCHITECTURE                 |
+-------------------------------------------------------------------------+
|                                                                         |
|  [ Sender ] ──(WebSocket /ws/chat)──> [ In-Memory WebSocket Router ]    |
|                                                │                        |
|                        ┌───────────────────────┴───────────────────────┐|
|                        ▼                                               ▼|
|              [ Recipient Online ]                            [ Recipient Offline ]
|                        │                                               │
|                        ▼                                               ▼
|         Direct In-Memory Delivery                      Staged in Ephemeral Queue
|           (Zero Server Storage)                      (ephemeral_chat_queue)
|                        │                                               │
|                        │                             Recipient Connects!
|                        │                                               │
|                        │                             Delivered & IMMEDIATELY
|                        │                             HARD-DELETED FROM DB
|                        │                             (Zero Server Retention)
|                        ▼                                               ▼
|         [ 100% Client-Side Retention in LocalStorage / chrome.storage.local ]
+-------------------------------------------------------------------------+
```

### Key Security Invariants:
1. **Zero Permanent Server Logs:** The Neogram PostgreSQL database **never** permanently stores chat transcripts.
2. **Ephemeral Store-and-Forward:** If a recipient is offline, the message is staged temporarily in `ephemeral_chat_queue` with a 24-hour expiration timer.
3. **Immediate Hard-Deletion Contract:** The instant the recipient establishes a connection, the queued messages are delivered and **immediately hard-deleted** (`DELETE FROM ephemeral_chat_queue WHERE id = ANY(...)`). Queue count returns to 0.
4. **100% User-Controlled History:** All message logs reside solely in the user's browser client storage (`localStorage.getItem('neogram_im_' + handle)` or `chrome.storage.local`). Users can export their logs as JSON or wipe them with one click.

---

## 2. Using NIM in the Workstation

### Floating Window UX
- Click the **💬 NIM** button in the top navigation bar or the desktop taskbar to summon the messenger window.
- The window is elevated above the taskbar safe zone (`bottom: 54px`) to prevent covering retro system tray controls.

### Buddy List & Cyberspace Directory
- Add friends by their cyber call-sign (`@handle`) or numeric UIN (`#100101`).
- Browse active transmitters in the [Cyberspace User Directory](/directory).
- Telemetry indicators display **🟢 Active**, **🟡 Away**, or **⚪ Inactive** presence.

### Sound Chimes & Synthesis
- Audio effects are synthesized in real time via the Web Audio API (`retroAudio.js`):
  - *Door Open / Chime:* When a buddy signs online
  - *Instant Message Sound:* Classic incoming ICQ "Uh-oh!" / 8-bit ping
  - *Door Close:* When a buddy goes offline
- Audio can be muted or unmuted at any time using the **♫ AUDIO** button in the bottom taskbar.

---

## 3. Chrome / Edge Manifest V3 Browser Extension

Neogram includes a dedicated browser extension (`extension/`) that lets you stay connected to NIM from any web page without keeping the workstation tab open.

```
+-------------------------------------------------------------+
|  NEOGRAM AIM EXTENSION (MANIFEST V3)                        |
+-------------------------------------------------------------+
|  - Classic 90s AIM Buddy List Popup in Chrome Toolbar       |
|  - Real-time unread badge counter                           |
|  - Desktop sound chimes for incoming transmissions          |
|  - Quick-connect Cyber-Pass SSO token exchange              |
+-------------------------------------------------------------+
```

### Installation Steps (Developer Mode):
1. Open Google Chrome, Brave, or Microsoft Edge.
2. Navigate to `chrome://extensions/` in the URL bar.
3. Enable the **"Developer mode"** toggle in the top-right corner.
4. Click **"Load unpacked"** in the top-left toolbar.
5. Select the `extension/` folder inside the Neogram project repository:
   ```
   /Users/.../Neogram---90s-Retro-Social-Publishing/extension
   ```
6. The Neogram retro icon (💬) will appear in your browser extension toolbar!

### Pairing Your Station:
1. Click the extension icon in your browser toolbar.
2. Click **"CONNECT TO STATION"**.
3. It will open the Cyber-Pass handshake window at `/auth/connect`, authorizing the extension to connect to your station.
4. Your buddy list and status message will instantly sync.

---

## 4. Extension Developer Tooling

- `npm run extension:sync`: Automatically syncs the latest compiled CSS (`public/css/neogram.css` $\rightarrow$ `extension/shared/neogram.css`) and audio engine (`public/js/retroAudio.js` $\rightarrow$ `extension/shared/retroAudio.js`) so the extension never drifts from the workstation.
- `npm run extension:package`: Syncs shared assets and packages the extension into `neogram-aim-extension.zip` ready for Chrome Web Store publishing.
