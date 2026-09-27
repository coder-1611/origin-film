// II · INFLATION (12 → 32 s, bars 1-7 at 84 BPM)
// 262,144 GPU particles whose positions are a pure analytic function of (seed, t):
//   comoving seed position in an egg-shaped volume → curl-noise turbulence → (bars 6-7)
//   projection onto the edges of a Voronoi tessellation (the cosmic web) → scale factor a(t)
//   (exponential inflation for 0.35 s, then a decelerating expansion) → shock/kick pushes.
// A GPGPU pass evaluates that function into a float texture at t and at t - shutter; instanced
// capsule sprites (size-attenuated, energy-conserving motion streaks, blackbody colour) are
// drawn additively in HDR. A half-res volumetric plasma fog with a uniform opacity κ(t) hides
// all but the nearest plasma until recombination (bar 5), when κ collapses and the view
// clears to 90 units. A blurred density buffer adds glow where particles crowd.
import { getNoise3D } from './ch1/noise3d.js';
import * as S from './ch2/shaders.js';

const SIDE = 512, ROWS = 2048, COUNT = SIDE * ROWS;   // 1,048,576 particles
const BANG = [0, 0, -10];                     // world position of the eruption (dead centre)
const EGG = { Rxy: 26, Rf: 12, Rb: 50 };
const SHUTTER = 1 / 120;                      // 180° shutter at 60 fps

let posPass, fogPass, compPass, downPass, blurPass;
let posA, posB, fogRT, partRT, d2, d4, d4b, d8, d8b;
let spriteScene, spriteMat, spriteGeo, orthoCam, cam, camPrev, noiseTex;
let kickCentres = [];
let T, bt;

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const sstep = (a, b, x) => { const u = clamp01((x - a) / (b - a)); return u * u * (3 - 2 * u); };
const smoother = (a, b, x) => { const u = clamp01((x - a) / (b - a)); return u * u * u * (u * (u * 6 - 15) + 10); };
let LOGK = {};
const lpwl = (name, t) => Math.exp(T.pwl(LOGK[name], t));

/** Scale factor: exponential inflation 0 → 0.35 s (×1e4), a soft landing, then slow growth. */
/** Scale factor: exponential inflation (×1e4) complete in ~2 frames, a soft landing, then a
 *  decelerating expansion. The bang is frame-exact on the 12.000 downbeat. */
const INFL = 0.022;
function aScale(t) {
  const tau = t - 12;
  if (tau <= 0) return 1e-4;
  const G = Math.log(1e4), lam = G / INFL, k = 0.35;
  const x = lam * tau - G;
  const soft = k * x > 30 ? x : Math.log1p(Math.exp(k * x)) / k;       // softplus: the landing
  const L = -G + lam * tau - soft;                                        // → 0 after inflation
  const coast = 0.62 + 0.38 * (1 - Math.exp(-tau / 0.18));               // the shell decelerates
  const post = 1 + 0.2 * Math.log1p(Math.max(0, tau - 0.05) / 0.9);      // slow expansion after
  return Math.exp(L) * coast * post;
}

function params(ctx, t) {
  const tau = t - 12;
  const f = ctx.features.at(t);
  const rec = smoother(bt(5) - 0.05, bt(5) + 0.9, t);          // recombination
  const web = smoother(25.6, 29.6, t);
  const kPre = T.pwl([[12, 0.01], [12.1, 0.05], [12.4, 0.09], [12.8, 0.12], [14, 0.13], [23.5, 0.13]], t);
  const kPost = T.pwl([[23.4, 0.018], [bt(6), 0.022], [28, 0.034], [30, 0.048], [33, 0.09]], t);
  return {
    tau, rec, web,
    a: aScale(t),
    tempK: lpwl('K', t),
    intensity: lpwl('I', t) * (1 + 0.35 * f.low + 0.25 * f.rms) * Math.min(1, Math.pow(aScale(t) / 0.6, 2)),
    sheet: 0.95 * sstep(0.05, 1.4, tau) * (1 - web),
    sheetPh: [0.075 * tau, -0.05 * tau, 0.12 * tau],
    kappa: kPre * (1 - rec) + kPost * rec,
    fogLevel: lpwl('fog', t),
    turbA: 0.45 * sstep(0.25, 2.6, tau) * (1 - 0.65 * web) * (1 + 0.5 * f.low),
    shockR: 11 * (1 - Math.exp(-Math.max(0, tau) / 2.0)),
    shockEnv: Math.exp(-Math.max(0, tau) / 1.6) * sstep(0.08, 0.35, tau),
    limb: 0.6 * Math.exp(-Math.max(0, tau) / 0.08),
    sizeW: 0.024,
    soft: 0.6 - 0.45 * rec,
    white: 0.45 * (1 - sstep(bt(3), bt(4, 3), t)),
    spark: 1.5 * rec * (1 - web),
    fogMul: 1 - 0.75 * rec,
    shellGlow: 3 * Math.exp(-Math.max(0, tau) / 0.12),
    glow1: 0.3 * (1 - 0.2 * rec) + 0.3 * web,
    glow2: 0.18 * (1 - 0.2 * rec) + 0.12 * web,
  };
}

