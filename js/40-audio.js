/* ============================================================
   40-audio.js — WebAudio ile tamamen prosedürel ses
   (dosya yok: rüzgâr, ayak sesi, griever çığlığı, geçit gıcırtısı…)
   ============================================================ */
(function (MV) {
  'use strict';
  const { clamp, lerp } = MV;

  const A = {
    ctx: null, master: null, ready: false, muted: false,
    noiseBuf: null, ambGain: null, ambSrc: null, droneGain: null, grGain: null,
    fear: 0,

    ensure() {
      if (this.ready) return true;
      const AC = (typeof window !== 'undefined') && (window.AudioContext || window.webkitAudioContext);
      if (!AC) return false;
      try {
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.85;
        this.master.connect(this.ctx.destination);
        // beyaz gürültü tamponu (2 sn)
        const len = this.ctx.sampleRate * 2;
        const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        this.noiseBuf = buf;
        this.ready = true;
        this.startAmbient();
      } catch (e) { this.ready = false; }
      return this.ready;
    },
    resume() { if (this.ready && this.ctx.state === 'suspended') this.ctx.resume(); },
    setMuted(m) {
      this.muted = m;
      if (this.master) this.master.gain.value = m ? 0 : 0.85;
    },
    now() { return this.ctx ? this.ctx.currentTime : 0; },

    /* ---------- yardımcılar ---------- */
    noise(dur, filterType, freq, q, gain, fade) {
      if (!this.ready) return;
      const c = this.ctx, t = c.currentTime;
      const src = c.createBufferSource();
      src.buffer = this.noiseBuf;
      src.loop = true;
      src.playbackRate.value = 0.8 + Math.random() * 0.5;
      const f = c.createBiquadFilter();
      f.type = filterType || 'lowpass'; f.frequency.value = freq || 800; f.Q.value = q || 1;
      const g = c.createGain();
      const gg = gain === undefined ? 0.3 : gain;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gg, t + (fade || 0.01));
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f); f.connect(g); g.connect(this.master);
      src.start(t); src.stop(t + dur + 0.05);
      return { src: src, f: f, g: g };
    },
    tone(f0, f1, dur, type, gain, delay) {
      if (!this.ready) return;
      const c = this.ctx, t = c.currentTime + (delay || 0);
      const o = c.createOscillator(), g = c.createGain();
      o.type = type || 'sine';
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain === undefined ? 0.2 : gain, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(this.master);
      o.start(t); o.stop(t + dur + 0.03);
      return { o: o, g: g };
    },

    /* ---------- ortam ---------- */
    startAmbient() {
      if (!this.ready || this.ambSrc) return;
      const c = this.ctx, t = c.currentTime;
      // rüzgâr: bant geçiren gürültü + yavaş LFO
      const src = c.createBufferSource();
      src.buffer = this.noiseBuf; src.loop = true;
      const f = c.createBiquadFilter();
      f.type = 'bandpass'; f.frequency.value = 380; f.Q.value = 0.7;
      const g = c.createGain(); g.gain.value = 0.05;
      const lfo = c.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 0.07;
      const lfoG = c.createGain(); lfoG.gain.value = 180;
      lfo.connect(lfoG); lfoG.connect(f.frequency);
      src.connect(f); f.connect(g); g.connect(this.master);
      src.start(t); lfo.start(t);
      this.ambSrc = src; this.ambGain = g;

      // alçak drone (WICKED varlığı)
      const o1 = c.createOscillator(), o2 = c.createOscillator(), dg = c.createGain();
      o1.type = 'sawtooth'; o1.frequency.value = 41;
      o2.type = 'sine'; o2.frequency.value = 61.5;
      const dg2 = c.createGain(); dg2.gain.value = 0.35;
      dg.gain.value = 0.028;
      o1.connect(dg2); o2.connect(dg2); dg2.connect(dg); dg.connect(this.master);
      o1.start(t); o2.start(t);
      this.droneGain = dg; this.droneO1 = o1; this.droneO2 = o2;

      // griever uğultusu (yakınlığa göre açılır)
      const gsrc = c.createBufferSource();
      gsrc.buffer = this.noiseBuf; gsrc.loop = true;
      const gf = c.createBiquadFilter(); gf.type = 'lowpass'; gf.frequency.value = 220; gf.Q.value = 4;
      const gg = c.createGain(); gg.gain.value = 0.0001;
      gsrc.connect(gf); gf.connect(gg); gg.connect(this.master);
      gsrc.start(t);
      this.grSrc = gsrc; this.grFilter = gf; this.grGain = gg;
      return;
    },
    setPhase(phase) {
      if (!this.ready) return;
      const isNight = phase === 'night';
      const t = this.ctx.currentTime;
      if (this.ambGain) this.ambGain.gain.setTargetAtTime(isNight ? 0.075 : 0.038, t, 1.5);
      if (this.droneGain) this.droneGain.gain.setTargetAtTime(isNight ? 0.075 : 0.02, t, 1.5);
      if (this.ambSrc) this.ambSrc.playbackRate.setTargetAtTime(isNight ? 0.7 : 1.0, t, 1.2);
    },
    /* griever yakınlığı 0..1 */
    setGriever(prox) {
      if (!this.ready || !this.grGain) return;
      const t = this.ctx.currentTime;
      this.grGain.gain.setTargetAtTime(0.0001 + prox * 0.30, t, 0.35);
      if (this.grFilter) this.grFilter.frequency.setTargetAtTime(140 + prox * 700, t, 0.4);
    },
    heartbeat(intensity) {
      if (!this.ready) return;
      const g = clamp(intensity, 0.05, 1) * 0.35;
      this.tone(72, 40, 0.16, 'sine', g);
      this.tone(60, 34, 0.20, 'sine', g * 0.7, 0.20);
    },
    /* ---------- efektler ---------- */
    step(surface) {
      if (!this.ready) return;
      const f = surface === 'grass' ? 1200 : (surface === 'metal' ? 2600 : 900);
      this.noise(0.11, 'bandpass', f, 0.9, 0.10, 0.004);
      if (surface === 'metal') this.tone(180, 90, 0.09, 'square', 0.04);
    },
    hurt() { this.noise(0.25, 'lowpass', 500, 1, 0.35, 0.002); this.tone(180, 60, 0.3, 'sawtooth', 0.12); },
    poison() { this.tone(320, 180, 0.5, 'triangle', 0.1); this.noise(0.5, 'bandpass', 700, 2, 0.08); },
    pickup() { this.tone(660, 990, 0.12, 'triangle', 0.13); this.tone(990, 1320, 0.1, 'sine', 0.08, 0.08); },
    ui() { this.tone(880, 660, 0.06, 'square', 0.05); },
    deny() { this.tone(200, 120, 0.25, 'square', 0.1); },
    read() {
      if (!this.ready) return;
      for (let i = 0; i < 7; i++) this.tone(400 + i * 260, 260 + i * 120, 0.09, 'square', 0.06, i * 0.05);
      this.noise(0.5, 'highpass', 2200, 1, 0.06);
    },
    unlock() {
      this.tone(300, 900, 0.35, 'triangle', 0.14);
      this.noise(0.4, 'bandpass', 1800, 3, 0.1);
      this.tone(1200, 300, 0.6, 'sine', 0.1, 0.3);
    },
    gateClose() {
      if (!this.ready) return;
      this.noise(2.4, 'lowpass', 320, 1.2, 0.45, 0.05);
      this.tone(90, 42, 1.6, 'sawtooth', 0.22, 0.1);
      this.tone(220, 80, 0.9, 'square', 0.12, 0.2);
      setTimeout(() => { if (this.ready) { this.noise(0.5, 'lowpass', 200, 1, 0.5, 0.005); this.tone(70, 38, 0.6, 'sawtooth', 0.2); } }, 2100);
    },
    gateOpen() {
      this.tone(60, 130, 1.6, 'sawtooth', 0.12);
      this.noise(1.6, 'lowpass', 500, 1, 0.18, 0.2);
    },
    grieverRoar(dist) {
      if (!this.ready) return;
      const v = clamp(1 - dist / 34, 0.05, 1);
      const t = this.now();
      const o = this.ctx.createOscillator(), g = this.ctx.createGain();
      const f = this.ctx.createBiquadFilter();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(180 + Math.random() * 60, t);
      o.frequency.exponentialRampToValueAtTime(40, t + 1.1);
      f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 3;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.30 * v, t + 0.06);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.3);
      o.connect(f); f.connect(g); g.connect(this.master);
      o.start(t); o.stop(t + 1.4);
      this.noise(0.9, 'bandpass', 1600, 2, 0.14 * v, 0.02);
    },
    screech() {
      if (!this.ready) return;
      this.tone(1600, 320, 0.8, 'sawtooth', 0.16);
      this.tone(2400, 900, 0.5, 'square', 0.07, 0.06);
      this.noise(0.7, 'highpass', 2400, 1, 0.12);
    },
    beetle() {
      for (let i = 0; i < 4; i++) this.tone(1400 + i * 220, 900, 0.035, 'square', 0.035, i * 0.06);
      this.tone(500, 1400, 0.25, 'triangle', 0.03, 0.2);
    },
    death() {
      if (!this.ready) return;
      this.tone(220, 30, 2.4, 'sawtooth', 0.28);
      this.noise(2.2, 'lowpass', 400, 1, 0.4, 0.05);
    },
    win() {
      const notes = [392, 523, 659, 784, 988];
      notes.forEach((f, i) => this.tone(f, f * 1.01, 1.5, 'triangle', 0.13, i * 0.22));
      this.noise(2.0, 'bandpass', 1200, 1, 0.06);
    },
    fall() {
      this.tone(700, 60, 1.5, 'sine', 0.24);
      this.noise(1.4, 'lowpass', 700, 1, 0.25);
    },
    thunder() {
      if (!this.ready) return;
      this.noise(2.8, 'lowpass', 200, 1, 0.3, 0.02);
      this.tone(50, 30, 2.4, 'sawtooth', 0.12, 0.05);
    },
    boxRise() {
      if (!this.ready) return;
      this.tone(48, 96, 2.2, 'sawtooth', 0.16);
      this.noise(2.0, 'lowpass', 600, 1, 0.2, 0.2);
    }
  };

  MV.Audio = A;
})(MV);
