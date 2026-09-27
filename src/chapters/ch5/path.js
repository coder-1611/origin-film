// V · PALE BLUE: the camera, as a pure function of t.
//   81.0 – 96.0   orbit: the timeline keyframes (cameras.V), planet units (R = 1)
//   96.0 – 100.6  descent: log-altitude dive toward the ocean point N0, while the view slerps
//                 from "look at the planet centre" to "look along the sun azimuth, pitched down"
//   100.4 – 102   local ocean frame (metres), continuing the same world orientation
//   102 – 107     underwater, pitching up to level
// Everything is in world directions so the sun, the heading and the horizon stay continuous
// across the renderer switch (hidden inside the cloud-deck whiteout).

export const SUN = norm([-0.8, 0.35, 0.5]);
export const D0 = 4.605104503013328;   // disc radius = 0.3056 H at fov 40

export const PH = {
  hold: 83.0,
  dive0: 96.0,
  sw0: 99.86, sw1: 99.97,               // planet → local crossfade (inside the whiteout)
  fog0: 99.60,                           // planet renderer starts fogging into the deck
  splash: 102.0,
  end: 107.0,
};

// ---------------------------------------------------------------- vec helpers
export function norm(a) { const l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l]; }
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const len = (a) => Math.hypot(a[0], a[1], a[2]);
export function slerpDir(a, b, u) {
  const c = Math.max(-1, Math.min(1, dot(a, b)));
  const th = Math.acos(c);
  if (th < 1e-6) return a.slice();
  const s = Math.sin(th);
  return add(mul(a, Math.sin((1 - u) * th) / s), mul(b, Math.sin(u * th) / s));
}
export function rotAxis(p, ax, a) {
  const c = Math.cos(a), s = Math.sin(a);
  return add(add(mul(p, c), mul(cross(ax, p), s)), mul(ax, dot(ax, p) * (1 - c)));
}
const clamp01 = (x) => Math.min(1, Math.max(0, x));
export const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
export const smoother = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * t * (t * (t * 6 - 15) + 10); };

// ---------------------------------------------------------------- planet spin (time-lapse)
// Angular speed ω(t): slow while molten, spins up during the cooling time-lapse, settles.
function omega(t) {
  const k = [[81.0, 0.05], [82.3, 0.05], [83.4, 0.42], [84.4, 0.42], [86.6, 0.03], [200, 0.03]];
  for (let i = 0; i < k.length - 1; i++) {
    if (t < k[i + 1][0]) { const u = smooth(k[i][0], k[i + 1][0], t); return k[i][1] + (k[i + 1][1] - k[i][1]) * u; }
  }
  return k[k.length - 1][1];
}
/** ∫ω from 81 to t (Simpson, fixed step: a pure function of t). */
export function spinAngle(t) {
  const a = 81.0, b = Math.max(a, t);
  const n = 2 * Math.max(1, Math.ceil((b - a) / 0.05));
  const h = (b - a) / n;
  let s = omega(a) + omega(b);
  for (let i = 1; i < n; i++) s += omega(a + i * h) * (i % 2 ? 4 : 2);
  return -s * h / 3;             // spin sense chosen so the glint glides against the surface
}
// Planet axis: tilted 23.4° toward the upper right, a touch toward the viewer.
export const AXIS = norm([Math.sin(23.4 * Math.PI / 180), Math.cos(23.4 * Math.PI / 180), 0.12]);

/** Row-major 3x3 world → planet-fixed rotation for spin angle phi (axis → +y). */
export function spinMatrix(phi) {
  // basis: Y = AXIS, X ⟂, Z = X × Y; then rotate around Y by -phi
  const Y = AXIS;
  const X = norm(cross(Y, [0, 0, 1]));
  const Z = cross(X, Y);
  const c = Math.cos(phi), s = Math.sin(phi);
  // world vector p → (dot(p,X), dot(p,Y), dot(p,Z)) → rotate about y by -phi
  const rX = add(mul(X, c), mul(Z, -s));   // row for x'
  const rZ = add(mul(X, s), mul(Z, c));    // row for z'
  return [rX, Y, rZ];
}
export const applyRows = (M, p) => [dot(M[0], p), dot(M[1], p), dot(M[2], p)];

