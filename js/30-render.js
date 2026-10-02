/* ============================================================
   30-render.js — yazılım raycaster (Wolfenstein/Inferno usulü)
   + gerçek zemin izdüşümü, sis, fener ışığı, sprite katmanı
   + FPS bakış açısı: baş sallanması, yürüyüş ritmi, nefes
   ============================================================ */
(function (MV) {
  'use strict';
  const { clamp, lerp, rgba, T } = MV;

  const R = {
    canvas: null, ctx: null, W: 0, H: 0, SS: 2,
    img: null, buf32: null, zbuf: null,
    texData: { walls: [], variant: [], sprites: {} },
    FOVK: 0.66,

    init(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d', { alpha: false });
      this.resize();
    },
    setQuality(q) { this.SS = q; this.resize(); },
    resize() {
      const cv = this.canvas;
      if (!cv) return;
      const internalW = Math.max(160, Math.round(480 / this.SS));
      const internalH = Math.round(internalW * 9 / 16);
      cv.width = internalW; cv.height = internalH;
      this.W = internalW; this.H = internalH;
      this.img = this.ctx.createImageData(internalW, internalH);
      this.buf32 = new Uint32Array(this.img.data.buffer);
      this.zbuf = new Float32Array(internalW);
      this.ctx.imageSmoothingEnabled = false;
    },
    /* ---------- doku verisini hazırla ---------- */
    prepare(tex) {
      const grab = (canvas) => {
        if (!canvas || !canvas.getContext) return null;
        if (canvas._data) return canvas._data;
        const c = canvas.getContext('2d');
        const d = c.getImageData(0, 0, canvas.width, canvas.height);
        canvas._data = new Uint32Array(d.data.buffer.slice(0));
        canvas._w = canvas.width; canvas._h = canvas.height;
        return canvas._data;
      };
      this.grab = grab;
      const td = { walls: [], variant: [], sprites: {} };
      for (let i = 0; i < tex.walls.length; i++) td.walls[i] = grab(tex.walls[i]);
      for (const k in tex.variant) td.variant[k] = tex.variant[k].map(grab).filter(Boolean);
      for (const k in tex.sprites) {
        const cv = tex.sprites[k];
        td.sprites[k] = { data: grab(cv), w: cv ? cv.width : 0, h: cv ? cv.height : 0, canvas: cv };
      }
      // zemin dokuları için hızlı dizin (id → dizi)
      td.floorIdx = [];
      for (let i = 0; i < 32; i++) {
        const arr = td.variant[i];
        td.floorIdx[i] = (arr && arr.length) ? arr : (td.walls[i] ? [td.walls[i]] : null);
      }
      this.texData = td;
      this.tex = tex;
    },
    spriteData(name) { return this.texData.sprites[name]; },

    /* ============================================================ */
    draw(v) {
      const W = this.W, H = this.H, buf = this.buf32, zb = this.zbuf;
      const world = v.world;
      const px = v.px, py = v.py, pa = v.pa;
      const zc = v.zc, pitch = v.pitch || 0;
      const light = v.light, torch = v.torch;
      const FOVK = this.FOVK;
      const fx = W / (2 * FOVK), fy = fx;
      const horizon = H * 0.5 + pitch;
      const dirX = Math.cos(pa), dirY = Math.sin(pa);
      const planeX = -dirY * FOVK, planeY = dirX * FOVK;
      const fogR = v.fogColor[0], fogG = v.fogColor[1], fogB = v.fogColor[2];
      const fogD = v.fogDens;

      /* 1) gökyüzü */
      const skyH = Math.max(0, Math.min(H, Math.ceil(horizon)));
      for (let y = 0; y < skyH; y++) {
        const t = clamp(y / Math.max(1, horizon), 0, 1);
        const r = lerp(v.sky[0], v.skyTop[0], t * t) | 0;
        const g = lerp(v.sky[1], v.skyTop[1], t * t) | 0;
        const b = lerp(v.sky[2], v.skyTop[2], t * t) | 0;
        buf.fill(rgba(r, g, b, 255), y * W, y * W + W);
      }
      if (v.stars > 0) {
        for (let y = 0; y < Math.min(skyH, horizon * 0.85); y++) {
          const row = y * W;
          for (let x = 0; x < W; x++) {
            const s = MV.h2(x, y, 5150);
            if (s > 0.9988 - v.stars * 0.0008) {
              const br = 120 + ((s * 977) % 110) | 0;
              buf[row + x] = rgba(br, br, Math.min(255, br + 30), 255);
            }
          }
        }
      }

      /* 2) zemin */
      this.castFloor(buf, W, H, horizon, px, py, dirX, dirY, planeX, planeY, zc, fy, light, torch, fogR, fogG, fogB, fogD, world, v);
      /* 3) duvarlar */
      this.castWalls(buf, zb, W, H, horizon, px, py, dirX, dirY, planeX, planeY, zc, fy, light, torch, fogR, fogG, fogB, fogD, world, v);
      /* 4) sprite'lar */
      this.castSprites(buf, zb, W, H, horizon, px, py, dirX, dirY, planeX, planeY, zc, fy, light, torch, fogR, fogG, fogB, fogD, v);

      this.ctx.putImageData(this.img, 0, 0);
      this.drawHeld(v, W, H, light, torch);
    },

    /* ---------- zemin izdüşümü ---------- */
    castFloor(buf, W, H, horizon, px, py, dirX, dirY, planeX, planeY, zc, fy, light, torch, fogR, fogG, fogB, fogD, world, v) {
      const fd = this.texData.floorIdx;
      const yStart = Math.max(0, Math.ceil(horizon) + 1);
      for (let y = yStart; y < H; y++) {
        const p = y - horizon;
        const d = zc * fy / p;
        if (!(d > 0) || d > 300) continue;
        let b = 1 / (1 + d * d * 0.0042) + 0.14 / (1 + d * d * 0.6);
        if (torch > 0) b += torch * 0.85 / (1 + d * d * 0.06);
        b *= light;
        if (b < 0.012) b = 0.012;
        const f = clamp(d * fogD, 0, 1);
        const mul = b * (1 - f) * 255;
        const addR = fogR * f, addG = fogG * f, addB = fogB * f;
        const rowPix = y * W;
        const stepX = d * planeX * 2 / W, stepY = d * planeY * 2 / W;
        let wx = px + d * (dirX - planeX), wy = py + d * (dirY - planeY);
        for (let x = 0; x < W; x++, wx += stepX, wy += stepY) {
          const cx = wx | 0, cy = wy | 0;
          if (cx < 0 || cy < 0 || cx >= world.W || cy >= world.H) { buf[rowPix + x] = rgba(3, 4, 6, 255); continue; }
          const id = world.floor[cy * world.W + cx];
          if (id >= 200) { buf[rowPix + x] = rgba(3, 4, 7, 255); continue; }  // uçurum boşluğu
          const arr = fd[id];
          if (!arr) { buf[rowPix + x] = rgba(8, 9, 10, 255); continue; }
          const data = arr.length === 1 ? arr[0] : arr[MV.h2(cx, cy, 771) % arr.length];
          if (!data) { buf[rowPix + x] = rgba(8, 9, 10, 255); continue; }
          const texel = data[(((wy * 64) | 0) & 63) * 64 + (((wx * 64) | 0) & 63)];
          buf[rowPix + x] = shade(texel, mul, addR, addG, addB);
        }
      }
    },

    /* ---------- duvarlar ---------- */
    castWalls(buf, zb, W, H, horizon, px, py, dirX, dirY, planeX, planeY, zc, fy, light, torch, fogR, fogG, fogB, fogD, world, v) {
      const gatesOpen = v.gatesOpen;
      const walls = this.texData.walls, variants = this.texData.variant;
      const maxGuard = Math.max(world.W, world.H) * 2;
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
        if (!hit) {
          // ufka doğru sonsuz düzlük: uzak sis
          zb[x] = 260;
          continue;
        }
        const perp = side === 0 ? (sdistX - deltaX) : (sdistY - deltaY);
        const dp = Math.max(0.02, perp);
        zb[x] = dp;
        const h = world.hscale ? (world.hscale[hitI] / 10) : 4;
        const yTop = horizon - (h - zc) * fy / dp;
        const yBot = horizon + zc * fy / dp;
        const startY = Math.max(0, Math.ceil(yTop));
        const endY = Math.min(H - 1, Math.floor(yBot));
        let b = 1 / (1 + dp * dp * 0.0042) + 0.14 / (1 + dp * dp * 0.55);
        if (torch > 0) b += torch * 1.25 / (1 + dp * dp * 0.045);
        if (side === 1) b *= 0.76;
        b *= light;
        if (texId >= T.RUNE1 && texId <= T.RUNE8) b = Math.max(b, 0.34 * light);
        else if (texId === T.RUNE_PI || texId === T.RUNE_SYS || texId === T.GATE) b = Math.max(b, 0.24 * light);
        const f = clamp(dp * fogD, 0, 1);
        const mul = b * (1 - f) * 255;
        const addR = fogR * f, addG = fogG * f, addB = fogB * f;
        let data = walls[texId];
        if (!data && variants[texId] && variants[texId].length) data = variants[texId][MV.h2(mapX, mapY, 771) % variants[texId].length];
        if (!data) { for (let y = startY; y <= endY; y++) buf[y * W + x] = rgba(0, 0, 0, 255); continue; }
        let wallX = side === 0 ? (py + dp * rayY) : (px + dp * rayX);
        wallX -= Math.floor(wallX);
        let texX = (wallX * 64) | 0;
        if ((side === 0 && rayX > 0) || (side === 1 && rayY < 0)) texX = 63 - texX;
        texX &= 63;
        for (let y = startY; y <= endY; y++) {
          const Yw = zc + (horizon - y) * dp / fy;
          let yy = (h - Yw) % 1; if (yy < 0) yy += 1;
          const texY = ((yy * 64) | 0) & 63;
          buf[y * W + x] = shade(data[texY * 64 + texX], mul, addR, addG, addB);
        }
        // duvar tepesi siluetı
        if (startY > 0) {
          const yy = startY - 1;
          buf[yy * W + x] = rgba(fogR * 0.3 | 0, fogG * 0.3 | 0, fogB * 0.3 | 0, 255);
        }
      }
    },

    /* ---------- sprite'lar ---------- */
    castSprites(buf, zb, W, H, horizon, px, py, dirX, dirY, planeX, planeY, zc, fy, light, torch, fogR, fogG, fogB, fogD, v) {
      const list = v.entities;
      if (!list.length) return;
      const fx = W / (2 * this.FOVK);
      const invDet = 1 / (planeX * dirY - dirX * planeY);
      const order = [];
      for (const e of list) {
        e._d = MV.dist2(e.x, e.y, px, py);
        order.push(e);
      }
      order.sort((a, b) => b._d - a._d);
      const sprites = this.texData.sprites;
      for (const e of order) {
        const relX = e.x - px, relY = e.y - py;
        const tX = invDet * (dirY * relX - dirX * relY);
        const tY = invDet * (-planeY * relX + planeX * relY);
        if (tY < 0.22) continue;
        const sd = sprites[e.sprite];
        if (!sd || !sd.data) continue;
        const scrX = (W / 2) * (1 + (tX / tY) / this.FOVK);
        const sw = (fx * (e.w || 1)) / tY;
        const sh = (fy * (e.h || 1)) / tY;
        if (sw < 0.6 || sh < 0.6) continue;
        const yBot = horizon + (zc - (e.yOff || 0)) * fy / tY;
        const yTop = yBot - sh;
        const x0 = Math.max(0, Math.floor(scrX - sw / 2)), x1 = Math.min(W, Math.ceil(scrX + sw / 2));
        const y0 = Math.max(0, Math.floor(yTop)), y1 = Math.min(H, Math.ceil(yBot));
        let bb = 1 / (1 + tY * tY * 0.0052);
        if (torch > 0) bb += torch * 0.6 / (1 + tY * tY * 0.075);
        bb *= light * (e.tint === undefined ? 1 : e.tint);
        if (e.glow) bb += e.glow;
        const f = clamp(tY * fogD, 0, 1);
        const mul = bb * (1 - f) * 255;
        const addR = fogR * f, addG = fogG * f, addB = fogB * f;
        const alpha = e.alpha === undefined ? 1 : e.alpha;
        const left = scrX - sw / 2;
        for (let x = x0; x < x1; x++) {
          if (tY >= zb[x]) continue;
          const u = (x - left) / sw;
          const tx = (u * sd.w) | 0;
          if (tx < 0 || tx >= sd.w) continue;
          for (let y = y0; y < y1; y++) {
            const vv = (y - yTop) / sh;
            const ty = (vv * sd.h) | 0;
            if (ty < 0 || ty >= sd.h) continue;
            const texel = sd.data[ty * sd.w + tx];
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

    /* ---------- elde tutulan eşya + ekran etkileri (2D) ---------- */
    drawHeld(v, W, H, light, torch) {
      const c = this.ctx;
      if (torch > 0.02) {
        const g = c.createRadialGradient(W * 0.5, H * 0.60, H * 0.04, W * 0.5, H * 0.60, H * 0.95);
        g.addColorStop(0, 'rgba(255,230,180,' + (0.20 * torch * (0.30 + light * 0.70)).toFixed(3) + ')');
        g.addColorStop(0.5, 'rgba(255,190,110,' + (0.09 * torch * (0.30 + light * 0.70)).toFixed(3) + ')');
        g.addColorStop(1, 'rgba(255,160,80,0)');
        c.fillStyle = g; c.fillRect(0, 0, W, H);
      }
      const held = v.held;
      if (held) {
        for (const it of held) {
          const sd = this.texData.sprites[it.sprite];
          if (!sd || !sd.canvas) continue;
          const s = (it.scale || 1) * (W / 480);
          const w = sd.canvas.width * s, h = sd.canvas.height * s;
          if (w < 1 || h < 1) continue;
          const cx = W * (it.x === undefined ? 0.5 : it.x) + (v.bobX || 0) * 8;
          const cy = H + (it.y || 0) - h + Math.sin(v.time * 2.3) * 2 + (v.bobY || 0) * 4 + (it.lift || 0) * h;
          c.save();
          c.globalAlpha = clamp(0.3 + light * 0.85 + torch * 0.35, 0, 1);
          c.translate(cx, cy);
          c.rotate(it.rot || 0);
          c.drawImage(sd.canvas, -w / 2, -h / 2, w, h);
          c.restore();
        }
      }
      if (v.hurt > 0.02) {
        c.strokeStyle = 'rgba(170,18,10,' + (v.hurt * 0.55).toFixed(2) + ')';
        c.lineWidth = 7 * (W / 480);
        c.strokeRect(0, 0, W, H);
      }
    }
  };

  /* piksel gölgeleme: texel, çarpan, eklenen sis */
  function shade(texel, mul, addR, addG, addB) {
    const r = (texel & 255) * mul / 255 + addR;
    const g = ((texel >>> 8) & 255) * mul / 255 + addG;
    const b = ((texel >>> 16) & 255) * mul / 255 + addB;
    return ((255 << 24) | (((b > 255 ? 255 : b) | 0) << 16) | (((g > 255 ? 255 : g) | 0) << 8) | ((r > 255 ? 255 : r) | 0)) >>> 0;
  }

  MV.Renderer = R;
})(MV);
