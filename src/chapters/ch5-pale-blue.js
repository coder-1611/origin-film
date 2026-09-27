// V · PALE BLUE (81.988 – 106.000, bars 29–40, F major)
// Showcase: a procedural planet shader. The molten disc handed over by IV cools in a
// time-lapse (cracks fade, seas rise, first clouds), becomes the pale blue dot (fbm continents,
// GGX sun glint on wind-roughened seas, Rayleigh + Mie single scattering, cyclones casting
// shadows), then the camera dives: the limb flattens, the sky turns blue, the cloud deck
// whites out (hiding the switch to a local flat-ocean renderer), open ocean with glitter, and
// the plunge at T.SPLASH_T into a teal underwater field with shafts, caustics and bubbles.
// Every frame is a pure function of t (no simulation state).
import { LUT_FRAG } from './ch5/atmo.js';
import { PLANET_FRAG } from './ch5/planet.js';
import { LOCAL_FRAG, CLOUD_FRAG, COV_FRAG } from './ch5/ocean.js';
import { UNDER_FRAG, bubbleState, MAX_BUBBLES } from './ch5/under.js';
import * as P from './ch5/path.js';

let lut, planet, local, cloud, under, cloudRT, fr = null, frKey = '';
const V3 = (THREE, a) => new THREE.Vector3(a[0], a[1], a[2]);
const M3 = (THREE, rows) => new THREE.Matrix3().set(...rows[0], ...rows[1], ...rows[2]);

// Integrate a piecewise-smooth rate (pure function of t).
function integrate(rate, a, t) {
  const b = Math.max(a, t);
  const n = 2 * Math.max(1, Math.ceil((b - a) / 0.05));
  const h = (b - a) / n;
  let s = rate(a) + rate(b);
  for (let i = 1; i < n; i++) s += rate(a + i * h) * (i % 2 ? 4 : 2);
  return s * h / 3;
}
const cloudRate = (t) => 0.4 + 5.5 * P.smooth(82.8, 83.6, t) * (1 - P.smooth(84.8, 86.8, t));

// Kick envelope for local reactions (not a global flash: the compositor already pulses exposure).
function kickEnv(T, t, tau = 0.18) {
  let e = 0;
  for (const k of T.kicks) { if (k > t) break; if (t - k < tau * 6) e += Math.exp(-(t - k) / tau); }
  return e;
}

