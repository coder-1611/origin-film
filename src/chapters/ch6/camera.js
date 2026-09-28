// VI · LIFE: camera authoring. The film reads T.cameras.VI (src/timeline.js), which is GENERATED from
// this file by `node src/chapters/ch6/camera.js` (prints the literal; paste into the VI entry).
// Not imported by the chapter at runtime, except for the walk frame (MARCH_FRAME), which must agree.
//   105–113.9   macro on the live colony, crane back and up, rise through the surface
//   114–126     over-under at the waterline (the forest sprouts; the school gathers; the breach at B)
//   B … B+1.4   tilt up with the rising flock, swing right to the sun, level off, zoom in
//   B+1.4 … 151 the march: level, looking at the sun on the horizon (screen centre); trucking so the
//               lead walker's screen x = T.marchX(t); craning up with the raised torch so its flame
//               lands exactly on the horizon at the centre when it catches (T.march.torch)
//   151.25–155  night: dolly straight back along the axis (the flame stays centred and shrinks)
import * as L from './layout.js';
import { makeMarch, MARCH_D, MARCH_FOV } from './march.js';
const { DEG } = L;

export const add = (a, b, s = 1) => a.map((v, i) => v + b[i] * s);
export const K = (t, pos, pitch, fov = 50, yaw = 0, extra = {}) => {
  const p = pitch * DEG, y = yaw * DEG;
  return { t, pos, target: add(pos, [Math.sin(y) * Math.cos(p), Math.sin(p), -Math.cos(y) * Math.cos(p)], 3), fov, roll: 0, ...extra };
};

// walk-local frame → world: x along the shore (screen right), z back toward the camera; the camera
// looks along −z = toward the sun. Origin chosen so the march camera starts right above the breach.
const A = L.SUN_AZ;
export const MARCH_FRAME = {
  X: [Math.cos(A), 0, Math.sin(A)],
  Z: [-Math.sin(A), 0, Math.cos(A)],
  start: [0.25, 0.7, 0.9],                 // world camera position at march.t0
};
MARCH_FRAME.O = add(MARCH_FRAME.start, MARCH_FRAME.Z, -MARCH_D).map((v, i) => i === 1 ? 0 : v);

export function marchCamera(T, m, t) {
  const F = MARCH_FRAME;
  const M = T.march;
  const hWalk = 0.7 + 0.55 * T.smootherstep(M.t0, m.lastStep, t);
  const fl = m.at(Math.min(t, M.torch)).flame;
  const aimY = fl ? fl[1] + (m.flameEnd[1] - m.at(M.torch).flame[1]) : 0;      // the flame's visual centre
  const h = fl ? hWalk + (aimY - hWalk) * T.smootherstep(M.standAt - 0.1, M.torch - 0.05, t) : hWalk;
  const dolly = 38 * T.smootherstep(M.torch + 0.25, T.chapterWindow('VI')[1] - 0.1, t);
  const x = m.camX(t);
  const pos = add(add(add(F.O, F.X, x), F.Z, MARCH_D + dolly), [0, 1, 0], h);
  return { t, pos, target: add(pos, F.Z, -3), fov: MARCH_FOV, roll: 0 };
}

export function buildKeys(T) {
  const m = makeMarch(T);
  const B = T.BREACH_T;
  const keys = [
    K(105.0, add(L.P0, L.N0, 0.16), -12),
    K(108.0, add(L.P0, L.N0, 0.148), -12),
    K(110.0, add(L.P0, L.N0, 0.14), -12),
    K(111.5, add(L.P0, L.N0, 0.30), -13),
    K(112.8, add(add(L.P0, L.N0, 0.44), [0, 0.07, 0]), -18),
    K(113.45, [0, -0.17, -0.84], -19),
    K(113.8, [0, -0.058, -0.71], -9.5),
    K(114.05, [0, -0.009, -0.6], -3.2),
    K(114.3, [0, 0.003, -0.52], -0.6),
    K(114.6, [0, 0.004, -0.45], 0),
    K(114.9, [0, 0.004, -0.39], 0),
    K(118.5, [0, 0.004, 0.0], 0),
    K(122.5, [0, 0.004, 0.33], 0),
    K(B - 0.4, [0, 0.004, 0.5], 0),
    K(B, [0, 0.006, 0.52], 1.5),
    K(B + 0.4, [0.03, 0.13, 0.58], 16, 50, 4),
    K(B + 0.72, [0.12, 0.36, 0.7], 27, 44, 19),
    K(B + 1.02, [0.2, 0.57, 0.82], 17, 35, 39),
  ];
  // the march: dense samples of the walker-derived truck / crane / dolly (a key exactly at the torch)
  keys.push(marchCamera(T, m, B + 1.36));
  const end = T.chapterWindow('VI')[1], TO = T.march.torch;
  const t0 = TO - 0.25 * Math.floor((TO - (B + 1.6)) / 0.25 + 1e-9), n = Math.round((end - t0) / 0.25);
  for (let i = 0; i <= n; i++) keys.push(marchCamera(T, m, +(t0 + i * 0.25).toFixed(4)));
  const r = (v) => +v.toFixed(5);
  return keys.map(k => ({ t: r(k.t), pos: k.pos.map(r), target: k.target.map(r), fov: r(k.fov), roll: 0 }));
}

// node src/chapters/ch6/camera.js  → prints the VI entry for src/timeline.js
if (typeof process !== 'undefined' && process.argv && process.argv[1] && process.argv[1].endsWith('camera.js')) {
  const T = await import('../../timeline.js');
  const keys = buildKeys(T);
  const lines = keys.map((k, i) => `          { t: ${k.t}, pos: [${k.pos.join(', ')}], target: [${k.target.join(', ')}], fov: ${k.fov}, roll: 0 }${i < keys.length - 1 ? ',' : ' ],'}`);
  lines[0] = lines[0].replace(/^ {10}\{/, '  VI:   [ {');
  console.log(lines.join('\n'));
}
