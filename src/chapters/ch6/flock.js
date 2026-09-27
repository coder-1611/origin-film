// VI · LIFE: where the school / flock wants to be at time t (a pure function of t).
import * as L from './layout.js';

// ---------------------------------------------------------------- flock goal
export const CAM_SUNSET = [0.4, 1.5, 1.0];
export const CM = [0.05, -0.43, -0.95];                // bait-ball (mill) centre
export const makeFlockGoal = (T) => function flockGoal(t) {
  const ss = T.smootherstep, pwl = T.pwl;
  const e = ss(119.6, 121.5, t);
  let p = [-2.6 + (CM[0] + 2.6) * e, -0.55 + (CM[1] + 0.55) * e, -1.2 + (CM[2] + 1.2) * e];
  p = [p[0] + 0.1 * Math.sin(t * 0.7), p[1] + 0.05 * Math.sin(t * 1.1), p[2] + 0.08 * Math.cos(t * 0.6)];
  const rs = ss(125.3, 126.2, t);
  p = [p[0] + (0.1 - p[0]) * rs, p[1] + (1.5 - p[1]) * rs, p[2] + (-1.0 - p[2]) * rs];
  const sf = [Math.sin(L.SUN_AZ), 0, -Math.cos(L.SUN_AZ)];
  const M = [CAM_SUNSET[0] + sf[0] * 30, 3.7, CAM_SUNSET[2] + sf[2] * 30];
  const path = [[126.0, [0.1, 1.2, -1.2]], [126.6, [0.5, 2.4, -4.0]], [127.4, [2.8, 4.6, -8.0]], [128.4, [8.0, 6.0, -11.5]], [129.4, [14.5, 5.2, -15.0]], [130.4, M]];
  let bp;
  const rt = [-sf[2], 0, sf[0]];
  if (t <= 130.4) bp = [0, 1, 2].map(j => pwl(path.map(([tt, v]) => [tt, v[j]]), t));
  else {
    // wheel around the sun: a slow loop in the plane facing the camera
    const w = (t - 130.4) * 2 * Math.PI / 4.8;
    const R = 4.5 * Math.sin(w) - 1.8 * Math.min(1, (t - 130.4) / 1.5);
    bp = [M[0] + rt[0] * R + sf[0] * 3 * (1 - Math.cos(w)), M[1] + 1.5 * Math.sin(w * 2.0) * 0.8, M[2] + rt[2] * R + sf[2] * 3 * (1 - Math.cos(w))];
  }
  // each bird's own place on a folding sheet around the goal: the murmuration's shape
  const grow = ss(126.2, 128.5, t), big = ss(128.5, 130.8, t);
  const W = 1.2 + 2.0 * grow + 3.2 * big, Hh = 0.8 + 0.9 * grow + 1.3 * big, Dd = 0.6 + 1.0 * grow + 2.5 * big;
  const fold = t * 0.9, twist = 0.5 * Math.sin(t * 0.43);
  const sheet = (u, v, out) => {
    const x = u * W, y = v * Hh * 0.35 + Math.sin(u * 2.3 + fold) * Hh * 0.55 + Math.cos(v * 1.7 - fold * 0.7) * Hh * 0.2;
    const z = Math.sin(u * 1.8 - fold * 0.8 + v * 0.9) * Dd;
    const c = Math.cos(twist), s2 = Math.sin(twist);
    const xr = x * c - z * s2, zr = x * s2 + z * c;
    out[0] = rt[0] * xr + sf[0] * zr; out[1] = y; out[2] = rt[2] * xr + sf[2] * zr;
  };
  return {
    p, k: 2.0 * (1 - ss(120.8, 121.8, t)) + 0.6, mill: 3.2 * ss(120.6, 121.8, t), orbit: 1.25,
    rise0: 125.45, riseSpan: 0.85,
    vmin: 0.5, vmax: 1.5, bird: t > 125.6,
    bp, sheet, bk: 12, bmin: 4.5, bmax: 13, wheel: 3 * ss(129.8, 131, t),
  };
};
