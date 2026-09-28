// ORIGIN score engine. Turns timeline.js (notes, SFX cues, automation, drone) into a Web Audio
// graph. The same code renders the film's soundtrack offline (OfflineAudioContext → WAV) and
// plays the live player (AudioContext with a lookahead scheduler).
//
// Every sound is synthesised: oscillators, noise, filters, envelopes, FM, Karplus-Strong
// buffers and a procedurally generated convolution impulse response. No samples.
import * as T from '../timeline.js';

const SR_DEFAULT = T.SAMPLE_RATE;
export const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

// ------------------------------------------------------------------ JS-synthesised buffers
/** Seeded white noise. */
function noiseData(len, seed) {
  const r = T.mulberry32(seed), d = new Float32Array(len);
  for (let i = 0; i < len; i++) d[i] = r() * 2 - 1;
  return d;
}

/** Procedural hall IR: early reflections + a decorrelated stereo tail whose highs decay faster. */
function makeIR(sr, seconds = 4.6, rt60 = 4.2, seed = 0x5EED) {
  const len = Math.floor(sr * seconds);
  const out = [new Float32Array(len), new Float32Array(len)];
  const tauLo = rt60 / 6.91, tauHi = tauLo * 0.45;
  for (let ch = 0; ch < 2; ch++) {
    const r = T.mulberry32(seed + ch * 7919);
    let lp = 0;
    const pre = Math.floor(0.012 * sr);
    for (let i = 0; i < len; i++) {
      const t = i / sr, w = r() * 2 - 1;
      lp += 0.08 * (w - lp);                                // one-pole lowpass split
      const lo = lp, hi = w - lp;
      const eLo = Math.exp(-t / tauLo), eHi = Math.exp(-t / tauHi);
      const fade = i < pre ? 0 : Math.min(1, (i - pre) / (0.02 * sr));
      out[ch][i] = (lo * 2.4 * eLo + hi * 0.55 * eHi) * fade;
    }
    for (let k = 0; k < 14; k++) {                          // early reflections
      const at = Math.floor((0.009 + r() * 0.075) * sr);
      out[ch][at] += (r() < 0.5 ? -1 : 1) * (0.5 - k * 0.03);
    }
  }
  let e = 0; for (const c of out) for (let i = 0; i < len; i++) e += c[i] * c[i];
  const g = 1 / Math.sqrt(e / 2) * 0.9;
  for (const c of out) for (let i = 0; i < len; i++) c[i] *= g;
  return out;
}

/** Karplus-Strong string/pluck. bright ∈ [0,1] sets the excitation colour and the loop filter;
 *  t60 is the ring time (s) of the fundamental. Fractional delay keeps it in tune. */
function ksData(sr, freq, seconds, seed, { bright = 0.5, t60 = 1.2, piano = false } = {}) {
  const len = Math.floor(sr * seconds), out = new Float32Array(len);
  const w1 = 0.5 + bright * 0.4;                          // loop filter: w1*y[n-P] + (1-w1)*y[n-P-1]
  const P = sr / freq - (1 - w1);                         // compensate the filter's group delay
  const M = Math.ceil(P) + 4, dl = new Float32Array(M);
  const r = T.mulberry32(seed);
  const exLen = Math.max(2, Math.floor(P));
  const ex = new Float32Array(exLen);
  let lp = 0, mean = 0;
  for (let i = 0; i < exLen; i++) { const w = r() * 2 - 1; lp += (0.2 + bright * 0.75) * (w - lp); ex[i] = lp; mean += lp; }
  mean /= exLen; for (let i = 0; i < exLen; i++) ex[i] -= mean;
  const g = Math.pow(10, -3 / (t60 * freq));
  let wp = 0, prevDelayed = 0;
  for (let i = 0; i < len; i++) {
    let rp = wp - P; while (rp < 0) rp += M;
    const i0 = Math.floor(rp), fr = rp - i0;
    const a = dl[i0 % M], b = dl[(i0 + 1) % M];
    const delayed = a + (b - a) * fr;
    const y = (i < exLen ? ex[i] : 0) + g * (w1 * delayed + (1 - w1) * prevDelayed);
    prevDelayed = delayed;
    dl[wp] = y; wp = (wp + 1) % M;
    out[i] = y;
  }
  if (piano) {                                             // slightly inharmonic sine partials + hammer
    const r2 = T.mulberry32(seed ^ 0xABC);
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      out[i] = out[i] * 0.6
        + 0.34 * Math.sin(2 * Math.PI * freq * t) * Math.exp(-t / 1.8)
        + 0.12 * Math.sin(2 * Math.PI * freq * 2.004 * t) * Math.exp(-t / 0.8)
        + 0.05 * Math.sin(2 * Math.PI * freq * 3.011 * t) * Math.exp(-t / 0.4)
        + (t < 0.006 ? (r2() * 2 - 1) * 0.2 * (1 - t / 0.006) : 0);
    }
  }
  for (let i = 0; i < 48 && i < len; i++) out[i] *= i / 48;
  for (let i = 0; i < 2400 && i < len; i++) out[len - 1 - i] *= i / 2400;
  return out;
}

/** The drone: additive sines on whole cycles per film (multiples of 1/DURATION Hz): exactly periodic. */
function droneData(sr) {
  const len = Math.floor(sr * T.DURATION), L = new Float32Array(len), R = new Float32Array(len);
  const P = T.DURATION;
  const lfo = T.drone.lfoCycles;
  for (const [cyc, gain, pan] of T.drone.partials) {
    const w = 2 * Math.PI * cyc / (P * sr);
    const gl = Math.cos((pan + 1) * Math.PI / 4) * gain, gr = Math.sin((pan + 1) * Math.PI / 4) * gain;
    const lw = 2 * Math.PI * lfo[Math.floor(cyc) % lfo.length] / (P * sr);
    for (let i = 0; i < len; i++) {
      const a = 0.75 + 0.25 * Math.sin(lw * i + cyc);
      const s = Math.sin(w * i) * a;
      L[i] += s * gl; R[i] += s * gr;
    }
  }
  // Gain envelope (wraps: g(DURATION) = g(0)) + the digital silence.
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    let g = T.pwl(T.drone.gain, t);
    L[i] *= g; R[i] *= g;
  }
  return [L, R];
}

