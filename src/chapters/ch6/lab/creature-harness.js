// VI lab: creature scenes for the harness (tools/scratch/lab.html?scene=creatures).
//   render({ stage: 'lizard', t, mode: 'sil' | 'real' })      one stage, walking
//   render({ evo: τ ∈ [0, 10], mode })                          the 10 s evolution walk
// Uses ch6's own sunset sky (GL_SKY with its ~131 s palette) so the look matches the chapter.
import * as THREE from '../../../vendor/three.module.js';
import { DEFAULT_POST } from '../../../engine/post.js';
import { makeGlobals, GL_UNIFORMS, GL_SKY } from '../common.js';
import { makeNoiseTexture } from '../textures.js';
import { poseCreature, STAGES } from './creatures.js';
import { makeCreatureRenderer } from './creature-render.js';
import { evolutionFrame, placeCreature } from './evolution.js';

const DEG = Math.PI / 180;

export async function makeCreatureScene(ctx, { post, hdr, W, H }) {
  const t0 = performance.now();
  const G = makeGlobals();
  const noise = makeNoiseTexture(ctx);
  G.uNoise.value = noise.texture;
  // sunset palette of ch6 at ~131 s: sun ~1° above the sea
  const e = 0.9 * DEG, az = 6 * DEG;
  G.uSunDir.value.set(Math.sin(az) * Math.cos(e), Math.sin(e), -Math.cos(az) * Math.cos(e));
  G.uSunCol.value.set(2.4, 1.0, 0.3); G.uSkyZen.value.set(0.014, 0.022, 0.07); G.uSkyMid.value.set(0.24, 0.10, 0.12);
  G.uSkyHor.value.set(0.95, 0.34, 0.10); G.uSkyHor2.value.set(0.20, 0.12, 0.19); G.uSunDisk.value = 10; G.uSunVis.value = 1; G.uDusk.value = 0;
  const sky = GL_UNIFORMS + GL_SKY;
  const R = { sil: makeCreatureRenderer({ mode: 'sil', skyGLSL: sky, uniforms: G }), real: makeCreatureRenderer({ mode: 'real', skyGLSL: sky, uniforms: G }) };
  const cam = new THREE.PerspectiveCamera(22, W / H, 0.05, 5000);
  // normalised framing: every creature is shown ~1 world unit tall (its frameH), ~45 % of the frame
  const D = 1 / (0.45 * 2 * Math.tan(11 * DEG));
  cam.position.set(0, 0.11, D);
  cam.up.set(0, 1, 0);
  cam.lookAt(new THREE.Vector3(0, 0.11 + D * Math.tan(2.6 * DEG), 0));
  cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);

  const initMs = performance.now() - t0;
  return {
    initMs,
    stats: () => STAGES.map(s => ({ stage: s, prims: poseCreature(s, 0).prims.length })),
    render(o) {
      const mode = o.mode || 'sil';
      { const e = (o.sunEl ?? 0.9) * DEG, az = (o.sunAz ?? 6) * DEG; G.uSunDir.value.set(Math.sin(az) * Math.cos(e), Math.sin(e), -Math.cos(az) * Math.cos(e)); }
      let A, B = null, morph = 0, t, flame = null, water = 0;
      if (o.evo !== undefined) {
        t = o.evo;
        const f = evolutionFrame(o.evo);
        A = f.A; flame = f.flame; water = f.water;
      } else {
        t = o.t ?? 0.4;
        A = placeCreature(o.stage || 'lizard', t);
        water = o.stage === 'tiktaalik' ? 1 : 0;
        if (A.pose.flame) flame = [A.pose.flame[0] * A.k + A.world[0], A.pose.flame[1] * A.k, 0.24 * A.k * (0.95 + 0.1 * Math.sin(t * 11))];
      }
      G.uT.value = t;
      const src = A;
      // optional: place the walk in a rotated / translated world frame (as ch6 would, facing the sunset)
      let camUse = cam, frame = null;
      if (o.yaw) {
        const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), o.yaw * DEG);
        const origin = new THREE.Vector3(...(o.origin || [0, 0, 0]));
        camUse = cam.clone();
        camUse.position.copy(cam.position).applyQuaternion(q).add(origin);
        camUse.quaternion.premultiply(q);
        camUse.updateMatrixWorld(true);
        frame = { rot: new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(q)), origin };
        G.uSunDir.value.applyQuaternion(q);
      }
      R[mode].render(ctx.renderer, hdr, camUse, { frame, A, B, morph, t, H, seaZ: -2.2, waterFront: water, flame, scroll: src.scroll });
      post.run(hdr, { ...DEFAULT_POST, bloom: 0.5, threshold: 1.2, knee: 0.5, vignette: 0.45, grain: 0.03, ca: 0.0012, saturation: 1.08, ...(o.post || {}) }, null,
        { frameSeed: Math.round(t * 60) % 100000, uiOn: false });
      return { jsMs: 0 };
    },
  };
}
