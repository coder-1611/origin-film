// VI · LIFE: where the school / flock wants to be at time t (a pure function of t).
//   B−3.6 … B−0.5  the school swims in from the left and gathers into a bait ball below the waterline
//   B−0.5 … B+0.3  the fish turn up and breach (B = T.BREACH_T is the middle of the breach)
//   B … B+2        the birds climb out over the sea toward the sun
//   B+2 … the end  a murmuration wheeling in the sunset sky above the march, framed by its camera
import * as L from './layout.js';
import { marchPlan } from '../../march/plan.js';

export const CM = [0.05, -0.43, -0.95];                // bait-ball (mill) centre

export const makeFlockGoal = (T) => {
  const ss = T.smootherstep, pwl = T.pwl;
  const MP = marchPlan(), B = T.BREACH_T, M0 = MP.t0, TO = MP.torch;
  const RISE0 = B - 0.5, RISE_SPAN = 0.72;           // each fish turns up at RISE0 + trait·RISE_SPAN
  const f = [Math.sin(L.SUN_AZ), 0, -Math.cos(L.SUN_AZ)], rt = [Math.cos(L.SUN_AZ), 0, Math.sin(L.SUN_AZ)];
  // the murmuration's centre: ~44 m out toward the sun, 5 m up, a little right of centre; it
  // rides along with the march camera's truck and wanders slowly
  const M = (t) => {
    const c = T.sampleCamera(T.cameras.VI, Math.min(Math.max(t, M0 + 0.5), TO + 0.2)).pos;
    const dx = 3.5 + 2.5 * Math.sin(t * 0.37 + 1.0), dy = 5.0 + 0.8 * Math.sin(t * 0.29);
    return [c[0] + f[0] * 44 + rt[0] * dx, dy + c[1] * 0.6, c[2] + f[2] * 44 + rt[2] * dx];
  };
  const path = [[B, [0.1, 1.0, -1.4]], [B + 0.3, [1.0, 2.2, -4.5]], [B + 0.7, [3.8, 3.4, -9.0]], [B + 1.2, [8.5, 3.8, -13.5]], [B + 2.0, [18, 4.0, -19]]];
  return function flockGoal(t) {
    const e = ss(B - 3.6, B - 2.4, t);
    let p = [-1.8 + (CM[0] + 1.8) * e, -0.55 + (CM[1] + 0.55) * e, -1.2 + (CM[2] + 1.2) * e];
    p = [p[0] + 0.1 * Math.sin(t * 0.7), p[1] + 0.05 * Math.sin(t * 1.1), p[2] + 0.08 * Math.cos(t * 0.6)];
    const rs = ss(RISE0 - 0.1, RISE0 + 0.6, t);
    p = [p[0] + (0.1 - p[0]) * rs, p[1] + (1.5 - p[1]) * rs, p[2] + (-1.0 - p[2]) * rs];
    let bp;
    if (t <= B + 2.0) bp = [0, 1, 2].map(j => pwl(path.map(([tt, v]) => [tt, v[j]]), t));
    else {
      const a = path[path.length - 1][1], m = M(t), u = ss(B + 2.0, B + 4.0, t);
      bp = [0, 1, 2].map(j => a[j] + (m[j] - a[j]) * u);
    }
    // each bird's own place on a folding sheet around the goal: the murmuration's shape
    const grow = ss(B - 0.05, B + 0.6, t), big = ss(B + 1.5, B + 4.5, t);
    const W = 1.2 + 3.2 * grow + 3.3 * big, Hh = 0.8 + 1.6 * grow + 0.9 * big, Dd = 0.6 + 2.2 * grow + 1.8 * big;
    const fold = t * 0.9, twist = 0.5 * Math.sin(t * 0.43);
    const sheet = (u, v, out) => {
      const x = u * W, y = v * Hh * 0.35 + Math.sin(u * 2.3 + fold) * Hh * 0.55 + Math.cos(v * 1.7 - fold * 0.7) * Hh * 0.2;
      const z = Math.sin(u * 1.8 - fold * 0.8 + v * 0.9) * Dd;
      const c = Math.cos(twist), s2 = Math.sin(twist);
      const xr = x * c - z * s2, zr = x * s2 + z * c;
      out[0] = rt[0] * xr + f[0] * zr; out[1] = y; out[2] = rt[2] * xr + f[2] * zr;
    };
    return {
      p, k: 2.0 * (1 - ss(B - 3.1, B - 2.3, t)) + 0.6, mill: 3.2 * ss(B - 3.0, B - 2.1, t), orbit: 1.25,
      rise0: RISE0, riseSpan: RISE_SPAN,
      vmin: 0.5, vmax: t < B - 2.2 ? 2.1 : 1.5, bird: t > RISE0 + 0.1, b0: B,
      bp, sheet, bk: t < B + 2.5 ? 18 : 12, bmin: 4.5, bmax: 13, wheel: 3 * ss(B + 3, B + 5, t),
    };
  };
};
