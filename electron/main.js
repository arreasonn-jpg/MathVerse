/* ============================================================
   electron/main.js — LABİRENT PROTOKOLÜ masaüstü kabuğu
   Pencere yönetimi, yerel menü, kayıt dosyaları, ekran görüntüsü,
   ayar saklama, hata yakalama ve tek örnek kilidi.
   ============================================================ */
'use strict';

const { app, BrowserWindow, Menu, ipcMain, dialog, shell, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const APP_NAME = 'LABİRENT PROTOKOLÜ';
const GAME_VERSION = '1.0.0';
const MAX_SLOTS = 4;                 // 1..3 oyuncu kaydı + 0: otomatik kayıt
const AUTO_SLOT = 0;

let mainWindow = null;
let quitting = false;
let rendererReady = false;

/* ---------------- yollar ---------------- */
function userDir() { return app.getPath('userData'); }
function savesDir() {
  const d = path.join(userDir(), 'saves');
  try { fs.mkdirSync(d, { recursive: true }); } catch (e) { }
  return d;
}
function settingsPath() { return path.join(userDir(), 'settings.json'); }
function logPath() { return path.join(userDir(), 'labirent.log'); }
function shotsDir() {
  let base = userDir();
  try { base = app.getPath('pictures') || userDir(); } catch (e) { }
  const d = path.join(base, 'Labirent Protokolu');
  try { fs.mkdirSync(d, { recursive: true }); } catch (e) { }
  return d;
}
function slotFile(slot) { return path.join(savesDir(), 'slot-' + slot + '.json'); }

/* ---------------- günlük ---------------- */
function logLine(msg) {
  const line = '[' + new Date().toISOString() + '] ' + msg + os.EOL;
  try { fs.appendFileSync(logPath(), line); } catch (e) { }
  if (process.env.LP_DEBUG) process.stdout.write(line);
}

/* ---------------- ayarlar ---------------- */
const DEFAULTS = {
  quality: 'orta',          // yuksek | orta | performans
  volume: 0.85,
  muted: false,
  sensitivity: 1.0,
  fov: 1.0,
  fps: false,
  shake: true,
  fullscreen: false,
  invertY: false,
  hudScale: 1.0
};
function readSettings() {
  try {
    const raw = fs.readFileSync(settingsPath(), 'utf8');
    return Object.assign({}, DEFAULTS, JSON.parse(raw));
  } catch (e) { return Object.assign({}, DEFAULTS); }
}
function writeSettings(patch) {
  const cur = readSettings();
  const next = Object.assign({}, cur, patch || {});
  try { fs.writeFileSync(settingsPath(), JSON.stringify(next, null, 2), 'utf8'); } catch (e) { logLine('ayar yazılamadı: ' + e.message); }
  return next;
}

/* ---------------- pencere durumu ---------------- */
const statePath = () => path.join(userDir(), 'window-state.json');
function readWindowState() {
  try {
    const s = JSON.parse(fs.readFileSync(statePath(), 'utf8'));
    if (s && s.width > 640 && s.height > 400) return s;
  } catch (e) { }
  return { width: 1280, height: 760, x: undefined, y: undefined, maximized: true };
}
function saveWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    const b = mainWindow.getBounds();
    const maximized = mainWindow.isMaximized();
    fs.writeFileSync(statePath(), JSON.stringify({
      width: b.width, height: b.height, x: b.x, y: b.y, maximized
    }, null, 2));
  } catch (e) { }
}

/* ---------------- kayıt dosyaları ---------------- */
function readSlot(slot) {
  try { return fs.readFileSync(slotFile(slot), 'utf8'); } catch (e) { return null; }
}
function writeSlot(slot, json) {
  try {
    fs.writeFileSync(slotFile(slot), json, 'utf8');
    return true;
  } catch (e) { logLine('kayıt yazılamadı: ' + e.message); return false; }
}
function slotInfo(slot) {
  const raw = readSlot(slot);
  if (!raw) return { slot: slot, empty: true };
  let d = null;
  try { d = JSON.parse(raw); } catch (e) { return { slot: slot, empty: true }; }
  let mtime = 0;
  try { mtime = fs.statSync(slotFile(slot)).mtimeMs; } catch (e) { }
  return {
    slot: slot, empty: false, day: d.day || 1, phase: d.phase || 'day',
    date: mtime, runes: (d.runesRead || []).length,
    hasKey: !!d.hasKey, kills: (d.meta && d.meta.kills) || 0,
    objective: d.objective || 'explore', seed: d.seed
  };
}
function allSlots() {
  const arr = [];
  for (let s = 0; s < MAX_SLOTS; s++) arr.push(slotInfo(s));
  return arr;
}

