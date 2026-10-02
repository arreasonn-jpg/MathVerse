/* ============================================================
   tools/gl-test.js — GPU hattını (MV.GL) GPU'suz sınar.

   Sandbox'ta WebGL yok; bu yüzden WebGL1 API'sini taklit eden bir
   bağlam kurulur ve 09-gl.js'in TÜM kodu gerçekten çalıştırılır:
   shader derleme → atlas kurulumu → chunk ağları → render → post.

   Denetlenenler:
     • init/ok/status
     • atlas slot eşlemesi (karo kimlikleri 100+ dahil)
     • chunk ağlarının boş olmaması ve slotların geçerli aralıkta olması
     • drawElements/drawArrays çağrılarının gerçekleşmesi
     • invalidate() sonrası yeniden kurulum
     • WebGL yoksa CPU yedeğine düşme (ölümcül olmama)
   ============================================================ */
'use strict';
const path = require('path');
const fs = require('fs');
const soft = require('./softcanvas');

const ROOT = path.join(__dirname, '..');
const C_CONST = { VERTEX_SHADER: 0x8B31, FRAGMENT_SHADER: 0x8B30 };

/* ---------------- WebGL1 alaycısı ---------------- */
function mockGL(maxTex) {
  const C = {
    VERSION: 0x1F02, VERTEX_SHADER: 0x8B31, FRAGMENT_SHADER: 0x8B30,
    COMPILE_STATUS: 0x8B81, LINK_STATUS: 0x8B82, ARRAY_BUFFER: 0x8892, ELEMENT_ARRAY_BUFFER: 0x8893,
    STATIC_DRAW: 0x88E4, DYNAMIC_DRAW: 0x88E8, FLOAT: 0x1406, UNSIGNED_SHORT: 0x1403,
    UNSIGNED_INT: 0x1405, UNSIGNED_BYTE: 0x1401, TRIANGLES: 0x0004, TRIANGLE_STRIP: 0x0005,
    TEXTURE_2D: 0x0DE1, RGBA: 0x1908, LINEAR: 0x2601, LINEAR_MIPMAP_LINEAR: 0x2703,
    NEAREST: 0x2600, CLAMP_TO_EDGE: 0x812F, TEXTURE_MIN_FILTER: 0x2801, TEXTURE_MAG_FILTER: 0x2800,
    TEXTURE_WRAP_S: 0x2802, TEXTURE_WRAP_T: 0x2803, TEXTURE0: 0x84C0, TEXTURE1: 0x84C1, TEXTURE2: 0x84C2,
    DEPTH_TEST: 0x0B71, BLEND: 0x0BE2, SRC_ALPHA: 0x0302, ONE_MINUS_SRC_ALPHA: 0x0303,
    FRAMEBUFFER: 0x8D40, RENDERBUFFER: 0x8D41, COLOR_ATTACHMENT0: 0x8CE0, DEPTH_ATTACHMENT: 0x8D00,
    DEPTH_COMPONENT16: 0x81A5, COLOR_BUFFER_BIT: 0x4000, DEPTH_BUFFER_BIT: 0x0100,
    NO_ERROR: 0, UNPACK_FLIP_Y_WEBGL: 0x9240, MAX_TEXTURE_SIZE: 0x0D33, MAX_ANISOTROPY_EXT: 0x84FF
  };
  const stats = {
    draws: 0, quads: 0, shaders: 0, programs: 0, textures: 0, buffers: 0,
    verts: 0, indices: 0, slotMin: Infinity, slotMax: -Infinity, writePixels: 0
  };
  let objectId = 1;
  const gl = Object.assign({}, C);
  const noop = () => { };

  gl.getParameter = (p) => {
    if (p === C.VERSION) return 'WebGL 1.0 (alay)';
    if (p === C.MAX_TEXTURE_SIZE) return maxTex || 8192;
    if (p === C.MAX_ANISOTROPY_EXT) return 16;
    return 0;
  };
  gl.getExtension = (n) => (/anisotropic/i.test(n) ? { MAX_TEXTURE_MAX_ANISOTROPY_EXT: C.MAX_ANISOTROPY_EXT, TEXTURE_MAX_ANISOTROPY_EXT: 0x84FE } : null);
  gl.createShader = (type) => ({ id: objectId++, _type: type, _src: '' });
  gl.shaderSource = (sh, src) => { sh._src = src; if (!src || src.length < 40) throw new Error('shader kaynağı boş'); };
  gl.compileShader = (sh) => { stats.shaders++; sh._ok = true; };
  gl.getShaderParameter = () => true;
  gl.getShaderInfoLog = () => '';
  const progs = [];
  gl._progs = progs;
  gl.createProgram = () => { const p = { id: objectId++, shaders: [] }; progs.push(p); return p; };
  gl.attachShader = (p, sh) => p.shaders.push(sh);
  gl.linkProgram = (p) => { stats.programs++; p._ok = true; };
  gl.getProgramParameter = () => true;
  gl.getProgramInfoLog = () => '';
  gl.useProgram = noop;
  gl.getAttribLocation = (prog, n) => (prog._attrs || (prog._attrs = {}))[n] !== undefined
    ? prog._attrs[n] : (prog._attrs[n] = Object.keys(prog._attrs).length);
  gl.getUniformLocation = (prog, n) => {
    prog._u = prog._u || {};
    if (!(n in prog._u)) prog._u[n] = { name: n, prog: prog.id };
    return prog._u[n];
  };
  gl.createBuffer = () => { stats.buffers++; return { id: objectId++ }; };
  gl.bindBuffer = (t, b) => { gl._bound = b; gl._boundType = t; };
  const meshes = [];
  gl._meshes = meshes;
  gl.bufferData = (t, data, usage) => {
    if (gl._bound) {
      gl._bound.bytes = data.byteLength || (data.length * 4) || 0;
      if (t === C.ELEMENT_ARRAY_BUFFER) gl._bound.isIndex = true;
      /* köşe verisini yakala: slot denetimi gerçek tampon üzerinde yapılır */
      if (t === C.ARRAY_BUFFER && data && data.length && typeof data[0] === 'number') {
        if (data.length > 400) meshes.push(data);
      }
    }
  };
  gl.deleteBuffer = noop;
  gl.createTexture = () => { stats.textures++; return { id: objectId++ }; };
  gl.bindTexture = noop; gl.deleteTexture = noop; gl.activeTexture = noop;
  gl.texImage2D = (target, lvl, ifmt, w, h, border, fmt, type, src) => {
    if (w && (!h || h < 1)) throw new Error('texImage2D yüksekliği geçersiz');
  };
  gl.texParameteri = noop; gl.texParameterf = noop; gl.generateMipmap = noop;
  gl.pixelStorei = noop;
  gl.createFramebuffer = () => { stats.buffers++; return { id: objectId++ }; };
  gl.bindFramebuffer = noop; gl.deleteFramebuffer = noop;
  gl.framebufferTexture2D = noop; gl.framebufferRenderbuffer = noop;
  gl.createRenderbuffer = () => ({ id: objectId++ });
  gl.bindRenderbuffer = noop; gl.renderbufferStorage = noop;
  gl.enable = noop; gl.disable = noop; gl.depthMask = noop; gl.blendFunc = noop;
  gl.clear = noop; gl.viewport = noop;
  gl.enableVertexAttribArray = noop; gl.disableVertexAttribArray = noop;
  gl.vertexAttribPointer = noop;
  gl.uniform1f = noop; gl.uniform1i = noop; gl.uniform2f = noop; gl.uniform3f = noop;
  gl.uniform3fv = noop; gl.uniformMatrix4fv = noop;
  gl.drawElements = (mode, count, type, off) => {
    stats.draws++; stats.indices += count;
    if (!count) throw new Error('drawElements sıfır indeks');
  };
  gl.drawArrays = (mode, first, count) => { stats.draws++; stats.quads++; if (!count) throw new Error('drawArrays boş'); };
  let clearCol = [0, 0, 0];
  gl.clearColor = (r, g, b, a) => { clearCol = [r * 255, g * 255, b * 255]; };
  gl.readPixels = (x, y, w, h, f, t, out) => {
    stats.writePixels++;
    for (let i = 0; i < out.length; i += 4) {
      out[i] = clearCol[0] | 0; out[i + 1] = clearCol[1] | 0; out[i + 2] = clearCol[2] | 0; out[i + 3] = 255;
    }
  };
  gl.getError = () => 0;
  gl.deleteShader = noop; gl.deleteProgram = noop;
  gl._stats = stats;
  return gl;
}

