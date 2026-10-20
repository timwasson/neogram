/**
 * Neogram Embeddable Client Widget (v2.0)
 * Zero-dependency vanilla JS script to inject retro feeds, guestbooks, and counters into static sites.
 */
(function (window, document) {
  'use strict';

  var Neogram = {
    init: function () {
      var widgets = document.querySelectorAll('[data-neogram-widget]');
      for (var i = 0; i < widgets.length; i++) {
        var el = widgets[i];
        var type = el.getAttribute('data-neogram-widget');
        if (type === 'counter') {
          this.renderCounter(el);
        } else if (type === 'feed') {
          this.renderFeed(el);
        } else if (type === 'guestbook') {
          this.renderGuestbook(el);
        }
      }
    },

    renderCounter: function (el) {
      var userId = el.getAttribute('data-user-id') || 'demo';
      var style = el.getAttribute('data-style') || 'green_led';
      el.classList.add('neogram-counter', 'neogram-counter--' + style);
      el.innerHTML = '<span class="neogram-counter__digits">042981</span>';
    },

    renderFeed: function (el) {
      el.classList.add('neogram-feed');
      el.innerHTML =
        '<div class="neogram-post">' +
        '  <div class="neogram-post__header">' +
        '    <span class="neogram-post__avatar">💾</span>' +
        '    <span class="neogram-post__handle">root@neogram</span>' +
        '  </div>' +
        '  <div class="neogram-post__caption">Neogram static embed initialized.</div>' +
        '</div>';
    },

    renderGuestbook: function (el) {
      el.classList.add('neogram-guestbook');
      el.innerHTML =
        '<div class="neogram-guestbook__header">Public Visitor Ledger</div>' +
        '<div class="neogram-guestbook__entries">No entries recorded yet.</div>';
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      Neogram.init();
    });
  } else {
    Neogram.init();
  }

  window.Neogram = Neogram;
})(window, document);
