/* Yazılım Canvas2D: prosedürel dokuları ve raycast çıktısını tarayıcı
   olmadan görebilmek için küçük bir gerçekleyici. */

/* ---------------- 5x7 bitmap yazı tipi ---------------- */
const GLYPHS = {
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11111', '00010', '00100', '00010', '00001', '10001', '01110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  'A': ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  'B': ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  'C': ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
  'D': ['11100', '10010', '10001', '10001', '10001', '10010', '11100'],
  'E': ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  'F': ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  'G': ['01110', '10001', '10000', '10111', '10001', '10001', '01111'],
  'H': ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  'I': ['01110', '00100', '00100', '00100', '00100', '00100', '01110'],
  'J': ['00111', '00010', '00010', '00010', '00010', '10010', '01100'],
  'K': ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  'L': ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  'M': ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  'N': ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  'O': ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  'P': ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  'Q': ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  'R': ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  'S': ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  'T': ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  'U': ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  'V': ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  'W': ['10001', '10001', '10001', '10101', '10101', '11011', '10001'],
  'X': ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  'Y': ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  'Z': ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
  'π': ['00000', '11111', '00100', '00100', '00100', '00100', '01010'],
  '.': ['00000', '00000', '00000', '00000', '00000', '00110', '00110'],
  '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
  '—': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
  '+': ['00000', '00100', '00100', '11111', '00100', '00100', '00000'],
  ':': ['00000', '00100', '00100', '00000', '00100', '00100', '00000'],
  '/': ['00001', '00010', '00010', '00100', '01000', '01000', '10000'],
  '×': ['00000', '10001', '01010', '00100', '01010', '10001', '00000'],
  '>': ['10000', '01000', '00100', '00010', '00100', '01000', '10000'],
  '·': ['00000', '00000', '00000', '00100', '00000', '00000', '00000'],
  '(': ['00010', '00100', '01000', '01000', '01000', '00100', '00010'],
  ')': ['01000', '00100', '00010', '00010', '00010', '00100', '01000'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000']
};
const SUBDIGITS = { '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9' };
function glyphOf(ch) {
  if (GLYPHS[ch]) return GLYPHS[ch];
  const up = String(ch).toUpperCase();
  if (GLYPHS[up]) return GLYPHS[up];
  if (SUBDIGITS[ch]) return GLYPHS[SUBDIGITS[ch]];
  return GLYPHS['·'];
}

/* ---------------- renk ---------- */
function parseColor(s) {
  if (s && typeof s === 'object' && s._stops) return null;
  s = String(s == null ? '#000' : s).trim();
  if (s[0] === '#') {
    if (s.length === 4) return [parseInt(s[1] + s[1], 16), parseInt(s[2] + s[2], 16), parseInt(s[3] + s[3], 16), 1];
    if (s.length === 7) return [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16), 1];
    if (s.length === 9) return [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16), parseInt(s.slice(7, 9), 16) / 255];
  }
  const m = s.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const p = m[1].split(',').map(v => parseFloat(v));
    return [p[0] || 0, p[1] || 0, p[2] || 0, p[3] === undefined ? 1 : p[3]];
  }
  if (s === 'transparent') return [0, 0, 0, 0];
  if (s === 'black') return [0, 0, 0, 1];
  if (s === 'white') return [255, 255, 255, 1];
  return [128, 128, 128, 1];
}
function makeGradient(type, a) {
  return {
    _stops: [], _type: type, _a: a,
    addColorStop(o, c) { this._stops.push([o, parseColor(c)]); this._stops.sort((x, y) => x[0] - y[0]); },
    at(x, y) {
      let t;
      if (this._type === 'linear') {
        const [x0, y0, x1, y1] = this._a;
        const dx = x1 - x0, dy = y1 - y0, l2 = dx * dx + dy * dy || 1;
        t = ((x - x0) * dx + (y - y0) * dy) / l2;
      } else {
        const [, , r0, x1, y1, r1] = this._a;
        t = (Math.hypot(x - x1, y - y1) - r0) / ((r1 - r0) || 1);
      }
      t = t < 0 ? 0 : (t > 1 ? 1 : t);
      const st = this._stops;
      if (!st.length) return [0, 0, 0, 1];
      if (t <= st[0][0]) return st[0][1];
      for (let i = 1; i < st.length; i++) {
        if (t <= st[i][0]) {
          const a = st[i - 1], b = st[i], k = (t - a[0]) / ((b[0] - a[0]) || 1);
          return [a[1][0] + (b[1][0] - a[1][0]) * k, a[1][1] + (b[1][1] - a[1][1]) * k,
          a[1][2] + (b[1][2] - a[1][2]) * k, a[1][3] + (b[1][3] - a[1][3]) * k];
        }
      }
      return st[st.length - 1][1];
    }
  };
}

