// Tileable 3D noise volume shared by chapters I and II (computed once, deterministically).
//   R, G, B: three independent 4-octave gradient-noise fbm fields (0.5 = zero crossing)
//   A:       Worley F2 - F1 (0 on cell walls): the "foam" walls
// 128^3 RGBA8, repeat-wrapped, trilinear. Sample with texture(noiseTex, p) where p is in
// "tiles" (one tile = the whole 128^3 volume).
import { mulberry32 } from '../../timeline.js';

const SIZE = 128;
let cached = null;

function perlinFbm(out, channel, seed, basePeriod, octaves) {
  const N = SIZE, N3 = N * N * N;
  const acc = new Float32Array(N3);
  let amp = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    const P = basePeriod << o;                 // lattice cells per tile
    const rnd = mulberry32(seed * 7919 + o * 104729 + 13);
    const G = new Float32Array(P * P * P * 3);
    for (let i = 0; i < P * P * P; i++) {       // random unit gradients
      const z = rnd() * 2 - 1, a = rnd() * Math.PI * 2, s = Math.sqrt(1 - z * z);
      G[i * 3] = s * Math.cos(a); G[i * 3 + 1] = s * Math.sin(a); G[i * 3 + 2] = z;
    }
    const step = P / N;
    const I0 = new Int32Array(N), F = new Float32Array(N), W = new Float32Array(N);
    for (let x = 0; x < N; x++) {
      const fx = (x + 0.5) * step, i0 = Math.floor(fx), f = fx - i0;
      I0[x] = i0; F[x] = f; W[x] = f * f * f * (f * (f * 6 - 15) + 10);
    }
    const idx = (i, j, k) => ((((k % P) * P) + (j % P)) * P + (i % P)) * 3;
    let o3 = 0;
    for (let z = 0; z < N; z++) {
      const k0 = I0[z], fz = F[z], wz = W[z];
      for (let y = 0; y < N; y++) {
        const j0 = I0[y], fy = F[y], wy = W[y];
        for (let x = 0; x < N; x++, o3++) {
          const i0 = I0[x], fx = F[x], wx = W[x];
          let g, n000, n100, n010, n110, n001, n101, n011, n111;
          g = idx(i0, j0, k0);         n000 = G[g] * fx + G[g + 1] * fy + G[g + 2] * fz;
          g = idx(i0 + 1, j0, k0);     n100 = G[g] * (fx - 1) + G[g + 1] * fy + G[g + 2] * fz;
          g = idx(i0, j0 + 1, k0);     n010 = G[g] * fx + G[g + 1] * (fy - 1) + G[g + 2] * fz;
          g = idx(i0 + 1, j0 + 1, k0); n110 = G[g] * (fx - 1) + G[g + 1] * (fy - 1) + G[g + 2] * fz;
          g = idx(i0, j0, k0 + 1);     n001 = G[g] * fx + G[g + 1] * fy + G[g + 2] * (fz - 1);
          g = idx(i0 + 1, j0, k0 + 1); n101 = G[g] * (fx - 1) + G[g + 1] * fy + G[g + 2] * (fz - 1);
          g = idx(i0, j0 + 1, k0 + 1); n011 = G[g] * fx + G[g + 1] * (fy - 1) + G[g + 2] * (fz - 1);
          g = idx(i0 + 1, j0 + 1, k0 + 1); n111 = G[g] * (fx - 1) + G[g + 1] * (fy - 1) + G[g + 2] * (fz - 1);
          const x00 = n000 + (n100 - n000) * wx, x10 = n010 + (n110 - n010) * wx;
          const x01 = n001 + (n101 - n001) * wx, x11 = n011 + (n111 - n011) * wx;
          const y0 = x00 + (x10 - x00) * wy, y1 = x01 + (x11 - x01) * wy;
          acc[o3] += amp * (y0 + (y1 - y0) * wz);
        }
      }
    }
    norm += amp; amp *= 0.5;
  }
  // Normalise by the measured spread so the field uses the 8-bit range well.
  let s2 = 0; for (let i = 0; i < N3; i++) s2 += acc[i] * acc[i];
  const sd = Math.sqrt(s2 / N3) || 1;
  for (let i = 0; i < N3; i++) {
    const v = 0.5 + acc[i] / sd * 0.16;             // ±3.1 sd fills [0, 1]
    out[i * 4 + channel] = Math.max(0, Math.min(255, Math.round(v * 255)));
  }
}

function worleyWalls(out, channel, seed, P) {
  const N = SIZE;
  const rnd = mulberry32(seed);
  const FP = new Float32Array(P * P * P * 3);
  for (let i = 0; i < P * P * P * 3; i++) FP[i] = 0.1 + 0.8 * rnd();
  const scale = P / N;
  let o3 = 0;
  for (let z = 0; z < N; z++) {
    const pz = (z + 0.5) * scale, cz = Math.floor(pz);
    for (let y = 0; y < N; y++) {
      const py = (y + 0.5) * scale, cy = Math.floor(py);
      for (let x = 0; x < N; x++, o3++) {
        const px = (x + 0.5) * scale, cx = Math.floor(px);
        let d1 = 1e9, d2 = 1e9;
        for (let dk = -1; dk <= 1; dk++) {
          const kk = cz + dk, km = ((kk % P) + P) % P;
          for (let dj = -1; dj <= 1; dj++) {
            const jj = cy + dj, jm = ((jj % P) + P) % P;
            for (let di = -1; di <= 1; di++) {
              const ii = cx + di, im = ((ii % P) + P) % P;
              const f = ((km * P + jm) * P + im) * 3;
              const ex = ii + FP[f] - px, ey = jj + FP[f + 1] - py, ez = kk + FP[f + 2] - pz;
              const d = ex * ex + ey * ey + ez * ez;
              if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
            }
          }
        }
        const v = Math.sqrt(d2) - Math.sqrt(d1);          // 0 on the walls
        out[o3 * 4 + channel] = Math.max(0, Math.min(255, Math.round(v * 1.6 * 255)));
      }
    }
  }
}

/** The shared RGBA8 128^3 noise volume (built once per page). */
export function getNoise3D(THREE) {
  if (cached) return cached;
  const data = new Uint8Array(SIZE * SIZE * SIZE * 4);
  perlinFbm(data, 0, 101, 4, 4);
  perlinFbm(data, 1, 202, 4, 4);
  perlinFbm(data, 2, 303, 4, 4);
  worleyWalls(data, 3, 404, 8);
  const tex = new THREE.Data3DTexture(data, SIZE, SIZE, SIZE);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.RepeatWrapping;
  tex.generateMipmaps = false;
  tex.unpackAlignment = 1;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  cached = tex;
  return tex;
}
