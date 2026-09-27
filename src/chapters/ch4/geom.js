// Chapter IV world model. Pure math, no Three.js, so the chapter and the camera generator
// (ch4/camgen.mjs) share exactly the same geometry.
//
// "Key space": the Sun sits at the origin, the disk lies in the XZ plane, and the frame
// co-rotates with the proto-Earth once the camera has locked onto it (lockW → 1 by 62.5 s),
// so after that the Earth is fixed at EARTH = (10, 0, 0). Every orbiting thing has
// key-space angle  θ0 + Ω(r)·(t − T0) − psi(t)  (Keplerian: Ω ∝ r^-1.5, a pure function of t).

export const RS = 0.6;               // young Sun radius
export const RE_ORB = 10;            // proto-Earth orbital radius
export const OMEGA_E = 0.1;          // proto-Earth angular velocity (rad/s)
export const RE = 0.25;              // Earth radius
export const RT = 0.55 * RE;         // Theia: Mars-sized
export const RM = 0.27 * RE;         // Moon
export const R_IN = 1.25, R_OUT = 44;
export const T0 = 57.2;
export const EARTH = [RE_ORB, 0, 0];
export const IMPACT_NDC = [0.05, 0.08];   // where the contact point sits on screen at THEIA_T
export const RING_TILT = 28, OBLIQUITY = 42;
export const FINAL = { t: 81.0, fov: 35, radiusH: 0.3056, sunView: [-0.8, 0.35, 0.5] };
export const MOON_A = 5.4 * RE;      // the Moon's orbit (5.4 Earth radii)
export const MOON_W = 0.26;          // its angular velocity (rad/s); the ring is Keplerian around the Earth

// Gaps carved by protoplanets: [radius, half-width, depth]. Earth's is at 10.
export const GAPS = [
  [2.35, 0.16, 0.85], [3.5, 0.22, 0.8], [5.1, 0.32, 0.86], [7.2, 0.42, 0.84], [RE_ORB, 1.2, 0.96],
  [13.4, 0.75, 0.82], [18.3, 1.15, 0.86], [24.4, 1.9, 0.96], [31.0, 1.3, 0.75],
];
// Protoplanets living in those gaps (not the Earth, which is its own object): [r, θ0, size]
export const PROTOPLANETS = [[2.35, 0.4, 0.025], [3.5, 1.1, 0.03], [5.1, 4.0, 0.04], [7.2, 2.2, 0.045], [13.4, 2.9, 0.05],
  [18.3, 5.6, 0.07], [24.4, 5.2, 0.16], [31.0, 0.6, 0.08]];

export const omega = (r) => OMEGA_E * Math.pow(r / RE_ORB, -1.5);
export const clamp01 = (x) => Math.min(1, Math.max(0, x));
export const sstep = (a, b, x) => { const u = clamp01((x - a) / (b - a)); return u * u * (3 - 2 * u); };
export const sstep5 = (a, b, x) => { const u = clamp01((x - a) / (b - a)); return u * u * u * (u * (u * 6 - 15) + 10); };
export const lockW = (t) => sstep(T0, 62.5, t);
/** Key-frame rotation: the frame co-rotates with the Earth once locked. */
export const psi = (t) => OMEGA_E * (t - T0) * lockW(t);
/** Key-space angle of anything on a circular orbit of radius r with world angle th0 at T0. */
export const orbitAngle = (r, th0, t) => th0 + omega(r) * (t - T0) - psi(t);
export function earthPos(t) {
  const a = orbitAngle(RE_ORB, 0, t);
  return [RE_ORB * Math.cos(a), 0, RE_ORB * Math.sin(a)];
}

// ------------------------------------------------------------------ vectors
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a) => Math.hypot(a[0], a[1], a[2]);
export const norm = (a) => mul(a, 1 / (len(a) || 1));
export const lerp3 = (a, b, u) => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];