/* ---------------- oyun penceresi ---------------- */
function createWindow() {
  const st = readWindowState();
  const settings = readSettings();
  mainWindow = new BrowserWindow({
    width: st.width, height: st.height, x: st.x, y: st.y,
    minWidth: 960, minHeight: 540,
    title: APP_NAME + ' — WICKED Deney Sahası 7',
    backgroundColor: '#05070a',
    show: false,
    autoHideMenuBar: true,
    fullscreen: !!settings.fullscreen,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
      spellcheck: false
    }
  });
  if (st.maximized && !settings.fullscreen) mainWindow.maximize();

  Menu.setApplicationMenu(buildMenu());
  loadRenderer();

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (settings.fullscreen) mainWindow.setFullScreen(true);
  });

  /* pencere odak kaybında oyunu duraklat (masaüstü davranışı) */
  mainWindow.on('blur', () => renderer && send('window:blur'));
  mainWindow.on('focus', () => send('window:focus'));
  mainWindow.on('resize', () => send('window:resize'));
  mainWindow.on('enter-full-screen', () => send('window:fullscreen', true));
  mainWindow.on('leave-full-screen', () => send('window:fullscreen', false));

  mainWindow.on('close', (e) => {
    if (quitting) { saveWindowState(); return; }
    e.preventDefault();
    askQuit();
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}

/* yükleyiciyi yükle; hata olursa oyunu kurtarmaya çalış */
let renderer = null;
function loadRenderer(retry) {
  const file = path.join(__dirname, '..', 'app', 'index.html');
  mainWindow.loadFile(file).catch(err => {
    logLine('yükleme hatası: ' + err.message);
    dialog.showErrorBox('Yükleme hatası', 'Oyun dosyaları yüklenemedi:\n' + err.message);
  });
  renderer = {
    send(channel, payload) {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
    }
  };
}
function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

/* ---------------- menü ---------------- */
function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{
      label: APP_NAME,
      submenu: [
        { role: 'about', label: 'Hakkında' },
        { type: 'separator' },
        { role: 'hide', label: 'Gizle' },
        { role: 'quit', label: 'Çıkış' }
      ]
    }] : []),
    {
      label: 'Oyun',
      submenu: [
        { label: 'Yeni Deney', accelerator: 'CmdOrCtrl+N', click: () => send('menu', 'new') },
        { label: 'Devam Et (otomatik kayıt)', accelerator: 'CmdOrCtrl+O', click: () => send('menu', 'continue') },
        { type: 'separator' },
        { label: 'Kaydet', accelerator: 'CmdOrCtrl+S', click: () => send('menu', 'save') },
        { label: 'Kayıt Yükle…', accelerator: 'CmdOrCtrl+L', click: () => send('menu', 'load') },
        { type: 'separator' },
        { label: 'Duraklat (Esc)', click: () => send('menu', 'pause') },
        { type: 'separator' },
        isMac ? { role: 'close', label: 'Kapat' } : { role: 'quit', label: 'Çıkış', accelerator: 'Alt+F4' }
      ]
    },
    {
      label: 'Görünüm',
      submenu: [
        { label: 'Tam Ekran', accelerator: isMac ? 'Ctrl+Cmd+F' : 'F11', click: toggleFullscreen },
        { label: 'Görüntü Kalitesi: Yüksek / Orta / Performans', click: () => send('menu', 'quality') },
        { label: 'FPS Sayacı', accelerator: 'F3', click: () => send('menu', 'fps') },
        { type: 'separator' },
        { label: 'Ekran Görüntüsü', accelerator: 'F12', click: () => takeScreenshot() },
        { label: 'Ekran Görüntüleri Klasörünü Aç', click: () => shell.openPath(shotsDir()) },
        { type: 'separator' },
        { role: 'toggleDevTools', label: 'Geliştirici Araçları', accelerator: 'CmdOrCtrl+Shift+I' },
        { role: 'reload', label: 'Yeniden Yükle', accelerator: 'CmdOrCtrl+R' }
      ]
    },
    {
      label: 'Ses',
      submenu: [
        { label: 'Sesi Aç/Kapat', accelerator: 'CmdOrCtrl+M', click: () => send('menu', 'mute') },
        { label: 'Ses Seviyesi', click: () => send('menu', 'settings') },
        { type: 'separator' },
        { role: 'toggleSpellChecker', visible: false }
      ]
    },
    {
      label: 'Yardım',
      submenu: [
        { label: 'Kontroller', accelerator: 'F1', click: () => send('menu', 'controls') },
        { label: 'Ayarlar', accelerator: 'CmdOrCtrl+,', click: () => send('menu', 'settings') },
        { type: 'separator' },
        { label: 'Kayıt Klasörünü Aç', click: () => shell.openPath(savesDir()) },
        { label: 'Günlük Dosyasını Aç', click: () => shell.openPath(logPath()) },
        { type: 'separator' },
        {
          label: 'Hakkında',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'Hakkında',
              message: APP_NAME,
              detail: 'Sürüm ' + GAME_VERSION + ' — WICKED Deney Sahası 7\n\n' +
                'Inferno Protocol görselliğinde, Labirent: Ölümcül Kaçış mantığında\n' +
                'birinci şahıs hayatta kalma korku oyunu.\n\n' +
                'Tüm dokular, sesler ve haritalar çalışma anında prosedürel üretilir.\n' +
                'Electron ' + (process.versions.electron || '-') + ' · Chromium ' + (process.versions.chrome || '-') +
                '\nKayıtlar: ' + savesDir()
            });
          }
        }
      ]
    }
  ];
  return Menu.buildFromTemplate(template);
}

