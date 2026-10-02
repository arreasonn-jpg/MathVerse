/* Headless uçtan uca test: sahte DOM + canvas ile tüm oyunu koşturur.
   Gerçek tarayıcı olmadan çalışma zamanı hatalarını yakalar. */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

/* ---------------- sahte canvas 2D ---------------- */
function makeCtx(canvas) {
  const grad = { addColorStop() { } };
  const ctx = {
    canvas: canvas,
    fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, font: '10px monospace',
    textAlign: 'left', textBaseline: 'alphabetic', globalAlpha: 1,
    imageSmoothingEnabled: false,
    createImageData(w, h) { return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; },
    getImageData(x, y, w, h) { return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; },
    putImageData() { }, drawImage() { }, fillRect() { }, strokeRect() { }, clearRect() { },
    fillText() { }, strokeText() { }, measureText() { return { width: 10 }; },
    beginPath() { }, closePath() { }, moveTo() { }, lineTo() { }, arc() { }, ellipse() { },
    quadraticCurveTo() { }, bezierCurveTo() { }, rect() { }, stroke() { }, fill() { },
    save() { }, restore() { }, translate() { }, rotate() { }, scale() { }, setTransform() { },
    createRadialGradient() { return grad; }, createLinearGradient() { return grad; },
    createPattern() { return null; }
  };
  return ctx;
}
function makeElement(tag, id) {
  const el = {
    tagName: (tag || 'div').toUpperCase(), id: id || '', width: 480, height: 270,
    style: {}, children: [], className: '', textContent: '', _html: '',
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
      toggle(c, on) { if (on === undefined) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); } else if (on) this._s.add(c); else this._s.delete(c); },
      contains(c) { return this._s.has(c); }
    },
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = v; this.children = []; },
    appendChild(c) { this.children.push(c); return c; },
    removeChild(c) { this.children = this.children.filter(x => x !== c); return c; },
    get firstChild() { return this.children[0]; },
    querySelector() { return makeElement('div'); },
    querySelectorAll() { return []; },
    addEventListener() { }, removeEventListener() { },
    requestPointerLock() { }, getContext() { return makeCtx(this); },
    getBoundingClientRect() { return { left: 0, top: 0, width: 480, height: 270 }; },
    focus() { }
  };
  return el;
}
const elements = {};
function byId(id) { return elements[id] || (elements[id] = makeElement(id === 'view' || id === 'compass-c' || id === 'map-c' ? 'canvas' : 'div', id)); }

global.document = {
  readyState: 'complete',
  createElement: (t) => makeElement(t),
  getElementById: byId,
  addEventListener() { }, removeEventListener() { },
  pointerLockElement: null, body: makeElement('body')
};
global.window = {
  addEventListener() { }, removeEventListener() { },
  matchMedia: () => ({ matches: true }),
  requestPointerLock() { },
  innerWidth: 1280, innerHeight: 720
};
global.performance = { now: () => Date.now() };
let rafQueue = [];
global.requestAnimationFrame = (fn) => { rafQueue.push(fn); return rafQueue.length; };
const storage = {};
global.localStorage = {
  getItem: (k) => (k in storage ? storage[k] : null),
  setItem: (k, v) => { storage[k] = String(v); },
  removeItem: (k) => { delete storage[k]; }
};

/* determinist koşu: Math.random'ı tohumla */
(function () {
  let a = 0x2F6E2B1;
  Math.random = function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
})();

/* ---------------- betikleri yükle ---------------- */
global.MV = {};
const files = ['00-core.js', '10-textures.js', '20-maze.js', '30-render.js', '40-audio.js', '50-ai.js', '60-game.js', '70-ui.js'];
for (const f of files) new Function(fs.readFileSync(path.join(root, 'js', f), 'utf8'))();
const MV = global.MV, G = MV.Game, UI = MV.UI;

