// ORIGIN · VI march timing: seven animals on a shore at sunset, each on ITS OWN clock
// (docs/research/animal-realism.md §1–2, §4). Moved and extended from src/chapters/ch6/lab/beats.js:
// this file holds only TIME and PLACE — speed plans, gait clocks, behaviour times, bout plans and the
// events they produce. Poses live in src/chapters/ch6/animals.js and read everything from here, so a
// foot plants, a throat pumps and a torch catches on exactly the times the sound is scheduled at.
// Pure JS: imports nothing from three.js, the DOM or timeline.js. Film time throughout.
//
// Frame ("walk-local", metres): x along the shore (screen right), y up, z toward the camera; the
// camera sits at z = ZC looking along −z (toward the sun). Each animal walks on its own plane
// z = ZC − D (D: its camera distance, §2.3 — real size, the camera closer for small animals).
// Nothing here is on the beat grid: speeds, pauses, gaps and bursts are seeded lognormals and every
// footfall comes from a gait clock's own plant times (tOfPhase).
import { makeGaitClock, eventTimes } from './gait.js';
import { boomPlan } from '../audio/nature/voices.js';
import { mulberry32, clamp, sstep } from '../audio/nature/dsp.js';
import { pantHootPlan, lizardHissPlan, foxBarksPlan, lognorm } from './plans.js';

export const ZC = 12;                         // camera z during the march (walk-local)
export const TORCH = 151.0;                   // the flame catches (VI → VII hand-off)
export const T0 = 128.0, T1 = 154.0;          // the march (vignettes 128–151, night 151–154)

/** FNV-1a: each animal's seed is a hash of its name (research §4). */
export function seedOf(name) { let h = 0x811c9dc5; for (let i = 0; i < name.length; i++) { h ^= name.charCodeAt(i); h = Math.imul(h, 0x01000193); } return h >>> 0; }
const frac = (x) => x - Math.floor(x);

// ------------------------------------------------------------------------------ shared helpers
/** Wrap a gait clock (world metres) for a builder working in model units (world = model · k). */
function modelClock(W, k) {
  return {
    X: (t) => W.X(t) / k, phase: W.phase, speed: W.speed,
    foot: (t, off, d, hipX, lift, neu) => { const f = W.foot(t, off, d, hipX * k, lift * k, (neu || 0) * k); return { ...f, x: f.x / k, y: f.y / k }; },
  };
}
/**
 * Plant times of every limb of a gait-clock animal in [a, b]: ψ = 0 of each cycle (stance start),
 * plus feet that finish their swing during a (non-freeze) stop. Returns [{t, id, x, z}] (world).
 */
function plantsOf(A, a, b) {
  const W = A.W, out = [];
  for (const [id, L] of Object.entries(A.limbs)) {
    const k0 = Math.ceil(W.phase(a) + L.off - 1e-9), k1 = Math.floor(W.phase(b) + L.off + 1e-9);
    for (let kk = k0; kk <= k1; kk++) {
      const t = W.tOfPhase(kk - L.off);
      if (t < a || t > b || W.phase(t) < kk - L.off - 1e-6) continue;
      out.push({ t, id, via: 'cycle' });
    }
    if (!A.freeze) for (const st of W.stops) {
      const psi = frac(W.phase(st.a) + L.off);
      if (psi < A.duty) continue;
      const s = (psi - A.duty) / (1 - A.duty), tl = st.a + (1 - s) * (1 - A.duty) / st.f;
      if (tl < st.b && tl >= a && tl <= b) out.push({ t: tl, id, via: 'stop' });
    }
  }
  for (const p of out) {
    const L = A.limbs[p.id], f = W.foot(p.t + 2e-4, L.off, A.duty, L.hipX, L.lift, L.neutral);
    p.x = A.x0 + A.dir * f.x; p.z = A.z + L.z;
  }
  return out.sort((u, v) => u.t - v.t);
}
function stepEvents(A, a, b, { m, kind, ground }) {
  return plantsOf(A, a, b).map(p => ({ t: p.t, animal: A.name, type: 'step', pos: [p.x, 0, p.z], m, kind: typeof kind === 'function' ? kind(p.id) : kind, ground, foot: p.id }));
}
/** A limb table in world metres from builder constants (model units) × k. */
function limbTable(k, spec) {
  const o = {};
  for (const [id, s] of Object.entries(spec)) o[id] = { off: s.off, hipX: s.hipX * k, neutral: (s.neutral || 0) * k, lift: s.lift * k, z: s.z * k };
  return o;
}

// ------------------------------------------------------------------------------ 1 · tetrapod
/**
 * TETRAPOD haul-out (2.1 m, real size), 128.0–131.0 — a mudskipper / seal model: both forelimbs
 * crutch together, the belly drags, each move starts with the head lifting (§2.2).
 * A custom clock (crutching is not a cyclic gait): two lunges, rests between, fins recovering while
 * the body is still, one fin slipping in the second lunge. No calls.
 */