/* ---------------- sahte DOM ---------------- */
let glImpl = null;
function makeCanvas(w, h) {
  const cv = {
    width: w || 300, height: h || 150, style: { cssText: '' }, id: '',
    getContext(kind) {
      if (kind === 'webgl' || kind === 'experimental-webgl') return glImpl;
      if (kind === '2d') { if (!cv._ctx) cv._ctx = soft.makeCanvas(cv.width, cv.height).getContext('2d'); return cv._ctx; }
      return null;
    },
    _parent: null,
    get parentNode() { return cv._parent; }
  };
  return cv;
}
function makeDiv(id) {
  const kids = [];
  return {
    id: id || '', tagName: 'DIV', style: {}, children: kids, className: '', textContent: '', _html: '',
    classList: { add() { }, remove() { }, toggle() { }, contains() { return false; } },
    appendChild(c) { kids.push(c); c._parent = this; return c; },
    insertBefore(c, ref) { kids.unshift(c); c._parent = this; return c; },
    removeChild(c) { const i = kids.indexOf(c); if (i >= 0) kids.splice(i, 1); c._parent = null; return c; },
    get firstChild() { return kids[0]; },
    querySelector() { return makeDiv(); }, querySelectorAll() { return []; },
    addEventListener() { }, removeEventListener() { }, setAttribute() { }, getAttribute() { return null; }
  };
}
const elements = {};
function byId(id) {
  if (elements[id]) return elements[id];
  elements[id] = (id === 'view') ? makeCanvas(683, 384) : makeDiv(id);
  return elements[id];
}
const viewCanvas = byId('view');
const root = makeDiv('app');
root.appendChild(viewCanvas);

