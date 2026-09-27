// ch3/galaxy.js: the density-wave spiral galaxy (pure JS, deterministic, no THREE).
//
// Lin–Shu style kinematic density wave (the "ellipse" construction): every star rides a centred
// ellipse whose position angle rotates with its semi-major axis, θ(a) = θ0 + K·ln(1 + a/aT).
// Neighbouring ellipses crowd together along two trailing loci, and those crowds are the arms.
// Old stars flow through the pattern (differential rotation); young stars, clusters and HII knots
// are born where the crowding (gas compression) is strongest and stay in the pattern frame.
//
// Galaxy units: disk radius ≈ 1. The disk lies in the XZ plane, +Y is the pole.
import { mulberry32 } from '../../timeline.js';

export const G = {
  rd: 0.30, aMin: 0.035, aMax: 1.25,
  K: 3.0, aT: 0.11,        // orientation twist
  eMax: 0.20,
  vc: 0.012, aCo: 0.62,    // flat rotation curve; corotation radius (pattern-frame speeds)
  hOld: 0.022, hYoung: 0.007,
  MAP: 512, EXT: 1.35,     // disk maps cover [-EXT, EXT]² in x/z
  tRef: 43.0,              // orbital phases are defined at this film time
  jA: 0.06, jU: 0.04,     // dispersion of the pattern (radial, along-orbit)
  yA: 0.03, yU: 0.03, yK0: 0.85, yK1: 1.5, yPow: 1.0,   // young-star acceptance vs crowding contrast
};

// Anchors (pattern frame). The nebula sits on an arm crest at r = 0.55 (the pattern is rotated at
// build time so a crest passes exactly through it); the Sun sits on an outer arm.
export const R_NEB = 0.55, PHI_NEB = 2.45;          // polar position of the nebula (radians)
export const NEB = [R_NEB * Math.cos(PHI_NEB), 0, R_NEB * Math.sin(PHI_NEB)];
export const NEB_R = 0.018;                         // nebula sphere radius (galaxy units)
export const NU = NEB_R / 10;                       // one nebula unit (the raymarch works in these)
export const SUN = [0.74586, 0.0006, 0.28929];     // the future Sun, on an outer-arm crest (r = 0.8)

const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export const thetaOf = (a, th0) => th0 + G.K * Math.log(1 + a / G.aT);
export const eccOf = (a) => G.eMax * sstep(0.02, 0.3, a) * (1 - 0.3 * sstep(1.0, 1.35, a));
/** Pattern-frame angular speed along the ellipse (rad/s of film time). */
export const omegaOf = (a) => G.vc * (1 / Math.max(a, 0.06) - 1 / G.aCo);

function gauss(R) { let u = R(); if (u < 1e-12) u = 1e-12; return Math.sqrt(-2 * Math.log(u)) * Math.cos(6.283185307179586 * R()); }
function sampleA(R) {           // p(a) ∝ a·exp(-a/rd), truncated
  for (;;) { const a = -G.rd * Math.log(Math.max(1e-12, R() * R())); if (a >= G.aMin && a <= G.aMax) return a; }
}
/** Point on the ellipse of semi-major a at parameter u (pattern frame, XZ). */
function ellipse(a, u, th0) {
  const e = eccOf(a), th = thetaOf(a, th0);
  const lx = a * Math.cos(u), lz = a * (1 - e) * Math.sin(u);
  const c = Math.cos(th), s = Math.sin(th);
  return [lx * c - lz * s, lx * s + lz * c];
}

