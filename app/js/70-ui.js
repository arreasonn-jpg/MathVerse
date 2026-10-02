/* ============================================================
   70-ui.js — HUD, pusula, harita, günlük, üretim terminali,
   tuş takımı, menüler ve sinematik metinler
   ============================================================ */
(function (MV) {
  'use strict';
  const { clamp, lerp, TAU, fmtTime, pad2, T } = MV;
  const Maze = MV.Maze;

  /* ayar satırları: ◀ değer ▶ biçiminde tıklanabilir */
  const SETTINGS_ROWS = [
    { key: 'quality', label: 'GÖRÜNTÜ KALİTESİ', values: ['yuksek', 'orta', 'performans'],
      fmt: (v) => MV.Desktop.QUALITY_LABEL[v], hint: 'Yüksek=480p iç çözünürlük, Performans=160p (eski PC\'ler için)' },
    { key: 'fov', label: 'GÖRÜŞ ALANI', values: [0.85, 1.0, 1.15, 1.3],
      fmt: (v) => Math.round(v * 100) + '%', hint: 'Yüksek FOV daha geniş görür ama daha fazla çizer' },
    { key: 'sensitivity', label: 'FARE HASSASİYETİ', values: [0.4, 0.6, 0.8, 1.0, 1.2, 1.5, 1.8, 2.0],
      fmt: (v) => v.toFixed(1) + '×', hint: '' },
    { key: 'invertY', label: 'Y EKSENİNİ TERS ÇEVİR', values: [false, true],
      fmt: (v) => v ? 'AÇIK' : 'KAPALI', hint: '' },
    { key: 'shake', label: 'KAMERA SARSINTISI', values: [true, false],
      fmt: (v) => v ? 'AÇIK' : 'KAPALI', hint: 'Grievers yaklaşınca ekran titremesi' },
    { key: 'hudScale', label: 'ARAYÜZ ÖLÇEĞİ', values: [0.85, 1.0, 1.15, 1.3],
      fmt: (v) => Math.round(v * 100) + '%', hint: '' },
    { key: 'volume', label: 'SES SEVİYESİ', values: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0],
      fmt: (v) => Math.round(v * 100) + '%', hint: '' },
    { key: 'muted', label: 'SES', values: [false, true],
      fmt: (v) => v ? 'KAPALI' : 'AÇIK', hint: '' },
    { key: 'fps', label: 'FPS SAYACI', values: [false, true],
      fmt: (v) => v ? 'AÇIK' : 'KAPALI', hint: 'Sağ üstte kare hızı göstergesi (F3)' }
  ];

  const UI = {
    refs: {}, modalShown: false, tracker: false, nightF: 0, dmgFx: 0,
    msgT: 0, subT: 0, toastT: 0, hintT: 0, seenIntro: false, paused: false,
    prevFocus: null,

    init(G) {
      if (typeof document === 'undefined') return;
      const $ = (id) => document.getElementById(id);
      this.refs = {
        G: G,
        view: $('view'), fxDamage: $('fx-damage'), fxPoison: $('fx-poison'),
        fxNight: $('fx-night'), fxGlitch: $('fx-glitch'),
        objText: $('obj-text'), objSub: $('obj-sub'),
        compass: $('compass-c'), sectorTag: $('sector-tag'),
        day: $('clock-day'), phase: $('clock-phase'), time: $('clock-time'),
        clockFill: $('clock-fill'), danger: $('danger'),
        barHp: $('bar-hp'), valHp: $('val-hp'), barSt: $('bar-st'), valSt: $('val-st'),
        barNoise: $('bar-noise'), valNoise: $('val-noise'), barTorch: $('bar-torch'),
        torchState: $('torch-state'), runeCount: $('rune-count'), runes: $('runes'),
        log: $('log'), interact: $('interact'), interactTxt: $('interact-txt'),
        subtitle: $('subtitle'), hint: $('hint'), toast: $('toast'),
        overlay: $('overlay'), modal: $('modal'), slots: [$('slot0'), $('slot1'), $('slot2'), $('slot3')],
        condPoi: $('cond-poi'), condHun: $('cond-hun'), condCra: $('cond-cra'),
        bootWarn: $('boot-warn'), msgcard: $('msgcard'),
        hud: $('hud'), fx: $('fx'), fps: $('fps')
      };
      this.cctx = this.refs.compass.getContext('2d');
      this.buildRuneStrip();
      this.buildLog();
      const canvas = this.refs.view;
      canvas.addEventListener('click', () => {
        MV.Audio.ensure(); MV.Audio.resume();
        if (!this.modalOpen() && document.pointerLockElement !== canvas) canvas.requestPointerLock();
        if (!this.seenIntro && this.modalOpen()) return;
      });
      this.refreshFromSave();
    },

    /* ============================================================
       AÇILIŞ / MENÜLER
       ============================================================ */
    refreshFromSave() {
      this.showTitle();
    },
    showTitle() {
      const G = this.refs.G;
      const D = MV.Desktop;
      const info = D.info();
      const slots = D.save.list();
      const auto = slots[0];
      const anyManual = slots.slice(1).some(sl => !sl.empty);
      const hasAny = !auto.empty || anyManual;
      const autoLine = auto.empty
        ? '<span class="dim">otomatik kayıt yok</span>'
        : '<span class="amber">GÜN ' + auto.day + ' · ' + (auto.phase === 'night' ? 'GECE' : 'GÜNDÜZ') +
        ' · veri ' + auto.runes + '/8</span>';
      const box = (d) => '<span class="dim">' + (d.electron && d.electron !== '-' ? 'Electron ' + d.electron : 'Tarayıcı') +
        ' · sürüm ' + d.version + '</span>';
      const platformName = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' }[info.platform] || info.platform;
      this.modal({
        kicker: 'WICKED — DENEY SAHASI 7 / LABİRENT PROTOKOLÜ',
        title: 'LABİRENT PROTOKOLÜ',
        html: `
          <div class="splash">
            <div class="titleBig">LABİRENT</div>
            <div class="wicked">P R O T O K O L Ü</div>
            <div class="sub">60 ÖZNE · 4 GEÇİT · 1 ÇIKIŞ</div>
          </div>
          <p class="dim" style="margin-top:14px">Kutu seni yukarı bıraktı. Hiçbir şey hatırlamıyorsun. Kayran duvarlarla çevrili,
          labirent her gece kendi duvarlarını yeniden diziyor ve geçitler alacakaranlıkta kapanıyor.</p>
          <div class="savebar">
            <div><span class="k">OTOMATİK KAYIT</span> ${autoLine}</div>
            <div class="dim">Sistem: ${platformName} · ${box(info)}</div>
          </div>
          <h3>HAYATTA KALMA KURALLARI</h3>
          <ul>
            <li>Gün doğduğunda geçitler açılır, <span class="amber">alacakaranlıkta kapanır</span>. Dışarıda kalan geceyi görür.</li>
            <li>Labirentteki <span class="amber">8 rune taşı</span> WICKED'in çıkış kodunu taşır. Sırası taşa kazınmıştır.</li>
            <li><span class="cyan">Böcek Bıçakları</span> seni görürse konumunu WICKED'e bildirir. <span class="red">Grievers</span> gelir.</li>
            <li>Kayran'daki <span class="amber">Kutu terminali</span> ile malzemeden araç üret.</li>
          </ul>`,
        buttons: [
          !auto.empty ? { label: 'DEVAM ET — GÜN ' + auto.day, cls: 'primary wide', fn: () => this.continueGame() } : null,
          anyManual ? { label: 'KAYIT YÜKLE', cls: 'wide', fn: () => this.openSaveSlots('load') } : null,
          { label: hasAny ? 'YENİ DENEY' : 'DENEYE BAŞLA', cls: (hasAny ? 'wide' : 'primary wide'), fn: () => this.confirmNew() },
          { label: 'AYARLAR', cls: 'wide', fn: () => this.openSettings(true) },
          { label: 'BAŞARIMLAR (' + G.achievementCount() + '/' + G.achievementTotal() + ')', cls: 'wide', fn: () => this.openAchievements('title') },
          { label: 'KONTROLLER', cls: 'wide', fn: () => this.showControls(true) },
          MV.Desktop.isDesktop ? { label: 'ÇIKIŞ', cls: 'danger wide', fn: () => MV.Desktop.quit() } : null
        ].filter(Boolean),
        escClose: false
      });
    },
    /* otomatik kayıttan devam */
    continueGame() {
      const G = this.refs.G;
      if (G.loadFrom(0)) { this.closeModal(); MV.Audio.ensure(); }
      else this.toast('OTOMATİK KAYIT OKUNAMADI');
    },
    /* yeni deney onayı */
    confirmNew() {
      const G = this.refs.G;
      const slots = MV.Desktop.save.list();
      const hasAny = slots.some(sl => !sl.empty);
      if (!hasAny) {
        G.newGame((Math.random() * 1e9) | 0);
        this.seenIntro = true;
        this.intro();
        return;
      }
      this.modal({
        kicker: 'YENİ DENEY', title: 'DENEYİ SIFIRLA',
        html: `<p>Yeni bir labirent üretilecek: yeni duvarlar, yeni rune yerleşimi, yeni bir özne.</p>
        <p class="red">Mevcut ilerleme (${slots.filter(sl => !sl.empty).length} kayıt) silinmez; üzerine yazmak istersen bunu <span class="amber">Kaydet</span> ekranından yapabilirsin.</p>`,
        buttons: [
          { label: 'YENİ LABİRENT ÜRET', cls: 'primary wide', fn: () => { G.newGame((Math.random() * 1e9) | 0); this.seenIntro = true; this.intro(); } },
          { label: 'VAZGEÇ', cls: 'wide', fn: () => this.showTitle() }
        ]
      });
    },

    /* ============================================================
       KAYIT SLOTLARI
       ============================================================ */
    openSaveSlots(mode) {
      const G = this.refs.G;
      const slots = MV.Desktop.save.list();
      const list = (mode === 'save' ? slots.slice(1) : slots);
      const dateStr = (t) => {
        if (!t) return '—';
        const d = new Date(t);
        return d.toLocaleDateString('tr-TR') + ' ' + d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
      };
      const rows = list.map(sl => {
        const name = sl.slot === 0 ? 'OTOMATİK KAYIT' : 'SLOT ' + sl.slot;
        if (sl.empty) {
          return `<div class="slotRow empty">
            <div class="sr-info"><div class="sr-name">${name}</div><div class="sr-meta dim">boş</div></div>
            ${mode === 'save' ? `<button class="btn" data-save="${sl.slot}">BURAYA KAYDET</button>` : ''}
          </div>`;
        }
        const meta = `Gün ${sl.day} · ${sl.phase === 'night' ? 'gece' : 'gündüz'} · veri ${sl.runes}/8` +
          ` · anahtar ${sl.hasKey ? 'var' : 'yok'} · ${sl.kills} grievers` +
          `<br><span class="dim">${dateStr(sl.date)} · can ${sl.hp} · ${Math.round((sl.time || 0) / 60)} dk</span>`;
        const actions = [
          `<button class="btn primary" data-load="${sl.slot}">YÜKLE</button>`,
          mode === 'save' ? `<button class="btn" data-save="${sl.slot}">ÜZERİNE YAZ</button>` : '',
          `<button class="btn danger" data-del="${sl.slot}">SİL</button>`
        ].filter(Boolean).join(' ');
        return `<div class="slotRow">
          <div class="sr-info"><div class="sr-name">${name}</div><div class="sr-meta">${meta}</div></div>
          <div class="sr-actions">${actions}</div>
        </div>`;
      }).join('');
      this.modal({
        kicker: 'KAYITLAR — ' + MV.Desktop.save.dir(), title: mode === 'save' ? 'OYUNU KAYDET' : 'KAYIT YÜKLE',
        html: `<div class="slotList">${rows}</div>
          <p class="dim" style="margin-top:10px">Oyun her 20 saniyede otomatik olarak slot 0'a kaydeder.
          ${MV.Desktop.isDesktop ? 'Dosyalar: ' + MV.Desktop.save.dir() : 'Tarayıcıda kayıtlar localStorage\'da tutulur.'}</p>`,
        buttons: [
          MV.Desktop.isDesktop ? { label: 'KAYIT KLASÖRÜNÜ AÇ', cls: 'wide', fn: () => MV.Desktop.openFolder('saves') } : null,
          { label: 'GERİ', cls: 'primary wide', fn: () => (mode === 'save' ? this.togglePause() : this.showTitle()) }
        ].filter(Boolean),
        escClose: true
      });
      const m = this.refs.modal;
      m.querySelectorAll('[data-load]').forEach(btn => {
        btn.onclick = () => {
          const slot = parseInt(btn.getAttribute('data-load'), 10);
          if (G.loadFrom(slot)) { this.closeModal(); this.toast('KAYIT YÜKLENDİ: SLOT ' + slot); }
          else this.toast('KAYIT YÜKLENEMEDİ');
        };
      });
      m.querySelectorAll('[data-save]').forEach(btn => {
        btn.onclick = () => {
          const slot = parseInt(btn.getAttribute('data-save'), 10);
          if (G.saveTo(slot)) { this.openSaveSlots('save'); this.toast('KAYDEDİLDİ: SLOT ' + slot); }
          else this.toast('KAYDEDİLEMEDİ (ölüm sonrası kayıt alınmaz)');
        };
      });
      m.querySelectorAll('[data-del]').forEach(btn => {
        btn.onclick = () => {
          const slot = parseInt(btn.getAttribute('data-del'), 10);
          MV.Desktop.save.remove(slot);
          this.openSaveSlots(mode);
          this.toast('SİLİNDİ: SLOT ' + slot);
        };
      });
    },

    /* ============================================================
       AYARLAR
       ============================================================ */
    openSettings(fromTitle) {
      const G = this.refs.G;
      const cur = MV.Desktop.settings.read();
      const D = MV.Desktop;
      const info = D.info();
      const row = (r) => {
        const v = cur[r.key];
        const idx = r.values.indexOf(v) >= 0 ? r.values.indexOf(v) : 0;
        const label = r.fmt ? r.fmt(v === undefined ? r.values[0] : v) : String(v);
        return `<div class="setRow" data-key="${r.key}">
          <div class="sr-info">
            <div class="sr-name">${r.label}</div>
            ${r.hint ? '<div class="sr-meta dim">' + r.hint + '</div>' : ''}
          </div>
          <div class="sr-actions">
            <button class="btn" data-dir="-1">◀</button>
            <span class="setVal">${label}</span>
            <button class="btn" data-dir="1">▶</button>
          </div>
        </div>`;
      };
      this.modal({
        kicker: 'SİSTEM AYARLARI', title: 'AYARLAR',
        html: `<div class="slotList">${SETTINGS_ROWS.map(row).join('')}</div>
          ${D.isDesktop ? `<h3>SİSTEM</h3>
          <div class="slotList">
            <div class="setRow"><div class="sr-info"><div class="sr-name">TAM EKRAN</div>
              <div class="sr-meta dim">F11 ile de değiştirilebilir</div></div>
              <div class="sr-actions"><button class="btn" id="setFull">${cur.fullscreen ? 'AÇIK' : 'KAPALI'}</button></div></div>
            <div class="setRow"><div class="sr-info"><div class="sr-name">EKRAN GÖRÜNTÜSÜ</div>
              <div class="sr-meta dim">F12 · ${info.shots}</div></div>
              <div class="sr-actions"><button class="btn" id="setShot">ÇEK</button>
              <button class="btn" id="setShotDir">KLASÖRÜ AÇ</button></div></div>
            <div class="setRow"><div class="sr-info"><div class="sr-name">KAYIT DOSYALARI</div>
              <div class="sr-meta dim">${info.saves}</div></div>
              <div class="sr-actions"><button class="btn" id="setSaveDir">KLASÖRÜ AÇ</button></div></div>
            <div class="setRow"><div class="sr-info"><div class="sr-name">SÜRÜM</div>
              <div class="sr-meta dim">${info.version} · Electron ${info.electron} · Chromium ${String(info.chrome).split('.')[0]} · ${info.platform}/${info.arch}</div></div>
              <div class="sr-actions"></div></div>
          </div>` : `<p class="dim" style="margin-top:10px">Tarayıcı sürümünde kayıtlar localStorage'da; ekran görüntüsü ve tam ekran için masaüstü uygulamasını kullan.</p>`}
          <p class="dim" style="margin-top:10px">Ayarlar anında uygulanır ve kalıcı olarak saklanır.</p>`,
        buttons: [
          { label: 'SIFIRLA', cls: 'danger wide', fn: () => { MV.Desktop.settings.write(MV.Desktop.DEFAULT_SETTINGS); MV.Desktop.apply(); this.openSettings(fromTitle); this.toast('AYARLAR SIFIRLANDI'); } },
          { label: fromTitle ? 'ANA MENÜ' : 'KAPAT', cls: 'primary wide', fn: () => (fromTitle ? this.showTitle() : this.togglePause()) }
        ],
        escClose: true
      });

      const m = this.refs.modal;
      SETTINGS_ROWS.forEach((r) => {
        const el = m.querySelector('[data-key="' + r.key + '"]');
        if (!el) return;
        el.querySelectorAll('[data-dir]').forEach(btn => {
          btn.onclick = () => {
            const dir = parseInt(btn.getAttribute('data-dir'), 10);
            const cur2 = MV.Desktop.settings.read();
            let i = r.values.indexOf(cur2[r.key]);
            if (i < 0) i = 0;
            i = (i + dir + r.values.length) % r.values.length;
            G.applySetting(r.key, r.values[i]);
            MV.Audio.ui();
            this.openSettings(fromTitle);
          };
        });
      });
      const full = m.querySelector('#setFull');
      if (full) full.onclick = () => {
        const next = !MV.Desktop.settings.read().fullscreen;
        MV.Desktop.setFullscreen(next);
        G.applySetting('fullscreen', next);
        this.openSettings(fromTitle);
      };
      const shot = m.querySelector('#setShot');
      if (shot) shot.onclick = () => { G.takeScreenshot(); };
      const sd = m.querySelector('#setShotDir');
      if (sd) sd.onclick = () => MV.Desktop.openFolder('shots');
      const svd = m.querySelector('#setSaveDir');
      if (svd) svd.onclick = () => MV.Desktop.openFolder('saves');
    },

    /* ============================================================
       BAŞARIMLAR
       ============================================================ */
    achievement(def) {
      MV.Audio.unlock();
      this.toast('★ BAŞARIM: ' + def.name);
    },
    openAchievements(from) {
      const G = this.refs.G;
      const list = G.achievementList();
      const got = list.filter(a => a.at).length;
      const rows = list.map(a => {
        const when = a.at ? new Date(a.at).toLocaleDateString('tr-TR') : 'kilitli';
        return '<div class="achRow' + (a.at ? ' got' : '') + '">' +
          '<b>' + (a.at ? '★' : '☆') + ' ' + a.name + '</b>' +
          '<span>' + a.desc + '</span>' +
          '<i>' + when + '</i></div>';
      }).join('');
      this.modal({
        kicker: 'WICKED KAYDI', title: 'BAŞARIMLAR — ' + got + ' / ' + list.length,
        html: '<div class="achList">' + rows + '</div>' +
          '<p class="dim" style="margin-top:12px">Başarımlar kayıt slotlarından bağımsız saklanır; yeni deney başlatsan da kaybolmaz.</p>',
        buttons: [{
          label: from ? 'GERİ' : 'KAPAT', cls: 'primary wide',
          fn: () => (from === 'title' ? this.showTitle() : (from === 'pause' ? this.togglePause() : this.reopen()))
        }],
        escClose: true
      });
    },
    showControls(back) {
      const G = this.refs.G;
      this.modal({
        kicker: 'SİSTEM', title: 'KONTROLLER',
        html: `<div class="keys">
          <div><span>İlerle / geri</span><b>W S</b></div>
          <div><span>Yan adım</span><b>A D</b></div>
          <div><span>Koş</span><b>SHIFT</b></div>
          <div><span>Eğil (sessiz)</span><b>C</b></div>
          <div><span>Bakış</span><b>FARE</b></div>
          <div><span>Etkileşim</span><b>E</b></div>
          <div><span>Fener</span><b>F</b></div>
          <div><span>Araç seç</span><b>1 2 3 4</b></div>
          <div><span>Aracı kullan</span><b>Q / SOL TIK</b></div>
          <div><span>Harita</span><b>M</b></div>
          <div><span>Günlük</span><b>TAB</b></div>
          <div><span>Duraklat</span><b>ESC</b></div>
        </div>
        <p class="dim" style="margin-top:10px;letter-spacing:.05em">OYUN KOLU (Xbox / DualSense / 8BitDo)</p>
        <div class="keys">
          <div><span>Yürü / bak</span><b>SOL / SAĞ ÇUBUK</b></div>
          <div><span>Koş</span><b>ÇUBUĞU İT</b></div>
          <div><span>Etkileşim</span><b>A</b></div>
          <div><span>Fener</span><b>B</b></div>
          <div><span>Mızrak</span><b>X</b></div>
          <div><span>Araç kullan</span><b>Y</b></div>
          <div><span>Araç değiştir</span><b>LB / RB</b></div>
          <div><span>Eğil</span><b>LT</b></div>
          <div><span>Harita</span><b>BACK</b></div>
          <div><span>Duraklat</span><b>START</b></div>
        </div>
        <p class="dim" style="margin-top:14px">İpucu: Eğilerek yürürken sesin azalır; Grievers seni daha zor bulur. Fener seni görünür yapar ama karanlıkta yalnız ölürsün.</p>`,
        buttons: back ? [{ label: 'GERİ', cls: 'primary wide', fn: () => this.showTitle() }]
          : [{ label: 'KAPAT', cls: 'wide primary', fn: () => this.closeModal() }]
      });
    },
    intro() {
      const G = this.refs.G;
      const cards = [
        { t: 'KUTU', s: 'Gün doğumu. Metal kapak yukarı kaydı, çelik kollar seni bıraktı.' },
        { t: 'KAYRAN', s: 'Çim, barakalar, bir fener direği. Etrafın duvarla çevrili. 4 geçit.' },
        { t: 'KURAL', s: 'Geçitler alacakaranlıkta kapanır. Duvarlar her gece yer değiştirir.' },
        { t: 'GÖREV', s: '8 veri parçası. Bir kod. Bir çıkış. Ve seni izleyen bir şey.' }
      ];
      let i = 0;
      const next = () => {
        if (i >= cards.length) {
          this.closeModal();
          const cv = this.refs.view;
          try { cv.requestPointerLock(); } catch (e) { }
          return;
        }
        const c = cards[i++];
        this.modal({
          kicker: 'GİRİŞ ' + i + '/' + cards.length, title: c.t,
          html: '<p style="font-size:15px;line-height:2">' + c.s + '</p>',
          buttons: [{ label: i >= cards.length ? 'BAŞLA' : 'DEVAM', cls: 'primary wide', fn: next }]
        });
      };
      next();
    },

    /* ============================================================
       MODAL
       ============================================================ */
    modal(cfg) {
      // bir önceki ekranı sakla: 'GERİ' düğmeleri buraya döner
      if (this.modalShown && this.modalCfg) this._returnCfg = this.modalCfg;
      const m = this.refs.modal, o = this.refs.overlay;
      m.classList.remove('hidden'); o.classList.remove('hidden');
      m.className = 'glitchy';
      m.innerHTML = '';
      const head = document.createElement('div');
      head.className = 'm-head';
      head.innerHTML = '<div><div class="m-kicker">' + (cfg.kicker || 'WICKED') + '</div>' +
        '<div class="m-title">' + cfg.title + '</div></div>';
      m.appendChild(head);
      const body = document.createElement('div');
      body.className = 'm-body';
      body.innerHTML = cfg.html || '';
      m.appendChild(body);
      const act = document.createElement('div');
      act.className = 'm-actions';
      (cfg.buttons || []).forEach(b => {
        const el = document.createElement('button');
        el.className = 'btn ' + (b.cls || '');
        el.textContent = b.label;
        el.onclick = () => { MV.Audio.ui(); b.fn && b.fn(); };
        act.appendChild(el);
      });
      m.appendChild(act);
      this.modalShown = true;
      this.modalCfg = cfg;
      this.modalActions = (cfg.buttons || []);
      if (cfg.onShow) cfg.onShow();          // tuval/bağlama gerektiren ekranlar için
    },
    /* önceki ekranı yeniden aç (başarım/kontroller gibi ara ekranlardan dönüş) */
    reopen() {
      const prev = this._returnCfg;
      if (!prev) { this.closeModal(); return; }
      this._returnCfg = null;
      this.modalShown = false;               // geri dönüşte tekrar sarmasın
      this.modal(prev);
    },
    closeModal() {
      this._returnCfg = null;
      this.refs.modal.classList.add('hidden');
      this.refs.overlay.classList.add('hidden');
      this.modalShown = false;
      this.modalCfg = null;
      this.mapOpen = false;
      this.keypadOn = false;
      const cv = this.refs.view;
      if (cv && !document.pointerLockElement) { try { cv.requestPointerLock(); } catch (e) { } }
    },
    modalOpen() { return this.modalShown; },
    handleKey(e) {
      if (e.code === 'Escape') {
        if (this.modalCfg && this.modalCfg.escClose) this.closeModal();
      }
      const n = parseInt((e.key || ''), 10);
      if (!isNaN(n) && this.keypadOn) this.keypadPress(String(n));
    },

    /* ============================================================
       HUD GÜNCELLEME
       ============================================================ */
    tick(G, dt) {
      const P = G.player, r = this.refs;
      if (!P) return;
      r.objText.textContent = G.obj().text;
      r.objSub.textContent = G.obj().sub;
      r.day.textContent = G.day;
      const dayFrac = G.phase === 'night' ? 0 : G.clock / 240;
      r.phase.textContent = G.phase === 'night' ? 'GECE'
        : (G.phase === 'dusk' ? 'ALACAKARANLIK'
          : (dayFrac > 0.90 ? 'ŞAFAK' : (dayFrac < 0.22 ? 'GÜN SONU' : 'GÜNDÜZ')));
      r.time.textContent = fmtTime(G.clock);
      const total = G.phase === 'night' ? 120 : 240;
      r.clockFill.style.width = clamp(G.clock / total * 100, 0, 100) + '%';
      r.clockFill.style.background = G.phase === 'night' ? '#6fe3ff' : (G.phase === 'dusk' ? '#ff6a3a' : '#ffb347');
      r.danger.classList.toggle('hidden', !(G.nearestGrieverProx > 0.42));
      /* barlar */
      r.barHp.style.width = clamp(P.hp / P.maxHp * 100, 0, 100) + '%';
      r.valHp.textContent = Math.max(0, Math.round(P.hp));
      r.barSt.style.width = clamp(P.stam, 0, 100) + '%';
      r.valSt.textContent = Math.round(P.stam);
      r.barNoise.style.width = clamp(P.noise * 100, 0, 100) + '%';
      r.valNoise.textContent = Math.round(P.noise * 100);
      r.barTorch.style.width = clamp(G.torchCharge, 0, 100) + '%';
      r.torchState.textContent = P.torchOn ? 'AÇIK' : 'KAPALI';
      r.runeCount.textContent = G.runesRead.length + '/8';
      r.condPoi.classList.toggle('hidden', P.poison < 1);
      r.condHun.classList.toggle('hidden', P.hunger > 25);
      r.condCra.classList.toggle('hidden', P.cold < 0.4);
      /* araç çubukları */
      const labels = ['FENER', 'İZLEYİCİ', 'MIZRAK', 'SERUM'];
      const counts = [G.tools.fener, G.tools.izleyici, G.tools.mizrak, G.resources.serum];
      r.slots.forEach((el, i) => {
        el.classList.toggle('active', G.tool === i);
        el.querySelector('.ic').textContent = labels[i];
        el.querySelector('.cnt').textContent = counts[i] > 0 ? 'x' + counts[i] : '—';
      });
      /* animasyon katmanları */
      this.dmgFx = Math.max(0, this.dmgFx - dt * 1.6);
      r.fxDamage.style.opacity = (this.dmgFx * 0.8).toFixed(2);
      r.fxPoison.style.opacity = clamp(P.poison / 90, 0, 0.9).toFixed(2);
      r.fxNight.style.opacity = (this.nightF * 0.30).toFixed(2);
      let glitch = G.nearestGrieverProx > 0.55 ? Math.random() * 0.12 * G.nearestGrieverProx : 0;
      if (this.scanFx > 0) { this.scanFx -= dt * 1.4; glitch = Math.max(glitch, this.scanFx * 0.5); }
      r.fxGlitch.style.opacity = glitch.toFixed(2);
      r.fxGlitch.style.background = this.scanFx > 0 ? 'rgba(120,240,255,.35)' : 'rgba(120,200,255,.10)';
      if (this.hitFx > 0) this.hitFx -= dt * 2.2;
      /* etkileşim + rune bilgisi */
      const rune = G.runeNear();
      if (rune && !this.modalOpen()) {
        const known = G.runesRead.indexOf(rune.idx) >= 0;
        this.setPrompt((known ? 'VERİ: ' + rune.digit + ' (sıra ' + (rune.idx + 1) + ') — kayıtlı' : 'RUNE VERİSİNİ OKU') + '  [E]');
      }
      /* mesaj süreleri */
      if (this.msgT > 0) { this.msgT -= dt; if (this.msgT <= 0) r.msgcard.classList.add('hidden'); }
      if (this.subT > 0) { this.subT -= dt; if (this.subT <= 0) r.subtitle.classList.remove('on'); }
      if (this.toastT > 0) { this.toastT -= dt; if (this.toastT <= 0) r.toast.classList.remove('on'); }
      if (this.hintT > 0) { this.hintT -= dt; if (this.hintT <= 0) r.hint.classList.remove('on'); }
      this.drawCompass(G);
      if (this.mapOpen) this.drawMap(G);
      /* FPS sayacı */
      if (this.fpsVisible && this.refs.fps) {
        this.fpsAcc = (this.fpsAcc || 0) + dt;
        this.fpsFrames = (this.fpsFrames || 0) + 1;
        if (this.fpsAcc >= 0.5) {
          const fps = Math.round(this.fpsFrames / this.fpsAcc);
          this.refs.fps.textContent = fps + ' FPS · ' + MV.Renderer.W + '×' + MV.Renderer.H +
            ' · ' + (G.view.entities.length) + ' nesne';
          this.fpsAcc = 0; this.fpsFrames = 0;
        }
      }
    },
    setPrompt(txt) {
      const r = this.refs;
      if (!txt) { r.interact.classList.add('hidden'); return; }
      r.interactTxt.textContent = txt;
      r.interact.classList.remove('hidden');
    },
    syncSlots() { if (this.refs.G) this.tick(this.refs.G, 0); },
    runeRead(rn) {
      const G = this.refs.G;
      const digits = MV.K.RUNE_ORDER.map((d, i) => G.runesRead.indexOf(i) >= 0 ? String(d) : '·').join(' ');
      this.modal({
        kicker: 'VERİ PARÇASI ' + (rn.idx + 1) + '/8', title: 'RUNE TAŞI',
        html: `<div style="text-align:center;font-size:64px;color:#ffb347;text-shadow:0 0 30px rgba(255,179,71,.5);margin:10px 0">${rn.digit}</div>
          <p class="dim">Taşın yüzeyinde rakam ve okunma sırası kazınmış: <span class="amber">sıra ${rn.idx + 1}</span>.</p>
          <p>Topladığın dizi: <span class="amber" style="letter-spacing:.3em">${digits}</span></p>
          ${G.runesRead.length >= 8 ? '<p class="cyan">Dizi tamam. Bu rakamlar bir dairenin çevresinin çapına oranı… KODU KAPAĞA GİR.</p>' : ''}`,
        buttons: [{ label: 'KAYDET', cls: 'primary wide', fn: () => this.closeModal() }]
      });
    },
    msg(title, body) {
      const r = this.refs;
      r.msgcard.innerHTML = '<div class="m-kicker">WICKED MESAJI</div><div class="m-title">' + title + '</div><div class="dim" style="margin-top:6px">' + body + '</div>';
      r.msgcard.classList.remove('hidden');
      r.msgcard.classList.add('glitchy');
      this.msgT = 4.2;
      MV.Audio.ui();
    },
    subtitle(txt) {
      const r = this.refs;
      r.subtitle.innerHTML = txt;
      r.subtitle.classList.add('on');
      this.subT = 6;
    },
    toast(txt) {
      const r = this.refs;
      r.toast.textContent = txt;
      r.toast.classList.add('on');
      this.toastT = 2.2;
    },
    hint(txt) {
      const r = this.refs;
      r.hint.textContent = txt;
      r.hint.classList.add('on');
      this.hintT = 8;
    },
    damage() { this.dmgFx = 1; },
    hitMark() { this.hitFx = 1; },
    scan() { this.scanFx = 1; },
    setNight(f) { this.nightF = f; },
    setQuality(q) {
      MV.Renderer.setQuality(q);
      this.quality = q;
      const cv = this.refs.view;
      // iç çözünürlük değişti: nişangah/HUD ölçeklenir
      this.refs.fxGlitch.style.opacity = 0;
      try { localStorage.setItem('labirent-quality', String(q)); } catch (e) { }
      this.toast(q === 1 ? 'GÖRÜNTÜ: YÜKSEK ÇÖZÜNÜRLÜK' : 'GÖRÜNTÜ: PERFORMANS');
    },
    log(entry) {
      const r = this.refs;
      const d = document.createElement('div');
      d.textContent = '> ' + entry.txt;
      r.log.appendChild(d);
      while (r.log.children.length > 6) r.log.removeChild(r.log.firstChild);
      setTimeout(() => { if (d.parentNode) d.style.opacity = '0.35'; }, 6000);
    },
    buildLog() {
      const G = this.refs.G;
      MV.onLog = (e) => this.log(e);
      const r = this.refs;
      r.log.innerHTML = '';
    },
    buildRuneStrip() {
      const r = this.refs;
      r.runes.innerHTML = '';
      for (let i = 0; i < 8; i++) {
        const el = document.createElement('i');
        el.id = 'rune' + i;
        el.textContent = '·';
        r.runes.appendChild(el);
      }
    },
    /* ============================================================
       PUSULA
       ============================================================ */
    drawCompass(G) {
      const c = this.cctx, W = 420, H = 34;
      if (!c || !G.player) return;
      c.clearRect(0, 0, W, H);
      const P = G.player;
      const span = 140 * Math.PI / 180;      // görünen açı
      const x0 = 0, cx = W / 2;
      c.fillStyle = 'rgba(4,8,10,.55)';
      c.fillRect(0, 0, W, H);
      /* derece çizgileri */
      for (let d = -70; d <= 70; d += 5) {
        const a = P.a + d * Math.PI / 180;
        const x = cx + (d / 70) * (W / 2 - 6);
        const big = (d % 15 === 0);
        c.strokeStyle = big ? 'rgba(255,179,71,.55)' : 'rgba(140,180,160,.25)';
        c.beginPath(); c.moveTo(x, H - 6); c.lineTo(x, H - (big ? 14 : 10)); c.stroke();
      }
      /* yön harfleri */
      const dirs = [[0, 'D'], [Math.PI / 2, 'G'], [Math.PI, 'B'], [3 * Math.PI / 2, 'K']];
      c.font = 'bold 10px monospace'; c.textAlign = 'center'; c.textBaseline = 'middle';
      for (const [a, ch] of dirs) {
        let dd = MV.angDiff(a, P.a) * 180 / Math.PI;
        if (Math.abs(dd) > 72) continue;
        const x = cx + (dd / 70) * (W / 2 - 6);
        c.fillStyle = 'rgba(255,179,71,.85)';
        c.fillText(ch, x, 9);
      }
      /* ilgi noktaları */
      const marks = [];
      marks.push({ x: G.world.cx, y: G.world.cy, col: '#8dff7a', ch: 'K' });
      if (G.knownProps['hatch'] || G.runesRead.length >= 8) marks.push({ x: G.world.hatch.x, y: G.world.hatch.y, col: '#6fe3ff', ch: 'Ç' });
      /* gece yaklaşırken dışarıdaysan geçitler görünür: filmin temel kuralı */
      const inGlade = Maze.rad(G.world, P.x, P.y) < MV.K.R1 + 1;
      if (!inGlade && G.phase !== 'night') {
        for (const a of MV.K.GAP_ANGLES) {
          marks.push({ x: G.world.cx + Math.cos(a) * (MV.K.R1 + 1.5), y: G.world.cy + Math.sin(a) * (MV.K.R1 + 1.5), col: G.phase === 'dusk' ? '#ff6a3a' : 'rgba(141,255,122,.8)', ch: 'G' });
        }
      }
      if (this.tracker && G.tools.izleyici > 0) {
        if (G.knownProps['hive']) marks.push({ x: G.world.hive.x, y: G.world.hive.y, col: '#ff6a9a', ch: 'Y' });
        const unread = G.world.runes.filter(r => G.runesRead.indexOf(r.idx) < 0);
        if (unread.length) {
          let best = unread[0], bd = 1e9;
          for (const u of unread) { const d = MV.dist(u.x, u.y, P.x, P.y); if (d < bd) { bd = d; best = u; } }
          marks.push({ x: best.x + .5, y: best.y + .5, col: '#ffb347', ch: 'V' });
        }
      }
      c.textBaseline = 'alphabetic';
      for (const m of marks) {
        const a = Math.atan2(m.y - P.y, m.x - P.x);
        const dd = MV.angDiff(a, P.a) * 180 / Math.PI;
        if (Math.abs(dd) > 71) continue;
        const x = cx + (dd / 70) * (W / 2 - 6);
        c.fillStyle = m.col;
        c.fillRect(x - 1, 20, 2, 8);
      }
      /* merkez işaretçi */
      c.fillStyle = '#ffb347';
      c.fillRect(cx - 1, 0, 2, H);
      /* bölüm etiketi */
      const sec = Maze.sectorAt(G.world, P.x, P.y);
      const r = Maze.rad(G.world, P.x, P.y);
      this.refs.sectorTag.textContent = sec === 255
        ? (r < MV.K.R1 ? 'KAYRAN' : (r > MV.K.RAV1 ? 'DIŞ KUŞAK' : 'HALKA YOLU'))
        : 'BÖLÜM ' + (sec + 1);
    },
    setHudScale(v) {
      this.hudScale = v || 1;
      const hud = this.refs.hud;
      if (hud && hud.style) hud.style.zoom = String(this.hudScale);
    },
    setFpsVisible(on) {
      this.fpsVisible = !!on;
      const el = this.refs.fps;
      if (el && el.classList) el.classList.toggle('hidden', !on);
      if (el) el.style.display = on ? '' : 'none';
    },
    hideOverlaysForShot() {
      if (this.refs.hud && this.refs.hud.style) this.refs.hud.style.display = 'none';
      if (this.refs.fx && this.refs.fx.style) this.refs.fx.style.display = 'none';
      if (this.refs.modal && this.refs.modal.style) this.refs.modal.style.display = 'none';
    },
    showOverlaysAfterShot() {
      if (this.refs.hud && this.refs.hud.style) this.refs.hud.style.display = '';
      if (this.refs.fx && this.refs.fx.style) this.refs.fx.style.display = '';
      if (this.refs.modal) this.refs.modal.style.display = '';
    },
    setPointerLockUI(locked) {
      if (locked) { this.lockHintShown = true; return; }
      if (this.lockHintShown || this.modalOpen()) return;
      this.lockHintShown = true;
      this.hint('FARE İLE BAKMAK İÇİN EKRANI SÜRÜKLE — SOL TIK: SALDIRI, SAĞ TIK: ETKİLEŞİM');
    },
    toggleTracker() {
      this.tracker = !this.tracker;
      MV.Audio.ui();
      this.toast(this.tracker ? 'İZLEYİCİ AÇIK' : 'İZLEYİCİ KAPALI');
    },
    trackerOn() { return this.tracker && this.refs.G.tools.izleyici > 0; },

    /* ============================================================
       HARİTA
       ============================================================ */
    openMap() {
      const G = this.refs.G;
      this.mapOpen = true;
      this.modal({
        kicker: 'İZLEYİCİ / HAFIZA', title: 'HARİTA — BİLDİĞİN KADARI',
        html: '<div class="mapwrap"><canvas id="map-c" width="380" height="380"></canvas>' +
          '<div class="maplegend">' +
          '<div><i style="background:#3b4a3f"></i>duvar (görülen)</div>' +
          '<div><i style="background:#151b18"></i>koridor</div>' +
          '<div><i style="background:#8dff7a"></i>Kayran</div>' +
          '<div><i style="background:#ffb347"></i>rune verisi</div>' +
          '<div><i style="background:#6fe3ff"></i>çıkış kapağı</div>' +
          '<div><i style="background:#ff6a9a"></i>kovan</div>' +
          '<div class="dim" style="margin-top:8px">Harita yalnızca yürüdüğün yerleri hatırlar. Kaydırma sonrası eski bilgiler yanıltır.</div>' +
          '</div></div>',
        buttons: [{ label: 'KAPAT', cls: 'primary wide', fn: () => { this.mapOpen = false; this.closeModal(); } }],
        onShow: () => this.bindMap(G),
        escClose: true
      });
    },
    bindMap(G) {
      this.mapCanvas = document.getElementById('map-c');
      if (this.mapCanvas && this.mapCanvas.getContext) {
        this.mctx = this.mapCanvas.getContext('2d');
        this.drawMap(G);
      }
    },
    drawMap(G) {
      const c = this.mctx; if (!c) return;
      const w = G.world, P = G.player, S = 380, R = 46;   // görünen yarıçap (karo)
      const scale = S / (R * 2);
      c.fillStyle = '#04070a'; c.fillRect(0, 0, S, S);
      const cxp = Math.floor(P.x), cyp = Math.floor(P.y);
      /* ızgara */
      for (let y = cyp - R; y <= cyp + R; y++) {
        for (let x = cxp - R; x <= cxp + R; x++) {
          if (x < 0 || y < 0 || x >= w.W || y >= w.H) continue;
          const i = y * w.W + x;
          if (!G.known[i]) continue;
          let col = null;
          if (w.void[i]) col = '#0a1420';
          else if (w.solid[i]) col = w.hidden[i] ? '#2c4a2c' : '#3b4a3f';
          else col = (w.floor[i] === T.GRASS ? '#1d3320' : (w.floor[i] === T.GRATE ? '#2a3a44' : '#151b18'));
          if (w.gate[i]) col = w.gate[i] ? '#7a5a20' : col;
          c.fillStyle = col;
          c.fillRect((x - cxp + R) * scale, (y - cyp + R) * scale, Math.ceil(scale), Math.ceil(scale));
        }
      }
      /* kayran sınırı */
      c.strokeStyle = 'rgba(141,255,122,.35)'; c.lineWidth = 1;
      c.beginPath();
      c.arc((w.cx - cxp + R) * scale, (w.cy - cyp + R) * scale, MV.K.R1 * scale, 0, TAU);
      c.stroke();
      c.beginPath();
      c.arc((w.cx - cxp + R) * scale, (w.cy - cyp + R) * scale, MV.K.RAV0 * scale, 0, TAU);
      c.strokeStyle = 'rgba(120,160,255,.18)'; c.stroke();
      /* rune taşları */
      for (const rn of w.runes) {
        const known = G.runesRead.indexOf(rn.idx) >= 0 || G.known[rn.y * w.W + rn.x];
        if (!known) continue;
        const read = G.runesRead.indexOf(rn.idx) >= 0;
        c.fillStyle = read ? '#ffb347' : '#8a6a2a';
        const px = (rn.x - cxp + R) * scale, py = (rn.y - cyp + R) * scale;
        c.fillRect(px - 2, py - 2, 5, 5);
        if (read) { c.fillStyle = '#000'; c.font = 'bold 6px monospace'; c.fillText(String(rn.digit), px + 1, py + 3); }
      }
      /* önemli noktalar */
      const pts = [
        [w.hatch.x, w.hatch.y, '#6fe3ff', 'Ç'],
        [w.hive.x, w.hive.y, '#ff6a9a', 'K'],
        [w.cx, w.cy, '#8dff7a', 'A']
      ];
      for (const [x, y, col, ch] of pts) {
        const k = ch === 'Ç' ? 'hatch' : (ch === 'K' ? 'hive' : null);
        if (k && !G.knownProps[k] && !(ch === 'Ç' && G.runesRead.length >= 8)) continue;
        c.fillStyle = col;
        const px = (x - cxp + R) * scale, py = (y - cyp + R) * scale;
        c.beginPath(); c.arc(px, py, 4, 0, TAU); c.fill();
        c.fillStyle = '#000'; c.font = 'bold 7px monospace'; c.fillText(ch, px - 2, py + 2.5);
      }
      /* oyuncu */
      const cx = R * scale, cy = R * scale;
      c.save(); c.translate(cx, cy); c.rotate(P.a);
      c.fillStyle = '#fff';
      c.beginPath(); c.moveTo(6, 0); c.lineTo(-4, -4); c.lineTo(-4, 4); c.closePath(); c.fill();
      c.restore();
      c.strokeStyle = 'rgba(255,255,255,.18)';
      c.strokeRect(0.5, 0.5, S - 1, S - 1);
    },

    /* ============================================================
       GÜNLÜK
       ============================================================ */
    openJournal() {
      const G = this.refs.G;
      const digits = MV.K.RUNE_ORDER.map((d, i) => {
        const has = G.runesRead.indexOf(i) >= 0;
        return '<i class="' + (has ? 'on' : '') + '">' + (has ? d : '·') + '</i>';
      }).join('');
      const res = [['lif', 'BİTKİ LİFİ'], ['celik', 'ÇELİK'], ['recine', 'REÇİNE'], ['gida', 'KONSERVE'], ['pil', 'PİL'], ['serum', 'SERUM']]
        .map(([k, n]) => '<div><span>' + n + '</span><b>' + (G.resources[k] || 0) + '</b></div>').join('');
      const tools = [['fener', 'FENER'], ['izleyici', 'İZLEYİCİ'], ['mizrak', 'MIZRAK'], ['halat', 'HALAT']]
        .map(([k, n]) => '<div><span>' + n + '</span><b>' + (G.tools[k] || 0) + '</b></div>').join('');
      this.modal({
        kicker: 'GÜNLÜK — GÜN ' + G.day, title: 'VERİ VE ÇANTA',
        html: `<h3>TOPLANAN VERİ — π DİZİSİ</h3>
          <div class="runeRow">${digits}</div>
          <p class="dim">${G.runesRead.length}/8 parça. Rakamlar sıraya göre dizildiğinde WICKED'in çıkış kodunu verir.</p>
          <h3>MALZEME</h3><div class="keys">${res}</div>
          <h3>ARAÇLAR</h3><div class="keys">${tools}</div>
          <h3>DURUM</h3>
          <div class="keys">
            <div><span>Öldürülen Grievers</span><b>${G.meta.kills}</b></div>
            <div><span>Labirentte geçen süre</span><b>${Math.round(G.meta.time / 60)} dk</b></div>
            <div><span>Kutu anahtarı</span><b>${G.hasKey ? 'VAR' : 'YOK'}</b></div>
            <div><span>Kaydırma sayısı</span><b>${G.day - 1}</b></div>
          </div>`,
        buttons: [{ label: 'KAPAT', cls: 'primary wide', fn: () => this.closeModal() }],
        escClose: true
      });
    },

    /* ============================================================
       KUTU (ÜRETİM) / ARŞİV / BARAKA
       ============================================================ */
    openCraft() {
      const G = this.refs.G;
      const rows = MV.Game.craftList().map(rec => {
        const can = G.canCraft(rec.id);
        const cost = Object.keys(rec.cost).map(k => {
          const have = G.resources[k] || 0;
          const enough = have >= rec.cost[k];
          return '<b style="color:' + (enough ? '#6fe3ff' : '#ff6a5a') + '">' + rec.cost[k] + '×' + (MV.Game.itemName(k)) + '</b>';
        }).join(' ');
        return `<div class="craftItem">
            <div class="ci-info"><div class="ci-name">${rec.name}</div>
            <div class="ci-cost">${rec.desc}<br>${cost}</div></div>
            <button class="btn ${can ? 'primary' : ''}" data-craft="${rec.id}">ÜRET</button>
          </div>`;
      }).join('');
      const res = [['lif', 'LİF'], ['celik', 'ÇELİK'], ['recine', 'REÇİNE'], ['gida', 'KONSERVE'], ['pil', 'PİL']]
        .map(([k, n]) => n + ': ' + (G.resources[k] || 0)).join('   ·   ');
      this.modal({
        kicker: 'KUTU — WICKED ÜRETİM TERMİNALİ', title: 'ÜRETİM',
        html: `<p class="dim">Çantandaki malzeme: ${res}</p>${rows}`,
        buttons: [{ label: 'KAPAT', cls: 'primary wide', fn: () => this.closeModal() }],
        escClose: true
      });
      this.refs.modal.querySelectorAll('[data-craft]').forEach(btn => {
        btn.onclick = () => {
          const id = btn.getAttribute('data-craft');
          if (G.craft(id)) this.openCraft();
        };
      });
    },
    openArchive() {
      this.modal({
        kicker: 'WICKED ARŞİVİ — TABLET 07', title: 'PROTOKOL NOTLARI',
        html: `<p>“Deney sahası 7. Labirent, öznelerin zihinsel haritasını ölçer.
        Duvarlar gün doğumunda yeniden dizilir; böylece hiçbir zihin tam bir harita kuramaz.</p>
        <p>Çıkış kodu, öznelerin çoğunun çocukluktan bildiği bir sabitten türetilir:
        <span class="amber">bir dairenin çevresinin çapına oranı</span>.
        Kodun her basamağı labirentin bir taşına kazınmıştır ve sırası taşın üstündedir.</p>
        <p>Geçitler alacakaranlıkta kapanır. Dışarıda kalan özne, <span class="red">Griever</span> testine tabidir.</p>
        <p>Kovan, tüm prototiplerin anasıdır. Aşağısı sıcaktır. Anahtar oradadır.”</p>
        <p class="dim">— doktor A., iki gün önce kayıt bıraktı</p>`,
        buttons: [{ label: 'KAPAT', cls: 'primary wide', fn: () => this.closeModal() }]
      });
    },
    openHut() {
      this.modal({
        kicker: 'BARAKA', title: 'İZLER',
        html: `<p>Bir yatak, paslı bir konserve açacağı ve tahtaya kazınmış isimler:
        <span class="dim">ALBY, NEWT, MINHO, CHUCK…</span> ve en altta taze çentikler.</p>
        <p>"Kimse dışarı çıkmadı. Ama her ay bir kişi geldi."</p>
        <p class="dim">Duvarda bir çentiğin yanında şu yazıyor: <span class="amber">“Kod bir sayı. Bir çocuk bile bilir.”</span></p>`,
        buttons: [{ label: 'ÇIK', cls: 'primary wide', fn: () => this.closeModal() }]
      });
    },
    openHive() {
      const G = this.refs.G;
      this.modal({
        kicker: 'KOVAN — GRIEVER YUVASI', title: 'AŞAĞI İN',
        html: `<p>Kovanın ağzı nefes alıyor gibi. İçeride metal, reçine ve sıcak et kokusu var.
        Griever'ların çoğu gece buradan çıkıyor. Anahtar aşağıda, prototip yatağının yanında.</p>
        <p class="amber">Halatını kullanacaksın (1 adet). Aşağı inmek gürültü yapar — muhafız uyanır.</p>`,
        buttons: [
          { label: 'HALATI SAL VE İN', cls: 'danger wide', fn: () => G.descendHive() },
          { label: 'VAZGEÇ', cls: 'wide', fn: () => this.closeModal() }
        ]
      });
    },

    /* ============================================================
       TUŞ TAKIMI (ÇIKIŞ KODU)
       ============================================================ */
    openKeypad() {
      const G = this.refs.G;
      this.keypadOn = true;
      this.keypadVal = '';
      this.keypadTries = 0;
      this.renderKeypad();
    },
    renderKeypad(err) {
      const G = this.refs.G;
      let keys = '';
      for (let i = 1; i <= 9; i++) keys += `<button class="btn" data-k="${i}">${i}</button>`;
      keys += `<button class="btn" data-k="C">C</button><button class="btn" data-k="0">0</button><button class="btn" data-k="OK">↵</button>`;
      this.modal({
        kicker: 'ÇIKIŞ KAPAĞI — WICKED MÜHRÜ', title: 'KOD GİRİŞİ',
        html: `<div class="kp-display ${err ? 'err' : ''}" id="kp-display">${this.keypadVal || '—'}</div>
          <div class="keypad">${keys}</div>
          <p class="dim">8 haneli kod. ${G.hasKey ? '' : '<span class="red">Anahtar olmadan kapak açılmaz.</span>'}
          ${G.runesRead.length ? 'Günlüğündeki diziye bak (TAB).' : 'Önce rune taşlarını oku.'}</p>`,
        buttons: [{ label: 'KAPAT', cls: 'primary wide', fn: () => { this.keypadOn = false; this.closeModal(); } }],
        escClose: true
      });
      this.refs.modal.querySelectorAll('[data-k]').forEach(b => {
        b.onclick = () => {
          const k = b.getAttribute('data-k');
          if (k === 'C') { this.keypadVal = ''; MV.Audio.ui(); this.renderKeypad(); }
          else if (k === 'OK') this.keypadSubmit();
          else this.keypadPress(k);
        };
      });
    },
    keypadPress(ch) {
      if (this.keypadVal.length >= 8) return;
      this.keypadVal += ch;
      MV.Audio.ui();
      this.renderKeypad();
    },
    keypadSubmit() {
      const G = this.refs.G;
      if (this.keypadVal.length < 8) { this.toast('KOD 8 HANE'); MV.Audio.deny(); return; }
      if (G.tryCode(this.keypadVal)) {
        this.keypadOn = false;
        G.openHatch();
      } else {
        this.keypadTries++;
        MV.Audio.deny();
        this.keypadVal = '';
        this.renderKeypad(true);
        this.toast('KOD REDDEDİLDİ (' + this.keypadTries + ')');
        if (this.keypadTries >= 3) {
          this.toast('WICKED CEZASI: GRIEVERS UYANDI');
          for (const g of G.grievers) { if (!g.dead && MV.dist(g.x, g.y, G.player.x, G.player.y) < 60) { g.aggro = true; g.repath = 0; } }
          this.keypadTries = 0;
        }
      }
    },

    /* ============================================================
       ÖLÜM / KAZANMA / DURAKLATMA
       ============================================================ */
    death(cause, msg) {
      const G = this.refs.G;
      const reasons = {
        griever: 'Bir Grievers seni duvarların arasında buldu.',
        zehir: 'Zehir kanına karıştı. Serum yoktu.',
        açlık: 'Açlık seni yavaşça bitirdi.',
        soğuk: 'Gece dışarıda kaldın. Soğuk ve karanlık.',
        uçurum: 'Uçurum. WICKED seni kurtarmadı.',
        temizlik: 'WICKED deneyi kapattı.'
      };
      this.modal({
        kicker: 'ÖZNE A7 — KAYIT SONU', title: 'ÖLDÜN',
        html: `<p class="red">${msg || reasons[cause] || 'Labirent seni aldı.'}</p>
          <p class="dim">Gün ${G.day} · ${G.runesRead.length}/8 veri · ${G.meta.kills} Grievers etkisiz</p>
          <p>WICKED, deneyi sürdürmek için özneyi geri getirebilir. Ama her dönüş biraz daha pahalıdır.</p>`,
        buttons: [
          { label: 'KAYRAN’DA UYAN (CEZA: YARIM CAN)', cls: 'primary wide', fn: () => G.respawn() },
          { label: 'YENİDEN BAŞLA', cls: 'wide', fn: () => { G.newGame((Math.random() * 1e9) | 0); this.closeModal(); } }
        ]
      });
    },
    win() {
      const G = this.refs.G;
      this.modal({
        kicker: 'PROTOKOL SONU', title: 'KAÇIŞ',
        html: `<p>Kapak yukarı kaydı ve seni ışık aldı: laboratuvar, cam bölmeler, üniformalı insanlar.
        WICKED seni izlerken sen kodu çözdün — sistemde ilk kez bir özne kaçtı.</p>
        <p class="cyan">BÖLÜM 2 VERİSİ AÇILDI: “Kovan sadece bir başlangıçtı, A7.”</p>
        <h3>DENEY RAPORU</h3>
        <div class="keys">
          <div><span>Kaçış günü</span><b>${G.day}</b></div>
          <div><span>Toplanan veri</span><b>${G.runesRead.length}/8</b></div>
          <div><span>Etkisiz bırakılan Grievers</span><b>${G.meta.kills}</b></div>
          <div><span>Labirent süresi</span><b>${Math.round(G.meta.time / 60)} dk</b></div>
        </div>`,
        buttons: [
          { label: 'YENİ DENEY', cls: 'primary wide', fn: () => { G.newGame((Math.random() * 1e9) | 0); this.seenIntro = true; this.intro(); } },
          { label: 'ANA MENÜ', cls: 'wide', fn: () => this.showTitle() }
        ]
      });
      MV.Desktop.save.remove(0);
    },
    togglePause() {
      const G = this.refs.G;
      if (this.modalOpen()) { this.closeModal(); G.paused = false; return; }
      G.paused = true;
      const auto = MV.Desktop.save.list()[0];
      const autoLine = auto.empty ? '<span class="dim">otomatik kayıt yok</span>'
        : '<span class="amber">Gün ' + auto.day + ' · ' + (auto.phase === 'night' ? 'gece' : 'gündüz') + '</span>';
      this.modal({
        kicker: 'SİSTEM', title: 'DURAKLATILDI',
        html: `<div class="savebar"><div><span class="k">OTOMATİK KAYIT</span> ${autoLine}</div>
          <div class="dim">Gün ${G.day} · veri ${G.runesRead.length}/8 · ${G.meta.kills} griever · ${Math.round(G.meta.time / 60)} dk</div></div>
          <p class="dim">Deney askıya alındı. Labirent bekliyor.</p>`,
        buttons: [
          { label: 'DEVAM', cls: 'primary wide', fn: () => { G.paused = false; this.closeModal(); } },
          { label: 'KAYDET', cls: 'wide', fn: () => this.openSaveSlots('save') },
          { label: 'KAYIT YÜKLE', cls: 'wide', fn: () => this.openSaveSlots('load') },
          { label: 'AYARLAR', cls: 'wide', fn: () => this.openSettings(false) },
          { label: 'BAŞARIMLAR (' + G.achievementCount() + '/' + G.achievementTotal() + ')', cls: 'wide', fn: () => this.openAchievements('pause') },
          { label: 'KONTROLLER', cls: 'wide', fn: () => this.showControls(false) },
          { label: 'ANA MENÜ', cls: 'wide', fn: () => { G.paused = false; G.save(0); this.showTitle(); } },
          MV.Desktop.isDesktop ? { label: 'ÇIKIŞ', cls: 'danger wide', fn: () => MV.Desktop.quit() } : null
        ].filter(Boolean),
        escClose: true
      });
    },

    setObjective(obj) {
      const r = this.refs;
      if (obj) { r.objText.textContent = obj.text; r.objSub.textContent = obj.sub; }
      const G = this.refs.G;
      if (G && obj && obj.hint) this.hint(obj.hint);
    }
  };

  MV.UI = UI;

  /* ---------- açılış ---------- */
  function boot() {
    const canvas = document.getElementById('view');
    MV.UI.init(MV.Game);
    MV.Game.init(canvas);
    MV.UI.syncSlots();
    // dokunmatik/klavyesiz cihaz uyarısı
    const touchOnly = ('ontouchstart' in window) && !window.matchMedia('(pointer: fine)').matches;
    if (touchOnly) {
      const w = document.getElementById('boot-warn');
      if (w) w.classList.remove('hidden');
      w && w.addEventListener('click', () => w.classList.add('hidden'));
    }
    MV.UI.subtitle('Kutu seni bıraktı. Kayran’dasın.');
  }
  if (typeof window !== 'undefined') {
    if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', boot);
    else boot();
  }
})(MV);
