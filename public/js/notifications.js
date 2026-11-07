/**
 * Neogram Cyberspace Notification Engine
 * Real-time WebSocket reception, audio chimes, native desktop/PWA alerts,
 * and persistent CRT notification inbox.
 */
(function (window) {
  'use strict';

  function formatRelativeTime(isoString) {
    if (!isoString) return '';
    try {
      var diffMs = Date.now() - new Date(isoString).getTime();
      var sec = Math.floor(diffMs / 1000);
      if (sec < 60) return 'JUST NOW';
      var min = Math.floor(sec / 60);
      if (min < 60) return min + 'M AGO';
      var hr = Math.floor(min / 60);
      if (hr < 24) return hr + 'H AGO';
      var days = Math.floor(hr / 24);
      return days + 'D AGO';
    } catch (_e) {
      return '';
    }
  }

  var NeogramNotifications = {
    unreadCount: 0,
    items: [],
    isOpen: false,

    init: function () {
      var self = this;
      this.bindDom();
      this.fetchNotifications();

      // Automatically sync PushManager subscription if notification permission is already active
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        this.syncPushSubscription();
      }

      // Close dropdown on outside click or escape
      document.addEventListener('click', function (e) {
        var menu = document.getElementById('retroNotifyMenu');
        if (menu && !menu.contains(e.target) && self.isOpen) {
          self.toggleDropdown(false);
        }
      });

      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && self.isOpen) {
          self.toggleDropdown(false);
        }
      });

      window.addEventListener('resize', function () {
        if (window.innerWidth >= 768 && self.isOpen) {
          document.body.classList.remove('mobile-notify-open');
          self.detachTouchLock();
          var backdrop = document.getElementById('notifyDropdownBackdrop');
          if (backdrop) backdrop.classList.add('hidden');
        }
      });
    },

    bindDom: function () {
      var btn = document.getElementById('notifyMenuBtn');
      if (btn) {
        var self = this;
        btn.onclick = function (e) {
          e.stopPropagation();
          if (window.retroAudio && typeof window.retroAudio.playClick === 'function') {
            window.retroAudio.playClick();
          }
          self.toggleDropdown();
        };
      }
    },

    _touchMoveHandler: null,

    attachTouchLock: function () {
      if (this._touchMoveHandler) return;
      var self = this;
      this._touchMoveHandler = function (e) {
        if (!self.isOpen || window.innerWidth >= 768) return;
        var list = document.getElementById('notifyDropdownList');
        if (list && list.contains(e.target)) {
          // Allow internal scrolling inside the notifications list
          return;
        }
        // Lock background and header/footer touch scrolling on mobile
        if (e.cancelable) {
          e.preventDefault();
        }
      };
      document.addEventListener('touchmove', this._touchMoveHandler, { passive: false });
    },

    detachTouchLock: function () {
      if (this._touchMoveHandler) {
        document.removeEventListener('touchmove', this._touchMoveHandler);
        this._touchMoveHandler = null;
      }
    },

    toggleDropdown: function (forceState) {
      var dropdown = document.getElementById('notifyDropdownMenu');
      var backdrop = document.getElementById('notifyDropdownBackdrop');
      var btn = document.getElementById('notifyMenuBtn');
      if (!dropdown) return;

      this.isOpen = typeof forceState === 'boolean' ? forceState : !this.isOpen;

      if (this.isOpen) {
        dropdown.classList.remove('hidden');
        if (backdrop) backdrop.classList.remove('hidden');
        if (btn) btn.setAttribute('aria-expanded', 'true');

        if (window.innerWidth < 768) {
          document.body.classList.add('mobile-notify-open');
          this.attachTouchLock();
        }

        // Close account dropdown if open
        if (typeof window.toggleUserMenu === 'function') {
          window.toggleUserMenu(false);
        }
        // Fetch freshest items
        this.fetchNotifications();
      } else {
        dropdown.classList.add('hidden');
        if (backdrop) backdrop.classList.add('hidden');
        if (btn) btn.setAttribute('aria-expanded', 'false');
        document.body.classList.remove('mobile-notify-open');
        this.detachTouchLock();
      }
    },

    fetchNotifications: function () {
      var self = this;
      fetch('/api/notifications?limit=25')
        .then(function (res) {
          if (!res.ok) throw new Error('HTTP ' + res.status);
          return res.json();
        })
        .then(function (data) {
          if (data && data.ok) {
            self.items = data.notifications || [];
            self.unreadCount = data.unreadCount || 0;
            self.renderBadge();
            self.renderList();
          }
        })
        .catch(function (err) {
          console.warn('[:> NOTIFY FETCH ERROR]', err);
        });
    },

    renderBadge: function () {
      var badge = document.getElementById('navNotifyBadge');
      if (!badge) return;

      if (this.unreadCount > 0) {
        badge.textContent = this.unreadCount > 99 ? '99+' : this.unreadCount;
        badge.classList.remove('hidden');
        badge.classList.add('animate-pulse');
      } else {
        badge.textContent = '0';
        badge.classList.add('hidden');
        badge.classList.remove('animate-pulse');
      }
    },

    renderList: function () {
      var container = document.getElementById('notifyDropdownList');
      if (!container) return;

      if (this.items.length === 0) {
        container.innerHTML =
          '<div class="text-xs text-muted text-center p-4 font-mono leading-relaxed">' +
          '  [● NO PENDING TRANSMISSIONS]<br />' +
          '  <span class="text-3xs text-prompt">Cyberspace station is currently quiet.</span>' +
          '</div>';
        return;
      }

      var html = '';
      for (var i = 0; i < this.items.length; i++) {
        var n = this.items[i];
        var unreadClass = !n.isRead ? 'retro-notify-item--unread' : '';
        var actorAvatar = n.actorAvatar
          ? '<img src="' + n.actorAvatar + '" class="w-4 h-4 border border-main object-cover inline-block mr-1 align-middle" alt="" />'
          : '';

        html +=
          '<div class="retro-notify-item ' + unreadClass + '" data-id="' + n.id + '" onclick="NeogramNotifications.handleClickItem(\'' + n.id + '\', \'' + (n.linkUrl || '') + '\')">' +
          '  <div class="retro-notify-item__icon"><span class="status-led ' + (!n.isRead ? 'status-led--online' : 'status-led--offline') + '"></span></div>' +
          '  <div class="retro-notify-item__content">' +
          '    <span class="retro-notify-item__title">' + actorAvatar + escapeHtml(n.title) + '</span>' +
          (n.body ? '    <span class="retro-notify-item__body">' + escapeHtml(n.body) + '</span>' : '') +
          '    <div class="flex items-center justify-between mt-1">' +
          '      <span class="retro-notify-item__time">' + formatRelativeTime(n.createdAt) + '</span>' +
          (!n.isRead ? '      <span class="text-3xs text-prompt font-bold font-mono">[UNREAD]</span>' : '') +
          '    </div>' +
          '  </div>' +
          '</div>';
      }

      container.innerHTML = html;
    },

    handleClickItem: function (id, linkUrl) {
      if (window.retroAudio && typeof window.retroAudio.playClick === 'function') {
        window.retroAudio.playClick();
      }

      // Mark as read in background
      this.markRead(id);

      // Navigate to target
      this.toggleDropdown(false);
      if (linkUrl) {
        // Special case for NIM popout
        if (linkUrl.startsWith('/#nim?user=')) {
          var userHandle = linkUrl.split('user=')[1];
          var client = window.AimClient || window.aimMessenger;
          if (client && typeof client.openChatWith === 'function') {
            client.openChatWith(userHandle);
            return;
          }
        }
        window.location.href = linkUrl;
      }
    },

    markRead: function (id) {
      var self = this;
      for (var i = 0; i < this.items.length; i++) {
        if (this.items[i].id === id) {
          if (!this.items[i].isRead) {
            this.items[i].isRead = true;
            self.unreadCount = Math.max(0, self.unreadCount - 1);
            self.renderBadge();
          }
          break;
        }
      }
      this.renderList();

      fetch('/api/notifications/' + encodeURIComponent(id) + '/read', {
        method: 'POST',
      }).catch(function (err) {
        console.warn('[:> MARK READ ERROR]', err);
      });
    },

    markAllRead: function () {
      var self = this;
      if (window.retroAudio && typeof window.retroAudio.playClick === 'function') {
        window.retroAudio.playClick();
      }

      for (var i = 0; i < this.items.length; i++) {
        this.items[i].isRead = true;
      }
      this.unreadCount = 0;
      this.renderBadge();
      this.renderList();

      fetch('/api/notifications/read-all', {
        method: 'POST',
      })
        .then(function () {
          if (window.retroAudio && typeof window.retroAudio.playSuccess === 'function') {
            window.retroAudio.playSuccess();
          }
        })
        .catch(function (err) {
          console.warn('[:> MARK ALL READ ERROR]', err);
        });
    },

    triggerDesktopNotification: function (title, options, linkUrl) {
      if (typeof window.Notification === 'undefined') {
        console.log('[:> DESKTOP NOTIFY] Window Notification is not supported in this browser.');
        return;
      }

      if (Notification.permission !== 'granted') {
        console.log('[:> DESKTOP NOTIFY] Permission is "' + Notification.permission + '" (not "granted"). Suppressing banner.');
        return;
      }

      console.log('[:> DESKTOP NOTIFY] Triggering alert banner:', title);

      var clientOpener = function () {
        window.focus();
        if (linkUrl) {
          if (linkUrl.startsWith('/#nim?user=')) {
            var u = linkUrl.split('user=')[1];
            var client = window.AimClient || window.aimMessenger;
            if (client && typeof client.openChatWith === 'function') {
              client.openChatWith(u);
              return;
            }
          }
          window.location.href = linkUrl;
        }
      };

      // 1. Direct window Notification
      try {
        var notif = new Notification(title, options);
        notif.onclick = function () {
          clientOpener();
          notif.close();
        };
        console.log('[:> DESKTOP NOTIFY] Notification spawned via window.Notification.');
        return;
      } catch (err) {
        console.warn('[:> DESKTOP NOTIFY] Notification constructor failed, attempting ServiceWorker:', err);
      }

      // 2. ServiceWorkerRegistration fallback
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.ready.then(function (reg) {
          if (reg && typeof reg.showNotification === 'function') {
            var swOptions = Object.assign({}, options, {
              data: { url: linkUrl || '/' },
              vibrate: [200, 100, 200]
            });
            return reg.showNotification(title, swOptions).then(function () {
              console.log('[:> DESKTOP NOTIFY] Spawned via ServiceWorker showNotification.');
            });
          }
        }).catch(function (swErr) {
          console.warn('[:> DESKTOP NOTIFY] ServiceWorker showNotification failed:', swErr);
        });
      }
    },

    urlBase64ToUint8Array: function (base64String) {
      var padding = '='.repeat((4 - (base64String.length % 4)) % 4);
      var base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
      var rawData = window.atob(base64);
      var outputArray = new Uint8Array(rawData.length);
      for (var i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
      }
      return outputArray;
    },

    syncPushSubscription: function () {
      var self = this;
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
      navigator.serviceWorker.ready.then(function (reg) {
        return reg.pushManager.getSubscription().then(function (subscription) {
          if (subscription) {
            var subJson = subscription.toJSON();
            if (subJson && subJson.keys) {
              return fetch('/api/notifications/push-subscription', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  endpoint: subscription.endpoint,
                  keys: subJson.keys,
                  userAgent: navigator.userAgent,
                }),
              }).then(function () {
                console.log('[:> WEB PUSH] PushSubscription re-synchronized with server.');
              }).catch(function (err) {
                console.warn('[:> WEB PUSH SYNC WARN]', err);
              });
            }
          }
          // No active subscription or missing keys, attempt clean subscription
          return self.subscribePush().catch(function (subErr) {
            console.warn('[:> WEB PUSH AUTO-SUBSCRIBE WARN]', subErr);
          });
        });
      }).catch(function (err) {
        console.warn('[:> WEB PUSH CHECK ERROR]', err);
      });
    },

    subscribePush: function () {
      var self = this;
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        return Promise.reject(new Error('Push messaging is not supported in this browser.'));
      }

      // Check synchronous in-memory key first to preserve user-gesture activation on iOS Safari
      var vapidKey = window.NEOGRAM_VAPID_PUBLIC_KEY;
      if (!vapidKey) {
        var meta = document.querySelector('meta[name="vapid-public-key"]');
        if (meta && meta.content) vapidKey = meta.content;
      }

      var getKeyPromise = vapidKey
        ? Promise.resolve(vapidKey)
        : fetch('/api/notifications/vapid-public-key')
            .then(function (res) {
              if (!res.ok) throw new Error('HTTP ' + res.status + ' fetching VAPID key');
              return res.json();
            })
            .then(function (data) {
              if (!data || !data.publicKey) throw new Error('Missing VAPID public key');
              window.NEOGRAM_VAPID_PUBLIC_KEY = data.publicKey;
              return data.publicKey;
            });

      return getKeyPromise.then(function (publicKey) {
        var applicationServerKey = self.urlBase64ToUint8Array(publicKey);
        return navigator.serviceWorker.ready.then(function (reg) {
          return reg.pushManager.getSubscription().then(function (existingSub) {
            var doSubscribe = function () {
              return reg.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: applicationServerKey,
              });
            };

            var subscribeAction;
            if (existingSub) {
              // If subscription already exists, try to re-subscribe directly, or unsubscribe and recreate if key mismatch
              subscribeAction = doSubscribe().catch(function (subErr) {
                console.warn('[:> WEB PUSH] Unsubscribing stale endpoint:', subErr);
                return existingSub.unsubscribe().then(doSubscribe);
              });
            } else {
              subscribeAction = doSubscribe();
            }

            return subscribeAction.then(function (subscription) {
              var subJson = subscription.toJSON();
              return fetch('/api/notifications/push-subscription', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  endpoint: subscription.endpoint,
                  keys: subJson.keys,
                  userAgent: navigator.userAgent,
                }),
              }).then(function (res) {
                if (!res.ok) throw new Error('HTTP ' + res.status + ' saving push subscription on server');
                return res.json().then(function (data) {
                  console.log('[:> WEB PUSH] PushSubscription registered with server.');
                  return subscription;
                });
              });
            });
          });
        });
      });
    },

    sendTestNotification: function () {
      var self = this;
      if (typeof window.Notification === 'undefined') {
        alert('Desktop notifications are not supported in this browser.');
        return false;
      }
      if (Notification.permission !== 'granted') {
        alert('Browser notification permission is currently: ' + Notification.permission + '. Click "PERMIT BROWSER" first.');
        return false;
      }

      // First attempt native server-side Web Push (APNs / FCM delivery to test background capability)
      return fetch('/api/notifications/test-push', {
        method: 'POST',
      })
        .then(function (res) { return res.json(); })
        .then(function (data) {
          if (data && data.ok && data.sentCount > 0) {
            alert('[:> TEST PUSH SENT] Dispatched to your device via Apple APNs! Lock your phone or switch apps now to verify background delivery.');
            return true;
          } else {
            // Subscription missing on server: alert and attempt sync
            alert('[:> PUSH NOT REGISTERED ON SERVER] No device push subscription was found on the server for this user. Re-subscribing device now...');
            return self.subscribePush().then(function () {
              alert('[:> DEVICE SUBSCRIBED] Device push carrier re-registered! Dispatched second test push.');
              return fetch('/api/notifications/test-push', { method: 'POST' });
            }).catch(function (err) {
              alert('[:> REGISTRATION ERROR] Could not register push: ' + (err.message || err));
            });
          }
        })
        .catch(function (err) {
          alert('[:> TEST DISPATCH ERROR] ' + (err.message || err));
        });
    },

    handleRealtimeNotification: function (packet) {
      var n = packet.notification;
      if (!n) return;

      // Add to in-memory items
      this.items.unshift(n);
      if (typeof packet.unreadCount === 'number') {
        this.unreadCount = packet.unreadCount;
      } else {
        this.unreadCount++;
      }

      this.renderBadge();
      this.renderList();

      // 1. Play 8-bit Audio Chime
      if (packet.soundEnabled !== false && window.retroAudio) {
        if (typeof window.retroAudio.playAlertBeep === 'function') {
          window.retroAudio.playAlertBeep();
        } else if (typeof window.retroAudio.playAimMessageChime === 'function') {
          window.retroAudio.playAimMessageChime();
        }
      }

      // 2. Trigger native desktop / PWA push notification if permitted
      if (packet.desktopPush) {
        this.triggerDesktopNotification(n.title, {
          body: n.body || 'New cyberspace transmission',
          icon: '/icons/icon-192.png',
          badge: '/icons/icon-192.png',
          tag: 'neogram-' + (n.id || Date.now()),
        }, n.linkUrl);
      }
    },
  };

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  window.NeogramNotifications = NeogramNotifications;
  window.handleMarkAllNotificationsRead = function (e) {
    if (e) e.stopPropagation();
    NeogramNotifications.markAllRead();
  };
  window.toggleNotificationCenter = function (force) {
    NeogramNotifications.toggleDropdown(force);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      NeogramNotifications.init();
    });
  } else {
    NeogramNotifications.init();
  }
})(window);
