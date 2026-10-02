/* Tarayıcısız çalıştırma için sahte DOM + canvas ortamı */
const fs = require('fs');
const path = require('path');

function makeCtx(canvas) {
  const grad = { addColorStop() { } };
  return {
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

function setup() {
  const elements = {};
  const byId = (id) => elements[id] || (elements[id] = makeElement(
    (id === 'view' || id === 'compass-c' || id === 'map-c') ? 'canvas' : 'div', id));
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
    requestPointerLock() { }, innerWidth: 1280, innerHeight: 720
  };
  global.performance = { now: () => Date.now() };
  global.requestAnimationFrame = () => 0;
  const storage = {};
  global.localStorage = {
    getItem: (k) => (k in storage ? storage[k] : null),
    setItem: (k, v) => { storage[k] = String(v); },
    removeItem: (k) => { delete storage[k]; }
  };
  global.MV = {};
  const root = path.join(__dirname, '..');
  const files = ['00-core.js', '10-textures.js', '20-maze.js', '30-render.js', '40-audio.js', '50-ai.js', '60-game.js', '70-ui.js'];
  for (const f of files) new Function(fs.readFileSync(path.join(root, 'js', f), 'utf8'))();
  return { MV: global.MV, byId: byId, elements: elements };
}

module.exports = { setup };
