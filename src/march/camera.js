// ORIGIN · VI march: the documentary camera, a pure function of t in the walk-local frame
// (docs/research/animal-realism.md §2.3). A telephoto (24° vertical) drifting along the shore at
// z = ZC, looking along −z at the low sun: it follows one subject at a time, never locked to it —
// its x is a smooth lagging average of the subject's position over the last ~1.4 s — and it eases
// lower for small animals (lizard, fox: 0.2–0.35 m) and higher for the theropod (1.25 m). The focus
// distance racks with the subject. At the torch it settles so the flame is at the exact centre with
// the horizon through it; then it dollies straight back into the night.
// Used by src/march/plan.js (screen x of every sound source) and by src/chapters/ch6/camera.js (the
// keys it writes into T.cameras.VI). Pure JS.
import { ZC, TORCH } from './beats.js';

export const FOV = 24, ASPECT = 16 / 9;
export const TANH = Math.tan(FOV / 2 * Math.PI / 180);
const DEG = Math.PI / 180;
const s3 = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * t * (t * (t * 6 - 15) + 10); };

// who the camera attends to, from when, and how long the hand-over takes (film s)
export const SCHEDULE = [
  { t: 100, name: 'tetrapod', span: 0 },
  { t: 130.3, name: 'amphibian', span: 1.8 },
  { t: 133.55, name: 'lizard', span: 1.4 },
  { t: 136.95, name: 'theropod', span: 1.8 },
  { t: 141.45, name: 'fox', span: 2.3 },
  { t: 145.35, name: 'ape', span: 1.5 },
  { t: 147.85, name: 'human', span: 1.6 },
];
// per subject: camera height (m), pitch (deg, up), lead (m ahead of the subject's visual centre:
// looking room in front of it)
export const SHOT = {
  tetrapod: { h: 0.42, pitch: 3.0, lead: 0.15 },
  amphibian: { h: 0.3, pitch: 2.8, lead: 0.15 },
  lizard: { h: 0.22, pitch: 2.5, lead: 0.12 },
  theropod: { h: 1.25, pitch: 4.5, lead: 1.1 },
  fox: { h: 0.32, pitch: 3.2, lead: 0.3 },
  ape: { h: 0.62, pitch: 3.4, lead: 0.3 },
  human: { h: 1.05, pitch: 3.0, lead: 0.6 },
};
const LAG_X = 1.4, LAG_H = 1.1, LAG_F = 0.6, NS = 32;
export const DOLLY = 38;                       // m, straight back along the axis after the catch

/**
 * makeCamera(cast, { schedule, shot, end }) → { at(t) → { x, h, z, pitch (rad), fov, focus }, ndc(cam, p), dist(cam, p) }
 *   end: the chapter window's end (the dolly finishes 0.1 s before it)
 */
export function makeCamera(cast, { schedule = SCHEDULE, shot = SHOT, end = 155 } = {}) {
  const human = cast.human, H = human.beh;
  const target = (name, t) => { const A = cast[name], S = shot[name]; return [A.X(t) + A.dir * (A.cx + S.lead), S.h, S.pitch, A.D]; };
  function raw(t) {
    let cur = target(schedule[0].name, t);
    for (let i = 1; i < schedule.length; i++) {
      const e = schedule[i], w = e.span > 0 ? s3(e.t, e.t + e.span, t) : (t >= e.t ? 1 : 0);
      if (w <= 0) break;
      const nx = target(e.name, t);
      cur = cur.map((v, j) => v + (nx[j] - v) * w);
    }
    return cur;
  }
  // smooth causal averages (kernel e^(−2u)(1−u)², C¹ at the window edge)
  const KW = Array.from({ length: NS + 1 }, (_, i) => { const u = i / NS; return Math.exp(-2 * u) * (1 - u) * (1 - u); });
  const KS = KW.reduce((a, b) => a + b, 0);
  function lagged(t) {
    const out = [0, 0, 0, 0];
    for (let i = 0; i <= NS; i++) {
      const u = i / NS;
      const rx = raw(t - u * LAG_X), rh = LAG_H === LAG_X ? rx : raw(t - u * LAG_H), rf = raw(t - u * LAG_F);
      out[0] += KW[i] * rx[0]; out[1] += KW[i] * rh[1]; out[2] += KW[i] * rh[2]; out[3] += KW[i] * rf[3];
    }
    return out.map(v => v / KS);
  }
  const flame = H.flame;
  function at(t) {
    const [lx, lh, lp, lf] = lagged(t);
    // the torch: settle on the flame (centre) with the horizon through it, exactly at TORCH
    const w = ss(H.standAt - 0.35, TORCH, t);
    const x = lx + (flame[0] - lx) * w, h = lh + (flame[1] + 0.06 - lh) * w, pitch = lp * (1 - w) * DEG;
    const dolly = DOLLY * ss(TORCH + 0.25, end - 0.1, t);
    const focus = lf + (human.D - lf) * w + dolly;
    return { t, x, h, z: ZC + dolly, pitch, fov: FOV, focus };
  }
  return { at, ndc, dist, raw };
}
/**
 * When each animal is in the world: the visible interval (any part inside the frame, ±5 %) that
 * overlaps its vignette window, padded 0.1 s — so it appears and disappears only off-screen (checked:
 * off-screen at both ends). Returns { name: [a, b] }. Pure; ~20 ms.
 */
export function presence(cast, cam, names, extentX, { a = 127.0, b = 155.0, dt = 1 / 60 } = {}) {
  const n = Math.round((b - a) / dt), cams = [];
  for (let i = 0; i <= n; i++) cams.push(cam.at(a + i * dt));
  const out = {};
  for (const name of names) {
    const A = cast[name], vis = [];
    for (let i = 0; i <= n; i++) {
      const t = a + i * dt, c = cams[i], [xl, xr] = extentX(A, t);
      const l = ndc(c, [xl, 0, A.z])[0], r = ndc(c, [xr, 0, A.z])[0];
      vis.push(r > -1.05 && l < 1.05);
    }
    const w0 = Math.round((A.window[0] - a) / dt), w1 = Math.round((A.window[1] - a) / dt);
    let i0 = -1; for (let i = w0; i <= w1; i++) if (vis[i]) { i0 = i; break; }
    if (i0 < 0) { out[name] = [A.window[0], A.window[1]]; continue; }
    let s = i0; while (s > 0 && vis[s - 1]) s--;
    let e = i0; for (let i = i0; i <= w1; i++) if (vis[i]) e = i;
    while (e < n && vis[e + 1]) e++;
    out[name] = [Math.max(a, a + s * dt - 0.1), Math.min(b, a + e * dt + 0.1)];
  }
  return out;
}
/** Screen position (NDC, x right / y up) of a walk-local point p = [x, y, z] from camera state c. */
export function ndc(c, p) {
  const dx = p[0] - c.x, dy = p[1] - c.h, dz = c.z - p[2];
  const cp = Math.cos(c.pitch), sp = Math.sin(c.pitch);
  const depth = dz * cp + dy * sp, yv = dy * cp - dz * sp;
  return [dx / (depth * TANH * ASPECT), yv / (depth * TANH), depth];
}
export function dist(c, p) { return Math.hypot(p[0] - c.x, p[1] - c.h, p[2] - c.z); }
