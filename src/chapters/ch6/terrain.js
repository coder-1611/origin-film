// VI · LIFE: terrain (sea floor + shore + headland), one heightfield shared by both views.
import { THREE } from '../../engine/gl.js';
import { DEG, SUN_AZ } from './layout.js';

// ---- deterministic JS noise (value noise, hashed lattice) ----
function h2(ix, iy, s) {
  let x = (ix * 374761393 + iy * 668265263 + s * 2147483647) | 0;
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}
export function vnoise2(x, y, s = 0) {
  const ix = Math.floor(x), iy = Math.floor(y);
  let fx = x - ix, fy = y - iy;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const a = h2(ix, iy, s), b = h2(ix + 1, iy, s), c = h2(ix, iy + 1, s), d = h2(ix + 1, iy + 1, s);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
export function fbm2(x, y, oct = 4, s = 0) {
  let a = 0.5, v = 0;
  for (let i = 0; i < oct; i++) { v += a * vnoise2(x, y, s + i * 17); x = x * 2.03 + 1.7; y = y * 2.03 - 3.1; a *= 0.5; }
  return v;
}

function h3(ix, iy, iz, s) {
  let x = (ix * 374761393 + iy * 668265263 + iz * 1440670441 + s * 2147483647) | 0;
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}
export function vnoise3(x, y, z, s = 0) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  let fx = x - ix, fy = y - iy, fz = z - iz;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); fz = fz * fz * (3 - 2 * fz);
  const L = (a, b, t) => a + (b - a) * t;
  const c = (dx, dy, dz) => h3(ix + dx, iy + dy, iz + dz, s);
  return L(L(L(c(0, 0, 0), c(1, 0, 0), fx), L(c(0, 1, 0), c(1, 1, 0), fx), fy), L(L(c(0, 0, 1), c(1, 0, 1), fx), L(c(0, 1, 1), c(1, 1, 1), fx), fy), fz);
}
export function fbm3(x, y, z, oct = 4, s = 0) {
  let a = 0.5, v = 0, tot = 0;
  for (let i = 0; i < oct; i++) { v += a * vnoise3(x, y, z, s + i * 31); tot += a; x = x * 2.07 + 1.3; y = y * 2.07 - 2.1; z = z * 2.07 + 0.7; a *= 0.5; }
  return v / tot;
}

export const ORIGIN = [0, 0, 0.5];              // polar centre of the coast (≈ over-under camera)
/** Distance from ORIGIN to the waterline at azimuth az (radians, + = right of -z). */
export function coastR(az) {
  const a = az / DEG;
  const base = 7.6 + 1.3 * Math.sin(az * 3.1 + 0.4) + 0.7 * Math.sin(az * 7.3 + 1.0) + 0.9 * (fbm2(a * 0.09, 3.3, 3) - 0.5);
  if (a <= 16) return base;
  // the headland curves away to the right; open sea toward the sunset azimuth
  const u = (a - 16) / (SUN_AZ / DEG - 5 - 16);
  if (u >= 1) return 1e5;
  return base + 9 * u + 120 * Math.pow(u, 3.2) / (1.0001 - u * u * u);
}
export function azR(x, z) { return [Math.atan2(x - ORIGIN[0], -(z - ORIGIN[2])), Math.hypot(x - ORIGIN[0], z - ORIGIN[2])]; }

/** Terrain height at (x, z). */
export function heightAt(x, z) {
  const [az, r] = azR(x, z);
  const cr = coastR(az);
  const n = fbm2(x * 0.07, z * 0.07, 5, 11) - 0.5;
  if (r < cr) {
    const dsea = cr - r;
    const floor = -1.38 + 0.12 * n + 0.03 * (fbm2(x * 0.6, z * 0.6, 2, 5) - 0.5);
    const shelf = -0.06 - 0.24 * dsea;
    return Math.max(floor, shelf);
  }
  const land = r - cr;
  const ss = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
  const berm = 0.28 * (1 - Math.exp(-land / 2.2));
  const slope = 0.035 * land * (1 - Math.exp(-land / 30));
  const rolling = 3.2 * (fbm2(x * 0.024, z * 0.024, 4, 31) - 0.32) * ss(5, 35, land);
  const hills = 26 * Math.pow(Math.min(1, Math.max(0, (land - 45) / 320)), 1.15) * (0.3 + 1.0 * fbm2(x * 0.0055, z * 0.0055, 4, 21));
  const bumps = 0.5 * n * Math.min(1, land / 10);
  return -0.06 + berm + slope + Math.max(-0.2, rolling) + hills + bumps;
}

/** Polar terrain mesh around ORIGIN (fine near the camera, coarse far away). */
export function makeTerrainGeometry({ nAz = 360, nR = 200, az0 = -105 * DEG, az1 = 125 * DEG, r0 = 0.15, r1 = 900 } = {}) {
  const pos = new Float32Array((nAz + 1) * (nR + 1) * 3);
  let k = 0;
  for (let j = 0; j <= nR; j++) {
    const u = j / nR;
    const r = r0 * Math.pow(r1 / r0, u);
    for (let i = 0; i <= nAz; i++) {
      const az = az0 + (az1 - az0) * i / nAz;
      const x = ORIGIN[0] + Math.sin(az) * r, z = ORIGIN[2] - Math.cos(az) * r;
      pos[k++] = x; pos[k++] = heightAt(x, z); pos[k++] = z;
    }
  }
  const idx = [];
  for (let j = 0; j < nR; j++) for (let i = 0; i < nAz; i++) {
    const a = j * (nAz + 1) + i, b = a + 1, c = a + nAz + 1, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
