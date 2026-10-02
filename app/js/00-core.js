/* ============================================================
   00-core.js — çekirdek: rastgelelik, gürültü, matematik, kayıt
   (DOM'suz. Node test koşumlarında da yüklenebilir.)
   ============================================================ */
var MV = (typeof globalThis !== 'undefined' ? globalThis : this).MV =
  (typeof globalThis !== 'undefined' ? globalThis.MV : this.MV) || {};

(function (MV) {
  'use strict';

  const TAU = Math.PI * 2;

  /* ---------- temel matematik ---------- */
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smoothstep(a, b, x) {
    const t = clamp((x - a) / (b - a || 1e-9), 0, 1);
    return t * t * (3 - 2 * t);
  }
  function dist(ax, ay, bx, by) { return Math.hypot(ax - bx, ay - by); }
  function dist2(ax, ay, bx, by) { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; }
  function angDiff(a, b) { let d = (a - b) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; }
  function approach(cur, target, rate, dt) {
    const d = target - cur, m = rate * dt;
    return (Math.abs(d) <= m) ? target : cur + Math.sign(d) * m;
  }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function fmtTime(sec) {
    sec = Math.max(0, Math.floor(sec));
    const m = Math.floor(sec / 60), s = sec % 60;
    return pad2(m) + ':' + pad2(s);
  }
  function fmtClock(sec) {
    // Labirent saati: GÜN/gece döngüsü 24 saate eşlenir
    const t = ((sec % 1) + 1) % 1;
    const h = Math.floor(t * 24), m = Math.floor((t * 24 - h) * 60);
    return pad2(h) + ':' + pad2(m);
  }

  /* ---------- rastgelelik (deterministik) ---------- */
  function hash32(x) {
    x = (x | 0) ^ 0x9e3779b9;
    x = Math.imul(x ^ (x >>> 16), 0x21f0aaad);
    x = Math.imul(x ^ (x >>> 15), 0x735a2d97);
    return (x ^ (x >>> 15)) >>> 0;
  }
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  /* RNG sarmalayıcı: int/range/pick/chance */
  /* RNG(seed) çağrılabilir bir fonksiyon döner (rng()) ve üzerinde
     int/range/pick/chance... yardımcıları taşır. */
  function RNG(seed) {
    const r = mulberry32(seed === undefined ? 1 : seed);
    const f = function () { return r(); };
    return Object.assign(f, {
      next: r,
      int: (n) => Math.floor(r() * n),
      range: (a, b) => a + r() * (b - a),
      irange: (a, b) => a + Math.floor(r() * (b - a + 1)),
      chance: (p) => r() < p,
      pick: (arr) => arr[Math.floor(r() * arr.length)],
      shuffle(arr) {
        for (let i = arr.length - 1; i > 0; i--) {
          const j = Math.floor(r() * (i + 1));
          const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
        }
        return arr;
      },
      sign: () => (r() < 0.5 ? -1 : 1)
    });
  }

  /* ---------- değer gürültüsü (periyodik → kusursuz döşeme) ---------- */
  function h2(x, y, s) {
    let n = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 2246822519);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  }
  function fade(t) { return t * t * (3 - 2 * t); }
  function pnoise(x, y, period, seed) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const w = (v) => ((v % period) + period) % period;
    const x0 = w(xi), x1 = w(xi + 1), y0 = w(yi), y1 = w(yi + 1);
    const a = h2(x0, y0, seed), b = h2(x1, y0, seed);
    const c = h2(x0, y1, seed), d = h2(x1, y1, seed);
    const u = fade(xf), v = fade(yf);
    return lerp(lerp(a, b, u), lerp(c, d, u), v);
  }
  /* fbm: taban periyodu tileSize olan, kusursuz döşenen çok oktavlı gürültü */
  function fbm(x, y, tileSize, oct, seed) {
    let sum = 0, amp = 0.5, norm = 0, p = tileSize, f = 1;
    for (let i = 0; i < oct; i++) {
      sum += amp * pnoise(x * f, y * f, p, seed + i * 1013);
      norm += amp; amp *= 0.5; p *= 2; f *= 2;
    }
    return sum / norm;
  }
  /* damla/gözenek gürültüsü (worley benzeri, ucuz) */
  function celNoise(x, y, period, seed) {
    const xi = Math.floor(x), yi = Math.floor(y);
    let best = 9;
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      const cx = xi + ox, cy = yi + oy;
      const w = (v) => ((v % period) + period) % period;
      const px = cx + h2(w(cx), w(cy), seed);
      const py = cy + h2(w(cx), w(cy), seed + 77);
      const d = Math.hypot(px - x, py - y);
      if (d < best) best = d;
    }
    return clamp(best, 0, 1);
  }

  /* ---------- renk (0xAABBGGRR — little-endian RGBA) ---------- */
  function rgb(r, g, b) {
    return ((255 << 24) | ((b & 255) << 16) | ((g & 255) << 8) | (r & 255)) >>> 0;
  }
  function rgba(r, g, b, a) {
    return (((a & 255) << 24) | ((b & 255) << 16) | ((g & 255) << 8) | (r & 255)) >>> 0;
  }
  function unpack(c) { return [c & 255, (c >>> 8) & 255, (c >>> 16) & 255, (c >>> 24) & 255]; }
  function pack(r, g, b, a) { return rgba(r, g, b, a === undefined ? 255 : a); }
  function mixC(c1, c2, t) {
    const a = c1 & 255, b = (c1 >>> 8) & 255, c = (c1 >>> 16) & 255, d = (c1 >>> 24) & 255;
    const e = c2 & 255, f = (c2 >>> 8) & 255, g = (c2 >>> 16) & 255, h = (c2 >>> 24) & 255;
    return ((((d + (h - d) * t) & 255) << 24) | (((g + (c - g) * t) & 255) << 16) |
      (((f + (b - f) * t) & 255) << 8) | ((e + (a - e) * t) & 255)) >>> 0;
  }
  function scaleRGB(c, m) {
    const a = c & 255, b = (c >>> 8) & 255, d = (c >>> 16) & 255;
    return rgba(Math.min(255, a * m) | 0, Math.min(255, b * m) | 0, Math.min(255, d * m) | 0, (c >>> 24) & 255);
  }
  function addRGB(c, r, g, b) {
    return rgba(clamp((c & 255) + r, 0, 255) | 0, clamp(((c >>> 8) & 255) + g, 0, 255) | 0,
      clamp(((c >>> 16) & 255) + b, 0, 255) | 0, (c >>> 24) & 255);
  }
  function shadeC(c, mul, add) {
    const a = c & 255, b = (c >>> 8) & 255, d = (c >>> 16) & 255;
    add = add || 0;
    const r = a * mul + add, g = b * mul + add, bl = d * mul + add;
    return rgba(r > 255 ? 255 : r | 0, g > 255 ? 255 : g | 0, bl > 255 ? 255 : bl | 0, (c >>> 24) & 255);
  }

  /* ---------- karo/doku kimlikleri ---------- */
  const T = {
    AIR: 0, STONE: 1, STONE_MOSS: 2, HEDERA: 3, BOX: 4, GRASS: 5, DIRT: 6,
    TRACK: 7, WOOD: 8, RUNE_PI: 9, RUNE_SYS: 10, VINE: 11, WATER: 12, CLIFF: 13,
    GATE: 14, ROCK: 15, GRATE: 16, HIVE: 17, LEAF: 18
  };
  /* 100..107: rune taşları (π kod dizisi; sırası taşa kazınır) */
  T.RUNE1 = 100; T.RUNE8 = 107;
  MV.T = T;

  /* ---------- kayıt (kalıcı hafıza) ---------- */
  const KEY = 'labirent-protokolu-save-v1';
  function loadSave() {
    try {
      const raw = (typeof localStorage !== 'undefined') && localStorage.getItem(KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (!s || typeof s !== 'object') return null;
      return s;
    } catch (e) { return null; }
  }
  function writeSave(s) {
    try { if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { }
  }
  function clearSave() {
    try { if (typeof localStorage !== 'undefined') localStorage.removeItem(KEY); } catch (e) { }
  }

  /* ---------- günlük (log) ---------- */
  const LOG = [];
  function logMsg(txt, kind) {
    LOG.push({ t: Date.now(), txt: txt, kind: kind || 'info' });
    if (LOG.length > 60) LOG.shift();
    if (MV.onLog) MV.onLog(LOG[LOG.length - 1]);
  }

  /* ---------- dışa aktarım ---------- */
  MV.clamp = clamp; MV.lerp = lerp; MV.smoothstep = smoothstep;
  MV.dist = dist; MV.dist2 = dist2; MV.angDiff = angDiff; MV.approach = approach;
  MV.pad2 = pad2; MV.fmtTime = fmtTime; MV.fmtClock = fmtClock;
  MV.hash32 = hash32; MV.mulberry32 = mulberry32; MV.RNG = RNG;
  MV.h2 = h2; MV.pnoise = pnoise; MV.fbm = fbm; MV.celNoise = celNoise;
  MV.rgb = rgb; MV.rgba = rgba; MV.unpack = unpack; MV.pack = pack;
  MV.mixC = mixC; MV.scaleRGB = scaleRGB; MV.addRGB = addRGB; MV.shadeC = shadeC;
  MV.loadSave = loadSave; MV.writeSave = writeSave; MV.clearSave = clearSave;
  MV.logMsg = logMsg; MV.TAU = TAU;

  if (typeof module !== 'undefined' && module.exports) module.exports = MV;
})(MV);
