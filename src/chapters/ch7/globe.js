// Night-Earth data: a land mask (JS scanline fill, deterministic), city lights with
// procedural suburbs, rural specks and highway strings, and the graticule lines.
import { LAND } from './continents.js';

const D = Math.PI / 180;
export const unit = (lat, lon) => [Math.cos(lat * D) * Math.sin(lon * D), Math.sin(lat * D), Math.cos(lat * D) * Math.cos(lon * D)];

/** Rasterise LAND into an equirectangular Uint8 mask (even-odd per polygon, union across). */
export function landMask(W = 2048, H = 1024) {
  const m = new Uint8Array(W * H);
  const xs = [];
  for (const poly of LAND) {
    const n = poly.length;
    for (let j = 0; j < H; j++) {
      const lat = 90 - (j + 0.5) / H * 180;
      xs.length = 0;
      for (let i = 0; i < n; i++) {
        const [ax, ay] = poly[i], [bx, by] = poly[(i + 1) % n];
        if ((ay <= lat && by > lat) || (by <= lat && ay > lat)) xs.push(ax + (lat - ay) / (by - ay) * (bx - ax));
      }
      if (xs.length < 2) continue;
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const x0 = Math.max(0, Math.ceil((xs[k] + 180) / 360 * W - 0.5)), x1 = Math.min(W - 1, Math.floor((xs[k + 1] + 180) / 360 * W - 0.5));
        for (let x = x0; x <= x1; x++) m[j * W + x] = 255;
      }
    }
  }
  return { data: m, W, H, at(lat, lon) {
    const x = Math.floor(((((lon + 180) % 360) + 360) % 360) / 360 * W), y = Math.min(H - 1, Math.max(0, Math.floor((90 - lat) / 180 * H)));
    return m[y * W + x] > 0;
  } };
}

// Decorative extra towns (not events; they only make the continents legible at night).
const EXTRA = [
  [30.27, -97.74, 0.55], [29.42, -98.49, 0.5], [33.45, -112.07, 0.5], [44.98, -93.27, 0.4], [38.63, -90.2, 0.4], [39.1, -94.58, 0.35],
  [36.16, -86.78, 0.35], [35.23, -80.84, 0.35], [38.9, -77.04, 0.5], [39.95, -75.17, 0.5], [42.33, -83.05, 0.45], [45.5, -73.57, 0.45],
  [29.95, -90.07, 0.35], [35.47, -97.52, 0.3], [40.76, -111.89, 0.3], [36.17, -115.14, 0.35], [45.52, -122.68, 0.35], [32.72, -117.16, 0.45],
  [25.67, -100.31, 0.45], [20.67, -103.35, 0.45], [45.46, 9.19, 0.5], [41.9, 12.5, 0.45], [41.39, 2.17, 0.45], [52.37, 4.9, 0.45],
  [52.23, 21.01, 0.4], [50.45, 30.52, 0.4], [24.71, 46.68, 0.4], [31.55, 74.34, 0.55], [22.57, 88.36, 0.6], [13.08, 80.27, 0.5],
  [12.97, 77.59, 0.5], [10.82, 106.63, 0.5], [30.57, 104.07, 0.5], [30.59, 114.3, 0.5], [23.13, 113.26, 0.6], [25.03, 121.56, 0.45],
  [-37.81, 144.96, 0.45], [-31.95, 115.86, 0.3], [9.03, 38.74, 0.35], [5.6, -0.19, 0.35], [33.57, -7.59, 0.35], [10.48, -66.9, 0.35],
  [-15.79, -47.88, 0.3], [-19.92, -43.94, 0.4], [-30.03, -51.23, 0.35], [50.11, 8.68, 0.4], [48.14, 11.58, 0.35], [53.48, -2.24, 0.4],
  [59.33, 18.07, 0.3], [59.91, 10.75, 0.25], [55.68, 12.57, 0.3], [47.5, 19.04, 0.35], [44.43, 26.1, 0.35], [37.98, 23.73, 0.35],
  [32.08, 34.78, 0.35], [33.31, 44.36, 0.35], [34.53, 69.17, 0.3], [27.7, 85.3, 0.3], [21.03, 105.85, 0.4], [3.14, 101.69, 0.4],
  [35.18, 136.91, 0.45], [33.59, 130.4, 0.35], [43.06, 141.35, 0.3], [-27.47, 153.03, 0.35], [-36.85, 174.76, 0.3], [-8.84, 13.23, 0.35],
  [15.5, 32.56, 0.35], [-6.79, 39.21, 0.35], [36.75, 3.06, 0.35], [36.81, 10.18, 0.3], [40.18, 44.51, 0.25], [41.3, 69.24, 0.3],
];

