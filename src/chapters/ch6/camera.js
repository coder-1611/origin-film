// VI · LIFE: camera authoring. The film reads T.cameras.VI (src/timeline.js), which is GENERATED from
// this file by `node src/chapters/ch6/camera.js` (prints the literal; paste into the VI entry).
// Not imported by the chapter at runtime, except for the walk frame (MARCH_FRAME), which must agree.
//   105–113.9   macro on the live colony, crane back and up, rise through the surface
//   114–126     over-under at the waterline (the forest sprouts; the school gathers; the breach at B)
//   B … B+1.4   tilt up with the rising flock, swing right to the sun, level off, low over the wash
//   B+1.4 … 151 the shore: the documentary drift of src/march/camera.js (each animal met in turn, the
//               camera lower and closer for small animals), settling so the torch flame is at the exact
//               centre with the horizon through it at the catch (a key lands exactly on it)
//   151.25–155  night: dolly straight back along the axis (the flame stays centred and shrinks)
import * as L from './layout.js';
import { ZC, TORCH } from '../../march/beats.js';
import { makeCast } from '../../march/beats.js';
import { makeCamera } from '../../march/camera.js';
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
  start: [0.25, 0.7, 0.9],                 // world position of the walk-local point (0, 0.7, ZC)
};
MARCH_FRAME.O = add(MARCH_FRAME.start, MARCH_FRAME.Z, -ZC).map((v, i) => i === 1 ? 0 : v);

/** A camera key (world) from the pure drift camera's state c = { x, h, z, pitch, fov } (walk-local). */
export function worldKey(c, t) {
  const F = MARCH_FRAME;
  const pos = add(add(add(F.O, F.X, c.x), F.Z, c.z), [0, 1, 0], c.h);
  const dir = add(F.Z.map(v => -v * Math.cos(c.pitch)), [0, 1, 0], Math.sin(c.pitch));
  return { t, pos, target: add(pos, dir, 3), fov: c.fov, roll: 0 };
}

export function buildKeys(T) {
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
  // the shore: dense samples of the drift camera (a key exactly at the torch)
  const cam = makeCamera(makeCast(), { end: T.chapterWindow('VI')[1] });
  keys.push(worldKey(cam.at(B + 1.36), B + 1.36));
  const end = T.chapterWindow('VI')[1], TO = TORCH;
  const t0 = TO - 0.25 * Math.floor((TO - (B + 1.6)) / 0.25 + 1e-9), n = Math.round((end - t0) / 0.25);
  for (let i = 0; i <= n; i++) { const t = +(t0 + i * 0.25).toFixed(4); keys.push(worldKey(cam.at(t), t)); }
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
