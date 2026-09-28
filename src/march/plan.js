// ORIGIN · VI march plan: every sound-making moment of the shore sequence (128–154 s), generated
// from each animal's own gait clock and bout plan (src/march/beats.js) — nothing on the beat grid —
// with each source's screen position under the chapter's camera (src/march/camera.js). The audio
// engine schedules from this; the chapter's visuals read the same modules and seeds, so every foot
// plants and every gesture happens on exactly these times.
// Pure JS: no three.js, no DOM, and it does NOT import timeline.js (timeline.js imports this).
//
// marchPlan() → {
//   t0: 128, t1: 154, torch: 151.0, standAt,        // standAt: the human's last footfall (feet together)
//   animals: [{ name, t0, t1 }],                     // the seven vignette windows
//   events: [{ t, animal, type, x, dist, ...params }] sorted by t
// }
//   x: source screen x in NDC (−1 left … +1 right; |x| > 1 = off-screen) at t; dist: metres from the lens
//   type 'step'       { m (kg), kind: 'claw'|'paw'|'foot'|'belly', ground: 'wet'|'sand', foot: limb id }
//   type 'haulout'    { lunges: [s], gulpAt: s, seed }  → voices.tetrapodHaulOut, started at t
//   type 'gulp'       { part: 'haulout'|'bout' }         (already inside that voice's render)
//   type 'breath'     { kind: 'exhale'|'inhale'|'sniff', dur, part? }
//   type 'sav'        { i, dur, f, bout }                 the silent 18–20 Hz body vibration (felt)
//   type 'boom'       { i, t0, d, f, onset, bout }        t = audible start (onset pulse); t0 = boom body
//                     bout = voices.boomPlan(...) + { start }: render theropodBoom({ plan: bout }) at bout.start
//   type 'hiss'       { seed, count, onset, dur }         → voices.lizardHiss, started at t (sound at onset)
//   type 'bark'       { seed, count, onsets, who: 'distant' }  → voices.foxBarks, started at t
//   type 'panthoot'   { seed, onset, climaxAt, plan }     → voices.pantHoot, started at onset (= t)
//   type 'scratch'    { dur }                             one stroke
//   type 'torchraise' { dur, catchAt }                    the raise; the flame catches at catchAt (= torch)
import { makeCast, NAMES, T0, T1, TORCH } from './beats.js';
import { makeCamera, ndc, dist } from './camera.js';

let PLAN = null;
export function marchPlan() {
  if (PLAN) return PLAN;
  const cast = makeCast(), cam = makeCamera(cast);
  const events = [];
  for (const n of NAMES) for (const e of cast[n].events()) {
    const c = cam.at(e.t), [x] = ndc(c, e.pos);
    const { pos, ...rest } = e;
    events.push({ ...rest, x: +x.toFixed(4), dist: +dist(c, pos).toFixed(2) });
  }
  events.sort((a, b) => a.t - b.t || (a.animal < b.animal ? -1 : 1));
  PLAN = {
    t0: T0, t1: T1, torch: TORCH, standAt: cast.human.beh.standAt,
    animals: NAMES.map(n => ({ name: n, t0: cast[n].window[0], t1: cast[n].window[1] })),
    events,
  };
  return PLAN;
}
