// ORIGIN · nature voices (from the VI lab, round 2): synthesised animal voices, footsteps and shore ambience (no samples).
// Every recipe is a pure function (sr, params, seed) → Float32Array or {L, R}, built from lab/dsp.js,
// so src/audio/engine.js can precompute them into AudioBuffers (like ksData / makeIR). The numbers
// come from the bioacoustics literature; see docs/research/animal-realism.md §3 for sources.
import {
  mulberry32, gauss, clamp, lerp, sstep, pwl, smoothNoise, fbmNoise, Biquad, Resonator, OnePole,
  pinkGen, brownGen, glottal, formants, chain, soft, outdoor, mixInto, stereo, normalize, TAU,
} from './dsp.js';

// ============================================================================ footsteps
/**
 * One footfall on the shore. Physics scaling (see doc §3.6):
 *   thump frequency f ≈ f_ref·(m / 60 kg)^(−1/3)   (sand as a spring whose stiffness grows with
 *   foot contact radius ∝ m^(1/3), so f = √(k/m)/2π ∝ m^(−1/3)); f_ref = 95 Hz (human on damp sand)
 *   thump amplitude ∝ m^(2/3) (√ kinetic energy with impact speed ∝ leg length^(1/2) ∝ m^(1/6))
 * ground: 'wet' (cohesive: no crunch, squelch on lift), 'damp' (some crunch), 'dry' (crunch), 'water'
 * (a thin film: slap + droplets). kind: 'foot' | 'paw' | 'knuckle' | 'claw' | 'belly' | 'fin'.
 * Returns mono; place it with outdoor().
 */
export function footstep(sr, { m = 60, v = 1, ground = 'wet', kind = 'foot', roll = null, seed = 1, lift = 0.25 } = {}) {
  const R = mulberry32(seed);
  const dur = 0.6 + (m > 200 ? 0.5 : 0);
  const n = Math.floor(sr * dur), out = new Float32Array(n);
  const mr = m / 60;
  const f = 120 * Math.pow(mr, -1 / 3) * (0.92 + 0.16 * R());        // 55 kg human 124 Hz, 1.5 t theropod 41 Hz
  const A = Math.pow(mr, 2 / 3) * (0.85 + 0.3 * R()) * v;
  const Q = kind === 'belly' ? 1.2 : 2.0;
  const tau = Q / (Math.PI * f);
  const rollT = roll ?? (kind === 'foot' ? 0.12 : kind === 'belly' ? 0.08 : 0.05) * Math.pow(mr, 0.17);
  // 1 · the thump: a damped sinusoid with a slight downward glide (the sand compacts as it loads),
  //     plus heel/ball double-hit for plantigrade feet
  const hits = kind === 'foot' ? [[0, 1], [rollT * 0.8, 0.45]] : [[0, 1]];
  for (const [t0, a] of hits) {
    const i0 = Math.floor(t0 * sr);
    let ph = 0;
    for (let i = 0; i < n - i0; i++) {
      const t = i / sr, e = Math.exp(-t / tau) * (1 - Math.exp(-t / 0.0015));
      if (e < 1e-5 && t > 0.01) break;
      ph += TAU * f * (1 - 0.18 * Math.min(1, t / (4 * tau))) / sr;
      out[i0 + i] += A * a * e * Math.sin(ph) * clamp(0.35 + 0.25 * Math.log10(Math.max(mr, 0.01) * 10), 0.2, 1);
    }
  }
  // 2 · contact noise: a short band of noise whose centre falls with mass (bigger foot, duller)
  {
    const fc = clamp(1700 * Math.pow(mr, -0.25), 300, 6000);           // ≈ half the hard-floor centroid (sand)
    const bp = new Biquad(sr, 'bandpass', fc, 0.8), lp = new OnePole(sr, fc * 1.8);
    const nt = kind === 'belly' ? 0.09 : 0.02 + 0.03 * Math.pow(mr, 0.2);
    for (let i = 0; i < Math.min(n, sr * nt * 5); i++) { const t = i / sr; out[i] += 1.1 * A * lp.run(bp.run(R() * 2 - 1)) * Math.exp(-t / nt); }
  }
  // 3 · grain crunch (Poisson micro-impacts as the foot rolls and grains shear); wet sand is cohesive
  const crunch = { dry: 1, damp: 0.35, wet: 0.08, water: 0.02 }[ground] ?? 0.2;
  if (crunch > 0.03) {
    const rate = 900 * crunch, hp = new Biquad(sr, 'highpass', 1500, 0.7);
    let t = R() * 0.004;
    while (t < rollT * 1.6) {
      t += -Math.log(Math.max(1e-6, R())) / rate;
      const i0 = Math.floor(t * sr), a = A * 0.12 * crunch * (0.3 + R()) * Math.exp(-t / (rollT * 0.8));
      const L = Math.floor(sr * (0.0004 + 0.0012 * R()));
      for (let j = 0; j < L && i0 + j < n; j++) out[i0 + j] += a * (R() * 2 - 1) * (1 - j / L);
    }
    for (let i = 0; i < n; i++) out[i] = out[i] * 0.7 + 0.3 * hp.run(out[i]);
  }
  // 4 · wet: suction release on lift — a short noise sweep up + a small cavity pop
  const wet = { dry: 0, damp: 0.3, wet: 1, water: 0.6 }[ground] ?? 0.5;
  if (wet > 0 && kind !== 'fin') {
    const t0 = lift * Math.pow(mr, 0.12), i0 = Math.floor(t0 * sr), L = Math.floor(sr * 0.06);
    const bp = new Biquad(sr, 'bandpass', 500, 2.2);
    const fp = clamp(900 * Math.pow(mr, -0.25), 180, 2500);
    for (let j = 0; j < L && i0 + j < n; j++) {
      const u = j / L;
      if ((j & 15) === 0) bp.set('bandpass', lerp(350, 1600, u) * Math.pow(mr, -0.15), 2.2);
      out[i0 + j] += 0.35 * wet * A * bp.run(R() * 2 - 1) * Math.sin(Math.PI * u) + 0.2 * wet * A * Math.sin(TAU * fp * j / sr) * Math.exp(-j / sr / 0.012) * (j > L * 0.5 ? 1 : 0);
    }
  }
  // 5 · water film: a slap and droplets (Minnaert bubbles: f ≈ 3.26 kHz·mm / radius)
  if (ground === 'water' || kind === 'belly' || kind === 'fin') {
    const hp = new Biquad(sr, 'highpass', 700, 0.7);
    for (let i = 0; i < Math.min(n, sr * 0.03); i++) out[i] += 0.6 * A * hp.run(R() * 2 - 1) * Math.exp(-i / sr / 0.006);
    const nd = Math.floor(4 + 10 * Math.min(1, Math.pow(mr, 0.4)));
    for (let k = 0; k < nd; k++) {
      const t0 = 0.01 + 0.25 * R() * R(), r = 0.6 + 2.4 * R(), fb = 3260 / r * (1 + 0.1 * gauss(R));
      const i0 = Math.floor(t0 * sr), L = Math.floor(sr * 0.03);
      const a = 0.12 * A * (0.3 + R());
      for (let j = 0; j < L && i0 + j < n; j++) { const tt = j / sr; out[i0 + j] += a * Math.sin(TAU * fb * tt * (1 + 2 * tt)) * Math.exp(-tt / 0.006); }
    }
  }
  return out;
}

