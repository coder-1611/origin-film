// VI · LIFE: the shore forest (114–124 s): developmental space-colonization trees (lab/tree.js),
// growing seedling → young tree as a pure function of g(t). g steps (eased) on every marimba note in
// T.leafFlushes, three times as far on the leitmotif notes, so each note visibly flushes a burst of
// buds unfolding at the shoot tips; a slow underlying ramp keeps the growth continuous.
import { growTree } from './lab/tree.js';
import { makeTree } from './lab/tree-render.js';
import { makeLeafAtlas } from './lab/leaf-atlas.js';
import { GL_SHADOW } from './shadow.js';
import { heightAt, coastR, ORIGIN } from './terrain.js';
import { THREE } from '../../engine/gl.js';

const DEG = Math.PI / 180;
// placement on the shore (azimuth from ORIGIN, + = right of −z; metres inland of the waterline)
const SPECS = [
  { id: 'hero', az: -4, land: 2.2, yaw: 0.4, scale: 1.0, delay: 0.0, grow: { seed: 1, species: 'linden' }, dens: 1 },
  { id: 'g1', az: -24, land: 6.5, yaw: 2.1, scale: 1.2, delay: 0.10, grow: { seed: 2, species: 'oak' }, dens: 3 },
  { id: 'g2', az: 15, land: 4.5, yaw: 4.0, scale: 1.0, delay: 0.18, grow: { seed: 3, species: 'birch', height: 6.5 }, dens: 3 },
  { id: 'g3', az: 30, land: 11, yaw: 1.0, scale: 1.35, delay: 0.30, grow: { seed: 4, species: 'maple' }, dens: 3 },
  { id: 'g4', az: -40, land: 14, yaw: 5.2, scale: 1.5, delay: 0.24, grow: { seed: 5, species: 'linden', radius: 2.0 }, dens: 3 },
  { id: 'g5', az: 6, land: 16, yaw: 3.3, scale: 1.6, delay: 0.36, grow: { seed: 6, species: 'maple', radius: 2.3 }, dens: 3 },
  // the forest filling in behind (reduced detail with distance), and the headland grove
  { id: 'f1', az: -14, land: 11, yaw: 0.7, scale: 1.3, delay: 0.26, grow: { seed: 7, species: 'maple', nPts: 3600 }, dens: 4 },
  { id: 'f2', az: 22, land: 8, yaw: 2.6, scale: 1.1, delay: 0.22, grow: { seed: 8, species: 'linden', nPts: 3600 }, dens: 4 },
  { id: 'f3', az: 36, land: 6, yaw: 4.4, scale: 1.25, delay: 0.3, grow: { seed: 12, species: 'oak', nPts: 3200 }, dens: 4 },
  { id: 'f4', az: -48, land: 18, yaw: 1.9, scale: 1.4, delay: 0.35, grow: { seed: 13, species: 'maple', nPts: 2600, leafLen: [0.09, 0.14] }, dens: 5 },
  { id: 'f5', az: -32, land: 24, yaw: 5.9, scale: 1.6, delay: 0.4, grow: { seed: 9, species: 'oak', nPts: 2400, leafLen: [0.1, 0.15] }, dens: 5 },
  { id: 'f6', az: 13, land: 28, yaw: 0.2, scale: 1.5, delay: 0.42, grow: { seed: 10, species: 'birch', height: 6.8, nPts: 2400, leafLen: [0.07, 0.1] }, dens: 5 },
  { id: 'f7', az: -5, land: 32, yaw: 3.7, scale: 1.8, delay: 0.45, grow: { seed: 11, species: 'linden', nPts: 2400, leafLen: [0.1, 0.15] }, dens: 5 },
  { id: 'f8', az: 29, land: 19, yaw: 2.2, scale: 1.5, delay: 0.38, grow: { seed: 14, species: 'maple', nPts: 2400, leafLen: [0.1, 0.15] }, dens: 5 },
];
const at = (az, land) => {
  const r = coastR(az * DEG) + land;
  const x = ORIGIN[0] + Math.sin(az * DEG) * r, z = ORIGIN[2] - Math.cos(az * DEG) * r;
  return [x, heightAt(x, z) - 0.03, z];
};

export function makeGrove(ctx, G, T) {
  const atlas = makeLeafAtlas();
  const hook = GL_SHADOW + 'float extShadow(vec3 p, vec3 n) { return sunShadow(p, n); }';
  const trees = SPECS.map((s) => {
    const skel = growTree(s.grow);
    const tr = makeTree(skel, { pos: at(s.az, s.land), yaw: s.yaw, scale: s.scale }, G, { atlas, extShadowGLSL: hook, densStride: s.dens });
    tr.spec = s;
    const [bmin, bmax] = tr.bbox;
    tr.box = new THREE.Box3(new THREE.Vector3(...bmin), new THREE.Vector3(...bmax)).expandByScalar(1.5);
    return tr;
  });

  // growth clock: slow ramp + an eased step on every flush note (motif ×3)
  const ev = T.leafFlushes.map(e => ({ t: e.t, w: e.motif ? 3 : 1 }));
  const wSum = ev.reduce((a, e) => a + e.w, 0);
  const T0 = ev[0].t - 0.15, T1 = ev[ev.length - 1].t + 0.25;     // 113.85 … 124.0
  const ease = (x) => { const u = Math.min(1, Math.max(0, x)); return u * u * (3 - 2 * u); };
  function gOf(t) {
    if (t <= T0) return 0;
    let f = 0;
    for (const e of ev) if (t > e.t) f += e.w * ease((t - e.t) / 0.28);
    const lin = Math.min(1, (t - T0) / (T1 - T0));
    return Math.min(1, 0.28 * lin + 0.72 * f / wSum);
  }
  const frustum = new THREE.Frustum(), pm = new THREE.Matrix4();
  return {
    trees, gOf,
    addTo(airScene, shadowScene) { for (const tr of trees) { airScene.add(tr.group); shadowScene.add(tr.barkDepth, tr.leafDepth); } },
    /** Per frame, before the shadow and air passes. Trees outside the view are skipped entirely. */
    update(t, renderer, cam) {
      const g = gOf(t);
      pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
      frustum.setFromProjectionMatrix(pm);
      for (const tr of trees) {
        const gi = Math.min(1, Math.max(0, (g - tr.spec.delay) / (1 - tr.spec.delay)));
        const vis = gi > 0 && frustum.intersectsBox(tr.box);
        tr.group.visible = tr.barkDepth.visible = tr.leafDepth.visible = vis;
        if (vis) tr.update(gi, t, renderer);
      }
      return g;
    },
  };
}