function makeTetrapod(o = {}) {
  const name = 'tetrapod', seed = seedOf(name), R = mulberry32(seed);
  const j = (s) => (R() - 0.5) * 2 * s;
  const k = 1, D = 5.2, z = ZC - D;
  const lift0 = 128.4 + j(0.03);
  const L1 = [128.62 + j(0.03)]; L1[1] = L1[0] + 0.68 * (0.95 + 0.1 * R());
  const gulp = 129.7 + j(0.05);
  const L2 = [130.22 + j(0.04)]; L2[1] = L2[0] + 0.62 * (0.95 + 0.1 * R());
  const D1 = 0.46 * (0.94 + 0.12 * R()), D2 = 0.28 * (0.94 + 0.12 * R());
  const plant = [[L1[0] - 0.07, L1[0] - 0.05 + 0.04 * R()], [L2[0] - 0.06, L2[0] - 0.04 + 0.04 * R()]];   // [LF, RF] per lunge
  const recov = [lift0 + 0.02, gulp + 0.3 + 0.08 * R()];                                                // fins lift for the reach
  const belly = [L1[1] + 0.05 + 0.03 * R(), L2[1] + 0.06 + 0.03 * R()];
  const throat = [L1[1] + 0.16 + 0.06 * R()]; throat.push(throat[0] + 0.66 * (0.9 + 0.2 * R()));
  const pulses = throat.filter(t => t < gulp - 0.15);
  const slip = { t: L2[0] + 0.28 + 0.1 * R(), d: 0.11, dx: -0.055 };
  const rest = 130.92 + j(0.03);
  const dir = -1, x0 = o.x0 ?? 0.2;
  // push: the body surges early in each lunge (speed peaks ~⅓ in), then glides to a stop
  const e = (u) => { u = clamp(u); const v = 1 - Math.pow(1 - u, 1.45); return v * v * (3 - 2 * v); };
  const X = (t) => x0 + dir * (D1 * e((t - L1[0]) / (L1[1] - L1[0])) + D2 * e((t - L2[0]) / (L2[1] - L2[0])));
  const HIPX = 0.82, FZ = 0.22;                                       // fin root ahead of X; fins' z
  const anchor = [X(127) + dir * (HIPX - 0.12), X(0.5 * (L1[0] + L1[1])) + dir * HIPX, X(0.5 * (L2[0] + L2[1])) + dir * HIPX];
  /** fin foot record (world x): planted (stance) or recovering (swing, lifted). id: 'LF' | 'RF' */
  function fin(t, id) {
    const side = id === 'LF' ? 0 : 1;
    const segs = [[recov[0], plant[0][side], anchor[0], anchor[1]], [recov[1], plant[1][side], anchor[1], anchor[2]]];
    let x = anchor[0], y = 0, stance = true, s = 0, psi = 0;
    for (let i = 0; i < 2; i++) {
      const [a, b, xa, xb] = segs[i];
      if (t >= b) { x = xb; stance = true; s = 0; }
      else if (t >= a) { s = (t - a) / (b - a); const ee = s * s * (3 - 2 * s); x = xa + (xb - xa) * ee; y = 0.07 * Math.pow(Math.sin(Math.PI * Math.pow(s, 0.8)), 1.2); stance = false; break; }
      else break;
    }
    if (side === 1 && t > slip.t) x += dir * slip.dx * sstep(slip.t, slip.t + slip.d, t);
    psi = stance ? 0 : 0.5 + 0.5 * s;
    return { x, y, stance, s, psi };
  }
  const B = {
    lift0, L1, L2, gulp, belly, pulses, slip, rest, recov, plant,
    push: (t) => Math.max(sstep(L1[0] - 0.05, L1[0] + 0.12, t) * (1 - sstep(L1[1] - 0.12, L1[1], t)), 0.75 * sstep(L2[0] - 0.05, L2[0] + 0.12, t) * (1 - sstep(L2[1] - 0.12, L2[1], t))),
    chest: (t) => Math.max(sstep(L1[0] - 0.05, L1[0] + 0.22, t) * (1 - sstep(L1[1] - 0.04, belly[0], t)), 0.7 * sstep(L2[0] - 0.05, L2[0] + 0.22, t) * (1 - sstep(L2[1] - 0.04, belly[1], t))),
    headUp: (t) => sstep(lift0 - 0.05, lift0 + 0.25, t) * (1 - 0.6 * sstep(L1[1], L1[1] + 0.3, t)) + 0.5 * sstep(L2[0] - 0.25, L2[0], t) * (1 - sstep(rest - 0.1, rest + 0.35, t)),
    gape: (t) => { const d = t - gulp; return d > 0 && d < 0.32 ? Math.sin(Math.PI * d / 0.32) : 0; },
    throat: (t) => { let v = 0; for (const p of pulses) { const d = t - p; if (d > 0 && d < 0.4) v = Math.max(v, Math.sin(Math.PI * d / 0.4)); } return v; },
    rest: (t) => sstep(rest - 0.1, rest + 0.4, t),
  };
  const A = { name, dir, k, D, z, x0, X, cx: 0.12, ext: [-1.0, 1.25], height: 0.36, fin, beh: B, HIPX, FZ, seed,
    // the receding wash: the waterline on the creature's plane slides back (behind it) as the sea drains
    waterX: (t) => x0 - dir * (0.35 + 0.5 * sstep(127.4, 129.2, t)) };
  A.events = () => {
    const ev = [];
    const tRef = L1[0] - 0.3;
    ev.push({ t: tRef, animal: name, type: 'haulout', pos: [X(tRef) + dir * 0.3, 0.1, z], lunges: [L1[0] - tRef, L2[0] - tRef], gulpAt: gulp - tRef, seed: seed % 100000 });
    for (let i = 0; i < 2; i++) for (const [id, side] of [['LF', 0], ['RF', 1]]) ev.push({ t: plant[i][side], animal: name, type: 'step', pos: [fin(plant[i][side] + 1e-3, id).x, 0, z + (side ? -FZ : FZ)], m: 40, kind: 'paw', ground: 'wet', foot: id });
    for (const t of belly) ev.push({ t, animal: name, type: 'step', pos: [X(t) + dir * 0.45, 0, z], m: 40, kind: 'belly', ground: 'wet', foot: 'belly' });
    ev.push({ t: gulp, animal: name, type: 'gulp', pos: [X(gulp) + dir * 1.15, 0.2, z], part: 'haulout' });
    for (const t of [L1[0], L2[0]]) ev.push({ t, animal: name, type: 'breath', pos: [X(t) + dir * 1.15, 0.2, z], kind: 'exhale', part: 'haulout' });
    return ev;
  };
  return A;
}

