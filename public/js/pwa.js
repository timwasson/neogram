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
            })
            .catch(function (err) {
              console.warn('[:> PWA // REGISTRATION FAILED]', err);
            });
        });

        navigator.serviceWorker.addEventListener('message', function (event) {
          if (event.data && event.data.type === 'CARRIER_RESTORED') {
            NeogramPWA.onCarrierRestored();
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

    flushOfflineBuffer: function () {
      if (!this.db) return;
      var tx = this.db.transaction('offline_posts', 'readonly');
      var store = tx.objectStore('offline_posts');
      var getAll = store.getAll();

      getAll.onsuccess = function () {
        var items = getAll.result || [];
        if (items.length === 0) return;

        console.log('[:> PWA] Found ' + items.length + ' offline buffered posts to synchronize.');
        // Notify user via alert
        alert('[:> CARRIER RESTORED] Synchronizing ' + items.length + ' offline photo posts...');
      };
    },
  };

  window.NeogramPWA = NeogramPWA;
  NeogramPWA.init();
})(window, document);