// ============================================================================ ambience
/**
 * Surf on a gentle shore, as individual wave events (never a constant noise): each wave has a
 * seeded period (lognormal around `period`), a set envelope (every 5–8 waves a bigger set), and
 * three phases — the break (a pink/brown roar peaking 200–800 Hz, 0.3–0.8 s attack), the swash
 * (foam fizz: Poisson bubble pops 1–6 kHz, 1.5–3 s) and the backwash (a receding sandy hiss).
 * The break travels along the shore (pan sweep). A far-surf bed fills between breaks.
 */
export function surf(sr, dur, { period = 8.5, level = 1, seed = 11, calm = 0.6 } = {}) {
  const out = stereo(sr, dur), R = mulberry32(seed);
  const n = out.L.length;
  // far surf bed: brown noise, lowpassed, slowly breathing + the hiss of distant breakers along the
  // shore (the high band never drops to silence between waves)
  { const br = brownGen(R), lp = [new Biquad(sr, 'lowpass', 380, 0.6), new Biquad(sr, 'lowpass', 380, 0.6)], sw = fbmNoise(seed + 3, 3);
    const brR = brownGen(mulberry32(seed + 99)), pk = [pinkGen(mulberry32(seed + 7)), pinkGen(mulberry32(seed + 8))];
    const hb = [new Biquad(sr, 'bandpass', 2400, 0.4), new Biquad(sr, 'bandpass', 2600, 0.4)];
    for (let i = 0; i < n; i++) { const t = i / sr, g = 0.05 * level * (0.75 + 0.25 * sw(t * 0.15)), h = 0.012 * level * (0.6 + 0.4 * sw(t * 0.23 + 5));
      out.L[i] += g * lp[0].run(br()) + h * hb[0].run(pk[0]()); out.R[i] += g * lp[1].run(brR()) + h * hb[1].run(pk[1]()); } }
  let t = -R() * period * 0.8, k = 0;
  const setPh = R() * 6;
  while (t < dur) {
    const setEnv = 0.6 + 0.4 * Math.pow(0.5 + 0.5 * Math.sin(TAU * k / 9.5 + setPh), 2);   // sets of ~7–12 waves
    const size = level * setEnv * (0.75 + 0.5 * R()) * calm;
    const pan0 = (R() - 0.5) * 1.2, pan1 = pan0 + (R() < 0.5 ? -1 : 1) * (0.3 + 0.4 * R());
    const wave = surfWave(sr, size, mulberry32(seed * 131 + k * 7919), pan0, pan1);
    mixInto(sr, out, wave, t, 1);
    t += period * Math.exp(0.16 * gauss(R)); k++;
  }
  return hp2(sr, out, 22);
}
/** Remove sub-audio rumble (brown/pink sources carry lots of < 20 Hz energy no speaker plays). */
export function hp2(sr, o, f = 22) { const a = [new Biquad(sr, 'highpass', f, 0.6), new Biquad(sr, 'highpass', f, 0.6)], b = [new Biquad(sr, 'highpass', f, 0.6), new Biquad(sr, 'highpass', f, 0.6)];
  for (let i = 0; i < o.L.length; i++) { o.L[i] = b[0].run(a[0].run(o.L[i])); o.R[i] = b[1].run(a[1].run(o.R[i])); } return o; }
function surfWave(sr, size, R, pan0, pan1) {
  const dur = 7, n = Math.floor(sr * dur), out = stereo(sr, dur);
  const pk = pinkGen(R), br = brownGen(R);
  const atk = 0.3 + 0.5 * R(), brk = 1.6 + 1.4 * R() * size;
  const lpB = new Biquad(sr, 'lowpass', 3000, 0.6), pkB = new Biquad(sr, 'peak', 450, 0.8, 5);
  const hpS = new Biquad(sr, 'highpass', 1400, 0.7), bpS = new Biquad(sr, 'bandpass', 3500, 0.6);
  const swashAt = atk + brk * 0.5, swashLen = 1.5 + 1.5 * R(), backAt = swashAt + swashLen * 0.7, backLen = 1.8 + 1.2 * R();
  const fizz = new Float32Array(n);
  // swash fizz: bubble pops (Minnaert), dense early, thinning
  { let tt = swashAt; const rate0 = 1400 * size;
    while (tt < swashAt + swashLen + backLen) {
      const u = (tt - swashAt) / (swashLen + backLen), rate = rate0 * Math.pow(1 - u, 2) + 60;
      tt += -Math.log(Math.max(1e-6, R())) / rate;
      const r = 0.4 + 2.6 * Math.pow(R(), 2), f = 3260 / r, i0 = Math.floor(tt * sr), L = Math.floor(sr * 0.02);
      const a = 0.05 * size * (0.2 + R());
      for (let j = 0; j < L && i0 + j < n; j++) { const q = j / sr; fizz[i0 + j] += a * Math.sin(TAU * f * q * (1 + 3 * q)) * Math.exp(-q / (0.002 + 0.004 * R())); }
    } }
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    // break: crash onset, roar decaying; the lowpass closes as the energy dissipates
    const eB = sstep(0, atk, t) * Math.exp(-Math.max(0, t - atk) / brk);
    if ((i & 63) === 0) lpB.set('lowpass', 500 + 3500 * eB, 0.6);
    const roar = pkB.run(lpB.run(pk() * 0.7 + br() * 0.5)) * eB * 0.35 * size;
    // swash & backwash: hiss that rises up the beach and drains back, higher and thinner
    const eS = sstep(swashAt, swashAt + 0.4, t) * (1 - sstep(swashAt + swashLen * 0.6, swashAt + swashLen, t));
    const eW = sstep(backAt, backAt + 0.5, t) * (1 - sstep(backAt + backLen * 0.3, backAt + backLen, t));
    const hiss = bpS.run(hpS.run(R() * 2 - 1)) * (0.06 * eS + 0.035 * eW) * size;
    const s = roar + hiss + fizz[i];
    const u = clamp(t / (atk + brk)), pan = lerp(pan0, pan1, u);
    out.L[i] += s * Math.cos((pan + 1) * Math.PI / 4); out.R[i] += s * Math.sin((pan + 1) * Math.PI / 4);
  }
  return out;
}
/**
 * Shore wind (Farnell's recipe): noise through a bandpass whose centre and level follow a gust
 * envelope (fbm, 0.05–0.3 Hz), a low rumble on the mic-less ear, and two faint whistles (narrow
 * resonances drifting with the gust) — only when gusting.
 */