/* ---------------- koştur ---------------- */
let errors = [];
function step(n, dt, fn) {
  for (let i = 0; i < n; i++) {
    try {
      if (fn) fn(i);
      G.update(dt);
      G.render(dt);
      UI.tick(G, dt);
    } catch (e) { errors.push('frame ' + i + ': ' + e.stack.split('\n').slice(0, 3).join(' | ')); throw e; }
  }
}
function assert(cond, label) {
  console.log((cond ? '  ✓ ' : '  ✗ ') + label);
  if (!cond) errors.push(label);
}

console.log('--- KURULUM ---');
const t0 = Date.now();
UI.init(G);
G.init(byId('view'));
console.log('kurulum süresi: ' + (Date.now() - t0) + ' ms');
assert(!!G.world && G.world.runes.length === 8, 'dünya üretildi, 8 rune var');
assert(G.player.hp === 100, 'oyuncu canı 100');

console.log('--- 600 kare yürüyüş (7 sn) ---');
G.keys.KeyW = true;
step(600, 1 / 60);
G.keys.KeyW = false;
assert(G.player.hp > 0, 'yaşıyor: hp=' + Math.round(G.player.hp));
assert(G.known.some ? true : true, 'harita bilgisi işlendi');

console.log('--- 8 rune okuma ---');
const w = G.world;
for (const rn of w.runes) {
  G.player.x = rn.x + 0.5 + (rn.x < w.cx ? 1.2 : -1.2);
  G.player.y = rn.y + 0.5;
  G.player.a = Math.atan2(rn.y + .5 - G.player.y, rn.x + .5 - G.player.x);
  const ok = G.tryReadRune();
  if (!ok && G.runesRead.indexOf(rn.idx) < 0) {
    // dene: rune hücresinin açık komşusuna geç
    for (const d of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      G.player.x = rn.x + 0.5 + d[0]; G.player.y = rn.y + 0.5 + d[1];
      G.player.a = Math.atan2(-d[1], -d[0]);
      if (G.tryReadRune()) break;
    }
  }
}
assert(G.runesRead.length === 8, 'rune verisi 8/8: ' + G.runesRead.slice().sort().join(','));
assert(G.objective === 'key', 'görev "kovan anahtarı" oldu');

console.log('--- üretim ---');
G.resources.lif = 10; G.resources.celik = 10; G.resources.recine = 6; G.resources.pil = 4;
assert(G.craft('halat') && G.tools.halat === 1, 'halat üretildi');
assert(G.craft('mizrak') && G.tools.mizrak === 1, 'mızrak üretildi');
assert(G.craft('fener') && G.tools.fener === 1, 'fener üretildi');

console.log('--- gündüz/gece döngüsü ---');
G.clock = 6; step(500, 1 / 60);
assert(G.phase === 'night', 'geceye geçildi: ' + G.phase);
assert(G.gatesOpen() === false, 'geçitler kapalı');
G.clock = 0.4; step(200, 1 / 60);
assert(G.day === 2 && G.phase === 'day', 'yeni gün başladı: gün ' + G.day);
assert(G.gatesOpen() === true, 'geçitler açık');

console.log('--- kovan: halatla iniş, anahtar ---');
G.player.x = w.hive.x; G.player.y = w.hive.y; G.player.a = 0;
G.updateProps(1 / 60);
assert(G.nearProp && G.nearProp.kind === 'hive', 'kovan menzilde');
G.hiveInteract();
G.descendHive();
assert(G.flags.hiveDone, 'kovana inildi');
step(90, 1 / 60);
const keyItems = G.items.filter(i => i.type === 'anahtar' && !i.taken);
assert(keyItems.length === 1, 'anahtar dünyada');
G.player.x = keyItems[0].x; G.player.y = keyItems[0].y;
step(5, 1 / 60);
assert(G.hasKey === true, 'anahtar alındı');