// ---------------------------------------------------------------- descent geometry
// The orbit ends at key 96 looking at the centre. The dive goes toward N0: the point reached
// by rotating the 96 s view direction toward the sun until the local sun elevation is SUN_EL.
export const SUN_EL = 21 * Math.PI / 180;
export const PITCH_END = 17 * Math.PI / 180;   // look-down angle when entering the deck
export const YAW0 = 0.28;                        // heading offset from the sun azimuth (sun to the right third)

export function descentFrame(T) {
  const k = T.sampleCamera(T.cameras.V, PH.dive0);
  const c96 = norm(k.pos);
  const ang0 = Math.acos(dot(c96, SUN));
  const target = Math.PI / 2 - SUN_EL;           // angle(N0, SUN)
  const N0 = slerpDir(c96, SUN, (ang0 - target) / ang0);
  const H0 = norm(sub(SUN, mul(N0, dot(SUN, N0))));   // heading: toward the sun azimuth
  const X = norm(cross(mul(H0, -1), N0));              // right = forward × up (forward=H0)
  // local frame: X right, Y = N0 up, Z = -H0 (heading is -Z)
  return { c96, N0, H0, X, Y: N0, Z: mul(H0, -1), k96: k };
}

// ---------------------------------------------------------------- quaternions (x,y,z,w)
function quatFromBasis(r, u, f) {
  // columns: x = r, y = u, z = -f (camera looks down -z)
  const m00 = r[0], m01 = u[0], m02 = -f[0];
  const m10 = r[1], m11 = u[1], m12 = -f[1];
  const m20 = r[2], m21 = u[2], m22 = -f[2];
  const tr = m00 + m11 + m22;
  let x, y, z, w;
  if (tr > 0) { const s = 0.5 / Math.sqrt(tr + 1); w = 0.25 / s; x = (m21 - m12) * s; y = (m02 - m20) * s; z = (m10 - m01) * s; }
  else if (m00 > m11 && m00 > m22) { const s = 2 * Math.sqrt(1 + m00 - m11 - m22); w = (m21 - m12) / s; x = 0.25 * s; y = (m01 + m10) / s; z = (m02 + m20) / s; }
  else if (m11 > m22) { const s = 2 * Math.sqrt(1 + m11 - m00 - m22); w = (m02 - m20) / s; x = (m01 + m10) / s; y = 0.25 * s; z = (m12 + m21) / s; }
  else { const s = 2 * Math.sqrt(1 + m22 - m00 - m11); w = (m10 - m01) / s; x = (m02 + m20) / s; y = (m12 + m21) / s; z = 0.25 * s; }
  return [x, y, z, w];
}
function quatSlerp(a, b, u) {
  let c = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  let bb = b;
  if (c < 0) { c = -c; bb = b.map(v => -v); }
  if (c > 0.9995) { const o = a.map((v, i) => v + (bb[i] - v) * u); const l = Math.hypot(...o); return o.map(v => v / l); }
  const th = Math.acos(c), s = Math.sin(th);
  const wa = Math.sin((1 - u) * th) / s, wb = Math.sin(u * th) / s;
  return a.map((v, i) => v * wa + bb[i] * wb);
}
function basisFromQuat(q) {
  const [x, y, z, w] = q;
  const r = [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w)];
  const u = [2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w)];
  const bz = [2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y)];
  return { r, u, f: mul(bz, -1) };
}
/** Camera basis from a timeline key sample (same convention as ctx.applyCamera). */
function basisFromKey(k) {
  const f = norm(sub(k.target, k.pos));
  let r = norm(cross(f, [0, 1, 0]));
  let u = cross(r, f);
  const a = (k.roll || 0) * Math.PI / 180;
  if (a) {                        // rotateZ(roll): rotate r,u about the view axis (counter-clockwise)
    const c = Math.cos(a), s = Math.sin(a);
    const r2 = add(mul(r, c), mul(u, s)), u2 = add(mul(u, c), mul(r, -s));
    r = r2; u = u2;
  }
  return { r, u, f };
}
function pitchedBasis(fr, pitch, yaw = 0, roll = 0) {
  // heading -Z, pitch down by `pitch` (radians), in the local frame fr, expressed in world
  const h = rotAxis(mul(fr.Z, -1), fr.Y, yaw);
  const right0 = norm(cross(h, fr.Y));
  const f = add(mul(h, Math.cos(pitch)), mul(fr.Y, -Math.sin(pitch)));
  let u = cross(right0, f);
  let r = right0;
  if (roll) { const c = Math.cos(roll), s = Math.sin(roll); const r2 = add(mul(r, c), mul(u, s)), u2 = add(mul(u, c), mul(r, -s)); r = r2; u = u2; }
  return { r, u, f };
}