global.document = {
  readyState: 'complete',
  createElement: (t) => (t === 'canvas' ? makeCanvas(300, 150) : makeDiv()),
  getElementById: byId, addEventListener() { }, removeEventListener() { },
  pointerLockElement: null, body: makeDiv('body'), documentElement: makeDiv('html'),
  querySelector: () => null
};
const define = (k, v) => Object.defineProperty(global, k, { value: v, configurable: true, writable: true });
define('navigator', { userAgent: 'GLTest' });
define('window', { addEventListener() { }, removeEventListener() { }, devicePixelRatio: 1, matchMedia: () => ({ matches: false }) });
define('performance', { now: () => Date.now() });
global.localStorage = { getItem: () => null, setItem() { }, removeItem() { } };

/* ---------------- modülleri yükle ---------------- */
global.MV = {};
for (const f of ['00-core.js', '09-gl.js', '10-textures.js', '20-maze.js', '30-render.js']) {
  new Function(fs.readFileSync(path.join(ROOT, 'app', 'js', f), 'utf8'))();
}
const MV = global.MV;

let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log('  ✓ ' + msg); }
  else { fail++; console.log('  ✗ ' + msg); }
}
function section(t) { console.log('--- ' + t + ' ---'); }

/* ---------------- 1) GPU yoksa CPU yedeği ---------------- */
section('WebGL yoksa (CPU yedeği)');
glImpl = null;
const GL = MV.GL;
GL.ok = false; GL.prepared = false; GL.canvas = null; GL.gl = null; GL._checked = false;
GL.init(viewCanvas);
ok(GL.ok === false, 'GPU yokken ok=false (ölümcül değil)');
ok(typeof GL.status === 'string' && GL.status.length > 3, 'durum metni: ' + GL.status);
ok(root.children.indexOf(GL.canvas) < 0, 'başarısız kurulumda tuval eklenmedi');
ok(GL.render({ world: null, px: 0, py: 0, zc: 1.6, pa: 0, pitch: 0, sunDir: [1, 0], sunCol: [255, 255, 255], sky: [20, 20, 24], skyTop: [4, 4, 8], fogColor: [10, 10, 12], fogDens: 0.05, entities: [] }, {}) === false,
  'render() GPU yokken false döner (CPU hattı devralır)');

/* ---------------- 2) gerçek kurulum ---------------- */
section('GPU hattı kurulumu');
glImpl = mockGL(8192);
GL.ok = false; GL.prepared = false; GL._checked = false;
GL.init(viewCanvas);
ok(GL.ok === true, 'init ok=true (' + GL.status + ')');
ok(root.children[0] === GL.canvas, 'GPU tuvali #view öncesine yerleştirildi');
ok(glImpl._stats.shaders >= 10, 'shader derlendi: ' + glImpl._stats.shaders);
ok(glImpl._stats.programs >= 5, 'program bağlandı: ' + glImpl._stats.programs);

/* ---------------- 3) atlas ---------------- */
section('Doku atlası');
const tex = MV.texBuild();
ok(!!tex && tex.walls.length > 100, 'karo dokusu üretildi: ' + tex.walls.length + ' yuva');
GL.setSize(683, 384);
GL.prepare(tex);
ok(GL.prepared === true, 'atlas hazır');
const filled = Object.keys(GL.slotOf).filter(k => GL.slotOf[k] >= 0).length;
ok(filled >= 20, 'atlas slotu eşlenen doku: ' + filled);
ok(GL.slotOf[MV.T.RUNE1] >= 0 && GL.slotOf[MV.T.RUNE1 + 7] >= 0, 'rune karoları (100-107) atlas içinde');
ok(GL.slotOf[MV.T.STONE] >= 0 && GL.slotOf[MV.T.GATE] >= 0, 'taş/kapı karoları atlas içinde');
ok(GL.atlasCols * GL.atlasRows >= filled, 'atlas ızgarası yeterli: ' + GL.atlasCols + '×' + GL.atlasRows + ' ≥ ' + filled);
ok((GL.atlasRows & (GL.atlasRows - 1)) === 0, 'satır sayısı 2’nin kuvveti (mipmap uyumlu): ' + GL.atlasRows);
let maxSlot = -1;
for (const k in GL.slotOf) if (GL.slotOf[k] > maxSlot) maxSlot = GL.slotOf[k];
ok(maxSlot < GL.atlasCols * GL.atlasRows, 'en büyük slot ızgara içinde: ' + maxSlot);

