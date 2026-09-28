// VI · LIFE: the march (T.march: 128–150 s). One continuously walking silhouette evolves through the
// seven stages of T.march (tetrapod → … → early human), each the lead walker from its t0, shape-
// morphing into the next (geometric slot morph, lab/creatures.js). Pure functions of t.
//
// Sync: every entry of T.footsteps is a foot planting. Each stage's gait clock τ = t − stage.t0 and
// its period / limb offsets are chosen so that plants (ψ = 0 in the gait engine) fall exactly on the
// stage's footstep times; stance feet are locked to world anchors, so nothing slides.
//
// Frame ("walk-local", metres): ground y = 0, the creature plane z = 0, x = walking direction
// (screen right). The camera looks along −z from z = D; ch6-life maps this frame into the world
// facing the sun. The camera trucks along x so the lead walker's screen x follows T.marchX(t):
//   camX(t) = ref(t) − marchX(t) · D · tan(fov/2) · aspect,
// where ref(t) is the walker's visual centre (the torch flame once the human stops).
import { poseCreature, morphCreatures } from './lab/creatures.js';

export const MARCH_D = 12;                 // camera distance to the walk plane (m)
export const MARCH_FOV = 24;               // vertical fov (deg) during the march
export const ASPECT = 16 / 9;
export const HALF_W = MARCH_D * Math.tan(MARCH_FOV / 2 * Math.PI / 180) * ASPECT;

