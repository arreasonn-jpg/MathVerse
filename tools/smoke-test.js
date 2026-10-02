/* ============================================================
   tools/smoke-test.js — uçtan uca oyun testi
   Sahte DOM ile: 4000+ kare koşu, tüm arayüz ekranları, kayıt/yükleme,
   kaçış sinematiği. Tarayıcı kipinde ve masaüstü kipinde çalışır.
   ============================================================ */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { setup } = require('./domstub');

/* determinist koşu */
(function () {
  let a = 0x2F6E2B1;
  Math.random = function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
})();

const MODE = process.argv.indexOf('--desktop') >= 0 ? 'desktop' : 'browser';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'labirent-test-'));
const ctx = setup(MODE === 'desktop' ? { desktop: tmp } : {});
const MV = ctx.MV, G = MV.Game, UI = MV.UI;
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

console.log('=== KİP: ' + MODE + ' ===');
console.log('--- KURULUM ---');
const t0 = Date.now();
UI.init(G);
G.init(ctx.byId('view'));
console.log('kurulum süresi: ' + (Date.now() - t0) + ' ms');
assert(!!G.world && G.world.runes.length === 8, 'dünya üretildi, 8 rune var');
assert(G.player.hp === 100, 'oyuncu canı 100');
assert(MV.Desktop.isDesktop === (MODE === 'desktop'), 'masaüstü köprüsü: ' + MV.Desktop.isDesktop);

console.log('--- 600 kare yürüyüş (7 sn) ---');
G.keys.KeyW = true;
step(600, 1 / 60);
G.keys.KeyW = false;
assert(G.player.hp > 0, 'yaşıyor: hp=' + Math.round(G.player.hp));

console.log('--- 8 rune okuma ---');
const w = G.world;
for (const rn of w.runes) {
  G.player.x = rn.x + 0.5 + (rn.x < w.cx ? 1.2 : -1.2);
  G.player.y = rn.y + 0.5;
  G.player.a = Math.atan2(rn.y + .5 - G.player.y, rn.x + .5 - G.player.x);
  const ok = G.tryReadRune();
  if (!ok && G.runesRead.indexOf(rn.idx) < 0) {
    for (const d of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      G.player.x = rn.x + 0.5 + d[0]; G.player.y = rn.y + 0.5 + d[1];
      G.player.a = Math.atan2(-d[1], -d[0]);
      if (G.tryReadRune()) break;
    }
  }
}
assert(G.runesRead.length === 8, 'rune verisi 8/8');
assert(G.objective === 'key', 'görev "kovan anahtarı" oldu');

console.log('--- üretim ve ayarlar ---');
G.resources.lif = 10; G.resources.celik = 10; G.resources.recine = 6; G.resources.pil = 4;
assert(G.craft('halat') && G.tools.halat === 1, 'halat üretildi');
assert(G.craft('mizrak') && G.tools.mizrak === 1, 'mızrak üretildi');
assert(G.craft('fener') && G.tools.fener === 1, 'fener üretildi');
G.applySetting('quality', 'performans');
assert(MV.Renderer.quality === 'performans', 'kalite ayarı motora uygulandı (' + MV.Renderer.quality + ')');
G.applySetting('fov', 1.3);
assert(Math.abs(MV.Renderer.fovMul - 1.3) < 1e-6, 'FOV ayarı uygulandı');
G.applySetting('sensitivity', 1.8);
assert(Math.abs(G.sensitivity - 1.8) < 1e-6, 'fare hassasiyeti uygulandı');
stopPause();
function stopPause() { G.paused = false; }

console.log('--- döngü: gece/gündüz/geçit ---');
G.clock = 6; step(500, 1 / 60);
assert(G.phase === 'night', 'geceye geçildi');
assert(G.gatesOpen() === false, 'geçitler kapalı');
G.clock = 0.4; step(200, 1 / 60);
assert(G.day === 2 && G.phase === 'day', 'yeni gün: gün ' + G.day);
assert(G.gatesOpen() === true, 'geçitler açık');

console.log('--- kovan ve anahtar ---');
G.player.x = w.hive.x; G.player.y = w.hive.y;
G.updateProps(1 / 60);
assert(G.nearProp && G.nearProp.kind === 'hive', 'kovan menzilde');
G.hiveInteract(); G.descendHive();
const keyItems = G.items.filter(i => i.type === 'anahtar' && !i.taken);
G.player.x = keyItems[0].x; G.player.y = keyItems[0].y;
step(5, 1 / 60);
assert(G.hasKey === true, 'anahtar alındı');