/** Fire crackle: a granular stream of filtered noise grains, panned to the flames. */
function crackleData(sr, ev) {
  const len = Math.floor(sr * ev.dur) + sr, L = new Float32Array(len), R = new Float32Array(len);
  const r = T.mulberry32(0xF1AE);
  let t = 0;
  while (t < ev.dur) {
    const ft = ev.t + t;
    const density = 38 + 30 * Math.sin(t * 2.1) + 25 * r();       // grains per second
    t += (0.3 + r() * 1.4) / density;
    const at = Math.floor(t * sr);
    const glen = Math.floor((0.0004 + r() * r() * 0.004) * sr);
    const amp = (0.15 + r() * r() * 0.85) * ev.vel;
    const x = Math.max(-1, Math.min(1, T.friezeX(ev.wx, ft) + (r() - 0.5) * 0.18));
    const gl = Math.cos((x * 0.85 + 1) * Math.PI / 4), gr = Math.sin((x * 0.85 + 1) * Math.PI / 4);
    const tone = 0.15 + r() * 0.7;
    let lp = 0;
    for (let i = 0; i < glen && at + i < len; i++) {
      const w = r() * 2 - 1; lp += tone * (w - lp);
      const e = Math.exp(-i / (glen * 0.3));
      const s = lp * e * amp;
      L[at + i] += s * gl; R[at + i] += s * gr;
    }
  }
  // Low "whoomph" bed of the fire.
  let lp = 0; const r2 = T.mulberry32(0xB0B);
  for (let i = 0; i < len; i++) {
    const tt = i / sr;
    const w = r2() * 2 - 1; lp += 0.004 * (w - lp);
    const env = Math.min(1, tt / 0.6) * Math.min(1, Math.max(0, (ev.dur - tt) / 1.2)) * (0.6 + 0.4 * Math.sin(tt * 3.3));
    const x = T.friezeX(ev.wx, ev.t + tt);
    const gl = Math.cos((x * 0.85 + 1) * Math.PI / 4), gr = Math.sin((x * 0.85 + 1) * Math.PI / 4);
    L[i] += lp * 9 * env * ev.vel * gl; R[i] += lp * 9 * env * ev.vel * gr;
  }
  return [L, R];
}

/** Every typed character's keyclick, panned by its key, thinning into a granular riser. */
function keysData(sr, ev) {
  const ty = T.typing, t0 = ev.t;
  const len = Math.floor(sr * (ev.dur + 0.5)), L = new Float32Array(len), R = new Float32Array(len);
  const r = T.mulberry32(0x4E75);
  const n = ty.text.length;
  for (let i = 0; i < n; i++) {
    const ct = ty.times[i];
    const rate = i > 0 ? 1 / Math.max(1e-4, ct - ty.times[i - 1]) : 15;
    const g = ev.vel * Math.min(1, Math.sqrt(15 / rate)) * (0.8 + 0.4 * r());
    const at = Math.floor((ct - t0) * sr);
    const x = ty.keyX[i] * ty.panScale;
    const gl = Math.cos((x + 1) * Math.PI / 4), gr = Math.sin((x + 1) * Math.PI / 4);
    const ch = ty.text[i];
    const space = ch === ' ', ret = ch === '\n';
    const thockF = space ? 150 : ret ? 130 : 210 + ty.keyRow[i] * 18 + r() * 30;
    const clickTone = 0.35 + ty.keyRow[i] * 0.1 + r() * 0.15;
    const clickLen = Math.floor(0.0025 * sr), thockLen = Math.floor((space || ret ? 0.03 : 0.016) * sr);
    let lp = 0;
    for (let k = 0; k < Math.max(clickLen, thockLen) && at + k < len; k++) {
      let s = 0;
      if (k < clickLen) { const w = r() * 2 - 1; lp += clickTone * (w - lp); s += (w - lp) * Math.exp(-k / (clickLen * 0.3)) * 0.9; }
      if (k < thockLen) s += Math.sin(2 * Math.PI * thockF * k / sr) * Math.exp(-k / (thockLen * 0.35)) * 0.55;
      s *= g;
      L[at + k] += s * gl; R[at + k] += s * gr;
    }
  }
  return [L, R];
}

// ------------------------------------------------------------------ the engine
export class ScoreEngine {
  /**
   * ctx: AudioContext or OfflineAudioContext. `origin`: ctx time that corresponds to film t = 0
   * (0 offline; for live, ctx.currentTime - filmTime at play).
   */
  constructor(ctx, { live = false, masterGain = 1, cache = null } = {}) {
    this.ctx = ctx; this.live = live; this.sr = ctx.sampleRate || SR_DEFAULT;
    this.masterGainValue = masterGain;
    // Heavy JS-synthesised buffers can be shared between engine instances (live re-seeks).
    this.cache = cache || { ks: new Map(), buffers: {} };
    this.ksCache = this.cache.ks;
    this.buffers = this.cache.buffers;
    this.voices = new Set();
  }

  build() {
    const c = this.ctx, sr = this.sr;
    const g = (v = 1) => { const n = c.createGain(); n.gain.value = v; return n; };
    this.out = g(this.masterGainValue);
    if (this.live) {
      // Live: in-graph glue compressor + limiter. (Offline: done sample-exactly in tools/master.mjs.)
      const glue = c.createDynamicsCompressor();
      glue.threshold.value = -18; glue.ratio.value = 2.5; glue.attack.value = 0.02; glue.release.value = 0.25; glue.knee.value = 6;
      const lim = c.createDynamicsCompressor();
      lim.threshold.value = -2; lim.ratio.value = 20; lim.attack.value = 0.001; lim.release.value = 0.08; lim.knee.value = 0;
      this.out.connect(glue); glue.connect(lim); lim.connect(c.destination);
    } else {
      this.out.connect(c.destination);
    }
    this.gate = g(1);                     // the 10.5–12.0 digital silence
    this.gate.connect(this.out);
    this.master = g(1);
    this.master.connect(this.gate);

    this.musicDuck = g(1);                 // sidechain: ducked by every kick
    this.musicLP = c.createBiquadFilter(); this.musicLP.type = 'lowpass'; this.musicLP.Q.value = 0.5; this.musicLP.frequency.value = 20000;
    this.music = g(0.9);
    this.music.connect(this.musicDuck); this.musicDuck.connect(this.musicLP); this.musicLP.connect(this.master);
    this.drums = g(0.9); this.drums.connect(this.master);
    this.sfxBus = g(0.9); this.sfxBus.connect(this.master);
    this.droneBus = g(0.32); this.droneBus.connect(this.master);

    // Reverb (procedural IR) and a dotted-eighth delay for the lead.
    if (!this.buffers.ir) {
      const ir = makeIR(sr);
      const irBuf = c.createBuffer(2, ir[0].length, sr); irBuf.copyToChannel(ir[0], 0); irBuf.copyToChannel(ir[1], 1);
      this.buffers.ir = irBuf;
    }
    const irBuf = this.buffers.ir;
    this.verb = c.createConvolver(); this.verb.normalize = false; this.verb.buffer = irBuf;
    this.verbIn = g(1); this.verbOut = g(0.42);
    this.verbIn.connect(this.verb); this.verb.connect(this.verbOut); this.verbOut.connect(this.musicLP);
    this.delay = c.createDelay(2); this.delay.delayTime.value = 0.375;
    const fb = g(0.32), dOut = g(0.35), dLP = c.createBiquadFilter(); dLP.type = 'lowpass'; dLP.frequency.value = 3500;
    this.delayIn = g(1);
    this.delayIn.connect(this.delay); this.delay.connect(dLP); dLP.connect(fb); fb.connect(this.delay); dLP.connect(dOut); dOut.connect(this.music); dOut.connect(this.verbIn);

    // Shared noise buffer (seeded).
    if (!this.buffers.noise) {
      const nd = noiseData(sr * 4, 0x0015E);
      this.buffers.noise = c.createBuffer(1, nd.length, sr); this.buffers.noise.copyToChannel(nd, 0);
    }
    this.noise = this.buffers.noise;
    return this;
  }

