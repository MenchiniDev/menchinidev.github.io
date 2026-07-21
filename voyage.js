/* =========================================================
   LM — lateral descent
   A capsule falls down the right margin as the page is read,
   and plants itself in the Moon at the bottom of the trajectory.
   ========================================================= */
(function () {
  'use strict';

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- math ---------- */
  function clamp(v, a, b) { a = a === undefined ? 0 : a; b = b === undefined ? 1 : b; return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function inv(v, a, b) { return clamp((v - a) / (b - a)); }
  function easeOut(t) { return 1 - Math.pow(1 - t, 3); }

  function P(x, y) { return { x: x, y: y }; }
  function mix(a, b, t) { return P(lerp(a.x, b.x, t), lerp(a.y, b.y, t)); }

  function bezier(p0, p1, p2, p3, t) {
    var u = 1 - t;
    return P(
      u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
      u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y
    );
  }
  function tangent(p0, p1, p2, p3, t) {
    var u = 1 - t;
    return P(
      3 * u * u * (p1.x - p0.x) + 6 * u * t * (p2.x - p1.x) + 3 * t * t * (p3.x - p2.x),
      3 * u * u * (p1.y - p0.y) + 6 * u * t * (p2.y - p1.y) + 3 * t * t * (p3.y - p2.y)
    );
  }
  /* de Casteljau — the 0..t slice of the curve as a path string */
  function partialPath(p0, p1, p2, p3, t) {
    var a = mix(p0, p1, t), b = mix(p1, p2, t), c = mix(p2, p3, t);
    var d = mix(a, b, t), e = mix(b, c, t);
    var f = mix(d, e, t);
    return 'M ' + p0.x.toFixed(1) + ' ' + p0.y.toFixed(1) +
           ' C ' + a.x.toFixed(1) + ' ' + a.y.toFixed(1) +
           ' ' + d.x.toFixed(1) + ' ' + d.y.toFixed(1) +
           ' ' + f.x.toFixed(1) + ' ' + f.y.toFixed(1);
  }

  var $ = function (id) { return document.getElementById(id); };

  /* ---------- nav ---------- */
  var nav = $('nav');
  var cue = $('cue');

  /* ---------- reveal on scroll ---------- */
  var revealables = document.querySelectorAll('[data-reveal]');
  if ('IntersectionObserver' in window && !reduced) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add('is-in'); io.unobserve(en.target); }
      });
    }, { rootMargin: '0px 0px -12% 0px', threshold: 0.08 });
    Array.prototype.forEach.call(revealables, function (el) { io.observe(el); });
  } else {
    Array.prototype.forEach.call(revealables, function (el) { el.classList.add('is-in'); });
  }

  /* =========================================================
     STARFIELD
     ========================================================= */
  (function starfield() {
    var cv = $('starfield');
    if (!cv) return;
    var ctx = cv.getContext('2d');
    var stars = [], W = 0, H = 0, dpr = Math.min(window.devicePixelRatio || 1, 2);

    function seed() {
      W = cv.clientWidth; H = cv.clientHeight;
      cv.width = W * dpr; cv.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      var n = Math.max(80, Math.min(Math.round((W * H) / 6000), 260));
      stars = [];
      for (var i = 0; i < n; i++) {
        stars.push({
          x: Math.random() * W,
          y: Math.random() * H,
          r: Math.random() < 0.88 ? Math.random() * 0.75 + 0.22 : Math.random() * 1.2 + 0.8,
          a: Math.random() * 0.45 + 0.15,
          s: Math.random() * 0.9 + 0.2,
          p: Math.random() * Math.PI * 2
        });
      }
    }

    function draw(time) {
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = '#e8e3d9';
      for (var i = 0; i < stars.length; i++) {
        var st = stars[i];
        var tw = reduced ? 1 : 0.65 + 0.35 * Math.sin(time * 0.0008 * st.s + st.p);
        ctx.globalAlpha = st.a * tw;
        ctx.beginPath();
        ctx.arc(st.x, st.y, st.r, 0, 6.2832);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    seed();
    draw(0);
    if (!reduced) { (function loop(t) { draw(t); requestAnimationFrame(loop); })(0); }

    var rt;
    window.addEventListener('resize', function () {
      clearTimeout(rt);
      rt = setTimeout(function () { seed(); draw(performance.now()); }, 180);
    });
  })();

  /* =========================================================
     THE DESCENT
     ========================================================= */
  var orbit = $('orbit');
  if (!orbit) return;

  var shake = $('shake'), moon = $('moon'), rocket = $('rocket'), exhaust = $('exhaust');
  var plan = $('plan'), trail = $('trail'), debris = $('debris'), tele = $('tele');

  /* trajectory — identical to #plan in the markup */
  var A = P(150, 70), B = P(30, 330), C = P(190, 600), D = P(104, 846);

  /* timeline over the whole page scroll */
  var T = {
    launch: [0.015, 0.05],   // capsule fades in
    flight: [0.02, 0.86],    // travel along the trajectory
    impact: [0.84, 0.92],    // it buries itself
    quake:  [0.845, 0.90],
    dust:   [0.845, 0.99]
  };

  /* --- debris particles --- */
  var parts = [];
  for (var i = 0; i < 12; i++) {
    var c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    debris.appendChild(c);
    parts.push({
      el: c,
      a: (i / 12) * Math.PI * 2 + Math.random() * 0.5,
      d: 24 + Math.random() * 46,
      s: 0.8 + Math.random() * 1.6
    });
  }

  function render(p) {
    if (cue) cue.style.opacity = 1 - inv(p, 0.005, 0.045);

    var t = inv(p, T.flight[0], T.flight[1]);
    var pt = bezier(A, B, C, D, t);
    var tg = tangent(A, B, C, D, t);
    var len = Math.sqrt(tg.x * tg.x + tg.y * tg.y) || 1;
    var ang = Math.atan2(tg.y, tg.x) * 180 / Math.PI;

    /* after contact it keeps sinking a little */
    var k = easeOut(inv(p, T.impact[0], T.impact[1]));
    var pen = k * 26;
    var x = pt.x + (tg.x / len) * pen;
    var y = pt.y + (tg.y / len) * pen;
    var sc = lerp(0.2, 0.34, easeOut(t));

    rocket.setAttribute('opacity', inv(p, T.launch[0], T.launch[1]).toFixed(3));
    rocket.setAttribute('transform',
      'translate(' + x.toFixed(1) + ' ' + y.toFixed(1) + ') rotate(' + ang.toFixed(2) + ') scale(' + sc.toFixed(4) + ')');
    exhaust.setAttribute('opacity', (1 - inv(p, T.impact[0] - 0.06, T.impact[0])).toFixed(3));

    trail.setAttribute('d', t > 0.001 ? partialPath(A, B, C, D, t) : '');
    plan.setAttribute('opacity', (0.16 * (1 - k * 0.7)).toFixed(3));

    /* the Moon takes the hit */
    moon.setAttribute('opacity', lerp(0.45, 1, inv(p, 0.35, 0.84)).toFixed(3));
    var ms = 1 + 0.014 * k;
    moon.setAttribute('transform',
      'translate(100 ' + (890 + 2.5 * k).toFixed(2) + ') scale(' + ms.toFixed(4) + ') translate(-100 -890)');

    /* debris */
    var dp = inv(p, T.dust[0], T.dust[1]);
    if (dp > 0 && dp < 1) {
      debris.setAttribute('opacity', (1 - dp).toFixed(3));
      debris.setAttribute('transform', 'translate(' + D.x.toFixed(1) + ' ' + D.y.toFixed(1) + ')');
      var de = easeOut(dp);
      for (var j = 0; j < parts.length; j++) {
        var o = parts[j];
        o.el.setAttribute('cx', (Math.cos(o.a) * o.d * de).toFixed(1));
        o.el.setAttribute('cy', (Math.sin(o.a) * o.d * de - 8 * de * de).toFixed(1));
        o.el.setAttribute('r', (o.s * (1 - dp * 0.85)).toFixed(2));
      }
    } else {
      debris.setAttribute('opacity', 0);
    }

    /* a short tremor on contact */
    var q = inv(p, T.quake[0], T.quake[1]);
    var amp = q > 0 && q < 1 ? 5 * (1 - q) : 0;
    shake.setAttribute('transform',
      'translate(' + (Math.sin(q * Math.PI * 9) * amp * 0.6).toFixed(2) + ' ' + (Math.cos(q * Math.PI * 11) * amp).toFixed(2) + ')');

    /* telemetry */
    if (tele) {
      tele.textContent = k > 0.985 ? 'CONTACT' : ('00' + Math.round(t * 100)).slice(-3);
      tele.setAttribute('opacity', k > 0.985 ? 0.75 : 0.5);
    }
  }

  /* --- scroll loop --- */
  var ticking = false;

  function readProgress() {
    var span = document.documentElement.scrollHeight - window.innerHeight;
    return span <= 0 ? 0 : clamp(window.scrollY / span);
  }

  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () {
      render(readProgress());
      if (nav) nav.classList.toggle('is-stuck', window.scrollY > 48);
      ticking = false;
    });
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', function () { render(readProgress()); });
  window.addEventListener('load', function () { render(readProgress()); });
  render(readProgress());
  if (nav) nav.classList.toggle('is-stuck', window.scrollY > 48);
})();
