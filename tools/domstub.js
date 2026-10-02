/* Tarayıcısız/Electronsuz çalıştırma için sahte ortam.
   İki kip destekler:
     setup()                    → tarayıcı (localStorage, desktopAPI yok)
     setup({desktop: dir})      → masaüstü (preload API'si dosya sistemine bağlı)
   Böylece oyun kodu her iki kipte de sınanabilir. */
const fs = require('fs');
const path = require('path');

function makeCtx(canvas) {
  const grad = { addColorStop() { } };
  return {
    canvas: canvas,
    fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, font: '10px monospace',
    filter: 'none', globalCompositeOperation: 'source-over',
    textAlign: 'left', textBaseline: 'alphabetic', globalAlpha: 1,
    imageSmoothingEnabled: false,
    createImageData(w, h) { return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; },
    getImageData(x, y, w, h) { return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; },
    putImageData() { }, drawImage() { }, fillRect() { }, strokeRect() { }, clearRect() { },
    fillText() { }, strokeText() { }, measureText() { return { width: 10 }; },
    beginPath() { }, closePath() { }, moveTo() { }, lineTo() { }, arc() { }, ellipse() { },
    quadraticCurveTo() { }, bezierCurveTo() { }, rect() { }, stroke() { }, fill() { }, clip() { },
    save() { }, restore() { }, translate() { }, rotate() { }, scale() { }, setTransform() { },
    createRadialGradient() { return grad; }, createLinearGradient() { return grad; },
    createPattern() { return null; }
  };
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
    clientWidth: 480, clientHeight: 270,
    focus() { }
  };
  return el;
}

/* ---------- masaüstü köprüsü (preload + main davranışı) ---------- */
function makeDesktopAPI(dir) {
  fs.mkdirSync(path.join(dir, 'saves'), { recursive: true });
  const slotFile = (s) => path.join(dir, 'saves', 'slot-' + s + '.json');
  const handlers = {};
  const calls = { screenshot: 0, quit: 0, openFolder: [], fullscreen: [] };
  const settingsFile = path.join(dir, 'settings.json');
  const DEFAULT_SETTINGS = {
    quality: 'orta', volume: 0.85, muted: false, sensitivity: 1.0, fov: 1.0,
    invertY: false, shake: true, fps: false, fullscreen: false, hudScale: 1.0,
    sprintMode: 'basili', crouchMode: 'basili', mouseCurve: 'dengeli', mouseSmoothing: 0.12,
    bob: 1.0, assist: true, vibration: true, padDeadzone: 0.18, padCurve: 1.7, padSens: 1.0,
    renderScale: 'auto', keymap: {}
  };
  const api = {
    isDesktop: true,
    platform: 'linux',
    calls: calls,
    emit(channel, payload) { (handlers[channel] || []).forEach(fn => fn(payload)); },
    save: {
      read(slot) { try { return fs.readFileSync(slotFile(slot), 'utf8'); } catch (e) { return null; } },
      write(slot, json) { try { fs.writeFileSync(slotFile(slot), json, 'utf8'); return true; } catch (e) { return false; } },
      remove(slot) { try { fs.unlinkSync(slotFile(slot)); return true; } catch (e) { return false; } },
      list() {
        const out = [];
        for (let s = 0; s < 4; s++) {
          const raw = api.save.read(s);
          if (!raw) { out.push({ slot: s, empty: true }); continue; }
          let d = {}; try { d = JSON.parse(raw); } catch (e) { }
          let mtime = 0;
          try { mtime = fs.statSync(slotFile(s)).mtimeMs; } catch (e) { }
          out.push({
            slot: s, empty: false, day: d.day || 1, phase: d.phase || 'day', date: d.t || mtime,
            runes: (d.runesRead || []).length, hasKey: !!d.hasKey,
            kills: (d.meta && d.meta.kills) || 0, objective: d.objective || 'explore', seed: d.seed
          });
        }
        return out;
      },
      dir() { return path.join(dir, 'saves'); }
    },
    /* başarımlar: gerçek main.js gibi tek profil dosyası */
    achievements: {
      read() { try { return fs.readFileSync(path.join(dir, 'achievements.json'), 'utf8'); } catch (e) { return null; } },
      write(json) {
        if (typeof json !== 'string' || json.length > 256 * 1024) return false;
        try {
          const o = JSON.parse(json);
          if (!o || typeof o !== 'object' || Array.isArray(o)) return false;
        } catch (e) { return false; }
        try { fs.writeFileSync(path.join(dir, 'achievements.json'), json); return true; } catch (e) { return false; }
      }
    },

    settings: {
      read() {
        try { return Object.assign({}, DEFAULT_SETTINGS, JSON.parse(fs.readFileSync(settingsFile, 'utf8'))); }
        catch (e) { return Object.assign({}, DEFAULT_SETTINGS); }
      },
      write(patch) {
        const next = Object.assign({}, api.settings.read(), patch || {});
        fs.writeFileSync(settingsFile, JSON.stringify(next, null, 2), 'utf8');
        return next;
      }
    },
    info() {
      return {
        version: '1.0.0', platform: 'linux', arch: 'x64', electron: '44.5.1',
        chrome: '138.0.0.0', node: '22.0.0', userData: dir,
        saves: api.save.dir(), shots: path.join(dir, 'shots'), screens: [{ w: 1920, h: 1080 }]
      };
    },
    quit() { calls.quit++; },
    setFullscreen(on) { calls.fullscreen.push(on); return !!on; },
    screenshot() { calls.screenshot++; setTimeout(() => api.emit('shot:saved', path.join(dir, 'shots', 'test.png')), 5); return Promise.resolve(path.join(dir, 'shots', 'test.png')); },
    openFolder(which) { calls.openFolder.push(which); },
    on(channel, fn) { (handlers[channel] = handlers[channel] || []).push(fn); return () => { }; },
    off(channel, fn) { handlers[channel] = (handlers[channel] || []).filter(f => f !== fn); }
  };
  return api;
}