function toggleFullscreen() {
  if (!mainWindow) return;
  const on = !mainWindow.isFullScreen();
  mainWindow.setFullScreen(on);
  writeSettings({ fullscreen: on });
}

/* ---------------- ekran görüntüsü ---------------- */
async function takeScreenshot() {
  if (!mainWindow) return null;
  try {
    const img = await mainWindow.webContents.capturePage();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const file = path.join(shotsDir(), 'labirent-' + stamp + '.png');
    fs.writeFileSync(file, img.toPNG());
    logLine('ekran görüntüsü: ' + file);
    send('shot:saved', file);
    return file;
  } catch (e) {
    logLine('ekran görüntüsü hatası: ' + e.message);
    return null;
  }
}

/* ---------------- çıkış akışı ---------------- */
function askQuit() {
  if (!mainWindow) { app.quit(); return; }
  const choice = dialog.showMessageBoxSync(mainWindow, {
    type: 'question',
    buttons: ['Kaydet ve Çık', 'Kaydetmeden Çık', 'Vazgeç'],
    defaultId: 0,
    cancelId: 2,
    title: 'Çıkış',
    message: 'Deneyden çıkmak istiyor musun?',
    detail: 'Otomatik kayıt (slot 0) her 20 saniyede alınır. Yine de kaydetmek isteyebilirsin.'
  });
  if (choice === 2) return;
  if (choice === 0) {
    send('menu', 'save-and-quit');
    // oyun kısa süre içinde kaydedip 'quit:now' gönderir
    setTimeout(() => { quitting = true; app.quit(); }, 900);
  } else {
    quitting = true; app.quit();
  }
}

/* ---------------- IPC ---------------- */
function registerIpc() {
  /* kayıtlar */
  ipcMain.on('save:read', (e, slot) => { e.returnValue = readSlot(Number(slot) || 0); });
  ipcMain.on('save:write', (e, slot, json) => { e.returnValue = writeSlot(Number(slot) || 0, json); });
  ipcMain.on('save:delete', (e, slot) => {
    try { fs.unlinkSync(slotFile(Number(slot) || 0)); e.returnValue = true; } catch (err) { e.returnValue = false; }
  });
  ipcMain.on('save:list', (e) => { e.returnValue = allSlots(); });
  ipcMain.on('save:dir', (e) => { e.returnValue = savesDir(); });

  /* ayarlar */
  ipcMain.on('settings:read', (e) => { e.returnValue = readSettings(); });
  ipcMain.on('settings:write', (e, patch) => { e.returnValue = writeSettings(patch); });

  /* sistem */
  ipcMain.on('app:info', (e) => {
    e.returnValue = {
      version: GAME_VERSION,
      platform: process.platform,
      arch: process.arch,
      electron: process.versions.electron || '-',
      chrome: process.versions.chrome || '-',
      node: process.versions.node || '-',
      userData: userDir(),
      saves: savesDir(),
      shots: shotsDir(),
      screens: screen.getAllDisplays().map(d => ({ w: d.size.width, h: d.size.height }))
    };
  });
  ipcMain.on('app:quit', () => { quitting = true; app.quit(); });
  ipcMain.on('app:fullscreen', (e, on) => {
    if (!mainWindow) { e.returnValue = false; return; }
    const want = on === undefined ? !mainWindow.isFullScreen() : !!on;
    mainWindow.setFullScreen(want);
    writeSettings({ fullscreen: want });
    e.returnValue = want;
  });
  ipcMain.handle('app:screenshot', async () => await takeScreenshot());
  ipcMain.on('app:openfolder', (e, which) => {
    shell.openPath(which === 'shots' ? shotsDir() : savesDir());
  });

  /* menüden gelen isteklerin panoya geri bildirimi */
  ipcMain.on('menu:handled', (e, what) => { logLine('menü: ' + what); });
}

/* ---------------- tek örnek ---------------- */
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    registerIpc();
    createWindow();
    logLine('uygulama başladı — ' + process.platform + ' ' + process.arch);
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });

  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.on('before-quit', () => { quitting = true; saveWindowState(); });
}

/* ---------------- hata yakalama ---------------- */
process.on('uncaughtException', (err) => {
  logLine('YAKALANMAMIŞ HATA: ' + (err && err.stack ? err.stack : err));
  try {
    dialog.showErrorBox('Beklenmeyen hata', String(err && err.message || err) +
      '\n\nAyrıntılar: ' + logPath());
  } catch (e) { }
});
process.on('unhandledRejection', (reason) => {
  logLine('İŞLENMEYEN VAAT: ' + (reason && reason.stack ? reason.stack : reason));
});