export function buildLights(T, mask, rng) {
  const P = [];   // [lat, lon, bright, size, kind, city]
  const cities = T.cities;
  const ncity = cities.length;
  const RR = cities.findIndex(c => c[0] === 'Round Rock');
  const weight = (i) => i === RR ? 0.5 : 0.55 + 0.45 * Math.max(0, 1 - i / 40);
  const gauss = () => { let u = 0; while (u < 1e-9) u = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng()); };
  const cluster = (lat, lon, w, city, isRR) => {
    const n = Math.round((isRR ? 34 : 36) + 90 * w);
    const sig = (isRR ? 0.18 : 0.22) + 0.42 * w;
    const arms = [];
    const na = 3 + Math.floor(rng() * 3);
    for (let k = 0; k < na; k++) arms.push(rng() * Math.PI * 2);
    for (let k = 0; k < n; k++) {
      let dla, dlo, dist;
      if (rng() < 0.32) {
        const a = arms[Math.floor(rng() * na)] + gauss() * 0.06, d = Math.pow(rng(), 0.7) * (0.9 + 1.8 * w);
        dla = Math.sin(a) * d + gauss() * 0.05; dlo = Math.cos(a) * d + gauss() * 0.05; dist = d;
      } else {
        dla = gauss() * sig; dlo = gauss() * sig; dist = Math.hypot(dla, dlo);
      }
      const la = lat + dla, lo = lon + dlo / Math.max(0.2, Math.cos(lat * D));
      if (!mask.at(la, lo) && dist > 0.12) continue;
      const b = (0.3 + 0.7 * rng()) * Math.exp(-dist / (sig * 2.2)) * (0.5 + 0.8 * w);
      P.push([la, lo, b, 0.55 + 0.5 * rng(), 1, city]);
    }
  };
  for (let i = 0; i < ncity; i++) {
    const [, lat, lon] = cities[i];
    if (i !== RR) P.push([lat, lon, 1.6 + 1.2 * weight(i), 1.25, 0, i]);
    cluster(lat, lon, weight(i), i, i === RR);
  }
  for (const [lat, lon, w] of EXTRA) { P.push([lat, lon, 0.9 + 1.2 * w, 1.0, 0, -1]); cluster(lat, lon, w * 0.8, -1, false); }
  // rural specks, denser near population
  const pop = cities.map((c, i) => [c[1], c[2], weight(i)]).concat(EXTRA);
  for (let k = 0; k < 42000; k++) {
    const lat = Math.asin(2 * rng() - 1) / D, lon = rng() * 360 - 180;
    if (lat < -56 || lat > 71) continue;
    if (!mask.at(lat, lon)) continue;
    let dens = 0.01;
    for (const [pl, po, w] of pop) {
      const dl = lat - pl, dn = (lon - po) * Math.cos(lat * D);
      const d2 = dl * dl + dn * dn;
      if (d2 < 400) dens += 0.55 * w * Math.exp(-d2 / (2 * 49));
    }
    if (lat > 16 && lat < 31 && lon > -15 && lon < 30) dens *= 0.08;       // Sahara
    if (lat > 16 && lat < 30 && lon > 45 && lon < 56) dens *= 0.2;          // Arabian interior
    if (lat > -14 && lat < 3 && lon > -72 && lon < -50) dens *= 0.15;       // Amazon
    if (lat > 52 && lon > 60) dens *= 0.3;                                  // Siberia
    if (lat > 55 && lon < -60 && lon > -170) dens *= 0.2;                   // northern Canada
    if (lat < -18 && lat > -34 && lon > 120 && lon < 147) dens *= 0.12;     // outback
    if (lat > 35 && lat < 48 && lon > 75 && lon < 110) dens *= 0.2;         // Tibet / Gobi
    if (rng() < Math.min(0.85, dens)) P.push([lat, lon, 0.12 + 0.3 * rng(), 0.45 + 0.3 * rng(), 2, -1]);
  }
  // highway strings between near neighbours
  const nodes = cities.map(c => [c[1], c[2]]).concat(EXTRA.map(e => [e[0], e[1]]));
  const hav = (a, b) => { const x = unit(a[0], a[1]), y = unit(b[0], b[1]); return Math.acos(Math.min(1, x[0] * y[0] + x[1] * y[1] + x[2] * y[2])) / D; };
  const seen = new Set();
  nodes.forEach((a, i) => {
    const near = nodes.map((b, j) => [j, hav(a, b)]).filter(([j, d]) => j !== i && d > 1.5 && d < 13).sort((p, q) => p[1] - q[1]).slice(0, 3);
    for (const [j, d] of near) {
      const key = i < j ? `${i}-${j}` : `${j}-${i}`;
      if (seen.has(key)) continue; seen.add(key);
      const A = unit(a[0], a[1]), B = unit(nodes[j][0], nodes[j][1]);
      const n = Math.floor(d / 0.28);
      const om = d * D, so = Math.sin(om);
      let wet = 0;
      for (let k = 1; k < n; k++) {
        const s = k / n, wa = Math.sin((1 - s) * om) / so, wb = Math.sin(s * om) / so;
        const x = A[0] * wa + B[0] * wb, y = A[1] * wa + B[1] * wb, z = A[2] * wa + B[2] * wb;
        const la = Math.asin(y) / D + (rng() - 0.5) * 0.12, lo = Math.atan2(x, z) / D + (rng() - 0.5) * 0.12;
        if (!mask.at(la, lo)) { wet++; continue; }
        P.push([la, lo, 0.16 + 0.16 * rng(), 0.5, 3, -1]);
      }
      if (wet > n * 0.3) { /* mostly sea: those dots were simply skipped */ }
    }
  });
  const N = P.length;
  const out = { n: N, x: new Float32Array(N), y: new Float32Array(N), z: new Float32Array(N), b: new Float32Array(N), s: new Float32Array(N),
    kind: new Uint8Array(N), city: new Int16Array(N), lon: new Float32Array(N), ph: new Float32Array(N), rr: RR };
  P.forEach(([la, lo, b, s, kind, city], i) => {
    const u = unit(la, lo);
    out.x[i] = u[0]; out.y[i] = u[1]; out.z[i] = u[2]; out.b[i] = b; out.s[i] = s; out.kind[i] = kind; out.city[i] = city; out.lon[i] = lo;
    out.ph[i] = rng();
  });
  return out;
}

/** Graticule lines as arrays of unit vectors: meridians every 15°, parallels every 15°. */
export function graticule() {
  const lines = [];
  for (let lon = -180; lon < 180; lon += 15) {
    const pts = [];
    for (let lat = -75; lat <= 75.001; lat += 2.5) pts.push(unit(lat, lon));
    lines.push({ pts, kind: 'mer', lon });
  }
  for (let lat = -60; lat <= 60; lat += 15) {
    const pts = [];
    for (let lon = -180; lon <= 180.001; lon += 3) pts.push(unit(lat, lon));
    lines.push({ pts, kind: 'par', lat });
  }
  return lines;
}
