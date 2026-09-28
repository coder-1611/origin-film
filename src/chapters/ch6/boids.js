// VI · LIFE: boids (Reynolds 1987) on the CPU with deterministic replay.
// A fixed 120 Hz step from TB0; state after step s is a pure function of s. Rendering
// interpolates between steps s and s+1. Seeking backwards resets and re-simulates.
// One flock, two regimes: a milling fish school under water, and birds once a boid has crossed
// the waterline (it keeps that identity: each fish becomes a bird as it breaches).
import { DEG } from './layout.js';

export const TB0 = 122.4, TB1 = 155.2, HZ = 120;   // T.BREACH_T − 3.6 … the end of VI's window
const DT = 1 / HZ;

export function makeBoids(T, { n = 420, goal, seed = 0xB01D } = {}) {
  const R = T.mulberry32(seed);
  const P = new Float64Array(n * 3), V = new Float64Array(n * 3), P0 = new Float64Array(n * 3);
  const A = new Float64Array(n * 3);
  const air = new Uint8Array(n), breachT = new Float64Array(n), breachX = new Float64Array(n), breachZ = new Float64Array(n);
  const trait = new Float64Array(n);
  const maxStep = Math.floor((TB1 - TB0) * HZ);
  const st = { step: -1 };
  const breaches = [];

  function reset() {
    const r = T.mulberry32(seed);
    const g = goal(TB0);
    for (let i = 0; i < n; i++) {
      // a loose shoal entering from the left, deep
      const u = r(), v = r(), w = r();
      P[i * 3] = g.p[0] - 0.5 - 1.1 * u; P[i * 3 + 1] = -0.85 + 0.45 * v; P[i * 3 + 2] = g.p[2] + (w - 0.5) * 0.9;
      V[i * 3] = 1.1 + 0.2 * r(); V[i * 3 + 1] = 0; V[i * 3 + 2] = (r() - 0.5) * 0.3;
      air[i] = 0; breachT[i] = 1e9; trait[i] = r();
    }
    P0.set(P);
    breaches.length = 0;
    st.step = 0;
  }

  // uniform grid neighbour search
  const cellOf = new Int32Array(n), next = new Int32Array(n);
  const heads = new Map();
  const off = [0, 0, 0];
  function step() {
    const t = TB0 + st.step * DT;
    const g = goal(t);
    const cs = g.bird ? 3.0 : 0.3;
    heads.clear();
    for (let i = 0; i < n; i++) {
      const cx = Math.floor(P[i * 3] / cs), cy = Math.floor(P[i * 3 + 1] / cs), cz = Math.floor(P[i * 3 + 2] / cs);
      const key = (cx * 73856093) ^ (cy * 19349663) ^ (cz * 83492791);
      cellOf[i] = key;
      next[i] = heads.has(key) ? heads.get(key) : -1;
      heads.set(key, i);
    }
    for (let i = 0; i < n; i++) {
      const bird = air[i] === 1;
      const rN = bird ? 3.0 : 0.3, rS = bird ? 1.5 : 0.1;
      const px = P[i * 3], py = P[i * 3 + 1], pz = P[i * 3 + 2];
      let ax = 0, ay = 0, az = 0, cxs = 0, cys = 0, czs = 0, vxs = 0, vys = 0, vzs = 0, sx = 0, sy = 0, sz = 0, cnt = 0;
      const gx = Math.floor(px / cs), gy = Math.floor(py / cs), gz = Math.floor(pz / cs);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
        const key = ((gx + dx) * 73856093) ^ ((gy + dy) * 19349663) ^ ((gz + dz) * 83492791);
        let j = heads.has(key) ? heads.get(key) : -1;
        while (j >= 0) {
          if (j !== i && air[j] === air[i]) {
            const ex = P[j * 3] - px, ey = P[j * 3 + 1] - py, ez = P[j * 3 + 2] - pz;
            const d2 = ex * ex + ey * ey + ez * ez;
            if (d2 < rN * rN && cnt < 24) {
              cnt++;
              cxs += ex; cys += ey; czs += ez;
              vxs += V[j * 3]; vys += V[j * 3 + 1]; vzs += V[j * 3 + 2];
              if (d2 < rS * rS) { const k = 1 / (d2 + 1e-4); sx -= ex * k; sy -= ey * k; sz -= ez * k; }
            }
          }
          j = next[j];
        }
      }
      const vx = V[i * 3], vy = V[i * 3 + 1], vz = V[i * 3 + 2];
      if (cnt > 0) {
        const kc = bird ? 0.9 : 1.2, ka = bird ? 2.6 : 2.0, ks = bird ? 3.5 : 0.03;
        ax += (cxs / cnt) * kc; ay += (cys / cnt) * kc; az += (czs / cnt) * kc;
        ax += (vxs / cnt - vx) * ka; ay += (vys / cnt - vy) * ka; az += (vzs / cnt - vz) * ka;
        ax += sx * ks; ay += sy * ks; az += sz * ks;
      }
      // goal seeking (+ milling swirl for the fish, wheeling for the birds)
      let gp = g.p;
      if (bird) { g.sheet(trait[i] * 2 - 1, trait[(i * 7) % n] * 2 - 1, off); gp = [g.bp[0] + off[0], g.bp[1] + off[1], g.bp[2] + off[2]]; }
      const ox = gp[0] - px, oy = gp[1] - py, oz = gp[2] - pz;
      const od = Math.hypot(ox, oy, oz) + 1e-6;
      const kg = bird ? g.bk : g.k;
      const kf = kg * Math.min(1, od / (bird ? 2.5 : 0.4));
      ax += ox / od * kf; ay += oy / od * kf; az += oz / od * kf;
      if (!bird) {
        // bait ball: each fish orbits the vertical axis through the goal on its own radius and
        // depth, so the school becomes a thick, swirling torus
        const rr = Math.hypot(ox, oz) + 1e-6;
        const R0 = 0.14 + 0.40 * trait[i], H0 = (trait[(i * 7) % n] - 0.5) * 0.62 * (1.0 - 0.5 * Math.abs(trait[i] - 0.5));
        const tx = -oz / rr, tz = ox / rr;
        const vdx = tx * g.orbit - (ox / rr) * (R0 - rr) * 2.2, vdz = tz * g.orbit - (oz / rr) * (R0 - rr) * 2.2;
        const vdy = (gp[1] + H0 - py) * 1.6;
        ax += (vdx - vx) * g.mill; ay += (vdy - vy) * g.mill; az += (vdz - vz) * g.mill;
        // the rise: each fish turns up on its own cue, so breaches spread around BREACH_T
        const riseAt = g.rise0 + trait[(i * 13) % n] * g.riseSpan;
        if (t > riseAt) { const k = Math.min(1, (t - riseAt) / 0.25); ay += 22 * k; ax += (gp[0] - px) * 3 * k; az += (gp[2] - pz) * 3 * k; }
        else {
          if (py > -0.14) ay -= (py + 0.14) * 30;
          if (py < -1.0) ay += (-1.0 - py) * 30;
        }
        const hx = px, hy = py + 0.67, hz = pz + 2.2;
        const hd = Math.hypot(hx / 0.78, hy / 0.45, hz / 0.70);
        if (hd < 1.25) { const k = (1.25 - hd) * 25; ax += hx * k; ay += hy * k; az += hz * k; }
      } else {
        ay += 12.0 * Math.max(0, 1.1 - py) * (t > g.b0 + 3 ? 1 : 0.5);   // birds keep clear of the sea
        const wx = -(gp[2] - pz), wz = gp[0] - px, wl = Math.hypot(wx, wz) + 1e-6;
        ax += wx / wl * g.wheel; az += wz / wl * g.wheel;
      }
      // individual wander (deterministic)
      const ph = trait[i] * 40 + t * (0.7 + trait[i]);
      const wa = bird ? 2.0 : 0.35;
      ax += Math.sin(ph) * wa; ay += Math.sin(ph * 1.3 + 2) * wa * 0.5; az += Math.cos(ph * 0.9) * wa;
      A[i * 3] = ax; A[i * 3 + 1] = ay; A[i * 3 + 2] = az;
    }
    for (let i = 0; i < n; i++) {
      const bird = air[i] === 1;
      let vx = V[i * 3] + A[i * 3] * DT, vy = V[i * 3 + 1] + A[i * 3 + 1] * DT, vz = V[i * 3 + 2] + A[i * 3 + 2] * DT;
      const sp = Math.hypot(vx, vy, vz) + 1e-9;
      const rising = !bird && t > g.rise0 + trait[(i * 13) % n] * g.riseSpan;
      const lo = bird ? g.bmin : (rising ? 1.5 : g.vmin), hi = bird ? g.bmax : (rising ? 4.2 : g.vmax);
      const s2 = Math.min(hi, Math.max(lo, sp));
      vx *= s2 / sp; vy *= s2 / sp; vz *= s2 / sp;
      V[i * 3] = vx; V[i * 3 + 1] = vy; V[i * 3 + 2] = vz;
      P0[i * 3] = P[i * 3]; P0[i * 3 + 1] = P[i * 3 + 1]; P0[i * 3 + 2] = P[i * 3 + 2];
      P[i * 3] += vx * DT; P[i * 3 + 1] += vy * DT; P[i * 3 + 2] += vz * DT;
      if (!bird && P[i * 3 + 1] > 0.0 && t > g.rise0) {
        air[i] = 1;
        breachT[i] = t + DT; breachX[i] = P[i * 3]; breachZ[i] = P[i * 3 + 2];
        breaches.push({ t: t + DT, x: P[i * 3], z: P[i * 3 + 2], vx, vy, vz, i });
        // the leap: out of the water forward and up, toward where the flock is heading
        const lx = 0.25 + (trait[i] - 0.5) * 0.5, ly = 0.42 + 0.16 * trait[(i * 7) % n], lz = -1.0;
        const ll = Math.hypot(lx, ly, lz), sp0 = 4.6 + 1.2 * trait[(i * 3) % n];
        V[i * 3] = lx / ll * sp0; V[i * 3 + 1] = ly / ll * sp0; V[i * 3 + 2] = lz / ll * sp0;
      }
    }
    st.step++;
  }

  return {
    n, P, P0, V, air, breachT, trait, breaches,
    stepAt(t) { return Math.max(0, Math.min(maxStep, Math.floor((t - TB0) * HZ + 1e-6))); },
    /** Advance/replay to t; returns the interpolation fraction between P0 (step s-1) and P (s). */
    ensure(t) {
      const S = this.stepAt(t) + 1;                     // we need state at s+1 to interpolate
      if (st.step < 0 || S < st.step) reset();
      while (st.step < S) step();
      const f = (t - TB0) * HZ - (S - 1);
      return Math.min(1, Math.max(0, f));
    },
    get step() { return st.step; },
  };
}
