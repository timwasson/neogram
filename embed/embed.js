/**
 * Neogram embed widgets (v3)
 * Zero-dependency script for counters, guestbooks, photo feeds and the chat pager on any page.
 *
 *   <script src="https://neogram.club/embed/embed.js" defer></script>
 *   <div data-neogram-widget="counter"   data-user-id="your_handle" data-style="green_led"></div>
 *   <div data-neogram-widget="guestbook" data-user-id="your_handle"></div>
 *   <div data-neogram-widget="feed"      data-user-id="your_handle" data-limit="6"></div>
 *   <div data-neogram-widget="pager"     data-station="your_handle"></div>
 *
 * Optional on any widget: data-slug="<site slug>" (multi-site accounts), data-api="https://neogram.club".
 * All remote text is inserted with textContent; only http(s) URLs are used for links and images.
 */
(function (window, document) {
  'use strict';

  // document.currentScript is only available while the script first runs, so capture it now.
  var thisScript = document.currentScript;
  var DEFAULT_API = (function () {
    var explicit = thisScript && thisScript.getAttribute('data-api');
    if (explicit && /^https?:\/\//i.test(explicit)) {
      try { return new URL(explicit).origin; } catch (e) {}
    }
    if (thisScript && thisScript.src) {
      try { return new URL(thisScript.src).origin; } catch (e) {}
    }
    return 'https://neogram.club';
  })();

  function apiFor(el) {
    var explicit = el.getAttribute('data-api');
    if (explicit && /^https?:\/\//i.test(explicit)) {
      try { return new URL(explicit).origin; } catch (e) {}
    }
    return DEFAULT_API;
  }

  function identity(el) {
    var id = (el.getAttribute('data-user-id') || el.getAttribute('data-station') || '').replace(/^@/, '').trim();
    return /^[A-Za-z0-9_.-]{1,64}$/.test(id) ? id : '';
  }

  function slugPart(el) {
    var slug = (el.getAttribute('data-slug') || '').trim();
    return /^[a-z0-9-]{1,60}$/.test(slug) ? '/' + slug : '';
  }

  function safeUrl(u) {
    return typeof u === 'string' && /^https?:\/\//i.test(u) ? u : '';
  }

  function make(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function showMessage(el, text) {
    el.textContent = '';
    el.appendChild(make('div', 'neogram-empty', text));
  }

  var Neogram = {
    init: function (root) {
      var widgets = (root || document).querySelectorAll('[data-neogram-widget]');
      for (var i = 0; i < widgets.length; i++) {
        var el = widgets[i];
        if (el.getAttribute('data-neogram-ready') === 'true') continue;
        el.setAttribute('data-neogram-ready', 'true');
        var type = el.getAttribute('data-neogram-widget');
        try {
          if (type === 'counter') this.renderCounter(el);
          else if (type === 'feed') this.renderFeed(el);
          else if (type === 'guestbook') this.renderGuestbook(el);
          else if (type === 'pager') this.renderPager(el);
        } catch (err) {
          if (window.console) console.warn('[neogram] widget failed:', err);
        }
      }
    },

    renderCounter: function (el) {
      var id = identity(el);
      if (!id) return showMessage(el, 'Neogram counter: add data-user-id="your_handle".');
      var style = (el.getAttribute('data-style') || 'green_led').replace(/[^a-z0-9_]/g, '');
      el.classList.add('neogram-counter');
      el.textContent = '';
      var img = make('img', 'neogram-counter__image');
      img.src = apiFor(el) + '/counter/' + encodeURIComponent(id) + slugPart(el) + '.svg?style=' + encodeURIComponent(style);
      img.alt = 'Visitor counter';
      img.loading = 'lazy';
      el.appendChild(img);
    },

    renderGuestbook: function (el) {
      var id = identity(el);
      if (!id) return showMessage(el, 'Neogram guestbook: add data-user-id="your_handle".');
      var theme = (el.getAttribute('data-theme') || 'win95').replace(/[^a-z0-9]/g, '');
      var height = parseInt(el.getAttribute('data-height'), 10) || 550;
      el.classList.add('neogram-guestbook');
      el.textContent = '';
      var frame = make('iframe', 'neogram-guestbook__frame');
      frame.src = apiFor(el) + '/embed/guestbook/' + encodeURIComponent(id) + slugPart(el) + '?theme=' + encodeURIComponent(theme);
      frame.title = 'Guestbook';
      frame.loading = 'lazy';
      frame.setAttribute('width', '100%');
      frame.setAttribute('height', String(Math.min(Math.max(height, 200), 2000)));
      frame.setAttribute('frameborder', '0');
      el.appendChild(frame);
    },

    renderFeed: function (el) {
      var id = identity(el);
      if (!id) return showMessage(el, 'Neogram feed: add data-user-id="your_handle".');
      var limit = Math.min(Math.max(parseInt(el.getAttribute('data-limit'), 10) || 6, 1), 50);
      var slug = slugPart(el).slice(1);
      var url = apiFor(el) + '/api/users/' + encodeURIComponent(id) + '/feed.json' + (slug ? '?siteSlug=' + encodeURIComponent(slug) : '');
      el.classList.add('neogram-feed', 'neogram-feed--grid');
      showMessage(el, 'Loading photos…');
      if (!window.fetch) return showMessage(el, 'Photos need a newer browser.');

      fetch(url)
        .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)); })
        .then(function (data) {
          var items = (data && Array.isArray(data.items) ? data.items : []).slice(0, limit);
          el.textContent = '';
          if (items.length === 0) return showMessage(el, 'No photos yet.');
          items.forEach(function (item) {
            var card = make('article', 'neogram-post');
            var link = safeUrl(item.url);
            var media = make(link ? 'a' : 'div', 'neogram-post__media');
            if (link) { media.href = link; media.target = '_blank'; media.rel = 'noopener noreferrer'; }
            var src = safeUrl(item.thumbnailUrl) || safeUrl(item.imageUrl);
            if (src) {
              var img = make('img', 'neogram-post__image');
              img.src = src;
              img.alt = item.caption ? String(item.caption).slice(0, 120) : 'Photo';
              img.loading = 'lazy';
              media.appendChild(img);
            }
            card.appendChild(media);
            if (item.caption) card.appendChild(make('p', 'neogram-post__caption', item.caption));
            var meta = make('div', 'neogram-post__actions');
            meta.appendChild(make('span', 'neogram-post__likes', '♥ ' + (parseInt(item.likes, 10) || 0)));
            if (item.createdAt) {
              var d = new Date(item.createdAt);
              if (!isNaN(d.getTime())) meta.appendChild(make('time', 'neogram-post__date', d.toLocaleDateString()));
            }
            card.appendChild(meta);
            el.appendChild(card);
          });
        })
        .catch(function () { showMessage(el, "Couldn't load photos right now."); });
    },

    renderPager: function (el) {
      var id = identity(el);
      if (!id || document.querySelector('script[data-neogram-pager]')) return;
      var script = document.createElement('script');
      script.src = apiFor(el) + '/embed/pager.js';
      script.setAttribute('data-station', id);
      script.setAttribute('data-api', apiFor(el));
      script.setAttribute('data-neogram-pager', 'true');
      var slug = slugPart(el).slice(1);
      if (slug) script.setAttribute('data-slug', slug);
      document.body.appendChild(script);
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { Neogram.init(); });
  } else {
    Neogram.init();
  }

  window.Neogram = Neogram;
})(window, document);
