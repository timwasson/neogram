/**
 * Neogram PWA Engine (v1.0)
 * Service Worker lifecycle, Install Prompt handler, and Offline Carrier Telemetry.
 */
(function (window, document) {
  'use strict';

  var deferredInstallPrompt = null;

  var NeogramPWA = {
    init: function () {
      this.registerServiceWorker();
      this.bindInstallPrompt();
      this.bindNetworkStatus();
      this.initIndexedDb();
    },

    registerServiceWorker: function () {
      if ('serviceWorker' in navigator) {
        window.addEventListener('load', function () {
          navigator.serviceWorker.register('/sw.js', { scope: '/' })
            .then(function (reg) {
              console.log('[:> PWA // CARRIER] Service Worker registered. Scope:', reg.scope);
              // Force update check on every load
              reg.update();
            })
            .catch(function (err) {
              console.warn('[:> PWA // REGISTRATION FAILED]', err);
            });
        });

        navigator.serviceWorker.addEventListener('message', function (event) {
          if (event.data && event.data.type === 'CARRIER_RESTORED') {
            NeogramPWA.onCarrierRestored();
          }
          if (event.data && event.data.type === 'CACHE_UPDATED') {
            console.log('[:> PWA // CARRIER] Clean shell cache activated. Reloading workstation...');
            window.location.reload();
          }
        });
      }
    },

    bindInstallPrompt: function () {
      var self = this;
      var installBtn = document.getElementById('pwaInstallBtn');

      window.addEventListener('beforeinstallprompt', function (e) {
        // Prevent default mini-infobar on mobile
        e.preventDefault();
        deferredInstallPrompt = e;

        if (installBtn) {
          installBtn.classList.remove('hidden');
          installBtn.addEventListener('click', function () {
            self.triggerInstall();
          });
        }
      });

      window.addEventListener('appinstalled', function () {
        console.log('[:> PWA] Neogram workstation application installed.');
        deferredInstallPrompt = null;
        if (installBtn) installBtn.classList.add('hidden');
        if (window.retroAudio) window.retroAudio.playSuccess();
      });
    },

    triggerInstall: async function () {
      if (!deferredInstallPrompt) return;
      if (window.retroAudio) window.retroAudio.playClick();

      deferredInstallPrompt.prompt();
      var choice = await deferredInstallPrompt.userChoice;
      console.log('[:> PWA INSTALL CHOICE]', choice.outcome);
      deferredInstallPrompt = null;
      var installBtn = document.getElementById('pwaInstallBtn');
      if (installBtn) installBtn.classList.add('hidden');
    },

    bindNetworkStatus: function () {
      var self = this;
      window.addEventListener('online', function () {
        self.updateCarrierTelemetry(true);
        self.flushOfflineBuffer();
      });

      window.addEventListener('offline', function () {
        self.updateCarrierTelemetry(false);
      });

      // Initial check
      this.updateCarrierTelemetry(navigator.onLine);
    },

    updateCarrierTelemetry: function (isOnline) {
      var panel = document.getElementById('taskbarCom2Panel');
      if (panel) {
        if (isOnline) {
          panel.innerHTML = '<span class="text-prompt font-bold">● COM2: 28.8k V.34</span> <span class="text-xs">[CARRIER: OK]</span>';
        } else {
          panel.innerHTML = '<span class="text-crimson font-bold">✕ COM2: NO CARRIER</span> <span class="text-xs text-yellow">[OFFLINE]</span>';
          if (window.retroAudio) window.retroAudio.playDialupBeep();
        }
      }
    },

    onCarrierRestored: function () {
      console.log('[:> PWA] Network carrier restored.');
      this.updateCarrierTelemetry(true);
      this.flushOfflineBuffer();
    },

    // -------------------------------------------------------------
    // INDEXEDDB OFFLINE BUFFER
    // -------------------------------------------------------------
    db: null,
    initIndexedDb: function () {
      var self = this;
      if (!window.indexedDB) return;

      var req = indexedDB.open('neogram_pwa_db', 1);
      req.onupgradeneeded = function (e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains('offline_posts')) {
          db.createObjectStore('offline_posts', { keyPath: 'id' });
        }
      };
      req.onsuccess = function (e) {
        self.db = e.target.result;
        if (navigator.onLine) self.flushOfflineBuffer();
      };
    },

    bufferOfflinePost: function (postData, callback) {
      if (!this.db) {
        if (callback) callback(new Error('IndexedDB not ready'));
        return;
      }
      var tx = this.db.transaction('offline_posts', 'readwrite');
      var store = tx.objectStore('offline_posts');
      var id = 'offline_' + Date.now();
      postData.id = id;
      postData.createdAt = new Date().toISOString();
      store.add(postData);

      tx.oncomplete = function () {
        console.log('[:> PWA] Post buffered in offline IndexedDB:', id);
        if (callback) callback(null, id);
      };
      tx.onerror = function (e) {
        if (callback) callback(e);
      };
    },

    // Sends queued posts one at a time. An item is deleted only after the server accepts it (2xx)
    // or definitively rejects it (4xx other than 401/408/429). Network errors stop the run and
    // leave the rest queued for the next reconnect.
    _flushing: false,
    flushOfflineBuffer: function () {
      var self = this;
      if (!this.db || this._flushing || !navigator.onLine || !window.fetch) return;
      this._flushing = true;

      var readTx = this.db.transaction('offline_posts', 'readonly');
      var getAll = readTx.objectStore('offline_posts').getAll();
      getAll.onerror = function () { self._flushing = false; };
      getAll.onsuccess = function () {
        var items = (getAll.result || []).sort(function (a, b) { return String(a.createdAt).localeCompare(String(b.createdAt)); });
        if (items.length === 0) { self._flushing = false; return; }
        self.notify('info', 'Back online', 'Uploading ' + items.length + ' photo post' + (items.length > 1 ? 's' : '') + ' saved while you were offline...');

        var sent = 0;
        var failed = [];
        var next = function (idx) {
          if (idx >= items.length) {
            self._flushing = false;
            if (sent > 0) self.notify('success', 'Offline posts published', sent + ' post' + (sent > 1 ? 's' : '') + ' uploaded to your site.');
            if (failed.length > 0) self.notify('error', "Some offline posts couldn't be published", failed.join(' '));
            return;
          }
          var item = items[idx];
          var form = new FormData();
          form.append('caption', item.caption || '');
          form.append('filterApplied', item.filterApplied || 'none');
          if (item.siteId) form.append('siteId', item.siteId);
          var files = Array.isArray(item.files) ? item.files : [];
          if (files.length > 0) {
            files.forEach(function (f, n) { form.append('imageFiles', f, (f && f.name) || ('offline-' + n + '.jpg')); });
          } else if (item.imageBase64) {
            form.append('imageBase64', item.imageBase64);
          } else {
            self.deleteBuffered(item.id);
            next(idx + 1);
            return;
          }

          fetch('/api/posts', { method: 'POST', body: form, credentials: 'same-origin' })
            .then(function (res) {
              return res.json().catch(function () { return {}; }).then(function (data) {
                if (res.ok) {
                  sent++;
                  self.deleteBuffered(item.id);
                } else if (res.status === 401 || res.status === 408 || res.status === 429 || res.status >= 500) {
                  // Keep it: sign-in expired or the server is busy. Try again on the next reconnect.
                  failed.push((data && data.error) || ('Server returned ' + res.status + '; will retry later.'));
                  self._flushing = false;
                  idx = items.length; // stop this run
                } else {
                  failed.push((data && data.error) || ('A post was rejected (' + res.status + ').'));
                  self.deleteBuffered(item.id);
                }
                next(idx + 1);
              });
            })
            .catch(function () {
              // Still offline / connection dropped mid-upload: leave the rest queued.
              self._flushing = false;
            });
        };
        next(0);
      };
    },

    deleteBuffered: function (id) {
      if (!this.db) return;
      try {
        this.db.transaction('offline_posts', 'readwrite').objectStore('offline_posts').delete(id);
      } catch (_e) {}
    },

    notify: function (kind, title, msg) {
      if (typeof window.showAlert === 'function') {
        try { window.showAlert(kind, title, msg); return; } catch (_e) {}
      }
      console.log('[:> PWA] ' + title + ': ' + msg);
    },
  };

  window.NeogramPWA = NeogramPWA;
  NeogramPWA.init();
})(window, document);
