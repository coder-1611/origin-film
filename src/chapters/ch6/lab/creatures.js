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
    const dx = fwd[0] * Math.cos(a), dz = Math.sin(a) * 0.9 + fwd[2];
    const L = lenD * (lengths ? lengths[i] : 1);
    const mid = add(base, nrm([dx, 0.15 * curl, dz]), L * 0.55);
    const tip = add(mid, nrm([dx, -0.6 * curl - 0.1, dz]), L * 0.5);
    rig.cone(base, mid, r0, r0 * 0.75, opt);
    rig.cone(mid, tip, r0 * 0.75, r0 * 0.35, opt);
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
function tiktaalik(t) {
  const G = { T: 1.4, duty: 0.5, v: 0.38, surge: 0.85, surgePh: 0.0 };
  const r = new Rig();
  const X = bodyX(G, t);
  const ph = fract(t / G.T);
  const push = Math.sin(Math.PI * clamp(ph / 0.5)) * (ph < 0.5 ? 1 : 0);   // 0..1 during the push
  const rec = ph >= 0.5 ? Math.sin(Math.PI * (ph - 0.5) / 0.5) : 0;
  const lift = 0.05 * push;                                               // fins lift the chest
  const hp = 0.10, chestY = 0.16 + lift;
  const pel = [0, hp, 0], sh = [0.72, chestY, 0];
  const headPitch = (4 + 10 * push - 3 * rec) * Math.PI / 180;
  const neck = add(sh, [0.12, 0.012 + lift * 0.2, 0]);
  const hd = [Math.cos(headPitch), Math.sin(headPitch), 0];
  const snout = add(neck, hd, 0.3);
  const tailSway = Math.sin(TAU * (t / G.T) + 1.2);
  const tl = (u) => [-0.95 * u, hp - 0.02 * u + 0.04 * u * u * tailSway, 0.18 * u * u * tailSway];
  const ctrl = [
    { p: tl(1.0), r: 0.008 }, { p: tl(0.7), r: 0.028 }, { p: tl(0.4), r: 0.055 }, { p: tl(0.15), r: 0.075 },
    { p: pel, r: 0.085 }, { p: [0.36, (hp + chestY) / 2 - 0.005, 0], r: 0.105 }, { p: sh, r: 0.108 },
    { p: neck, r: 0.095 },
  ];
  const sp = spinePoints(ctrl, 16);
  r.group = 'spine';
  r.chain(sp.map(s => s.p), sp.map(s => s.r), { k: 0.03 });
  r.group = 'head';
  // head: flat wedge (two side-by-side cones give width in 3D; the profile stays low)
  for (const zz of [-0.045, 0.045]) {
    r.cone(add(neck, [0, -0.005, zz]), add(snout, [0, -0.012, zz * 0.4]), 0.07, 0.022, { k: 0.04 });
  }
  r.cone(add(neck, [0.02, -0.03, 0]), add(snout, [-0.03, -0.028, 0]), 0.055, 0.016, { k: 0.03 });       // lower jaw
  // eyes on top of the skull (crocodile-like) + an eye cut for the silhouette
  const eye = add(add(neck, hd, 0.2), [0, 0.058, 0]);
  r.cone(add(eye, [-0.02, -0.01, 0]), eye, 0.02, 0.018, { k: 0.025 });
  // mouth slit
  r.cone(add(add(neck, hd, 0.12), [0, -0.033, 0.07]), add(snout, [-0.02, -0.02, 0.07]), 0.0022, 0.0015, { kind: 5 });
  r.group = 'x';
  // tail fin fringe: dorsal + ventral membranes with rays
  for (let i = 0; i < 9; i++) {
    const u = 0.35 + i * 0.075, s = tl(u), s2 = tl(u + 0.075);
    const hgt = 0.02 + 0.07 * (u - 0.35) / 0.65;
    r.cone(add(s, [0, 0.02, 0]), add(s2, [-0.03, 0.03 + hgt, 0]), 0.006, 0.005, { kind: 1, thick: 0.009, k: 0.035 });
    r.cone(add(s, [0, -0.02, 0]), add(s2, [-0.03, -0.025 - hgt * 0.7, 0]), 0.006, 0.005, { kind: 1, thick: 0.009, k: 0.035 });
  }
  r.cone(add(tl(0.95), [0, 0.0, 0]), add(tl(1.1), [0, 0.03, 0]), 0.05, 0.03, { kind: 1, thick: 0.009, k: 0.04 });
  r.cone(add(tl(0.95), [0, 0.0, 0]), add(tl(1.1), [0, -0.03, 0]), 0.045, 0.028, { kind: 1, thick: 0.009, k: 0.04 });
  // dorsal scale ridge
  for (let i = 0; i < 12; i++) {
    const s = sp[4 + (i % 8)].p;
    if (i > 7) break;
    r.cone(add(s, [0, sp[4 + i].r * 0.85, 0]), add(s, [-0.02, sp[4 + i].r + 0.012, 0]), 0.006, 0.001, { kind: 3, k: 0.01 });
  }
  // pectoral fins (both in phase): shoulder → elbow → fin blade planted on the mud
  for (const side of [1, -1]) {
    const far = side < 0 ? 1 : 0;
    r.group = side > 0 ? 'LF' : 'RF';
    const hip = add(sh, [-0.02, -0.06, 0.08 * side]);
    const f = footTrack(G, t, 0.0, sh[0] + 0.1, 0.07);
    const foot = [f.x - X, 0.012 + f.y, 0.22 * side];
    const { knee } = ik2(hip, foot, 0.16, 0.14, [0.2, 1, 0.6 * side]);
    r.cone(hip, knee, 0.042, 0.032, { k: 0.03, far });
    r.cone(knee, foot, 0.032, 0.02, { k: 0.02, far });
    // fin blade: a fan of rays with membrane between, splayed back along the ground
    for (let i = 0; i < 7; i++) {
      const a = (-35 + i * 11) * Math.PI / 180;
      const tip = add(foot, [Math.cos(a + Math.PI) * -0.12 + 0.02, -0.006 + 0.03 * f.y / 0.07, Math.sin(a) * 0.05 * side]);
      r.cone(foot, tip, 0.012, 0.003, { kind: 1, thick: 0.003, far, k: 0.018 });
    }
  }
  // pelvic fins: small, trailing, paddling half a cycle later
  for (const side of [1, -1]) {
    const far = side < 0 ? 1 : 0;
    r.group = side > 0 ? 'LH' : 'RH';
    const base = add(pel, [0.02, -0.05, 0.06 * side]);
    const sw = Math.sin(TAU * (t / G.T + 0.5));
    const tip = add(base, [-0.14, -0.03 + 0.02 * sw, 0.06 * side]);
    r.cone(base, tip, 0.028, 0.006, { k: 0.02, far });
    r.cone(add(base, [-0.04, -0.01, 0]), add(tip, [-0.02, -0.02, 0]), 0.008, 0.012, { kind: 1, thick: 0.002, far });
  }
  return { rig: r, X, height: 0.34, len: 2.1, center: [0.1, 0.14], water: 0.035, G };
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
  const neckDir = dir2(nk.deg + (P.headNod || 0) * Math.sin(TAU * 2 * cyc + 0.6));
  const neckBase = add(sh, [0.02 * P.scale, P.trunkR[2] * 0.25, 0]);
  const neckTop = add(neckBase, neckDir, nk.len);
  const ctrl = [
    { p: tailPt(1.0), r: tail.r1 }, { p: tailPt(0.66), r: mix(tail.r0, tail.r1, 0.6) }, { p: tailPt(0.33), r: mix(tail.r0, tail.r1, 0.25) },
    { p: add(pel, [0, 0, lat(0)]), r: P.trunkR[0] },
    { p: add(mixv(pel, sh, 0.5), [0, -(P.bellySag || 0), lat(0.5)]), r: P.trunkR[1] },
    { p: add(sh, [0, 0, lat(1)]), r: P.trunkR[2] },
    { p: neckBase, r: nk.r0 },
    { p: neckTop, r: nk.r1 },
  ];
  const sp = spinePoints(ctrl, 16);
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
  P.head(r, { neckTop, neckDir, sh, pel, t, cyc, X, sp, bob, scale: P.scale });
  r.group = 'x';
  if (P.extras) P.extras(r, { sp, sh, pel, t, cyc, X, limbs, tailPt, scale: P.scale });
  return { rig: r, X, height: P.frameH, len: P.frameL, center: P.center, G };
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
    r.cone(knee, ankle, L.r[1], L.r[2], opt);
    r.cone(ankle, foot, L.r[2], L.r[3], opt);
    if (L.toes) digits(r, foot, [1, 0, 0], L.toes, L.toeLen, L.r[3] * 0.75, L.toeSpread || 40, f.stance ? 0.4 : 1, { ...opt, k: opt.k * 0.5 }, L.toeLens);
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
    if (L.toes) digits(r, foot, nrm([1, 0, 0.5 * side]), L.toes, L.toeLen, L.r[3] * 0.7, L.toeSpread || 120, f.stance ? 0.35 : 0.9, { ...opt, k: opt.k * 0.4 }, L.toeLens);
  }
}