// ------------------------------------------------------------------------------ 2 · amphibian
/**
 * AMPHIBIAN, a 1.7 m temnospondyl on salamander kinematics, 131.0–134.0: one slow stride (cycle
 * ≈ 2 s, lateral sequence, diagonal couplets), a pause at maximum bend with a forefoot raised, the
 * head lifts and swings ~15° to scan (throat pulsing at 1.5 Hz), then half a stride on. No call.
 */
function makeAmphibian(o = {}) {
  const name = 'amphibian', seed = seedOf(name), R = mulberry32(seed);
  const j = (s) => (R() - 0.5) * 2 * s;
  const k = 8.5, D = 4.5, z = ZC - D, v = 0.3;
  const stop = 132.3 + j(0.04), go = 133.5 + j(0.04);
  const plan = [[124, v], [stop - 0.55, v * (0.97 + 0.06 * R())], [stop, 0], [go, 0], [go + 0.35, v * (0.95 + 0.1 * R())], [170, v]];
  const offs = { LH: 0, LF: 0.4, RH: 0.5, RF: 0.9 }, duty = 0.75;
  const W = makeGaitClock({ plan, h: 0.2, duty, offs, seed: seed % 9973, cv: 0.025, fScale: 0.3, t0: 124, t1: 158, freeze: { foot: 'LF', s: 0.3 } });
  const scan = 133.1 + j(0.04);
  const throatT = [scan - 0.05]; for (let i = 0; i < 3; i++) throatT.push(throatT[i] + 0.667 * (0.92 + 0.16 * R()));
  const scanYaw = (10 + 8 * R()) * (R() < 0.5 ? 1 : -1);
  const xRef = o.xRef ?? [131.8, 3.2];
  const dir = o.dir ?? -1, x0 = xRef[1] - dir * W.X(xRef[0]);
  const B = {
    stop, go, scan, scanYaw, throatT,
    lift: (t) => sstep(scan - 0.05, scan + 0.2, t) * (1 - sstep(go + 0.05, go + 0.45, t)),
    yaw: (t) => sstep(scan + 0.08, scan + 0.3, t) * (1 - sstep(scan + 0.62, scan + 0.85, t)),
    throat: (t) => { let v2 = 0; for (const p of throatT) { const d = t - p; if (d > 0 && d < 0.45) v2 = Math.max(v2, Math.sin(Math.PI * d / 0.45)); } return v2; },
  };
  // salamander builder constants (lab/creatures.js DEFS.salamander): girdle x + rootX, lift, z
  const limbs = limbTable(k, { LH: { off: 0, hipX: 0, lift: 0.006, z: 0.02 }, RH: { off: 0.5, hipX: 0, lift: 0.006, z: -0.02 },
    LF: { off: 0.4, hipX: 0.052, lift: 0.006, z: 0.019 }, RF: { off: 0.9, hipX: 0.052, lift: 0.006, z: -0.019 } });
  const A = { name, dir, k, D, z, x0, W, clock: modelClock(W, k), X: (t) => x0 + dir * W.X(t), duty, offs, limbs, freeze: true, cx: -0.15, ext: [-1.0, 0.75], height: 0.25, beh: B, seed };
  A.events = () => {
    const ev = stepEvents(A, 128.5, 136, { m: 50, kind: 'paw', ground: 'wet' });
    ev.push({ t: scan + 0.02, animal: name, type: 'breath', pos: [A.X(scan) + dir * 0.75, 0.15, z], kind: 'exhale', dur: 0.5 });
    return ev;
  };
  return A;
}

// ------------------------------------------------------------------------------ 4 · theropod
/**
 * THEROPOD, Allosaurus-class (6 m, hip 2 m, k = 2), the centrepiece: walks in behind the frozen
 * lizard, a braking step into double support, head saccade-and-holds, two gulps, an inhale that
 * raises the body, head down with the mouth SHUT, the SAV (the swash at its feet dances), then a
 * closed-mouth boom with the throat sac at ~2× the neck (cassowary + crocodilian model). The bout
 * continues: the second boom rings off-screen under the ape. Plan from voices.boomPlan (same seed).
 */
