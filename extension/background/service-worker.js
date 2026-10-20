/**
 * Neogram AIM Messenger - Manifest V3 Background Service Worker
 * Handles badge counters, notifications, and storage synchronization.
 */

// Initialize on extension installation
chrome.runtime.onInstalled.addListener(async () => {
  console.log('[:> AIM EXTENSION] Service Worker installed.');
  await chrome.action.setBadgeBackgroundColor({ color: '#000080' });
  await chrome.action.setBadgeText({ text: '' });
  
  // Set up a 15-minute alarm for periodic status checks
  chrome.alarms.create('neogram_pulse', { periodInMinutes: 15 });
});

// Periodic alarm handler
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'neogram_pulse') {
    const data = await chrome.storage.local.get(['neogram_token', 'neogram_unread_count']);
    if (data.neogram_unread_count && data.neogram_unread_count > 0) {
      await chrome.action.setBadgeText({ text: String(data.neogram_unread_count) });
      await chrome.action.setBadgeBackgroundColor({ color: '#ff3300' });
    }
  }
});

// Message listener from popup
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    if (message.type === 'UPDATE_BADGE') {
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
