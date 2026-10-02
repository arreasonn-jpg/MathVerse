/* ============================================================
   10-textures.js — prosedürel doku üretimi (dosya yok, hepsi kod)
   Inferno Protocol paleti: kirli beton, yosun, pas, organik çelik
   ============================================================ */
(function (MV) {
  'use strict';
  const { rgb, rgba, pack, mixC, clamp, RNG, h2, fbm, pnoise, celNoise, lerp } = MV;

  const TS = 64;                 // doku boyutu (kare)
  const TN = 19;                 // doku sayısı
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
    const block = o.block || 32, rows = h / block;
    const rng = RNG(seed);
    // taban harç
    paint(ctx, w, h, seed, (x, y) => {
      const n = fbm(x / 9, y / 9, 8, 3, seed) * 0.5 + fbm(x / 2.5, y / 2.5, 4, 2, seed + 5) * 0.5;
      const m = 0.90 + n * 0.30;
      return [mortar[0] * m, mortar[1] * m, mortar[2] * m, 255];
    });
    // bloklar
    for (let r = 0; r < rows; r++) {
      const xoff = (r % 2) ? block / 2 : 0;
      for (let cx = -1; cx <= w / block; cx++) {
        const bx = cx * block + xoff + 1, by = r * block + 1;
        const bw = block - 2, bh = block - 2;
        const t = rng();
        const tint = 0.82 + t * 0.36;
        const stoneCol = [base[0] * tint, base[1] * tint, base[2] * tint];
        // blok içi pikseller
        for (let y = by; y < by + bh; y++) {
          for (let x = bx; x < bx + bw; x++) {
            if (x < 0 || y < 0 || x >= w || y >= h) continue;
            const grain = fbm(x / 3.2, y / 3.2, 6, 3, seed + r * 31 + cx) * 0.5 +
              fbm(x / 1.4, y / 1.4, 4, 2, seed + 91) * 0.5;
            const edge = Math.min(x - bx, bx + bw - 1 - x, y - by, by + bh - 1 - y);
            const bevel = edge < 1 ? 0.74 : (edge < 2 ? 0.90 : 1);
            const m = (0.88 + grain * 0.42) * bevel;
            ctx.fillStyle = 'rgb(' + (stoneCol[0] * m | 0) + ',' + (stoneCol[1] * m | 0) + ',' + (stoneCol[2] * m | 0) + ')';
            ctx.fillRect(x, y, 1, 1);
          }
        }
        // blok üstü leke/çatlak
        if (rng() < 0.55) {
          ctx.fillStyle = 'rgba(0,0,0,' + (0.10 + rng() * 0.20).toFixed(2) + ')';
          const sx = bx + rng() * bw, sy = by + rng() * bh;
          ctx.beginPath(); ctx.ellipse(sx, sy, 2 + rng() * 6, 1.5 + rng() * 4, rng() * 3, 0, 6.3); ctx.fill();
        }
        if (rng() < 0.30) { // çatlak
          ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 1;
          ctx.beginPath();
          let px = bx + rng() * bw, py = by;
          ctx.moveTo(px, py);
          for (let k = 0; k < 4; k++) { px += (rng() - 0.5) * 9; py += bh / 4; ctx.lineTo(px, py); }
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
    speckle(ctx, TS, TS, seed + 3, 240, 'rgba(0,0,0,.22)');
    speckle(ctx, TS, TS, seed + 4, 90, 'rgba(255,255,255,.05)');
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

  function texGrass(seed) { // Kayran çimi
    const ctx = getCtx(TS, TS); if (!ctx) return null;
    paint(ctx, TS, TS, seed, (x, y) => {
      const n = fbm(x / 8, y / 8, 8, 4, seed) * 0.6 + fbm(x / 2.2, y / 2.2, 4, 3, seed + 3) * 0.4;
      const g = 52 + n * 44;
      return [g * 0.72, g * 0.92, g * 0.62, 255];
    });
    const rng = RNG(seed + 6);
    for (let i = 0; i < 1500; i++) {
      const x = rng.next() * TS, y = rng.next() * TS;
      const g = 48 + rng() * 62, dark = rng() < 0.25;
      ctx.fillStyle = dark ? 'rgba(24,30,20,.65)' : 'rgba(' + (g * 0.66 | 0) + ',' + g + ',' + (g * 0.52 | 0) + ',.70)';
      ctx.fillRect(x | 0, y | 0, 1, 1 + (rng() < 0.3 ? 1 : 0));
    }
    // toprak yamaları
    for (let i = 0; i < 7; i++) {
      ctx.fillStyle = 'rgba(48,38,26,.5)';
      ctx.beginPath(); ctx.ellipse(rng.next() * TS, rng.next() * TS, 2 + rng() * 6, 2 + rng() * 5, rng() * 3, 0, 6.3); ctx.fill();
    }
    grimeEdge(ctx, TS, TS, seed, 0.35);
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

  /* ---------- sprite üreticileri (şeffaf zeminli, 64x64) ---------- */
  function sprite(seed, draw) {
    const ctx = getCtx(64, 64); if (!ctx) return null;
    draw(ctx, RNG(seed));
    return ctx.canvas;
  }

  function makeSprites() {
    const S = {};
    // GRIEVER — örümcek-yengeç melezi: gövde, kabuk plakaları, 8 uzuv, kırmızı sensörler
    S.griever = sprite(7, (c, rng) => {
      c.save(); c.translate(32, 34);
      // gölge
      c.fillStyle = 'rgba(0,0,0,.45)'; c.beginPath(); c.ellipse(0, 20, 20, 6, 0, 0, 6.3); c.fill();
      // uzuvlar
      for (let s = -1; s <= 1; s += 2) for (let i = 0; i < 4; i++) {
        const a = (-0.9 + i * 0.62) * s + (s > 0 ? 0 : Math.PI);
        const L = 22 + i * 3;
        const kx = Math.cos(a) * L * 0.6, ky = Math.sin(a) * L * 0.45 - 6;
        const ex = Math.cos(a) * L * (s > 0 ? 1 : 1) - (s < 0 ? 0 : 0), ey = Math.sin(a) * L * 0.35 + 12;
        c.strokeStyle = 'rgb(38,30,34)'; c.lineWidth = 3.4;
        c.beginPath(); c.moveTo(s * 6, 0); c.lineTo(kx * (s > 0 ? 1 : -1) * (s > 0 ? 1 : 1) + s * 2, ky); c.stroke();
        c.strokeStyle = 'rgb(24,19,22)'; c.lineWidth = 2.4;
        c.beginPath(); c.moveTo(kx * (s > 0 ? 1 : -1) + s * 2, ky); c.lineTo(ex * (s > 0 ? 1 : -1), ey); c.stroke();
        // pençe
        c.fillStyle = 'rgb(60,52,50)';
        c.beginPath(); c.arc(ex * (s > 0 ? 1 : -1), ey, 2.2, 0, 6.3); c.fill();
      }
      // gövde: kitin plakalar
      const g = c.createRadialGradient(-6, -8, 2, 0, 0, 22);
      g.addColorStop(0, 'rgb(92,74,80)'); g.addColorStop(0.5, 'rgb(58,46,52)'); g.addColorStop(1, 'rgb(24,20,24)');
      c.fillStyle = g;
      c.beginPath(); c.ellipse(0, 0, 19, 14, 0, 0, 6.3); c.fill();
      c.strokeStyle = 'rgba(12,10,12,.9)'; c.lineWidth = 1;
      for (let i = -2; i <= 2; i++) {
        c.beginPath(); c.ellipse(i * 3.6, 0, 3.4, 13 - Math.abs(i) * 1.6, 0, 0, 6.3); c.stroke();
      }
      // kafa plakası + sensörler
      c.fillStyle = 'rgb(30,24,28)';
      c.beginPath(); c.ellipse(0, -9, 10, 7, 0, 0, 6.3); c.fill();
      c.fillStyle = '#ff3a2a';
      c.beginPath(); c.arc(-4.2, -10, 1.7, 0, 6.3); c.fill();
      c.beginPath(); c.arc(4.2, -10, 1.7, 0, 6.3); c.fill();
      c.fillStyle = 'rgba(255,120,90,.55)';
      c.beginPath(); c.arc(-4.2, -10, 3.4, 0, 6.3); c.fill();
      c.beginPath(); c.arc(4.2, -10, 3.4, 0, 6.3); c.fill();
      // iğne kolları
      c.strokeStyle = 'rgb(20,16,18)'; c.lineWidth = 2;
      c.beginPath(); c.moveTo(-7, -6); c.lineTo(-16, -16); c.stroke();
      c.beginPath(); c.moveTo(7, -6); c.lineTo(16, -16); c.stroke();
      c.restore();
    });
    // BÖCEK BIÇAĞI — WICKED casusu
    S.beetle = sprite(11, (c) => {
      c.save(); c.translate(32, 30);
      const body = c.createLinearGradient(0, -12, 0, 12);
      body.addColorStop(0, 'rgb(120,130,128)'); body.addColorStop(1, 'rgb(38,44,44)');
      c.fillStyle = body;
      c.beginPath(); c.ellipse(0, 0, 8, 12, 0, 0, 6.3); c.fill();
      c.strokeStyle = 'rgba(10,12,12,.8)'; c.lineWidth = 1;
      c.beginPath(); c.moveTo(0, -12); c.lineTo(0, 12); c.stroke();
      c.fillStyle = 'rgb(28,32,32)';
      c.beginPath(); c.ellipse(0, -13, 5, 4, 0, 0, 6.3); c.fill();
      // sensör göz
      c.fillStyle = '#8ef0ff'; c.beginPath(); c.arc(0, -14, 1.6, 0, 6.3); c.fill();
      c.fillStyle = 'rgba(140,240,255,.35)'; c.beginPath(); c.arc(0, -14, 3.4, 0, 6.3); c.fill();
      // kanat kılıfları
      c.strokeStyle = 'rgba(200,210,205,.25)'; c.lineWidth = 1;
      for (let i = -1; i <= 1; i++) { c.beginPath(); c.moveTo(i * 3, -8); c.lineTo(i * 4, 8); c.stroke(); }
      // 3 çift bacak
      for (let i = 0; i < 3; i++) for (let s = -1; s <= 1; s += 2) {
        c.strokeStyle = 'rgb(22,26,26)'; c.lineWidth = 1.6;
        c.beginPath(); c.moveTo(s * 6, -6 + i * 6);
        c.lineTo(s * 12, -9 + i * 7); c.lineTo(s * 15, -2 + i * 7); c.stroke();
      }
      // anten
      c.strokeStyle = 'rgb(30,34,34)'; c.lineWidth = 1.2;
      c.beginPath(); c.moveTo(-2, -16); c.lineTo(-7, -22); c.stroke();
      c.beginPath(); c.moveTo(2, -16); c.lineTo(7, -22); c.stroke();
      c.restore();
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
    S.tracker = sprite(41, (c) => {
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
    S.box = sprite(241, (c, rng) => {
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
    S.crate = sprite(101, (c) => {
      c.save(); c.translate(32, 38);
      c.fillStyle = 'rgba(0,0,0,.45)'; c.beginPath(); c.ellipse(0, 16, 15, 5, 0, 0, 6.3); c.fill();
      c.fillStyle = 'rgb(74,62,46)'; c.fillRect(-14, -14, 28, 30);
      c.fillStyle = 'rgb(58,48,36)'; c.fillRect(-14, -14, 28, 4); c.fillRect(-14, 10, 28, 6);
      c.strokeStyle = 'rgba(20,16,12,.7)'; c.lineWidth = 1; c.strokeRect(-14, -14, 28, 30);
      c.fillStyle = 'rgba(150,140,120,.25)'; c.fillRect(-6, -6, 12, 4);
      c.restore();
    });
    // Fener direği
    S.lamp = sprite(111, (c) => {
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
    S.hut = sprite(211, (c, rng) => {
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
    S.hive = sprite(221, (c, rng) => {
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
    const sprites = makeSprites();
    /* --- seviye düzeltmesi: tüm dokular ve sprite'lar --- */
    for (const k in walls) {
      const cv = walls[k];
      if (cv && cv.getContext) levelBoost(cv.getContext('2d'));
    }
    for (const k in variant) {
      variant[k].forEach(cv => { if (cv && cv.getContext) levelBoost(cv.getContext('2d')); });
    }
    for (const k in sprites) {
      const cv = sprites[k];
      if (cv && cv.getContext) levelBoost(cv.getContext('2d'), 0.68, 8);
    }

    MV.TEXV = variant;                 // hücre bazlı doku varyantları
    if (walls[T.RUNE_PI]) MV.RUNE_PI_TEX = walls[T.RUNE_PI];
    return { walls: walls, variant: variant, sprites: sprites };
  }

  MV.texBuild = build;
  MV.makeCanvas = makeCanvas;
  MV.texRune = texRune;
})(MV);
