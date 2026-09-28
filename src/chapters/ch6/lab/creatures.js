// VI lab: seven evolution-stage creatures as parametric skeletons with procedural gaits.
// poseCreature(key, t) is a pure function of t → a list of primitives (tapered capsules / round
// cones, exact SDFs after Quilez) shared by both renderers (3D raymarch and 2D silhouette).
//
// Gait engine (no foot sliding by construction): the body follows an analytic trajectory X(t);
// every foot has a phase ψ = fract(t/T + offset). In stance (ψ < duty) the foot is locked to a
// WORLD anchor = X(mid-stance time) + hip offset; in swing it eases from one anchor to the next
// along an asymmetric lift arc. Periods follow Froude scaling (T ≈ 2.3·√(L/g)·Fr^−0.2), duty
// factors and phase offsets follow Hildebrand / measured data (see docs/research/natural-forms.md).
//
// Frame: x forward (walking right on screen), y up, z toward the camera. The animal's LEFT side
// faces the camera (z > 0 = near side). Units are metres at the animal's real size.

// ------------------------------------------------------------------------------ small math
const add = (a, b, s = 1) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scl = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const nrm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const mix = (a, b, t) => a + (b - a) * t;
const mixv = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const fract = (x) => x - Math.floor(x);
const TAU = Math.PI * 2;
const rotZ = (v, a) => [v[0] * Math.cos(a) - v[1] * Math.sin(a), v[0] * Math.sin(a) + v[1] * Math.cos(a), v[2]];
const rotAbout = (a, b, ang) => add(a, rotZ(sub(b, a), ang));
const dir2 = (deg) => [Math.cos(deg * Math.PI / 180), Math.sin(deg * Math.PI / 180), 0];
// deterministic hash for per-cycle variation (breaks perfect mirror/loop symmetry)
const hsh = (n) => { let x = (n | 0) ^ 0x9E3779B9; x = Math.imul(x ^ (x >>> 16), 0x85EBCA6B); x = Math.imul(x ^ (x >>> 13), 0xC2B2AE35); return ((x ^ (x >>> 16)) >>> 0) / 4294967296; };

/** Two-bone IK: root A, target T, lengths l1, l2, pole P (direction the middle joint bends to). */
export function ik2(A, T, l1, l2, P) {
  let d = sub(T, A);
  let dl = len(d);
  const dmax = (l1 + l2) * 0.999, dmin = Math.abs(l1 - l2) + 1e-4;
  if (dl > dmax) { d = scl(d, dmax / dl); dl = dmax; }
  if (dl < dmin) { d = scl(nrm(d), dmin); dl = dmin; }
  const u = scl(d, 1 / dl);
  const a = (l1 * l1 - l2 * l2 + dl * dl) / (2 * dl);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  let v = sub(P, scl(u, dot(P, u)));
  v = len(v) < 1e-6 ? [0, 1, 0] : nrm(v);
  return { knee: add(add(A, u, a), v, h), end: add(A, d) };
}

// ------------------------------------------------------------------------------ primitives
// Each primitive: a (xyz, ra), b (xyz, rb), m = [blend k, kind, thickness(m) for translucency, side]
// kind: 0 flesh · 1 fin membrane (glows, dark rays) · 2 fur (edge fringe) · 3 scaly crest
//       4 wood (torch) · 5 cut (subtracted: eye holes, mouth slits) · 6 ear (thin, glows)
// side: 0 body / near side, 1 far side (drawn slightly lifted toward the sky in silhouette)
// Every primitive also carries an anatomical SLOT ("spine:3", "LH:1", "head:0", …): morphs between
// stages interpolate matching slots geometrically, so a lizard's body really lifts into a theropod.
class Rig {
  constructor() { this.p = []; this.group = 'x'; this.cnt = {}; }
  cone(a, b, ra, rb, { k = 0.0, kind = 0, thick = 0, far = 0 } = {}) {
    if (kind === 5 && this.noCuts) return;
    const g = this.group, i = this.cnt[g] = (this.cnt[g] || 0) + 1;
    this.p.push({ a, b, ra, rb, k, kind, thick: thick || 2 * Math.max(ra, rb), far, slot: g + ':' + (i - 1) });
  }
  chain(pts, radii, opt) { for (let i = 0; i < pts.length - 1; i++) this.cone(pts[i], pts[i + 1], radii[i], radii[i + 1], opt); }
}

// ------------------------------------------------------------------------------ gait
/**
 * Body trajectory X(t): mean speed v with an optional surge (crutching / lunging gaits):
 * X = v·t + surge·v·T/(2π)·sin(2π t/T − π/2)… so the speed peaks at mid-push.
 */
function bodyX(G, t) { return G.v * t - (G.surge || 0) * G.v * G.T / TAU * Math.sin(TAU * (t / G.T + (G.surgePh || 0))); }

/** Foot world position (x, lift) for a limb with phase offset `off`. */
function footTrack(G, t, off, hipX, lift, neutral = 0) {
  const c = t / G.T + off, k = Math.floor(c), psi = c - k;
  const anchor = (kk) => {
    const tm = (kk - off + G.duty * 0.5) * G.T;          // mid-stance time of cycle kk
    return bodyX(G, tm) + hipX + neutral;
  };
  if (psi < G.duty) return { x: anchor(k), y: 0, psi, stance: true, s: psi / G.duty, k };
  const s = (psi - G.duty) / (1 - G.duty);
  // swing: ease-in-out travel, lift peaking early (toe clears, then reaches and plants)
  const e = s * s * (3 - 2 * s);
  const x = mix(anchor(k), anchor(k + 1), e);
  const y = lift * Math.pow(Math.sin(Math.PI * Math.pow(s, 0.8)), 1.2);
  return { x, y, psi, stance: false, s, k };
}

// ------------------------------------------------------------------------------ builders
// Shared anatomy helpers ---------------------------------------------------------------
function digits(rig, base, fwd, n, lenD, r0, spreadDeg, curl, opt, lengths) {
  // fan of n digits in the horizontal plane around `fwd`, curling down at the tips
  for (let i = 0; i < n; i++) {
    const f = n === 1 ? 0 : i / (n - 1) - 0.5;
    const a = f * spreadDeg * Math.PI / 180;
    const fu = opt.fanUp || 0;
    let dx = fwd[0] * Math.cos(a), dz = Math.sin(a) * 0.9 + fwd[2];
    if (fu) dx = Math.cos(a * (1 + fu * 0.25));
    const up = fu * Math.abs(Math.sin(a)) * 0.9;
    const L = lenD * (lengths ? lengths[i] : 1);
    const mid = add(base, nrm([dx, 0.15 * curl + up, dz * (1 - fu * 0.7)]), L * 0.55);
    const tip = add(mid, nrm([dx, -0.6 * curl - 0.1 + up * 0.6, dz * (1 - fu * 0.7)]), L * 0.5);
    rig.cone(base, mid, r0, r0 * 0.75, opt);
    rig.cone(mid, tip, r0 * 0.75, r0 * 0.35, opt);
    if (opt.claw) {
      // a hooked claw: out along the digit, then curving down to a fine point
      const cd = nrm([dx, -0.35 - 0.4 * curl, dz]);
      const c1 = add(tip, cd, opt.claw * 0.6), c2 = add(c1, nrm([dx * 0.4, -1, dz * 0.4]), opt.claw * 0.55);
      rig.cone(tip, c1, r0 * 0.4, r0 * 0.22, { ...opt, k: 0 });
      rig.cone(c1, c2, r0 * 0.22, r0 * 0.02, { ...opt, k: 0 });
    }
  }
}

function spinePoints(ctrl, n) {
  // Catmull-Rom through control points [{p, r}] → n samples (with radii)
  const out = [];
  const m = ctrl.length - 1;
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1) * m, j = Math.min(m - 1, Math.floor(u)), f = u - j;
    const P = (k) => ctrl[Math.max(0, Math.min(m, k))];
    const p0 = P(j - 1).p, p1 = P(j).p, p2 = P(j + 1).p, p3 = P(j + 2).p;
    const cr = (a, b, c, d) => 0.5 * (2 * b + (c - a) * f + (2 * a - 5 * b + 4 * c - d) * f * f + (3 * b - a - 3 * c + d) * f * f * f);
    out.push({ p: [cr(p0[0], p1[0], p2[0], p3[0]), cr(p0[1], p1[1], p2[1], p3[1]), cr(p0[2], p1[2], p2[2], p3[2])], r: mix(P(j).r, P(j + 1).r, f * f * (3 - 2 * f)) });
  }
  return out;
}

