/**
 * Neogram Cyber-Pager & Chat Embed Widget (v1.0)
 * Lightweight, zero-dependency client script injecting an expandable retro pager dock
 * into external static sites (Neocities, Nekoweb, GitHub Pages, self-hosted).
 */
(function (window, document) {
  'use strict';

  // Prevent multiple instantiations
  if (window.__NeogramPagerInitialized) return;
  window.__NeogramPagerInitialized = true;

  // 1. Locate configuration from current script tag or widget mount point
  var scriptTag = document.currentScript || (function() {
    var scripts = document.getElementsByTagName('script');
    for (var i = 0; i < scripts.length; i++) {
      if (scripts[i].src && scripts[i].src.indexOf('pager.js') !== -1) {
        return scripts[i];
      }
    }
    return null;
  })();

  var widgetElement = document.querySelector('[data-neogram-widget="pager"]');

  var station = (scriptTag && scriptTag.getAttribute('data-station')) ||
                (widgetElement && widgetElement.getAttribute('data-station')) ||
                '';
  var siteSlug = (scriptTag && scriptTag.getAttribute('data-slug')) ||
                 (widgetElement && widgetElement.getAttribute('data-slug')) ||
                 '';
  var position = (scriptTag && scriptTag.getAttribute('data-position')) ||
                 (widgetElement && widgetElement.getAttribute('data-position')) ||
                 'bottom-right';

  // Derive API host from script source
  var apiHost = '';
  if (scriptTag && scriptTag.src) {
    try {
      var url = new URL(scriptTag.src);
      apiHost = url.origin;
    } catch(e) {
      apiHost = window.location.origin;
    }
  } else {
    apiHost = window.location.origin;
  }

  if (!station) {
    console.warn('[:> NEOGRAM PAGER] Missing required data-station attribute on script or container.');
    return;
  }

  // Clean station handle
  station = station.replace(/^@/, '').trim();

  // 2. Inject Stylesheet if not already present
  function ensureStylesheet() {
    var existing = document.querySelector('link[href*="neogram-embed.css"], link[href*="neogram.css"]');
    if (!existing) {
      var link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = apiHost + '/embed/neogram-embed.css';
      document.head.appendChild(link);
    }
  }
  ensureStylesheet();

  // 3. Audio Engine: Synthesized 8-bit sound effects via Web Audio API
  var audioCtx = null;
  function getAudioContext() {
    if (!audioCtx) {
      var AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) {
        audioCtx = new AudioContext();
      }
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    return audioCtx;
  }

  function playSound(type) {
    try {
      var ctx = getAudioContext();
      if (!ctx) return;
      var now = ctx.currentTime;

      if (type === 'beep') {
        // High-pitched retro pager chime (two tones)
        var osc1 = ctx.createOscillator();
        var gain1 = ctx.createGain();
        osc1.type = 'square';
        osc1.frequency.setValueAtTime(880, now);
        osc1.frequency.setValueAtTime(1760, now + 0.08);
        gain1.gain.setValueAtTime(0.12, now);
        gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
        osc1.connect(gain1);
        gain1.connect(ctx.destination);
        osc1.start(now);
        osc1.stop(now + 0.22);
      } else if (type === 'click') {
        // Sharp mechanical keyboard click
        var osc2 = ctx.createOscillator();
        var gain2 = ctx.createGain();
        osc2.type = 'triangle';
        osc2.frequency.setValueAtTime(220, now);
        osc2.frequency.exponentialRampToValueAtTime(40, now + 0.04);
        gain2.gain.setValueAtTime(0.15, now);
        gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
        osc2.connect(gain2);
        gain2.connect(ctx.destination);
        osc2.start(now);
        osc2.stop(now + 0.04);
      }
    } catch(e) {}
  }

  // 4. Identity & Session State
  var currentToken = localStorage.getItem('neogram_pass') || '';
  var verifiedHandle = '';
  var anonHandle = '';
  var isExpanded = false;
  var stationStatus = 'offline';
  var stationStatusMsg = 'Surfing cyberspace';
  var widgetEnabled = true;
  var allowAnonymous = true;
  var ws = null;
  var unreadCount = 0;

  function initCallerIdentity() {
    if (currentToken) {
      try {
        var payload = JSON.parse(atob(currentToken.split('.')[1]));
        verifiedHandle = payload.handle || ('node_' + (payload.uin || 'user'));
        return;
      } catch(e) {
        localStorage.removeItem('neogram_pass');
        currentToken = '';
        verifiedHandle = '';
      }
    }

    var savedAnon = sessionStorage.getItem('neogram_pager_anon');
    if (!savedAnon) {
      var prefixes = ['guest', 'surfer', 'cyber', 'dialup', 'node', 'netizen'];
      var num = Math.floor(1000 + Math.random() * 9000);
      savedAnon = prefixes[Math.floor(Math.random() * prefixes.length)] + '_' + num;
      sessionStorage.setItem('neogram_pager_anon', savedAnon);
    }
    anonHandle = savedAnon;
  }
  initCallerIdentity();

  // 5. Build Widget DOM Components
  var dockContainer = document.createElement('div');
  dockContainer.className = 'neogram-pager-dock' + (position === 'bottom-left' ? ' neogram-pager-dock--bottom-left' : '');

  var dockBtn = document.createElement('button');
  dockBtn.type = 'button';
  dockBtn.className = 'neogram-pager-dock__btn';
  dockBtn.setAttribute('aria-expanded', 'false');
  dockBtn.setAttribute('aria-label', 'Open Cyberspace Pager for @' + station);
  dockBtn.innerHTML =
    '<span class="neogram-pager-dock__icon">📟</span>' +
    '<span class="pager-led pager-led--offline" id="ngPagerLed"></span>' +
    '<span class="neogram-pager-dock__label" id="ngPagerDockLabel">PAGE @' + station + '</span>';

  dockContainer.appendChild(dockBtn);

  // Expanded Window
  var windowEl = document.createElement('div');
  windowEl.className = 'neogram-pager-window neogram-pager-window--hidden' + (position === 'bottom-left' ? ' neogram-pager-window--bottom-left' : '');
  windowEl.setAttribute('role', 'region');
  windowEl.setAttribute('aria-label', 'Neogram Pager Window');

  windowEl.innerHTML =
    '<div class="neogram-pager-window__header">' +
    '  <div style="display:flex;align-items:center;gap:6px;">' +
    '    <span>📟</span>' +
    '    <span>PAGER: @' + station + '</span>' +
    '    <span class="pager-led pager-led--offline" id="ngWinLed"></span>' +
    '  </div>' +
    '  <div class="neogram-pager-window__controls">' +
    '    <button type="button" class="neogram-pager-window__control-btn" id="ngMinBtn" title="Minimize [─]">─</button>' +
    '    <button type="button" class="neogram-pager-window__control-btn" id="ngCloseBtn" title="Close [✕]">✕</button>' +
    '  </div>' +
    '</div>' +
    '<div class="neogram-pager-window__meta">' +
    '  <span style="font-weight:bold;" id="ngWinStatus">OFFLINE</span>' +
    '  <span class="neogram-pager-window__status-msg" id="ngWinStatusMsg">:&gt; ' + stationStatusMsg + '</span>' +
    '</div>' +
    '<div class="neogram-pager-window__transcript" id="ngTranscript">' +
    '  <div style="font-size:10px;color:#666;border-bottom:1px solid #ccc;padding-bottom:4px;margin-bottom:6px;">' +
    '    [:&gt; Secure pager carrier. 24h store-and-forward delivery with zero retention.]' +
    '  </div>' +
    '  <div id="ngMsgList" style="display:flex;flex-direction:column;gap:6px;"></div>' +
    '</div>' +
    '<div class="neogram-pager-window__auth-bar">' +
    '  <div style="display:flex;align-items:center;gap:4px;">' +
    '    <span style="color:#666;">TRANSMITTING:</span>' +
    '    <span style="font-weight:bold;color:#000080;" id="ngCallerLabel">@' + (verifiedHandle || anonHandle) + '</span>' +
    '  </div>' +
    '  <div>' +
    '    <button type="button" id="ngAuthBtn" style="background:none;border:none;color:#000080;font-family:inherit;font-size:10px;cursor:pointer;font-weight:bold;padding:0;">' +
    '      ' + (verifiedHandle ? '[Disconnect]' : '⚡ Connect Cyber-Pass') +
    '    </button>' +
    '  </div>' +
    '</div>' +
    '<form class="neogram-pager-window__form" id="ngForm">' +
    '  <input type="text" name="website" id="ngBotTrap" style="display:none;" tabindex="-1" autocomplete="off" />' +
    '  <div id="ngNotice" style="display:none;padding:4px 6px;background:#ffefc0;border:1px solid #c09000;font-size:10px;margin-bottom:4px;"></div>' +
    '  <textarea class="neogram-pager-window__input" id="ngInput" rows="2" maxlength="500" placeholder="Type message to page @' + station + '..." required></textarea>' +
    '  <div class="neogram-pager-window__footer">' +
    '    <span class="neogram-pager-window__char-count" id="ngCharCount">0 / 500 chars</span>' +
    '    <button type="submit" class="neogram-pager-window__send-btn" id="ngSendBtn">📟 TRANSMIT</button>' +
    '  </div>' +
    '</form>';

  // Mount to page
  function mount() {
    document.body.appendChild(dockContainer);
    document.body.appendChild(windowEl);
    attachEvents();
    loadTranscript();
    probeStatus();
  }

  // 6. Event Handlers & State Management
  function toggleExpanded(expand) {
    if (expand === undefined) expand = !isExpanded;
    isExpanded = expand;

    dockBtn.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
    if (isExpanded) {
      windowEl.classList.remove('neogram-pager-window--hidden');
      dockBtn.classList.remove('neogram-pager-dock__btn--alert');
      unreadCount = 0;
      updateDockLabel();
      scrollTranscript();
      var input = document.getElementById('ngInput');
      if (input) input.focus();
      connectWebSocket();
    } else {
      windowEl.classList.add('neogram-pager-window--hidden');
    }
    playSound('click');
  }

  function updateDockLabel() {
    var label = document.getElementById('ngPagerDockLabel');
    if (!label) return;
    if (unreadCount > 0) {
      label.textContent = '🔔 ' + unreadCount + ' NEW MESSAGE' + (unreadCount > 1 ? 'S' : '');
    } else {
      label.textContent = 'PAGE @' + station;
    }
  }

  function scrollTranscript() {
    var t = document.getElementById('ngTranscript');
    if (t) t.scrollTop = t.scrollHeight;
  }

  function renderMessage(m) {
    var list = document.getElementById('ngMsgList');
    if (!list) return;

    var el = document.createElement('div');
    el.className = 'neogram-pager-window__msg' + (m.isMe ? ' neogram-pager-window__msg--me' : '');
    var timeStr = new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    el.innerHTML =
      '<div class="neogram-pager-window__msg-header">' +
      '  <span class="neogram-pager-window__msg-author' + (m.isMe ? ' neogram-pager-window__msg-author--me' : '') + '">@' + m.from + '</span>' +
      '  <span>' + timeStr + '</span>' +
      '</div>' +
      '<div style="word-break:break-word;">' + escapeHtml(m.text) + '</div>';

    list.appendChild(el);
    scrollTranscript();
  }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function loadTranscript() {
    var list = document.getElementById('ngMsgList');
    if (!list) return;
    list.innerHTML = '';
    var saved = sessionStorage.getItem('neogram_pager_msgs_' + station);
    var msgs = saved ? JSON.parse(saved) : [];
    for (var i = 0; i < msgs.length; i++) {
      renderMessage(msgs[i]);
    }
  }

  function saveMessage(msgObj) {
    var saved = sessionStorage.getItem('neogram_pager_msgs_' + station);
    var msgs = saved ? JSON.parse(saved) : [];
    msgs.push(msgObj);
    sessionStorage.setItem('neogram_pager_msgs_' + station, JSON.stringify(msgs));
    renderMessage(msgObj);
  }

  // 7. Status Probe
  async function probeStatus() {
    try {
      var url = apiHost + '/api/chat/status/' + encodeURIComponent(station) + (siteSlug ? '/' + encodeURIComponent(siteSlug) : '');
      var res = await fetch(url);
      if (!res.ok) return;
      var data = await res.json();
      if (data.ok) {
        stationStatus = data.status || 'offline';
        stationStatusMsg = data.statusMessage || 'Surfing cyberspace';
        widgetEnabled = data.widgetEnabled !== false;
        allowAnonymous = data.allowAnonymous !== false;

        updateStatusUI();
      }
    } catch(e) {}
  }

  function updateStatusUI() {
    var dockLed = document.getElementById('ngPagerLed');
    var winLed = document.getElementById('ngWinLed');
    var winStatus = document.getElementById('ngWinStatus');
    var winMsg = document.getElementById('ngWinStatusMsg');
    var notice = document.getElementById('ngNotice');
    var sendBtn = document.getElementById('ngSendBtn');
    var input = document.getElementById('ngInput');

    var ledClass = 'pager-led pager-led--' + stationStatus;
    if (dockLed) dockLed.className = ledClass;
    if (winLed) winLed.className = ledClass;

    if (winStatus) winStatus.textContent = stationStatus.toUpperCase();
    if (winMsg) winMsg.textContent = ':> ' + stationStatusMsg;

    if (!widgetEnabled) {
      if (notice) {
        notice.style.display = 'block';
        notice.textContent = '🔒 Pager is currently deactivated by node operator.';
      }
      if (sendBtn) sendBtn.disabled = true;
      if (input) input.disabled = true;
      return;
    }

    if (!allowAnonymous && !verifiedHandle) {
      if (notice) {
        notice.style.display = 'block';
        notice.textContent = '🔒 Verified Cyber-Pass required to message this station.';
      }
      if (sendBtn) sendBtn.disabled = true;
      if (input) input.disabled = true;
    } else {
      if (notice) notice.style.display = 'none';
      if (sendBtn) sendBtn.disabled = false;
      if (input) input.disabled = false;
    }
  }

  // 8. WebSocket Live Bridge
  function connectWebSocket() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    var wsProtocol = apiHost.indexOf('https') === 0 ? 'wss:' : 'ws:';
    var wsUrl = wsProtocol + '//' + apiHost.replace(/^https?:\/\//, '') + '/ws/chat?pager=true&station=' + encodeURIComponent(station);

    if (currentToken) {
      wsUrl += '&token=' + encodeURIComponent(currentToken);
    } else {
      wsUrl += '&anonHandle=' + encodeURIComponent(anonHandle);
    }

    try {
      ws = new WebSocket(wsUrl);

      ws.onmessage = function (event) {
        try {
          var packet = JSON.parse(event.data);
          handleWebSocketPacket(packet);
        } catch(e) {}
      };

      ws.onclose = function () {
        ws = null;
      };
    } catch(e) {
      ws = null;
    }
  }

  function handleWebSocketPacket(packet) {
    if (packet.type === 'pager_init') {
      stationStatus = packet.status || 'offline';
      stationStatusMsg = packet.awayMessage || 'Online';
      updateStatusUI();
    } else if (packet.type === 'direct_message') {
      var msgObj = {
        id: packet.id,
        from: packet.from,
        text: packet.text,
        timestamp: packet.timestamp || new Date().toISOString(),
        isMe: false,
      };
      saveMessage(msgObj);
      playSound('beep');

      if (!isExpanded) {
        unreadCount++;
        dockBtn.classList.add('neogram-pager-dock__btn--alert');
        updateDockLabel();
      }
    }
  }

  // 9. Cyber-Pass SSO Handshake
  function handleAuthClick() {
    if (verifiedHandle) {
      // Disconnect
      localStorage.removeItem('neogram_pass');
      currentToken = '';
      verifiedHandle = '';
      initCallerIdentity();
      updateCallerLabel();
      updateStatusUI();
      playSound('click');
      return;
    }

    var width = 460;
    var height = 540;
    var left = (window.screen.width - width) / 2;
    var top = (window.screen.height - height) / 2;
    var authUrl = apiHost + '/auth/connect?mode=popup';

    var popup = window.open(
      authUrl,
      'NeogramCyberPass',
      'width=' + width + ',height=' + height + ',top=' + top + ',left=' + left + ',scrollbars=yes'
    );

    function onPassMessage(e) {
      if (e.data && e.data.type === 'NEOGRAM_PASS_APPROVED' && e.data.token) {
        currentToken = e.data.token;
        localStorage.setItem('neogram_pass', currentToken);
        initCallerIdentity();
        updateCallerLabel();
        updateStatusUI();
        playSound('beep');
        window.removeEventListener('message', onPassMessage);
        if (ws) {
          ws.close();
          connectWebSocket();
        }
      }
    }
    window.addEventListener('message', onPassMessage);
  }

  function updateCallerLabel() {
    var label = document.getElementById('ngCallerLabel');
    var btn = document.getElementById('ngAuthBtn');
    if (label) {
      label.textContent = '@' + (verifiedHandle || anonHandle) + (verifiedHandle ? ' [VERIFIED]' : ' [ANON]');
    }
    if (btn) {
      btn.textContent = verifiedHandle ? '[Disconnect]' : '⚡ Connect Cyber-Pass';
    }
  }

  // 10. Message Transmission
  async function submitTransmission(e) {
    e.preventDefault();
    var input = document.getElementById('ngInput');
    var btn = document.getElementById('ngSendBtn');
    var botTrap = document.getElementById('ngBotTrap');

    if (!input || !input.value.trim()) return;
    var text = input.value.trim();

    if (botTrap && botTrap.value) {
      input.value = '';
      return;
    }

    btn.disabled = true;
    playSound('click');

    var fromHandle = verifiedHandle || anonHandle;
    var msgId = 'pager_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);

    // If WebSocket is active, send over WebSocket
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({
          type: 'direct_message',
          id: msgId,
          to: station,
          text: text,
        }));

        var msgObj = {
          id: msgId,
          from: fromHandle,
          text: text,
          timestamp: new Date().toISOString(),
          isMe: true,
        };
        saveMessage(msgObj);
        input.value = '';
        updateCharCount();
        btn.disabled = false;
        return;
      } catch(err) {}
    }

    // Fallback to REST API
    try {
      var headers = { 'Content-Type': 'application/json' };
      if (currentToken) {
        headers['Authorization'] = 'Bearer ' + currentToken;
      }

      var res = await fetch(apiHost + '/api/chat/pager/send/' + encodeURIComponent(station), {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
          to: station,
          text: text,
          senderHandle: fromHandle,
          siteSlug: siteSlug,
        }),
      });

      var data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Transmission failed.');
      }

      var msgObjRest = {
        id: data.id || msgId,
        from: fromHandle,
        text: text,
        timestamp: data.timestamp || new Date().toISOString(),
        isMe: true,
      };
      saveMessage(msgObjRest);
      input.value = '';
      updateCharCount();
    } catch(err) {
      alert('[:> TRANSMISSION ERROR] ' + err.message);
    } finally {
      btn.disabled = false;
    }
  }

  function updateCharCount() {
    var input = document.getElementById('ngInput');
    var count = document.getElementById('ngCharCount');
    if (input && count) {
      count.textContent = input.value.length + ' / 500 chars';
    }
  }

  function attachEvents() {
    dockBtn.addEventListener('click', function() { toggleExpanded(); });

    var minBtn = document.getElementById('ngMinBtn');
    if (minBtn) minBtn.addEventListener('click', function() { toggleExpanded(false); });

    var closeBtn = document.getElementById('ngCloseBtn');
    if (closeBtn) closeBtn.addEventListener('click', function() { toggleExpanded(false); });

    var authBtn = document.getElementById('ngAuthBtn');
    if (authBtn) authBtn.addEventListener('click', handleAuthClick);

    var form = document.getElementById('ngForm');
    if (form) form.addEventListener('submit', submitTransmission);

    var input = document.getElementById('ngInput');
    if (input) input.addEventListener('input', updateCharCount);

    // Refresh status every 30s
    setInterval(probeStatus, 30000);
  }

  // Mount on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }

})(window, document);
