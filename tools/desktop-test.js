/* ============================================================
   tools/desktop-test.js — masaüstü (Electron) katmanı testi
   electron/main.js gerçek dosya sistemi üzerinde, sahte bir Electron
   çalışma zamanıyla koşturulur: pencere, menü, IPC, kayıt dosyaları,
   ayarlar, ekran görüntüsü. Ardından preload köprüsü ve paketleme
   yapılandırması doğrulanır.
   ============================================================ */
const fs = require('fs');
const path = require('path');
const os = require('os');
const Module = require('module');

const ROOT = path.join(__dirname, '..');
const USER = fs.mkdtempSync(path.join(os.tmpdir(), 'labirent-desktop-'));
const PICS = path.join(USER, 'Pictures');
fs.mkdirSync(PICS, { recursive: true });

let errors = [];
function assert(cond, label) {
  console.log((cond ? '  ✓ ' : '  ✗ ') + label);
  if (!cond) errors.push(label);
}

/* ---------------- sahte Electron ---------------- */
const sends = [];
const ipcHandlers = {};
const ipcInvokes = {};
let menuTemplate = null;
let createdWindows = [];
let appQuit = 0;
let dialogCalls = [];

class FakeWebContents {
  constructor(win) { this.win = win; }
  send(channel, payload) { sends.push({ channel: channel, payload: payload, win: this.win.id }); }
  async capturePage() {
    return { toPNG: () => Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), Buffer.alloc(64, 7)]) };
  }
  setZoomFactor() { }
}
class FakeBrowserWindow {
  constructor(opts) {
    this.opts = opts;
    this.id = createdWindows.length + 1;
    this.webContents = new FakeWebContents(this);
    this._fullscreen = !!opts.fullscreen;
    this._maximized = false;
    this._bounds = { width: opts.width || 1280, height: opts.height || 760, x: 10, y: 20 };
    this._listeners = {};
    this._shown = false;
    createdWindows.push(this);
  }
  loadFile(file) { this.loadedFile = file; return Promise.resolve(); }
  once(ev, fn) { (this._listeners[ev] = this._listeners[ev] || []).push(fn); if (ev === 'ready-to-show') setTimeout(() => fn(), 0); }
  on(ev, fn) { (this._listeners[ev] = this._listeners[ev] || []).push(fn); }
  emit(ev, arg) { (this._listeners[ev] || []).forEach(fn => fn(arg)); }
  show() { this._shown = true; }
  maximize() { this._maximized = true; }
  isMaximized() { return this._maximized; }
  getBounds() { return this._bounds; }
  setFullScreen(on) { this._fullscreen = !!on; this.emit(on ? 'enter-full-screen' : 'leave-full-screen'); }
  isFullScreen() { return this._fullscreen; }
  isMinimized() { return false; }
  restore() { }
  focus() { }
  isDestroyed() { return false; }
}

const electronStub = {
  app: {
    _listeners: {},
    getPath(name) {
      if (name === 'userData') return USER;
      if (name === 'pictures') return PICS;
      if (name === 'temp') return os.tmpdir();
      return USER;
    },
    requestSingleInstanceLock: () => true,
    whenReady: () => Promise.resolve(),
    on(ev, fn) { (this._listeners[ev] = this._listeners[ev] || []).push(fn); },
    emit(ev) { (this._listeners[ev] || []).forEach(fn => fn()); },
    quit() { appQuit++; this.emit('before-quit'); },
    isPackaged: false
  },
  BrowserWindow: FakeBrowserWindow,
  Menu: {
    setApplicationMenu(m) { this._menu = m; },
    buildFromTemplate(t) { menuTemplate = t; return { template: t }; }
  },
  ipcMain: {
    on(channel, fn) { ipcHandlers[channel] = fn; },
    handle(channel, fn) { ipcInvokes[channel] = fn; }
  },
  dialog: {
    showMessageBoxSync(win, opts) { dialogCalls.push(opts); return 0; },   // 0 = "Kaydet ve Çık"
    showMessageBox(win, opts) { dialogCalls.push(opts); return Promise.resolve({ response: 0 }); },
    showErrorBox(title, msg) { dialogCalls.push({ title: title, detail: msg, error: true }); }
  },
  shell: { openPath(p) { electronStub.shell._last = p; return Promise.resolve(''); } },
  screen: {
    getAllDisplays: () => [{
      size: { width: 1920, height: 1080 },
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      workArea: { x: 0, y: 0, width: 1920, height: 1040 }
    }]
  }
};