console.log('--- uçurum ve ölüm/dönüş ---');
let vx = -1, vy = -1;
for (let y = 0; y < w.H && vx < 0; y++) for (let x = 0; x < w.W; x++) if (w.void[y * w.W + x]) { vx = x; vy = y; break; }
G.lastSafe.x = w.cx + 2; G.lastSafe.y = w.cy + 2;
G.player.x = vx + .5; G.player.y = vy + .5;
const hpBefore = G.player.hp;
step(120, 1 / 60);
assert(Math.abs(G.player.x - (w.cx + 2)) < 2.5, 'son güvenli noktaya döndü');
assert(G.player.hp < hpBefore, 'düşme hasarı işlendi');
G.damage(500, 'griever');
assert(G.dead === true, 'ölüm işlendi');
G.respawn();
assert(G.dead === false && G.player.hp > 0, 'Kayran’da uyandı');

console.log('--- kumanda: menü komutları ---');
G.takeScreenshot();
G.handleMenuCommand('quality');
assert(true, 'menü komutu (kalite) hatasız');
G.paused = false; UI.closeModal();

console.log('--- duraklat → kaydet → yükle ---');
const dayBefore = G.day;
G.paused = true;
G.saveTo(1);
assert(!!MV.Desktop.save.read(1), 'slot 1 dosyası yazıldı');
const slotInfo = MV.Desktop.save.list()[1];
assert(!slotInfo.empty && slotInfo.day === dayBefore, 'slot listesi kaydı görüyor (gün ' + slotInfo.day + ')');
G.day = 1; G.runesRead = [];
G.loadFrom(1);
assert(G.day === dayBefore && G.runesRead.length === 8, 'kayıt yüklendi: gün ' + G.day + ', veri ' + G.runesRead.length);
G.paused = false;

console.log('--- kod ve kaçış ---');
assert(G.tryCode('31415926') === true, 'π kodu doğru');
assert(G.tryCode('11111111') === false, 'yanlış kod reddedildi');
G.player.x = w.hatch.x; G.player.y = w.hatch.y;
G.openHatch();
assert(!!G.cinematic, 'kaçış sinematiği başladı');
G.won = false;
step(260, 1 / 60);
assert(G.won === true, 'sinematik sonunda kazanma ekranı açıldı');
assert(MV.Desktop.save.read(0) === null, 'kazanınca otomatik kayıt temizlendi');
UI.closeModal();

console.log('--- kayıt/yükleme (otomatik) ---');
G.dead = false; G.won = false;
G.save(0);
assert(!!MV.Desktop.save.read(0), 'otomatik kayıt yazıldı');
G.loadFrom(0);
step(60, 1 / 60);
assert(G.player.hp > 0 && !!G.world, 'otomatik kayıttan devam edildi');

console.log('--- uzun simülasyon (AI baskısı) ---');
for (let i = 0; i < 8; i++) { G.clock = 1.2; step(20, 1 / 60); G.clock = 1.2; step(20, 1 / 60); }
step(900, 1 / 60, (i) => {
  G.keys.KeyW = (i % 200) < 120;
  G.keys.KeyA = (i % 340) < 60;
  G.mouse.dx = ((i % 7) - 3) * 8;
});
assert(true, 'uzun simülasyon hatasız: gün ' + G.day + ', hp ' + Math.round(G.player.hp));

console.log('--- yaşam alanı güvenliği (Kayran\'da yaratık olmaz) ---');
{
  /* Kullanıcı isteği: canavarlar yalnızca labirentte. En zorlu koşul:
     gece, oyuncu labirentte, geçitler kapalı → yaratıklar serbest. */
  const K = MV.K, W = G.world;
  const st = {
    world: W, player: G.player, night: true, gatesOpen: false,
    grievers: G.grievers, beetles: G.beetles, items: G.items,
    addItem() { }, onBeetleSteal() { }, onGrieverAttack() { }, sound() { }, fx() { }, day: G.day
  };
  const spot = MV.Maze.nearestOpen(W, W.cx + K.R1 + 9, W.cy, 10, true);
  G.player.x = spot.x; G.player.y = spot.y;
  let worst = 1e9, violations = 0, checked = 0;
  for (let cycle = 0; cycle < 8; cycle++) {
    st.day = 1 + cycle; st.night = cycle % 2 === 1;
    for (let i = 0; i < 90; i++) MV.AI.update(st, 1 / 60);
    for (const list of [G.grievers, G.beetles]) {
      for (const e of list) {
        const r = Math.hypot(e.x - W.cx, e.y - W.cy);
        checked++; if (r < worst) worst = r;
        if (r < K.R1) violations++;
      }
    }
  }
  assert(violations === 0, 'Kayran içinde yaratık yok (' + checked + ' kontrol, en yakın ' + worst.toFixed(2) + ' / R1=' + K.R1 + ')');
  assert(worst > K.R1, 'en yakın yaratık Kayran sınırının dışında');
}

