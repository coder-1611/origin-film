// ORIGIN · VI march timing (moved from src/chapters/ch6/lab/gait2.js): a GAIT CLOCK for natural, unquantised locomotion (pure functions of t).
//
// The round-1 engine had one constant period T and speed v per animal: X = v·t, phase = t/T. That
// can't accelerate, decelerate, stop, or vary a stride — so every animal marched like a metronome.
// This clock is built once from a behaviour plan and then answers, for any t:
//   X(t)      body position along the walk (m)          = ∫ v dt
//   phase(t)  gait cycles elapsed                       = ∫ f dt, f from v by dynamic similarity
//   foot(...) the same foot record the gait engine uses ({x, y, psi, stance, s, k}), stance feet
//             locked to world anchors X(t_midstance) + hip offset → no sliding at any speed
//
// Physics (see docs/research/animal-realism.md §1):
//   · stride frequency from speed at fixed leg length (Alexander 1976, λ/h = 2.3·Fr^0.3):
//        f = v / λ = v^0.4 · g^0.3 / (2.3 · h^0.7)      → stride length λ ∝ v^0.6 shrinks as it slows
//   · natural variability: stride period CV ≈ 2–3 % with long-range (1/f-like) correlation
//     (Hausdorff et al. 1995), implemented as a slow fbm modulation of f, seeded
//   · stops: the deceleration is re-timed so the phase lands in a support window (all feet planted
//     for bipeds' double support); feet caught in swing finish their swing at the last cadence and
//     land under their hip, then hold; restarts integrate onward from there.
import { mulberry32, fbmNoise, clamp, sstep } from '../audio/nature/dsp.js';

const G = 9.81;

/**
 * makeGaitClock({ plan, h, duty, offs, dt, cv, seed, fScale, t0, t1 })
 *   plan: [[t, v], …] speed keyframes (m/s), smoothstepped between keys (hold v = 0 for stops)
 *   h: hip (leg) height in m (of the animal as shown); duty; offs: {foot: phase offset};
 *   fScale: multiply the Alexander frequency (species tweak); cv: stride period CV (0.02–0.03)
 */
