/* ============================================================
   electron/preload.js — oyun ile masaüstü kabuğu arasındaki köprü
   contextIsolation açık; renderer'a yalnızca dar bir API verilir.
   ============================================================ */
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/** masaüstü API'si — tarayıcıda bu nesne yoktur, oyun otomatik olarak
    localStorage yedeğine düşer (bkz. app/js/05-desktop.js). */
const api = {
  isDesktop: true,
  platform: process.platform,

  /* --- kayıt slotları (senkron; kayıt anında birkaç ms sürer) --- */
  save: {
    read: (slot) => ipcRenderer.sendSync('save:read', slot),
    write: (slot, json) => ipcRenderer.sendSync('save:write', slot, json),
    remove: (slot) => ipcRenderer.sendSync('save:delete', slot),
    list: () => ipcRenderer.sendSync('save:list'),
    dir: () => ipcRenderer.sendSync('save:dir')
  },

  /* --- başarımlar (slotlardan bağımsız profil) --- */
  achievements: {
    read: () => ipcRenderer.sendSync('achievements:read'),
    write: (json) => ipcRenderer.sendSync('achievements:write', json)
  },

  /* --- ayarlar --- */
  settings: {
    read: () => ipcRenderer.sendSync('settings:read'),
    write: (patch) => ipcRenderer.sendSync('settings:write', patch)
  },

  /* --- uygulama --- */
  info: () => ipcRenderer.sendSync('app:info'),
  quit: () => ipcRenderer.send('app:quit'),
  setFullscreen: (on) => ipcRenderer.sendSync('app:fullscreen', on),
  screenshot: () => ipcRenderer.invoke('app:screenshot'),
  openFolder: (which) => ipcRenderer.send('app:openfolder', which),

  /* --- kabuk olayları --- */
  on: (channel, fn) => {
    const allowed = ['menu', 'window:blur', 'window:focus', 'window:resize', 'window:fullscreen', 'shot:saved'];
    if (allowed.indexOf(channel) < 0) return () => { };
    const handler = (e, payload) => fn(payload, e);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
  off: (channel, fn) => ipcRenderer.removeListener(channel, fn)
};

contextBridge.exposeInMainWorld('desktopAPI', api);