  // ---------------------------------------------------------------- automation
  /** Write f(t) as a value curve onto `param` for film times [t0, t1). */
  curve(param, f, t0, t1, rate = 500) {
    const n = Math.max(2, Math.ceil((t1 - t0) * rate));
    const v = new Float32Array(n);
    for (let i = 0; i < n; i++) v[i] = f(t0 + (t1 - t0) * i / (n - 1));
    param.setValueCurveAtTime(v, this.at(t0), t1 - t0);
  }
  duckAt(t) {
    const depth = 1 - Math.pow(10, -T.automation.duckDb / 20), rel = T.automation.duckRelease / 3;
    let e = 0;
    // kicks are sorted; look back 0.6 s
    let lo = 0, hi = T.kicks.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (T.kicks[m] <= t) lo = m + 1; else hi = m; }
    for (let i = lo - 1; i >= 0 && t - T.kicks[i] < 0.6; i--) {
      const x = t - T.kicks[i];
      e = Math.max(e, x < 0.004 ? x / 0.004 : Math.exp(-(x - 0.004) / rel));
    }
    return 1 - depth * e;
  }
  lowpassAt(t) {
    const k = T.automation.musicLowpass;
    return Math.exp(T.pwl(k.map(([tt, f]) => [tt, Math.log(f)]), t));
  }
  gateAt(t) {
    const [a, b] = T.automation.silence;
    if (t < a - 0.003 || t >= b) return 1;
    if (t < a) return (a - t) / 0.003;
    if (t > b - 0.003) return (t - (b - 0.003)) / 0.003;
    return 0;
  }
  automate(t0, t1) {
    this.curve(this.musicDuck.gain, (t) => this.duckAt(t), t0, t1, 1000);
    this.curve(this.musicLP.frequency, (t) => this.lowpassAt(t), t0, t1, 100);
    this.curve(this.gate.gain, (t) => this.gateAt(t), t0, t1, 2000);
  }

  /** ctx time for film time t. */
  at(t) { return (this.origin || 0) + t; }

  // ---------------------------------------------------------------- voice plumbing
  src(buf, when, { loop = false, offset = 0, dur } = {}) {
    const s = this.ctx.createBufferSource(); s.buffer = buf; s.loop = loop;
    s.start(Math.max(when, 0), offset); if (dur !== undefined) s.stop(when + dur);
    return s;
  }
  osc(type, freq, when, stop) {
    const o = this.ctx.createOscillator(); o.type = type; o.frequency.value = freq;
    o.start(when); o.stop(stop);
    return o;
  }
  noiseSrc(when, dur, seed = 0) {
    const off = (T.hash1(seed) * 3.0);
    return this.src(this.noise, when, { loop: true, offset: off, dur });
  }
  /** Connect a voice into a bus with pan + dry + reverb send (+ optional delay send). */
  route(node, bus, { pan = 0, dry = 1, wet = 0, delay = 0 } = {}) {
    const c = this.ctx;
    const p = c.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan));
    node.connect(p);
    const d = c.createGain(); d.gain.value = dry; p.connect(d); d.connect(bus);
    if (wet > 0) { const w = c.createGain(); w.gain.value = wet; p.connect(w); w.connect(this.verbIn); }
    if (delay > 0) { const w = c.createGain(); w.gain.value = delay; p.connect(w); w.connect(this.delayIn); }
    return p;
  }
  env(gainParam, when, dur, { a = 0.01, d = 0.2, s = 0.7, r = 0.3, peak = 1 }) {
    gainParam.setValueAtTime(0, when);
    gainParam.linearRampToValueAtTime(peak, when + a);
    gainParam.setTargetAtTime(peak * s, when + a, Math.max(1e-3, d / 3));
    const rel = when + Math.max(a, dur);
    gainParam.setTargetAtTime(0, rel, Math.max(1e-3, r / 3));
    return rel + r * 2.5;
  }

  // ---------------------------------------------------------------- instruments
  play(n) {
    const f = this['i_' + n.inst];
    if (f) f.call(this, n, this.at(n.t));
  }
  i_sine(n, w) {
    const c = this.ctx, fr = mtof(n.midi), end = w + n.dur + 4;
    const o = this.osc('sine', fr, w, end), o2 = this.osc('sine', fr * 2, w, end);
    const vib = this.osc('sine', 5.1, w, end), vg = c.createGain(); vg.gain.setValueAtTime(0, w); vg.gain.linearRampToValueAtTime(fr * 0.0025, w + 0.6);
    vib.connect(vg); vg.connect(o.frequency);
    const g2 = c.createGain(); g2.gain.value = 0.07; o2.connect(g2);
    const g = c.createGain(); o.connect(g); g2.connect(g);
    this.env(g.gain, w, n.dur, { a: 0.06, d: 0.6, s: 0.75, r: 1.6, peak: 0.17 * n.vel });
    this.route(g, this.music, { wet: 0.9, dry: 0.8 });
  }
  i_bell(n, w) {
    const c = this.ctx, fr = mtof(n.midi), end = w + n.dur + 1;
    const car = this.osc('sine', fr, w, end), mod = this.osc('sine', fr * 3.5, w, end);
    const mg = c.createGain(); mg.gain.setValueAtTime(fr * 5.5, w); mg.gain.exponentialRampToValueAtTime(fr * 0.3, w + n.dur * 0.6);
    mod.connect(mg); mg.connect(car.frequency);
    const sh = this.osc('sine', fr * 4.2, w, end), sg = c.createGain(); sg.gain.setValueAtTime(0.18 * n.vel, w); sg.gain.setTargetAtTime(0, w, 0.12); sh.connect(sg);
    const g = c.createGain(); car.connect(g); sg.connect(g);
    g.gain.setValueAtTime(0, w); g.gain.linearRampToValueAtTime(0.3 * n.vel, w + 0.003); g.gain.setTargetAtTime(0, w + 0.003, n.dur / 3.5);
    this.route(g, this.music, { pan: (n.x || 0) * 0.85, wet: 0.8, dry: 0.75 });
  }
  supersaw(n, w, { voices = 7, spread = 18, cutoff = 2200, env = 1600, a = 0.5, d = 1, s = 0.8, r = 1.2, peak = 0.08, q = 0.7, bus = this.music, wet = 0.5, delay = 0, formant = false }) {
    const c = this.ctx, fr = mtof(n.midi), end = w + n.dur + r * 3;
    const mixL = c.createGain(), mixR = c.createGain();
    for (let i = 0; i < voices; i++) {
      const o = this.osc('sawtooth', fr, w, end);
      o.detune.value = (i / (voices - 1) - 0.5) * 2 * spread + (T.hash1(n.midi * 31 + i) - 0.5) * 3;
      o.connect(i % 2 ? mixL : mixR);
    }
    const merger = c.createChannelMerger(2);
    mixL.connect(merger, 0, 0); mixR.connect(merger, 0, 1);
    let tail = c.createBiquadFilter(); tail.type = 'lowpass'; tail.Q.value = q;
    tail.frequency.setValueAtTime(cutoff, w); tail.frequency.linearRampToValueAtTime(cutoff + env, w + a); tail.frequency.setTargetAtTime(cutoff, w + a, d);
    merger.connect(tail);
    if (formant) {
      const f1 = c.createBiquadFilter(), f2 = c.createBiquadFilter();
      f1.type = f2.type = 'bandpass'; f1.frequency.value = 760; f2.frequency.value = 1180; f1.Q.value = 4; f2.Q.value = 5;
      const fm = c.createGain(); tail.connect(f1); tail.connect(f2); f1.connect(fm); f2.connect(fm);
      const dryG = c.createGain(); dryG.gain.value = 0.35; tail.connect(dryG); dryG.connect(fm);
      fm.gain.value = 1.6;
      tail = fm;
    }
    const hpf = c.createBiquadFilter(); hpf.type = 'highpass'; hpf.frequency.value = 150; tail.connect(hpf);
    const g = c.createGain(); hpf.connect(g);
    this.env(g.gain, w, n.dur, { a, d, s, r, peak: peak * n.vel });
    this.route(g, bus, { wet, delay, pan: 0 });
  }
  i_pad(n, w) { this.supersaw(n, w, { voices: 6, spread: 16, cutoff: 2600, env: 2200, a: 0.45, d: 1.2, s: 0.85, r: 1.1, peak: 0.055, wet: 0.55 }); }
  i_choir(n, w) { this.supersaw(n, w, { voices: 6, spread: 22, cutoff: 3400, env: 1400, a: 0.35, d: 1.5, s: 0.9, r: 1.4, peak: 0.075, wet: 0.7, formant: true }); }
  i_lead(n, w) { this.supersaw(n, w, { voices: 7, spread: 20, cutoff: 2600, env: 5200, a: 0.012, d: 0.35, s: 0.75, r: 0.28, peak: 0.13, q: 1.2, wet: 0.35, delay: 0.3 }); }
  i_sub(n, w) {
    const c = this.ctx, fr = mtof(n.midi), end = w + n.dur + 1;
    const o = this.osc('sine', fr, w, end), o2 = this.osc('triangle', fr * 2, w, end);
    const g2 = c.createGain(); g2.gain.value = 0.18; o2.connect(g2);
    const sh = c.createWaveShaper();
    const curve = new Float32Array(1024); for (let i = 0; i < 1024; i++) { const x = i / 511.5 - 1; curve[i] = Math.tanh(x * 1.8) / Math.tanh(1.8); }
    sh.curve = curve;
    const pre = c.createGain(); o.connect(pre); g2.connect(pre); pre.connect(sh);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 170; sh.connect(lp);
    const g = c.createGain(); lp.connect(g);
    this.env(g.gain, w, n.dur, n.swell ? { a: 1.6, d: 0.5, s: 1, r: 0.004, peak: 0.24 * n.vel } : { a: 0.008, d: 0.25, s: 0.85, r: 0.09, peak: 0.24 * n.vel });
    this.route(g, this.music, { wet: 0.04 });
  }
  i_kick(n, w) {
    const c = this.ctx;
    const o = this.osc('sine', 150, w, w + 0.7);
    o.frequency.setValueAtTime(160, w); o.frequency.exponentialRampToValueAtTime(52, w + 0.055); o.frequency.exponentialRampToValueAtTime(44, w + 0.4);
    const g = c.createGain(); g.gain.setValueAtTime(0, w); g.gain.linearRampToValueAtTime(0.8 * n.vel, w + 0.002); g.gain.setTargetAtTime(0, w + 0.03, 0.09);
    o.connect(g);
    const nz = this.noiseSrc(w, 0.02, n.t * 1000), hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2200;
    const ng = c.createGain(); ng.gain.setValueAtTime(0.35 * n.vel, w); ng.gain.setTargetAtTime(0, w, 0.004);
    nz.connect(hp); hp.connect(ng); ng.connect(g);
    this.route(g, this.drums, { wet: 0.06 });
  }
  i_snare(n, w) {
    const c = this.ctx;
    const nz = this.noiseSrc(w, 0.4, n.t * 1000 + 1), bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1900; bp.Q.value = 0.7;
    const ng = c.createGain(); ng.gain.setValueAtTime(0.5 * n.vel, w); ng.gain.setTargetAtTime(0, w, 0.055);
    nz.connect(bp); bp.connect(ng);
    const o = this.osc('triangle', 185, w, w + 0.3), og = c.createGain(); og.gain.setValueAtTime(0.5 * n.vel, w); og.gain.setTargetAtTime(0, w, 0.03);
    o.frequency.exponentialRampToValueAtTime(160, w + 0.08); o.connect(og);
    const g = c.createGain(); g.gain.value = 1; ng.connect(g); og.connect(g);
    this.route(g, this.drums, { wet: 0.22, pan: 0.05 });
  }
  i_clap(n, w) {
    const c = this.ctx;
    const nz = this.noiseSrc(w, 0.5, n.t * 1000 + 2), bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1250; bp.Q.value = 1.1;
    const g = c.createGain();
    g.gain.setValueAtTime(0, w);
    for (const k of [0, 0.011, 0.022]) { g.gain.setValueAtTime(0.55 * n.vel, w + k); g.gain.setTargetAtTime(0.05, w + k, 0.003); }
    g.gain.setValueAtTime(0.4 * n.vel, w + 0.033); g.gain.setTargetAtTime(0, w + 0.033, 0.045);
    nz.connect(bp); bp.connect(g);
    this.route(g, this.drums, { wet: 0.35, pan: -0.05 });
  }
  i_hat(n, w, open = false) {
    const c = this.ctx;
    const nz = this.noiseSrc(w, open ? 0.5 : 0.1, n.t * 1000 + 3), hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7200;
    const bp = c.createBiquadFilter(); bp.type = 'peaking'; bp.frequency.value = 9500; bp.gain.value = 2;
    const g = c.createGain(); g.gain.setValueAtTime(0.3 * n.vel, w); g.gain.setTargetAtTime(0, w, open ? 0.08 : 0.015);
    nz.connect(hp); hp.connect(bp); bp.connect(g);
    this.route(g, this.drums, { wet: 0.08, pan: open ? -0.25 : 0.22 });
  }
  i_ohat(n, w) { this.i_hat(n, w, true); }
  ksBuffer(midi, seconds, opts, seed) {
    const key = midi + ':' + seconds + ':' + JSON.stringify(opts);
    if (!this.ksCache.has(key)) {
      const d = ksData(this.sr, mtof(midi), seconds, seed, opts);
      const b = this.ctx.createBuffer(1, d.length, this.sr); b.copyToChannel(d, 0);
      this.ksCache.set(key, b);
    }
    return this.ksCache.get(key);
  }
  i_ks(n, w) {
    const buf = this.ksBuffer(n.midi, 2.5, { bright: 0.75, t60: 1.1 }, n.midi * 13 + 7);
    const s = this.src(buf, w);
    const g = this.ctx.createGain(); g.gain.value = 0.55 * n.vel; s.connect(g);
    this.route(g, this.music, { pan: (n.x || 0) * 0.8, wet: 0.4 });
  }
  i_piano(n, w) {
    const buf = this.ksBuffer(n.midi, 7, { bright: 0.7, t60: 5.0, piano: true }, n.midi * 17 + 3);
    const s = this.src(buf, w);
    const g = this.ctx.createGain(); g.gain.setValueAtTime(0.7 * n.vel, w); g.gain.setTargetAtTime(0, w + n.dur, 0.5);
    s.connect(g);
    this.route(g, this.music, { pan: (n.midi - 62) * 0.03, wet: 0.75 });
  }
  i_marimba(n, w) {
    const c = this.ctx, fr = mtof(n.midi), g = c.createGain();
    [[1, 1, 0.55], [3.99, 0.32, 0.13], [10.65, 0.1, 0.035]].forEach(([ratio, amp, tau]) => {
      const o = this.osc('sine', fr * ratio, w, w + tau * 8 + 0.05), og = c.createGain();
      og.gain.setValueAtTime(0, w); og.gain.linearRampToValueAtTime(amp * 0.4 * n.vel, w + 0.0015); og.gain.setTargetAtTime(0, w + 0.0015, tau);
      o.connect(og); og.connect(g);
    });
    const nz = this.noiseSrc(w, 0.02, n.t * 997), bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2800; bp.Q.value = 2;
    const ng = c.createGain(); ng.gain.setValueAtTime(0.08 * n.vel, w); ng.gain.setTargetAtTime(0, w, 0.003);
    nz.connect(bp); bp.connect(ng); ng.connect(g);
    this.route(g, this.music, { pan: (n.x || 0) * 0.8, wet: 0.35 });
  }

  // ---------------------------------------------------------------- SFX
  playSfx(e) { const f = this['s_' + e.type]; if (f) f.call(this, e, this.at(e.t)); }
  s_riser(e, w) {
    const c = this.ctx, end = w + e.dur;
    const nz = this.noiseSrc(w, e.dur + 0.1, e.t * 31), bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.6;
    bp.frequency.setValueAtTime(300, w); bp.frequency.exponentialRampToValueAtTime(e.soft ? 3000 : 7000, end);
    const g = c.createGain(); nz.connect(bp); bp.connect(g);
    const saw = c.createGain(), lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(400, w); lp.frequency.exponentialRampToValueAtTime(6000, end);
    [-9, 0, 9].forEach((det) => {
      const o = this.osc('sawtooth', mtof(50), w, end + 0.05); o.detune.value = det;
      o.frequency.setValueAtTime(mtof(50), w); o.frequency.exponentialRampToValueAtTime(mtof(74), end);
      o.connect(lp);
    });
    lp.connect(saw); saw.gain.value = 0.18; saw.connect(g);
    const peak = (e.soft ? 0.18 : 0.32) * e.vel;
    g.gain.setValueAtTime(0.0001, w); g.gain.exponentialRampToValueAtTime(peak, end - 0.01);
    if (e.hardStop) g.gain.linearRampToValueAtTime(0, end + 0.004);
    else g.gain.setTargetAtTime(0, end, 0.06);
    this.route(g, this.sfxBus, { wet: e.hardStop ? 0.2 : 0.4, pan: e.x * 0.8 });
  }
  s_impact(e, w) {
    const c = this.ctx;
    const o = this.osc('sine', 90, w, w + e.dur);
    o.frequency.setValueAtTime(e.soft ? 70 : 95, w); o.frequency.exponentialRampToValueAtTime(27, w + 1.6);
    const og = c.createGain(); og.gain.setValueAtTime(0, w); og.gain.linearRampToValueAtTime((e.soft ? 0.3 : 0.55) * e.vel, w + 0.004); og.gain.setTargetAtTime(0, w + 0.05, e.big ? 1.1 : 0.6);
    o.connect(og);
    const nz = this.noiseSrc(w, e.dur, e.t * 17), lp = c.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(e.soft ? 1800 : 5000, w); lp.frequency.exponentialRampToValueAtTime(180, w + 1.2);
    const ng = c.createGain(); ng.gain.setValueAtTime((e.soft ? 0.25 : 0.95) * e.vel, w); ng.gain.setTargetAtTime(0, w, e.big ? 0.45 : 0.25);
    nz.connect(lp); lp.connect(ng);
    const g = c.createGain(); og.connect(g); ng.connect(g);
    if (e.theia || e.big) {                                  // rumble tail
      const rz = this.noiseSrc(w, e.dur, e.t * 19 + 5), rl = c.createBiquadFilter(); rl.type = 'lowpass'; rl.frequency.value = 140;
      const rg = c.createGain(); rg.gain.setValueAtTime(0, w); rg.gain.linearRampToValueAtTime(0.7 * e.vel, w + 0.08); rg.gain.setTargetAtTime(0, w + 0.3, e.theia ? 1.8 : 1.2);
      rz.connect(rl); rl.connect(rg); rg.connect(g);
    }
    this.route(g, this.sfxBus, { pan: e.x * 0.8, wet: 0.9 });
  }
  s_whoosh(e, w) {
    const c = this.ctx, end = w + e.dur;
    const nz = this.noiseSrc(w, e.dur + 0.1, e.t * 23), bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = e.small ? 2 : 1.2;
    bp.frequency.setValueAtTime(350, w); bp.frequency.exponentialRampToValueAtTime(e.atmosphere ? 1600 : 2600, w + e.dur * 0.75); bp.frequency.exponentialRampToValueAtTime(500, end);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, w); g.gain.exponentialRampToValueAtTime((e.small ? 0.3 : 0.6) * e.vel, w + e.dur * 0.75); g.gain.exponentialRampToValueAtTime(0.0001, end);
    nz.connect(bp); bp.connect(g);
    const p = this.route(g, this.sfxBus, { pan: e.x * 0.85, wet: 0.35 });
    if (e.x1 !== undefined) { p.pan.setValueAtTime(e.x * 0.85, w); p.pan.linearRampToValueAtTime(e.x1 * 0.85, end); }
  }
  s_shimmer(e, w) {
    [77, 81, 84, 89, 93].forEach((m, i) => this.i_bell({ midi: m, dur: 3.5, vel: 0.35 * e.vel, x: (i - 2) * 0.3 }, w + i * 0.09));
  }
  s_splash(e, w) {
    const c = this.ctx;
    const nz = this.noiseSrc(w, e.dur, e.t * 29), lp = c.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(9000, w); lp.frequency.exponentialRampToValueAtTime(600, w + 0.7);
    const g = c.createGain(); g.gain.setValueAtTime(0, w); g.gain.linearRampToValueAtTime((e.small ? 0.3 : 0.6) * e.vel, w + 0.01); g.gain.setTargetAtTime(0, w + 0.02, e.small ? 0.2 : 0.35);
    nz.connect(lp); lp.connect(g);
    this.route(g, this.sfxBus, { pan: e.x, wet: 0.5 });
    const r = T.mulberry32(Math.floor(e.t * 1000));
    for (let k = 0; k < (e.small ? 6 : 14); k++) this.s_bubble({ t: e.t, vel: 0.35 * e.vel, x: (r() - 0.5) * 0.8, midi: 80 + Math.floor(r() * 14) }, w + 0.05 + r() * 0.5);
  }
  s_bubble(e, w) {
    const c = this.ctx, fr = mtof(e.midi || 86);
    const o = this.osc('sine', fr, w, w + 0.15); o.frequency.setValueAtTime(fr, w); o.frequency.exponentialRampToValueAtTime(fr * 1.7, w + 0.07);
    const g = c.createGain(); g.gain.setValueAtTime(0, w); g.gain.linearRampToValueAtTime(0.16 * e.vel, w + 0.004); g.gain.setTargetAtTime(0, w + 0.01, 0.025);
    o.connect(g);
    this.route(g, this.sfxBus, { pan: e.x * 0.85, wet: 0.45 });
  }
  s_pop(e, w) {
    const c = this.ctx, fr = mtof(e.midi || 81);
    const o = this.osc('sine', fr * 1.5, w, w + 0.3); o.frequency.setValueAtTime(fr * 1.5, w); o.frequency.exponentialRampToValueAtTime(fr, w + 0.03);
    const g = c.createGain(); g.gain.setValueAtTime(0, w); g.gain.linearRampToValueAtTime(0.2 * e.vel, w + 0.003); g.gain.setTargetAtTime(0, w + 0.01, 0.06);
    o.connect(g);
    this.route(g, this.sfxBus, { pan: e.x * 0.85, wet: 0.5 });
  }
  s_tick(e, w) {
    const c = this.ctx;
    const nz = this.noiseSrc(w, 0.05, e.t * 37), bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 3200 + T.hash1(e.t * 1000) * 2500; bp.Q.value = 3;
    const g = c.createGain(); g.gain.setValueAtTime(0.5 * e.vel, w); g.gain.setTargetAtTime(0, w, 0.006);
    nz.connect(bp); bp.connect(g);
    this.route(g, this.sfxBus, { pan: e.x * 0.85, wet: 0.3 });
  }
  s_clank(e, w) {
    const c = this.ctx, fr = 178;
    const car = this.osc('sine', fr, w, w + 1.2), mod = this.osc('sine', fr * 2.76, w, w + 1.2), mg = c.createGain();
    mg.gain.setValueAtTime(fr * 9, w); mg.gain.setTargetAtTime(fr * 0.5, w, 0.08); mod.connect(mg); mg.connect(car.frequency);
    const g = c.createGain(); g.gain.setValueAtTime(0, w); g.gain.linearRampToValueAtTime(0.26 * e.vel, w + 0.002); g.gain.setTargetAtTime(0, w + 0.004, 0.14);
    car.connect(g);
    const nz = this.noiseSrc(w, 0.05, e.t * 41), hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1500;
    const ng = c.createGain(); ng.gain.setValueAtTime(0.3 * e.vel, w); ng.gain.setTargetAtTime(0, w, 0.008);
    nz.connect(hp); hp.connect(ng); ng.connect(g);
    this.route(g, this.sfxBus, { pan: e.x * 0.85, wet: 0.35 });
  }
  s_hiss(e, w) {
    const c = this.ctx;
    const nz = this.noiseSrc(w, e.dur + 0.2, e.t * 43), hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 3000;
    const g = c.createGain(); g.gain.setValueAtTime(0, w); g.gain.linearRampToValueAtTime(0.22 * e.vel, w + 0.02); g.gain.setTargetAtTime(0, w + 0.05, e.dur / 3);
    nz.connect(hp); hp.connect(g);
    const nz2 = this.noiseSrc(w, 0.2, e.t * 47), lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 280;
    const g2 = c.createGain(); g2.gain.setValueAtTime(0.9 * e.vel, w); g2.gain.setTargetAtTime(0, w, 0.03);
    nz2.connect(lp); lp.connect(g2); g2.connect(g);
    this.route(g, this.sfxBus, { pan: e.x * 0.85, wet: 0.25 });
  }
  s_zap(e, w) {
    const c = this.ctx, fr = mtof(e.midi || 86);
    const o = this.osc('sine', fr * 2, w, w + 0.3); o.frequency.setValueAtTime(fr * 2.2, w); o.frequency.exponentialRampToValueAtTime(fr, w + 0.1);
    const m = this.osc('sine', fr * 0.5, w, w + 0.3), mg = c.createGain(); mg.gain.value = fr * 0.8; m.connect(mg); mg.connect(o.frequency);
    const g = c.createGain(); g.gain.setValueAtTime(0, w); g.gain.linearRampToValueAtTime(0.14 * e.vel, w + 0.003); g.gain.setTargetAtTime(0, w + 0.02, 0.045);
    o.connect(g);
    this.route(g, this.sfxBus, { pan: e.x * 0.9, wet: 0.4 });
  }
  s_thunk(e, w) {
    const c = this.ctx;
    const o = this.osc('sine', 120, w, w + 0.4); o.frequency.exponentialRampToValueAtTime(80, w + 0.08);
    const g = c.createGain(); g.gain.setValueAtTime(0, w); g.gain.linearRampToValueAtTime(0.6 * e.vel, w + 0.002); g.gain.setTargetAtTime(0, w + 0.004, 0.035);
    o.connect(g);
    const nz = this.noiseSrc(w, 0.03, 5), bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 3500; bp.Q.value = 1.5;
    const ng = c.createGain(); ng.gain.setValueAtTime(0.5 * e.vel, w); ng.gain.setTargetAtTime(0, w, 0.004);
    nz.connect(bp); bp.connect(ng); ng.connect(g);
    this.route(g, this.sfxBus, { pan: e.x * 0.85, wet: 0.6 });
  }
  // ---- VI: the march (footsteps, calls, the torch) ----------------------------------------
  s_step(e, w) {
    const c = this.ctx, g = c.createGain(), k = e.kind;
    const P = {   // [noise filter type, freq, Q, noise decay, thump Hz from→to, thump decay, noise amp, thump amp]
      slap:    ['bandpass', 900, 1.0, 0.04, 140, 90, 0.05, 0.5, 0.35],
      pad:     ['lowpass', 520, 0.7, 0.03, 110, 80, 0.04, 0.35, 0.45],
      patter:  ['bandpass', 2400, 1.5, 0.008, 300, 200, 0.01, 0.35, 0.05],
      stomp:   ['lowpass', 320, 0.7, 0.12, 62, 34, 0.26, 0.6, 1.0],
      knuckle: ['bandpass', 700, 1.0, 0.035, 120, 85, 0.05, 0.4, 0.5],
      foot:    ['lowpass', 1300, 0.8, 0.06, 90, 70, 0.05, 0.45, 0.4],
    }[k] || ['lowpass', 800, 0.7, 0.04, 100, 70, 0.05, 0.4, 0.4];
    const nz = this.noiseSrc(w, 0.4, e.t * 53 + 7), f = c.createBiquadFilter(); f.type = P[0]; f.frequency.value = P[1]; f.Q.value = P[2];
    const ng = c.createGain(); ng.gain.setValueAtTime(P[7] * e.vel, w); ng.gain.setTargetAtTime(0, w, P[3]);
    nz.connect(f); f.connect(ng); ng.connect(g);
    const o = this.osc('sine', P[4], w, w + P[6] * 6 + 0.05); o.frequency.exponentialRampToValueAtTime(P[5], w + P[6] * 2);
    const og = c.createGain(); og.gain.setValueAtTime(0, w); og.gain.linearRampToValueAtTime(P[8] * e.vel, w + 0.003); og.gain.setTargetAtTime(0, w + 0.005, P[6]);
    o.connect(og); og.connect(g);
    this.route(g, this.sfxBus, { pan: e.x * 0.85, wet: k === 'stomp' ? 0.35 : 0.15 });
  }
  s_call(e, w) {
    const c = this.ctx, g = c.createGain(), d = e.dur;
    if (e.call === 'croak') {                       // amphibian: pulsed buzzy tone through a formant
      const o = this.osc('sawtooth', 190, w, w + d + 0.1), am = this.osc('square', 28, w, w + d + 0.1), amg = c.createGain();
      amg.gain.value = 0.5; am.connect(amg);
      const vca = c.createGain(); vca.gain.value = 0.5; amg.connect(vca.gain); o.connect(vca);
      const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 620; bp.Q.value = 3; vca.connect(bp); bp.connect(g);
      o.frequency.setValueAtTime(200, w); o.frequency.linearRampToValueAtTime(170, w + d);
      g.gain.setValueAtTime(0, w); g.gain.linearRampToValueAtTime(0.5 * e.vel, w + 0.03); g.gain.setTargetAtTime(0, w + d * 0.7, 0.05);
    } else if (e.call === 'hiss') {                 // reptile
      const nz = this.noiseSrc(w, d + 0.1, 311), hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 3800;
      nz.connect(hp); hp.connect(g);
      g.gain.setValueAtTime(0, w); g.gain.linearRampToValueAtTime(0.28 * e.vel, w + 0.06); g.gain.setTargetAtTime(0, w + d * 0.6, 0.08);
    } else if (e.call === 'roar') {                 // dinosaur: FM growl + formant-swept noise, big room
      const o = this.osc('sawtooth', 78, w, w + d + 0.2), m = this.osc('sine', 23, w, w + d + 0.2), mg = c.createGain();
      mg.gain.value = 30; m.connect(mg); mg.connect(o.frequency);
      o.frequency.setValueAtTime(95, w); o.frequency.linearRampToValueAtTime(70, w + d);
      const nz = this.noiseSrc(w, d + 0.2, 523), bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 2.5;
      bp.frequency.setValueAtTime(350, w); bp.frequency.exponentialRampToValueAtTime(900, w + d * 0.4); bp.frequency.exponentialRampToValueAtTime(260, w + d);
      const ng = c.createGain(); ng.gain.value = 1.4; nz.connect(bp); bp.connect(ng);
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400; o.connect(lp);
      const mix = c.createGain(); lp.connect(mix); ng.connect(mix);
      const sh = c.createWaveShaper(); const cv = new Float32Array(1024); for (let i = 0; i < 1024; i++) { const x = i / 511.5 - 1; cv[i] = Math.tanh(x * 2.5); } sh.curve = cv;
      mix.connect(sh); sh.connect(g);
      g.gain.setValueAtTime(0, w); g.gain.linearRampToValueAtTime(0.36 * e.vel, w + 0.12); g.gain.setTargetAtTime(0.22 * e.vel, w + 0.12, 0.3); g.gain.setTargetAtTime(0, w + d * 0.75, 0.12);
    } else if (e.call === 'chirp') {                // small mammal: three quick rising chirps
      for (let k = 0; k < 3; k++) {
        const t0 = w + k * 0.09, o = this.osc('sine', 3600, t0, t0 + 0.07); o.frequency.exponentialRampToValueAtTime(5200, t0 + 0.05);
        const cg = c.createGain(); cg.gain.setValueAtTime(0, t0); cg.gain.linearRampToValueAtTime(0.12 * e.vel, t0 + 0.005); cg.gain.setTargetAtTime(0, t0 + 0.02, 0.015);
        o.connect(cg); cg.connect(g);
      }
      g.gain.value = 1;
    } else if (e.call === 'hoot') {                 // ape: two breathy "hoo"s gliding up
      for (let k = 0; k < 2; k++) {
        const t0 = w + k * 0.24, o = this.osc('triangle', 360 + k * 60, t0, t0 + 0.26); o.frequency.exponentialRampToValueAtTime(520 + k * 80, t0 + 0.2);
        const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 700; bp.Q.value = 1.2;
        const nz = this.noiseSrc(t0, 0.26, 733 + k), nlp = c.createBiquadFilter(); nlp.type = 'bandpass'; nlp.frequency.value = 900; const ngn = c.createGain(); ngn.gain.value = 0.25;
        nz.connect(nlp); nlp.connect(ngn);
        const cg = c.createGain(); cg.gain.setValueAtTime(0, t0); cg.gain.linearRampToValueAtTime(0.3 * e.vel, t0 + 0.04); cg.gain.setTargetAtTime(0, t0 + 0.15, 0.04);
        o.connect(bp); bp.connect(cg); ngn.connect(cg); cg.connect(g);
      }
      g.gain.value = 1;
    }
    this.route(g, this.sfxBus, { pan: e.x * 0.85, wet: e.call === 'roar' ? 0.7 : 0.35 });
  }
  s_ignite(e, w) {                                  // the torch catches: whoosh + its own crackle
    const c = this.ctx;
    const nz = this.noiseSrc(w, 0.6, 977), bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.3;
    bp.frequency.setValueAtTime(260, w); bp.frequency.exponentialRampToValueAtTime(1900, w + 0.25); bp.frequency.exponentialRampToValueAtTime(700, w + 0.55);
    const g = c.createGain(); g.gain.setValueAtTime(0, w); g.gain.linearRampToValueAtTime(0.45 * e.vel, w + 0.08); g.gain.setTargetAtTime(0, w + 0.25, 0.12);
    nz.connect(bp); bp.connect(g);
    this.route(g, this.sfxBus, { pan: e.x * 0.85, wet: 0.3 });
    if (!this.buffers.ignite) {
      const sr = this.sr, len = Math.floor(sr * e.dur), L = new Float32Array(len), R = new Float32Array(len), r = T.mulberry32(0x7043);
      let t = 0.05;
      while (t < e.dur) {
        t += (0.3 + r() * 1.4) / (45 + 25 * r());
        const at = Math.floor(t * sr), glen = Math.floor((0.0004 + r() * r() * 0.003) * sr), amp = (0.15 + r() * r() * 0.8) * Math.min(1, t / 0.2) * Math.max(0, 1 - t / e.dur);
        const x = (r() - 0.5) * 0.12, gl = Math.cos((x + 1) * Math.PI / 4), gr = Math.sin((x + 1) * Math.PI / 4), tone = 0.15 + r() * 0.7;
        let lp = 0;
        for (let i = 0; i < glen && at + i < len; i++) { const wv = r() * 2 - 1; lp += tone * (wv - lp); const v = lp * Math.exp(-i / (glen * 0.3)) * amp; L[at + i] += v * gl; R[at + i] += v * gr; }
      }
      const b = c.createBuffer(2, len, sr); b.copyToChannel(L, 0); b.copyToChannel(R, 1); this.buffers.ignite = b;
    }
    const s = this.src(this.buffers.ignite, w), cg = c.createGain(); cg.gain.value = 0.5 * e.vel; s.connect(cg); cg.connect(this.sfxBus);
  }
  bufferVoice(name, data, e, w, offset = 0) {
    if (!this.buffers[name]) {
      const b = this.ctx.createBuffer(2, data[0].length, this.sr); b.copyToChannel(data[0], 0); b.copyToChannel(data[1], 1);
      this.buffers[name] = b;
    }
    const s = this.src(this.buffers[name], w, { offset });
    const g = this.ctx.createGain(); g.gain.value = 1; s.connect(g);
    return g;
  }
  s_crackle(e, w, offset = 0) {
    const g = this.bufferVoice('crackle', this.buffers.crackle ? null : crackleData(this.sr, e), e, w, offset);
    g.gain.value = 0.5;
    g.connect(this.sfxBus);
    const wg = this.ctx.createGain(); wg.gain.value = 0.15; g.connect(wg); wg.connect(this.verbIn);
  }
  s_keys(e, w, offset = 0) {
    const g = this.bufferVoice('keys', this.buffers.keys ? null : keysData(this.sr, e), e, w, offset);
    g.gain.value = 0.55;
    g.connect(this.sfxBus);
    const wg = this.ctx.createGain(); wg.gain.value = 0.12; g.connect(wg); wg.connect(this.verbIn);
  }
  startDrone(filmT = 0) {
    if (!this.buffers.drone) {
      const d = droneData(this.sr);
      const b = this.ctx.createBuffer(2, d[0].length, this.sr); b.copyToChannel(d[0], 0); b.copyToChannel(d[1], 1);
      this.buffers.drone = b;
    }
    const s = this.ctx.createBufferSource(); s.buffer = this.buffers.drone;
    s.start(this.at(filmT), filmT);                       // stops by itself at the end of the film
    const wg = this.ctx.createGain(); wg.gain.value = 0.25;
    s.connect(this.droneBus); s.connect(wg); wg.connect(this.verbIn);
    return s;
  }

  // ---------------------------------------------------------------- scheduling
  /** Schedule everything that starts in [t0, t1). */
  scheduleRange(t0, t1) {
    for (const n of T.notes) if (n.t >= t0 && n.t < t1) this.play(n);
    for (const e of T.sfx) if (e.t >= t0 && e.t < t1) this.playSfx(e);
  }
  /** Live: start at film time t0 (sustained notes already sounding are re-entered). */
  startLive(t0, lead = 0.08) {
    this.origin = this.ctx.currentTime + lead - t0;
    this.automate(t0, T.DURATION + 0.5);
    if (t0 < T.DURATION) this.startDrone(t0);
    const SUSTAIN = new Set(['pad', 'choir', 'sub', 'lead', 'sine', 'piano']);
    for (const n of T.notes) if (SUSTAIN.has(n.inst) && n.t < t0 && n.t + n.dur > t0 + 0.05) this.play({ ...n, t: t0, dur: n.t + n.dur - t0 });
    for (const e of T.sfx) {
      if ((e.type === 'keys' || e.type === 'crackle') && e.t < t0 && e.t + e.dur > t0) this['s_' + e.type](e, this.at(t0), t0 - e.t);
    }
    this.scheduledTo = t0;
  }
  /** Live lookahead: schedule events that start before film time `until`. */
  pump(until) {
    if (until <= this.scheduledTo) return;
    this.scheduleRange(this.scheduledTo, until);
    this.scheduledTo = until;
  }
  /** Fade out and disconnect (on pause/seek). */
  dispose() {
    const now = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(now);
    this.out.gain.setTargetAtTime(0, now, 0.015);
    const out = this.out;
    setTimeout(() => { try { out.disconnect(); } catch {} }, 250);
  }

  /** Offline: the whole film (+ tail). */
  scheduleAll() {
    this.origin = 0;
    this.automate(0, T.DURATION + T.AUDIO_TAIL);
    this.startDrone(0);
    this.scheduleRange(0, T.DURATION + T.AUDIO_TAIL);
  }
}

/** Render the whole score offline. Returns an AudioBuffer (186 s, stereo, 48 kHz, pre-master). */
export async function renderOffline(onProgress) {
  const sr = T.SAMPLE_RATE, len = Math.ceil((T.DURATION + T.AUDIO_TAIL) * sr);
  const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: len, sampleRate: sr });
  const eng = new ScoreEngine(ctx, { live: false }).build();
  const t0 = performance.now();
  eng.scheduleAll();
  onProgress && onProgress(`scheduled in ${(performance.now() - t0).toFixed(0)} ms`);
  const buf = await ctx.startRendering();
  onProgress && onProgress(`rendered in ${(performance.now() - t0).toFixed(0)} ms`);
  return buf;
}