export function makeGaitClock({ plan, h, duty, offs, dt = 1 / 600, cv = 0.025, seed = 1, fScale = 1, fExp = 0.4, vRef = 1, t0 = -2, t1 = 12, vStop = 0.02, freeze = null, settle = null }) {
  const n = Math.ceil((t1 - t0) / dt) + 1;
  const T = new Float64Array(n), X = new Float64Array(n), P = new Float64Array(n), V = new Float64Array(n);
  const vAt = (t) => {
    if (t <= plan[0][0]) return plan[0][1];
    for (let i = 0; i < plan.length - 1; i++) if (t < plan[i + 1][0]) { const u = sstep(plan[i][0], plan[i + 1][0], t); return plan[i][1] + (plan[i + 1][1] - plan[i][1]) * u; }
    return plan[plan.length - 1][1];
  };
  const wob = fbmNoise(seed * 7 + 3, 4);
  // f = v^0.4·g^0.3/(2.3·h^0.7) (Alexander); fExp ≠ 0.4 bends it for sprawlers (f rises faster with v)
  const fOf = (v, t) => v < vStop ? 0 : fScale * Math.pow(vRef, 0.4 - fExp) * Math.pow(v, fExp) * Math.pow(G, 0.3) / (2.3 * Math.pow(h, 0.7)) * (1 + cv * 1.8 * wob(t * 0.9));
  // integrate
  for (let i = 0; i < n; i++) {
    const t = t0 + i * dt; T[i] = t; V[i] = vAt(t);
    if (i) { X[i] = X[i - 1] + 0.5 * (V[i] + V[i - 1]) * dt; P[i] = P[i - 1] + 0.5 * (fOf(V[i], t) + fOf(V[i - 1], t - dt)) * dt; }
  }
  // stops: find runs where v < vStop; re-time the preceding deceleration so the phase lands in a
  // support window; hold it through the stop; shift everything after by the correction
  const allStanceAt = (ph) => Object.values(offs).every(o => ((ph + o) % 1 + 1) % 1 < duty);
  const supportTarget = (ph, lo, hi) => {
    // the phase in [lo, hi] nearest ph where every foot is in stance (bipeds: double support); if the
    // gait has no all-stance window (e.g. a lateral-sequence walk, duty 0.65), take the phase where
    // the most feet are down and the swinging foot is nearest touch-down
    let best = clamp(ph, lo, hi), score = -1;
    const N = Math.max(8, Math.ceil((hi - lo) / 0.004));
    for (let k = 0; k <= N; k++) {
      const c = lo + (hi - lo) * k / N;
      const down = Object.values(offs).map(o => ((c + o) % 1 + 1) % 1);
      const nDown = down.filter(p => p < duty).length;
      const late = Math.max(...down.map(p => p >= duty ? (p - duty) / (1 - duty) : 1));
      const s = nDown + (allStanceAt(c) ? 10 : late) - 0.3 * Math.abs(c - ph);
      if (s > score) { score = s; best = c; }
    }
    return best;
  };
  const stops = [];
  let i = 1, prevEnd = 1;
  while (i < n) {
    if (V[i] < vStop && V[i - 1] >= vStop) {
      const iStop = i;
      let iEnd = iStop; while (iEnd < n - 1 && V[iEnd] < vStop) iEnd++;
      // the deceleration: walk back while the speed keeps rising (up to 3 s) — and re-time over at
      // least the last 0.6 s of gait (not across the previous stop), so a quick hitch can't make the
      // legs flick or run backwards
      let iDec = iStop - 1; while (iDec > 1 && V[iDec - 1] > V[iDec] + 1e-9 && iStop - iDec < Math.round(3 / dt)) iDec--;
      const iWin = Math.max(prevEnd, Math.min(iDec, iStop - Math.round(0.6 / dt)));
      const p0 = P[iWin], p1 = P[iStop], Dp = Math.max(1e-6, p1 - p0);
      const lo = p0 + 0.6 * Dp, hi = p0 + 1.5 * Dp;             // the cadence changes by −40 … +50 % at most
      // freeze = { foot, s }: a long pause with that foot held raised early in its swing (lizards pause
      // at a limb-cycle extreme with a foot lifted); settle = { foot, s }: stop with that foot late in
      // its swing — it finishes the step under the hip, beside the other (feet together). Otherwise
      // (and for short hitches) land in a support window.
      const q = freeze || settle, long = (iEnd - iStop) * dt >= 0.4;
      let target;
      if (q && long) {
        const want = duty + q.s * (1 - duty) - offs[q.foot];
        let bestD = 1e9;
        for (let k = Math.floor(lo - want) - 1; k <= Math.ceil(hi - want) + 1; k++) {
          const c = want + k, d = (c < lo ? lo - c : c > hi ? c - hi : 0) * 10 + Math.abs(c - (p1 - 0.05));
          if (d < bestD) { bestD = d; target = c; }
        }
      } else target = supportTarget(p1, lo, hi);
      const sc = (target - p0) / Dp;
      for (let j = iWin; j < iStop; j++) P[j] = p0 + (P[j] - p0) * sc;
      const shift = target - P[iStop];
      for (let j = iStop; j < n; j++) P[j] += shift;
      stops.push({ a: T[iStop], b: T[iEnd], f: Math.max(0.3, (P[iStop - 1] - P[Math.max(0, iStop - 60)]) / (T[iStop - 1] - T[Math.max(0, iStop - 60)])) });
      prevEnd = iEnd;
    }
    i++;
  }
  const idx = (t) => clamp((t - t0) / dt, 0, n - 1);
  const sample = (A, t) => { const x = idx(t), a = Math.floor(x), b = Math.min(n - 1, a + 1), f = x - a; return A[a] + (A[b] - A[a]) * f; };
  const tOfPhase = (ph) => {
    if (ph <= P[0]) return T[0];
    if (ph >= P[n - 1]) return T[n - 1];
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (P[m] < ph) lo = m; else hi = m; }
    // flat (stopped) stretches: return the FIRST time the phase reaches ph
    const f = (ph - P[lo]) / Math.max(1e-12, P[hi] - P[lo]);
    return T[lo] + f * dt;
  };
  const Xat = (t) => sample(X, t), phase = (t) => sample(P, t), speed = (t) => sample(V, t);
  const rng = mulberry32(seed * 131 + 7);
  const jit = Array.from({ length: 64 }, () => (rng() - 0.5));            // per-cycle foot placement jitter
  /** Foot record for a limb (same contract as creatures.js footTrack). */
  function foot(t, off, dty, hipX, lift, neutral = 0) {
    const c = phase(t) + off, k = Math.floor(c), psi = c - k;
    const anchor = (kk) => Xat(tOfPhase(kk - off + dty * 0.5)) + hipX + neutral + 0.03 * h * jit[((kk % 64) + 64) % 64];
    if (psi < dty) return { x: anchor(k), y: 0, psi, stance: true, s: psi / dty, k };
    let s = (psi - dty) / (1 - dty);
    // stopped with this foot in the air: it finishes its swing at the last cadence and lands
    const st = freeze ? null : stops.find(q => t >= q.a && t < q.b);
    if (st) { s = Math.min(1, s + (t - st.a) * st.f / (1 - dty)); if (s >= 1) return { x: anchor(k + 1), y: 0, psi, stance: true, s: 0, k: k + 1 }; }
    const e = s * s * (3 - 2 * s);
    // swing height scales with stride length (short, shuffling steps lift less)
    const sl = Math.abs(anchor(k + 1) - anchor(k)) / Math.max(1e-6, 0.8 * h);
    const y = lift * clamp(sl, 0.25, 1.2) * Math.pow(Math.sin(Math.PI * Math.pow(s, 0.8)), 1.2);
    return { x: anchor(k) + (anchor(k + 1) - anchor(k)) * e, y, psi, stance: false, s, k };
  }
  return { X: Xat, phase, speed, tOfPhase, foot, stops, freqAt: (t) => fOf(speed(t), t), t0, t1 };
}

/**
 * Seeded irregular event times (blinks, ear flicks, tail twitches, calls): a renewal process with
 * lognormal intervals (median m, log-SD s) — never on a beat grid. Returns sorted times in [a, b).
 */
export function eventTimes(seed, a, b, m, s = 0.5, minGap = 0) {
  const R = mulberry32(seed), out = [];
  const g = () => { const u = Math.max(1e-9, R()), v = R(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  let t = a + R() * m;
  while (t < b) { out.push(t); t += Math.max(minGap, m * Math.exp(s * g())); }
  return out;
}
/** A pulse train from event times: each event rises over `atk`, falls over `rel` (0..1). */
export function pulses(times, atk, rel) {
  return (t) => { let v = 0; for (const e of times) { if (e > t) break; const d = t - e; v = Math.max(v, d < atk ? d / atk : Math.exp(-(d - atk) / rel)); } return v; };
}
