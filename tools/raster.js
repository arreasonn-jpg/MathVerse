/* ============================================================
   tools/raster.js — küçük CPU üçgen rasterleştirici

   Yalnızca DOĞRULAMA içindir: GPU hattının (Three.js) ürettiği geometri
   dizilerini alıp, oyunun kamera kurulumuyla (FOVK, yaw, pitch, zc)
   gerçek dokuları örnekleyerek görüntü üretir. Böylece sandbox'ta GPU
   olmadan "acaba motor ne çizer?" sorusu gözle yanıtlanabilir.
   ============================================================ */
'use strict';

function makeFramebuffer(W, H, bg) {
  const rgb = new Float32Array(W * H * 3);
  const z = new Float32Array(W * H).fill(Infinity);
  const b = bg || [0.05, 0.06, 0.09];
  for (let i = 0; i < W * H; i++) {
    rgb[i * 3] = b[0]; rgb[i * 3 + 1] = b[1]; rgb[i * 3 + 2] = b[2];
  }
  return { W: W, H: H, rgb: rgb, z: z };
}

function camBasis(yaw, pitch, roll) {
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const f = [Math.cos(yaw) * cp, sp, Math.sin(yaw) * cp];
  let r = [-Math.sin(yaw), 0, Math.cos(yaw)];
  let u = [
    r[1] * f[2] - r[2] * f[1],
    r[2] * f[0] - r[0] * f[2],
    r[0] * f[1] - r[1] * f[0]
  ];
  const rl = roll || 0;
  if (rl) {
    const c = Math.cos(rl), s = Math.sin(rl);
    const r2 = [r[0] * c + u[0] * s, r[1] * c + u[1] * s, r[2] * c + u[2] * s];
    const u2 = [u[0] * c - r[0] * s, u[1] * c - r[1] * s, u[2] * c - r[2] * s];
    r = r2; u = u2;
  }
  return { f: f, r: r, u: u };
}

/* Kamera uzayına çevir; yakın düzlem gerisindekileri kırp */
function toCamera(verts, cam) {
  const b = cam.basis;
  const out = [];
  for (const v of verts) {
    const dx = v.p[0] - cam.x, dy = v.p[1] - cam.y, dz = v.p[2] - cam.z;
    out.push({
      c: [
        dx * b.r[0] + dy * b.r[1] + dz * b.r[2],
        dx * b.u[0] + dy * b.u[1] + dz * b.u[2],
        dx * b.f[0] + dy * b.f[1] + dz * b.f[2]
      ],
      uv: v.uv,
      shade: v.shade,
      w: v.p
    });
  }
  return out;
}

const NEAR = 0.05;
function clipNear(poly) {
  const inside = poly.filter(v => v.c[2] >= NEAR);
  if (inside.length === poly.length) return [poly];
  if (inside.length < 3) return [];
  const res = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const aIn = a.c[2] >= NEAR, bIn = b.c[2] >= NEAR;
    if (aIn) res.push(a);
    if (aIn !== bIn) {
      const t = (NEAR - a.c[2]) / (b.c[2] - a.c[2]);
      res.push({
        c: [a.c[0] + (b.c[0] - a.c[0]) * t, a.c[1] + (b.c[1] - a.c[1]) * t, NEAR],
        uv: [a.uv[0] + (b.uv[0] - a.uv[0]) * t, a.uv[1] + (b.uv[1] - a.uv[1]) * t],
        shade: a.shade + (b.shade - a.shade) * t,
        w: [
          a.w[0] + (b.w[0] - a.w[0]) * t, a.w[1] + (b.w[1] - a.w[1]) * t, a.w[2] + (b.w[2] - a.w[2]) * t
        ]
      });
    }
  }
  if (res.length < 3) return [];
  const tris = [];
  for (let i = 1; i + 1 < res.length; i++) tris.push([res[0], res[i], res[i + 1]]);
  return tris;
}

function sampleTex(tex, u, v) {
  if (!tex || !tex.data || !tex.w || !tex.h) return null;
  let fu = u - Math.floor(u), fv = v - Math.floor(v);
  const x = Math.min(tex.w - 1, Math.max(0, Math.round(fu * (tex.w - 1))));
  const y = Math.min(tex.h - 1, Math.max(0, Math.round((1 - fv) * (tex.h - 1))));   // three: flipY
  const i = (y * tex.w + x) * 4;
  return [tex.data[i] / 255, tex.data[i + 1] / 255, tex.data[i + 2] / 255, tex.data[i + 3] / 255];
}

