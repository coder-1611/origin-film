// VI lab: the ~10 s evolution walk as data. One continuously walking "unbroken outline" (after the
// Cosmos 1980 morph): seven stages, each held while it walks, then shape-morphed (signed-distance
// interpolation) into the next over MORPH seconds. Every creature walks on its own gait clock, so
// its feet stay locked to the ground through the hold; the morph happens on a double-support beat.
import { STAGES, poseCreature, morphCreatures } from './creatures.js';

export const EVO = {
  duration: 10.0,
  morph: 0.32,                 // seconds of shape interpolation at each boundary
  stages: STAGES,
};

/**
 * evolutionAt(τ) → { a, b, w, ta, tb, water, stage }
 *   a / b: stage keys (b null outside morphs), w ∈ [0, 1] morph weight, ta / tb: each creature's clock.
 */
export function evolutionAt(tau) {
  const n = STAGES.length, seg = EVO.duration / n, m = EVO.morph;
  const i = Math.min(n - 1, Math.max(0, Math.floor(tau / seg)));
  const local = tau - i * seg;
  let a = STAGES[i], b = null, w = 0;
  // morph window straddles the boundary into the next stage
  const toNext = (i + 1) * seg - tau;
  if (i < n - 1 && toNext < m / 2) { b = STAGES[i + 1]; w = smooth(0.5 - toNext / m); }
  const fromPrev = local;
  if (i > 0 && fromPrev < m / 2) { b = a; a = STAGES[i - 1]; w = smooth(0.5 + fromPrev / m); }
  return { a, b, w, ta: tau, tb: tau, water: a === 'tiktaalik' && (!b || w < 0.5) ? 1 : 0, stage: i };
}
const smooth = (x) => { const t = Math.min(1, Math.max(0, x)); return t * t * t * (t * (t * 6 - 15) + 10); };

/** Albedo / skin parameters for the 3D ('real') renderer; the silhouette ignores them. */
export const LOOK = {
  tiktaalik: { alb: [[0.075, 0.072, 0.05], [0.17, 0.15, 0.11]], skin: [70, 0, 1, 0] },
  salamander: { alb: [[0.025, 0.024, 0.028], [0.09, 0.07, 0.03]], skin: [0, 0, 1, 1] },
  lizard: { alb: [[0.07, 0.09, 0.045], [0.16, 0.15, 0.09]], skin: [140, 0, 0.3, 0] },
  theropod: { alb: [[0.09, 0.07, 0.045], [0.2, 0.16, 0.1]], skin: [45, 0, 0.2, 0] },
  mammal: { alb: [[0.24, 0.095, 0.035], [0.34, 0.3, 0.25]], skin: [0, 1, 0, 0] },
  ape: { alb: [[0.022, 0.019, 0.017], [0.03, 0.025, 0.022]], skin: [0, 1, 0, 0] },
  human: { alb: [[0.17, 0.095, 0.06], [0.19, 0.11, 0.07]], skin: [0, 0, 0, 0] },
};

/**
 * Place one posed stage in the walk's local frame: normalised so the animal is ≤ `size` tall and
 * ≤ 2.1·size long, centred at x = 0 (the camera tracks it; the ground scrolls by `scroll`).
 */
export function placeCreature(key, t, size = 1) {
  const pose = poseCreature(key, t);
  const k = Math.min(size / pose.height, 2.1 * size / pose.len);
  return { pose, k, world: [-pose.center[0] * k, 0, 0], ...LOOK[key], scroll: pose.X * k };
}

/**
 * Everything a renderer needs for walk-time τ ∈ [0, EVO.duration]:
 *   { A, scroll, flame, water, stage } → pass to makeCreatureRenderer().render(…, { A, flame, scroll, waterFront: water, … }).
 * Between stages A is a geometric slot morph (morphCreatures), never a cross-dissolve.
 */
export function evolutionFrame(tau, { size = 1 } = {}) {
  const ev = evolutionAt(tau);
  let A = placeCreature(ev.a, ev.ta, size);
  let flameSrc = A, fl = 1;
  if (ev.b) {
    const B = placeCreature(ev.b, ev.tb, size);
    const M = morphCreatures(A, B, ev.w);
    M.scroll = A.scroll + (B.scroll - A.scroll) * ev.w;
    M.alb = ev.w < 0.5 ? A.alb : B.alb; M.skin = ev.w < 0.5 ? A.skin : B.skin;
    if (B.pose.flame) { flameSrc = B; fl = ev.w < 0.6 ? 0 : (ev.w - 0.6) / 0.4; }        // the torch catches once formed
    else if (A.pose.flame) { flameSrc = A; fl = 1 - ev.w; }
    else flameSrc = null;
    A = M;
  }
  let flame = null;
  if (flameSrc && flameSrc.pose.flame) {
    let fp = [flameSrc.pose.flame[0] * flameSrc.k + flameSrc.world[0], flameSrc.pose.flame[1] * flameSrc.k];
    if (ev.b) {   // follow the morphing torch
      const tp = A.pose.prims.filter(p => p.kind === 4), top = tp[tp.length > 1 ? 1 : 0];
      if (top) fp = [top.b[0] * A.k + 0.01 * A.k, top.b[1] * A.k + 0.06 * A.k];
    }
    flame = [fp[0], fp[1], 0.24 * flameSrc.k * (0.95 + 0.1 * Math.sin(tau * 11)) * fl * fl];
  }
  return { A, scroll: A.scroll, flame, water: ev.water, stage: ev.stage, a: ev.a, b: ev.b, w: ev.w };
}
