// ORIGIN: src/timeline.js
// ----------------------------------------------------------------------------------------
// THE single source of truth. The score (src/audio/*) and the picture (src/engine/*,
// src/chapters/*) both import this file. Tempo, harmony, every note, every SFX cue, every
// chapter boundary, every camera keyframe, every flash and every typed character live here.
// Sync is therefore constructed from shared data: nothing is lined up by hand.
//
// Pure data + pure functions. No DOM, no clocks, no Math.random. Works in the browser and
// in Node. All randomness comes from seeded mulberry32 streams.
// ----------------------------------------------------------------------------------------
import { PROMPT } from './assets/prompt.js';
import { marchPlan } from './march/plan.js';

export const FPS = 60;
export const DURATION = 200;                  // 3:20 (VI's evolution got 20 s more)
export const FRAMES = FPS * DURATION;         // 12,000. Frame n shows t = n / FPS.
export const W = 1920, H = 1080;
export const SAMPLE_RATE = 48000;
export const AUDIO_TAIL = 6;                  // audio renders to 186 s; the tail folds onto 0 s

// ---------------------------------------------------------------- seeded randomness
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
/** Stateless integer hash → [0, 1). */
export function hash1(n) {
  let x = (n | 0) ^ 0x9E3779B9;
  x = Math.imul(x ^ (x >>> 16), 0x85EBCA6B);
  x = Math.imul(x ^ (x >>> 13), 0xC2B2AE35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

// ---------------------------------------------------------------- tempo map
// Free time before bar 1 (12 s) and after 176 s. The two accelerando breakpoints were solved
// numerically so bars 18, 29, 41 land on 58.000 s, 81.988 s and 106.000 s.
export const tempo = {
  bar1: 12,
  beatsPerBar: 4,
  segments: [
    { t0: 12,             t1: 33.3508893593, bpm0: 84,  bpm1: 84 },
    { t0: 33.3508893593,  t1: 83.9824439740, bpm0: 84,  bpm1: 120 },
    { t0: 83.9824439740,  t1: 188,           bpm0: 120, bpm1: 120 },
    { t0: 188,            t1: 196,           bpm0: 120, bpm1: 60 },
  ],
  freeUntil: 12,
  freeFrom: 196,
};
for (const s of tempo.segments) {
  s.D = s.t1 - s.t0;
  s.beats = s.D * (s.bpm0 + s.bpm1) / 120;
}
{
  let acc = 0;
  for (const s of tempo.segments) { s.b0 = acc; acc += s.beats; }
  tempo.totalBeats = acc;                                     // 296 beats = 74 bars
}

export function bpmAt(t) {
  for (const s of tempo.segments) if (t >= s.t0 && t < s.t1) return s.bpm0 + (s.bpm1 - s.bpm0) * (t - s.t0) / s.D;
  return t < tempo.bar1 ? 84 : 60;
}
/** Beats elapsed since the bar-1 downbeat (negative in the opening free time). */
export function beatAt(t) {
  const segs = tempo.segments;
  if (t <= segs[0].t0) return (t - segs[0].t0) * segs[0].bpm0 / 60;
  for (const s of segs) {
    if (t < s.t1) {
      const x = t - s.t0;
      return s.b0 + (s.bpm0 * x + (s.bpm1 - s.bpm0) * x * x / (2 * s.D)) / 60;
    }
  }
  const last = segs[segs.length - 1];
  return tempo.totalBeats + (t - last.t1) * last.bpm1 / 60;
}
/** Exact inverse of beatAt. */
export function timeAtBeat(b) {
  const segs = tempo.segments;
  if (b <= 0) return segs[0].t0 + b * 60 / segs[0].bpm0;
  for (const s of segs) {
    if (b < s.b0 + s.beats) {
      const B = b - s.b0, a = s.bpm0, d = s.bpm1 - s.bpm0;
      if (Math.abs(d) < 1e-9) return s.t0 + 60 * B / a;
      return s.t0 + s.D * (-a + Math.sqrt(a * a + 120 * B * d / s.D)) / d;
    }
  }
  const last = segs[segs.length - 1];
  return last.t1 + (b - tempo.totalBeats) * 60 / last.bpm1;
}
/** Time of (bar, beat), both 1-based; beat may be fractional (2.5 = the "and" of 2). */
export function bt(bar, beat = 1) { return timeAtBeat((bar - 1) * 4 + (beat - 1)); }
/** Length in seconds of `beats` beats starting at time t. */
export function beatsToSec(t, beats) { return timeAtBeat(beatAt(t) + beats) - t; }
/** {bar, beat, free}. bar/beat are 1-based; beat is fractional. */
export function barBeat(t) {
  if (t < tempo.freeUntil || t >= tempo.freeFrom) return { bar: 0, beat: 0, free: true };
  const b = beatAt(t);
  return { bar: Math.floor(b / 4) + 1, beat: (b % 4) + 1, free: false };
}

// ---------------------------------------------------------------- chapters
export const chapters = [
  { id: 'I',    name: 'SINGULARITY',   start: 0,       end: 12 },
  { id: 'II',   name: 'INFLATION',     start: 12,      end: bt(8) },
  { id: 'III',  name: 'FIRST LIGHT',   start: bt(8),   end: bt(18) },
  { id: 'IV',   name: 'ACCRETION',     start: bt(18),  end: bt(29) },
  { id: 'V',    name: 'PALE BLUE',     start: bt(29),  end: bt(41) },
  { id: 'VI',   name: 'LIFE',          start: bt(41),  end: bt(65) },
  { id: 'VII',  name: 'FIRE TO FIBER', start: bt(65),  end: bt(78) },
  { id: 'VIII', name: 'THE PROMPT',    start: bt(78),  end: DURATION },
];
for (const c of chapters) c.label = `${c.id} · ${c.name}`;
export const chapterById = Object.fromEntries(chapters.map(c => [c.id, c]));

// Hand-off windows: both chapters render inside [a, b]; the compositor blends them with
// a smootherstep weight. The match-moves themselves (shared glow, shared disc, shared
// point…) are each chapter's job, as contracted in STORYBOARD.md.
export const transitions = [
  { from: 'I',   to: 'II',   a: 11.96, b: 12.0 },    // the pinprick → the bang, on the downbeat
  { from: 'II',  to: 'III',  a: 30.0,  b: 33.0 },
  { from: 'III', to: 'IV',   a: 57.2,  b: 58.6 },
  { from: 'IV',  to: 'V',    a: 81.0,  b: 83.0 },
  { from: 'V',   to: 'VI',   a: 105.0, b: 107.0 },
  { from: 'VI',  to: 'VII',  a: 153.0, b: 155.0 },
  { from: 'VII', to: 'VIII', a: 179.2, b: 180.6 },
];
export function smootherstep(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * t * (t * (t * 6 - 15) + 10);
}
/** Chapters visible at t with their blend weights (weights sum to 1). */
export function activeChapters(t) {
  for (const tr of transitions) {
    if (t >= tr.a && t < tr.b) {
      const w = smootherstep(tr.a, tr.b, t);
      return [{ chapter: chapterById[tr.from], weight: 1 - w }, { chapter: chapterById[tr.to], weight: w }];
    }
  }
  const c = chapters.find(c => t >= c.start && t < c.end) || chapters[chapters.length - 1];
  return [{ chapter: c, weight: 1 }];
}
/** The chapter that "owns" t (for labels/HUD): the incoming one once past the midpoint. */
export function chapterAt(t) {
  const a = activeChapters(t);
  return a.length === 1 ? a[0].chapter : (a[1].weight >= 0.5 ? a[1].chapter : a[0].chapter);
}
/** [start, end] window in which a chapter must be able to render (incl. hand-offs). */
export function chapterWindow(id) {
  const c = chapterById[id];
  let s = c.start, e = c.end;
  for (const tr of transitions) {
    if (tr.to === id) s = Math.min(s, tr.a);
    if (tr.from === id) e = Math.max(e, tr.b);
  }
  return [s, e];
}

// ---------------------------------------------------------------- harmony
export const CHORDS = {
  D5:     { pcs: [2, 9],             bass: 2 },
  Dm:     { pcs: [2, 5, 9],          bass: 2 },
  Dm9:    { pcs: [2, 5, 9, 0, 4],    bass: 2 },
  'Dm/F': { pcs: [2, 5, 9],          bass: 5 },
  Bb:     { pcs: [10, 2, 5],         bass: 10 },
  Bbmaj7: { pcs: [10, 2, 5, 9],      bass: 10 },
  F:      { pcs: [5, 9, 0],          bass: 5 },
  'F/A':  { pcs: [5, 9, 0],          bass: 9 },
  C:      { pcs: [0, 4, 7],          bass: 0 },
  'C/E':  { pcs: [0, 4, 7],          bass: 4 },
  C7:     { pcs: [0, 4, 7, 10],      bass: 0 },
  Gm:     { pcs: [7, 10, 2],         bass: 7 },
  Gm9:    { pcs: [7, 10, 2, 5, 9],   bass: 7 },
  A:      { pcs: [9, 1, 4],          bass: 9 },
  A7sus4: { pcs: [9, 2, 4, 7],       bass: 9 },
  Am:     { pcs: [9, 0, 4],          bass: 9 },
};
// One chord per bar; [name, beatOfChange, name2] splits a bar.
export const chart = {
  1: 'Dm', 2: 'Dm', 3: 'Bb', 4: 'F', 5: 'C', 6: 'Gm', 7: ['A7sus4', 3, 'A'],
  8: 'Dm9', 9: 'Dm', 10: 'Bbmaj7', 11: 'Bb', 12: 'Gm9', 13: 'Gm', 14: 'Dm/F', 15: 'Bb', 16: 'C', 17: 'A',
  18: 'Dm', 19: 'Dm', 20: 'Bb', 21: 'C', 22: 'A', 23: 'Dm', 24: 'Bb', 25: 'Gm', 26: 'Dm', 27: 'C', 28: 'C7',
  29: 'F', 30: 'C/E', 31: 'Dm', 32: 'Bb', 33: 'F', 34: 'C', 35: 'Bb', 36: 'Bb', 37: 'Gm', 38: 'C', 39: 'F', 40: 'F',
  // VI (41-64): cells, forest, the breach (51), the march (52-62), the torch (63), nightfall (64)
  41: 'F', 42: 'Am', 43: 'Bb', 44: 'C', 45: 'F', 46: 'Am', 47: 'Bb', 48: 'C', 49: 'Dm', 50: 'Bb', 51: 'F', 52: 'C',
  53: 'Dm', 54: 'Bb', 55: 'F', 56: 'C', 57: 'Dm', 58: 'Bb', 59: 'F', 60: 'C', 61: 'Dm', 62: 'Gm', 63: 'Bb', 64: 'C',
  // VII (65-77)
  65: 'F', 66: 'C', 67: 'Dm', 68: 'Bb', 69: 'F', 70: 'C', 71: 'Bb', 72: 'C', 73: 'Dm', 74: 'Bb', 75: 'F/A', 76: 'Gm', 77: 'C',
  // VIII (78-84)
  78: 'Bb', 79: 'Gm', 80: 'Bb', 81: 'A', 82: 'Dm', 83: 'Bb', 84: ['Gm', 3, 'A'],
};
export function chordNameAt(t) {
  const bb = barBeat(t);
  if (bb.free) return 'D5';
  const e = chart[bb.bar];
  if (!e) return 'D5';
  if (Array.isArray(e)) return bb.beat >= e[1] ? e[2] : e[0];
  return e;
}
export function chordAt(t) { const n = chordNameAt(t); return { name: n, ...CHORDS[n] }; }
export const keyChanges = [
  { t: 0, key: 'D minor', tonic: 2 },
  { t: bt(29), key: 'F major', tonic: 5 },
  { t: bt(78), key: 'D minor', tonic: 2 },
];
export function keyAt(t) { let k = keyChanges[0]; for (const c of keyChanges) if (t >= c.t) k = c; return k; }

/** Nearest MIDI note with pitch class pc to `near`. */
function place(pc, near) { let m = near - ((((near - pc) % 12) + 12) % 12); if (near - m > 6) m += 12; return m; }
/** Spread voicing of a chord inside [lo, hi]. */
function voicing(ch, lo = 55, hi = 77, max = 5) {
  const out = [];
  for (let m = lo; m <= hi && out.length < max; m++) {
    if (ch.pcs.includes(((m % 12) + 12) % 12) && (!out.length || m - out[out.length - 1] >= 3)) out.push(m);
  }
  return out;
}
function bassNote(ch, near = 38) { return place(ch.bass, near); }

// ---------------------------------------------------------------- leitmotif
// Scale degrees 1 5 4 3 2: long-short-short-short-long. Never resolves until 176 s.
export const MOTIF = {
  minor: [0, 7, 5, 3, 2],
  major: [0, 7, 5, 4, 2],
  beats: [0, 1.5, 2, 2.5, 3],          // onsets within the phrase, in beats
  durs:  [1.5, 0.5, 0.5, 0.5, 4],
};

// ---------------------------------------------------------------- composition → events
// Every note is { t, dur, inst, midi, vel, x? }. `x` ∈ [-1, 1] is the on-screen position
// (NDC) of the thing that makes the sound; the mixer pans by it.
export const notes = [];
export const sfx = [];       // { t, dur, type, vel, x, ...params }
export const starBirths = [];     // III: { t, x, y, midi, big }
export const cellDivisions = [];  // VI:  { t, x, y, midi }
export const collisions = [];     // IV:  { t, x, y }
export const bubbles = [];        // V:   { t, x, y, midi }
export const arcs = [];           // VII: { t, from, to, x }
export const leafFlushes = [];    // VI:  { t, midi }  (every marimba note in bars 45-54)

const R = mulberry32(0x0816);
const N = (t, dur, inst, midi, vel, extra) => { const n = { t, dur, inst, midi, vel, ...extra }; notes.push(n); return n; };
const S = (t, dur, type, vel, x = 0, extra) => { const e = { t, dur, type, vel, x, ...extra }; sfx.push(e); return e; };
const barLen = (bar) => bt(bar + 1) - bt(bar);
const beatLen = (bar, beat = 1) => bt(bar, beat + 1) - bt(bar, beat);

function padBar(bar, vel, lo = 55, hi = 77, inst = 'pad') {
  const e = chart[bar];
  const parts = Array.isArray(e) ? [[e[0], 1, e[1]], [e[2], e[1], 5]] : [[e, 1, 5]];
  for (const [name, b0, b1] of parts) {
    const t = bt(bar, b0), dur = bt(bar, b1) - t;
    for (const m of voicing(CHORDS[name], lo, hi)) N(t, dur, inst, m, vel);
  }
}
function subBar(bar, vel, pattern = [1], near = 38, len = null) {
  for (const b of pattern) {
    const t = bt(bar, b);
    const name = chordNameAt(t + 1e-3);
    N(t, len ? beatsToSec(t, len) : beatsToSec(t, 4 - (b - 1)) * 0.98, 'sub', bassNote(CHORDS[name], near), vel);
  }
}
function drums(bar, { kick = [], snare = [], clap = [], hat = [], ohat = [] }, vel = 1, rng = R) {
  for (const b of kick)  N(bt(bar, b), 0.5, 'kick', 36, vel);
  for (const b of snare) N(bt(bar, b), 0.3, 'snare', 38, 0.8 * vel);
  for (const b of clap)  N(bt(bar, b), 0.3, 'clap', 39, 0.7 * vel);
  for (const b of hat)   N(bt(bar, b), 0.06, 'hat', 42, (0.28 + 0.1 * rng()) * vel);
  for (const b of ohat)  N(bt(bar, b), 0.3, 'ohat', 46, 0.3 * vel);
}
function motif(bar, beat, tonicMidi, mode, inst, vel, extra = {}, beatScale = 1) {
  const deg = MOTIF[mode], out = [];
  for (let i = 0; i < 5; i++) {
    const t = bt(bar, beat + MOTIF.beats[i] * beatScale);
    const dur = beatsToSec(t, MOTIF.durs[i] * beatScale);
    out.push(N(t, dur, inst, tonicMidi + deg[i], vel * (i === 0 ? 1 : 0.85), extra));
  }
  return out;
}
const eighths = (from = 1, to = 4.5) => { const a = []; for (let b = from; b <= to; b += 0.5) a.push(b); return a; };
const sixteenths = (from = 1, to = 4.75) => { const a = []; for (let b = from; b <= to; b += 0.25) a.push(b); return a; };

// ===== I · SINGULARITY (free time) ========================================================
// Motif on a pure sine; each note reveals a title glyph (see `title` below).
export const titleGlyphTimes = [3.0, 4.2, 5.0, 5.8, 7.0, 7.6];   // O R I G I N
[[3.0, 1.1, 62], [4.2, 0.75, 69], [5.0, 0.75, 67], [5.8, 1.1, 65], [7.0, 3.4, 64]]
  .forEach(([t, d, m], i) => N(t, d, 'sine', m, i === 0 ? 0.7 : 0.6));
N(7.6, 2.9, 'sub', 26, 0.55, { swell: true });                     // the "N" swell
S(7.0, 3.5, 'riser', 0.75, 0, { hardStop: true });
export const silence = [10.5, 12.0];                                // digital silence

// ===== II · INFLATION (bars 1-7, 84 BPM) ===================================================
S(bt(1), 6.0, 'impact', 1.0, 0, { big: true });
for (let bar = 1; bar <= 7; bar++) {
  padBar(bar, bar === 1 ? 0.9 : 0.55, 50, 79, 'choir');
  subBar(bar, 0.8, bar === 1 ? [1] : [1, 3], 38);
}
N(bt(1), 0.5, 'kick', 36, 1.0);
for (let bar = 2; bar <= 7; bar++) {
  drums(bar, { kick: [1, 3], snare: bar >= 3 ? [3] : [], hat: bar >= 4 ? eighths() : [] }, 0.95);
}
S(bt(7), barLen(7), 'riser', 0.45, 0, { soft: true });

// ===== III · FIRST LIGHT (bars 8-17, 84 → 101.5 BPM) =======================================
for (let bar = 8; bar <= 17; bar++) { padBar(bar, 0.3, 55, 81); subBar(bar, 0.4, [1], 38); }
{
  // Star births: each is an FM bell pitched to the current chord at a screen position.
  const births = [[8, 1, 0, 0, true]];
  for (let bar = 8; bar <= 11; bar++) {
    const count = bar === 8 ? 2 : 3;
    for (let k = 0; k < count; k++) {
      const beat = bar === 8 ? 2.5 + k * 1.0 : 1 + k * 1.25 + (R() < 0.5 ? 0.5 : 0);
      births.push([bar, beat, (R() * 2 - 1) * 0.8, (R() * 2 - 1) * 0.6, false]);
    }
  }
  for (let bar = 14; bar <= 16; bar++) {
    for (let k = 0; k < 2; k++) births.push([bar, 1 + k * 2 + (R() < 0.5 ? 0.5 : 0), (R() * 2 - 1) * 0.85, (R() * 2 - 1) * 0.55, false]);
  }
  for (const [bar, beat, x, y, big] of births) {
    const t = bt(bar, beat);
    const ch = chordAt(t + 1e-3);
    const pc = ch.pcs[Math.floor(R() * ch.pcs.length)];
    const midi = place(pc, big ? 74 : 79 + Math.floor(R() * 5));
    N(t, big ? 5 : 3.2, 'bell', midi, big ? 0.8 : 0.45 + 0.2 * R(), { x });
    starBirths.push({ t, x, y, midi, big });
  }
  // The leitmotif on bells (bars 12-13); every motif bell is also a star birth in the arms.
  for (const n of motif(12, 1, 74, 'minor', 'bell', 0.75)) {
    n.x = (R() * 2 - 1) * 0.5;
    starBirths.push({ t: n.t, x: n.x, y: (R() * 2 - 1) * 0.35, midi: n.midi, big: false, motif: true });
  }
  starBirths.sort((a, b) => a.t - b.t);
}
S(bt(16), bt(18) - bt(16), 'riser', 0.8, 0);
drums(17, { kick: [1, 2, 3, 4], snare: [4.5] }, 0.85);

// ===== IV · ACCRETION (bars 18-28, 101.5 → 118.6 BPM) ======================================
for (let bar = 18; bar <= 28; bar++) padBar(bar, bar >= 23 && bar <= 25 ? 0.6 : 0.4, 52, 79);
for (let bar = 18; bar <= 22; bar++) {
  subBar(bar, 0.7, eighths(), 38, 0.45);
  drums(bar, {
    kick: [1, 2.5, 3],
    snare: bar >= 20 ? [2, 4] : [],
    hat: bar === 22 ? sixteenths() : (bar >= 19 ? eighths() : []),
  }, 0.95);
  // Accretion arpeggio: Karplus-Strong 16ths over chord tones.
  const ch = CHORDS[chart[bar]];
  const tones = voicing(ch, 62, 86, 6);
  sixteenths().forEach((b, i) => N(bt(bar, b), beatLen(bar) * 0.9, 'ks', tones[(i * 3) % tones.length], 0.22 + 0.08 * R(), { x: (R() * 2 - 1) * 0.5 }));
  // Planetesimal collisions: small ticks at screen positions (the picture flashes there).
  if (bar <= 21) for (let k = 0; k < 3; k++) {
    const t = bt(bar, 1 + Math.floor(R() * 16) / 4), x = (R() * 2 - 1) * 0.7, y = (R() * 2 - 1) * 0.35;
    collisions.push({ t, x, y });
    S(t, 0.15, 'tick', 0.35 + 0.2 * R(), x);
  }
}
collisions.sort((a, b) => a.t - b.t);
// Snare roll into the impact.
sixteenths(3, 4.75).forEach((b, i) => N(bt(22, b), 0.2, 'snare', 38, 0.35 + i * 0.07));
S(bt(22), barLen(22), 'riser', 0.9, 0.3);
S(bt(21, 3), bt(23) - bt(21, 3), 'whoosh', 0.8, 0.9, { x1: 0.05 });   // Theia approaches from the right
export const THEIA_T = bt(23);
S(THEIA_T, 7.0, 'impact', 1.0, 0.05, { big: true, theia: true });
N(THEIA_T, 0.5, 'kick', 36, 1.0);
for (let bar = 23; bar <= 25; bar++) { subBar(bar, 0.8, [1, 3], 38); drums(bar, { kick: bar === 23 ? [3] : [1, 3], snare: [3], hat: bar >= 24 ? eighths() : [] }, 0.9); }
for (let bar = 26; bar <= 27; bar++) {
  subBar(bar, 0.6, [1], 38);
  drums(bar, { kick: [1] }, 0.7);
  const tones = voicing(CHORDS[chart[bar]], 67, 88, 6);
  eighths().forEach((b, i) => N(bt(bar, b), beatLen(bar), 'ks', tones[i % tones.length], 0.28, { x: Math.sin(i * 0.9) * 0.4 }));
}
subBar(28, 0.6, [1, 2, 3, 4], 38, 0.9);
drums(28, { kick: [1, 2, 3, 4], hat: sixteenths() }, 0.75);

// ===== V · PALE BLUE (bars 29-40, F major, 120 BPM) ========================================
S(bt(29), 4.0, 'shimmer', 0.6, 0);
for (let bar = 29; bar <= 40; bar++) {
  padBar(bar, 0.5, 57, 84);
  subBar(bar, 0.5, [1], 41);
  if (bar >= 30 && bar <= 38) {
    const tones = voicing(CHORDS[chart[bar]], 60, 86, 6);
    const order = [0, 2, 4, 5, 3, 1, 2, 4];
    eighths().forEach((b, i) => N(bt(bar, b), beatLen(bar) * 1.6, 'ks', tones[order[i] % tones.length], 0.26 + 0.1 * (i === 0), { x: ((i % 4) / 3 - 0.5) * 0.6 }));
  }
  if (bar >= 33 && bar <= 38) drums(bar, { kick: [1, 3], hat: bar >= 35 ? sixteenths().filter((_, i) => i % 2 === 1) : [] }, 0.6);
}
S(bt(37), bt(39) - bt(37), 'whoosh', 0.9, 0, { x1: 0, atmosphere: true });
export const SPLASH_T = bt(39);
S(SPLASH_T, 3.0, 'splash', 1.0, 0);
for (let k = 0; k < 16; k++) {
  const t = SPLASH_T + 0.15 + k * 0.24 + R() * 0.12, x = (R() * 2 - 1) * 0.7;
  const midi = 84 + Math.floor(R() * 10);
  bubbles.push({ t, x, y: -0.8 + R() * 0.3, midi });
  S(t, 0.12, 'bubble', 0.3 + 0.25 * R(), x, { midi });
}

// ===== VI · LIFE (bars 41-64, 120 BPM) =====================================================
// cells 41-43 · surfacing 44 · forest 45-49 · the breach 51 · the march 52-62 · torch 63 · night 64
const R6 = mulberry32(0x6E6F);   // stream for bars 55-64, so every later event keeps its draws
for (let bar = 41; bar <= 64; bar++) {
  const rr = bar <= 54 ? R : R6;
  padBar(bar, 0.3, 57, 81);
  subBar(bar, 0.55, bar >= 45 ? [1, 3] : [1], 41);
  // Marimba ostinato: root-5th-octave-3rd cell.
  const ch = CHORDS[chart[bar]];
  const r = place(ch.bass === 4 ? 0 : ch.pcs[0], 60), fifth = place(ch.pcs[2] ?? ch.pcs[1], r + 7), third = place(ch.pcs[1], r + 16);
  const cell = [r, fifth, r + 12, third, fifth, r + 12, third, fifth];
  eighths().forEach((b, i) => {
    const n = N(bt(bar, b), 0.4, 'marimba', cell[i], (i % 2 ? 0.28 : 0.38) + 0.05 * rr(), { x: (rr() * 2 - 1) * 0.3 });
    if (bar >= 45 && bar <= 49) leafFlushes.push({ t: n.t, midi: n.midi });   // the forest sprouts on the marimba
  });
  if (bar >= 45 && bar <= 54) drums(bar, { kick: [1, 2, 3, 4], hat: bar >= 47 ? [1.5, 2.5, 3.5, 4.5] : [], clap: bar >= 49 ? [2, 4] : [] }, 0.7);
  // The march (55-62) keeps the groove, the dinosaur's bars (57-58) hit hardest; the torch
  // and nightfall (63-64) thin out to the kick so the riser can carry into VII.
  if (bar >= 55 && bar <= 62) drums(bar, { kick: [1, 2, 3, 4], hat: [1.5, 2.5, 3.5, 4.5], clap: bar >= 57 ? [2, 4] : [] }, bar === 57 || bar === 58 ? 0.8 : 0.7, R6);
  if (bar === 63) drums(bar, { kick: [1, 3] }, 0.6, R6);
  if (bar === 64) drums(bar, { kick: [1] }, 0.5, R6);
}
for (let bar = 41; bar <= 44; bar++) {
  for (let k = 0; k < 3; k++) {
    // Same random draws as before (so every later event is unchanged), squeezed into 106–111.8 s.
    const t0 = bt(bar, 1 + k * 1.5 + (R() < 0.3 ? 0.5 : 0)), x = (R() * 2 - 1) * 0.6, y = (R() * 2 - 1) * 0.5;
    const t = bt(41) + (t0 - bt(41)) * 0.72;
    const ch = chordAt(t + 1e-3), midi = place(ch.pcs[Math.floor(R() * ch.pcs.length)], 81);
    cellDivisions.push({ t, x, y, midi });
    S(t, 0.25, 'pop', 0.45, x, { midi });
  }
}
cellDivisions.sort((a, b) => a.t - b.t);
for (const n of motif(45, 1, 65, 'major', 'marimba', 0.62)) leafFlushes.push({ t: n.t, midi: n.midi, motif: true });
for (const n of motif(47, 1, 65, 'major', 'marimba', 0.62)) leafFlushes.push({ t: n.t, midi: n.midi, motif: true });
leafFlushes.sort((a, b) => a.t - b.t);
motif(59, 1, 65, 'major', 'marimba', 0.5);                          // the motif returns as mammals arrive
export const BREACH_T = bt(51);                                      // 126.0: fish → birds
S(bt(50, 3), BREACH_T - bt(50, 3), 'whoosh', 0.6, 0, { x1: 0 });
S(BREACH_T, 1.2, 'splash', 0.55, 0, { small: true });
S(bt(64), barLen(64), 'riser', 0.7, 0);

// ----- The march: evolution on the shore at sunset (128–154 s) ----------------------------
// Seven animals at real size, each on its own gait clock and bout plan (src/march/*), met in turn
// by a camera drifting along the beach; nothing morphs and nothing is on the beat grid. The plan is
// shared: the chapter's visuals plant every foot and time every gesture on these exact events, and
// the audio schedules its synthesised voices from them (research: docs/research/animal-realism.md).
export const march = (() => {
  const P = marchPlan();
  return { t0: P.t0, t1: P.t1, torch: P.torch, standAt: P.standAt, animals: P.animals, events: P.events };
})();
{
  const P = march;
  const h = (str) => { let x = 2166136261; for (let i = 0; i < str.length; i++) x = Math.imul(x ^ str.charCodeAt(i), 16777619); return (x >>> 0) % 100000; };
  const pan = (x) => Math.max(-1, Math.min(1, x));                      // off-screen (|x| > 1) pans hard
  const level = (ref, d, refD) => ref - 20 * Math.log10(Math.max(1, d) / refD);   // 1/r
  for (const e of P.events) {
    const x = pan(e.x);
    if (e.type === 'step') {
      const ref = e.m >= 1000 ? -10 : e.m >= 40 ? -22 : e.m >= 5 ? -28 : -34;      // peak at 8 m, by mass
      S(e.t, 1.2, 'nature', 1, x, { voice: 'footstep', params: { m: e.m, kind: e.kind, ground: e.ground, seed: h(e.animal + e.foot + e.t.toFixed(3)) },
        dist: e.dist, hs: e.m >= 1000 ? 0 : 0.2, peakDb: level(ref, e.dist, 8) });
    } else if (e.type === 'haulout') {
      S(e.t, 3.6, 'nature', 1, x, { voice: 'haulout', params: { lunges: e.lunges, gulpAt: e.gulpAt, seed: e.seed }, dist: e.dist, hs: 0.2, peakDb: level(-17, e.dist, 5) });
    } else if (e.type === 'boom' && e.i === 0) {
      // one render of the whole bout (gulps, inhale, SAV, booms), started at the bout's origin
      S(e.bout.start, e.bout.end + 0.8, 'nature', 1, x, { voice: 'boom', params: { plan: e.bout, seed: 57 }, dist: e.dist, hs: 1.8, peakDb: level(-6, e.dist, 15), duck: true });
    } else if (e.type === 'hiss') {
      S(e.t, e.dur, 'nature', 1, x, { voice: 'hiss', params: { seed: e.seed, count: e.count }, dist: e.dist, hs: 0.3, peakDb: level(-24, e.dist, 4), duck: true });
    } else if (e.type === 'bark') {
      S(e.t, 2.6, 'nature', 1, x, { voice: 'bark', params: { seed: e.seed, count: e.count }, dist: e.dist, hs: 0.4, peakDb: level(-17, e.dist, 12) });
    } else if (e.type === 'panthoot') {
      S(e.t, e.climaxAt - e.t + 3.2, 'nature', 1, x, { voice: 'panthoot', params: { seed: e.seed }, dist: e.dist, hs: 1, peakDb: level(-13, e.dist, 10), duck: true });
    }
  }
  // the torch catches: a whoomph, then a crackle settling to a slow burn (VII's fire takes over)
  S(P.torch - 0.3, 4.0, 'nature', 1, 0, { voice: 'torch', params: { seed: 4, dur: 4, igniteAt: 0.3 }, dist: 3, hs: 1.8, peakDb: -13 });
}
// ----- The shore's ambience (VI) --------------------------------------------------------
// Surf as individual waves from the moment the camera surfaces, wind under the march, a distant
// flock while the birds are overhead. Synthesised in src/audio/nature/voices.js; the long beds
// fade out as night falls into VII's fire.
S(113.7, 154.6 - 113.7, 'nature', 1, 0, { voice: 'surf', params: { seed: 11, period: 8.5 }, peakDb: -15, fadeIn: 1.2, fadeOut: 3.2 });
S(124.0, 154.4 - 124.0, 'nature', 1, 0, { voice: 'wind', params: { seed: 21 }, peakDb: -27, fadeIn: 3, fadeOut: 2.5 });
S(126.4, 151.6 - 126.4, 'nature', 1, 0.2, { voice: 'flock', params: { seed: 31, distance: 140 }, peakDb: -25, fadeIn: 2.5, fadeOut: 2.5 });

// ===== VII · FIRE TO FIBER (bars 65-77, 120 BPM) ===========================================
// The frieze: line drawings laid out along one long scroll; the camera trucks right.
// friezeX(wx, t) gives the NDC x of frieze-space x `wx` at time t; SFX pan by it.
export const frieze = {
  items: [
    { name: 'fire',   wx: 0.0, t0: bt(65), t1: bt(67) },
    { name: 'wheel',  wx: 2.0, t0: bt(67), t1: bt(69) },
    { name: 'press',  wx: 4.0, t0: bt(69), t1: bt(71) },
    { name: 'engine', wx: 6.0, t0: bt(71), t1: bt(73) },
  ],
  // camera truck (frieze units; 2 units = one screen width): hold on each plate while it is
  // drawn and animated, glide to the next between them (clanks 162–165, hisses from 166).
  truck: [[bt(65), 0.0], [156.2, 0.0], [157.6, 2.0], [160.4, 2.0], [161.6, 4.0], [165.2, 4.0], [166.0, 6.0], [bt(73), 6.2]],
};
export function friezeCamX(t) { return pwl(frieze.truck, t); }
export function friezeX(wx, t) { return wx - friezeCamX(t); }

for (let bar = 65; bar <= 77; bar++) {
  padBar(bar, 0.46, 55, 79);
  subBar(bar, 0.8, eighths(), 38, 0.45);
  if (bar <= 76) drums(bar, { kick: [1, 2, 3, 4], clap: [2, 4], hat: sixteenths(), ohat: [1.5, 2.5, 3.5, 4.5] }, 1.0);
}
drums(77, { kick: [1, 2, 3], snare: sixteenths(3, 4.75) }, 0.9);
{
  const L = 'lead';
  motif(65, 1, 65, 'major', L, 0.7);                                  // F C Bb A G
  [[67, 1, 74], [67, 2, 72], [67, 3, 70], [67, 4, 69]].forEach(([b, be, m]) => N(bt(b, be), beatsToSec(bt(b, be), 1), L, m, 0.62));
  N(bt(68), beatsToSec(bt(68), 4), L, 70, 0.6);
  for (const n of motif(69, 1, 65, 'major', L, 0.72)) N(n.t, n.dur, L, n.midi + (n.midi % 12 === 5 || n.midi % 12 === 0 ? 4 : 3), n.vel * 0.8); // in thirds
  [[71, 1, 77], [71, 2, 76], [71, 3, 74], [71, 4, 72]].forEach(([b, be, m]) => N(bt(b, be), beatsToSec(bt(b, be), 1), L, m, 0.66));
  N(bt(72), beatsToSec(bt(72), 4), L, 72, 0.62);
  motif(73, 1, 77, 'major', L, 0.78);                                 // up an octave
  [[75, 1, 81], [75, 2, 79], [75, 3, 77], [75, 4, 76]].forEach(([b, be, m]) => N(bt(b, be), beatsToSec(bt(b, be), 1), L, m, 0.7));
  N(bt(76), beatsToSec(bt(76), 4), L, 74, 0.66);
  N(bt(77), beatsToSec(bt(77), 4), L, 76, 0.6);
}
// Fire crackle stream (granular), panned to the flames as the camera trucks.
S(bt(65), bt(68) - bt(65), 'crackle', 0.55, friezeX(0, bt(65)), { wx: 0.0 });
S(bt(67), 0.9, 'whoosh', 0.35, friezeX(2.0, bt(67)), { x1: friezeX(2.0, bt(67) + 0.9), small: true });
for (const bar of [69, 70]) for (const b of [1, 3]) S(bt(bar, b), 0.6, 'clank', 0.7, friezeX(4.0, bt(bar, b)));
for (const bar of [71, 72]) for (const b of [1, 2, 3, 4]) S(bt(bar, b), 0.35, 'hiss', 0.4, friezeX(6.0, bt(bar, b)));

// ===== Globe (VII, bars 73-77) =============================================================
// Orthographic night-Earth. globeView(t) → centre longitude/latitude (deg) and radius
// (as a fraction of half the screen height). Arcs, zaps and the renderer all use it.
export const ROUND_ROCK = [30.5083, -97.6789];
export const cities = [
  ['Tokyo', 35.68, 139.69], ['Delhi', 28.61, 77.21], ['Shanghai', 31.23, 121.47], ['São Paulo', -23.55, -46.63],
  ['Mexico City', 19.43, -99.13], ['Cairo', 30.04, 31.24], ['Mumbai', 19.08, 72.88], ['Beijing', 39.90, 116.40],
  ['Dhaka', 23.81, 90.41], ['Osaka', 34.69, 135.50], ['New York', 40.71, -74.01], ['Karachi', 24.86, 67.01],
  ['Buenos Aires', -34.60, -58.38], ['Istanbul', 41.01, 28.98], ['Lagos', 6.52, 3.38], ['Manila', 14.60, 120.98],
  ['Rio de Janeiro', -22.91, -43.17], ['Los Angeles', 34.05, -118.24], ['Moscow', 55.76, 37.62], ['Paris', 48.86, 2.35],
  ['London', 51.51, -0.13], ['Bangkok', 13.76, 100.50], ['Jakarta', -6.21, 106.85], ['Lima', -12.05, -77.04],
  ['Seoul', 37.57, 126.98], ['Nairobi', -1.29, 36.82], ['Johannesburg', -26.20, 28.05], ['Sydney', -33.87, 151.21],
  ['Singapore', 1.35, 103.82], ['Chicago', 41.88, -87.63], ['Toronto', 43.65, -79.38], ['Madrid', 40.42, -3.70],
  ['Berlin', 52.52, 13.40], ['Dubai', 25.20, 55.27], ['Hong Kong', 22.32, 114.17], ['Santiago', -33.45, -70.67],
  ['Bogotá', 4.71, -74.07], ['Vancouver', 49.28, -123.12], ['Reykjavík', 64.15, -21.94], ['Anchorage', 61.22, -149.90],
  ['Honolulu', 21.31, -157.86], ['Cape Town', -33.92, 18.42], ['Tehran', 35.69, 51.39], ['Kinshasa', -4.44, 15.27],
  ['San Francisco', 37.77, -122.42], ['Miami', 25.76, -80.19], ['Denver', 39.74, -104.99], ['Atlanta', 33.75, -84.39],
  ['Houston', 29.76, -95.37], ['Dallas', 32.78, -96.80], ['Seattle', 47.61, -122.33], ['Boston', 42.36, -71.06],
  ['Round Rock', ROUND_ROCK[0], ROUND_ROCK[1]],
];
export const globe = {
  // [t, lon0, lat0, radius]
  keys: [
    [bt(72, 3), 10, 20, 0.0],
    [bt(73), 10, 20, 0.78],
    [bt(75), -40, 24, 0.80],
    [bt(76, 3), -88, 28, 0.86],
    [bt(77, 3), ROUND_ROCK[1], ROUND_ROCK[0], 3.2],
    [bt(78), ROUND_ROCK[1], ROUND_ROCK[0], 60],
  ],
};
export function globeView(t) {
  const k = globe.keys;
  if (t <= k[0][0]) return { lon0: k[0][1], lat0: k[0][2], r: k[0][3] };
  for (let i = 0; i < k.length - 1; i++) {
    if (t < k[i + 1][0]) {
      const u = smootherstep(k[i][0], k[i + 1][0], t);
      const lr = Math.log(Math.max(1e-3, k[i][3])), lr1 = Math.log(Math.max(1e-3, k[i + 1][3]));
      return {
        lon0: k[i][1] + (k[i + 1][1] - k[i][1]) * u,
        lat0: k[i][2] + (k[i + 1][2] - k[i][2]) * u,
        r: k[i][3] < 1e-3 ? k[i + 1][3] * u : Math.exp(lr + (lr1 - lr) * u),   // log-zoom
      };
    }
  }
  const l = k[k.length - 1];
  return { lon0: l[1], lat0: l[2], r: l[3] };
}
/** Orthographic projection of (lat, lon) at time t → NDC {x, y, visible}. aspect = W/H. */
export function globeProject(t, lat, lon, aspect = W / H) {
  const v = globeView(t), D = Math.PI / 180;
  const la = lat * D, lo = (lon - v.lon0) * D, la0 = v.lat0 * D;
  const cosc = Math.sin(la0) * Math.sin(la) + Math.cos(la0) * Math.cos(la) * Math.cos(lo);
  const px = Math.cos(la) * Math.sin(lo);
  const py = Math.cos(la0) * Math.sin(la) - Math.sin(la0) * Math.cos(la) * Math.cos(lo);
  return { x: px * v.r / aspect, y: py * v.r, visible: cosc > 0 };
}
{
  // Arcs on the 8th notes, bars 73-76; then they converge on Round Rock (16ths, 76.3-77.3).
  const cityIdx = (name) => cities.findIndex(c => c[0] === name);
  const rr = cityIdx('Round Rock');
  const pool = cities.map((_, i) => i).filter(i => i !== rr);
  let k = 0;
  for (let bar = 73; bar <= 76; bar++) {
    for (const b of eighths()) {
      if (bar === 76 && b >= 3) break;
      const t = bt(bar, b);
      const a = pool[Math.floor(R() * pool.length)];
      let c = pool[Math.floor(R() * pool.length)]; if (c === a) c = pool[(pool.indexOf(a) + 7) % pool.length];
      arcs.push({ t, from: a, to: c, dur: 0.9 });
      k++;
    }
  }
  const conv = ['New York', 'London', 'Tokyo', 'São Paulo', 'Mexico City', 'Seattle', 'Chicago', 'Miami', 'Denver', 'Los Angeles', 'Boston', 'Houston', 'Dallas', 'Atlanta', 'Toronto', 'San Francisco'];
  sixteenths(3, 4.75).concat(sixteenths(1, 1.75).map(b => b + 4)).forEach((b, i) => {
    const t = bt(76, b);
    arcs.push({ t, from: cityIdx(conv[i % conv.length]), to: rr, dur: 1.0, converge: true });
  });
  for (const a of arcs) {
    const [, lat, lon] = cities[a.to];
    const p = globeProject(a.t + a.dur * 0.92, lat, lon);   // where the landing flash is
    a.x = Math.max(-1, Math.min(1, p.x));
    S(a.t + a.dur * 0.92, 0.25, 'zap', a.converge ? 0.32 : 0.4, a.x, { midi: 84 + (a.to * 5) % 12 });
  }
}
S(bt(76, 3), bt(78) - bt(76, 3), 'riser', 0.55, 0, { soft: true });

// ===== VIII · THE PROMPT (bars 78-84, 120 → 60 BPM, then free) =============================
for (let bar = 78; bar <= 81; bar++) { padBar(bar, 0.24, 55, 76); subBar(bar, 0.35, [1], 38); drums(bar, { kick: [1] }, 0.5); }

// Typing schedule: human speed for the first line, then exponential acceleration.
export const typing = (() => {
  const text = PROMPT, n = text.length;
  const start = bt(78, 3);            // 181.0
  const humanChars = 36;              // "Build a 3-minute film called ORIGIN:"
  const last = 187.85;                // the last keystroke; the HUD reads NOW here
  const rng = mulberry32(0x7E57);
  const times = new Float64Array(n);
  let t = start;
  for (let i = 0; i < Math.min(humanChars, n); i++) {
    times[i] = t;
    const c = text[i];
    t += (1 / 15) * (0.65 + 0.7 * rng()) * (c === ' ' ? 1.35 : 1);
  }
  const t0 = t, span = last - t0, rest = n - humanChars, r0 = 15;
  // C(τ) = r0/k (e^{kτ} - 1) chars typed by τ; solve C(span) = rest for k.
  let lo = 0.01, hi = 20;
  for (let it = 0; it < 100; it++) { const k = (lo + hi) / 2; (r0 / k) * (Math.exp(k * span) - 1) < rest ? lo = k : hi = k; }
  const k = (lo + hi) / 2;
  for (let i = humanChars; i < n; i++) {
    const c = i - humanChars + 1;
    times[i] = t0 + Math.log(1 + k * c / r0) / k;
  }
  times[n - 1] = last;
  // Physical key x on a QWERTY keyboard, in [-1, 1]; keyclicks pan by keyX * 0.42.
  const rows = ['`1234567890-=', 'qwertyuiop[]\\', "asdfghjkl;'", 'zxcvbnm,./'];
  const shifted = ['~!@#$%^&*()_+', 'QWERTYUIOP{}|', 'ASDFGHJKL:"', 'ZXCVBNM<>?'];
  const offs = [0, 1.5, 1.8, 2.3];
  const keyPos = (c) => {
    if (c === ' ') return [0, 4];
    if (c === '\n') return [12.9, 2];
    for (let r = 0; r < 4; r++) {
      let i = rows[r].indexOf(c); if (i < 0) i = shifted[r].indexOf(c);
      if (i >= 0) return [offs[r] + i, r];
    }
    return [6.5, 2];   // unicode (→, –, −, ·): somewhere mid-board
  };
  const keyX = new Float32Array(n), keyRow = new Uint8Array(n);
  for (let i = 0; i < n; i++) { const [col, row] = keyPos(text[i]); keyX[i] = (col - 7) / 7.5; keyRow[i] = row; }
  return { text, start, humanChars, last, times, keyX, keyRow, k, enter: bt(82), panScale: 0.42 };
})();
/** Number of characters visible at time t. */
export function typedCount(t) {
  const T = typing.times;
  if (t < T[0]) return 0;
  let lo = 0, hi = T.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (T[m] <= t) lo = m + 1; else hi = m; }
  return lo;
}
S(typing.start, typing.last - typing.start + 0.05, 'keys', 0.8, 0);   // one granular stream, pans per key
S(bt(80), bt(82) - bt(80), 'riser', 0.6, 0);
export const ENTER_T = bt(82);
S(ENTER_T, 3.0, 'thunk', 0.9, 0.3);
S(ENTER_T, 5.0, 'impact', 0.45, 0, { soft: true });
export const renderBar = { t0: ENTER_T + 0.3, t1: 191.6 };
for (let k = 0; k < 12; k++) S(renderBar.t0 + (renderBar.t1 - renderBar.t0) * (k / 11), 0.08, 'tick', 0.18, 0);
// Rit: the leitmotif on the piano-pluck, resolving only at 196 s (E → D).
for (let bar = 82; bar <= 84; bar++) padBar(bar, 0.26, 50, 74);
subBar(82, 0.5, [1], 38); subBar(83, 0.45, [1], 38); subBar(84, 0.45, [1, 3], 38);
motif(82, 1, 62, 'minor', 'piano', 0.7);
N(bt(83, 3), beatsToSec(bt(83, 3), 1.5), 'piano', 57, 0.4);
N(bt(84), beatsToSec(bt(84), 2), 'piano', 58, 0.42);
N(bt(84, 3), 196 - bt(84, 3), 'piano', 64, 0.5);                    // E (unresolved)…
N(196.0, 6.5, 'piano', 62, 0.62);                                    // …→ D at 196: resolution
N(196.0, 6.5, 'piano', 50, 0.35);
N(196.0, 5.5, 'pad', 50, 0.22); N(196.0, 5.5, 'pad', 57, 0.2); N(196.0, 5.5, 'pad', 62, 0.18);

// ----- The march is scored as nature, not as a groove -------------------------------------
// From the first animal (128 s) to the torch (151 s) the drums, claps, marimba and pads fall
// away, and the harmony becomes a slow string bed under the surf, the wind and the animals.
// (They're generated above and removed here, so the shared random streams — and therefore every
// later event — stay exactly as they were.)
{
  const a = march.t0 - 0.02, b = march.torch;
  const drop = new Set(['kick', 'snare', 'clap', 'hat', 'ohat', 'marimba', 'pad', 'sub']);
  for (let i = notes.length - 1; i >= 0; i--) { const n = notes[i]; if (n.t >= a && n.t < b && drop.has(n.inst)) notes.splice(i, 1); }
  for (let bar = 52; bar <= 62; bar++) {
    const t = bt(bar), dur = bt(bar + 1) - t + 1.4;
    const ch = CHORDS[chart[bar]];
    for (const m of voicing(ch, 50, 74, 4)) N(t, dur, 'strings', m, 0.4);
    if (bar % 2 === 0) N(t, bt(bar + 2) - t, 'sub', bassNote(ch, 36), 0.22);
  }
}
notes.sort((a, b) => a.t - b.t || a.midi - b.midi);
sfx.sort((a, b) => a.t - b.t);

// ---------------------------------------------------------------- drone
// Exactly 180 s-periodic: every partial and LFO sits on a multiple of 1/180 Hz, so the loop
// point is sample-continuous. The gain envelope wraps: g(180) = g(0).
export const drone = {
  // [Hz, gain, pan] → stored as [cycles per film, gain, pan]: each partial is rounded to a whole
  // number of cycles over DURATION, so the drone is exactly periodic and the loop is seamless.
  partials: [
    [36.711, 0.55, 0], [36.717, 0.30, -0.2],      // D1, slow beating pair
    [55.067, 0.22, 0.15],                         // A1
    [73.422, 0.20, -0.1], [73.433, 0.12, 0.25],   // D2
    [110.13, 0.08, 0.3],                          // A2
    [146.84, 0.05, -0.3],                         // D3
  ].map(([f, g, p]) => [Math.round(f * DURATION), g, p]),
  lfoCycles: [7, 11, 13],             // amplitude LFOs, cycles per film
  gain: [[0, 0.5], [7.0, 0.5], [10.4, 0.8], [10.5, 0], [12, 0], [188, 0], [192, 0.12], [198, 0.42], [DURATION, 0.5]],
};

// ---------------------------------------------------------------- mix automation
export const automation = {
  silence,
  // Music-bus lowpass: underwater from the plunge until the waterline shot.
  musicLowpass: [[0, 20000], [SPLASH_T - 0.02, 20000], [SPLASH_T + 0.08, 650], [bt(41), 800], [bt(44), 1400], [bt(45), 20000]],
  duckDb: 7, duckRelease: 0.15,
};

// ---------------------------------------------------------------- picture-side events
export const kicks = notes.filter(n => n.inst === 'kick').map(n => n.t);
export const flashes = [
  { t: 12,        name: 'bigbang', dur: 0.3,  gain: 6.0 },
  { t: THEIA_T,   name: 'theia',   dur: 0.6,  gain: 3.0 },
  { t: SPLASH_T,  name: 'splash',  dur: 0.35, gain: 1.6 },
  { t: ENTER_T,   name: 'enter',   dur: 0.25, gain: 0.8 },
];
/** Storyboarded sharp visual beats (besides flashes, kick pulses and star births). The cut
 *  checker allows a single-frame jump only at these, the flashes, kicks and star births. */
export const storyBeats = [
  { t: 10.5, name: 'collapse to pinprick', dur: 0.25 },
  { t: bt(8), name: 'first star ignites', dur: 0.1 },
  { t: bt(63, 3), name: 'the torch catches', dur: 0.3 },
];
/** Exposure pulse per kick (fraction of exposure added at the hit), by chapter. */
export const pulse = { I: 0, II: 0.22, III: 0.16, IV: 0.16, V: 0.12, VI: 0.12, VII: 0.13, VIII: 0.14, tau: 0.085 };
export function kickPulse(t) {
  // Last kick at or before t (kicks are sorted).
  let lo = 0, hi = kicks.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (kicks[m] <= t) lo = m + 1; else hi = m; }
  let p = 0;
  for (let i = lo - 1; i >= Math.max(0, lo - 3); i--) {
    const dt = t - kicks[i];
    const amp = pulse[chapterAt(kicks[i]).id] || 0;
    p += amp * Math.exp(-dt / pulse.tau);
  }
  return p;
}
export function flashAt(t) {
  let f = 0;
  for (const fl of flashes) if (t >= fl.t && t < fl.t + fl.dur * 6) f += fl.gain * Math.exp(-(t - fl.t) / fl.dur);
  return f;
}