export function wind(sr, dur, { level = 1, seed = 21 } = {}) {
  const out = stereo(sr, dur), n = out.L.length, R = mulberry32(seed);
  const gust = fbmNoise(seed, 4), gust2 = fbmNoise(seed + 9, 3);
  const pk = [pinkGen(R), pinkGen(mulberry32(seed + 5))];
  const bp = [new Biquad(sr, 'bandpass', 600, 0.5), new Biquad(sr, 'bandpass', 700, 0.5)];
  const lo = [new Biquad(sr, 'lowpass', 120, 0.7), new Biquad(sr, 'lowpass', 120, 0.7)];
  const wh = [new Resonator(sr, 900, 12), new Resonator(sr, 1400, 18)];
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const g = clamp(0.55 + 0.45 * gust(t * 0.18) + 0.2 * gust2(t * 0.9), 0.05, 1.3);
    if ((i & 127) === 0) { bp[0].set('bandpass', 300 + 900 * g, 0.5); bp[1].set('bandpass', 340 + 1000 * g, 0.5); wh[0].set(700 + 500 * g, 10); wh[1].set(1200 + 700 * g, 14); }
    for (let c = 0; c < 2; c++) {
      const s = pk[c]();
      let v = bp[c].run(s) * 0.12 * g * g + lo[c].run(s) * 0.05 * g;
      v += wh[c].run(s) * 0.02 * Math.max(0, g - 0.85) * 3;
      (c ? out.R : out.L)[i] += v * level;
    }
  }
  return hp2(sr, out, 30);
}
/**
 * A distant mixed seabird flock: gull "kyow"s (harmonic, rise–fall, 0.25–0.45 s, f0 0.9–1.6 kHz,
 * rough), tern "kee-arr"s (2.5–4 kHz down-slurs) and wader whistles (3–4 kHz up-sweeps), as a
 * clustered Poisson process (calls come in bursts), all heavily air-absorbed (60–200 m away).
 */
export function flock(sr, dur, { rate = 2.2, level = 1, seed = 31, distance = 120 } = {}) {
  const out = stereo(sr, dur), R = mulberry32(seed);
  let t = R() * 0.5;
  while (t < dur) {
    const burst = 1 + Math.floor(R() * R() * 5);
    for (let b = 0; b < burst && t < dur; b++) {
      const kind = R(), pan = (R() - 0.5) * 1.6, d = distance * (0.6 + 0.8 * R());
      const call = kind < 0.5 ? gullCall(sr, R) : kind < 0.8 ? ternCall(sr, R) : waderCall(sr, R);
      const placed = outdoor(sr, call, { distance: d, hs: 15 + 20 * R(), pan, tail: 0.25, tailT: 1.1, seed: Math.floor(R() * 1e6), absorb: 1.4 });
      mixInto(sr, out, placed, t, level * 6);
      t += 0.08 + 0.25 * R();
    }
    t += -Math.log(Math.max(1e-6, R())) / (rate / 2.5);
  }
  return out;
}
function gullCall(sr, R) {
  const d = 0.25 + 0.2 * R(), f1 = 900 + 700 * R();
  const g = glottal(sr, d, { f0: (t) => f1 * (1 + 0.25 * Math.sin(Math.PI * t / d) - 0.15 * t / d), jitter: 0.02, shimmer: 0.12, oq: 0.4, breath: 0.25, seed: Math.floor(R() * 1e6), amp: (t) => sstep(0, 0.03, t) * (1 - sstep(d * 0.6, d, t)) });
  return formants(sr, g.buf, [{ f: 1800, bw: 400, g: 1 }, { f: 3200, bw: 600, g: 0.5 }]);
}
function ternCall(sr, R) {
  const d = 0.3 + 0.2 * R(), f1 = 3600 + 600 * R();
  const g = glottal(sr, d, { f0: (t) => f1 * (1 - 0.35 * t / d), jitter: 0.03, shimmer: 0.2, oq: 0.35, breath: 0.35, seed: Math.floor(R() * 1e6), amp: (t) => sstep(0, 0.02, t) * (1 - sstep(d * 0.5, d, t)) });
  return chain(sr, g.buf, [{ type: 'highpass', f: 1500 }]);
}
function waderCall(sr, R) {
  const d = 0.12 + 0.08 * R(), f1 = 2800 + 700 * R(), n = Math.floor(sr * d), out = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) { const t = i / sr, u = t / d; ph += TAU * f1 * (1 + 0.35 * u) / sr; out[i] = Math.sin(ph) * Math.sin(Math.PI * u) * 0.4; }
  return out;
}

// ============================================================================ voices
/** Lognormal draw around m with log-SD s (natural durations/intervals are right-skewed). */
const lognorm = (R, m, s) => m * Math.exp(s * gauss(R));

/**
 * THEROPOD: a closed-mouth boom bout (the extant bracket: crocodilian bellow + ratite boom; see doc).
 * Mouth shut, the call radiates through an inflated oesophageal/tracheal sac and the neck/chest
 * wall, so almost all energy is the fundamental and a few harmonics:
 *   source   syringeal/laryngeal pulse train, f0 ≈ 24–38 Hz, jitter 2 %, shimmer 10 %, chaotic
 *            onset (0.15 s), a subharmonic (f0/2) regime mid-call, vocal fry at the end
 *   filter   sac Helmholtz resonance f_H = c/2π·√(A/(V·L)) ≈ 30 Hz (V ≈ 30 L, neck 5 cm², 5 cm)
 *            reinforcing f0; skin low-pass 12 dB/oct above ~180 Hz; a weak nasal leak through a
 *            ~1.1 m tract (closed–open tube formants (2k−1)·c/4L ≈ 78, 234, 390 Hz)
 *   bout     inhale (audible nasal intake) → 2–4 booms of lognormal length with lognormal gaps,
 *            each slightly lower/rougher than the last (pressure runs down)
 * Returns mono at the animal (1 m); place with outdoor().
 */
