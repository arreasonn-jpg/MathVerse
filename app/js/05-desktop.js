/* ============================================================
   05-desktop.js — masaüstü köprüsü
   Electron preload API'si varsa onu kullanır (dosya tabanlı kayıt,
   ayarlar, yerel menü, ekran görüntüsü); tarayıcıda aynı API'yi
   localStorage ile taklit eder, böylece oyun kodu tek biçim kalır.
   ============================================================ */
(function (MV) {
  'use strict';

  const DEFAULT_SETTINGS = {
    quality: 'orta',      // yuksek | orta | performans
    volume: 0.85,
    muted: false,
    sensitivity: 1.0,
    fov: 1.0,
    invertY: false,
    shake: true,
    fps: false,
    fullscreen: false,
    hudScale: 1.0
  };
  const QUALITY_SS = { yuksek: 1, orta: 2, performans: 3 };
  const QUALITY_LABEL = { yuksek: 'YÜKSEK', orta: 'ORTA', performans: 'PERFORMANS' };

  const LS_SETTINGS = 'labirent-settings-v1';
  const LS_SLOT = (s) => 'labirent-slot-' + s + '-v1';
  const LS_ACH = 'labirent-basarim-v1';

  const bridge = (typeof window !== 'undefined') ? window.desktopAPI : null;
  const isDesktop = !!(bridge && bridge.isDesktop);

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }
  function lsDel(k) { try { localStorage.removeItem(k); return true; } catch (e) { return false; } }

  const D = {
    isDesktop: isDesktop,
    bridge: bridge,

    /* ---------------- bilgi ---------------- */
    info() {
      if (isDesktop) { try { return bridge.info(); } catch (e) { } }
      return {
        version: '1.0.1-tarayıcı', platform: 'tarayıcı', arch: '-',
        electron: '-', chrome: navigator.userAgent, node: '-',
        userData: '-', saves: 'localStorage', shots: '-', screens: []
      };
    },

    /* ---------------- ayarlar ---------------- */
    settings: {
      read() {
        if (isDesktop) { try { return Object.assign({}, DEFAULT_SETTINGS, bridge.settings.read()); } catch (e) { } }
        try {
          const raw = lsGet(LS_SETTINGS);
          return Object.assign({}, DEFAULT_SETTINGS, raw ? JSON.parse(raw) : {});
        } catch (e) { return Object.assign({}, DEFAULT_SETTINGS); }
      },
      write(patch) {
        const next = Object.assign({}, this.read(), patch || {});
        if (isDesktop) { try { bridge.settings.write(next); } catch (e) { } }
        else lsSet(LS_SETTINGS, JSON.stringify(next));
        return next;
      }
    },

    /* ---------------- kayıt slotları ---------------- */
    save: {
      read(slot) {
        if (isDesktop) { try { return bridge.save.read(slot); } catch (e) { return null; } }
        return lsGet(LS_SLOT(slot));
      },
      write(slot, json) {
        if (isDesktop) { try { return !!bridge.save.write(slot, json); } catch (e) { return false; } }
        return lsSet(LS_SLOT(slot), json);
      },
      remove(slot) {
        if (isDesktop) { try { return !!bridge.save.remove(slot); } catch (e) { return false; } }
        return lsDel(LS_SLOT(slot));
      },
      list() {
        const out = [];
        for (let s = 0; s < 4; s++) {
          const raw = this.read(s);
          if (!raw) { out.push({ slot: s, empty: true }); continue; }
          let d = null;
          try { d = JSON.parse(raw); } catch (e) { out.push({ slot: s, empty: true }); continue; }
          out.push({
            slot: s, empty: false, day: d.day || 1, phase: d.phase || 'day',
            date: d.t || 0, runes: (d.runesRead || []).length,
            hasKey: !!d.hasKey, kills: (d.meta && d.meta.kills) || 0,
            objective: d.objective || 'explore', seed: d.seed || 0,
            hp: Math.round(d.hp || 0), time: (d.meta && d.meta.time) || 0
          });
        }
        return out;
      },
      dir() {
        if (isDesktop) { try { return bridge.save.dir(); } catch (e) { } }
        return 'tarayıcı: localStorage';
      }
    },

    /* ---------------- başarımlar ----------------
       Kayıt slotlarından bağımsız tek profil: yeni deney başlatınca da korunur. */
    achievements: {
      read() {
        if (isDesktop) { try { return bridge.achievements.read(); } catch (e) { return null; } }
        return lsGet(LS_ACH);
      },
      write(json) {
        if (isDesktop) { try { return !!bridge.achievements.write(json); } catch (e) { return false; } }
        return lsSet(LS_ACH, json);
      },
      list() {
        const raw = this.read();
        if (!raw) return {};
        try {
          const o = JSON.parse(raw);
          return (o && typeof o === 'object' && !Array.isArray(o)) ? o : {};
        } catch (e) { return {}; }
      },
      clear() { return this.write('{}'); }
    },

    /* ---------------- uygulama ---------------- */
    quit() {
      if (isDesktop) { try { bridge.quit(); } catch (e) { } }
      else MV.logMsg('Çıkış yalnızca masaüstü sürümünde.');
    },
    setFullscreen(on) {
      if (isDesktop) { try { return !!bridge.setFullscreen(on); } catch (e) { return false; } }
      try {
        if (on && document.documentElement.requestFullscreen) document.documentElement.requestFullscreen();
        else if (!on && document.exitFullscreen) document.exitFullscreen();
        return !!on;
      } catch (e) { return false; }
    },
    screenshot() {
      if (isDesktop) { try { return bridge.screenshot(); } catch (e) { return null; } }
      return null;
    },
    openFolder(which) {
      if (isDesktop) { try { bridge.openFolder(which); } catch (e) { } }
    },

    /* ---------------- olaylar ---------------- */
    onMenu(fn) {
      if (isDesktop && bridge.on) bridge.on('menu', (cmd) => fn(cmd));
      return () => { };
    },
    onWindow(fn) {
      if (isDesktop && bridge.on) {
        bridge.on('window:blur', () => fn('blur'));
        bridge.on('window:focus', () => fn('focus'));
        bridge.on('window:resize', () => fn('resize'));
        bridge.on('window:fullscreen', (on) => fn('fullscreen', on));
      }
      return () => { };
    },
    onShotSaved(fn) {
      if (isDesktop && bridge.on) bridge.on('shot:saved', (file) => fn(file));
      return () => { };
    },

    /* ---------------- yardımcılar ---------------- */
    QUALITY_SS: QUALITY_SS,
    QUALITY_LABEL: QUALITY_LABEL,
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,

    /* ayarları alıp motora uygular */
    apply(settings) {
      const s = settings || this.settings.read();
      if (MV.Renderer) {
        MV.Renderer.setQuality(QUALITY_SS[s.quality] || 2);
        MV.Renderer.fovMul = s.fov || 1.0;
      }
      if (MV.Audio) {
        MV.Audio.setVolume(s.volume);
        MV.Audio.setMuted(!!s.muted);
      }
      if (MV.Game) {
        MV.Game.invertY = !!s.invertY;
        MV.Game.sensitivity = s.sensitivity || 1.0;
        MV.Game.shake = s.shake !== false;
      }
      if (MV.UI) {
        MV.UI.setHudScale(s.hudScale || 1.0);
        MV.UI.setFpsVisible(!!s.fps);
      }
      document.documentElement.setAttribute('data-platform', isDesktop ? 'masaustu' : 'tarayici');
      return s;
    }
  };

  MV.Desktop = D;
  MV.Desktop.DEFAULT_SETTINGS = DEFAULT_SETTINGS;
})(MV);
