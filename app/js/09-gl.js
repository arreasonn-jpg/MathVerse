/* ============================================================
   09-gl.js — GPU (WebGL) render hattı.

   CPU raycast hattının "piksel" görünümünü bırakmak için gerçek bir
   GPU rasterizer: bölüm bölüm (chunk) dünya geometrisi, mipmap'li
   doku atlasları, normal + parlama haritaları, güneş/fener ışığı,
   gökyüzü shader'ı, billboard sprite'lar ve sinematik post-process
   (bloom, ACES ton eşleme, renk sapması, vinyet, film greni).

   WebGL yoksa ya da bir shader derlenmezse sessizce CPU hattına döner:
   MV.GL.ok = false ve MV.GL.status sebebi taşır.
   ============================================================ */
(function (MV) {
  'use strict';
  const { clamp } = MV;

  const GL = {
    ok: false,
    status: 'başlatılmadı',
    gl: null,
    canvas: null
  };

  /* ---------------- küçük yardımcılar ---------------- */
  function mat4() { return new Float32Array(16); }
  function perspective(out, tanHalfX, aspect, near, far) {
    const f = 1 / tanHalfX;                 // yatay yarım açının tanjantı
    out.fill(0);
    out[0] = f;
    out[5] = f * aspect;                    // dikey ölçek (aspect = W/H)
    out[10] = (far + near) / (near - far);
    out[11] = -1;
    out[14] = (2 * far * near) / (near - far);
    return out;
  }
  function mul(out, a, b) {                 // out = a * b (sütun-öncelikli)
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        out[i * 4 + j] = a[j] * b[i * 4] + a[4 + j] * b[i * 4 + 1] + a[8 + j] * b[i * 4 + 2] + a[12 + j] * b[i * 4 + 3];
      }
    }
    return out;
  }
  function viewMatrix(out, px, py, pz, yaw, pitch, roll) {
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    roll = roll || 0;
    /* ileri (yukarı bakış pozitif), sağ ve yukarı vektörleri */
    const fx = cy * cp, fy = sp, fz = sy * cp;
    let rx = -sy, ry = 0, rz = cy;
    /* up = right × forward */
    let ux = ry * fz - rz * fy, uy = rz * fx - rx * fz, uz = rx * fy - ry * fx;
    /* yana yatma (lean/roll): sağ ve yukarı vektörlerini ileri eksende döndür */
    if (roll) {
      const cr = Math.cos(roll), sr = Math.sin(roll);
      const rx2 = rx * cr + ux * sr, ry2 = ry * cr + uy * sr, rz2 = rz * cr + uz * sr;
      const ux2 = ux * cr - rx * sr, uy2 = uy * cr - ry * sr, uz2 = uz * cr - rz * sr;
      rx = rx2; ry = ry2; rz = rz2; ux = ux2; uy = uy2; uz = uz2;
    }
    out[0] = rx; out[1] = ux; out[2] = -fx; out[3] = 0;
    out[4] = ry; out[5] = uy; out[6] = -fy; out[7] = 0;
    out[8] = rz; out[9] = uz; out[10] = -fz; out[11] = 0;
    out[12] = -(rx * px + ry * py + rz * pz);
    out[13] = -(ux * px + uy * py + uz * pz);
    out[14] = fx * px + fy * py + fz * pz;
    out[15] = 1;
    return out;
  }

  /* ---------------- shader derleme ---------------- */
  GL._compile = function (vertexSrc, fragmentSrc, name) {
    const gl = this.gl;
    const mk = (type, src) => {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(sh) || '';
        throw new Error((name || 'shader') + ' derlenemedi: ' + log.slice(0, 220));
      }
      return sh;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, mk(gl.VERTEX_SHADER, vertexSrc));
    gl.attachShader(prog, mk(gl.FRAGMENT_SHADER, fragmentSrc));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error((name || 'program') + ' bağlanamadı: ' + String(gl.getProgramInfoLog(prog)).slice(0, 220));
    }
    const ucache = {}, acache = {};
    const loc = (n) => (n in ucache ? ucache[n] : (ucache[n] = gl.getUniformLocation(prog, n)));
    const attr = (n) => (n in acache ? acache[n] : (acache[n] = gl.getAttribLocation(prog, n)));
    return { prog: prog, u: loc, a: attr };
  };

  GL._texture = function (source, opts) {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    const pot = opts && opts.pot;
    if (pot) {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.generateMipmap(gl.TEXTURE_2D);
      const aniso = gl.getExtension('EXT_texture_filter_anisotropic')
        || gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic');
      if (aniso) {
        const max = gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT);
        gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, max));
      }
    } else {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    return t;
  };

  /* ============================================================
     BAŞLATMA
     ============================================================ */
  GL.init = function (canvas2d) {
    if (this.ok) return this;
    try {
      if (typeof document === 'undefined' || !canvas2d || !canvas2d.parentNode) throw new Error('canvas yok');
      const cv = document.createElement('canvas');
      cv.id = 'glview';
      cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;background:#000';
      canvas2d.parentNode.insertBefore(cv, canvas2d);
      const opts = { alpha: false, antialias: true, depth: true, stencil: false, powerPreference: 'high-performance', preserveDrawingBuffer: false };
      const gl = cv.getContext('webgl', opts) || cv.getContext('experimental-webgl', opts);
      /* yetenek denetimi: sahte (stub) bağlamlarda burada dururuz */
      if (!gl || typeof gl.createShader !== 'function' || typeof gl.getParameter !== 'function'
        || typeof gl.createBuffer !== 'function' || typeof gl.texImage2D !== 'function') {
        throw new Error('WebGL bağlamı yok');
      }
      const ver = String(gl.getParameter(gl.VERSION) || '');
      if (!ver) throw new Error('WebGL sürümü okunamadı');
      /* yazılım GPU (SwiftShader/llvmpipe) tespiti: o durumda CPU hattı daha iyi */
      try {
        const dbg = gl.getExtension('WEBGL_debug_renderer_info');
        if (dbg) {
          const rend = String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || '');
          if (/swiftshader|llvmpipe|softpipe|software|basic render/i.test(rend)) {
            throw new Error('yazılım GPU: ' + rend.slice(0, 40));
          }
          this.rendererName = rend;
        }
      } catch (e) {
        if (e && /yazılım GPU/.test(e.message || '')) throw e;
      }

      this.canvas = cv; this.gl = gl;
      this.W = 1; this.H = 1;
      this.scale = 1;
      this.chunks = {};
      this.chunkList = [];
      this.worldRef = null;
      this.worldStamp = -1;

      /* ---- shader'lar ---- */
      this._buildShaders();
      /* ---- post hedefleri ---- */
      this._resizeTargets(64, 64);
      this.ok = true;
      this.status = 'GPU etkin (' + (this.rendererName ? this.rendererName.slice(0, 42) : ver) + ')';
      return this;
    } catch (e) {
      this.ok = false;
      this.status = 'CPU (sebep: ' + (e && e.message ? e.message : e) + ')';
      try { if (this.canvas && this.canvas.parentNode) this.canvas.parentNode.removeChild(this.canvas); } catch (e2) { }
      this.canvas = null; this.gl = null;
      if (MV.logMsg) MV.logMsg('[GL] ' + this.status);
      return this;
    }
  };

  /* ============================================================
     SHADER'LAR
     ============================================================ */
  GL._buildShaders = function () {
    const P = MV.TS;                          // doku boyutu (256)
    const COLS = 8, ROWS = 4;                 // atlas ızgarası
    this.atlasCols = COLS; this.atlasRows = ROWS; this.atlasSize = P;

    /* ---------- dünya: duvar + zemin + tavan ---------- */
    const worldVS = [
      'attribute vec3 aPos;',
      'attribute vec2 aUV;',
      'attribute vec2 aSlot;',               // x: atlas slot indeksi
      'attribute vec2 aShade;',              // x: ışık çarpanı, y: AO
      'attribute float aFlags;',             // 1 = işlenmemiş karanlık (uçurum)
      'uniform mat4 uVP;',
      'uniform vec2 uCell;',                 // 1/COLS, 1/ROWS
      'uniform float uCols;',                // atlas sütun sayısı
      'varying vec2 vUV;',
      'varying vec2 vShade;',
      'varying vec3 vWorld;',
      'varying float vFlags;',
      'void main() {',
      '  vec2 cell = vec2(mod(aSlot.x, uCols), floor(aSlot.x / uCols));',
      '  vUV = (cell + clamp(aUV, 0.004, 0.996)) * uCell;',
      '  vShade = aShade;',
      '  vWorld = aPos;',
      '  vFlags = aFlags;',
      '  gl_Position = uVP * vec4(aPos, 1.0);',
      '}'
    ].join('\n');

    const worldFS = [
      '#ifdef GL_FRAGMENT_PRECISION_HIGH',
      'precision highp float;',
      '#else',
      'precision mediump float;',
      '#endif',
      'uniform sampler2D uAlbedo;',
      'uniform sampler2D uNormal;',
      'uniform sampler2D uSpec;',
      'uniform vec3 uSunDir;',               // normalize edilmiş
      'uniform vec3 uSunCol;',
      'uniform float uSunAmt;',              // güneş katkısı
      'uniform vec3 uAmbient;',
      'uniform vec3 uTorchCol;',
      'uniform float uTorch;',
      'uniform vec3 uCamPos;',
      'uniform vec3 uFogCol;',
      'uniform float uFogDens;',
      'uniform float uAmb;',
      'varying vec2 vUV;',
      'varying vec2 vShade;',
      'varying vec3 vWorld;',
      'varying float vFlags;',
      'void main() {',
      '  vec3 alb = texture2D(uAlbedo, vUV).rgb;',
      '  if (vFlags > 0.5) {',                 /* uçurum: doku yok, koyu boşluk */
      '    vec3 p = vWorld - uCamPos;',
      '    float dp = length(p);',
      '    float f = clamp(dp * uFogDens, 0.0, 1.0);',
      '    vec3 col = mix(vec3(0.012, 0.014, 0.02) * vShade.y, uFogCol, f);',
      '    gl_FragColor = vec4(col, 1.0);',
      '    return;',
      '  }',
      '  vec3 nrmT = texture2D(uNormal, vUV).rgb * 2.0 - 1.0;',
      '  float spec = texture2D(uSpec, vUV).r;',
      '  vec3 albedo = alb * vShade.x * vShade.y;',
      '  vec3 toCam = uCamPos - vWorld;',
      '  float dist = length(toCam);',
      '  vec3 V = toCam / max(dist, 0.0001);',
      '  /* normal: doku yüzeyi düz kabul edilir (duvar/zemin yönelimi eksenel) */',
      '  vec3 N = normalize(vec3(nrmT.x, nrmT.z, nrmT.y));',
      '  /* dikey yüzeylerde normal haritası XZ düzleminde kalır: yaklaşık yönelimi geri kazan */',
      '  if (abs(N.y) > 0.7) N = normalize(vec3(nrmT.x, 0.75, nrmT.y));',
      '  float lam = max(0.0, dot(N, uSunDir));',
      '  vec3 col = albedo * (uAmbient + uSunCol * lam * uSunAmt);',
      '  if (uTorch > 0.001) {',
      '    vec3 L = -V;',
      '    float lamT = max(0.0, dot(N, L));',
      '    float att = 1.0 / (1.0 + dist * dist * 0.055);',
      '    vec3 H = normalize(L + V);',
      '    float sp = pow(max(0.0, dot(N, H)), 28.0) * spec;',
      '    col += uTorchCol * uTorch * att * (lamT * 0.85 + sp * 0.9);',
      '  }',
      '  float f = clamp(dist * uFogDens, 0.0, 1.0);',
      '  col = mix(col, uFogCol, f);',
      '  gl_FragColor = vec4(col, 1.0);',
      '}'
    ].join('\n');

    /* ---------- gökyüzü (tam ekran) ---------- */
    const skyVS = [
      'attribute vec2 aPos;',
      'uniform mat4 uInvVP;',
      'uniform vec3 uCamPos;',
      'varying vec3 vRay;',
      'void main() {',
      '  vec4 far = uInvVP * vec4(aPos, 1.0, 1.0);',
      '  vec4 near = uInvVP * vec4(aPos, -1.0, 1.0);',
      '  vRay = normalize(far.xyz / far.w - near.xyz / near.w);',
      '  gl_Position = vec4(aPos, 0.999, 1.0);',
      '}'
    ].join('\n');
    const skyFS = [
      '#ifdef GL_FRAGMENT_PRECISION_HIGH',
      'precision highp float;',
      '#else',
      'precision mediump float;',
      '#endif',
      'uniform vec3 uSkyTop;',
      'uniform vec3 uSkyHorizon;',
      'uniform vec3 uSunDir;',
      'uniform vec3 uSunCol;',
      'uniform float uStars;',
      'uniform float uClouds;',
      'uniform float uTime;',
      'uniform float uFogDens;',
      'varying vec3 vRay;',
      'float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }',
      'float noise(vec2 p) {',
      '  vec2 i = floor(p); vec2 f = fract(p);',
      '  f = f * f * (3.0 - 2.0 * f);',
      '  float a = hash(i), b = hash(i + vec2(1.0, 0.0)), c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));',
      '  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);',
      '}',
      'float fbm(vec2 p) {',
      '  float s = 0.0, a = 0.5;',
      '  for (int i = 0; i < 5; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; }',
      '  return s;',
      '}',
      'void main() {',
      '  vec3 d = normalize(vRay);',
      '  float h = clamp(d.y * 0.5 + 0.5, 0.0, 1.0);',
      '  vec3 col = mix(uSkyHorizon, uSkyTop, pow(clamp(d.y, 0.0, 1.0), 0.62));',
      '  /* yıldızlar */',
      '  if (uStars > 0.01 && d.y > -0.02) {',
      '    vec2 sp = d.xz / max(0.08, d.y + 0.25) * 9.0;',
      '    float s = hash(floor(sp * 26.0));',
      '    float tw = 0.55 + 0.45 * sin(uTime * 2.2 + s * 40.0);',
      '    float star = smoothstep(0.9975, 1.0, s) * tw;',
      '    col += vec3(0.85, 0.9, 1.0) * star * uStars * clamp(d.y * 3.0, 0.0, 1.0);',
      '  }',
      '  /* bulutlar */',
      '  if (uClouds > 0.01 && d.y > 0.0) {',
      '    vec2 cp = d.xz / max(0.12, d.y + 0.12) * 0.62 + vec2(uTime * 0.004, uTime * 0.0022);',
      '    float c = fbm(cp * 1.35);',
      '    c = smoothstep(0.52, 0.86, c) * uClouds * clamp(d.y * 4.0, 0.0, 1.0);',
      '    vec3 lit = mix(vec3(0.42, 0.44, 0.5), vec3(0.95, 0.94, 0.92), smoothstep(0.0, 1.0, d.y));',
      '    col = mix(col, lit, c);',
      '  }',
      '  /* güneş/ay diski ve halesi */',
      '  float sd = max(0.0, dot(d, uSunDir));',
      '  col += uSunCol * pow(sd, 900.0) * 1.6;',
      '  col += uSunCol * pow(sd, 26.0) * 0.30;',
      '  col += uSunCol * pow(sd, 6.0) * 0.10;',
      '  /* ufuk sisine bağlanma */',
      '  float f = clamp((1.0 - clamp(d.y * 6.0, 0.0, 1.0)) * 0.55, 0.0, 1.0);',
      '  col = mix(col, uSkyHorizon, f * 0.35);',
      '  gl_FragColor = vec4(col, 1.0);',
      '}'
    ].join('\n');

    /* ---------- sprite (billboard) ---------- */
    const sprVS = [
      'attribute vec2 aPos;',                 // köşe (-0.5..0.5, 0..1)
      'attribute vec3 aCenter;',              // dünya merkezi (x, zemin, z)
      'attribute vec2 aSize;',                // genişlik, yükseklik
      'attribute vec4 aUV;',                  // u0, v0, u1, v1 (atlasta)
      'attribute vec2 aTint;',                // parlaklık, alfa
      'uniform mat4 uVP;',
      'varying vec2 vUV;',
      'varying vec2 vTint;',
      'varying vec3 vWorld;',
      'void main() {',
      '  /* kameraya bakan billboard: sağ vektörü kameranın sağıdır */',
      '  vec3 right = normalize(vec3(uVP[0][0], 0.0, uVP[0][2]));',
      '  vec3 pos = aCenter + right * (aPos.x * aSize.x) + vec3(0.0, aPos.y * aSize.y, 0.0);',
      '  vWorld = pos;',
      '  vUV = vec2(mix(aUV.x, aUV.z, aPos.x + 0.5), mix(aUV.w, aUV.y, aPos.y + 0.5));',
      '  vTint = aTint;',
      '  gl_Position = uVP * vec4(pos, 1.0);',
      '}'
    ].join('\n');
    const sprFS = [
      '#ifdef GL_FRAGMENT_PRECISION_HIGH',
      'precision highp float;',
      '#else',
      'precision mediump float;',
      '#endif',
      'uniform sampler2D uAtlas;',
      'uniform vec3 uCamPos;',
      'uniform vec3 uFogCol;',
      'uniform float uFogDens;',
      'uniform float uLight;',
      'uniform vec3 uAmbient;',
      'uniform vec3 uTorchCol;',
      'uniform float uTorch;',
      'varying vec2 vUV;',
      'varying vec2 vTint;',
      'varying vec3 vWorld;',
      'void main() {',
      '  vec4 tex = texture2D(uAtlas, vUV);',
      '  if (tex.a < 0.06) discard;',
      '  float dist = length(uCamPos - vWorld);',
      '  vec3 col = tex.rgb * (uAmbient + vec3(uLight) * 0.75) * vTint.x;',
      '  if (uTorch > 0.001) col += tex.rgb * uTorchCol * uTorch * (1.0 / (1.0 + dist * dist * 0.05)) * 0.55;',
      '  float f = clamp(dist * uFogDens, 0.0, 1.0);',
      '  col = mix(col, uFogCol, f);',
      '  gl_FragColor = vec4(col, tex.a * vTint.y);',
      '}'
    ].join('\n');

    /* ---------- post: parlak geçiş + bulanıklık + birleştirme ---------- */
    const quadVS = [
      'attribute vec2 aPos;',
      'varying vec2 vUV;',
      'void main() { vUV = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }'
    ].join('\n');

    const brightFS = [
      'precision mediump float;',
      'uniform sampler2D uTex;',
      'uniform float uThreshold;',
      'varying vec2 vUV;',
      'void main() {',
      '  vec3 c = texture2D(uTex, vUV).rgb;',
      '  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));',
      '  float k = max(0.0, l - uThreshold) / max(0.0001, 1.0 - uThreshold);',
      '  gl_FragColor = vec4(c * k, 1.0);',
      '}'
    ].join('\n');

    const blurFS = [
      'precision mediump float;',
      'uniform sampler2D uTex;',
      'uniform vec2 uDir;',
      'varying vec2 vUV;',
      'void main() {',
      '  vec3 s = texture2D(uTex, vUV).rgb * 0.227;',
      '  s += texture2D(uTex, vUV + uDir * 1.3846).rgb * 0.316;',
      '  s += texture2D(uTex, vUV - uDir * 1.3846).rgb * 0.316;',
      '  s += texture2D(uTex, vUV + uDir * 3.2308).rgb * 0.070;',
      '  s += texture2D(uTex, vUV - uDir * 3.2308).rgb * 0.070;',
      '  gl_FragColor = vec4(s, 1.0);',
      '}'
    ].join('\n');

    const compFS = [
      '#ifdef GL_FRAGMENT_PRECISION_HIGH',
      'precision highp float;',
      '#else',
      'precision mediump float;',
      '#endif',
      'uniform sampler2D uTex;',
      'uniform sampler2D uBloom;',
      'uniform float uExposure;',
      'uniform float uBloomAmt;',
      'uniform float uCA;',
      'uniform float uGrain;',
      'uniform float uTime;',
      'uniform float uVignette;',
      'uniform vec2 uRes;',                 // sahne (süper örneklemeli) çözünürlük
      'uniform float uSS;',                 // süper örnekleme oranı
      'varying vec2 vUV;',
      'vec3 samp(vec2 uv) {',
      '  if (uSS <= 1.001) return texture2D(uTex, uv).rgb;',
      '  vec2 t = 0.35 / uRes;',
      '  return (texture2D(uTex, uv + vec2(-t.x, -t.y)).rgb + texture2D(uTex, uv + vec2(t.x, -t.y)).rgb',
      '        + texture2D(uTex, uv + vec2(-t.x, t.y)).rgb + texture2D(uTex, uv + vec2(t.x, t.y)).rgb) * 0.25;',
      '}',
      'vec3 aces(vec3 x) {',
      '  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);',
      '}',
      'float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }',
      'void main() {',
      '  vec2 uv = vUV;',
      '  vec2 d = uv - 0.5;',
      '  float r2 = dot(d, d);',
      '  /* renk sapması: kenarlara doğru artar */',
      '  vec2 off = d * (uCA * 0.006) * (0.35 + r2 * 2.4);',
      '  vec3 col;',
      '  col.r = samp(uv + off).r;',
      '  col.g = samp(uv).g;',
      '  col.b = samp(uv - off).b;',
      '  col *= uExposure;',
      '  col += texture2D(uBloom, uv).rgb * uBloomAmt;',
      '  col = aces(col);',
      '  /* vinyet */',
      '  float v = smoothstep(0.95, 0.28, length(d) * 1.42);',
      '  col *= mix(1.0 - uVignette, 1.0, v);',
      '  /* film greni */',
      '  float n = hash(uv * uRes * 0.5 + fract(uTime) * 137.0) - 0.5;',
      '  col += n * uGrain;',
      '  /* hafif keskinleştirme (kontrast kaybını telafi) */',
      '  vec3 blur = samp(uv + vec2(1.0 / uRes.x, 0.0)) + samp(uv - vec2(1.0 / uRes.x, 0.0));',
      '  col += (col - (blur + col) * 0.5) * 0.10;',
      '  gl_FragColor = vec4(col, 1.0);',
      '}'
    ].join('\n');

    this.pWorld = this._compile(worldVS, worldFS, 'dünya');
    this.pSky = this._compile(skyVS, skyFS, 'gökyüzü');
    this.pSprite = this._compile(sprVS, sprFS, 'sprite');
    this.pBright = this._compile(quadVS, brightFS, 'parlak');
    this.pBlur = this._compile(quadVS, blurFS, 'bulanık');
    this.pComp = this._compile(quadVS, compFS, 'birleştir');

    /* tam ekran dörtgen */
    const quad = this.gl.createBuffer();
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, quad);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), this.gl.STATIC_DRAW);
    this.quadBuf = quad;

    /* sprite dörtgeni (birim kare) */
    const spr = this.gl.createBuffer();
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, spr);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, new Float32Array([
      -0.5, 0, 0.5, 0, -0.5, 1, 0.5, 1
    ]), this.gl.STATIC_DRAW);
    this.sprQuad = spr;
  };

  /* ============================================================
     DOKULAR (doku atlasları)
     ============================================================ */
  GL.prepare = function (tex) {
    if (!this.ok) return;
    try {
      const gl = this.gl;
      const P = this.atlasSize;
      /* karo kimlikleri 107'ye kadar çıkıyor: yalnızca dokusu olanları
         sırayla atlas slotlarına yerleştir (boşuna dev atlas üretmeyiz) */
      const slots = [];
      const map = new Int16Array(256).fill(-1);
      for (let i = 0; i < tex.walls.length; i++) {
        if (!tex.walls[i]) continue;
        map[i] = slots.length;
        slots.push(tex.walls[i]);
      }
      this.slotOf = map;
      const COLS = 8;
      let ROWS = 2;
      while (ROWS * COLS < slots.length && ROWS < 16) ROWS *= 2;   // mipmap için 2'nin kuvveti
      if (ROWS * COLS < slots.length) throw new Error('doku atlası yetmedi: ' + slots.length + ' karo');
      this.atlasCols = COLS; this.atlasRows = ROWS; this.slotCount = slots.length;
      const AW = P * COLS, AH = P * ROWS;
      if (gl.getParameter(gl.MAX_TEXTURE_SIZE) < AW) throw new Error('atlas GPU sınırını aşıyor: ' + AW);

      const mk = () => { const c = MV.makeCanvas(AW, AH); const x = c.getContext('2d'); x.clearRect(0, 0, AW, AH); return { c: c, x: x }; };
      const A = mk(), N = mk(), S = mk();
      const tmp = MV.makeCanvas(P, P), tctx = tmp.getContext('2d');

      for (let i = 0; i < slots.length; i++) {
        const cv = slots[i];
        if (!cv) continue;
        const cx = (i % COLS) * P, cy = ((i / COLS) | 0) * P;
        A.x.drawImage(cv, cx, cy);
        const w = cv.width, h = cv.height;
        if (cv._normal) {
          const im = tctx.createImageData(w, h);
          for (let p = 0; p < w * h; p++) {
            im.data[p * 4] = cv._normal[p * 2];
            im.data[p * 4 + 1] = cv._normal[p * 2 + 1];
            im.data[p * 4 + 2] = 255;
            im.data[p * 4 + 3] = 255;
          }
          tctx.putImageData(im, 0, 0);
          N.x.drawImage(tmp, cx, cy);
        }
        if (cv._spec) {
          const im = tctx.createImageData(w, h);
          for (let p = 0; p < w * h; p++) {
            const s = cv._spec[p];
            im.data[p * 4] = s; im.data[p * 4 + 1] = s; im.data[p * 4 + 2] = s; im.data[p * 4 + 3] = 255;
          }
          tctx.putImageData(im, 0, 0);
          S.x.drawImage(tmp, cx, cy);
        }
      }
      this.texAlbedo = this._texture(A.c, { pot: true });
      this.texNormal = this._texture(N.c, { pot: true });
      this.texSpec = this._texture(S.c, { pot: true });

      /* ---- sprite atlası ---- */
      const SA = 1024;
      const sc = MV.makeCanvas(SA, SA), sx2 = sc.getContext('2d');
      sx2.clearRect(0, 0, SA, SA);
      const rects = {};
      let penX = 0, penY = 0, rowH = 0;
      const place = (cv) => {
        if (cv.width + penX > SA) { penX = 0; penY += rowH + 2; rowH = 0; }
        if (penY + cv.height > SA) return null;
        const r = { x: penX, y: penY, w: cv.width, h: cv.height };
        sx2.drawImage(cv, penX, penY);
        penX += cv.width + 2;
        rowH = Math.max(rowH, cv.height);
        return r;
      };
      for (const name in tex.sprites) {
        const cv = tex.sprites[name];
        if (!cv) continue;
        if (Array.isArray(cv)) {
          rects[name] = [];
          for (const f of cv) rects[name].push(place(f));
        } else {
          rects[name] = place(cv);
        }
      }
      this.spriteRects = rects;
      this.texSprites = this._texture(sc, { pot: true });

      this.prepared = true;
    } catch (e) {
      this.ok = false;
      this.status = 'CPU (doku yükleme hatası: ' + (e && e.message ? e.message : e) + ')';
      if (MV.logMsg) MV.logMsg('[GL] ' + this.status);
    }
  };

  /* ============================================================
     GEOMETRİ: bölüm bölüm dünya ağı
     ============================================================ */
  const CHUNK = 32;

  GL._chunkAt = function (cx, cy) {
    const key = cx + ':' + cy;
    let ch = this.chunks[key];
    if (ch) return ch;
    ch = { key: key, cx: cx, cy: cy, vbo: null, ibo: null, count: 0, stamp: -1 };
    this.chunks[key] = ch;
    return ch;
  };

  GL._buildChunk = function (ch) {
    const gl = this.gl, w = this.worldRef;
    const T = MV.T;
    const x0 = ch.cx * CHUNK, y0 = ch.cy * CHUNK;
    const x1 = Math.min(x0 + CHUNK, w.W), y1 = Math.min(y0 + CHUNK, w.H);
    const verts = [], idx = [];
    const COLS = this.atlasCols, ROWS = this.atlasRows;

    /* karo kimliği -> atlas slotu; dokusu olmayan karo karanlık yüz olur */
    const slotted = (id) => {
      const t = this.slotOf;
      const sl = t && id < t.length ? t[id] : id;
      return sl === undefined || sl < 0 ? -1 : sl;
    };
    const push = (x, y, z, u, v, id, shade, ao, flags) => {
      let slot = slotted(id);
      if (slot < 0) { slot = 0; flags = 1; }
      verts.push(x, y, z, u, v, slot, 0, shade, ao, flags || 0);
      return (verts.length / 10) - 1;
    };
    const quad = (a, b, c, d) => { idx.push(a, b, c, a, c, d); };

    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = y * w.W + x;
        const solid = w.solid[i] === 1;
        const isVoid = w.void[i] === 1;
        const dx = x + 0.5 - w.cx, dy = y + 0.5 - w.cy;
        const r = Math.sqrt(dx * dx + dy * dy);
        const indoor = r >= MV.K.R2B && r < MV.K.RAV0;
        /* açıklık → AO: komşu duvar sayısı */
        let open = 0;
        for (let d = 0; d < 4; d++) {
          const nx = x + (d === 0 ? 1 : d === 1 ? -1 : 0), ny = y + (d === 2 ? 1 : d === 3 ? -1 : 0);
          if (nx < 0 || ny < 0 || nx >= w.W || ny >= w.H) continue;
          if (w.solid[ny * w.W + nx] !== 1) open++;
        }
        const ao = 0.62 + 0.095 * open;                       /* 0..1 arası yumuşak ambient occlusion */
        const shade = indoor ? 0.52 + 0.10 * open : 1.0;      /* kapalı koridor daha az güneş alır */

        if (solid) {
          const hgt = w.hscale[i] ? w.hscale[i] / 10 : 4;
          const wall = w.wall[i] || T.STONE;
          const gate = w.gate[i] === 1;
          const slot = gate ? T.GATE : wall;
          /* dört komşuya bakan yüzler */
          for (let d = 0; d < 4; d++) {
            const nx = x + (d === 0 ? 1 : d === 1 ? -1 : 0), ny = y + (d === 2 ? 1 : d === 3 ? -1 : 0);
            if (nx < 0 || ny < 0 || nx >= w.W || ny >= w.H) continue;
            if (w.solid[ny * w.W + nx] === 1) continue;
            const X0 = x, X1 = x + 1, Y0 = y, Y1 = y + 1;
            let a, b, c, e;
            if (d === 0) {        /* +x yönü */
              a = push(X1, 0, Y1, 0, hgt, slot, shade, ao);
              b = push(X1, 0, Y0, 1, hgt, slot, shade, ao);
              c = push(X1, hgt, Y0, 1, 0, slot, shade, ao);
              e = push(X1, hgt, Y1, 0, 0, slot, shade, ao);
            } else if (d === 1) { /* -x */
              a = push(X0, 0, Y0, 0, hgt, slot, shade, ao);
              b = push(X0, 0, Y1, 1, hgt, slot, shade, ao);
              c = push(X0, hgt, Y1, 1, 0, slot, shade, ao);
              e = push(X0, hgt, Y0, 0, 0, slot, shade, ao);
            } else if (d === 2) { /* +y (z) */
              a = push(X0, 0, Y1, 0, hgt, slot, shade, ao);
              b = push(X1, 0, Y1, 1, hgt, slot, shade, ao);
              c = push(X1, hgt, Y1, 1, 0, slot, shade, ao);
              e = push(X0, hgt, Y1, 0, 0, slot, shade, ao);
            } else {              /* -y (z) */
              a = push(X1, 0, Y0, 0, hgt, slot, shade, ao);
              b = push(X0, 0, Y0, 1, hgt, slot, shade, ao);
              c = push(X0, hgt, Y0, 1, 0, slot, shade, ao);
              e = push(X1, hgt, Y0, 0, 0, slot, shade, ao);
            }
            quad(a, b, c, e);
          }
          continue;
        }

        /* zemin */
        const fl = w.floor[i];
        if (isVoid) {
          const a = push(x, 0, y, 0, 0, T.ROCK, 0.25, 0.5, 1);
          const b = push(x + 1, 0, y, 1, 0, T.ROCK, 0.25, 0.5, 1);
          const c = push(x + 1, 0, y + 1, 1, 1, T.ROCK, 0.25, 0.5, 1);
          const e = push(x, 0, y + 1, 0, 1, T.ROCK, 0.25, 0.5, 1);
          quad(a, b, c, e);
        } else if (fl !== undefined && fl !== null) {
          const a = push(x, 0, y + 1, 0, 1, fl, shade, ao);
          const b = push(x + 1, 0, y + 1, 1, 1, fl, shade, ao);
          const c = push(x + 1, 0, y, 1, 0, fl, shade, ao);
          const e = push(x, 0, y, 0, 0, fl, shade, ao);
          quad(a, b, c, e);
        }
        /* tavan: yalnızca kapalı labirent kuşağında */
        if (indoor) {
          const a = push(x, 4, y, 0, 0, T.CEIL, shade * 0.85, 0.55);
          const b = push(x + 1, 4, y, 1, 0, T.CEIL, shade * 0.85, 0.55);
          const c = push(x + 1, 4, y + 1, 1, 1, T.CEIL, shade * 0.85, 0.55);
          const e = push(x, 4, y + 1, 0, 1, T.CEIL, shade * 0.85, 0.55);
          quad(a, b, c, e);
        }
      }
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, ch.vbo || (ch.vbo = gl.createBuffer()));
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ch.ibo || (ch.ibo = gl.createBuffer()));
    const big = verts.length / 10 > 65000;
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, big ? new Uint32Array(idx) : new Uint16Array(idx), gl.STATIC_DRAW);
    ch.count = idx.length;
    ch.big = big;
    ch.stamp = this.worldStamp;
  };

  GL._updateChunks = function (px, py, radius) {
    const w = this.worldRef;
    if (!w) return;
    const R = radius || 3;                       // chunk yarıçapı (32 karo * R)
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
    /* kare başına bütçe: takılma olmasın, yakın bölümler önce */
    if (pending.length) {
      pending.sort((a, b) => a.d - b.d);
      const budget = Math.min(6, pending.length);
      for (let i = 0; i < budget; i++) this._buildChunk(pending[i].ch);
    }
    /* uzaktaki bölümleri bırak */
    for (const key in this.chunks) {
      if (keep[key]) continue;
      const ch = this.chunks[key];
      if (ch.vbo) this.gl.deleteBuffer(ch.vbo);
      if (ch.ibo) this.gl.deleteBuffer(ch.ibo);
      delete this.chunks[key];
    }
  };

  /* dünya değişti (gece kaydırma / yeni gün) */
  GL.invalidate = function () {
    this.worldStamp++;
    const gl = this.gl;
    if (!gl) return;
    for (const key in this.chunks) {
      const ch = this.chunks[key];
      if (ch.vbo) gl.deleteBuffer(ch.vbo);
      if (ch.ibo) gl.deleteBuffer(ch.ibo);
    }
    this.chunks = {};
  };

  /* ============================================================
     BOYUT / HEDEFLER
     ============================================================ */
  GL._resizeTargets = function (w, h) {
    const gl = this.gl;
    if (!gl) return;
    const mkFBO = (W, H) => {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      if (H !== undefined) {
        const db = gl.createRenderbuffer();
        gl.bindRenderbuffer(gl.RENDERBUFFER, db);
        gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, W, H);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, db);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return { fb: fb, tex: tex, w: W, h: H };
    };
    const old = this.scene, oldA = this.brightA, oldB = this.brightB;
    this.scene = mkFBO(Math.max(4, w), Math.max(4, h));
    const bw = Math.max(2, Math.floor(w / 4)), bh = Math.max(2, Math.floor(h / 4));
    this.brightA = mkFBO(bw, bh);
    this.brightB = mkFBO(bw, bh);
    for (const o of [old, oldA, oldB]) {
      if (!o) continue;
      gl.deleteFramebuffer(o.fb); gl.deleteTexture(o.tex);
    }
    this.targetW = w; this.targetH = h;
  };

  GL.setSize = function (W, H) {
    if (!this.ok) return;
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) ? Math.min(2, window.devicePixelRatio) : 1;
    const pw = Math.max(64, Math.round(W * dpr * this.scale));
    const ph = Math.max(64, Math.round(H * dpr * this.scale));
    /* sahne süper örneklemeli çizilir, birleştirmede kutu filtresiyle iner:
       kenar yumuşatma (MSAA'nın FBO'larda çalışmadığı WebGL1 için gerçek çözüm) */
    const sw = Math.max(64, Math.round(pw * (this.ss || 1)));
    const sh = Math.max(64, Math.round(ph * (this.ss || 1)));
    if (this.canvas.width !== pw || this.canvas.height !== ph) {
      this.canvas.width = pw; this.canvas.height = ph;
    }
    if (!this.scene || this.scene.w !== sw || this.scene.h !== sh) this._resizeTargets(sw, sh);
  };

  /* ============================================================
     ÇİZİM
     ============================================================ */
  GL.render = function (v, R) {
    if (!this.ok) return false;
    try {
      const gl = this.gl;
      const W = this.canvas.width, H = this.canvas.height;
      const SW = (this.scene && this.scene.w) || W, SH = (this.scene && this.scene.h) || H;
      const aspect = SW / SH;
      const FOVK = (R && R.FOVK ? R.FOVK : 0.66) * (R.fovMul || 1) * (R.dynFov || 1);
      const fy = SW / (2 * FOVK);

      if (v.world !== this.worldRef) { this.worldRef = v.world; this.invalidate(); }
      this._updateChunks(v.px, v.py, 4);

      const eyeY = v.zc;
      const pitchAng = Math.atan2(v.pitch || 0, fy);
      const proj = perspective(mat4(), FOVK, aspect, 0.02, 260);
      const view = viewMatrix(mat4(), v.px, eyeY, v.py, v.pa, pitchAng, v.roll || 0);
      const VP = mul(mat4(), proj, view);
      const invVP = mat4();
      invert(invVP, VP);

      /* ---- 1) sahne: gökyüzü + dünya + sprite'lar ---- */
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.scene.fb);
      gl.viewport(0, 0, SW, SH);
      gl.enable(gl.DEPTH_TEST);
      gl.depthMask(false);
      gl.disable(gl.BLEND);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

      const sunY = Math.max(0.06, (v.sunEl === undefined ? 0.5 : v.sunEl));
      const sunDir = norm3(v.sunDir[0] * 0.9, sunY, v.sunDir[1] * 0.9);
      const fcol = [v.fogColor[0] / 255, v.fogColor[1] / 255, v.fogColor[2] / 255];

      /* gökyüzü */
      {
        const p = this.pSky;
        gl.useProgram(p.prog);
        gl.uniformMatrix4fv(p.u('uInvVP'), false, invVP);
        gl.uniform3fv(p.u('uCamPos'), [v.px, eyeY, v.py]);
        gl.uniform3fv(p.u('uSkyTop'), [v.skyTop[0] / 255, v.skyTop[1] / 255, v.skyTop[2] / 255]);
        gl.uniform3fv(p.u('uSkyHorizon'), [v.sky[0] / 255, v.sky[1] / 255, v.sky[2] / 255]);
        gl.uniform3fv(p.u('uSunDir'), sunDir);
        gl.uniform3fv(p.u('uSunCol'), [(v.sunCol[0] / 255) * 0.9, (v.sunCol[1] / 255) * 0.9, (v.sunCol[2] / 255) * 0.9]);
        gl.uniform1f(p.u('uStars'), v.stars || 0);
        gl.uniform1f(p.u('uClouds'), v.clouds || 0);
        gl.uniform1f(p.u('uTime'), v.time || 0);
        gl.uniform1f(p.u('uFogDens'), v.fogDens);
        const loc = p.a('aPos');
        gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.disableVertexAttribArray(loc);
      }
      gl.depthMask(true);

      /* dünya */
      {
        const p = this.pWorld;
        gl.useProgram(p.prog);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.texAlbedo);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.texNormal);
        gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.texSpec);
        gl.uniform1i(p.u('uAlbedo'), 0);
        gl.uniform1i(p.u('uNormal'), 1);
        gl.uniform1i(p.u('uSpec'), 2);
        gl.uniformMatrix4fv(p.u('uVP'), false, VP);
        gl.uniform1f(p.u('uCols'), this.atlasCols);
        gl.uniform2f(p.u('uCell'), 1 / this.atlasCols, 1 / this.atlasRows);
        gl.uniform3fv(p.u('uSunDir'), sunDir);
        gl.uniform3fv(p.u('uSunCol'), [(v.sunCol[0] / 255), (v.sunCol[1] / 255), (v.sunCol[2] / 255)]);
        gl.uniform1f(p.u('uSunAmt'), Math.max(0.05, (v.light || 0.7) * 0.85));
        gl.uniform3f(p.u('uAmbient'), 0.115, 0.125, 0.15);
        gl.uniform3f(p.u('uTorchCol'), 1.0, 0.84, 0.62);
        gl.uniform1f(p.u('uTorch'), v.torch || 0);
        gl.uniform3fv(p.u('uCamPos'), [v.px, eyeY, v.py]);
        gl.uniform3fv(p.u('uFogCol'), fcol);
        gl.uniform1f(p.u('uFogDens'), v.fogDens);
        gl.uniform1f(p.u('uAmb'), 1.0);

        const aPos = p.a('aPos'), aUV = p.a('aUV'), aSlot = p.a('aSlot'), aShade = p.a('aShade'), aFlags = p.a('aFlags');
        const stride = 10 * 4;
        gl.enableVertexAttribArray(aPos); gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, stride, 0);
        gl.enableVertexAttribArray(aUV); gl.vertexAttribPointer(aUV, 2, gl.FLOAT, false, stride, 12);
        gl.enableVertexAttribArray(aSlot); gl.vertexAttribPointer(aSlot, 2, gl.FLOAT, false, stride, 20);
        gl.enableVertexAttribArray(aShade); gl.vertexAttribPointer(aShade, 2, gl.FLOAT, false, stride, 28);
        gl.enableVertexAttribArray(aFlags); gl.vertexAttribPointer(aFlags, 1, gl.FLOAT, false, stride, 36);
        const camF = [Math.cos(v.pa), Math.sin(v.pa)];
        for (const key in this.chunks) {
          const ch = this.chunks[key];
          if (!ch.vbo || !ch.count) continue;
          if (ch.stamp !== this.worldStamp) continue;      /* henüz kurulmadı */
          const mx = ch.cx * CHUNK + CHUNK / 2, my = ch.cy * CHUNK + CHUNK / 2;
          const ddx = mx - v.px, ddy = my - v.py;
          if (ddx * ddx + ddy * ddy > 78 * 78) continue;    /* sisin ötesi */
          const dl = Math.sqrt(ddx * ddx + ddy * ddy) || 1;
          if ((ddx * camF[0] + ddy * camF[1]) / dl < -0.55 && dl > 40) continue;
          gl.bindBuffer(gl.ARRAY_BUFFER, ch.vbo);
          gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, stride, 0);
          gl.vertexAttribPointer(aUV, 2, gl.FLOAT, false, stride, 12);
          gl.vertexAttribPointer(aSlot, 2, gl.FLOAT, false, stride, 20);
          gl.vertexAttribPointer(aShade, 2, gl.FLOAT, false, stride, 28);
          gl.vertexAttribPointer(aFlags, 1, gl.FLOAT, false, stride, 36);
          gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ch.ibo);
          gl.drawElements(gl.TRIANGLES, ch.count, ch.big ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT, 0);
        }
      }

      /* sprite'lar */
      if (v.entities && v.entities.length) this._drawSprites(v, VP, sunY, fcol, R);

      /* ---- 2) post: parlak geçiş + bulanıklık ---- */
      const quality = (R && R.quality) || 'yuksek';
      const doBloom = quality !== 'performans';
      gl.disable(gl.DEPTH_TEST);
      gl.depthMask(false);
      gl.disable(gl.BLEND);
      if (doBloom) {
        const bw = this.brightA.w, bh = this.brightA.h;
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.brightA.fb);
        gl.viewport(0, 0, bw, bh);
        const pb = this.pBright;
        gl.useProgram(pb.prog);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.scene.tex);
        gl.uniform1i(pb.u('uTex'), 0);
        gl.uniform1f(pb.u('uThreshold'), 0.62);
        this._quad(pb);
        /* yatay + dikey bulanıklık */
        for (let pass = 0; pass < 2; pass++) {
          const src = pass === 0 ? this.brightA : this.brightB;
          const dst = pass === 0 ? this.brightB : this.brightA;
          gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fb);
          gl.viewport(0, 0, dst.w, dst.h);
          const pl = this.pBlur;
          gl.useProgram(pl.prog);
          gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src.tex);
          gl.uniform1i(pl.u('uTex'), 0);
          gl.uniform2f(pl.u('uDir'), pass === 0 ? 1.3 / dst.w : 0, pass === 0 ? 0 : 1.3 / dst.h);
          this._quad(pl);
        }
      }

      /* ---- 3) birleştirme (ekrana) ---- */
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, W, H);
      const pc = this.pComp;
      gl.useProgram(pc.prog);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.scene.tex);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, doBloom ? this.brightA.tex : this.scene.tex);
      gl.uniform1i(pc.u('uTex'), 0);
      gl.uniform1i(pc.u('uBloom'), 1);
      gl.uniform1f(pc.u('uExposure'), (v.exposure === undefined ? 1.05 : v.exposure) * 1.15);
      gl.uniform1f(pc.u('uBloomAmt'), doBloom ? clamp((v.bloom === undefined ? 0.3 : v.bloom) * 0.85, 0, 0.9) : 0);
      gl.uniform1f(pc.u('uCA'), quality === 'yuksek' ? (v.ca === undefined ? 0.5 : v.ca) * 0.5 : 0);
      gl.uniform1f(pc.u('uGrain'), quality === 'yuksek' ? 0.020 + (v.grain || 0) * 0.012 : 0.008);
      gl.uniform1f(pc.u('uTime'), v.time || 0);
      gl.uniform1f(pc.u('uVignette'), 0.34);
      gl.uniform2f(pc.u('uRes'), SW, SH);
      gl.uniform1f(pc.u('uSS'), this.ss || 1);
      this._quad(pc);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, null);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, null);

      /* ---- kendi kendini sınama (ilk kare): bozuk GPU çıktısını yakala ---- */
      if (this.selfCheck !== false && !this._checked) {
        this._checked = true;
        const err = gl.getError();
        let black = false;
        try {
          const px = new Uint8Array(4 * 16);
          gl.readPixels(Math.floor(SW * 0.35), Math.floor(SH * 0.35), 4, 4, gl.RGBA, gl.UNSIGNED_BYTE, px);
          let maxV = 0;
          for (let i = 0; i < px.length; i++) if (px[i] > maxV) maxV = px[i];
          black = maxV < 3;
        } catch (e) { black = false; }
        if (err !== gl.NO_ERROR || black) {
          throw new Error('GPU çıktısı doğrulanamadı (hata ' + err + (black ? ', siyah kare' : '') + ')');
        }
      }
      return true;
    } catch (e) {
      /* GPU hatası: CPU'ya düş */
      this.ok = false;
      this.status = 'CPU (çizim hatası: ' + (e && e.message ? e.message : e) + ')';
      if (MV.logMsg) MV.logMsg('[GL] ' + this.status);
      try { if (this.canvas) this.canvas.style.display = 'none'; } catch (e2) { }
      return false;
    }
  };

  GL._quad = function (p) {
    const gl = this.gl;
    const loc = p.a('aPos');
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.disableVertexAttribArray(loc);
  };

  /* ---------- sprite'lar (billboard, köşe başına genişletilmiş) ---------- */
  GL._drawSprites = function (v, VP, sunY, fcol, R) {
    const gl = this.gl;
    const rects = this.spriteRects;
    if (!rects) return;
    const list = v.entities;
    const MAXV = 8000;                                   // 8000 köşe = 2000 sprite
    const data = this._sprData || (this._sprData = new Float32Array(MAXV * 13));
    const idx = this._sprIdx || (this._sprIdx = (() => {
      const a = new Uint16Array(MAXV / 4 * 6 + 6);
      for (let i = 0; i < MAXV / 4; i++) {
        const b = i * 4, o = i * 6;
        a[o] = b; a[o + 1] = b + 1; a[o + 2] = b + 2;
        a[o + 3] = b + 2; a[o + 4] = b + 1; a[o + 5] = b + 3;
      }
      return a;
    })());
    const sw = this.texSprites.width || 1024;
    const corners = [[-0.5, 0], [0.5, 0], [-0.5, 1], [0.5, 1]];
    let n = 0, vcount = 0;
    for (let k = 0; k < list.length; k++) {
      const e = list[k];
      let r = rects[e.sprite];
      if (!r) continue;
      if (Array.isArray(r)) {
        const fn = r.length;
        let fi = e.frame;
        if (fi === undefined || fi === null) fi = Math.floor((e.anim || 0) * 6) % fn;
        fi = ((fi % fn) + fn) % fn;
        r = r[fi];
        if (!r) continue;
      }
      if (e.alpha !== undefined && e.alpha < 0.02) continue;
      if (vcount + 4 > MAXV) break;
      const tint = (e.tint === undefined ? 1 : e.tint) + (e.glow || 0) * 0.8;
      const alpha = e.alpha === undefined ? 1 : e.alpha;
      const yOff = e.yOff || 0;
      const w = e.w || 1, h = e.h || 1;
      const u0 = r.x / sw, v0 = (r.y + r.h) / sw, u1 = (r.x + r.w) / sw, v1 = r.y / sw;
      for (let c = 0; c < 4; c++) {
        const o = (vcount + c) * 13;
        data[o] = corners[c][0]; data[o + 1] = corners[c][1];
        data[o + 2] = e.x; data[o + 3] = yOff; data[o + 4] = e.y;
        data[o + 5] = w; data[o + 6] = h;
        data[o + 7] = u0; data[o + 8] = v0; data[o + 9] = u1; data[o + 10] = v1;
        data[o + 11] = tint; data[o + 12] = alpha;
      }
      n++; vcount += 4;
    }
    if (!n) return;
    const p = this.pSprite;
    gl.useProgram(p.prog);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.texSprites);
    gl.uniform1i(p.u('uAtlas'), 0);
    gl.uniformMatrix4fv(p.u('uVP'), false, VP);
    gl.uniform3fv(p.u('uCamPos'), [v.px, v.zc, v.py]);
    gl.uniform3fv(p.u('uFogCol'), fcol);
    gl.uniform1f(p.u('uFogDens'), v.fogDens);
    gl.uniform1f(p.u('uLight'), (v.light || 0.7));
    gl.uniform3f(p.u('uAmbient'), 0.30, 0.31, 0.34);
    gl.uniform3f(p.u('uTorchCol'), 1.0, 0.85, 0.62);
    gl.uniform1f(p.u('uTorch'), v.torch || 0);
    const stride = 13 * 4;
    const aPos = p.a('aPos'), aCenter = p.a('aCenter'), aSize = p.a('aSize'), aUV = p.a('aUV'), aTint = p.a('aTint');
    if (!this._spriteVBO) this._spriteVBO = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this._spriteVBO);
    gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, vcount * 13), gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(aPos); gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(aCenter); gl.vertexAttribPointer(aCenter, 3, gl.FLOAT, false, stride, 8);
    gl.enableVertexAttribArray(aSize); gl.vertexAttribPointer(aSize, 2, gl.FLOAT, false, stride, 20);
    gl.enableVertexAttribArray(aUV); gl.vertexAttribPointer(aUV, 4, gl.FLOAT, false, stride, 28);
    gl.enableVertexAttribArray(aTint); gl.vertexAttribPointer(aTint, 2, gl.FLOAT, false, stride, 44);
    if (!this._sprIBO) this._sprIBO = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this._sprIBO);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    gl.drawElements(gl.TRIANGLES, n * 6, gl.UNSIGNED_SHORT, 0);
    gl.disable(gl.BLEND);
  };

  /* ---------- 4x4 ters (standart kramer) ---------- */
  function invert(out, m) {
    const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3];
    const a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7];
    const a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11];
    const a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];
    const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10;
    const b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
    const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30;
    const b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
    let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    if (!det) return out;
    det = 1 / det;
    out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
    out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
    out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
    out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
    out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
    out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
    out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
    out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
    out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
    out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
    out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
    out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
    out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
    out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
    out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
    out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
    return out;
  }
  function norm3(x, y, z) {
    const l = Math.sqrt(x * x + y * y + z * z) || 1;
    return [x / l, y / l, z / l];
  }

  MV.GL = GL;
})(MV);
