/* =========================================================
   LM — cosmos
   Interface layer: reticle cursor, decoding telemetry text,
   title ignition, mission clock, magnetic buttons.
   ========================================================= */
(function () {
  'use strict';

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  var $ = function (id) { return document.getElementById(id); };
  var each = function (sel, fn) { Array.prototype.forEach.call(document.querySelectorAll(sel), fn); };

  document.documentElement.classList.add('js');

  /* =========================================================
     TITLE IGNITION — letters rise one by one
     ========================================================= */
  each('[data-ignite]', function (h) {
    h.setAttribute('aria-label', h.textContent.replace(/\s+/g, ' ').trim());
    var i = 0;
    (function split(node) {
      Array.prototype.slice.call(node.childNodes).forEach(function (ch) {
        if (ch.nodeType === 3) {
          var frag = document.createDocumentFragment();
          ch.textContent.split('').forEach(function (c) {
            if (!c.trim()) { frag.appendChild(document.createTextNode(c)); return; }
            var s = document.createElement('span');
            s.className = 'ch';
            s.setAttribute('aria-hidden', 'true');
            s.style.setProperty('--i', i++);
            s.textContent = c;
            frag.appendChild(s);
          });
          node.replaceChild(frag, ch);
        } else if (ch.nodeType === 1 && ch.tagName !== 'BR') {
          split(ch);
        }
      });
    })(h);
  });

  /* =========================================================
     DECODE — telemetry text resolves from noise
     ========================================================= */
  var GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#/<>—·+';

  function decode(el) {
    if (el.dataset.decoded) return;
    el.dataset.decoded = '1';
    var final = el.textContent;
    if (reduced) return;
    var start = performance.now(), dur = Math.min(1400, 380 + final.length * 28);
    (function tick(now) {
      var p = Math.min(1, (now - start) / dur);
      var out = '';
      for (var i = 0; i < final.length; i++) {
        var c = final[i];
        if (c === ' ' || i / final.length < p * 1.15 - 0.15) out += c;
        else out += GLYPHS[(Math.random() * GLYPHS.length) | 0];
      }
      el.textContent = out;
      if (p < 1) requestAnimationFrame(tick); else el.textContent = final;
    })(start);
  }

  var decodables = document.querySelectorAll('[data-decode]');
  if ('IntersectionObserver' in window) {
    var dio = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        var el = en.target;
        setTimeout(function () { decode(el); }, +(el.dataset.decode || 0));
        dio.unobserve(el);
      });
    }, { threshold: 0.4 });
    Array.prototype.forEach.call(decodables, function (el) { dio.observe(el); });
  }

  /* =========================================================
     MISSION CLOCK — UTC + elapsed time on page
     ========================================================= */
  var clock = $('clock');
  if (clock) {
    var t0 = Date.now();
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    var tickClock = function () {
      var d = new Date(), e = Math.floor((Date.now() - t0) / 1000);
      clock.innerHTML =
        '<span>UTC ' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds()) + '</span>' +
        '<span class="nav__met">MET T+' + pad(Math.floor(e / 60)) + ':' + pad(e % 60) + '</span>';
    };
    tickClock();
    setInterval(tickClock, 1000);
  }

  /* =========================================================
     RETICLE CURSOR
     ========================================================= */
  if (finePointer && !reduced) {
    var ret = document.createElement('div');
    ret.className = 'reticle';
    ret.innerHTML = '<i class="reticle__dot"></i><i class="reticle__ring"></i><b class="reticle__xy"></b>';
    document.body.appendChild(ret);
    var dot = ret.children[0], ring = ret.children[1], xy = ret.children[2];
    var x = -100, y = -100, rx = -100, ry = -100, seen = false;

    window.addEventListener('pointermove', function (e) {
      x = e.clientX; y = e.clientY;
      if (!seen) { seen = true; rx = x; ry = y; document.documentElement.classList.add('has-reticle'); }
    }, { passive: true });
    document.addEventListener('pointerleave', function () { ret.classList.add('is-gone'); });
    document.addEventListener('pointerenter', function () { ret.classList.remove('is-gone'); });
    window.addEventListener('pointerdown', function () { ret.classList.add('is-down'); });
    window.addEventListener('pointerup', function () { ret.classList.remove('is-down'); });

    document.addEventListener('pointerover', function (e) {
      ret.classList.toggle('is-lock', !!e.target.closest('a, button'));
    });

    (function follow() {
      rx += (x - rx) * 0.18; ry += (y - ry) * 0.18;
      dot.style.transform = 'translate(' + x + 'px,' + y + 'px)';
      ring.style.transform = 'translate(' + rx + 'px,' + ry + 'px)';
      xy.style.transform = 'translate(' + (rx + 26) + 'px,' + (ry + 18) + 'px)';
      xy.textContent = ('000' + Math.round(x)).slice(-4) + ' · ' + ('000' + Math.round(y)).slice(-4);
      requestAnimationFrame(follow);
    })();
  }

  /* =========================================================
     MAGNETIC BUTTONS
     ========================================================= */
  if (finePointer && !reduced) {
    each('.btn, .beacon', function (b) {
      b.addEventListener('pointermove', function (e) {
        var r = b.getBoundingClientRect();
        var dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
        b.style.transform = 'translate(' + (dx * 0.22).toFixed(1) + 'px,' + (dy * 0.3).toFixed(1) + 'px)';
      });
      b.addEventListener('pointerleave', function () { b.style.transform = ''; });
    });
  }
})();
