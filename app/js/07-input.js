/* ============================================================
   07-input.js — giriş modeli: eylemler, tuş atamaları, fare/kol
   Tuş atamaları settings.json içinde saklanır; oyun içinden
   değiştirilebilir (bkz. 70-ui.js → KONTROLLER → tuşa bas).
   ============================================================ */
(function (MV) {
  'use strict';

  /* Eylem listesi: kimlik → etiket + varsayılan tuş(lar) + grup */
  const ACTIONS = [
    { id: 'forward',   label: 'İlerle',            keys: ['KeyW', 'ArrowUp'],        group: 'HAREKET' },
    { id: 'back',      label: 'Geri',              keys: ['KeyS', 'ArrowDown'],      group: 'HAREKET' },
    { id: 'left',      label: 'Sola yürü',         keys: ['KeyA'],                   group: 'HAREKET' },
    { id: 'right',     label: 'Sağa yürü',         keys: ['KeyD'],                   group: 'HAREKET' },
    { id: 'sprint',    label: 'Koş',               keys: ['ShiftLeft', 'ShiftRight'], group: 'HAREKET' },
    { id: 'crouch',    label: 'Eğil',              keys: ['KeyC', 'ControlLeft'],    group: 'HAREKET' },
    { id: 'jump',      label: 'Zıpla / tırman',    keys: ['Space'],                  group: 'HAREKET' },
    { id: 'interact',  label: 'Etkileşim',         keys: ['KeyE'],                   group: 'EYLEM' },
    { id: 'attack',    label: 'Saldır / kullan',   keys: ['KeyQ'],                   group: 'EYLEM' },
    { id: 'torch',     label: 'Fener',             keys: ['KeyF'],                   group: 'EYLEM' },
    { id: 'tool1',     label: '1. araç',           keys: ['Digit1'],                 group: 'ARAÇLAR' },
    { id: 'tool2',     label: '2. araç',           keys: ['Digit2'],                 group: 'ARAÇLAR' },
    { id: 'tool3',     label: '3. araç',           keys: ['Digit3'],                 group: 'ARAÇLAR' },
    { id: 'tool4',     label: '4. araç',           keys: ['Digit4'],                 group: 'ARAÇLAR' },
    { id: 'toolNext',  label: 'Sonraki araç',      keys: ['KeyX'],                   group: 'ARAÇLAR' },
    { id: 'map',       label: 'Harita',            keys: ['KeyM'],                   group: 'ARAYÜZ' },
    { id: 'journal',   label: 'Günlük',            keys: ['Tab'],                    group: 'ARAYÜZ' },
    { id: 'pause',     label: 'Duraklat',          keys: ['Escape'],                 group: 'ARAYÜZ' },
    { id: 'achievements', label: 'Başarımlar',     keys: ['F2'],                     group: 'ARAYÜZ' },
    { id: 'quicksave', label: 'Hızlı kaydet',      keys: ['F5'],                     group: 'SİSTEM' },
    { id: 'quickload', label: 'Hızlı yükle',       keys: ['F9'],                     group: 'SİSTEM' },
    { id: 'screenshot', label: 'Ekran görüntüsü',  keys: ['F12'],                    group: 'SİSTEM' },
    { id: 'fullscreen', label: 'Tam ekran',        keys: ['F11'],                    group: 'SİSTEM' }
  ];

  const Input = {
    ACTIONS: ACTIONS,
    map: {},
    defaults: null,
    /* kurulum: ayarlardaki atamaları yükle, eksikleri varsayılanla doldur */
    init(settings) {
      this.defaults = {};
      for (const a of ACTIONS) this.defaults[a.id] = a.keys.slice();
      this.map = {};
      const saved = (settings && settings.keymap) || null;
      for (const a of ACTIONS) {
        const v = saved && Array.isArray(saved[a.id]) ? saved[a.id].filter(k => typeof k === 'string' && k.length) : null;
        this.map[a.id] = (v && v.length) ? v.slice(0, 3) : a.keys.slice();
      }
      return this.map;
    },
    actionFor(code) {
      for (const id in this.map) if (this.map[id].indexOf(code) >= 0) return id;
      return null;
    },
    keysFor(id) { return this.map[id] || []; },
    label(id) {
      const a = ACTIONS.filter(x => x.id === id)[0];
      return a ? a.label : id;
    },
    /* basılı mı (klavye durumu sözlüğüyle) */
    down(keys, id) {
      const list = this.map[id] || [];
      for (const k of list) if (keys[k]) return true;
      return false;
    },
    /* atamayı değiştir; aynı tuş başka eylemde kullanılıyorsa oradan kaldır */
    setBinding(id, code) {
      if (!this.map[id]) return false;
      for (const other in this.map) {
        if (other === id) continue;
        const i = this.map[other].indexOf(code);
        if (i >= 0) this.map[other].splice(i, 1);
      }
      if (this.map[id].indexOf(code) < 0) this.map[id].unshift(code);
      this.map[id] = this.map[id].slice(0, 3);
      return true;
    },
    addBinding(id, code) {
      if (!this.map[id] || this.map[id].indexOf(code) >= 0) return false;
      this.map[id].push(code);
      return true;
    },
    clear(id) { if (this.map[id]) this.map[id] = []; return true; },
    resetOne(id) { if (this.defaults[id]) this.map[id] = this.defaults[id].slice(); return true; },
    resetAll() { for (const id in this.defaults) this.map[id] = this.defaults[id].slice(); return true; },
    /* kayıt için sadeleştirilmiş kopya */
    serialize() {
      const out = {};
      for (const id in this.map) {
        if (!this.map[id].length) continue;
        if (JSON.stringify(this.map[id]) === JSON.stringify(this.defaults[id])) continue;
        out[id] = this.map[id].slice();
      }
      return out;
    },
    /* insan okuyabilir tuş adı */
    keyLabel(code) {
      if (!code) return '—';
      const named = {
        KeyW: 'W', KeyA: 'A', KeyS: 'S', KeyD: 'D', KeyE: 'E', KeyF: 'F', KeyQ: 'Q', KeyX: 'X',
        KeyC: 'C', KeyM: 'M', KeyR: 'R', KeyT: 'T', KeyZ: 'Z', KeyG: 'G', KeyH: 'H', KeyJ: 'J',
        KeyK: 'K', KeyL: 'L', KeyN: 'N', KeyO: 'O', KeyP: 'P', KeyU: 'U', KeyV: 'V', KeyB: 'B',
        KeyI: 'I', KeyY: 'Y', Tab: 'TAB', Escape: 'ESC', Space: 'BOŞLUK', Enter: 'ENTER',
        ShiftLeft: 'SOL SHIFT', ShiftRight: 'SAĞ SHIFT', ControlLeft: 'SOL CTRL', ControlRight: 'SAĞ CTRL',
        AltLeft: 'SOL ALT', AltRight: 'SAĞ ALT', Backspace: 'GERİ', Delete: 'DEL', Insert: 'INS',
        Home: 'HOME', End: 'END', PageUp: 'PGUP', PageDown: 'PGDN', CapsLock: 'CAPS',
        ArrowUp: 'YUKARI', ArrowDown: 'AŞAĞI', ArrowLeft: 'SOL', ArrowRight: 'SAĞ',
        NumpadAdd: 'NUM +', NumpadSubtract: 'NUM -', NumpadEnter: 'NUM ENTER', Numpad0: 'NUM 0'
      };
      if (named[code]) return named[code];
      if (/^F\d{1,2}$/.test(code)) return code.toUpperCase();
      if (/^Digit\d$/.test(code)) return code.slice(5);
      if (/^Numpad\d$/.test(code)) return 'NUM ' + code.slice(6);
      return code.replace(/^(Key|Arrow)/, '').toUpperCase();
    }
  };

  /* ---------------- fare eğrisi ve kol yardımcıları ---------------- */
  const Aim = {
    /* ham fare deltası → bakış açısı: hassasiyet, eğri, yumuşatma */
    apply(cur, raw, sens, curve, smoothing, dt, invert) {
      // raw: birikmiş piksel deltası
      let d = raw * sens * 0.0022;
      if (curve === 'hassas') {
        // düşük hızda ince ayar, hızlı harekette çevik dönüş
        d = Math.sign(d) * Math.pow(Math.abs(d) * 900, 1.6) / 900;
      } else if (curve === 'yumusak') {
        d = Math.tanh(d * 2.2) * 0.72;
      } else {
        // dengeli: hafif S eğrisi (küçük hareketler yumuşar, büyük hareketler tam geçer)
        d = Math.tanh(d * 3.2) * 0.3125 * (1 + Math.abs(d) * 0.35);
      }
      let out = cur + d;
      if (smoothing > 0.001) {
        const k = MV.clamp(1 - Math.pow(smoothing, Math.max(0.001, dt) * 60), 0.05, 1);
        out = MV.lerp(cur, out, k);
      }
      return out;
    },
    /* kol çubuğu: ölü bölge + anti-ölü bölge + tepki eğrisi
       mode 'cift': çift bölgeli (iç bölge ince nişan, dış bölge hızlı dönüş) —
       profesyonel nişancı oyunlarının standart hissi */
    stick(v, dead, expo, mode) {
      const a = Math.abs(v);
      if (a < dead) return 0;
      const t = (a - dead) / (1 - dead);
      const anti = 0.06;                                  // sıfırdan sıçrama olmasın
      if (mode === 'cift') {
        const inner = 0.62;                               // iç bölge sınırı
        const k = t < inner
          ? t * 0.72 / inner                              // ince: tam ölçeğin %72'si
          : 0.72 + (t - inner) / (1 - inner) * 0.28;      // dış: 1.0'a tamamla
        return Math.sign(v) * (anti + k * (1 - anti));
      }
      return Math.sign(v) * (anti + Math.pow(t, expo === undefined ? 1.6 : expo) * (1 - anti));
    },
    /* hedef yumuşatma (aim assist): görüş konisindeki en yakın düşmanı hafifçe çeker */
    assist(curAngle, targetAngle, strength, dt) {
      const d = MV.angDiff(targetAngle, curAngle);
      return curAngle + d * MV.clamp(strength * dt * 6, 0, 1);
    }
  };

  MV.Input = Input;
  MV.Aim = Aim;
})(MV);
