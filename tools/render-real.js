/* Gerçek dokularla raycast çıktısı üretir (yazılım canvas + PNG). */
const path = require('path');
const fs = require('fs');
const soft = require('./softcanvas');
const { writePNG } = require('./png');

/* ---------- sahte ortam (gerçek canvas'larla) ---------- */
const elements = {};
function makeDiv(id) {
  const d = {
    id: id || '', tagName: 'DIV', style: {}, children: [], className: '', textContent: '', _html: '',
    classList: { add() { }, remove() { }, toggle() { }, contains() { return false; } },
    appendChild(c) { this.children.push(c); return c; }, removeChild(c) { return c; },
    get firstChild() { return this.children[0]; },
    querySelector() { return makeDiv(); }, querySelectorAll() { return []; },
    addEventListener() { }, removeEventListener() { }
  };
  return d;
}
function byId(id) {
  if (elements[id]) return elements[id];
  if (id === 'view' || id === 'compass-c' || id === 'map-c') elements[id] = soft.makeCanvas(480, 270);
  else elements[id] = makeDiv(id);
  return elements[id];
}
global.document = {
  readyState: 'complete',
  createElement: (t) => (t === 'canvas' ? soft.makeCanvas(300, 150) : makeDiv()),
  getElementById: byId, addEventListener() { }, removeEventListener() { },
  pointerLockElement: null, body: makeDiv('body'),
  documentElement: { setAttribute() { }, getAttribute() { return null; }, style: {} }
};
global.navigator = { userAgent: 'NodeTest' };
global.window = { addEventListener() { }, removeEventListener() { }, matchMedia: () => ({ matches: true }), requestPointerLock() { } };
global.performance = { now: () => Date.now() };
global.requestAnimationFrame = () => 0;
const storage = {};
global.localStorage = { getItem: (k) => (k in storage ? storage[k] : null), setItem: (k, v) => { storage[k] = v; }, removeItem: (k) => { delete storage[k]; } };

const root = path.join(__dirname, '..');
global.MV = {};
for (const f of ['00-core.js', '05-desktop.js', '07-input.js', '09-gl.js', '10-textures.js', '20-maze.js', '30-render.js', '40-audio.js', '50-ai.js', '60-game.js', '70-ui.js']) {
  new Function(fs.readFileSync(path.join(root, 'app', 'js', f), 'utf8'))();
}
const MV = global.MV, G = MV.Game, UI = MV.UI;

UI.init(G);
G.init(byId('view'));

const outDir = path.join(__dirname, 'out');
fs.mkdirSync(outDir, { recursive: true });

function dump(name, bufW, bufH, data, scale) {
  const out = new Uint8Array(bufW * bufH * 4);
  for (let i = 0; i < bufW * bufH; i++) {
    const c = data[i];
    out[i * 4] = c & 255; out[i * 4 + 1] = (c >>> 8) & 255; out[i * 4 + 2] = (c >>> 16) & 255; out[i * 4 + 3] = 255;
  }
  const file = path.join(outDir, name + '.png');
  writePNG(file, out, bufW, bufH, scale || 2);
  console.log('  ' + name + '.png ' + bufW + 'x' + bufH);
}

/* ---------- doku sayfası ---------- */
const R = MV.Renderer;
function texSheet() {
  const names = ['STONE', 'STONE_MOSS', 'HEDERA', 'VINE', 'CLIFF', 'BOX', 'GRASS', 'DIRT', 'TRACK', 'WOOD', 'GATE', 'GRATE', 'HIVE', 'LEAF'];
  const cols = 8, cell = 64, rows = 2 + Math.ceil((14 + 8) / cols);
  const sheet = soft.makeCanvas(cols * cell, rows * cell);
  const c = sheet.getContext('2d');
  c.fillStyle = '#101010'; c.fillRect(0, 0, cols * cell, rows * cell);
  let i = 0;
  for (const n of names) {
    const cv = G.tex.walls[MV.T[n]];
    if (!cv || !cv.getContext) continue;
    const x = (i % cols) * cell, y = Math.floor(i / cols) * cell;
    c.drawImage(cv, x, y, cell, cell);
    c.fillStyle = '#ffcc66'; c.font = '9px monospace';
    c.fillText(n.slice(0, 7), x + 2, y + 9);
    i++;
  }
  // rune taşları
  for (let k = 0; k < 8; k++) {
    const cv = G.tex.walls[100 + k];
    if (!cv || !cv.getContext) continue;
    const x = (i % cols) * cell, y = Math.floor(i / cols) * cell;
    c.drawImage(cv, x, y, cell, cell);
    c.fillStyle = '#ffcc66'; c.fillText('RUNE ' + (k + 1), x + 2, y + 9);
    i++;
  }
  // sprite'lar
  const sprites = ['griever', 'beetle', 'hut', 'hive', 'spear', 'torch', 'tracker', 'key', 'vial', 'food', 'crate', 'lamp', 'sign', 'spike', 'egg', 'grassTuft', 'bush', 'boxLid'];
  for (const s of sprites) {
    const sd = G.tex.sprites[s];
    if (!sd || !sd.getContext) continue;
    const x = (i % cols) * cell, y = Math.floor(i / cols) * cell;
    c.fillStyle = '#20242a'; c.fillRect(x, y, cell, cell);
    c.drawImage(sd, x, y, cell, cell);
    c.fillStyle = '#66ddff'; c.font = '8px monospace';
    c.fillText(s.slice(0, 8), x + 1, y + 8);
    i++;
  }
  const surf = sheet._getSurf();
  const out = new Uint8Array(surf.width * surf.height * 4);
  for (let p = 0; p < surf.width * surf.height; p++) {
    out[p * 4] = surf.data[p * 4]; out[p * 4 + 1] = surf.data[p * 4 + 1];
    out[p * 4 + 2] = surf.data[p * 4 + 2]; out[p * 4 + 3] = 255;
  }
  writePNG(path.join(outDir, '00_textures.png'), out, surf.width, surf.height, 2);
  console.log('  00_textures.png ' + surf.width + 'x' + surf.height);
}