function makeTheropod(o = {}) {
  const name = 'theropod', seed = 7, R = mulberry32(seed);
  const k = 2, D = 15, z = ZC - D, walkV = 1.7;
  const stop = 139.0 + (R() - 0.5) * 0.06;
  const v1 = walkV * (0.97 + 0.06 * R()), v2 = walkV * (0.96 + 0.08 * R());
  const bout = boomPlan({ seed: seed * 7 + 1, booms: 2, f0: 31 });
  const B0 = stop + 0.12;                                      // bout start: gulps at B0 + 0.05 …
  const sav0 = B0 + bout.booms[0].sav[0];
  const end0 = B0 + bout.booms[0].t0 + bout.booms[0].d;       // the first boom dies away
  // after its first boom it walks on (the bout continues: it stops again, off-screen, to boom again)
  // (a brisk walk, Fr ≈ 0.22: it strides out of the fox's frame before its next display)
  const off = end0 + 0.2 + 0.15 * R(), stop2 = B0 + bout.booms[1].sav[0] - 0.1;
  const v3 = 2.1 * (0.97 + 0.06 * R());
  const plan = [[120, v1], [stop - 1.0, v2], [stop, 0], [off, 0], [off + 0.55, v3], [stop2 - 0.55, v3 * (0.96 + 0.08 * R())], [stop2, 0], [200, 0]];
  const offs = { LH: 0, RH: 0.5 }, duty = 0.6;
  const W = makeGaitClock({ plan, h: 1.0 * k, duty, offs, seed, cv: 0.025, t0: 124, t1: 160 });
  const boomEnd = bout.booms.map(b => B0 + b.t0 + b.d);
  const rel = (i, t) => 1 - sstep(boomEnd[i] + 0.05, boomEnd[i] + 0.55, t);
  const sacc = eventTimes(seed + 11, stop - 0.1, B0 + 0.2 + bout.inhale[0], 0.45, 0.4, 0.2);
  const saccAmp = sacc.map(() => (R() - 0.5) * 10);
  const B = {
    stop, B0, bout, sacc, saccAmp,
    off, stop2, boomEnd,
    inflate: (t) => { const [a, d] = bout.inhale; return sstep(B0 + a, B0 + a + d, t) * rel(0, t); },
    headDown: (t) => { let v = 0; bout.booms.forEach((b, i) => { const s0 = B0 + b.sav[0]; v = Math.max(v, sstep(s0 - 0.1, s0 + 0.35, t) * rel(i, t)); }); return v; },
    sav: (t) => { let v = 0; for (const b of bout.booms) { const [a, d] = b.sav; v = Math.max(v, sstep(B0 + a, B0 + a + 0.25, t) * (1 - sstep(B0 + a + d - 0.3, B0 + a + d, t))); } return v; },
    boom: (t) => { let v = 0; for (const b of bout.booms) v = Math.max(v, sstep(B0 + b.t0, B0 + b.t0 + 0.12, t) * (1 - sstep(B0 + b.t0 + b.d * 0.75, B0 + b.t0 + b.d, t))); return v; },
    onset: (t) => { let v = 0; for (const b of bout.booms) { const a = B0 + b.t0 - b.onset; v = Math.max(v, sstep(a - 0.03, a + 0.04, t) * (1 - sstep(B0 + b.t0 - 0.02, B0 + b.t0 + 0.1, t))); } return v; },
    gulp: (t) => { let v = 0; for (const g of bout.gulps) { const d = t - (B0 + g); if (d > 0 && d < 0.3) v = Math.max(v, Math.sin(Math.PI * d / 0.3)); } return v; },
    sacAt: B0 + bout.booms[0].t0,
    headSacc: (t) => { let a = 0; sacc.forEach((e, i) => { a += saccAmp[i] * sstep(e, e + 0.12, t); }); return a - 0.5 * saccAmp.reduce((x, y) => x + y, 0) * sstep(B0 - 0.1, B0 + 0.3, t); },
    settle: (t) => { const d = t - stop; return d > 0 ? Math.exp(-d / 0.35) * Math.sin(d * 9) : 0; },
  };
  const limbs = limbTable(k, { LH: { off: 0, hipX: 0, lift: 0.16, z: 0.1 }, RH: { off: 0.5, hipX: 0, lift: 0.16, z: -0.1 } });
  const xRef = o.xRef ?? [stop, 10.4];
  const dir = o.dir ?? -1, x0 = xRef[1] - dir * W.X(xRef[0]);
  const A = { name, dir, k, D, z, x0, W, clock: modelClock(W, k), X: (t) => x0 + dir * W.X(t), duty, offs, limbs, freeze: false, cx: -0.5, ext: [-3.5, 2.5], height: 3.3, beh: B, seed, walkV };
  const head = (t) => [A.X(t) + dir * 2.2, 2.3 - 0.9 * B.headDown(t), z];
  A.events = () => {
    const ev = stepEvents(A, 134.2, stop2 + 1.0, { m: 1500, kind: 'claw', ground: 'wet' });
    const bt = { ...bout, start: B0 };
    bout.gulps.forEach((g, i) => ev.push({ t: B0 + g, animal: name, type: 'gulp', pos: head(B0 + g), part: 'bout', i }));
    ev.push({ t: B0 + bout.inhale[0], animal: name, type: 'breath', pos: head(B0 + bout.inhale[0]), kind: 'inhale', dur: bout.inhale[1], part: 'bout' });
    bout.booms.forEach((b, i) => {
      ev.push({ t: B0 + b.sav[0], animal: name, type: 'sav', pos: [A.X(B0 + b.sav[0]) + dir * 0.3, 1.4, z], i, dur: b.sav[1], f: b.sav[2], bout: bt });
      ev.push({ t: B0 + b.t0 - b.onset, animal: name, type: 'boom', pos: [A.X(B0 + b.t0) + dir * 1.6, 1.6, z], i, t0: B0 + b.t0, d: b.d, f: b.f, onset: b.onset, bout: bt });
    });
    return ev;
  };
  return A;
}

// ------------------------------------------------------------------------------ 3 · lizard
/**
 * LIZARD, a 1.35 m monitor (k = 3), 134.0–137.5: intermittent locomotion (2–3 darts of ~0.3 s with
 * ~0.12 s hitches), a freeze with the near forefoot held raised, the head rises to eye the sky, one
 * forked tongue-flick; the theropod's footfalls come close → it turns its head, HISSES (a threat,
 * the only reason a monitor hisses) and darts out of frame.
 */