/* ---------------- tuval ---------------- */
function Surface(w, h) { this.width = w; this.height = h; this.data = new Uint8ClampedArray(Math.max(1, w * h * 4)); }

function Ctx2D(canvas, surf) {
  this.canvas = canvas;
  this.surf = surf;
  this.fillStyle = '#000'; this.strokeStyle = '#000'; this.lineWidth = 1;
  this.globalAlpha = 1; this.font = '10px monospace';
  this.textAlign = 'left'; this.textBaseline = 'alphabetic';
  this.imageSmoothingEnabled = false;
  this.m = [1, 0, 0, 1, 0, 0];
  this.path = []; this._cur = null; this._stack = [];
}
Ctx2D.prototype._tp = function (x, y) { const m = this.m; return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]; };
Ctx2D.prototype._fscale = function () { const m = this.m; return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1; };
Ctx2D.prototype.save = function () { this._stack.push([this.m.slice(), this.fillStyle, this.strokeStyle, this.lineWidth, this.globalAlpha, this.textAlign, this.textBaseline, this.font]); };
Ctx2D.prototype.restore = function () {
  const s = this._stack.pop(); if (!s) return;
  this.m = s[0]; this.fillStyle = s[1]; this.strokeStyle = s[2]; this.lineWidth = s[3];
  this.globalAlpha = s[4]; this.textAlign = s[5]; this.textBaseline = s[6]; this.font = s[7];
};
Ctx2D.prototype.translate = function (x, y) { const m = this.m; m[4] += m[0] * x + m[2] * y; m[5] += m[1] * x + m[3] * y; };
Ctx2D.prototype.rotate = function (a) {
  const m = this.m, c = Math.cos(a), s = Math.sin(a);
  const a0 = m[0] * c + m[2] * s, b0 = m[1] * c + m[3] * s;
  const c0 = -m[0] * s + m[2] * c, d0 = -m[1] * s + m[3] * c;
  m[0] = a0; m[1] = b0; m[2] = c0; m[3] = d0;
};
Ctx2D.prototype.scale = function (x, y) { const m = this.m; m[0] *= x; m[1] *= x; m[2] *= y; m[3] *= y; };
Ctx2D.prototype.setTransform = function (a, b, c, d, e, f) { this.m = [a, b, c, d, e, f]; };
Ctx2D.prototype.clearRect = function (x, y, w, h) {
  const s = this.surf;
  const p = [this._tp(x, y), this._tp(x + w, y), this._tp(x + w, y + h), this._tp(x, y + h)];
  const x0 = Math.max(0, Math.floor(Math.min(p[0][0], p[1][0], p[2][0], p[3][0])));
  const x1 = Math.min(s.width - 1, Math.ceil(Math.max(p[0][0], p[1][0], p[2][0], p[3][0])));
  const y0 = Math.max(0, Math.floor(Math.min(p[0][1], p[1][1], p[2][1], p[3][1])));
  const y1 = Math.min(s.height - 1, Math.ceil(Math.max(p[0][1], p[1][1], p[2][1], p[3][1])));
  for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) {
    const i = (yy * s.width + xx) * 4;
    s.data[i] = s.data[i + 1] = s.data[i + 2] = s.data[i + 3] = 0;
  }
};
Ctx2D.prototype._blend = function (x, y, col, alpha) {
  const s = this.surf;
  if (x < 0 || y < 0 || x >= s.width || y >= s.height) return;
  const a = alpha * this.globalAlpha * (col[3] === undefined ? 1 : col[3]);
  if (a <= 0.002) return;
  const i = (y * s.width + x) * 4, d = s.data;
  d[i] += (col[0] - d[i]) * a;
  d[i + 1] += (col[1] - d[i + 1]) * a;
  d[i + 2] += (col[2] - d[i + 2]) * a;
  if (d[i + 3] < 255 * a) d[i + 3] = 255 * a;
};
Ctx2D.prototype._fillPolys = function (polys, style) {
  const grad = style && style._stops ? style : null;
  const col = grad ? null : parseColor(style);
  const s = this.surf;
  let minY = 1e9, maxY = -1e9, minX = 1e9, maxX = -1e9;
  for (const p of polys) for (const q of p) {
    if (q[1] < minY) minY = q[1]; if (q[1] > maxY) maxY = q[1];
    if (q[0] < minX) minX = q[0]; if (q[0] > maxX) maxX = q[0];
  }
  const y0 = Math.max(0, Math.floor(minY)), y1 = Math.min(s.height - 1, Math.ceil(maxY));
  const xa = Math.max(0, Math.floor(minX)), xb = Math.min(s.width - 1, Math.ceil(maxX));
  const xs = [];
  for (let y = y0; y <= y1; y++) {
    const cy = y + 0.5;
    xs.length = 0;
    for (const p of polys) {
      for (let i = 0; i < p.length; i++) {
        const a = p[i], b = p[(i + 1) % p.length];
        if ((a[1] <= cy && b[1] > cy) || (b[1] <= cy && a[1] > cy)) {
          const t = (cy - a[1]) / (b[1] - a[1]);
          xs.push([a[0] + (b[0] - a[0]) * t, (b[1] > a[1]) ? 1 : -1]);
        }
      }
    }
    if (!xs.length) continue;
    xs.sort((p, q) => p[0] - q[0]);
    let wind = 0;
    for (let i = 0; i < xs.length - 1; i++) {
      wind += xs[i][1];
      if (wind === 0) continue;
      const sx = Math.max(xa, Math.ceil(xs[i][0] - 0.5)), ex = Math.min(xb, Math.floor(xs[i + 1][0] - 0.5));
      for (let x = sx; x <= ex; x++) this._blend(x, y, grad ? grad.at(x + 0.5, cy) : col, 1);
    }
  }
};
Ctx2D.prototype.beginPath = function () { this.path = []; this._cur = null; };
Ctx2D.prototype.moveTo = function (x, y) { this._cur = [this._tp(x, y)]; this.path.push(this._cur); };
Ctx2D.prototype.lineTo = function (x, y) { if (!this._cur) this.moveTo(x, y); else this._cur.push(this._tp(x, y)); };
Ctx2D.prototype.closePath = function () { if (this._cur && this._cur.length > 2) this._cur.push(this._cur[0].slice()); };
Ctx2D.prototype.rect = function (x, y, w, h) { this.moveTo(x, y); this.lineTo(x + w, y); this.lineTo(x + w, y + h); this.lineTo(x, y + h); this.closePath(); };
Ctx2D.prototype.quadraticCurveTo = function (cx, cy, x, y) {
  if (!this._cur) this.moveTo(cx, cy);
  const p0 = this._cur[this._cur.length - 1];
  const c = this._tp(cx, cy), p1 = this._tp(x, y);
  for (let i = 1; i <= 8; i++) {
    const t = i / 8, mt = 1 - t;
    this._cur.push([mt * mt * p0[0] + 2 * mt * t * c[0] + t * t * p1[0], mt * mt * p0[1] + 2 * mt * t * c[1] + t * t * p1[1]]);
  }
};
Ctx2D.prototype.bezierCurveTo = function (c1x, c1y, c2x, c2y, x, y) {
  if (!this._cur) this.moveTo(c1x, c1y);
  const p0 = this._cur[this._cur.length - 1];
  const a = this._tp(c1x, c1y), b = this._tp(c2x, c2y), p1 = this._tp(x, y);
  for (let i = 1; i <= 10; i++) {
    const t = i / 10, mt = 1 - t;
    this._cur.push([
      mt * mt * mt * p0[0] + 3 * mt * mt * t * a[0] + 3 * mt * t * t * b[0] + t * t * t * p1[0],
      mt * mt * mt * p0[1] + 3 * mt * mt * t * a[1] + 3 * mt * t * t * b[1] + t * t * t * p1[1]]);
  }
};
Ctx2D.prototype.ellipse = function (x, y, rx, ry, rot, a0, a1) {
  const steps = 24;
  const start = a0 === undefined ? 0 : a0;
  const end = a1 === undefined ? Math.PI * 2 : a1;
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = start + (end - start) * (i / steps);
    const ex = Math.cos(t) * rx, ey = Math.sin(t) * ry;
    pts.push(this._tp(x + ex * Math.cos(rot) - ey * Math.sin(rot), y + ex * Math.sin(rot) + ey * Math.cos(rot)));
  }
  this._cur = pts; this.path.push(pts);
};
Ctx2D.prototype.arc = function (x, y, r, a0, a1) { this.ellipse(x, y, r, r, 0, a0, a1); };
Ctx2D.prototype.fill = function () { this._fillPolys(this.path.filter(p => p.length > 2), this.fillStyle); };
Ctx2D.prototype.stroke = function () {
  const lw = Math.max(0.5, this.lineWidth * this._fscale()) / 2;
  const quads = [];
  for (const p of this.path) {
    for (let i = 0; i < p.length - 1; i++) {
      const a = p[i], b = p[i + 1];
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len * lw, ny = dx / len * lw;
      quads.push([[a[0] + nx, a[1] + ny], [b[0] + nx, b[1] + ny], [b[0] - nx, b[1] - ny], [a[0] - nx, a[1] - ny]]);
    }
  }
  if (quads.length) this._fillPolys(quads, this.strokeStyle);
};
Ctx2D.prototype.fillRect = function (x, y, w, h) {
  this._fillPolys([[this._tp(x, y), this._tp(x + w, y), this._tp(x + w, y + h), this._tp(x, y + h)]], this.fillStyle);
};
Ctx2D.prototype.strokeRect = function (x, y, w, h) { this.beginPath(); this.rect(x, y, w, h); this.stroke(); };
Ctx2D.prototype.fillText = function (text, x, y) {
  const size = parseFloat((String(this.font).match(/(\d+(\.\d+)?)px/) || [, '10'])[1]);
  const sc = Math.max(1, Math.round(size / 7));
  const str = String(text);
  const gw = 6 * sc;
  let ox = x;
  if (this.textAlign === 'center') ox = x - (str.length * gw) / 2;
  else if (this.textAlign === 'right') ox = x - str.length * gw;
  let oy = y;
  if (this.textBaseline === 'middle') oy = y - 3.5 * sc;
  else if (this.textBaseline === 'alphabetic') oy = y - 7 * sc;
  const col = parseColor(this.fillStyle);
  for (let ci = 0; ci < str.length; ci++) {
    const g = glyphOf(str[ci]);
    for (let ry = 0; ry < 7; ry++) for (let rx = 0; rx < 5; rx++) {
      if (g[ry][rx] !== '1') continue;
      for (let sy = 0; sy < sc; sy++) for (let sx = 0; sx < sc; sx++) {
        const p = this._tp(ox + ci * gw + rx * sc + sx, oy + ry * sc + sy);
        this._blend(Math.floor(p[0]), Math.floor(p[1]), col, 1);
      }
    }
  }
};
Ctx2D.prototype.strokeText = function (t, x, y) { this.fillText(t, x, y); };
Ctx2D.prototype.measureText = function (t) { return { width: String(t).length * 6 }; };
Ctx2D.prototype.drawImage = function (img, dx, dy, dw, dh) {
  const src = img && (img._surf || (img.getContext && (img.getContext('2d'), img._surf)));
  if (!src) return;
  if (dw === undefined) { dw = src.width; dh = src.height; }
  const x0 = Math.max(0, Math.floor(dx)), y0 = Math.max(0, Math.floor(dy));
  const x1 = Math.min(this.surf.width - 1, Math.ceil(dx + dw)), y1 = Math.min(this.surf.height - 1, Math.ceil(dy + dh));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const u = (x + 0.5 - dx) / dw, v = (y + 0.5 - dy) / dh;
    if (u < 0 || u >= 1 || v < 0 || v >= 1) continue;
    const sxi = Math.min(src.width - 1, Math.max(0, (u * src.width) | 0));
    const syi = Math.min(src.height - 1, Math.max(0, (v * src.height) | 0));
    const i = (syi * src.width + sxi) * 4;
    const a = src.data[i + 3] / 255;
    if (a <= 0.003) continue;
    const p = this._tp(x + 0.5, y + 0.5);
    this._blend(Math.floor(p[0]), Math.floor(p[1]), [src.data[i], src.data[i + 1], src.data[i + 2], 1], a);
  }
};
Ctx2D.prototype.createImageData = function (w, h) { return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; };
Ctx2D.prototype.getImageData = function (x, y, w, h) {
  const out = { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
  for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
    const sx = x + xx, sy = y + yy;
    if (sx < 0 || sy < 0 || sx >= this.surf.width || sy >= this.surf.height) continue;
    const si = (sy * this.surf.width + sx) * 4, di = (yy * w + xx) * 4;
    out.data[di] = this.surf.data[si]; out.data[di + 1] = this.surf.data[si + 1];
    out.data[di + 2] = this.surf.data[si + 2]; out.data[di + 3] = this.surf.data[si + 3];
  }
  return out;
};
Ctx2D.prototype.putImageData = function (img, x, y) {
  for (let yy = 0; yy < img.height; yy++) for (let xx = 0; xx < img.width; xx++) {
    const sx = x + xx, sy = y + yy;
    if (sx < 0 || sy < 0 || sx >= this.surf.width || sy >= this.surf.height) continue;
    const si = (yy * img.width + xx) * 4, di = (sy * this.surf.width + sx) * 4;
    const a = img.data[si + 3] / 255, d = this.surf.data;
    d[di] += (img.data[si] - d[di]) * a;
    d[di + 1] += (img.data[si + 1] - d[di + 1]) * a;
    d[di + 2] += (img.data[si + 2] - d[di + 2]) * a;
    if (d[di + 3] < 255 * a) d[di + 3] = 255 * a;
  }
};
Ctx2D.prototype.createLinearGradient = function (x0, y0, x1, y1) { return makeGradient('linear', [x0, y0, x1, y1]); };
Ctx2D.prototype.createRadialGradient = function (x0, y0, r0, x1, y1, r1) { return makeGradient('radial', [x0, y0, r0, x1, y1, r1]); };
Ctx2D.prototype.createPattern = function () { return null; };