console.log('--- tuş atama (rebind) turu ---');
{
  const In = MV.Input;
  const before = In.keyLabel(In.map['forward'][0]);
  In.setBinding('forward', 'KeyI');
  assert(In.map['forward'][0] === 'KeyI', 'yeni tuş atandı (I)');
  const ser = In.serialize();
  assert(ser['forward'] && ser['forward'][0] === 'KeyI', 'serialize yalnızca değişeni yazıyor');
  const saved = MV.Desktop.settings.read();
  saved.keymap = ser;
  MV.Desktop.settings.write(saved);
  const re = MV.Desktop.settings.read();
  In.init(re);
  MV.Desktop.apply(re);
  assert(In.map['forward'][0] === 'KeyI', 'kaydedilip geri yüklendi: ' + In.keyLabel(In.map['forward'][0]));
  assert(In.actionFor('KeyI') === 'forward', 'yeni tuş eyleme bağlandı (' + In.actionFor('KeyI') + ')');
  /* kayıtlı atamayı temizle → varsayılana dönüş */
  const cleared = MV.Desktop.settings.read();
  cleared.keymap = {};
  MV.Desktop.settings.write(cleared);
  In.init(cleared); MV.Desktop.apply(cleared);
  assert(In.map['forward'][0] === 'KeyW', 'varsayılana dönüş (şimdi ' + In.keyLabel(In.map['forward'][0]) + ', ilk tuş: ' + before + ')');
  assert(In.actionFor('KeyI') === null, 'eski atama temizlendi');
}

console.log('--- başarım ölçümü (performans kalitesi) ---');
{
  MV.Renderer.setQuality('performans');
  MV.Renderer.setScale(1);
  const t = Date.now();
  for (let i = 0; i < 40; i++) { G.update(1 / 60); G.render(1 / 60); }
  const per = (Date.now() - t) / 40;
  console.log('  → performans kalitesi: ' + per.toFixed(1) + ' ms/kare (' + MV.Renderer.W + 'x' + MV.Renderer.H + ')');
  assert(per < 60, 'kare süresi kabul sınırında (' + per.toFixed(1) + ' ms)');
  MV.Renderer.setQuality('orta');
}

console.log('--- tüm arayüz ekranları ---');
const screens = [
  ['başlık', () => UI.showTitle()],
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
  ['kayıt: kaydet', () => UI.openSaveSlots('save')],
  ['kayıt: yükle', () => UI.openSaveSlots('load')],
  ['ayarlar', () => UI.openSettings(true)],
  ['yeni deney onayı', () => UI.confirmNew()],
  ['ölüm', () => UI.death('griever')],
  ['kazanma', () => UI.win()],
  ['başarımlar', () => UI.openAchievements('back')],
  ['mesaj', () => UI.msg('TEST', 'deneme')],
  ['altyazı', () => UI.subtitle('test')],
  ['HUD ölçeği', () => UI.setHudScale(1.15)],
  ['FPS göstergesi', () => UI.setFpsVisible(true)],
  ['ekran görüntüsü katmanları', () => { UI.hideOverlaysForShot(); UI.showOverlaysAfterShot(); }]
];
for (const [name, fn] of screens) {
  try { fn(); } catch (e) { errors.push(name + ': ' + e.message); console.log('  ✗ ' + name + ': ' + e.message); continue; }
  console.log('  ✓ ' + name);
}
UI.closeModal();
step(30, 1 / 60);

console.log('--- başarımlar ---');
{
  const total = G.achievementTotal();
  assert(total >= 10, 'başarım tanımı yüklendi (' + total + ' adet)');
  MV.Desktop.achievements.write('{}');
  G.loadAchievements();
  assert(G.achievementCount() === 0, 'profil sıfırdan başladı');
  G.day = 3; G.meta.kills = 5; G.meta.crafted = 2;
  G.tools = { fener: 1, izleyici: 1, mizrak: 1, halat: 1 };
  G.flags.boxRead = true; G.flags.hiveDone = true; G.runesRead = [0, 1, 2, 3, 4, 5, 6, 7];
  const got = G.checkAchievements();
  assert(got >= 10, 'koşullar sağlanınca başarımlar açıldı (' + got + '/' + total + ')');
  const stored = MV.Desktop.achievements.list();
  assert(stored['ilk-kan'] > 0 && stored['tam-takim'] > 0, 'başarımlar profile yazıldı');
  assert(!stored['kacis'], 'henüz kaçılmadığı için KAÇIŞ kilitli kaldı');
  const snap = MV.Desktop.achievements.read();
  G.checkAchievements();
  assert(MV.Desktop.achievements.read() === snap, 'aynı başarım ikinci kez yazılmaz');
  assert(G.unlockAchievement('ilk-kan') === false, 'açılmış başarım tekrar açılamaz');
  assert(G.unlockAchievement('olmayan-basarim') === false, 'tanımsız başarım yok sayıldı');
  G.won = true;
  G.checkAchievements();
  assert(MV.Desktop.achievements.list()['kacis'] > 0, 'kaçış başarımı kazanınca açıldı');
  G.won = false;
  UI.openAchievements('title');
  assert(UI.modalOpen(), 'başarım ekranı açıldı');
  UI.closeModal();
}