// ---------------------------------------------------------------- HUD clock
// Piecewise log-linear in "years ago". Below one year it counts days/hours/minutes/seconds
// and reads NOW from the last keystroke.
export const hud = {
  fadeIn: [1.0, 2.5],
  fadeOut: [194.0, 195.5],
  anchors: [
    [0, 13.8e9], [12, 13.8e9], [bt(5), 13.79962e9], [32, 13.6e9], [bt(12), 12.0e9], [58, 4.6e9],
    [THEIA_T, 4.51e9], [bt(29), 4.4e9], [SPLASH_T, 3.9e9], [106, 3.8e9], [bt(45), 4.7e8],
    [BREACH_T, 3.8e8], [march.animals[0].t0, 3.75e8], [march.animals[1].t0, 3.4e8], [march.animals[2].t0, 3.1e8],
    [march.animals[3].t0, 2.3e8], [march.animals[4].t0, 6.6e7], [march.animals[5].t0, 2.0e7], [march.animals[6].t0, 2.0e6],
    [march.torch, 1.05e6], [bt(65), 1.0e6], [bt(67), 5500],
    [bt(69), 586], [bt(71), 250], [bt(73), 55], [bt(76, 3), 1], [typing.start, 1 / 365.25],
    [typing.times[typing.humanChars], 1 / 8766], [typing.last, 1 / 31557600],
  ],
};
export function yearsAgo(t) {
  const A = hud.anchors;
  if (t >= typing.last) return 0;
  if (t <= A[0][0]) return A[0][1];
  for (let i = 0; i < A.length - 1; i++) {
    if (t < A[i + 1][0]) {
      const u = (t - A[i][0]) / (A[i + 1][0] - A[i][0]);
      return Math.exp(Math.log(A[i][1]) + (Math.log(A[i + 1][1]) - Math.log(A[i][1])) * u);
    }
  }
  return 0;
}
export function hudText(t) {
  const y = yearsAgo(t);
  if (y <= 0) return 'NOW';
  const fmt = (n, unit) => `${Math.round(n).toLocaleString('en-US')} ${unit}${Math.round(n) === 1 ? '' : 'S'} AGO`;
  if (y >= 1) return fmt(y, 'YEAR');
  const d = y * 365.25; if (d >= 1) return fmt(d, 'DAY');
  const h = d * 24;     if (h >= 1) return fmt(h, 'HOUR');
  const m = h * 60;     if (m >= 1) return fmt(m, 'MINUTE');
  return fmt(Math.max(1, m * 60), 'SECOND');
}
export function hudAlpha(t) {
  return smootherstep(hud.fadeIn[0], hud.fadeIn[1], t) * (1 - smootherstep(hud.fadeOut[0], hud.fadeOut[1], t));
}

