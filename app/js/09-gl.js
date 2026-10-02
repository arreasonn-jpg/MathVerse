/* ============================================================
   09-gl.js — GPU görüntü motoru (Three.js / WebGL)

   v1.1'e kadar dünya CPU'da yazılım raycast ile, v1.2'de elle yazılmış
   WebGL shader'larıyla çiziliyordu. v1.3'te çizim, olgun bir oyun motoruna
   (Three.js r147) devredildi: PBR (fizik tabanlı) materyaller, gerçek zamanlı
   güneş gölgeleri, HDR + ACES ton eşleme, çok örneklemeli kenar yumuşatma
   (MSAA), bloom ve sinema sonrası katman.

   Sözleşme (30-render.js bunu kullanır):
     ok · status · canvas · scale · ss · prepared · worldRef · worldStamp
     init(canvas2d) · prepare(tex) · setSize(W,H) · invalidate()
     render(view, R) → bool   (false dönerse CPU hattı devralır)

   Motor hiçbir koşulda oyunu düşürmez: kurulum ya da çizim hatasında
   ok=false olur, tuval gizlenir ve CPU hattı devam eder.
   ============================================================ */
(function (MV) {
  'use strict';

  const GL = {};

  /* ---------- genel durum ---------- */
  GL.ok = false;
  GL.prepared = false;
  GL.status = 'başlatılmadı';
  GL.canvas = null;
  GL.renderer = null;
  GL.scene = null;
  GL.camera = null;
  GL.composer = null;
  GL.worldRef = null;
  GL.worldStamp = 0;
  GL.scale = 1;                       // iç çözünürlük ölçeği (kalite)
  GL.ss = 1;                          // kenar yumuşatma örneklemesi (bilgi amaçlı)
  GL.chunks = {};
  GL.chunkList = [];
  GL.mats = {};                        // doku kimliği → THREE.MeshStandardMaterial
  GL.spriteMats = {};                  // "ad:kare" → THREE.SpriteMaterial
  GL.dolls = {};                       // "ad:kare" → ölçek bilgisi
  GL.entities = [];
  GL.blobs = [];

  const CHUNK = 24;                    // karo cinsinden bölüm boyutu
  const CHUNK_R = 2;                   // oyuncu çevresinde 5×5 bölüm
  const CEIL_Y = 4;                    // kapalı alan tavan yüksekliği (duvarlar 4 birim)
  const FOG_MIN = 0.004;

  function T3() {
    return MV.THREE || (typeof window !== 'undefined' ? window.THREE : null);
  }

  function log(msg) { if (MV.logMsg) MV.logMsg('[GL] ' + msg); }

  /* ============================================================
     MOTOR KURULUMU
     ============================================================ */
  GL.init = function (canvas2d) {
    if (this.ok) return this;
    this.prepared = false;
    this._checked = 0;
    try {
      const T = T3();
      if (!T || !T.WebGLRenderer) throw new Error('Three.js yüklenemedi');
      if (typeof document === 'undefined' || !canvas2d || !canvas2d.parentNode) throw new Error('tuval yok');

      /* ---- GPU tuvali: #view'in arkasına yerleşir ---- */
      const cv = document.createElement('canvas');
      cv.id = 'glview';
      cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;background:#000';
      canvas2d.parentNode.insertBefore(cv, canvas2d);

      const renderer = new T.WebGLRenderer({
        canvas: cv,
        antialias: false,                   // MSAA'yı besteleyicide kullanıyoruz
        alpha: false,
        powerPreference: 'high-performance',
        stencil: false
      });
      if (!renderer || !renderer.getContext()) throw new Error('WebGL bağlamı açılamadı');

      const gl = renderer.getContext();
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      const gpuName = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || '') : '';
      if (/swiftshader|llvmpipe|softpipe|software|basic render/i.test(gpuName)) {
        throw new Error('yazılım GPU: ' + gpuName.slice(0, 40));
      }

      renderer.setPixelRatio(1);            // dahili çözünürlüğü biz belirliyoruz
      renderer.outputEncoding = T.sRGBEncoding;
      /* Ton eşleme ve sRGB çıkışı son katmanda elle yapılır (ShaderPass
         içindeki özel shader'lara three bunları otomatik eklemez). */
      renderer.toneMapping = T.NoToneMapping;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = T.PCFSoftShadowMap;
      renderer.autoClear = true;

      this.T = T;
      this.renderer = renderer;
      this.gl = gl;
      this.canvas = cv;
      this.gpuName = gpuName;
      this.isWebGL2 = !!(gl.texStorage2D || (T.WebGLMultisampleRenderTarget && renderer.capabilities && renderer.capabilities.isWebGL2));

      /* ---- sahne ve kamera ---- */
      const scene = new T.Scene();
      scene.matrixWorldAutoUpdate = true;
      scene.fog = new T.FogExp2(0x0a0d12, 0.03);
      const camera = new T.PerspectiveCamera(70, 1.6, 0.04, 420);
      camera.rotation.order = 'YXZ';
      scene.add(camera);
      this.scene = scene;
      this.camera = camera;

      /* ---- ışıklar ---- */
      const hemi = new T.HemisphereLight(0x8fb4ff, 0x2a2620, 0.55);
      scene.add(hemi);
      this.hemi = hemi;

      const sun = new T.DirectionalLight(0xffe9c4, 1.6);
      sun.castShadow = true;
      sun.shadow.mapSize.set(2048, 2048);
      sun.shadow.camera.left = -26;
      sun.shadow.camera.right = 26;
      sun.shadow.camera.top = 26;
      sun.shadow.camera.bottom = -26;
      sun.shadow.camera.near = 0.5;
      sun.shadow.camera.far = 150;
      sun.shadow.bias = -0.0006;
      sun.shadow.normalBias = 0.035;
      scene.add(sun);
      scene.add(sun.target);
      this.sun = sun;

      const torch = new T.SpotLight(0xffe0b0, 0, 30, 0.62, 0.75, 1.15);
      torch.castShadow = false;
      scene.add(torch);
      scene.add(torch.target);
      this.torch = torch;

      const fill = new T.PointLight(0xffd9a8, 0, 14, 1.4);
      scene.add(fill);
      this.fill = fill;

      /* ---- gökyüzü kubbesi ---- */
      this._buildSky();

      /* ---- konum sonrası katman ---- */
      this._buildComposer();

      this.ok = true;
      this.status = 'GPU etkin (Three.js r' + T.REVISION + (gpuName ? ' · ' + gpuName.slice(0, 34) : '') + ')';
      log(this.status);
      return this;
    } catch (e) {
      this.ok = false;
      this.status = 'CPU (sebep: ' + (e && e.message ? e.message : e) + ')';
      try { if (this.canvas && this.canvas.parentNode) this.canvas.parentNode.removeChild(this.canvas); } catch (e2) { }
      this.canvas = null;
      this.renderer = null;
      this.gl = null;
      log(this.status);
      return this;
    }
  };

  /* ============================================================
     GÖKYÜZÜ
     ============================================================ */
  GL._buildSky = function () {
    const T = this.T;
    const geo = new T.SphereGeometry(300, 32, 20);
    const mat = new T.ShaderMaterial({
      side: T.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uTop: { value: new T.Color(0x0a1020) },
        uHorizon: { value: new T.Color(0x2a3242) },
        uSun: { value: new T.Vector3(0.5, 0.6, 0.5) },
        uSunCol: { value: new T.Color(0xffe6bc) },
        uStars: { value: 0.6 },
        uClouds: { value: 0.3 },
        uTime: { value: 0 }
      },
      vertexShader: [
        'varying vec3 vDir;',
        'void main() {',
        '  vDir = position;',
        '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
        '}'
      ].join('\n'),
      fragmentShader: [
        '#ifdef GL_FRAGMENT_PRECISION_HIGH',
        'precision highp float;',
        '#else',
        'precision mediump float;',
        '#endif',
        'uniform vec3 uTop;',
        'uniform vec3 uHorizon;',
        'uniform vec3 uSun;',
        'uniform vec3 uSunCol;',
        'uniform float uStars;',
        'uniform float uClouds;',
        'uniform float uTime;',
        'varying vec3 vDir;',
        'void main() {',
        '  vec3 d = normalize(vDir);',
        '  float up = clamp(d.y * 1.15 + 0.06, 0.0, 1.0);',
        '  vec3 col = mix(uHorizon, uTop, pow(up, 0.72));',
        '  vec3 S = normalize(uSun);',
        '  float sd = max(dot(d, S), 0.0);',
        '  col += uSunCol * (pow(sd, 1400.0) * 3.0 + pow(sd, 30.0) * 0.20 + pow(sd, 6.0) * 0.05);',
        '  if (uStars > 0.01 && d.y > 0.0) {',
        '    vec2 sp = floor(d.xz * 300.0 / max(0.25, d.y + 0.35));',
        '    float h = fract(sin(dot(sp, vec2(12.9898, 78.233))) * 43758.5453);',
        '    float star = step(0.9968, h) * uStars * smoothstep(0.0, 0.30, d.y);',
        '    col += vec3(star) * (0.7 + 0.6 * fract(h * 71.0));',
        '  }',
        '  float band = smoothstep(0.10, 0.55, d.y);',
        '  float cl = sin(d.x * 3.1 + uTime * 0.012) * 0.5 + sin(d.z * 2.3 - uTime * 0.009) * 0.5;',
        '  col = mix(col, vec3(0.58, 0.61, 0.66), clamp(uClouds, 0.0, 1.0) * band * 0.30 * (0.6 + 0.4 * cl));',
        '  gl_FragColor = vec4(col, 1.0);',
        '}'
      ].join('\n')
    });
    const sky = new T.Mesh(geo, mat);
    sky.frustumCulled = false;
    sky.renderOrder = -1000;
    this.scene.add(sky);
    this.sky = sky;
  };

  /* ============================================================
     KONUM SONRASI (bloom + derecelendirme)
     ============================================================ */
  GL._buildComposer = function () {
    const T = this.T;
    const size = new T.Vector2(2, 2);
    let rt;
    if (this.isWebGL2 && T.WebGLMultisampleRenderTarget) {
      rt = new T.WebGLMultisampleRenderTarget(2, 2, { format: T.RGBAFormat, samples: 4 });
      GL.ss = 4;
    } else {
      rt = new T.WebGLRenderTarget(2, 2, { format: T.RGBAFormat });
      GL.ss = 1;
    }
    this.rt = rt;
    const composer = new T.EffectComposer(this.renderer, rt);
    composer.addPass(new T.RenderPass(this.scene, this.camera));
    this.passRender = composer.passes[0];

    const bloom = new T.UnrealBloomPass(size, 0.32, 0.55, 0.86);
    composer.addPass(bloom);
    this.passBloom = bloom;

    /* son katman: vinyet + film greni + renk sapması + hafif keskinleştirme */
    const grade = new T.ShaderPass({
      uniforms: {
        tDiffuse: { value: null },
        uExposure: { value: 1.0 },
        uCA: { value: 0.5 },
        uGrain: { value: 0.3 },
        uTime: { value: 0 },
        uVignette: { value: 0.30 },
        uRes: { value: new T.Vector2(1280, 720) }
      },
      vertexShader: [
        'varying vec2 vUv;',
        'void main() {',
        '  vUv = uv;',
        '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
        '}'
      ].join('\n'),
      fragmentShader: [
        '#ifdef GL_FRAGMENT_PRECISION_HIGH',
        'precision highp float;',
        '#else',
        'precision mediump float;',
        '#endif',
        'uniform sampler2D tDiffuse;',
        'uniform float uExposure;',
        'uniform float uCA;',
        'uniform float uGrain;',
        'uniform float uTime;',
        'uniform float uVignette;',
        'uniform vec2 uRes;',
        'varying vec2 vUv;',
        'float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }',
        'vec3 aces(vec3 x) {',
        '  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);',
        '}',
        'vec3 lin2srgb(vec3 c) {',
        '  vec3 lo = c * 12.92;',
        '  vec3 hi = 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055;',
        '  return mix(lo, hi, step(vec3(0.0031308), c));',
        '}',
        'void main() {',
        '  vec2 uv = vUv;',
        '  vec2 d = uv - 0.5;',
        '  float r2 = dot(d, d);',
        '  vec2 off = d * (uCA * 0.0035) * (0.35 + r2 * 2.2);',
        '  vec3 col;',
        '  col.r = texture2D(tDiffuse, uv + off).r;',
        '  col.g = texture2D(tDiffuse, uv).g;',
        '  col.b = texture2D(tDiffuse, uv - off).b;',
        '  col *= uExposure;',
        '  vec3 blur = texture2D(tDiffuse, uv + vec2(1.0 / uRes.x, 0.0)).rgb;',
        '  blur += texture2D(tDiffuse, uv - vec2(1.0 / uRes.x, 0.0)).rgb;',
        '  col += (col - (blur + col) * 0.5) * 0.10;',
        '  float v = smoothstep(0.98, 0.30, length(d) * 1.36);',
        '  col *= mix(1.0 - uVignette, 1.0, v);',
        '  col = aces(col);',
        '  col = lin2srgb(col);',
        '  float n = hash(uv * uRes * 0.5 + fract(uTime) * 137.0) - 0.5;',
        '  col += n * uGrain;',
        '  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);',
        '}'
      ].join('\n')
    });
    composer.addPass(grade);
    grade.renderToScreen = true;
    this.passGrade = grade;
    this.composer = composer;
  };

  /* ============================================================
     DOKULAR → MATERYALLER
     ============================================================ */
  GL._normTex = function (cv) {
    const T = this.T;
    const n = cv._normal;
    if (!n) return null;
    const w = cv.width, h = cv.height;
    const data = new Uint8Array(w * h * 4);
    for (let i = 0, p = 0; p < w * h; p++, i += 4) {
      data[i] = n[p * 2];
      data[i + 1] = n[p * 2 + 1];
      data[i + 2] = 255;
      data[i + 3] = 255;
    }
    const tex = new T.DataTexture(data, w, h, T.RGBAFormat);
    tex.wrapS = tex.wrapT = T.RepeatWrapping;
    tex.minFilter = T.LinearMipmapLinearFilter;
    tex.magFilter = T.LinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = this.maxAniso || 4;
    tex.needsUpdate = true;
    return tex;
  };

  GL._roughTex = function (cv) {
    const T = this.T;
    const s = cv._spec;
    if (!s) return null;
    const w = cv.width, h = cv.height;
    const data = new Uint8Array(w * h * 4);
    for (let i = 0, p = 0; p < w * h; p++, i += 4) {
      const v = s[p];
      data[i] = v; data[i + 1] = v; data[i + 2] = v; data[i + 3] = 255;
    }
    const tex = new T.DataTexture(data, w, h, T.RGBAFormat);
    tex.wrapS = tex.wrapT = T.RepeatWrapping;
    tex.minFilter = T.LinearMipmapLinearFilter;
    tex.magFilter = T.LinearFilter;
    tex.generateMipmaps = true;
    tex.needsUpdate = true;
    return tex;
  };

  /* parlayan karolar (rune taşları, kapı, kovan) */
  const EMISSIVE = {};
  EMISSIVE[9] = { color: 0x69c8ff, power: 0.85 };       // RUNE_PI
  EMISSIVE[10] = { color: 0x7fe0ff, power: 0.55 };      // RUNE_SYS
  EMISSIVE[14] = { color: 0xff7a2a, power: 0.75 };      // GATE
  EMISSIVE[17] = { color: 0xff8b3a, power: 0.60 };      // HIVE
  for (let k = 0; k < 8; k++) EMISSIVE[100 + k] = { color: 0x9fdcff, power: 0.95 };

  GL.prepare = function (tex) {
    if (!this.ok || !tex) return;
    try {
      const T = this.T;
      this.maxAniso = Math.min(8, this.renderer.capabilities.getMaxAnisotropy ? this.renderer.capabilities.getMaxAnisotropy() : 4);

      const walls = tex.walls || [];
      this._texIds = {};
      for (let id = 0; id < walls.length; id++) {
        const cv = walls[id];
        if (!cv) continue;
        this._texIds[id] = 1;
        const map = new T.CanvasTexture(cv);
        map.encoding = T.sRGBEncoding;
        map.wrapS = map.wrapT = T.RepeatWrapping;
        map.anisotropy = this.maxAniso;
        map.needsUpdate = true;
        const em = EMISSIVE[id];
        const mat = new T.MeshStandardMaterial({
          map: map,
          normalMap: this._normTex(cv),
          roughnessMap: this._roughTex(cv),
          roughness: 0.94,
          metalness: 0.02,
          vertexColors: true,
          dithering: true
        });
        if (mat.normalMap) mat.normalScale.set(0.9, 0.9);
        if (em) {
          mat.emissive = new T.Color(em.color);
          mat.emissiveIntensity = em.power;
          mat.emissiveMap = map;
        }
        this.mats[id] = mat;
      }

      /* ---- sprite materyalleri (kare animasyonlu) ---- */
      const sprites = tex.sprites || {};
      let dollCount = 0;
      for (const name in sprites) {
        const cv = sprites[name];
        if (!cv) continue;
        const list = Array.isArray(cv) ? cv : [cv];
        for (let f = 0; f < list.length; f++) {
          const frameCv = list[f];
          if (!frameCv) continue;
          const t = new T.CanvasTexture(frameCv);
          t.encoding = T.sRGBEncoding;
          t.anisotropy = this.maxAniso;
          t.needsUpdate = true;
          const sm = new T.SpriteMaterial({
            map: t, alphaTest: 0.35, transparent: true, fog: true,
            depthWrite: true, depthTest: true, sizeAttenuation: true
          });
          this.spriteMats[name + ':' + f] = sm;
          dollCount++;
        }
        /* tek kareli isimler için 0. kareye takma ad */
        if (list.length && !this.spriteMats[name + ':0']) this.spriteMats[name + ':0'] = this.spriteMats[name + ':0'];
      }
      this.spriteTotal = dollCount;

      /* ---- gölge lekesi dokusu ---- */
      const bc = MV.makeCanvas(64, 64);
      const bx = bc.getContext('2d');
      const g = bx.createRadialGradient(32, 32, 2, 32, 32, 30);
      g.addColorStop(0, 'rgba(0,0,0,0.55)');
      g.addColorStop(0.65, 'rgba(0,0,0,0.28)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      bx.fillStyle = g;
      bx.fillRect(0, 0, 64, 64);
      const bt = new T.CanvasTexture(bc);
      bt.needsUpdate = true;
      this.blobMat = new T.MeshBasicMaterial({ map: bt, transparent: true, depthWrite: false, color: 0x000000, opacity: 1, fog: true });
      this.blobGeo = new T.CircleGeometry(0.5, 14);

      this.prepared = true;
      log('materyal hazır: ' + Object.keys(this.mats).length + ' doku · ' + dollCount + ' sprite karesi');
    } catch (e) {
      this.ok = false;
      this.status = 'CPU (materyal hatası: ' + (e && e.message ? e.message : e) + ')';
      log(this.status);
    }
  };

  /* ============================================================
     DÜNYA → GEOMETRİ (saf veri; GPU'suz da çalışır ve sınanabilir)
     ============================================================ */
  /* Bir karoya karşılık gelen doku döşeme yoğunluğu: 1 birim = 1 doku */
  GL.buildChunkData = function (world, cx, cy, gatesOpen) {
    const T = MV.T;
    const hasTex = (id) => (!this._texIds ? true : !!this._texIds[id]);
    const pick = (id, alt) => (hasTex(id) ? id : alt);
    const x0 = cx * CHUNK, y0 = cy * CHUNK;
    const x1 = Math.min(x0 + CHUNK, world.W), y1 = Math.min(y0 + CHUNK, world.H);
    const mats = {};
    let tris = 0, cells = 0, walls = 0, floors = 0, ceils = 0;

    const bucket = (id) => {
      let b = mats[id];
      if (!b) {
        b = mats[id] = { pos: [], nrm: [], uv: [], col: [], idx: [] };
      }
      return b;
    };
    const quad = (b, a, bb, c, d, nx, ny, nz, uv, shade) => {
      const base = b.pos.length / 3;
      const P = [a, bb, c, d];
      for (let i = 0; i < 4; i++) {
        b.pos.push(P[i][0], P[i][1], P[i][2]);
        b.nrm.push(nx, ny, nz);
        b.uv.push(uv[i][0], uv[i][1]);
        b.col.push(shade, shade, shade);
      }
      b.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      tris += 2;
    };

    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        cells++;
        const i = y * world.W + x;
        const isGate = world.gate[i] === 1 && !gatesOpen;
        const solid = world.solid[i] === 1 || isGate;
        const isVoid = world.void[i] === 1;
        const dxc = x + 0.5 - world.cx, dyc = y + 0.5 - world.cy;
        const r = Math.sqrt(dxc * dxc + dyc * dyc);
        const covered = r >= (MV.K.R1 - 0.5);        // Kayran açık, dışı tavanlı

        let open = 0;
        for (let d = 0; d < 4; d++) {
          const nx = x + (d === 0 ? 1 : d === 1 ? -1 : 0), ny = y + (d === 2 ? 1 : d === 3 ? -1 : 0);
          if (nx < 0 || ny < 0 || nx >= world.W || ny >= world.H) continue;
          if (world.solid[ny * world.W + nx] !== 1) open++;
        }
        const ao = 0.58 + 0.105 * open;
        let shade;
        if (!covered) shade = 1.0;
        else if (r < MV.K.R2B) shade = 0.86 + 0.035 * open;
        else if (r < MV.K.RAV0) shade = 0.58 + 0.10 * open;
        else shade = 0.72 + 0.06 * open;
        const lit = Math.min(1.25, ao * shade);

        if (solid) {
          walls++;
          const hgt = world.hscale[i] ? world.hscale[i] / 10 : CEIL_Y;
          const wall = world.wall[i] || T.STONE;
          const id = pick(isGate ? T.GATE : wall, T.STONE);
          const b = bucket(id);
          const s = 1;                                  // doku yoğunluğu
          for (let d = 0; d < 4; d++) {
            const nx = x + (d === 0 ? 1 : d === 1 ? -1 : 0), ny = y + (d === 2 ? 1 : d === 3 ? -1 : 0);
            if (nx < 0 || ny < 0 || nx >= world.W || ny >= world.H) continue;
            if (world.solid[ny * world.W + nx] === 1) continue;
            const X0 = x, X1 = x + 1, Y0 = y, Y1 = y + 1, H = hgt;
            if (d === 0) {          /* +x */
              quad(b, [X1, 0, Y1], [X1, 0, Y0], [X1, H, Y0], [X1, H, Y1], 1, 0, 0,
                [[0, 0], [s, 0], [s, H * s], [0, H * s]], lit);
            } else if (d === 1) {   /* -x */
              quad(b, [X0, 0, Y0], [X0, 0, Y1], [X0, H, Y1], [X0, H, Y0], -1, 0, 0,
                [[0, 0], [s, 0], [s, H * s], [0, H * s]], lit);
            } else if (d === 2) {   /* +z */
              quad(b, [X0, 0, Y1], [X1, 0, Y1], [X1, H, Y1], [X0, H, Y1], 0, 0, 1,
                [[0, 0], [s, 0], [s, H * s], [0, H * s]], lit);
            } else {                /* -z */
              quad(b, [X1, 0, Y0], [X0, 0, Y0], [X0, H, Y0], [X1, H, Y0], 0, 0, -1,
                [[0, 0], [s, 0], [s, H * s], [0, H * s]], lit);
            }
          }
          continue;
        }

        /* --- zemin --- */
        if (isVoid) {
          const b = bucket(pick(T.ROCK, T.DIRT));
          quad(b, [x, 0, y + 1], [x + 1, 0, y + 1], [x + 1, 0, y], [x, 0, y], 0, 1, 0,
            [[0, 0], [s0(), 0], [s0(), s0()], [0, s0()]], 0.30);
        } else {
          const fl = world.floor[i];
          if (fl) {
            const b = bucket(pick(fl, T.DIRT));
            quad(b, [x, 0, y + 1], [x + 1, 0, y + 1], [x + 1, 0, y], [x, 0, y], 0, 1, 0,
              [[0, 0], [1, 0], [1, 1], [0, 1]], lit);
            floors++;
          }
        }

        /* --- tavan (yalnızca kapalı alanda) --- */
        if (covered && hasTex(T.CEIL)) {
          const b = bucket(T.CEIL);
          quad(b, [x, CEIL_Y, y], [x + 1, CEIL_Y, y], [x + 1, CEIL_Y, y + 1], [x, CEIL_Y, y + 1], 0, -1, 0,
            [[0, 0], [1, 0], [1, 1], [0, 1]], Math.min(1.1, lit * 0.9));
          ceils++;
        }
      }
    }
    function s0() { return 2; }                       /* uçurum dokusu daha büyük döşenir */

    return { mats: mats, tris: tris, cells: cells, walls: walls, floors: floors, ceils: ceils };
  };

  /* ============================================================
     BÖLÜM AĞLARI (THREE)
     ============================================================ */
  GL._chunkAt = function (cx, cy) {
    const key = cx + ':' + cy;
    let ch = this.chunks[key];
    if (!ch) {
      ch = { key: key, cx: cx, cy: cy, group: null, stamp: -1, tris: 0 };
      this.chunks[key] = ch;
    }
    return ch;
  };

  GL._buildChunk = function (ch) {
    const T = this.T;
    const data = this.buildChunkData(this.worldRef, ch.cx, ch.cy, this._gatesOpen);
    const group = new T.Group();
    let meshes = 0;
    for (const id in data.mats) {
      const b = data.mats[id];
      const mat = this.mats[id];
      if (!mat || !b.idx.length) continue;
      const geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.Float32BufferAttribute(b.pos, 3));
      geo.setAttribute('normal', new T.Float32BufferAttribute(b.nrm, 3));
      geo.setAttribute('uv', new T.Float32BufferAttribute(b.uv, 2));
      geo.setAttribute('color', new T.Float32BufferAttribute(b.col, 3));
      geo.setIndex(b.pos.length / 3 > 65000 ? new T.Uint32BufferAttribute(b.idx, 1) : new T.Uint16BufferAttribute(b.idx, 1));
      geo.computeBoundingSphere();
      const mesh = new T.Mesh(geo, mat);
      mesh.castShadow = !this._noShadow;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      group.add(mesh);
      meshes++;
    }
    group.matrixAutoUpdate = false;
    group.updateMatrix();
    this.scene.add(group);
    if (ch.group) this._disposeChunk(ch);
    ch.group = group;
    ch.tris = data.tris;
    ch.meshes = meshes;
    ch.stamp = this.worldStamp;
    return ch;
  };

  GL._disposeChunk = function (ch) {
    if (!ch.group) return;
    const g = ch.group;
    this.scene.remove(g);
    for (const m of g.children) {
      if (m.geometry) m.geometry.dispose();
    }
    ch.group = null;
    ch.tris = 0;
  };

  GL._updateChunks = function (px, py, radius) {
    const w = this.worldRef;
    if (!w) return;
    const R = radius === undefined ? CHUNK_R : radius;
    const ccx = Math.floor(px / CHUNK), ccy = Math.floor(py / CHUNK);
    const keep = {};
    const pending = [];
    for (let cy = ccy - R; cy <= ccy + R; cy++) {
      for (let cx = ccx - R; cx <= ccx + R; cx++) {
        if (cx < 0 || cy < 0 || cx * CHUNK >= w.W || cy * CHUNK >= w.H) continue;
        keep[cx + ':' + cy] = 1;
        const ch = this._chunkAt(cx, cy);
        if (ch.stamp !== this.worldStamp) {
          const d = (cx - ccx) * (cx - ccx) + (cy - ccy) * (cy - ccy);
          pending.push({ ch: ch, d: d });
        }
      }
    }
    if (pending.length) {
      pending.sort((a, b) => a.d - b.d);
      const budget = Math.min(3, pending.length);
      for (let i = 0; i < budget; i++) this._buildChunk(pending[i].ch);
    }
    for (const key in this.chunks) {
      if (keep[key]) continue;
      const ch = this.chunks[key];
      this._disposeChunk(ch);
      delete this.chunks[key];
    }
  };

  GL.invalidate = function () {
    this.worldStamp++;
    for (const key in this.chunks) {
      const ch = this.chunks[key];
      this._disposeChunk(ch);
      delete this.chunks[key];
    }
  };

  /* ============================================================
     SPRITE'LAR (yaratıklar, eşyalar, yapılar, gölge lekeleri)
     ============================================================ */
  GL._spriteMat = function (e) {
    const name = e.sprite;
    if (!name) return null;
    const frames = [];
    for (let f = 0; f < 8; f++) {
      if (this.spriteMats[name + ':' + f]) frames.push(f);
      else break;
    }
    if (frames.length) {
      let fi = e.frame;
      if (fi === undefined || fi === null) fi = Math.floor((e.anim || 0) * 6) % frames.length;
      fi = ((fi % frames.length) + frames.length) % frames.length;
      return this.spriteMats[name + ':' + fi];
    }
    return this.spriteMats[name + ':0'] || null;
  };

  GL._syncEntities = function (v) {
    const T = this.T;
    const list = v.entities || [];
    const pool = this.entities;
    let used = 0, blobs = 0;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      const mat = this._spriteMat(e);
      if (!mat) continue;
      if (e.alpha !== undefined && e.alpha < 0.03) continue;
      let sp = pool[used];
      if (!sp) {
        sp = new T.Sprite(mat.clone());          // her varlığın kendi ton/şeffaflığı
        sp.center.set(0.5, 0);
        this.scene.add(sp);
        pool[used] = sp;
      }
      sp.visible = true;
      const w = e.w || 1, h = e.h || 1;
      const tint = (e.tint === undefined ? 1 : e.tint) + (e.glow || 0) * 0.85;
      const alpha = e.alpha === undefined ? 1 : e.alpha;
      sp.material.map = mat.map;
      sp.material.alphaTest = mat.alphaTest;
      sp.material.needsUpdate = false;
      sp.position.set(e.x, (e.yOff || 0), e.y);
      sp.scale.set(w, h, 1);
      sp.material.color.setRGB(Math.min(3, tint), Math.min(3, tint), Math.min(3, tint));
      sp.material.opacity = alpha;
      sp.material.transparent = true;
      used++;

      /* gölge lekesi */
      if (e.shadow && this.blobMat) {
        let bl = this.blobs[blobs];
        if (!bl) {
          bl = new T.Mesh(this.blobGeo, this.blobMat.clone());
          bl.rotation.x = -Math.PI / 2;
          bl.receiveShadow = false;
          this.scene.add(bl);
          this.blobs[blobs] = bl;
        }
        bl.visible = true;
        const bw = (e.shadowW || w) * 1.05;
        bl.position.set(e.x, 0.015, e.y);
        bl.scale.set(bw, bw * 0.85, 1);
        bl.material.opacity = 0.5;
        blobs++;
      }
    }
    for (let i = used; i < pool.length; i++) if (pool[i]) pool[i].visible = false;
    for (let i = blobs; i < this.blobs.length; i++) if (this.blobs[i]) this.blobs[i].visible = false;
  };

  /* ============================================================
     BOYUT
     ============================================================ */
  GL.setSize = function (W, H) {
    if (!this.ok) return;
    const s = this.scale || 1;
    const w = Math.max(160, Math.round(W * s));
    const h = Math.max(120, Math.round(H * s));
    this.canvas.width = w;
    this.canvas.height = h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.composer) this.composer.setSize(w, h);
    if (this.passGrade) this.passGrade.uniforms.uRes.value.set(w, h);
    this.pw = w; this.ph = h;
  };

  /* ============================================================
     KARE ÇİZİMİ
     ============================================================ */
  GL.render = function (v, R) {
    if (!this.ok) return false;
    try {
      const T = this.T;
      const cam = this.camera;
      const w = this.world = v.world;

      /* dünya değişti (yeni oyun / gece kayması) ya da geçitler açılıp
         kapandı → ağları tazele */
      const gatesOpen = v.gatesOpen !== false;
      if (v.world !== this.worldRef) { this.worldRef = v.world; this.invalidate(); }
      else if (gatesOpen !== this._gatesOpen) { this._gatesOpen = gatesOpen; this.invalidate(); }

      /* ---- kalite anahtarları ---- */
      const q = (R && R.quality) || 'yuksek';
      if (this._q !== q) {
        this._q = q;
        const useShadows = q !== 'performans';
        this.renderer.shadowMap.enabled = useShadows;
        this._noShadow = !useShadows;
        this.passBloom.enabled = q !== 'performans';
        this.passBloom.strength = q === 'yuksek' ? 0.42 : 0.30;
        if (this.sun) this.sun.shadow.mapSize.set(q === 'yuksek' ? 2048 : 1024, q === 'yuksek' ? 2048 : 1024);
        this.hemi.intensity = q === 'performans' ? 0.42 : 0.5;
      }

      /* ---- kamera ---- */
      const FOVK = (R && R.FOVK ? R.FOVK : 0.66) * (R.fovMul || 1) * (R.dynFov || 1);
      const hFov = 2 * Math.atan(FOVK);
      const vFov = 2 * Math.atan(Math.tan(hFov / 2) / Math.max(0.2, cam.aspect));
      cam.fov = Math.min(120, Math.max(25, vFov * 180 / Math.PI));
      cam.updateProjectionMatrix();
      const fy = (this.pw || 1) / (2 * FOVK);
      const pitchAng = Math.atan2(v.pitch || 0, fy);
      cam.position.set(v.px, v.zc, v.py);
      cam.rotation.set(pitchAng, Math.atan2(-Math.cos(v.pa), -Math.sin(v.pa)), -(v.roll || 0), 'YXZ');
      cam.updateMatrixWorld();

      /* ---- sis ve gökyüzü ---- */
      const fog = new T.Color(v.fogColor[0] / 255, v.fogColor[1] / 255, v.fogColor[2] / 255);
      this.scene.fog.color.copy(fog);
      this.scene.fog.density = Math.max(FOG_MIN, (v.fogDens || 0.03) * 0.85);
      const sun3 = new T.Vector3(v.sunDir[0], Math.max(0.06, v.sunEl === undefined ? 0.5 : v.sunEl), v.sunDir[1]).normalize();
      if (this.sky) {
        const u = this.sky.material.uniforms;
        u.uTop.value.setRGB(v.skyTop[0] / 255, v.skyTop[1] / 255, v.skyTop[2] / 255);
        u.uHorizon.value.setRGB(v.sky[0] / 255, v.sky[1] / 255, v.sky[2] / 255);
        u.uSun.value.copy(sun3);
        u.uSunCol.value.setRGB(v.sunCol[0] / 255 * 0.9, v.sunCol[1] / 255 * 0.9, v.sunCol[2] / 255 * 0.9);
        u.uStars.value = v.stars || 0;
        u.uClouds.value = v.clouds || 0;
        u.uTime.value = v.time || 0;
        this.sky.position.set(v.px, 0, v.py);
      }

      /* ---- ışıklar ---- */
      const light = v.light === undefined ? 0.7 : v.light;
      this.sun.color.setRGB(v.sunCol[0] / 255, v.sunCol[1] / 255, v.sunCol[2] / 255);
      this.sun.intensity = Math.max(0.02, light * 2.3) * (this._q === 'performans' ? 0.85 : 1);
      this.sun.position.set(v.px + sun3.x * 70, sun3.y * 70 + 12, v.py + sun3.z * 70);
      this.sun.target.position.set(v.px, 0, v.py);
      this.sun.target.updateMatrixWorld();
      this.hemi.color.setRGB(v.sky[0] / 255, v.sky[1] / 255, v.sky[2] / 255);
      this.hemi.groundColor.setRGB(fog.r * 0.55, fog.g * 0.55, fog.b * 0.55);
      const amb = v.ambient === undefined ? 0.3 : v.ambient;
      this.hemi.intensity = (0.42 + amb * 0.9) * (this._q === 'performans' ? 0.85 : 1);

      const torchOn = (v.torch || 0) > 0.02 && this._q !== 'performans';
      this.torch.intensity = torchOn ? v.torch * 3.4 : 0;
      this.fill.intensity = torchOn ? v.torch * 0.7 : 0;
      if (torchOn) {
        const fwd = new T.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
        this.torch.position.copy(cam.position).addScaledVector(fwd, 0.15);
        this.torch.target.position.copy(cam.position).addScaledVector(fwd, 12);
        this.torch.target.updateMatrixWorld();
        this.fill.position.copy(cam.position).addScaledVector(fwd, 0.6);
      }

      /* ---- bölüm ağları ---- */
      this._updateChunks(v.px, v.py, CHUNK_R);

      /* ---- varlıklar ---- */
      this._syncEntities(v);
      if (this.sky) this.sky.position.set(v.px, 0, v.py);

      /* ---- son katman değerleri ---- */
      const g = this.passGrade.uniforms;
      g.uExposure.value = (v.exposure === undefined ? 1.03 : v.exposure) * 1.06;
      g.uCA.value = (this._q === 'yuksek') ? (v.ca === undefined ? 0.5 : v.ca) * 0.55 : 0;
      g.uGrain.value = (this._q === 'yuksek') ? 0.016 + (v.grain || 0) * 0.010 : 0.007;
      g.uTime.value = v.time || 0;
      g.uVignette.value = 0.30;
      if (this.passBloom.enabled) {
        this.passBloom.strength = Math.min(1.0, 0.22 + (v.bloom === undefined ? 0.25 : v.bloom) * 0.9);
      }

      /* ---- çizim ---- */
      this.composer.render();

      /* ---- ilk kare denetimi: tamamen siyah kare → CPU'ya dön ---- */
      if (!this._checked) {
        this._checked = 1;
        const gl = this.gl;
        const cw = this.canvas.width, chh = this.canvas.height;
        const px = new Uint8Array(4 * 64 * 36);
        gl.readPixels(Math.max(0, (cw >> 1) - 32), Math.max(0, (chh >> 1) - 18), 64, 36, gl.RGBA, gl.UNSIGNED_BYTE, px);
        let sum = 0;
        for (let i = 0; i < px.length; i += 4) sum += px[i] + px[i + 1] + px[i + 2];
        const mean = sum / (64 * 36 * 3);
        this.lastMean = mean;
        if (mean < 0.35) throw new Error('GPU karesi boş (ortalama ' + mean.toFixed(2) + ')');
      }
      return true;
    } catch (e) {
      this.ok = false;
      this.status = 'CPU (çizim hatası: ' + (e && e.message ? e.message : e) + ')';
      log(this.status);
      try { if (this.canvas) this.canvas.style.display = 'none'; } catch (e2) { }
      return false;
    }
  };

  MV.GL = GL;
})(MV);
