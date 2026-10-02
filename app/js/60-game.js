/* ============================================================
   60-game.js — oyun çekirdeği: gün/gece döngüsü, geçitler, Kutu,
   rune taşları, üretim, savaş, kayıt ve görev akışı
   ============================================================ */
(function (MV) {
  'use strict';
  const { clamp, lerp, dist, angDiff, TAU, fmtTime, T } = MV;
  const Maze = MV.Maze, AI = MV.AI, A = MV.Audio;
  const K = Maze.K;

  const DAY_LEN = 240;        // gündüz süresi (saniye)
  const NIGHT_LEN = 120;      // gece süresi
  const PHASE_DAWN = 0.06;    // gündüzün ilk %6'sı şafak
  const PHASE_DUSK = 0.22;    // bitişteki alacakaranlık oranı
  const MAX_DAY = 7;          // bu günden sonra labirent "temizlenir"

  const ITEMS = {
    lif: { name: 'BİTKİ LİFİ', sprite: 'grassTuft', w: 0.42, h: 0.5, yOff: 0.18 },
    celik: { name: 'ÇELİK PARÇASI', sprite: 'rock', w: 0.42, h: 0.45, yOff: 0.16 },
    recine: { name: 'REÇİNE', sprite: 'egg', w: 0.36, h: 0.42, yOff: 0.14 },
    gida: { name: 'KONSERVE', sprite: 'food', w: 0.42, h: 0.5, yOff: 0.20 },
    pil: { name: 'PİL', sprite: 'vial', w: 0.34, h: 0.46, yOff: 0.16 },
    serum: { name: 'SERUM', sprite: 'vial', w: 0.36, h: 0.48, yOff: 0.18 },
    anahtar: { name: 'WICKED ANAHTARI', sprite: 'key', w: 0.44, h: 0.44, yOff: 0.22 }
  };

  const RECIPES = [
    { id: 'fener', name: 'FENER', cost: { celik: 1, recine: 1 }, desc: 'Karanlıkta görüş. Pille çalışır.' },
    { id: 'izleyici', name: 'İZLEYİCİ', cost: { celik: 2, pil: 1 }, desc: 'Konumunu ve yakındaki verileri gösterir.' },
    { id: 'mizrak', name: 'MIZRAK', cost: { lif: 2, celik: 2 }, desc: 'Grievers\'i uzakta tutar. Sersemletir.' },
    { id: 'halat', name: 'HALAT', cost: { lif: 4, recine: 1 }, desc: 'Kovan çukuruna inmek için şart.' },
    { id: 'serum', name: 'SERUM', cost: { recine: 2, pil: 1 }, desc: 'Zehri temizler, yaraları sarar.' },
    { id: 'gida', name: 'KONSERVE', cost: { recine: 1, lif: 1 }, desc: 'Açlığı giderir, biraz can verir.' }
  ];

  const OBJECTIVES = {
    explore: {
      text: 'KAYRAN’I KEŞFET',
      sub: 'Kutu terminalinde kuralları oku',
      hint: 'Kutu: Kayran’ın ortasındaki metal kutu. Yaklaş ve [E] ile oku.'
    },
    runes: {
      text: 'LABİRENTTEKİ VERİYİ TOPLA',
      sub: '8 rune taşı — hepsi π dizisinin basamağı',
      hint: 'Rune taşları sektörlerin duvarlarına kazınmış. Labirentin derinliklerinde.'
    },
    key: {
      text: 'KOVAN’DAN ANAHTARI AL',
      sub: 'Griever yuvası dış kuşakta. Halat gerekir',
      hint: 'İzleyici kovanın yönünü gösterir. Yanına halat almadan gitme.'
    },
    code: {
      text: 'ÇIKIŞ KAPAĞINI AÇ',
      sub: 'Dış kuşaktaki kapağa 8 haneli kodu gir',
      hint: 'Veriyi sırasıyla oku. Rakamlar tanıdık gelmiyor mu?'
    },
    escape: { text: 'KAÇ', sub: 'Kapağın altından geçtin — koş', hint: '' }
  };

  /* ============================================================
     BAŞARIMLAR — kayıt slotlarından bağımsız, profilde saklanır
     ============================================================ */
  const ACHIEVEMENTS = [
    { id: 'kutu', name: 'KUTU OKUNDU', desc: 'Kayran’ın ortasındaki Kutu terminalini açtın.', test: (g) => !!g.flags.boxRead },
    { id: 'ilk-veri', name: 'İLK VERİ', desc: 'İlk rune verisini okudun.', test: (g) => g.runesRead.length >= 1 },
    { id: 'sekiz-veri', name: 'SEKİZ BASAMAK', desc: 'Sekiz sektörün rune verisini topladın.', test: (g) => g.runesRead.length >= 8 },
    { id: 'ilk-gece', name: 'İLK GECE', desc: 'Kapıların kapandığı ilk geceyi atlattın.', test: (g) => g.day >= 2 },
    { id: 'uc-safak', name: 'ÜÇÜNCÜ ŞAFAK', desc: 'Hayatta kalıp 3. güne ulaştın.', test: (g) => g.day >= 3 },
    { id: 'yedi-gun', name: 'YEDİ GÜN', desc: '7. güne ulaştın — WICKED seni hâlâ izliyor.', test: (g) => g.day >= 7 },
    { id: 'ilk-kan', name: 'İLK KAN', desc: 'İlk Griever’ı devirdin.', test: (g) => g.meta.kills >= 1 },
    { id: 'avci', name: 'AVCI', desc: 'Beş Griever devirdin.', test: (g) => g.meta.kills >= 5 },
    { id: 'zanaat', name: 'ZANAATKÂR', desc: 'Kutu terminalinde ilk aracını ürettin.', test: (g) => (g.meta.crafted || 0) >= 1 },
    { id: 'tam-takim', name: 'TAM TAKIM', desc: 'Fener, izleyici, mızrak ve halat: dördünü de ürettin.',
      test: (g) => g.tools.fener > 0 && g.tools.izleyici > 0 && g.tools.mizrak > 0 && g.tools.halat > 0 },
    { id: 'kovan', name: 'KOVAN', desc: 'Griever kovanına indin.', test: (g) => !!g.flags.hiveDone },
    { id: 'kacis', name: 'KAÇIŞ', desc: 'π kodunu girdin ve Labirent’ten kaçtın.', test: (g) => !!g.won }
  ];

  const G = {
    running: false, paused: false, dead: false, won: false,
    world: null, tex: null, player: null, view: null,
    day: 1, phase: 'day', clock: DAY_LEN * 0.35,
    props: [], items: [], grievers: [], beetles: [], particles: [],
    keys: {}, mouse: { dx: 0, dy: 0, down: false },
    objective: 'explore', objectiveSub: OBJECTIVES.explore.sub,
    runesRead: [], resources: { lif: 0, celik: 0, recine: 0, gida: 0, pil: 0, serum: 0, anahtar: 0 },
    tools: { fener: 0, izleyici: 0, mizrak: 0, halat: 0 },
    tool: 0, torchCharge: 100, hasKey: false, hiveOpen: false, hatchCode: '', codeOk: false,
    msgQueue: [], lastSafe: { x: 0, y: 0 }, falling: 0, fear: 0, music: 0,
    lastHeart: 0, stepAcc: 0, meta: { runs: 1, kills: 0, deaths: 0, time: 0, sections: 0, crafted: 0 },
    /* başarımlar: profil düzeyinde, kayıtlardan bağımsız */
    achieved: {}, achT: 0,
    flags: {}, cinematic: null, seed: 1, saveT: 0, hourAnnounced: false,
    /* masaüstü ayarları */
    sensitivity: 1.0, invertY: false, shake: true, settings: null,
    /* oyun kolu */
    pad: null, padPrev: {}, padMove: { f: 0, s: 0 }, inputMode: 'klavye',
    shotPending: false, slot: 0, pauseOnBlur: true
  };
  MV.G = G;

  /* ============================================================
     KURULUM
     ============================================================ */
  G.init = function (canvas) {
    if (typeof document === 'undefined') return;
    this.canvas = canvas;
    this.tex = MV.texBuild();
    MV.Renderer.init(canvas);
    MV.Renderer.prepare(this.tex);

    /* masaüstü ayarları (varsa dosyadan, yoksa localStorage'dan) */
    this.settings = MV.Desktop.settings.read();
    MV.Desktop.apply(this.settings);
    this.loadAchievements();

    /* son durum: otomatik kayıt (slot 0) → yoksa yeni deney */
    const auto = MV.Desktop.save.read(0);
    if (auto) {
      try { this.applySave(JSON.parse(auto)); } catch (e) { this.newGame((Math.random() * 1e9) | 0); }
    } else {
      this.newGame((Math.random() * 1e9) | 0);
    }
    this.bindInput();
    this.bindDesktop();
    this.running = true;
    this.last = performance.now();
    requestAnimationFrame(this.loop.bind(this));
  };

  /* ---------- masaüstü kabuğu olayları ---------- */
  G.bindDesktop = function () {
    const self = this;
    MV.Desktop.onMenu(function (cmd) { self.handleMenuCommand(cmd); });
    MV.Desktop.onWindow(function (kind, arg) {
      if (kind === 'blur') {
        if (self.running && !self.dead && !self.won && !MV.UI.modalOpen() && self.pauseOnBlur) {
          MV.UI.togglePause();
        }
      } else if (kind === 'resize') {
        MV.Renderer.resize();
      } else if (kind === 'fullscreen') {
        self.settings = MV.Desktop.settings.write({ fullscreen: !!arg });
      }
    });
    MV.Desktop.onShotSaved(function (file) {
      self.shotPending = false;
      MV.UI.toast('EKRAN GÖRÜNTÜSÜ: ' + file);
      MV.logMsg('Ekran görüntüsü kaydedildi: ' + file);
    });
  };

  G.handleMenuCommand = function (cmd) {
    switch (cmd) {
      case 'new':
        MV.UI.confirmNew();
        break;
      case 'continue':
        this.loadFrom(0) ? MV.UI.toast('OTOMATİK KAYIT YÜKLENDİ') : MV.UI.toast('OTOMATİK KAYIT YOK');
        break;
      case 'save':
        MV.UI.openSaveSlots('save');
        break;
      case 'load':
        MV.UI.openSaveSlots('load');
        break;
      case 'pause':
        if (!MV.UI.modalOpen()) MV.UI.togglePause();
        else MV.UI.closeModal();
        break;
      case 'achievements':
        if (!MV.UI.modalOpen()) this.paused = true;
        MV.UI.openAchievements(MV.UI.modalOpen() ? 'back' : '');
        break;
      case 'quality': {
        const order = ['yuksek', 'orta', 'performans'];
        const cur = this.settings.quality || 'orta';
        const next = order[(order.indexOf(cur) + 1) % order.length];
        this.applySetting('quality', next);
        MV.UI.toast('GÖRÜNTÜ KALİTESİ: ' + MV.Desktop.QUALITY_LABEL[next]);
        break;
      }
      case 'fps':
        this.applySetting('fps', !this.settings.fps);
        break;
      case 'mute':
        this.applySetting('muted', !this.settings.muted);
        MV.UI.toast(this.settings.muted ? 'SES KAPALI' : 'SES AÇIK');
        break;
      case 'settings':
        MV.UI.openSettings();
        break;
      case 'controls':
        MV.UI.showControls(false);
        break;
      case 'save-and-quit':
        this.saveTo(0);
        MV.logMsg('Çıkıştan önce kaydedildi.');
        break;
      case 'screenshot':
        this.takeScreenshot();
        break;
    }
  };

  /* ayar değiştir → kaydet → uygula */
  G.applySetting = function (key, value) {
    this.settings = MV.Desktop.settings.write({ [key]: value });
    MV.Desktop.apply(this.settings);
    return this.settings;
  };

  /* ekran görüntüsü: HUD gizlenir, yakalanır, HUD geri gelir */
  G.takeScreenshot = function () {
    if (!MV.Desktop.isDesktop) { MV.UI.toast('EKRAN GÖRÜNTÜSÜ YALNIZCA MASAÜSTÜNDE (F12)'); return; }
    this.shotPending = true;
    MV.UI.hideOverlaysForShot();
    const self = this;
    setTimeout(function () {
      MV.Desktop.screenshot();
      MV.UI.showOverlaysAfterShot();
      self.shotPending = false;
    }, 120);
  };

  G.newGame = function (seed) {
    // not: başarımlar profil düzeyinde kalır, yeni deneyde sıfırlanmaz
    this.seed = seed >>> 0;
    this.day = 1; this.phase = 'day'; this.clock = DAY_LEN * 0.35;
    this.grievers = []; this.beetles = []; this.particles = [];
    this.runesRead = [];
    this.resources = { lif: 0, celik: 0, recine: 0, gida: 1, pil: 0, serum: 0, anahtar: 0 };
    this.tools = { fener: 0, izleyici: 0, mizrak: 0, halat: 0 };
    this.tool = 0; this.torchCharge = 100;
    this.hasKey = false; this.hiveOpen = false; this.hatchCode = ''; this.codeOk = false;
    this.flags = {}; this.meta = { runs: 1, kills: 0, deaths: 0, time: 0, sections: 0 };
    this.setObjective('explore');
    this.buildWorld(true);
    this.player.hp = 100; this.player.stam = 100; this.player.hunger = 100;
    MV.logMsg('KUTU AÇILDI — özne A7 Kayran’a bırakıldı.');
    this.queueMsg('A7 — DENEY BAŞLIYOR', 'Kayran’ı öğren. Geçitler alacakaranlıkta kapanır.');
    this.save();
  };

  G.buildWorld = function (fresh) {
    const w = Maze.genWorld(this.seed, this.day);
    if (!fresh) {
      for (let d = 2; d <= this.day; d++) Maze.shiftWorld(w, d, this.seed);
    }
    this.world = w;
    this.setupProps(w, fresh);
    this.player = {
      x: w.spawn.x, y: w.spawn.y, a: w.spawn.a, pitch: 0, zc: 0.55,
      hp: 100, maxHp: 100, stam: 100, maxStam: 100, hunger: 100, poison: 0, cold: 0,
      noise: 0, crouch: false, sprint: false, bobT: 0, bobX: 0, bobY: 0,
      walkSpeed: 3.05, runSpeed: 4.65, hurtFx: 0, fallV: 0,
      torchOn: false, kills: 0, steps: 0
    };
    this.known = new Uint8Array(w.W * w.H);
    this.knownProps = {};
    this.lastSafe = { x: w.spawn.x, y: w.spawn.y };
    this.view = { held: [], entities: [] };
    this.spawnRavens(w);
    this.markKnownAround(this.player.x, this.player.y, 7.5);
  };

  /* ---------- eşyalar / yaratıklar ---------- */
  G.setupProps = function (w, fresh) {
    const rng = MV.RNG((this.seed ^ 0x5151) >>> 0);
    const props = [], items = [];
    const add = (x, y, kind, opts) => {
      const p = Object.assign({ x: Math.round(x) + .5, y: Math.round(y) + .5, kind: kind }, opts || {});
      props.push(p); return p;
    };
    /* --- Kayran --- */
    add(w.boxAt.x, w.boxAt.y, 'box', { sprite: 'box', w: 3.0, h: 2.2, yOff: 0, prompt: 'KUTU — ÜRETİM TERMİNALİ', big: 1 });
    const gladeSpots = [[-5, -4], [5, -5], [-6, 5], [6, 6], [0, -7], [0, 7]];
    gladeSpots.forEach((s, i) => {
      const x = w.cx + s[0], y = w.cy + s[1];
      if (i < 3) add(x, y, 'hut', { sprite: 'hut', w: 2.6, h: 2.0, yOff: 0, prompt: 'BARAKA' });
      else if (i === 3) add(x, y, 'archive', { sprite: 'sign', w: 0.9, h: 1.2, yOff: 0.2, prompt: 'WICKED ARŞİV TABLETİ' });
      else add(x, y, 'lamp', { sprite: 'lamp', w: 1.1, h: 1.8, yOff: 0.1, glow: 0.35, prompt: 'FENER DİREĞİ', solidProp: true });
    });
    /* bahçe: yiyecek */
    for (let i = 0; i < 8; i++) {
      const a = rng.range(0, TAU), r = rng.range(3.5, K.R1 - 1.6);
      items.push({ x: w.cx + Math.cos(a) * r, y: w.cy + Math.sin(a) * r, type: 'gida', taken: false, inGlade: true });
    }
    /* --- Labirent: kaynaklar --- */
    const kinds = ['lif', 'lif', 'celik', 'celik', 'recine', 'gida', 'pil', 'serum'];
    for (let i = 0; i < 90; i++) {
      const a = rng.range(0, TAU), r = rng.range(K.R2B + 2, K.RAV0 - 3);
      const p = Maze.nearestOpen(w, w.cx + Math.cos(a) * r, w.cy + Math.sin(a) * r, 8, true);
      if (Maze.voidAt(w, p.x, p.y)) continue;
      items.push({ x: p.x, y: p.y, type: rng.pick(kinds), taken: false });
    }
    /* nadir: mızrak ucu, izleyici parçası gibi özel sandıklar */
    for (let i = 0; i < 6; i++) {
      const a = rng.range(0, TAU), r = rng.range(K.R2B + 8, K.RAV0 - 4);
      const p = Maze.nearestOpen(w, w.cx + Math.cos(a) * r, w.cy + Math.sin(a) * r, 8, true);
      if (Maze.voidAt(w, p.x, p.y)) continue;
      items.push({ x: p.x, y: p.y, type: 'celik', taken: false, cache: true, cnt: 3 });
    }
    /* --- Dış kuşak: kovan ve kapak --- */
    add(w.hive.x, w.hive.y, 'hive', { sprite: 'hive', w: 2.2, h: 2.2, yOff: 0, prompt: 'GRIEVER KOVANI', boss: 1 });
    add(w.hatch.x, w.hatch.y, 'hatch', { sprite: 'boxLid', w: 1.8, h: 0.8, yOff: 0.0, prompt: 'ÇIKIŞ KAPAĞI' });
    /* dış kuşakta kaynak */
    for (let i = 0; i < 14; i++) {
      const a = rng.range(0, TAU), r = rng.range(K.RAV1 + 1, K.ROUT - 2);
      const p = Maze.nearestOpen(w, w.cx + Math.cos(a) * r, w.cy + Math.sin(a) * r, 6, true);
      items.push({ x: p.x, y: p.y, type: rng.chance(0.2) ? 'serum' : rng.pick(kinds), taken: false });
    }
    /* --- kovan içi anahtar --- */
    const keyPos = Maze.nearestOpen(w, w.hive.x + 4, w.hive.y, 6, true);
    items.push({ x: keyPos.x, y: keyPos.y, type: 'anahtar', taken: false, quest: true });

    this.props = props;
    this.items = items;
    if (fresh) this.takenFlags = new Uint8Array(items.length);
    /* kayıttan gelen alınmış eşyalar */
    if (this.pendingTaken) {
      this.pendingTaken.forEach(i => { if (items[i]) items[i].taken = true; });
      this.pendingTaken = null;
    }
  };

  G.spawnRavens = function (w) {
    this.grievers = []; this.beetles = [];
    const rng = MV.RNG((this.seed ^ 0x7A7A) >>> 0);
    const gCount = 5 + this.day;
    for (let i = 0; i < gCount; i++) {
      const a = rng.range(0, TAU), r = rng.range(K.R2B + 4, K.RAV0 - 4);
      const p = Maze.nearestOpen(w, w.cx + Math.cos(a) * r, w.cy + Math.sin(a) * r, 10, true);
      this.grievers.push(AI.newGriever(p.x, p.y, { elite: rng.chance(0.18) }));
    }
    for (let i = 0; i < 6; i++) {
      const a = rng.range(0, TAU), r = rng.range(K.R2B + 6, K.RAV0 - 6);
      const p = Maze.nearestOpen(w, w.cx + Math.cos(a) * r, w.cy + Math.sin(a) * r, 10, true);
      this.beetles.push(AI.newBeetle(p.x, p.y));
    }
    // kovan muhafızı
    const hp = Maze.nearestOpen(w, w.hive.x, w.hive.y - 3, 8, true);
    this.guardian = AI.newGriever(hp.x, hp.y, { elite: true, speed: 3.1, hp: 260, sense: 17 });
    this.grievers.push(this.guardian);
  };

  /* ============================================================
     GİRDİ
     ============================================================ */
  G.bindInput = function () {
    const self = this;
    window.addEventListener('keydown', e => {
      if (e.repeat) return;
      self.keys[e.code] = true;
      self.onKey(e);
    });
    window.addEventListener('keyup', e => { self.keys[e.code] = false; });
    const cv = this.canvas;
    const isLocked = () => document.pointerLockElement === cv;

    /* --- fare: kilitle bakış, kilit yoksa sürükle-bakış --- */
    cv.addEventListener('mousedown', e => {
      A.ensure(); A.resume();
      self.mouse.down = true;
      self.mouse.moved = 0;
      if (!MV.UI.modalOpen()) {
        if (!isLocked()) { try { cv.requestPointerLock(); } catch (err) { } }
        else if (e.button === 0) self.onAttack();
      }
      e.preventDefault();
    });
    window.addEventListener('mouseup', e => {
      // kilit yokken: sürükleme yapılmadıysa tıklama say → saldırı / etkileşim
      if (!isLocked() && self.mouse.down && !MV.UI.modalOpen()) {
        if (self.mouse.moved < 6) {
          if (e.button === 2) self.interact();
          else self.onAttack();
        }
      }
      self.mouse.down = false;
    });
    cv.addEventListener('contextmenu', e => e.preventDefault());
    document.addEventListener('mousemove', e => {
      const dx = e.movementX || 0, dy = e.movementY || 0;
      if (isLocked() || self.mouse.down) {
        self.mouse.dx += dx; self.mouse.dy += dy;
        self.mouse.moved += Math.abs(dx) + Math.abs(dy);
      }
    });
    document.addEventListener('pointerlockchange', () => {
      self.pointerLocked = isLocked();
      if (self.pointerLocked === false && self.mouse.down) { /* kilit reddedildi: sürükle modu devrede */ }
      MV.UI.setPointerLockUI && MV.UI.setPointerLockUI(self.pointerLocked);
    });

    /* --- dokunmatik: sürükle-bak, sağ yarıya dokun = saldırı, sol = etkileşim --- */
    let touchId = null, tx0 = 0, ty0 = 0, tmove = 0, tSide = 0;
    cv.addEventListener('touchstart', e => {
      A.ensure(); A.resume();
      const t = e.changedTouches[0];
      touchId = t.identifier; tx0 = t.clientX; ty0 = t.clientY; tmove = 0;
      tSide = (t.clientX > window.innerWidth * 0.5) ? 1 : 0;
      e.preventDefault();
    }, { passive: false });
    cv.addEventListener('touchmove', e => {
      for (const t of e.changedTouches) {
        if (t.identifier !== touchId) continue;
        const dx = t.clientX - tx0, dy = t.clientY - ty0;
        tx0 = t.clientX; ty0 = t.clientY;
        tmove += Math.abs(dx) + Math.abs(dy);
        self.mouse.dx += dx * 1.6; self.mouse.dy += dy * 1.6;
      }
      e.preventDefault();
    }, { passive: false });
    cv.addEventListener('touchend', e => {
      for (const t of e.changedTouches) {
        if (t.identifier !== touchId) continue;
        if (tmove < 14) {
          if (tSide) self.onAttack(); else self.interact();
        }
        touchId = null;
      }
      e.preventDefault();
    }, { passive: false });

    window.addEventListener('blur', () => { self.keys = {}; self.mouse.down = false; });
    /* oyun kolu bağlanınca haber ver */
    window.addEventListener('gamepadconnected', (e) => {
      self.inputMode = 'kol';
      if (MV.UI && MV.UI.toast) MV.UI.toast('KOL BAĞLANDI: ' + (e.gamepad && e.gamepad.id ? String(e.gamepad.id).slice(0, 28) : 'kol'));
    });
    window.addEventListener('gamepaddisconnected', () => {
      self.pad = null; self.padMove = { f: 0, s: 0 };
      if (MV.UI && MV.UI.toast) MV.UI.toast('KOL AYRILDI — KLAVYE/FARE');
    });
    /* fare kullanılınca girdi kipini geri al */
    document.addEventListener('mousemove', (e) => {
      if (Math.abs(e.movementX || 0) + Math.abs(e.movementY || 0) > 4) self.inputMode = 'klavye';
    });
  };

  G.onKey = function (e) {
    A.ensure(); A.resume();
    if (MV.UI.modalOpen()) { MV.UI.handleKey(e); return; }
    switch (e.code) {
      case 'KeyE': this.interact(); break;
      case 'KeyF': this.toggleTorch(); break;
      case 'KeyC': case 'ControlLeft': this.player.crouch = !this.player.crouch; break;
      case 'Digit1': case 'Digit2': case 'Digit3': case 'Digit4':
        this.tool = parseInt(e.code.slice(5), 10) - 1; A.ui(); MV.UI.syncSlots(); break;
      case 'KeyM': MV.UI.openMap(); break;
      case 'Tab': e.preventDefault(); MV.UI.openJournal(); break;
      case 'Escape': MV.UI.togglePause(); break;
      case 'KeyQ': this.useTool(); break;
    }
  };

  /* ============================================================
     DÖNGÜ
     ============================================================ */
  G.loop = function (now) {
    if (!this.running) return;
    let dt = (now - this.last) / 1000;
    this.last = now;
    dt = Math.min(dt, 0.05);
    if (!this.paused && !MV.UI.modalOpen()) {
      this.update(dt);
    } else {
      this.updateIdle(dt);
    }
    this.render(dt);
    MV.UI.tick(this, dt);
    requestAnimationFrame(this.loop.bind(this));
  };

  G.updateIdle = function (dt) {
    // menüdeyken dünya durur ama ses/animasyon nefes alır
    if (A.setGriever) A.setGriever(this.nearestGrieverProx ? this.nearestGrieverProx : 0);
  };

  G.update = function (dt) {
    const P = this.player, w = this.world;
    this.meta.time += dt;
    this.achT = (this.achT || 0) + dt;
    if (this.achT > 0.75) { this.achT = 0; this.checkAchievements(); }
    this.pollGamepad(dt);
    /* kaçış sinematiği: kapak açılır, ışık yükselir, rapor gelir */
    if (this.cinematic) {
      this.cinematic.t += dt;
      if (this.cinematic.kind === 'escape' && this.cinematic.t > 3.2) {
        this.cinematic = null;
        this.win();
        return;
      }
      this.updateClock(dt);
      return;
    }
    this.updateClock(dt);
    this.updateLook(dt);
    this.updateMove(dt);
    this.updateVitals(dt);
    this.updateItemsPickup(dt);
    this.updateProps(dt);
    this.updateFalling(dt);

    /* --- yaratıklar --- */
    const st = {
      world: w, player: P, grievers: this.grievers, beetles: this.beetles,
      gatesOpen: this.gatesOpen(), night: this.phase === 'night',
      onEvent: this.onEntityEvent.bind(this)
    };
    AI.update(st, dt);

    /* --- ses + kamera sarsıntısı --- */
    let prox = 0;
    for (const g of this.grievers) {
      if (g.dead) continue;
      const d = dist(g.x, g.y, P.x, P.y);
      prox = Math.max(prox, clamp(1 - d / 26, 0, 1));
    }
    A.setGriever(prox * (this.phase === 'night' ? 1 : 0.6));
    this.nearestGrieverProx = prox;
    /* yakın tehdit varken kamera titrer (ayarlardan kapatılabilir) */
    const shakeTarget = this.shake ? prox * prox * 0.012 : 0;
    this.shakeAmt = lerp(this.shakeAmt || 0, shakeTarget, dt * 3);
    this.fear = lerp(this.fear, clamp(prox * 1.2 + (this.phase === 'night' ? 0.35 : 0), 0, 1), dt * 0.5);
    if (this.fear > 0.55 && this.meta.time - this.lastHeart > (1.15 - this.fear * 0.45)) {
      this.lastHeart = this.meta.time;
      A.heartbeat(this.fear);
    }

    this.markKnownAround(P.x, P.y, MV.UI.trackerOn() ? 12 : 7.5);
    this.autoSave(dt);
  };

  /* ---------- saat / faz ---------- */
  G.updateClock = function (dt) {
    const P = this.player;
    if (this.phase === 'night') {
      this.clock -= dt;
      if (this.clock <= 0) this.startDay();
    } else {
      this.clock -= dt;
      const frac = this.clock / DAY_LEN;
      const wasDusk = this.phase === 'dusk';
      if (frac <= PHASE_DUSK) {
        if (!wasDusk) {
          this.phase = 'dusk';
          this.queueMsg('ALACAKARANLIK', 'Geçitler kapanmak üzere. Ya Kayran’da ol ya da yalnız kal.');
          A.setPhase('night');
        }
        if (frac <= PHASE_DUSK * 0.25) this.closeGates();
      }
      if (this.clock <= 0) this.startNight();
    }
  };
  G.gatesOpen = function () { return this.phase !== 'night'; };
  G.closeGates = function () {
    if (this.flags.gatesClosed) return;
    this.flags.gatesClosed = true;
    A.gateClose();
    const inGlade = Maze.rad(this.world, this.player.x, this.player.y) < K.R1 - 1;
    MV.UI.subtitle(inGlade
      ? 'Kapılar kapandı. Kayran güvenli — ama gözler karanlıkta.'
      : 'KAPILAR KAPANDI. Dışarıdasın. Sabaha kadar hayatta kal.');
    this.queueMsg('GEÇİTLER KAPALI', inGlade ? 'Kayran güvende.' : 'DIŞARIDASIN — GRIEVERS AVCIDA');
  };
  G.startNight = function () {
    this.phase = 'night';
    this.clock = NIGHT_LEN;
    this.flags.gatesClosed = true;
    A.setPhase('night');
    MV.logMsg('GECE ' + this.day + ' — bölümler kayıyor.');
  };
  G.startDay = function () {
    this.day++;
    this.phase = 'day';
    this.clock = DAY_LEN;
    this.flags.gatesClosed = false;
    A.gateOpen(); A.setPhase('day');
    const P = this.player;
    const inGlade = Maze.rad(this.world, P.x, P.y) < K.R1 + 2;
    if (this.day > MAX_DAY) { this.purge(); return; }
    /* LABİRENTİ KAYDIR */
    Maze.shiftWorld(this.world, this.day, this.seed);
    for (let d = this.day; d <= this.day; d++) { /* tek kaydırma yeterli */ }
    const p = Maze.nearestOpen(this.world, P.x, P.y, 20, true);
    P.x = p.x; P.y = p.y;
    this.spawnRavens(this.world);
    if (inGlade) {
      this.resources.gida += 1;
      this.resources.celik += 1;
      this.queueMsg('GÜN ' + this.day + ' — KUTU YÜKSELDİ', 'Erzak bırakıldı: konserve + çelik.');
      A.boxRise();
    } else {
      this.queueMsg('GÜN ' + this.day, 'Geceyi dışarıda geçirdin. Hayatta kaldın.');
    }
    MV.UI.subtitle('Labirentin duvarları yeniden dizildi. Eski yollar artık yok.');
    MV.logMsg('GÜN ' + this.day + ' — duvarlar kaydırıldı.');
    this.save();
  };
  G.purge = function () {
    this.queueMsg('PROTOKOL: TEMİZLİK', 'Deney sonlandı. Labirent seni içine alıyor.');
    this.startDeath('temizlik', 'WICKED deneyi kapattı. Labirent sustu.');
  };

  /* ---------- başarımlar ---------- */
  G.loadAchievements = function () {
    const list = MV.Desktop.achievements.list();
    this.achieved = (list && typeof list === 'object') ? list : {};
    return this.achieved;
  };
  G.unlockAchievement = function (id) {
    const def = ACHIEVEMENTS.filter(a => a.id === id)[0];
    if (!def || this.achieved[id]) return false;
    this.achieved[id] = Date.now();
    MV.Desktop.achievements.write(JSON.stringify(this.achieved));
    MV.logMsg('başarım açıldı: ' + def.name);
    if (MV.UI) {
      if (MV.UI.achievement) MV.UI.achievement(def);
      else if (MV.UI.toast) MV.UI.toast('BAŞARIM: ' + def.name);
    }
    return true;
  };
  G.checkAchievements = function () {
    for (const a of ACHIEVEMENTS) {
      if (this.achieved[a.id]) continue;
      let ok = false;
      try { ok = !!a.test(this); } catch (e) { ok = false; }
      if (ok) this.unlockAchievement(a.id);
    }
    return this.achievementCount();
  };
  G.achievementCount = function () { return Object.keys(this.achieved).length; };
  G.achievementTotal = function () { return ACHIEVEMENTS.length; };
  G.achievementList = function () {
    return ACHIEVEMENTS.map(a => ({ id: a.id, name: a.name, desc: a.desc, at: this.achieved[a.id] || 0 }));
  };

  /* ---------- oyun kolu (Xbox/DualSense/8BitDo…) ---------- */
  G.pollGamepad = function (dt) {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return;
    let pad = null;
    const pads = navigator.getGamepads();
    for (let i = 0; i < pads.length; i++) { if (pads[i] && pads[i].connected) { pad = pads[i]; break; } }
    this.pad = pad;
    if (!pad) { this.padMove.f = 0; this.padMove.s = 0; return; }
    const dz = 0.22;
    const ax = (i) => { const v = pad.axes[i] || 0; return Math.abs(v) < dz ? 0 : (Math.abs(v) - dz) / (1 - dz) * Math.sign(v); };
    const b = (i) => !!(pad.buttons[i] && pad.buttons[i].pressed);
    const pressed = (i) => b(i) && !this.padPrev[i];
    this.padPrev = this.padPrev || {};
    /* hareket: sol çubuk (y yukarı = -1) */
    this.padMove.f = -ax(1);
    this.padMove.s = ax(0);
    /* bakış: sağ çubuk */
    const sens = (this.sensitivity || 1) * (this.invertY ? -1 : 1);
    const lookX = ax(2), lookY = ax(3);
    if (lookX || lookY) {
      this.player.a += lookX * 2.3 * sens * dt;
      this.player.pitch = MV.clamp(this.player.pitch - lookY * 150 * sens * dt, -this.H() * 0.28, this.H() * 0.28);
      this.inputMode = 'kol';
    }
    /* düğmeler (kenar tetiklemeli) */
    if (pressed(0)) this.interact();                 // A: etkileşim
    if (pressed(1)) this.toggleTorch();              // B: fener
    if (pressed(2)) this.onAttack();                 // X: mızrak
    if (pressed(3)) this.useTool();                  // Y: araç kullan
    if (pressed(4)) { this.cycleTool(-1); }          // LB
    if (pressed(5)) { this.cycleTool(1); }           // RB
    if (pressed(6)) this.player.crouch = !this.player.crouch;   // LT: eğil
    if (pressed(7) || (pad.buttons[7] && pad.buttons[7].value > 0.6 && !this.padPrev.rt)) {
      this.onAttack(); this.padPrev.rt = true;       // RT: saldırı
      setTimeout(() => { this.padPrev.rt = false; }, 220);
    }
    if (pressed(9)) { if (!MV.UI.modalOpen()) MV.UI.togglePause(); else MV.UI.closeModal(); }  // Start
    if (pressed(8)) {                                                                       // Back: harita
      if (MV.UI.mapOpen) { MV.UI.mapOpen = false; MV.UI.closeModal(); }
      else { this.paused = false; MV.UI.openMap(); }
    }
    /* düğme durumlarını sakla */
    for (let i = 0; i < pad.buttons.length; i++) this.padPrev[i] = b(i);
    /* koşu: sol çubuğu sonuna kadar itmek */
    const sprint = Math.hypot(ax(0), ax(1)) > 0.85;
    this.padSprint = sprint;
  };

  G.cycleTool = function (dir) {
    this.tool = ((this.tool + dir) % 4 + 4) % 4;
    A.ui(); MV.UI.syncSlots();
  };

  /* ---------- bakış ---------- */
  G.updateLook = function (dt) {
    const P = this.player;
    const sens = 0.0022 * (this.sensitivity || 1);
    const inv = this.invertY ? -1 : 1;
    if (this.mouse.dx || this.mouse.dy) {
      P.a += this.mouse.dx * sens;
      P.pitch = clamp(P.pitch - this.mouse.dy * sens * 30 * inv, -this.H() * 0.28, this.H() * 0.28);
      this.mouse.dx = 0; this.mouse.dy = 0;
    }
    if (this.keys.ArrowLeft) P.a -= 1.9 * dt;
    if (this.keys.ArrowRight) P.a += 1.9 * dt;
    P.a = (P.a + TAU) % TAU;
  };
  G.H = function () { return MV.Renderer.H; };

  /* ---------- hareket ---------- */
  G.updateMove = function (dt) {
    const P = this.player, w = this.world;
    let fwd = 0, strafe = 0;
    if (this.keys.KeyW) fwd += 1;
    if (this.keys.KeyS) fwd -= 1;
    if (this.keys.KeyA) strafe -= 1;
    if (this.keys.KeyD) strafe += 1;
    /* kol girdisi */
    const pm = this.padMove || { f: 0, s: 0 };
    if (pm.f || pm.s) { fwd += pm.f; strafe += pm.s; this.inputMode = 'kol'; }
    const sprintKey = this.keys.ShiftLeft || this.keys.ShiftRight || this.padSprint;
    const wantSprint = sprintKey && fwd > 0.1 && P.stam > 4 && !P.crouch;
    P.sprint = wantSprint;
    const speed = (P.crouch ? 1.5 : (P.sprint ? P.runSpeed : P.walkSpeed)) * (this.phase === 'night' && !this.insideGlade() ? 0.95 : 1);
    const len = Math.hypot(fwd, strafe) || 1;
    const mx = (fwd * Math.cos(P.a) - strafe * Math.sin(P.a)) / len;
    const my = (fwd * Math.sin(P.a) + strafe * Math.cos(P.a)) / len;
    const gatesOpen = this.gatesOpen();
    const nx = P.x + mx * speed * dt, ny = P.y + my * speed * dt;
    const r = 0.28;
    const canX = !this.blocked(nx + Math.sign(mx) * r, P.y, r, gatesOpen);
    const canY = !this.blocked(P.x, ny + Math.sign(my) * r, r, gatesOpen);
    if (fwd || strafe) {
      if (canX) P.x = nx;
      if (canY) P.y = ny;
      P.bobT += dt * (P.sprint ? 12 : (P.crouch ? 6 : 9));
      P.steps += dt * (P.sprint ? 3.2 : (P.crouch ? 1.1 : 2.0));
      P.noise = Math.min(1, P.noise + dt * (P.sprint ? 1.7 : (P.crouch ? 0.25 : 0.85)));
      /* ayak sesi */
      this.stepAcc += dt * (P.sprint ? 2.6 : (P.crouch ? 1.0 : 1.75));
      if (this.stepAcc >= 1) {
        this.stepAcc = 0;
        const fl = Maze.floorAt(w, P.x, P.y);
        A.step(fl === T.GRASS ? 'grass' : (fl === T.GRATE ? 'metal' : 'stone'));
        if (fl === T.GRATE) P.noise = Math.min(1, P.noise + 0.25);
      }
    } else {
      P.noise = Math.max(0, P.noise - dt * 1.1);
      P.bobT += dt * 1.6;
    }
    P.stam = clamp(P.stam + dt * (P.sprint ? -14 : (P.crouch || !(fwd || strafe) ? 12 : 4)), 0, P.maxStam);
    P.bobX = Math.sin(P.bobT) * (P.sprint ? 1.35 : 1) * (fwd || strafe ? 1 : 0.25);
    P.bobY = Math.abs(Math.cos(P.bobT)) * (P.sprint ? 1.1 : 0.7) * (fwd || strafe ? 1 : 0.2);
    /* güvenli konum */
    if (!Maze.voidAt(w, P.x, P.y) && !this.blocked(P.x, P.y, 0.3, gatesOpen)) {
      this.lastSafe.x = P.x; this.lastSafe.y = P.y;
    }
  };
  G.blocked = function (x, y, r, gatesOpen) {
    const w = this.world;
    for (const o of [[-r, -r], [r, -r], [-r, r], [r, r], [0, 0]]) {
      if (Maze.solidAt(w, x + o[0], y + o[1], gatesOpen)) return true;
    }
    return false;
  };
  G.insideGlade = function () {
    return Maze.rad(this.world, this.player.x, this.player.y) < K.R1;
  };

  /* ---------- can / durum ---------- */
  G.updateVitals = function (dt) {
    const P = this.player;
    P.hurtFx = Math.max(0, P.hurtFx - dt * 1.6);
    /* açlık */
    P.hunger = clamp(P.hunger - dt * 0.16, 0, 100);
    if (P.hunger <= 0) this.damage(dt * 1.1, 'açlık');
    /* zehir */
    if (P.poison > 0) {
      P.poison = Math.max(0, P.poison - dt * 1.6);
      this.damage(dt * 1.5, 'zehir');
    }
    /* gece dışarıda üşüme */
    const outside = !this.insideGlade();
    if (this.phase === 'night' && outside) {
      P.cold = clamp(P.cold + dt * (P.torchOn ? 0.14 : 0.32), 0, 1);
      if (P.cold > 0.85) this.damage(dt * 2.2, 'soğuk');
    } else {
      P.cold = clamp(P.cold - dt * 0.5, 0, 1);
    }
    /* uçurum */
    if (Maze.voidAt(this.world, P.x, P.y)) this.beginFall();
  };
  G.damage = function (v, cause) {
    const P = this.player;
    if (this.dead || this.cinematic) return;
    P.hp -= v;
    if (v > 1) P.hurtFx = Math.min(1, P.hurtFx + v / 40);
    if (v > 3) MV.UI.damage(); 
    if (P.hp <= 0) this.startDeath(cause);
  };
  G.beginFall = function () {
    if (this.falling > 0 || this.dead) return;
    this.falling = 1.4;
    A.fall();
    MV.UI.subtitle('Boşluğa düştün. WICKED izliyor…');
  };
  G.updateFalling = function (dt) {
    if (this.falling <= 0) return;
    this.falling += dt;
    if (this.falling > 1.5) {
      this.falling = 0;
      // WICKED müdahalesi: son güvenli noktaya bırakır (ağır bedel)
      this.player.x = this.lastSafe.x; this.player.y = this.lastSafe.y;
      this.player.hp -= 34;
      this.player.cold = 1;
      const keys = Object.keys(this.resources).filter(k => this.resources[k] > 0);
      if (keys.length) {
        const k = keys[(Math.random() * keys.length) | 0];
        this.resources[k] = Math.max(0, this.resources[k] - 1);
        MV.UI.toast('KAYIP: ' + (ITEMS[k] ? ITEMS[k].name : k));
      }
      MV.logMsg('WICKED müdahalesi: uçurumdan çıkarıldın (hasar 34).');
      if (this.player.hp <= 0) this.startDeath('uçurum');
    }
  };

  /* ---------- eşya toplama ---------- */
  G.updateItemsPickup = function (dt) {
    const P = this.player;
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      if (it.taken) continue;
      if (dist(it.x, it.y, P.x, P.y) < 0.75) {
        it.taken = true;
        this.knownProps['i' + i] = 1;
        this.collect(it, i);
      }
    }
  };
  G.collect = function (it, idx) {
    const def = ITEMS[it.type];
    A.pickup();
    if (it.type === 'anahtar') {
      this.hasKey = true; this.resources.anahtar = 1;
      MV.UI.toast('WICKED ANAHTARI ALINDI');
      MV.UI.subtitle('Anahtar elinde. Kapak artık açılabilir — kodu bilmen gerek.');
      this.setObjective('code');
      return;
    }
    const n = it.cnt || 1;
    this.resources[it.type] = (this.resources[it.type] || 0) + n;
    MV.UI.toast('+' + n + ' ' + def.name);
  };

  /* ---------- eşyalar (prop) ---------- */
  G.updateProps = function (dt) {
    const P = this.player;
    this.nearProp = null;
    let best = 2.6;
    for (const p of this.props) {
      const d = dist(p.x, p.y, P.x, P.y);
      const key = 'p' + this.props.indexOf(p);
      if (d < 12) this.knownProps[key] = 1;
      if (p.kind === 'hatch' && (d < 22 || this.flags.hatchSeen)) this.knownProps['hatch'] = 1;
      if (p.kind === 'hive' && d < 22) this.knownProps['hive'] = 1;
      if (d > best) continue;
      const ang = Math.atan2(p.y - P.y, p.x - P.x);
      if (Math.abs(angDiff(ang, P.a)) > 1.0) continue;
      best = d; this.nearProp = p;
    }
    MV.UI.setPrompt(this.nearProp ? this.nearProp.prompt : null);
  };

  /* ---------- etkileşim ---------- */
  G.interact = function () {
    const p = this.nearProp;
    if (!p) { MV.UI.toast('BURADA BİR ŞEY YOK'); A.deny(); return; }
    if (p.kind === 'box') {
      this.flags.boxRead = true;
      if (this.objective === 'explore') this.setObjective('runes');
      this.checkAchievements();
      MV.UI.openCraft();
      return;
    }
    if (p.kind === 'archive') {
      MV.UI.openArchive();
      if (this.objective === 'explore') this.setObjective('runes');
      return;
    }
    if (p.kind === 'hut') { MV.UI.openHut(); return; }
    if (p.kind === 'lamp') { MV.UI.subtitle('Direk sallanıyor: "WICKED, gece için ışık bırakmıyor."'); return; }
    if (p.kind === 'hive') { this.hiveInteract(); return; }
    if (p.kind === 'hatch') { MV.UI.openKeypad(); return; }
    /* rune taşları */
    const rune = this.runeNear(p);
    if (rune) return;
  };

  G.runeNear = function () {
    const P = this.player, w = this.world;
    const fx = P.x + Math.cos(P.a) * 0.9, fy = P.y + Math.sin(P.a) * 0.9;
    const cx = Math.floor(fx), cy = Math.floor(fy);
    for (const rn of w.runes) {
      if (Math.abs(rn.x - cx) <= 1 && Math.abs(rn.y - cy) <= 1 && dist(P.x, P.y, rn.x + .5, rn.y + .5) < 2.1) return rn;
    }
    return null;
  };
  G.tryReadRune = function () {
    const rn = this.runeNear();
    if (!rn) { MV.UI.toast('BURADA VERİ YOK'); A.deny(); return false; }
    if (this.runesRead.indexOf(rn.idx) >= 0) { MV.UI.toast('BU VERİ ZATEN KAYITLI'); return false; }
    this.runesRead.push(rn.idx);
    A.read();
    if (this.objective === 'explore') this.setObjective('runes');
    MV.UI.runeRead(rn);
    if (this.runesRead.length >= 8) {
      this.setObjective('key');
      MV.UI.subtitle('8/8 — dizi tamam: 3 1 4 1 5 9 2 6. Bu sayı tanıdık. WICKED’in kodu kendini ele veriyor.');
      this.queueMsg('VERİ TAMAMLANDI', 'Kodu çıkış kapağına gir. Anahtar kovanda.');
    } else {
      MV.UI.subtitle('Veri kaydedildi: ' + rn.digit + '  (sıra ' + (rn.idx + 1) + ') — ' + this.runesRead.length + '/8');
    }
    MV.logMsg('RUNE okundu: ' + rn.digit + ' (sıra ' + (rn.idx + 1) + ') ' + this.runesRead.length + '/8');
    this.save();
    return true;
  };

  /* ---------- kovan ---------- */
  G.hiveInteract = function () {
    if (this.flags.hiveDone) { MV.UI.subtitle('Kovan sessiz. İçindeki boş.'); return; }
    if (this.tools.halat <= 0) {
      MV.UI.subtitle('Aşağı inmek için halat gerek. Kutu terminalinde üret (4 lif + 1 reçine).');
      A.deny(); return;
    }
    MV.UI.openHive();
  };
  G.descendHive = function () {
    this.flags.hiveDone = true;
    this.resources.lif = Math.max(0, this.resources.lif - 0);
    this.tools.halat--;
    A.unlock();
    MV.UI.subtitle('Halatı kancaya geçirdin. Kovanın içi sıcak ve nefes alıyor gibi…');
    const w = this.world;
    const P = this.player;
    const target = Maze.nearestOpen(w, w.hive.x + 5, w.hive.y + 4, 10, true);
    P.x = target.x; P.y = target.y;
    // kovan ödülleri
    this.resources.serum += 2; this.resources.recine += 3; this.resources.celik += 2;
    MV.UI.toast('KOVAN YAĞMALANDI: +2 SERUM +3 REÇİNE +2 ÇELİK');
    if (this.guardian && !this.guardian.dead) {
      this.guardian.aggro = true;
      MV.UI.subtitle('Bir şey uyandı. Muhafız seni gördü.');
      A.grieverRoar(4);
    }
    MV.UI.closeModal();
  };

  /* ---------- araçlar ---------- */
  G.toggleTorch = function () {
    const P = this.player;
    if (this.tools.fener <= 0) { MV.UI.toast('FENER YOK — ÜRET'); A.deny(); return; }
    if (this.torchCharge <= 0) { MV.UI.toast('PİL BİTTİ'); A.deny(); return; }
    P.torchOn = !P.torchOn;
    A.ui();
    MV.UI.syncSlots();
  };
  G.useTool = function () {
    const P = this.player;
    if (this.tool === 0) return this.toggleTorch();
    if (this.tool === 1) {
      if (this.tools.izleyici <= 0) { MV.UI.toast('İZLEYİCİ YOK'); A.deny(); return; }
      MV.UI.toggleTracker();
      return;
    }
    if (this.tool === 2) {
      if (this.tools.mizrak <= 0) { MV.UI.toast('MIZRAK YOK'); A.deny(); return; }
      this.onAttack();
      return;
    }
    if (this.tool === 3) {
      /* tüketilebilir: serum > konserve */
      if (this.resources.serum > 0 && P.poison > 2) { this.consume('serum'); return; }
      if (this.resources.gida > 0) { this.consume('gida'); return; }
      MV.UI.toast('ÇANTADA BİR ŞEY YOK'); A.deny();
    }
  };
  G.consume = function (kind) {
    const P = this.player;
    if (this.resources[kind] <= 0) { A.deny(); return; }
    this.resources[kind]--;
    if (kind === 'serum') {
      P.poison = 0; P.hp = Math.min(P.maxHp, P.hp + 34); A.poison();
      MV.UI.toast('SERUM: zehir temizlendi (+34)');
    } else if (kind === 'gida') {
      P.hunger = 100; P.hp = Math.min(P.maxHp, P.hp + 16); A.pickup();
      MV.UI.toast('YEMEK: açlık giderildi (+16)');
    } else if (kind === 'pil') {
      this.torchCharge = 100; A.ui();
      MV.UI.toast('PİL TAKILDI');
    }
    this.save();
  };

  /* ---------- savaş ---------- */
  G.onAttack = function () {
    const P = this.player;
    this.attackT = 0.36;
    if (this.tool !== 2 && this.tools.mizrak > 0) this.tool = 2;
    if (this.tools.mizrak <= 0) { A.deny(); MV.UI.toast('SİLAH YOK'); return; }
    const reach = 1.9;
    const hx = P.x + Math.cos(P.a) * reach, hy = P.y + Math.sin(P.a) * reach;
    let hit = false;
    for (const b of this.beetles) {
      if (dist(b.x, b.y, hx, hy) < 0.9) {
        b.hp -= 40; hit = true;
        this.spark(b.x, b.y);
        if (b.hp <= 0) {
          this.killBeetle(b);
        } else { b.state = 'flee'; b.path = null; }
      }
    }
    for (const g of this.grievers) {
      if (g.dead) continue;
      if (dist(g.x, g.y, hx, hy) < 1.5) {
        g.hp -= 26; hit = true;
        g.stun = 1.5; g.aggro = true;
        A.hurt(); this.spark(g.x, g.y);
        g.path = null; g.repath = 0;
        if (g.hp <= 0) this.killGriever(g);
      }
    }
    A.noise(0.12, 'bandpass', 500, 1, 0.14, 0.004);
    if (hit) { MV.UI.hitMark(); MV.UI.subtitle('Mızrak isabet etti.'); }
  };
  G.killBeetle = function (b) {
    b.dead = true;
    this.meta.kills++;
    A.screech();
    this.resources.celik += 1;
    MV.UI.toast('BÖCEK BIÇAĞI İMHA — +1 ÇELİK');
    MV.logMsg('Böcek Bıçağı imha edildi.');
    // çalınan veriyi geri ver
    if (b.carrying) {
      this.resources[b.carrying] = (this.resources[b.carrying] || 0) + 1;
      if (b.carrying === 'anahtar') { this.hasKey = true; this.resources.anahtar = 1; }
      MV.UI.toast('ÇALINAN GERİ ALINDI');
    }
  };
  G.killGriever = function (g) {
    g.dead = true;
    this.meta.kills++;
    A.screech(); A.death();
    this.resources.recine += 2; this.resources.celik += 1;
    MV.UI.toast('GRIEVER ETKİSİZ — +2 REÇİNE +1 ÇELİK');
    MV.logMsg('Grievers etkisiz hale getirildi.');
  };
  G.spark = function (x, y) {
    for (let i = 0; i < 10; i++) {
      this.particles.push({
        x: x, y: y, vx: (Math.random() - .5) * 3, vy: (Math.random() - .5) * 3,
        life: 0.5, col: [255, 120, 60]
      });
    }
  };

  /* ---------- yaratık olayları ---------- */
  G.onEntityEvent = function (kind, ent) {
    const P = this.player;
    if (kind === 'grieverAggro') { A.grieverRoar(dist(ent.x, ent.y, P.x, P.y)); MV.UI.subtitle('Grievers seni buldu.'); }
    else if (kind === 'grieverRoar') { A.grieverRoar(dist(ent.x, ent.y, P.x, P.y)); }
    else if (kind === 'grieverHit') {
      this.damage(19 + Math.random() * 8, 'griever');
      P.poison = Math.min(100, P.poison + 45);
      A.hurt();
      MV.UI.damage();
      MV.UI.subtitle('Grievers iğnesini geçirdi. Zehir yayılıyor — serum bul.');
      const dx = P.x - ent.x, dy = P.y - ent.y, d = Math.hypot(dx, dy) || 1;
      const p = Maze.nearestOpen(this.world, P.x + dx / d * 1.2, P.y + dy / d * 1.2, 6, this.gatesOpen());
      P.x = p.x; P.y = p.y;
    }
    else if (kind === 'beetleSpotted') { A.beetle(); MV.UI.scan(); MV.UI.subtitle('Bir Böcek Bıçağı seni taradı. WICKED’in gözü üzerinde.'); }
    else if (kind === 'beetleReport') {
      MV.logMsg('WICKED: özne A7 görüldü. Konum iletildi.');
      MV.UI.toast('WICKED KONUMUNU ALDI');
      A.beetle();
      let n = 0;
      const sorted = this.grievers.filter(g => !g.dead).sort((a, b) => dist(a.x, a.y, P.x, P.y) - dist(b.x, b.y, P.x, P.y));
      for (const g of sorted) { if (n++ >= 2) break; g.aggro = true; g.repath = 0; }
    }
    else if (kind === 'beetleTake') {
      const keys = Object.keys(this.resources).filter(k => this.resources[k] > 0 && k !== 'anahtar');
      if (keys.length) {
        const k = keys[(Math.random() * keys.length) | 0];
        this.resources[k]--;
        ent.carrying = k;
        MV.UI.toast('BÖCEK ÇALDI: ' + ITEMS[k].name);
      } else { ent.carrying = null; }
    }
    else if (kind === 'beetleDeliver') { MV.logMsg('Böcek Bıçağı kaynağı kovana taşıdı.'); }
  };

  /* ---------- harita bilgisi ---------- */
  G.markKnownAround = function (x, y, r) {
    const w = this.world, R2 = r * r;
    const x0 = Math.max(0, Math.floor(x - r)), x1 = Math.min(w.W - 1, Math.ceil(x + r));
    const y0 = Math.max(0, Math.floor(y - r)), y1 = Math.min(w.H - 1, Math.ceil(y + r));
    for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) {
      const dx = xx + .5 - x, dy = yy + .5 - y;
      if (dx * dx + dy * dy > R2) continue;
      this.known[yy * w.W + xx] = 1;
    }
  };

  /* ---------- mesajlar ---------- */
  G.queueMsg = function (title, body) { MV.UI.msg(title, body); };
  G.setObjective = function (key) {
    if (!OBJECTIVES[key]) return;
    this.objective = key;
    MV.UI.setObjective(OBJECTIVES[key]);
  };
  G.obj = function () { return OBJECTIVES[this.objective]; };

  /* ---------- üretim ---------- */
  G.craft = function (id) {
    const rec = RECIPES.find(r => r.id === id);
    if (!rec) return false;
    for (const k in rec.cost) if ((this.resources[k] || 0) < rec.cost[k]) { A.deny(); MV.UI.toast('MALZEME YETERSİZ'); return false; }
    for (const k in rec.cost) this.resources[k] -= rec.cost[k];
    if (rec.id === 'fener') { this.tools.fener++; this.torchCharge = 100; this.player.torchOn = true; }
    else if (rec.id === 'izleyici') this.tools.izleyici++;
    else if (rec.id === 'mizrak') this.tools.mizrak++;
    else if (rec.id === 'halat') this.tools.halat++;
    else if (rec.id === 'serum') this.resources.serum++;
    else if (rec.id === 'gida') this.resources.gida++;
    A.unlock();
    this.meta.crafted = (this.meta.crafted || 0) + 1;
    this.checkAchievements();
    MV.UI.toast('ÜRETİLDİ: ' + rec.name);
    MV.logMsg('Üretim: ' + rec.name);
    this.save();
    return true;
  };
  G.canCraft = function (id) {
    const rec = RECIPES.find(r => r.id === id);
    if (!rec) return false;
    for (const k in rec.cost) if ((this.resources[k] || 0) < rec.cost[k]) return false;
    return true;
  };
  G.craftList = function () { return RECIPES; };
  G.itemName = function (k) { return ITEMS[k] ? ITEMS[k].name : k; };

  /* ---------- çıkış kapağı ---------- */
  G.tryCode = function (code) {
    if (code === '31415926') {
      this.codeOk = true;
      return true;
    }
    return false;
  };
  G.openHatch = function () {
    if (!this.hasKey) { MV.UI.subtitle('Kapakta WICKED mührü var: anahtar gerek.'); A.deny(); return; }
    this.cinematic = { t: 0, kind: 'escape' };
    this.setObjective('escape');
    A.unlock(); A.win();
    MV.UI.subtitle('Mühür açıldı. Kapak yukarı kayıyor. Işık…');
    MV.UI.closeModal();
  };

  /* ---------- ölüm / kazanma ---------- */
  G.startDeath = function (cause, msg) {
    if (this.dead) return;
    this.dead = true;
    this.meta.deaths++;
    A.death();
    MV.logMsg('ÖLDÜN: ' + (cause || '?'));
    MV.UI.death(cause, msg);
  };
  G.respawn = function () {
    const P = this.player;
    this.dead = false;
    P.hp = this.player.maxHp * 0.6;
    P.poison = 0; P.cold = 0; P.hunger = Math.max(40, P.hunger);
    const p = Maze.nearestOpen(this.world, this.world.cx + 3, this.world.cy + 3, 12, this.gatesOpen());
    P.x = p.x; P.y = p.y; P.a = this.world.spawn.a;
    for (const g of this.grievers) { g.aggro = false; g.path = null; }
    MV.UI.subtitle('WICKED seni Kayran’da uyandırdı. "Ölmene izin veremem, özne A7."');
    MV.UI.closeModal();
  };
  G.win = function () {
    this.won = true;
    this.checkAchievements();
    MV.Desktop.save.remove(0);      // otomatik kayıt temizlenir: deney tamamlandı
    MV.UI.win();
  };

  /* ---------- kayıt ---------- */
  G.snapshot = function () {
    return {
      v: 1, t: Date.now(), seed: this.seed, day: this.day, phase: this.phase, clock: this.clock,
      px: this.player.x, py: this.player.y, pa: this.player.a,
      hp: this.player.hp, stam: this.player.stam, hunger: this.player.hunger,
      poison: this.player.poison, tools: this.tools, tool: this.tool,
      torchCharge: this.torchCharge, resources: this.resources,
      runesRead: this.runesRead, objective: this.objective,
      hasKey: this.hasKey, flags: this.flags, meta: this.meta,
      taken: this.items.map((it, i) => it.taken ? i : -1).filter(i => i >= 0)
    };
  };
  G.save = function (slot) {
    if (this.dead) return false;
    return this.saveTo(slot === undefined ? 0 : slot);
  };
  G.saveTo = function (slot) {
    if (this.dead) return false;
    const ok = MV.Desktop.save.write(slot, JSON.stringify(this.snapshot()));
    if (ok) MV.logMsg('Kayıt: slot ' + slot + ' (gün ' + this.day + ')');
    return ok;
  };
  G.loadFrom = function (slot) {
    const raw = MV.Desktop.save.read(slot);
    if (!raw) return false;
    try {
      this.applySave(JSON.parse(raw));
      this.dead = false; this.won = false; this.cinematic = null;
      MV.UI.closeModal();
      MV.UI.setObjective(this.obj());
      MV.logMsg('Kayıt yüklendi: slot ' + slot);
      return true;
    } catch (e) {
      MV.logMsg('Kayıt okunamadı: ' + e.message);
      return false;
    }
  };
  G.autoSave = function (dt) {
    this.saveT += dt;
    if (this.saveT > 20) { this.saveT = 0; this.save(); }
  };
  G.applySave = function (s) {
    this.seed = s.seed >>> 0;
    this.day = s.day || 1;
    this.phase = s.phase || 'day';
    this.clock = s.clock !== undefined ? s.clock : DAY_LEN * 0.4;
    this.runesRead = s.runesRead || [];
    this.resources = s.resources || this.resources;
    this.tools = s.tools || this.tools;
    this.tool = s.tool || 0;
    this.torchCharge = s.torchCharge === undefined ? 100 : s.torchCharge;
    this.objective = s.objective || 'explore';
    this.hasKey = !!s.hasKey;
    this.flags = s.flags || {};
    this.meta = s.meta || this.meta;
    this.pendingTaken = s.taken || [];
    this.buildWorld(this.day === 1 && s.fresh);
    const op = MV.Maze.nearestOpen(this.world, s.px || this.world.spawn.x, s.py || this.world.spawn.y, 12, true);
    this.player.x = op.x;
    this.player.y = op.y;
    this.player.a = s.pa || this.player.a;
    this.player.hp = s.hp || 100;
    this.player.stam = s.stam === undefined ? 100 : s.stam;
    this.player.hunger = s.hunger === undefined ? 100 : s.hunger;
    this.player.poison = s.poison || 0;
    this.setObjective(this.objective);
    MV.UI.syncSlots();
  };

  /* ---------- görüntü nesnesi ---------- */
  G.render = function (dt) {
    const P = this.player, w = this.world, R = MV.Renderer;
    const phase = this.phase;
    const nightF = phase === 'night' ? 1 : (phase === 'dusk' ? clamp(1 - (this.clock / DAY_LEN) / PHASE_DUSK, 0, 1) : 0);
    /* gökyüzü ve ışık */
    let sky, skyTop, light, fog, fogDens, stars;
    if (nightF >= 0.99) {
      sky = [16, 22, 40]; skyTop = [6, 9, 20]; light = 0.30; fog = [16, 22, 42]; fogDens = 0.052; stars = 1;
    } else if (nightF > 0.05) {
      const t = nightF;
      sky = [lerp(122, 150, t), lerp(126, 84, t), lerp(128, 58, t)];
      skyTop = [lerp(62, 26, t), lerp(70, 34, t), lerp(92, 52, t)];
      light = lerp(1.0, 0.42, t);
      fog = [lerp(96, 44, t), lerp(100, 36, t), lerp(104, 38, t)];
      fogDens = lerp(0.028, 0.046, t); stars = t > 0.5 ? (t - 0.5) * 2 : 0;
    } else {
      sky = [122, 128, 126]; skyTop = [62, 70, 92]; light = 1.0; fog = [96, 102, 104]; fogDens = 0.026; stars = 0;
    }
    /* fener ışığı ve şarj */
    let torch = 0;
    if (P.torchOn && this.tools.fener > 0 && this.torchCharge > 0) {
      torch = 1;
      this.torchCharge = Math.max(0, this.torchCharge - dt * 0.42);
      if (this.torchCharge <= 0) { P.torchOn = false; MV.UI.toast('FENER SÖNDÜ'); A.deny(); }
    }
    const flicker = 1 + Math.sin(this.meta.time * 22) * 0.05 + Math.sin(this.meta.time * 7.3) * 0.07;
    /* kaçış: beyaz ışık yükselir */
    if (this.cinematic && this.cinematic.kind === 'escape') {
      const k = clamp(this.cinematic.t / 3.2, 0, 1);
      light = lerp(light, 2.4, k);
      fog = [lerp(fog[0], 235, k), lerp(fog[1], 242, k), lerp(fog[2], 250, k)];
      fogDens = lerp(fogDens, 0.30, k);
      sky = [lerp(sky[0], 240, k), lerp(sky[1], 245, k), lerp(sky[2], 250, k)];
      skyTop = sky;
    }
    /* saldırı animasyonu */
    if (this.attackT > 0) this.attackT = Math.max(0, this.attackT - dt);
    /* görüş nesneleri */
    const ents = [];
    const px = P.x, py = P.y;
    for (const p of this.props) {
      if (dist(p.x, p.y, px, py) > 46) continue;
      ents.push({
        x: p.x, y: p.y, sprite: p.sprite, w: p.w, h: p.h, yOff: p.yOff || 0,
        glow: (p.glow || 0) * (1 - nightF * 0.2), tint: nightF > 0.5 ? 0.75 : 1
      });
    }
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      if (it.taken) continue;
      if (dist(it.x, it.y, px, py) > 34) continue;
      const def = ITEMS[it.type];
      ents.push({
        x: it.x, y: it.y, sprite: def.sprite, w: def.w, h: def.h, yOff: def.yOff,
        glow: it.type === 'anahtar' ? 0.25 : 0.06, tint: 1
      });
    }
    for (const g of this.grievers) {
      if (g.dead) continue;
      const d = dist(g.x, g.y, px, py);
      if (d > 42) continue;
      ents.push({
        x: g.x, y: g.y, sprite: g.sprite, w: g.w, h: g.h, yOff: g.yOff,
        glow: g.aggro ? 0.16 : 0, tint: 1
      });
    }
    for (const b of this.beetles) {
      if (b.dead) continue;
      if (dist(b.x, b.y, px, py) > 30) continue;
      ents.push({
        x: b.x, y: b.y, sprite: b.sprite, w: b.w, h: b.h, yOff: b.yOff,
        glow: b.state !== 'roam' ? 0.3 : 0.12, tint: 1
      });
    }
    /* parçacıklar */
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const pa = this.particles[i];
      pa.life -= dt;
      pa.x += pa.vx * dt; pa.y += pa.vy * dt;
      if (pa.life <= 0) { this.particles.splice(i, 1); continue; }
      ents.push({ x: pa.x, y: pa.y, sprite: 'flame', w: 0.22, h: 0.22, yOff: 0.5, alpha: clamp(pa.life * 2, 0, 1), glow: 0.8 });
    }
    /* elde tutulan eşya */
    const held = [];
    if (this.tool === 0 && this.tools.fener > 0) held.push({ sprite: 'torch', x: 0.78, y: -10, scale: 1.35, rot: -0.22 * (1 + P.bobX * 0.4) });
    if (this.tool === 1 && this.tools.izleyici > 0) held.push({ sprite: 'tracker', x: 0.74, y: -6, scale: 1.1, rot: -0.16 });
    if (this.tool === 2 && this.tools.mizrak > 0) {
      const at = this.attackT > 0 ? (1 - this.attackT / 0.36) : 0;
      const thrust = Math.sin(Math.min(1, at) * Math.PI);
      held.push({ sprite: 'spear', x: 0.72 - thrust * 0.10, y: -18 + thrust * 16, scale: 1.5 + thrust * 0.25, rot: -0.35 + thrust * 0.55 });
    }
    if (this.tool === 3) held.push({ sprite: this.resources.serum > 0 && P.poison > 2 ? 'vial' : 'food', x: 0.76, y: -8, scale: 1.1, rot: -0.1 });

    const zc = P.zc + Math.sin(P.bobT * 2) * 0.006 - (P.crouch ? 0.14 : 0) - this.falling * 0.25;
    const sh = this.shakeAmt || 0;
    const shx = sh ? Math.sin(this.meta.time * 41) * sh : 0;
    const shy = sh ? Math.cos(this.meta.time * 37) * sh : 0;
    this.view = {
      world: w, px: P.x, py: P.y, pa: P.a + shx * 0.9, pitch: P.pitch + shy * 60,
      zc: zc, bobY: P.bobY, bobX: P.bobX,
      light: light * flicker * (this.falling > 0 ? 0.5 : 1),
      torch: torch * flicker,
      fogColor: fog, fogDens: fogDens, sky: sky, skyTop: skyTop, stars: stars,
      gatesOpen: this.gatesOpen(), entities: ents, held: held,
      hurt: P.hurtFx, ghostFx: this.falling > 0, time: this.meta.time
    };
    R.draw(this.view);
    MV.UI.setNight(nightF);
  };

  /* ---------- dışa aktarım ---------- */
  MV.Game = G;

  if (typeof module !== 'undefined' && module.exports) module.exports = G;
})(MV);
