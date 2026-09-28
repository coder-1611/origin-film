// VI lab · round 2: a tiny deterministic DSP kit for synthesising animal voices, footsteps and
// shore ambience as plain Float32Array buffers (same pattern as ksData / makeIR in
// src/audio/engine.js, so the engine can wrap any of these in an AudioBuffer). No Web Audio, no
// clocks, no Math.random: every stream is a seeded mulberry32. Runs in Node and in the browser.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Gaussian (Box–Muller) from a uniform stream. */
export const gauss = (R) => { const u = Math.max(1e-12, R()), v = R(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
export const dbToGain = (db) => Math.pow(10, db / 20);
export const TAU = Math.PI * 2;

/** Piecewise-linear curve through [[t, v], …] (clamped). */
export function pwl(pts, t) {
  if (t <= pts[0][0]) return pts[0][1];
  for (let i = 0; i < pts.length - 1; i++) if (t < pts[i + 1][0]) {
    const u = (t - pts[i][0]) / (pts[i + 1][0] - pts[i][0]);
    return pts[i][1] + (pts[i + 1][1] - pts[i][1]) * u;
  }
  return pts[pts.length - 1][1];
}
/** Smooth 1D value noise in [−1, 1] (for slow random drifts: vibrato, pressure, wind). */
export function smoothNoise(seed) {
  const cache = new Map();
  const h = (i) => { let v = cache.get(i); if (v === undefined) { const r = mulberry32((seed * 7919 + i * 104729) >>> 0); r(); v = r() * 2 - 1; cache.set(i, v); } return v; };
  return (x) => { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return h(i) + (h(i + 1) - h(i)) * u; };
}
/** Fractal (1/f-ish) noise from smoothNoise octaves, roughly in [−1, 1]. */
export function fbmNoise(seed, oct = 4) {
  const n = Array.from({ length: oct }, (_, k) => smoothNoise(seed + k * 31));
  return (x) => { let s = 0, a = 0.5, f = 1, tot = 0; for (let k = 0; k < oct; k++) { s += a * n[k](x * f); tot += a; a *= 0.5; f *= 2.03; } return s / tot; };
}

// ------------------------------------------------------------------------------ filters
/** RBJ-cookbook biquad; coefficients can be recomputed per sample (set) for modulated filters. */
export class Biquad {
  constructor(sr, type = 'lowpass', f = 1000, q = 0.707, gainDb = 0) { this.sr = sr; this.x1 = this.x2 = this.y1 = this.y2 = 0; this.set(type, f, q, gainDb); }
  set(type, f, q = 0.707, gainDb = 0) {
    const w = TAU * clamp(f, 1, this.sr * 0.49) / this.sr, cw = Math.cos(w), sw = Math.sin(w), al = sw / (2 * q), A = Math.pow(10, gainDb / 40);
    let b0, b1, b2, a0, a1, a2;
    switch (type) {
      case 'lowpass': b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; break;
      case 'highpass': b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; break;
      case 'bandpass': b0 = al; b1 = 0; b2 = -al; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; break;          // 0 dB peak
      case 'peak': b0 = 1 + al * A; b1 = -2 * cw; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * cw; a2 = 1 - al / A; break;
      case 'lowshelf': { const s = 2 * Math.sqrt(A) * al; b0 = A * ((A + 1) - (A - 1) * cw + s); b1 = 2 * A * ((A - 1) - (A + 1) * cw); b2 = A * ((A + 1) - (A - 1) * cw - s); a0 = (A + 1) + (A - 1) * cw + s; a1 = -2 * ((A - 1) + (A + 1) * cw); a2 = (A + 1) + (A - 1) * cw - s; break; }
      case 'highshelf': { const s = 2 * Math.sqrt(A) * al; b0 = A * ((A + 1) + (A - 1) * cw + s); b1 = -2 * A * ((A - 1) + (A + 1) * cw); b2 = A * ((A + 1) + (A - 1) * cw - s); a0 = (A + 1) - (A - 1) * cw + s; a1 = 2 * ((A - 1) - (A + 1) * cw); a2 = (A + 1) - (A - 1) * cw - s; break; }
      default: throw new Error('biquad type ' + type);
    }
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0;
    return this;
  }
  run(x) { const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2; this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y; return y; }
  process(buf) { for (let i = 0; i < buf.length; i++) buf[i] = this.run(buf[i]); return buf; }
}
/** Two-pole resonator with unity peak gain; frequency / bandwidth (Hz). Good for formants. */
export class Resonator {
  constructor(sr, f, bw) { this.sr = sr; this.y1 = this.y2 = 0; this.set(f, bw); }
  set(f, bw) {
    const r = Math.exp(-Math.PI * bw / this.sr), th = TAU * f / this.sr;
    this.a1 = -2 * r * Math.cos(th); this.a2 = r * r;
    this.g = (1 - r) * Math.sqrt(1 - 2 * r * Math.cos(2 * th) + r * r);   // unity gain at resonance
    return this;
  }
  run(x) { const y = this.g * x - this.a1 * this.y1 - this.a2 * this.y2; this.y2 = this.y1; this.y1 = y; return y; }
}
/** One-pole lowpass (air absorption / "distance" dulling). */
export class OnePole { constructor(sr, f) { this.set(sr, f); this.y = 0; } set(sr, f) { this.a = Math.exp(-TAU * f / sr); return this; } run(x) { this.y = x + this.a * (this.y - x); return this.y; } }

// ------------------------------------------------------------------------------ sources
export const white = (R) => R() * 2 - 1;
/** Pink noise (Paul Kellet's economy filter on white). */
export function pinkGen(R) {
  let b0 = 0, b1 = 0, b2 = 0;
  return () => { const w = R() * 2 - 1; b0 = 0.99765 * b0 + w * 0.0990460; b1 = 0.96300 * b1 + w * 0.2965164; b2 = 0.57000 * b2 + w * 1.0526913; return (b0 + b1 + b2 + w * 0.1848) * 0.2; };
}
/** Brown (red) noise. */
export function brownGen(R) { let y = 0; return () => { y = (y + 0.02 * (R() * 2 - 1)) / 1.02; return y * 3.5; }; }

/**
 * Glottal / syringeal pulse train (Rosenberg-style flow derivative), cycle by cycle.
 *   f0(t) Hz; jitter = relative SD of each period; shimmer = relative SD of each pulse amplitude;
 *   oq = open quotient (0.3 pressed … 0.8 breathy); subharm(t) ∈ [0, 1] = period-doubling depth
 *   (alternate cycles long/short & loud/soft → an f0/2 subharmonic); chaos(t) ∈ [0, 1] = irregular
 *   (deterministic-chaos-like) cycle-to-cycle variation; breath = aspiration noise gated to the
 *   open phase. Returns Float32Array of dur·sr samples, and the list of cycle start times.
 */
export function glottal(sr, dur, { f0, jitter = 0.01, shimmer = 0.05, oq = 0.55, skew = 0.7, subharm = () => 0, chaos = () => 0, breath = 0.05, seed = 1, amp = () => 1 }) {
  const n = Math.floor(dur * sr), out = new Float32Array(n), R = mulberry32(seed), cycles = [];
  let t = 0, k = 0;
  while (t < dur) {
    const ch = chaos(t), sh = subharm(t);
    let T0 = 1 / Math.max(1, f0(t));
    T0 *= 1 + jitter * gauss(R) + ch * 0.18 * gauss(R);
    if (sh > 0) T0 *= 1 + (k % 2 ? 1 : -1) * 0.12 * sh;
    let A = amp(t) * (1 + shimmer * gauss(R) + ch * 0.35 * gauss(R));
    if (sh > 0) A *= 1 + (k % 2 ? -1 : 1) * 0.45 * sh;
    A = Math.max(0, A);
    cycles.push(t);
    const i0 = Math.floor(t * sr), L = Math.max(4, Math.floor(T0 * sr));
    const To = L * clamp(oq + 0.05 * gauss(R) * ch, 0.2, 0.9), Tp = To * skew, Tn = To - Tp;
    let prev = 0;
    for (let j = 0; j < L && i0 + j < n; j++) {
      // Rosenberg flow: rise 0.5(1 − cos(π j/Tp)), fall cos(π (j − Tp) / (2 Tn)), closed after
      let g;
      if (j < Tp) g = 0.5 * (1 - Math.cos(Math.PI * j / Tp));
      else if (j < To) g = Math.cos(0.5 * Math.PI * (j - Tp) / Tn);
      else g = 0;
      const d = g - prev; prev = g;                                   // flow derivative (radiated)
      out[i0 + j] += A * d * L * 0.25 + (j < To ? breath * A * g * (R() * 2 - 1) : 0);
    }
    t += L / sr; k++;
  }
  return { buf: out, cycles };
}

/** Parallel formant bank: out = Σ g_k · Res(f_k(t), bw_k(t)) over the input (updates every 32 samples). */
export function formants(sr, x, list) {
  const out = new Float32Array(x.length);
  const rs = list.map(F => new Resonator(sr, typeof F.f === 'function' ? F.f(0) : F.f, typeof F.bw === 'function' ? F.bw(0) : F.bw));
  for (let i = 0; i < x.length; i++) {
    if ((i & 31) === 0) list.forEach((F, k) => { if (typeof F.f === 'function' || typeof F.bw === 'function') { const t = i / sr; rs[k].set(typeof F.f === 'function' ? F.f(t) : F.f, typeof F.bw === 'function' ? F.bw(t) : F.bw); } });
    let s = 0;
    for (let k = 0; k < rs.length; k++) s += (typeof list[k].g === 'function' ? list[k].g(i / sr) : (list[k].g ?? 1)) * rs[k].run(x[i]);
    out[i] = s;
  }
  return out;
}
/** Apply a biquad chain [{type, f, q, g}] in series (static). */
export function chain(sr, x, filters) {
  const out = Float32Array.from(x);
  for (const F of filters) new Biquad(sr, F.type, F.f, F.q ?? 0.707, F.g ?? 0).process(out);
  return out;
}
/** Soft saturation (asymmetric, like a stretched membrane / tissue non-linearity). */
export const soft = (x, drive = 1, asym = 0) => Math.tanh(drive * (x + asym)) - Math.tanh(drive * asym);

// ------------------------------------------------------------------------------ space
/**
 * Outdoor placement: distance (m) → 1/r gain (re 1 m) + air absorption (ISO 9613-ish, dulling above
 * ~2 kHz at tens of metres), a ground reflection (source height hs, listener hl), and a faint diffuse
 * tail (open beach: short, RT ≈ 0.4–0.9 s from the cliff and the sea surface). Returns {L, R}.
 */
export function outdoor(sr, x, { distance = 15, hs = 1, hl = 1.5, pan = 0, tail = 0.12, tailT = 0.7, seed = 7, absorb = 1 } = {}) {
  const n = x.length + Math.floor(sr * (tailT * 1.2 + 0.05));
  const L = new Float32Array(n), Rr = new Float32Array(n);
  const g = 1 / Math.max(1, distance);
  const air = new OnePole(sr, clamp(20000 / (1 + absorb * distance / 30), 1500, 20000));
  const d1 = distance, d2 = Math.hypot(distance, hs + hl);
  const lag = Math.round((d2 - d1) / 343 * sr), gr = 0.55 * d1 / d2;              // soft sand/water: |R| ≈ 0.55
  const pl = Math.cos((pan + 1) * Math.PI / 4), pr = Math.sin((pan + 1) * Math.PI / 4);
  const dry = new Float32Array(n);
  for (let i = 0; i < x.length; i++) { const v = air.run(x[i]) * g; dry[i] += v; if (i + lag < n) dry[i + lag] += v * gr; }
  // diffuse tail: exponentially decaying, decorrelated, lowpassed noise convolution (sparse)
  const R = mulberry32(seed), taps = [];
  const nt = 90;
  for (let k = 0; k < nt; k++) {
    const tt = 0.02 + Math.pow(R(), 1.6) * tailT;
    taps.push([Math.floor(tt * sr), (R() < 0.5 ? -1 : 1) * Math.exp(-tt / (tailT / 6.9)) * tail * (0.6 + 0.4 * R()), R() < 0.5 ? 0 : 1]);
  }
  for (let i = 0; i < n; i++) { L[i] += dry[i] * pl; Rr[i] += dry[i] * pr; }
  const lpT = [new OnePole(sr, 2500), new OnePole(sr, 2500)];
  const wetL = new Float32Array(n), wetR = new Float32Array(n);
  for (const [d, a, side] of taps) {
    const tgt = side ? wetR : wetL;
    for (let i = 0; i + d < n; i++) tgt[i + d] += dry[i] * a;
  }
  for (let i = 0; i < n; i++) { L[i] += lpT[0].run(wetL[i]); Rr[i] += lpT[1].run(wetR[i]); }
  return { L, R: Rr };
}

/** Mix src (mono or {L,R}) into dst {L,R} at time t0 (s) with gain. */
export function mixInto(sr, dst, src, t0 = 0, gain = 1, pan = 0) {
  const o = Math.floor(t0 * sr);
  const pl = Math.cos((pan + 1) * Math.PI / 4) * Math.SQRT2, pr = Math.sin((pan + 1) * Math.PI / 4) * Math.SQRT2;
  if (src instanceof Float32Array) {
    for (let i = 0; i < src.length && o + i < dst.L.length; i++) if (o + i >= 0) { dst.L[o + i] += src[i] * gain * pl; dst.R[o + i] += src[i] * gain * pr; }
  } else {
    for (let i = 0; i < src.L.length && o + i < dst.L.length; i++) if (o + i >= 0) { dst.L[o + i] += src.L[i] * gain; dst.R[o + i] += src.R[i] * gain; }
  }
  return dst;
}
export const stereo = (sr, dur) => ({ L: new Float32Array(Math.ceil(dur * sr)), R: new Float32Array(Math.ceil(dur * sr)) });
export function normalize(buf, peakDb = -1) {
  const chans = buf instanceof Float32Array ? [buf] : [buf.L, buf.R];
  let m = 0; for (const c of chans) for (let i = 0; i < c.length; i++) m = Math.max(m, Math.abs(c[i]));
  const g = m > 0 ? dbToGain(peakDb) / m : 1;
  for (const c of chans) for (let i = 0; i < c.length; i++) c[i] *= g;
  return buf;
}