/**
 * The bout plan, shared by the sound (theropodBoom) and the animation (beats.js): gulps, the
 * inhale, and each boom's start/length/pitch/irregularities — so throat pumping, inflation and the
 * water dance line up with what is heard. Times in seconds from the bout start.
 */
export function boomPlan({ seed = 1, booms = 2, f0 = 31, gulps = 2 } = {}) {
  const R = mulberry32(seed);
  let t = 0.05;
  const gulpT = [];
  for (let g = 0; g < gulps; g++) { gulpT.push(t); t += clamp(lognorm(R, 0.24, 0.25), 0.15, 0.4); }
  const inhale = [t + 0.05, 0.45 + 0.2 * R()];
  t = inhale[0] + inhale[1] + 0.12;
  const list = [];
  const fi = f0 * (0.92 + 0.16 * R());                                 // one individual pitch
  for (let b = 0; b < booms; b++) {
    // SAV: the silent 18–20 Hz body vibration (crocodilian) that precedes each boom; it shortens
    // through the bout (1.35 s → 0.55 s by the 5th) — this is what makes the water dance
    const sav = clamp(1.35 - 0.2 * b + 0.12 * (R() - 0.5), 0.5, 1.5), savF = 18.5 + 1.5 * R();
    const t0 = t + sav + 0.05;
    const d = clamp(lognorm(R, 1.35, 0.3), 0.8, 2.0);
    const u = R();
    list.push({ sav: [t, sav, savF], t0, d, f: fi * (1 - 0.04 * b), onset: 0.15 + 0.15 * R(),
      sub: u < 0.25, bi: u >= 0.25 && u < 0.35, jump: R() < 0.08, subAt: 0.25 + 0.4 * R(), subLen: 0.1 + 0.2 * R(),
      amF: 5 + 15 * R(), amD: 0.1 + 0.1 * R() });
    t = t0 + d + clamp(lognorm(R, 3.5, 0.4), 2.0, 8.0);                 // lognormal gaps, median 3.5 s
  }
  return { gulps: gulpT, inhale, booms: list, end: list[list.length - 1].t0 + list[list.length - 1].d + 0.5 };
}
export function theropodBoom(sr, { seed = 1, booms = 2, f0 = 31, size = 1, plan: bp = null, sav = true } = {}) {
  const P = bp || boomPlan({ seed, booms, f0 });
  const R = mulberry32(seed * 3 + 1);
  const plan = P.booms, inhale = P.inhale;
  const dur = P.end + 0.6, n = Math.floor(sr * dur), out = new Float32Array(n);
  // gulps: short wet clicks of the glottis/throat closing + a low throat thump
  for (const g0 of P.gulps) {
    const i0 = Math.floor(g0 * sr), bp2 = new Biquad(sr, 'bandpass', 700, 1.5);
    for (let j = 0; j < sr * 0.12 && i0 + j < n; j++) { const u = j / sr; out[i0 + j] += 0.05 * size * bp2.run(R() * 2 - 1) * Math.exp(-u / 0.015) + 0.12 * size * Math.sin(TAU * 55 * u) * Math.exp(-u / 0.04) * (1 - Math.exp(-u / 0.003)); }
  }
  // inhale: turbulent flow through the nares (200–800 Hz), rising then cut
  { const bp1 = new Biquad(sr, 'bandpass', 500, 0.8), lp = new Biquad(sr, 'lowpass', 1200, 0.7);
    const i0 = Math.floor(inhale[0] * sr), L = Math.floor(inhale[1] * sr);
    for (let j = 0; j < L; j++) { const u = j / L, e = Math.pow(Math.sin(Math.PI * Math.pow(u, 0.7)), 1.5); if ((j & 63) === 0) bp1.set('bandpass', 250 + 450 * u, 0.9); out[i0 + j] += 0.07 * size * e * lp.run(bp1.run(R() * 2 - 1)); } }
  for (const B of plan) {
    // SAV: felt more than heard (a sub-channel sine) + the rattle of droplets it throws (see water-dance.js)
    if (sav) {
      const [ts, ds, fs] = B.sav, i0 = Math.floor(ts * sr), L = Math.floor(ds * sr);
      let ph = 0; const hp = new Biquad(sr, 'highpass', 2000, 0.7);
      for (let j = 0; j < L && i0 + j < n; j++) {
        const u = j / sr, e = sstep(0, 0.25, u) * (1 - sstep(ds - 0.3, ds, u));
        ph += TAU * fs / sr;
        out[i0 + j] += 0.5 * size * e * Math.sin(ph);
        // droplet rattle: grain density follows the rectified Faraday envelope (fs/2)
        if (R() < 0.004 * e * Math.max(0, Math.sin(ph / 2))) { const g = 0.02 + 0.05 * R(), ff = 1500 + 3000 * R(); for (let q = 0; q < sr * 0.012 && i0 + j + q < n; q++) out[i0 + j + q] += g * e * Math.sin(TAU * ff * q / sr) * Math.exp(-q / sr / 0.003); }
      }
    }
    const trem = smoothNoise(Math.floor(R() * 1e6)), press = fbmNoise(Math.floor(R() * 1e6), 3);
    const d = B.d, on = B.onset;
    // onset: a roar-like pulse sweeping 200→100 Hz (cassowary), mouth slightly open, then the boom
    const f0c = (t) => {
      if (t < on) return lerp(200, 100, t / on);
      const tb = t - on;
      let f = B.f * (1 + 0.12 * Math.exp(-tb / 0.05) - 0.13 * sstep(d - 0.3, d, tb)) * (1 + 0.03 * trem(tb * 3));
      if (B.jump && tb > d * 0.55 && tb < d * 0.55 + 0.05) f *= 1.25;
      return f;
    };
    const amp = (t) => sstep(0, 0.06, t) * (1 - sstep(on + d - 0.25, on + d, t)) * (0.85 + 0.15 * press(t * 2.5)) * (1 - B.amD * (0.5 + 0.5 * Math.sin(TAU * B.amF * t)));
    const g = glottal(sr, on + d, {
      f0: f0c, jitter: 0.02, shimmer: 0.08, oq: 0.55, skew: 0.62, breath: 0.03, seed: Math.floor(R() * 1e6), amp,
      chaos: (t) => (t < on ? 0.6 : 0) + 0.4 * sstep(on + d * 0.85, on + d, t),
      subharm: (t) => (t < on ? 0.7 : 0) + (B.sub ? sstep(on + B.subAt * d, on + B.subAt * d + 0.05, t) * (1 - sstep(on + B.subAt * d + B.subLen, on + B.subAt * d + B.subLen + 0.05, t)) : 0),
    });
    const x = g.buf;
    // biphonation (10 %): a second, independent oscillator at 1.37·f0 for part of the call
    if (B.bi) { const g2 = glottal(sr, on + d, { f0: (t) => f0c(t) * 1.37, jitter: 0.03, shimmer: 0.1, oq: 0.55, seed: Math.floor(R() * 1e6), amp: (t) => amp(t) * 0.5 * sstep(on + 0.3 * d, on + 0.4 * d, t) * (1 - sstep(on + 0.7 * d, on + 0.8 * d, t)) }); for (let i = 0; i < x.length; i++) x[i] += g2.buf[i]; }
    // filter: sac resonance at 1.1·f0 (Q ≈ 4) + 2f0 + skin low-pass; open-mouth formants leak at −20 dB
    const openness = (t) => t < on ? 1 : Math.max(0.1, 1 - (t - on) / 0.1);
    const sac = formants(sr, x, [{ f: 1.1 * B.f, bw: 1.1 * B.f / 4, g: 1.0 }, { f: 2.1 * B.f, bw: 2.1 * B.f / 3, g: 0.5 }, { f: 3.1 * B.f, bw: 40, g: 0.22 }]);
    const mouth = formants(sr, x, [{ f: 143, bw: 60, g: (t) => 0.9 * openness(t) }, { f: 430, bw: 120, g: (t) => 0.35 * openness(t) }, { f: 715, bw: 180, g: (t) => 0.12 * openness(t) }]);
    const mix = new Float32Array(x.length);
    for (let i = 0; i < x.length; i++) mix[i] = sac[i] + mouth[i] * 0.6 + x[i] * 0.003;
    const skin = chain(sr, mix, [{ type: 'lowpass', f: 3.2 * B.f, q: 0.6 }, { type: 'lowpass', f: 400, q: 0.6 }]);
    const i0 = Math.floor((B.t0 - on) * sr), bpN = new Biquad(sr, 'bandpass', 900, 0.8);
    for (let i = 0; i < skin.length && i0 + i < n; i++) out[i0 + i] += soft(skin[i] * 3.2 * size, 1.1, 0.05) + 0.004 * size * amp(i / sr) * bpN.run(R() * 2 - 1);
  }
  return new Biquad(sr, 'highpass', 14, 0.7).process(out);
}