// ---------------------------------------------------------------- cameras
// Keyframes per chapter: { t, pos: [x,y,z], target: [x,y,z], fov (deg, vertical), roll (deg) }.
// Units are each chapter's own world units. Sampled with Catmull-Rom (sampleCamera).
// Chapter owners edit ONLY their own entry.
export const cameras = {
  // I: uniform 1.75 s key spacing (C1-smooth Catmull-Rom); slow dolly, accelerating in the riser.
  I:    [ { t: 0, pos: [0, 0, 6], target: [0, 0, 0], fov: 40, roll: 0 },
          { t: 1.75, pos: [0, 0, 5.7725], target: [0, 0, 0], fov: 40, roll: 0 },
          { t: 3.5, pos: [0, 0, 5.545], target: [0, 0, 0], fov: 40, roll: 0 },
          { t: 5.25, pos: [0, 0, 5.3175], target: [0, 0, 0], fov: 40, roll: 0 },
          { t: 7.0, pos: [0, 0, 5.09], target: [0, 0, 0], fov: 40, roll: 0 },
          { t: 8.75, pos: [0, 0, 4.68], target: [0, 0, 0], fov: 40, roll: 0 },
          { t: 10.5, pos: [0, 0, 3.9], target: [0, 0, 0], fov: 40, roll: 0 },
          { t: 12.25, pos: [0, 0, 3.55], target: [0, 0, 0], fov: 40, roll: 0 } ],
  // II: collinear keys at uniform spacing beyond the window → constant 2 u/s dolly, linear 12° roll.
  II:   [ { t: 9, pos: [0, 0, 6], target: [0, 0, 5], fov: 60, roll: -1.7143 },
          { t: 12, pos: [0, 0, 0], target: [0, 0, -1], fov: 60, roll: 0 },
          { t: 15, pos: [0, 0, -6], target: [0, 0, -7], fov: 60, roll: 1.7143 },
          { t: 18, pos: [0, 0, -12], target: [0, 0, -13], fov: 60, roll: 3.4286 },
          { t: 21, pos: [0, 0, -18], target: [0, 0, -19], fov: 60, roll: 5.1429 },
          { t: 24, pos: [0, 0, -24], target: [0, 0, -25], fov: 60, roll: 6.8571 },
          { t: 27, pos: [0, 0, -30], target: [0, 0, -31], fov: 60, roll: 8.5714 },
          { t: 30, pos: [0, 0, -36], target: [0, 0, -37], fov: 60, roll: 10.2857 },
          { t: 33, pos: [0, 0, -42], target: [0, 0, -43], fov: 60, roll: 12 },
          { t: 36, pos: [0, 0, -48], target: [0, 0, -49], fov: 60, roll: 13.7143 } ],
  // III: galaxy units (disk radius ≈ 1, disk in XZ). Sampled by ch3/rig.js (log-distance about
  // target + `anchor` pinning: 'neb' = the nebula, 'sun' = the future Sun), not by sampleCamera.
  III:  [ { t: 30.0, pos: [-0.419099, 0.00263, 0.368931], target: [-0.423627, 0, 0.350771], fov: 55, roll: 0, anchor: 'neb' },
          { t: 36.5, pos: [-0.422029, 0.002313, 0.36379], target: [-0.423627, 0, 0.350771], fov: 55, roll: 0, anchor: 'neb' },
          { t: 42.4, pos: [-0.423872, 0.00162, 0.357782], target: [-0.423627, 0, 0.350771], fov: 55, roll: 0, anchor: 'neb' },
          { t: 43.5, pos: [-0.424076, 0.001724, 0.357188], target: [-0.423627, 0, 0.350771], fov: 55, roll: 0, anchor: 'neb' },
          { t: 44.6, pos: [-0.424981, 0.008386, 0.372491], target: [-0.423457, 0, 0.350698], fov: 55, roll: 0, anchor: 'neb' },
          { t: 45.8, pos: [-0.420901, 0.045, 0.426341], target: [-0.418181, 0, 0.348446], fov: 55, roll: 0, anchor: 'neb' },
          { t: 47.2, pos: [-0.314694, 0.385673, 0.763913], target: [-0.314694, 0, 0.304287], fov: 55, roll: 0, anchor: 'neb' },
          { t: 48.6, pos: [0, 1.279869, 1.363497], target: [0, 0, 0.17], fov: 55, roll: 0, anchor: 'neb' },
          { t: 50.7, pos: [-0.150291, 1.286955, 1.239374], target: [0, 0, 0.17], fov: 55, roll: 0, anchor: 'sun' },
          { t: 52.3, pos: [0.37329, 0.67208, 0.906156], target: [0.408447, 0.000329, 0.235325], fov: 55, roll: 0, anchor: 'sun' },
          { t: 54.0, pos: [0.728312, 0.159263, 0.49793], target: [0.697912, 0.000561, 0.281621], fov: 55, roll: 0, anchor: 'sun' },
          { t: 55.6, pos: [0.754914, 0.021028, 0.327513], target: [0.743862, 0.000598, 0.28897], fov: 55, roll: 0, anchor: 'sun' },
          { t: 56.6, pos: [0.747723, 0.002848, 0.294511], target: [0.74582, 0.0006, 0.289284], fov: 55, roll: 0, anchor: 'sun' },
          { t: 57.3, pos: [0.746282, 0.00101, 0.290336], target: [0.74586, 0.0006, 0.28929], fov: 55, roll: 0, anchor: 'sun' },
          { t: 58.6, pos: [0.746044, 0.000767, 0.289724], target: [0.74586, 0.0006, 0.28929], fov: 55, roll: 0, anchor: 'sun' } ],
  IV:   [ { t: 57.2, pos: [0.8019, 0.7388, -0.5011], target: [0, 0, 0], fov: 42, roll: -6 },
          { t: 57.6, pos: [0.8426, 0.7757, -0.5253], target: [0, 0, 0], fov: 42, roll: -6 },
          { t: 58, pos: [0.89, 0.8082, -0.5451], target: [0, 0, 0], fov: 42, roll: -6 },
          { t: 58.2, pos: [0.9012, 0.8064, -0.5438], target: [0, 0, 0], fov: 42.0145, roll: -5.9435 },
          { t: 58.4, pos: [0.9366, 0.822, -0.5548], target: [0, 0, 0], fov: 42.056, roll: -5.7828 },
          { t: 58.6, pos: [1.0158, 0.8708, -0.5884], target: [0, 0, 0], fov: 42.1215, roll: -5.5315 },
          { t: 58.8, pos: [1.1603, 0.9679, -0.6551], target: [0, 0, 0], fov: 42.208, roll: -5.2029 },
          { t: 59, pos: [1.4004, 1.1328, -0.7682], target: [0, 0, 0], fov: 42.3125, roll: -4.8105 },
          { t: 59.2, pos: [1.7821, 1.3937, -0.9469], target: [0, 0, 0], fov: 42.432, roll: -4.3677 },
          { t: 59.4, pos: [2.376, 1.7918, -1.2192], target: [0, 0, 0], fov: 42.5635, roll: -3.888 },
          { t: 59.6, pos: [3.2866, 2.3847, -1.6241], target: [0.0047, 0, 0.0012], fov: 42.704, roll: -3.3848 },
          { t: 59.8, pos: [4.659, 3.2464, -2.2111], target: [0.0404, 0, 0.0101], fov: 42.8505, roll: -2.8715 },
          { t: 60, pos: [6.6753, 4.4599, -3.0347], target: [0.1082, 0, 0.0271], fov: 43, roll: -2.3615 },
          { t: 60.2, pos: [9.5273, 6.0965, -4.1388], target: [0.2042, 0, 0.051], fov: 43.1495, roll: -1.8684 },
          { t: 60.4, pos: [13.3537, 8.1774, -5.5301], target: [0.3244, 0, 0.0811], fov: 43.296, roll: -1.4054 },
          { t: 60.6, pos: [18.1414, 10.6267, -7.146], target: [0.4651, 0, 0.1163], fov: 43.4365, roll: -0.9862 },
          { t: 60.8, pos: [23.6263, 13.2377, -8.8336], target: [0.6222, 0, 0.1556], fov: 43.568, roll: -0.624 },
          { t: 61, pos: [29.2605, 15.6869, -10.3641], target: [0.792, 0, 0.198], fov: 43.6875, roll: -0.3324 },
          { t: 61.2, pos: [34.3189, 17.6184, -11.4957], target: [0.9705, 0, 0.2426], fov: 43.792, roll: -0.1247 },
          { t: 61.4, pos: [38.1453, 18.7752, -12.0656], target: [1.1539, 0, 0.2885], fov: 43.8785, roll: -0.0144 },
          { t: 61.6, pos: [40.4372, 19.1156, -12.0637], target: [1.3382, 0, 0.3345], fov: 43.944, roll: 0 },
          { t: 61.8, pos: [41.4197, 18.8478, -11.6454], target: [1.5196, 0, 0.3799], fov: 43.9855, roll: 0 },
          { t: 62, pos: [41.7881, 18.3562, -11.0692], target: [1.6942, 0, 0.4236], fov: 44, roll: 0 },
          { t: 62.35, pos: [41.8217, 17.4216, -9.9923], target: [1.9718, 0, 0.4929], fov: 44, roll: 0 },
          { t: 62.7, pos: [41.3203, 16.5539, -8.9522], target: [2.1958, 0, 0.549], fov: 44, roll: 0 },
          { t: 62.9, pos: [40.9192, 16.1548, -8.4216], target: [24.7343, 9.3859, -4.6528], fov: 44, roll: 0 },
          { t: 63.1, pos: [40.2068, 15.8141, -9.1395], target: [24.3611, 9.1931, -5.066], fov: 43.9522, roll: 0 },
          { t: 63.3, pos: [37.4723, 14.4657, -10.72], target: [22.9774, 8.5067, -5.8095], fov: 43.8174, roll: 0 },
          { t: 63.5, pos: [32.8297, 12.1358, -12.2289], target: [20.7236, 7.3774, -6.2871], fov: 43.6085, roll: 0 },
          { t: 63.7, pos: [27.1752, 9.2569, -12.872], target: [18.0792, 6.0063, -6.2926], fov: 43.3383, roll: 0 },
          { t: 63.9, pos: [21.6186, 6.3879, -12.348], target: [15.5427, 4.6179, -5.8659], fov: 43.0198, roll: 0 },
          { t: 64.1, pos: [16.9846, 3.9595, -10.8785], target: [13.4142, 3.3566, -5.1697], fov: 42.6659, roll: 0 },
          { t: 64.3, pos: [13.6043, 2.1584, -8.9467], target: [11.7997, 2.2915, -4.3479], fov: 42.2894, roll: 0 },
          { t: 64.5, pos: [11.4001, 0.9605, -7.0065], target: [10.6914, 1.4504, -3.5063], fov: 41.9033, roll: 0 },
          { t: 64.7, pos: [10.0926, 0.2319, -5.3355], target: [10.0115, 0.8283, -2.7335], fov: 41.5203, roll: 0 },
          { t: 64.9, pos: [9.3756, -0.181, -4.0333], target: [9.6389, 0.393, -2.0907], fov: 41.1535, roll: 0 },
          { t: 65.1, pos: [9.0039, -0.4044, -3.0871], target: [9.4488, 0.1007, -1.5976], fov: 40.8157, roll: 0 },
          { t: 65.3, pos: [8.8124, -0.5251, -2.4367], target: [9.3476, -0.0899, -1.2408], fov: 40.5198, roll: 0 },
          { t: 65.5, pos: [8.7037, -0.5954, -2.0165], target: [9.2824, -0.2116, -0.9952], fov: 40.2786, roll: 0 },
          { t: 65.7, pos: [8.6297, -0.6418, -1.7733], target: [9.232, -0.2869, -0.8407], fov: 40.1051, roll: 0 },
          { t: 65.9, pos: [8.5806, -0.6706, -1.6682], target: [9.1974, -0.3264, -0.7666], fov: 40.0122, roll: 0 },
          { t: 66, pos: [8.5723, -0.6752, -1.6569], target: [9.8165, 0.0146, 0.1491], fov: 40, roll: 0 },
          { t: 66.4, pos: [8.6134, -0.6824, -1.6482], target: [9.817, 0.0145, 0.1449], fov: 40, roll: 0 },
          { t: 66.8, pos: [8.6726, -0.6921, -1.6342], target: [9.818, 0.0144, 0.1388], fov: 40, roll: 0 },
          { t: 67.2, pos: [8.7424, -0.7024, -1.6154], target: [9.8193, 0.0143, 0.1316], fov: 40, roll: 0 },
          { t: 67.6, pos: [8.8154, -0.7119, -1.5931], target: [9.821, 0.0142, 0.1241], fov: 40, roll: 0 },
          { t: 68, pos: [8.8849, -0.7197, -1.569], target: [9.8228, 0.014, 0.1169], fov: 40, roll: 0 },
          { t: 68.4, pos: [8.9446, -0.7253, -1.5462], target: [9.8247, 0.0139, 0.1106], fov: 40, roll: 0 },
          { t: 68.8, pos: [8.989, -0.7287, -1.5278], target: [9.8262, 0.0138, 0.106], fov: 40, roll: 0 },
          { t: 69.2, pos: [9.0128, -0.7303, -1.5174], target: [9.827, 0.0137, 0.1035], fov: 40, roll: 0 },
          { t: 69.3672, pos: [9.0153, -0.7305, -1.5163], target: [9.8271, 0.0137, 0.1032], fov: 40, roll: 0 },
          { t: 69.6172, pos: [9.0052, -0.7381, -1.5324], target: [9.8279, 0.0136, 0.1028], fov: 40, roll: 0 },
          { t: 70.0172, pos: [8.9162, -0.8177, -1.7156], target: [9.8225, 0.0133, 0.1036], fov: 40, roll: 0 },
          { t: 70.4172, pos: [8.8008, -0.9503, -2.0403], target: [9.8186, 0.0125, 0.0989], fov: 40, roll: 0 },
          { t: 70.8172, pos: [8.742, -1.0977, -2.4222], target: [9.8282, 0.0104, 0.0831], fov: 40, roll: 0 },
          { t: 71.2172, pos: [8.8163, -1.225, -2.7634], target: [9.8574, 0.0074, 0.057], fov: 40, roll: -0.0276 },
          { t: 71.6172, pos: [9.0679, -1.2982, -2.9443], target: [9.903, 0.004, 0.0286], fov: 40, roll: -0.2164 },
          { t: 72.0172, pos: [9.442, -1.3622, -3.0173], target: [9.9492, 0.0015, 0.0087], fov: 40, roll: -0.5703 },
          { t: 72.4172, pos: [9.9022, -1.4633, -3.0387], target: [9.9842, 0.0003, 0.0004], fov: 40, roll: -1.0732 },
          { t: 72.8172, pos: [10.439, -1.5987, -2.9666], target: [9.9998, 0, 0], fov: 40, roll: -1.7089 },
          { t: 73.2172, pos: [11.0283, -1.7526, -2.761], target: [10, 0, 0], fov: 40, roll: -2.4612 },
          { t: 73.6172, pos: [11.6218, -1.9139, -2.3844], target: [10, 0, 0], fov: 40, roll: -3.3139 },
          { t: 74.0172, pos: [12.1518, -2.0664, -1.82], target: [10, 0, 0], fov: 40, roll: -4.2509 },
          { t: 74.4172, pos: [12.5423, -2.1915, -1.0839], target: [10, 0, 0], fov: 40, roll: -5.256 },
          { t: 74.8172, pos: [12.7267, -2.2713, -0.229], target: [10, 0, 0], fov: 40, roll: -6.3129 },
          { t: 75.2172, pos: [12.6669, -2.2938, 0.6617], target: [10.0065, 0.0119, 0.015], fov: 40, roll: -7.4057 },
          { t: 75.6172, pos: [12.3664, -2.2562, 1.494], target: [10.0127, 0.0839, 0.1077], fov: 40, roll: -8.518 },
          { t: 76.0172, pos: [11.8697, -2.1651, 2.1855], target: [9.9636, 0.1943, 0.2274], fov: 40, roll: -9.6336 },
          { t: 76.4172, pos: [11.2493, -2.0335, 2.6827], target: [9.8665, 0.3019, 0.2976], fov: 40, roll: -10.7365 },
          { t: 76.8172, pos: [10.5777, -1.9086, 2.9573], target: [9.7805, 0.3524, 0.2777], fov: 40, roll: -11.8105 },
          { t: 77.2172, pos: [9.9226, -1.859, 3.0024], target: [9.7347, 0.3547, 0.22], fov: 40, roll: -12.8393 },
          { t: 77.6172, pos: [9.3599, -1.8792, 2.8709], target: [9.7063, 0.351, 0.1716], fov: 40, roll: -13.8067 },
          { t: 78.0172, pos: [8.9289, -1.9532, 2.6282], target: [9.6875, 0.342, 0.1347], fov: 40, roll: -14.6967 },
          { t: 78.4172, pos: [8.6362, -2.0609, 2.336], target: [9.6731, 0.329, 0.1079], fov: 40, roll: -15.493 },
          { t: 78.8172, pos: [8.4648, -2.1813, 2.0432], target: [9.6605, 0.3134, 0.089], fov: 40, roll: -16.1795 },
          { t: 79.2172, pos: [8.3844, -2.2966, 1.785], target: [9.6743, 0.2747, 0.0679], fov: 40, roll: -16.74 },
          { t: 79.6172, pos: [8.3599, -2.3937, 1.5845], target: [9.8028, 0.1508, 0.0273], fov: 40, roll: -17.1583 },
          { t: 79.9519, pos: [8.3581, -2.4543, 1.4733], target: [9.9332, 0.0478, 0.0057], fov: 40, roll: -17.3872 },
          { t: 80.1519, pos: [8.6346, -2.0474, 1.216], target: [9.9466, 0.0382, 0.0045], fov: 38.9942, roll: -17.4107 },
          { t: 80.3519, pos: [9.0413, -1.4461, 0.8413], target: [9.9724, 0.0198, 0.0023], fov: 37.0651, roll: -17.4556 },
          { t: 80.5519, pos: [9.266, -1.1121, 0.6369], target: [9.9919, 0.0058, 0.0007], fov: 35.6088, roll: -17.4895, ease: 'out' },
          { t: 80.99, pos: [9.3435, -0.9965, 0.567], target: [10, 0, 0], fov: 35, roll: -17.5037 },
          { t: 81, pos: [9.3435, -0.9965, 0.567], target: [10, 0, 0], fov: 35, roll: -17.5037 },
          { t: 83, pos: [9.3435, -0.9965, 0.567], target: [10, 0, 0], fov: 35, roll: -17.5037 } ],   // generated: src/chapters/ch4/camgen.mjs
  // V: planet units (R = 1). 81–84 hold the IV→V disc (r = 0.3056 H at fov 40), then a slow
  // banking orbit toward the terminator. 96–107 (dive, ocean, underwater) is derived in
  // src/chapters/ch5/path.js from the 96 s key: altitude spans 5 orders of magnitude (log-space).
  V:    [ { t: 81.0, pos: [0, 0, 4.6051045], target: [0, 0, 0], fov: 40, roll: 0 },
          { t: 83.0, pos: [0, 0, 4.6051045], target: [0, 0, 0], fov: 40, roll: 0 },
          { t: 84.0, pos: [0, 0, 4.6051045], target: [0, 0, 0], fov: 40, roll: 0 },
          { t: 88.0, pos: [0.37464, -0.11256, 4.28217], target: [0, 0, 0], fov: 40, roll: 6 },
          { t: 92.0, pos: [0.84873, -0.23076, 3.67625], target: [0, 0, 0], fov: 40, roll: 17 },
          { t: 96.0, pos: [1.19217, -0.33449, 2.95073], target: [0, 0, 0], fov: 40, roll: 32 } ],
  // VI: metres, sea surface y = 0. Macro on the stromatolite's live colony → crane back and up,
  // rising through the surface ~113.8–114.3 → over-under at the waterline (the forest sprouts, the
  // school gathers, the breach at BREACH_T) → tilt up with the flock and swing to the sun → the shore:
  // a documentary drift along the beach meeting seven animals in turn (src/march/camera.js; lower and
  // closer for small ones), settling so the torch flame is at the exact centre on the horizon at the
  // catch (151.0) → night: dolly straight back along the axis. GENERATED by `node src/chapters/ch6/camera.js`.
  VI:   [ { t: 105, pos: [0, -0.57581, -1.34994], target: [0, -1.19955, -4.28438], fov: 50, roll: 0 },
          { t: 108, pos: [0, -0.57831, -1.36168], target: [0, -1.20204, -4.29612], fov: 50, roll: 0 },
          { t: 110, pos: [0, -0.57997, -1.3695], target: [0, -1.2037, -4.30395], fov: 50, roll: 0 },
          { t: 111.5, pos: [0, -0.5467, -1.213], target: [0, -1.22156, -4.13611], fov: 50, roll: 0 },
          { t: 112.8, pos: [0, -0.4476, -1.07606], target: [0, -1.37465, -3.92923], fov: 50, roll: 0 },
          { t: 113.45, pos: [0, -0.17, -0.84], target: [0, -1.1467, -3.67656], fov: 50, roll: 0 },
          { t: 113.8, pos: [0, -0.058, -0.71], target: [0, -0.55314, -3.66886], fov: 50, roll: 0 },
          { t: 114.05, pos: [0, -0.009, -0.6], target: [0, -0.17646, -3.59532], fov: 50, roll: 0 },
          { t: 114.3, pos: [0, 0.003, -0.52], target: [0, -0.02842, -3.51984], fov: 50, roll: 0 },
          { t: 114.6, pos: [0, 0.004, -0.45], target: [0, 0.004, -3.45], fov: 50, roll: 0 },
          { t: 114.9, pos: [0, 0.004, -0.39], target: [0, 0.004, -3.39], fov: 50, roll: 0 },
          { t: 118.5, pos: [0, 0.004, 0], target: [0, 0.004, -3], fov: 50, roll: 0 },
          { t: 122.5, pos: [0, 0.004, 0.33], target: [0, 0.004, -2.67], fov: 50, roll: 0 },
          { t: 125.6, pos: [0, 0.004, 0.5], target: [0, 0.004, -2.5], fov: 50, roll: 0 },
          { t: 126, pos: [0, 0.006, 0.52], target: [0, 0.08453, -2.47897], fov: 50, roll: 0 },
          { t: 126.4, pos: [0.03, 0.13, 0.58], target: [0.23116, 0.95691, -2.29676], fov: 50, roll: 0 },
          { t: 126.72, pos: [0.12, 0.36, 0.7], target: [0.99025, 1.72197, -1.82739], fov: 44, roll: 0 },
          { t: 127.02, pos: [0.2, 0.57, 0.82], target: [2.00547, 1.44712, -1.40957], fov: 35, roll: 0 },
          { t: 127.36, pos: [0.205, 0.42, 0.84638], target: [2.49999, 0.57701, -1.07934], fov: 24, roll: 0 },
          { t: 127.75, pos: [0.205, 0.42, 0.84638], target: [2.49999, 0.57701, -1.07934], fov: 24, roll: 0 },
          { t: 128, pos: [0.205, 0.42, 0.84638], target: [2.49999, 0.57701, -1.07934], fov: 24, roll: 0 },
          { t: 128.25, pos: [0.205, 0.42, 0.84638], target: [2.49999, 0.57701, -1.07934], fov: 24, roll: 0 },
          { t: 128.5, pos: [0.205, 0.42, 0.84638], target: [2.49999, 0.57701, -1.07934], fov: 24, roll: 0 },
          { t: 128.75, pos: [0.19826, 0.42, 0.83834], target: [2.49325, 0.57701, -1.08738], fov: 24, roll: 0 },
          { t: 129, pos: [0.11241, 0.42, 0.73602], target: [2.40739, 0.57701, -1.1897], fov: 24, roll: 0 },
          { t: 129.25, pos: [0.00317, 0.42, 0.60584], target: [2.29816, 0.57701, -1.31988], fov: 24, roll: 0 },
          { t: 129.5, pos: [-0.0538, 0.42, 0.53795], target: [2.24119, 0.57701, -1.38777], fov: 24, roll: 0 },
          { t: 129.75, pos: [-0.07613, 0.42, 0.51134], target: [2.21886, 0.57701, -1.41438], fov: 24, roll: 0 },
          { t: 130, pos: [-0.08313, 0.42, 0.50299], target: [2.21185, 0.57701, -1.42273], fov: 24, roll: 0 },
          { t: 130.25, pos: [-0.08555, 0.42, 0.50011], target: [2.20944, 0.57701, -1.42561], fov: 24, roll: 0 },
          { t: 130.5, pos: [-0.10366, 0.41878, 0.47853], target: [2.19133, 0.57569, -1.4472], fov: 24, roll: 0 },
          { t: 130.75, pos: [-0.0088, 0.41083, 0.59158], target: [2.28622, 0.56703, -1.33417], fov: 24, roll: 0 },
          { t: 131, pos: [0.28791, 0.39484, 0.94518], target: [2.58298, 0.54965, -0.98062], fov: 24, roll: 0 },
          { t: 131.25, pos: [0.73272, 0.37315, 1.47529], target: [3.02787, 0.52607, -0.45057], fov: 24, roll: 0 },
          { t: 131.5, pos: [1.236, 0.34931, 2.07507], target: [3.53123, 0.50016, 0.14915], fov: 24, roll: 0 },
          { t: 131.75, pos: [1.70602, 0.32715, 2.63522], target: [4.00132, 0.47606, 0.70924], fov: 24, roll: 0 },
          { t: 132, pos: [2.05963, 0.31052, 3.05663], target: [4.35499, 0.45799, 1.1306], fov: 24, roll: 0 },
          { t: 132.25, pos: [2.24278, 0.30265, 3.2749], target: [4.53816, 0.44944, 1.34885], fov: 24, roll: 0 },
          { t: 132.5, pos: [2.31, 0.30047, 3.35501], target: [4.60539, 0.44706, 1.42896], fov: 24, roll: 0 },
          { t: 132.75, pos: [2.33033, 0.30004, 3.37924], target: [4.62572, 0.44659, 1.45318], fov: 24, roll: 0 },
          { t: 133, pos: [2.33477, 0.3, 3.38453], target: [4.63016, 0.44655, 1.45847], fov: 24, roll: 0 },
          { t: 133.25, pos: [2.33527, 0.3, 3.38513], target: [4.63066, 0.44655, 1.45907], fov: 24, roll: 0 },
          { t: 133.5, pos: [2.33527, 0.3, 3.38513], target: [4.63066, 0.44655, 1.45907], fov: 24, roll: 0 },
          { t: 133.75, pos: [2.37208, 0.29869, 3.429], target: [4.66748, 0.44498, 1.50293], fov: 24, roll: 0 },
          { t: 134, pos: [2.61841, 0.29036, 3.72257], target: [4.91387, 0.43502, 1.79645], fov: 24, roll: 0 },
          { t: 134.25, pos: [3.0952, 0.27452, 4.29077], target: [5.39077, 0.41607, 2.36456], fov: 24, roll: 0 },
          { t: 134.5, pos: [3.70482, 0.25489, 5.01729], target: [6.00053, 0.39259, 3.09096], fov: 24, roll: 0 },
          { t: 134.75, pos: [4.2676, 0.23657, 5.68799], target: [6.56344, 0.37067, 3.76156], fov: 24, roll: 0 },
          { t: 135, pos: [4.60064, 0.22495, 6.0849], target: [6.89656, 0.35678, 4.1584], fov: 24, roll: 0 },
          { t: 135.25, pos: [4.71049, 0.22104, 6.21581], target: [7.00643, 0.35211, 4.28928], fov: 24, roll: 0 },
          { t: 135.5, pos: [4.74313, 0.22013, 6.2547], target: [7.03907, 0.35102, 4.32817], fov: 24, roll: 0 },
          { t: 135.75, pos: [4.74929, 0.22001, 6.26204], target: [7.04523, 0.35086, 4.33551], fov: 24, roll: 0 },
          { t: 136, pos: [4.74934, 0.22, 6.26211], target: [7.04529, 0.35086, 4.33558], fov: 24, roll: 0 },
          { t: 136.25, pos: [4.74914, 0.22, 6.26187], target: [7.04509, 0.35086, 4.33534], fov: 24, roll: 0 },
          { t: 136.5, pos: [4.74914, 0.22, 6.26187], target: [7.04509, 0.35086, 4.33534], fov: 24, roll: 0 },
          { t: 136.75, pos: [4.74914, 0.22, 6.26187], target: [7.04509, 0.35086, 4.33534], fov: 24, roll: 0 },
          { t: 137, pos: [4.75053, 0.22034, 6.26353], target: [7.04648, 0.35124, 4.337], fov: 24, roll: 0 },
          { t: 137.25, pos: [4.81535, 0.24913, 6.34078], target: [7.1112, 0.38294, 4.41433], fov: 24, roll: 0 },
          { t: 137.5, pos: [5.04918, 0.34609, 6.61944], target: [7.34468, 0.48976, 4.69329], fov: 24, roll: 0 },
          { t: 137.75, pos: [5.47849, 0.50616, 7.13107], target: [7.77335, 0.66608, 5.20545], fov: 24, roll: 0 },
          { t: 138, pos: [6.02735, 0.7036, 7.78518], target: [8.32135, 0.88356, 5.86029], fov: 24, roll: 0 },
          { t: 138.25, pos: [6.58518, 0.90644, 8.44997], target: [8.87817, 1.10698, 6.52592], fov: 24, roll: 0 },
          { t: 138.5, pos: [7.06152, 1.08162, 9.01765], target: [9.35356, 1.29992, 7.0944], fov: 24, roll: 0 },
          { t: 138.75, pos: [7.38409, 1.19601, 9.40207], target: [9.67546, 1.42592, 7.47938], fov: 24, roll: 0 },
          { t: 139, pos: [7.51879, 1.23799, 9.56261], target: [9.80991, 1.47216, 7.64013], fov: 24, roll: 0 },
          { t: 139.25, pos: [7.56392, 1.24829, 9.6164], target: [9.85498, 1.48349, 7.69397], fov: 24, roll: 0 },
          { t: 139.5, pos: [7.57581, 1.24991, 9.63056], target: [9.86686, 1.48527, 7.70814], fov: 24, roll: 0 },
          { t: 139.75, pos: [7.57773, 1.25, 9.63285], target: [9.86878, 1.48538, 7.71043], fov: 24, roll: 0 },
          { t: 140, pos: [7.57779, 1.25, 9.63292], target: [9.86884, 1.48538, 7.7105], fov: 24, roll: 0 },
          { t: 140.25, pos: [7.57778, 1.25, 9.63291], target: [9.86883, 1.48538, 7.71049], fov: 24, roll: 0 },
          { t: 140.5, pos: [7.57778, 1.25, 9.63291], target: [9.86883, 1.48538, 7.71049], fov: 24, roll: 0 },
          { t: 140.75, pos: [7.57778, 1.25, 9.63291], target: [9.86883, 1.48538, 7.71049], fov: 24, roll: 0 },
          { t: 141, pos: [7.57778, 1.25, 9.63291], target: [9.86883, 1.48538, 7.71049], fov: 24, roll: 0 },
          { t: 141.25, pos: [7.57778, 1.25, 9.63291], target: [9.86883, 1.48538, 7.71049], fov: 24, roll: 0 },
          { t: 141.5, pos: [7.57897, 1.24981, 9.63432], target: [9.87002, 1.48517, 7.7119], fov: 24, roll: 0 },
          { t: 141.75, pos: [7.66983, 1.23354, 9.74261], target: [9.96095, 1.46771, 7.82013], fov: 24, roll: 0 },
          { t: 142, pos: [7.97888, 1.17713, 10.11092], target: [10.27025, 1.40719, 8.18824], fov: 24, roll: 0 },
          { t: 142.25, pos: [8.50069, 1.07998, 10.73279], target: [10.79247, 1.30294, 8.80976], fov: 24, roll: 0 },
          { t: 142.5, pos: [9.16255, 0.95245, 11.52157], target: [11.45485, 1.16611, 9.5981], fov: 24, roll: 0 },
          { t: 142.75, pos: [9.87199, 0.80826, 12.36704], target: [12.16485, 1.01139, 10.4431], fov: 24, roll: 0 },
          { t: 143, pos: [10.53943, 0.66171, 13.16247], target: [12.83283, 0.85414, 11.23808], fov: 24, roll: 0 },
          { t: 143.25, pos: [11.08773, 0.52714, 13.8159], target: [13.3816, 0.70974, 11.89112], fov: 24, roll: 0 },
          { t: 143.5, pos: [11.45491, 0.41887, 14.25349], target: [13.74914, 0.59355, 12.3284], fov: 24, roll: 0 },
          { t: 143.75, pos: [11.63115, 0.35123, 14.46353], target: [13.9256, 0.52098, 12.53825], fov: 24, roll: 0 },
          { t: 144, pos: [11.69448, 0.32687, 14.539], target: [13.98901, 0.49484, 12.61366], fov: 24, roll: 0 },
          { t: 144.25, pos: [11.71296, 0.32097, 14.56102], target: [14.00751, 0.48851, 12.63567], fov: 24, roll: 0 },
          { t: 144.5, pos: [11.71686, 0.32005, 14.56567], target: [14.01141, 0.48752, 12.64031], fov: 24, roll: 0 },
          { t: 144.75, pos: [11.71731, 0.32, 14.5662], target: [14.01186, 0.48746, 12.64085], fov: 24, roll: 0 },
          { t: 145, pos: [11.71732, 0.32, 14.56622], target: [14.01187, 0.48746, 12.64086], fov: 24, roll: 0 },
          { t: 145.25, pos: [11.71732, 0.32, 14.56621], target: [14.01187, 0.48746, 12.64086], fov: 24, roll: 0 },
          { t: 145.5, pos: [11.73146, 0.32208, 14.58308], target: [14.02601, 0.48962, 12.65772], fov: 24, roll: 0 },
          { t: 145.75, pos: [11.87352, 0.34416, 14.75237], target: [14.16803, 0.51247, 12.82704], fov: 24, roll: 0 },
          { t: 146, pos: [12.17722, 0.3931, 15.1143], target: [14.47166, 0.56311, 13.18904], fov: 24, roll: 0 },
          { t: 146.25, pos: [12.57102, 0.45962, 15.58362], target: [14.86536, 0.63196, 13.65844], fov: 24, roll: 0 },
          { t: 146.5, pos: [12.97241, 0.52872, 16.06198], target: [15.26664, 0.70346, 14.13689], fov: 24, roll: 0 },
          { t: 146.75, pos: [13.31225, 0.58388, 16.46699], target: [15.6064, 0.76054, 14.54197], fov: 24, roll: 0 },
          { t: 147, pos: [13.50414, 0.61079, 16.69567], target: [15.79825, 0.78839, 14.77069], fov: 24, roll: 0 },
          { t: 147.25, pos: [13.57763, 0.61836, 16.78325], target: [15.87172, 0.79622, 14.85828], fov: 24, roll: 0 },
          { t: 147.5, pos: [13.60092, 0.61985, 16.81101], target: [15.89501, 0.79777, 14.88604], fov: 24, roll: 0 },
          { t: 147.75, pos: [13.60636, 0.62, 16.81749], target: [15.90045, 0.79792, 14.89252], fov: 24, roll: 0 },
          { t: 148, pos: [13.62308, 0.62263, 16.83742], target: [15.91718, 0.80042, 14.91245], fov: 24, roll: 0 },
          { t: 148.25, pos: [13.7847, 0.65077, 17.03002], target: [16.07885, 0.82719, 15.105], fov: 24, roll: 0 },
          { t: 148.5, pos: [14.13279, 0.71396, 17.44486], target: [16.42708, 0.88731, 15.51972], fov: 24, roll: 0 },
          { t: 148.75, pos: [14.58838, 0.80174, 17.98781], target: [16.88286, 0.97082, 16.06251], fov: 24, roll: 0 },
          { t: 149, pos: [15.03703, 0.89647, 18.5225], target: [17.33171, 1.06094, 16.59704], fov: 24, roll: 0 },
          { t: 149.25, pos: [15.38833, 0.97869, 18.94116], target: [17.68317, 1.13916, 17.01556], fov: 24, roll: 0 },
          { t: 149.5, pos: [15.60324, 1.0291, 19.19728], target: [17.89819, 1.18711, 17.27159], fov: 24, roll: 0 },
          { t: 149.75, pos: [15.70575, 1.10694, 19.31945], target: [18.00103, 1.25648, 17.39348], fov: 24, roll: 0 },
          { t: 150, pos: [15.78518, 1.34384, 19.41411], target: [18.08147, 1.46393, 17.48729], fov: 24, roll: 0 },
          { t: 150.25, pos: [15.86905, 1.70455, 19.51406], target: [18.16647, 1.77936, 17.58629], fov: 24, roll: 0 },
          { t: 150.5, pos: [15.94492, 2.05303, 19.60447], target: [18.24293, 2.08406, 17.67621], fov: 24, roll: 0 },
          { t: 150.75, pos: [15.98933, 2.25861, 19.6574], target: [18.28746, 2.26381, 17.72904], fov: 24, roll: 0 },
          { t: 151, pos: [15.99827, 2.3, 19.66806], target: [18.2964, 2.3, 17.73969], fov: 24, roll: 0 },
          { t: 151.25, pos: [15.99827, 2.3, 19.66806], target: [18.2964, 2.3, 17.73969], fov: 24, roll: 0 },
          { t: 151.5, pos: [15.91408, 2.3, 19.7387], target: [18.21221, 2.3, 17.81034], fov: 24, roll: 0 },
          { t: 151.75, pos: [15.39531, 2.3, 20.174], target: [17.69345, 2.3, 18.24563], fov: 24, roll: 0 },
          { t: 152, pos: [14.18722, 2.3, 21.18771], target: [16.48535, 2.3, 19.25935], fov: 24, roll: 0 },
          { t: 152.25, pos: [12.20249, 2.3, 22.8531], target: [14.50062, 2.3, 20.92473], fov: 24, roll: 0 },
          { t: 152.5, pos: [9.48967, 2.3, 25.12942], target: [11.7878, 2.3, 23.20106], fov: 24, roll: 0 },
          { t: 152.75, pos: [6.20158, 2.3, 27.88846], target: [8.49971, 2.3, 25.9601], fov: 24, roll: 0 },
          { t: 153, pos: [2.56368, 2.3, 30.94101], target: [4.86182, 2.3, 29.01265], fov: 24, roll: 0 },
          { t: 153.25, pos: [-1.15746, 2.3, 34.06342], target: [1.14067, 2.3, 32.13506], fov: 24, roll: 0 },
          { t: 153.5, pos: [-4.68583, 2.3, 37.02407], target: [-2.38769, 2.3, 35.09571], fov: 24, roll: 0 },
          { t: 153.75, pos: [-7.7675, 2.3, 39.60991], target: [-5.46937, 2.3, 37.68154], fov: 24, roll: 0 },
          { t: 154, pos: [-10.20229, 2.3, 41.65294], target: [-7.90416, 2.3, 39.72458], fov: 24, roll: 0 },
          { t: 154.25, pos: [-11.8753, 2.3, 43.05676], target: [-9.57716, 2.3, 41.12839], fov: 24, roll: 0 },
          { t: 154.5, pos: [-12.78851, 2.3, 43.82304], target: [-10.49038, 2.3, 41.89467], fov: 24, roll: 0 },
          { t: 154.75, pos: [-13.09244, 2.3, 44.07806], target: [-10.79431, 2.3, 42.1497], fov: 24, roll: 0 },
          { t: 155, pos: [-13.11142, 2.3, 44.09399], target: [-10.81329, 2.3, 42.16562], fov: 24, roll: 0 } ],
  VII:  [ { t: 153.0, pos: [0, 0, 1], target: [0, 0, 0], fov: 50, roll: 0 },
          { t: 180.6, pos: [0, 0, 1], target: [0, 0, 0], fov: 50, roll: 0 } ],
  // VIII: metres (desk top y = 0). 159.2–160.3 the caret held at the exact centre (targets on the
  // caret, positions on its display normal), pull back to the typing hero shot (keyboard spans
  // ±0.42 NDC so key x ≈ keyclick pan), push in with the acceleration, breathe out after Enter,
  // then the recursion push: swing head-on and unroll until the 16:9 display exactly fills the
  // frame at 179.98333 (fov 30, d = 0.30901 m). Solved from src/chapters/ch8/layout.js.
  VIII: [ { t: 179.2, pos: [-0.120949, 0.329726, 0.256663], target: [-0.120949, 0.179237, -0.156802], fov: 30, roll: 0 },
          { t: 180.3, pos: [-0.120949, 0.339986, 0.284854], target: [-0.120949, 0.179237, -0.156802], fov: 30, roll: 0 },
          { t: 180.36, pos: [-0.120949, 0.340602, 0.286545], target: [-0.120949, 0.179237, -0.156802], fov: 30, roll: 0, ease: 'inout' },
          { t: 181.35, pos: [-0.01959, 0.361014, 0.502992], target: [0, 0.075, -0.058], fov: 30, roll: 0 },
          { t: 183.4, pos: [0.019291, 0.347598, 0.492422], target: [0, 0.078, -0.06], fov: 30, roll: 0 },
          { t: 185.6, pos: [0.067644, 0.304337, 0.393312], target: [0, 0.093, -0.088], fov: 30, roll: 0 },
          { t: 187.85, pos: [0.080161, 0.267266, 0.300393], target: [0, 0.106, -0.112], fov: 30, roll: -1 },
          { t: 188.7, pos: [0.068408, 0.280256, 0.317912], target: [0, 0.108, -0.114], fov: 30, roll: -1 },
          { t: 191.6, pos: [-0.1631, 0.436095, 0.601463], target: [0, 0.098, -0.105], fov: 30, roll: -8 },
          { t: 192.7, pos: [-0.213057, 0.494999, 0.608506], target: [0, 0.118, -0.134513], fov: 30, roll: -13 },
          { t: 194.5, pos: [-0.110292, 0.387605, 0.490986], target: [0, 0.118, -0.134513], fov: 30, roll: -12 },
          { t: 196.0, pos: [-0.034515, 0.307935, 0.359079], target: [0, 0.118, -0.134513], fov: 30, roll: -7 },
          { t: 197.5, pos: [-0.006547, 0.256775, 0.240585], target: [0, 0.118, -0.134513], fov: 30, roll: -2.5 },
          { t: 198.8, pos: [0, 0.229423, 0.17079], target: [0, 0.118, -0.134513], fov: 30, roll: -0.3, ease: 'out' },
          { t: 199.98333, pos: [0, 0.223689, 0.155865], target: [0, 0.118, -0.134513], fov: 30, roll: 0 } ],
};
/** Catmull-Rom sample of a keyframe list at t (clamped at the ends). Keys may add `ease`. */
export function sampleCamera(keys, t) {
  if (t <= keys[0].t) return clone(keys[0]);
  const n = keys.length;
  if (t >= keys[n - 1].t) return clone(keys[n - 1]);
  let i = 0; while (i < n - 2 && t >= keys[i + 1].t) i++;
  const k0 = keys[Math.max(0, i - 1)], k1 = keys[i], k2 = keys[i + 1], k3 = keys[Math.min(n - 1, i + 2)];
  let u = (t - k1.t) / (k2.t - k1.t);
  if (k1.ease === 'inout') u = u * u * (3 - 2 * u);
  else if (k1.ease === 'in') u = u * u;
  else if (k1.ease === 'out') u = 1 - (1 - u) * (1 - u);
  const cr = (a, b, c, d) => 0.5 * ((2 * b) + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u * u + (-a + 3 * b - 3 * c + d) * u * u * u);
  const v3 = (p) => [0, 1, 2].map(j => cr(k0[p][j], k1[p][j], k2[p][j], k3[p][j]));
  return { t, pos: v3('pos'), target: v3('target'), fov: cr(k0.fov, k1.fov, k2.fov, k3.fov), roll: cr(k0.roll || 0, k1.roll || 0, k2.roll || 0, k3.roll || 0) };
}
function clone(k) { return { t: k.t, pos: [...k.pos], target: [...k.target], fov: k.fov, roll: k.roll || 0 }; }
/** Piecewise-linear lookup in [[t, v], …] (clamped). */
export function pwl(keys, t) {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 0; i < keys.length - 1; i++) {
    if (t < keys[i + 1][0]) return keys[i][1] + (keys[i + 1][1] - keys[i][1]) * (t - keys[i][0]) / (keys[i + 1][0] - keys[i][0]);
  }
  return keys[keys.length - 1][1];
}
/** Notes of an instrument within [t0, t1). */
export function notesIn(inst, t0, t1) { return notes.filter(n => n.inst === inst && n.t >= t0 && n.t < t1); }
/** Event list helper: events whose t ∈ [t - lookback, t]. */
export function recent(list, t, lookback) { return list.filter(e => e.t <= t && e.t > t - lookback); }