// ---------------------------------------------------------------- altitude profiles
const ALT_SW = 0.0047;          // planet-units altitude where the local renderer takes over
function diveAlt(t, alt96) {
  const u = clamp01((t - PH.dive0) / (PH.sw1 + 0.05 - PH.dive0));
  const g = 1 - Math.cos(u * Math.PI / 2);                   // ease-in (continuous with the orbit)
  const g2 = g * 0.35 + 0.65 * (u * u * (3 - 2 * u)) ;
  return Math.exp(Math.log(alt96) + (Math.log(ALT_SW) - Math.log(alt96)) * (0.5 * g + 0.5 * g2));
}
/** Local altitude in metres (camera above the sea), 100.3 → 102. */
export function localAlt(t) {
  const k = [[99.80, 2650], [99.97, 2290], [100.14, 1820], [100.30, 1390], [100.44, 985], [100.60, 730], [100.90, 480], [101.20, 280], [101.50, 130], [101.75, 45], [101.90, 12], [102.0, 0.0]];
  if (t <= k[0][0]) return k[0][1];
  for (let i = 0; i < k.length - 1; i++) {
    if (t < k[i + 1][0]) {
      const u = (t - k[i][0]) / (k[i + 1][0] - k[i][0]);
      // monotone cubic (Catmull-Rom tangents on log(alt + 3))
      const f = (j) => Math.log(k[Math.max(0, Math.min(k.length - 1, j))][1] + 3);
      const tt = (j) => k[Math.max(0, Math.min(k.length - 1, j))][0];
      const y0 = f(i), y1 = f(i + 1);
      const m0 = (f(i + 1) - f(i - 1)) / (tt(i + 1) - tt(i - 1)) * (k[i + 1][0] - k[i][0]);
      const m1 = (f(i + 2) - f(i)) / (tt(i + 2) - tt(i)) * (k[i + 1][0] - k[i][0]);
      const h00 = 2 * u ** 3 - 3 * u ** 2 + 1, h10 = u ** 3 - 2 * u ** 2 + u, h01 = -2 * u ** 3 + 3 * u ** 2, h11 = u ** 3 - u ** 2;
      return Math.max(0, Math.exp(h00 * y0 + h10 * m0 + h01 * y1 + h11 * m1) - 3);
    }
  }
  return 0;
}
function localPitch(t) {
  // enter the deck at PITCH_END, level out a little under it, then tip down into the plunge
  const p1 = PITCH_END, p2 = 22 * Math.PI / 180, p3 = 58 * Math.PI / 180;
  let p = p1 + (p2 - p1) * smooth(100.0, 100.9, t);
  p += (p3 - p2) * Math.pow(smooth(101.35, 102.0, t), 1.6);
  return p;
}
function underPitch(t) {
  const p3 = 58 * Math.PI / 180;
  return p3 * (1 - smoother(102.0, 104.9, t));
}
export function underDepth(t) {
  const u = t - PH.splash;
  return 7.5 * (1 - Math.exp(-u / 0.9)) + 0.15 * u;     // metres below the surface
}

