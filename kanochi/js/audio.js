/* 完落ち ― 効果音（Web Audioで合成。外部音源なし） */
(function () {
  const Sfx = {
    ctx: null, out: null, amb: null, on: true, noise: null, brown: null, lastTick: 0, hbTimer: null, hbLevel: 0, whine: null,

    init() {
      if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try { this.ctx = new AC(); } catch (e) { return; }
      const c = this.ctx;
      const comp = c.createDynamicsCompressor();
      comp.threshold.value = -16; comp.ratio.value = 4;
      this.out = c.createGain(); this.out.gain.value = this.on ? 0.85 : 0;
      this.out.connect(comp); comp.connect(c.destination);
      // white / brown noise buffers
      const len = c.sampleRate * 2;
      this.noise = c.createBuffer(1, len, c.sampleRate);
      const w = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) w[i] = Math.random() * 2 - 1;
      this.brown = c.createBuffer(1, len, c.sampleRate);
      const b = this.brown.getChannelData(0); let last = 0;
      for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; b[i] = last * 3.5; }
      this.startAmbience();
    },

    setOn(v) {
      this.on = v;
      if (this.out) this.out.gain.setTargetAtTime(v ? 0.85 : 0, this.ctx.currentTime, 0.05);
    },

    // ── building blocks ──
    t() { return this.ctx.currentTime; },
    env(g, t0, a, peak, d, end = 0.0001) {
      g.gain.cancelScheduledValues(t0);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t0 + a);
      g.gain.exponentialRampToValueAtTime(end, t0 + a + d);
    },
    osc(type, f0, f1, t0, dur, peak, a = 0.005, dest) {
      const c = this.ctx, o = c.createOscillator(), g = c.createGain();
      o.type = type; o.frequency.setValueAtTime(f0, t0);
      if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
      this.env(g, t0, a, peak, dur);
      o.connect(g); g.connect(dest || this.out);
      o.start(t0); o.stop(t0 + a + dur + 0.05);
      return o;
    },
    burst(t0, dur, peak, filt = 'lowpass', freq = 1000, q = 0.7, buf, a = 0.003, sweepTo) {
      const c = this.ctx, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
      s.buffer = buf || this.noise; s.loop = true;
      f.type = filt; f.frequency.setValueAtTime(freq, t0); f.Q.value = q;
      if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t0 + dur);
      this.env(g, t0, a, peak, dur);
      s.connect(f); f.connect(g); g.connect(this.out);
      s.start(t0, Math.random()); s.stop(t0 + a + dur + 0.05);
    },

    startAmbience() {
      const c = this.ctx;
      this.amb = c.createGain(); this.amb.gain.value = 0; this.amb.connect(this.out);
      // fluorescent hum
      const hum = c.createOscillator(); hum.type = 'sawtooth'; hum.frequency.value = 100;
      const hf = c.createBiquadFilter(); hf.type = 'lowpass'; hf.frequency.value = 340;
      const hg = c.createGain(); hg.gain.value = 0.022;
      hum.connect(hf); hf.connect(hg); hg.connect(this.amb); hum.start();
      // room tone
      const rt = c.createBufferSource(); rt.buffer = this.brown; rt.loop = true;
      const rf = c.createBiquadFilter(); rf.type = 'lowpass'; rf.frequency.value = 420;
      const rg = c.createGain(); rg.gain.value = 0.05;
      rt.connect(rf); rf.connect(rg); rg.connect(this.amb); rt.start();
      // lamp whine (reversal only)
      const wh = c.createOscillator(); wh.type = 'sine'; wh.frequency.value = 7600;
      const wg = c.createGain(); wg.gain.value = 0;
      wh.connect(wg); wg.connect(this.amb); wh.start();
      this.whine = wg;
      this.amb.gain.setTargetAtTime(1, c.currentTime, 1.5);
    },
    setWhine(v) { if (this.whine) this.whine.gain.setTargetAtTime(v ? 0.0035 : 0, this.ctx.currentTime, 0.8); },

    tick() {
      if (!this.ctx || !this.on) return;
      const now = performance.now();
      if (now - this.lastTick < 55) return;
      this.lastTick = now;
      this.burst(this.t(), 0.012, 0.035, 'bandpass', 2200 + Math.random() * 900, 3);
    },

    heartbeat(level) {
      this.hbLevel = level;
      if (!this.ctx) return;
      if (level > 0 && !this.hbTimer) {
        const beat = () => {
          if (this.hbLevel <= 0) { this.hbTimer = null; return; }
          const t0 = this.t(), g = 0.35 + 0.25 * Math.min(1, this.hbLevel);
          this.osc('sine', 70, 38, t0, 0.13, g, 0.006);
          this.osc('sine', 64, 36, t0 + 0.2, 0.15, g * 0.75, 0.006);
          this.hbTimer = setTimeout(beat, 1000 - 280 * Math.min(1, this.hbLevel));
        };
        beat();
      }
    },

    play(name) {
      if (!this.ctx || !this.on) return;
      const t0 = this.t() + 0.01;
      const R = this[`s_${name}`];
      if (R) R.call(this, t0);
    },

    // ── recipes ──
    s_ui(t) { this.burst(t, 0.03, 0.05, 'bandpass', 1400, 2); },
    s_slam(t) {
      this.osc('sine', 95, 34, t, 0.32, 1.0, 0.002);
      this.burst(t, 0.2, 0.55, 'lowpass', 900, 0.7);
      this.osc('triangle', 523, 515, t, 0.7, 0.05, 0.002);
      this.osc('triangle', 787, 780, t, 0.6, 0.035, 0.002);
      this.burst(t + 0.04, 0.35, 0.05, 'bandpass', 3200, 4);
    },
    s_lamp(t) {
      this.burst(t, 0.006, 0.4, 'highpass', 3000, 0.7);
      this.burst(t + 0.09, 0.005, 0.25, 'highpass', 2500, 0.7);
      const c = this.ctx, o = c.createOscillator(), f = c.createBiquadFilter(), g = c.createGain();
      o.type = 'sawtooth'; o.frequency.value = 120; f.type = 'lowpass'; f.frequency.value = 900;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05, t + 0.15); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
      o.connect(f); f.connect(g); g.connect(this.out); o.start(t); o.stop(t + 1.2);
    },
    s_lampOff(t) { this.burst(t, 0.006, 0.35, 'highpass', 2600, 0.7); this.osc('sine', 300, 120, t, 0.2, 0.05); },
    s_tea(t) {
      this.burst(t, 0.7, 0.05, 'bandpass', 1300, 1.2, null, 0.08);
      [[2350, 0.12], [3170, 0.08], [4120, 0.05]].forEach(([f, g]) => this.osc('sine', f, f * 0.995, t + 0.75, 0.5, g, 0.002));
    },
    s_katsudon(t) {
      [[1650, 0.1], [2210, 0.07]].forEach(([f, g]) => this.osc('sine', f, f, t, 0.25, g, 0.002));
      [[1720, 0.08], [2380, 0.05]].forEach(([f, g]) => this.osc('sine', f, f, t + 0.13, 0.3, g, 0.002));
      this.burst(t + 0.2, 1.4, 0.03, 'highpass', 4000, 0.5, null, 0.3);
    },
    s_phone(t) {
      for (let k = 0; k < 2; k++) {
        const t1 = t + k * 0.62;
        [440, 480].forEach(f => {
          const c = this.ctx, o = c.createOscillator(), g = c.createGain(), lfo = c.createOscillator(), lg = c.createGain();
          o.frequency.value = f; lfo.frequency.value = 20; lg.gain.value = 0.03; lfo.connect(lg); lg.connect(g.gain);
          g.gain.setValueAtTime(0.0001, t1); g.gain.linearRampToValueAtTime(0.035, t1 + 0.02); g.gain.setValueAtTime(0.035, t1 + 0.38); g.gain.linearRampToValueAtTime(0.0001, t1 + 0.42);
          o.connect(g); g.connect(this.out); o.start(t1); lfo.start(t1); o.stop(t1 + 0.45); lfo.stop(t1 + 0.45);
        });
      }
    },
    s_stamp(t) {
      this.osc('sine', 74, 38, t, 0.35, 1.0, 0.002);
      this.burst(t, 0.07, 0.6, 'bandpass', 1500, 0.9);
      const c = this.ctx;
      [110, 116.5, 164.8].forEach((f, i) => {
        const o = c.createOscillator(), fl = c.createBiquadFilter(), g = c.createGain();
        o.type = 'sawtooth'; o.frequency.value = f;
        fl.type = 'lowpass'; fl.frequency.setValueAtTime(300, t); fl.frequency.exponentialRampToValueAtTime(1500, t + 0.25); fl.frequency.exponentialRampToValueAtTime(260, t + 1.4);
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(i === 2 ? 0.05 : 0.08, t + 0.04); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
        o.connect(fl); fl.connect(g); g.connect(this.out); o.start(t); o.stop(t + 1.6);
      });
    },
    s_nocontra(t) {
      this.osc('sine', 130, 80, t, 0.3, 0.45, 0.003);
      this.burst(t, 0.05, 0.2, 'bandpass', 900, 0.8);
      this.osc('triangle', 330, 196, t + 0.08, 0.7, 0.06, 0.02);
      this.osc('triangle', 349, 207, t + 0.08, 0.7, 0.04, 0.02);
    },
    s_rebut(t) {
      this.burst(t, 0.5, 0.12, 'bandpass', 500, 1, null, 0.25, 2400);
      this.osc('sawtooth', 220, 146, t + 0.3, 0.9, 0.05, 0.02);
      this.osc('sawtooth', 233, 155, t + 0.3, 0.9, 0.04, 0.02);
    },
    s_stmt(t) {
      const c = this.ctx, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain(), lfo = c.createOscillator(), lg = c.createGain();
      s.buffer = this.noise; s.loop = true; f.type = 'bandpass'; f.frequency.value = 3200; f.Q.value = 2;
      lfo.frequency.value = 23; lg.gain.value = 0.05; lfo.connect(lg); lg.connect(g.gain); g.gain.value = 0.05;
      s.connect(f); f.connect(g); g.connect(this.out);
      s.start(t); lfo.start(t); s.stop(t + 0.42); lfo.stop(t + 0.42);
      this.osc('sine', 1318, 1318, t + 0.45, 1.3, 0.07, 0.004);
      this.osc('sine', 1975, 1975, t + 0.45, 1.0, 0.04, 0.004);
    },
    s_report(t) {
      this.burst(t, 0.32, 0.12, 'bandpass', 1300, 1.2, null, 0.05, 2600);
      this.osc('sine', 180, 90, t + 0.38, 0.09, 0.25);
      this.osc('sine', 180, 90, t + 0.55, 0.09, 0.2);
    },
    s_insert(t) { this.burst(t, 0.015, 0.25, 'highpass', 2000, 0.7); this.burst(t + 0.05, 0.03, 0.12, 'bandpass', 1200, 1); },
    s_push(t) { this.osc('sine', 55, 45, t, 1.4, 0.25, 0.4); this.burst(t, 1.2, 0.03, 'lowpass', 200, 0.7, this.brown, 0.5, 900); },
    s_flip(t) {
      this.burst(t, 1.6, 0.22, 'lowpass', 200, 0.7, null, 0.6, 7000);
      this.osc('sine', 60, 30, t + 1.4, 1.6, 0.9, 0.01);
      const c = this.ctx, o = c.createOscillator(), g = c.createGain();
      o.type = 'sine'; o.frequency.value = 5800;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05, t + 1.2); g.gain.setValueAtTime(0.05, t + 3.2); g.gain.exponentialRampToValueAtTime(0.0001, t + 6);
      o.connect(g); g.connect(this.out); o.start(t); o.stop(t + 6.1);
    },
    s_reveal(t) {
      this.osc('sine', 82, 41, t, 2.2, 0.6, 0.02);
      [233, 247, 349].forEach((f, i) => this.osc('triangle', f, f * 0.97, t + i * 0.04, 2.4, 0.045, 0.3));
    },
    s_clear(t) {
      [98, 146.8, 196, 233.1, 293.7].forEach((f, i) => {
        const c = this.ctx, o = c.createOscillator(), g = c.createGain();
        o.type = i < 2 ? 'sine' : 'triangle'; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.06, t + 1.2); g.gain.exponentialRampToValueAtTime(0.0001, t + 5);
        o.connect(g); g.connect(this.out); o.start(t); o.stop(t + 5.1);
      });
    },
    s_gameover(t) { this.osc('sawtooth', 55, 50, t, 3.2, 0.08, 0.5); this.osc('sine', 41, 40, t, 3.4, 0.3, 0.5); },
    s_fingerprint(t) { this.osc('sine', 90, 50, t, 0.25, 0.5, 0.01); this.burst(t, 0.12, 0.08, 'lowpass', 600, 0.7); },
  };
  window.Sfx = Sfx;
})();
