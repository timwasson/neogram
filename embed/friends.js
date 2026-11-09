/**
 * Neogram Federated Friends Client Widget (embed/friends.js)
 * ==========================================================
 * Pure zero-dependency vanilla JS widget to dynamically aggregate
 * friend stations' static feed.json files directly in the browser!
 *
 * Usage:
 *   <div id="neogram-friends-grid" data-station="alice"></div>
 *   <script src="https://neogram.club/embed/friends.js"></script>
 */
(function (window, document) {
  'use strict';

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatDate(isoStr) {
    if (!isoStr) return '';
    try {
      var d = new Date(isoStr);
      return d.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      });
    } catch(e) {
      return isoStr;
    }
  }

  var FederatedFriends = {
    init: function () {
      var containers = document.querySelectorAll('#neogram-friends-grid, [data-neogram-friends]');
      for (var i = 0; i < containers.length; i++) {
        this.renderContainer(containers[i]);
      }
    },

    renderContainer: function (container) {
      var station = container.getAttribute('data-station') || '';
      var apiHost = container.getAttribute('data-api-host') || 'https://neogram.club';

      // Auto-detect API host from script tag origin
      var currentScript = document.currentScript;
      if (currentScript && currentScript.src) {
        try {
          apiHost = new URL(currentScript.src).origin;
        } catch(e) {}
      }

      container.innerHTML = 
        '<div class="neogram-loading" style="text-align:center; padding: 2rem; font-family: monospace;">' +
        '  <span style="display:inline-block; animation: blink 1s infinite;">CONNECTING TO CYBERSPACE FRIENDS MESH...</span>' +
        '</div>';

      var fetchUrl = station 
        ? apiHost + '/api/user/' + encodeURIComponent(station) + '/friends-feed'
        : apiHost + '/api/friends';

      fetch(fetchUrl, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        credentials: 'same-origin'
      })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        var posts = data.posts || [];
        FederatedFriends.renderPosts(container, posts, apiHost);
      })
      .catch(function (err) {
        container.innerHTML = 
          '<div class="neogram-empty" style="text-align:center; padding: 2rem; font-family: monospace;">' +
          '  <div style="font-weight: bold; margin: 0.5rem 0;">[:> FEDERATED FRIENDS STREAM READY]</div>' +
          '  <p style="font-size: 0.85rem; opacity: 0.8;">No transmissions loaded from cyberspace friends roster.</p>' +
          '</div>';
      });
    },

    renderPosts: function (container, posts, apiHost) {
      if (!posts || posts.length === 0) {
        container.innerHTML = 
          '<div class="neogram-empty" style="text-align:center; padding: 2rem; font-family: monospace;">' +
          '  <div style="font-weight: bold; margin: 0.5rem 0;">[:> NO TRANSMISSIONS RECORDED IN FRIENDS MESH YET]</div>' +
          '  <p style="font-size: 0.85rem; opacity: 0.8;">Follow creator station nodes on Neogram to stream their broadcasted photographs here in real time.</p>' +
          '</div>';
        return;
      }

      var html = '<div class="neogram-grid">';
      for (var i = 0; i < posts.length; i++) {
        var p = posts[i];
        var author = p.author || p.authorHandle || 'station';
        var profileUrl = p.profileUrl || (apiHost + '/user/' + encodeURIComponent(p.authorUin || p.uin || author));
        var filter = p.filter || p.filterApplied || 'none';
        var imgUrl = p.thumbnailUrl || p.imageUrl || p.thumbnailPath || p.imagePath || '';

        html += 
          '<article class="neogram-card">' +
          '  <div class="neogram-card__header">' +
          '    <a href="' + escapeHtml(profileUrl) + '" target="_blank" class="neogram-card__author">' +
          '      @' + escapeHtml(author) + (p.authorUin ? ' [#' + escapeHtml(p.authorUin) + ']' : '') +
          '    </a>' +
          '    <span class="neogram-card__shader">' + escapeHtml(filter).toUpperCase() + '</span>' +
          '  </div>' +
          '  <a href="' + escapeHtml(profileUrl) + '" target="_blank" class="neogram-card__media">' +
          '    <img src="' + escapeHtml(imgUrl) + '" alt="' + escapeHtml(p.caption || '') + '" class="neogram-card__image filter-' + escapeHtml(filter) + '" loading="lazy" />' +
          '    <div class="neogram-card__overlay">' +
          '      <span class="neogram-btn neogram-btn--yellow neogram-btn--sm neogram-card__overlay-btn">VIEW PROFILE</span>' +
          '    </div>' +
          '  </a>' +
          '  <div class="neogram-card__body">' +
          '    <div class="neogram-card__content">' +
          '      <div class="neogram-card__meta">' +
          '        <span class="neogram-card__location">' + escapeHtml(p.location || 'Cyberspace') + '</span>' +
          '        <span class="neogram-card__date">' + escapeHtml(formatDate(p.createdAt)) + '</span>' +
          '      </div>' +
          '      <p class="neogram-card__caption">' + escapeHtml(p.caption || '') + '</p>' +
          '    </div>' +
          '    <div class="neogram-card__footer">' +
          '      <span class="neogram-card__likes"><strong>' + (p.likes || 0) + '</strong> likes</span>' +
          '      <a href="' + escapeHtml(profileUrl) + '" target="_blank" class="neogram-btn neogram-btn--yellow neogram-btn--sm">Station Node :&gt;</a>' +
          '    </div>' +
          '  </div>' +
          '</article>';
      }
      html += '</div>';

      container.innerHTML = html;
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      FederatedFriends.init();
    });
  } else {
    FederatedFriends.init();
  }

  window.FederatedFriends = FederatedFriends;
})(window, document);

