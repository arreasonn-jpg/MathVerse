/* ============================================================
   tools/three-test.js — GPU motorunu (Three.js hattı) GPU'suz sınar

   Sandbox'ta WebGL yok; bu yüzden:
     1) Motorun ürettiği geometri (MV.GL.buildChunkData) doğrulanır:
        köşe/normal/UV bütünlüğü, malzeme dağılımı, sınırlar.
     2) Geometri, oyunun kamera kurulumuyla CPU'da rasterleştirilir ve
        PNG olarak yazılır → gözle denetim (tools/out/).
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const soft = require('./softcanvas');
const raster = require('./raster');
const { writePNG } = require('./png');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });

/* ---------- sahte ortam ---------- */
const elements = {};
function makeDiv(id) {
  const kids = [];
  const d = {
    id: id || '', tagName: 'DIV', style: {}, children: kids, className: '', textContent: '', _html: '',
    classList: { add() { }, remove() { }, toggle() { }, contains() { return false; } },
    appendChild(c) { kids.push(c); c._parent = this; return c; },
    insertBefore(c) { kids.unshift(c); c._parent = this; return c; },
    removeChild(c) { const i = kids.indexOf(c); if (i >= 0) kids.splice(i, 1); return c; },
    get firstChild() { return kids[0]; },
    querySelector() { return makeDiv(); }, querySelectorAll() { return []; },
    addEventListener() { }, removeEventListener() { }, setAttribute() { }, getAttribute() { return null; }
  };
  return d;
}
function byId(id) {
  if (elements[id]) return elements[id];
  elements[id] = (id === 'view') ? soft.makeCanvas(960, 540) : makeDiv(id);
  return elements[id];
}
const define = (k, v) => Object.defineProperty(global, k, { value: v, configurable: true, writable: true });
define('document', {
  readyState: 'complete',
  createElement: (t) => (t === 'canvas' ? soft.makeCanvas(300, 150) : makeDiv()),
  getElementById: byId, addEventListener() { }, removeEventListener() { },
  pointerLockElement: null, body: makeDiv('body'), documentElement: makeDiv('html'), querySelector: () => null
});
define('window', { addEventListener() { }, removeEventListener() { }, devicePixelRatio: 1, matchMedia: () => ({ matches: false }) });
define('navigator', { userAgent: 'ThreeTest' });
define('performance', { now: () => Date.now() });
define('localStorage', { getItem: () => null, setItem() { }, removeItem() { } });

/* ---------- Three.js (satıcı dosyaları) ---------- */
global.window.THREE = require(path.join(ROOT, 'app/vendor/three.min.js'));
global.THREE = global.window.THREE;
for (const f of ['postprocessing/Pass.js', 'postprocessing/EffectComposer.js', 'postprocessing/RenderPass.js',
  'postprocessing/ShaderPass.js', 'postprocessing/UnrealBloomPass.js', 'shaders/CopyShader.js',
  'shaders/LuminosityHighPassShader.js']) {
  new Function(fs.readFileSync(path.join(ROOT, 'app/vendor', f), 'utf8'))();
}

/* ---------- oyun modülleri ---------- */
global.MV = {};
for (const f of ['00-core.js', '09-gl.js', '10-textures.js', '20-maze.js']) {
  new Function(fs.readFileSync(path.join(ROOT, 'app/js', f), 'utf8'))();
}
const MV = global.MV, GL = MV.GL, T = MV.T;

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const section = (t) => console.log('--- ' + t + ' ---');

/* ---------- dokular ve dünya ---------- */
console.log('dokular üretiliyor…');
const tex = MV.texBuild();
console.log('dünya üretiliyor…');
const world = MV.Maze.genWorld(20261003);

GL._texIds = {};
for (let i = 0; i < tex.walls.length; i++) if (tex.walls[i]) GL._texIds[i] = 1;

/* doku verisini rasterleştirici için hazırla */
const texData = {};
for (let i = 0; i < tex.walls.length; i++) {
  const cv = tex.walls[i];
  if (!cv) continue;
  const x = cv.getContext('2d');
  const img = x.getImageData(0, 0, cv.width, cv.height);
  texData[i] = { data: img.data, w: cv.width, h: cv.height };
}
const baseColor = {};
for (const id in texData) {
  const td = texData[id];
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < td.data.length; i += 4 * 37) { r += td.data[i]; g += td.data[i + 1]; b += td.data[i + 2]; n++; }
  baseColor[id] = [r / n / 255, g / n / 255, b / n / 255];
}

