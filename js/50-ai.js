/* ============================================================
   50-ai.js — Böcek Bıçakları (WICKED casusları) ve Grievers
   Rota: BFS akış alanı + hücre merkezli ilerleme (duvara takılmaz)
   ============================================================ */
(function (MV) {
  'use strict';
  const { clamp, dist, TAU, angDiff, RNG } = MV;

  const AI = {
    /* ---------- görüş hattı ---------- */
    los(world, ax, ay, bx, by, gatesOpen) {
      const d = dist(ax, ay, bx, by);
      const steps = Math.ceil(d * 3);
      const dx = (bx - ax) / steps, dy = (by - ay) / steps;
      let x = ax, y = ay;
      for (let i = 0; i < steps; i++) {
        x += dx; y += dy;
        if (MV.Maze.solidAt(world, x, y, gatesOpen)) return false;
      }
      return true;
    },
    /* ---------- BFS yol (hücre merkezleri) ---------- */
    path(world, sx, sy, tx, ty, gatesOpen, limit) {
      const W = world.W, H = world.H;
      sx = clamp(Math.floor(sx), 0, W - 1); sy = clamp(Math.floor(sy), 0, H - 1);
      tx = clamp(Math.floor(tx), 0, W - 1); ty = clamp(Math.floor(ty), 0, H - 1);
      const start = sy * W + sx, goal = ty * W + tx;
      if (MV.Maze.solidAt(world, tx, ty, gatesOpen) || MV.Maze.voidAt(world, tx, ty)) return null;
      const prev = new Int32Array(W * H).fill(-1);
      const seen = new Uint8Array(W * H);
      const q = [start]; seen[start] = 1;
      let head = 0, found = false, visited = 0;
      const maxN = limit || (W * H);
      while (head < q.length && visited < maxN) {
        const cur = q[head++]; visited++;
        if (cur === goal) { found = true; break; }
        const x = cur % W, y = (cur / W) | 0;
        for (const d of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + d[0], ny = y + d[1];
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const ni = ny * W + nx;
          if (seen[ni]) continue;
          if (world.solid[ni] === 1) continue;
          if (world.void[ni] === 1) continue;
          if (world.gate[ni] === 1 && !gatesOpen) continue;
          seen[ni] = 1; prev[ni] = cur; q.push(ni);
        }
      }
      if (!found) return null;
      const out = [];
      let cur = goal;
      while (cur !== start && cur !== -1) {
        out.push({ x: (cur % W) + 0.5, y: ((cur / W) | 0) + 0.5 });
        cur = prev[cur];
      }
      out.reverse();
      return out;
    },

    /* ---------- yaratık fabrikaları ---------- */
    newGriever(x, y, opts) {
      opts = opts || {};
      return {
        kind: 'griever', x: x, y: y, a: 0,
        speed: opts.speed || 3.35,
        w: 1.5, h: 1.15, yOff: 0.42,
        sprite: 'griever',
        hp: opts.hp || 100, maxHp: opts.hp || 100,
        aggro: false, path: null, pi: 0, repath: 0, atkCd: 0,
        roarCd: 0, lostT: 0, sense: opts.sense || 15,
        home: { x: x, y: y }, elite: !!opts.elite,
        anim: Math.random() * 10, dead: false
      };
    },
    newBeetle(x, y, opts) {
      opts = opts || {};
      return {
        kind: 'beetle', x: x, y: y, a: 0,
        speed: opts.speed || 7.2,
        w: 0.55, h: 0.5, yOff: 0.62,
        sprite: 'beetle',
        path: null, pi: 0, repath: 0, target: null,
        carrying: null, state: 'roam', alertT: 0, anim: Math.random() * 10,
        hp: 30, home: { x: x, y: y }
      };
    },

    /* ---------- ana güncelleme ---------- */
    update(st, dt) {
      const world = st.world, P = st.player, gatesOpen = st.gatesOpen;
      const night = st.night;
      /* --- GRIEVERS --- */
      for (const g of st.grievers) {
        if (g.dead) continue;
        g.anim += dt;
        g.atkCd = Math.max(0, g.atkCd - dt);
        g.roarCd = Math.max(0, g.roarCd - dt);
        const d = dist(g.x, g.y, P.x, P.y);
        const losOk = d < 30 && this.los(world, g.x, g.y, P.x, P.y, gatesOpen);
        const senseR = g.sense * (night ? 1.5 : 1.0) * (1 + P.noise * 1.6) * (P.crouch ? 0.55 : 1);
        if (!g.aggro) {
          if ((losOk && d < senseR) || (d < 3.2 && losOk)) {
            g.aggro = true; g.lostT = 0;
            if (st.onEvent) st.onEvent('grieverAggro', g);
          }
          /* vahşi dolaşma */
          if (!g.path || g.pi >= g.path.length) {
            const t = this.randomTarget(world, g, gatesOpen);
            g.path = t && this.path(world, g.x, g.y, t.x, t.y, gatesOpen, 6000);
            g.pi = 0;
          }
        } else {
          g.lostT += dt;
          if (d > 40 || (g.lostT > 7 && !losOk && d > 12)) {
            g.aggro = false;
            if (st.onEvent) st.onEvent('grieverLost', g);
          } else {
            g.repath -= dt;
            if (!g.path || g.repath <= 0) {
              g.path = this.path(world, g.x, g.y, P.x, P.y, gatesOpen, 20000);
              g.pi = 0;
              g.repath = 0.55 + Math.random() * 0.5;
            }
          }
          if (losOk && d < 26 && g.roarCd <= 0) {
            g.roarCd = 6 + Math.random() * 8;
            if (st.onEvent) st.onEvent('grieverRoar', g);
          }
          if (d < 1.25 && g.atkCd <= 0) {
            g.atkCd = 1.5;
            g.path = this.path(world, g.x, g.y, P.x, P.y, gatesOpen, 20000);
            g.pi = 0;
            if (st.onEvent) st.onEvent('grieverHit', g);
          }
        }
        const sp = g.speed * (g.aggro ? (night ? 1.18 : 1.05) : 0.62);
        this.follow(g, sp, dt, world, gatesOpen);
        g.a = g.a || 0;
      }
      /* --- BÖCEK BIÇAKLARI --- */
      for (const b of st.beetles) {
        b.anim += dt * 2.2;
        const d = dist(b.x, b.y, P.x, P.y);
        const losOk = d < 24 && this.los(world, b.x, b.y, P.x, P.y, gatesOpen);
        if (b.state === 'roam') {
          if (losOk && d < 22 && (b.alertT <= 0 || d < 14)) {
            b.state = 'scan';
            b.alertT = 1.35;
            if (st.onEvent) st.onEvent('beetleSpotted', b);
          }
          if (!b.path || b.pi >= b.path.length) {
            const t = this.randomTarget(world, b, gatesOpen);
            b.path = t && this.path(world, b.x, b.y, t.x, t.y, gatesOpen, 6000);
            b.pi = 0;
            if (!b.path) { b.state = 'roam'; }
          }
        } else if (b.state === 'scan') {
          b.alertT -= dt;
          // oyuncuya döner
          b.a = Math.atan2(P.y - b.y, P.x - b.x);
          if (b.alertT <= 0) {
            b.state = 'steal';
            if (st.onEvent) st.onEvent('beetleReport', b);
          }
        } else if (b.state === 'steal') {
          b.repath -= dt;
          if (!b.path || b.repath <= 0) {
            b.path = this.path(world, b.x, b.y, P.x, P.y, gatesOpen, 20000);
            b.pi = 0; b.repath = 0.7;
          }
          if (d < 1.0) {
            if (st.onEvent) st.onEvent('beetleTake', b);
            b.state = 'flee'; b.path = null; b.repath = 0;
          }
        } else if (b.state === 'flee') {
          b.repath -= dt;
          if (!b.path || b.pi >= b.path.length || b.repath <= 0) {
            const t = this.randomTarget(world, b, gatesOpen, 26);
            b.path = t && this.path(world, b.x, b.y, t.x, t.y, gatesOpen, 9000);
            b.pi = 0; b.repath = 1.2;
            if (b.pi >= (b.path ? b.path.length : 0)) { b.state = 'roam'; b.carrying = null; }
          }
          if (b.path && b.pi >= b.path.length) {
            if (st.onEvent && b.carrying) st.onEvent('beetleDeliver', b);
            b.carrying = null; b.state = 'roam';
          }
        }
        this.follow(b, b.speed, dt, world, gatesOpen);
      }
    },

    /* hedefe doğru hücre merkezlerini takip et */
    follow(e, speed, dt, world, gatesOpen) {
      if (!e.path || e.pi >= e.path.length) return false;
      const wp = e.path[e.pi];
      const dx = wp.x - e.x, dy = wp.y - e.y;
      const d = Math.hypot(dx, dy);
      if (d < 0.13) {
        e.pi++;
        return true;
      }
      const step = Math.min(speed * dt, d);
      const nx = e.x + dx / d * step, ny = e.y + dy / d * step;
      const tx = Math.floor(nx), ty = Math.floor(ny);
      const cx = Math.floor(e.x), cy = Math.floor(e.y);
      // yalnızca hedef hücre açıksa geç (köşe kesmeyi önler)
      if (tx === cx && ty === cy) { e.x = nx; e.y = ny; }
      else if (!MV.Maze.solidAt(world, tx, ty, gatesOpen) && !MV.Maze.voidAt(world, tx, ty)) {
        // hücre merkezine doğru yumuşak geçiş
        if (tx !== cx) e.y = MV.lerp(e.y, cy + 0.5, clamp(step * 1.4, 0, 1));
        if (ty !== cy) e.x = MV.lerp(e.x, cx + 0.5, clamp(step * 1.4, 0, 1));
        e.x = MV.clamp(e.x + dx / d * step * 0.6, Math.min(cx, tx), Math.max(cx, tx) + 0.999);
        e.y = MV.clamp(e.y + dy / d * step * 0.6, Math.min(cy, ty), Math.max(cy, ty) + 0.999);
      } else {
        e.pi++;
      }
      e.a = Math.atan2(dy, dx);
      return true;
    },

    randomTarget(world, e, gatesOpen, maxR) {
      const K = MV.K;
      for (let i = 0; i < 40; i++) {
        const a = Math.random() * TAU;
        const r = K.R2B + Math.random() * (K.RAV0 - K.R2B - 4);
        const x = Math.floor(world.cx + Math.cos(a) * r), y = Math.floor(world.cy + Math.sin(a) * r);
        if (x < 1 || y < 1 || x >= world.W - 1 || y >= world.H - 1) continue;
        const i2 = y * world.W + x;
        if (world.solid[i2] || world.void[i2]) continue;
        return { x: x + 0.5, y: y + 0.5 };
      }
      return null;
    }
  };

  MV.AI = AI;
})(MV);