function shot(name, cfg) {
  const w = G.world, P = G.player;
  if (cfg.day !== undefined) G.day = cfg.day;
  if (cfg.phase) { G.phase = cfg.phase; G.clock = cfg.phase === 'night' ? 60 : 120; G.flags.gatesClosed = cfg.phase === 'night'; }
  if (cfg.place) { const p = cfg.place(w); P.x = p.x; P.y = p.y; if (p.a !== undefined) P.a = p.a; }
  if (cfg.torch) { G.tools.fener = 1; G.torchCharge = 100; P.torchOn = true; }
  if (cfg.tool !== undefined) G.tool = cfg.tool;
  for (let i = 0; i < 2; i++) G.render(1 / 60);
  const buf = new Uint32Array(R.img.data.buffer);
  dump(name, R.W, R.H, buf, cfg.scale || 2);
}

console.log('--- doku sayfası ---');
texSheet();

/* ekran görüntüleri profesyonel kalitede alınsın */
try { MV.Renderer.init(byId('view')); MV.Renderer.setQuality('yuksek'); } catch (e) { console.log('kalite: ' + e.message); }

console.log('--- sahneler ---');
const w = G.world;
shot('01_kayran', { day: 1, phase: 'day', place: () => ({ x: w.cx - 6.5, y: w.cy - 5.5, a: Math.atan2(2 + 5.5, 2 + 6.5) }) });
shot('02_kayran_genel', { place: () => ({ x: w.cx + 6.5, y: w.cy + 6.5, a: -Math.PI * 0.75 }) });
shot('03_gecit_ic', { place: () => ({ x: w.cx + MV.K.R1 - 3.2, y: w.cy + .5, a: 0 }) });
shot('04_gecit_dis', { place: () => ({ x: w.cx + MV.K.R1 + 4.5, y: w.cy + .5, a: Math.PI }) });
shot('05_sektor_agzi', { place: () => ({ x: w.cx + 26, y: w.cy + .5, a: Math.PI }) });
const m1 = MV.Maze.nearestOpen(w, w.cx - 42, w.cy - 30, 12, true);
shot('06_labirent', { place: () => ({ x: m1.x, y: m1.y, a: 2.1 }) });
const m2 = MV.Maze.nearestOpen(w, w.cx + 31, w.cy + 19, 12, true);
shot('07_labirent2', { place: () => ({ x: m2.x, y: m2.y, a: -0.7 }) });
const rn = w.runes[0];
shot('08_rune', {
  place: () => {
    for (const d of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = rn.x + d[0], ny = rn.y + d[1];
      if (!w.solid[ny * w.W + nx] && !w.void[ny * w.W + nx]) {
        return { x: nx + .5, y: ny + .5, a: Math.atan2(rn.y + .5 - (ny + .5), rn.x + .5 - (nx + .5)) };
      }
    }
    return { x: rn.x + 1.5, y: rn.y + .5, a: Math.PI };
  }
});
shot('09_gece_torch', { phase: 'night', torch: true, place: () => ({ x: m1.x, y: m1.y, a: 2.1 }) });
shot('10_gece_karanlik', { phase: 'night', place: () => ({ x: m1.x, y: m1.y, a: 2.1 }) });
shot('11_kayran_gece', { phase: 'night', place: () => ({ x: w.cx + 5, y: w.cy + 7, a: -1.6 }) });
shot('12_ucurum', { place: () => ({ x: w.cx - 58, y: w.cy + 2, a: Math.PI }) });
shot('13_kovan', { place: () => ({ x: w.hive.x + 5.5, y: w.hive.y + 2.5, a: Math.atan2(-2.5, -5.5) }) });
shot('14_cikis', { place: () => ({ x: w.hatch.x + 4.5, y: w.hatch.y + 1.5, a: Math.atan2(-1.5, -4.5) }) });
/* açık bir koridorda yaratık sahnesi kur */
function corridorSpot(w) {
  for (let t = 0; t < 4000; t++) {
    const a = Math.random() * Math.PI * 2, r = MV.K.R2B + 3 + Math.random() * (MV.K.RAV0 - MV.K.R2B - 8);
    const x = Math.floor(w.cx + Math.cos(a) * r), y = Math.floor(w.cy + Math.sin(a) * r);
    for (const d of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      let ok = true;
      for (let k = 0; k <= 6; k++) {
        const nx = x + d[0] * k, ny = y + d[1] * k;
        if (w.solid[ny * w.W + nx] || w.void[ny * w.W + nx]) { ok = false; break; }
      }
      if (ok) return { x: x + .5, y: y + .5, a: Math.atan2(d[1], d[0]), d: d };
    }
  }
  return null;
}
const csp = corridorSpot(w);
shot('15_griever', {
  place: () => {
    const g = G.grievers[0];
    g.x = csp.x + csp.d[0] * 3.4; g.y = csp.y + csp.d[1] * 3.4;
    g.aggro = true;
    return { x: csp.x, y: csp.y, a: csp.a };
  }
});
shot('16_bocek', {
  place: () => {
    const b = G.beetles[0];
    b.x = csp.x + csp.d[0] * 2.6; b.y = csp.y + csp.d[1] * 2.6;
    b.state = 'scan';
    return { x: csp.x, y: csp.y, a: csp.a };
  }
});
shot('16b_bocek_tarama', {
  place: () => {
    const b = G.beetles[0];
    b.x = csp.x + csp.d[0] * 1.6; b.y = csp.y + csp.d[1] * 1.6;
    b.state = 'scan'; b.glow = 0.5;
    return { x: csp.x, y: csp.y, a: csp.a };
  }
});
shot('17_esya', {
  place: () => {
    const it = G.items.find(i => i.type === 'serum') || G.items[5];
    const p = MV.Maze.nearestOpen(w, it.x - 2.2, it.y, 8, true);
    return { x: p.x, y: p.y, a: Math.atan2(it.y - p.y, it.x - p.x) };
  }
});
shot('18_orta_gun', { day: 4, phase: 'day', place: () => ({ x: w.cx + 30, y: w.cy - 20, a: 1.90 }) });
/* dokümantasyon görselleri: sahneyi 1× ölçekte çekip docs/ altına yaz (depo küçük kalsın) */
function docShot(name, cfg, dst) {
  shot(name, Object.assign({ scale: 1 }, cfg || {}));
  try {
    fs.copyFileSync(path.join(outDir, name + '.png'), path.join(root, 'docs', dst + '.png'));
    console.log('  docs/' + dst + '.png güncellendi');
  } catch (e) { console.log('  docs kopyası yazılamadı: ' + e.message); }
}
docShot('doc_kayran', { day: 1, phase: 'day', place: () => ({ x: w.cx - 6.5, y: w.cy - 5.5, a: Math.atan2(2 + 5.5, 2 + 6.5) }) }, 'kayran');
docShot('doc_labirent', { place: () => ({ x: m1.x, y: m1.y, a: 2.1 }) }, 'labirent');
docShot('doc_gece', { phase: 'night', torch: true, place: () => ({ x: m1.x, y: m1.y, a: 2.1 }) }, 'gece-fener');
docShot('doc_griever', {
  place: () => {
    const g = G.grievers[0];
    g.x = csp.x + csp.d[0] * 3.4; g.y = csp.y + csp.d[1] * 3.4; g.aggro = true;
    return { x: csp.x, y: csp.y, a: csp.a };
  }
}, 'griever');
docShot('doc_rune', {
  place: () => {
    for (const d of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = rn.x + d[0], ny = rn.y + d[1];
      if (!w.solid[ny * w.W + nx] && !w.void[ny * w.W + nx]) {
        return { x: nx + .5, y: ny + .5, a: Math.atan2(rn.y + .5 - (ny + .5), rn.x + .5 - (nx + .5)) };
      }
    }
    return { x: rn.x + 1.5, y: rn.y + .5, a: Math.PI };
  }
}, 'rune');

console.log('bitti → tools/out/');