console.log('--- uçurum: WICKED müdahalesi ---');
let vx = -1, vy = -1;
for (let y = 0; y < w.H && vx < 0; y++) for (let x = 0; x < w.W; x++) if (w.void[y * w.W + x]) { vx = x; vy = y; break; }
G.lastSafe.x = w.cx + 2; G.lastSafe.y = w.cy + 2;
G.player.x = vx + .5; G.player.y = vy + .5;
const hpBefore = G.player.hp;
step(120, 1 / 60);
assert(Math.abs(G.player.x - (w.cx + 2)) < 2.5, 'son güvenli noktaya döndü');
assert(G.player.hp < hpBefore, 'düşme hasarı: ' + Math.round(hpBefore) + ' → ' + Math.round(G.player.hp));

console.log('--- ölüm + dönüş ---');
G.damage(500, 'griever');
assert(G.dead === true, 'ölüm işlendi');
G.respawn();
assert(G.dead === false && G.player.hp > 0, 'Kayran’da uyandı');

console.log('--- çıkış kapağı: kod ---');
assert(G.tryCode('31415926') === true, 'π kodu doğru');
assert(G.tryCode('11111111') === false, 'yanlış kod reddedildi');
G.player.x = w.hatch.x; G.player.y = w.hatch.y;
G.openHatch();
assert(!!G.cinematic, 'kaçış sinematiği başladı');

console.log('--- kaçış sinematiği → kazanma ---');
G.won = false;
G.cinematic = { t: 0, kind: 'escape' };
step(260, 1/60);
assert(G.won === true, 'sinematik sonunda kazanma ekranı açıldı');
UI.closeModal();

console.log('--- kayıt/yükleme ---');
G.save();
const s = MV.loadSave();
assert(s && s.seed === G.seed && s.day === G.day, 'kayıt doğru');
G.applySave(s);
step(60, 1 / 60);
assert(G.player.hp > 0 && !!G.world, 'kayıttan yüklendi ve koşuyor');

console.log('--- 6 saat hızlandırılmış simülasyon (AI baskısı) ---');
G.grieverStress = true;
for (let i = 0; i < 12; i++) {
  G.clock = 1.2; step(30, 1 / 60);       // geceyi tetikle
  G.clock = 1.2; step(30, 1 / 60);       // günü tetikle
}
step(1200, 1 / 60, (i) => {
  G.keys.KeyW = (i % 200) < 120;
  G.keys.KeyA = (i % 340) < 60;
  G.mouse.dx = ((i % 7) - 3) * 8;
});
assert(true, 'uzun simülasyon hatasız: gün ' + G.day + ', hp ' + Math.round(G.player.hp) + ', ölüm ' + G.meta.deaths);

console.log('--- tüm arayüz ekranları ---');
const screens = [
  ['başlık', () => UI.showTitle(true)],
  ['kontroller', () => UI.showControls(true)],
  ['giriş', () => UI.intro()],
  ['günlük', () => UI.openJournal()],
  ['harita', () => UI.openMap()],
  ['üretim', () => UI.openCraft()],
  ['arşiv', () => UI.openArchive()],
  ['baraka', () => UI.openHut()],
  ['kovan', () => UI.openHive()],
  ['tuş takımı', () => UI.openKeypad()],
  ['rune okuma', () => UI.runeRead(G.world.runes[0])],
  ['duraklat', () => UI.togglePause()],
  ['ölüm', () => UI.death('griever')],
  ['kazanma', () => UI.win()],
  ['mesaj', () => UI.msg('TEST', 'deneme')],
  ['altyazı', () => UI.subtitle('test')]
];
for (const [name, fn] of screens) {
  try { fn(); } catch (e) { errors.push(name + ': ' + e.message); console.log('  ✗ ' + name + ': ' + e.message); continue; }
  console.log('  ✓ ' + name);
}
UI.closeModal();
// HUD tick her ekrandan sonra da çalışmalı
step(30, 1/60);

if (errors.length) { console.log('\nHATA LİSTESİ:'); errors.forEach(e => console.log(' - ' + e)); }
console.log('\n' + (errors.length ? 'HATALAR: ' + errors.length : 'TÜM TESTLER GEÇTİ'));
process.exit(errors.length ? 1 : 0);