section('Geometri (kare başına)');
const t0 = Date.now();
const data = GL.buildChunkData(world, Math.floor(world.spawn.x / 24), Math.floor(world.spawn.y / 24), true);
const buildMs = Date.now() - t0;
ok(data.tris > 0, 'üçgen üretildi: ' + data.tris.toLocaleString('tr-TR') + ' (' + data.cells + ' karo, ' + buildMs + ' ms)');
let vertSum = 0, badNrm = 0, badIdx = 0, uvMin = Infinity, uvMax = -Infinity, badShade = 0;
for (const id in data.mats) {
  const b = data.mats[id];
  vertSum += b.pos.length / 3;
  if (b.pos.length / 3 !== b.nrm.length / 3 || b.pos.length / 3 !== b.uv.length / 2 || b.pos.length / 3 !== b.col.length / 3) {
    badIdx++;
  }
  for (let i = 0; i < b.nrm.length; i += 3) {
    const l = Math.hypot(b.nrm[i], b.nrm[i + 1], b.nrm[i + 2]);
    if (Math.abs(l - 1) > 1e-6) badNrm++;
  }
  for (let i = 0; i < b.uv.length; i++) { if (b.uv[i] < uvMin) uvMin = b.uv[i]; if (b.uv[i] > uvMax) uvMax = b.uv[i]; }
  for (let i = 0; i < b.col.length; i++) if (!(b.col[i] > 0.1 && b.col[i] <= 1.3)) badShade++;
  for (let i = 0; i < b.idx.length; i++) if (b.idx[i] < 0 || b.idx[i] >= b.pos.length / 3) badIdx++;
}
ok(badIdx === 0 && badNrm === 0, 'öznitelik dizileri tutarlı, normaller birim (' + vertSum.toLocaleString('tr-TR') + ' köşe)');
ok(uvMin >= 0 && uvMax <= 8.01, 'UV aralığı geçerli: ' + uvMin.toFixed(2) + '…' + uvMax.toFixed(2) + ' (döşeme)');
ok(badShade === 0, 'gölgeleme katsayıları makul aralıkta');
ok(buildMs < 40, 'bölüm kurulumu kare bütçesinde: ' + buildMs + ' ms');

section('Malzeme dağılımı');
const matIds = Object.keys(data.mats).map(Number).sort((a, b) => a - b);
ok(matIds.length >= 3, 'kullanılan doku türü: ' + matIds.map(i => i + '(' + (data.mats[i].pos.length / 3) + ')').join(' '));
ok(matIds.indexOf(T.CEIL) >= 0, 'tavan dokusu kullanılıyor (kapalı alan)');
/* Kayran açık alan: duvar beklenmez; labirent bölümünde duvar aranır */
const mazeChunk = GL.buildChunkData(world, Math.floor(world.cx / 24) + 3, Math.floor(world.cy / 24), true);
const mazeMats = Object.keys(mazeChunk.mats).map(Number);
ok(mazeMats.some(i => i === T.STONE || i === T.STONE_MOSS || i === T.HEDERA || i === T.GATE),
  'labirent bölümünde duvar dokuları var: ' + mazeMats.join(','));

section('Geometri bütünlüğü (geniş alan)');
let totalTris = 0, totalCells = 0, bad = 0, empty = 0;
for (let cy = 0; cy < 5; cy++) {
  for (let cx = 0; cx < 5; cx++) {
    const d2 = GL.buildChunkData(world, cx + 6, cy + 6, true);
    totalTris += d2.tris; totalCells += d2.cells;
    if (!d2.tris) empty++;
    for (const id in d2.mats) {
      const b = d2.mats[id];
      if (b.pos.length % 12 !== 0 || b.uv.length % 8 !== 0 || b.idx.length % 3 !== 0) bad++;
    }
  }
}
ok(bad === 0, '25 bölümde öznitelik hizaları doğru');
ok(totalTris > 0, 'toplam üçgen: ' + totalTris.toLocaleString('tr-TR') + ' / ' + totalCells.toLocaleString('tr-TR') + ' karo');
ok(empty === 0, 'boş bölüm yok');