function setup(opts) {
  opts = opts || {};
  const elements = {};
  const byId = (id) => elements[id] || (elements[id] = makeElement(
    (id === 'view' || id === 'compass-c' || id === 'map-c') ? 'canvas' : 'div', id));
  const docEl = makeElement('html', 'html');
  docEl.setAttribute = function (k, v) { this._attrs = this._attrs || {}; this._attrs[k] = v; };
  docEl.getAttribute = function (k) { return (this._attrs || {})[k]; };

  global.document = {
    readyState: 'complete',
    createElement: (t) => makeElement(t),
    getElementById: byId,
    addEventListener() { }, removeEventListener() { },
    pointerLockElement: null, body: makeElement('body'),
    documentElement: docEl
  };
  const padState = [null, null, null, null];
  /* Node 22'de navigator yerleşik ve yalnızca-okunur; defineProperty şart */
  Object.defineProperty(global, 'navigator', {
    value: { userAgent: 'NodeTest/1.0', getGamepads: () => padState },
    configurable: true, writable: true
  });
  /* test için kol tak/çıkar: buttons = [{pressed}|bool], axes = [4] */
  function setGamepad(spec) {
    if (!spec) { padState[0] = null; return; }
    const buttons = (spec.buttons || []).map(b => (typeof b === 'object' ? b : { pressed: !!b, value: b ? 1 : 0 }));
    while (buttons.length < 17) buttons.push({ pressed: false, value: 0 });
    padState[0] = { id: spec.id || 'Test Kol (STANDARD GAMEPAD)', index: 0, connected: true, mapping: 'standard',
      axes: spec.axes || [0, 0, 0, 0], buttons: buttons };
  }
  global.window = {
    addEventListener() { }, removeEventListener() { },
    matchMedia: () => ({ matches: true }),
    requestPointerLock() { }, innerWidth: 1280, innerHeight: 720
  };
  if (opts.desktop) {
    global.window.desktopAPI = makeDesktopAPI(opts.desktop);
  }
  global.performance = { now: () => Date.now() };
  global.requestAnimationFrame = () => 0;
  const storage = {};
  global.localStorage = {
    getItem: (k) => (k in storage ? storage[k] : null),
    setItem: (k, v) => { storage[k] = String(v); },
    removeItem: (k) => { delete storage[k]; },
    _dump: () => storage
  };

  global.MV = {};
  const root = path.join(__dirname, '..');
  const files = ['00-core.js', '05-desktop.js', '07-input.js', '09-gl.js', '10-textures.js', '20-maze.js', '30-render.js',
    '40-audio.js', '50-ai.js', '60-game.js', '70-ui.js'];
  for (const f of files) new Function(fs.readFileSync(path.join(root, 'app', 'js', f), 'utf8'))();
  return { MV: global.MV, byId: byId, elements: elements, desktopAPI: global.window.desktopAPI, setGamepad: setGamepad };
}

module.exports = { setup, makeDesktopAPI };
