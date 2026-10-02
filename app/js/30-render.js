/* ============================================================
   30-render.js — yazılım raycaster, "profesyonel" render hattı
   • dinamik iç çözünürlük (hedef FPS'e göre ölçeklenir) + çift doğrusal yükseltme
   • zemin VE tavan doku izdüşümü; Kayran'da açık gökyüzü tavanı
   • normal haritalı dinamik aydınlatma: güneş/ay + fener (nokta ışık) + parlama
   • gölge, kendinden ışıklı sprite'lar, kare animasyonlu yaratıklar
   • sinema sonrası katman: renk derecelendirme, bloom, vinyet, film gren, renk sapması
   ============================================================ */
(function (MV) {
  'use strict';
  const { clamp, lerp, rgba } = MV;

  const QUALITY_H = { yuksek: 640, orta: 512, performans: 384 };

  const R = {
    canvas: null, ctx: null,
    buf: null, bctx: null, img: null, buf32: null, zbuf: null,
    W: 0, H: 0, dispW: 0, dispH: 0,
    quality: 'orta', targetH: 540, scale: 1.0, autoScale: true,
    fovMul: 1.0, _fov: 0.66, FOVK: 0.66, dynFov: 1,
    filter: 1,                     // 1: çift doğrusal doku örnekleme
    perf: { acc: 0, n: 0, avg: 16.7, cool: 0 },
    bloomCv: null, bloomCtx: null, noise: [], noiseIdx: 0,
    vignette: null, vigW: 0, vigH: 0,
    texData: { walls: [], normals: [], spec: [], variant: [], sprites: {}, ceil: null, ceilNormal: null },

    /* ---------------- kurulum ---------------- */
    init(canvas) {
      this.canvas = canvas;
      /* GPU hattı önce denenir: başarırsa #view yalnızca saydam kaplama
         katmanı olur (elde tutulan eşya, fener konisi, hasar kenarı) */
      this.gl = null;
      if (MV.GL) {
        MV.GL.init(canvas);
        if (MV.GL.ok) this.gl = MV.GL;
        this.glStatus = MV.GL.status;
      }
      this.ctx = canvas.getContext('2d', this.gl ? { alpha: true } : { alpha: false });
      this.buf = MV.makeCanvas(320, 180);
      this.bctx = this.buf.getContext('2d');
      this.bloomCv = MV.makeCanvas(160, 90);
      this.bloomCtx = this.bloomCv.getContext('2d');
      this.buildNoise();
      this.buildSkyTextures();
      this.resize();
      if (typeof document !== 'undefined' && document.documentElement && document.documentElement.setAttribute) {
        document.documentElement.setAttribute('data-raster', this.gl ? 'gl' : 'cpu');
      }
    },
    setQuality(q) {
      this.quality = q || 'orta';
      this.targetH = QUALITY_H[this.quality] || 540;
      this.scale = 1.0;
      this.filter = this.quality === 'yuksek' ? 1 : 0;   // çift doğrusal doku yalnızca yüksekte
      if (this.gl) {
        /* ölçek: dahili çözünürlük · ss: süper örnekleme (kenar yumuşatma) */
        this.gl.scale = this.quality === 'performans' ? 0.8 : (this.quality === 'orta' ? 0.95 : 1.0);
        this.gl.ss = this.quality === 'performans' ? 1.0 : (this.quality === 'orta' ? 1.15 : 1.35);
      }
      this.resize();
    },
    setScale(s) { this.scale = clamp(s, 0.45, 1.4); if (this.gl) this.gl.scale = this.scale; this.resize(); },
    /* görünür tuval = pencere boyutu (donanım hızlandırmalı yükseltme),
       iç tampon = kaliteye göre düşük çözünürlük (CPU raycaster) */
    resize() {
      const cv = this.canvas;
      if (!cv) return;
      const dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
      const cw = Math.max(320, Math.round((cv.clientWidth || cv.width || 1280) * dpr));
      const ch = Math.max(200, Math.round((cv.clientHeight || cv.height || 720) * dpr));
      const maxW = 2560, maxH = 1440;
      const s = Math.min(1, maxW / cw, maxH / ch);
      this.dispW = Math.max(320, Math.round(cw * s));
      this.dispH = Math.max(200, Math.round(ch * s));
      cv.width = this.dispW; cv.height = this.dispH;

      const scale = this.scale;
      const ih = Math.max(200, Math.round(this.targetH * scale));
      const iw = Math.max(288, Math.round(ih * (this.dispW / this.dispH)));
      if (iw !== this.W || ih !== this.H) {
        this.W = iw; this.H = ih;
        this.buf.width = iw; this.buf.height = ih;
        this.bctx = this.buf.getContext('2d');
        this.img = this.bctx.createImageData(iw, ih);
        this.buf32 = new Uint32Array(this.img.data.buffer);
        this.zbuf = new Float32Array(iw);
      }
      this.bloomCv.width = Math.max(40, iw >> 2);
      this.bloomCv.height = Math.max(24, ih >> 2);
      this.bloomCtx = this.bloomCv.getContext('2d');
      this.vignette = null;
      this.ctx.imageSmoothingEnabled = true;
      if ('imageSmoothingQuality' in this.ctx) this.ctx.imageSmoothingQuality = 'high';
      if (this.gl) this.gl.setSize(this.dispW, this.dispH);
    },

    /* bulut ve yıldız dokuları: bir kez üretilir, GPU katmanında döşenir */
    buildSkyTextures() {
      const mk = (w, h, fn) => {
        const c = MV.makeCanvas(w, h), ctx = c.getContext('2d');
        if (!ctx) return null;
        const im = ctx.createImageData(w, h);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          const col = fn(x, y);
          const i = (y * w + x) * 4;
          im.data[i] = col[0]; im.data[i + 1] = col[1]; im.data[i + 2] = col[2]; im.data[i + 3] = col[3];
        }
        ctx.putImageData(im, 0, 0);
        return c;
      };
      /* bulut: yumuşak fbm, şeffaf kenarlı */
      this.cloud = mk(512, 192, (x, y) => {
        const n = MV.fbm(x / 512 * 5, y / 192 * 2.2, 5, 5, 777);
        const c = (n - 0.50) * 3.0;
        const a = clamp(c, 0, 1);
        const bright = 226 - (1 - a) * 30;
        return [bright, bright, bright + 6, a * a * 210 | 0];
      });
      /* yıldız alanı */
      this.starfield = mk(512, 256, (x, y) => {
        const s = MV.h2(x, y, 5150);
        if (s > 0.9975) {
          const br = 150 + ((s * 977) % 105);
          return [br, br, Math.min(255, br + 30), 255];
        }
        return [0, 0, 0, 0];
      });
    },

    /* film gren için önceden üretilmiş gürültü karoları */
    buildNoise() {
      const n = MV.makeCanvas(128, 128), c = n.getContext('2d');
      if (!c) return;
      const im = c.createImageData(128, 128);
      const rng = MV.RNG(9911);
      for (let i = 0; i < 128 * 128; i++) {
        const v = 110 + rng() * 46;
        im.data[i * 4] = v; im.data[i * 4 + 1] = v; im.data[i * 4 + 2] = v; im.data[i * 4 + 3] = 26;
      }
      c.putImageData(im, 0, 0);
      this.noise = [n];
    },

    /* ---------------- doku verisi ---------------- */
    prepare(tex) {
      const grabCanvas = (canvas) => {
        if (!canvas || !canvas.getContext) return null;
        if (canvas._data) return canvas._data;
        const c = canvas.getContext('2d');
        const d = c.getImageData(0, 0, canvas.width, canvas.height);
        canvas._data = new Uint32Array(d.data.buffer.slice(0));
        canvas._w = canvas.width; canvas._h = canvas.height;
        return canvas._data;
      };
      const td = { walls: [], normals: [], spec: [], variant: [], sprites: {}, ceil: null, ceilNormal: null, ceilSpec: null };
      for (let i = 0; i < tex.walls.length; i++) {
        td.walls[i] = grabCanvas(tex.walls[i]);
        td.normals[i] = tex.walls[i] && tex.walls[i]._normal ? tex.walls[i]._normal : null;
        td.spec[i] = tex.walls[i] && tex.walls[i]._spec ? tex.walls[i]._spec : null;
      }
      for (const k in tex.variant) {
        td.variant[k] = tex.variant[k].map(cv => ({
          data: grabCanvas(cv),
          normal: cv && cv._normal ? cv._normal : null
        })).filter(v => v.data);
      }
      for (const k in tex.sprites) {
        const cv = tex.sprites[k];
        if (Array.isArray(cv)) {
          td.sprites[k] = { frames: cv.map(c => ({ data: grabCanvas(c), w: c.width, h: c.height, canvas: c })), w: cv[0].width, h: cv[0].height };
        } else if (cv) {
          td.sprites[k] = { data: grabCanvas(cv), w: cv.width, h: cv.height, canvas: cv, frames: null };
        }
      }
      const ceilTex = tex.walls[MV.T.CEIL];
      td.ceil = grabCanvas(ceilTex);
      td.ceilNormal = ceilTex && ceilTex._normal ? ceilTex._normal : null;
      td.ceilSpec = ceilTex && ceilTex._spec ? ceilTex._spec : null;

      // zemin dokuları için hızlı dizin (id → varyant listesi)
      td.floorIdx = [];
      for (let i = 0; i < 40; i++) {
        const arr = td.variant[i];
        td.floorIdx[i] = (arr && arr.length) ? arr : (td.walls[i] ? [{ data: td.walls[i], normal: td.normals[i] }] : null);
      }
      this.texData = td;
      this.tex = tex;
      if (this.gl && !this.gl.prepared) this.gl.prepare(tex);
      this.TS = tex.walls[1] ? tex.walls[1].width : 128;
      this.TMASK = this.TS - 1;
      this.TSHIFT = Math.round(Math.log2(this.TS));
    },
    spriteData(name) { return this.texData.sprites[name]; },

    /* ---------------- performans: dinamik çözünürlük ---------------- */
    tick(dt) {
      /* GPU: ölçek zaten kalite ayarından gelir, yalnızca ağır sahnelerde kıs */
      if (this.gl && this.gl.ok) {
        if (this.autoScale) {
          const p = this.perf;
          p.acc += dt; p.n++;
          if (p.n >= 40) {
            p.avg = p.acc / p.n * 1000;
            p.acc = 0; p.n = 0;
            if (p.avg > 24 && this.gl.scale > 0.7) { this.gl.scale = Math.max(0.7, this.gl.scale - 0.05); this.resize(); }
            else if (p.avg < 12 && this.gl.scale < 1.0) { this.gl.scale = Math.min(1.0, this.gl.scale + 0.05); this.resize(); }
          }
        }
        return;
      }
      const p = this.perf;
      p.acc += dt; p.n++;
      if (p.n >= 30) {
        p.avg = p.acc / p.n * 1000;
        p.acc = 0; p.n = 0;
        if (this.autoScale && p.cool <= 0) {
          const want = this.targetH * this.scale;
          if (p.avg > 20.5 && this.scale > 0.5) { this.scale = Math.max(0.5, this.scale - 0.07); this.setScale(this.scale); p.cool = 2; }
          else if (p.avg < 13 && this.scale < 1.0) { this.scale = Math.min(1.0, this.scale + 0.05); this.setScale(this.scale); p.cool = 3; }
        }
      }
      if (p.cool > 0) p.cool -= dt / 30;
    },

    /* ============================================================
       ANA ÇİZİM
       ============================================================ */
    draw(v) {
      /* ---- GPU hattı ---- */
      if (this.gl && this.gl.ok && this.gl.prepared) {
        if (this.gl.worldRef && this.gl.worldRef !== v.world) { /* dünya değişti */ }
        if (this.gl.render(v, this)) {
          this.drawOverlay(v);
          return;
        }
      }
      const W = this.W, H = this.H;
      const world = v.world;
      const px = v.px, py = v.py, pa = v.pa;
      const zc = v.zc, pitch = v.pitch || 0;
      /* oyuncu FOV ayarı (fovMul) ile koşu/nişan vuruşu (dynFov) ayrı çarpılır */
      const FOVK = this.FOVK * (this.fovMul || 1) * (this.dynFov || 1);
      this._fov = FOVK;
      const fx = W / (2 * FOVK), fy = fx;
      const horizon = H * 0.5 + pitch;
      const dirX = Math.cos(pa), dirY = Math.sin(pa);
      const planeX = -dirY * FOVK, planeY = dirX * FOVK;
      const buf = this.buf32, zb = this.zbuf;

      /* gökyüzü GPU katmanına taşındı: tamponda ufkun üstü şeffaf kalır */
      const skyRows = Math.max(0, Math.min(H, Math.ceil(horizon)));
      if (skyRows > 0) this.img.data.fill(0, 0, skyRows * W * 4);
      /* tavan (kapalı alan) ve zemin */
      this.castPlanes(buf, W, H, horizon, px, py, dirX, dirY, planeX, planeY, zc, fy, v);
      /* duvarlar */
      this.castWalls(buf, zb, W, H, horizon, px, py, dirX, dirY, planeX, planeY, zc, fy, v);
      /* yaratık/eşya gölgeleri (yarı saydam, duvarlardan önce) */
      this.castShadows(buf, W, H, horizon, fy, px, py, dirX, dirY, planeX, planeY, v);
      /* sprite'lar */
      this.castSprites(buf, zb, W, H, horizon, px, py, dirX, dirY, planeX, planeY, zc, fy, v);
      /* elde tutulan eşya (dünya katmanının üstünde, post'tan önce) */
      this.drawHeld(v);

      this.bctx.putImageData(this.img, 0, 0);
      this.post(v);
    },

    /* ---------------- gökyüzü: gradyan + güneş/ay + bulut + yıldız ---------------- */
    castSky(buf, W, H, horizon, px, py, dirX, dirY, planeX, planeY, v) {
      const top = v.skyTop, hor = v.sky;
      const skyH = Math.max(0, Math.min(H, Math.ceil(horizon)));
      for (let y = 0; y < skyH; y++) {
        const t = clamp(y / Math.max(1, horizon), 0, 1);
        const k = t * t;
        buf.fill(rgba(lerp(hor[0], top[0], k) | 0, lerp(hor[1], top[1], k) | 0, lerp(hor[2], top[2], k) | 0, 255), y * W, y * W + W);
      }
      /* yıldızlar */
      if (v.stars > 0) {
        const lim = Math.min(skyH, horizon * 0.92);
        for (let y = 0; y < lim; y += 2) {
          const row = y * W;
          for (let x = 0; x < W; x++) {
            const s = MV.h2(x, y, 5150);
            if (s > 0.9986 - v.stars * 0.0009) {
              const tw = 0.55 + 0.45 * Math.sin(v.time * 2.4 + s * 40);
              const br = (150 + ((s * 977) % 105)) * tw * v.stars | 0;
              buf[row + x] = rgba(br, br, Math.min(255, br + 30), 255);
            }
          }
        }
      }
      /* güneş / ay diski + hale */
      if (v.sun && skyH > 4) {
        const rel = Math.atan2(v.sun.y - py, v.sun.x - px) - Math.atan2(dirY, dirX);
        let a = rel; while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2;
        const sx = Math.round((W / 2) * (1 + Math.tan(a) / (this._fov || this.FOVK)));
        const sy = Math.round(horizon - v.sunEl * H * 0.55);
        const r = Math.max(6, Math.round(H * 0.055));
        if (sx > -r * 3 && sx < W + r * 3) {
          for (let y = Math.max(0, sy - r * 3); y < Math.min(skyH, sy + r * 3); y++) {
            for (let x = Math.max(0, sx - r * 3); x < Math.min(W, sx + r * 3); x++) {
              const d = Math.hypot(x - sx, y - sy);
              if (d > r * 3) continue;
              const core = clamp(1 - d / r, 0, 1);
              const halo = Math.pow(clamp(1 - d / (r * 3), 0, 1), 2.4) * 0.55;
              const add = core * core * 0.95 + halo;
              if (add < 0.02) continue;
              const i = y * W + x, t0 = buf[i];
              const r0 = (t0 & 255), g0 = (t0 >>> 8) & 255, b0 = (t0 >>> 16) & 255;
              buf[i] = rgba(
                Math.min(255, r0 + v.sunCol[0] * add) | 0,
                Math.min(255, g0 + v.sunCol[1] * add) | 0,
                Math.min(255, b0 + v.sunCol[2] * add) | 0, 255);
            }
          }
        }
      }
      /* bulutlar: yumuşak fbm katmanı, hafif kayar */
      if (v.clouds > 0.02 && skyH > 6) {
        const t0 = v.time * 0.006;
        for (let y = 0; y < skyH; y++) {
          const yy = (y / Math.max(1, horizon)) * 3.2;
          const row = y * W;
          const fade = clamp((y / Math.max(1, skyH)) * 1.5, 0, 1) * v.clouds;
          if (fade <= 0.02) continue;
          for (let x = 0; x < W; x += 1) {
            const n = MV.fbm(x / W * 6 + t0, yy, 6, 4, 777);
            const c = (n - 0.52) * 2.6;
            if (c <= 0) continue;
            const a = clamp(c, 0, 1) * fade * 0.55;
            const i = row + x, t = buf[i];
            const r0 = t & 255, g0 = (t >>> 8) & 255, b0 = (t >>> 16) & 255;
            const cr = 214, cg = 218, cb = 224;
            buf[i] = rgba(r0 + (cr - r0) * a | 0, g0 + (cg - g0) * a | 0, b0 + (cb - b0) * a | 0, 255);
          }
        }
      }
    },

    /* ---------------- tavan ve zemin izdüşümü ----------------
       İki satırda bir hesaplanır (yarı çözünürlük), sonuç iki satıra yazılır:
       yükseltme zaten çift doğrusal olduğu için fark neredeyse görünmez,
       CPU maliyeti yarıya iner. */
    castPlanes(buf, W, H, horizon, px, py, dirX, dirY, planeX, planeY, zc, fy, v) {
      const fd = this.texData.floorIdx;
      const world = v.world;
      const TS = this.TS, TM = this.TMASK, SH = this.TSHIFT;
      const light = v.light, torch = v.torch, sun = v.sunDir;
      const fogR = v.fogColor[0], fogG = v.fogColor[1], fogB = v.fogColor[2], fogD = v.fogDens;
      const skyCol = v.sky, skyTop = v.skyTop;
      const gladeR = MV.K.R1 - 0.5;
      const glade2 = gladeR * gladeR;
      const ceilData = this.texData.ceil, ceilN = this.texData.ceilNormal;
      const pick = this.cellPick(world);

      const fogFull = 1 / Math.max(1e-4, fogD);
      const fogCol = rgba(fogR | 0, fogG | 0, fogB | 0, 255);
      /* ---- tavan (ufkun üstü) ---- */
      for (let y = Math.max(0, Math.floor(horizon) - 1); y >= 0; y -= 2) {
        const p = horizon - y;
        if (p <= 0) continue;
        const d = zc * fy / p;
        if (!(d > 0) || d > 400) continue;
        if (d > fogFull) {                                   /* kalan tüm satırlar sis */
          for (let yy = y; yy >= 0; yy--) { buf[yy * W] = fogCol; }
          const row0 = y * W;
          for (let x = 1; x < W; x++) {
            buf[row0 + x] = fogCol;
            if (y + 1 < H) buf[row0 + W + x] = fogCol;
          }
          for (let yy = y - 1; yy >= 0; yy--) { const r = yy * W; for (let x = 1; x < W; x++) buf[r + x] = fogCol; }
          break;
        }
        const rowA = y * W, rowB = (y + 1 < H) ? (y + 1) * W : -1;
        const stepX = d * planeX * 2 / W, stepY = d * planeY * 2 / W;
        let wx = px + d * (dirX - planeX), wy = py + d * (dirY - planeY);
        const b = this.planeLight(d, light, torch, 1.0);
        const f = d * fogD > 1 ? 1 : d * fogD;
        const mul = b * (1 - f) * 255;
        const addR = fogR * f, addG = fogG * f, addB = fogB * f;
        const flat = (mul < 4 && addR > fogR * 0.98);
        for (let x = 0; x < W; x++, wx += stepX, wy += stepY) {
          const cx = wx | 0, cy = wy | 0;
          let col;
          if (cx < 0 || cy < 0 || cx >= world.W || cy >= world.H) { col = rgba(4, 5, 8, 255); }
          else {
            const ddx = wx - world.cx, ddy = wy - world.cy;
            if (ddx * ddx + ddy * ddy < glade2) {                 // Kayran: açık gökyüzü tavanı
              const t = clamp(0.6 - d / 500, 0, 0.6) + 0.2;
              col = rgba(lerp(skyCol[0], skyTop[0], t) | 0, lerp(skyCol[1], skyTop[1], t) | 0, lerp(skyCol[2], skyTop[2], t) | 0, 255);
            } else if (!ceilData) { col = rgba(10, 11, 13, 255); }
            else if (flat) { col = rgba(addR | 0, addG | 0, addB | 0, 255); }
            else {
              const tx = (wx * TS) & TM, ty = (wy * TS) & TM;
              const ti = (ty << SH) + tx;
              let nb = b;
              if (ceilN) nb *= (1 + (ceilN[ti * 2 + 1] * (1 / 128) - 1) * 0.28);
              col = shade(ceilData[ti], nb * (1 - f) * 255, addR, addG, addB);
            }
          }
          buf[rowA + x] = col;
          if (rowB >= 0) buf[rowB + x] = col;
        }
      }

      /* ---- zemin (ufkun altı) ---- */
      const sunBoost = 1 + 0.10 * Math.max(0, sun[1]);
      for (let y = Math.max(0, Math.ceil(horizon) + 1); y < H; y += 2) {
        const p = y - horizon;
        if (p <= 0) continue;
        const d = zc * fy / p;
        if (!(d > 0) || d > 400) continue;
        if (d > fogFull) {                                   /* kalan tüm satırlar sis */
          for (let yy = y; yy < H; yy++) { const r = yy * W; for (let x = 0; x < W; x++) buf[r + x] = fogCol; }
          break;
        }
        const rowA = y * W, rowB = (y + 1 < H) ? (y + 1) * W : -1;
        const stepX = d * planeX * 2 / W, stepY = d * planeY * 2 / W;
        let wx = px + d * (dirX - planeX), wy = py + d * (dirY - planeY);
        const b = this.planeLight(d, light, torch, sunBoost);
        const f = d * fogD > 1 ? 1 : d * fogD;
        const mul = b * (1 - f) * 255;
        const addR = fogR * f, addG = fogG * f, addB = fogB * f;
        const flat = (mul < 4);
        for (let x = 0; x < W; x++, wx += stepX, wy += stepY) {
          const cx = wx | 0, cy = wy | 0;
          let col;
          if (cx < 0 || cy < 0 || cx >= world.W || cy >= world.H) col = rgba(3, 4, 6, 255);
          else {
            const id = world.floor[cy * world.W + cx];
            if (id >= 200) col = rgba(3, 4, 7, 255);              // uçurum boşluğu
            else {
              const arr = fd[id];
              if (!arr || !arr.length) col = rgba(8, 9, 10, 255);
              else if (flat) col = rgba(addR | 0, addG | 0, addB | 0, 255);
              else {
                const sel = arr.length === 1 ? arr[0] : (arr[pick[cy * world.W + cx] % arr.length] || arr[0]);
                const tx = (wx * TS) & TM, ty = (wy * TS) & TM;
                col = shade(sel.data[(ty << SH) + tx], mul, addR, addG, addB);
              }
            }
          }
          buf[rowA + x] = col;
          if (rowB >= 0) buf[rowB + x] = col;
        }
      }
    },

    /* hücre varyant seçimi: bir kez hesaplanır, dünya değişene kadar saklanır */
    cellPick(world) {
      if (this._pickWorld === world && this._pickArr && this._pickArr.length === world.W * world.H) return this._pickArr;
      const n = world.W * world.H;
      const arr = new Uint8Array(n);
      for (let y = 0; y < world.H; y++) {
        for (let x = 0; x < world.W; x++) arr[y * world.W + x] = (MV.h2(x, y, 771) * 251) & 255;
      }
      this._pickWorld = world; this._pickArr = arr;
      return arr;
    },

    /* mesafeye bağlı ışık eğrisi (zemin/tavan satırları için) */
    planeLight(d, light, torch, k) {
      let b = (0.30 + 0.70 / (1 + d * d * 0.0038)) + 0.16 / (1 + d * d * 0.5);
      if (torch > 0) b += torch * 0.58 / (1 + d * d * 0.05);
      b *= light * (k === undefined ? 1 : k);
      return b < 0.012 ? 0.012 : b;
    },

    /* ---------------- duvarlar: normal haritalı ışık ---------------- */
    castWalls(buf, zb, W, H, horizon, px, py, dirX, dirY, planeX, planeY, zc, fy, v) {
      const gatesOpen = v.gatesOpen;
      const walls = this.texData.walls, normals = this.texData.normals, specs = this.texData.spec;
      const world = v.world;
      const TS = this.TS, TM = this.TMASK, SH = this.TSHIFT;
      const fogR = v.fogColor[0], fogG = v.fogColor[1], fogB = v.fogColor[2], fogD = v.fogDens;
      const light = v.light, torch = v.torch;
      const sunX = v.sunDir[0], sunY = v.sunDir[1];
      const sunC = v.sunCol, ambient = v.ambient;
      /* sisin tamamen örttüğü mesafeden ötesini aramak boşuna: ışın bütçesi
         ~1/fogDens karo ile sınırlanır (büyük haritada büyük kazanç) */
      const fogFull = 1 / Math.max(1e-4, fogD);
      const maxGuard = Math.min(4096, Math.ceil(fogFull) + 6);
      const colU = R._colU || (R._colU = new Float32Array(TS));
      const colC = R._colC || (R._colC = new Float32Array(TS * 3));

      for (let x = 0; x < W; x++) {
        const camX = 2 * x / W - 1;
        const rayX = dirX + planeX * camX, rayY = dirY + planeY * camX;
        let mapX = px | 0, mapY = py | 0;
        const deltaX = Math.abs(1 / (rayX || 1e-9)), deltaY = Math.abs(1 / (rayY || 1e-9));
        let stepX, stepY, sdistX, sdistY;
        if (rayX < 0) { stepX = -1; sdistX = (px - mapX) * deltaX; } else { stepX = 1; sdistX = (mapX + 1 - px) * deltaX; }
        if (rayY < 0) { stepY = -1; sdistY = (py - mapY) * deltaY; } else { stepY = 1; sdistY = (mapY + 1 - py) * deltaY; }
        let side = 0, hit = 0, guard = 0, texId = 0, hitI = 0;
        while (!hit && guard++ < maxGuard) {
          if (sdistX < sdistY) { sdistX += deltaX; mapX += stepX; side = 0; }
          else { sdistY += deltaY; mapY += stepY; side = 1; }
          if (mapX < 0 || mapY < 0 || mapX >= world.W || mapY >= world.H) break;
          const i = mapY * world.W + mapX;
          const isGate = world.gate[i] === 1;
          if (world.solid[i] === 1 || (isGate && !gatesOpen)) { hit = 1; texId = world.wall[i]; hitI = i; }
        }
        let beyondFog = false;
        if (!hit) {
          /* ışın bütçesi bitti: bu sütun tamamen sise gömülü → sis duvarı */
          beyondFog = true; hit = 1; texId = -1; hitI = -1;
        }
        const perp = side === 0 ? (sdistX - deltaX) : (sdistY - deltaY);
        const dp = beyondFog ? fogFull + 0.5 : Math.max(0.02, perp);
        zb[x] = dp;
        const h = (hitI >= 0 && world.hscale) ? (world.hscale[hitI] / 10) : 4;
        const yTop = horizon - (h - zc) * fy / dp;
        const yBot = horizon + zc * fy / dp;
        const startY = Math.max(0, Math.ceil(yTop));
        const endY = Math.min(H - 1, Math.floor(yBot));
        /* yüz normali ve teğeti (u ekseni duvar boyunca) */
        const fnx = side === 0 ? -stepX : 0, fny = side === 0 ? 0 : -stepY;
        const tx0 = side === 0 ? 0 : -stepY, ty0 = side === 0 ? stepX : 0;
        /* duvar yüzeyinde yatay konum → doku sütunu */
        let wallX = side === 0 ? (py + dp * rayY) : (px + dp * rayX);
        wallX -= Math.floor(wallX);
        let uu = wallX;
        if ((side === 0 && rayX > 0) || (side === 1 && rayY < 0)) uu = 1 - uu;
        const uTex = uu * TS - 0.5;
        const iu = uTex | 0, fu = uTex - iu;
        const nx = ((iu + 1) & TM);

        if (beyondFog) {                                    /* sis duvarı: doku örneklemesi yok */
          const col = rgba(fogR | 0, fogG | 0, fogB | 0, 255);
          for (let y = startY; y <= endY; y++) buf[y * W + x] = col;
          if (startY > 0) buf[(startY - 1) * W + x] = rgba(fogR | 0, fogG | 0, fogB | 0, 255);
          continue;
        }
        let data = walls[texId];
        let nrm = normals[texId], spc = specs[texId];
        if ((!data || !data.length) && this.texData.variant[texId] && this.texData.variant[texId].length) {
          const pick = this.texData.variant[texId][MV.h2(mapX, mapY, 771) % this.texData.variant[texId].length];
          data = pick.data; nrm = pick.normal; spc = null;
        }
        if (!data) { for (let y = startY; y <= endY; y++) buf[y * W + x] = rgba(0, 0, 0, 255); continue; }

        /* ışık profili (sütun sabitleri) — sqrt, hypot'tan çok daha hızlı */
        const invRayLen = 1 / Math.sqrt(rayX * rayX + rayY * rayY);
        const toCamX = -rayX * invRayLen, toCamY = -rayY * invRayLen;
        const att = 1 / (1 + dp * dp * 0.030);
        const torchBase = torch * att * 0.60;
        const sunDiff = Math.max(0, fnx * sunX + fny * sunY);
        const sunAmt = ambient + sunDiff * 0.88;
        const fogF = clamp(dp * fogD, 0, 1);
        const fogMul = (1 - fogF) * 255;
        const addR = fogR * fogF, addG = fogG * fogF, addB = fogB * fogF;
        const vMask = TS * TS - 1;
        const near = dp < 8.5;                       // yakın duvarlarda tam ışık, uzakta sütun sabiti
        const useB = this.filter === 1 && near && fu > 0.02;

        for (let y = startY; y <= endY; y++) {
          const Yw = zc + (horizon - y) * dp / fy;
          let yy = (h - Yw) % 1; if (yy < 0) yy += 1;
          const vy = yy * TS - 0.5;
          const iv = vy | 0, fv = vy - iv;
          const r0 = (iv << SH), r1 = (((iv + 1) & TM) << SH);
          const i00 = (r0 + iu) & vMask, i10 = (r0 + nx) & vMask;
          const i01 = (r1 + iu) & vMask, i11 = (r1 + nx) & vMask;
          let texel;
          if (useB) {
            texel = lerpTex(data[((iv & TM) << SH) + iu], data[((iv & TM) << SH) + nx], fu);
          } else {
            texel = data[((iv & TM) << SH) + iu];
          }
          let mul;
          if (near) {
            /* normal haritası → N·L (yalnızca yakın duvarlarda) */
            let ndiff = sunAmt, nspec = 0, ntorch = torchBase * 0.42;
            if (nrm) {
              const ni = (((iv & TM) * TS + iu)) * 2;
              const nu = nrm[ni] * (1 / 127) - 1;
              const Nx = fnx + tx0 * nu * 0.85, Ny = fny + ty0 * nu * 0.85;
              ndiff = ambient + Math.max(0, Nx * sunX + Ny * sunY) * 0.88;
              const facing = Math.max(0, Nx * toCamX + Ny * toCamY);
              ntorch = torchBase * (0.34 + 0.70 * facing);
              if (spc) {
                const hx = sunX + toCamX, hy = sunY + toCamY;
                const hl = 1 / (Math.sqrt(hx * hx + hy * hy) || 1);
                const sp = Math.max(0, (Nx * hx + Ny * hy) * hl);
                const sp2 = sp * sp; const sp4 = sp2 * sp2;
                nspec = sp4 * sp4 * sp4 * sp2 * (spc[((iv & TM) * TS + iu)] * 0.0019) * light;
              }
            }
            mul = (ndiff * light + ntorch + nspec) * fogMul;
          } else {
            mul = (sunAmt * light + torchBase * 0.38) * fogMul;
          }
          const tRune = texId >= MV.T.RUNE1 && texId <= MV.T.RUNE8;
          if (tRune) mul = Math.max(mul, 0.30 * light * fogMul);
          else if (texId === MV.T.RUNE_PI || texId === MV.T.RUNE_SYS || texId === MV.T.GATE) mul = Math.max(mul, 0.20 * light * fogMul);
          buf[y * W + x] = shade(texel, mul, addR, addG, addB);
        }
        /* duvar dibi temas gölgesi (AO): zemine yumuşak karartma */
        {
          const band = Math.max(2, Math.round(fy / dp * 0.14));
          const yEnd = Math.min(H - 1, endY + band);
          for (let y = endY + 1; y <= yEnd; y++) {
            const k = 1 - (y - endY - 1) / band;
            const i = y * W + x, t0 = buf[i];
            const f = 1 - 0.30 * k * k;
            buf[i] = rgba((t0 & 255) * f | 0, ((t0 >>> 8) & 255) * f | 0, ((t0 >>> 16) & 255) * f | 0, 255);
          }
        }
        /* uzak duvar tepesi: sisli siluet */
        if (startY > 0) buf[(startY - 1) * W + x] = rgba(fogR * 0.4 | 0, fogG * 0.4 | 0, fogB * 0.4 | 0, 255);
      }
    },

    /* ---------------- gölgeler ---------------- */
    castShadows(buf, W, H, horizon, fy, px, py, dirX, dirY, planeX, planeY, v) {
      const list = v.entities;
      if (!list) return;
      const FOVK = this._fov || this.FOVK;
      const invDet = 1 / (planeX * dirY - dirX * planeY);
      for (const e of list) {
        if (!e.shadow) continue;
        const relX = e.x - px, relY = e.y - py;
        const tY = invDet * (-planeY * relX + planeX * relY);
        if (tY < 0.5 || tY > 30) continue;
        const tX = invDet * (dirY * relX - dirX * relY);
        const scrX = (W / 2) * (1 + (tX / tY) / FOVK);
        const ry = horizon + v.zc * fy / tY;
        const rw = (W / (2 * FOVK)) * (e.shadowW || e.w || 1) * 0.6 / tY;
        const rh = Math.max(1, rw * 0.30);
        const a = clamp(0.22 * (1 - tY / 30), 0, 0.26);
        const x0 = Math.max(0, Math.floor(scrX - rw)), x1 = Math.min(W, Math.ceil(scrX + rw));
        const y0 = Math.max(0, Math.floor(ry - rh * 0.5)), y1 = Math.min(H, Math.ceil(ry + rh * 0.5));
        for (let y = y0; y < y1; y++) {
          const dy = (y - ry) / rh;
          const row = y * W;
          for (let x = x0; x < x1; x++) {
            const dx = (x - scrX) / rw;
            const d2 = dx * dx + dy * dy;
            if (d2 > 1) continue;
            const k = (1 - d2) * (1 - d2) * a;
            const i = row + x, t0 = buf[i];
            const r0 = t0 & 255, g0 = (t0 >>> 8) & 255, b0 = (t0 >>> 16) & 255;
            buf[i] = rgba(r0 * (1 - k) | 0, g0 * (1 - k) | 0, b0 * (1 - k) | 0, 255);
          }
        }
      }
    },

    /* ---------------- sprite katmanı ---------------- */
    castSprites(buf, zb, W, H, horizon, px, py, dirX, dirY, planeX, planeY, zc, fy, v) {
      const list = v.entities;
      if (!list || !list.length) return;
      const FOVK = this._fov || this.FOVK;
      const fx = W / (2 * FOVK);
      const invDet = 1 / (planeX * dirY - dirX * planeY);
      const order = [];
      for (const e of list) { e._d = MV.dist2(e.x, e.y, px, py); order.push(e); }
      order.sort((a, b) => b._d - a._d);
      const sprites = this.texData.sprites;
      const light = v.light, torch = v.torch;
      const fogR = v.fogColor[0], fogG = v.fogColor[1], fogB = v.fogColor[2], fogD = v.fogDens;
      for (const e of order) {
        const relX = e.x - px, relY = e.y - py;
        const tX = invDet * (dirY * relX - dirX * relY);
        const tY = invDet * (-planeY * relX + planeX * relY);
        if (tY < 0.20) continue;
        const sd = sprites[e.sprite];
        if (!sd) continue;
        let data = sd.data, sw0 = sd.w, sh0 = sd.h;
        if (sd.frames && sd.frames.length) {
          const n = sd.frames.length;
          let fi = e.frame;
          if (fi === undefined || fi === null) fi = Math.floor((e.anim || 0) * 6) % n;
          fi = ((fi % n) + n) % n;
          const fr = sd.frames[fi];
          data = fr.data; sw0 = fr.w; sh0 = fr.h;
        }
        if (!data) continue;
        const scrX = (W / 2) * (1 + (tX / tY) / FOVK);
        const sw = (fx * (e.w || 1)) / tY;
        const sh = (fy * (e.h || 1)) / tY;
        if (sw < 0.6 || sh < 0.6) continue;
        const yBot = horizon + (zc - (e.yOff || 0)) * fy / tY;
        const yTop = yBot - sh;
        const x0 = Math.max(0, Math.floor(scrX - sw / 2)), x1 = Math.min(W, Math.ceil(scrX + sw / 2));
        const y0 = Math.max(0, Math.floor(yTop)), y1 = Math.min(H, Math.ceil(yBot));
        if (x1 <= x0 || y1 <= y0) continue;
        /* mesafeye bağlı ışık: yüzü kameraya dönük varsayımı + fener konisi */
        let bb = (0.34 + 0.66 / (1 + tY * tY * 0.006)) * light;
        if (torch > 0) bb += torch * 0.72 / (1 + tY * tY * 0.05) * (1 - clamp(tY / 22, 0, 1) * 0.35);
        bb *= (e.tint === undefined ? 1 : e.tint);
        if (e.glow) bb += e.glow;
        const f = clamp(tY * fogD, 0, 1);
        const mul = bb * (1 - f) * 255;
        const addR = fogR * f, addG = fogG * f, addB = fogB * f;
        const alpha = e.alpha === undefined ? 1 : e.alpha;
        const left = scrX - sw / 2;
        const flip = !!e.flip;
        const smooth = (sw / sw0) > 1.15 || (sh / sh0) > 1.15;   // büyütmede çift doğrusal
        for (let x = x0; x < x1; x++) {
          if (tY >= zb[x]) continue;
          let u = (x - left) / sw;
          if (flip) u = 1 - u;
          const fx0 = u * sw0 - 0.5;
          if (fx0 < -1.5 || fx0 > sw0 + 0.5) continue;
          const tx = fx0 | 0;
          for (let y = y0; y < y1; y++) {
            const vv = (y - yTop) / sh;
            const fy0 = vv * sh0 - 0.5;
            const ty = fy0 | 0;
            let texel;
            if (smooth) {
              if (tx < 0 || tx >= sw0 || ty < 0 || ty >= sh0) continue;
              const fu = fx0 - tx, fv = fy0 - ty;
              texel = data[ty * sw0 + tx];
              const a0 = (texel >>> 24) & 255;
              if (fu > 0.02 || fv > 0.02) {
                const i00 = ty * sw0 + tx;
                const i10 = (tx + 1 < sw0) ? i00 + 1 : i00;
                const i01 = (ty + 1 < sh0) ? i00 + sw0 : i00;
                const i11 = (ty + 1 < sh0 && tx + 1 < sw0) ? i01 + 1 : i01;
                texel = lerpTexP(lerpTexP(data[i00], data[i10], fu), lerpTexP(data[i01], data[i11], fu), fv);
                if (a0 < 250) {
                  /* alfa kenarlarında da yumuşat (sprite çevresi tırtıklı olmasın) */
                  const a1 = (data[i10] >>> 24) & 255, a2 = (data[i01] >>> 24) & 255, a3 = (data[i11] >>> 24) & 255;
                  const ai = (a0 + (a1 - a0) * fu + ((a2 + (a3 - a2) * fu) - (a0 + (a1 - a0) * fu)) * fv) | 0;
                  texel = ((ai & 255) << 24 | (texel & 0xffffff)) >>> 0;
                }
              }
            } else {
              if (tx < 0 || tx >= sw0 || ty < 0 || ty >= sh0) continue;
              texel = data[ty * sw0 + tx];
            }
            const a = (texel >>> 24) & 255;
            if (a < 8) continue;
            const idx = y * W + x;
            if (a < 250 || alpha < 0.99) {
              const bg = buf[idx];
              const w2 = (a / 255) * alpha;
              const sr = (texel & 255) * mul / 255 + addR;
              const sg = ((texel >>> 8) & 255) * mul / 255 + addG;
              const sb = ((texel >>> 16) & 255) * mul / 255 + addB;
              buf[idx] = rgba(
                (bg & 255) + (sr - (bg & 255)) * w2,
                ((bg >>> 8) & 255) + (sg - ((bg >>> 8) & 255)) * w2,
                ((bg >>> 16) & 255) + (sb - ((bg >>> 16) & 255)) * w2, 255);
            } else {
              buf[idx] = shade(texel, mul, addR, addG, addB);
            }
          }
        }
      }
    },

    /* ---------------- GPU hattı kaplaması (ekran çözünürlüğü) ----------------
       Dünya GPU'da çizildiği için yalnızca ekran üstü katmanlar burada:
       elde tutulan eşya, fener konisi, hasar kenarı. */
    drawOverlay(v) {
      const c = this.ctx, W = this.dispW, H = this.dispH;
      if (!c) return;
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.globalCompositeOperation = 'source-over';
      c.globalAlpha = 1;
      c.clearRect(0, 0, W, H);
      const held = v.held;
      const sway = v.sway || { x: 0, y: 0 };
      if (held) {
        for (const it of held) {
          const sd = this.texData.sprites[it.sprite];
          if (!sd || !sd.canvas) continue;
          const s = (it.scale || 1) * (H / 540);
          const w = sd.canvas.width * s, h = sd.canvas.height * s;
          if (w < 1 || h < 1) continue;
          const cx = W * (it.x === undefined ? 0.5 : it.x) + sway.x * 26 + (v.bobX || 0) * 6;
          const cy = H + (it.y || 0) * (H / 540) - h + Math.sin(v.time * 1.8) * 1.6 + sway.y * 18 + (v.bobY || 0) * 4 + (it.lift || 0) * h;
          c.save();
          c.globalAlpha = clamp(0.30 + v.light * 0.8 + v.torch * 0.4, 0, 1);
          c.translate(cx, cy);
          c.rotate((it.rot || 0) + sway.x * 0.05);
          c.drawImage(sd.canvas, -w / 2, -h / 2, w, h);
          c.restore();
        }
      }
      /* fener konisi (ekran aydınlatması) */
      if (v.torch > 0.02 && c.createRadialGradient) {
        const g = c.createRadialGradient(W * 0.5, H * 0.62, H * 0.03, W * 0.5, H * 0.62, H * 1.05);
        const k = v.torch * (0.34 + v.light * 0.66);
        g.addColorStop(0, 'rgba(255,236,198,' + (0.22 * k).toFixed(3) + ')');
        g.addColorStop(0.45, 'rgba(255,196,124,' + (0.10 * k).toFixed(3) + ')');
        g.addColorStop(1, 'rgba(255,160,80,0)');
        c.fillStyle = g; c.fillRect(0, 0, W, H);
      }
      /* hasar kenarı */
      if (v.hurt > 0.02) {
        c.strokeStyle = 'rgba(170,18,10,' + (v.hurt * 0.55).toFixed(2) + ')';
        c.lineWidth = 7 * (H / 540);
        c.strokeRect(0, 0, W, H);
      }
    },

    /* ---------------- elde tutulan eşya: sallanma + geri tepme + namlu ışığı ---------------- */
    drawHeld(v) {
      const c = this.bctx, W = this.W, H = this.H;
      const held = v.held;
      const sway = v.sway || { x: 0, y: 0 };
      if (held) {
        for (const it of held) {
          const sd = this.texData.sprites[it.sprite];
          if (!sd || !sd.canvas) continue;
          const s = (it.scale || 1) * (H / 540);
          const w = sd.canvas.width * s, h = sd.canvas.height * s;
          if (w < 1 || h < 1) continue;
          const cx = W * (it.x === undefined ? 0.5 : it.x) + sway.x * 26 + (v.bobX || 0) * 6;
          const cy = H + (it.y || 0) * (H / 540) - h + Math.sin(v.time * 1.8) * 1.6 + sway.y * 18 + (v.bobY || 0) * 4 + (it.lift || 0) * h;
          c.save();
          c.globalAlpha = clamp(0.30 + v.light * 0.8 + v.torch * 0.4, 0, 1);
          c.translate(cx, cy);
          c.rotate((it.rot || 0) + sway.x * 0.05);
          c.drawImage(sd.canvas, -w / 2, -h / 2, w, h);
          c.restore();
        }
      }
      /* fener konisi (ekran aydınlatması) */
      if (v.torch > 0.02) {
        const g = c.createRadialGradient(W * 0.5, H * 0.62, H * 0.03, W * 0.5, H * 0.62, H * 1.05);
        const k = v.torch * (0.34 + v.light * 0.66);
        g.addColorStop(0, 'rgba(255,236,198,' + (0.22 * k).toFixed(3) + ')');
        g.addColorStop(0.45, 'rgba(255,196,124,' + (0.10 * k).toFixed(3) + ')');
        g.addColorStop(1, 'rgba(255,160,80,0)');
        c.fillStyle = g; c.fillRect(0, 0, W, H);
      }
      /* hasar kenarı */
      if (v.hurt > 0.02) {
        c.strokeStyle = 'rgba(170,18,10,' + (v.hurt * 0.55).toFixed(2) + ')';
        c.lineWidth = 7 * (H / 540);
        c.strokeRect(0, 0, W, H);
      }
    },

    /* ============================================================
       SİNEMA SONRASI: yükseltme + renk + bloom + vinyet + gren
       ============================================================ */
    /* gökyüzü: yalnızca ekranın ufka kadar olan üst kısmına çizilir */
    drawSky(v, W, H) {
      const c = this.ctx;
      if (!c || !c.createLinearGradient) return;
      const horizonY = clamp(H * 0.5 + (v.pitch || 0) * (H / this.H), 0, H);
      if (horizonY <= 0) return;
      const g = c.createLinearGradient(0, 0, 0, horizonY);
      g.addColorStop(0, 'rgb(' + (v.skyTop[0] | 0) + ',' + (v.skyTop[1] | 0) + ',' + (v.skyTop[2] | 0) + ')');
      g.addColorStop(1, 'rgb(' + (v.sky[0] | 0) + ',' + (v.sky[1] | 0) + ',' + (v.sky[2] | 0) + ')');
      c.save();
      c.beginPath(); c.rect(0, 0, W, horizonY); c.clip();
      c.fillStyle = g; c.fillRect(0, 0, W, horizonY);
      /* ufuk sisine bağlanma: uzak duvarlar gökyüzüyle kaynaşır */
      const hz = c.createLinearGradient(0, horizonY * 0.42, 0, horizonY);
      const fc = v.fogColor;
      hz.addColorStop(0, 'rgba(' + (fc[0] | 0) + ',' + (fc[1] | 0) + ',' + (fc[2] | 0) + ',0)');
      hz.addColorStop(0.7, 'rgba(' + (fc[0] | 0) + ',' + (fc[1] | 0) + ',' + (fc[2] | 0) + ',' + (0.34 + 0.36 * (v.light || 0.6)).toFixed(2) + ')');
      hz.addColorStop(1, 'rgba(' + (fc[0] | 0) + ',' + (fc[1] | 0) + ',' + (fc[2] | 0) + ',0.92)');
      c.fillStyle = hz; c.fillRect(0, horizonY * 0.42, W, horizonY * 0.58 + 1);
      /* yıldızlar */
      if (v.stars > 0.02 && this.starfield) {
        c.globalAlpha = clamp(v.stars, 0, 1) * (0.75 + 0.25 * Math.sin(v.time * 2.1));
        const sw = W * 1.2, sh = horizonY * 0.95;
        c.drawImage(this.starfield, -((v.time * 4) % sw), 0, sw, sh);
        c.drawImage(this.starfield, sw - ((v.time * 4) % sw), 0, sw, sh);
        c.globalAlpha = 1;
      }
      /* bulutlar (hafif kayar) */
      if (v.clouds > 0.02 && this.cloud) {
        c.globalAlpha = clamp(v.clouds, 0, 1) * 0.75;
        for (const layer of [[1.0, 0.30, 0.5], [1.45, 0.55, 0.3]]) {
          const cw = W * layer[0], chh = horizonY * layer[1];
          const off = -((v.time * 3.5 + layer[2] * 900) % cw);
          for (let x = off - cw; x < W + cw; x += cw) c.drawImage(this.cloud, x, horizonY * (0.06 + layer[2] * 0.3), cw, chh);
        }
        c.globalAlpha = 1;
      }
      /* güneş / ay diski + hale */
      if (v.sun && c.createRadialGradient) {
        const rel = Math.atan2(v.sun.y - v.py, v.sun.x - v.px) - v.pa;
        let a = rel; while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2;
        const fov = this._fov || this.FOVK;
        const sx = (W / 2) * (1 + Math.tan(a) / fov);
        const sy = horizonY - (v.sunEl || 0.5) * H * 0.42;
        if (sx > -W * 0.4 && sx < W * 1.4) {
          const col = v.sunCol || [255, 232, 196];
          const r = H * 0.05;
          const rg = c.createRadialGradient(sx, sy, 0, sx, sy, r * 7);
          rg.addColorStop(0, 'rgba(' + (col[0] | 0) + ',' + (col[1] | 0) + ',' + (col[2] | 0) + ',0.95)');
          rg.addColorStop(0.16, 'rgba(' + (col[0] | 0) + ',' + (col[1] | 0) + ',' + (col[2] | 0) + ',0.55)');
          rg.addColorStop(1, 'rgba(' + (col[0] | 0) + ',' + (col[1] | 0) + ',' + (col[2] | 0) + ',0)');
          c.fillStyle = rg;
          c.beginPath(); c.arc(sx, sy, r * 7, 0, 6.3); c.fill();
          c.fillStyle = 'rgba(255,255,248,0.96)';
          c.beginPath(); c.arc(sx, sy, r, 0, 6.3); c.fill();
        }
      }
      c.restore();
    },

    post(v) {
      const c = this.ctx, W = this.dispW, H = this.dispH;
      if (!c) return;
      const canFilter = typeof c.filter === 'string';
      const exposure = v.exposure === undefined ? 1 : v.exposure;
      /* --- gökyüzü katmanı (gradyan + güneş/ay + yıldız + bulut): GPU'da çizilir --- */
      this.drawSky(v, W, H);
      const grade = 'contrast(1.09) saturate(1.16) brightness(' + exposure.toFixed(3) + ')';
      c.globalCompositeOperation = 'source-over';
      c.globalAlpha = 1;
      if (canFilter) c.filter = grade;
      c.drawImage(this.buf, 0, 0, W, H);
      if (canFilter) c.filter = 'none';

      /* bloom: parlak alanlar yumuşatılıp eklenir */
      const bloom = v.bloom === undefined ? 0.30 : v.bloom;
      if (bloom > 0.01 && this.bloomCv && c.drawImage) {
        const bc = this.bloomCtx;
        if (bc) {
          bc.globalCompositeOperation = 'source-over';
          bc.globalAlpha = 1;
          if (typeof bc.filter === 'string') bc.filter = 'brightness(1.7) contrast(1.35) blur(4px)';
          bc.drawImage(this.buf, 0, 0, this.bloomCv.width, this.bloomCv.height);
          if (typeof bc.filter === 'string') bc.filter = 'none';
          c.globalCompositeOperation = 'lighter';
          c.globalAlpha = clamp(bloom, 0, 0.8);
          c.drawImage(this.bloomCv, 0, 0, W, H);
          c.globalAlpha = 1;
          c.globalCompositeOperation = 'source-over';
        }
      }

      /* renk sapması (çok hafif, kenarlara doğru artan) */
      const ca = v.ca === undefined ? 0.55 : v.ca;
      if (ca > 0.01 && this.dispW > 640) {
        const off = ca * (W / 1280) * 1.6;
        c.globalCompositeOperation = 'lighter';
        c.globalAlpha = 0.055;
        c.drawImage(this.buf, -off, 0, W, H);
        c.drawImage(this.buf, off, 0, W, H);
        c.globalAlpha = 1;
        c.globalCompositeOperation = 'source-over';
      }

      /* vinyet */
      if (!this.vignette || this.vigW !== W || this.vigH !== H) {
        const g = c.createRadialGradient(W * 0.5, H * 0.48, Math.min(W, H) * 0.32, W * 0.5, H * 0.5, Math.max(W, H) * 0.78);
        g.addColorStop(0, 'rgba(0,0,0,0)');
        g.addColorStop(0.65, 'rgba(0,0,0,0.22)');
        g.addColorStop(1, 'rgba(2,3,6,0.72)');
        this.vignette = g; this.vigW = W; this.vigH = H;
      }
      if (this.vignette) { c.fillStyle = this.vignette; c.fillRect(0, 0, W, H); }

      /* film greni (hafif) */
      if (this.noise.length) {
        const n = this.noise[(v.time * 12 | 0) % this.noise.length];
        const ox = -((v.time * 37) % 128), oy = -((v.time * 53) % 128);
        c.globalAlpha = 0.05 + (v.grain || 0) * 0.06;
        for (let y = oy; y < H; y += 128) for (let x = ox; x < W; x += 128) c.drawImage(n, x, y);
        c.globalAlpha = 1;
      }
    }
  };

  /* ARGB paketli çift doğrusal örnekleme (sprite yumuşatma) */
  function lerpTexP(a, b, t) {
    const r = (a & 255) + (((b & 255) - (a & 255)) * t);
    const g = ((a >>> 8) & 255) + ((((b >>> 8) & 255) - ((a >>> 8) & 255)) * t);
    const bl = ((a >>> 16) & 255) + ((((b >>> 16) & 255) - ((a >>> 16) & 255)) * t);
    const al = ((a >>> 24) & 255) + ((((b >>> 24) & 255) - ((a >>> 24) & 255)) * t);
    return (((al | 0) << 24) | ((bl | 0) << 16) | ((g | 0) << 8) | (r | 0)) >>> 0;
  }

  /* iki texeli doğrusal harmanlama (ARGB paketli) */
  function lerpTex(a, b, t) {
    const r = (a & 255) + (((b & 255) - (a & 255)) * t);
    const g = ((a >>> 8) & 255) + ((((b >>> 8) & 255) - ((a >>> 8) & 255)) * t);
    const bl = ((a >>> 16) & 255) + ((((b >>> 16) & 255) - ((a >>> 16) & 255)) * t);
    return ((255 << 24) | ((bl | 0) << 16) | ((g | 0) << 8) | (r | 0)) >>> 0;
  }
  function ivec(v) { return v < 0 ? 0 : v; }

  /* piksel gölgeleme: texel, çarpan, eklenen sis */
  function shade(texel, mul, addR, addG, addB) {
    const r = (texel & 255) * mul / 255 + addR;
    const g = ((texel >>> 8) & 255) * mul / 255 + addG;
    const b = ((texel >>> 16) & 255) * mul / 255 + addB;
    return ((255 << 24) | (((b > 255 ? 255 : b) | 0) << 16) | (((g > 255 ? 255 : g) | 0) << 8) | ((r > 255 ? 255 : r) | 0)) >>> 0;
  }

  MV.Renderer = R;
})(MV);