const KEY = { tetrapod: 'tiktaalik', amphibian: 'salamander', reptile: 'lizard', dinosaur: 'theropod', mammal: 'mammal', ape: 'ape', human: 'human' };
// k: display scale (world m per real m). Gait T / offsets put plants on the footstep grid:
// tetrapod & human & dinosaur every beat, amphibian / mammal / ape every half beat (4 feet at
// quarter offsets, T = 1 s), reptile every quarter beat (walking trot, T = 0.25 s).
const CFG = {
  tiktaalik:  { k: 1.7, look: [1.7, 0.35, 1.0, 1], ov: { G: { T: 1.0, duty: 0.55, v: 0.51, surge: 0.35 }, finOffs: [0, 0.5] } },
  salamander: { k: 16, look: [16, 0.35, 1.0, 1], ov: { T: 1.0, v: 0.056, offs: { RH: 0, LF: 0.25, LH: 0.5, RF: 0.75 } } },
  lizard:     { k: 7.5, look: [7.5, 0.6, 0.35, 1], ov: { T: 0.25, v: 0.24, offs: { LH: 0, RF: 0, RH: 0.5, LF: 0.5 } } },
  theropod:   { k: 1.28, look: [1.28, 0.6, 0.0, 0.6], ov: { T: 1.0, v: 1.2, offs: { LH: 0, RH: 0.5 }, callDeg: 22 } },
  mammal:     { k: 1.9, ov: { T: 1.0, v: 0.60, offs: { LH: 0, LF: 0.25, RH: 0.5, RF: 0.75 }, callDeg: 18 } },
  ape:        { k: 1.75, ov: { T: 1.0, v: 0.68, offs: { LH: 0, RF: 0.25, RH: 0.5, LF: 0.75 }, callDeg: 16 } },
  human:      { k: 1.0, ov: { T: 1.0, v: 1.30, offs: { LH: 0, RH: 0.5 } } },
};
const MORPH = 0.30;                        // the incoming stage is fully formed at its first plant
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export function makeMarch(T) {
  const M = T.march;
  const stages = M.stages.map((s, i) => ({ ...s, i, key: KEY[s.name], ...CFG[KEY[s.name]] }));
  const calls = T.sfx.filter(e => e.type === 'call').map(e => ({ t: e.t, dur: e.call === 'roar' ? 1.0 : 0.5, type: e.call }));
  const human = stages[stages.length - 1];
  const lastStep = T.footsteps.filter(f => f.stage === human.i).reduce((a, f) => Math.max(a, f.t), 0);

  // gait clock of a stage at t (the human decelerates after its last plant, both feet planted)
  function tau(s, t) {
    let x = t - s.t0;
    if (s === human && t > lastStep) {
      const u = Math.min(1, (t - lastStep) / (M.standAt - lastStep));
      x = (lastStep - s.t0) + 0.088 * (1 - (1 - u) * (1 - u));
    }
    return x;
  }
  function callAt(t) {
    let c = 0;
    for (const e of calls) {
      const a = sstep(e.t - 0.09, e.t + 0.05, t) * (1 - sstep(e.t + e.dur * 0.45, e.t + e.dur, t));
      c = Math.max(c, a);
    }
    return c;
  }
  const raiseAt = (t) => sstep(M.standAt + 0.05, M.torch - 0.08, t);
  function overrides(s, t) {
    const ov = { ...s.ov, call: callAt(t) };
    if (s === human) { ov.raise = raiseAt(t); ov.armRelax = sstep(lastStep, M.standAt + 0.2, t); }
    return ov;
  }
  const poseOf = (s, t) => poseCreature(s.key, tau(s, t), overrides(s, t));

  // placements: Q (constant per stage) keeps planted feet fixed; visual centres agree at each
  // morph midpoint so the silhouette never jumps
  const P0 = T.marchX(M.t0) * HALF_W;       // camera starts at x = 0
  const visX = (s, pose) => s.Q + (pose.X + pose.center[0]) * s.k;
  {
    const p = poseOf(stages[0], M.t0);
    stages[0].Q = P0 - (p.X + p.center[0]) * stages[0].k;
    for (let i = 1; i < stages.length; i++) {
      const tm = stages[i].t0 - MORPH / 2;
      const pa = poseOf(stages[i - 1], tm), pb = poseOf(stages[i], tm);
      stages[i].Q = visX(stages[i - 1], pa) - (pb.X + pb.center[0]) * stages[i].k;
    }
  }
  const record = (s, pose) => ({ pose, k: s.k, world: [s.Q + pose.X * s.k, 0, 0], look: s.look || [1, 1, 0, 0] });

  /** Everything the renderer needs at t: creature record (maybe morphed), flame, visual centre. */
  function at(t) {
    let si = 0;
    for (let i = 0; i < stages.length; i++) if (t >= stages[i].t0 - MORPH) si = i;
    const s = stages[si];
    const pose = poseOf(s, t);
    let A = record(s, pose), P = visX(s, pose), w = 1;
    if (si > 0 && t < s.t0) {
      const pr = stages[si - 1];
      const pp = poseOf(pr, t);
      w = sstep(s.t0 - MORPH, s.t0, t);
      const la = pr.look || [1, 1, 0, 0], lb = s.look || [1, 1, 0, 0];
      A = morphCreatures(record(pr, pp), A, w);
      A.look = la.map((v, j) => v + (lb[j] - v) * w);
      P = visX(pr, pp) + (P - visX(pr, pp)) * w;
    }
    let flame = null;
    if (s === human && pose.flame) flame = [A.world[0] + pose.flame[0] * s.k, pose.flame[1] * s.k, pose.flame[2] * s.k];
    return { A, P, flame, stage: si, key: s.key, w, call: callAt(t) };
  }

  // footfalls: at each T.footsteps time, the foot that just planted (ψ ≈ 0), in walk-local metres
  const falls = T.footsteps.map((f) => {
    const s = stages[f.stage], pose = poseOf(s, f.t);
    let best = null;
    for (const ft of pose.feet) if (ft.stance && (!best || ft.psi < best.psi)) best = ft;
    return { t: f.t, x: best ? s.Q + best.x * s.k : visX(s, pose), z: best ? best.z * s.k : 0, psi: best ? best.psi : 1, w: f.weight };
  });
  // the haul-out: the tetrapod's head breaks out of the sea with a splash of rings
  const haul = (() => { const a = poseOf(stages[0], M.t0); return { x: stages[0].Q + (a.X + a.center[0] + 0.5) * stages[0].k, z: 0 }; })();
  function ripples(t) {
    const out = falls.filter(f => f.t <= t && t - f.t < 1.6).slice(-7).map(f => [f.x, f.z, t - f.t, 0.35 + 0.9 * f.w]);
    if (t >= M.t0 && t - M.t0 < 1.6) out.unshift([haul.x, haul.z, t - M.t0, 2.2]);
    return out.slice(0, 8);
  }

  // camera reference: visual centre, handing over to the torch flame as the human stops (the flame
  // body rises above its anchor: aim at its visual centre, a quarter of its height up)
  const fa = at(M.torch).flame;
  const flameEnd = [fa[0], fa[1] + 0.06, fa[2]];
  function camRef(t) {
    const w = sstep(lastStep - 0.6, M.standAt, t);
    return at(t).P * (1 - w) + flameEnd[0] * w;
  }
  const camX = (t) => camRef(t) - T.marchX(t) * HALF_W;
  const clipX0 = P0 + 1.3;                  // the sea's edge at the haul-out (walk-local x)
  return { stages, at, camX, camRef, flameEnd, lastStep, tau, callAt, raiseAt, falls, ripples, clipX0 };
}