function makeLizard(o = {}, thero) {
  const name = 'lizard', seed = 5, R = mulberry32(seed);
  const j = (s) => (R() - 0.5) * 2 * s;
  const k = 3, D = 3.4, z = ZC - D, vD = 1.1;
  const freezeAt = 135.0 + j(0.03);
  const bursts = [];
  { const ds = [], hs = [];
    for (let i = 0; i < 3; i++) { ds.push(clamp(0.3 * Math.exp(0.25 * (R() - 0.5) * 2), 0.22, 0.42)); hs.push(clamp(0.12 * Math.exp(0.4 * (R() - 0.5) * 2), 0.08, 0.2)); }
    let t = freezeAt - ds.reduce((a, b) => a + b, 0) - hs[0] - hs[1];
    for (let i = 0; i < 3; i++) { bursts.push([t, ds[i]]); t += ds[i] + hs[i]; } }
  const raiseAt = 135.6 + j(0.05), tongueAt = 136.0 + j(0.05);
  // the threat: the first heavy footfall of the approaching theropod after the tongue-flick
  const thump = thero.stepTimes.find(t => t > tongueAt + 0.2) ?? 136.5;
  const hiss = lizardHissPlan({ seed: seed * 13 + 1, count: 1 });
  const hissAt = thump + 0.2 + 0.06 * R();                     // onset (the plan starts 0.05 s into the voice)
  const hissD = hiss[0][1];
  const dartAt = hissAt + Math.min(0.55, hissD * 0.6);
  const plan = [[120, 0]];
  for (const [a, d] of bursts) plan.push([a, 0], [a + 0.06, vD], [a + d - 0.05, vD], [a + d, 0]);
  plan.push([dartAt, 0], [dartAt + 0.12, vD], [dartAt + 1.6, vD * 1.05], [200, vD * 1.05]);
  const offs = { LH: 0, LF: 0.4, RH: 0.5, RF: 0.9 }, duty = 0.72;
  const W = makeGaitClock({ plan, h: 0.036 * k * 1.6, duty, offs, seed, fScale: 0.34, fExp: 0.75, vRef: 0.3, cv: 0.03, t0: 124, t1: 160, freeze: { foot: 'LF', s: 0.3 } });
  const B = {
    bursts, freezeAt, raiseAt, tongueAt, thump, hissAt, hissD, dartAt,
    raise: (t) => sstep(raiseAt, raiseAt + 0.2, t) * (1 - sstep(thump + 0.08, thump + 0.3, t)),
    alarm: (t) => sstep(thump + 0.08, thump + 0.25, t) * (1 - sstep(dartAt, dartAt + 0.2, t)),   // head turns to the sound, body presses down
    tongue: (t) => sstep(tongueAt, tongueAt + 0.06, t) * (1 - sstep(tongueAt + 0.18, tongueAt + 0.26, t)),
    hiss: (t) => sstep(hissAt - 0.03, hissAt + 0.05, t) * (1 - sstep(hissAt + hissD - 0.25, hissAt + hissD, t)),
  };
  const limbs = limbTable(k, { LH: { off: 0, hipX: 0, lift: 0.014, z: 0.039 }, RH: { off: 0.5, hipX: 0, lift: 0.014, z: -0.039 },
    LF: { off: 0.4, hipX: 0.088, lift: 0.012, z: 0.032 }, RF: { off: 0.9, hipX: 0.088, lift: 0.012, z: -0.032 } });
  const xRef = o.xRef ?? [freezeAt, 7.0];
  const dir = o.dir ?? -1, x0 = xRef[1] - dir * W.X(xRef[0]);
  const A = { name, dir, k, D, z, x0, W, clock: modelClock(W, k), X: (t) => x0 + dir * W.X(t), duty, offs, limbs, freeze: true, cx: -0.12, ext: [-0.95, 0.4], height: 0.2, beh: B, seed };
  A.events = () => {
    const ev = stepEvents(A, 132, 139.5, { m: 6, kind: 'claw', ground: 'sand' });
    ev.push({ t: hissAt - hiss[0][0], animal: name, type: 'hiss', pos: [A.X(hissAt) + dir * 0.35, 0.1, z], seed: seed * 13 + 1, count: 1, onset: hissAt, dur: hissD });
    return ev;
  };
  return A;
}

// ------------------------------------------------------------------------------ 5 · fox
/**
 * FOX, real size (shoulder 0.37 m), 142.0–145.0: trots in at 1.6 m/s, 2.6–2.7 Hz (off the 2 Hz
 * grid), stops within one stride; a distant fox barks → its ears swivel independently toward it,
 * the head tilts; the nose dips to the sand; a look back over the shoulder, held. Silent itself.
 */