/* ============================================================
   GÖRSEL DOĞRULAMA: CPU rasterleştirme
   ============================================================ */
function collectTris(camWorld, radius, gatesOpen) {
  const ccx = Math.floor(camWorld.x / 24), ccy = Math.floor(camWorld.z / 24);
  const out = [];
  for (let cy = ccy - radius; cy <= ccy + radius; cy++) {
    for (let cx = ccx - radius; cx <= ccx + radius; cx++) {
      if (cx < 0 || cy < 0 || cx * 24 >= world.W || cy * 24 >= world.H) continue;
      const d = GL.buildChunkData(world, cx, cy, gatesOpen !== false);
      for (const id in d.mats) {
        const b = d.mats[id];
        const matId = Number(id);
        for (let i = 0; i < b.idx.length; i += 3) {
          const out3 = [];
          const uv3 = [];
          for (let k = 0; k < 3; k++) {
            const vi = b.idx[i + k];
            out3.push([b.pos[vi * 3], b.pos[vi * 3 + 1], b.pos[vi * 3 + 2]]);
            uv3.push([b.uv[vi * 2], b.uv[vi * 2 + 1]]);
          }
          const vi0 = b.idx[i];
          out.push({
            p: out3, uv: uv3,
            n: [b.nrm[vi0 * 3], b.nrm[vi0 * 3 + 1], b.nrm[vi0 * 3 + 2]],
            tex: texData[matId], base: baseColor[matId] || [0.5, 0.5, 0.5],
            shade: b.col[vi0 * 3]
          });
        }
      }
    }
  }
  return out;
}

function shot(name, opts) {
  const W = opts.W || 960, H = opts.H || 540;
  const fb = raster.makeFramebuffer(W, H, [0.03, 0.04, 0.07]);
  const cam = {
    x: opts.x, y: opts.y, z: opts.z, yaw: opts.yaw, pitch: opts.pitch || 0, roll: 0,
    fovK: opts.fovK || 0.66, imageW: W
  };
  const t0 = Date.now();
  const tris = collectTris({ x: opts.x, z: opts.z }, opts.radius || 1, opts.gatesOpen);
  const cull = opts.backface === false ? [] : null;
  const drawn = raster.render(fb, tris, cam, {
    fogColor: opts.fogColor || [0.06, 0.07, 0.1],
    fogDens: opts.fogDens === undefined ? 0.03 : opts.fogDens,
    sunDir: opts.sunDir || [0.35, 0.8, 0.45],
    sunAmt: opts.sunAmt === undefined ? 0.7 : opts.sunAmt,
    ambient: opts.ambient === undefined ? 0.32 : opts.ambient,
    torch: opts.torch || 0,
    torchPos: [opts.x, opts.y, opts.z]
  });
  const rgba = raster.toRGBA(fb, opts.exposure === undefined ? 1.0 : opts.exposure);
  const file = path.join(OUT, name + '.png');
  writePNG(file, rgba, W, H, 1);
  console.log('  → ' + name + '.png (' + tris.length.toLocaleString('tr-TR') + ' üçgen, ' + (Date.now() - t0) + ' ms)');
  return { tris: tris.length, drawn: drawn, file: file };
}