// Buffeting in the atmosphere: tiny angular shake, pumped by the kicks.
function shake(T, t) {
  const env = smooth(97.3, 98.4, t) * (1 - smooth(101.9, 102.05, t));
  if (env <= 0) return [0, 0];
  let kick = 0;
  for (const k of T.kicks) { if (k <= t && t - k < 0.6) kick += Math.exp(-(t - k) / 0.12); }
  const a = env * (0.0009 + 0.0022 * kick);
  const s1 = Math.sin(t * 37.1) + 0.6 * Math.sin(t * 61.7 + 1.3) + 0.3 * Math.sin(t * 97.3 + 0.2);
  const s2 = Math.sin(t * 41.3 + 2.1) + 0.6 * Math.sin(t * 57.9 + 0.7) + 0.3 * Math.sin(t * 89.1 + 2.9);
  return [a * s1, a * s2];
}

/**
 * The camera at t. Returns {mode, pos (planet units, planet mode), r,u,f (world), fov,
 *   local: {alt (m), along (m), r,u,f in local frame coords}, depth (m, under)}.
 */
export function cameraAt(T, t, fr) {
  fr = fr || descentFrame(T);
  const out = { fov: 40, fr };
  // ---- planet modes
  if (t < PH.dive0) {
    const k = T.sampleCamera(T.cameras.V, t);
    Object.assign(out, basisFromKey(k), { pos: k.pos, fov: k.fov, mode: 'planet' });
  } else {
    const k = fr.k96;
    const b96 = basisFromKey(k);
    const q96 = quatFromBasis(b96.r, b96.u, b96.f);
    const bEnd = pitchedBasis(fr, PITCH_END, YAW0);
    const qEnd = quatFromBasis(bEnd.r, bEnd.u, bEnd.f);
    const alt96 = len(k.pos) - 1;
    if (t < PH.sw1 + 0.05) {
      const tt = Math.min(t, PH.sw1 + 0.05);
      const alt = diveAlt(tt, alt96);
      const dirU = smoother(PH.dive0, PH.sw0, tt);
      const dir = slerpDir(fr.c96, fr.N0, dirU);
      const pos = mul(dir, 1 + alt);
      // orientation: the pitch-up happens once the planet overfills the frame
      const s = smoother(96.6, 99.55, tt);
      const b = basisFromQuat(quatSlerp(q96, qEnd, s));
      // re-level: the up vector follows the local vertical as we arrive
      Object.assign(out, b, { pos, mode: 'planet', alt });
    }
    if (t >= PH.sw0) {
      // local frame (metres). Orientation continues from the same world basis.
      const alt = t < PH.splash ? localAlt(t) : -underDepth(t);
      const pitch = t < PH.splash ? localPitch(t) : underPitch(t);
      const [sy, sp] = shake(T, t);
      const b = pitchedBasis(fr, pitch + sp, YAW0 + 0.03 * Math.sin((t - 100) * 0.9) + sy, 0.02 * Math.sin((t - 100) * 0.7 + 0.5));
      out.local = { alt, along: alongAt(t), ...toLocal(fr, b), world: b };
      if (t >= PH.sw1 + 0.05) Object.assign(out, b, { mode: t < PH.splash ? 'local' : 'under' });
    }
  }
  if (t >= PH.dive0 && t < PH.sw0) {
    const [sy, sp] = shake(T, t);
    if (sy || sp) {
      out.f = norm(add(out.f, add(mul(out.r, sy), mul(out.u, sp))));
      out.r = norm(cross(out.f, out.u)); out.u = cross(out.r, out.f);
    }
  }
  return out;
}
/** Metres travelled along the heading (drives wave parallax). */
export function alongAt(t) {
  const v = 240;
  if (t < PH.splash) return v * (t - PH.sw0);
  const u = t - PH.splash;
  return v * (PH.splash - PH.sw0) + v * 0.45 * (1 - Math.exp(-u / 0.45));
}
function toLocal(fr, b) {
  const L = (v) => [dot(v, fr.X), dot(v, fr.Y), dot(v, fr.Z)];
  return { r: L(b.r), u: L(b.u), f: L(b.f) };
}
export function sunLocal(fr) { return [dot(SUN, fr.X), dot(SUN, fr.Y), dot(SUN, fr.Z)]; }