// ---------------------------------------------------------------------------------------
// 1 · TIKTAALIK-like tetrapodomorph (~2 m): crutching on both pectoral fins in phase
// (mudskipper-like: push 45 %, recovery 52 %, stride ≈ 0.27 body length), body surging,
// head pitching up on the push, tail sweeping; flat crocodile head with eyes on top.
function tiktaalik(t, ov = {}) {
  const G = { T: 1.4, duty: 0.5, v: 0.38, surge: 0.85, surgePh: 0.0, ...(ov.G || {}) };
  const finOffs = ov.finOffs || [0, 0];
  const call = ov.call || 0;
  const r = new Rig();
  const X = bodyX(G, t);
  const ph = fract(t / G.T);
  // alternating fins push twice per cycle; in-phase crutching once
  const ph2 = finOffs[0] === finOffs[1] ? ph : fract(ph * 2);
  const push = Math.sin(Math.PI * clamp(ph2 / 0.5)) * (ph2 < 0.5 ? 1 : 0);   // 0..1 during the push
  const rec = ph2 >= 0.5 ? Math.sin(Math.PI * (ph2 - 0.5) / 0.5) : 0;
  const lift = 0.05 * push;                                               // fins lift the chest
  const hp = 0.10, chestY = 0.16 + lift;
  const pel = [0, hp, 0], sh = [0.72, chestY, 0];
  const headPitch = (4 + 10 * push - 3 * rec + 16 * call) * Math.PI / 180;
  const neck = add(sh, [0.12, 0.012 + lift * 0.2, 0]);
  const hd = [Math.cos(headPitch), Math.sin(headPitch), 0];
  const snout = add(neck, hd, 0.3);
  const tailSway = Math.sin(TAU * (t / G.T) + 1.2);
  const tl = (u) => [-0.95 * u, hp - 0.02 * u + 0.04 * u * u * tailSway, 0.18 * u * u * tailSway];
  r.noCuts = true;
  // body: one smooth, continuous curve from the tail tip to the flat head (dense spline samples)
  const tailR = (u) => 0.006 + 0.079 * Math.pow(1 - u, 1.35);
  const ctrl = [];
  for (const u of [1.0, 0.85, 0.7, 0.55, 0.4, 0.25, 0.12]) ctrl.push({ p: tl(u), r: tailR(u) });
  ctrl.push({ p: pel, r: 0.086 }, { p: [0.24, hp + 0.012 - 0.008, 0], r: 0.098 }, { p: [0.5, (hp + chestY) / 2 - 0.006, 0], r: 0.106 },
    { p: sh, r: 0.108 }, { p: neck, r: 0.094 });
  const sp = spinePoints(ctrl, 30);
  r.group = 'spine';
  r.chain(sp.map(s => s.p), sp.map(s => s.r), { k: 0.03 });
  r.group = 'head';
  // a broad, flat skull (low profile) with a rounded snout, the eyes on bumps on top, a heavy jaw
  const hup = [-hd[1], hd[0], 0];
  const H = (u, h) => add(add(neck, hd, u * 0.34), hup, h);
  const sk = [[0.0, 0.004, 0.085], [0.3, 0.008, 0.07], [0.62, 0.004, 0.052], [0.88, -0.004, 0.036], [1.0, -0.008, 0.028]];
  for (let i = 0; i < sk.length - 1; i++) r.cone(H(sk[i][0], sk[i][1]), H(sk[i + 1][0], sk[i + 1][1]), sk[i][2], sk[i + 1][2], { k: 0.02 });
  const hinge = H(0.04, -0.035), gape = -0.3 * call;
  const Jw = (p) => rotAbout(hinge, p, gape);
  r.cone(Jw(H(0.04, -0.035)), Jw(H(0.55, -0.042)), 0.06, 0.036, { k: 0.018 });
  r.cone(Jw(H(0.55, -0.042)), Jw(H(0.97, -0.03)), 0.036, 0.02, { k: 0.012 });
  r.cone(H(0.46, 0.058), H(0.52, 0.06), 0.024, 0.02, { k: 0.012 });                                     // eye bump
  r.cone(H(0.3, 0.06), H(0.46, 0.066), 0.012, 0.016, { k: 0.012 });                                     // brow ridge to the eye
  r.group = 'x';
  // tail fin: dorsal and ventral membranes (one continuous band each) on fine bony rays that reach
  // just past the edge; taller toward the tip, rounding off
  const finH = (u) => (0.014 + 0.07 * Math.min(1, Math.max(0, (u - 0.28) / 0.55))) * (1 - 0.45 * Math.max(0, (u - 0.9) / 0.14));
  for (const sg of [1, -0.72]) {
    const M = [];
    for (let i = 0; i <= 16; i++) {
      const u = 0.26 + i * (0.78 / 16), rr = tailR(Math.min(u, 1)), h = finH(u) * Math.abs(sg);
      M.push({ p: add(tl(Math.min(u, 1.04)), [0, Math.sign(sg) * (rr * 0.6 + h * 0.5), 0]), r: h * 0.5 + rr * 0.3 });
    }
    for (let i = 0; i < M.length - 1; i++) r.cone(M[i].p, M[i + 1].p, M[i].r, M[i + 1].r, { kind: 1, thick: 0.0045, k: 0.006 });
    const NR = 30;
    for (let i = 0; i < NR; i++) {
      const u = 0.27 + i * (0.76 / (NR - 1)), rr = tailR(Math.min(u, 1)), h = finH(u) * Math.abs(sg);
      const base = add(tl(u), [0, Math.sign(sg) * rr * 0.7, 0]), tip = add(tl(Math.min(1.04, u + 0.04)), [0, Math.sign(sg) * (rr * 0.6 + h * 1.06), 0]);
      r.cone(base, tip, 0.0024, 0.0008, { k: 0.001 });
    }
  }
  // a fine scale ridge along the back
  for (let i = 9; i < 25; i++) {
    const a = sp[i];
    r.cone(add(a.p, [0, a.r * 0.9, 0]), add(a.p, [-0.012, a.r + 0.009, 0]), 0.004, 0.0004, { kind: 3, k: 0.001 });
  }
  // pectoral limbs: shoulder → elbow → wrist, then a splayed hand of eight digits webbed together
  const feet = [];
  for (const side of [1, -1]) {
    const far = side < 0 ? 1 : 0;
    r.group = side > 0 ? 'LF' : 'RF';
    const hip = add(sh, [-0.02, -0.06, 0.08 * side]);
    const f = footTrack(G, t, side > 0 ? finOffs[0] : finOffs[1], sh[0] + 0.1, 0.07);
    const foot = [f.x - X, 0.012 + f.y, 0.22 * side];
    feet.push({ id: side > 0 ? 'LF' : 'RF', x: f.x, psi: f.psi, stance: f.stance, z: foot[2] });
    const { knee } = ik2(hip, foot, 0.16, 0.14, [0.2, 1, 0.6 * side]);
    r.cone(hip, knee, 0.044, 0.03, { k: 0.03, far });
    r.cone(knee, foot, 0.03, 0.02, { k: 0.02, far });
    const lift = f.stance ? 0 : f.y / 0.07;
    // eight digits fanned out from the wrist (forward, down to the mud, and back), webbed
    const dg = (i) => {
      const a = (-10 + i * 24) * Math.PI / 180, L = 0.09 * (0.72 + 0.28 * Math.sin(Math.PI * i / 7));
      return add(foot, [Math.cos(a) * L, -0.004 + Math.max(0, Math.sin(a)) * L * 0.55 + 0.012 * lift, (0.3 - 0.08 * i) * 0.04 * side]);
    };
    for (let i = 0; i < 8; i++) {
      const tip = dg(i);
      r.cone(foot, tip, 0.0055, 0.0016, { k: 0.002, far });
      if (i < 7) r.cone(foot, mixv(mixv(tip, dg(i + 1), 0.5), foot, 0.15), 0.013, 0.006, { kind: 1, thick: 0.0045, k: 0.004, far });   // web
    }
  }
  // pelvic fins: small rayed paddles, half a cycle later
  for (const side of [1, -1]) {
    const far = side < 0 ? 1 : 0;
    r.group = side > 0 ? 'LH' : 'RH';
    const base = add(pel, [0.02, -0.05, 0.06 * side]);
    const sw = Math.sin(TAU * (t / G.T + 0.5));
    for (let i = 0; i < 5; i++) {
      const tip = add(base, [-0.12 - 0.01 * i, -0.045 + 0.012 * i + 0.02 * sw, 0.06 * side]);
      r.cone(base, tip, 0.006, 0.0015, { k: 0.002, far });
      if (i < 4) r.cone(base, add(base, [-0.12 - 0.01 * i - 0.005, -0.039 + 0.012 * i + 0.02 * sw, 0.06 * side]), 0.014, 0.005, { kind: 1, thick: 0.0045, k: 0.003, far });
    }
  }
  return { rig: r, X, height: 0.34, len: 2.1, center: [0.1, 0.14], water: 0.035, G, feet };
}