function makeFox(o = {}, thero) {
  const name = 'fox', seed = 3, R = mulberry32(seed);
  const k = 1, D = 3.6, z = ZC - D, trotV = 1.6;
  const stop = 143.8 + (R() - 0.5) * 0.06;
  const plan = [[120, trotV], [stop - 0.38, trotV * (0.95 + 0.1 * R())], [stop, 0], [200, 0]];
  const offs = { LH: 0, RF: 0.02, RH: 0.5, LF: 0.52 }, duty = 0.45;
  const W = makeGaitClock({ plan, h: 0.35, duty, offs, seed, cv: 0.025, fScale: 1.21, t0: 124, t1: 160 });
  // it stops, facing the giant walking away: its ears swivel to the first departing footfall
  const thump = thero.stepTimes.find(t => t > stop + 0.05) ?? stop + 0.3;
  const barkSeed = seedOf('fox-far') % 100000, barkCount = 3 + Math.floor(R() * 2);
  const barks = foxBarksPlan({ seed: barkSeed, count: barkCount });
  // later another fox calls from far behind it (up the beach): it looks back over its shoulder
  const barkT = 144.85 + 0.1 * R();
  const bark1 = barkT + barks[0][0];
  const eL = [thump + 0.1 + 0.05 * R(), bark1 + 0.12 + 0.04 * R(), ...eventTimes(seed + 1, bark1 + 0.8, stop + 3.2, 0.55, 0.45, 0.25)];
  const eR = eL.map(x => x + 0.1 + 0.1 * R());
  const aL = eL.map((_, i) => i === 0 ? -0.9 - 0.3 * R() : i === 1 ? 0.8 + 0.3 * R() : (R() - 0.5) * 1.2), aR = aL.map(a => a * (0.4 + 0.5 * R()) + (R() - 0.5) * 0.4);
  const tiltA = thump + 0.3 + 0.08 * R();
  const sniffA = 144.55 + (R() - 0.5) * 0.08, sniffD = 0.4 + 0.1 * R();
  const lookA = bark1 + 0.25 + 0.05 * R();
  const tailFlick = eventTimes(seed + 5, stop + 0.3, stop + 4, 1.4, 0.5, 0.6);
  const earAng = (times, amps, t) => { let a = 0; times.forEach((e, i) => { a += (amps[i] - a) * sstep(e, e + 0.12, t); }); return a; };
  const B = {
    stop, thump, barkT, bark1, eL, eR, aL, aR, sniffA, sniffD, lookA, tailFlick,
    earL: (t) => earAng(eL, aL, t), earR: (t) => earAng(eR, aR, t),
    tilt: (t) => 0.26 * sstep(tiltA, tiltA + 0.2, t) * (1 - sstep(tiltA + 0.6, tiltA + 0.8, t)),
    sniff: (t) => sstep(sniffA - 0.2, sniffA, t) * (1 - sstep(sniffA + sniffD, sniffA + sniffD + 0.2, t)),
    look: (t) => sstep(lookA, lookA + 0.3, t) * (1 - sstep(lookA + 1.1, lookA + 1.45, t)),
  };
  // mammal builder constants (DEFS.mammal): hind at the pelvis, fore at shX 0.36 + rootX 0.01
  const limbs = limbTable(k, { LH: { off: 0, hipX: 0, lift: 0.07, z: 0.045 }, RH: { off: 0.5, hipX: 0, lift: 0.07, z: -0.045 },
    RF: { off: 0.02, hipX: 0.37, neutral: 0.02, lift: 0.08, z: -0.045 }, LF: { off: 0.52, hipX: 0.37, neutral: 0.02, lift: 0.08, z: 0.045 } });
  const xRef = o.xRef ?? [stop, 16.0];
  const dir = o.dir ?? -1, x0 = xRef[1] - dir * W.X(xRef[0]);
  const A = { name, dir, k, D, z, x0, W, clock: modelClock(W, k), X: (t) => x0 + dir * W.X(t), duty, offs, limbs, freeze: false, cx: 0.06, ext: [-0.75, 0.62], height: 0.62, beh: B, seed };
  A.events = () => {
    const ev = stepEvents(A, 140.5, 146, { m: 6, kind: 'paw', ground: 'sand' });
    // the other fox: off-screen right and far up the beach
    ev.push({ t: barkT, animal: name, type: 'bark', pos: [A.X(stop) - dir * 38, 0.4, z - 55], seed: barkSeed, count: barkCount, onsets: barks.map(b => barkT + b[0]), who: 'distant' });
    ev.push({ t: sniffA, animal: name, type: 'breath', pos: [A.X(stop) + dir * 0.55, 0.05, z], kind: 'sniff', dur: sniffD });
    return ev;
  };
  return A;
}

// ------------------------------------------------------------------------------ 6 · ape
/**
 * APE, a chimpanzee at real size, 145.0–148.0: knuckle-walks (diagonal sequence, stride ~1.2 s,
 * rump above the shoulders), stops and sits back on its haunches, scratches its forearm (4–6
 * irregular strokes), eyes then head turn to the sun, then the pant-hoot: build-up pants pump the
 * chest, piloerection grows the silhouette ~10 %, the head throws up at the climax.
 */
