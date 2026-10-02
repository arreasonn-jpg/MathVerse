/* Gerçek raycast çıktısını PNG olarak kaydeder (görsel doğrulama). */
const path = require('path');
const fs = require('fs');
const { setup } = require('./domstub');
const { writePNG } = require('./png');

const ctx = setup();
const MV = ctx.MV, G = MV.Game, UI = MV.UI;
const outDir = path.join(__dirname, 'out');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

UI.init(G);
G.init(ctx.byId('view'));

function shot(name, cfg) {
  const w = G.world, P = G.player;
  if (cfg.day !== undefined) { G.day = cfg.day; }
  if (cfg.phase) {
    G.phase = cfg.phase;
    G.clock = cfg.phase === 'night' ? 60 : 120;
    G.flags.gatesClosed = cfg.phase === 'night';
  }
  if (cfg.place) {
    const p = cfg.place(w);
    P.x = p.x; P.y = p.y; P.a = p.a === undefined ? P.a : p.a;
  }
  if (cfg.pitch !== undefined) P.pitch = cfg.pitch;
  if (cfg.crouch) P.crouch = true;
  if (cfg.torch) { G.tools.fener = 1; G.torchCharge = 100; P.torchOn = true; }
  for (let i = 0; i < (cfg.warm || 3); i++) G.render(1 / 60);
  const R = MV.Renderer;
  // buf32 → RGBA
  const W = R.W, H = R.H;
  const out = new Uint8Array(W * H * 4);
  const buf = new Uint32Array(R.img.data.buffer);
  for (let i = 0; i < W * H; i++) {
    const c = buf[i];
    out[i * 4] = c & 255;
    out[i * 4 + 1] = (c >>> 8) & 255;
    out[i * 4 + 2] = (c >>> 16) & 255;
    out[i * 4 + 3] = 255;
  }
  const file = path.join(outDir, name + '.png');
  const bytes = writePNG(file, out, W, H, 2);
  console.log('  ' + name + '.png  ' + W + 'x' + H + ' → ' + (bytes / 1024).toFixed(0) + ' KB');
  return out;
}

const w = G.world;
console.log('--- görüntü alınıyor ---');
shot('01_kayran_kutu', { day: 1, phase: 'day', place: () => ({ x: w.cx - 7.5, y: w.cy - 6.5, a: Math.atan2(2 + 6.5 + 6.5, 2 - (w.cx - 7.5) + 7.5) }) });
shot('02_kayran_genel', { place: () => ({ x: w.cx + 6.5, y: w.cy + 6.5, a: -Math.PI * 0.75 }) });
shot('03_gecit_dis', { place: () => ({ x: w.cx + MV.K.R1 + 4, y: w.cy + 0.5, a: Math.PI }) });
shot('04_gecit_ic', { place: () => ({ x: w.cx + MV.K.R1 - 3, y: w.cy + 0.5, a: 0 }) });
shot('05_labirent', { place: () => ({ x: w.cx - 40, y: w.cy - 34, a: 2.2 }) });
shot('06_labirent2', { place: () => ({ x: w.cx + 33, y: w.cy + 21, a: -0.6 }) });
/* rune taşına bak */
const rn = w.runes[0];
shot('07_rune', {
  place: () => {
    // rune'un açık komşusundan bak
    for (const d of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = rn.x + d[0], ny = rn.y + d[1];
      const i = ny * w.W + nx;
      if (!w.solid[i] && !w.void[i]) {
        return { x: nx + .5, y: ny + .5, a: Math.atan2(rn.y + .5 - (ny + .5), rn.x + .5 - (nx + .5)) };
      }
    }
    return { x: rn.x + 1.5, y: rn.y + .5, a: Math.PI };
  }
});
shot('08_gece_dis', { phase: 'night', place: () => ({ x: w.cx - 40, y: w.cy - 34, a: 2.2 }), torch: true });
shot('09_gece_kayran', { phase: 'night', place: () => ({ x: w.cx + 6, y: w.cy + 6, a: -Math.PI * 0.75 }) });
shot('10_ucurum', { place: () => ({ x: w.cx - 58, y: w.cy + 2, a: Math.PI }) });
shot('11_kovan', { place: () => ({ x: w.hive.x + 5.5, y: w.hive.y + 2.5, a: Math.atan2(-2.5, -5.5) }) });
shot('12_cikis', { place: () => ({ x: w.hatch.x + 4.5, y: w.hatch.y + 1.5, a: Math.atan2(-1.5, -4.5) }) });
/* Grievers'i görüş alanına koy */
shot('13_griever', {
  place: () => {
    const P = G.player;
    const g = G.grievers[0];
    const p = MV.Maze.nearestOpen(w, g.x - 3.5, g.y, 8, true);
    P.x = p.x; P.y = p.y; P.a = Math.atan2(g.y - p.y, g.x - p.x);
    g.x = p.x + Math.cos(P.a) * 3.2; g.y = p.y + Math.sin(P.a) * 3.2;
    return { x: p.x, y: p.y, a: P.a };
  }
});
/* Böcek Bıçağı */
shot('14_bocek', {
  place: () => {
    const P = G.player;
    const b = G.beetles[0];
    const p = MV.Maze.nearestOpen(w, b.x - 2.5, b.y, 8, true);
    b.x = p.x + Math.cos(0) * 2.6; b.y = p.y;
    b.state = 'scan';
    return { x: p.x, y: p.y, a: 0 };
  }
});
shot('15_safak_kayran', { day: 3, phase: 'day', place: () => ({ x: w.cx - 5, y: w.cy + 8, a: -1.2 }) });
console.log('bitti → tools/out/');