// Generic quadruped / biped builder ---------------------------------------------------------
// P: { T, duty, v, offs:{LH,LF,RH,RF}, hp, shH, shX, trunkR:[pel,belly,chest], neck:{len,deg,r},
//      head:fn, tail:{len,r0,droop,wave}, hind:{l1,l2,l3,pole,sprawl,lift,foot}, fore:{…}, undulate }
function quadruped(t, P) {
  const G = { T: P.T, duty: P.duty, v: P.v, surge: P.surge || 0 };
  const r = new Rig();
  const X = bodyX(G, t);
  const cyc = t / G.T;
  // body bob: dips at double support (twice per cycle for symmetric gaits)
  const bob = (P.bob || 0) * Math.cos(TAU * 2 * (cyc + (P.bobPh || 0)));
  const roll = (P.pitchOsc || 0) * Math.sin(TAU * cyc);
  const pel = [0, P.hp + bob, 0];
  const sh = [P.shX, P.shH + bob * 0.6 + roll * P.shX, 0];
  // lateral undulation: standing wave (nodes at the girdles) → travelling with speed
  const und = (P.undulate || 0), trav = P.travel || 0;
  const lat = (u) => und * (Math.sin(Math.PI * u) * Math.cos(TAU * cyc) * (1 - trav) + Math.sin(Math.PI * 2 * u - TAU * cyc) * trav);
  // spine: tail tip → pelvis → belly → shoulder → neck → head base
  const tail = P.tail;
  const tailPt = (u) => {
    const wv = Math.sin(TAU * (cyc - u * (tail.lag || 0.3))) * (tail.wave || 0) * u * u;
    const a = (tail.deg || -8) * Math.PI / 180 - (tail.droop || 0) * u;
    return [-Math.cos(a) * tail.len * u, P.hp + bob + Math.sin(a) * tail.len * u + (tail.curl || 0) * u * u * u + (tail.vwave || 0) * wv, lat(-u * 0.5) + wv];
  };
  const nk = P.neck;
  const call = P.call || 0;
  r.noCuts = !!P.noCuts;
  const neckDir = dir2(nk.deg + (P.headNod || 0) * Math.sin(TAU * 2 * cyc + 0.6) * (1 - call) + (P.callDeg || 14) * call);
  const neckBase = add(sh, [0.02 * P.scale, P.trunkR[2] * 0.25, 0]);
  const neckTop = add(neckBase, neckDir, nk.len);
  let ctrl;
  if (tail.n) {
    // many tail control points with a concave taper (r0 → r1 as (1−u)^pow): a tail that tapers
    // along a curve instead of a straight cone
    ctrl = [];
    for (let i = tail.n; i >= 1; i--) { const u = i / tail.n; ctrl.push({ p: tailPt(u), r: tail.r1 + (tail.r0 - tail.r1) * Math.pow(1 - u, tail.pow || 1.6) }); }
  } else ctrl = [{ p: tailPt(1.0), r: tail.r1 }, { p: tailPt(0.66), r: mix(tail.r0, tail.r1, 0.6) }, { p: tailPt(0.33), r: mix(tail.r0, tail.r1, 0.25) }];
  ctrl.push({ p: add(pel, [0, 0, lat(0)]), r: P.trunkR[0] });
  if (P.trunkR.length > 3) {
    // deep-chested bodies: a fuller belly and a chest dropping below the shoulder line
    ctrl.push({ p: add(mixv(pel, sh, 0.33), [0, -(P.bellySag || 0) * 0.8, lat(0.33)]), r: P.trunkR[1] });
    ctrl.push({ p: add(mixv(pel, sh, 0.7), [0, -(P.bellySag || 0), lat(0.7)]), r: P.trunkR[2] });
    ctrl.push({ p: add(sh, [0, 0, lat(1)]), r: P.trunkR[3] });
  } else {
    ctrl.push({ p: add(mixv(pel, sh, 0.5), [0, -(P.bellySag || 0), lat(0.5)]), r: P.trunkR[1] });
    ctrl.push({ p: add(sh, [0, 0, lat(1)]), r: P.trunkR[2] });
  }
  ctrl.push({ p: neckBase, r: nk.r0 });
  if (nk.s) {
    // S-curved neck: the lower third bows forward, the upper third back, the head juts forward
    const pp = [-neckDir[1], neckDir[0], 0];
    ctrl.push({ p: add(add(neckBase, neckDir, nk.len * 0.36), pp, -nk.s), r: mix(nk.r0, nk.r1, 0.4) });
    ctrl.push({ p: add(add(neckBase, neckDir, nk.len * 0.72), pp, nk.s * 0.8), r: mix(nk.r0, nk.r1, 0.75) });
  }
  ctrl.push({ p: neckTop, r: nk.r1 });
  const sp = spinePoints(ctrl, P.spineS || 16);
  r.group = 'spine';
  r.chain(sp.map(s => s.p), sp.map(s => s.r), { k: P.bodyK || 0.02 * P.scale, kind: P.fur ? 2 : 0 });
  // limbs
  const limbs = [];
  const defs = [['LH', 'hind', 1], ['RH', 'hind', -1], ['LF', 'fore', 1], ['RF', 'fore', -1]];
  for (const [id, kindL, side] of defs) {
    const L = P[kindL];
    if (!L) continue;
    const far = side < 0 ? 1 : 0;
    const girdle = kindL === 'hind' ? pel : sh;
    const root = add(girdle, [L.rootX || 0, L.rootY || 0, (L.width || 0) * side + lat(kindL === 'hind' ? 0 : 1)]);
    const f = footTrack(G, t, P.offs[id], girdle[0] + (L.rootX || 0), L.lift, L.neutral || 0);
    const foot = [f.x - X, (L.footY || 0) + f.y, (L.width || 0) * side + (L.sprawl || 0) * side];
    limbs.push({ id, L, side, far, root, foot, f });
  }
  for (const lb of limbs) { r.group = lb.id; buildLimb(r, lb, P, t); }
  // head & extras
  r.group = 'head';
  P.head(r, { neckTop, neckDir, sh, pel, t, cyc, X, sp, bob, scale: P.scale, call });
  r.group = 'x';
  if (P.extras) P.extras(r, { sp, sh, pel, t, cyc, X, limbs, tailPt, scale: P.scale, P });
  const feet = limbs.map(lb => ({ id: lb.id, x: lb.f.x, psi: lb.f.psi, stance: lb.f.stance, z: lb.foot[2] }));
  return { rig: r, X, height: P.frameH, len: P.frameL, center: P.center, G, feet };
}

