# Chrome Web Store Listing: Neogram AIM Messenger

This document contains all metadata, descriptions, permissions justifications, and privacy disclosures required to publish the Neogram AIM browser extension to the Chrome Web Store.

---

## 1. Store Listing Metadata

| Field | Value | Constraints |
|---|---|---|
| **Extension Name** | `Neogram AIM Messenger` | Max 45 characters |
| **Short Description** | `Retro 90s AIM/ICQ instant messenger client for Neogram cyber-publishers and static web enthusiasts.` | Max 132 characters |
| **Category** | `Social & Communication` | Chrome Store Taxonomy |
| **Default Language** | `English (United States)` | ISO 639-1 |
| **Primary Website** | `http://localhost:4000/` (or production domain) | Live URL |
| **Support URL** | `http://localhost:4000/embed/guestbook/root` | Live URL |

---

## 2. Detailed Store Description

```text
Step back into the golden age of the web with Neogram AIM Messenger — a classic 1990s-inspired instant messaging companion for personal web creators, Neocities denizens, and cyber-publishers.

FEATURES:
• Classic 90s Desktop Aesthetic: Modeled after System 7 and AIM 97 with CRT scanline styling and retro window controls.
• Real-Time Presence: See when friends in your webring come online or step away with classic green and yellow presence indicators.
• Synthesized Retro Audio: Authentic synthesized Web Audio sound effects including the iconic door open chime, door slam thump, sparkling message bell, and send click.
• Zero-Server Privacy: Your chat history is stored 100% locally on your computer. Messages travel directly through temporary memory and are never permanently stored in an external database.
• Away Messages & Status: Write retro away messages and set auto-responses for when you are away from your workstation.
• Chat Log Export: Export your conversations anytime as JSON or purge local history with one click.
• Baud Rate Dial-Up Telemetry: Vintage 300 to 56.6k baud-rate progression indicator on carrier login.

HOW TO USE:
1. Open the Neogram AIM popup from your browser toolbar.
2. Enter your Neogram user handle or email to receive a 6-digit carrier key.
3. Chat with fellow creators across the retro static web!
```

---

## 3. Permissions Justifications

The Chrome Web Store review team requires specific, user-benefit justifications for each declared permission:

| Permission | Technical Reason | Review Justification (User Benefit) |
|---|---|---|
| `storage` | `chrome.storage.local` API | Used to save your carrier login token and keep your chat conversations saved safely on your device without server-side tracking. |
| `alarms` | `chrome.alarms` API | Used to schedule background connection heartbeats so the extension knows when your buddies sign on or off without draining battery. |
| `notifications` | `chrome.notifications` API | Delivers desktop notification chimes when you receive an instant message from a buddy while the popup is closed. |
| `host_permissions` (`http://localhost:4000/*`, `https://*.neocities.org/*`) | `fetch()` and `WebSocket` | Allows the extension to authenticate with your personal Neogram carrier node and maintain real-time instant messaging. |

---

## 4. Privacy & Data Use Disclosure

- **Account Information:** Handles user email/handle strictly to authenticate against the user-designated Neogram node.
- **Communications:** Instant messages travel via WebSockets for direct delivery. **Messages are never permanently stored on the server.** Delivered messages are removed immediately from temporary memory. Long-term history exists exclusively inside the user's browser `storage.local`.
- **Analytics & Tracking:** None. Zero third-party trackers, zero advertising SDKs, zero telemetry collectors.
- **Data Sharing:** Neogram does not sell, transfer, or share any user communications or account data with third parties.

---

## 5. Version History

- **v1.0.0 (2026-10-20):** Initial Manifest V3 release featuring retro baud-rate login, online/away buddy list, direct messaging with synthesized Web Audio chimes, local-first storage, and JSON chat log export.
