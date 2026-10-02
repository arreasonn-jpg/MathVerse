/* ============================================================
   20-maze.js — Labirent dünyası: Kayran, Geçitler, Sektör duvarları,
   DFS labirenti, Kaydırma (duvarların her gece yer değiştirmesi),
   Uçurum (ravine) ve dış kuşak.  (DOM'suz.)
   ============================================================ */
(function (MV) {
  'use strict';
  const { RNG, h2, clamp, TAU } = MV;
  const T = MV.T;

  /* ---------- sabitler ---------- */
  const K = {
    W: 152, H: 152,          // hücre sayısı (çift olmalı)
    R1: 10.5,                // Kayran yarıçapı (çim)
    R2A: 18.5,               // halka koridorunun dış sınırı
    R2B: 21.5,               // sektör duvarının dış sınırı / labirent başlangıcı
    RAV0: 61.5,              // uçurum iç kenarı
    RAV1: 66.5,              // uçurum dış kenarı
    ROUT: 70,                // dış kuşak taş duvarı
    VOID: 250,               // boşluk (düşme) zemin kodu
    GATE_R: 14.5,            // geçit yarıçapı
    SPOKE_ANGLES: [Math.PI / 4, 3 * Math.PI / 4, 5 * Math.PI / 4, 7 * Math.PI / 4],
    GAP_ANGLES: [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2], // Kayran kapıları (D/G/B/K)
    RUNE_ORDER: [3, 1, 4, 1, 5, 9, 2, 6]  // π kod dizisi
  };
  MV.K = K;

  const I = (w, x, y) => y * w.W + x;
  const inb = (w, x, y) => x >= 0 && y >= 0 && x < w.W && y < w.H;
  const rad = (w, x, y) => Math.hypot(x - w.cx, y - w.cy);
  const ang = (w, x, y) => Math.atan2(y - w.cy, x - w.cx);

  /* ---------- temel fırçalar ---------- */
  function setSolidAt(w, x, y, solid, tex) {
    if (!inb(w, x, y)) return;
    const i = I(w, x, y);
    w.solid[i] = solid ? 1 : 0;
    if (tex !== undefined) w.wall[i] = tex;
    if (!solid) { w.void[i] = 0; }
  }
  function fillAll(w, solid, tex, floor) {
    for (let y = 0; y < w.H; y++) for (let x = 0; x < w.W; x++) {
      const i = I(w, x, y);
      w.solid[i] = solid; w.wall[i] = tex; w.floor[i] = floor; w.void[i] = 0; w.hscale[i] = 40;
    }
  }
  function ring(w, rin, rout, solid, tex, floor) {
    for (let y = 0; y < w.H; y++) for (let x = 0; x < w.W; x++) {
      const r = rad(w, x + 0.5, y + 0.5);
      if (r >= rin && r < rout) {
        const i = I(w, x, y);
        w.solid[i] = solid; if (tex !== undefined) w.wall[i] = tex;
        if (floor !== undefined) w.floor[i] = floor;
        if (!solid) w.void[i] = 0;
      }
    }
  }
  function disc(w, r0, solid, tex, floor) {
    for (let y = 0; y < w.H; y++) for (let x = 0; x < w.W; x++) {
      const r = rad(w, x + 0.5, y + 0.5);
      if (r < r0) {
        const i = I(w, x, y);
        w.solid[i] = solid; if (tex !== undefined) w.wall[i] = tex;
        if (floor !== undefined) w.floor[i] = floor;
        if (!solid) w.void[i] = 0;
      }
    }
  }
  function setHeightRing(w, rin, rout, h) {
    for (let y = 0; y < w.H; y++) for (let x = 0; x < w.W; x++) {
      const r = rad(w, x + 0.5, y + 0.5);
      if (r >= rin && r < rout) w.hscale[I(w, x, y)] = h;
    }
  }
  /* bir açı boyunca yay biçimli boşluk açar (kapı/geçit) */
  function carveArcGap(w, a, r0, r1, halfAng) {
    for (let rr = r0; rr <= r1; rr += 0.25) {
      for (let da = -halfAng; da <= halfAng; da += 0.008) {
        const x = Math.floor(w.cx + Math.cos(a + da) * rr);
        const y = Math.floor(w.cy + Math.sin(a + da) * rr);
        if (!inb(w, x, y)) continue;
        const i = I(w, x, y);
        w.solid[i] = 0; w.void[i] = 0;
        if (w.floor[i] === K.VOID) w.floor[i] = T.DIRT;
      }
    }
  }

  /* ---------- dünya üretimi ---------- */
  function genWorld(seed, day) {
    day = day || 1;
    const w = {
      seed: seed, day: day, W: K.W, H: K.H, cx: K.W / 2, cy: K.H / 2,
      solid: new Uint8Array(K.W * K.H),
      void: new Uint8Array(K.W * K.H),
      wall: new Uint8Array(K.W * K.H),
      floor: new Uint8Array(K.W * K.H),
      sector: new Uint8Array(K.W * K.H),
      gate: new Uint8Array(K.W * K.H),
      hscale: new Uint8Array(K.W * K.H),
      hidden: new Uint8Array(K.W * K.H),
      runes: [], gates: [], channels: [], hive: null, hatch: null
    };
    const rng = RNG(seed >>> 0);

    /* 1) her yeri kaya ile doldur */
    fillAll(w, 1, T.CLIFF, T.DIRT);

    /* 2) dış duvar ve dış kuşak */
    ring(w, K.ROUT, K.W, 1, T.CLIFF, T.DIRT);
    setHeightRing(w, K.ROUT, K.W, 95);
    ring(w, K.RAV1, K.ROUT, 0, T.CLIFF, T.ROCK);
    setHeightRing(w, K.RAV1, K.ROUT, 32);

    /* 3) uçurum boşluğu */
    ring(w, K.RAV0, K.RAV1, 0, T.CLIFF, K.VOID);
    for (let y = 0; y < w.H; y++) for (let x = 0; x < w.W; x++) {
      const r = rad(w, x + 0.5, y + 0.5);
      if (r >= K.RAV0 && r < K.RAV1) { const i = I(w, x, y); w.void[i] = 1; w.solid[i] = 0; }
    }

    /* 4) labirent kuşağı: boşalt */
    ring(w, K.R2B, K.RAV0, 0, T.CLIFF, T.DIRT);

    /* 5) sektör duvarı (kalın kaya) */
    ring(w, K.R2A, K.R2B, 1, T.CLIFF, T.DIRT);
    setHeightRing(w, K.R2A, K.R2B, 70);

    /* 6) Kayran: çim + yüksek duvar + 4 GEÇİT */
    disc(w, K.R1, 0, T.HEDERA, T.GRASS);
    ring(w, K.R1, K.R2A, 0, T.STONE, T.DIRT);          // halka yolu (Kayran dışı)
    ring(w, K.R1, K.R1 + 1.05, 1, T.CLIFF, T.DIRT);    // Kayran duvarı (yüksek taş)
    setHeightRing(w, K.R1, K.R1 + 1.05, 72);

    /* 7) geçitler: Kayran duvarında 4 kapı + sektör duvarında 4 ağız */
    for (const a of K.GAP_ANGLES) {
      carveArcGap(w, a, K.R1 - 0.8, K.R1 + 1.9, 0.080);          // geçit boşluğu
      carveArcGap(w, a, K.R2A - 0.6, K.R2B + 1.2, 0.072);        // sektör ağzı
    }
    /* geçit kanatları: boşluğun iki yanına ahşap/çelik kapı gözleri */
    const gateSeen = {};
    for (const a of K.GAP_ANGLES) {
      for (let rr = K.R1 + 0.15; rr < K.R1 + 0.95; rr += 0.18) {
        for (let da = -0.080; da <= 0.080; da += 0.01) {
          const x = Math.floor(w.cx + Math.cos(a + da) * rr);
          const y = Math.floor(w.cy + Math.sin(a + da) * rr);
          if (!inb(w, x, y)) continue;
          const i = I(w, x, y);
          if (w.solid[i]) continue;
          w.gate[i] = 1;
          w.wall[i] = T.GATE;
          w.floor[i] = T.TRACK;
          w.hscale[i] = 60;
          if (!gateSeen[i]) {
            gateSeen[i] = 1;
            w.gates.push({ x: x, y: y, a: a, sector: 0 });
          }
        }
      }
    }

    /* 8) sektörler (köşegenler arası 4 çeyrek) */
    for (let y = 0; y < w.H; y++) for (let x = 0; x < w.W; x++) {
      const r = rad(w, x + 0.5, y + 0.5);
      if (r < K.R2B) { w.sector[I(w, x, y)] = 255; continue; }
      const a = ang(w, x + 0.5, y + 0.5);
      w.sector[I(w, x, y)] = Math.floor(((a + TAU + TAU / 8) % TAU) / (TAU / 4));
    }

    /* 9) halka yolundan geçide uzanan kısa koridorlar (gece dışarıda kalma riski) */
    for (const a of K.GAP_ANGLES) carveArcGap(w, a, K.R1 - 1.2, K.R2A - 1.0, 0.085);

    /* 10) labirent */
    carveLabyrinth(w, rng, K.R2B, K.RAV0 - 1.5);
    /*     sektör ağızları labirentin içine kadar açılsın */
    for (const a of K.GAP_ANGLES) ensureConnection(w, a, K.R2A - 0.6);

    /* 11) ana arterler */
    boulevards(w, rng, 6);

    /* 12) uçurumu geçen kanallar */
    channels(w, rng, 2);

    /* 13) rune taşları */
    placeRunes(w, rng);

    /* 14) sektör duvarlarına sistem sembolleri */
    for (let i = 0; i < 60; i++) {
      const x = rng.int(K.W), y = rng.int(K.H);
      const r = rad(w, x, y);
      if (r > K.R2A + 2 && r < K.RAV0 - 2 && w.solid[I(w, x, y)] && w.wall[I(w, x, y)] === T.CLIFF) {
        w.wall[I(w, x, y)] = T.RUNE_SYS;
      }
    }

    /* 15) gizli geçitler */
    hiddenPassages(w, rng, 10);

    /* 16) doğuş noktası: Kayran, Kutu'nun yanı */
    w.spawn = { x: w.cx + 4.5, y: w.cy + 4.5, a: -Math.PI * 0.75 };
    w.boxAt = { x: w.cx + 2, y: w.cy + 2 };

    /* 17) çıkış kapağı + kovan (dış kuşak) */
    const rim = K.RAV1 + 2.0;
    const mk = (ch) => {
      const a = ch ? ch.aEnd : 0;
      return { x: Math.round(w.cx + Math.cos(a) * rim), y: Math.round(w.cy + Math.sin(a) * rim), a: a };
    };
    w.hatch = mk(w.channels[0]);
    w.hive = mk(w.channels[1]);
    clearArea(w, w.hatch.x, w.hatch.y, 3.4);
    clearArea(w, w.hive.x, w.hive.y, 3.4);

    return w;
  }

  /* Sektör geçidinden labirente kesintisiz bir koridor açar */
  function ensureConnection(w, a, rStart) {
    const r0 = Math.floor(rStart), rMax = K.RAV0 - 2;
    for (let r = r0; r < rMax; r++) {
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        const x = Math.floor(w.cx + Math.cos(a) * r) + ox;
        const y = Math.floor(w.cy + Math.sin(a) * r) + oy;
        if (!inb(w, x, y)) continue;
        const i = I(w, x, y);
        w.solid[i] = 0; w.void[i] = 0;
        if (w.floor[i] === K.VOID) w.floor[i] = T.ROCK;
      }
      // koridordan yana açılan bir hücre bulunduysa yeter
      if (r > K.R2B + 2) {
        const x = Math.floor(w.cx + Math.cos(a) * r), y = Math.floor(w.cy + Math.sin(a) * r);
        for (const d of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + d[0] * 2, ny = y + d[1] * 2;
          if (inb(w, nx, ny) && !w.solid[I(w, nx, ny)] && !w.void[I(w, nx, ny)]) return;
        }
      }
    }
  }

  function clearArea(w, cx, cy, r) {
    for (let y = Math.floor(cy - r); y <= cy + r; y++)
      for (let x = Math.floor(cx - r); x <= cx + r; x++) {
        if (!inb(w, x, y)) continue;
        if (rad(w, x + .5, y + .5) > K.ROUT - 2.0) continue;
        const i = I(w, x, y);
        w.solid[i] = 0; w.void[i] = 0;
        if (w.floor[i] === K.VOID) w.floor[i] = T.ROCK;
      }
  }

  /* ---------- labirent (DFS, çift koordinat odaları) ---------- */
  function carveLabyrinth(w, rng, rin, rout) {
    const rooms = [];
    const mark = new Uint8Array(w.W * w.H);
    /* 0) önce kuşağı gerçekten duvarla (gizli geçitler korunur) */
    for (let y = 0; y < w.H; y++) for (let x = 0; x < w.W; x++) {
      const r = rad(w, x + .5, y + .5);
      if (r < rin || r > rout) continue;
      const i = I(w, x, y);
      if (w.hidden[i]) continue;
      w.solid[i] = 1;
      w.wall[i] = rng.chance(0.30) ? T.STONE_MOSS : T.STONE;
      w.hscale[i] = 40;
    }
    for (let y = 2; y < w.H - 2; y += 2) for (let x = 2; x < w.W - 2; x += 2) {
      const r = rad(w, x + .5, y + .5);
      if (r < rin || r > rout) continue;
      rooms.push(I(w, x, y));
      w.solid[I(w, x, y)] = 0;
      w.floor[I(w, x, y)] = T.DIRT;
    }
    if (!rooms.length) return;
    const start = rooms[rng.int(rooms.length)];
    const stack = [start];
    mark[start] = 1;
    const dirs = [[2, 0], [-2, 0], [0, 2], [0, -2]];
    while (stack.length) {
      const cur = stack[stack.length - 1];
      const cx = cur % w.W, cy = (cur / w.W) | 0;
      rng.shuffle(dirs);
      let moved = false;
      for (const d of dirs) {
        const nx = cx + d[0], ny = cy + d[1];
        if (nx < 2 || ny < 2 || nx >= w.W - 2 || ny >= w.H - 2) continue;
        const r = rad(w, nx + .5, ny + .5);
        if (r < rin || r > rout) continue;
        if (mark[I(w, nx, ny)]) continue;
        const mx = cx + d[0] / 2, my = cy + d[1] / 2;
        w.solid[I(w, mx, my)] = 0; w.floor[I(w, mx, my)] = T.DIRT; mark[I(w, mx, my)] = 1;
        w.solid[I(w, nx, ny)] = 0; w.floor[I(w, nx, ny)] = T.DIRT;
        mark[I(w, nx, ny)] = 1;
        stack.push(I(w, nx, ny));
        moved = true;
        break;
      }
      if (!moved) stack.pop();
    }
    /* ulaşılamayan odaları bağla */
    const iso = rooms.filter(i => !mark[i]);
    for (const is of iso) {
      const x = is % w.W, y = (is / w.W) | 0;
      let done = false;
      for (let d = 2; d <= 40 && !done; d += 2) {
        for (const dd of [[d, 0], [-d, 0], [0, d], [0, -d]]) {
          const nx = x + dd[0], ny = y + dd[1];
          if (!inb(w, nx, ny)) continue;
          if (!mark[I(w, nx, ny)]) continue;
          if (w.void[I(w, nx, ny)]) continue;
          let px = x, py = y;
          const sx = Math.sign(dd[0]), sy = Math.sign(dd[1]);
          while (px !== nx || py !== ny) {
            const i2 = I(w, px, py);
            w.solid[i2] = 0; mark[i2] = 1;
            if (w.floor[i2] === K.VOID) w.floor[i2] = T.ROCK;
            else w.floor[i2] = T.DIRT;
            px += sx; py += sy;
          }
          done = true; break;
        }
      }
    }
    /* örgüleme: bazı duvarları kaldır → döngüler */
    for (let y = 1; y < w.H - 1; y++) for (let x = 1; x < w.W - 1; x++) {
      const r = rad(w, x + .5, y + .5);
      if (r < rin || r > rout) continue;
      const i = I(w, x, y);
      if (!w.solid[i]) continue;
      if ((x % 2) === (y % 2)) continue;      // sütun gözü
      if (w.hidden[i]) continue;
      if (!rng.chance(0.16)) continue;
      w.solid[i] = 0;
      if (w.floor[i] === K.VOID) w.floor[i] = T.ROCK;
    }
  }

  /* ---------- bulvarlar: uzun, hatırlanabilir koridorlar ---------- */
  function boulevards(w, rng, n) {
    for (let k = 0; k < n; k++) {
      const a0 = rng.range(0, TAU);
      let x = w.cx + Math.cos(a0) * (K.R2B + 1.5), y = w.cy + Math.sin(a0) * (K.R2B + 1.5);
      let dir = a0;
      const len = rng.range(30, 52);
      for (let s = 0; s < len; s += 0.7) {
        dir += (rng.next() - 0.5) * 0.10;
        x += Math.cos(dir) * 0.7; y += Math.sin(dir) * 0.7;
        const r = rad(w, x, y);
        if (r > K.RAV0 - 2.5) break;
        for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
          const px = Math.round(x) + ox, py = Math.round(y) + oy;
          if (!inb(w, px, py)) continue;
          if (rad(w, px + .5, py + .5) > K.RAV0 - 1.5) continue;
          const i = I(w, px, py);
          if (w.hidden[i]) continue;
          w.solid[i] = 0;
          w.floor[i] = (ox === 0 && oy === 0) ? T.TRACK : T.DIRT;
        }
      }
    }
  }

  /* ---------- uçurumu geçen kanallar ---------- */
  function channels(w, rng, n) {
    w.channels = [];
    const base = rng.range(0, TAU);
    for (let k = 0; k < n; k++) {
      let a = base + k * Math.PI + rng.range(-0.45, 0.45);
      const pts = [];
      for (let r = K.R2B - 2.5; r <= K.ROUT + 8; r += 0.4) {
        a += (noise1(r * 0.05 + k * 40 + 3) - 0.5) * 0.045;
        pts.push({ x: w.cx + Math.cos(a) * r, y: w.cy + Math.sin(a) * r, r: r });
      }
      for (const p of pts) {
        for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
          const px = Math.round(p.x) + ox, py = Math.round(p.y) + oy;
          if (!inb(w, px, py)) continue;
          const rr = rad(w, px + .5, py + .5);
          if (rr >= K.ROUT) continue;
          const i = I(w, px, py);
          w.solid[i] = 0; w.void[i] = 0;
          w.floor[i] = (rr >= K.RAV0 && rr < K.RAV1) ? T.GRATE : T.ROCK;
        }
      }
      const last = pts[pts.length - 1];
      w.channels.push({
        aStart: base + k * Math.PI + rng.range(-0.45, 0.45),
        aEnd: Math.atan2(last.y - w.cy, last.x - w.cx),
        pts: pts
      });
    }
  }
  function noise1(x) {
    const i = Math.floor(x), f = x - i;
    const a = h2(i, 7, 999), b = h2(i + 1, 7, 999);
    const t = f * f * (3 - 2 * f);
    return a + (b - a) * t;
  }

  /* ---------- rune taşları (π kodu) ---------- */
  function placeRunes(w, rng) {
    w.runes = [];
    const used = [];
    for (let idx = 0; idx < 8; idx++) {
      const sector = idx % 4;
      const aLo = K.SPOKE_ANGLES[sector] + 0.14, aHi = K.SPOKE_ANGLES[sector] + TAU / 4 - 0.14;
      let placed = null;
      for (let attempt = 0; attempt < 1200 && !placed; attempt++) {
        const a = rng.range(aLo, aHi);
        const r = rng.range(K.R2B + 4, K.RAV0 - 5);
        const x = Math.floor(w.cx + Math.cos(a) * r), y = Math.floor(w.cy + Math.sin(a) * r);
        if (!inb(w, x, y)) continue;
        const i = I(w, x, y);
        if (!w.solid[i] || w.hidden[i]) continue;
        let bad = false;
        for (const u of used) if (Math.hypot(u.x - x, u.y - y) < 24) { bad = true; break; }
        if (bad) continue;
        let open = 0;
        for (const d of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + d[0], ny = y + d[1];
          if (inb(w, nx, ny) && !w.solid[I(w, nx, ny)] && !w.void[I(w, nx, ny)]) open++;
        }
        if (open < 1) continue;
        placed = { x: x, y: y, digit: K.RUNE_ORDER[idx], idx: idx };
      }
      if (placed) {
        used.push(placed);
        const i = I(w, placed.x, placed.y);
        w.wall[i] = T.RUNE1 + placed.idx;
        w.solid[i] = 1;
        w.hscale[i] = 40;
        w.runes.push(placed);
      }
    }
  }

  /* ---------- gizli geçitler ---------- */
  function hiddenPassages(w, rng, n) {
    let made = 0;
    for (let t = 0; t < 6000 && made < n; t++) {
      const a = rng.range(0, TAU), r = rng.range(K.R2B + 5, K.RAV0 - 6);
      const x = Math.floor(w.cx + Math.cos(a) * r), y = Math.floor(w.cy + Math.sin(a) * r);
      if (!inb(w, x, y)) continue;
      const i = I(w, x, y);
      if (!w.solid[i] || w.hidden[i] || w.wall[i] >= T.RUNE1) continue;
      const hOpen = !w.solid[I(w, x - 1, y)] && !w.solid[I(w, x + 1, y)] && !w.void[I(w, x - 1, y)] && !w.void[I(w, x + 1, y)];
      const vOpen = !w.solid[I(w, x, y - 1)] && !w.solid[I(w, x, y + 1)] && !w.void[I(w, x, y - 1)] && !w.void[I(w, x, y + 1)];
      if (!hOpen && !vOpen) continue;
      w.hidden[i] = 1;
      w.wall[i] = T.HEDERA;
      made++;
    }
  }

  /* ---------- KAYDIRMA ----------
     İç labirent kuşağı yeni tohumla yeniden üretilir; oyuncunun bildiği
     yollar kaybolur (filmdeki "sections shift"). */
  const SHIFT_BAND = 13;
  function shiftWorld(w, day, seed) {
    const rng = RNG(((seed ^ (day * 7919)) >>> 0));
    const rin = K.R2B, rout = K.R2B + SHIFT_BAND;
    let changed = 0;
    for (let y = 0; y < w.H; y++) for (let x = 0; x < w.W; x++) {
      const r = rad(w, x + .5, y + .5);
      if (r < rin || r > rout) continue;
      const i = I(w, x, y);
      if (w.hidden[i]) continue;
      if (w.wall[i] >= T.RUNE1) continue;     // rune taşı yerinde kalır
      w.solid[i] = 1;
      w.wall[i] = rng.chance(0.3) ? T.STONE_MOSS : T.STONE;
      changed++;
    }
    carveLabyrinth(w, rng, rin, rout);
    // sektör geçitlerini yeniden aç
    for (const a of K.GAP_ANGLES) carveArcGap(w, a, K.R2A - 0.6, K.R2B + 1.2, 0.072);
    // rune taşlarını yeniden yerleştir (aynı basamaklar, yeni yerler)
    const keep = w.runes.map(r => ({ digit: r.digit, idx: r.idx }));
    // eski rune dokularını temizle
    for (let i = 0; i < w.wall.length; i++) {
      if (w.wall[i] >= T.RUNE1 && w.wall[i] <= T.RUNE8) w.wall[i] = T.STONE;
    }
    w.runes = [];
    // rune'ları aynı sektörlere yerleştir
    const rng2 = RNG((seed ^ (day * 104729)) >>> 0);
    const used = [];
    keep.forEach((rn, idx) => {
      const sector = rn.idx % 4;
      const aLo = K.SPOKE_ANGLES[sector] + 0.14, aHi = K.SPOKE_ANGLES[sector] + TAU / 4 - 0.14;
      for (let attempt = 0; attempt < 1500; attempt++) {
        const a = rng2.range(aLo, aHi);
        const r = rng2.range(K.R2B + 4, K.RAV0 - 5);
        const x = Math.floor(w.cx + Math.cos(a) * r), y = Math.floor(w.cy + Math.sin(a) * r);
        if (!inb(w, x, y)) continue;
        const i = I(w, x, y);
        if (!w.solid[i] || w.hidden[i]) continue;
        let bad = false;
        for (const u of used) if (Math.hypot(u.x - x, u.y - y) < 24) { bad = true; break; }
        if (bad) continue;
        let open = 0;
        for (const d of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + d[0], ny = y + d[1];
          if (inb(w, nx, ny) && !w.solid[I(w, nx, ny)]) open++;
        }
        if (open < 1) continue;
        w.wall[i] = T.RUNE1 + rn.idx;
        w.solid[i] = 1;
        const obj = { x: x, y: y, digit: rn.digit, idx: rn.idx };
        used.push(obj);
        w.runes.push(obj);
        break;
      }
    });
    return changed;
  }

  /* ---------- sorgular ---------- */
  function solidAt(w, x, y, gatesOpen) {
    x = x | 0; y = y | 0;
    if (x < 0 || y < 0 || x >= w.W || y >= w.H) return true;
    const i = y * w.W + x;
    if (w.gate[i] && !gatesOpen) return true;
    return w.solid[i] === 1;
  }
  function voidAt(w, x, y) {
    x = x | 0; y = y | 0;
    if (x < 0 || y < 0 || x >= w.W || y >= w.H) return false;
    return w.void[y * w.W + x] === 1;
  }
  /* Kayran = güvenli yaşam alanı: canavarlar buraya giremez */
  function inGlade(w, x, y, margin) {
    const m = margin === undefined ? 0.5 : margin;
    return rad(w, x, y) < K.R1 - m;
  }
  function outsideGlade(w, x, y, margin) {
    const m = margin === undefined ? 1.5 : margin;
    return rad(w, x, y) > K.R1 + m;
  }

  function floorAt(w, x, y) {
    x = x | 0; y = y | 0;
    if (x < 0 || y < 0 || x >= w.W || y >= w.H) return T.DIRT;
    return w.floor[y * w.W + x];
  }
  function sectorAt(w, x, y) {
    x = x | 0; y = y | 0;
    if (x < 0 || y < 0 || x >= w.W || y >= w.H) return 255;
    return w.sector[y * w.W + x];
  }
  function nearestOpen(w, x, y, maxR, gatesOpen) {
    x = Math.floor(x); y = Math.floor(y);
    if (!solidAt(w, x, y, gatesOpen) && !voidAt(w, x, y)) return { x: x + .5, y: y + .5 };
    for (let r = 1; r <= (maxR || 12); r++) {
      for (let a = 0; a < 24; a++) {
        const ang2 = a / 24 * TAU;
        const px = Math.floor(x + Math.cos(ang2) * r), py = Math.floor(y + Math.sin(ang2) * r);
        if (!solidAt(w, px, py, gatesOpen) && !voidAt(w, px, py)) return { x: px + .5, y: py + .5 };
      }
    }
    return { x: w.cx + .5, y: w.cy + .5 };
  }

  MV.Maze = {
    K: K, inb: inb, idx: I, rad: rad, ang: ang, setSolidAt: setSolidAt,
    inGlade: inGlade, outsideGlade: outsideGlade,
    genWorld: genWorld, shiftWorld: shiftWorld, solidAt: solidAt, voidAt: voidAt,
    floorAt: floorAt, sectorAt: sectorAt, nearestOpen: nearestOpen,
    clearArea: clearArea, carveArcGap: carveArcGap
  };
})(MV);