// ------------------------------------------------------------------ camera (mirrors ctx.applyCamera)
/** Orthonormal camera frame for a timeline camera sample {pos,target,fov,roll}. */
export function camFrame(k, aspect) {
  const z = norm(sub(k.pos, k.target));
  let x = norm(cross([0, 1, 0], z));
  let y = cross(z, x);
  if (k.roll) {
    const r = k.roll * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
    [x, y] = [add(mul(x, c), mul(y, s)), add(mul(x, -s), mul(y, c))];
  }
  return { pos: k.pos, x, y, z, th: Math.tan(k.fov * Math.PI / 360), aspect, fov: k.fov };
}
/** World point → NDC {x, y} and view depth d (positive in front). */
export function project(f, p) {
  const d = sub(p, f.pos), zc = -dot(d, f.z);
  return { x: dot(d, f.x) / (zc * f.th * f.aspect), y: dot(d, f.y) / (zc * f.th), d: zc };
}
/** Unit ray direction through NDC (nx, ny). */
export function rayDir(f, nx, ny) {
  return norm(add(add(mul(f.x, nx * f.th * f.aspect), mul(f.y, ny * f.th)), mul(f.z, -1)));
}

// ------------------------------------------------------------------ the giant impact
/** Final-frame camera direction (Earth → camera) for roll 0, lookAt(up = +Y), toward-sun = −X. */
export function finalDir() {
  const S = norm(FINAL.sunView);
  const vx = -S[2], rxz = Math.abs(vx) / Math.sqrt(1 - S[0] * S[0]), vz = -S[0] * rxz;
  return norm([vx, -Math.sqrt(Math.max(0, 1 - vx * vx - vz * vz)), vz]);
}
export const FINAL_RHO = RE / Math.sin(Math.atan(2 * FINAL.radiusH * Math.tan(FINAL.fov * Math.PI / 360)));
/**
 * Everything about Theia's impact, derived from the camera at THEIA_T so the contact point lands
 * on screen at IMPACT_NDC by construction. Key space.
 */
export function impactGeom(T, aspect) {
  const f = camFrame(T.sampleCamera(T.cameras.IV, T.THEIA_T), aspect);
  const d = rayDir(f, IMPACT_NDC[0], IMPACT_NDC[1]);
  const E = EARTH;
  const tca = dot(sub(E, f.pos), d);
  const pc = add(f.pos, mul(d, tca));
  const off = sub(pc, E), m = len(off);
  const P = m < RE ? add(f.pos, mul(d, tca - Math.sqrt(RE * RE - m * m))) : add(E, mul(off, RE / m));
  const n = norm(sub(P, E));
  // The ring (impact angular momentum) lies level in the Theia shot, open RING_TILT° toward the
  // camera; Theia's velocity follows from it: into the surface at OBLIQUITY° along the flow.
  const tl = RING_TILT * Math.PI / 180;
  const hint = norm(add(mul(f.y, -Math.cos(tl)), mul(f.z, Math.sin(tl))));
  const axis = norm(sub(hint, mul(n, dot(hint, n))));
  const e1 = n, e2 = norm(cross(axis, n));            // ring basis: φ = 0 at the impact, increasing along the flow
  const ob = OBLIQUITY * Math.PI / 180;
  const v = norm(add(mul(n, -Math.cos(ob)), mul(e2, Math.sin(ob))));   // Theia's velocity
  const theiaC = add(E, mul(n, RE + RT));
  // Approach distance so that at the start of the whoosh Theia's centre sits at x = 0.9.
  const tw = T.sfx.find(s => s.type === 'whoosh' && s.t > 60 && s.t < 69).t;
  const fw = camFrame(T.sampleCamera(T.cameras.IV, tw), aspect);
  let lo = 0, hi = 40;
  for (let i = 0; i < 80; i++) { const s = (lo + hi) / 2; project(fw, add(theiaC, mul(v, -s))).x < 0.9 ? lo = s : hi = s; }
  return { f, P, n, v, axis, e1, e2, theiaC, approachD: (lo + hi) / 2, approachT0: tw, obliquity: Math.acos(-dot(n, v)) * 180 / Math.PI };
}