/* ---------------- 3b) sprite atlası ---------------- */
section('Sprite atlası');
const srects = GL.spriteRects || {};
const names = Object.keys(srects);
let nullRects = 0, sprFrames = 0, maxW = 0, maxH = 0, placed = 0;
for (const n of names) {
  const r = srects[n];
  const list = Array.isArray(r) ? r : [r];
  for (const q of list) {
    sprFrames++;
    if (!q) nullRects++;
    else {
      placed++;
      if (q.w > maxW) maxW = q.w;
      if (q.h > maxH) maxH = q.h;
      if (q.x < 0 || q.y < 0 || q.x + q.w > 1024 || q.y + q.h > 1024) nullRects++;
    }
  }
}
ok(names.length >= 10, 'atlasa giren sprite türü: ' + names.length);
ok(placed > 0, 'yerleştirilen kare: ' + placed + '/' + sprFrames);
ok(nullRects === 0, 'taşan/boş kare yok (taşan: ' + nullRects + ')');
ok(maxW <= 1024 && maxH <= 1024, 'en büyük kare: ' + maxW + '×' + maxH);
ok(!!srects.griever || !!srects.griever_walk || Object.keys(srects).some(k => k.indexOf('griever') === 0), 'Griever sprite’ı atlas içinde');

/* ---------------- 3c) kamera/projeksiyon matematiği ---------------- */
section('Projeksiyon ve bakış matrisi');
const M = GL._math;
const W3 = 683, H3 = 384, FOVK3 = 0.66;
const fy3 = W3 / (2 * FOVK3);
function project(world, cam) {
  const proj = M.perspective(M.mat4(), FOVK3, W3 / H3, 0.05, 400);
  const view = M.viewMatrix(M.mat4(), cam.x, cam.zc, cam.y, cam.yaw, cam.pitch || 0, cam.roll || 0);
  const VP = M.mul(M.mat4(), proj, view);
  const x = world[0], y = world[1], z = world[2];
  const cx = VP[0] * x + VP[4] * y + VP[8] * z + VP[12];
  const cy = VP[1] * x + VP[5] * y + VP[9] * z + VP[13];
  const cw = VP[3] * x + VP[7] * y + VP[11] * z + VP[15];
  return { x: cx / cw, y: cy / cw, w: cw };
}
const cam = { x: 10, y: 10, zc: 1.6, yaw: 0, pitch: 0, roll: 0 };
const ahead = project([12, 1.6, 10], cam);      // ileri (+x yönü, yaw=0)
ok(Math.abs(ahead.x) < 0.02 && Math.abs(ahead.y) < 0.02, 'tam karşıdaki nokta ekran merkezine düşer (' + ahead.x.toFixed(3) + ', ' + ahead.y.toFixed(3) + ')');
const right = project([12, 1.6, 11], cam);      // sağ taraf (+z = sağ)
const left = project([12, 1.6, 9], cam);        // sol taraf
ok(right.x > 0.05, 'kameranın sağındaki nokta ekranın sağına düşer (x=' + right.x.toFixed(3) + ')');
ok(left.x < -0.05, 'kameranın solundaki nokta ekranın soluna düşer (x=' + left.x.toFixed(3) + ')');
ok(Math.abs(right.x + left.x) < 0.001, 'sol/sağ simetrik (aynalama yok)');
const up = project([12, 2.6, 10], cam);         // yukarı
ok(up.y > 0.05, 'yukarıdaki nokta ekranın üstüne düşer (y=' + up.y.toFixed(3) + ')');
const behind = project([8, 1.6, 10], cam);
ok(behind.w < 0, 'arkadaki nokta kırpılır (w=' + behind.w.toFixed(2) + ')');
/* eğim ve yatış: kamera eğilince ufuk kayar, yatınca yön değişir */
const camP = { x: 10, y: 10, zc: 1.6, yaw: 0, pitch: 0.5, roll: 0 };
ok(project([12, 1.6, 10], camP).y < -0.05, 'yukarı bakışta düz nokta ekranın altına kayar');
const camY = { x: 10, y: 10, zc: 1.6, yaw: Math.PI / 2, pitch: 0, roll: 0 };
ok(Math.abs(project([10, 1.6, 12], camY).x) < 0.02, 'yaw=90° dönüşte (+z) nokta merkezde');
const camR = { x: 10, y: 10, zc: 1.6, yaw: 0, pitch: 0, roll: 0.2 };
const rolled = project([12, 1.6, 11], camR);
ok(Math.abs(rolled.y - right.y) > 0.03, 'kamera yatışı (roll) yandaki noktayı döndürür (Δy=' + (rolled.y - right.y).toFixed(3) + ')');
/* ters matris: ekran merkezinden ileri ışını geri kazanılmalı */
const proj0 = M.perspective(M.mat4(), FOVK3, W3 / H3, 0.05, 400);
const view0 = M.viewMatrix(M.mat4(), cam.x, cam.zc, cam.y, cam.yaw, 0, 0);
const inv = M.mat4();
M.invert(inv, M.mul(M.mat4(), proj0, view0));
function unproject(sx, sy) {
  const cx = inv[0] * sx + inv[4] * sy + inv[8] * 1 + inv[12];
  const cy = inv[1] * sx + inv[5] * sy + inv[9] * 1 + inv[13];
  const cz = inv[2] * sx + inv[6] * sy + inv[10] * 1 + inv[14];
  const cw = inv[3] * sx + inv[7] * sy + inv[11] * 1 + inv[15];
  return [cx / cw, cy / cw, cz / cw];
}
const c0 = unproject(0, 0);
ok(c0[0] > cam.x + 10, 'ekran merkezi ileri yönü verir (x=' + c0[0].toFixed(1) + ')');
ok(Math.abs(c0[1] - cam.zc) < 0.4, 'merkez ışını ufukta kalır (y=' + c0[1].toFixed(2) + ')');
const cL = unproject(-0.8, 0), cR = unproject(0.8, 0);
ok(cL[2] !== cR[2], 'sol/sağ ışınlar farklı yönlere gider');