/* ---------------- sahte <canvas> ---------------- */
function makeCanvas(w0, h0) {
  let w = Math.max(1, (w0 | 0) || 300), h = Math.max(1, (h0 | 0) || 150);
  let surf = new Surface(w, h);
  let ctx = null;
  const el = {
    tagName: 'CANVAS', style: {}, children: [], className: '', textContent: '', _html: '',
    classList: { add() { }, remove() { }, toggle() { }, contains() { return false; } },
    appendChild(c) { return c; }, removeChild(c) { return c; },
    get firstChild() { return null; },
    querySelector() { return el; }, querySelectorAll() { return []; },
    addEventListener() { }, removeEventListener() { },
    getBoundingClientRect() { return { left: 0, top: 0, width: w, height: h }; },
    requestPointerLock() { },
    getContext(kind) {
      if (kind === '2d' && !ctx) { ctx = new Ctx2D(el, surf); ctx.img = null; }
      return ctx;
    },
    _getSurf() { return surf; },
    toRGBA() { return surf.data; }
  };
  Object.defineProperty(el, 'width', {
    get() { return w; },
    set(v) { w = Math.max(1, v | 0); surf = new Surface(w, h); if (ctx) { ctx.surf = surf; ctx.m = [1, 0, 0, 1, 0, 0]; ctx._stack = []; } }
  });
  Object.defineProperty(el, 'height', {
    get() { return h; },
    set(v) { h = Math.max(1, v | 0); surf = new Surface(w, h); if (ctx) { ctx.surf = surf; ctx.m = [1, 0, 0, 1, 0, 0]; ctx._stack = []; } }
  });
  Object.defineProperty(el, '_surf', { get() { return surf; } });
  return el;
}
module.exports = { makeCanvas, Surface, Ctx2D, parseColor };