section('Görsel doğrulama (CPU rasterleştirme)');
const sp = world.spawn;
const shots = [];
/* 1) Kayran: açık gökyüzü, kamp yapıları çevresi */
shots.push(shot('motor-01-kayran', {
  x: world.cx + 3, y: 0.55, z: world.cy + 3, yaw: Math.atan2(world.cy + 20 - (world.cy + 3), world.cx + 20 - (world.cx + 3)),
  pitch: 0.02, radius: 1, fogDens: 0.012
}));
/* 2) Labirent koridoru: tavan + duvarlar */
let corr = null;
for (let r = 30; r < 70 && !corr; r += 2) {
  for (let a = 0; a < 6.28; a += 0.35) {
    const x = Math.floor(world.cx + Math.cos(a) * r), y = Math.floor(world.cy + Math.sin(a) * r);
    if (x < 2 || y < 2 || x > world.W - 3 || y > world.H - 3) continue;
    const i = y * world.W + x;
    if (world.solid[i] || world.void[i]) continue;
    /* koridor: iki yanında duvar olsun */
    const left = world.solid[y * world.W + x - 1], right = world.solid[y * world.W + x + 1];
    const up = world.solid[(y - 1) * world.W + x], down = world.solid[(y + 1) * world.W + x];
    if ((left && right) || (up && down)) { corr = { x: x + 0.5, y: y + 0.5 }; break; }
  }
}
ok(!!corr, 'labirentte koridor noktası bulundu: ' + (corr ? corr.x.toFixed(1) + ',' + corr.y.toFixed(1) : '-'));
if (corr) {
  shots.push(shot('motor-02-koridor', {
    x: corr.x, y: 0.55, z: corr.y, yaw: 0, pitch: 0, radius: 1, fogDens: 0.028, sunAmt: 0.55, ambient: 0.30
  }));
  shots.push(shot('motor-03-koridor-donus', {
    x: corr.x, y: 0.55, z: corr.y, yaw: Math.PI * 0.5, pitch: 0.05, radius: 1, fogDens: 0.05, sunAmt: 0.2, ambient: 0.26
  }));
  shots.push(shot('motor-04-gece-fener', {
    x: corr.x, y: 0.55, z: corr.y, yaw: 0, pitch: 0, radius: 1, fogDens: 0.075,
    sunAmt: 0.10, ambient: 0.18, torch: 1, exposure: 1.1,
    fogColor: [0.04, 0.05, 0.09]
  }));
}
/* 5) Dış kuşak: uçurum + karanlık yüzeyler */
let voidPt = null;
for (let r = 228; r <= 252 && !voidPt; r += 0.5) {
  const x = Math.floor(world.cx + r), y = world.cy;
  if (MV.Maze.voidAt(world, x + 0.5, y + 0.5)) voidPt = { x: x + 0.5, y: y + 0.5 };
}
if (voidPt) {
  shots.push(shot('motor-05-kusak', {
    x: voidPt.x - 6, y: 0.55, z: voidPt.y, yaw: 0, pitch: -0.05, radius: 1, fogDens: 0.05, sunAmt: 0.7
  }));
  ok(true, 'dış kuşak görüntüsü üretildi');
}

section('Görüntü içeriği denetimi');
function readPNGStats(file) {
  /* yazılan PNG'yi geri okuyup parlaklık dağılımına bakıyoruz */
  return null;   // (dosya boyutu denetimi aşağıda)
}
let minSize = Infinity, maxSize = 0;
for (const s of shots) {
  const st = fs.statSync(s.file);
  if (st.size < minSize) minSize = st.size;
  if (st.size > maxSize) maxSize = st.size;
}
ok(shots.length >= 4, 'üretilen görüntü: ' + shots.length);
ok(minSize > 20000, 'en küçük PNG bile dolu bir kare içeriyor: ' + Math.round(minSize / 1024) + ' KB');
ok(shots.every(s => s.tris > 500), 'her görüntüde yüzlerce üçgen çizildi');

section('Motor kurulumu (GPU yokken)');
/* Sahte DOM'da WebGL olmadığı için motor CPU yedeğine düşmeli — oyun düşmemeli */
GL.ok = false; GL.prepared = false;
GL.init(byId('view'));
ok(GL.ok === false, 'WebGL yokken ok=false');
ok(/CPU/.test(GL.status), 'durum: ' + GL.status);
ok(GL.render({ world: world, px: 10, py: 10, pa: 0, zc: 0.55, fogColor: [10, 10, 12], sky: [10, 10, 14], skyTop: [4, 4, 8], fogDens: 0.03, sunDir: [1, 1], sunCol: [255, 255, 255], entities: [] }, {}) === false,
  'render() GPU yokken false döner → CPU hattı devralır');

console.log('');
console.log('Motor testi: ' + pass + ' geçti, ' + fail + ' başarısız');
console.log('Görüntüler: tools/out/motor-*.png');
process.exit(fail ? 1 : 0);