// head builders -----------------------------------------------------------------------------
function salamanderHead(r, { neckTop, neckDir }) {
  const s = 1;
  const d = nrm(add(neckDir, [0, -0.15, 0]));
  const tip = add(neckTop, d, 0.021 * s);
  r.cone(neckTop, tip, 0.0088 * s, 0.0058 * s, { k: 0.004 * s });
  r.cone(add(neckTop, [0, -0.002 * s, 0]), add(tip, [-0.002 * s, -0.0025 * s, 0]), 0.007 * s, 0.004 * s, { k: 0.003 * s });
  const eye = add(add(neckTop, d, 0.012 * s), [0, 0.0062 * s, 0]);
  r.cone(eye, add(eye, [0.002 * s, 0.001 * s, 0]), 0.0032 * s, 0.003 * s, { k: 0.003 * s });
  r.cone(add(add(neckTop, d, 0.006 * s), [0, -0.004 * s, 0.01 * s]), add(tip, [-0.002 * s, -0.0035 * s, 0.01 * s]), 0.00045 * s, 0.00035 * s, { kind: 5 });
}
function lizardHead(r, { neckTop, neckDir, cyc }) {
  const s = 1;
  const d = nrm(add(neckDir, [0, -0.25, 0]));
  const tip = add(neckTop, d, 0.05 * s);
  r.cone(neckTop, tip, 0.0125 * s, 0.0035 * s, { k: 0.004 * s });
  r.cone(add(neckTop, [-0.004 * s, -0.006 * s, 0]), add(tip, [-0.006 * s, -0.004 * s, 0]), 0.009 * s, 0.002 * s, { k: 0.003 * s });
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
    hind: { type: 'sprawl', l1: 0.012, l2: 0.011, width: 0.006, sprawl: 0.014, lift: 0.006, pole: [0, 1, 0.8], r: [0.0036, 0.0028, 0.0022, 0.0017], toes: 5, toeLen: 0.0058, toeSpread: 110, toeLens: [0.6, 0.9, 1.1, 1.0, 0.7] },
    fore: { type: 'sprawl', l1: 0.0095, l2: 0.0095, width: 0.006, sprawl: 0.013, lift: 0.006, pole: [-0.2, 1, 0.8], r: [0.003, 0.0024, 0.0019, 0.0015], toes: 4, toeLen: 0.0045, toeSpread: 100, toeLens: [0.7, 1, 1, 0.75] },
    head: salamanderHead, frameH: 0.035, frameL: 0.2, center: [0.0, 0.016],
  },
  // 3 · lizard, 0.45 m: walking trot (diagonal pairs), duty 0.6, belly clear of the ground, crest
  lizard: {
    scale: 0.2, T: 0.47, duty: 0.6, v: 0.34, offs: { LH: 0, RF: 0, RH: 0.5, LF: 0.5 },
    hp: 0.036, shH: 0.038, shX: 0.088, trunkR: [0.012, 0.0165, 0.015], bellySag: 0.002, undulate: 0.016, travel: 0.6, bob: 0.0015,
    neck: { len: 0.022, deg: 12, r0: 0.0125, r1: 0.011 },
    tail: { len: 0.3, r0: 0.0115, r1: 0.0008, deg: -9, droop: -0.12, curl: 0.004, wave: 0.03, lag: 0.3 },
    hind: { type: 'sprawl', l1: 0.03, l2: 0.03, l3: 0.006, width: 0.009, sprawl: 0.03, lift: 0.014, pole: [0.3, 1, 0.7], r: [0.0068, 0.0045, 0.0032, 0.0024], toes: 5, toeLen: 0.017, toeSpread: 95, toeLens: [0.45, 0.7, 0.9, 1.15, 0.6] },
    fore: { type: 'sprawl', l1: 0.022, l2: 0.023, l3: 0.004, width: 0.008, sprawl: 0.024, lift: 0.012, pole: [-0.3, 1, 0.7], r: [0.0052, 0.0036, 0.0026, 0.002], toes: 5, toeLen: 0.009, toeSpread: 100, toeLens: [0.5, 0.8, 1, 0.9, 0.6] },
    head: lizardHead,
    extras(r, { sp }) {
      // dorsal crest: a row of small spines from the nape down the tail base
      for (let i = 8; i < sp.length - 1; i++) {
        const s = sp[i], n = sp[i + 1];
        const h = s.r * (0.7 + 0.25 * Math.sin(i * 1.7));
        r.cone(add(s.p, [0, s.r * 0.8, 0]), add(mixv(s.p, n.p, 0.5), [-0.004, s.r + h * 0.55, 0]), s.r * 0.22, 0.0003, { kind: 3, k: 0.001 });
      }
      for (let i = 3; i < 8; i++) {
        const s = sp[i];
        r.cone(add(s.p, [0, s.r * 0.8, 0]), add(s.p, [-0.003, s.r + 0.0035, 0]), s.r * 0.2, 0.0003, { kind: 3, k: 0.001 });
      }
    },
    frameH: 0.075, frameL: 0.45, center: [-0.04, 0.035],
  },
  // 4 · theropod (Coelophysis-like, 3 m, hip 1 m): biped walk, duty 0.6, Fr ≈ 0.3, horizontal
  // back see-sawing on the hips, S-neck, stabilised head, stiff tail with small yaw
  theropod: {
    scale: 2.5, T: 0.93, duty: 0.6, v: 1.7, offs: { LH: 0, RH: 0.5 },
    hp: 1.0, shH: 0.97, shX: 0.62, trunkR: [0.19, 0.22, 0.17], bellySag: 0.06, bob: 0.03, bobPh: 0.3, pitchOsc: 0.015,
    neck: { len: 0.5, deg: 52, r0: 0.11, r1: 0.065 }, headNod: 3,
    tail: { len: 1.55, r0: 0.17, r1: 0.01, deg: 3, droop: 0.1, wave: 0.12, lag: 0.3 },
    hind: { type: 'digitigrade', l1: 0.42, l2: 0.46, l3: 0.30, metaDeg: 62, width: 0.1, sprawl: 0.0, lift: 0.16, pole: [1, 0, 0.1], rootY: -0.02, r: [0.17, 0.085, 0.045, 0.034], toes: 3, toeLen: 0.15, toeSpread: 50, toeLens: [0.8, 1.1, 0.85], k: 0.05 },
    head(r, { neckTop, neckDir, cyc }) {
      const d = nrm([1, -0.12 + 0.03 * Math.sin(TAU * 2 * cyc), 0]);
      const tip = add(neckTop, d, 0.3);
      r.cone(add(neckTop, [-0.03, 0.0, 0]), tip, 0.072, 0.022, { k: 0.03 });
      r.cone(add(neckTop, [0.0, -0.04, 0]), add(tip, [-0.02, -0.026, 0]), 0.045, 0.014, { k: 0.015 });
      const eye = add(add(neckTop, d, 0.085), [0, 0.022, 0]);
      // jaw line with a row of tiny teeth (cut-paper serration)
      const j0 = add(add(neckTop, d, 0.1), [0, -0.024, 0.06]), j1 = add(tip, [-0.015, -0.016, 0.06]);
      r.cone(j0, j1, 0.0035, 0.0025, { kind: 5 });
      for (let i = 0; i < 7; i++) { const p = mixv(j0, j1, (i + 0.5) / 7); r.cone(add(p, [0, 0.004, 0]), add(p, [0.004, -0.004, 0]), 0.003, 0.0008, { k: 0.002 }); }
    },
    extras(r, { sh, cyc, sp }) {
      // small held arms with three clawed fingers, hardly swinging
      for (const side of [1, -1]) {
        const far = side < 0 ? 1 : 0;
        r.group = side > 0 ? 'LF' : 'RF';
        const s0 = add(sh, [0.02, -0.08, 0.1 * side]);
        const sw = 0.1 * Math.sin(TAU * (cyc + (side > 0 ? 0 : 0.5)));
        const el = add(s0, rotZ([0.02, -0.17, 0], sw));
        const wr = add(el, rotZ([0.13, -0.03, 0], sw * 0.5));
        r.cone(s0, el, 0.04, 0.025, { k: 0.02, far });
        r.cone(el, wr, 0.025, 0.017, { k: 0.01, far });
        digits(r, wr, [0.5, 0, 0], 3, 0.07, 0.011, 40, 1.3, { k: 0.004, far }, [0.8, 1, 0.9]);
      }
      r.group = 'x';
      // faint dorsal scute line along the back
      for (let i = 5; i < 12; i++) { const s = sp[i]; r.cone(add(s.p, [0, s.r * 0.85, 0]), add(s.p, [-0.03, s.r + 0.012, 0]), 0.012, 0.002, { kind: 3, k: 0.004 }); }
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
    head(r, { neckTop, neckDir, cyc }) {
      const d = nrm([1, -0.35, 0]);
      const cr = add(neckTop, [0.02, 0.012, 0]);
      const tip = add(cr, d, 0.14);
      r.cone(add(cr, [-0.02, 0.005, 0]), add(cr, [0.03, -0.002, 0]), 0.05, 0.046, { k: 0.02, kind: 2 });
      r.cone(add(cr, [0.02, -0.005, 0]), tip, 0.04, 0.011, { k: 0.02, kind: 2 });
      r.cone(add(cr, [0.02, -0.03, 0]), add(tip, [-0.03, -0.012, 0]), 0.022, 0.008, { k: 0.01 });
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
    head(r, { neckTop }) {
      const c = add(neckTop, [0.05, 0.035, 0]);
      r.cone(add(c, [-0.03, 0.01, 0]), add(c, [0.03, 0.005, 0]), 0.085, 0.078, { k: 0.02, kind: 2 });            // cranium
      r.cone(add(c, [0.07, 0.03, 0]), add(c, [0.095, 0.026, 0]), 0.03, 0.028, { k: 0.02 });                       // brow ridge
      r.cone(add(c, [0.07, -0.015, 0]), add(c, [0.14, -0.05, 0]), 0.055, 0.042, { k: 0.03 });                     // prognathic muzzle
      r.cone(add(c, [0.06, -0.07, 0]), add(c, [0.13, -0.078, 0]), 0.03, 0.026, { k: 0.02 });                      // lower lip / jaw
      r.cone(add(c, [0.14, -0.04, 0]), add(c, [0.155, -0.058, 0]), 0.022, 0.02, { k: 0.015 });                    // upper lip
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
    extras(r, { sh, pel, cyc }) {
      // torso masses: buttocks, lower back curve, rib cage, shoulder (deltoid)
      r.cone(add(pel, [-0.035, -0.01, 0]), add(pel, [-0.045, -0.07, 0]), 0.1, 0.09, { k: 0.05 });
      r.cone(add(pel, [0.02, 0.12, 0]), add(pel, [0.035, 0.26, 0]), 0.1, 0.112, { k: 0.06 });
      r.cone(add(sh, [0.02, -0.26, 0]), add(sh, [0.02, -0.1, 0]), 0.122, 0.12, { k: 0.06 });
      r.cone(add(sh, [0.0, -0.02, 0.15]), add(sh, [0.02, -0.1, 0.17]), 0.056, 0.05, { k: 0.04 });
      // near (left) arm holds the torch high & forward; far (right) arm swings opposite its leg
      const S = add(sh, [0.0, -0.035, 0.17]), Sf = add(sh, [0.0, -0.035, -0.17]);
      r.group = 'LF';
      const lift = 0.01 * Math.sin(TAU * 2 * cyc);
      const el = add(S, [0.1, -0.24 + lift, 0.03]);
      const hand = add(el, [0.22, 0.1 + lift, 0.0]);
      r.cone(S, el, 0.047, 0.036, { k: 0.02 });
      r.cone(add(S, [0.0, -0.06, 0]), add(S, [0.02, -0.16, 0]), 0.05, 0.04, { k: 0.03 });                          // biceps/deltoid mass
      r.cone(el, hand, 0.037, 0.027, { k: 0.02 });
      r.cone(add(el, [0.03, 0.0, 0]), add(el, [0.12, 0.045, 0]), 0.04, 0.032, { k: 0.02 });                       // forearm muscle
      r.cone(add(hand, [-0.015, -0.005, 0]), add(hand, [0.035, 0.005, 0]), 0.036, 0.03, { k: 0.012 });             // fist
      r.cone(add(hand, [0.0, 0.012, 0.01]), add(hand, [0.03, 0.03, 0.01]), 0.014, 0.012, { k: 0.006 });           // thumb over the shaft
      // torch: a stout branch angled up and forward, a burning bundle at the top
      r.group = 'torch';
      const t0 = add(hand, [-0.1, -0.2, 0.02]), t1 = add(hand, [0.13, 0.45, 0.02]);
      r.cone(t0, t1, 0.017, 0.024, { kind: 4, k: 0.0 });
      r.cone(add(t1, [-0.025, -0.07, 0]), add(t1, [0.008, 0.02, 0]), 0.038, 0.034, { kind: 4, k: 0.012 });
      r.cone(add(t1, [-0.03, -0.02, 0]), add(t1, [-0.05, 0.03, 0]), 0.01, 0.004, { kind: 4, k: 0.004 });          // frayed twigs
      r.cone(add(t1, [0.02, -0.01, 0]), add(t1, [0.045, 0.035, 0]), 0.009, 0.003, { kind: 4, k: 0.004 });
      r.group = 'RF';
      const sw = 0.36 * Math.sin(TAU * cyc);
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
export function poseCreature(key, t) {
  let out;
  if (key === 'tiktaalik') out = tiktaalik(t);
  else out = quadruped(t, DEFS[key]);
  const def = DEFS[key];
  let flame = null;
  if (key === 'human') {
    // re-run the extras hook to get the flame anchor (it returned it from the builder)
    const r = out.rig.p;
    const torch = r.filter(p => p.kind === 4);
    const top = torch[torch.length - 1];
    flame = add(top.b, [0.01, 0.06, 0]);
  }
  return { prims: out.rig.p, X: out.X, height: out.height, len: out.len, center: out.center, water: out.water || 0, flame, G: out.G, key, label: STAGE_LABEL[key] };
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
  const used = new Set(), out = [];
  const e = w * w * (3 - 2 * w);
  for (const pa of A.pose.prims) {
    const pb = mapB.get(pa.slot);
    const a0 = W(A, pa.a), b0 = W(A, pa.b);
    if (pb) {
      used.add(pa.slot);
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
