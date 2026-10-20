/**
 * Neogram AIM Messenger - Popup Client Controller (Manifest V3)
 * Full WebSockets + Local Storage Retention + Retro Sound Synthesis
 */
(function () {
  'use strict';

  var DEFAULT_SERVER = 'http://localhost:4000';

  var ExtApp = {
    serverUrl: DEFAULT_SERVER,
    token: null,
    currentUser: null,
    activeBuddy: null,
    buddies: [],
    ws: null,
    reconnectTimer: null,
    currentIdentifier: '',
    receivedDemoCode: '',
    typingTimer: null,

    init: async function () {
      this.bindDom();
      await this.loadStoredConfig();
      await this.checkAuthStatus();
    },

    bindDom: function () {
      var self = this;

      // Views
      this.loginView = document.getElementById('extLoginView');
      this.buddiesView = document.getElementById('extBuddiesView');
      this.imView = document.getElementById('extImView');

      // Header controls
      this.connStatusDot = document.getElementById('connStatusDot');
      this.logoutBtn = document.getElementById('extLogoutBtn');

      // Login elements
      this.step1Form = document.getElementById('extStep1Form');
      this.step2Form = document.getElementById('extStep2Form');
      this.identifierInput = document.getElementById('extIdentifierInput');
      this.otpInput = document.getElementById('extOtpInput');
      this.demoHelper = document.getElementById('extDemoHelper');
      this.demoCodeText = document.getElementById('extDemoCodeText');
      this.quickFillBtn = document.getElementById('extQuickFillBtn');
      this.changeAddressBtn = document.getElementById('extChangeAddressBtn');
      this.alertBox = document.getElementById('extAlertBox');
      this.alertTag = document.getElementById('extAlertTag');
      this.alertMsg = document.getElementById('extAlertMsg');
      this.baudStatus = document.getElementById('extBaudStatus');
      this.serverUrlLabel = document.getElementById('extServerUrlLabel');

      // Buddies elements
      this.myHandleEl = document.getElementById('extMyHandle');
      this.statusSelect = document.getElementById('extStatusSelect');
      this.awayInput = document.getElementById('extAwayInput');
      this.onlineBuddiesEl = document.getElementById('extOnlineBuddies');
      this.offlineBuddiesEl = document.getElementById('extOfflineBuddies');
      this.exportLogsBtn = document.getElementById('extExportLogsBtn');
      this.clearLogsBtn = document.getElementById('extClearLogsBtn');

      // IM Chat elements
      this.imTitle = document.getElementById('extImTitle');
      this.imStatusDot = document.getElementById('extImStatusDot');
      this.imAwayBanner = document.getElementById('extImAwayBanner');
      this.imTranscript = document.getElementById('extImTranscript');
      this.imTyping = document.getElementById('extImTyping');
      this.imForm = document.getElementById('extImForm');
      this.imInput = document.getElementById('extImInput');
      this.backToBuddiesBtn = document.getElementById('extBackToBuddiesBtn');

      // Bind Listeners
      if (this.step1Form) {
        this.step1Form.addEventListener('submit', function (e) {
          e.preventDefault();
          self.handleRequestOtp();
        });
      }

      if (this.step2Form) {
        this.step2Form.addEventListener('submit', function (e) {
          e.preventDefault();
          self.handleVerifyOtp();
        });
      }

      if (this.quickFillBtn) {
        this.quickFillBtn.addEventListener('click', function () {
          self.quickFillDemo();
        });
      }

      if (this.changeAddressBtn) {
        this.changeAddressBtn.addEventListener('click', function () {
          self.resetToStep1();
        });
      }

      if (this.logoutBtn) {
        this.logoutBtn.addEventListener('click', function () {
          self.logout();
        });
      }

      if (this.backToBuddiesBtn) {
        this.backToBuddiesBtn.addEventListener('click', function () {
          self.showBuddiesView();
        });
      }

      if (this.imForm) {
        this.imForm.addEventListener('submit', function (e) {
          e.preventDefault();
          self.sendMessage();
        });
      }

      if (this.imInput) {
        this.imInput.addEventListener('input', function () {
          self.sendTypingIndicator();
        });
      }

      if (this.statusSelect) {
        this.statusSelect.addEventListener('change', function () {
          self.updateMyStatus();
        });
      }

      if (this.awayInput) {
        this.awayInput.addEventListener('change', function () {
          self.updateMyStatus();
        });
      }

      if (this.exportLogsBtn) {
        this.exportLogsBtn.addEventListener('click', function () {
          self.exportLogs();
        });
      }

      if (this.clearLogsBtn) {
        this.clearLogsBtn.addEventListener('click', function () {
          self.clearLogs();
        });
      }
    },

    // -------------------------------------------------------------
    // CONFIG & STORAGE ADAPTER
    // -------------------------------------------------------------
    getStorage: async function (key) {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        var res = await chrome.storage.local.get(key);
        return res[key];
      }
      try {
        var raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
      } catch (e) {
        return null;
      }
    },

    setStorage: async function (key, value) {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        await chrome.storage.local.set({ [key]: value });
      } else {
        localStorage.setItem(key, JSON.stringify(value));
      }
    },

    loadStoredConfig: async function () {
      var storedUrl = await this.getStorage('neogram_server_url');
      if (storedUrl) this.serverUrl = storedUrl;
      if (this.serverUrlLabel) this.serverUrlLabel.textContent = this.serverUrl;
    },

    // -------------------------------------------------------------
    // AUTHENTICATION FLOW
    // -------------------------------------------------------------
    checkAuthStatus: async function () {
      this.token = await this.getStorage('neogram_token');
      this.currentUser = await this.getStorage('neogram_user');

      if (!this.token || !this.currentUser) {
        this.showLoginView();
        return;
      }

      // Verify token with backend
      try {
        var res = await fetch(this.serverUrl + '/api/auth/me', {
          headers: { 'Authorization': 'Bearer ' + this.token }
        });
        var data = await res.json();
        if (data.ok && data.user) {
          this.currentUser = data.user;
          await this.setStorage('neogram_user', data.user);
          this.onAuthSuccess();
        } else {
          this.showLoginView();
        }
      } catch (err) {
        console.warn('[:> AUTH CHECK FAILED]', err);
        // If server is momentarily unreachable, proceed with cached user if present
        if (this.currentUser) {
          this.onAuthSuccess();
        } else {
          this.showLoginView();
        }
      }
    },

    onAuthSuccess: function () {
      if (this.myHandleEl) {
        this.myHandleEl.textContent = '@' + (this.currentUser.handle || this.currentUser.email.split('@')[0]);
      }
      if (this.logoutBtn) this.logoutBtn.classList.remove('hidden');
      this.showBuddiesView();
      this.connectWebSocket();
    },

    handleRequestOtp: async function () {
      var self = this;
      var identifier = this.identifierInput.value.trim();
      if (!identifier) return;

      this.currentIdentifier = identifier;
      this.hideAlert();
      this.setBaud(2, '9600 BAUD');
      if (window.retroAudio) window.retroAudio.playDialupBeep();

      try {
        var res = await fetch(this.serverUrl + '/api/auth/request-otp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ identifier: identifier })
        });
        var data = await res.json();

        if (!data.ok) {
          this.setBaud(0, 'CARRIER LOST');
          this.showAlert('error', data.error || 'Request failed', '[!] AUTH FAULT:');
          return;
        }

        this.setBaud(4, '56.6k V.90');
        this.showAlert('success', 'Carrier locked! Authorization key dispatched.', '[✓] OTP SENT:');

        // Transition to Step 2
        this.step1Form.classList.add('hidden');
        this.step2Form.classList.remove('hidden');

        if (data.demoCode) {
          this.receivedDemoCode = data.demoCode;
          if (this.demoCodeText) this.demoCodeText.textContent = data.demoCode;
          if (this.demoHelper) this.demoHelper.classList.remove('hidden');
        }

        this.otpInput.focus();
      } catch (e) {
        this.setBaud(0, 'CONN ERROR');
        this.showAlert('error', e.message, '[!] NETWORK FAULT:');
      }
    },

    quickFillDemo: function () {
      if (window.retroAudio) window.retroAudio.playClick();
      if (this.otpInput && this.receivedDemoCode) {
        this.otpInput.value = this.receivedDemoCode;
        this.otpInput.focus();
      }
    },

    resetToStep1: function () {
      if (window.retroAudio) window.retroAudio.playClick();
      this.step2Form.classList.add('hidden');
      this.step1Form.classList.remove('hidden');
      this.setBaud(0, 'STANDBY // 300 BAUD');
      this.hideAlert();
      this.identifierInput.focus();
    },

    handleVerifyOtp: async function () {
      var code = this.otpInput.value.trim();
      if (!code) return;

      this.hideAlert();
      this.setBaud(5, 'WWW ONLINE');

      try {
        var res = await fetch(this.serverUrl + '/api/auth/verify-otp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ identifier: this.currentIdentifier, code: code })
        });
        var data = await res.json();

        if (!data.ok) {
          this.showAlert('error', data.error || 'Invalid authorization key.', '[!] REJECTED:');
          return;
        }

        if (window.retroAudio) window.retroAudio.playSuccess();
        this.token = data.token;
        this.currentUser = data.user;

        await this.setStorage('neogram_token', data.token);
        await this.setStorage('neogram_user', data.user);

        this.onAuthSuccess();
      } catch (e) {
        this.showAlert('error', e.message, '[!] SYSTEM FAULT:');
      }
    },

    logout: async function () {
      if (window.retroAudio) window.retroAudio.playClick();
      if (this.ws) {
        this.ws.close();
        this.ws = null;
      }
      this.token = null;
      this.currentUser = null;
      await this.setStorage('neogram_token', null);
      await this.setStorage('neogram_user', null);
      this.logoutBtn.classList.add('hidden');
      this.showLoginView();
      this.resetToStep1();
    },

    // -------------------------------------------------------------
    // WEBSOCKET CHAT ROUTER
    // -------------------------------------------------------------
    connectWebSocket: function () {
      var self = this;
      if (!this.token) return;

      var wsProtocol = this.serverUrl.startsWith('https') ? 'wss:' : 'ws:';
      var host = this.serverUrl.replace(/^https?:\/\//, '');
      var wsUrl = wsProtocol + '//' + host + '/ws/chat?token=' + encodeURIComponent(this.token);

      try {
        if (this.ws) {
          this.ws.close();
        }

        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = function () {
          console.log('[:> EXTENSION AIM] WebSocket connected.');
          clearTimeout(self.reconnectTimer);
          if (self.connStatusDot) {
            self.connStatusDot.textContent = '🟢';
            self.connStatusDot.title = 'Connected to Neogram Carrier';
          }
        };

        this.ws.onmessage = function (event) {
          try {
            var packet = JSON.parse(event.data);
            self.handlePacket(packet);
          } catch (e) {
            console.warn('Packet parse error:', e);
          }
        };

        this.ws.onclose = function () {
          console.log('[:> EXTENSION AIM] Connection closed. Reconnecting...');
          if (self.connStatusDot) {
            self.connStatusDot.textContent = '🔴';
            self.connStatusDot.title = 'Offline / Reconnecting...';
          }
          self.scheduleReconnect();
        };

        this.ws.onerror = function (err) {
          console.warn('WebSocket error:', err);
        };
      } catch (err) {
        console.error('WebSocket init failed:', err);
        this.scheduleReconnect();
      }
    },

    scheduleReconnect: function () {
      var self = this;
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = setTimeout(function () {
        if (self.token) self.connectWebSocket();
      }, 5000);
    },

    handlePacket: function (packet) {
      switch (packet.type) {
        case 'init_state':
          this.buddies = packet.buddies || [];
          this.renderBuddies();
          break;

        case 'presence_update':
          this.handlePresenceChange(packet);
          break;

        case 'direct_message':
          this.handleIncomingMessage(packet);
          break;

        case 'message_status':
          this.handleMessageStatus(packet);
          break;

        case 'typing':
          if (this.activeBuddy && packet.from === this.activeBuddy.handle) {
            this.showTyping(packet.from);
          }
          break;
      }
    },

    handlePresenceChange: function (packet) {
      var buddy = null;
      for (var i = 0; i < this.buddies.length; i++) {
        if (this.buddies[i].id === packet.userId || this.buddies[i].handle === packet.handle) {
          buddy = this.buddies[i];
          break;
        }
      }

      if (buddy) {
        var wasOnline = buddy.isOnline;
        buddy.isOnline = packet.status !== 'offline';
        buddy.status = packet.status;
        if (packet.awayMessage !== undefined) buddy.awayMessage = packet.awayMessage;

        // Sound triggers
        if (!wasOnline && buddy.isOnline) {
          if (window.retroAudio) window.retroAudio.playAimDoorOpen();
        } else if (wasOnline && !buddy.isOnline) {
          if (window.retroAudio) window.retroAudio.playAimDoorSlam();
        }
      } else {
        this.buddies.push({
          id: packet.userId,
          handle: packet.handle,
          isOnline: packet.status !== 'offline',
          status: packet.status,
          awayMessage: packet.awayMessage || '',
        });
        if (window.retroAudio) window.retroAudio.playAimDoorOpen();
      }

      this.renderBuddies();

      if (this.activeBuddy && this.activeBuddy.handle === packet.handle) {
        this.activeBuddy.isOnline = packet.status !== 'offline';
        this.activeBuddy.status = packet.status;
        this.activeBuddy.awayMessage = packet.awayMessage || '';
        this.updateImHeader();
      }
    },

    handleIncomingMessage: async function (packet) {
      var fromHandle = packet.from;
      var msgObj = {
        id: packet.id,
        from: fromHandle,
        to: this.currentUser ? this.currentUser.handle : 'me',
        text: packet.text,
        timestamp: packet.timestamp || new Date().toISOString(),
        isMe: false,
        wasQueued: !!packet.wasQueued,
      };

      // 1. Save to Storage
      await this.saveMessage(fromHandle, msgObj);

      // 2. Play Audio Chime
      if (window.retroAudio) window.retroAudio.playAimMessageChime();

      // 3. Append to Transcript if currently chatting with this buddy
      if (this.activeBuddy && this.activeBuddy.handle === fromHandle && !this.imView.classList.contains('hidden')) {
        this.appendTranscript(msgObj);
      } else {
        // Send notification to service worker
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
          chrome.runtime.sendMessage({
            type: 'SHOW_NOTIFICATION',
            from: fromHandle,
            text: packet.text,
          });
        }
      }
    },

    handleMessageStatus: function (packet) {
      if (this.activeBuddy && this.activeBuddy.handle === packet.to) {
        if (packet.status === 'queued_offline') {
          this.appendTranscript({
            id: 'sys_' + Date.now(),
            from: 'system',
            text: '[:> SYSTEM] Recipient @' + packet.to + ' is offline. Message held in 24h store-and-forward queue.',
            timestamp: new Date().toISOString(),
            isSystem: true,
          });
        }
      }
    },

    sendMessage: async function () {
      if (!this.imInput || !this.activeBuddy) return;
      var text = this.imInput.value.trim();
      if (!text) return;

      var msgId = 'msg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
      var timestamp = new Date().toISOString();
      var myHandle = this.currentUser ? (this.currentUser.handle || 'me') : 'me';

      var msgObj = {
        id: msgId,
        from: myHandle,
        to: this.activeBuddy.handle,
        text: text,
        timestamp: timestamp,
        isMe: true,
      };

      // 1. Save to Storage
      await this.saveMessage(this.activeBuddy.handle, msgObj);

      // 2. Render in transcript
      this.appendTranscript(msgObj);

      // 3. Play Send Sound
      if (window.retroAudio) window.retroAudio.playAimSendSound();

      // 4. Send packet via WebSocket
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({
          type: 'direct_message',
          id: msgId,
          to: this.activeBuddy.handle,
          text: text,
        }));
      }

      this.imInput.value = '';
    },

    sendTypingIndicator: function () {
      var self = this;
      if (!this.activeBuddy || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      if (this.typingTimer) return;

      this.ws.send(JSON.stringify({
        type: 'typing',
        to: this.activeBuddy.handle,
      }));

      this.typingTimer = setTimeout(function () {
        self.typingTimer = null;
      }, 3000);
    },

    showTyping: function (handle) {
      if (!this.imTyping) return;
      this.imTyping.textContent = '@' + handle + ' is typing...';
      clearTimeout(this._typingTimer);
      var el = this.imTyping;
      this._typingTimer = setTimeout(function () {
        el.textContent = '';
      }, 3500);
    },

    updateMyStatus: function () {
      var status = this.statusSelect ? this.statusSelect.value : 'online';
      var awayMessage = this.awayInput ? this.awayInput.value.trim() : '';

      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({
          type: 'set_status',
          status: status,
          awayMessage: awayMessage,
        }));
      }
    },

    // -------------------------------------------------------------
    // CHAT HISTORY STORAGE (100% LOCAL RETENTION)
    // -------------------------------------------------------------
    getStorageKey: function (handle) {
      return 'neogram_im_' + (handle || '').toLowerCase();
    },

    loadMessages: async function (handle) {
      var list = await this.getStorage(this.getStorageKey(handle));
      return Array.isArray(list) ? list : [];
    },

    saveMessage: async function (handle, msgObj) {
      var list = await this.loadMessages(handle);
      list.push(msgObj);
      if (list.length > 250) list = list.slice(list.length - 250);
      await this.setStorage(this.getStorageKey(handle), list);
    },

    exportLogs: async function () {
      if (window.retroAudio) window.retroAudio.playClick();
      var allLogs = {};

      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        var all = await chrome.storage.local.get(null);
        for (var k in all) {
          if (k.indexOf('neogram_im_') === 0) allLogs[k] = all[k];
        }
      } else {
        for (var i = 0; i < localStorage.length; i++) {
          var key = localStorage.key(i);
          if (key && key.indexOf('neogram_im_') === 0) {
            try { allLogs[key] = JSON.parse(localStorage.getItem(key)); } catch (e) {}
          }
        }
      }

      var handle = this.currentUser ? this.currentUser.handle : 'user';
      var blob = new Blob([JSON.stringify(allLogs, null, 2)], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'neogram_aim_chat_logs_' + handle + '.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },

    clearLogs: async function () {
      if (!confirm('Clear all local chat history?')) return;
      if (window.retroAudio) window.retroAudio.playClick();

      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        var all = await chrome.storage.local.get(null);
        var keysToRemove = Object.keys(all).filter(function (k) { return k.startsWith('neogram_im_'); });
        await chrome.storage.local.remove(keysToRemove);
      } else {
        for (var i = localStorage.length - 1; i >= 0; i--) {
          var k = localStorage.key(i);
          if (k && k.startsWith('neogram_im_')) localStorage.removeItem(k);
        }
      }

      if (this.activeBuddy) {
        this.openChatWith(this.activeBuddy.handle);
      }
      alert('Local chat history purged.');
    },

    // -------------------------------------------------------------
    // UI RENDERING
    // -------------------------------------------------------------
    showLoginView: function () {
      this.loginView.classList.remove('hidden');
      this.buddiesView.classList.add('hidden');
      this.imView.classList.add('hidden');
    },

    showBuddiesView: function () {
      if (window.retroAudio) window.retroAudio.playClick();
      this.activeBuddy = null;
      this.loginView.classList.add('hidden');
      this.buddiesView.classList.remove('hidden');
      this.imView.classList.add('hidden');
      this.renderBuddies();
    },

    renderBuddies: function () {
      var self = this;
      if (!this.onlineBuddiesEl || !this.offlineBuddiesEl) return;

      var myHandle = this.currentUser ? (this.currentUser.handle || '').toLowerCase() : '';
      var online = [];
      var offline = [];

      this.buddies.forEach(function (b) {
        if ((b.handle || '').toLowerCase() === myHandle) return;
        if (b.isOnline) online.push(b);
        else offline.push(b);
      });

      // 1. Online
      if (online.length === 0) {
        this.onlineBuddiesEl.innerHTML = '<div class="text-xs text-muted p-1 italic">No buddies online.</div>';
      } else {
        var html = '';
        online.forEach(function (b) {
          var dot = b.status === 'away' ? '🟡' : '🟢';
          var note = b.awayMessage ? ' — "' + b.awayMessage + '"' : '';
          html += '<div class="aim-window__buddy-item" data-handle="' + b.handle + '">' +
            '<div class="flex items-center gap-1.5 overflow-hidden">' +
              '<span>' + dot + '</span>' +
              '<span class="font-bold text-prompt">@' + b.handle + '</span>' +
              '<span class="text-muted text-xs truncate">' + note + '</span>' +
            '</div>' +
            '<button type="button" class="aim-window__btn-sm">IM</button>' +
          '</div>';
        });
        this.onlineBuddiesEl.innerHTML = html;
      }

      // 2. Offline
      if (offline.length === 0) {
        this.offlineBuddiesEl.innerHTML = '<div class="text-xs text-muted p-1 italic">No offline buddies.</div>';
      } else {
        var offHtml = '';
        offline.forEach(function (b) {
          offHtml += '<div class="aim-window__buddy-item opacity-70" data-handle="' + b.handle + '">' +
            '<div class="flex items-center gap-1.5 overflow-hidden">' +
              '<span>⚪</span>' +
              '<span>@' + b.handle + '</span>' +
            '</div>' +
            '<button type="button" class="aim-window__btn-sm">MSG</button>' +
          '</div>';
        });
        this.offlineBuddiesEl.innerHTML = offHtml;
      }

      // Attach click events to buddy items
      var items = this.buddiesView.querySelectorAll('.aim-window__buddy-item');
      items.forEach(function (el) {
        el.addEventListener('click', function () {
          var h = el.getAttribute('data-handle');
          self.openChatWith(h);
        });
      });
    },

    openChatWith: async function (handle) {
      if (window.retroAudio) window.retroAudio.playClick();

      var buddy = null;
      for (var i = 0; i < this.buddies.length; i++) {
        if (this.buddies[i].handle === handle) {
          buddy = this.buddies[i];
          break;
        }
      }
      if (!buddy) buddy = { handle: handle, isOnline: false, status: 'offline', awayMessage: '' };

      this.activeBuddy = buddy;
      this.loginView.classList.add('hidden');
      this.buddiesView.classList.add('hidden');
      this.imView.classList.remove('hidden');

      this.updateImHeader();

      // Load messages
      this.imTranscript.innerHTML = '';
      var msgs = await this.loadMessages(buddy.handle);

      if (msgs.length === 0) {
        this.imTranscript.innerHTML = '<div class="aim-window__msg-line aim-window__msg-line--sys">' +
          '[:> AIM SYSTEM] Conversation opened with @' + buddy.handle + '. Local-first zero liability chat.' +
        '</div>';
      } else {
        var self = this;
        msgs.forEach(function (m) {
          self.appendTranscript(m);
        });
      }

      this.imInput.focus();
    },

    updateImHeader: function () {
      if (!this.activeBuddy) return;
      this.imTitle.textContent = 'IM: @' + this.activeBuddy.handle;
      this.imStatusDot.textContent = this.activeBuddy.isOnline
        ? (this.activeBuddy.status === 'away' ? '🟡 Away' : '🟢 Online')
        : '⚪ Offline';

      if (this.imAwayBanner) {
        if (this.activeBuddy.status === 'away' && this.activeBuddy.awayMessage) {
          this.imAwayBanner.textContent = 'Auto-Response: "' + this.activeBuddy.awayMessage + '"';
          this.imAwayBanner.classList.remove('hidden');
        } else {
          this.imAwayBanner.classList.add('hidden');
        }
      }
    },

    appendTranscript: function (msg) {
      if (!this.imTranscript) return;
      var line = document.createElement('div');

      var timeStr = '';
      try {
        var d = new Date(msg.timestamp);
        timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      } catch (e) {}

      if (msg.isSystem) {
        line.className = 'aim-window__msg-line aim-window__msg-line--sys';
        line.textContent = msg.text;
      } else if (msg.isMe) {
        line.className = 'aim-window__msg-line aim-window__msg-line--me';
        line.innerHTML = '<span class="text-muted">[' + timeStr + ']</span> <strong>&lt;' + msg.from + '&gt;:</strong> ' + this.escapeHtml(msg.text);
      } else {
        line.className = 'aim-window__msg-line aim-window__msg-line--them';
        var queuedBadge = msg.wasQueued ? ' <span class="aim-window__msg-line--sys">[offline delivered]</span>' : '';
        line.innerHTML = '<span class="text-muted">[' + timeStr + ']</span> <strong>&lt;' + msg.from + '&gt;:</strong> ' + this.escapeHtml(msg.text) + queuedBadge;
      }

      this.imTranscript.appendChild(line);
      this.imTranscript.scrollTop = this.imTranscript.scrollHeight;
    },

    escapeHtml: function (str) {
      var div = document.createElement('div');
      div.textContent = str;
      return div.innerHTML;
    },

    setBaud: function (idx, label) {
      if (this.baudStatus) this.baudStatus.textContent = label;
      for (var i = 0; i <= 5; i++) {
        var step = document.getElementById('ext-step-' + i);
        if (!step) continue;
        step.classList.remove('is-locked');
        if (i <= idx) step.classList.add('is-locked');
      }
    },

    showAlert: function (type, msg, tag) {
      if (!this.alertBox) return;
      this.alertBox.className = 'retro-alert is-visible';
      if (type === 'error') {
        this.alertBox.classList.add('retro-alert--error');
        if (window.retroAudio) window.retroAudio.playError();
      } else if (type === 'success') {
        this.alertBox.classList.add('retro-alert--success');
      } else {
        this.alertBox.classList.add('retro-alert--info');
      }
      this.alertTag.textContent = tag || '';
      this.alertMsg.textContent = msg;
    },

    hideAlert: function () {
      if (this.alertBox) this.alertBox.className = 'retro-alert';
    },
  };

  document.addEventListener('DOMContentLoaded', function () {
    ExtApp.init();
  });
})();
