// Primordia — generative sound. Births play notes on a pentatonic scale (pitch from the
// creature's colour), hunts are soft percussion, and an ambient pad follows the population:
// brighter as herbivores thrive, a low drone as predators rise, silence at extinction.

const SCALE = [0, 2, 4, 7, 9];                 // major pentatonic
const ROOT = 220;                              // A3
const CHORDS = [[0, 4, 7, 11], [-3, 0, 4, 7], [-7, -3, 0, 4], [-5, -1, 2, 7]];   // Amaj7, F#m7, Dmaj7, E6sus

export class Sound {
  constructor() {
    this.on = false;
    this.ctx = null;
    this.tokens = { note: 0, hit: 0 };
    this.lastRefill = 0;
    this.chord = 0;
    this.nextChordAt = 0;
  }

  async toggle() { return this.on ? this.disable() : this.enable(); }

  async enable() {
    if (!this.ctx) this.build();
    await this.ctx.resume();
    this.master.gain.cancelScheduledValues(this.ctx.currentTime);
    this.master.gain.setTargetAtTime(0.9, this.ctx.currentTime, 0.4);
    this.on = true;
    return true;
  }

  async disable() {
    if (!this.ctx) return false;
    this.on = false;
    this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.15);
    setTimeout(() => { if (!this.on) this.ctx.suspend(); }, 800);
    return false;
  }

  build() {
    const ctx = this.ctx = new AudioContext();
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);

    // a long, soft reverb from a synthetic impulse response
    this.reverb = ctx.createConvolver();
    const len = ctx.sampleRate * 3.5, ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
    }
    this.reverb.buffer = ir;
    this.wet = ctx.createGain(); this.wet.gain.value = 0.55;
    this.reverb.connect(this.wet).connect(this.master);
    this.dry = ctx.createGain(); this.dry.gain.value = 0.7;
    this.dry.connect(this.master);

    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const nd = this.noise.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

    // ambient pad: four slow, detuned voices through a breathing low-pass filter
    this.padFilter = ctx.createBiquadFilter();
    this.padFilter.type = 'lowpass'; this.padFilter.frequency.value = 400; this.padFilter.Q.value = 0.7;
    this.padGain = ctx.createGain(); this.padGain.gain.value = 0;
    this.padFilter.connect(this.padGain);
    this.padGain.connect(this.reverb); this.padGain.connect(this.dry);
    const lfo = ctx.createOscillator(), lfoAmt = ctx.createGain();
    lfo.frequency.value = 0.07; lfoAmt.gain.value = 180;
    lfo.connect(lfoAmt).connect(this.padFilter.frequency); lfo.start();
    this.pad = CHORDS[0].map((st) => {
      const o = ctx.createOscillator(), o2 = ctx.createOscillator();
      o.type = 'sawtooth'; o2.type = 'triangle';
      o.frequency.value = (ROOT / 2) * 2 ** (st / 12); o2.frequency.value = o.frequency.value * 1.004;
      const g = ctx.createGain(); g.gain.value = 0.05;
      o.connect(g); o2.connect(g); g.connect(this.padFilter);
      o.start(); o2.start();
      return [o, o2];
    });

    // predator drone
    this.drone = ctx.createOscillator(); this.drone.type = 'sine'; this.drone.frequency.value = 55;
    this.droneGain = ctx.createGain(); this.droneGain.gain.value = 0;
    this.drone.connect(this.droneGain).connect(this.dry); this.drone.start();
  }

  // Rate limiting so fast-forward does not turn into noise.
  take(kind, perSec, burst) {
    const now = this.ctx.currentTime;
    const dt = now - this.lastRefill; this.lastRefill = now;
    for (const k in this.tokens) this.tokens[k] = Math.min(burst, this.tokens[k] + dt * perSec);
    if (this.tokens[kind] < 1) return false;
    this.tokens[kind]--; return true;
  }

  panner(pan) {
    const p = this.ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    p.connect(this.dry); p.connect(this.reverb);
    return p;
  }

  birth(hue, size, pan = 0) {
    if (!this.on || !this.take('note', 4, 4)) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const deg = Math.floor((hue / 360) * 10);
    const octave = size > 8 ? -1 : size < 4 ? 1 : 0;
    const f = ROOT * 2 ** ((SCALE[deg % 5] + 12 * (Math.floor(deg / 5) + octave)) / 12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.11, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0008, t + 1.6);
    g.connect(this.panner(pan));
    for (const [type, mult, amp] of [['triangle', 1, 1], ['sine', 2, 0.35]]) {
      const o = ctx.createOscillator(), a = ctx.createGain();
      o.type = type; o.frequency.value = f * mult; a.gain.value = amp;
      o.connect(a).connect(g); o.start(t); o.stop(t + 1.7);
    }
  }

  hunt(pan = 0) {
    if (!this.on || !this.take('hit', 3, 3)) return;
    const ctx = this.ctx, t = ctx.currentTime, out = this.panner(pan);
    const n = ctx.createBufferSource(); n.buffer = this.noise;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 1.2;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.18, t); ng.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    n.connect(bp).connect(ng).connect(out); n.start(t); n.stop(t + 0.2);
    const o = ctx.createOscillator(), og = ctx.createGain();
    o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.25);
    og.gain.setValueAtTime(0.28, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.connect(og).connect(out); o.start(t); o.stop(t + 0.32);
  }

  meteor(pan = 0) {
    if (!this.on) return;
    const ctx = this.ctx, t = ctx.currentTime, out = this.panner(pan);
    const n = ctx.createBufferSource(); n.buffer = this.noise; n.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(3000, t); lp.frequency.exponentialRampToValueAtTime(80, t + 2.5);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.5, t); ng.gain.exponentialRampToValueAtTime(0.001, t + 2.8);
    n.connect(lp).connect(ng).connect(out); n.start(t); n.stop(t + 3);
    const o = ctx.createOscillator(), og = ctx.createGain();
    o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(25, t + 1.5);
    og.gain.setValueAtTime(0.6, t); og.gain.exponentialRampToValueAtTime(0.001, t + 1.8);
    o.connect(og).connect(out); o.start(t); o.stop(t + 2);
  }

  // Called a few times a second with the current census.
  ambience(herb, pred) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, total = herb + pred;
    const life = Math.min(total / 300, 1);
    this.padGain.gain.setTargetAtTime(this.on ? 0.55 * Math.sqrt(life) : 0, t, 2.5);
    this.padFilter.frequency.setTargetAtTime(250 + 1600 * Math.min(herb / 450, 1), t, 3);
    this.droneGain.gain.setTargetAtTime(this.on ? 0.12 * Math.min(pred / 80, 1) : 0, t, 3);
    if (t > this.nextChordAt) {
      this.chord = (this.chord + 1) % CHORDS.length;
      this.nextChordAt = t + 14;
      CHORDS[this.chord].forEach((st, i) => {
        const f = (ROOT / 2) * 2 ** (st / 12);
        for (const [k, o] of this.pad[i].entries()) o.frequency.setTargetAtTime(f * (k ? 1.004 : 1), t, 1.5);
      });
    }
  }
}