console.log('--- oyun kolu ---');
G.paused = false;
G.player.x = w.spawn.x; G.player.y = w.spawn.y; G.player.a = 0;
G.player.hp = G.player.maxHp; G.dead = false; G.won = false; UI.closeModal();
{
  const x0 = G.player.x, y0 = G.player.y;
  ctx.setGamepad({ axes: [0, -1, 0, 0] });
  step(60, 1 / 60);
  const moved = Math.hypot(G.player.x - x0, G.player.y - y0);
  assert(moved > 0.4, 'sol çubuk yürütüyor (hareket: ' + moved.toFixed(2) + ')');
  assert(G.inputMode === 'kol', 'girdi kipi kola geçti');

  const a0 = G.player.a;
  G.player.a = a0;
  ctx.setGamepad({ axes: [0, 0, 1, 0] });
  step(30, 1 / 60);
  assert(Math.abs(G.player.a - a0) > 0.2, 'sağ çubuk bakışı döndürüyor');
  ctx.setGamepad({ axes: [0, 0, 0, 0] });

  const tool0 = G.tool;
  ctx.setGamepad({ axes: [0, 0, 0, 0], buttons: [] });
  G.pollGamepad(1 / 60);
  ctx.setGamepad({ axes: [0, 0, 0, 0], buttons: [false, false, false, false, false, true] }); // RB
  G.pollGamepad(1 / 60);
  assert(G.tool !== tool0, 'RB aracı değiştirdi (' + tool0 + ' → ' + G.tool + ')');

  ctx.setGamepad({ axes: [0, 0, 0, 0], buttons: [] });
  G.pollGamepad(1 / 60);
  ctx.setGamepad({ axes: [0, 0, 0, 0], buttons: [false, false, false, false, false, false, false, false, true] }); // Back
  G.pollGamepad(1 / 60);
  assert(MV.UI.mapOpen === true && UI.modalOpen(), 'Back düğmesi haritayı açtı');
  UI.mapOpen = false; UI.closeModal();

  ctx.setGamepad({ axes: [0, 0, 0, 0], buttons: [] });
  G.pollGamepad(1 / 60);
  ctx.setGamepad({ axes: [0, 0, 0, 0], buttons: [false, false, false, false, false, false, false, false, false, true] }); // Start
  G.pollGamepad(1 / 60);
  assert(G.paused === true && UI.modalOpen(), 'Start duraklatma menüsünü açtı');
  G.paused = false; UI.closeModal();

  ctx.setGamepad(null);
  G.pollGamepad(1 / 60);
  assert(G.pad === null, 'kol çıkarıldığında durum temizlendi');
}

/* --- masaüstüne özgü asenkron akışlar (zamanlayıcı gerektirir) --- */
(async function finish() {
  if (MODE === 'desktop') {
    const d = ctx.desktopAPI;
    G.takeScreenshot();
    await new Promise(r => setTimeout(r, 350));
    assert(d.calls.screenshot > 0, 'masaüstü: ekran görüntüsü API çağrıldı ve dosya yolu bildirildi');
    d.emit('window:blur');
    assert(G.paused === true || UI.modalOpen(), 'odak kaybında oyun duraklatıldı');
    G.paused = false; UI.closeModal();
    d.emit('menu', 'quality');
    const q = MV.Desktop.settings.read().quality;
    assert(!!q, 'yerel menü komutu ayarı değiştirdi: ' + q);
    d.emit('menu', 'save-and-quit');
    await new Promise(r => setTimeout(r, 60));
    assert(!!MV.Desktop.save.read(0), 'çıkıştan önce otomatik kayıt alındı');
    d.emit('window:resize');
  }
  if (errors.length) { console.log('\nHATA LİSTESİ:'); errors.forEach(e => console.log(' - ' + e)); }
  console.log('\n' + (errors.length ? 'HATALAR: ' + errors.length : 'TÜM TESTLER GEÇTİ'));
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { }
  process.exit(errors.length ? 1 : 0);
})();
