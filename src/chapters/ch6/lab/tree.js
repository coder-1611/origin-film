// VI lab: a developmental space-colonization tree (Runions, Lane & Prusinkiewicz 2007) whose crown
// envelope EXPANDS with time (scaled about the root), so one deterministic run yields the finished
// tree and its whole growth history: every node knows the moment it was laid down. Growth on
// screen is then a pure function of the growth parameter g ∈ [0, 1]:
//   · primary growth: shoots extend from their tips only (older wood never moves or scales);
//   · secondary growth: radii follow the pipe model  r^n = Σ r_child^n + (leaves born here)·a_leaf,
//     evaluated at g, so trunks thicken as the crown they feed grows (da Vinci / Shinozaki);
//   · leaves are born behind the growing tips, unfold, and are shed from wood that has become a
//     limb (subtree carrying more than `limbLeaves` leaves), so trunks and main limbs are bare.
// The leader is apically dominant (it tracks the envelope top), laterals compete for attraction
// points (light/space), tropism bends shoots up, and the crown envelope has noisy lobes plus a
// clumped attraction-point density, which is what gives sky holes and irregular clumps.
import { mulberry32, fbm3, v3, clamp } from './rng.js';

export const TREE_DEFAULTS = {
  seed: 1,
  height: 6.0,            // envelope top (m)
  crownBase: 1.1,         // envelope bottom (m)
  radius: 2.3,            // envelope max radius (m)
  widest: 0.42,           // where along the crown height it is widest (0 bottom … 1 top)
  flat: 0.85,             // profile exponent (<1 rounder shoulders, >1 more pointed)
  lobes: 0.30,            // envelope radius noise (fraction)
  squash: [1.0, 0.92],    // x/z anisotropy of the crown
  lean: [0.0, 0.0],       // crown centre offset (m) (phototropic lean toward open sky)
  nPts: 5200,             // attraction points
  clump: 0.55,            // 0 = uniform points … 1 = strongly clumped (sky holes)
  D: 0.085,               // segment length (m)
  di: 0.95,               // influence radius (m)
  dk: 0.21,               // kill radius (m)
  tropism: 0.16,          // upward bias of laterals (gravitropism, negative = drooping)
  persist: 0.45,          // direction persistence (smooths the zig-zag of plain SCA)
  jitter: 0.10,           // random heading noise
  envIters: 230, maxIters: 330, s0: 0.03, sPow: 1.35,
  leaderWobble: 0.10,
  gEnd: 0.9,
  leaderStop: 0.72,       // the leader stops dominating at this fraction of the height (decurrent crown)
  // leaves
  leavesPerNode: 2.0, spurs: 0.92, leafOut: 1.1, spurLeaves: [4, 8], leafLen: [0.07, 0.11], petiole: 0.028, budDelay: 0.004, unfold: 0.05,
  limbLeaves: 420,        // wood whose subtree bears more leaves than this sheds its own
  leafVariants: [0, 0, 2],
  // pipe model
  pipeN: 2.45, leafPipe: 0.00125, rMin: 0.0023,
};

/** Species presets (merged over TREE_DEFAULTS). Values are envelope/metre scale for a ~6 m tree. */
export const SPECIES = {
  // linden / lime: ovoid crown, leader fading into the crown, broad serrate leaves
  linden: { leaderStop: 0.6, leafVariants: [0, 0, 2], leafLen: [0.07, 0.11], tropism: 0.14 },
  // field maple / hornbeam: rounder, wider, decurrent (the leader dissolves early)
  maple: { leaderStop: 0.55, widest: 0.5, flat: 0.7, radius: 2.6, leafVariants: [2, 2, 1], leafLen: [0.065, 0.10], tropism: 0.10, crownBase: 0.9 },
  // birch: narrow, drooping twigs, small leaves, pale bark
  birch: { leaderStop: 0.9, widest: 0.38, flat: 1.15, radius: 1.8, tropism: -0.08, leafVariants: [0, 1], leafLen: [0.045, 0.07], spurLeaves: [3, 6],
    clump: 0.45, persist: 0.55, bark: 'birch' },
  // oak-like: broad, irregular, lobed crown with strong clumps and gnarly limbs
  oak: { leaderStop: 0.5, widest: 0.55, flat: 0.65, radius: 2.8, lobes: 0.45, clump: 0.7, jitter: 0.18, tropism: 0.06, leafVariants: [1, 2], leafLen: [0.07, 0.11], crownBase: 1.3 },
};

