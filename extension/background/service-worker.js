/**
 * Neogram AIM Messenger - Manifest V3 Background Service Worker
 * Handles badge counters, notifications, and storage synchronization.
 */

// MV3 workers can't hold a socket open, so the toolbar badge is refreshed by polling the
// server's unread-notification count on an alarm (and whenever the browser starts).
async function refreshUnreadBadge() {
  try {
    const data = await chrome.storage.local.get(['neogram_token', 'neogram_server_url']);
    if (!data.neogram_token) {
      await chrome.action.setBadgeText({ text: '' });
      return;
    }
    const serverUrl = (data.neogram_server_url || 'https://neogram.club').replace(/\/+$/, '');
    const res = await fetch(serverUrl + '/api/notifications', {
      headers: { Authorization: 'Bearer ' + data.neogram_token },
    });
    if (!res.ok) return;
    const body = await res.json();
    const count = Number(body && body.unreadCount) || 0;
    await chrome.storage.local.set({ neogram_unread_count: count });
    await chrome.action.setBadgeBackgroundColor({ color: '#ff3300' });
    await chrome.action.setBadgeText({ text: count > 0 ? (count > 99 ? '99+' : String(count)) : '' });
  } catch (err) {
    console.warn('[:> AIM EXTENSION] Badge refresh failed:', err && err.message);
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.action.setBadgeText({ text: '' });
  chrome.alarms.create('neogram_pulse', { periodInMinutes: 5 });
  refreshUnreadBadge();
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create('neogram_pulse', { periodInMinutes: 5 });
  refreshUnreadBadge();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'neogram_pulse') refreshUnreadBadge();
});

// Scoped Cyber-Pass cache: origin -> { token, handle, uin, avatar, expiresAt }
const passCache = new Map();

/**
 * Exchanges the stored session JWT for a 1h, social-only Cyber-Pass bound to `origin`.
 * The session JWT itself is never handed to web pages.
 */
async function mintPassForOrigin(origin) {
  const cached = passCache.get(origin);
  if (cached && cached.expiresAt > Date.now()) return cached;

  const data = await chrome.storage.local.get(['neogram_token', 'neogram_server_url']);
  if (!data.neogram_token) return null;
  const serverUrl = (data.neogram_server_url || 'https://neogram.club').replace(/\/+$/, '');

  const res = await fetch(serverUrl + '/api/auth/pass-token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + data.neogram_token },
    body: JSON.stringify({ origin }),
  });
  if (!res.ok) return null;
  const body = await res.json();
  if (!body || !body.ok || !body.token) return null;
  const entry = {
    token: body.token,
    handle: body.handle,
    uin: body.uin || null,
    avatar: body.avatar || '',
    expiresAt: Date.now() + 50 * 60 * 1000,
  };
  passCache.set(origin, entry);
  return entry;
}

// Message listener from popup and content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    // Messages from web-page content scripts may only request a scoped pass
    if (sender && sender.tab && message.type !== 'NEOGRAM_MINT_PASS') {
      sendResponse({ ok: false, error: 'Not allowed from content scripts' });
      return;
    }
    if (message.type === 'NEOGRAM_MINT_PASS') {
      // Derive the origin from the browser-attested sender, never from the message body
      let origin = '';
      try {
        origin = sender && sender.url ? new URL(sender.url).origin : '';
      } catch {
        origin = '';
      }
      if (!sender || !sender.tab || sender.frameId !== 0 || !/^https?:\/\//.test(origin)) {
        sendResponse({ ok: false });
        return;
      }
      // Zero-click passes would bypass the /auth/connect consent screen for ANY *.neocities.org /
      // *.nekoweb.org page (anyone can register one). Only origins the user explicitly approved get one.
      const { neogram_bridge_origins: approved } = await chrome.storage.local.get(['neogram_bridge_origins']);
      if (!Array.isArray(approved) || !approved.includes(origin)) {
        sendResponse({ ok: false, error: 'Origin not approved' });
        return;
      }
      try {
        const pass = await mintPassForOrigin(origin);
        sendResponse(pass ? { ok: true, ...pass } : { ok: false });
      } catch {
        sendResponse({ ok: false });
      }
    } else if (message.type === 'UPDATE_BADGE') {
      const count = message.count || 0;
      await chrome.storage.local.set({ neogram_unread_count: count });
      if (count > 0) {
        await chrome.action.setBadgeText({ text: String(count) });
        await chrome.action.setBadgeBackgroundColor({ color: '#ff3300' });
      } else {
        await chrome.action.setBadgeText({ text: '' });
      }
      sendResponse({ ok: true });
    } else if (message.type === 'SHOW_NOTIFICATION') {
      if (chrome.notifications) {
        chrome.notifications.create({
          type: 'basic',
          iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
          title: `AIM: Message from @${message.from}`,
          message: message.text || 'New instant message received.',
          priority: 2,
        });
      }
      sendResponse({ ok: true });
    } else {
      sendResponse({ ok: false, error: 'Unknown message type' });
    }
  })();
  return true; // Keep message channel open for async response
});