function buildLimb(r, { L, side, far, root, foot, f }, P) {
  const opt = { k: L.k ?? 0.012 * P.scale, far, kind: P.fur ? 2 : 0 };
  const pole = [L.pole[0], L.pole[1], L.pole[2] * side];
  const up = f.stance ? 0 : f.s;
  if (L.type === 'digitigrade') {
    // metatarsus/metacarpus held at an angle; it rises (heel lift) through late stance & swing
    const heel = f.stance ? sstep(0.55, 1.0, f.s) : 1 - sstep(0.6, 1.0, up);
    const ang = (L.metaDeg + heel * 25 + (f.stance ? 0 : 20 * Math.sin(Math.PI * up))) * Math.PI / 180;
    const back = L.metaBack ?? 1;
    const ankle = add(foot, [-Math.cos(ang) * L.l3 * back, Math.sin(ang) * L.l3, 0]);
    const { knee } = ik2(root, ankle, L.l1, L.l2, pole);
    r.cone(root, knee, L.r[0], L.r[1], opt);
    if (L.bow) {
      // the shank bows gently forward and the calf swells behind it: no straight trapezoids
      const sd = nrm(sub(ankle, knee)), fw = nrm([sd[1], -sd[0], 0]);
      const mid = add(mixv(knee, ankle, 0.45), fw[0] > 0 ? fw : scl(fw, -1), L.bow);
      r.cone(knee, mid, L.r[1], mix(L.r[1], L.r[2], 0.55), opt);
      r.cone(mid, ankle, mix(L.r[1], L.r[2], 0.55), L.r[2], opt);
    } else r.cone(knee, ankle, L.r[1], L.r[2], opt);
    if (L.thighMass) {
      // the drumstick: a muscular mass behind the femur, flowing into the knee
      const td = nrm(sub(knee, root));
      let bk = nrm(cross(td, [0, 0, 1])); if (bk[0] > 0) bk = scl(bk, -1);
      r.cone(add(add(root, td, L.l1 * 0.12), bk, L.thighMass[0] * 0.25), add(add(root, td, L.l1 * 0.72), bk, L.thighMass[1] * 0.35), L.thighMass[0], L.thighMass[1], { ...opt, k: (L.k ?? 0.012) * 1.6 });
    }
    if (L.calfMass) {
      const sd = nrm(sub(ankle, knee));
      let bk = nrm(cross(sd, [0, 0, 1])); if (bk[0] > 0) bk = scl(bk, -1);
      r.cone(add(add(knee, sd, L.l2 * 0.08), bk, L.calfMass[0] * 0.45), add(add(knee, sd, L.l2 * 0.55), bk, L.calfMass[1] * 0.2), L.calfMass[0], L.calfMass[1], { ...opt, k: (L.k ?? 0.012) * 1.4 });
    }
    r.cone(ankle, foot, L.r[2], L.r[3], opt);
    if (L.toes) digits(r, foot, [1, 0, 0], L.toes, L.toeLen, L.r[3] * 0.75, L.toeSpread || 40, f.stance ? 0.4 : 1, { ...opt, k: opt.k * 0.5, claw: L.claw || 0 }, L.toeLens);
    if (L.paw) r.cone(add(foot, [-L.paw * 0.3, L.paw * 0.35, 0]), add(foot, [L.paw * 0.55, L.paw * 0.15, 0]), L.paw * 0.42, L.paw * 0.3, opt);
  } else if (L.type === 'plantigrade') {
    // foot = heel → ball → toe. Stance: flat, then the heel rises about the ball (toe-off);
    // swing: toe-off pitch eases back to level (slightly toe-up at heel strike).
    const Lf = L.foot;
    let phi;
    if (f.stance) phi = sstep(0.55, 1.0, f.s) * 38;
    else phi = mix(38, -12, sstep(0.0, 0.85, f.s));
    phi *= Math.PI / 180;
    const B = foot;                                                       // the ball of the foot
    const heel = add(B, [-0.75 * Lf * Math.cos(phi), 0.75 * Lf * Math.sin(phi), 0]);
    const toe = f.stance ? add(B, [0.25 * Lf, 0, 0]) : add(B, [0.25 * Lf * Math.cos(phi), -0.25 * Lf * Math.sin(phi), 0]);
    const rot = (x, y) => [x * Math.cos(-phi) - y * Math.sin(-phi), x * Math.sin(-phi) + y * Math.cos(-phi), 0];
    const ankle = add(heel, rot(0.2 * Lf, L.l3));
    const { knee } = ik2(root, ankle, L.l1, L.l2, pole);
    r.cone(root, knee, L.r[0], L.r[1], opt);
    r.cone(knee, ankle, L.r[1], L.r[2], opt);
    const hr = L.r[2] * 0.95;
    r.cone(add(heel, [0, hr, 0]), add(B, [0, L.r[3], 0]), hr, L.r[3], opt);           // heel → ball
    r.cone(ankle, add(heel, [0.02 * Lf, hr * 1.1, 0]), L.r[2], hr, opt);
    r.cone(add(B, [0, L.r[3], 0]), add(toe, [0, L.r[3] * 0.55, 0]), L.r[3], L.r[3] * 0.55, { ...opt, k: opt.k * 0.5 });
    // muscle masses: calf behind the upper shin, quadriceps in front of the thigh
    const sd = nrm(sub(ankle, knee));
    let bk = nrm(cross(sd, [0, 0, 1])); if (bk[0] > 0) bk = scl(bk, -1);
    if (L.calf) r.cone(add(add(knee, sd, L.l2 * 0.18), bk, L.calf[0] * 0.35), add(add(knee, sd, L.l2 * 0.55), bk, L.calf[1] * 0.2), L.calf[0], L.calf[1], opt);
    const td = nrm(sub(knee, root));
    let fr = nrm(cross([0, 0, 1], td)); if (fr[0] < 0) fr = scl(fr, -1);
    if (L.thigh) r.cone(add(add(root, td, L.l1 * 0.25), fr, L.thigh[0] * 0.3), add(add(root, td, L.l1 * 0.8), fr, L.thigh[1] * 0.2), L.thigh[0], L.thigh[1], opt);
    if (L.bigToe) r.cone(add(B, [0.0, L.r[3], 0.02 * side]), add(B, [L.bigToe * 0.9, L.r[3] * 0.6, 0.05 * side]), L.r[3] * 0.8, L.r[3] * 0.5, { ...opt, k: opt.k * 0.4 });
  } else if (L.type === 'knuckle') {
    // chimp forelimb: weight on the backs of the middle phalanges; wrist straight above
    const wrist = add(foot, [-0.02 * P.scale, L.l3, 0]);
    const { knee } = ik2(root, wrist, L.l1, L.l2, pole);
    r.cone(root, knee, L.r[0], L.r[1], opt);
    r.cone(knee, wrist, L.r[1], L.r[2], opt);
    r.cone(wrist, add(foot, [0.03 * P.scale, L.r[3], 0]), L.r[2], L.r[3], opt);
    // curled fingers: knuckle pad forward, finger backs folded under
    for (let i = 0; i < 4; i++) {
      const z = (i - 1.5) * L.r[3] * 0.55;
      const k1 = add(foot, [0.045 * P.scale, L.r[3] * 0.9, z]);
      r.cone(k1, add(k1, [0.02 * P.scale, -L.r[3] * 0.6, 0]), L.r[3] * 0.5, L.r[3] * 0.4, { ...opt, k: opt.k * 0.4 });
    }
    r.cone(add(wrist, [0.01 * P.scale, -L.l3 * 0.3, 0.02 * P.scale]), add(foot, [0.05 * P.scale, L.r[3] * 1.6, 0.03 * P.scale]), L.r[3] * 0.45, L.r[3] * 0.35, opt);
  } else {
    // sprawling limb: upper limb out sideways, lower limb down to the foot, splayed digits
    const { knee } = ik2(root, add(foot, [0, L.l3 || 0, 0]), L.l1, L.l2, pole);
    r.cone(root, knee, L.r[0], L.r[1], opt);
    r.cone(knee, add(foot, [0, L.l3 || 0, 0]), L.r[1], L.r[2], opt);
    if (L.l3) r.cone(add(foot, [0, L.l3, 0]), foot, L.r[2], L.r[3], opt);
    if (L.toes) digits(r, foot, nrm([1, 0, 0.5 * side]), L.toes, L.toeLen, L.r[3] * 0.7, L.toeSpread || 120, f.stance ? 0.35 : 0.9, { ...opt, k: opt.k * 0.4, fanUp: L.fanUp || 0 }, L.toeLens);
  }
}

// head builders -----------------------------------------------------------------------------
function salamanderHead(r, { neckTop, neckDir, call = 0 }) {
  // broad, flat, rounded skull; eyes on bumps on top; a wide jaw (the throat pumps on the croak)
  if (call > 0.01) {
    const sac = add(neckTop, [-0.004, -0.009 - 0.004 * call, 0.003]);
    r.cone(add(sac, [-0.003, 0.002, 0]), add(sac, [0.006, 0.0, 0]), 0.0045 * call, 0.0065 * call, { kind: 6, thick: 0.009, k: 0.003 });
  }
  const d = nrm(add(neckDir, [0, -0.12, 0]));
  const up = [-d[1], d[0], 0];
  const H = (u, h) => add(add(neckTop, d, u * 0.022), up, h);
  r.cone(H(0, 0.0005), H(0.55, 0.0008), 0.0088, 0.0072, { k: 0.002 });
  r.cone(H(0.55, 0.0008), H(1.0, -0.0006), 0.0072, 0.0046, { k: 0.0015 });
  r.cone(H(1.0, -0.0006), H(1.1, -0.0012), 0.0046, 0.0034, { k: 0.001 });                    // rounded snout
  const hinge = H(0.05, -0.003);
  r.cone(hinge, rotAbout(hinge, H(1.0, -0.0035), -0.25 * call), 0.0068, 0.0036, { k: 0.0015 });
  r.cone(H(0.42, 0.0072), H(0.5, 0.0074), 0.0028, 0.0024, { k: 0.0012 });                    // eye bump
}
function lizardHead(r, { neckTop, neckDir, cyc, call = 0 }) {
  const s = 1;
  const d = nrm(add(neckDir, [0, -0.25, 0]));
  const tip = add(neckTop, d, 0.05 * s);
  r.cone(neckTop, tip, 0.0125 * s, 0.0035 * s, { k: 0.004 * s });
  r.cone(add(neckTop, [-0.004 * s, -0.006 * s, 0]), rotAbout(add(neckTop, [-0.004 * s, -0.006 * s, 0]), add(tip, [-0.006 * s, -0.004 * s, 0]), -0.55 * call), 0.009 * s, 0.002 * s, { k: 0.003 * s });
  // jowl / dewlap
  r.cone(add(neckTop, [-0.008 * s, -0.008 * s, 0]), add(neckTop, [0.012 * s, -0.016 * s, 0]), 0.004 * s, 0.002 * s, { kind: 6, thick: 0.0015 * s, k: 0.004 * s });
  const eye = add(add(neckTop, d, 0.022 * s), [0, 0.0065 * s, 0]);
  r.cone(add(add(neckTop, d, 0.012 * s), [0, -0.0035 * s, 0.02 * s]), add(tip, [-0.002 * s, -0.002 * s, 0.02 * s]), 0.0004 * s, 0.0003 * s, { kind: 5 });
  // tongue flick, every other cycle (a life cue in 1.4 s)
  const fl = Math.max(0, Math.sin(TAU * (cyc * 0.5) + 1.0));
  if (fl > 0.6) {
    const e = (fl - 0.6) / 0.4;
    const t0 = add(tip, [-0.002 * s, -0.001 * s, 0]), t1 = add(t0, d, 0.02 * s * e);
    r.cone(t0, t1, 0.0008 * s, 0.0005 * s, { kind: 6, thick: 0.0005 * s });
    r.cone(t1, add(t1, [0.004 * s * e, 0.002 * s * e, 0]), 0.0004 * s, 0.0002 * s, { kind: 6, thick: 0.0003 * s });
    r.cone(t1, add(t1, [0.004 * s * e, -0.002 * s * e, 0]), 0.0004 * s, 0.0002 * s, { kind: 6, thick: 0.0003 * s });
  }
}