function renderTri(fb, tri, cam, opt) {
  const W = fb.W, H = fb.H;
  const s = (cam.imageW || W) / (2 * cam.fovK);
  const pts = tri.map(v => ({
    x: W * 0.5 + (v.c[0] / v.c[2]) * s,
    y: H * 0.5 - (v.c[1] / v.c[2]) * s,
    iz: 1 / v.c[2],
    z: v.c[2],
    uv: v.uv,
    shade: v.shade,
    w: v.w
  }));
  const minX = Math.max(0, Math.floor(Math.min(pts[0].x, pts[1].x, pts[2].x)));
  const maxX = Math.min(W - 1, Math.ceil(Math.max(pts[0].x, pts[1].x, pts[2].x)));
  const minY = Math.max(0, Math.floor(Math.min(pts[0].y, pts[1].y, pts[2].y)));
  const maxY = Math.min(H - 1, Math.ceil(Math.max(pts[0].y, pts[1].y, pts[2].y)));
  if (maxX < minX || maxY < minY) return 0;

  const [a, b, c] = pts;
  const area = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);
  if (Math.abs(area) < 1e-9) return 0;
  const inv = 1 / area;
  const fogC = opt.fogColor || [0.06, 0.07, 0.1];
  const fogD = opt.fogDens || 0.03;
  const sun = opt.sunDir || [0.3, 0.8, 0.4];
  const sunAmt = opt.sunAmt === undefined ? 0.7 : opt.sunAmt;
  const ambient = opt.ambient === undefined ? 0.3 : opt.ambient;
  const torch = opt.torch || 0;
  const torchPos = opt.torchPos;
  let drawn = 0;

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5, py = y + 0.5;
      let w0 = ((b.x - px) * (c.y - py) - (c.x - px) * (b.y - py)) * inv;
      let w1 = ((c.x - px) * (a.y - py) - (a.x - px) * (c.y - py)) * inv;
      let w2 = 1 - w0 - w1;
      if (w0 < 0 || w1 < 0 || w2 < 0) continue;
      const iz = w0 * a.iz + w1 * b.iz + w2 * c.iz;
      const z = 1 / iz;
      const idx = y * W + x;
      if (z >= fb.z[idx]) continue;
      /* perspektif doğru öznitelik */
      const u = (w0 * a.uv[0] * a.iz + w1 * b.uv[0] * b.iz + w2 * c.uv[0] * c.iz) / iz;
      const v = (w0 * a.uv[1] * a.iz + w1 * b.uv[1] * b.iz + w2 * c.uv[1] * c.iz) / iz;
      const sh = (w0 * a.shade * a.iz + w1 * b.shade * b.iz + w2 * c.shade * c.iz) / iz;
      let col = sampleTex(tri.tex, u, v);
      if (!col) col = [tri.base[0], tri.base[1], tri.base[2], 1];
      if (col[3] < 0.5) continue;
      const lam = ambient + sunAmt * Math.max(0, tri.n[0] * sun[0] + tri.n[1] * sun[1] + tri.n[2] * sun[2]);
      let lr = lam, lg = lam, lb = lam;
      if (torch > 0 && torchPos) {
        const cx2 = x, cy2 = y;
        const tdist = Math.max(0.3, z);
        const att = torch * 1.9 / (1 + tdist * tdist * 0.045);
        lr += att * 1.0; lg += att * 0.86; lb += att * 0.64;
      }
      let r = col[0] * lr * sh, g = col[1] * lg * sh, bl = col[2] * lb * sh;
      const f = Math.min(1, z * fogD);
      r = r * (1 - f) + fogC[0] * f;
      g = g * (1 - f) + fogC[1] * f;
      bl = bl * (1 - f) + fogC[2] * f;
      fb.z[idx] = z;
      fb.rgb[idx * 3] = r; fb.rgb[idx * 3 + 1] = g; fb.rgb[idx * 3 + 2] = bl;
      drawn++;
    }
  }
  return drawn;
}

/* tris: [{ p:[v0,v1,v2], uv:[[u,v]×3], n:[x,y,z], tex:{data,w,h}, base:[r,g,b], shade }] */
function render(fb, tris, cam, opt) {
  opt = opt || {};
  cam.basis = camBasis(cam.yaw, cam.pitch, cam.roll || 0);
  let drawn = 0;
  for (const t of tris) {
    const verts = [
      { p: t.p[0], uv: t.uv ? t.uv[0] : [0, 0], shade: t.shade || 1 },
      { p: t.p[1], uv: t.uv ? t.uv[1] : [0, 0], shade: t.shade || 1 },
      { p: t.p[2], uv: t.uv ? t.uv[2] : [0, 0], shade: t.shade || 1 }
    ];
    const camVerts = toCamera(verts, cam);
    for (const poly of clipNear(camVerts)) {
      const tri = poly.map(v => ({ c: v.c, uv: v.uv, shade: v.shade, w: v.w }));
      for (let i = 1; i + 1 < tri.length; i++) {
        /* doku/normal/taban renk bilgisi kırpılmış üçgene taşınır */
        const piece = [tri[0], tri[i], tri[i + 1]];
        piece.tex = t.tex;
        piece.base = t.base;
        piece.n = t.n;
        drawn += renderTri(fb, piece, cam, opt) > 0 ? 1 : 0;
      }
    }
  }
  return drawn;
}

function toRGBA(fb, exposure, gamma) {
  const e = exposure === undefined ? 1 : exposure;
  const out = new Uint8Array(fb.W * fb.H * 4);
  for (let i = 0; i < fb.W * fb.H; i++) {
    for (let c = 0; c < 3; c++) {
      let v = fb.rgb[i * 3 + c] * e;
      /* ACES yaklaşımı (motorun son katmanıyla aynı ailede) */
      v = (v * (2.51 * v + 0.03)) / (v * (2.43 * v + 0.59) + 0.14);
      v = Math.max(0, Math.min(1, v));
      if (gamma !== false) v = Math.pow(v, 1 / 2.2);
      out[i * 4 + c] = (v * 255) | 0;
    }
    out[i * 4 + 3] = 255;
  }
  return out;
}

module.exports = { makeFramebuffer, render, toRGBA };