function setPosUniforms(u, t) {
  const p = params(ctxRef, t);
  u.tau.value = p.tau; u.aScale.value = p.a; u.turbA.value = p.turbA;
  u.webPull.value = p.web; u.shockR.value = p.shockR; u.shockEnv.value = p.shockEnv; u.sheetPull.value = p.sheet;
  u.sheetPh.value.set(...p.sheetPh);
  // The two most recent kicks (local turbulence punches).
  let n = 0;
  for (let i = kickCentres.length - 1; i >= 0 && n < 2; i--) {
    const k = kickCentres[i];
    if (k.t <= t && t - k.t < 1.8) {
      u.kickA.value[n].set(k.c[0], k.c[1], k.c[2], t - k.t);
      u.kickS.value[n] = k.seed;
      n++;
    }
  }
  for (; n < 2; n++) { u.kickA.value[n].set(0, 0, 0, -1); u.kickS.value[n] = 0; }
  return p;
}
let ctxRef;

export default {
  id: 'II',

  async init(ctx) {
    const { THREE, glsl, Pass, W, H } = ctx;
    ctxRef = ctx; T = ctx.T; bt = T.bt;
    const lk = (keys) => keys.map(([a, b]) => [a, Math.log(b)]);
    LOGK = {
      K: lk([[12, 60000], [12.5, 40000], [bt(2), 26000], [bt(3), 16500], [bt(4), 9500], [bt(4, 3), 6200],
             [bt(5), 4300], [bt(5, 3), 3100], [bt(6), 2250], [bt(6, 3), 1750], [bt(7), 1400], [33, 1080]]),
      I: lk([[12, 0.25], [12.05, 0.11], [12.15, 0.13], [12.3, 0.2], [12.6, 0.36], [13.2, 0.7], [14, 1.1], [bt(3), 0.95], [bt(4), 0.85], [bt(5), 0.8],
             [bt(6), 0.6], [bt(7), 0.4], [31, 0.22], [33, 0.1]]),
      fog: lk([[12, 0.25], [12.05, 0.09], [12.15, 0.11], [12.3, 0.14], [12.6, 0.22], [13.2, 0.36], [13.8, 0.45], [14.8, 0.5], [bt(4), 0.45], [bt(5), 0.4], [bt(6), 0.1], [33, 0.06]]),
    };
    noiseTex = getNoise3D(THREE);
    cam = new THREE.PerspectiveCamera(60, ctx.aspect, 0.05, 200);
    camPrev = cam.clone();

    // Kick centres: in front of the camera at each kick, scattered across the frame.
    for (let i = 0; i < T.kicks.length; i++) {
      const tk = T.kicks[i];
      if (tk < 14 || tk > 33) continue;
      ctx.applyCamera(cam, T.sampleCamera(T.cameras.II, tk));
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
      const h = (k) => T.hash1(i * 7 + k * 131 + 99);
      const d = 8.5 + 4 * h(1);
      const side = (i % 2 ? 1 : -1);
      const ox = side * (0.15 + 0.45 * h(2)) * d * Math.tan(Math.PI / 6) * ctx.aspect;
      const oy = (h(3) * 2 - 1) * 0.45 * d * Math.tan(Math.PI / 6);
      const c = cam.position.clone().addScaledVector(fwd, d).addScaledVector(right, ox).addScaledVector(up, oy);
      kickCentres.push({ t: tk, c: [c.x, c.y, c.z], seed: 10 * h(4) });
    }

    const eggU = { Rxy: { value: EGG.Rxy }, Rf: { value: EGG.Rf }, Rb: { value: EGG.Rb } };
    const posTarget = () => ctx.makeTarget(SIDE, ROWS, { type: THREE.FloatType, linear: false });
    posA = posTarget(); posB = posTarget();
    posPass = new Pass(glsl.all + S.PARTICLE_COMMON + S.KICK_COMMON + S.POS_FRAG, {
      ...eggU, tau: { value: 0 }, aScale: { value: 1 }, turbA: { value: 0 }, webPull: { value: 0 }, webCell: { value: 6.5 },
      shockR: { value: 0 }, shockEnv: { value: 0 }, C: { value: new THREE.Vector3(...BANG) },
      sheetPull: { value: 0 }, sheetFreq: { value: 0.15 }, sheetPh: { value: new THREE.Vector3() },
      kickA: { value: [new THREE.Vector4(0, 0, 0, -1), new THREE.Vector4(0, 0, 0, -1)] }, kickS: { value: [0, 0] },
    });

    fogRT = ctx.makeTarget(Math.round(W / 2), Math.round(H / 2));
    fogPass = new Pass(glsl.all + S.KICK_COMMON + S.FOG_FRAG, {
      ...eggU, noiseTex: { value: noiseTex }, camPos: { value: new THREE.Vector3() }, camRot: { value: new THREE.Matrix3() },
      tanHalf: { value: Math.tan(Math.PI / 6) }, aspect: { value: ctx.aspect }, C: { value: new THREE.Vector3(...BANG) },
      aScale: { value: 1 }, tau: { value: 0 }, kappa: { value: 0 }, fogLevel: { value: 1 }, tempK: { value: 6000 },
      shockR: { value: 0 }, shockEnv: { value: 0 }, limb: { value: 0 }, frame: { value: 0 },
      sheetGlow: { value: 0 }, sheetFreq: { value: 0.15 }, sheetPh: { value: new THREE.Vector3() },
      kickA: { value: [new THREE.Vector4(0, 0, 0, -1), new THREE.Vector4(0, 0, 0, -1)] },
    });

    partRT = ctx.makeTarget(W, H);
    d2 = ctx.makeTarget(W / 2, H / 2); d4 = ctx.makeTarget(W / 4, H / 4); d4b = ctx.makeTarget(W / 4, H / 4);
    d8 = ctx.makeTarget(W / 8, H / 8); d8b = ctx.makeTarget(W / 8, H / 8);
    downPass = new Pass(glsl.header + S.DOWN_FRAG, { src: { value: null }, texel: { value: new THREE.Vector2() } });
    blurPass = new Pass(glsl.header + S.BLUR_FRAG, { src: { value: null }, dir: { value: new THREE.Vector2() } });
    compPass = new Pass(glsl.header + glsl.color + S.COMP_FRAG, {
      partTex: { value: partRT.texture }, fogTex: { value: fogRT.texture }, glowA: { value: d4.texture }, glowB: { value: d8.texture },
      on: { value: 1 }, glowGain: { value: 0.3 }, glowGain2: { value: 0.2 },
      core: { value: new THREE.Vector4() }, res: { value: new THREE.Vector2(W, H) }, trim: { value: 1 },
    });

    // Instanced capsule sprites.
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    geo.setAttribute('aDummy', new THREE.InstancedBufferAttribute(new Float32Array(COUNT), 1));
    geo.instanceCount = COUNT;
    spriteGeo = geo;
    spriteMat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: glsl.all + S.PARTICLE_COMMON + S.SPRITE_VERT,
      fragmentShader: glsl.header + S.SPRITE_FRAG,
      uniforms: {
        ...eggU, posNow: { value: posA.texture }, posPrev: { value: posB.texture },
        viewProj: { value: new THREE.Matrix4() }, prevViewProj: { value: new THREE.Matrix4() },
        res: { value: new THREE.Vector2(W, H) }, projScale: { value: 1 }, sizeW: { value: 0.05 }, intensity: { value: 1 },
        tempK: { value: 6000 }, kappa: { value: 0 }, soft: { value: 1 }, shellGlow: { value: 0 },
        rMin: { value: Math.max(0.7, 0.9 * H / 1080) }, rMax: { value: 16 * H / 1080 },
        tau: { value: 0 }, hotAmp: { value: 1 }, nearFade: { value: 5.0 }, white: { value: 0 }, spark: { value: 0 },
        rRef: { value: 2.2 * H / 1080 },
      },
      blending: THREE.AdditiveBlending, transparent: true, depthTest: false, depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, spriteMat);
    mesh.frustumCulled = false;
    spriteScene = new THREE.Scene(); spriteScene.add(mesh);
    orthoCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  },

  render(ctx, t, target) {
    const { renderer: r, THREE } = ctx;
    if (t < 12) { ctx.clear(target, [0, 0, 0]); return; }     // pure black before the bang

    // Cameras at t and t - shutter.
    ctx.applyCamera(cam, T.sampleCamera(T.cameras.II, t));
    ctx.applyCamera(camPrev, T.sampleCamera(T.cameras.II, t - SHUTTER));

    // Positions at t and at t - shutter (a pure function of t: no state).
    const pu = posPass.uniforms;
    setPosUniforms(pu, t - SHUTTER);
    posPass.render(r, posB);
    const p = setPosUniforms(pu, t);
    posPass.render(r, posA);

    // Plasma fog.
    const fu = fogPass.uniforms;
    fu.camPos.value.copy(cam.position);
    fu.camRot.value.setFromMatrix4(cam.matrixWorld);
    fu.aScale.value = p.a; fu.tau.value = p.tau; fu.kappa.value = p.kappa; fu.fogLevel.value = p.fogLevel * p.fogMul; fu.sheetGlow.value = p.sheet; fu.sheetPh.value.set(...p.sheetPh);
    fu.tempK.value = p.tempK; fu.shockR.value = p.shockR; fu.shockEnv.value = p.shockEnv; fu.limb.value = p.limb;
    fu.frame.value = ctx.frameSeed(t) % 997;
    for (let k = 0; k < 2; k++) fu.kickA.value[k].copy(pu.kickA.value[k]);
    fogPass.render(r, fogRT);

    // Sprites.
    const su = spriteMat.uniforms;
    // While the fireball is only a few pixels across, draw a random subset (particles are
    // hash-ordered) with compensating intensity: identical look, no blend pile-up.
    // Same during the 2-3 frames of peak streak length (energy-conserving capsules, far fewer px).
    let frac = Math.min(1, Math.max(1 / 64, Math.pow(p.a / 0.12, 2)));
    frac *= 0.2 + 0.8 * sstep(0.04, 0.1, p.tau);
    spriteGeo.instanceCount = Math.max(1, Math.round(COUNT * frac));
    su.viewProj.value.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    su.prevViewProj.value.multiplyMatrices(camPrev.projectionMatrix, camPrev.matrixWorldInverse);
    su.projScale.value = 0.5 * ctx.H / Math.tan(cam.fov * Math.PI / 360);
    // ×0.5 per particle: 2^20 particles carry the light that 2^19 did.
    su.sizeW.value = p.sizeW; su.intensity.value = p.intensity * 0.5 * COUNT / spriteGeo.instanceCount;
    su.tempK.value = p.tempK;
    su.kappa.value = p.kappa; su.soft.value = p.soft; su.shellGlow.value = p.shellGlow; su.tau.value = p.tau;
    su.white.value = p.white; su.spark.value = p.spark;
    ctx.clear(partRT, [0, 0, 0]);
    r.autoClear = false;
    r.setRenderTarget(partRT);
    r.render(spriteScene, orthoCam);
    r.autoClear = true;

    // Density glow: 1/4 and 1/8 resolution blurs of the particle buffer.
    const tx = (rt) => new THREE.Vector2(1 / rt.width, 1 / rt.height);
    downPass.render(r, d2, { src: partRT.texture, texel: tx(partRT) });
    downPass.render(r, d4, { src: d2.texture, texel: tx(d2) });
    blurPass.render(r, d4b, { src: d4.texture, dir: new THREE.Vector2(1 / d4.width, 0) });
    blurPass.render(r, d4, { src: d4b.texture, dir: new THREE.Vector2(0, 1 / d4.height) });
    downPass.render(r, d8, { src: d4.texture, texel: tx(d4) });
    blurPass.render(r, d8b, { src: d8.texture, dir: new THREE.Vector2(1 / d8.width, 0) });
    blurPass.render(r, d8, { src: d8b.texture, dir: new THREE.Vector2(0, 1 / d8.height) });

    // The eruption core: from the exact centre pixel at 12.000, sized to the projected fireball,
    // bridging the frames where the inflating particle cloud is still sub-pixel.
    // At 12.000 a white-hot core already fills most of the frame; it swells past the frame
    // edges and decays in ~3 frames (the engine's flash rides on top).
    const coreI = 3.0 * Math.exp(-p.tau / 0.018);
    compPass.uniforms.core.value.set(coreI > 1e-4 ? coreI : 0, 0.33 + 3.0 * p.tau, 0, 0);
    // The engine multiplies exposure by (1 + flash) at the bang; soften its tail on the plasma so
    // structure reads from ~12.1 while the flash still visibly decays.
    const trim = Math.pow(1 + T.flashAt(t), -0.6);
    compPass.render(r, target, { on: 1, glowGain: p.glow1, glowGain2: p.glow2, trim });
  },

  post(t) {
    const rec = smoother(bt(5) - 0.05, bt(5) + 0.9, t);
    return {
      bloom: 0.75 - 0.2 * rec, threshold: 1.0, knee: 0.7, bloomRadius: 1.1,
      vignette: 0.4, grain: 0.032, ca: 0.0022 - 0.001 * rec, saturation: 1.05,
    };
  },
};
