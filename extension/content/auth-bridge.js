/**
 * Neogram WebExtension - Content Script Auth Bridge
 *
 * Hands a Neogram-enabled static site a SCOPED Cyber-Pass so the visitor is signed in with 0 clicks.
 *
 * Security model:
 *  - The full workstation session JWT never leaves the extension. The background worker exchanges it
 *    for a short-lived (1h) `pass` token (social actions only: likes, comments, guestbook, pager),
 *    minted by the server for this page's exact origin.
 *  - The pass is posted to this page's own origin only (never '*'), so cross-origin frames and
 *    openers cannot read it.
 *  - Only top-level documents are served (no iframes injected by third parties).
 */
(function () {
  'use strict';

  if (window.top !== window) return;
  if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) return;

  var origin = window.location.origin;
  if (!/^https?:\/\//.test(origin)) return;

  function broadcastSession() {
    chrome.runtime.sendMessage({ type: 'NEOGRAM_MINT_PASS' }, function (resp) {
      if (chrome.runtime.lastError || !resp || !resp.ok || !resp.token) return;
      window.postMessage(
        {
          type: 'NEOGRAM_EXTENSION_PASS',
          token: resp.token,
          handle: resp.handle,
          uin: resp.uin || null,
          avatar: resp.avatar || '',
        },
        origin
      );
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', broadcastSession);
  } else {
    broadcastSession();
  }

  // Explicit inquiry from the page itself (same window, same origin only)
  window.addEventListener('message', function (event) {
    if (event.source !== window || event.origin !== origin) return;
    if (event.data && event.data.type === 'QUERY_NEOGRAM_EXTENSION') {
      broadcastSession();
    }
  });
})();
