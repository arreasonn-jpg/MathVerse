/* Headless labirent testi: üretim, bağlantısallık, rune/çıkış erişimi */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
global.MV = {};
new Function(fs.readFileSync(path.join(root, 'app/js/00-core.js'), 'utf8'))();
const MV = global.MV;
new Function(fs.readFileSync(path.join(root, 'app/js/20-maze.js'), 'utf8'))();

function bfs(w, sx, sy, gatesOpen, allowVoid) {
  const seen = new Uint8Array(w.W * w.H);
  const q = [Math.floor(sy) * w.W + Math.floor(sx)];
  seen[q[0]] = 1;
  let head = 0, count = 0;
  while (head < q.length) {
    const i = q[head++]; count++;
    const x = i % w.W, y = (i / w.W) | 0;
    for (const d of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + d[0], ny = y + d[1];
      if (nx < 0 || ny < 0 || nx >= w.W || ny >= w.H) continue;
      const ni = ny * w.W + nx;
      if (seen[ni]) continue;
      if (w.solid[ni] === 1) continue;
      if (w.void[ni] === 1 && !allowVoid) continue;
      if (w.gate[ni] === 1 && !gatesOpen) continue;
      seen[ni] = 1; q.push(ni);
    }
  }
  return { seen, count };
}

function stat(t, w, seen, label) {
  const i = Math.floor(t.y) * w.W + Math.floor(t.x);
  console.log('  ' + label + ' ', t.x + ',' + t.y, seen[i] ? 'ERİŞİLEBİLİR' : '!! ERİŞİLEMEZ');
  return seen[i] === 1;
}

function run(seed, day) {
  console.log('=== tohum ' + seed + ' gün ' + day + ' ===');
  const w = MV.Maze.genWorld(seed, day);
  console.log('runes:', w.runes.map(r => r.digit + '#' + (r.idx + 1) + '@' + Math.round(MV.Maze.rad(w, r.x, r.y))).join(' '));
  console.log('gates:', w.gates.length, 'channels:', w.channels.length, 'hatch:', JSON.stringify(w.hatch), 'hive:', JSON.stringify(w.hive));
  const r = bfs(w, w.spawn.x, w.spawn.y, true, false);
  console.log('  erişilebilir hücre (gündüz, geçitler açık):', r.count);
  let ok = true;
  // rune'ların komşusu erişilebilir mi?
  for (const rn of w.runes) {
    let any = false;
    for (const d of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const i = (rn.y + d[1]) * w.W + (rn.x + d[0]);
      if (r.seen[i]) any = true;
    }
    if (!any) { console.log('  !! rune erişilemez:', rn.x, rn.y, 'basamak', rn.digit); ok = false; }
  }
  ok = stat(w.hatch, w, r.seen, 'çıkış') && ok;
  ok = stat(w.hive, w, r.seen, 'kovan') && ok;
  // gece: geçitler kapalı → kayran içi halka
  const rn = bfs(w, w.spawn.x, w.spawn.y, false, false);
  console.log('  erişilebilir hücre (gece, kapalı):', rn.count);
  // uçurum aşılabilir mi? void olmadan
  const rnv = bfs(w, w.spawn.x, w.spawn.y, true, false);
  console.log('  uçurum engel mi:', rnv.seen[Math.floor(w.hive.y) * w.W + Math.floor(w.hive.x)] ? 'hayır (kanal var)' : 'evet');
  console.log('  ' + (ok ? 'OK' : 'HATA'));
  return ok;
}

/* Kaydırma testi: gece duvarlar değişir, dünya hâlâ gezilebilir olmalı */
function runShift(seed) {
  console.log('=== KAYDIRMA tohum ' + seed + ' ===');
  const w = MV.Maze.genWorld(seed, 1);
  const inside = MV.Maze.nearestOpen(w, w.spawn.x + 30, w.spawn.y + 30, 30, true);
  let ok = true;
  for (let day = 2; day <= 4; day++) {
    const changed = MV.Maze.shiftWorld(w, day, seed);
    const r = bfs(w, w.spawn.x, w.spawn.y, true, false);
    const p = MV.Maze.nearestOpen(w, inside.x, inside.y, 30, true);
    const okHatch = r.seen[Math.floor(w.hatch.y) * w.W + Math.floor(w.hatch.x)] === 1;
    const okHive = r.seen[Math.floor(w.hive.y) * w.W + Math.floor(w.hive.x)] === 1;
    let runeOk = w.runes.length === 8;
    for (const rn of w.runes) {
      let any = false;
      for (const d of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (r.seen[(rn.y + d[1]) * w.W + (rn.x + d[0])]) any = true;
      }
      if (!any) runeOk = false;
    }
    const size = MV.Maze.solidAt(w, p.x, p.y, true) ? 'SIKIŞTI' : 'serbest';
    console.log('  gün ' + day + ': değişen hücre ' + changed + ', erişim ' + r.count +
      ', çıkış ' + (okHatch ? 'ok' : 'YOK') + ', kovan ' + (okHive ? 'ok' : 'YOK') +
      ', rune ' + (runeOk ? w.runes.length + ' ok' : 'HATA') + ', oyuncu ' + size);
    ok = ok && okHatch && okHive && runeOk && size === 'serbest';
  }
  console.log('  ' + (ok ? 'OK' : 'HATA'));
  return ok;
}

let all = true;
for (const s of [1, 2, 3, 12345, 99999]) all = run(s, 1) && all;
all = runShift(4242) && all;

console.log(all ? '\nTÜM TESTLER GEÇTİ' : '\nHATALAR VAR');
process.exit(all ? 0 : 1);