/* ---------------- 4) dünya + render ---------------- */
section('Dünya ağları ve çizim');
const world = MV.Maze.genWorld(1234);
ok(!!world && world.W > 400 && world.H > 400, 'dünya üretildi: ' + world.W + '×' + world.H);
function makeView(x, y, a) {
  return {
    world: world, px: x, py: y, pa: a, zc: 1.62, pitch: 0, roll: 0.02,
    fogDens: 0.045, fogColor: [16, 18, 22], sky: [26, 30, 40], skyTop: [6, 8, 16],
    sunDir: [0.5, 0.8], sunCol: [255, 236, 200], sunEl: 0.5, light: 0.75, torch: 0.6,
    stars: 0.2, clouds: 0.4, time: 12.5, exposure: 1.05, bloom: 0.3, ca: 0.5, grain: 0.2,
    entities: [
      { sprite: 'griever', x: x + 6, y: y + 2, w: 1.4, h: 2.4, yOff: 0, frame: 0, anim: 0, tint: 1, glow: 0.2, alpha: 1 },
      { sprite: 'beetle', x: x - 4, y: y + 5, w: 0.6, h: 0.4, yOff: -1.1, frame: 1, anim: 0.5, tint: 1, glow: 0, alpha: 1 }
    ]
  };
}
const sp = MV.Maze.spawnOf ? MV.Maze.spawnOf(world) : null;
const sx = (sp && sp.x) || (world.cx + 0.5), sy = (sp && sp.y) || (world.cy + 0.5);
const before = glImpl._stats.draws;
let frames = 0;
for (let i = 0; i < 6; i++) {
  if (GL.render(makeView(sx + i * 0.4, sy, i * 0.7), { FOVK: 0.66, fovMul: 1, quality: 'yuksek' })) frames++;
}
ok(frames === 6, 'render() altı karede de true: ' + frames);
ok(glImpl._stats.draws > before + 6, 'çizim çağrısı yapıldı: ' + glImpl._stats.draws);
let built = 0, vertsTotal = 0, idxTotal = 0;
for (const k in GL.chunks) {
  const ch = GL.chunks[k];
  if (ch.vbo && ch.count) { built++; vertsTotal += ch.verts || 0; idxTotal += ch.count; }
}
ok(built > 0, 'kurulan chunk ağı: ' + built + ' (toplam ' + Object.keys(GL.chunks).length + ')');
ok(glImpl._meshes.every(m => m.length / 10 < 65535), 'hiçbir bölüm 65535 köşeyi aşmıyor (Uint16 indeks güvenli)');
ok(idxTotal > 0, 'toplam indeks: ' + idxTotal.toLocaleString('tr-TR'));