// ---------------------------------------------------------------------------------------
// the seven stages
export const STAGES = ['tiktaalik', 'salamander', 'lizard', 'theropod', 'mammal', 'ape', 'human'];
export const STAGE_LABEL = { tiktaalik: 'Tiktaalik-like tetrapod', salamander: 'amphibian', lizard: 'reptile', theropod: 'theropod', mammal: 'small mammal', ape: 'ape (knuckle-walking)', human: 'early human' };

const DEFS = {
  // 2 · salamander, 0.2 m: lateral-sequence walk, duty 0.69, standing-wave trunk bending
  salamander: {
    scale: 0.1, T: 0.7, duty: 0.69, v: 0.09, offs: { RH: 0, RF: 0.22, LH: 0.5, LF: 0.72 },
    hp: 0.0115, shH: 0.012, shX: 0.052, trunkR: [0.0068, 0.0088, 0.0078], bellySag: 0.0015, undulate: 0.012, travel: 0.1,
    neck: { len: 0.009, deg: 2, r0: 0.0075, r1: 0.0085 },
    tail: { len: 0.115, r0: 0.0068, r1: 0.0008, deg: -4, droop: 0.05, wave: 0.01, lag: 0.25, vwave: 0.15 },
    hind: { type: 'sprawl', l1: 0.012, l2: 0.011, width: 0.006, sprawl: 0.014, lift: 0.006, pole: [0, 1, 0.8], r: [0.0036, 0.0028, 0.0022, 0.0017], toes: 5, toeLen: 0.0066, toeSpread: 150, toeLens: [0.6, 0.9, 1.1, 1.0, 0.7], fanUp: 0.8 },
    fore: { type: 'sprawl', l1: 0.0095, l2: 0.0095, width: 0.006, sprawl: 0.013, lift: 0.006, pole: [-0.2, 1, 0.8], r: [0.003, 0.0024, 0.0019, 0.0015], toes: 4, toeLen: 0.0052, toeSpread: 140, toeLens: [0.7, 1, 1, 0.75], fanUp: 0.8 },
    head: salamanderHead, frameH: 0.035, frameL: 0.2, center: [0.0, 0.016], noCuts: 1, spineS: 30,
    extras(r, { tailPt, sp }) {
      // a low newt crest along the tail (dorsal and ventral bands) on fine rays, taller toward the tip
      const h = (u) => 0.0012 + 0.0042 * Math.min(1, Math.max(0, (u - 0.12) / 0.6)) * (1 - 0.5 * Math.max(0, (u - 0.85) / 0.15));
      const rad = (u) => 0.0068 * Math.pow(1 - u, 1.1) + 0.0008;
      for (const sg of [1, -0.6]) {
        const M = [];
        for (let i = 0; i <= 18; i++) { const u = 0.1 + i * 0.9 / 18, hh = h(u) * Math.abs(sg); M.push({ p: add(tailPt(u), [0, Math.sign(sg) * (rad(u) * 0.55 + hh * 0.5), 0]), r: hh * 0.5 + rad(u) * 0.25 }); }
        for (let i = 0; i < M.length - 1; i++) r.cone(M[i].p, M[i + 1].p, M[i].r, M[i + 1].r, { kind: 1, thick: 0.0045, k: 0.0006 });
        const N = 34;
        for (let i = 0; i < N; i++) {
          const u = 0.11 + i * 0.88 / (N - 1), hh = h(u) * Math.abs(sg);
          r.cone(add(tailPt(u), [0, Math.sign(sg) * rad(u) * 0.6, 0]), add(tailPt(Math.min(1, u + 0.03)), [0, Math.sign(sg) * (rad(u) * 0.55 + hh * 1.08), 0]), 0.00026, 0.0001, { k: 0.0001 });
        }
      }
      // subtle costal grooves read as a gently undulating back line
      for (let i = 12; i < 22; i++) { const a = sp[i]; r.cone(add(a.p, [0, a.r * 0.75, 0]), add(a.p, [0.0015, a.r * 0.95, 0]), a.r * 0.28, a.r * 0.2, { k: 0.0008 }); }
    },
  },
  // 3 · lizard, 0.45 m: walking trot (diagonal pairs), duty 0.6, belly clear of the ground, crest
  lizard: {
    scale: 0.2, T: 0.47, duty: 0.6, v: 0.34, offs: { LH: 0, RF: 0, RH: 0.5, LF: 0.5 },
    hp: 0.036, shH: 0.038, shX: 0.088, trunkR: [0.012, 0.0165, 0.015], bellySag: 0.002, undulate: 0.016, travel: 0.6, bob: 0.0015,
    neck: { len: 0.022, deg: 12, r0: 0.0125, r1: 0.011 },
    tail: { len: 0.3, r0: 0.0115, r1: 0.0008, deg: -9, droop: -0.12, curl: 0.004, wave: 0.03, lag: 0.3 },
    hind: { type: 'sprawl', l1: 0.03, l2: 0.03, l3: 0.006, width: 0.009, sprawl: 0.03, lift: 0.014, pole: [0.3, 1, 0.7], r: [0.0068, 0.0045, 0.0032, 0.0024], toes: 5, toeLen: 0.017, toeSpread: 120, toeLens: [0.45, 0.7, 0.9, 1.15, 0.6], fanUp: 0.6 },
    fore: { type: 'sprawl', l1: 0.022, l2: 0.023, l3: 0.004, width: 0.008, sprawl: 0.024, lift: 0.012, pole: [-0.3, 1, 0.7], r: [0.0052, 0.0036, 0.0026, 0.002], toes: 5, toeLen: 0.009, toeSpread: 120, toeLens: [0.5, 0.8, 1, 0.9, 0.6], fanUp: 0.6 },
    head: lizardHead,
    extras(r, { sp }) {
      // a fine scale fringe along the back and the tail base: many small, low, backward-leaning scales
      for (let i = 2; i < sp.length - 3; i++) for (let j = 0; j < 4; j++) {
        const f = j / 4, p = mixv(sp[i].p, sp[i + 1].p, f), rr = mix(sp[i].r, sp[i + 1].r, f);
        const h = rr * (0.18 + 0.07 * Math.sin(i * 2.3 + j * 1.7));
        r.cone(add(p, [0, rr * 0.9, 0]), add(p, [-rr * 0.4, rr + h, 0]), rr * 0.1, 0.00012, { kind: 3, k: 0.0003 });
      }
    },
    frameH: 0.075, frameL: 0.45, center: [-0.04, 0.035],
  },
  // 4 · theropod (Coelophysis-like, 3 m, hip 1 m): biped walk, duty 0.6, Fr ≈ 0.3, horizontal
  // back see-sawing on the hips; drawn with smooth spline outlines: an S-curved neck, a deep chest,
  // a drumstick thigh flowing into a bowed shank, three clawed toes, small clawed hands, a tail that
  // tapers along a gentle curve, a serrated jaw line and a fine feathery fringe down the back
  theropod: {
    scale: 2.5, T: 0.93, duty: 0.6, v: 1.7, offs: { LH: 0, RH: 0.5 }, noCuts: 1, spineS: 36,
    hp: 1.0, shH: 0.97, shX: 0.62, trunkR: [0.18, 0.235, 0.26, 0.17], bellySag: 0.1, bob: 0.03, bobPh: 0.3, pitchOsc: 0.015, bodyK: 0.06,
    neck: { len: 0.56, deg: 60, r0: 0.125, r1: 0.068, s: 0.055 }, headNod: 3,
    tail: { len: 1.66, r0: 0.19, r1: 0.006, deg: 9, droop: 0.36, curl: 0.13, wave: 0.1, lag: 0.3, n: 8, pow: 1.45 },
    hind: { type: 'digitigrade', l1: 0.42, l2: 0.46, l3: 0.30, metaDeg: 62, width: 0.1, sprawl: 0.0, lift: 0.16, pole: [1, 0, 0.1], rootY: -0.02,
      r: [0.15, 0.078, 0.042, 0.032], toes: 3, toeLen: 0.16, toeSpread: 50, toeLens: [0.8, 1.1, 0.85], k: 0.055,
      thighMass: [0.19, 0.115], calfMass: [0.075, 0.038], bow: 0.028, claw: 0.055 },
    head(r, { neckTop, cyc, call = 0 }) {
      const d = nrm(rotZ([1, -0.16 + 0.03 * Math.sin(TAU * 2 * cyc) * (1 - call), 0], 0.2 * call));
      const up = [-d[1], d[0], 0];
      const Ls = 0.34;
      const Pt = (u, h) => add(add(neckTop, d, u * Ls - 0.02), up, h);
      // skull: (u along the skull, centre height, radius): deep behind the eye, a long tapering snout
      const prof = [[0.0, 0.018, 0.068], [0.2, 0.03, 0.064], [0.42, 0.024, 0.05], [0.66, 0.012, 0.037], [0.88, 0.002, 0.027], [1.0, -0.002, 0.021]];
      const ph = (u) => { for (let i = 0; i < prof.length - 1; i++) if (u <= prof[i + 1][0]) { const f = (u - prof[i][0]) / (prof[i + 1][0] - prof[i][0]); return [mix(prof[i][1], prof[i + 1][1], f), mix(prof[i][2], prof[i + 1][2], f)]; } return [prof[5][1], prof[5][2]]; };
      for (let i = 0; i < prof.length - 1; i++) r.cone(Pt(prof[i][0], prof[i][1]), Pt(prof[i + 1][0], prof[i + 1][1]), prof[i][2], prof[i + 1][2], { k: 0.012 });
      r.cone(Pt(0.985, 0.0), Pt(1.03, -0.006), 0.021, 0.016, { k: 0.008 });                                  // rounded snout tip
      r.cone(Pt(0.26, 0.078), Pt(0.36, 0.08), 0.02, 0.016, { k: 0.01 });                                     // brow over the eye
      r.cone(Pt(0.72, 0.043), Pt(0.8, 0.04), 0.009, 0.006, { k: 0.008 });                                     // nasal ridge
      // lower jaw: hinged at the back; closed, a thin gap runs along the jaw line and the teeth cross it
      const gap = 0.008, hinge = Pt(0.05, -0.06), jaw = [];
      for (const u of [0.05, 0.3, 0.6, 0.97]) {
        const [hc, rc] = ph(u), rj = mix(0.04, 0.015, (u - 0.05) / 0.92);
        const top = u < 0.2 ? hc - rc + 0.012 : hc - rc - gap;
        jaw.push({ p: Pt(u, top - rj), r: rj });
      }
      const open = -0.62 * call;
      const J = (p) => rotAbout(hinge, p, open);
      for (let i = 0; i < jaw.length - 1; i++) r.cone(J(jaw[i].p), J(jaw[i + 1].p), jaw[i].r, jaw[i + 1].r, { k: 0.006 });
      r.cone(J(add(jaw[0].p, up, -0.012)), J(add(jaw[1].p, up, -0.02)), 0.034, 0.024, { k: 0.01 });          // throat
      // teeth: a serrated edge along both jaws (curved, pointing back a little)
      for (let i = 0; i < 12; i++) {
        const u = 0.3 + i * 0.058, [hc, rc] = ph(u);
        const base = Pt(u, hc - rc + 0.004), tip = add(add(base, up, -0.017 - 0.004 * ((i * 7) % 3)), d, -0.004);
        r.cone(base, tip, 0.0048, 0.0006, { k: 0 });
      }
      for (let i = 0; i < 10; i++) {
        const u = 0.34 + i * 0.062;
        const f = (u - 0.05) / 0.92, rj = mix(0.04, 0.015, f);
        const [hc, rc] = ph(u), top = hc - rc - gap;
        const base = J(Pt(u, top - 0.003)), tip = J(add(add(Pt(u, top - 0.003), up, 0.013), d, -0.003));
        r.cone(base, tip, 0.004, 0.0006, { k: 0 });
      }
    },
    extras(r, { sh, pel, cyc, sp }) {
      // deep chest: the ribcage drops below the shoulder line, the belly lifts toward the pelvis
      r.cone(add(sh, [0.03, -0.12, 0]), add(sh, [-0.22, -0.13, 0]), 0.14, 0.15, { k: 0.09 });
      // small held arms with three clawed fingers, hardly swinging
      for (const side of [1, -1]) {
        const far = side < 0 ? 1 : 0;
        r.group = side > 0 ? 'LF' : 'RF';
        const s0 = add(sh, [0.03, -0.1, 0.1 * side]);
        const sw = 0.1 * Math.sin(TAU * (cyc + (side > 0 ? 0 : 0.5)));
        const el = add(s0, rotZ([0.0, -0.17, 0], sw));
        const wr = add(el, rotZ([0.14, -0.02, 0], sw * 0.5));
        r.cone(s0, el, 0.042, 0.026, { k: 0.025, far });
        r.cone(add(s0, [0.0, -0.03, 0]), mixv(s0, el, 0.6), 0.046, 0.03, { k: 0.03, far });                      // upper-arm muscle
        r.cone(el, wr, 0.026, 0.016, { k: 0.012, far });
        digits(r, wr, [0.6, -0.3, 0], 3, 0.07, 0.01, 44, 1.3, { k: 0.004, far, claw: 0.03 }, [0.75, 1, 0.9]);
      }
      r.group = 'x';
      // a fine fringe of filaments down the back and the upper tail (early theropods carried
      // protofeathers): short, dark, backswept strands along the dorsal line
      const n = sp.length;
      for (let i = Math.round(n * 0.3); i < n - 4; i++) for (let j = 0; j < 2; j++) {
        const f = j / 2, a = sp[i], b = sp[i + 1];
        const p = mixv(a.p, b.p, f), rr = mix(a.r, b.r, f);
        const tg = nrm(sub(b.p, a.p)), up = [-tg[1], tg[0], 0];
        const ln = (0.05 + 0.03 * Math.abs(Math.sin(i * 2.1 + j * 1.3))) * (i > n * 0.8 ? 0.7 : 1);
        const base = add(p, up, rr * 0.95), tip = add(add(base, up, ln * 0.75), tg, -ln * 0.66);
        r.cone(base, tip, 0.006, 0.0007, { k: 0 });
      }
    },
    frameH: 1.75, frameL: 3.1, center: [-0.1, 0.85],
  },
  // 5 · fox-sized mammal (head-body 0.6 m, shoulder 0.38 m): lateral-sequence walk, duty 0.65,
  // legs as columns under the body, pointed backlit ears, bushy tail, whiskers, fur fringe
  mammal: {
    scale: 0.75, T: 0.56, duty: 0.65, v: 1.2, offs: { LH: 0, LF: 0.25, RH: 0.5, RF: 0.75 }, fur: 1,
    hp: 0.35, shH: 0.36, shX: 0.36, trunkR: [0.058, 0.064, 0.074], bellySag: 0.015, bob: 0.008, headNod: 4,
    neck: { len: 0.15, deg: 38, r0: 0.06, r1: 0.045 },
    tail: { len: 0.42, r0: 0.03, r1: 0.022, deg: -20, droop: 0.35, curl: 0.03, wave: 0.03, lag: 0.35, vwave: 0.4 },
    hind: { type: 'digitigrade', l1: 0.16, l2: 0.17, l3: 0.105, metaDeg: 70, width: 0.045, lift: 0.07, pole: [1, 0, 0], rootY: -0.01, r: [0.05, 0.028, 0.017, 0.014], paw: 0.04 },
    fore: { type: 'digitigrade', l1: 0.14, l2: 0.15, l3: 0.05, metaDeg: 76, metaBack: 0.35, width: 0.045, lift: 0.08, pole: [-1, 0, 0], rootX: 0.01, rootY: -0.04, r: [0.042, 0.024, 0.016, 0.013], paw: 0.035, neutral: 0.02 },
    head(r, { neckTop, neckDir, cyc, call = 0 }) {
      const d = nrm(rotZ([1, -0.35, 0], 0.35 * call));
      const cr = add(neckTop, [0.02, 0.012, 0]);
      const tip = add(cr, d, 0.14);
      r.cone(add(cr, [-0.02, 0.005, 0]), add(cr, [0.03, -0.002, 0]), 0.05, 0.046, { k: 0.02, kind: 2 });
      r.cone(add(cr, [0.02, -0.005, 0]), tip, 0.04, 0.011, { k: 0.02, kind: 2 });
      r.cone(add(cr, [0.02, -0.03, 0]), rotAbout(add(cr, [0.02, -0.03, 0]), add(tip, [-0.03, -0.012, 0]), -0.4 * call), 0.022, 0.008, { k: 0.01 });
      r.cone(tip, add(tip, [0.004, -0.002, 0]), 0.011, 0.01, { k: 0.004 });                      // nose
      const eye = add(add(cr, d, 0.045), [0, 0.022, 0]);
      // ears: tall, thin, pointed, glowing when backlit; a small flick now and then
      const flick = Math.max(0, Math.sin(TAU * cyc * 0.5 + 2.0)) ** 8 * 0.35;
      for (const [dz, far] of [[0.03, 0], [-0.03, 1]]) {
        const b = add(cr, [-0.022 + (far ? 0.012 : 0), 0.04, dz]);
        const tp = add(b, rotZ([0.012, 0.085, 0], 0.18 - flick * (far ? 0.5 : 1)));
        r.cone(b, tp, 0.022, 0.003, { kind: 6, thick: 0.0045, k: 0.01, far });
      }
      // whiskers: fine backlit lines
      for (let i = 0; i < 4; i++) {
        const w0 = add(tip, [-0.03, -0.01 + i * 0.004, 0.02]);
        r.cone(w0, add(w0, rotZ([0.1, 0, 0], -0.25 + i * 0.15)), 0.0009, 0.0003, { kind: 6, thick: 0.0005 });
      }
    },
    extras(r, { tailPt }) {
      // bushy tail: fur volume around the tail spine
      for (let i = 0; i < 6; i++) {
        const u0 = 0.15 + i * 0.14, u1 = u0 + 0.16;
        r.cone(tailPt(u0), tailPt(Math.min(1.02, u1)), 0.035 + 0.02 * Math.sin(Math.PI * u0), 0.035 + 0.02 * Math.sin(Math.PI * Math.min(1, u1)) - (i === 5 ? 0.03 : 0), { k: 0.03, kind: 2 });
      }
    },
    frameH: 0.62, frameL: 1.05, center: [0.02, 0.3],
  },
  // 6 · chimpanzee (hind ≈ 0.5 m): knuckle-walking, diagonal-sequence (limb phase 0.6), duty 0.65,
  // shoulders above hips, bent knees, protruding muzzle, big ears, hair fringe, no tail
  ape: {
    scale: 1, T: 0.7, duty: 0.65, v: 1.05, offs: { LH: 0, RF: 0.1, RH: 0.5, LF: 0.6 }, fur: 1, surge: 0.08,
    hp: 0.5, shH: 0.74, shX: 0.36, trunkR: [0.11, 0.14, 0.15], bellySag: 0.02, bob: 0.012, pitchOsc: 0.01, headNod: 3,
    neck: { len: 0.08, deg: 25, r0: 0.085, r1: 0.07 },
    tail: { len: 0.06, r0: 0.08, r1: 0.05, deg: -60 },
    hind: { type: 'plantigrade', l1: 0.28, l2: 0.26, l3: 0.06, foot: 0.19, width: 0.09, lift: 0.07, pole: [1, 0.1, 0.5], rootY: -0.04, r: [0.08, 0.052, 0.036, 0.034], calf: [0.05, 0.035], thigh: [0.075, 0.055], bigToe: 0.07, neutral: -0.02, k: 0.03 },
    fore: { type: 'knuckle', l1: 0.3, l2: 0.29, l3: 0.1, width: 0.12, lift: 0.08, pole: [-1, 0, 0.4], rootY: -0.05, r: [0.06, 0.045, 0.032, 0.03], neutral: 0.06 },
    head(r, { neckTop, call = 0 }) {
      const c = add(neckTop, [0.05, 0.035 + 0.02 * call, 0]);
      r.cone(add(c, [-0.03, 0.01, 0]), add(c, [0.03, 0.005, 0]), 0.085, 0.078, { k: 0.02, kind: 2 });            // cranium
      r.cone(add(c, [0.07, 0.03, 0]), add(c, [0.095, 0.026, 0]), 0.03, 0.028, { k: 0.02 });                       // brow ridge
      r.cone(add(c, [0.07, -0.015, 0]), add(c, [0.14, -0.05, 0]), 0.055, 0.042, { k: 0.03 });                     // prognathic muzzle
      r.cone(add(c, [0.06, -0.07, 0]), rotAbout(add(c, [0.06, -0.07, 0]), add(c, [0.13 + 0.02 * call, -0.078, 0]), -0.25 * call), 0.03, 0.026, { k: 0.02 });  // lower lip / jaw
      r.cone(add(c, [0.14, -0.04, 0]), add(c, [0.155 + 0.035 * call, -0.058 - 0.012 * call, 0]), 0.022, 0.02 + 0.006 * call, { k: 0.015 });                   // upper lip (pouts)
      for (const [dz, far] of [[0.075, 0], [-0.075, 1]]) {                                                        // big round ears
        const e = add(c, [-0.01, 0.0, dz]);
        r.cone(e, add(e, [-0.02, 0.025, 0.01 * Math.sign(dz)]), 0.036, 0.03, { kind: 6, thick: 0.0045, k: 0.004, far });
      }
    },
    frameH: 0.95, frameL: 1.05, center: [0.1, 0.45],
  },
  // 7 · early human (Homo erectus, 1.72 m): walk T 1.1 s, duty 0.6 (20 % double support), COM bob
  // ~4 cm twice per stride, heel-toe roll, free arm swinging opposite its leg, torch held high
  human: {
    scale: 1, T: 1.1, duty: 0.6, v: 1.27, offs: { LH: 0, RH: 0.5 }, torch: 1,
    hp: 0.915, shH: 1.42, shX: 0.035, trunkR: [0.105, 0.098, 0.118], bellySag: 0, bob: 0.02, bobPh: 0.15, headNod: 1.0,
    neck: { len: 0.1, deg: 78, r0: 0.056, r1: 0.05 }, spineN: 12, bodyK: 0.05,
    tail: { len: 0.01, r0: 0.1, r1: 0.09, deg: -90 },
    hind: { type: 'plantigrade', l1: 0.44, l2: 0.42, l3: 0.075, foot: 0.25, width: 0.085, lift: 0.1, pole: [1, 0, 0], rootY: -0.035,
      r: [0.078, 0.047, 0.032, 0.026], calf: [0.052, 0.036], thigh: [0.07, 0.052], bigToe: 0.05, k: 0.03 },
    head(r, { neckTop }) {
      // Homo erectus: long, low vault; heavy brow torus; projecting mid-face; no chin
      const c = add(neckTop, [0.015, 0.085, 0]);
      r.cone(add(c, [-0.045, 0.0, 0]), add(c, [0.035, 0.008, 0]), 0.078, 0.074, { k: 0.02 });                     // vault
      r.cone(add(c, [0.07, 0.022, 0]), add(c, [0.095, 0.014, 0]), 0.022, 0.02, { k: 0.02 });                      // brow torus
      r.cone(add(c, [0.06, -0.025, 0]), add(c, [0.09, -0.06, 0]), 0.045, 0.033, { k: 0.025 });                    // mid-face
      r.cone(add(c, [0.095, -0.012, 0]), add(c, [0.118, -0.05, 0]), 0.011, 0.013, { k: 0.012 });                  // nose
      r.cone(add(c, [0.093, -0.072, 0]), add(c, [0.1, -0.08, 0]), 0.012, 0.011, { k: 0.01 });                     // lips
      r.cone(add(c, [0.02, -0.075, 0]), add(c, [0.075, -0.095, 0]), 0.032, 0.022, { k: 0.02 });                   // chinless jaw
      r.cone(add(c, [-0.005, -0.02, 0.07]), add(c, [-0.01, -0.045, 0.07]), 0.016, 0.012, { kind: 6, thick: 0.003, k: 0.006 }); // ear
      r.cone(add(c, [-0.07, 0.01, 0]), add(c, [0.03, 0.045, 0]), 0.07, 0.062, { k: 0.025, kind: 2 });             // hair
    },
    extras(r, { sh, pel, cyc, P }) {
      // torso masses: buttocks, lower back curve, rib cage, shoulder (deltoid)
      r.cone(add(pel, [-0.035, -0.01, 0]), add(pel, [-0.045, -0.07, 0]), 0.1, 0.09, { k: 0.05 });
      r.cone(add(pel, [0.02, 0.12, 0]), add(pel, [0.035, 0.26, 0]), 0.1, 0.112, { k: 0.06 });
      r.cone(add(sh, [0.02, -0.26, 0]), add(sh, [0.02, -0.1, 0]), 0.122, 0.12, { k: 0.06 });
      r.cone(add(sh, [0.0, -0.02, 0.15]), add(sh, [0.02, -0.1, 0.17]), 0.056, 0.05, { k: 0.04 });
      // near (left) arm carries the unlit torch low and forward; P.raise lifts it to the sky
      // (shoulder and elbow angles interpolate, so the arm keeps its length). Far (right) arm swings
      // opposite its leg, relaxing to hang when the walker stops (P.armRelax).
      const S = add(sh, [0.0, -0.035, 0.17]), Sf = add(sh, [0.0, -0.035, -0.17]);
      const rz = P.raise || 0, re = rz * rz * (3 - 2 * rz);
      r.group = 'LF';
      const lift = 0.01 * Math.sin(TAU * 2 * cyc) * (1 - re);
      const a1 = (-80 + 90 * re) * Math.PI / 180, a2 = (-15 + 55 * re) * Math.PI / 180, at = (35 + 35 * re) * Math.PI / 180;
      const el = add(S, [0.28 * Math.cos(a1), 0.28 * Math.sin(a1) + lift, 0.03]);
      const hand = add(el, [0.26 * Math.cos(a2), 0.26 * Math.sin(a2), 0.0]);
      r.cone(S, el, 0.047, 0.036, { k: 0.02 });
      r.cone(add(S, [0.0, -0.03, 0]), mixv(S, el, 0.55), 0.05, 0.04, { k: 0.03 });                                  // biceps/deltoid mass
      r.cone(el, hand, 0.037, 0.027, { k: 0.02 });
      r.cone(mixv(el, hand, 0.12), mixv(el, hand, 0.5), 0.04, 0.032, { k: 0.02 });                                 // forearm muscle
      const td = [Math.cos(at), Math.sin(at), 0];
      r.cone(add(hand, td, -0.03), add(hand, td, 0.03), 0.036, 0.03, { k: 0.012 });                                // fist
      r.cone(add(hand, [0.0, 0.012, 0.01]), add(add(hand, td, 0.03), [0.0, 0.03, 0.01]), 0.014, 0.012, { k: 0.006 }); // thumb over the shaft
      // torch: a stout branch, a bundle of dry grass bound at its head
      r.group = 'torch';
      const t0 = add(hand, td, -0.2), t1 = add(hand, td, 0.42);
      r.cone(t0, t1, 0.017, 0.024, { kind: 4, k: 0.0 });
      r.cone(add(t1, td, -0.07), add(t1, td, 0.02), 0.038, 0.034, { kind: 4, k: 0.012 });
      r.cone(add(t1, [-0.03, -0.01, 0]), add(t1, [-0.05, 0.03, 0]), 0.01, 0.004, { kind: 4, k: 0.004 });          // frayed twigs
      r.cone(add(t1, [0.02, 0.0, 0]), add(t1, [0.045, 0.035, 0]), 0.009, 0.003, { kind: 4, k: 0.004 });
      r.flame = add(add(t1, td, 0.05), [0.0, 0.03, 0.02]);
      r.group = 'RF';
      const sw = 0.36 * Math.sin(TAU * cyc) * (1 - (P.armRelax || 0));
      const elf = add(Sf, rotZ([0, -0.3, 0], sw));
      const hf = add(elf, rotZ([0, -0.25, 0], sw * 1.35 + 0.22));
      r.cone(Sf, elf, 0.046, 0.035, { k: 0.02, far: 1 });
      r.cone(elf, hf, 0.035, 0.026, { k: 0.015, far: 1 });
      r.cone(hf, add(hf, rotZ([0.01, -0.09, 0], sw + 0.3)), 0.028, 0.02, { k: 0.01, far: 1 });                     // hand
      digits(r, add(hf, rotZ([0.0, -0.08, 0], sw + 0.3)), nrm(rotZ([0.2, -1, 0], sw + 0.2)), 4, 0.07, 0.009, 24, 0.5, { k: 0.004, far: 1 });
    },
    frameH: 2.05, frameL: 1.7, center: [0.12, 1.0],
  },
};

