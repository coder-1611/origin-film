// VI · LIFE: the shore at sunset, 128–154 s — seven SEPARATE animals at their real sizes, each on its
// own clock (src/march/beats.js), met one by one by a documentary camera drifting along the shore
// (src/march/camera.js). No morphing, no beat grid. This module assembles, for any t, what the
// renderer draws: the animals present (each appears and leaves only off-screen), the torch flame,
// footfall ripples in the wet film, the water dance at the theropod's feet, the shoreline, and the
// lens (focus distance for the telephoto depth of field). Pure functions of t.
//
// Frame ("walk-local", metres): ground y = 0, x along the shore (screen right), z toward the camera
// (which sits at z = ZC looking along −z at the sun); MARCH_FRAME (camera.js) places it in the world.
import { makeCast, NAMES, extentX } from '../../march/beats.js';
import { makeCamera, presence } from '../../march/camera.js';
import { makeAnimals } from './animals.js';

export const APERTURE = 0.03;              // m: entrance pupil of the telephoto (depth of field)

export function makeMarch({ end = 155 } = {}) {
  const cast = makeCast(), cam = makeCamera(cast, { end });
  const P = presence(cast, cam, NAMES, extentX);
  const animals = makeAnimals(cast);
  const events = NAMES.flatMap(n => cast[n].events());
  // footfalls in the wet film make rings (a heavy foot, a belly flop, the haul-out)
  const rings = events.filter(e => (e.type === 'step' && e.ground === 'wet') || e.type === 'haulout')
    .map(e => ({ t: e.t, x: e.pos[0], z: e.pos[2], a: e.type === 'haulout' ? 1.8 : Math.min(1.6, 0.25 + 0.35 * Math.log10(1 + e.m) + (e.kind === 'belly' ? 0.5 : 0)) }))
    .sort((a, b) => a.t - b.t);
  const tet = cast.tetrapod, human = cast.human;

  function at(t) {
    const list = [];
    for (const n of NAMES) if (t >= P[n][0] && t <= P[n][1]) list.push(animals[n](t));
    const H = list.find(r => r.name === 'human'), R = list.find(r => r.name === 'theropod');
    return { list, flame: H ? H.flame : null, flameZ: human.z, dance: R ? R.dance : null, cam: cam.at(t) };
  }
  function ripples(t) {
    const out = [];
    for (let i = rings.length - 1; i >= 0 && out.length < 8; i--) { const r = rings[i]; if (r.t <= t && t - r.t < 1.6) out.push([r.x, r.z, t - r.t, r.a]); }
    return out;
  }
  // the shoreline (sea where z < seaZ(x)): a tongue of the wash reaching past the tetrapod on its right
  // (draining back as it hauls out), then the beach widening; the theropod stands in the swash
  function shore(t) {
    const w = tet.waterX(t);
    return [[-6, 3.6], [w - 0.9, 5.9], [w + 0.35, 8.9], [w + 1.7, 7.4], [w + 3.1, 3.6], [7.5, 1.2], [10.0, -3.25], [40, -3.8]];
  }
  const dof = (t) => ({ focus: cam.at(t).focus, aperture: APERTURE });
  return { cast, cam, presence: P, at, ripples, shore, dof, events };
}