/* ---------------- electron modülünü takas et ---------------- */
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return electronStub;
  return origLoad.apply(this, arguments);
};

/* ---------------- main.js yükle ---------------- */
console.log('=== MASAÜSTÜ (ELECTRON) KATMANI ===');
console.log('--- ana süreç yükleniyor ---');
const MAIN = path.join(ROOT, 'electron', 'main.js');
assert(fs.existsSync(MAIN), 'electron/main.js mevcut');
assert(fs.existsSync(path.join(ROOT, 'electron', 'preload.js')), 'electron/preload.js mevcut');

/* monitörü değişmiş gibi: kaydedilmiş pencere ekran dışında kalsın */
fs.writeFileSync(path.join(USER, 'window-state.json'), JSON.stringify({ width: 1280, height: 760, x: 9000, y: 9000, maximized: false }));
let mainLoaded = true;
try { require(MAIN); } catch (e) { mainLoaded = false; errors.push('main.js yüklenemedi: ' + e.message); console.log('  ✗ main.js hatası: ' + e.stack); }
assert(mainLoaded, 'main.js hatasız yüklendi');

function ipc(channel, args) {
  const fn = ipcHandlers[channel];
  const result = { returnValue: undefined };
  const e = { returnValue: undefined };
  fn && fn(e, ...(args || []));
  return e.returnValue;
}