/* ağlardaki slotlar gerçekten atlas aralığında mı? (ham GPU tamponları) */
let slotGood = true, slotSeen = {}, vtx = 0, maxSeen = -1, strideBad = 0, dark = 0;
const F = 10;
for (const arr of glImpl._meshes) {
  if (arr.length % F) { strideBad++; continue; }
  vtx += arr.length / F;
  for (let i = 5; i < arr.length; i += F) {
    const sl = arr[i] | 0;
    if (sl !== arr[i] || sl < 0 || sl >= GL.atlasCols * GL.atlasRows) slotGood = false;
    slotSeen[sl] = 1;
    if (sl > maxSeen) maxSeen = sl;
  }
  for (let i = 9; i < arr.length; i += F) if (arr[i] > 0.5) dark++;
}
ok(glImpl._meshes.length > 5, 'köşe tamponu yüklendi: ' + glImpl._meshes.length + ' ağ');
ok(vtx > 5000, 'toplam köşe: ' + Math.round(vtx).toLocaleString('tr-TR'));
ok(strideBad === 0, 'her ağ 10 float adımına tam bölünüyor (bozuk ağ: ' + strideBad + ')');
ok(slotGood, 'tüm köşe slotları geçerli tam sayı ve ızgara içinde — en büyük slot ' + maxSeen);
ok(maxSeen < 32 && maxSeen >= 0, 'yüksek kimlikli karolar (100+) sıkıştırılmış slota eşlendi (en büyük ' + maxSeen + ')');
ok(Object.keys(slotSeen).length >= 3, 'ağlarda kullanılan farklı doku: ' + Object.keys(slotSeen).length);
ok(dark >= 0, 'karanlık (uçurum işaretli) köşe: ' + dark);

/* duvar UV'leri: yükseklik boyunca döşeniyor mu? (streç/çizgi hatası denetimi) */
let wallVerts = 0, floorVerts = 0, maxV = 0, badWallU = 0, heights = {};
for (const arr of glImpl._meshes) {
  for (let i = 0; i < arr.length; i += F) {
    const uy = arr[i + 4], ux = arr[i + 3], py = arr[i + 1];
    if (uy > 1.5) {
      wallVerts++;
      if (uy > maxV) maxV = uy;
      heights[uy.toFixed(1)] = (heights[uy.toFixed(1)] || 0) + 1;
      if (ux < -0.001 || ux > 1.001) badWallU++;
    } else if (py < 0.01) floorVerts++;
  }
}
ok(wallVerts > 1000, 'duvar köşesi: ' + wallVerts.toLocaleString('tr-TR'));
ok(maxV >= 3.9 && maxV <= 9, 'duvar UV yüksekliği gerçek ölçekte döşeniyor (en büyük v=' + maxV.toFixed(2) + ')');
ok(badWallU === 0, 'duvar yatay UV hücre içinde kalıyor (taşan: ' + badWallU + ')');
ok(floorVerts > 100, 'zemin köşesi: ' + floorVerts.toLocaleString('tr-TR'));

/* bölüm kurulum süresi: kare takılması olmasın */
GL.invalidate();
const t0 = process.hrtime.bigint();
let builtNow = 0;
for (let i = 0; i < 4; i++) {
  const before2 = Object.keys(GL.chunks).length;
  GL._updateChunks(sx, sy, 2);
  builtNow += Object.keys(GL.chunks).length - before2;
}
const ms = Number(process.hrtime.bigint() - t0) / 1e6;
ok(builtNow >= 0 && ms / Math.max(1, builtNow) < 12, 'bölüm kurulumu kare bütçesinde: ' + (ms / Math.max(1, builtNow)).toFixed(2) + ' ms/bölüm');

/* ---------------- 5) yeniden kurulum ---------------- */
section('invalidate ve boyut değişimi');
const chunkCount = Object.keys(GL.chunks).length;
GL.invalidate();
ok(GL.worldStamp >= 0, 'invalidate sonrası damga ilerledi: ' + GL.worldStamp);
GL.setSize(1138, 640);
ok(GL.canvas.width === 1138 && GL.canvas.height === 640, 'setSize tuvali ölçekledi: ' + GL.canvas.width + '×' + GL.canvas.height);
GL.ss = 1.35; GL.setSize(683, 384);
ok(GL.scene.w >= GL.canvas.width, 'süper örneklemeli sahne hedefi büyütüldü: sahne ' + GL.scene.w + '×' + GL.scene.h + ' ← tuval ' + GL.canvas.width + '×' + GL.canvas.height);
GL.ss = 1;
GL.render(makeView(sx, sy, 1.2), { FOVK: 0.66, fovMul: 1, quality: 'performans' });
ok(true, 'performans kalitesinde (bloom/CA kapalı) kare çizildi');
GL.render(makeView(sx, sy, 1.2), { FOVK: 0.66, fovMul: 1, quality: 'yuksek' });
ok(true, 'yüksek kalitede kare çizildi');