/**
 * Grow a tree. Returns plain typed arrays (see bottom of function) in tree-local metres
 * (root at the origin, y up). Deterministic in `opts.seed`.
 */
export function growTree(opts = {}) {
  const o = { ...TREE_DEFAULTS, ...(SPECIES[opts.species] || {}), ...opts };
  const R = mulberry32(o.seed * 7919 + 17);
  const UP = [0, 1, 0];
  const top = o.height, yb = o.crownBase;
  const sq = o.squash;

  // ---------------------------------------------------------------- envelope
  const prof = (u) => {
    const a = Math.log(0.5) / Math.log(o.widest);
    return Math.pow(Math.max(0, Math.sin(Math.PI * Math.pow(u, a))), o.flat);
  };
  const lobeSeed = o.seed * 3 + 1;
  // lobe factor tabulated over (azimuth, height): the envelope test runs millions of times
  const LA = 64, LU = 32, lobeTab = new Float32Array(LA * LU), profTab = new Float32Array(257);
  for (let j = 0; j < LU; j++) for (let i = 0; i < LA; i++) {
    const ang = i / LA * Math.PI * 2, u = j / (LU - 1);
    lobeTab[j * LA + i] = 1 + o.lobes * 2 * (fbm3(Math.cos(ang) * 1.6 + 5, u * 2.4, Math.sin(ang) * 1.6, 3, lobeSeed) - 0.5);
  }
  for (let i = 0; i <= 256; i++) profTab[i] = prof(i / 256);
  const lobeAt = (ang, u) => {
    const fa = ((ang / (Math.PI * 2)) % 1 + 1) % 1 * LA, fu = u * (LU - 1);
    const i0 = Math.floor(fa), j0 = Math.min(LU - 2, Math.floor(fu)), a = fa - i0, b = fu - j0;
    const i1 = (i0 + 1) % LA, T = lobeTab;
    return (T[j0 * LA + i0] * (1 - a) + T[j0 * LA + i1] * a) * (1 - b) + (T[(j0 + 1) * LA + i0] * (1 - a) + T[(j0 + 1) * LA + i1] * a) * b;
  };
  const inFinal = (x, y, z) => {
    const u = (y - yb) / (top - yb);
    if (u <= 0 || u >= 1) return false;
    const cx = o.lean[0] * u, cz = o.lean[1] * u;
    const dx = (x - cx) / sq[0], dz = (z - cz) / sq[1];
    const rr = Math.hypot(dx, dz);
    if (rr > o.radius * (1 + o.lobes)) return false;
    return rr < o.radius * profTab[Math.round(u * 256)] * lobeAt(Math.atan2(dz, dx), u);
  };
  // swept envelope: q ∈ E_s ⇔ q / s ∈ E (scaled about the root). ρ(q) = smallest such s.
  const rho = (x, y, z) => {
    for (let s = o.s0; s <= 1.0001; s += 0.01) if (inFinal(x / s, y / s, z / s)) return s;
    return -1;
  };

  // ---------------------------------------------------------------- attraction points
  const P = { x: [], y: [], z: [], rho: [] };
  const Rm = o.radius * 1.5;
  let guard = 0;
  while (P.x.length < o.nPts && guard++ < o.nPts * 60) {
    const x = (R() * 2 - 1) * Rm * sq[0] + o.lean[0], y = R() * top, z = (R() * 2 - 1) * Rm * sq[1] + o.lean[1];
    const r = rho(x, y, z);
    if (r < 0) continue;
    // clumped density: leaves concentrate in clumps with gaps between them
    const n = fbm3(x * 0.95 + 11, y * 0.95, z * 0.95 - 4, 3, o.seed * 5 + 3);
    const keep = (1 - o.clump) + o.clump * clamp((n - 0.36) / 0.28);
    if (R() > keep) continue;
    P.x.push(x); P.y.push(y); P.z.push(z); P.rho.push(r);
  }
  const NP = P.x.length;
  const order = [...Array(NP).keys()].sort((a, b) => P.rho[a] - P.rho[b]);

  // ---------------------------------------------------------------- nodes + grids
  const N = { p: [], parent: [], it: [], kids: [], dir: [], leader: [] };
  const CS = 0.3;                                     // node grid cell
  const nodeGrid = new Map();
  const key = (ix, iy, iz) => ((ix + 1000) * 2048 + (iy + 1000)) * 2048 + (iz + 1000);
  const addNode = (p, parent, it, dir, leader) => {
    const id = N.p.length;
    N.p.push(p); N.parent.push(parent); N.it.push(it); N.kids.push([]); N.dir.push(dir); N.leader.push(leader);
    if (parent >= 0) N.kids[parent].push(id);
    const k = key(Math.floor(p[0] / CS), Math.floor(p[1] / CS), Math.floor(p[2] / CS));
    let a = nodeGrid.get(k); if (!a) nodeGrid.set(k, a = []); a.push(id);
    return id;
  };
  const PCS = o.di;                                   // point grid cell
  const ptGrid = new Map();
  for (let j = 0; j < NP; j++) {
    const k = key(Math.floor(P.x[j] / PCS), Math.floor(P.y[j] / PCS), Math.floor(P.z[j] / PCS));
    let a = ptGrid.get(k); if (!a) ptGrid.set(k, a = []); a.push(j);
  }
  const state = new Uint8Array(NP);                   // 0 dormant, 1 active, 2 consumed
  const near = new Int32Array(NP).fill(-1), nd2 = new Float32Array(NP).fill(1e9);
  const di2 = o.di * o.di, dk2 = o.dk * o.dk;
  const nearestNode = (x, y, z) => {
    const ix = Math.floor(x / CS), iy = Math.floor(y / CS), iz = Math.floor(z / CS), rr = Math.ceil(o.di / CS);
    let best = -1, bd = di2;
    for (let a = -rr; a <= rr; a++) for (let b = -rr; b <= rr; b++) for (let c = -rr; c <= rr; c++) {
      const cell = nodeGrid.get(key(ix + a, iy + b, iz + c));
      if (!cell) continue;
      for (const id of cell) { const q = N.p[id]; const d = (q[0] - x) ** 2 + (q[1] - y) ** 2 + (q[2] - z) ** 2; if (d < bd) { bd = d; best = id; } }
    }
    return [best, bd];
  };

  addNode([0, 0, 0], -1, 0, UP, true);
  let leaderTip = 0, lastIt = 0, active = [], ptr = 0, stall = 0;
  const sAt = (it) => Math.min(1, o.s0 + (1 - o.s0) * Math.pow(Math.min(1, it / o.envIters), o.sPow));
  const randUnit = () => { const a = R() * Math.PI * 2, z = R() * 2 - 1, r = Math.sqrt(1 - z * z); return [r * Math.cos(a), z, r * Math.sin(a)]; };

  for (let it = 1; it <= o.maxIters; it++) {
    const s = sAt(it);
    // activate points entering the envelope
    while (ptr < NP && P.rho[order[ptr]] <= s) {
      const j = order[ptr++];
      const [b, d] = nearestNode(P.x[j], P.y[j], P.z[j]);
      if (b >= 0 && d < dk2) { state[j] = 2; continue; }
      state[j] = 1; near[j] = b; nd2[j] = d; active.push(j);
    }
    // accumulate attraction
    const acc = new Map();
    for (const j of active) {
      const b = near[j]; if (b < 0) continue;
      const q = N.p[b];
      const dx = P.x[j] - q[0], dy = P.y[j] - q[1], dz = P.z[j] - q[2], l = Math.hypot(dx, dy, dz) || 1;
      let a = acc.get(b); if (!a) acc.set(b, a = [0, 0, 0, 0]);
      a[0] += dx / l; a[1] += dy / l; a[2] += dz / l; a[3]++;
    }
    const born = [];
    // the leader: apical dominance, it climbs while below the envelope top
    const lp = N.p[leaderTip], oldTip = leaderTip;
    if (lp[1] < s * top * 0.985 && lp[1] < o.leaderStop * top) {
      const a = acc.get(leaderTip);
      let d = [0, 1, 0];
      if (a) d = v3.add(d, v3.norm(a), 0.6);
      d = v3.norm(v3.add(v3.add(d, N.dir[leaderTip], 0.8), randUnit(), o.leaderWobble));
      leaderTip = addNode(v3.add(lp, d, o.D), leaderTip, it, d, true);
      born.push(leaderTip);
      acc.delete(oldTip);
    }
    for (const [b, a] of acc) {
      if (N.kids[b].length >= 3) continue;
      const q = N.p[b];
      let d = v3.norm(a);
      if (v3.len(a) < 0.15 * a[3]) continue;          // balanced pull: no clear direction
      d = v3.add(d, N.dir[b], o.persist);
      d = v3.add(d, UP, o.tropism);
      d = v3.norm(v3.add(d, randUnit(), o.jitter));
      // don't duplicate an existing shoot
      let dup = false;
      for (const k of N.kids[b]) if (v3.dot(N.dir[k], d) > 0.9) { dup = true; break; }
      if (dup) continue;
      const p = v3.add(q, d, o.D);
      if (p[1] < 0.06) continue;
      born.push(addNode(p, b, it, d, false));
    }
    // update point → nearest-node associations around the new nodes; consume reached points
    for (const id of born) {
      const q = N.p[id];
      const ix = Math.floor(q[0] / PCS), iy = Math.floor(q[1] / PCS), iz = Math.floor(q[2] / PCS);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
        const cell = ptGrid.get(key(ix + a, iy + b, iz + c));
        if (!cell) continue;
        for (const j of cell) {
          if (state[j] !== 1) continue;
          const d = (P.x[j] - q[0]) ** 2 + (P.y[j] - q[1]) ** 2 + (P.z[j] - q[2]) ** 2;
          if (d < dk2) { state[j] = 2; continue; }
          if (d < nd2[j]) { nd2[j] = d; near[j] = id; }
        }
      }
    }
    active = active.filter(j => state[j] === 1);
    if (born.length) { lastIt = it; stall = 0; } else if (s >= 1 && ++stall > 6) break;
  }

  // ---------------------------------------------------------------- structure
  const n = N.p.length;
  const parent = Int32Array.from(N.parent);
  const kids = N.kids;
  const sub = new Float32Array(n);                    // subtree node count
  for (let i = n - 1; i >= 0; i--) { sub[i] += 1; if (parent[i] >= 0) sub[parent[i]] += sub[i]; }
  const main = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) { let best = -1, bs = -1; for (const k of kids[i]) if (sub[k] > bs) { bs = sub[k]; best = k; } main[i] = best; }
  // smoothing: pull each node toward the mean of its parent and main child (keeps junctions)
  const pos = N.p.map(p => p.slice());
  for (let pass = 0; pass < 3; pass++) {
    const nx = pos.map(p => p.slice());
    for (let i = 1; i < n; i++) {
      const m = main[i]; if (m < 0) continue;
      const a = pos[parent[i]], b = pos[m];
      for (let c = 0; c < 3; c++) nx[i][c] = pos[i][c] + 0.5 * ((a[c] + b[c]) / 2 - pos[i][c]);
    }
    for (let i = 1; i < n; i++) pos[i] = nx[i];
  }
  // arc length, order, birth (g units)
  const s = new Float32Array(n), ord = new Uint8Array(n), birth = new Float32Array(n);
  const gIt = o.gEnd / Math.max(1, lastIt);          // births end at gEnd so every leaf is out by g = 1
  for (let i = 0; i < n; i++) {
    birth[i] = N.it[i] * gIt;
    if (i === 0) continue;
    const p = parent[i];
    s[i] = s[p] + v3.len(v3.sub(pos[i], pos[p]));
    ord[i] = ord[p] + (main[p] === i ? 0 : 1);
  }
  // chains: follow the main child from every chain start
  const chainOf = new Int32Array(n).fill(-1);
  const chains = [];
  for (let i = 0; i < n; i++) {
    if (i !== 0 && main[parent[i]] === i) continue;
    const c = { nodes: [], attach: i === 0 ? -1 : parent[i], order: ord[i] };
    let k = i;
    while (k >= 0) { c.nodes.push(k); chainOf[k] = chains.length; k = main[k]; }
    chains.push(c);
  }

  // ---------------------------------------------------------------- leaves
  const L = { host: [], off: [], axis: [], nrm: [], tan: [], birth: [], death: [], size: [], seed: [], variant: [] };
  const RL = mulberry32(o.seed * 104729 + 3);
  const idxInChain = new Int32Array(n);
  for (const c of chains) c.nodes.forEach((k, j) => { idxInChain[k] = j; });
  const addLeaf = (host, off, axis, nrm, b, size, variant) => {
    L.host.push(host); L.off.push(off); L.axis.push(axis); L.nrm.push(nrm); L.birth.push(b);
    L.tan.push(host > 0 ? v3.norm(v3.sub(pos[host], pos[parent[host]])) : UP);
    L.death.push(9); L.size.push(size); L.seed.push(RL()); L.variant.push(variant);
  };
  // crown centre: leaves on the crown's skin turn their faces outward toward the light they get
  // (a near-spherical leaf-angle distribution, not all-horizontal blades that vanish edge-on)
  let cc = [0, 0, 0], ccn = 0;
  for (let i = 0; i < n; i++) if (pos[i][1] > yb * 0.8) { cc = v3.add(cc, pos[i]); ccn++; }
  cc = v3.scale(cc, 1 / Math.max(1, ccn));
  const faceOut = (p, ax) => {
    const rd = v3.sub(p, cc); rd[1] *= 0.6;
    const out = v3.norm(rd);
    let nr = v3.norm(v3.add(v3.add(UP, out, o.leafOut), [RL() - 0.5, RL() - 0.5, RL() - 0.5], 0.9));
    nr = v3.norm(v3.sub(nr, v3.scale(ax, v3.dot(nr, ax))));
    return nr;
  };
  const leafNodeStart = [];
  for (let i = 1; i < n; i++) {
    leafNodeStart.push(L.host.length);
    if (pos[i][1] < 0.18) continue;
    const T = v3.norm(v3.sub(pos[i], pos[parent[i]]));
    const B1 = v3.perp(T), B2 = v3.cross(T, B1);
    const cnt = Math.max(1, Math.round(o.leavesPerNode * (0.6 + 0.8 * RL())));
    for (let q = 0; q < cnt; q++) {
      const th = (idxInChain[i] * 2 + q) * 2.39996 + (RL() - 0.5) * 0.5;      // 137.5° phyllotaxis
      const out = v3.add(v3.scale(B1, Math.cos(th)), B2, Math.sin(th));
      const pet = v3.norm(v3.add(out, T, 0.75));
      const off = v3.scale(pet, o.petiole * (0.7 + 0.6 * RL()));
      // blades spread out and roughly level, tips drooping, facing the sky (phototropism)
      let ax = v3.norm(v3.add(v3.add(out, T, 0.45), [0, -0.25 - 0.3 * RL(), 0]));
      ax = v3.norm([ax[0], ax[1] * 0.6, ax[2]]);
      const nr = faceOut(pos[i], ax);
      const sz = (o.leafLen[0] + (o.leafLen[1] - o.leafLen[0]) * RL()) * (0.8 + 0.25 * Math.min(1, s[i] / 1.5));
      const variant = o.leafVariants[Math.floor(RL() * o.leafVariants.length)];
      addLeaf(i, off, ax, nr, birth[i] + o.budDelay * (0.6 + 0.9 * RL()), sz, variant);
    }
    // a short shoot (spur) with a rosette of 3–6 leaves, on most twig nodes (not the leader)
    if (ord[i] > 0 && RL() < o.spurs) {
      const th = RL() * Math.PI * 2;
      const out = v3.add(v3.scale(B1, Math.cos(th)), B2, Math.sin(th));
      const sd = v3.norm(v3.add(v3.add(out, T, 0.6), UP, 0.35));
      const base = v3.scale(sd, 0.03 + 0.05 * RL());
      const k = o.spurLeaves[0] + Math.floor(RL() * (o.spurLeaves[1] - o.spurLeaves[0] + 1));
      const variant = o.leafVariants[Math.floor(RL() * o.leafVariants.length)];
      const b0 = birth[i] + o.budDelay * (1.5 + 2.5 * RL());
      for (let q = 0; q < k; q++) {
        const a = q / k * Math.PI * 2 + RL() * 0.6;
        const S1 = v3.perp(sd), S2 = v3.cross(sd, S1);
        let ax = v3.norm(v3.add(v3.add(v3.scale(S1, Math.cos(a)), S2, Math.sin(a)), sd, 0.35 + 0.2 * RL()));
        ax = v3.norm([ax[0], ax[1] * 0.7 - 0.15, ax[2]]);
        const nr = faceOut(v3.add(pos[i], base), ax);
        const sz = (o.leafLen[0] + (o.leafLen[1] - o.leafLen[0]) * RL()) * (0.7 + 0.3 * RL());
        addLeaf(i, v3.add(base, ax, 0.012), ax, nr, b0 + q * 0.002, sz, variant);
      }
    }
  }
  // cotyledons: two round seed leaves on the first node, shed as the sapling establishes
  const cot = Math.min(1, n - 1);
  for (const side of [-1, 1]) {
    const ax = v3.norm([side * 0.95, 0.25, 0.1]);
    addLeaf(cot, v3.scale(ax, 0.006), ax, v3.norm([-side * 0.2, 1, 0]), 0.0, 0.045, 3);
    L.death[L.death.length - 1] = 0.30 + 0.05 * RL();
  }
  const NL = L.host.length;
  // leaf shedding from limbs: first g at which a node's subtree carries more than limbLeaves
  // leaves (evaluated on a time grid; one reverse pass per sample)
  const leafBirthByNode = new Array(n).fill(null).map(() => []);
  for (let l = 0; l < NL; l++) leafBirthByNode[L.host[l]].push(L.birth[l]);
  const shed = new Float32Array(n).fill(9);
  const cnt = new Float32Array(n);
  for (let k = 0; k <= 160; k++) {
    const g = k / 160;
    cnt.fill(0);
    for (let i = n - 1; i >= 0; i--) {
      for (const b of leafBirthByNode[i]) if (b <= g) cnt[i]++;
      if (parent[i] >= 0) cnt[parent[i]] += cnt[i];
      if (shed[i] > 8 && cnt[i] > o.limbLeaves) shed[i] = g;
    }
  }
  for (let l = 0; l < NL; l++) if (L.variant[l] !== 3) L.death[l] = shed[L.host[l]] + 0.01 + 0.05 * L.seed[l];

  // ---------------------------------------------------------------- pack
  const P3 = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) P3.set(pos[i], i * 3);
  const flat = (arr) => { const f = new Float32Array(arr.length * 3); arr.forEach((v, i) => f.set(v, i * 3)); return f; };
  let bb = [1e9, 1e9, 1e9, -1e9, -1e9, -1e9];
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) { bb[c] = Math.min(bb[c], pos[i][c]); bb[c + 3] = Math.max(bb[c + 3], pos[i][c]); }
  return {
    opts: o, species: opts.species || 'linden', n, pos: P3, parent, birth, order: ord, s, sub, main, chainOf, chains, dG: gIt,
    leaves: {
      n: NL, host: Int32Array.from(L.host), off: flat(L.off), axis: flat(L.axis), nrm: flat(L.nrm), tan: flat(L.tan),
      birth: Float32Array.from(L.birth), death: Float32Array.from(L.death), size: Float32Array.from(L.size),
      seed: Float32Array.from(L.seed), variant: Float32Array.from(L.variant),
    },
    leafBirthByNode, bbox: bb, iters: lastIt, points: NP,
  };
}
