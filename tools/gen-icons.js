/* ============================================================
   tools/gen-icons.js — uygulama simgesi üretici
   Prosedürel olarak 1024px ikon çizer; PNG + ICO + ICNS yazar.
   Harici araç gerekmez (kendi PNG kodlayıcımız kullanılır).
   ============================================================ */
const fs = require('fs');
const path = require('path');
const soft = require('./softcanvas');
const { writePNG } = require('./png');

const ROOT = path.join(__dirname, '..');
const BUILD = path.join(ROOT, 'build');
fs.mkdirSync(BUILD, { recursive: true });

/* ---------------- ikon çizimi (1024x1024) ---------------- */
function drawIcon(size) {
  const cv = soft.makeCanvas(size, size);
  const c = cv.getContext('2d');
  const S = size / 1024;
  const cx = 512 * S, cy = 512 * S;

  function roundRect(x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.lineTo(x + w - r, y);
    c.quadraticCurveTo(x + w, y, x + w, y + r);
    c.lineTo(x + w, y + h - r);
    c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    c.lineTo(x + r, y + h);
    c.quadraticCurveTo(x, y + h, x, y + h - r);
    c.lineTo(x, y + r);
    c.quadraticCurveTo(x, y, x + r, y);
    c.closePath();
  }

  /* --- plaka: paslı koyu çelik --- */
  const bg = c.createLinearGradient(0, 0, size, size);
  bg.addColorStop(0, 'rgb(38,45,45)');
  bg.addColorStop(0.4, 'rgb(20,25,26)');
  bg.addColorStop(1, 'rgb(11,14,15)');
  c.fillStyle = bg;
  roundRect(10 * S, 10 * S, size - 20 * S, size - 20 * S, 168 * S);
  c.fill();
  c.strokeStyle = 'rgba(158,196,182,.30)';
  c.lineWidth = 9 * S;
  roundRect(20 * S, 20 * S, size - 40 * S, size - 40 * S, 158 * S);
  c.stroke();

  /* --- zemin halka ışığı --- */
  const halo = c.createRadialGradient(cx, cy, 10 * S, cx, cy, 470 * S);
  halo.addColorStop(0, 'rgba(255,80,50,.20)');
  halo.addColorStop(0.45, 'rgba(255,60,40,.05)');
  halo.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = halo;
  c.beginPath(); c.arc(cx, cy, 470 * S, 0, Math.PI * 2); c.fill();

  /* --- labirent: 3 kalın kırık halka + bağlantı duvarları --- */
  const rings = [
    { r: 388, lw: 84, gapA: 0.32, gapLen: 1.15, link: 2.35 },
    { r: 268, lw: 78, gapA: 3.55, gapLen: 1.05, link: 0.42 },
    { r: 156, lw: 70, gapA: 1.55, gapLen: 0.95, link: 4.05 }
  ];
  for (let i = 0; i < rings.length; i++) {
    const R = rings[i], rr = R.r * S, lw = R.lw * S;
    const a0 = R.gapA + R.gapLen, a1 = R.gapA + Math.PI * 2;
    /* gövde: iki katman (dış kontur koyu, iç doku açık) */
    c.lineCap = 'butt';
    c.strokeStyle = 'rgba(18,20,20,.95)';
    c.lineWidth = lw + 10 * S;
    c.beginPath(); c.arc(cx, cy, rr, a0, a1, false); c.stroke();
    c.strokeStyle = 'rgb(176,170,150)';
    c.lineWidth = lw;
    c.beginPath(); c.arc(cx, cy, rr, a0, a1, false); c.stroke();
    /* üst yüzey ışığı */
    c.strokeStyle = 'rgba(255,255,255,.14)';
    c.lineWidth = lw * 0.30;
    c.beginPath(); c.arc(cx, cy, rr - lw * 0.30, a0, a1, false); c.stroke();
    /* alt gölge */
    c.strokeStyle = 'rgba(0,0,0,.35)';
    c.lineWidth = lw * 0.22;
    c.beginPath(); c.arc(cx, cy, rr + lw * 0.38, a0, a1, false); c.stroke();
    /* blok ekleri */
    c.strokeStyle = 'rgba(20,22,22,.75)';
    c.lineWidth = 7 * S;
    for (let k = 1; k < 8; k++) {
      const a = a0 + (a1 - a0) * (k / 8);
      c.beginPath();
      c.moveTo(cx + Math.cos(a) * (rr - lw / 2), cy + Math.sin(a) * (rr - lw / 2));
      c.lineTo(cx + Math.cos(a) * (rr + lw / 2), cy + Math.sin(a) * (rr + lw / 2));
      c.stroke();
    }
    /* boşluğu kapatan radyal duvar (labirent geçidi hissi) */
    const la = R.link;
    c.strokeStyle = 'rgb(176,170,150)';
    c.lineWidth = lw * 0.92;
    c.beginPath();
    c.moveTo(cx + Math.cos(la) * (rr - lw * 0.6), cy + Math.sin(la) * (rr - lw * 0.6));
    c.lineTo(cx + Math.cos(la) * (rr + lw * 1.7), cy + Math.sin(la) * (rr + lw * 1.7));
    c.stroke();
    c.strokeStyle = 'rgba(0,0,0,.4)';
    c.lineWidth = 7 * S;
    c.beginPath();
    c.moveTo(cx + Math.cos(la) * (rr - lw * 0.6), cy + Math.sin(la) * (rr - lw * 0.6));
    c.lineTo(cx + Math.cos(la) * (rr + lw * 1.7), cy + Math.sin(la) * (rr + lw * 1.7));
    c.stroke();
  }

  /* --- merkez: griever gözü --- */
  const glow = c.createRadialGradient(cx, cy, 6 * S, cx, cy, 200 * S);
  glow.addColorStop(0, 'rgba(255,120,80,1)');
  glow.addColorStop(0.30, 'rgba(230,50,25,.62)');
  glow.addColorStop(1, 'rgba(150,20,10,0)');
  c.fillStyle = glow;
  c.beginPath(); c.arc(cx, cy, 205 * S, 0, Math.PI * 2); c.fill();

  c.fillStyle = 'rgb(12,9,11)';
  c.beginPath(); c.ellipse(cx, cy, 88 * S, 112 * S, 0, 0, Math.PI * 2); c.fill();
  c.strokeStyle = 'rgba(214,204,182,.55)';
  c.lineWidth = 8 * S;
  c.beginPath(); c.ellipse(cx, cy, 88 * S, 112 * S, 0, 0, Math.PI * 2); c.stroke();

  const eyeGlow = c.createRadialGradient(cx - 30 * S, cy - 16 * S, 2 * S, cx - 30 * S, cy - 16 * S, 44 * S);
  eyeGlow.addColorStop(0, 'rgba(255,190,150,.95)');
  eyeGlow.addColorStop(1, 'rgba(255,60,30,0)');
  c.fillStyle = eyeGlow;
  c.beginPath(); c.arc(cx - 30 * S, cy - 16 * S, 44 * S, 0, Math.PI * 2); c.fill();
  c.beginPath(); c.arc(cx + 30 * S, cy - 16 * S, 44 * S, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#ff5533';
  c.beginPath(); c.arc(cx - 30 * S, cy - 16 * S, 21 * S, 0, Math.PI * 2); c.fill();
  c.beginPath(); c.arc(cx + 30 * S, cy - 16 * S, 21 * S, 0, Math.PI * 2); c.fill();

  /* --- WICKED mührü: sol üst köşe, küçük ve net --- */
  c.save();
  c.translate(206 * S, 200 * S);
  c.fillStyle = 'rgba(13,19,19,.94)';
  roundRect(-112 * S, -112 * S, 224 * S, 224 * S, 46 * S);
  c.fill();
  c.strokeStyle = 'rgba(111,227,255,.55)';
  c.lineWidth = 8 * S;
  roundRect(-112 * S, -112 * S, 224 * S, 224 * S, 46 * S);
  c.stroke();
  c.fillStyle = 'rgba(166,242,255,.96)';
  c.font = 'bold ' + Math.round(168 * S) + 'px monospace';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText('7', 4 * S, 10 * S);
  /* küçük tarama çizgileri */
  c.fillStyle = 'rgba(111,227,255,.20)';
  for (let i = 0; i < 4; i++) c.fillRect(-92 * S, (-70 + i * 46) * S, 184 * S, 3 * S);
  c.restore();

  /* --- uyarı şeridi (alt) --- */
  const stripeY = 856 * S, stripeH = 40 * S;
  c.save();
  roundRect(56 * S, stripeY, size - 112 * S, stripeH, 8 * S);
  c.clip ? null : null;
  for (let i = 0; i < 15; i++) {
    c.fillStyle = i % 2 ? 'rgba(206,158,58,.90)' : 'rgba(22,22,20,.95)';
    c.fillRect(56 * S + i * ((size - 112 * S) / 15), stripeY, (size - 112 * S) / 15 + 1, stripeH);
  }
  c.restore();

  /* --- çizikler / kir --- */
  c.strokeStyle = 'rgba(0,0,0,.30)';
  for (let i = 0; i < 22; i++) {
    const x = 60 * S + (i * 173 % (880 * S));
    const y = 60 * S + (i * 331 % (760 * S));
    c.lineWidth = (1 + (i % 3)) * S;
    c.beginPath(); c.moveTo(x, y); c.lineTo(x + (i % 5) * 22 * S, y + (i % 7) * 12 * S); c.stroke();
  }
  return cv;
}

/* ---------------- yeniden ölçekleme (box filter) ---------------- */
function resize(surf, sw, sh, dw, dh) {
  const out = new Uint8ClampedArray(dw * dh * 4);
  const xs = sw / dw, ys = sh / dh;
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      const x0 = Math.floor(x * xs), x1 = Math.min(sw, Math.ceil((x + 1) * xs));
      const y0 = Math.floor(y * ys), y1 = Math.min(sh, Math.ceil((y + 1) * ys));
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) {
        const i = (yy * sw + xx) * 4;
        r += surf.data[i]; g += surf.data[i + 1]; b += surf.data[i + 2]; a += surf.data[i + 3];
        n++;
      }
      const o = (y * dw + x) * 4;
      out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = a / n;
    }
  }
  return out;
}
function pngBytes(rgba, w, h) {
  const { writePNG } = require('./png');
  const tmp = path.join(BUILD, '.tmp-' + w + 'x' + h + '.png');
  writePNG(tmp, rgba, w, h, 1);
  const buf = fs.readFileSync(tmp);
  fs.unlinkSync(tmp);
  return buf;
}

