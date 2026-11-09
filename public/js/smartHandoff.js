/**
 * Neogram Smart Handoff Client Controller
 * ========================================
 * Bridges authenticated PWA sessions into the native mobile browser (Safari/Chrome)
 * and remote static sites (Neocities, Nekoweb, GitHub Pages) without re-authenticating.
 */
(function (window, document) {
  'use strict';

  function isPWAStandalone() {
    return Boolean(
      window.navigator.standalone ||
      (window.matchMedia && (
        window.matchMedia('(display-mode: standalone)').matches ||
        window.matchMedia('(display-mode: window-controls-overlay)').matches ||
        window.matchMedia('(display-mode: fullscreen)').matches ||
        window.matchMedia('(display-mode: minimal-ui)').matches
      ))
    );
  }

  function isExternalStationUrl(urlStr) {
    if (!urlStr || typeof urlStr !== 'string') return false;
    if (urlStr.startsWith('/') || urlStr.startsWith('#') || urlStr.startsWith('javascript:')) return false;

    try {
      var u = new URL(urlStr, window.location.href);
      if (u.origin === window.location.origin) return false;
      return (
        u.hostname.indexOf('neocities.org') !== -1 ||
        u.hostname.indexOf('nekoweb.org') !== -1 ||
        u.hostname.indexOf('github.io') !== -1 ||
        u.protocol === 'http:' ||
        u.protocol === 'https:'
      );
    } catch (_e) {
      return false;
    }
  }

  function openSmartHandoff(targetUrl, event) {
    if (window.retroAudio && typeof window.retroAudio.playClick === 'function') {
      try { window.retroAudio.playClick(); } catch (_e) {}
    }

    if (!targetUrl) return false;

    // If link is not external, let it behave normally
    if (!isExternalStationUrl(targetUrl)) {
      return true;
    }

    // In PWA standalone mode (or mobile), intercept and route through /auth/handoff
    if (isPWAStandalone()) {
      if (event) {
        event.preventDefault();
        event.stopPropagation();
      }

      fetch('/api/auth/handoff-ticket', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: targetUrl }),
      })
        .then(function (res) {
          return res.json();
        })
        .then(function (data) {
          var destination = (data && data.ok && data.handoffUrl) ? data.handoffUrl : targetUrl;
          var opened = window.open(destination, '_system');
          if (!opened) {
            opened = window.open(destination, '_blank', 'noopener,noreferrer');
          }
          if (!opened) {
            window.location.assign(destination);
          }
        })
        .catch(function () {
          var opened = window.open(targetUrl, '_system');
          if (!opened) {
            window.open(targetUrl, '_blank', 'noopener,noreferrer');
          }
        });

      return false;
    }

    // In normal browser desktop tab: let the link open normally
    return true;
  }

  // Global exports
  window.openSmartHandoff = openSmartHandoff;
  window.openInNativeBrowser = openSmartHandoff;
  window.isPWAStandalone = isPWAStandalone;

  // Intercept click events for external links when running inside PWA
  document.addEventListener('click', function (e) {
    if (!isPWAStandalone()) return;

    var targetAnchor = e.target.closest('a');
    if (!targetAnchor || !targetAnchor.href) return;

    // Check if link explicitly opts in or points to external station
    var href = targetAnchor.getAttribute('href');
    if (!href || href.startsWith('#') || href.startsWith('javascript:')) return;

    if (isExternalStationUrl(targetAnchor.href)) {
      openSmartHandoff(targetAnchor.href, e);
    }
  }, false);
})(window, document);

