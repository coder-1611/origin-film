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

export const FPS = 60;
export const DURATION = 180;
export const FRAMES = FPS * DURATION;         // 10,800. Frame n shows t = n / FPS.
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
    { t0: 83.9824439740,  t1: 168,           bpm0: 120, bpm1: 120 },
    { t0: 168,            t1: 176,           bpm0: 120, bpm1: 60 },
  ],
  freeUntil: 12,
  freeFrom: 176,
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
  { id: 'VI',   name: 'LIFE',          start: bt(41),  end: bt(55) },
  { id: 'VII',  name: 'FIRE TO FIBER', start: bt(55),  end: bt(68) },
  { id: 'VIII', name: 'THE PROMPT',    start: bt(68),  end: DURATION },
];
for (const c of chapters) c.label = `${c.id} · ${c.name}`;
export const chapterById = Object.fromEntries(chapters.map(c => [c.id, c]));

// Hand-off windows: both chapters render inside [a, b]; the compositor blends them with
// a smootherstep weight. The match-moves themselves (shared glow, shared disc, shared
// point…) are each chapter's job, as contracted in STORYBOARD.md.
export const transitions = [
  { from: 'I',   to: 'II',   a: 11.95, b: 12.15 },
  { from: 'II',  to: 'III',  a: 30.0,  b: 33.0 },
  { from: 'III', to: 'IV',   a: 57.2,  b: 58.6 },
  { from: 'IV',  to: 'V',    a: 81.0,  b: 83.0 },
  { from: 'V',   to: 'VI',   a: 105.0, b: 107.0 },
  { from: 'VI',  to: 'VII',  a: 133.0, b: 135.0 },
  { from: 'VII', to: 'VIII', a: 159.2, b: 160.6 },
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
  41: 'F', 42: 'Am', 43: 'Bb', 44: 'C', 45: 'F', 46: 'Am', 47: 'Bb', 48: 'C', 49: 'Dm', 50: 'Bb', 51: 'F', 52: 'C', 53: 'Bb', 54: 'C',
  55: 'F', 56: 'C', 57: 'Dm', 58: 'Bb', 59: 'F', 60: 'C', 61: 'Bb', 62: 'C', 63: 'Dm', 64: 'Bb', 65: 'F/A', 66: 'Gm', 67: 'C',
  68: 'Bb', 69: 'Gm', 70: 'Bb', 71: 'A', 72: 'Dm', 73: 'Bb', 74: ['Gm', 3, 'A'],
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
  { t: bt(68), key: 'D minor', tonic: 2 },
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
function drums(bar, { kick = [], snare = [], clap = [], hat = [], ohat = [] }, vel = 1) {
  for (const b of kick)  N(bt(bar, b), 0.5, 'kick', 36, vel);
  for (const b of snare) N(bt(bar, b), 0.3, 'snare', 38, 0.8 * vel);
  for (const b of clap)  N(bt(bar, b), 0.3, 'clap', 39, 0.7 * vel);
  for (const b of hat)   N(bt(bar, b), 0.06, 'hat', 42, (0.28 + 0.1 * R()) * vel);
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

// ===== VI · LIFE (bars 41-54, 120 BPM) =====================================================
for (let bar = 41; bar <= 54; bar++) {
  padBar(bar, 0.3, 57, 81);
  subBar(bar, 0.55, bar >= 45 ? [1, 3] : [1], 41);
  // Marimba ostinato: root-5th-octave-3rd cell.
  const ch = CHORDS[chart[bar]];
  const r = place(ch.bass === 4 ? 0 : ch.pcs[0], 60), fifth = place(ch.pcs[2] ?? ch.pcs[1], r + 7), third = place(ch.pcs[1], r + 16);
  const cell = [r, fifth, r + 12, third, fifth, r + 12, third, fifth];
  eighths().forEach((b, i) => {
    const n = N(bt(bar, b), 0.4, 'marimba', cell[i], (i % 2 ? 0.28 : 0.38) + 0.05 * R(), { x: (R() * 2 - 1) * 0.3 });
    if (bar >= 45) leafFlushes.push({ t: n.t, midi: n.midi });
  });
  if (bar >= 45) drums(bar, { kick: [1, 2, 3, 4], hat: bar >= 47 ? [1.5, 2.5, 3.5, 4.5] : [], clap: bar >= 49 ? [2, 4] : [] }, 0.7);
}
for (let bar = 41; bar <= 44; bar++) {
  for (let k = 0; k < 3; k++) {
    const t = bt(bar, 1 + k * 1.5 + (R() < 0.3 ? 0.5 : 0)), x = (R() * 2 - 1) * 0.6, y = (R() * 2 - 1) * 0.5;
    const ch = chordAt(t + 1e-3), midi = place(ch.pcs[Math.floor(R() * ch.pcs.length)], 81);
    cellDivisions.push({ t, x, y, midi });
    S(t, 0.25, 'pop', 0.45, x, { midi });
  }
}
cellDivisions.sort((a, b) => a.t - b.t);
for (const n of motif(45, 1, 65, 'major', 'marimba', 0.62)) leafFlushes.push({ t: n.t, midi: n.midi, motif: true });
for (const n of motif(47, 1, 65, 'major', 'marimba', 0.62)) leafFlushes.push({ t: n.t, midi: n.midi, motif: true });
leafFlushes.sort((a, b) => a.t - b.t);
export const BREACH_T = bt(51);
S(bt(50, 3), bt(51) - bt(50, 3), 'whoosh', 0.6, 0, { x1: 0 });
S(BREACH_T, 1.2, 'splash', 0.55, 0, { small: true });
S(bt(54), barLen(54), 'riser', 0.7, 0);

// ===== VII · FIRE TO FIBER (bars 55-67, 120 BPM) ===========================================
// The frieze: line drawings laid out along one long scroll; the camera trucks right.
// friezeX(wx, t) gives the NDC x of frieze-space x `wx` at time t; SFX pan by it.
export const frieze = {
  items: [
    { name: 'fire',   wx: 0.0, t0: bt(55), t1: bt(57) },
    { name: 'wheel',  wx: 2.0, t0: bt(57), t1: bt(59) },
    { name: 'press',  wx: 4.0, t0: bt(59), t1: bt(61) },
    { name: 'engine', wx: 6.0, t0: bt(61), t1: bt(63) },
  ],
  // camera truck (frieze units; 2 units = one screen width)
  truck: [[bt(55), 0.0], [bt(61), 6.0], [bt(62), 6.18], [bt(63), 6.2]],
};
export function friezeCamX(t) { return pwl(frieze.truck, t); }
export function friezeX(wx, t) { return wx - friezeCamX(t); }

for (let bar = 55; bar <= 67; bar++) {
  padBar(bar, 0.46, 55, 79);
  subBar(bar, 0.8, eighths(), 38, 0.45);
  if (bar <= 66) drums(bar, { kick: [1, 2, 3, 4], clap: [2, 4], hat: sixteenths(), ohat: [1.5, 2.5, 3.5, 4.5] }, 1.0);
}
drums(67, { kick: [1, 2, 3], snare: sixteenths(3, 4.75) }, 0.9);
{
  const L = 'lead';
  motif(55, 1, 65, 'major', L, 0.7);                                  // F C Bb A G
  [[57, 1, 74], [57, 2, 72], [57, 3, 70], [57, 4, 69]].forEach(([b, be, m]) => N(bt(b, be), beatsToSec(bt(b, be), 1), L, m, 0.62));
  N(bt(58), beatsToSec(bt(58), 4), L, 70, 0.6);
  for (const n of motif(59, 1, 65, 'major', L, 0.72)) N(n.t, n.dur, L, n.midi + (n.midi % 12 === 5 || n.midi % 12 === 0 ? 4 : 3), n.vel * 0.8); // in thirds
  [[61, 1, 77], [61, 2, 76], [61, 3, 74], [61, 4, 72]].forEach(([b, be, m]) => N(bt(b, be), beatsToSec(bt(b, be), 1), L, m, 0.66));
  N(bt(62), beatsToSec(bt(62), 4), L, 72, 0.62);
  motif(63, 1, 77, 'major', L, 0.78);                                 // up an octave
  [[65, 1, 81], [65, 2, 79], [65, 3, 77], [65, 4, 76]].forEach(([b, be, m]) => N(bt(b, be), beatsToSec(bt(b, be), 1), L, m, 0.7));
  N(bt(66), beatsToSec(bt(66), 4), L, 74, 0.66);
  N(bt(67), beatsToSec(bt(67), 4), L, 76, 0.6);
}
// Fire crackle stream (granular), panned to the flames as the camera trucks.
S(bt(55), bt(58) - bt(55), 'crackle', 0.55, friezeX(0, bt(55)), { wx: 0.0 });
S(bt(57), 0.9, 'whoosh', 0.35, friezeX(2.0, bt(57)), { x1: friezeX(2.0, bt(57) + 0.9), small: true });
for (const bar of [59, 60]) for (const b of [1, 3]) S(bt(bar, b), 0.6, 'clank', 0.7, friezeX(4.0, bt(bar, b)));
for (const bar of [61, 62]) for (const b of [1, 2, 3, 4]) S(bt(bar, b), 0.35, 'hiss', 0.4, friezeX(6.0, bt(bar, b)));

// ===== Globe (VII, bars 63-67) =============================================================
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
    [bt(62, 3), 10, 20, 0.0],
    [bt(63), 10, 20, 0.78],
    [bt(65), -40, 24, 0.80],
    [bt(66, 3), -88, 28, 0.86],
    [bt(67, 3), ROUND_ROCK[1], ROUND_ROCK[0], 3.2],
    [bt(68), ROUND_ROCK[1], ROUND_ROCK[0], 60],
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
  // Arcs on the 8th notes, bars 63-66; then they converge on Round Rock (16ths, 66.3-67.3).
  const cityIdx = (name) => cities.findIndex(c => c[0] === name);
  const rr = cityIdx('Round Rock');
  const pool = cities.map((_, i) => i).filter(i => i !== rr);
  let k = 0;
  for (let bar = 63; bar <= 66; bar++) {
    for (const b of eighths()) {
      if (bar === 66 && b >= 3) break;
      const t = bt(bar, b);
      const a = pool[Math.floor(R() * pool.length)];
      let c = pool[Math.floor(R() * pool.length)]; if (c === a) c = pool[(pool.indexOf(a) + 7) % pool.length];
      arcs.push({ t, from: a, to: c, dur: 0.9 });
      k++;
    }
  }
  const conv = ['New York', 'London', 'Tokyo', 'São Paulo', 'Mexico City', 'Seattle', 'Chicago', 'Miami', 'Denver', 'Los Angeles', 'Boston', 'Houston', 'Dallas', 'Atlanta', 'Toronto', 'San Francisco'];
  sixteenths(3, 4.75).concat(sixteenths(1, 1.75).map(b => b + 4)).forEach((b, i) => {
    const t = bt(66, b);
    arcs.push({ t, from: cityIdx(conv[i % conv.length]), to: rr, dur: 1.0, converge: true });
  });
  for (const a of arcs) {
    const [, lat, lon] = cities[a.to];
    const p = globeProject(a.t + a.dur, lat, lon);
    a.x = Math.max(-1, Math.min(1, p.x));
    S(a.t + a.dur * 0.92, 0.25, 'zap', a.converge ? 0.32 : 0.4, a.x, { midi: 84 + (a.to * 5) % 12 });
  }
}
S(bt(66, 3), bt(68) - bt(66, 3), 'riser', 0.55, 0, { soft: true });

// ===== VIII · THE PROMPT (bars 68-74, 120 → 60 BPM, then free) =============================
for (let bar = 68; bar <= 71; bar++) { padBar(bar, 0.24, 55, 76); subBar(bar, 0.35, [1], 38); drums(bar, { kick: [1] }, 0.5); }

// Typing schedule: human speed for the first line, then exponential acceleration.
export const typing = (() => {
  const text = PROMPT, n = text.length;
  const start = bt(68, 3);            // 161.0
  const humanChars = 36;              // "Build a 3-minute film called ORIGIN:"
  const last = 167.85;                // the last keystroke; the HUD reads NOW here
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
  return { text, start, humanChars, last, times, keyX, keyRow, k, enter: bt(72), panScale: 0.42 };
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
S(bt(70), bt(72) - bt(70), 'riser', 0.6, 0);
export const ENTER_T = bt(72);
S(ENTER_T, 3.0, 'thunk', 0.9, 0.3);
S(ENTER_T, 5.0, 'impact', 0.45, 0, { soft: true });
export const renderBar = { t0: ENTER_T + 0.3, t1: 171.6 };
for (let k = 0; k < 12; k++) S(renderBar.t0 + (renderBar.t1 - renderBar.t0) * (k / 11), 0.08, 'tick', 0.18, 0);
// Rit: the leitmotif on the piano-pluck, resolving only at 176 s (E → D).
for (let bar = 72; bar <= 74; bar++) padBar(bar, 0.26, 50, 74);
subBar(72, 0.5, [1], 38); subBar(73, 0.45, [1], 38); subBar(74, 0.45, [1, 3], 38);
motif(72, 1, 62, 'minor', 'piano', 0.7);
N(bt(73, 3), beatsToSec(bt(73, 3), 1.5), 'piano', 57, 0.4);
N(bt(74), beatsToSec(bt(74), 2), 'piano', 58, 0.42);
N(bt(74, 3), 176 - bt(74, 3), 'piano', 64, 0.5);                    // E (unresolved)…
N(176.0, 6.5, 'piano', 62, 0.62);                                    // …→ D at 176: resolution
N(176.0, 6.5, 'piano', 50, 0.35);
N(176.0, 5.5, 'pad', 50, 0.22); N(176.0, 5.5, 'pad', 57, 0.2); N(176.0, 5.5, 'pad', 62, 0.18);

notes.sort((a, b) => a.t - b.t || a.midi - b.midi);
sfx.sort((a, b) => a.t - b.t);

// ---------------------------------------------------------------- drone
// Exactly 180 s-periodic: every partial and LFO sits on a multiple of 1/180 Hz, so the loop
// point is sample-continuous. The gain envelope wraps: g(180) = g(0).
export const drone = {
  partials: [                         // [cycles per 180 s, gain, pan]
    [6608, 0.55, 0], [6609, 0.30, -0.2],      // D1 ≈ 36.711 Hz, slow beating pair
    [9912, 0.22, 0.15],                       // A1 ≈ 55.067 Hz
    [13216, 0.20, -0.1], [13218, 0.12, 0.25], // D2 ≈ 73.42 Hz
    [19824, 0.08, 0.3],                       // A2
    [26432, 0.05, -0.3],                      // D3
  ],
  lfoCycles: [7, 11, 13],             // amplitude LFOs, cycles per 180 s
  gain: [[0, 0.5], [7.0, 0.5], [10.4, 0.8], [10.5, 0], [12, 0], [168, 0], [172, 0.12], [178, 0.42], [180, 0.5]],
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
  { t: 12,        name: 'bigbang', dur: 0.45, gain: 6.0 },
  { t: THEIA_T,   name: 'theia',   dur: 0.6,  gain: 3.0 },
  { t: SPLASH_T,  name: 'splash',  dur: 0.35, gain: 1.6 },
  { t: ENTER_T,   name: 'enter',   dur: 0.25, gain: 0.8 },
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
  fadeOut: [174.0, 175.5],
  anchors: [
    [0, 13.8e9], [12, 13.8e9], [bt(5), 13.79962e9], [32, 13.6e9], [bt(12), 12.0e9], [58, 4.6e9],
    [THEIA_T, 4.51e9], [bt(29), 4.4e9], [SPLASH_T, 3.9e9], [106, 3.8e9], [bt(45), 1.0e9],
    [bt(49), 3.85e8], [BREACH_T, 1.5e8], [bt(54), 6.6e7], [134, 1.0e6], [bt(57), 5500],
    [bt(59), 586], [bt(61), 250], [bt(63), 55], [bt(66, 3), 1], [typing.start, 1 / 365.25],
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
  II:   [ { t: 11.9, pos: [0, 0, 0], target: [0, 0, -1], fov: 60, roll: 0 },
          { t: 33.0, pos: [0, 0, -24], target: [0, 0, -25], fov: 60, roll: 12 } ],
  // III: galaxy units (disk radius ≈ 1, disk in XZ). Sampled by ch3/rig.js (log-distance about
  // target + `anchor` pinning: 'neb' = the nebula, 'sun' = the future Sun), not by sampleCamera.
  III:  [ { t: 30.0, pos: [-0.421308, 0.002938, 0.367271], target: [-0.423627, 0, 0.350771], fov: 55, roll: 0, anchor: 'neb' },
          { t: 37.0, pos: [-0.422227, 0.002404, 0.36306], target: [-0.423627, 0, 0.350771], fov: 55, roll: 0, anchor: 'neb' },
          { t: 42.6, pos: [-0.42286, 0.001871, 0.35954], target: [-0.423627, 0, 0.350771], fov: 55, roll: 0, anchor: 'neb' },
          { t: 43.5, pos: [-0.422953, 0.002017, 0.359145], target: [-0.423627, 0, 0.350771], fov: 55, roll: 0, anchor: 'neb' },
          { t: 44.6, pos: [-0.421836, 0.008619, 0.374302], target: [-0.423487, 0, 0.350679], fov: 55, roll: 0, anchor: 'neb' },
          { t: 45.8, pos: [-0.415389, 0.045, 0.42588], target: [-0.419468, 0, 0.348045], fov: 55, roll: 0, anchor: 'neb' },
          { t: 47.2, pos: [-0.312966, 0.468391, 0.807188], target: [-0.326584, 0, 0.287165], fov: 55, roll: 0, anchor: 'neb' },
          { t: 48.6, pos: [0.02, 1.838507, 1.60269], target: [0.02, 0, 0.06], fov: 55, roll: 0, anchor: 'neb' },
          { t: 50.7, pos: [-0.128015, 1.812425, 1.468264], target: [0.02, 0, 0.06], fov: 55, roll: 0, anchor: 'sun' },
          { t: 52.3, pos: [0.4138, 0.863557, 1.026669], target: [0.442892, 0.00035, 0.193586], fov: 55, roll: 0, anchor: 'sun' },
          { t: 54.0, pos: [0.741767, 0.176904, 0.51767], target: [0.707989, 0.000569, 0.277327], fov: 55, roll: 0, anchor: 'sun' },
          { t: 55.6, pos: [0.755492, 0.021028, 0.327383], target: [0.74444, 0.000599, 0.288841], fov: 55, roll: 0, anchor: 'sun' },
          { t: 56.6, pos: [0.747734, 0.002848, 0.294509], target: [0.745832, 0.0006, 0.289281], fov: 55, roll: 0, anchor: 'sun' },
          { t: 57.3, pos: [0.746282, 0.00101, 0.290336], target: [0.74586, 0.0006, 0.28929], fov: 55, roll: 0, anchor: 'sun' },
          { t: 58.6, pos: [0.746044, 0.000767, 0.289724], target: [0.74586, 0.0006, 0.28929], fov: 55, roll: 0, anchor: 'sun' } ],
  IV:   [ { t: 57.2, pos: [0, 2, 8], target: [0, 0, 0], fov: 45, roll: 0 },
          { t: 83.0, pos: [0, 0.5, 4], target: [0, 0, 0], fov: 45, roll: 0 } ],
  // V: planet units (R = 1). 81–84 hold the IV→V disc (r = 0.3056 H at fov 40), then a slow
  // banking orbit toward the terminator. 96–107 (dive, ocean, underwater) is derived in
  // src/chapters/ch5/path.js from the 96 s key: altitude spans 5 orders of magnitude (log-space).
  V:    [ { t: 81.0, pos: [0, 0, 4.6051045], target: [0, 0, 0], fov: 40, roll: 0 },
          { t: 83.0, pos: [0, 0, 4.6051045], target: [0, 0, 0], fov: 40, roll: 0 },
          { t: 84.0, pos: [0, 0, 4.6051045], target: [0, 0, 0], fov: 40, roll: 0 },
          { t: 88.0, pos: [0.38335, -0.11518, 4.38175], target: [0, 0, 0], fov: 40, roll: 6 },
          { t: 92.0, pos: [0.90935, -0.24725, 3.93884], target: [0, 0, 0], fov: 40, roll: 17 },
          { t: 96.0, pos: [1.3412, -0.3763, 3.31958], target: [0, 0, 0], fov: 40, roll: 32 } ],
  VI:   [ { t: 105.0, pos: [0, 0, 1], target: [0, 0, 0], fov: 50, roll: 0 },
          { t: 135.0, pos: [0, 0, 1], target: [0, 0, 0], fov: 50, roll: 0 } ],
  VII:  [ { t: 133.0, pos: [0, 0, 1], target: [0, 0, 0], fov: 50, roll: 0 },
          { t: 160.6, pos: [0, 0, 1], target: [0, 0, 0], fov: 50, roll: 0 } ],
  VIII: [ { t: 159.2, pos: [0, 0.3, 0.6], target: [0, 0.25, 0], fov: 35, roll: 0 },
          { t: 180.0, pos: [0, 0.25, 0.3], target: [0, 0.25, 0], fov: 35, roll: 0 } ],
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
