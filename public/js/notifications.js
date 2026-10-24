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

    toggleDropdown: function (forceState) {
      var dropdown = document.getElementById('notifyDropdownMenu');
      var btn = document.getElementById('notifyMenuBtn');
      if (!dropdown) return;

      this.isOpen = typeof forceState === 'boolean' ? forceState : !this.isOpen;

      if (this.isOpen) {
        dropdown.classList.remove('hidden');
        if (btn) btn.setAttribute('aria-expanded', 'true');
        // Close account dropdown if open
        if (typeof window.toggleUserMenu === 'function') {
          window.toggleUserMenu(false);
        }
        // Fetch freshest items
        this.fetchNotifications();
      } else {
        dropdown.classList.add('hidden');
        if (btn) btn.setAttribute('aria-expanded', 'false');
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
          '  <div class="retro-notify-item__icon">' + (n.icon || '🔔') + '</div>' +
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
          if (window.aimMessenger && typeof window.aimMessenger.openChatWith === 'function') {
            window.aimMessenger.openChatWith(userHandle);
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
      if (packet.desktopPush && typeof window.Notification !== 'undefined' && Notification.permission === 'granted') {
        try {
          if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
            navigator.serviceWorker.ready.then(function (reg) {
              reg.showNotification(n.title, {
                body: n.body || 'New cyberspace transmission',
                icon: '/icons/icon-192.png',
                badge: '/icons/icon-192.png',
                vibrate: [200, 100, 200],
                data: { url: n.linkUrl || '/' },
              });
            });
          } else {
            var notif = new Notification(n.title, {
              body: n.body || 'New cyberspace transmission',
              icon: '/icons/icon-192.png',
            });
            notif.onclick = function () {
              window.focus();
              if (n.linkUrl) window.location.href = n.linkUrl;
            };
          }
        } catch (_pushErr) {}
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
