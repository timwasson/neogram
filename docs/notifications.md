# Cyber Notification Dispatcher & Alert Protocols

Neogram features a real-time, multi-channel notification engine that bridges static website social activity (Neocities, GitHub Pages, self-hosted static servers) and the Neogram Workstation.

---

## 1. Notification Event Matrix

Neogram monitors and dispatches notifications across 8 configurable retro-social event categories:

| Event Type | Identifier | Trigger Condition | Default |
|---|---|---|---|
| **NIM Direct Messages** | `nim` | Another user sends you an instant transmission via Neogram Instant Messenger (`/ws/chat`) | **Enabled** |
| **New Friend Follow** | `follow` | A fellow creator adds your station to their Cyberspace Friends network | **Enabled** |
| **Photo Comments** | `comment_own` | A visitor or fellow creator comments on one of your published photos | **Enabled** |
| **Thread Participation** | `comment_thread` | A photo you previously participated in receives additional replies | **Enabled** |
| **Guestbook Signatures** | `guestbook` | A visitor signs your station guestbook ledger | **Enabled** |
| **Photo Likes & Reactions** | `like` | A visitor clicks "LIKE" on one of your published photos | **Enabled** |
| **Friend Photo Broadcasts** | `friend_post` | A creator you follow broadcasts a new photograph to their gallery | **Enabled** |
| **Deploy Status** | `deploy` | Background 11ty static compilation and Neocities deployment completes | **Enabled** |

---

## 2. User Preferences Dashboard (`[:> NOTIFICATION_DISPATCHER.CFG]`)

Every registered station has granular control over their incoming alerts. In the Workstation **Settings** tab (`#settings`), under **Cyber Alert Protocols (`NOTIFICATION_DISPATCHER.CFG`)**, users can:

1. **Toggle Individual Event Categories:** Turn on or off any of the 8 event types. When an event is muted, the server suppresses all dispatch logic—creating 0 database rows and emitting 0 socket packets.
2. **Toggle 8-Bit Audio Chimes (`sound_enabled`):** Enable or mute client-side Web Audio API alert tones synthesized via `retroAudio.playAlertBeep(880, 0.1)`.
3. **Toggle Desktop & PWA Push Notifications (`desktop_push`):** Request native operating system push permission. When granted, notifications appear on desktop or mobile lock screens even when the browser tab is minimized or operating as an installed Progressive Web App (PWA).

### REST Endpoints
- `GET /api/settings/notifications`: Retrieves current preferences (returns JSON with all 10 booleans). Default preferences are automatically provisioned if not yet created.
- `PUT /api/settings/notifications`: Updates preferences. Payload:
  ```json
  {
    "notifyNim": true,
    "notifyFollow": true,
    "notifyCommentOwn": true,
    "notifyCommentThread": true,
    "notifyGuestbook": true,
    "notifyLike": false,
    "notifyFriendPost": true,
    "notifyDeploy": true,
    "soundEnabled": true,
    "desktopPush": false
  }
  ```

---

## 3. Real-Time Delivery Pipeline

```
+-------------------------------------------------------------+
|                     EVENT OCCURRENCE                         |
| (NIM DM, Comment, Follow, Guestbook, Like, Broadcast, Deploy)|
+-------------------------------------------------------------+
                              |
                              v
+-------------------------------------------------------------+
|                  NOTIFICATION DISPATCHER                    |
|             (server/services/notificationService.ts)        |
+-------------------------------------------------------------+
                              |
              +---------------+---------------+
              |                               |
       [Category Disabled]             [Category Enabled]
              |                               |
              v                               v
    +-------------------+           +-------------------+
    |    SUPPRESSED     |           |   INSERT DB ROW   |
    |  0 rows, 0 msgs   |           |  (notifications)  |
    +-------------------+           +-------------------+
                                              |
                                              v
                                    +-------------------+
                                    | WEBSOCKET ACTIVE? |
                                    +-------------------+
                                      /               \
                                   [Yes]              [No]
                                    /                   \
                                   v                     v
                        +--------------------+    +-------------+
                        | ROUTE WS PACKET    |    | REMAINS IN  |
                        | { type: 'notification' } | INBOX AS   |
                        | + Audio Beep       |    | UNREAD (1)  |
                        | + Desktop Push     |    +-------------+
                        +--------------------+
```

1. **Suppression Check:** Before doing any work, `dispatchNotification()` checks the recipient's `notification_preferences`. If the category is disabled, execution exits cleanly.
2. **Persistent Inbox:** If enabled, a record is added to the `notifications` table (`is_read = FALSE`).
3. **Immediate WebSocket Relay:** If the user has an active connection on `/ws/chat`, the server pushes `{ type: 'notification', notification: { ... } }` in real-time.
4. **Offline Resilience:** If offline, the unread count awaits the user on their next workstation login.

---

## 4. Header Notification Center (`[:> NOTIFY_CENTER.SYS]`)

The fixed top navigation bar displays a dedicated bell icon (`#notifyMenuBtn`) with a high-contrast phosphor badge (`#navNotifyBadge`).

- Clicking opens the retro drawer menu (`#notifyDropdownMenu`).
- Shows the last 15 alerts in reverse-chronological order.
- Clicking any notification item automatically navigates to the associated destination (`link_url`), such as the photo page, profile, or guestbook.
- `[✓ Mark All Read]` marks all entries read in PostgreSQL (`POST /api/notifications/read-all`).

---

## 5. Zero-Retention Chat Privacy Invariant

Neogram strictly enforces a **Zero Server Retention** invariant for chat:
- In-memory WebSockets route chat messages between users without saving transcripts.
- Notification records for NIM transmissions strictly store sender handle metadata (e.g. `title: "New NIM Transmission"`, `body: "@handle sent you a transmission"`).
- **Message body text is NEVER written to PostgreSQL**, ensuring that 0 bytes of conversation data persist on the server.