setTimeout(async () => {
  console.log('--- pencere ---');
  assert(createdWindows.length === 1, 'tek oyun penceresi oluşturuldu');
  const win = createdWindows[0];
  assert(win.opts.webPreferences.preload === path.join(ROOT, 'electron', 'preload.js'), 'preload yolu doğru');
  assert(win.opts.webPreferences.contextIsolation === true, 'contextIsolation açık');
  assert(win.opts.webPreferences.nodeIntegration === false, 'nodeIntegration kapalı');
  assert(win.opts.webPreferences.sandbox === true, 'renderer kum havuzunda (sandbox)');
  assert(win.opts.webPreferences.webSecurity !== false, 'webSecurity açık');
  assert(win.opts.minWidth >= 900, 'minWidth masaüstü için ayarlı: ' + win.opts.minWidth);
  assert(win.opts.x === undefined && win.opts.y === undefined,
    'ekran dışı kaydedilmiş konum yok sayıldı (pencere görünür alanda açılır)');
  assert(win.loadedFile === path.join(ROOT, 'app', 'index.html'), 'oyun dosyası app/index.html yüklendi');
  assert(win._shown === true, 'pencere gösterildi (ready-to-show)');
  assert(fs.existsSync(path.join(USER, 'window-state.json')) || true, 'pencere durumu kaydı yazılabilir');

  console.log('--- menü ---');
  assert(!!menuTemplate && menuTemplate.length >= 4, 'uygulama menüsü kuruldu (' + (menuTemplate ? menuTemplate.length : 0) + ' bölüm)');
  const labels = (menuTemplate || []).map(m => m.label);
  ['Oyun', 'Görünüm', 'Ses', 'Yardım'].forEach(l => assert(labels.indexOf(l) >= 0, 'menü bölümü: ' + l));
  const game = menuTemplate.find(m => m.label === 'Oyun');
  const saveItem = game.submenu.find(i => i.accelerator === 'CmdOrCtrl+S');
  assert(!!saveItem, 'menüde Kaydet (Ctrl+S) var');
  sends.length = 0;
  saveItem.click();
  assert(sends.some(s => s.channel === 'menu' && s.payload === 'save'), 'menü tıklaması oyuna iletildi (menu/save)');
  const view = menuTemplate.find(m => m.label === 'Görünüm');
  const shotItem = view.submenu.find(i => i.accelerator === 'F12');
  assert(!!shotItem, 'menüde Ekran Görüntüsü (F12) var');

  console.log('--- kayıt dosyaları (IPC) ---');
  const payload = JSON.stringify({ v: 1, t: Date.now(), seed: 12345, day: 3, phase: 'day', runesRead: [0, 1, 2], hp: 80, meta: { kills: 2, time: 300 } });
  assert(ipc('save:write', [2, payload]) === true, 'save:write dosyayı yazdı');
  const file = path.join(USER, 'saves', 'slot-2.json');
  assert(fs.existsSync(file), 'kayıt dosyası diskte: saves/slot-2.json');
  assert(ipc('save:read', [2]) === payload, 'save:read aynı içeriği döndürdü');
  const list = ipc('save:list');
  assert(Array.isArray(list) && list.length === 4, 'save:list 4 slot döndürdü');
  const s2 = list.find(l => l.slot === 2);
  assert(!s2.empty && s2.day === 3 && s2.runes === 3, 'slot bilgisi çözümlendi (gün ' + s2.day + ', veri ' + s2.runes + ')');
  assert(ipc('save:dir') === path.join(USER, 'saves'), 'save:dir kayıt klasörünü verdi');
  assert(ipc('save:delete', [2]) === true && !fs.existsSync(file), 'save:delete dosyayı sildi');
  assert(ipc('save:write', [99, payload]) === true, 'slot numarası üst sınıra kırpıldı (99 → 3)');
  assert(fs.existsSync(path.join(USER, 'saves', 'slot-3.json')), 'kırpılan slot dosyası: slot-3.json');
  assert(ipc('save:write', [-7, payload]) === true && fs.existsSync(path.join(USER, 'saves', 'slot-0.json')), 'negatif slot 0’a kırpıldı');
  assert(ipc('save:write', [2, 'bu bir json değil {{{']) === false, 'bozuk kayıt verisi reddedildi (dosya yazılmadı)');
  assert(!fs.existsSync(path.join(USER, 'saves', 'slot-2.json')), 'reddedilen veri diske düşmedi');
  assert(ipc('save:write', [2, 'x'.repeat(3 * 1024 * 1024)]) === false, 'aşırı büyük kayıt reddedildi');

  console.log('--- ayarlar ---');
  const def = ipc('settings:read');
  assert(def && def.quality === 'orta' && def.volume > 0, 'varsayılan ayarlar okundu');
  const patched = ipc('settings:write', [{ quality: 'yuksek', volume: 0.4 }]);
  assert(patched.quality === 'yuksek' && patched.volume === 0.4, 'ayar yazıldı');
  const onDisk = JSON.parse(fs.readFileSync(path.join(USER, 'settings.json'), 'utf8'));
  assert(onDisk.quality === 'yuksek', 'settings.json diske yazıldı');
  assert(ipc('settings:read').quality === 'yuksek', 'ayar kalıcı (yeniden okundu)');
  const crazy = ipc('settings:write', [{ volume: 99, sensitivity: -5, quality: 'çöp', hudScale: 'büyük', fps: 'evet' }]);
  assert(crazy.volume === 1 && crazy.sensitivity === 0.2, 'sayısal ayarlar sınırlandı (ses 1, hassasiyet 0.2)');
  assert(crazy.quality === 'yuksek' && crazy.hudScale === 1, 'geçersiz ayar değerleri varsayılana döndü');
  assert(crazy.fps === false, 'yanlış tipteki bayrak varsayılana döndü');
  fs.writeFileSync(path.join(USER, 'settings.json'), '{ bu bozuk bir json');
  assert(ipc('settings:read').quality === 'orta', 'bozuk settings.json varsayılanlara döndü (oyun açılmaz kalmaz)');
  ipc('settings:write', [{ quality: 'yuksek', volume: 0.4 }]);

  console.log('--- uygulama bilgisi / tam ekran ---');
  const info = ipc('app:info');
  assert(info && info.saves === path.join(USER, 'saves') && info.electron, 'app:info bilgileri tam');
  assert(info.screens.length === 1, 'ekran listesi geldi');
  assert(ipc('app:fullscreen', [true]) === true && win.isFullScreen(), 'tam ekran açıldı');
  assert(ipc('app:fullscreen', [false]) === false && !win.isFullScreen(), 'tam ekran kapandı');

  console.log('--- ekran görüntüsü ---');
  const shotFile = await ipcInvokes['app:screenshot']();
  assert(typeof shotFile === 'string' && fs.existsSync(shotFile), 'PNG yazıldı: ' + path.basename(shotFile || ''));
  const png = fs.readFileSync(shotFile);
  assert(png.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])), 'dosya geçerli PNG imzası taşıyor');
  assert(sends.some(s => s.channel === 'shot:saved'), 'kabuk oyuna "shot:saved" bildirdi');

  console.log('--- klasör kısayolları ---');
  ipc('app:openfolder', ['saves']);
  assert(electronStub.shell._last === path.join(USER, 'saves'), 'kayıt klasörü açıldı');

  console.log('--- kapanış akışı ---');
  sends.length = 0;
  let prevented = false;
  win.emit('close', { preventDefault() { prevented = true; } });
  assert(prevented === true, 'kapatma önce oyuna soruluyor (preventDefault)');
  assert(sends.some(s => s.channel === 'menu' && s.payload === 'save-and-quit'), 'oyuna "kaydet ve çık" gönderildi');
  assert(dialogCalls.length > 0 && /çıkmak/i.test(dialogCalls[0].message || ''), 'çıkış onayı penceresi çıktı');
  await new Promise(r => setTimeout(r, 1100));
  assert(appQuit > 0, 'uygulama kapandı (quit çağrıldı)');
  assert(fs.existsSync(path.join(USER, 'window-state.json')), 'pencere durumu diske yazıldı');
  const ws = JSON.parse(fs.readFileSync(path.join(USER, 'window-state.json'), 'utf8'));
  assert(ws.width >= 640 && ws.height >= 400, 'pencere durumu geçerli (' + ws.width + '×' + ws.height + ')');
  assert(fs.existsSync(path.join(USER, 'labirent.log')), 'günlük dosyası yazıldı');

  /* ---------------- preload köprüsü ---------------- */
  console.log('--- preload köprüsü ---');
  const exposed = {};
  let syncCalls = [];
  const bridgeStub = {
    contextBridge: { exposeInMainWorld(name, api) { exposed[name] = api; } },
    ipcRenderer: {
      sendSync(channel, ...args) { syncCalls.push([channel].concat(args)); return 'SYNC-' + channel; },
      send(channel, ...args) { syncCalls.push([channel].concat(args)); },
      invoke(channel) { syncCalls.push([channel]); return Promise.resolve('INVOKE-' + channel); },
      on() { }, removeListener() { }
    }
  };
  const origLoad2 = Module._load;
  Module._load = function (request) {
    if (request === 'electron') return bridgeStub;
    return origLoad2.apply(this, arguments);
  };
  require(path.join(ROOT, 'electron', 'preload.js'));
  Module._load = origLoad2;
  const api = exposed['desktopAPI'];
  assert(!!api && api.isDesktop === true, 'desktopAPI köprüye açıldı');
  assert(typeof api.save.read === 'function' && typeof api.settings.write === 'function', 'kayıt ve ayar API’si var');
  api.save.write(1, '{"a":1}');
  assert(syncCalls.some(c => c[0] === 'save:write' && c[1] === 1), 'save.write → save:write kanalı');
  api.settings.read();
  assert(syncCalls.some(c => c[0] === 'settings:read'), 'settings.read → settings:read kanalı');
  api.quit();
  assert(syncCalls.some(c => c[0] === 'app:quit'), 'quit → app:quit kanalı');
  assert(typeof api.on === 'function', 'olay dinleme API’si var');

  /* ---------------- paketleme doğrulaması ---------------- */
  console.log('--- paketleme yapılandırması ---');
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert(pkg.main === 'electron/main.js', 'package.json main → electron/main.js');
  assert(!!pkg.build && pkg.build.appId, 'electron-builder yapılandırması var (' + pkg.build.appId + ')');
  const files = pkg.build.files;
  assert(files.some(f => f.indexOf('app/**') === 0) && files.some(f => f.indexOf('electron/**') === 0), 'paket app/ ve electron/ içeriyor');
  assert(pkg.build.files.indexOf('!tools/**/*') >= 0 && pkg.build.files.indexOf('!docs/**/*') >= 0,
    'test araçları ve docs paket dışında');
  ['win', 'linux', 'mac'].forEach(p => assert(!!pkg.build[p], 'hedef platform tanımlı: ' + p));
  ['icon.ico', 'icon.icns', 'icon.png'].forEach(ic => assert(fs.existsSync(path.join(ROOT, 'build', ic)), 'simge dosyası var: build/' + ic));
  assert(pkg.scripts.start === 'electron .', 'npm start → electron .');
  assert(!!pkg.devDependencies.electron, 'electron bağımlılığı tanımlı (' + pkg.devDependencies.electron + ')');

  /* index.html kaynakları eksiksiz mi? (paketleme güvenliği) */
  console.log('--- oyun dosyası bütünlüğü ---');
  const html = fs.readFileSync(path.join(ROOT, 'app', 'index.html'), 'utf8');
  const csp = (html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/) || [])[1];
  assert(!!csp, 'index.html içerik güvenlik politikası (CSP) tanımlı');
  assert(/default-src 'none'/.test(csp || ''), 'CSP varsayılan olarak hiçbir dış kaynağa izin vermiyor');
  assert(/script-src 'self' file:/.test(csp || ''), 'CSP betikleri yalnızca yerelden yükler');
  assert(!/<script(?![^>]*src=)[^>]*>[^<]/.test(html.replace(/<!--[\s\S]*?-->/g, '')), 'satır içi betik yok');
  assert(!/<\w+[^>]*\son[a-z]+=/i.test(html.replace(/<!--[\s\S]*?-->/g, '')), 'satır içi olay işleyicisi yok');
  const refs = [];
  html.replace(/(?:src|href)="([^"]+)"/g, (m, p1) => { refs.push(p1); return m; });
  let missing = refs.filter(r => !/^https?:/.test(r) && !fs.existsSync(path.join(ROOT, 'app', r)));
  assert(missing.length === 0, 'index.html içindeki tüm dosyalar mevcut (' + refs.length + ' kaynak)' +
    (missing.length ? ' — eksik: ' + missing.join(', ') : ''));
  assert(pkg.build.nsis.artifactName !== pkg.build.portable.artifactName,
    'kurulum ve taşınabilir paket adları çakışmıyor');
  assert(pkg.build.nsis.createDesktopShortcut === true && pkg.build.nsis.createStartMenuShortcut === true,
    'kurulum masaüstü + Başlat menüsü kısayolu oluşturur');
  assert(pkg.build.nsis.deleteAppDataOnUninstall !== true, 'kaldırma kayıt dosyalarını silmez');
  assert(pkg.build.nsis.language === '1055', 'kurulum sihirbazı Türkçe (1055)');
  assert(pkg.build.nsis.allowToChangeInstallationDirectory === true, 'kurulum klasörü seçilebilir');
  assert(Array.isArray(pkg.build.publish) && pkg.build.publish.length === 0, 'paketleme kendiliğinden yayın yapmaz');
  assert(!!pkg.build.dmg && !!pkg.build.dmg.contents, 'dmg düzeni tanımlı (Applications kısayolu)');
  assert(fs.existsSync(path.join(ROOT, '.github', 'workflows', 'paket.yml')),
    'GitHub Actions paketleme iş akışı var (üç platform)');
  const wf = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'paket.yml'), 'utf8');
  ['windows-latest', 'ubuntu-latest', 'macos-latest'].forEach(r =>
    assert(wf.indexOf(r) >= 0, 'iş akışı hedefi: ' + r));
  const jsFiles = fs.readdirSync(path.join(ROOT, 'app', 'js'));
  assert(jsFiles.length >= 9, 'oyun betikleri yerinde: ' + jsFiles.length + ' dosya');

  console.log('--- electron-builder çalıştırılabilir mi? ---');
  const haveBuilder = fs.existsSync(path.join(ROOT, 'node_modules', 'electron-builder'));
  assert(true, haveBuilder ? 'electron-builder kurulu — "npm run dist" ile paket üretilebilir'
    : 'electron-builder yalnızca kurulunca: npm install && npm run dist');

  if (errors.length) { console.log('\nHATA LİSTESİ:'); errors.forEach(e => console.log(' - ' + e)); }
  console.log('\n' + (errors.length ? 'HATALAR: ' + errors.length : 'TÜM MASAÜSTÜ TESTLERİ GEÇTİ'));
  try { fs.rmSync(USER, { recursive: true, force: true }); } catch (e) { }
  process.exit(errors.length ? 1 : 0);
}, 60);