/** Distance travelled toward the impact still to go at time t (accelerating infall). */
export function theiaRemaining(g, T, t) {
  const u = (T.THEIA_T - t) / (T.THEIA_T - g.approachT0);        // 1 at the whoosh, 0 at impact
  const b = 0.45;
  return g.approachD * (b * u + (1 - b) * (2 * u - u * u));
}

/** Ring-plane position around the Earth: radius a (world units), angle φ, height z. */
export function ringPos(g, a, phi, z = 0) {
  return add(add(add(EARTH, mul(g.e1, a * Math.cos(phi))), mul(g.e2, a * Math.sin(phi))), mul(g.axis, z));
}

/**
 * The Moon's orbital phase at FINAL.t: the angle that keeps it furthest outside the left edge
 * of the final frame for the whole 81 → 83 s hold (it keeps orbiting).
 */
export function moonPhase81(T, g, aspect) {
  const f = camFrame(T.sampleCamera(T.cameras.IV, FINAL.t), aspect);
  let best = 0, bestScore = -1e9;
  for (let k = 0; k < 720; k++) {
    const phi = k / 720 * Math.PI * 2;
    let score = 1e9;
    for (let s = 0; s <= 8; s++) {
      const p = project(f, ringPos(g, MOON_A, phi + MOON_W * (s / 8) * 2.2));
      // off-screen margin: how far past the left edge (in NDC), or "behind the camera"
      // it must leave through the LEFT edge and stay out: margin past x = −1 (behind camera = fine)
      const m = p.d < 0.02 ? 3 : (-p.x - 1) - 0.7 * Math.max(0, Math.abs(p.y) - 0.45);
      score = Math.min(score, m);
    }
    if (score > bestScore) { bestScore = score; best = phi; }
  }
  return { phi81: best, margin: bestScore };
}

/** Rodrigues rotation of v about unit axis k by angle a. */
export function rotAbout(v, k, a) {
  const c = Math.cos(a), s = Math.sin(a);
  return add(add(mul(v, c), mul(cross(k, v), s)), mul(k, dot(k, v) * (1 - c)));
}
/**
 * The final (IV→V) camera frame. The contract fixes where the Sun appears (2 DOF); the last
 * degree of freedom, a rotation about the sun direction, is spent laying the debris ring
 * horizontal in frame (axis·x = 0), so the Moon can leave through the left edge.
 * Returns {pos, target, fov, roll, open} as a timeline key.
 */
export function finalKey(axis, preferOpen = 25, ySign = 1) {
  const s = [-1, 0, 0], z0 = finalDir(), x0 = norm(cross([0, 1, 0], z0)), y0 = cross(z0, x0);
  let best = null;
  for (let k = 0; k < 3600; k++) {
    const chi = k / 3600 * Math.PI * 2;
    const x = rotAbout(x0, s, chi), y = rotAbout(y0, s, chi), z = rotAbout(z0, s, chi);
    const f = dot(axis, x), open = Math.asin(Math.abs(dot(axis, z))) * 180 / Math.PI;
    if (Math.abs(z[1]) > 0.93) continue;
    const score = Math.abs(f) * 20 + Math.abs(open - preferOpen) / 30 + (dot(axis, y) * ySign > 0 ? 0 : 5);
    if (!best || score < best.score) best = { score, x, y, z, chi, open };
  }
  const pos = add(EARTH, mul(best.z, FINAL_RHO));
  const xl = norm(cross([0, 1, 0], best.z)), yl = cross(best.z, xl);
  const roll = Math.atan2(dot(best.x, yl), dot(best.x, xl)) * 180 / Math.PI;
  return { pos, target: EARTH.slice(), fov: FINAL.fov, roll, open: best.open, axisX: dot(axis, best.x), dir: best.z };
}
