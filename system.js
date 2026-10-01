/* =========================================================
   LM — the system
   Every project is a planet. The page scroll drives a camera
   from a wide view of the system to each world in turn.
   Software-rendered: procedural textures mapped onto spheres,
   lit by the sun from wherever the camera happens to be.
   ========================================================= */
(function () {
  'use strict';

  var root = document.getElementById('voyage');
  if (!root) return;

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var stage = root.querySelector('.voyage__stage');
  var cv = root.querySelector('.voyage__canvas');
  var ctx = cv.getContext('2d');
  var panels = root.querySelectorAll('.vpanel');
  var anchors = root.querySelectorAll('.voyage__anchor');
  var rail = root.querySelectorAll('.voyage__rail button');
  var hud = {};
  Array.prototype.forEach.call(root.querySelectorAll('[data-hud]'), function (el) { hud[el.dataset.hud] = el; });
  var orbitStrip = document.getElementById('orbit');

  /* ---------- scalar math ---------- */
  function clamp(v, a, b) { a = a === undefined ? 0 : a; b = b === undefined ? 1 : b; return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smooth(t) { return t * t * (3 - 2 * t); }
  function smoother(t) { return t * t * t * (t * (t * 6 - 15) + 10); }

  /* ---------- vectors ---------- */
  function V(x, y, z) { return { x: x, y: y, z: z }; }
  function add(a, b) { return V(a.x + b.x, a.y + b.y, a.z + b.z); }
  function sub(a, b) { return V(a.x - b.x, a.y - b.y, a.z - b.z); }
  function mul(a, k) { return V(a.x * k, a.y * k, a.z * k); }
  function dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
  function cross(a, b) { return V(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x); }
  function len(a) { return Math.sqrt(dot(a, a)); }
  function norm(a) { var l = len(a) || 1; return mul(a, 1 / l); }
  function vlerp(a, b, t) { return V(lerp(a.x, b.x, t), lerp(a.y, b.y, t), lerp(a.z, b.z, t)); }
  function rotY(a, t) { var c = Math.cos(t), s = Math.sin(t); return V(a.x * c + a.z * s, a.y, -a.x * s + a.z * c); }
  var UP = V(0, 1, 0);

  /* =========================================================
     NOISE — seeded 3D value noise, sampled on the sphere so
     textures never show a seam
     ========================================================= */
  var seed = 7;
  function rand() {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }
  var perm = new Uint8Array(512), grad = new Float32Array(256);
  (function () {
    var p = [];
    for (var i = 0; i < 256; i++) { p[i] = i; grad[i] = rand(); }
    for (i = 255; i > 0; i--) { var j = (rand() * (i + 1)) | 0, t = p[i]; p[i] = p[j]; p[j] = t; }
    for (i = 0; i < 512; i++) perm[i] = p[i & 255];
  })();
  function h(i, j, k) { return grad[perm[perm[perm[i & 255] + (j & 255)] + (k & 255)]]; }
  function noise(x, y, z) {
    var xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    var xf = x - xi, yf = y - yi, zf = z - zi;
    var u = smooth(xf), v = smooth(yf), w = smooth(zf);
    var a = lerp(h(xi, yi, zi), h(xi + 1, yi, zi), u), b = lerp(h(xi, yi + 1, zi), h(xi + 1, yi + 1, zi), u);
    var c = lerp(h(xi, yi, zi + 1), h(xi + 1, yi, zi + 1), u), d = lerp(h(xi, yi + 1, zi + 1), h(xi + 1, yi + 1, zi + 1), u);
    return lerp(lerp(a, b, v), lerp(c, d, v), w);
  }
  function fbm(x, y, z, oct) {
    var s = 0, amp = 0.5, f = 1, n = 0;
    for (var i = 0; i < oct; i++) { s += amp * noise(x * f + 17.3 * i, y * f, z * f); n += amp; amp *= 0.5; f *= 2.03; }
    return s / n;
  }
  function mix3(a, b, t) { return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; }

  /* =========================================================
     TEXTURES — equirectangular, generated once on demand
     ========================================================= */
  var TW = 512, TH = 256;

  function bake(fn) {
    var data = new Uint8ClampedArray(TW * TH * 4);
    for (var j = 0; j < TH; j++) {
      var lat = (0.5 - (j + 0.5) / TH) * Math.PI, cl = Math.cos(lat), y = Math.sin(lat);
      for (var i = 0; i < TW; i++) {
        var lon = (i / TW) * Math.PI * 2;
        var c = fn(cl * Math.sin(lon), y, cl * Math.cos(lon), lat);
        var o = (j * TW + i) * 4;
        data[o] = c[0]; data[o + 1] = c[1]; data[o + 2] = c[2]; data[o + 3] = 255;
      }
    }
    return data;
  }

  /* R—01 · a regolith world, grey and cratered */
  function texRegolith() {
    var craters = [];
    for (var i = 0; i < 46; i++) {
      var u = rand() * 2 - 1, t = rand() * Math.PI * 2, s = Math.sqrt(1 - u * u);
      craters.push({ x: s * Math.cos(t), y: u, z: s * Math.sin(t), r: 0.04 + Math.pow(rand(), 3) * 0.22 });
    }
    return bake(function (x, y, z) {
      var n = fbm(x * 3, y * 3, z * 3, 5);
      var mare = smooth(clamp((fbm(x * 1.3 + 4, y * 1.3, z * 1.3, 3) - 0.5) * 6));
      var g = 150 + (n - 0.5) * 90 - mare * 48;
      for (var k = 0; k < craters.length; k++) {
        var c = craters[k];
        var d = Math.acos(clamp(x * c.x + y * c.y + z * c.z, -1, 1)) / c.r;
        if (d < 1.25) {
          if (d < 0.85) g -= 24 * (1 - d / 0.85) + 8;
          else if (d < 1.05) g += 34 * (1 - Math.abs(d - 0.95) / 0.1);
          else g += 6 * (1.25 - d) / 0.2;
        }
      }
      return [g * 1.02, g, g * 0.96];
    });
  }

  /* P—01 · Earth, seen the way Sentinel-2 sees it */
  function texEarth() {
    return bake(function (x, y, z, lat) {
      var hgt = fbm(x * 2.1 + 3, y * 2.1, z * 2.1, 6);
      var al = Math.abs(lat) / (Math.PI / 2);
      var c;
      if (hgt < 0.5) {
        c = mix3([10, 30, 70], [26, 86, 130], smooth(clamp((hgt - 0.3) / 0.2)));
      } else {
        var dry = fbm(x * 4 + 9, y * 4, z * 4, 3);
        c = mix3([52, 96, 52], [150, 128, 84], smooth(clamp((dry - 0.45) * 4 + (0.35 - Math.abs(al - 0.3)) * 1.2)));
        c = mix3(c, [96, 88, 70], clamp((hgt - 0.62) * 5));
      }
      if (al > 0.82) c = mix3(c, [228, 236, 240], smooth(clamp((al - 0.82) / 0.08)));
      var cl = fbm(x * 3.2 + 40, y * 6.5, z * 3.2, 5);
      c = mix3(c, [240, 244, 248], smooth(clamp((cl - 0.52) * 4.5)) * 0.85);
      return c;
    });
  }

  /* P—02 · a world wired like a network of agents */
  function texNetwork() {
    return bake(function (x, y, z, lat) {
      var warp = fbm(x * 2, y * 2, z * 2, 4);
      var band = Math.sin(lat * 7 + warp * 6);
      var c = mix3([24, 32, 78], [36, 118, 138], smooth(clamp(band * 0.5 + 0.5)));
      c = mix3(c, [92, 52, 140], smooth(clamp((fbm(x * 3 + 5, y * 3, z * 3, 3) - 0.5) * 3)));
      var ridge = Math.abs(fbm(x * 4.5 + 11, y * 4.5, z * 4.5, 4) - 0.5);
      var line = clamp(1 - ridge / 0.022);
      c = mix3(c, [150, 240, 236], line * 0.9);
      return c;
    });
  }

  /* P—03 · a carnival giant, banded in parade colours */
  function texCarnival() {
    var pal = [[86, 34, 108], [212, 64, 118], [236, 132, 56], [244, 204, 98], [40, 150, 150], [212, 64, 118], [86, 34, 108]];
    return bake(function (x, y, z, lat) {
      var turb = fbm(x * 2.4, y * 5, z * 2.4, 5);
      var t = clamp((Math.sin(lat * 3.2 + turb * 3.4) * 0.5 + 0.5));
      var f = t * (pal.length - 1), i = Math.min(pal.length - 2, f | 0);
      var c = mix3(pal[i], pal[i + 1], smooth(f - i));
      var spot = Math.sqrt(Math.pow(x - 0.62, 2) + Math.pow(y + 0.28, 2) * 4 + Math.pow(z - 0.72, 2));
      if (spot < 0.22) c = mix3(c, [250, 236, 210], smooth(1 - spot / 0.22) * 0.75);
      return c;
    });
  }

  /* =========================================================
     THE SYSTEM
     ========================================================= */
  var SUN = { pos: V(0, 0, 0), R: 1.7 };

  var worlds = [
    { label: 'R—01', name: 'Lunar Rover',     orbit: 6.4,  R: 0.58, a0: 3.75, w: 0.010, spin: 0.020, make: texRegolith, atm: [190, 190, 190], atmK: 0.10, frame: 3.7 },
    { label: 'P—01', name: 'Orbit to Edge',   orbit: 9.8,  R: 0.80, a0: 5.35, w: 0.007, spin: 0.016, make: texEarth,    atm: [96, 160, 255],  atmK: 0.95, frame: 3.8, sat: true },
    { label: 'P—02', name: 'Multi-Agent',     orbit: 13.8, R: 0.96, a0: 0.95, w: 0.005, spin: 0.012, make: texNetwork,  atm: [120, 220, 230], atmK: 0.55, frame: 4.9, moons: 3 },
    { label: 'P—03', name: 'Carnival',        orbit: 18.4, R: 1.18, a0: 2.15, w: 0.004, spin: 0.010, make: texCarnival, atm: [250, 170, 120], atmK: 0.35, frame: 6.4, ring: [1.45, 2.35] }
  ];
  worlds.forEach(function (p) {
    p.off = document.createElement('canvas');
    p.octx = p.off.getContext('2d');
    p.S = 0;
  });

  /* textures are baked lazily, one per idle slice, so the page never stalls */
  var bakeQueue = worlds.slice();
  function bakeNext() {
    var p = bakeQueue.shift();
    if (!p) return;
    p.tex = p.make();
    var avg = [0, 0, 0];
    for (var i = 0; i < p.tex.length; i += 4 * 97) { avg[0] += p.tex[i]; avg[1] += p.tex[i + 1]; avg[2] += p.tex[i + 2]; }
    var n = p.tex.length / (4 * 97);
    p.avg = [avg[0] / n | 0, avg[1] / n | 0, avg[2] / n | 0];
    schedule(bakeNext);
  }
  function schedule(fn) { (window.requestIdleCallback || function (f) { return setTimeout(f, 30); })(fn); }

  /* =========================================================
     SPHERE RASTERISER — per-size lookup tables, then a cheap
     per-pixel loop: texture fetch + lambert + atmosphere rim
     ========================================================= */
  var luts = {};
  function lut(S) {
    if (luts[S]) return luts[S];
    var idx = [], u = [], v = [], nx = [], ny = [], nz = [], al = [];
    var edge = 1 + 1.5 / S;
    for (var py = 0; py < S; py++) {
      for (var px = 0; px < S; px++) {
        var x = (px + 0.5) / S * 2 - 1, y = 1 - (py + 0.5) / S * 2;
        var d2 = x * x + y * y;
        if (d2 > edge * edge) continue;
        var d = Math.sqrt(d2), cx = x, cy = y;
        if (d > 1) { cx /= d; cy /= d; }
        var z = Math.sqrt(Math.max(0, 1 - cx * cx - cy * cy));
        idx.push(py * S + px);
        u.push(Math.atan2(cx, z) / (Math.PI * 2));
        v.push(clamp((0.5 - Math.asin(clamp(cy, -1, 1)) / Math.PI) * TH - 0.5, 0, TH - 1.001));
        nx.push(cx); ny.push(cy); nz.push(z);
        al.push(clamp((1 - d) * S * 0.5 + 0.5));
      }
    }
    var L = luts[S] = {
      n: idx.length, idx: new Int32Array(idx), u: new Float32Array(u), v: new Float32Array(v),
      nx: new Float32Array(nx), ny: new Float32Array(ny), nz: new Float32Array(nz), al: new Float32Array(al)
    };
    return L;
  }

  function rasterise(p, S, lx, ly, lz, rot) {
    if (p.S !== S) {
      p.off.width = p.off.height = S;
      p.img = p.octx.createImageData(S, S);
      p.S = S;
    }
    var L = lut(S), out = p.img.data, tex = p.tex;
    var ar = p.atm[0], ag = p.atm[1], ab = p.atm[2], ak = p.atmK;
    for (var k = 0; k < L.n; k++) {
      var uu = L.u[k] + rot; uu -= Math.floor(uu);
      var fx = uu * TW, x0 = fx | 0, wx = fx - x0, x1 = x0 + 1 === TW ? 0 : x0 + 1;
      var fy = L.v[k], y0 = fy | 0, wy = fy - y0;
      var r0 = y0 * TW, r1 = r0 + TW;
      var a00 = (r0 + x0) * 4, a10 = (r0 + x1) * 4, a01 = (r1 + x0) * 4, a11 = (r1 + x1) * 4;
      var w00 = (1 - wx) * (1 - wy), w10 = wx * (1 - wy), w01 = (1 - wx) * wy, w11 = wx * wy;
      var nzk = L.nz[k];
      var lam = L.nx[k] * lx + L.ny[k] * ly + nzk * lz;
      var lit = clamp((lam + 0.08) / 0.45);
      lit = lit * lit * (3 - 2 * lit);
      var shade = 0.035 + 0.965 * lit * (0.55 + 0.45 * Math.max(lam, 0));
      var rim = 1 - nzk; rim = rim * rim * rim * ak * clamp(lam + 0.35);
      var o = L.idx[k] * 4;
      out[o]     = (tex[a00] * w00 + tex[a10] * w10 + tex[a01] * w01 + tex[a11] * w11) * shade + ar * rim;
      out[o + 1] = (tex[a00 + 1] * w00 + tex[a10 + 1] * w10 + tex[a01 + 1] * w01 + tex[a11 + 1] * w11) * shade + ag * rim;
      out[o + 2] = (tex[a00 + 2] * w00 + tex[a10 + 2] * w10 + tex[a01 + 2] * w01 + tex[a11 + 2] * w11) * shade + ab * rim;
      out[o + 3] = L.al[k] * 255;
    }
    p.octx.putImageData(p.img, 0, 0);
  }

  /* =========================================================
     CAMERA
     ========================================================= */
  var W = 0, H = 0, dpr = 1, focal = 1;
  var cam = { pos: V(0, 10, 30), f: V(0, 0, -1), r: V(1, 0, 0), u: V(0, 1, 0), cx: 0, cy: 0 };

  function look(pos, target) {
    cam.pos = pos;
    cam.f = norm(sub(target, pos));
    cam.r = norm(cross(cam.f, UP));
    cam.u = cross(cam.r, cam.f);
  }
  function project(P) {
    var d = sub(P, cam.pos), z = dot(d, cam.f);
    if (z < 0.08) return null;
    var k = focal / z;
    return { x: cam.cx + dot(d, cam.r) * k, y: cam.cy - dot(d, cam.u) * k, z: z, k: k };
  }
  /* light direction (towards the sun) expressed in camera space, z towards the viewer */
  function lightFor(P) {
    var l = norm(sub(SUN.pos, P));
    return [dot(l, cam.r), dot(l, cam.u), -dot(l, cam.f)];
  }

  function worldPos(p, t) {
    var a = p.a0 + p.w * t;
    return V(Math.cos(a) * p.orbit, 0, Math.sin(a) * p.orbit);
  }

  function narrow() { return W < 760; }

  /* keyframe for stop i: camera position, target, lens shift */
  function key(i, t) {
    if (i === 0) {
      return {
        pos: V(0, 19, 33), target: V(0, -1.2, 0),
        sx: narrow() ? 0 : W * 0.16, sy: narrow() ? -H * 0.13 : 0
      };
    }
    var p = worlds[i - 1], P = worldPos(p, t);
    var toSun = norm(mul(P, -1));
    var dir = rotY(toSun, -1.05);
    var dist = p.R * p.frame * (narrow() ? 1.25 : 1);
    return {
      pos: add(add(P, mul(dir, dist)), mul(UP, dist * 0.3)),
      target: P,
      sx: narrow() ? 0 : W * 0.2, sy: narrow() ? -H * 0.2 : 0
    };
  }

  /* =========================================================
     LAYOUT & SCROLL
     ========================================================= */
  var STOPS = 5, seg = 1, top0 = 0;

  function layout() {
    W = stage.clientWidth; H = stage.clientHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 1.75);
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    focal = Math.min(W, H) * 1.05;
    seg = (root.offsetHeight - window.innerHeight) / (STOPS - 1);
    Array.prototype.forEach.call(anchors, function (a) { a.style.top = (+a.dataset.stop * seg) + 'px'; });
  }

  function progress() {
    var r = root.getBoundingClientRect();
    top0 = window.scrollY + r.top;
    return { s: clamp(-r.top / seg, 0, STOPS - 1), rect: r };
  }

  Array.prototype.forEach.call(rail, function (b) {
    b.addEventListener('click', function () {
      window.scrollTo({ top: top0 + +b.dataset.go * seg + 2, behavior: reduced ? 'auto' : 'smooth' });
    });
  });

  /* =========================================================
     DRAWING
     ========================================================= */
  var BONE = '232,227,217', AMBER = '200,137,74';

  function drawOrbit(p, hi) {
    ctx.beginPath();
    var pen = false;
    for (var i = 0; i <= 180; i++) {
      var a = (i / 180) * Math.PI * 2;
      var q = project(V(Math.cos(a) * p.orbit, 0, Math.sin(a) * p.orbit));
      if (!q || q.z < 0.6) { pen = false; continue; }
      if (pen) ctx.lineTo(q.x, q.y); else { ctx.moveTo(q.x, q.y); pen = true; }
    }
    ctx.strokeStyle = 'rgba(' + (hi > 0.01 ? AMBER : BONE) + ',' + (0.1 + hi * 0.22).toFixed(3) + ')';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 6]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function drawSun(q) {
    var r = SUN.R * q.k;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    var g = ctx.createRadialGradient(q.x, q.y, r * 0.4, q.x, q.y, r * 7);
    g.addColorStop(0, 'rgba(255,190,120,0.42)');
    g.addColorStop(0.25, 'rgba(220,130,60,0.12)');
    g.addColorStop(1, 'rgba(200,110,50,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(q.x, q.y, r * 7, 0, 6.2832); ctx.fill();
    ctx.restore();
    var c = ctx.createRadialGradient(q.x - r * 0.2, q.y - r * 0.2, 0, q.x, q.y, r);
    c.addColorStop(0, '#fff8ea');
    c.addColorStop(0.55, '#ffd9a0');
    c.addColorStop(1, '#e89a52');
    ctx.fillStyle = c;
    ctx.beginPath(); ctx.arc(q.x, q.y, r, 0, 6.2832); ctx.fill();
  }

  function drawPlanet(p, q, rot) {
    var r = p.R * q.k;
    if (q.x + r * 2.6 < 0 || q.x - r * 2.6 > W || q.y + r * 2.6 < 0 || q.y - r * 2.6 > H) return;
    var l = lightFor(p.P);
    if (!p.tex || r < 5) {
      var c = p.avg || [140, 140, 140], b = 0.35 + 0.65 * clamp(l[2] * 0.5 + 0.5);
      ctx.fillStyle = 'rgb(' + (c[0] * b | 0) + ',' + (c[1] * b | 0) + ',' + (c[2] * b | 0) + ')';
      ctx.beginPath(); ctx.arc(q.x, q.y, Math.max(r, 1.2), 0, 6.2832); ctx.fill();
      return;
    }
    var S = clamp(Math.round(r * 2 / 8) * 8, 16, 440);
    rasterise(p, S, l[0], l[1], l[2], rot);
    if (p.atmK > 0.4) {
      var g = ctx.createRadialGradient(q.x, q.y, r * 0.92, q.x, q.y, r * 1.22);
      g.addColorStop(0, 'rgba(' + p.atm.join(',') + ',' + (0.28 * clamp(l[2] + 0.6)).toFixed(3) + ')');
      g.addColorStop(1, 'rgba(' + p.atm.join(',') + ',0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(q.x, q.y, r * 1.22, 0, 6.2832); ctx.fill();
    }
    ctx.drawImage(p.off, q.x - r, q.y - r, r * 2, r * 2);
  }

  function ringBands(p) {
    if (p.bands) return p.bands;
    var n = 22, out = [];
    for (var i = 0; i < n; i++) {
      var f = i / (n - 1);
      var dens = 0.25 + 0.75 * Math.abs(Math.sin(f * 9.3 + 1.2) * Math.sin(f * 3.1));
      if (f > 0.58 && f < 0.64) dens = 0.04;                       // a Cassini-style gap
      var col = f < 0.5 ? '244,206,160' : f < 0.8 ? '226,150,120' : '236,190,140';
      out.push([lerp(p.ring[0], p.ring[1], f), 'rgba(' + col + ',' + (0.08 + dens * 0.42).toFixed(3) + ')']);
    }
    return (p.bands = out);
  }

  /* half of a ring: the part behind (back) or in front of the planet */
  function drawRing(p, q, back) {
    var bands = ringBands(p);
    var l = lightFor(p.P), lit = 0.45 + 0.55 * clamp(l[2] * 0.5 + 0.6);
    ctx.save();
    ctx.globalAlpha = lit;
    for (var b = 0; b < bands.length; b++) {
      var rr = bands[b][0] * p.R, pen = false;
      ctx.beginPath();
      for (var i = 0; i <= 160; i++) {
        var a = (i / 160) * Math.PI * 2;
        var w = add(p.P, V(Math.cos(a) * rr, 0, Math.sin(a) * rr));
        var s = project(w);
        if (!s || (s.z > q.z) !== back) { pen = false; continue; }
        if (pen) ctx.lineTo(s.x, s.y); else { ctx.moveTo(s.x, s.y); pen = true; }
      }
      ctx.strokeStyle = bands[b][1];
      ctx.lineWidth = Math.max(0.6, (p.ring[1] - p.ring[0]) * p.R * q.k / bands.length * 1.15);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawMoon(q, R, P) {
    var r = Math.max(1.4, R * q.k), l = lightFor(P);
    var lx = q.x + l[0] * r * 0.6, ly = q.y - l[1] * r * 0.6;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    var g = ctx.createRadialGradient(q.x, q.y, r, q.x, q.y, r * 2.4);
    g.addColorStop(0, 'rgba(150,240,236,0.16)');
    g.addColorStop(1, 'rgba(150,240,236,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(q.x, q.y, r * 2.4, 0, 6.2832); ctx.fill();
    ctx.restore();
    var s = ctx.createRadialGradient(lx, ly, 0, q.x, q.y, r);
    s.addColorStop(0, '#d8fffb');
    s.addColorStop(0.5, '#5fb8b6');
    s.addColorStop(1, '#0d1b24');
    ctx.fillStyle = s;
    ctx.beginPath(); ctx.arc(q.x, q.y, r, 0, 6.2832); ctx.fill();
  }

  function drawLabel(p, q, a) {
    if (a < 0.01) return;
    var r = Math.max(4, p.R * q.k), x = q.x + r * 0.75 + 8, y = q.y - r * 0.75 - 8;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.strokeStyle = 'rgba(' + BONE + ',0.35)';
    ctx.beginPath(); ctx.moveTo(q.x + r * 0.75, q.y - r * 0.75); ctx.lineTo(x + 6, y - 6); ctx.lineTo(x + 26, y - 6); ctx.stroke();
    ctx.font = '500 10px "JetBrains Mono", monospace';
    if ('letterSpacing' in ctx) ctx.letterSpacing = '2px';
    ctx.fillStyle = 'rgb(' + AMBER + ')';
    ctx.fillText(p.label, x + 32, y - 2);
    ctx.fillStyle = 'rgba(' + BONE + ',0.6)';
    if (!narrow()) ctx.fillText(p.name.toUpperCase(), x + 32, y + 12);
    ctx.restore();
  }

  function drawLock(p, q, a) {
    if (a < 0.02) return;
    var r = p.R * q.k * (p.ring ? 2.45 : p.moons ? 1.6 : 1.32) + (1 - a) * 40;
    var c = r * 0.22;
    ctx.save();
    ctx.globalAlpha = a * 0.85;
    ctx.strokeStyle = 'rgb(' + AMBER + ')';
    ctx.lineWidth = 1;
    ctx.beginPath();
    [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(function (s) {
      var x = q.x + s[0] * r, y = q.y + s[1] * r;
      ctx.moveTo(x, y - s[1] * c); ctx.lineTo(x, y); ctx.lineTo(x - s[0] * c, y);
    });
    ctx.stroke();
    ctx.font = '400 10px "JetBrains Mono", monospace';
    if ('letterSpacing' in ctx) ctx.letterSpacing = '2px';
    ctx.fillStyle = 'rgba(' + BONE + ',0.7)';
    ctx.fillText('LOCK · ' + p.label, q.x - r, q.y + r + 18);
    ctx.restore();
  }

  /* =========================================================
     FRAME
     ========================================================= */
  var t0 = performance.now(), lastPos = null, speed = 0, lastT = t0, lastHud = '';

  function frame(now) {
    requestAnimationFrame(frame);
    var pr = progress(), rect = pr.rect, s = pr.s;
    var vh = window.innerHeight;

    /* the side descent steps aside while the system is on screen */
    var vis = Math.min(clamp((vh - rect.top) / (vh * 0.5)), clamp((rect.bottom - vh * 0.2) / (vh * 0.5)));
    if (orbitStrip) orbitStrip.style.opacity = (0.9 * (1 - vis)).toFixed(3);
    if (rect.bottom < 0 || rect.top > vh) return;

    var t = reduced ? 0 : (now - t0) / 1000;
    worlds.forEach(function (p) { p.P = worldPos(p, t); });

    /* camera: hold at each stop, travel in between with a lift */
    var i = Math.min(STOPS - 2, Math.floor(s)), f = s - i;
    var e = smoother(clamp((f - 0.2) / 0.6));
    var et = smoother(clamp((f - 0.14) / 0.6));
    var A = key(i, t), B = key(i + 1, t);
    var pos = vlerp(A.pos, B.pos, e);
    pos = add(pos, mul(UP, Math.sin(Math.PI * e) * len(sub(B.pos, A.pos)) * 0.22));
    look(pos, vlerp(A.target, B.target, et));
    cam.cx = W / 2 + lerp(A.sx, B.sx, e);
    cam.cy = H / 2 + lerp(A.sy, B.sy, e);

    /* weights: how "arrived" we are at each stop */
    var wts = [];
    for (var k = 0; k < STOPS; k++) wts[k] = smooth(clamp(1 - Math.abs(s - k) / 0.3));

    ctx.clearRect(0, 0, W, H);

    worlds.forEach(function (p, j) { drawOrbit(p, wts[j + 1]); });

    /* gather everything, paint far to near */
    var items = [];
    var qs = project(SUN.pos);
    if (qs) items.push({ z: qs.z, fn: function () { drawSun(qs); } });

    worlds.forEach(function (p, j) {
      var q = project(p.P);
      if (!q) return;
      p.q = q;
      var rot = (p.spin * t) % 1;
      items.push({ z: q.z, fn: function () { drawPlanet(p, q, rot); } });
      if (p.ring) {
        items.push({ z: q.z + 1e-4, fn: function () { drawRing(p, q, true); } });
        items.push({ z: q.z - 1e-4, fn: function () { drawRing(p, q, false); } });
      }
      if (p.moons) {
        for (var m = 0; m < p.moons; m++) {
          var a = t * (0.5 - m * 0.11) + m * 2.1, rr = p.R * (1.65 + m * 0.32), tilt = 0.25 + m * 0.18;
          var mp = add(p.P, V(Math.cos(a) * rr, Math.sin(a) * rr * tilt, Math.sin(a) * rr));
          (function (mq, mp) {
            if (mq) items.push({ z: mq.z, fn: function () { drawMoon(mq, p.R * 0.075, mp); } });
          })(project(mp), mp);
        }
      }
      if (p.sat) {
        var sa = t * 0.7, sr = p.R * 1.4;
        var sq = project(add(p.P, V(Math.cos(sa) * sr, Math.cos(sa) * sr * 0.5, Math.sin(sa) * sr)));
        if (sq) items.push({ z: sq.z, fn: function () {
          var w = clamp(p.R * sq.k * 0.035, 1.5, 9);
          ctx.fillStyle = 'rgba(' + AMBER + ',0.85)';
          ctx.fillRect(sq.x - w * 2.2, sq.y - w * 0.22, w * 4.4, w * 0.44);
          ctx.fillStyle = '#fff4e2';
          ctx.fillRect(sq.x - w * 0.45, sq.y - w * 0.45, w * 0.9, w * 0.9);
        } });
      }
    });

    items.sort(function (a, b) { return b.z - a.z; });
    for (var n = 0; n < items.length; n++) items[n].fn();

    /* labels in the wide view, a lock box on arrival */
    var labelA = 1 - smooth(clamp(s / 0.55));
    worlds.forEach(function (p, j) {
      if (!p.q) return;
      drawLabel(p, p.q, labelA);
      drawLock(p, p.q, wts[j + 1]);
    });

    /* panels */
    Array.prototype.forEach.call(panels, function (el) {
      var w = wts[+el.dataset.stop];
      el.style.opacity = w.toFixed(3);
      el.style.transform = 'translateY(' + ((1 - w) * 26).toFixed(1) + 'px)';
      el.style.visibility = w < 0.01 ? 'hidden' : 'visible';
      el.style.pointerEvents = w > 0.6 ? 'auto' : 'none';
      var vid = el.querySelector('video');
      if (vid) { if (w > 0.2 && vid.paused) vid.play().catch(function () {}); else if (w <= 0.2 && !vid.paused) vid.pause(); }
    });

    /* rail + HUD */
    var near = Math.round(s);
    Array.prototype.forEach.call(rail, function (b, j) { b.classList.toggle('is-on', j === near); });

    var dt = Math.max(0.001, (now - lastT) / 1000); lastT = now;
    if (lastPos) speed = lerp(speed, len(sub(pos, lastPos)) / dt, 0.08);
    lastPos = pos;
    var tgt = near === 0 ? null : worlds[near - 1];
    var range = tgt ? len(sub(tgt.P, pos)) : len(pos);
    var hudText = (tgt ? tgt.label + ' ' + tgt.name : 'System') + '|' + (range * 0.038).toFixed(2) + ' AU|' + (speed * 2.4).toFixed(1) + ' km/s';
    if (hudText !== lastHud) {
      var parts = hudText.split('|');
      hud.target.textContent = parts[0];
      hud.range.textContent = parts[1];
      hud.speed.textContent = parts[2];
      lastHud = hudText;
    }
  }

  layout();
  window.addEventListener('resize', layout);
  window.addEventListener('load', layout);
  schedule(bakeNext);
  requestAnimationFrame(frame);
})();
