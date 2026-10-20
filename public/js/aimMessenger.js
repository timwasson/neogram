/**
 * Neogram AIM Messenger Client (v1.0)
 * Real-time WebSockets + Ephemeral Delivery + 100% LocalStorage Retention
 * Zero long-term server liability.
 */
(function (window, document) {
  'use strict';

  var AimClient = {
    ws: null,
    currentUser: null,
    activeBuddy: null,
    buddies: [],
    reconnectTimer: null,
    isOpen: false,
    currentView: 'buddies', // 'buddies' | 'im'
    typingTimer: null,

    init: function (userHandle) {
      if (!userHandle) return;
      this.currentUser = userHandle;
      this.bindDomElements();
      this.connectWebSocket();
    },

    bindDomElements: function () {
      var self = this;

      this.dockBtn = document.getElementById('aimDockBtn');
      this.windowEl = document.getElementById('aimMessengerWindow');
      this.onlineCountBadge = document.getElementById('aimOnlineCountBadge');
      this.buddiesListEl = document.getElementById('aimBuddiesList');
      this.offlineBuddiesListEl = document.getElementById('aimOfflineBuddiesList');
      this.buddiesViewEl = document.getElementById('aimBuddiesView');
      this.imViewEl = document.getElementById('aimImView');
      this.imTitleEl = document.getElementById('aimImTitle');
      this.imStatusDotEl = document.getElementById('aimImStatusDot');
      this.imAwayBannerEl = document.getElementById('aimImAwayBanner');
      this.imTranscriptEl = document.getElementById('aimImTranscript');
      this.imTypingEl = document.getElementById('aimImTyping');
      this.imInputEl = document.getElementById('aimImInput');
      this.imFormEl = document.getElementById('aimImForm');
      this.userStatusSelect = document.getElementById('aimUserStatusSelect');
      this.userAwayMsgInput = document.getElementById('aimUserAwayMsg');

      if (this.dockBtn) {
        this.dockBtn.addEventListener('click', function () {
          self.toggleWindow();
        });
      }

      var minimizeBtn = document.getElementById('aimMinimizeBtn');
      if (minimizeBtn) {
        minimizeBtn.addEventListener('click', function () {
          self.closeWindow();
        });
      }

      var backBtn = document.getElementById('aimBackToBuddiesBtn');
      if (backBtn) {
        backBtn.addEventListener('click', function () {
          self.showBuddiesView();
        });
      }

      var exportBtn = document.getElementById('aimExportLogsBtn');
      if (exportBtn) {
        exportBtn.addEventListener('click', function () {
          self.exportLogs();
        });
      }

      var clearBtn = document.getElementById('aimClearLogsBtn');
      if (clearBtn) {
        clearBtn.addEventListener('click', function () {
          self.clearLogs();
        });
      }

      if (this.imFormEl) {
        this.imFormEl.addEventListener('submit', function (e) {
          e.preventDefault();
          self.sendMessage();
        });
      }

      if (this.imInputEl) {
        this.imInputEl.addEventListener('input', function () {
          self.sendTypingIndicator();
        });
      }

      if (this.userStatusSelect) {
        this.userStatusSelect.addEventListener('change', function () {
          self.updateMyStatus();
        });
      }

      if (this.userAwayMsgInput) {
        this.userAwayMsgInput.addEventListener('change', function () {
          self.updateMyStatus();
        });
      }
    },

    connectWebSocket: function () {
      var self = this;
      var protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      var wsUrl = protocol + '//' + window.location.host + '/ws/chat';

      try {
        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = function () {
          console.log('[:> AIM // WS] Connected to chat router.');
          clearTimeout(self.reconnectTimer);
        };

        this.ws.onmessage = function (event) {
          try {
            var packet = JSON.parse(event.data);
            self.handlePacket(packet);
          } catch (e) {
            console.warn('[:> AIM // WS PARSE ERROR]', e);
          }
        };

        this.ws.onclose = function () {
          console.log('[:> AIM // WS] Connection dropped. Scheduling reconnect...');
          self.scheduleReconnect();
        };

        this.ws.onerror = function (err) {
          console.warn('[:> AIM // WS ERROR]', err);
        };
      } catch (e) {
        console.error('[:> AIM // WS INIT FAILED]', e);
        this.scheduleReconnect();
      }
    },

    scheduleReconnect: function () {
      var self = this;
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = setTimeout(function () {
        self.connectWebSocket();
      }, 5000);
    },

    handlePacket: function (packet) {
      var self = this;

      switch (packet.type) {
        case 'init_state':
          this.buddies = packet.buddies || [];
          this.renderBuddies();
          this.updateDockBadge();
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
        if (packet.awayMessage !== undefined) {
          buddy.awayMessage = packet.awayMessage;
        }

        // Sound triggers
        if (!wasOnline && buddy.isOnline) {
          if (window.retroAudio && window.retroAudio.playAimDoorOpen) {
            window.retroAudio.playAimDoorOpen();
          }
        } else if (wasOnline && !buddy.isOnline) {
          if (window.retroAudio && window.retroAudio.playAimDoorSlam) {
            window.retroAudio.playAimDoorSlam();
          }
        }
      } else {
        // New buddy added to list
        this.buddies.push({
          id: packet.userId,
          handle: packet.handle,
          isOnline: packet.status !== 'offline',
          status: packet.status,
          awayMessage: packet.awayMessage || '',
        });
        if (window.retroAudio && window.retroAudio.playAimDoorOpen) {
          window.retroAudio.playAimDoorOpen();
        }
      }

      this.renderBuddies();
      this.updateDockBadge();

      // If chatting with this buddy right now, update their header
      if (this.activeBuddy && this.activeBuddy.handle === packet.handle) {
        this.activeBuddy.isOnline = packet.status !== 'offline';
        this.activeBuddy.status = packet.status;
        this.activeBuddy.awayMessage = packet.awayMessage || '';
        this.updateImHeader();
      }
    },

    handleIncomingMessage: function (packet) {
      var fromHandle = packet.from;
      var msgObj = {
        id: packet.id,
        from: fromHandle,
        to: this.currentUser,
        text: packet.text,
        timestamp: packet.timestamp || new Date().toISOString(),
        isMe: false,
        wasQueued: !!packet.wasQueued,
      };

      // 1. Store in LocalStorage
      this.saveMessageToLocal(fromHandle, msgObj);

      // 2. Play classic chime
      if (window.retroAudio && window.retroAudio.playAimMessageChime) {
        window.retroAudio.playAimMessageChime();
      }

      // 3. If chatting with this buddy right now, append to transcript
      if (this.isOpen && this.currentView === 'im' && this.activeBuddy && this.activeBuddy.handle === fromHandle) {
        this.appendMessageToTranscript(msgObj);
      } else {
        // Alert on dock button
        if (this.dockBtn) {
          this.dockBtn.classList.add('aim-dock-btn--alert');
          this.dockBtn.innerHTML = '<span>🔔 New IM from @' + fromHandle + '</span>';
        }
      }
    },

    handleMessageStatus: function (packet) {
      // Append delivery feedback to transcript if active
      if (this.isOpen && this.currentView === 'im' && this.activeBuddy && this.activeBuddy.handle === packet.to) {
        if (packet.status === 'queued_offline') {
          var sysMsg = {
            id: 'sys_' + Date.now(),
            from: 'system',
            text: '[:> SYSTEM] Recipient @' + packet.to + ' is offline. Message held in 24h store-and-forward queue.',
            timestamp: new Date().toISOString(),
            isSystem: true,
          };
          this.appendMessageToTranscript(sysMsg);
        }
      }
    },

    sendMessage: function () {
      if (!this.imInputEl || !this.activeBuddy) return;
      var text = this.imInputEl.value.trim();
      if (!text) return;

      var msgId = 'msg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
      var timestamp = new Date().toISOString();

      var msgObj = {
        id: msgId,
        from: this.currentUser,
        to: this.activeBuddy.handle,
        text: text,
        timestamp: timestamp,
        isMe: true,
      };

      // 1. Save to LocalStorage
      this.saveMessageToLocal(this.activeBuddy.handle, msgObj);

      // 2. Render immediately in transcript
      this.appendMessageToTranscript(msgObj);

      // 3. Play send audio
      if (window.retroAudio && window.retroAudio.playAimSendSound) {
        window.retroAudio.playAimSendSound();
      }

      // 4. Transmit over WebSocket
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({
          type: 'direct_message',
          id: msgId,
          to: this.activeBuddy.handle,
          text: text,
        }));
      }

      this.imInputEl.value = '';
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
      if (!this.imTypingEl) return;
      this.imTypingEl.textContent = '@' + handle + ' is typing...';
      clearTimeout(this._typingClearTimer);
      var el = this.imTypingEl;
      this._typingClearTimer = setTimeout(function () {
        el.textContent = '';
      }, 3500);
    },

    updateMyStatus: function () {
      var status = this.userStatusSelect ? this.userStatusSelect.value : 'online';
      var awayMessage = this.userAwayMsgInput ? this.userAwayMsgInput.value.trim() : '';

      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({
          type: 'set_status',
          status: status,
          awayMessage: awayMessage,
        }));
      }
    },

    // -------------------------------------------------------------
    // LOCALSTORAGE REPOSITORY (ZERO SERVER STORAGE)
    // -------------------------------------------------------------
    getStorageKey: function (buddyHandle) {
      return 'neogram_im_' + (buddyHandle || '').toLowerCase();
    },

    getLocalHistory: function (buddyHandle) {
      try {
        var raw = localStorage.getItem(this.getStorageKey(buddyHandle));
        return raw ? JSON.parse(raw) : [];
      } catch (e) {
        return [];
      }
    },

    saveMessageToLocal: function (buddyHandle, msgObj) {
      try {
        var history = this.getLocalHistory(buddyHandle);
        history.push(msgObj);
        // Keep max 250 recent messages per conversation
        if (history.length > 250) {
          history = history.slice(history.length - 250);
        }
        localStorage.setItem(this.getStorageKey(buddyHandle), JSON.stringify(history));
      } catch (e) {
        console.warn('LocalStorage save failed:', e);
      }
    },

    exportLogs: function () {
      if (window.retroAudio) window.retroAudio.playClick();
      var allLogs = {};
      for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i);
        if (key && key.indexOf('neogram_im_') === 0) {
          try {
            allLogs[key] = JSON.parse(localStorage.getItem(key));
          } catch (e) {}
        }
      }

      var blob = new Blob([JSON.stringify(allLogs, null, 2)], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'neogram_aim_chat_logs_' + this.currentUser + '.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },

    clearLogs: function () {
      if (!confirm('Clear all local chat history from your browser?')) return;
      if (window.retroAudio) window.retroAudio.playClick();

      var keysToRemove = [];
      for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i);
        if (key && key.indexOf('neogram_im_') === 0) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach(function (k) {
        localStorage.removeItem(k);
      });

      if (this.currentView === 'im') {
        this.loadConversation(this.activeBuddy);
      }
      alert('Local chat logs cleared.');
    },

    // -------------------------------------------------------------
    // UI RENDERING & SWITCHING
    // -------------------------------------------------------------
    renderBuddies: function () {
      var self = this;
      if (!this.buddiesListEl || !this.offlineBuddiesListEl) return;

      var online = [];
      var offline = [];

      this.buddies.forEach(function (b) {
        if (b.handle === self.currentUser) return; // Don't show yourself in buddy list
        if (b.isOnline) online.push(b);
        else offline.push(b);
      });

      // 1. Online list
      if (online.length === 0) {
        this.buddiesListEl.innerHTML = '<div class="text-xs text-muted p-1 italic">No buddies currently online.</div>';
      } else {
        var html = '';
        online.forEach(function (b) {
          var dot = b.status === 'away' ? '🟡' : '🟢';
          var awayTip = b.awayMessage ? ' — "' + b.awayMessage + '"' : '';
          html += '<div class="aim-window__buddy-item" data-handle="' + b.handle + '">' +
            '<div class="flex items-center gap-1.5 overflow-hidden">' +
              '<span>' + dot + '</span>' +
              '<span class="font-bold text-prompt">@' + b.handle + '</span>' +
              '<span class="text-muted text-xs truncate">' + awayTip + '</span>' +
            '</div>' +
            '<button type="button" class="aim-window__btn-sm">IM</button>' +
          '</div>';
        });
        this.buddiesListEl.innerHTML = html;
      }

      // 2. Offline list
      if (offline.length === 0) {
        this.offlineBuddiesListEl.innerHTML = '<div class="text-xs text-muted p-1 italic">No offline buddies.</div>';
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
        this.offlineBuddiesListEl.innerHTML = offHtml;
      }

      // Attach click listeners to buddy items
      var allItems = this.windowEl.querySelectorAll('.aim-window__buddy-item');
      allItems.forEach(function (el) {
        el.addEventListener('click', function () {
          var handle = el.getAttribute('data-handle');
          self.openChatWith(handle);
        });
      });
    },

    updateDockBadge: function () {
      if (!this.onlineCountBadge) return;
      var count = 0;
      var self = this;
      this.buddies.forEach(function (b) {
        if (b.isOnline && b.handle !== self.currentUser) count++;
      });
      this.onlineCountBadge.textContent = count + ' Online';
    },

    openChatWith: function (handle) {
      if (window.retroAudio) window.retroAudio.playClick();
      var buddy = null;
      for (var i = 0; i < this.buddies.length; i++) {
        if (this.buddies[i].handle === handle) {
          buddy = this.buddies[i];
          break;
        }
      }

      if (!buddy) {
        buddy = { handle: handle, isOnline: false, status: 'offline', awayMessage: '' };
      }

      this.activeBuddy = buddy;
      this.currentView = 'im';

      if (this.buddiesViewEl) this.buddiesViewEl.classList.add('hidden');
      if (this.imViewEl) this.imViewEl.classList.remove('hidden');

      this.updateImHeader();
      this.loadConversation(buddy);

      if (this.imInputEl) this.imInputEl.focus();
    },

    showBuddiesView: function () {
      if (window.retroAudio) window.retroAudio.playClick();
      this.currentView = 'buddies';
      this.activeBuddy = null;
      if (this.imViewEl) this.imViewEl.classList.add('hidden');
      if (this.buddiesViewEl) this.buddiesViewEl.classList.remove('hidden');
    },

    updateImHeader: function () {
      if (!this.activeBuddy) return;
      if (this.imTitleEl) this.imTitleEl.textContent = 'Instant Message: @' + this.activeBuddy.handle;
      if (this.imStatusDotEl) {
        this.imStatusDotEl.textContent = this.activeBuddy.isOnline
          ? (this.activeBuddy.status === 'away' ? '🟡 Away' : '🟢 Online')
          : '⚪ Offline';
      }

      if (this.imAwayBannerEl) {
        if (this.activeBuddy.status === 'away' && this.activeBuddy.awayMessage) {
          this.imAwayBannerEl.textContent = 'Auto-Response: "' + this.activeBuddy.awayMessage + '"';
          this.imAwayBannerEl.classList.remove('hidden');
        } else {
          this.imAwayBannerEl.classList.add('hidden');
        }
      }
    },

    loadConversation: function (buddy) {
      if (!this.imTranscriptEl || !buddy) return;
      this.imTranscriptEl.innerHTML = '';

      var history = this.getLocalHistory(buddy.handle);

      if (history.length === 0) {
        this.imTranscriptEl.innerHTML = '<div class="aim-window__msg-line aim-window__msg-line--sys">' +
          '[:> AIM SYSTEM] Conversation opened with @' + buddy.handle + '. Messages are stored locally on your device.' +
        '</div>';
      } else {
        var self = this;
        history.forEach(function (msg) {
          self.appendMessageToTranscript(msg);
        });
      }

      this.scrollTranscriptToBottom();
    },

    appendMessageToTranscript: function (msg) {
      if (!this.imTranscriptEl) return;
      var line = document.createElement('div');

      var timeStr = '';
      try {
        var d = new Date(msg.timestamp);
        timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      } catch (e) {
        timeStr = '';
      }

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

      this.imTranscriptEl.appendChild(line);
      this.scrollTranscriptToBottom();
    },

    scrollTranscriptToBottom: function () {
      if (this.imTranscriptEl) {
        this.imTranscriptEl.scrollTop = this.imTranscriptEl.scrollHeight;
      }
    },

    escapeHtml: function (str) {
      var div = document.createElement('div');
      div.textContent = str;
      return div.innerHTML;
    },

    toggleWindow: function () {
      if (window.retroAudio) window.retroAudio.playClick();
      if (this.isOpen) {
        this.closeWindow();
      } else {
        this.openWindow();
      }
    },

    openWindow: function () {
      this.isOpen = true;
      if (this.windowEl) this.windowEl.classList.remove('hidden');
      if (this.dockBtn) {
        this.dockBtn.classList.remove('aim-dock-btn--alert');
        this.updateDockBadge();
      }
    },

    closeWindow: function () {
      this.isOpen = false;
      if (this.windowEl) this.windowEl.classList.add('hidden');
    },
  };

  window.AimClient = AimClient;
})(window, document);
