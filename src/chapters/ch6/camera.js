// VI · LIFE: camera authoring helper. The film reads T.cameras.VI (src/timeline.js), which was
// generated from these keys (rounded to 5 decimals). Not imported at runtime.
import * as L from './layout.js';
import { CAM_SUNSET } from './flock.js';
const { DEG } = L;
export const add = (a, b, s = 1) => a.map((v, i) => v + b[i] * s);
export const K = (t, pos, pitch, fov = 50, yaw = 0, extra = {}) => {
  const p = pitch * DEG, y = yaw * DEG;
  return { t, pos, target: add(pos, [Math.sin(y) * Math.cos(p), Math.sin(p), -Math.cos(y) * Math.cos(p)], 3), fov, roll: 0, ...extra };
};
const SUN_YAW = L.SUN_AZ / DEG;
export const LOCAL_KEYS = [
  K(105.0, add(L.P0, L.N0, 0.16), -12),
  K(108.0, add(L.P0, L.N0, 0.148), -12),
  K(110.0, add(L.P0, L.N0, 0.14), -12),
  K(111.5, add(L.P0, L.N0, 0.30), -13),
  K(112.8, add(add(L.P0, L.N0, 0.52), [0, 0.10, 0]), -20),
  K(113.45, [0, -0.22, L.P0[2] + 0.66], -26),
  K(113.78, [0, -0.035, 0.08], -3),
  K(113.95, [0, 0.004, 0.2], 0),
  K(114.3, [0, 0.004, 0.25], 0),
  K(114.6, [0, 0.004, 0.28], 0),
  K(118.0, [0, 0.004, 0.55], 0),
  K(122.0, [0, 0.004, 0.75], 0),
  K(125.6, [0, 0.004, 0.85], 0),
  K(126.2, [0, 0.03, 0.85], 6, 50, 1),
  K(126.8, [0.05, 0.2, 0.9], 22, 50, 3),
  K(127.7, [0.15, 0.5, 0.95], 24, 48, 13),
  K(128.6, [0.3, 1.0, 1.0], 17, 44, 30),
  K(129.6, [0.4, 1.4, 1.0], 7, 35, 43),
  K(130.6, CAM_SUNSET, 0, 27, SUN_YAW),
  K(131.5, CAM_SUNSET, 0, 25.5, SUN_YAW),
  K(134.0, CAM_SUNSET, 0, 22.5, SUN_YAW),
  K(135.0, CAM_SUNSET, 0, 22.0, SUN_YAW),
];