/** A generic "movie roar" (the old recipe, for the A/B spectrogram): saw+FM growl, swept formant noise, tanh. */
export function movieRoar(sr, { seed = 3 } = {}) {
  const d = 1.6, n = Math.floor(sr * (d + 0.4)), out = new Float32Array(n), R = mulberry32(seed);
  let ph = 0, pm = 0; const bp = new Biquad(sr, 'bandpass', 350, 2.5), lp = new Biquad(sr, 'lowpass', 1400, 0.7);
  for (let i = 0; i < n; i++) {
    const t = i / sr; pm += TAU * 23 / sr; const f = lerp(95, 70, t / d) + 30 * Math.sin(pm); ph += TAU * f / sr;
    const saw = 2 * ((ph / TAU) % 1) - 1;
    if ((i & 31) === 0) bp.set('bandpass', t < d * 0.4 ? lerp(350, 900, t / (d * 0.4)) : lerp(900, 260, (t - d * 0.4) / (d * 0.6)), 2.5);
    const env = sstep(0, 0.12, t) * (t < d * 0.75 ? 1 : Math.exp(-(t - d * 0.75) / 0.12));
    out[i] = Math.tanh(2.5 * (lp.run(saw) + 1.4 * bp.run(R() * 2 - 1))) * env * 0.5;
  }
  return out;
}

/**
 * AMPHIBIAN: a bullfrog-like advertisement call ("jug-o-rum"), scaled toward a large amphibian.
 * Notes 0.4–0.9 s in a series of 3–6, each a harmonic pulse train (f0 ≈ 90–110 Hz) through two
 * resonances (the bimodal bullfrog spectrum: a low peak ~200–300 Hz and a high peak ~1.3–1.5 kHz;
 * `size` > 1 lowers both toward a bigger animal), fast attack, slow amplitude decay, slight f0 rise.
 */
export function frogCall(sr, { seed = 1, notes = 4, size = 1 } = {}) {
  const R = mulberry32(seed), plan = [];
  let t = 0.05;
  for (let k = 0; k < notes; k++) { const d = 0.48 + 0.115 * R(); plan.push([t, d, 1 + Math.floor(R() * 3)]); t += d + 0.5 + 0.03 * R() + 0.04 * k; }   // notes 480–595 ms, gaps 500–530 ms
  const n = Math.floor(sr * (t + 0.3)), out = new Float32Array(n);
  const fs = Math.pow(size, -0.5);
  for (const [t0, d, humps] of plan) {
    const f1 = (95 + 25 * R()) * fs;                                     // pulse rate 80–135 Hz
    const g = glottal(sr, d, { f0: (u) => f1 * (1 + 0.06 * u / d), jitter: 0.01, shimmer: 0.05, oq: 0.35, skew: 0.8, breath: 0.01, seed: Math.floor(R() * 1e6),
      amp: (u) => sstep(0, 0.04, u) * (1 - sstep(d - 0.06, d, u)) * (0.55 + 0.45 * Math.pow(Math.abs(Math.sin(Math.PI * humps * u / d)), 0.8)) });   // 1–3 AM humps
    const y = formants(sr, g.buf, [{ f: 250 * fs, bw: 250 * fs / 3, g: 1 }, { f: 1400 * fs, bw: 1400 * fs / 5, g: 6 }, { f: 2700 * fs, bw: 500, g: 0.3 }]);   // bimodal: the high band ≈ −10 dB
    const lp = chain(sr, y, [{ type: 'lowpass', f: 2000, q: 0.7 }]);  // vocal sac
    const i0 = Math.floor(t0 * sr);
    for (let i = 0; i < lp.length && i0 + i < n; i++) out[i0 + i] += lp[i] * 3;
  }
  return out;
}

