/* Cyber-Pass consent handler (no inline JS; destination is server-validated and read from data-attributes). */
(function () {
  var btn = document.getElementById('btnManualAuthorize');
  var deny = document.getElementById('btnDeny');
  if (!btn) return;

  var destination = btn.dataset.destination || '';
  var returnUrl = btn.dataset.returnUrl || '';

  btn.addEventListener('click', function () {
    if (!destination) return;
    var passData = {
      type: 'NEOGRAM_CYBER_PASS',
      token: btn.dataset.token,
      handle: btn.dataset.handle,
      uin: parseInt(btn.dataset.uin, 10) || 0,
      avatar: btn.dataset.avatar || ''
    };
    if (window.retroAudio) window.retroAudio.playSuccess();
    if (window.opener && !window.opener.closed) {
      // Exact, server-validated origin: never '*'
      window.opener.postMessage(passData, destination);
      setTimeout(function () { window.close(); }, 300);
    } else if (returnUrl) {
      window.location.href = returnUrl + '#neogram_pass=' + encodeURIComponent(JSON.stringify(passData));
    } else {
      btn.disabled = true;
      btn.textContent = '[:> Cyber-Pass active. You can return to the site.]';
    }
  });

  if (deny) {
    deny.addEventListener('click', function () {
      if (window.opener && !window.opener.closed) window.close();
      else window.location.href = '/';
    });
  }
})();