/** Pose any stage at time t (seconds, local to the stage). Returns { prims, meta }. */
export function poseCreature(key, t, ov = {}) {
  let out;
  if (key === 'tiktaalik') out = tiktaalik(t, ov);
  else out = quadruped(t, { ...DEFS[key], ...ov, offs: { ...DEFS[key].offs, ...(ov.offs || {}) } });
  const def = DEFS[key];
  let flame = null;
  if (key === 'human') flame = out.rig.flame;
  return { prims: out.rig.p, X: out.X, height: out.height, len: out.len, center: out.center, water: out.water || 0, flame, G: out.G, key, label: STAGE_LABEL[key], feet: out.feet || [] };
}

/**
 * Geometric morph between two posed creatures placed in the world ({pose, k, world}): matching slots
 * interpolate endpoints, radii and blend; unmatched parts shrink away (A) or grow in (B).
 * Returns a creature record in the same form, with prims in "real" units for k = mix(kA, kB).
 */
export function morphCreatures(A, B, w) {
  const km = A.k + (B.k - A.k) * w;
  const W = (C, v) => [v[0] * C.k + C.world[0], v[1] * C.k + C.world[1], v[2] * C.k + C.world[2]];
  const toR = (v) => [v[0] / km, v[1] / km, v[2] / km];
  const mapB = new Map(B.pose.prims.map(p => [p.slot, p]));
  const spA = A.pose.prims.filter(p => p.slot.startsWith('spine:')), spB = B.pose.prims.filter(p => p.slot.startsWith('spine:'));
  if (spA.length && spB.length && spA.length !== spB.length) {
    spA.forEach((p, j) => mapB.set(p.slot, spB[Math.round(j * (spB.length - 1) / Math.max(1, spA.length - 1))]));
  }
  const used = new Set(), out = [];
  const e = w * w * (3 - 2 * w);
  for (const pa of A.pose.prims) {
    const pb = mapB.get(pa.slot);
    const a0 = W(A, pa.a), b0 = W(A, pa.b);
    if (pb) {
      used.add(pb.slot);
      const a1 = W(B, pb.a), b1 = W(B, pb.b);
      out.push({ a: toR(mixv(a0, a1, e)), b: toR(mixv(b0, b1, e)), ra: mix(pa.ra * A.k, pb.ra * B.k, e) / km, rb: mix(pa.rb * A.k, pb.rb * B.k, e) / km,
        k: mix(pa.k * A.k, pb.k * B.k, e) / km, kind: e < 0.5 ? pa.kind : pb.kind, thick: mix(pa.thick, pb.thick, e), far: pa.far, slot: pa.slot,
        fur: mix(pa.kind === 2 ? 1 : 0, pb.kind === 2 ? 1 : 0, e) });
    } else {
      const f = Math.pow(1 - sstep(0.0, 0.6, w), 1.5);                  // outgoing-only parts leave early
      out.push({ a: toR(a0), b: toR(b0), ra: pa.ra * A.k * f / km, rb: pa.rb * A.k * f / km, k: pa.k * A.k * f / km, kind: pa.kind, thick: pa.thick, far: pa.far, slot: pa.slot });
    }
  }
  for (const pb of B.pose.prims) {
    if (used.has(pb.slot)) continue;
    const f = Math.pow(sstep(0.4, 1.0, w), 1.5);                         // incoming-only parts arrive late
    const a1 = W(B, pb.a), b1 = W(B, pb.b);
    out.push({ a: toR(a1), b: toR(b1), ra: pb.ra * B.k * f / km, rb: pb.rb * B.k * f / km, k: pb.k * B.k * f / km, kind: pb.kind, thick: pb.thick, far: pb.far, slot: pb.slot });
  }
  return { pose: { ...(e < 0.5 ? A.pose : B.pose), prims: out.filter(p => p.ra + p.rb > 1e-7) }, k: km, world: [0, 0, 0] };
}

/** Pack primitives into Float32Arrays for uniforms: A(xyz,ra), B(xyz,rb), M(k, kind, thick, far). */
export function packPrims(prims, max, offset = [0, 0, 0], scale = 1) {
  const A = new Float32Array(max * 4), B = new Float32Array(max * 4), M = new Float32Array(max * 4);
  const n = Math.min(max, prims.length);
  for (let i = 0; i < n; i++) {
    const p = prims[i];
    A.set([(p.a[0] + offset[0]) * scale, (p.a[1] + offset[1]) * scale, (p.a[2] + offset[2]) * scale, p.ra * scale], i * 4);
    B.set([(p.b[0] + offset[0]) * scale, (p.b[1] + offset[1]) * scale, (p.b[2] + offset[2]) * scale, p.rb * scale], i * 4);
    M.set([p.k * scale, p.kind, p.thick, p.far], i * 4);
  }
  return { A, B, M, n };
}