/**
 * LIZARD (monitor-sized): a defensive hiss — forced exhalation through the glottis: broadband
 * noise shaped by a ~0.12 m tract (open–open resonances ≈ c/2L multiples: 1.4, 2.9, 4.3 kHz, wide),
 * sharp onset (≈10 ms) with a low "huff" (throat, 300–800 Hz), a sustain with pressure wobble, and
 * a taper; optionally a second, shorter hiss after an inhale. Unvoiced: no f0.
 */
export function lizardHiss(sr, { seed = 1, count = 2 } = {}) {
  const R = mulberry32(seed), plan = [];
  let t = 0.05;
  for (let k = 0; k < count; k++) { const d = clamp(lognorm(R, k ? 0.55 : 0.95, 0.25), 0.4, 1.5); plan.push([t, d]); t += d + 0.3 + 0.3 * R(); }
  const n = Math.floor(sr * (t + 0.2)), out = new Float32Array(n);
  for (const [t0, d] of plan) {
    const L = Math.floor(sr * d), x = new Float32Array(L), wob = smoothNoise(Math.floor(R() * 1e6)), pk = pinkGen(R);
    for (let i = 0; i < L; i++) { const u = i / sr; x[i] = pk() * sstep(0, 0.025, u) * Math.exp(-u / 0.4) * (1 - sstep(d - 0.08, d, u)) * (0.85 + 0.15 * wob(u * 18)); }
    const y = chain(sr, x, [{ type: 'highpass', f: 1500, q: 0.6 }, { type: 'lowpass', f: 9000, q: 0.6 }, { type: 'peak', f: 4000, q: 0.8, g: 8 }]);
    const throat = formants(sr, x, [{ f: 1000, bw: 350, g: 1 }]);
    const i0 = Math.floor(t0 * sr);
    for (let i = 0; i < L && i0 + i < n; i++) out[i0 + i] += y[i] * 1.5 + throat[i] * 0.5;
  }
  return out;
}

/**
 * FOX: the red fox contact bark series ("wow-wow-wow"): 3–5 short barks, each rising–falling in f0
 * (≈ 450–700 Hz), harsh (strong harmonics to 5 kHz, a chaotic onset), through a ~0.12 m canid
 * tract (formants ≈ 700, 1800, 2900, 4000 Hz, the mouth opening during each bark), with lognormal
 * inter-bark intervals (≈0.4–0.9 s).
 */
export function foxBarks(sr, { seed = 1, count = 4 } = {}) {
  const R = mulberry32(seed), plan = [];
  let t = 0.05;
  for (let k = 0; k < count; k++) { const d = 0.12 + 0.08 * R(); plan.push([t, d]); t += d + clamp(0.35 + 0.06 * k + 0.12 * R(), 0.3, 0.75); }   // slowing series
  const n = Math.floor(sr * (t + 0.2)), out = new Float32Array(n);
  for (const [t0, d] of plan) {
    const s0 = 0.93 + 0.14 * R();
    // f0 700 → 1000 → 750 Hz over the syllable; a noisy "w" offglide in the last 30 %
    const g = glottal(sr, d, { f0: (u) => s0 * (u < 0.35 * d ? lerp(700, 1000, u / (0.35 * d)) : lerp(1000, 750, (u - 0.35 * d) / (0.65 * d))), jitter: 0.02, shimmer: 0.08, oq: 0.4, skew: 0.75,
      breath: 0.15, seed: Math.floor(R() * 1e6), chaos: (u) => (1 - sstep(0.0, 0.03, u)) + 0.5 * sstep(0.7 * d, d, u), amp: (u) => sstep(0, 0.012, u) * (1 - sstep(d * 0.6, d, u)) });
    const y = formants(sr, g.buf, [{ f: 1200, bw: 250, g: 1 }, { f: 2600, bw: 400, g: 0.6 }, { f: 3800, bw: 600, g: 0.35 }, { f: 700, bw: 250, g: 0.35 }]);
    const i0 = Math.floor(t0 * sr);
    for (let i = 0; i < y.length && i0 + i < n; i++) out[i0 + i] += y[i] * 2.5;
  }
  return out;
}

/**
 * CHIMPANZEE pant-hoot: introduction (2–3 low "hoo"s, f0 ≈ 250–350 Hz, lips funnelled → low
 * formants) → build-up (pants: voiced exhale "hoo" + voiced inhale, accelerating from ≈2.5 to 6
 * per second, f0 climbing) → climax (1–3 screams, f0 ≈ 0.9–1.5 kHz, harsh, nonlinear) → let-down
 * (a few slowing pants). Each element is its own source-filter event with seeded irregularity.
 */