export default {
  id: 'V',

  async init(ctx) {
    const { THREE, glsl, Pass, makeTarget, renderer } = ctx;
    // Transmittance LUT (once).
    lut = makeTarget(256, 64);
    new Pass(LUT_FRAG(glsl), {}).render(renderer, lut);
    renderer.setRenderTarget(null);

    const common = () => ({
      uTrans: { value: lut.texture }, uSun: { value: V3(THREE, P.SUN) },
      uAtmo: { value: 1 }, uHaze: { value: 1 }, uSunI: { value: 1.35 }, uMS: { value: 0.08 },
      uCamPos: { value: new THREE.Vector3() }, uCamR: { value: new THREE.Vector3() }, uCamU: { value: new THREE.Vector3() }, uCamF: { value: new THREE.Vector3() },
      uTanHalf: { value: Math.tan(20 * Math.PI / 180) }, uAspect: { value: ctx.aspect }, uRes: { value: new THREE.Vector2(ctx.W, ctx.H) },
      uTime: { value: 0 },
    });
    planet = new Pass(PLANET_FRAG(glsl), {
      ...common(),
      uSpin: { value: new THREE.Matrix3() }, uCSpin: { value: new THREE.Matrix3() }, uCloudT: { value: 0 },
      uMolten: { value: 1 }, uCrust: { value: 1 }, uSea: { value: -1 }, uCloud: { value: 0 }, uFog: { value: 0 }, uStars: { value: 1 },
      uKick: { value: 0 }, uShimmer: { value: 0 }, uOcean: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] },
      uCyc: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] }, uDeck: { value: new THREE.Vector4() }, uClear: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] },
    });
    // Local ocean renderer + half-res volumetric cloud slab.
    const cw = Math.round(ctx.W / 2), ch = Math.round(ctx.H / 2);
    cloudRT = makeTarget(cw, ch);
    // Bake the cloud-deck coverage (a static 2D field) once: the slab samples it ~150x per pixel.
    const covRT = makeTarget(1024, 1024);
    new Pass(COV_FRAG(glsl), { ...common(), uCov: { value: null } }).render(renderer, covRT);
    renderer.setRenderTarget(null);
    const localU = () => ({
      ...common(),
      uLocR: { value: new THREE.Vector3() }, uLocU: { value: new THREE.Vector3() }, uLocF: { value: new THREE.Vector3() },
      uSunL: { value: new THREE.Vector3() }, uAlt: { value: 1000 }, uAlong: { value: 0 },
      uN0: { value: new THREE.Vector3() }, uX: { value: new THREE.Vector3() }, uZ: { value: new THREE.Vector3() },
      uWeight: { value: 1 }, uSplash: { value: 0 }, uGlitter: { value: 0 }, uVeil: { value: 0 }, uCov: { value: covRT.texture },
    });
    cloud = new Pass(CLOUD_FRAG(glsl), { ...localU(), uRes: { value: new THREE.Vector2(cw, ch) } });
    local = new Pass(LOCAL_FRAG(glsl), { ...localU(), uClouds: { value: cloudRT.texture } },
      { blending: THREE.CustomBlending, transparent: true });
    local.material.blendSrc = THREE.SrcAlphaFactor;
    local.material.blendDst = THREE.OneMinusSrcAlphaFactor;
    local.material.blendEquation = THREE.AddEquation;
    local.material.blendSrcAlpha = THREE.OneFactor;
    local.material.blendDstAlpha = THREE.ZeroFactor;
    // Underwater.
    under = new Pass(UNDER_FRAG(glsl), {
      ...common(),
      uLocR: { value: new THREE.Vector3() }, uLocU: { value: new THREE.Vector3() }, uLocF: { value: new THREE.Vector3() },
      uSunL: { value: new THREE.Vector3() }, uDepth: { value: 0 }, uSince: { value: 0 }, uAlong: { value: 0 },
      uBub: { value: Array.from({ length: MAX_BUBBLES }, () => new THREE.Vector4()) }, uNBub: { value: 0 },
      uKick: { value: 0 }, uHigh: { value: 0 },
    });
  },

  render(ctx, t, target) {
    const { THREE, renderer: r, T } = ctx;
    const key = JSON.stringify(T.cameras.V);
    if (key !== frKey) { fr = P.descentFrame(T); frKey = key; }
    const cam = P.cameraAt(T, t, fr);
    const feat = ctx.features.at(t);
    const tanHalf = Math.tan(cam.fov * Math.PI / 360);
    const kick = kickEnv(T, t);

    // ---------------------------------------------------------- planet (orbit + dive)
    if (t < P.PH.sw1) {
      const phi = P.spinAngle(t);
      const u = planet.uniforms;
      u.uCamPos.value.set(...cam.pos); u.uCamR.value.set(...cam.r); u.uCamU.value.set(...cam.u); u.uCamF.value.set(...cam.f);
      u.uTanHalf.value = tanHalf;
      u.uTime.value = t - 81;
      u.uSpin.value.copy(M3(THREE, P.spinMatrix(phi)));
      const cspin = (tt) => P.spinMatrix(P.spinAngle(tt) * 1.06 + 0.004 * (tt - 81));
      u.uCSpin.value.copy(M3(THREE, cspin(t)));
      const dk = P.applyRows(cspin(100.3), fr.N0);
      u.uDeck.value.set(dk[0], dk[1], dk[2], 0.16);
      // keep the sun glint's track mostly clear of cloud (cloud-fixed positions at 87, 91, 95 s)
      [87, 91, 95].forEach((tg, i) => {
        const c = P.cameraAt(T, tg, fr);
        const g = P.applyRows(cspin(tg), P.norm(P.add(P.norm(c.pos), P.SUN)));
        u.uClear.value[i].set(g[0], g[1], g[2], 0.32);
      });
      u.uCloudT.value = integrate(cloudRate, 81, t);
      u.uMolten.value = 1 - P.smoother(82.2, 84.9, t);
      u.uCrust.value = 1 - P.smooth(83.6, 86.4, t);
      const seaU = P.smooth(82.7, 85.8, t);
      u.uSea.value = -1.1 + (0.075 + 1.1) * (1 - Math.pow(1 - seaU, 2.2));
      u.uCloud.value = P.smooth(83.0, 86.6, t);
      u.uAtmo.value = P.smooth(82.3, 85.6, t);
      u.uStars.value = 1 - P.smooth(97.6, 99.4, t);
      u.uFog.value = P.smooth(P.PH.fog0, P.PH.sw1, t);
      u.uShimmer.value = Math.min(1.2, 0.5 * kick + 0.3 * feat.high);
      u.uKick.value = kick;
      // Ocean basins: under the descent point, and along the sun glint's track (88 s, 94 s).
      const q0 = P.applyRows(P.spinMatrix(P.spinAngle(100.5)), fr.N0);
      u.uOcean.value[0].set(q0[0], q0[1], q0[2], 0.9);
      [88, 94, 85.5].forEach((tg, i) => {
        const c = P.cameraAt(T, tg, fr);
        const g = P.applyRows(P.spinMatrix(P.spinAngle(tg)), P.norm(P.add(P.norm(c.pos), P.SUN)));
        u.uOcean.value[i + 1].set(g[0], g[1], g[2], 0.75);
      });
      // Cyclones: fixed in the cloud frame (placed where the camera looks during 88-96).
      const cs = P.spinMatrix(P.spinAngle(92) * 1.06 + 0.004 * 11);
      const place = [[-0.35, 0.42, 0.84, 1.0], [0.46, -0.30, 0.83, -0.8], [-0.62, -0.2, 0.76, -0.55]];
      place.forEach((c, i) => {
        const w = P.applyRows(cs, P.norm(c.slice(0, 3)));
        u.uCyc.value[i].set(w[0], w[1], w[2], c[3] * P.smooth(85.0, 89.0, t));
      });
      planet.render(r, target);
    }
    // ---------------------------------------------------------- local ocean (in the whiteout)
    if (t >= P.PH.sw0 && t < P.PH.splash) {
      const L = cam.local;
      const sl = P.sunLocal(fr);
      const w = P.smooth(P.PH.sw0, P.PH.sw1, t);
      for (const pass of [cloud, local]) {
        const u = pass.uniforms;
        u.uLocR.value.set(...L.r); u.uLocU.value.set(...L.u); u.uLocF.value.set(...L.f);
        u.uSunL.value.set(...sl); u.uSun.value.set(...sl); u.uAlt.value = L.alt; u.uAlong.value = L.along; u.uTime.value = t - 81;
        u.uN0.value.set(...fr.N0); u.uX.value.set(...fr.X); u.uZ.value.set(...fr.Z);
        u.uTanHalf.value = tanHalf; u.uWeight.value = w;
        u.uSplash.value = Math.min(1, Math.max(0, (t - 101.822) / 0.178));   // ~10 frames before the flash
        u.uGlitter.value = Math.min(1.5, 0.3 * feat.high + 0.6 * kick);
        u.uVeil.value = 0.0;
      }
      cloud.render(r, cloudRT);
      r.autoClear = false;                 // blend over the (whited-out) planet frame
      local.render(r, target);
      r.autoClear = true;
    }
    // ---------------------------------------------------------- underwater
    if (t >= P.PH.splash - 1e-9 || t >= T.SPLASH_T) {
      const L = cam.local;
      const u = under.uniforms;
      u.uLocR.value.set(...L.r); u.uLocU.value.set(...L.u); u.uLocF.value.set(...L.f);
      u.uSunL.value.set(...P.sunLocal(fr));
      u.uDepth.value = P.underDepth(t);
      u.uSince.value = t - T.SPLASH_T;
      u.uAlong.value = L.along;
      u.uTime.value = t - 81;
      u.uTanHalf.value = tanHalf;
      u.uKick.value = kick; u.uHigh.value = feat.high;
      const bs = bubbleState(T, t, ctx.aspect);
      for (let i = 0; i < MAX_BUBBLES; i++) u.uBub.value[i].set(...(bs[i] || [0, 0, 0, 0]));
      u.uNBub.value = bs.length;
      under.render(r, target);
    }
    r.setRenderTarget(null);
  },

  post(t) {
    // Space: crisp, low grain; underwater: softer, more bloom for the shafts.
    const uw = P.smooth(101.95, 102.4, t);
    return {
      exposure: 1.0,
      bloom: 0.5 + 0.25 * uw,
      threshold: 1.0 - 0.25 * uw,
      knee: 0.6,
      bloomRadius: 1.0,
      vignette: 0.32 + 0.1 * uw,
      grain: 0.028 + 0.012 * uw,
      ca: 0.0012,
      saturation: 1.0,
    };
  },
};
