/**
 * Neogram WebExtension - Content Script Auth Bridge
 * Automatically broadcasts the user's active Cyber-Pass session to Neogram-enabled static sites
 * (Neocities, Nekoweb, localhost) so the user is authenticated with 0 clicks!
 */
(function () {
  'use strict';

  function broadcastSession() {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
      return;
    }

    chrome.storage.local.get(
      ['neogram_token', 'neogram_handle', 'neogram_uin', 'neogram_avatar'],
      (data) => {
        if (chrome.runtime.lastError) return;
        if (data && data.neogram_token && data.neogram_handle) {
          window.postMessage(
            {
              type: 'NEOGRAM_EXTENSION_PASS',
              token: data.neogram_token,
              handle: data.neogram_handle,
              uin: data.neogram_uin || null,
              avatar: data.neogram_avatar || '💬',
            },
            '*'
          );
        }
      }
    );
  }

  // Broadcast when DOM is interactive and when page loads
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', broadcastSession);
  } else {
    broadcastSession();
  }

  // Also listen for explicit page inquiry
  window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'QUERY_NEOGRAM_EXTENSION') {
      broadcastSession();
    }
  });
})();