export function pantHoot(sr, { seed = 1, scale = 1, full = true } = {}) {
  const R = mulberry32(seed), ev = [];
  let t = 0.05;
  if (full) for (let k = 0; k < 3 + Math.floor(R() * 2); k++) { const d = 0.25 + 0.15 * R(); ev.push({ t, d, f: 450 + 100 * R(), form: 'hoo', g: 0.7, breath: 0.12, nl: 0 }); t += d + 0.15 + 0.15 * R(); }   // introduction
  const nb = 5 + Math.floor(R() * 3);                                                      // build-up: 5.3 ± 4 exhales
  for (let k = 0; k < nb; k++) {
    const u = k / (nb - 1), per = lerp(1 / 3, 1 / 6, u) * (1 + 0.08 * gauss(R));        // 3 → 6 pairs per second
    ev.push({ t, d: per * 0.55, f: lerp(300, 450, u) * (1 + 0.04 * gauss(R)), form: 'hoo', g: lerp(0.6, 1, u), breath: 0.2, nl: 0 });
    ev.push({ t: t + per * 0.58, d: per * 0.38, f: 0, form: 'inhale', g: lerp(0.35, 0.6, u), breath: 1, nl: 0 });  // noisy inhale
    t += per;
  }
  t += 0.03;
  for (let k = 0; k < 2 + Math.floor(R() * 2); k++) { const d = 0.25 + 0.25 * R(); ev.push({ t, d, f: 900 + 350 * R(), form: 'scream', g: 1.2, breath: 0.3, nl: R() < 0.55 ? 1 : 0 }); t += d + 0.08 + 0.1 * R(); }   // climax, peak ≈ 1170 Hz; 55 % with NLP
  for (let k = 0; k < 2; k++) { const d = 0.2 + 0.1 * R(); ev.push({ t, d, f: 520 - 90 * k, form: 'hoo', g: 0.5 - 0.15 * k, breath: 0.3, nl: 0 }); t += d + 0.18 + 0.1 * k; }  // let-down
  const n = Math.floor(sr * (t + 0.3)), out = new Float32Array(n);
  const FORM = {
    hoo: [{ f: 420, bw: 120, g: 1 }, { f: 850, bw: 200, g: 0.35 }, { f: 2400, bw: 400, g: 0.06 }],
    scream: [{ f: 1150, bw: 350, g: 1 }, { f: 2200, bw: 500, g: 0.7 }, { f: 3400, bw: 700, g: 0.35 }],
  };
  for (const e of ev) {
    const i0 = Math.floor(e.t * sr);
    if (e.form === 'inhale') {                                                              // turbulent, unvoiced
      const L = Math.floor(e.d * sr), bp = new Biquad(sr, 'bandpass', 1400, 0.6);
      for (let i = 0; i < L && i0 + i < n; i++) out[i0 + i] += 0.25 * e.g * bp.run(R() * 2 - 1) * Math.sin(Math.PI * i / L);
      continue;
    }
    const g = glottal(sr, e.d, { f0: (u) => e.f * (1 + (e.form === 'scream' ? 0.12 * Math.sin(Math.PI * u / e.d) : 0.05 * u / e.d)), jitter: e.nl ? 0.04 : 0.015, shimmer: e.nl ? 0.2 : 0.07,
      oq: e.form === 'scream' ? 0.35 : 0.6, breath: e.breath, seed: Math.floor(R() * 1e6), chaos: (u) => e.nl * 0.6 * sstep(0.3 * e.d, 0.4 * e.d, u) * (1 - sstep(0.7 * e.d, 0.8 * e.d, u)),
      amp: (u) => sstep(0, 0.02, u) * (1 - sstep(e.d * 0.6, e.d, u)) });
    if (e.nl) { const g2 = glottal(sr, e.d, { f0: (u) => e.f * 1.41, jitter: 0.05, shimmer: 0.2, oq: 0.35, seed: Math.floor(R() * 1e6), amp: (u) => 0.5 * sstep(0.25 * e.d, 0.35 * e.d, u) * (1 - sstep(0.6 * e.d, 0.75 * e.d, u)) }); for (let i = 0; i < g.buf.length; i++) g.buf[i] += g2.buf[i]; }   // biphonation
    const y = formants(sr, g.buf, FORM[e.form].map(F => ({ ...F, f: F.f / scale })));
    for (let i = 0; i < y.length && i0 + i < n; i++) out[i0 + i] += y[i] * e.g * 1.6;
  }
  return out;
}

/**
 * EARLY TETRAPOD haul-out (no calls: acoustic communication evolved much later in each lineage):
 * a push-up grunt of breath through the nares (noise 200–2000 Hz, 0.2–0.5 s), an air gulp (a wet
 * click + a short low throat thump), the belly dragging on wet sand (a granular swish shaped by the
 * lunge velocity) and water streaming off (Minnaert drip pops). `lunges`: times (s) of each push.
 */
export function tetrapodHaulOut(sr, { seed = 1, lunges = [0.3, 1.9], gulpAt = 1.25 } = {}) {
  const R = mulberry32(seed), dur = Math.max(...lunges) + 1.6, n = Math.floor(sr * dur), out = new Float32Array(n);
  for (const t0 of lunges) {
    // exhale puff on the push
    { const d = 0.25 + 0.2 * R(), bp = new Biquad(sr, 'bandpass', 600, 0.6), i0 = Math.floor(t0 * sr);
      for (let j = 0; j < d * sr && i0 + j < n; j++) { const u = j / (d * sr); if ((j & 63) === 0) bp.set('bandpass', lerp(900, 400, u), 0.7); out[i0 + j] += 0.12 * Math.pow(Math.sin(Math.PI * Math.pow(u, 0.5)), 2) * bp.run(R() * 2 - 1); } }
    // belly drag: granular swish following the surge (0.7 s), wet → mostly low-mid hiss
    { const d = 0.75, hp = new Biquad(sr, 'bandpass', 1400, 0.5), i0 = Math.floor((t0 + 0.05) * sr);
      for (let j = 0; j < d * sr && i0 + j < n; j++) { const u = j / (d * sr), v = Math.sin(Math.PI * u) ** 2; if (R() < 0.08 * v) { const g = 0.03 * v * (0.3 + R()), L = Math.floor(sr * (0.0008 + 0.002 * R())); for (let q = 0; q < L && i0 + j + q < n; q++) out[i0 + j + q] += g * (R() * 2 - 1); } out[i0 + j] += 0.02 * v * hp.run(R() * 2 - 1); } }
    // drips off the flank for ~1 s after each lunge
    for (let k = 0; k < 10; k++) { const td = t0 + 0.2 + R() * 1.1, r = 1 + 2.5 * R(), f = 3260 / r, i0 = Math.floor(td * sr), a = 0.03 * (0.3 + R()); for (let q = 0; q < sr * 0.03 && i0 + q < n; q++) { const u = q / sr; out[i0 + q] += a * Math.sin(TAU * f * u * (1 + 2 * u)) * Math.exp(-u / 0.005); } }
  }
  // (drag grains are sand, not glass: roll off above ~5 kHz)
  { const lp = new Biquad(sr, 'lowpass', 5000, 0.6); for (let i = 0; i < n; i++) out[i] = lp.run(out[i]); }
  // air gulp: jaw snap-click + low thump + a short inflow hiss
  { const i0 = Math.floor(gulpAt * sr), bp = new Biquad(sr, 'bandpass', 1800, 1.2);
    for (let j = 0; j < 0.25 * sr && i0 + j < n; j++) { const u = j / sr; out[i0 + j] += 0.08 * bp.run(R() * 2 - 1) * Math.exp(-u / 0.006) + 0.1 * Math.sin(TAU * 70 * u) * Math.exp(-u / 0.05) * (1 - Math.exp(-u / 0.004)) + 0.02 * (R() * 2 - 1) * Math.exp(-Math.abs(u - 0.12) / 0.04); } }
  return out;
}
/** Torch ignition + burn (Farnell): a band-swept "whoomph", then crackles (Poisson, band-passed at
 *  1500 + 500·decay_ms, Q 1), hiss (HP 1 kHz × squared slow noise) and lapping (≈30 Hz, clipped). */