function makeApe(o = {}) {
  const name = 'ape', seed = seedOf(name), R = mulberry32(seed);
  const j = (s) => (R() - 0.5) * 2 * s;
  const k = 1, D = 6.5, z = ZC - D, v = 0.84;
  const stop = 146.6 + j(0.04);
  const plan = [[120, v * (0.97 + 0.06 * R())], [stop - 0.6, v * (0.95 + 0.1 * R())], [stop, 0], [200, 0]];
  const offs = { LH: 0, RF: 0.1, RH: 0.5, LF: 0.6 }, duty = 0.65;
  const W = makeGaitClock({ plan, h: 0.5, duty, offs, seed: seed % 9973, cv: 0.025, fScale: 0.64, t0: 124, t1: 160 });
  const sitA = stop + 0.03 + 0.04 * R(), sitB = sitA + 0.4;
  const strokes = [];
  { let t = sitB + 0.02 + 0.04 * R(); const n = 4 + Math.floor(R() * 2);
    for (let i = 0; i < n; i++) { const d = clamp(lognorm(R, 0.1, 0.2), 0.07, 0.15); strokes.push([t, d]); t += d + clamp(lognorm(R, 0.025, 0.5), 0.006, 0.08); } }
  const scratchEnd = strokes[strokes.length - 1][0] + strokes[strokes.length - 1][1];
  const gazeA = 147.3 + j(0.04);
  const phSeed = seed % 100000, ph = pantHootPlan({ seed: phSeed });
  const climaxAt = 147.62 + j(0.04), onset = climaxAt - ph.climax[0].t;
  const at = (e) => onset + e.t, introT = ph.intro.length ? ph.intro[0].t : ph.pants[0].t;
  const climaxEnd = at(ph.climax[ph.climax.length - 1]) + ph.climax[ph.climax.length - 1].d;
  const B = {
    stop, sitA, sitB, strokes, scratchEnd, gazeA, ph, onset, climaxAt, climaxEnd,
    sit: (t) => sstep(sitA, sitB, t),
    scratch: (t) => { let v2 = 0; for (const [a, d] of strokes) { const u = (t - a) / d; if (u > 0 && u < 1) v2 = Math.sin(Math.PI * u); } return v2; },
    scratching: (t) => sstep(sitB - 0.1, strokes[0][0], t) * (1 - sstep(scratchEnd, scratchEnd + 0.2, t)),
    gaze: (t) => sstep(gazeA, gazeA + 0.12, t) * 0.3 + sstep(gazeA + 0.08, gazeA + 0.32, t) * 0.7,
    // chest pumps: each build-up exhale compresses, each inhale expands (−1 … 1)
    pump: (t) => { let v2 = 0; for (const p of ph.pants) { const a = at(p), u = (t - a) / p.d; if (u > 0 && u < 1) v2 = -Math.sin(Math.PI * u); const b = onset + p.inhale[0], w = (t - b) / p.inhale[1]; if (w > 0 && w < 1) v2 = Math.sin(Math.PI * w); } return v2; },
    funnel: (t) => sstep(onset + introT - 0.05, onset + introT + 0.1, t) * (1 - sstep(climaxEnd + 0.8, climaxEnd + 1.2, t)),
    pilo: (t) => sstep(at(ph.pants[0]), climaxAt, t) * (1 - 0.6 * sstep(climaxEnd + 0.5, climaxEnd + 2.5, t)),
    throw: (t) => { let v2 = 0; for (const c of ph.climax) { const a = at(c); v2 = Math.max(v2, sstep(a - 0.06, a + 0.1, t) * (1 - sstep(a + c.d, a + c.d + 0.25, t))); } return v2; },
    scream: (t) => { let v2 = 0; for (const c of ph.climax) { const a = at(c); v2 = Math.max(v2, sstep(a - 0.02, a + 0.05, t) * (1 - sstep(a + c.d - 0.05, a + c.d + 0.05, t))); } return v2; },
  };
  // ape builder constants (DEFS.ape): plantigrade hind (neutral −0.02), knuckle fore at shX 0.36 (neutral 0.06)
  const limbs = limbTable(k, { LH: { off: 0, hipX: 0, neutral: -0.02, lift: 0.07, z: 0.09 }, RH: { off: 0.5, hipX: 0, neutral: -0.02, lift: 0.07, z: -0.09 },
    RF: { off: 0.1, hipX: 0.36, neutral: 0.06, lift: 0.08, z: -0.12 }, LF: { off: 0.6, hipX: 0.36, neutral: 0.06, lift: 0.08, z: 0.12 } });
  const xRef = o.xRef ?? [stop, 19.5];
  const dir = o.dir ?? -1, x0 = xRef[1] - dir * W.X(xRef[0]);
  const A = { name, dir, k, D, z, x0, W, clock: modelClock(W, k), X: (t) => x0 + dir * W.X(t), duty, offs, limbs, freeze: false, cx: 0.12, ext: [-0.3, 0.62], height: 0.95, beh: B, seed };
  const headAt = (t) => [A.X(t) + dir * 0.45, 0.75, z];
  A.events = () => {
    const ev = stepEvents(A, 141, stop + 0.6, { m: 45, kind: (id) => id.endsWith('F') ? 'paw' : 'foot', ground: 'sand' });
    for (const [a, d] of strokes) ev.push({ t: a, animal: name, type: 'scratch', pos: [A.X(a) + dir * 0.2, 0.45, z], dur: d });
    ev.push({ t: onset, animal: name, type: 'panthoot', pos: headAt(onset), seed: phSeed, onset, climaxAt, plan: ph });
    return ev;
  };
  return A;
}

// ------------------------------------------------------------------------------ 7 · human
/**
 * EARLY HUMAN (Homo erectus, 1.72 m), 148.0–151.0: a tired end-of-day walk (~1.1 m/s, ~1.7 steps/s),
 * the last two steps shorten into a stop with the feet together, stillness, the gaze lifts to the
 * horizon (eyes first, the head supplies ~80 %), a small anticipatory dip, the torch rises over
 * ~0.7 s with a slight overshoot, and catches at TORCH — its flame exactly where the camera centres.
 */