/* ---------------- ICO (PNG gömülü) ---------------- */
function buildICO(entries) {
  const head = Buffer.alloc(6);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(entries.length, 4);
  const dir = Buffer.alloc(16 * entries.length);
  let offset = 6 + 16 * entries.length;
  const blobs = [];
  entries.forEach((e, i) => {
    const o = i * 16;
    dir[o] = e.size >= 256 ? 0 : e.size;
    dir[o + 1] = e.size >= 256 ? 0 : e.size;
    dir[o + 2] = 0; dir[o + 3] = 0;
    dir.writeUInt16LE(1, o + 4);
    dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(e.png.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += e.png.length;
    blobs.push(e.png);
  });
  const file = Buffer.concat([head, dir, ...blobs]);
  fs.writeFileSync(path.join(BUILD, 'icon.ico'), file);
  return file.length;
}

/* ---------------- ICNS (PNG gömülü) ---------------- */
function buildICNS(entries) {
  const chunks = entries.map(e => {
    const b = Buffer.alloc(8 + e.png.length);
    b.write(e.type, 0, 4, 'ascii');
    b.writeUInt32BE(8 + e.png.length, 4);
    e.png.copy(b, 8);
    return b;
  });
  const total = 8 + chunks.reduce((s, c) => s + c.length, 0);
  const head = Buffer.alloc(8);
  head.write('icns', 0, 4, 'ascii');
  head.writeUInt32BE(total, 4);
  const file = Buffer.concat([head, ...chunks]);
  fs.writeFileSync(path.join(BUILD, 'icon.icns'), file);
  return file.length;
}

/* ---------------- üret ---------------- */
console.log('ikon çiziliyor (1024px)…');
const master = drawIcon(1024);
const masterSurf = master._getSurf();
console.log('  ana tuval: ' + masterSurf.width + 'x' + masterSurf.height);

/* ana PNG (Linux + electron-builder kaynağı) */
writePNG(path.join(BUILD, 'icon.png'), masterSurf.data, 1024, 1024, 1);
console.log('  build/icon.png  (1024x1024)');

/* ölçekli PNG'ler */
const sizes = [256, 128, 64, 48, 32, 16];
const pngs = {};
for (const s of sizes) {
  pngs[s] = pngBytes(resize(masterSurf, 1024, 1024, s, s), s, s);
}
const ico = buildICO(sizes.map(s => ({ size: s, png: pngs[s] })));
console.log('  build/icon.ico  (' + (ico / 1024).toFixed(0) + ' KB, ' + sizes.length + ' boyut)');

/* ICNS: 512 ve 256 zorunlu; diğerleri bonus */
const icnsPngs = {
  16: pngs[16], 32: pngs[32], 64: pngs[64], 128: pngs[128], 256: pngs[256],
  512: pngBytes(resize(masterSurf, 1024, 1024, 512, 512), 512, 512),
  1024: fs.readFileSync(path.join(BUILD, 'icon.png'))
};
const icns = buildICNS([
  { type: 'icp4', png: icnsPngs[16] },
  { type: 'icp5', png: icnsPngs[32] },
  { type: 'icp6', png: icnsPngs[64] },
  { type: 'ic07', png: icnsPngs[128] },
  { type: 'ic08', png: icnsPngs[256] },
  { type: 'ic09', png: icnsPngs[512] },
  { type: 'ic10', png: icnsPngs[1024] }
]);
console.log('  build/icon.icns (' + (icns / 1024).toFixed(0) + ' KB)');

/* önizleme (docs) */
fs.copyFileSync(path.join(BUILD, 'icon.png'), path.join(ROOT, 'docs', 'ikon.png'));
console.log('  docs/ikon.png (önizleme)');
console.log('bitti.');