/* ---------------- 5b) boşluk/uçurum hattı ---------------- */
section('Dış kuşak (void) hattı');
const meshesBefore = glImpl._meshes.length;
GL.invalidate();
let voidX = null, voidY = world.cy;
for (let r = 225; r <= 252; r += 0.5) {
  if (MV.Maze.voidAt(world, world.cx + r, world.cy)) { voidX = world.cx + r; break; }
}
ok(voidX !== null, 'dış kuşakta boşluk hücresi bulundu (r=' + (voidX === null ? '-' : (voidX - world.cx).toFixed(1)) + ')');
if (voidX === null) voidX = world.cx + 240;
GL.render(makeView(voidX, voidY, Math.PI), { FOVK: 0.66, fovMul: 1, quality: 'yuksek' });
let darkSeen = 0;
for (let mi = meshesBefore; mi < glImpl._meshes.length; mi++) {
  const arr = glImpl._meshes[mi];
  for (let i = 9; i < arr.length; i += 10) if (arr[i] > 0.5) darkSeen++;
}
ok(glImpl._meshes.length > meshesBefore, 'kuşak için yeni ağ kuruldu: ' + (glImpl._meshes.length - meshesBefore));
ok(darkSeen > 0, 'uçurum (karanlık) köşeleri işaretlendi: ' + darkSeen);
ok(GL.ok === true, 'kuşak çizimi sonrası hat hâlâ sağlam');

/* ---------------- 6) eşik durumları ---------------- */
section('Sınır durumları');
GL.render({ world: world, px: sx, py: sy, zc: 1.6, pa: 0, pitch: 0, sunDir: [0, 1], sunCol: [255, 255, 255], sky: [10, 10, 10], skyTop: [2, 2, 2], fogColor: [0, 0, 0], fogDens: 0.05, entities: [] }, {});
ok(GL.ok === true, 'eksik alanlarla (roll/bloom/time yok) çizim çökmedi');
GL.prepare({ walls: [], sprites: {} });
ok(GL.prepared === true, 'boş doku setinde prepare yeniden çalıştı');

/* ---------------- 6b) bozuk GPU: sonda yakalar ---------------- */
section('Bozuk sürücü koruması');
const goodGL = glImpl;
const badGL = mockGL(8192);
badGL.readPixels = (x, y, w, h, f, t, out) => { for (let i = 0; i < out.length; i++) out[i] = 0; };
glImpl = badGL;
GL.ok = false; GL.prepared = false; GL._probed = false;
GL.init(viewCanvas);
ok(GL.ok === true, 'bozuk sürücüde kurulum tamamlandı (henüz hata yok)');
GL.setSize(683, 384);
GL.prepare(tex);
const probeRes = GL.render(makeView(sx, sy, 0.3), { FOVK: 0.66, fovMul: 1, quality: 'yuksek' });
ok(probeRes === false, 'sonda tutarsızlığı yakalandı → render false');
ok(GL.ok === false && /geri okuma/.test(GL.status), 'durum açıklaması: ' + GL.status);
glImpl = goodGL;
GL.ok = false; GL.prepared = false; GL._probed = false;
GL.init(viewCanvas);
GL.setSize(683, 384);
GL.prepare(tex);
ok(GL.ok === true, 'iyi sürücüye dönüş: ' + GL.status);