function makeHuman(o = {}) {
  const name = 'human', seed = seedOf(name), R = mulberry32(seed);
  const j = (s) => (R() - 0.5) * 2 * s;
  const k = 1, D = 12.5, z = ZC - D, v = 1.1;
  const stopT = 149.5 + j(0.03);
  const plan = [[120, v * (1.0 + 0.04 * R())], [148.85 + j(0.03), v * (0.97 + 0.06 * R())], [stopT, 0], [200, 0]];
  const offs = { LH: 0, RH: 0.5 }, duty = 0.61;
  // the stop lands mid-step: the trailing foot finishes a short closing step beside the other
  const W = makeGaitClock({ plan, h: 0.915, duty, offs, seed: seed % 9973, cv: 0.022, fScale: 0.89, t0: 124, t1: 160, settle: { foot: 'LH', s: 0.7 } });
  const limbs = limbTable(k, { LH: { off: 0, hipX: 0, lift: 0.1, z: 0.085 }, RH: { off: 0.5, hipX: 0, lift: 0.1, z: -0.085 } });
  const xRef = o.xRef ?? [stopT, 25.0];
  const dir = o.dir ?? -1, x0 = xRef[1] - dir * W.X(xRef[0]);
  const A0 = { name, dir, k, D, z, x0, W, X: (t) => x0 + dir * W.X(t), duty, offs, limbs, freeze: false };
  const steps = plantsOf(A0, 140, 152);
  const standAt = steps.filter(s => s.t < stopT + 1).reduce((a, s) => Math.max(a, s.t), 0);
  const gazeA = standAt + 0.08 + 0.05 * R();
  const dipA = gazeA + 0.12 + 0.04 * R();
  const raiseA = dipA + 0.1, raiseB = TORCH - 0.1;
  const u = (t) => clamp((t - raiseA) / (raiseB - raiseA));
  // raise: ease-in-out with a slight overshoot that settles exactly by the catch
  const raise = (t) => { if (t <= raiseA) return 0; if (t >= TORCH - 0.02) return 1; const x = u(t), e = x * x * (3 - 2 * x); return e + 0.06 * Math.sin(Math.PI * Math.min(1, (t - raiseA) / (TORCH - 0.02 - raiseA))) * sstep(0.55, 1.0, x); };
  // the flame (world, on the creature plane): up and a little forward of the head
  const flame = [x0 + dir * (W.X(stopT + 1) + 0.3), 2.24, z];
  const B = {
    stopT, standAt, gazeA, dipA, raiseA, raiseB, raise, flame,
    gaze: (t) => sstep(gazeA, gazeA + 0.1, t) * 0.2 + sstep(gazeA + 0.06, gazeA + 0.34, t) * 0.8,
    dip: (t) => Math.sin(Math.PI * clamp((t - dipA) / 0.36)) * (t > dipA ? 1 : 0),
    relax: (t) => sstep(standAt - 0.5, standAt + 0.3, t),
    settle: (t) => sstep(stopT - 0.1, stopT + 0.45, t),
  };
  const A = { ...A0, clock: modelClock(W, k), cx: 0.12, ext: [-0.3, 0.45], height: 1.75, beh: B, seed };
  A.events = () => {
    const ev = stepEvents(A, 140, 152, { m: 55, kind: 'foot', ground: 'sand' });
    ev.push({ t: standAt + 0.08, animal: name, type: 'breath', pos: [A.X(standAt) + dir * 0.12, 1.6, z], kind: 'exhale', dur: 0.8 });
    ev.push({ t: raiseA, animal: name, type: 'torchraise', pos: [flame[0], 1.4, z], dur: raiseB - raiseA, catchAt: TORCH });
    return ev;
  };
  return A;
}

/** World x-extent [left, right] of an animal at t (ext is [back, front] along its heading). */
export function extentX(A, t) { const X = A.X(t); return A.dir > 0 ? [X + A.ext[0], X + A.ext[1]] : [X - A.ext[1], X - A.ext[0]]; }
/** World x of the animal's visual centre at t. */
export function centreX(A, t) { return A.X(t) + A.dir * A.cx; }

// ------------------------------------------------------------------------------ the cast
export const NAMES = ['tetrapod', 'amphibian', 'lizard', 'theropod', 'fox', 'ape', 'human'];
export const WINDOWS = { tetrapod: [128.0, 131.0], amphibian: [131.0, 134.0], lizard: [134.0, 137.5], theropod: [137.5, 142.0], fox: [142.0, 145.0], ape: [145.0, 148.0], human: [148.0, 151.0] };

let CAST = null;
/** makeCast(opts?) → { tetrapod, amphibian, lizard, theropod, fox, ape, human } (memoised without opts). */
export function makeCast(opts = null) {
  if (!opts && CAST) return CAST;
  const P = opts || POS;
  const thero = makeTheropod(P.theropod);
  thero.stepTimes = plantsOf(thero, 130, 142).map(p => p.t);
  const c = {
    tetrapod: makeTetrapod(P.tetrapod), amphibian: makeAmphibian(P.amphibian), lizard: makeLizard(P.lizard, thero), theropod: thero,
    fox: makeFox(P.fox, thero), ape: makeApe(P.ape), human: makeHuman(P.human),
  };
  for (const n of NAMES) c[n].window = WINDOWS[n];
  if (!opts) CAST = c;
  return c;
}
// where each animal is along the shore at its key moment (walk-local x, metres)
export const POS = {
  tetrapod: { x0: 0.2 },
  amphibian: { xRef: [131.8, 3.3] },
  lizard: { xRef: [135.0, 7.0] },
  theropod: { xRef: [139.0, 12.0] },
  fox: { xRef: [143.8, 18.2] },
  ape: { xRef: [146.6, 21.2] },
  human: { xRef: [149.5, 24.8] },
};
