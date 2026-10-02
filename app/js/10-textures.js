/* ============================================================
   10-textures.js — prosedürel doku üretimi (dosya yok, hepsi kod)
   Inferno Protocol paleti: kirli beton, yosun, pas, organik çelik
   ============================================================ */
(function (MV) {
  'use strict';
  const { rgb, rgba, pack, mixC, clamp, RNG, h2, fbm, pnoise, celNoise, lerp } = MV;

  const TS = 256;                // doku boyutu (kare, normal harita için yüksek)
  const TN = 20;                 // doku sayısı
  MV.TS = TS; MV.TEXN = TN;

  const T = MV.T;   // karo/doku kimlikleri çekirdekte tanımlı

  /* ---------- yardımcılar ---------- */
  function makeCanvas(w, h) {
    const c = (typeof document !== 'undefined')
      ? document.createElement('canvas')
      : { width: w, height: h, _fake: true };
    c.width = w; c.height = h;
    return c;
  }
  function getCtx(w, h) {
    const c = makeCanvas(w, h);
    if (!c.getContext) return null;
    return c.getContext('2d');
  }

  /* gürültü tabanlı doku yazıcı: her piksel için fn(x,y,rng) → renk */
  function paint(ctx, w, h, seed, fn) {
    const img = ctx.createImageData(w, h);
    const d = img.data;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const col = fn(x, y);
        d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = col[3] === undefined ? 255 : col[3];
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  /* ---------- taş / beton blok zemini ----------
     block: 32px blok, harç çizgileri, lekeler, çatlaklar */
  function drawMasonry(ctx, w, h, o) {
    const seed = o.seed, base = o.base, mortar = o.mortar;
    const block = o.block || 32, rows = Math.round(h / block);
    const rng = RNG(seed);
    /* blok renk tonları (blok başına bir kez) */
    const cols = Math.ceil(w / block) + 2;
    const tint = new Float32Array(rows * cols);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) tint[r * cols + c] = 0.80 + rng() * 0.40;
    const edgeW = Math.max(1, Math.round(block / 22));      // derz/çerçeve kalınlığı
    const img = ctx.createImageData(w, h);
    const d = img.data;
    const baseR = base[0], baseG = base[1], baseB = base[2];
    const morR = mortar[0], morG = mortar[1], morB = mortar[2];
    for (let y = 0; y < h; y++) {
      const r = (y / block) | 0;
      const by = y - r * block;
      const xoff = (r % 2) ? block * 0.5 : 0;
      const rowT = r * cols;
      for (let x = 0; x < w; x++) {
        const c = ((x - xoff) / block) | 0;
        const bx = (x - xoff) - c * block;
        const inBlock = bx > edgeW && bx < block - edgeW && by > edgeW && by < block - edgeW;
        const i = (y * w + x) * 4;
        if (inBlock) {
          const t = tint[rowT + (c + 1)];
          const grain = MV.fbm(x / 6, y / 6, 6, 3, seed + r * 31 + c) * 0.52 +
                        MV.fbm(x / 2.2, y / 2.2, 4, 2, seed + 55) * 0.30 +
                        MV.h2(x, y, seed + 91) * 0.34;      // ince kum/çakıl dokusu
          const edge = Math.min(bx - edgeW, block - edgeW - bx, by - edgeW, block - edgeW - by);
          const bevel = edge < edgeW ? 0.80 : (edge < edgeW * 2 ? 0.93 : 1);
          const pits = MV.h2(x, y, seed + 137) > 0.986 ? 0.70 : 1;   // gözenek/oyuk
          const m = (0.80 + grain * 0.52) * bevel * t * pits;
          d[i] = baseR * m; d[i + 1] = baseG * m; d[i + 2] = baseB * m; d[i + 3] = 255;
        } else {
          const n = MV.fbm(x / 9, y / 9, 8, 3, seed) * 0.5 + MV.h2(x, y, seed + 5) * 0.5;
          const m = 0.90 + n * 0.30;
          d[i] = morR * m; d[i + 1] = morG * m; d[i + 2] = morB * m; d[i + 3] = 255;
        }
      }
    }
    ctx.putImageData(img, 0, 0);
    /* blok üstü leke/çatlak (vektör; az sayıda) */
    for (let r = 0; r < rows; r++) {
      const xoff = (r % 2) ? block / 2 : 0;
      for (let c = -1; c <= w / block; c++) {
        const bx = c * block + xoff, by = r * block;
        if (rng() < 0.55) {
          ctx.fillStyle = 'rgba(0,0,0,' + (0.10 + rng() * 0.20).toFixed(2) + ')';
          ctx.beginPath();
          ctx.ellipse(bx + edgeW + rng() * (block - 2 * edgeW), by + edgeW + rng() * (block - 2 * edgeW),
            (2 + rng() * 6) * block / 32, (1.5 + rng() * 4) * block / 32, rng() * 3, 0, 6.3);
          ctx.fill();
        }
        if (rng() < 0.30) {
          ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = Math.max(1, block / 32);
          ctx.beginPath();
          let px = bx + rng() * block, py = by;
          ctx.moveTo(px, py);
          for (let k = 0; k < 4; k++) { px += (rng() - 0.5) * block * 0.28; py += block / 4; ctx.lineTo(px, py); }
          ctx.stroke();
        }
      }
    }
  }

  function mossify(ctx, w, h, seed, amount, col) {
    col = col || [64, 94, 50];
    const img = ctx.getImageData(0, 0, w, h), d = img.data;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const n = fbm(x / 10, y / 10, 8, 4, seed + 700) * 0.6 + fbm(x / 3, y / 3, 4, 2, seed + 31) * 0.4;
      const topBias = 0.55 + 0.45 * (1 - y / h);
      let a = clamp((n - (1 - amount)) * 2.6 * topBias, 0, 1);
      if (a <= 0.01) continue;
      const i = (y * w + x) * 4;
      const m = 0.75 + h2(x, y, seed) * 0.5;
      d[i] = lerp(d[i], col[0] * m, a);
      d[i + 1] = lerp(d[i + 1], col[1] * m, a);
      d[i + 2] = lerp(d[i + 2], col[2] * m, a);
    }
    ctx.putImageData(img, 0, 0);
  }

  function grimeEdge(ctx, w, h, seed, dark) {
    const img = ctx.getImageData(0, 0, w, h), d = img.data;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const edge = Math.min(x, y, w - 1 - x, h - 1 - y);
      const vig = 1 - MV.smoothstep(0, 14, edge) * 0.50;
      const i = (y * w + x) * 4;
      const m = vig * (1 - dark * 0.30) + 0.40;
      d[i] *= m; d[i + 1] *= m; d[i + 2] *= m;
    }
    ctx.putImageData(img, 0, 0);
  }

  /* seviye/gamma düzeltmesi: karanlık dokuları göze okunur hale getirir,
     göreli kontrastı korur (Inferno Protocol'ün kirli gri paleti gibi) */
  function levelBoost(ctx, gamma, floor) {
    gamma = gamma === undefined ? 0.62 : gamma;
    floor = floor === undefined ? 10 : floor;
    const img = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
    const d = img.data;
    const lut = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
      const v = 255 * Math.pow(i / 255, gamma) + floor * (1 - i / 255);
      lut[i] = v > 255 ? 255 : v | 0;
    }
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 8) continue;
      d[i] = lut[d[i]]; d[i + 1] = lut[d[i + 1]]; d[i + 2] = lut[d[i + 2]];
    }
    ctx.putImageData(img, 0, 0);
  }

  function speckle(ctx, w, h, seed, n, col, sz) {
    const rng = RNG(seed);
    ctx.fillStyle = col;
    for (let i = 0; i < n; i++) {
      const s = sz || 1;
      ctx.fillRect(rng.int(w), rng.int(h), s, s);
    }
  }

  /* ---------- doku üreticileri ---------- */
  function texStone(seed, base) {
    const ctx = getCtx(TS, TS); if (!ctx) return null;
    drawMasonry(ctx, TS, TS, { seed: seed, base: base, mortar: [base[0] * 0.55, base[1] * 0.55, base[2] * 0.55], block: 32 });
    speckle(ctx, TS, TS, seed + 3, 240 * (TS / 128) * (TS / 128), 'rgba(0,0,0,.22)');
    speckle(ctx, TS, TS, seed + 4, 40 * (TS / 128) * (TS / 128), 'rgba(255,255,255,.035)');
    grimeEdge(ctx, TS, TS, seed, 0.6);
    return ctx.canvas;
  }

  function texHedera(seed) { // sarmaşık duvarı
    const ctx = getCtx(TS, TS); if (!ctx) return null;
    drawMasonry(ctx, TS, TS, { seed: seed, base: [96, 94, 84], mortar: [44, 44, 38], block: 32 });
    // gövde + yaprak kümeleri
    const rng = RNG(seed + 17);
    for (let i = 0; i < 26; i++) {
      let x = rng.int(TS), y = rng.int(TS);
      const steps = 6 + rng.int(6);
      ctx.strokeStyle = 'rgba(28,40,22,.9)'; ctx.lineWidth = 1 + rng.int(2);
      ctx.beginPath(); ctx.moveTo(x, y);
      for (let s = 0; s < steps; s++) { x += (rng() - 0.5) * 8; y += rng() * 5; ctx.lineTo(x, y); }
      ctx.stroke();
      for (let l = 0; l < 7; l++) {
        const lx = x + (rng() - 0.5) * 14, ly = y + (rng() - 0.5) * 14;
        const g = 34 + rng() * 34;
        ctx.fillStyle = 'rgba(' + (g * 0.55 | 0) + ',' + g + ',' + (g * 0.42 | 0) + ',' + (0.55 + rng() * 0.4) + ')';
        ctx.beginPath(); ctx.ellipse(lx, ly, 1.4 + rng() * 2.6, 1 + rng() * 2, rng() * 3, 0, 6.3); ctx.fill();
      }
    }
    mossify(ctx, TS, TS, seed, 0.5);
    grimeEdge(ctx, TS, TS, seed, 0.5);
    return ctx.canvas;
  }

  function texVine(seed) { // yapraklı örtü (ticari "wall") — sarkan dallar
    const ctx = getCtx(TS, TS); if (!ctx) return null;
    paint(ctx, TS, TS, seed, (x, y) => {
      const n = fbm(x / 6, y / 6, 8, 4, seed);
      const g = 24 + n * 52;
      return [g * 0.5, g, g * 0.38, 255];
    });
    const rng = RNG(seed + 5);
    for (let i = 0; i < 22; i++) {
      let x = rng.int(TS), y = 0;
      ctx.strokeStyle = 'rgba(24,34,18,.85)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, y);
      while (y < TS) { x += (rng() - 0.5) * 4.5; y += 3 + rng() * 4; ctx.lineTo(x, y); }
      ctx.stroke();
      for (let l = 0; l < 9; l++) {
        const g = 40 + rng() * 45;
        ctx.fillStyle = 'rgba(' + (g * 0.5 | 0) + ',' + g + ',' + (g * 0.4 | 0) + ',.8)';
        ctx.beginPath(); ctx.ellipse(x + (rng() - 0.5) * 12, rng() * TS, 1.6 + rng() * 2, 1.1 + rng() * 1.6, rng() * 3, 0, 6.3); ctx.fill();
      }
    }
    grimeEdge(ctx, TS, TS, seed, 0.4);
    return ctx.canvas;
  }

  function texBox(seed) { // Kutu: paslı çelik plakalar + perçinler + WICKED kazıması
    const ctx = getCtx(TS, TS); if (!ctx) return null;
    paint(ctx, TS, TS, seed, (x, y) => {
      const n = fbm(x / 7, y / 7, 8, 4, seed) * 0.6 + fbm(x / 2, y / 2, 4, 2, seed + 9) * 0.4;
      const base = 76 + n * 38;
      return [base * 1.02, base * 0.98, base * 0.92, 255];
    });
    // dikey kaynak/panel çizgileri
    ctx.fillStyle = 'rgba(0,0,0,.42)';
    ctx.fillRect(0, 0, 1, TS); ctx.fillRect(31, 0, 2, TS); ctx.fillRect(0, 31, TS, 2);
    ctx.fillStyle = 'rgba(255,255,255,.06)';
    ctx.fillRect(1, 0, 1, TS); ctx.fillRect(33, 0, 1, TS); ctx.fillRect(0, 33, TS, 1);
    // perçinler
    for (let y = 6; y < TS; y += 16) for (let x = 6; x < TS; x += 16) {
      ctx.fillStyle = 'rgba(210,205,190,.20)'; ctx.fillRect(x, y, 2, 2);
      ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(x + 1, y + 2, 2, 1);
    }
    // pas akıntısı
    const rng = RNG(seed + 44);
    for (let i = 0; i < 16; i++) {
      const x = rng.int(TS), y = rng.int(TS), hh = 3 + rng.int(14);
      ctx.fillStyle = 'rgba(' + (90 + rng() * 40 | 0) + ',' + (44 + rng() * 18 | 0) + ',18,' + (0.15 + rng() * 0.3) + ')';
      ctx.fillRect(x, y, 1 + rng.int(2), hh);
    }
    grimeEdge(ctx, TS, TS, seed, 0.55);
    return ctx.canvas;
  }

  function texGrass(seed) { // Kayran çimi: yamalı, ince taneli, döşeme izi göstermez
    const ctx = getCtx(TS, TS); if (!ctx) return null;
    const k = TS / 128;
    paint(ctx, TS, TS, seed, (x, y) => {
      const patch = fbm(x / (26 * k), y / (26 * k), 8, 4, seed) * 0.55 + fbm(x / (9 * k), y / (9 * k), 8, 3, seed + 41) * 0.45;
      const fine = fbm(x / (2.0 * k), y / (2.0 * k), 8, 3, seed + 3);
      const g = 44 + patch * 40 + fine * 16;
      const dry = clamp((fbm(x / (18 * k), y / (18 * k), 4, 3, seed + 77) - 0.52) * 2.4, 0, 1);
      return [g * (0.66 + dry * 0.30), g * (0.92 - dry * 0.10), g * (0.52 - dry * 0.16), 255];
    });
    const rng = RNG(seed + 6);
    /* çim sapları: kısa dikey çizgiler (yön çeşitliliği ile) */
    for (let i = 0; i < 5200; i++) {
      const x = rng.next() * TS, y = rng.next() * TS;
      const g = 48 + rng() * 70, dark = rng() < 0.3;
      ctx.fillStyle = dark ? 'rgba(20,26,17,.55)' : 'rgba(' + (g * 0.62 | 0) + ',' + g + ',' + (g * 0.48 | 0) + ',.62)';
      ctx.fillRect(x | 0, y | 0, 1, 1 + (rng() < 0.45 ? 1 : 0) + (rng() < 0.12 ? 1 : 0));
    }
    /* toprak/kuru yamalar */
    for (let i = 0; i < 12; i++) {
      ctx.fillStyle = 'rgba(52,41,27,' + (0.22 + rng() * 0.28).toFixed(2) + ')';
      ctx.beginPath();
      ctx.ellipse(rng.next() * TS, rng.next() * TS, (3 + rng() * 9) * k, (2.5 + rng() * 7) * k, rng() * 3, 0, 6.3);
      ctx.fill();
    }
    /* küçük taş/çakıl */
    for (let i = 0; i < 24; i++) {
      const x = rng.next() * TS, y = rng.next() * TS, r = (0.8 + rng() * 1.4) * k;
      ctx.fillStyle = 'rgba(120,118,104,.30)';
      ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.7, rng() * 3, 0, 6.3); ctx.fill();
    }
    grimeEdge(ctx, TS, TS, seed, 0.28);
    return ctx.canvas;
  }

  function texDirt(seed) { // Labirent zemini: toz, taş kırıntısı, tekerlek izi
    const ctx = getCtx(TS, TS); if (!ctx) return null;
    paint(ctx, TS, TS, seed, (x, y) => {
      const n = fbm(x / 9, y / 9, 8, 4, seed) * 0.7 + celNoise(x / 8, y / 8, 8, seed + 2) * 0.3;
      const v = 50 + n * 36;
      return [v * 1.1, v * 1.0, v * 0.85, 255];
    });
    speckle(ctx, TS, TS, seed + 8, 420, 'rgba(0,0,0,.25)');
    speckle(ctx, TS, TS, seed + 9, 260, 'rgba(190,180,160,.10)');
    // çift tekerlek izi
    ctx.fillStyle = 'rgba(0,0,0,.16)';
    ctx.fillRect(0, 14, TS, 2); ctx.fillRect(0, 17, TS, 1);
    ctx.fillRect(0, 46, TS, 2); ctx.fillRect(0, 49, TS, 1);
    grimeEdge(ctx, TS, TS, seed, 0.4);
    return ctx.canvas;
  }

  function texTrack(seed) { // Labirent "yolu": aşınmış plaka + turuncu sinyal bandı
    const ctx = getCtx(TS, TS); if (!ctx) return null;
    drawMasonry(ctx, TS, TS, { seed: seed, base: [104, 102, 96], mortar: [50, 50, 46], block: 32 });
    ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(0, 0, TS, 3); ctx.fillRect(0, TS - 3, TS, 3);
    const wob = 0.55 + 0.45 * Math.sin(seed * 0.7);
    ctx.fillStyle = 'rgba(' + (150 * wob | 0) + ',' + (96 * wob | 0) + ',20,.5)';
    ctx.fillRect(0, 30, TS, 4);
    speckle(ctx, TS, TS, seed + 12, 200, 'rgba(0,0,0,.25)');
    grimeEdge(ctx, TS, TS, seed, 0.5);
    return ctx.canvas;
  }

  function texWood(seed) { // ahşap (kulübe, kapı, tuzak)
    const ctx = getCtx(TS, TS); if (!ctx) return null;
    paint(ctx, TS, TS, seed, (x, y) => {
      const plank = Math.floor(y / 16);
      const wobble = fbm(x / 22, plank * 3.3, 8, 2, seed + plank) * 6;
      const grain = fbm(x / 30, (y + wobble) / 1.4, 8, 3, seed + 3) * 0.5 + fbm(x / 4, y / 2.2, 4, 2, seed + 8) * 0.5;
      const v = 64 + grain * 50;
      return [v * 1.25, v * 0.86, v * 0.52, 255];
    });
    ctx.fillStyle = 'rgba(0,0,0,.5)';
    for (let y = 0; y < TS; y += 16) ctx.fillRect(0, y, TS, 1);
    speckle(ctx, TS, TS, seed + 21, 130, 'rgba(0,0,0,.3)');
    grimeEdge(ctx, TS, TS, seed, 0.45);
    return ctx.canvas;
  }

  function texGate(seed) { // Geçit: ahşap + demir kafes + WICKED mühürü
    const ctx = getCtx(TS, TS); if (!ctx) return null;
    const wood = texWood(seed);
    if (wood) ctx.drawImage(wood, 0, 0);
    ctx.fillStyle = 'rgba(30,26,20,.75)';
    for (let x = 8; x < TS; x += 14) ctx.fillRect(x, 0, 3, TS);
    for (let y = 10; y < TS; y += 22) ctx.fillRect(0, y, TS, 2);
    ctx.fillStyle = 'rgba(180,175,160,.10)';
    for (let x = 8; x < TS; x += 14) ctx.fillRect(x, 0, 1, TS);
    // mühür plakası
    ctx.fillStyle = 'rgba(24,30,30,.85)'; ctx.fillRect(22, 24, 20, 16);
    ctx.strokeStyle = 'rgba(120,200,220,.35)'; ctx.lineWidth = 1; ctx.strokeRect(22.5, 24.5, 19, 15);
    ctx.fillStyle = 'rgba(140,215,235,.45)'; ctx.font = 'bold 10px monospace'; ctx.textAlign = 'center';
    ctx.fillText('7', 32, 36);
    grimeEdge(ctx, TS, TS, seed, 0.5);
    return ctx.canvas;
  }

  function texRuneDigit(seed, digit, idx) { // Sıra numarası da taşa kazınır: "3 ₁"
    const ctx = getCtx(TS, TS); if (!ctx) return null;
    drawMasonry(ctx, TS, TS, { seed: seed, base: [118, 114, 102], mortar: [50, 50, 44], block: 32 });
    ctx.save(); ctx.translate(32, 31);
    ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(0, 0, 25, 0, 6.3); ctx.stroke();
    ctx.fillStyle = 'rgba(6,8,8,.72)'; ctx.beginPath(); ctx.arc(0, 0, 22, 0, 6.3); ctx.fill();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = 'bold 31px ui-monospace, monospace';
    ctx.fillStyle = 'rgba(0,0,0,.95)'; ctx.fillText(String(digit), 1.5, 3.5);
    ctx.fillStyle = 'rgba(255,196,118,.96)'; ctx.fillText(String(digit), 0, 1);
    // indeks alt simgesi
    ctx.font = 'bold 11px ui-monospace, monospace';
    ctx.fillStyle = 'rgba(0,0,0,.9)'; ctx.fillText(String(idx + 1), 17.5, 19.5);
    ctx.fillStyle = 'rgba(170,225,255,.95)'; ctx.fillText(String(idx + 1), 16, 18);
    ctx.restore();
    // aşınma + kir
    const rng = RNG(seed + 61);
    for (let i = 0; i < 40; i++) {
      ctx.fillStyle = 'rgba(0,0,0,' + (0.15 + rng() * 0.3) + ')';
      ctx.fillRect(rng.int(TS), rng.int(TS), 1 + rng.int(3), 1 + rng.int(2));
    }
    mossify(ctx, TS, TS, seed + 5, 0.3);
    grimeEdge(ctx, TS, TS, seed, 0.45);
    return ctx.canvas;
  }

  function texRune(seed, text, glow) { // Kazınmış rune duvarı
    const ctx = getCtx(TS, TS); if (!ctx) return null;
    drawMasonry(ctx, TS, TS, { seed: seed, base: [112, 110, 100], mortar: [52, 52, 46], block: 32 });
    ctx.save();
    ctx.translate(32, 32);
    // oyma çerçeve
    ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(0, 0, 24, 0, 6.3); ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,.4)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(0, 0, 21, 0, 6.3); ctx.stroke();
    ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.beginPath(); ctx.arc(0, 0, 19, 0, 6.3); ctx.fill();
    // rakam/glyph
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = 'bold 30px ui-monospace, monospace';
    ctx.fillStyle = 'rgba(8,10,10,.95)';
    ctx.fillText(text, 1.5, 2.5);
    ctx.fillStyle = glow ? 'rgba(255,190,110,.95)' : 'rgba(150,150,140,.55)';
    ctx.fillText(text, 0, 0);
    if (glow) {
      ctx.globalAlpha = 0.35; ctx.fillStyle = '#ffd9a0';
      ctx.fillText(text, 0, 0); ctx.globalAlpha = 1;
    }
    // çentikler
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * 6.283;
      ctx.fillStyle = glow ? 'rgba(255,190,110,.55)' : 'rgba(0,0,0,.5)';
      ctx.fillRect(Math.cos(a) * 24 - 1, Math.sin(a) * 24 - 1, 2, 2);
    }
    ctx.restore();
    speckle(ctx, TS, TS, seed + 30, 200, 'rgba(0,0,0,.28)');
    mossify(ctx, TS, TS, seed, 0.22);
    grimeEdge(ctx, TS, TS, seed, 0.5);
    return ctx.canvas;
  }

  function texCliff(seed) { // Sektör dış duvarı: dik kaya + kemik/çentik izleri
    const ctx = getCtx(TS, TS); if (!ctx) return null;
    paint(ctx, TS, TS, seed, (x, y) => {
      const n = fbm(x / 12, y / 12, 8, 4, seed) * 0.55 + fbm(x / 3, y / 3, 4, 3, seed + 4) * 0.45;
      const strata = 0.5 + 0.5 * Math.sin(y * 0.55 + fbm(x / 20, 0, 8, 2, seed) * 4);
      const v = 46 + n * 34 + strata * 10;
      return [v * 1.02, v * 0.95, v * 0.86, 255];
    });
    const img = ctx.getImageData(0, 0, TS, TS), d = img.data;
    for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) {
      const i = (y * TS + x) * 4;
      // dikey çatlaklar
      const cr = Math.abs(fbm(x / 5, y / 26, 8, 2, seed + 60) - 0.5);
      if (cr < 0.035) { d[i] *= 0.25; d[i + 1] *= 0.25; d[i + 2] *= 0.3; }
    }
    ctx.putImageData(img, 0, 0);
    mossify(ctx, TS, TS, seed + 2, 0.35);
    speckle(ctx, TS, TS, seed + 33, 150, 'rgba(230,225,210,.07)');
    grimeEdge(ctx, TS, TS, seed, 0.6);
    return ctx.canvas;
  }

  function texWater(seed) {
    const ctx = getCtx(TS, TS); if (!ctx) return null;
    paint(ctx, TS, TS, seed, (x, y) => {
      const n = fbm(x / 7, y / 7, 8, 4, seed) * 0.6 + fbm(x / 2.5, y / 2.5, 4, 2, seed + 2) * 0.4;
      const v = 24 + n * 38;
      return [v * 0.5, v * 0.85, v, 255];
    });
    return ctx.canvas;
  }

  function texGrate(seed) { // çelik ızgara zemin
    const ctx = getCtx(TS, TS); if (!ctx) return null;
    paint(ctx, TS, TS, seed, (x, y) => {
      const n = fbm(x / 4, y / 4, 8, 3, seed);
      const v = 32 + n * 20;
      return [v, v * 0.98, v * 0.94, 255];
    });
    ctx.fillStyle = 'rgba(150,150,142,.5)';
    for (let x = 0; x < TS; x += 8) ctx.fillRect(x, 0, 2, TS);
    for (let y = 0; y < TS; y += 8) ctx.fillRect(0, y, TS, 2);
    ctx.fillStyle = 'rgba(0,0,0,.55)';
    for (let x = 0; x < TS; x += 8) ctx.fillRect(x + 2, 0, 6, TS);
    for (let y = 0; y < TS; y += 8) ctx.fillRect(0, y + 2, TS, 6);
    return ctx.canvas;
  }

  function texHive(seed) { // Griever kovanı: organik kalın duvar
    const ctx = getCtx(TS, TS); if (!ctx) return null;
    paint(ctx, TS, TS, seed, (x, y) => {
      const n = fbm(x / 10, y / 10, 8, 4, seed) * 0.6 + celNoise(x / 9, y / 9, 8, seed + 5) * 0.4;
      const v = 36 + n * 30;
      return [v * 0.7, v * 0.62, v * 0.72, 255];
    });
    const rng = RNG(seed + 3);
    for (let i = 0; i < 30; i++) { // kabarcık / damar
      const x = rng.next() * TS, y = rng.next() * TS;
      ctx.strokeStyle = 'rgba(20,14,22,.7)'; ctx.lineWidth = 1 + rng.int(2);
      ctx.beginPath(); ctx.arc(x, y, 2 + rng() * 7, rng() * 3, rng() * 3 + 2); ctx.stroke();
    }
    for (let i = 0; i < 90; i++) {
      ctx.fillStyle = 'rgba(180,60,90,.10)';
      ctx.fillRect(rng.int(TS), rng.int(TS), 1 + rng.int(2), 1);
    }
    grimeEdge(ctx, TS, TS, seed, 0.6);
    return ctx.canvas;
  }

  function texLeaf(seed) { // koyu yaprak örtüsü (üst katman)
    const ctx = getCtx(TS, TS); if (!ctx) return null;
    paint(ctx, TS, TS, seed, (x, y) => {
      const n = fbm(x / 5, y / 5, 8, 4, seed);
      const v = 20 + n * 26;
      return [v * 0.55, v, v * 0.42, 255];
    });
    const rng = RNG(seed + 15);
    for (let i = 0; i < 70; i++) {
      const g = 24 + rng() * 40;
      ctx.fillStyle = 'rgba(' + (g * 0.5 | 0) + ',' + g + ',' + (g * 0.36 | 0) + ',.7)';
      ctx.beginPath(); ctx.ellipse(rng.next() * TS, rng.next() * TS, 2 + rng() * 4, 1.5 + rng() * 2.5, rng() * 3, 0, 6.3); ctx.fill();
    }
    return ctx.canvas;
  }

  /* ---------- sprite üreticileri (şeffaf zeminli) ---------- */
  function spriteSize(w, h, draw, seed) {
    const ctx = getCtx(w, h); if (!ctx) return null;
    draw(ctx, RNG(seed === undefined ? 1 : seed));
    return ctx.canvas;
  }
  function sprite(seed, draw) { return spriteSize(64, 64, draw, seed); }
  /* yüksek çözünürlüklü sprite: aynı vektör çizim k kat büyük tuvale ölçeklenir
     (kulübe, Kutu, kovan gibi büyük nesneler yakından bakıldığında bloklu görünmez) */
  function spriteBig(seed, k, draw) {
    const n = Math.round(64 * k);
    return spriteSize(n, n, (c, rng) => { c.save(); c.scale(k, k); draw(c, rng); c.restore(); }, seed);
  }
  /* animasyonlu sprite: n kare, her kare phase 0..1 */
  function spriteFrames(w, h, n, seed, draw) {
    const out = [];
    for (let i = 0; i < n; i++) out.push(spriteSize(w, h, (c, rng) => draw(c, rng, i / n, i), seed + i * 17));
    return out;
  }

  /* ---------- yaratık çizim yardımcıları ---------- */
  function limb(c, x0, y0, x1, y1, x2, y2, w1, w2, col, col2) {
    c.lineCap = 'round';
    c.strokeStyle = col; c.lineWidth = w1;
    c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
    c.strokeStyle = col2 || col; c.lineWidth = w2;
    c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke();
    c.fillStyle = col;
    c.beginPath(); c.arc(x1, y1, w1 * 0.55, 0, 6.3); c.fill();
    c.strokeStyle = 'rgba(226,236,232,.30)'; c.lineWidth = Math.max(1, w1 * 0.26);
    c.beginPath(); c.moveTo(x0, y0 - w1 * 0.30); c.lineTo(x1, y1 - w1 * 0.30); c.stroke();
    c.fillStyle = col2 || col;
    c.beginPath(); c.arc(x2, y2, w2 * 0.62, 0, 6.3); c.fill();
  }
  function plateShade(c, x, y, rx, ry, rot, base, hi) {
    const g = c.createLinearGradient(x - rx, y - ry, x + rx, y + ry);
    g.addColorStop(0, hi); g.addColorStop(0.55, base); g.addColorStop(1, 'rgba(12,15,16,.95)');
    c.fillStyle = g;
    c.beginPath(); c.ellipse(x, y, rx, ry, rot, 0, 6.3); c.fill();
  }
  function rivets(c, x, y, rx, ry, rot, n, col) {
    c.save(); c.translate(x, y); c.rotate(rot);
    c.fillStyle = col || 'rgba(196,206,200,.55)';
    for (let i = 0; i < n; i++) {
      const a = i / n * 6.283;
      c.beginPath(); c.arc(Math.cos(a) * rx * 0.72, Math.sin(a) * ry * 0.72, 1.15, 0, 6.3); c.fill();
    }
    c.restore();
  }
  /* filmdeki Griever: zırhlı, uzun bacaklı, biyomekanik avcı */
  function drawGriever(c, rng, phase, S) {
    const cx = S.w * 0.5;
    const W = S.w, H = S.h;
    let cy = S.h * 0.54;
    const bob = Math.sin(phase * 6.283) * H * 0.012;
    cy += bob;
    const shell = 'rgb(58,66,62)', shellHi = 'rgba(126,140,132,.95)', dark = 'rgb(26,30,32)';
    // zemin gölgesi
    c.fillStyle = 'rgba(0,0,0,.42)';
    c.beginPath(); c.ellipse(cx, H * 0.92, W * 0.32, H * 0.05, 0, 0, 6.3); c.fill();
    // 8 uzuv: femur + tibia + pençe (yürüyüş salınımı)
    for (let s = -1; s <= 1; s += 2) {
      for (let i = 0; i < 4; i++) {
        const ph = phase * 6.283 + i * 1.55 + (s > 0 ? 0 : Math.PI * 0.5);
        const swing = Math.sin(ph) * H * 0.075;
        const lift = Math.max(0, Math.cos(ph)) * H * 0.05;
        const hipX = cx + s * W * 0.10, hipY = cy - H * 0.10 + i * H * 0.055;
        const kneeX = cx + s * W * (0.24 + i * 0.012), kneeY = hipY - H * 0.17 - lift * 0.4;
        const footX = cx + s * W * (0.40 + i * 0.028), footY = hipY + H * 0.20 + swing - lift * 0.5;
        limb(c, hipX, hipY, kneeX, kneeY, footX, footY, 3.1, 1.9, dark, 'rgb(40,46,44)');
        c.strokeStyle = 'rgba(206,222,214,.20)'; c.lineWidth = 0.9;
        c.beginPath(); c.moveTo(kneeX, kneeY); c.lineTo(footX, footY); c.stroke();
      }
    }
    // karın (arka gövde): kitin plakalar
    plateShade(c, cx, cy + H * 0.06, W * 0.20, H * 0.17, 0, 'rgb(46,54,50)', 'rgba(104,120,110,.9)');
    c.strokeStyle = 'rgba(16,20,20,.8)'; c.lineWidth = 1.2;
    for (let i = -2; i <= 2; i++) {
      c.beginPath();
      c.ellipse(cx, cy + H * 0.06, W * 0.20 - Math.abs(i) * 1.6, H * 0.17 * (1 - Math.abs(i) * 0.16), 0, 0.35, Math.PI - 0.35);
      c.stroke();
    }
    // göğüs zırhı
    plateShade(c, cx, cy - H * 0.06, W * 0.17, H * 0.13, 0, shell, shellHi);
    rivets(c, cx, cy - H * 0.06, W * 0.17, H * 0.13, 0, 8, 'rgba(212,222,214,.5)');
    // WICKED implant: mavi parlayan sırt ışıkları
    for (let i = 0; i < 3; i++) {
      const ix = cx - W * 0.06 + i * W * 0.06, iy = cy - H * 0.06;
      c.fillStyle = 'rgba(120,225,255,.28)';
      c.beginPath(); c.arc(ix, iy, 4.2, 0, 6.3); c.fill();
      c.fillStyle = 'rgb(180,244,255)';
      c.beginPath(); c.arc(ix, iy, 1.7, 0, 6.3); c.fill();
    }
    // baş: koyu kitle + 4 sensör gözü + mandibula
    const hx = cx + Math.sin(phase * 6.283) * W * 0.012, hy = cy - H * 0.21;
    plateShade(c, hx, hy, W * 0.115, H * 0.085, 0, 'rgb(38,44,44)', 'rgba(96,110,104,.9)');
    for (let i = 0; i < 4; i++) {
      const ex = hx + (i < 2 ? -1 : 1) * W * 0.045, ey = hy + (i % 2 ? 0 : -H * 0.03);
      c.fillStyle = 'rgba(255,90,70,.30)';
      c.beginPath(); c.arc(ex, ey, 3.6, 0, 6.3); c.fill();
      c.fillStyle = 'rgb(255,168,120)';
      c.beginPath(); c.arc(ex, ey, 1.35, 0, 6.3); c.fill();
    }
    c.strokeStyle = dark; c.lineWidth = 2.2; c.lineCap = 'round';
    for (let s = -1; s <= 1; s += 2) {
      c.beginPath(); c.moveTo(hx + s * W * 0.045, hy + H * 0.05);
      c.lineTo(hx + s * W * 0.10, hy + H * 0.11);
      c.lineTo(hx + s * W * 0.045, hy + H * 0.12); c.stroke();
      c.beginPath(); c.moveTo(hx + s * W * 0.045, hy + H * 0.05);
      c.lineTo(hx + s * W * 0.015, hy + H * 0.13); c.stroke();
    }
    // kuyruk iğnesi
    c.strokeStyle = 'rgb(34,38,38)'; c.lineWidth = 3.4; c.lineCap = 'round';
    c.beginPath();
    c.moveTo(cx - W * 0.02, cy + H * 0.16);
    c.quadraticCurveTo(cx - W * 0.22, cy + H * 0.24, cx - W * 0.26, cy - H * 0.06);
    c.stroke();
    c.fillStyle = 'rgb(196,206,190)';
    c.beginPath(); c.moveTo(cx - W * 0.26, cy - H * 0.06);
    c.lineTo(cx - W * 0.30, cy - H * 0.16);
    c.lineTo(cx - W * 0.22, cy - H * 0.10); c.closePath(); c.fill();
    c.fillStyle = 'rgba(150,220,170,.75)';
    c.beginPath(); c.arc(cx - W * 0.245, cy - H * 0.115, 1.4, 0, 6.3); c.fill();
  }

  function makeSprites() {
    const S = {};
    // GRIEVER — filmdeki biyomekanik avcı: 4 kareli yürüyüş animasyonu
    S.griever = spriteFrames(176, 140, 4, 7, (c, rng, phase) => drawGriever(c, rng, phase, { w: 176, h: 140 }));
    // BÖCEK BIÇAĞI — WICKED casusu: metal kabuk, kamera gözü, kare kare kanat
    S.beetle = spriteFrames(40, 34, 4, 11, (c, rng, phase, fi) => {
      const W = 40, H = 34, cx = W / 2, cy = H / 2 + 1;
      c.fillStyle = 'rgba(0,0,0,.35)';
      c.beginPath(); c.ellipse(cx, H - 3, W * 0.22, H * 0.06, 0, 0, 6.3); c.fill();
      // kanat bulanıklığı
      c.fillStyle = 'rgba(186,214,220,' + (0.10 + (fi % 2 ? 0.10 : 0.02)) + ')';
      c.beginPath(); c.ellipse(cx - 4, cy - 5, 12, 5, -0.35, 0, 6.3); c.fill();
      c.beginPath(); c.ellipse(cx + 4, cy - 5, 12, 5, 0.35, 0, 6.3); c.fill();
      // bacaklar
      for (let i = 0; i < 3; i++) for (let s = -1; s <= 1; s += 2) {
        const t = Math.sin(phase * 6.283 + i * 1.2) * 1.6;
        c.strokeStyle = 'rgb(24,28,28)'; c.lineWidth = 1.5; c.lineCap = 'round';
        c.beginPath(); c.moveTo(cx + s * 4, cy - 3 + i * 3.4);
        c.lineTo(cx + s * 10, cy - 5 + i * 3.6 + t);
        c.lineTo(cx + s * 13, cy + 1 + i * 3.6 + t * 1.2); c.stroke();
      }
      // kabuk
      c.save(); c.translate(cx, cy); c.rotate(-0.06);
      plateShade(c, 0, 0, 9.5, 6.4, 0, 'rgb(58,70,68)', 'rgba(150,176,168,.95)');
      c.strokeStyle = 'rgba(14,18,18,.85)'; c.lineWidth = 1;
      c.beginPath(); c.moveTo(0, -6); c.lineTo(0, 6); c.stroke();
      rivets(c, 0, 0, 9.5, 6.4, 0, 8, 'rgba(208,222,214,.5)');
      c.restore();
      // kamera gözü (WICKED casusu) + kızıl tarama ışığı
      c.fillStyle = 'rgba(255,70,60,.22)';
      c.beginPath(); c.arc(cx, cy - 6, 4.6, 0, 6.3); c.fill();
      c.fillStyle = 'rgb(30,34,34)';
      c.beginPath(); c.arc(cx, cy - 6, 2.7, 0, 6.3); c.fill();
      c.fillStyle = 'rgb(255,120,96)';
      c.beginPath(); c.arc(cx, cy - 6, 1.5, 0, 6.3); c.fill();
      c.fillStyle = 'rgba(255,255,255,.85)';
      c.beginPath(); c.arc(cx - 0.7, cy - 6.7, 0.5, 0, 6.3); c.fill();
      // anten
      c.strokeStyle = 'rgb(30,34,34)'; c.lineWidth = 1.1;
      c.beginPath(); c.moveTo(cx - 2, cy - 8); c.lineTo(cx - 6, cy - 13); c.stroke();
      c.beginPath(); c.moveTo(cx + 2, cy - 8); c.lineTo(cx + 6, cy - 13); c.stroke();
    });
    // Serum (yeşil cam)
    S.vial = sprite(21, (c) => {
      c.save(); c.translate(32, 34);
      c.fillStyle = 'rgba(0,0,0,.4)'; c.beginPath(); c.ellipse(0, 16, 7, 3, 0, 0, 6.3); c.fill();
      c.fillStyle = 'rgba(160,220,190,.35)'; c.fillRect(-5, -14, 10, 26);
      c.fillStyle = 'rgba(70,220,120,.85)'; c.fillRect(-4, -2, 8, 13);
      c.strokeStyle = 'rgba(230,255,240,.6)'; c.lineWidth = 1; c.strokeRect(-5, -14, 10, 26);
      c.fillStyle = 'rgb(90,90,86)'; c.fillRect(-4, -18, 8, 5);
      c.fillStyle = 'rgba(255,255,255,.5)'; c.fillRect(-3, -12, 1, 20);
      c.restore();
    });
    // Anahtar (dişli mekanik anahtar)
    S.key = sprite(31, (c) => {
      c.save(); c.translate(32, 32); c.rotate(-0.4);
      c.fillStyle = 'rgba(0,0,0,.4)'; c.beginPath(); c.ellipse(0, 20, 8, 3, 0, 0, 6.3); c.fill();
      c.strokeStyle = 'rgb(190,190,180)'; c.lineWidth = 3;
      c.beginPath(); c.arc(0, -10, 6, 0, 6.3); c.stroke();
      c.strokeStyle = 'rgb(150,150,142)'; c.lineWidth = 3.4;
      c.beginPath(); c.moveTo(0, -4); c.lineTo(0, 16); c.stroke();
      c.fillStyle = 'rgb(150,150,142)'; c.fillRect(0, 12, 7, 3); c.fillRect(0, 17, 5, 3);
      c.fillStyle = 'rgba(255,255,255,.25)'; c.fillRect(-1, -4, 1, 20);
      c.restore();
    });
    // İzleyici (tracker) — WICKED terminali
    S.tracker = spriteBig(41, 1.5, (c) => {
      c.save(); c.translate(32, 40);
      c.fillStyle = 'rgba(0,0,0,.45)'; c.beginPath(); c.ellipse(0, 14, 14, 5, 0, 0, 6.3); c.fill();
      c.fillStyle = 'rgb(58,64,62)'; c.fillRect(-4, -10, 8, 22);
      c.fillStyle = 'rgb(40,46,44)'; c.fillRect(-13, -18, 26, 16);
      c.strokeStyle = 'rgba(140,230,255,.7)'; c.lineWidth = 1; c.strokeRect(-12, -17, 24, 14);
      c.fillStyle = 'rgba(120,220,255,.35)'; c.fillRect(-11, -16, 22, 12);
      c.fillStyle = '#bff6ff'; c.font = '7px monospace'; c.textAlign = 'center';
      c.fillText('7', 0, -7);
      c.fillStyle = 'rgba(255,180,90,.6)'; c.fillRect(-6, -22, 12, 3);
      c.restore();
    });
    // Fener
    S.torch = sprite(51, (c) => {
      c.save(); c.translate(32, 38);
      c.fillStyle = 'rgba(0,0,0,.4)'; c.beginPath(); c.ellipse(0, 16, 8, 3, 0, 0, 6.3); c.fill();
      c.fillStyle = 'rgb(70,74,72)'; c.fillRect(-6, -4, 12, 20);
      c.fillStyle = 'rgb(52,56,54)'; c.fillRect(-7, -8, 14, 5);
      const g = c.createRadialGradient(0, -10, 1, 0, -10, 9);
      g.addColorStop(0, '#fff4d0'); g.addColorStop(0.45, 'rgba(255,220,140,.85)'); g.addColorStop(1, 'rgba(255,200,90,0)');
      c.fillStyle = g; c.beginPath(); c.arc(0, -10, 9, 0, 6.3); c.fill();
      c.fillStyle = 'rgba(255,240,200,.9)'; c.beginPath(); c.arc(0, -10, 3, 0, 6.3); c.fill();
      c.restore();
    });
    // Runik tablet parçası
    S.runePick = sprite(61, (c) => {
      c.save(); c.translate(32, 34);
      c.fillStyle = 'rgba(0,0,0,.45)'; c.beginPath(); c.ellipse(0, 18, 10, 4, 0, 0, 6.3); c.fill();
      c.fillStyle = 'rgb(96,96,88)';
      c.beginPath(); c.moveTo(-9, 12); c.lineTo(-6, -14); c.lineTo(7, -16); c.lineTo(10, 12); c.closePath(); c.fill();
      c.strokeStyle = 'rgba(0,0,0,.5)'; c.lineWidth = 1; c.stroke();
      c.fillStyle = 'rgba(255,190,110,.85)'; c.font = 'bold 14px monospace'; c.textAlign = 'center';
      c.fillText('π', 0, 4);
      c.fillStyle = 'rgba(255,190,110,.25)'; c.fillText('π', 0, 4);
      c.restore();
    });
    // Yiyecek (Kayran meyvesi / konserve)
    S.food = sprite(71, (c) => {
      c.save(); c.translate(32, 38);
      c.fillStyle = 'rgba(0,0,0,.4)'; c.beginPath(); c.ellipse(0, 14, 9, 3, 0, 0, 6.3); c.fill();
      c.fillStyle = 'rgb(120,118,112)'; c.fillRect(-8, -10, 16, 24);
      c.fillStyle = 'rgb(88,86,80)'; c.fillRect(-8, -10, 16, 4);
      c.fillStyle = 'rgba(180,60,40,.7)'; c.fillRect(-5, -3, 10, 8);
      c.strokeStyle = 'rgba(255,255,255,.2)'; c.lineWidth = 1; c.strokeRect(-8, -10, 16, 24);
      c.restore();
    });
    // Taş
    S.rock = sprite(81, (c, rng) => {
      c.save(); c.translate(32, 40);
      c.fillStyle = 'rgba(0,0,0,.4)'; c.beginPath(); c.ellipse(0, 10, 13, 4, 0, 0, 6.3); c.fill();
      c.fillStyle = 'rgb(78,76,70)';
      c.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = i / 8 * 6.283, r = 10 + rng() * 5;
        const x = Math.cos(a) * r, y = Math.sin(a) * r * 0.7;
        i ? c.lineTo(x, y) : c.moveTo(x, y);
      }
      c.closePath(); c.fill();
      c.fillStyle = 'rgba(255,255,255,.09)'; c.beginPath(); c.ellipse(-3, -3, 6, 4, 0.5, 0, 6.3); c.fill();
      c.restore();
    });
    // Çalı (billboard)
    S.bush = sprite(91, (c, rng) => {
      c.save(); c.translate(32, 56);
      for (let i = 0; i < 46; i++) {
        const x = (rng() - 0.5) * 40, h = 4 + rng() * 34, w = 1 + rng() * 1.6;
        const g = 30 + rng() * 46;
        c.strokeStyle = 'rgba(' + (g * 0.45 | 0) + ',' + g + ',' + (g * 0.35 | 0) + ',' + (0.6 + rng() * 0.4) + ')';
        c.lineWidth = w;
        c.beginPath(); c.moveTo(x, 0); c.quadraticCurveTo(x * 1.2, -h * 0.6, x * 1.5 + (rng() - 0.5) * 6, -h); c.stroke();
      }
      c.restore();
    });
    // KUTU — WICKED çelik konteyneri (Kayran'ın merkezi)
    S.box = spriteBig(241, 2, (c, rng) => {
      c.save(); c.translate(32, 58);
      c.fillStyle = 'rgba(0,0,0,.45)'; c.beginPath(); c.ellipse(0, 4, 30, 7, 0, 0, 6.3); c.fill();
      // gövde
      const g = c.createLinearGradient(0, -56, 0, 4);
      g.addColorStop(0, 'rgb(126,130,128)'); g.addColorStop(0.45, 'rgb(96,100,99)');
      g.addColorStop(1, 'rgb(58,62,62)');
      c.fillStyle = g;
      c.fillRect(-28, -56, 56, 60);
      // panel çizgileri
      c.strokeStyle = 'rgba(24,28,28,.85)'; c.lineWidth = 1;
      for (let x = -28; x <= 28; x += 14) { c.beginPath(); c.moveTo(x, -56); c.lineTo(x, 4); c.stroke(); }
      for (let y = -56; y <= 4; y += 15) { c.beginPath(); c.moveTo(-28, y); c.lineTo(28, y); c.stroke(); }
      // kenar ışığı
      c.fillStyle = 'rgba(255,255,255,.10)'; c.fillRect(-28, -56, 56, 2);
      c.fillStyle = 'rgba(0,0,0,.30)'; c.fillRect(-28, 2, 56, 2);
      // perçinler
      for (let x = -24; x <= 24; x += 8) for (let y = -52; y <= 0; y += 15) {
        c.fillStyle = 'rgba(226,228,222,.18)'; c.fillRect(x, y, 1, 1);
      }
      // WICKED paneli
      c.fillStyle = 'rgba(14,20,20,.92)'; c.fillRect(-17, -44, 34, 18);
      c.strokeStyle = 'rgba(111,227,255,.55)'; c.lineWidth = 1; c.strokeRect(-16.5, -43.5, 33, 17);
      c.fillStyle = 'rgba(140,235,255,.85)'; c.font = 'bold 11px monospace'; c.textAlign = 'center';
      c.fillText('7', 0, -31);
      c.font = '5px monospace'; c.fillStyle = 'rgba(140,235,255,.5)';
      c.fillText('WICKED', 0, -39);
      // kapak / ambar
      c.fillStyle = 'rgb(44,48,48)'; c.fillRect(-12, -18, 24, 16);
      c.fillStyle = 'rgba(255,255,255,.06)'; c.fillRect(-12, -18, 24, 2);
      c.strokeStyle = 'rgba(0,0,0,.6)'; c.strokeRect(-12, -18, 24, 16);
      // uyarı şeridi
      for (let i = 0; i < 7; i++) {
        c.fillStyle = i % 2 ? 'rgba(214,164,60,.75)' : 'rgba(30,30,28,.75)';
        c.fillRect(-28 + i * 8, 1, 8, 4);
      }
      // pas akıntıları
      for (let i = 0; i < 14; i++) {
        c.fillStyle = 'rgba(96,52,22,' + (0.10 + rng() * 0.22) + ')';
        c.fillRect(-26 + rng() * 50, -50 + rng() * 40, 1 + rng() * 2, 3 + rng() * 14);
      }
      c.restore();
    });
    // Kutu kapağı / kasa
    S.crate = spriteBig(101, 1.5, (c) => {
      c.save(); c.translate(32, 38);
      c.fillStyle = 'rgba(0,0,0,.45)'; c.beginPath(); c.ellipse(0, 16, 15, 5, 0, 0, 6.3); c.fill();
      c.fillStyle = 'rgb(74,62,46)'; c.fillRect(-14, -14, 28, 30);
      c.fillStyle = 'rgb(58,48,36)'; c.fillRect(-14, -14, 28, 4); c.fillRect(-14, 10, 28, 6);
      c.strokeStyle = 'rgba(20,16,12,.7)'; c.lineWidth = 1; c.strokeRect(-14, -14, 28, 30);
      c.fillStyle = 'rgba(150,140,120,.25)'; c.fillRect(-6, -6, 12, 4);
      c.restore();
    });
    // Fener direği
    S.lamp = spriteBig(111, 1.5, (c) => {
      c.save(); c.translate(32, 56);
      c.strokeStyle = 'rgb(48,48,44)'; c.lineWidth = 3;
      c.beginPath(); c.moveTo(0, 0); c.lineTo(0, -46); c.stroke();
      c.fillStyle = 'rgb(40,42,40)'; c.fillRect(-7, -52, 14, 8);
      const g = c.createRadialGradient(0, -48, 1, 0, -48, 20);
      g.addColorStop(0, 'rgba(255,240,200,.95)'); g.addColorStop(0.4, 'rgba(255,200,120,.5)'); g.addColorStop(1, 'rgba(255,180,80,0)');
      c.fillStyle = g; c.beginPath(); c.arc(0, -48, 20, 0, 6.3); c.fill();
      c.restore();
    });
    // Dikenli tuzak
    S.spike = sprite(121, (c) => {
      c.save(); c.translate(32, 48);
      for (let i = -2; i <= 2; i++) {
        c.fillStyle = 'rgb(120,120,112)';
        c.beginPath(); c.moveTo(i * 9 - 3, 0); c.lineTo(i * 9, -22 - Math.abs(i) * -4); c.lineTo(i * 9 + 3, 0); c.closePath(); c.fill();
        c.fillStyle = 'rgba(120,20,10,.5)';
        c.beginPath(); c.moveTo(i * 9 - 1, -8); c.lineTo(i * 9, -22); c.lineTo(i * 9 + 1, -8); c.closePath(); c.fill();
      }
      c.restore();
    });
    // Kutu kapağı (Kutu'nun yukarıdan inen platformu)
    S.boxLid = sprite(131, (c) => {
      c.save(); c.translate(32, 40);
      c.fillStyle = 'rgb(58,62,60)'; c.fillRect(-22, 0, 44, 18);
      c.fillStyle = 'rgb(44,48,46)'; c.fillRect(-22, 0, 44, 4);
      c.strokeStyle = 'rgba(160,220,235,.35)'; c.lineWidth = 1;
      for (let x = -18; x <= 18; x += 9) c.strokeRect(x, 5, 6, 10);
      c.fillStyle = 'rgba(120,220,255,.25)'; c.fillRect(-20, 16, 40, 2);
      c.restore();
    });
    // Baraka (Kayran kulübesi)
    S.hut = spriteBig(211, 2.5, (c, rng) => {
      c.save(); c.translate(32, 56);
      c.fillStyle = 'rgba(0,0,0,.4)'; c.beginPath(); c.ellipse(0, 6, 26, 6, 0, 0, 6.3); c.fill();
      // gövde
      c.fillStyle = 'rgb(64,54,40)';
      c.fillRect(-22, -26, 44, 32);
      c.strokeStyle = 'rgba(24,20,14,.85)'; c.lineWidth = 1;
      for (let y = -26; y < 6; y += 5) { c.beginPath(); c.moveTo(-22, y); c.lineTo(22, y); c.stroke(); }
      // çatı
      c.fillStyle = 'rgb(40,34,26)';
      c.beginPath(); c.moveTo(-28, -26); c.lineTo(0, -48); c.lineTo(28, -26); c.closePath(); c.fill();
      c.strokeStyle = 'rgba(16,14,10,.9)';
      for (let i = -24; i <= 24; i += 7) { c.beginPath(); c.moveTo(i, -27); c.lineTo(i * 0.35, -45); c.stroke(); }
      // kapı
      c.fillStyle = 'rgb(28,24,18)'; c.fillRect(-7, -18, 14, 24);
      c.fillStyle = 'rgba(255,190,110,.18)'; c.fillRect(-6, -17, 12, 22);
      // ayrıntı: teneke
      c.fillStyle = 'rgba(120,120,110,.25)'; c.fillRect(10, -12, 8, 10);
      c.restore();
    });
    // Griever kovanı (organik yığın)
    S.hive = spriteBig(221, 2, (c, rng) => {
      c.save(); c.translate(32, 58);
      c.fillStyle = 'rgba(0,0,0,.45)'; c.beginPath(); c.ellipse(0, 4, 30, 8, 0, 0, 6.3); c.fill();
      const g = c.createRadialGradient(-6, -26, 4, 0, -18, 34);
      g.addColorStop(0, 'rgb(96,66,84)'); g.addColorStop(0.6, 'rgb(52,34,46)'); g.addColorStop(1, 'rgb(20,14,20)');
      c.fillStyle = g;
      c.beginPath();
      c.moveTo(-28, 0);
      c.bezierCurveTo(-30, -26, -14, -46, 0, -50);
      c.bezierCurveTo(16, -46, 30, -26, 28, 0);
      c.closePath(); c.fill();
      // kabarcıklar / damarlar
      for (let i = 0; i < 26; i++) {
        const a = rng() * 6.283, r = 6 + rng() * 22;
        c.strokeStyle = 'rgba(180,60,100,' + (0.06 + rng() * 0.14) + ')';
        c.lineWidth = 1 + rng() * 1.6;
        c.beginPath(); c.arc(Math.cos(a) * r * 0.7, -20 + Math.sin(a) * r * 0.55, 3 + rng() * 7, rng() * 3, rng() * 3 + 2); c.stroke();
      }
      // ağız
      c.fillStyle = 'rgb(8,6,9)';
      c.beginPath(); c.ellipse(0, -12, 9, 7, 0, 0, 6.3); c.fill();
      c.fillStyle = 'rgba(255,60,90,.28)';
      c.beginPath(); c.ellipse(0, -12, 6, 4.5, 0, 0, 6.3); c.fill();
      c.restore();
    });
    // Grievers mızrağı (elde)
    S.spear = sprite(231, (c) => {
      c.save(); c.translate(32, 32);
      c.fillStyle = 'rgb(70,58,42)'; c.fillRect(-2, 2, 4, 60);
      c.fillStyle = 'rgb(46,38,28)'; c.fillRect(-3, 26, 6, 3); c.fillRect(-3, 38, 6, 3);
      // uç
      c.fillStyle = 'rgb(178,180,172)';
      c.beginPath(); c.moveTo(-5, 4); c.lineTo(0, -26); c.lineTo(5, 4); c.closePath(); c.fill();
      c.fillStyle = 'rgba(255,255,255,.25)';
      c.beginPath(); c.moveTo(-2, 2); c.lineTo(0, -26); c.lineTo(1, 2); c.closePath(); c.fill();
      // bağ
      c.strokeStyle = 'rgb(120,90,50)'; c.lineWidth = 1.5;
      c.beginPath(); c.moveTo(-4, 2); c.lineTo(4, 6); c.stroke();
      c.restore();
    });
    // Meşale ateşi (billboard, animasyon için 2 kare)
    S.flame = sprite(141, (c, rng) => {
      c.save(); c.translate(32, 44);
      for (let i = 0; i < 3; i++) {
        const g = c.createRadialGradient(0, -12, 1, 0, -12, 16 + i * 3);
        g.addColorStop(0, 'rgba(255,240,190,.9)');
        g.addColorStop(0.35, 'rgba(255,170,60,.6)');
        g.addColorStop(1, 'rgba(200,60,20,0)');
        c.fillStyle = g;
        c.beginPath(); c.ellipse((rng() - 0.5) * 4, -12 - rng() * 6, 5 + rng() * 3, 9 + rng() * 5, 0, 0, 6.3); c.fill();
      }
      c.restore();
    });
    // Çalı yaprağı tek (vurgu)
    S.grassTuft = sprite(151, (c, rng) => {
      c.save(); c.translate(32, 60);
      for (let i = 0; i < 12; i++) {
        const g = 40 + rng() * 50;
        c.strokeStyle = 'rgba(' + (g * 0.5 | 0) + ',' + g + ',' + (g * 0.36 | 0) + ',.9)';
        c.lineWidth = 1 + rng();
        c.beginPath(); c.moveTo((rng() - 0.5) * 10, 0);
        c.quadraticCurveTo((rng() - 0.5) * 18, -16, (rng() - 0.5) * 26, -22 - rng() * 12);
        c.stroke();
      }
      c.restore();
    });
    // Asma / sarkan yaprak (Labirent duvar üstü)
    S.vine = sprite(161, (c, rng) => {
      c.save(); c.translate(32, 0);
      for (let i = 0; i < 4; i++) {
        let x = (rng() - 0.5) * 26, y = 0;
        c.strokeStyle = 'rgba(26,36,20,.95)'; c.lineWidth = 1.4;
        c.beginPath(); c.moveTo(x, y);
        while (y < 34 + rng() * 22) { x += (rng() - 0.5) * 6; y += 4 + rng() * 4; c.lineTo(x, y); }
        c.stroke();
        for (let l = 0; l < 8; l++) {
          const g = 34 + rng() * 40;
          c.fillStyle = 'rgba(' + (g * 0.5 | 0) + ',' + g + ',' + (g * 0.36 | 0) + ',.85)';
          c.beginPath(); c.ellipse(x + (rng() - 0.5) * 16, rng() * 40, 2 + rng() * 2.4, 1.4 + rng() * 1.6, rng() * 3, 0, 6.3); c.fill();
        }
      }
      c.restore();
    });
    // Duman/parçacık (griever sisi değil — sadece billboard sisi)
    S.fog = sprite(171, (c, rng) => {
      c.save(); c.translate(32, 32);
      for (let i = 0; i < 5; i++) {
        const g = c.createRadialGradient((rng() - 0.5) * 12, (rng() - 0.5) * 12, 2, 0, 0, 24 + rng() * 6);
        g.addColorStop(0, 'rgba(120,130,130,.20)'); g.addColorStop(1, 'rgba(120,130,130,0)');
        c.fillStyle = g; c.beginPath(); c.arc(0, 0, 26, 0, 6.3); c.fill();
      }
      c.restore();
    });
    // Uyarı üçgeni (görev işaretçisi / mesaj)
    S.sign = sprite(181, (c) => {
      c.save(); c.translate(32, 40);
      c.fillStyle = 'rgb(60,54,44)'; c.fillRect(-2, -8, 4, 22);
      c.fillStyle = 'rgb(74,66,52)'; c.fillRect(-15, -22, 30, 16);
      c.strokeStyle = 'rgba(20,18,14,.8)'; c.lineWidth = 1; c.strokeRect(-15, -22, 30, 16);
      c.fillStyle = 'rgba(255,190,110,.7)'; c.font = 'bold 9px monospace'; c.textAlign = 'center';
      c.fillText('7', 0, -11);
      c.restore();
    });
    // Yumurta / kovan kesesi
    S.egg = sprite(191, (c) => {
      c.save(); c.translate(32, 44);
      c.fillStyle = 'rgba(0,0,0,.4)'; c.beginPath(); c.ellipse(0, 12, 11, 4, 0, 0, 6.3); c.fill();
      const g = c.createRadialGradient(-3, -6, 2, 0, 0, 16);
      g.addColorStop(0, 'rgb(150,110,140)'); g.addColorStop(1, 'rgb(48,32,46)');
      c.fillStyle = g; c.beginPath(); c.ellipse(0, 0, 11, 14, 0, 0, 6.3); c.fill();
      c.strokeStyle = 'rgba(200,80,120,.35)'; c.lineWidth = 1;
      for (let i = 0; i < 4; i++) { c.beginPath(); c.arc(0, 0, 4 + i * 3, 0.4, 2.4); c.stroke(); }
      c.restore();
    });
    return S;
  }

  /* ---------- tavan: kaba kaya + kiriş izleri ---------- */
  function texCeil(seed) {
    const ctx = getCtx(TS, TS); if (!ctx) return null;
    paint(ctx, TS, TS, seed, (x, y) => {
      const n = fbm(x / 22, y / 22, 6, 4, seed) * 0.6 + fbm(x / 6, y / 6, 8, 3, seed + 9) * 0.4;
      const g = 46 + n * 46;
      const cr = fbm(x / 13, y / 13, 4, 3, seed + 31);
      const crack = cr > 0.62 ? 1 : 0;
      const v = (g * (crack ? 0.55 : 1)) | 0;
      const moss = clamp(fbm(x / 26, y / 26, 4, 3, seed + 77) - 0.44, 0, 1) * 0.5;
      return [v * (1 - moss * 0.25) | 0, (v + moss * 22) | 0, (v * 0.96 + moss * 10) | 0, 255];
    });
    speckle(ctx, TS, TS, seed + 5, 900, [22, 24, 26], 1);
    return ctx.canvas;
  }

  /* ---------- normal + parlama haritası (yükseklik ≈ parlaklık) ---------- */
  function attachMaps(cv, bump, specAmt) {
    if (!cv || !cv.getContext) return cv;
    const c = cv.getContext('2d');
    const w = cv.width, h = cv.height;
    const d = c.getImageData(0, 0, w, h).data;
    const n = new Uint8Array(w * h * 2);
    const sp = new Uint8Array(w * h);
    const lum = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) {
      lum[i] = (d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114) / 255;
    }
    for (let y = 0; y < h; y++) {
      const ym = y > 0 ? y - 1 : h - 1, yp = y < h - 1 ? y + 1 : 0;
      for (let x = 0; x < w; x++) {
        const xm = x > 0 ? x - 1 : w - 1, xp = x < w - 1 ? x + 1 : 0;
        const dx = (lum[y * w + xp] - lum[y * w + xm]) * bump;
        const dy = (lum[yp * w + x] - lum[ym * w + x]) * bump;
        const nx2 = clamp(-dx, -1, 1), ny2 = clamp(-dy, -1, 1);
        const i = (y * w + x);
        n[i * 2] = Math.round((nx2 * 0.5 + 0.5) * 255);
        n[i * 2 + 1] = Math.round((ny2 * 0.5 + 0.5) * 255);
        sp[i] = Math.round(clamp((lum[i] - 0.42) * 1.7, 0, 1) * 255 * (specAmt === undefined ? 0.5 : specAmt));
      }
    }
    cv._normal = n; cv._spec = sp; cv._data = null;
    return cv;
  }

  /* ---------- yükleme ---------- */
  function build() {
    const walls = [];
    walls[T.AIR] = null;
    walls[T.STONE] = texStone(1001, [122, 120, 110]);
    walls[T.STONE_MOSS] = texStone(1002, [104, 104, 94]);
    if (walls[T.STONE_MOSS]) mossify(walls[T.STONE_MOSS].getContext('2d'), TS, TS, 1002, 0.62);
    walls[T.HEDERA] = texHedera(1003);
    walls[T.VINE] = texVine(1004);
    walls[T.CLIFF] = texCliff(1005);
    walls[T.BOX] = texBox(1006);
    walls[T.GRASS] = texGrass(1007);
    walls[T.DIRT] = texDirt(1008);
    walls[T.TRACK] = texTrack(1009);
    walls[T.WOOD] = texWood(1010);
    walls[T.GATE] = texGate(1011);
    walls[T.RUNE_PI] = texRune(1012, 'π', true);
    walls[T.RUNE_SYS] = texRune(1013, '7', true);
    walls[T.WATER] = texWater(1014);
    walls[T.GRATE] = texGrate(1015);
    walls[T.HIVE] = texHive(1016);
    walls[T.ROCK] = texCliff(1017);
    walls[T.LEAF] = texLeaf(1018);
    walls[T.CEIL] = texCeil(1019);
    // her rune taşı: basamak + okunma sırası
    const order = (MV.K && MV.K.RUNE_ORDER) || [3, 1, 4, 1, 5, 9, 2, 6];
    for (let k = 0; k < 8; k++) {
      walls[T.RUNE1 + k] = texRuneDigit(3100 + k * 13, order[k], k);
    }

    // küçük varyantlar (aynı doku, farklı seed → çeşitlilik)
    const variant = {
      1: [texStone(2001, [112, 112, 100]), texStone(2002, [132, 126, 112])],
      2: [texStone(2003, [96, 100, 90]), walls[T.STONE_MOSS]],
      13: [texCliff(2005), texCliff(2006)],
      15: [texCliff(2007)],
      5: [texGrass(2008)],
      6: [texDirt(2009)],
      8: [texWood(2010)],
      11: [texVine(2011)],
      18: [texLeaf(2012)]
    };
    /* --- normal/parlama haritaları: dokunun parlaklığı yükseklik kabul edilir --- */
    const BUMP = {
      1: [2.4, 0.35], 2: [2.6, 0.30], 3: [2.0, 0.25], 11: [2.0, 0.25], 13: [2.8, 0.30],
      15: [2.8, 0.30], 4: [1.6, 0.75], 14: [1.5, 0.65], 9: [2.2, 0.45], 10: [2.2, 0.45],
      17: [2.2, 0.35], 18: [2.0, 0.20], 8: [1.8, 0.30], 16: [2.6, 0.85], 5: [1.2, 0.10],
      6: [1.5, 0.12], 7: [1.4, 0.45], 12: [0.7, 0.95], 19: [2.5, 0.22]
    };
    for (const k in walls) {
      const cv = walls[k];
      if (!cv) continue;
      const b0 = BUMP[k] || [2.0, 0.3];
      const b = [b0[0] * (TS / 128), b0[1]];
      attachMaps(cv, b[0], b[1]);
    }
    for (const k in variant) {
      variant[k].forEach(cv => {
        if (!cv) return;
        const b0 = BUMP[k] || [2.0, 0.3];
      const b = [b0[0] * (TS / 128), b0[1]];
        attachMaps(cv, b[0], b[1]);
      });
    }

    const sprites = makeSprites();
    /* --- seviye düzeltmesi: tüm dokular ve sprite'lar --- */
    for (const k in walls) {
      const cv = walls[k];
      if (cv && cv.getContext) levelBoost(cv.getContext('2d'), 0.66, 7);
    }
    for (const k in variant) {
      variant[k].forEach(cv => { if (cv && cv.getContext) levelBoost(cv.getContext('2d')); });
    }
    for (const k in sprites) {
      const cv = sprites[k];
      if (cv && cv.getContext) levelBoost(cv.getContext('2d'), 0.70, 6);
    }

    MV.TEXV = variant;                 // hücre bazlı doku varyantları
    if (walls[T.RUNE_PI]) MV.RUNE_PI_TEX = walls[T.RUNE_PI];
    return { walls: walls, variant: variant, sprites: sprites };
  }

  MV.texBuild = build;
  MV.makeCanvas = makeCanvas;
  MV.texRune = texRune;
})(MV);