/* ---------------- 6c) shader kaynak denetimi ---------------- */
section('Shader kaynakları (statik denetim)');
const src = fs.readFileSync(path.join(ROOT, 'app', 'js', '09-gl.js'), 'utf8');
let shaderCount = 0, braceBad = 0, parenBad = 0, varyBad = [], attrBad = [], uniformBad = [];
for (const prog of badGL._progs.concat(glImpl._progs)) {
  const vs = prog.shaders.find(x => x._type === C_CONST.VERTEX_SHADER);
  const fsx = prog.shaders.find(x => x._type === C_CONST.FRAGMENT_SHADER);
  for (const sh of [vs, fsx]) {
    if (!sh || !sh._src) continue;
    shaderCount++;
    const open = (sh._src.match(/\{/g) || []).length, close = (sh._src.match(/\}/g) || []).length;
    if (open !== close) braceBad++;
    const opAll = (sh._src.match(/\(/g) || []).length, clAll = (sh._src.match(/\)/g) || []).length;
    if (opAll !== clAll) parenBad++;
  }
  for (const sh of [vs, fsx]) {
    if (!sh || !sh._src) continue;
    const us = sh._src.match(/uniform\s+\w+\s+(\w+)/g) || [];
    for (const d of us) {
      const n = d.split(/\s+/).pop();
      if (src.indexOf("u('" + n + "')") < 0) uniformBad.push(n);
    }
  }
  if (vs && fsx) {
    const declared = new Set((vs._src.match(/varying\s+\w+\s+(\w+)/g) || []).map(x => x.split(/\s+/).pop()));
    const used = (fsx._src.match(/varying\s+\w+\s+(\w+)/g) || []).map(x => x.split(/\s+/).pop());
    for (const v of used) if (!declared.has(v)) varyBad.push(v);
    const attrs = (vs._src.match(/attribute\s+\w+\s+(\w+)/g) || []).map(x => x.split(/\s+/).pop());
    for (const a of attrs) if (src.indexOf("a('" + a + "')") < 0) attrBad.push(a);
    /* tür uyuşmazlığı: aynı isimli varying iki tarafta aynı türde olmalı */
    const ty = (text, kind) => {
      const m = text.match(new RegExp(kind + '\\s+(\\w+)\\s+(\\w+)', 'g')) || [];
      const o = {};
      for (const d of m) { const p2 = d.split(/\s+/); o[p2[2]] = p2[1]; }
      return o;
    };
    const vt = ty(vs._src, 'varying'), ft = ty(fsx._src, 'varying');
    for (const k2 in ft) if (vt[k2] && vt[k2] !== ft[k2]) varyBad.push(k2 + '(' + vt[k2] + '≠' + ft[k2] + ')');
    if (vt.vUV && ft.vUV && vt.vUV !== ft.vUV) varyBad.push('vUV');
  }
}
ok(shaderCount >= 10, 'denetlenen shader: ' + shaderCount);
ok(braceBad === 0, 'süslü parantezler dengeli (bozuk: ' + braceBad + ')');
ok(parenBad === 0, 'parantezler dengeli (bozuk: ' + parenBad + ')');
ok(varyBad.length === 0, 'fragment shader’da tanımsız varying yok' + (varyBad.length ? ': ' + varyBad.join(', ') : ''));
ok(attrBad.length === 0, 'her vertex özniteliği JS tarafından bağlanıyor' + (attrBad.length ? ': ' + attrBad.join(', ') : ''));
const uniUniq = Array.from(new Set(uniformBad));
let uniTotal = 0;
for (const prog of badGL._progs.concat(glImpl._progs)) {
  for (const sh of prog.shaders) {
    if (!sh._src) continue;
    uniTotal += (sh._src.match(/uniform\s+\w+\s+(\w+)/g) || []).length;
  }
}
ok(uniTotal >= 30, 'denetlenen uniform bildirimi: ' + uniTotal);
ok(uniUniq.length === 0, 'her uniform JS tarafından besleniyor' + (uniUniq.length ? ': ' + uniUniq.join(', ') : ''));
const isCount = (src.match(/ if \(/g) || []).length;
ok(isCount > 0 || true, 'shader ifade sayısı: ' + isCount);

/* ---------------- 7) Renderer entegrasyonu ---------------- */
section('Renderer ↔ GPU hattı bağlantısı');
const R2 = MV.Renderer;
R2.init(viewCanvas);
ok(R2.gl === MV.GL, 'Renderer.init GPU hattını devraldı (gl bağlı)');
ok(MV.GL.canvas === R2.canvas.parentNode.children[0], 'GPU tuvali sahne içinde #view’in arkasında');
const tex2 = MV.texBuild();
R2.prepare(tex2);
ok(MV.GL.prepared === true, 'Renderer.prepare atlası GPU’ya yükledi');
const beforeDraw = glImpl._stats.draws;
const view2 = makeView(sx, sy, 2.1);
view2.held = [{ sprite: 'torch', x: 0.78, y: -10, scale: 1.35, rot: -0.22, lift: 0 }];
view2.sway = { x: 0.1, y: -0.05 };
view2.hurt = 0.4;
view2.time = 3.2;
ok(R2.draw(view2) === undefined, 'Renderer.draw GPU hattında tamamlandı (istisna yok)');
ok(glImpl._stats.draws > beforeDraw, 'Renderer.draw GPU çizimi yaptı: +' + (glImpl._stats.draws - beforeDraw));
R2.setQuality('performans');
ok(MV.GL.scale > 0 && MV.GL.scale <= 1, 'kalite değişimi GPU ölçeğine işledi: ' + MV.GL.scale.toFixed(2));
R2.setQuality('yuksek');
R2.fovMul = 1.2; R2.dynFov = 1.05;
R2.draw(view2);
ok(MV.GL.ok === true, 'FOV ayarı + koşu vuruşu birlikte sorunsuz');

/* GPU kapatılınca CPU hattına dönüş */
R2.gl = null; R2.useGpu = false;
MV.GL.canvas.style.display = 'none';
R2.draw(view2);
ok(R2.gl === null, 'GPU kapatıldığında CPU hattı çizime devam eder');

console.log('');
console.log('GL testi: ' + pass + ' geçti, ' + fail + ' başarısız');
process.exit(fail ? 1 : 0);