export function torch(sr, { seed = 1, dur = 4, igniteAt = 0.3 } = {}) {
  const R = mulberry32(seed), n = Math.floor(sr * dur), out = new Float32Array(n);
  const slow = smoothNoise(seed + 3), hp = new Biquad(sr, 'highpass', 1000, 0.7), lap = new Biquad(sr, 'bandpass', 30, 0.8), bpW = new Biquad(sr, 'bandpass', 150, 0.9);
  for (let i = 0; i < n; i++) {
    const t = i / sr, on = sstep(igniteAt, igniteAt + 0.15, t);
    if (t >= igniteAt && t < igniteAt + 0.8) { const u = (t - igniteAt) / 0.8; if ((i & 63) === 0) bpW.set('bandpass', lerp(150, 600, Math.sqrt(u)), 0.9); out[i] += 0.5 * Math.sin(Math.PI * Math.pow(u, 0.4)) ** 2 * bpW.run(R() * 2 - 1); }
    const sn = slow(t * 1.0);
    out[i] += on * (0.03 * sn * sn * hp.run(R() * 2 - 1) + 0.12 * Math.tanh(3 * lap.run(R() * 2 - 1)));
  }
  let t = igniteAt;
  while (t < dur) {
    const rate = t < igniteAt + 2 ? 10 : 2;                             // a crackle burst, then settling
    t += -Math.log(Math.max(1e-6, R())) / rate;
    const dms = 30 * R(), f = 1500 + 500 * dms, i0 = Math.floor(t * sr), bp = new Biquad(sr, 'bandpass', f, 1), a = 0.3 * (0.2 + R() * R());
    for (let q = 0; q < sr * 0.05 && i0 + q < n; q++) out[i0 + q] += a * bp.run(R() * 2 - 1) * Math.exp(-q / sr / (0.001 + dms / 1000));
  }
  return new Biquad(sr, 'highpass', 25, 0.7).process(out);
}

// ============================================================================ registry
// Each: render(sr) → buffer; f0: [min,max] for the YIN tracker; maxHz / lowHz for spectrograms.
const scene = (sr, dur, fn) => { const o = stereo(sr, dur); fn(o); return normalize(o, -3); };
export const SOUNDS = {
  // footsteps: one per animal at its real mass, on wet sand, 12 m away
  'step-salamander': { render: (sr) => normalize(outdoor(sr, footstep(sr, { m: 0.3, kind: 'paw', seed: 3 }), { distance: 3 }), -12), maxHz: 12000 },
  'step-monitor': { render: (sr) => normalize(outdoor(sr, footstep(sr, { m: 6, kind: 'claw', seed: 4 }), { distance: 6 }), -9), maxHz: 12000 },
  'step-fox': { render: (sr) => normalize(outdoor(sr, footstep(sr, { m: 6, kind: 'paw', seed: 5 }), { distance: 8 }), -9), maxHz: 12000 },
  'step-chimp-knuckle': { render: (sr) => normalize(outdoor(sr, footstep(sr, { m: 45, kind: 'knuckle', seed: 6 }), { distance: 10 }), -6), maxHz: 12000 },
  'step-human': { render: (sr) => normalize(outdoor(sr, footstep(sr, { m: 55, kind: 'foot', seed: 7 }), { distance: 10 }), -6), maxHz: 12000 },
  'step-theropod': { render: (sr) => normalize(outdoor(sr, footstep(sr, { m: 1500, kind: 'claw', seed: 8, v: 0.8 }), { distance: 14, hs: 0 }), -1), maxHz: 4000, lowHz: 400 },
  'step-tetrapod-belly': { render: (sr) => normalize(outdoor(sr, footstep(sr, { m: 120, kind: 'belly', ground: 'water', seed: 9 }), { distance: 10, hs: 0 }), -3), maxHz: 12000 },
  // theropod: closed-mouth boom bout vs the old movie roar
  'theropod-boom': { render: (sr) => normalize(outdoor(sr, theropodBoom(sr, { seed: 5, booms: 2 }), { distance: 14, hs: 1.8, tail: 0.1 }), -1), f0: [20, 80], maxHz: 3000, lowHz: 400 },
  'theropod-boom-bout': { render: (sr) => normalize(outdoor(sr, theropodBoom(sr, { seed: 9, booms: 4 }), { distance: 14, hs: 1.8, tail: 0.1 }), -1), f0: [20, 80], maxHz: 1500, lowHz: 300 },
  'movie-roar-before': { render: (sr) => normalize(outdoor(sr, movieRoar(sr), { distance: 14, hs: 1.8 }), -1), f0: [40, 400], maxHz: 3000, lowHz: 400 },
  'amphibian-croak': { render: (sr) => normalize(outdoor(sr, frogCall(sr, { seed: 7, notes: 5 }), { distance: 10, hs: 0.2 }), -2), f0: [60, 180], maxHz: 4000, lowHz: 1000 },
  'lizard-hiss': { render: (sr) => normalize(outdoor(sr, lizardHiss(sr, { seed: 4 }), { distance: 6, hs: 0.3 }), -3), maxHz: 12000 },
  'fox-barks': { render: (sr) => normalize(outdoor(sr, foxBarks(sr, { seed: 2 }), { distance: 12, hs: 0.4 }), -2), f0: [500, 1300], maxHz: 8000 },
  'chimp-pant-hoot': { render: (sr) => normalize(outdoor(sr, pantHoot(sr, { seed: 3 }), { distance: 14, hs: 1 }), -2), f0: [200, 1800], maxHz: 6000 },
  'tetrapod-haulout': { render: (sr) => normalize(outdoor(sr, tetrapodHaulOut(sr, { seed: 2 }), { distance: 9, hs: 0.2 }), -3), maxHz: 8000 },
  'torch-ignite': { render: (sr) => normalize(outdoor(sr, torch(sr, { seed: 4 }), { distance: 8, hs: 1.8 }), -2), maxHz: 8000 },
  // ambience
  'amb-surf': { render: (sr) => normalize(surf(sr, 30, { seed: 11 }), -3), maxHz: 8000, logF: true },
  'amb-wind': { render: (sr) => normalize(wind(sr, 20, { seed: 21 }), -6), maxHz: 4000 },
  'amb-flock': { render: (sr) => normalize(flock(sr, 20, { seed: 31 }), -6), maxHz: 8000 },
};