// Flocculent patchiness: a smooth deterministic value-noise field in the disk plane.
function vhash(i, j) { let h = (i * 374761393 + j * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function vnoise2(x, y) {
  const i = Math.floor(x), j = Math.floor(y), u = x - i, v = y - j, su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v);
  return (vhash(i, j) * (1 - su) + vhash(i + 1, j) * su) * (1 - sv) + (vhash(i, j + 1) * (1 - su) + vhash(i + 1, j + 1) * su) * sv;
}
export function flocc(x, z) {
  const n = 0.55 * vnoise2(x * 9 + 3.1, z * 9 - 7.7) + 0.3 * vnoise2(x * 23 - 1.3, z * 23 + 4.2) + 0.15 * vnoise2(x * 51, z * 51);
  return Math.min(1, Math.max(0, (n - 0.3) * 2.2));
}

// ---------------------------------------------------------------- maps
const M = G.MAP;
function splat(map, x, z, w) {
  const fx = (x + G.EXT) / (2 * G.EXT) * M - 0.5, fz = (z + G.EXT) / (2 * G.EXT) * M - 0.5;
  const ix = Math.floor(fx), iz = Math.floor(fz);
  if (ix < 0 || iz < 0 || ix >= M - 1 || iz >= M - 1) return;
  const ux = fx - ix, uz = fz - iz, i = iz * M + ix;
  map[i] += w * (1 - ux) * (1 - uz); map[i + 1] += w * ux * (1 - uz);
  map[i + M] += w * (1 - ux) * uz; map[i + M + 1] += w * ux * uz;
}
function sample(map, x, z) {
  const fx = (x + G.EXT) / (2 * G.EXT) * M - 0.5, fz = (z + G.EXT) / (2 * G.EXT) * M - 0.5;
  const ix = Math.floor(fx), iz = Math.floor(fz);
  if (ix < 0 || iz < 0 || ix >= M - 1 || iz >= M - 1) return 0;
  const ux = fx - ix, uz = fz - iz, i = iz * M + ix;
  return (map[i] * (1 - ux) + map[i + 1] * ux) * (1 - uz) + (map[i + M] * (1 - ux) + map[i + M + 1] * ux) * uz;
}
function blur(src, sigma) {
  const r = Math.ceil(sigma * 3), k = new Float32Array(2 * r + 1);
  let s = 0; for (let i = -r; i <= r; i++) { k[i + r] = Math.exp(-i * i / (2 * sigma * sigma)); s += k[i + r]; }
  for (let i = 0; i < k.length; i++) k[i] /= s;
  const tmp = new Float32Array(M * M), out = new Float32Array(M * M);
  for (let y = 0; y < M; y++) {
    const row = y * M;
    for (let x = 0; x < M; x++) {
      let acc = 0;
      for (let j = -r; j <= r; j++) { const xx = x + j; if (xx >= 0 && xx < M) acc += src[row + xx] * k[j + r]; }
      tmp[row + x] = acc;
    }
  }
  for (let y = 0; y < M; y++) {
    for (let x = 0; x < M; x++) {
      let acc = 0;
      for (let j = -r; j <= r; j++) { const yy = y + j; if (yy >= 0 && yy < M) acc += tmp[yy * M + x] * k[j + r]; }
      out[y * M + x] = acc;
    }
  }
  return out;
}
/** Density of the bare ellipse pattern (the "crowding" map) for a given θ0. */
function patternMap(th0, n, seed) {
  const R = mulberry32(seed), map = new Float32Array(M * M);
  for (let i = 0; i < n; i++) {
    const a = sampleA(R), u = R() * 6.283185307179586;
    const [x, z] = ellipse(a * (1 + G.jA * gauss(R)), u + G.jU * gauss(R), th0);
    splat(map, x, z, 1);
  }
  return map;
}
function crestAngle(map, r) {
  let best = -1, bestPhi = 0;
  for (let i = 0; i < 1440; i++) {
    const phi = i / 1440 * 6.283185307179586;
    const v = sample(map, r * Math.cos(phi), r * Math.sin(phi));
    if (v > best) { best = v; bestPhi = phi; }
  }
  return bestPhi;
}

// Blackbody-ish star colour (normalised so max = 1), linear.
export function starColor(K) {
  const k = Math.min(40000, Math.max(1000, K)) / 100;
  let r, g, b;
  r = k <= 66 ? 1 : Math.min(1, 1.29293618606 * Math.pow(k - 60, -0.1332047592));
  g = k <= 66 ? Math.min(1, Math.max(0, 0.39008157876 * Math.log(k) - 0.63184144378)) : Math.min(1, 1.12989086089 * Math.pow(k - 60, -0.0755148492));
  b = k >= 66 ? 1 : (k <= 19 ? 0 : Math.min(1, Math.max(0, 0.54320678911 * Math.log(k - 10) - 1.19625408914)));
  return [Math.pow(r, 2.2), Math.pow(g, 2.2), Math.pow(b, 2.2)];
}

// Reference PSF solid angle (sr) for fov 55°, σ = 0.0015 NDC-y: the shader uses the same numbers.
export const PSF_SIGMA_NDC = 0.0015;
const SR_REF = 2 * Math.PI * Math.pow(PSF_SIGMA_NDC * Math.tan(27.5 * Math.PI / 180), 2);
/** Luminosity giving a peak radiance `peak` when seen from distance d. */
const Lum = (peak, d) => peak * d * d * SR_REF;

// ---------------------------------------------------------------- build
export const POP = { OLD: 0, BULGE: 1, YOUNG: 2, CLUSTER: 3, HII: 4, LOCAL_N: 5, LOCAL_S: 6 };

/**
 * Builds everything. Returns { th0, sun, counts, orb, ext, col, maps: Float32Array(M*M*4) }.
 * orb = (A, B, θ, u0): position = rot(θ)·(A cos u, B sin u), u = u0 + ω (t − tRef)
 * ext = (y, ω, pop, seed)     col = (r, g, b, L)
 */
export function buildGalaxy({ scale = 1 } = {}) {
  // Pass 1: find where a crest crosses r = R_NEB with θ0 = 0, then rotate the pattern onto the nebula.
  const probe = blur(patternMap(0, 600000, 0x61A1), 1.5);
  const th0 = PHI_NEB - crestAngle(probe, R_NEB);

  // Pass 2: the real pattern maps.
  const raw = patternMap(th0, 3000000, 0x61A2);
  const arm = blur(raw, 1.6), smooth = blur(raw, 9);
  const contrast = (x, z) => { const s = sample(smooth, x, z); return s > 1e-6 ? sample(arm, x, z) / s : 0; };

  const R = mulberry32(0x5EED3);
  const orb = [], ext = [], col = [], cnt = {};
  const push = (A, B, th, u0, y, w, pop, seed, c, L) => {
    orb.push(A, B, th, u0); ext.push(y, w, pop, seed); col.push(c[0], c[1], c[2], L);
    cnt[pop] = (cnt[pop] || 0) + 1;
  };
  const N = (n) => Math.round(n * scale);

  // Old disk: flows through the arms.
  for (let i = 0; i < N(100000); i++) {
    const a = sampleA(R) * (1 + 0.06 * gauss(R)), e = eccOf(a), th = thetaOf(a, th0) + 0.05 * gauss(R);
    const K = 3600 + 2600 * Math.pow(R(), 1.6);
    const peak = 0.10 + 0.55 * Math.pow(R(), 5);
    push(a, a * (1 - e), th, R() * 6.2831853, G.hOld * gauss(R) * (0.6 + 0.8 * a), omegaOf(a), POP.OLD, R(), starColor(K), Lum(peak, 2.3));
  }
  // Bulge: flattened Hernquist sphere of warm stars, slow solid-ish rotation.
  for (let i = 0; i < N(26000); i++) {
    const u = Math.max(1e-6, R() * 0.93);
    const r = 0.075 * Math.sqrt(u) / (1 - Math.sqrt(u));
    const ct = 2 * R() - 1, ph = R() * 6.2831853, st = Math.sqrt(1 - ct * ct);
    const x = r * st * Math.cos(ph), z = r * st * Math.sin(ph), y = r * ct * 0.62;
    const rr = Math.hypot(x, z);
    const K = 3000 + 1700 * R();
    push(rr, rr, Math.atan2(z, x), 0, y, 0.10 / (1 + rr * 8), POP.BULGE, R(), starColor(K), Lum(0.12 + 0.5 * Math.pow(R(), 6), 2.3));
  }
  // Young stars: accepted where the ellipses crowd (the arm crests).
  const young = [];
  for (let tries = 0; young.length < N(42000) && tries < 3e6; tries++) {
    const a = sampleA(R); if (a < 0.12) continue;
    const u = R() * 6.2831853;
    const [x, z] = ellipse(a * (1 + G.yA * gauss(R)), u + G.yU * gauss(R), th0);
    const c = contrast(x, z);
    const p = Math.pow(Math.min(1, Math.max(0, (c - G.yK0) * G.yK1)), G.yPow) * flocc(x, z);
    if (R() > p) continue;
    young.push([x, z, c]);
    const K = 9000 + 16000 * Math.pow(R(), 1.5);
    push(Math.hypot(x, z), Math.hypot(x, z), Math.atan2(z, x), 0, G.hYoung * gauss(R), 0, POP.YOUNG, R(), starColor(K), Lum(0.25 + 1.4 * Math.pow(R(), 5), 2.3));
  }
  // OB associations: clumps seeded on the strongest crests; some of them light an HII knot.
  const knots = [];
  for (let i = 0; i < N(2600); i++) {
    const s = young[Math.floor(R() * young.length)];
    if (s[2] < 1.3 && R() < 0.75) continue;
    const r0 = Math.hypot(s[0], s[1]), rad = 0.004 + 0.008 * R();
    const m = 6 + Math.floor(R() * 22);
    for (let k = 0; k < m; k++) {
      const x = s[0] + rad * gauss(R), z = s[1] + rad * gauss(R);
      const K = 12000 + 18000 * R();
      push(Math.hypot(x, z), Math.hypot(x, z), Math.atan2(z, x), 0, G.hYoung * 0.6 * gauss(R), 0, POP.CLUSTER, R(), starColor(K), Lum(0.3 + 1.6 * Math.pow(R(), 4), 2.3));
    }
    if (R() < 0.42 && r0 > 0.2) {
      // push the knot slightly downstream (outward of the dust lane on the crest)
      const x = s[0] * 1.012, z = s[1] * 1.012;
      knots.push([x, z]);
      const size = 0.0035 + 0.009 * Math.pow(R(), 2);
      push(Math.hypot(x, z), Math.hypot(x, z), Math.atan2(z, x), 0, 0, size, POP.HII, R(), [1.0, 0.22, 0.42], Lum(0.9 + 1.6 * R(), 2.3));
    }
  }
  // The nebula's own neighbourhood: the first stars, fading in one by one through 33–43 s.
  for (let i = 0; i < N(14000); i++) {
    const d = NEB_R * (1.0 + 14 * Math.pow(R(), 1.7));
    const ct = 2 * R() - 1, ph = R() * 6.2831853, st = Math.sqrt(1 - ct * ct);
    const x = NEB[0] + d * st * Math.cos(ph), z = NEB[2] + d * st * Math.sin(ph);
    const y = Math.max(-1, Math.min(1, ct)) * d * 0.45 * (0.3 + 0.7 * R());
    const K = 3500 + 16000 * Math.pow(R(), 2.2);
    const tb = 32.6 + 10.2 * Math.pow(R(), 0.8);
    push(Math.hypot(x, z), Math.hypot(x, z), Math.atan2(z, x), 0, y, 0, POP.LOCAL_N, tb, starColor(K), Lum(0.03 + 3.0 * Math.pow(R(), 10), 0.03));
  }
  // The Sun: on an outer-arm crest. Its neighbourhood streams past during the dive.
  // (literal so the timeline camera keys can target it; `sunCrest` reports the nearest crest)
  const sun = SUN;
  const sunCrest = crestAngleNear(arm, Math.hypot(SUN[0], SUN[2]), Math.atan2(SUN[2], SUN[0]));
  for (let i = 0; i < N(16000); i++) {
    const d = 0.0008 + 0.06 * Math.pow(R(), 1.6);
    const ct = 2 * R() - 1, ph = R() * 6.2831853, st = Math.sqrt(1 - ct * ct);
    const x = sun[0] + d * st * Math.cos(ph), z = sun[2] + d * st * Math.sin(ph);
    const y = sun[1] + ct * Math.min(d, 0.012) * 0.8;
    const K = 3300 + 9000 * Math.pow(R(), 2.0);
    push(Math.hypot(x, z), Math.hypot(x, z), Math.atan2(z, x), 0, y, 0, POP.LOCAL_S, R(), starColor(K), Lum(0.3 + 3.0 * Math.pow(R(), 5), 0.01));
  }

  // Disk maps (RGBA): R = smooth starlight, G = young/arm light, B = dust, A = HII glow.
  const light = new Float32Array(M * M), yl = new Float32Array(M * M), hii = new Float32Array(M * M);
  for (let i = 0; i < orb.length / 4; i++) {
    const A = orb[i * 4], th = orb[i * 4 + 2], u0 = orb[i * 4 + 3], B = orb[i * 4 + 1];
    const lx = A * Math.cos(u0), lz = B * Math.sin(u0), c = Math.cos(th), s = Math.sin(th);
    const x = lx * c - lz * s, z = lx * s + lz * c, pop = ext[i * 4 + 2];
    if (pop === POP.OLD) splat(light, x, z, 1);
    else if (pop === POP.YOUNG || pop === POP.CLUSTER) splat(yl, x, z, 1);
  }
  for (const [x, z] of knots) splat(hii, x, z, 1);
  const L1 = blur(light, 2.5), Y1 = blur(yl, 1.6), H1 = blur(hii, 1.4);
  // Dust: the crowding contrast sampled slightly outward, so lanes sit on the inner (concave) edge
  // of the arms, weighted by the absolute density so the sparse outer disk stays clean.
  const dust = new Float32Array(M * M);
  let smax = 0; for (let i = 0; i < M * M; i++) smax = Math.max(smax, smooth[i]);
  for (let iz = 0; iz < M; iz++) for (let ix = 0; ix < M; ix++) {
    const x = ((ix + 0.5) / M * 2 - 1) * G.EXT, z = ((iz + 0.5) / M * 2 - 1) * G.EXT;
    const r = Math.hypot(x, z);
    const s = sample(smooth, x * 1.045, z * 1.045), a = sample(arm, x * 1.045, z * 1.045);
    const c = s > 1e-6 ? a / s : 0;
    dust[iz * M + ix] = Math.pow(Math.max(0, c - 1.0), 1.2) * Math.pow(s / smax, 0.4) * sstep(0.06, 0.25, r) * (1 - sstep(0.95, 1.3, r));
  }
  dust.set(blur(dust, 1.6));
  // Normalise each channel to a sensible range.
  const norm = (m, q) => { let mx = 0; for (let i = 0; i < m.length; i++) if (m[i] > mx) mx = m[i]; const k = q / (mx || 1); for (let i = 0; i < m.length; i++) m[i] *= k; };
  norm(L1, 1); norm(Y1, 1); norm(H1, 1); norm(dust, 1);
  const maps = new Float32Array(M * M * 4);
  for (let i = 0; i < M * M; i++) { maps[i * 4] = L1[i]; maps[i * 4 + 1] = Y1[i]; maps[i * 4 + 2] = dust[i]; maps[i * 4 + 3] = H1[i]; }

  return {
    th0, sun, sunCrest, sunPhi: Math.atan2(SUN[2], SUN[0]), counts: cnt, n: orb.length / 4,
    orb: new Float32Array(orb), ext: new Float32Array(ext), col: new Float32Array(col), maps,
  };
}
function crestAngleNear(map, r, hint) {
  let best = -1, bestPhi = hint;
  for (let i = -240; i <= 240; i++) {
    const phi = hint + i / 240 * 0.5;
    const v = sample(map, r * Math.cos(phi), r * Math.sin(phi));
    if (v > best) { best = v; bestPhi = phi; }
  }
  return bestPhi;
}
