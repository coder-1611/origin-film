// III · FIRST LIGHT (32.000–58.000 s, bars 8–17; window 30.0–58.6).
//
// Technique: a half-resolution volumetric fbm raymarch (emission/absorption, H-α + O-III, dust
// lanes, ionisation fronts and wind-blown cavities around every newborn star), screen-space light
// shafts from the brightest stars, then a scale dissolve into a Lin–Shu density-wave spiral galaxy
// (~220k instanced star particles on rotating ellipses + analytic thin-disk light, dust and bulge),
// and a dive into the future Sun that ends in the III → IV glare.
//
// Every frame is a pure function of t: no simulation state. Star births are unprojected through the
// camera at their exact event time (T.starBirths) and then live in the world.
import { buildGalaxy, NEB, NU, NEB_R, SUN, G as GAL, PSF_SIGMA_NDC } from './ch3/galaxy.js';
import { makeRig, basis, project, unproject } from './ch3/rig.js';
import { bakeNoise } from './ch3/noise3d.js';
import * as SH from './ch3/shaders.js';

const S = {};
const lerp = (a, b, u) => a + (b - a) * u;
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const sstep = (a, b, x) => { const u = clamp01((x - a) / (b - a)); return u * u * (3 - 2 * u); };
const toNeb = (p) => [(p[0] - NEB[0]) / NU, (p[1] - NEB[1]) / NU, (p[2] - NEB[2]) / NU];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const NEBP = [['cliffY', -3.4], ['dustAmt', 1], ['gasAmt', 1], ['dustS', 1.15], ['gasS', 0.07], ['sheetP', 3], ['filK', 1.2], ['pillarH', 4.2], ['rimK', 2.2], ['o3K', 1.6], ['nearClip', 2.0], ['o3lo', 0.18], ['o3hi', 0.42], ['fmax', 2.6], ['o3r', 0.75]];
const RAY_STARS = [0, 5, 9];          // births that throw light shafts (0 = the first star)
const CHORD_O3 = { Dm9: 0.18, Dm: 0.0, Bbmaj7: 0.22, Bb: 0.1, Gm9: -0.06, Gm: -0.1, 'Dm/F': 0.05, C: 0.12, A: 0.2, A7sus4: 0.1 };

function sphereChord(o, d, R) {       // o in NU, unit d → [t0, t1] or null
  const b = o[0] * d[0] + o[1] * d[1] + o[2] * d[2];
  const c = o[0] * o[0] + o[1] * o[1] + o[2] * o[2] - R * R;
  const h = b * b - c; if (h <= 0) return null;
  const s = Math.sqrt(h); return [Math.max(-b - s, 0), -b + s];
}

export default {
  id: 'III',

  async init(ctx) {
    const { THREE, T, Pass, glsl, makeTarget } = ctx;
    S.rig = makeRig(T.cameras.III, { neb: NEB, sun: SUN });
    S.noise = bakeNoise(ctx);
    const gal = buildGalaxy();
    S.gal = gal;

    // Disk maps → half-float texture (linear filtering is core for half floats).
    const M = GAL.MAP, hf = new Uint16Array(M * M * 4);
    for (let i = 0; i < hf.length; i++) hf[i] = THREE.DataUtils.toHalfFloat(gal.maps[i]);
    S.galMap = new THREE.DataTexture(hf, M, M, THREE.RGBAFormat, THREE.HalfFloatType);
    S.galMap.minFilter = S.galMap.magFilter = THREE.LinearFilter;
    S.galMap.wrapS = S.galMap.wrapT = THREE.ClampToEdgeWrapping;
    S.galMap.colorSpace = THREE.NoColorSpace;
    S.galMap.needsUpdate = true;

    const hw = Math.ceil(ctx.W / 2), hh = Math.ceil(ctx.H / 2);
    S.hw = hw; S.hh = hh;
    S.nebRT = new THREE.WebGLRenderTarget(hw, hh, {
      count: 2, type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false,
    });
    for (const tx of S.nebRT.textures) { tx.colorSpace = THREE.NoColorSpace; tx.minFilter = tx.magFilter = THREE.LinearFilter; }
    S.raysRT = makeTarget(hw, hh);
    S.nebDN = makeTarget(hw, hh);
    S.hRT = makeTarget(512, 512);
    { const hp = new Pass(SH.HEIGHT(glsl), { noiseTex: { value: S.noise } }); hp.render(ctx.renderer, S.hRT); hp.material.dispose(); }
    S.LVN = 80;
    S.lightRT = new THREE.WebGL3DRenderTarget(S.LVN, S.LVN, S.LVN, {
      type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false,
    });
    S.lightRT.texture.colorSpace = THREE.NoColorSpace;
    S.extRT = makeTarget(SH.MAXB, 1, { linear: false });

    const V3 = () => new THREE.Vector3();
    const camU = () => ({ camR: { value: V3() }, camU: { value: V3() }, camF: { value: V3() }, tanHalf: { value: 0.5 }, aspect: { value: ctx.aspect } });
    S.nebPass = new Pass(SH.NEBULA(glsl), {
      ...camU(), noiseTex: { value: S.noise }, nebSeed: { value: 0 }, camN: { value: V3() }, res: { value: new THREE.Vector2(hw, hh) },
      lightTex: { value: S.lightRT.texture }, hTex: { value: S.hRT.texture }, nSteps: { value: 60 }, pxAng: { value: 0.001 },
      amb: { value: 0 }, gain: { value: 1 }, o3bias: { value: 0 }, shimmer: { value: 0 }, t: { value: 0 },
      cliffY: { value: -1.8 }, dustAmt: { value: 1 }, gasAmt: { value: 1 }, dustS: { value: 1.15 }, gasS: { value: 0.07 }, rimK: { value: 0.9 }, o3K: { value: 1 },
      sheetP: { value: 5 }, nearClip: { value: 2.0 }, o3lo: { value: 1.0 }, o3hi: { value: 6.0 }, filK: { value: 1.2 }, fmax: { value: 6 }, o3r: { value: 1 }, haloK: { value: 0 }, cavR: { value: 0 }, cavC: { value: V3() }, pillarH: { value: 4 },
    });
    S.dnPass = new Pass(SH.DENOISE(glsl), { src: { value: S.nebRT.textures[0] }, texel: { value: new THREE.Vector2(1 / hw, 1 / hh) }, sigma: { value: 1.0 } });
    S.lvPass = new Pass(SH.LIGHTVOL(glsl), {
      zSlice: { value: 0 }, res: { value: S.LVN }, halfExt: { value: 11.0 }, o3r: { value: 0.9 },
      nL: { value: 0 }, lPos: { value: Array.from({ length: SH.MAXL }, V3) }, lPar: { value: Array.from({ length: SH.MAXL }, () => new THREE.Vector4()) },
    });
    S.extPass = new Pass(SH.EXTINCTION(glsl), {
      ...camU(), noiseTex: { value: S.noise }, nebSeed: { value: 0 }, camN: { value: V3() },
      sN: { value: Array.from({ length: SH.MAXB }, V3) }, nS: { value: 0 }, hTex: { value: S.hRT.texture },
      cliffY: { value: -1.8 }, dustAmt: { value: 1 }, gasAmt: { value: 1 }, dustS: { value: 1.15 }, gasS: { value: 0.07 }, sheetP: { value: 5 }, filK: { value: 1.2 }, cavR: { value: 0 }, cavC: { value: V3() }, pillarH: { value: 4 },
    });
    // Angular beam pattern for the light shafts: periodic in angle (x) and in slow time (y).
    {
      const BW = 512, BH = 64, R = T.mulberry32(0xBEA3), comps = [];
      for (let k = 0; k < 12; k++) comps.push({ f: 2 + Math.floor(R() * 11), m: 1 + Math.floor(R() * 3), ph: R() * 6.2832, a: 1 / (1 + k * 0.2) });
      const d = new Uint8Array(BW * BH * 4);
      let lo = 1e9, hi = -1e9; const v = new Float32Array(BW * BH);
      for (let y = 0; y < BH; y++) for (let x = 0; x < BW; x++) {
        let a = 0; for (const c of comps) a += c.a * Math.sin(6.2832 * (c.f * x / BW + c.m * y / BH) + c.ph);
        v[y * BW + x] = a; lo = Math.min(lo, a); hi = Math.max(hi, a);
      }
      for (let i = 0; i < BW * BH; i++) { const u = Math.round(255 * (v[i] - lo) / (hi - lo)); d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = u; d[i * 4 + 3] = 255; }
      S.beamTex = new THREE.DataTexture(d, BW, BH, THREE.RGBAFormat, THREE.UnsignedByteType);
      S.beamTex.wrapS = S.beamTex.wrapT = THREE.RepeatWrapping;
      S.beamTex.minFilter = S.beamTex.magFilter = THREE.LinearFilter;
      S.beamTex.needsUpdate = true;
    }
    S.raysPass = new Pass(SH.RAYS(glsl), {
      neb0: { value: S.nebRT.textures[0] }, neb1: { value: S.nebRT.textures[1] },
      rS: { value: [0, 1, 2].map(() => new THREE.Vector4()) }, rC: { value: [0, 1, 2].map(V3) }, aspect: { value: ctx.aspect }, rayK: { value: 1 }, beamTex: { value: null }, beamT: { value: 0 },
    });
    S.compPass = new Pass(SH.COMPOSITE(glsl), {
      ...camU(), neb0: { value: S.nebDN.texture }, rays: { value: S.raysRT.texture }, galMap: { value: S.galMap }, extTex: { value: S.extRT.texture },
      noiseTex: { value: S.noise }, halfRes: { value: new THREE.Vector2(hw, hh) }, res: { value: new THREE.Vector2(ctx.W, ctx.H) },
      nebOn: { value: 0 }, raysOn: { value: 0 }, camG: { value: V3() }, galDiff: { value: 0 }, bulgeOn: { value: 0 }, dustK: { value: 1.6 },
      EXT: { value: GAL.EXT }, galT: { value: 0 }, nB: { value: 0 }, diffK: { value: 1 }, bulgeK: { value: 1 }, nucK: { value: 1 },
      bP: { value: Array.from({ length: SH.MAXB }, () => new THREE.Vector4()) }, bC: { value: Array.from({ length: SH.MAXB }, () => new THREE.Vector4()) },
      sunP: { value: new THREE.Vector4() }, sunF: { value: new THREE.Vector4() }, knot: { value: new THREE.Vector4() }, glareW: { value: 0 },
      psf: { value: PSF_SIGMA_NDC }, t: { value: 0 },
    });

    // Instanced star particles.
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    geo.setAttribute('aOrb', new THREE.InstancedBufferAttribute(gal.orb, 4));
    geo.setAttribute('aExt', new THREE.InstancedBufferAttribute(gal.ext, 4));
    geo.setAttribute('aCol', new THREE.InstancedBufferAttribute(gal.col, 4));
    geo.instanceCount = gal.n;
    S.partMat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: SH.PARTICLE_VERT(glsl), fragmentShader: SH.PARTICLE_FRAG(glsl),
      uniforms: {
        t: { value: 0 }, tRef: { value: GAL.tRef }, camPos: { value: V3() }, ...camU(),
        psf: { value: PSF_SIGMA_NDC }, galGain: { value: 1 }, hiiGain: { value: 1 }, dSoft: { value: 0.3 }, oldGain: { value: 0.5 }, galVis: { value: 0 }, localNVis: { value: 1 }, localSVis: { value: 0 }, nebOn: { value: 0 }, twinkle: { value: 0.08 },
        resY: { value: ctx.H }, EXT: { value: GAL.EXT }, dustK: { value: 1.6 }, camN: { value: V3() }, NU: { value: NU }, nebC: { value: V3() },
        neb1: { value: S.nebRT.textures[1] }, galMap: { value: S.galMap }, noiseTex: { value: S.noise },
      },
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendEquation: THREE.AddEquation,
      depthTest: false, depthWrite: false, transparent: true,
    });
    const mesh = new THREE.Mesh(geo, S.partMat);
    mesh.frustumCulled = false;
    S.partScene = new THREE.Scene(); S.partScene.add(mesh);
    S.orthoCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    // Star births: unproject each through the camera at its exact time; from then on it lives in the world.
    const [w0, w1] = T.chapterWindow('III');
    const sigRef = PSF_SIGMA_NDC;
    S.births = T.starBirths.filter(b => b.t >= w0 && b.t < w1).map((b, i) => {
      const k = S.rig(b.t), B = basis(k, ctx.aspect), dir = unproject(B, b.x, b.y);
      const h = T.hash1(i * 7919 + 17);
      let pos, kind, peak;
      if (b.t < 42.9) {
        const depth = (i === 0 ? 11.5 : 6.2 + 5.5 * h) * NU;
        pos = k.pos.map((v, j) => v + dir[j] * depth); kind = 'neb'; peak = i === 0 ? 160 : 22 + 12 * T.hash1(i * 31 + 5);
      } else if (b.motif) {
        const depth = k.D * (0.85 + 0.5 * h);
        pos = k.pos.map((v, j) => v + dir[j] * depth); kind = dist(pos, NEB) < NEB_R ? 'neb' : 'far'; peak = 30;
      } else {
        const y0 = 0.0012, s = (y0 - k.pos[1]) / dir[1];
        const depth = s > 0 ? s : k.D;
        pos = k.pos.map((v, j) => v + dir[j] * depth); kind = 'far'; peak = 16;
      }
      const d = dist(pos, k.pos);
      const L = peak * d * d * 2 * Math.PI * Math.pow(sigRef * B.tanHalf, 2);
      const warm = i === 0 ? 1 : T.hash1(i * 101 + 9);
      const col = i === 0 ? [1.0, 0.9, 0.74] : (warm < 0.3 ? [1.0, 0.86, 0.66] : [0.74, 0.84, 1.0]);
      const note = T.notes.find(n => n.inst === 'bell' && Math.abs(n.t - b.t) < 1e-6);
      return { ...b, i, pos, kind, L, col, big: !!b.big, bellDur: note ? note.dur : 3,
        Lgas: i === 0 ? 10.0 : (b.motif ? 0.8 : 0.9 + 0.7 * h), nebPos: toNeb(pos) };
    });
    S.kicks = T.kicks.filter(k => k >= T.bt(17) - 1e-6 && k <= 58.7);
  },

  render(ctx, t, target) {
    const { T, renderer: r } = ctx;
    const k = S.rig(t);
    const B = basis(k, ctx.aspect);
    const cam = k.pos;
    const camN = toNeb(cam);
    const setCam = (u) => {
      u.camR.value.set(...B.right); u.camU.value.set(...B.up); u.camF.value.set(...B.fwd);
      u.tanHalf.value = B.tanHalf; u.aspect.value = ctx.aspect;
    };
    const fz = ctx.features.at(t);
    const psf = Math.max(PSF_SIGMA_NDC, 1.5 / ctx.H);
    const pxSr = 2 * Math.PI * Math.pow(psf * B.tanHalf, 2);

    // ---- nebula visibility (it shrinks into an HII knot as we pull back)
    const dN = dist(cam, NEB);
    const rn = NEB_R / (dN * B.tanHalf);                    // on-screen radius, ndc-y
    const nebOn = sstep(0.05, 0.12, rn);
    const pN = project(B, cam, NEB);

    // seen from outside, the nebula reads as a glowing pink knot: its dust thins with distance
    const outside = 1 - 0.7 * sstep(Math.log(0.022), Math.log(0.12), Math.log(k.D));

    // ---- the first star's wind-blown cavity (time-lapse: ~145 Myr of film per second here)
    const cAge = Math.max(0, t - S.births[0].t);
    const cGrow = 1 - Math.exp(-cAge / 2.4);
    const cavR = 7.6 * cGrow * sstep(0, 0.4, cAge);
    const cavC = S.births[0].nebPos.map((v, j) => lerp(v, [0, 0.6, 0][j], cGrow));

    // ---- births
    const lights = [], stars = [];
    for (const b of S.births) {
      const age = t - b.t;
      if (age < 0) { stars.push(null); continue; }
      const fl = Math.exp(-age / (b.big ? 0.22 : 0.15));
      if (b.kind === 'neb' && lights.length < SH.MAXL) {
        const Rf = 0.15 + (b.big ? 7.5 : 1.6) * (1 - Math.exp(-age / (b.big ? 1.8 : 1.1)));
        const Rc = 0.3 + (b.big ? 2.3 : 1.4) * (1 - Math.exp(-age / 4.5));
        const bell = 1 + 0.3 * Math.exp(-age / Math.max(0.6, b.bellDur * 0.35));
        lights.push({ p: b.nebPos, par: [b.Lgas * bell * (1 + 0.6 * fl), Rf, Rc, 0.5 * Math.exp(-age / 1.6)] });
      }
      const P = project(B, cam, b.pos);
      if (P.z <= 0) { stars.push(null); continue; }
      let peak = b.L / (P.d * P.d) / pxSr;
      if (peak > 60) peak = 60 + 14 * Math.log(peak / 60);
      const tw = 1 + (0.05 + 0.25 * fz.high) * Math.sin(t * (2.1 + (b.i % 5) * 0.7) + b.i * 3.7);
      peak *= (1 + (b.big ? 8 : 5) * fl) * (1 + 0.35 * Math.exp(-age / Math.max(0.6, b.bellDur * 0.4))) * tw;
      if (b.motif) peak *= 1 + 0.6 * Math.exp(-age / 0.35) * (0.5 + 0.5 * Math.cos(age * 26));   // motif bells glint
      if (b.kind === 'far') peak *= 0.3 + 0.7 * Math.exp(-age / 1.2);                             // twinkle, then settle into the arm
      const sp = clamp01((peak - 4) / 26) * 1.4 * (b.kind === 'neb' ? 1 : 0.8);
      stars.push({ b, x: P.x, y: P.y, peak, sp, fl, d: P.d });
    }

    // ---- 1. nebula raymarch (half res, MRT)
    if (nebOn > 0.001) {
      const u = S.nebPass.uniforms;
      setCam(u);
      u.camN.value.set(...camN);
      {
        const lu = S.lvPass.uniforms;
        lu.nL.value = lights.length; lu.o3r.value = 0.75;
        lights.forEach((L, i) => { lu.lPos.value[i].set(...L.p); lu.lPar.value[i].set(...L.par); });
        u.nSteps.value = 80;
        u.pxAng.value = 2 * B.tanHalf / S.hh * 4;
        for (let z = 0; z < S.LVN; z++) {
          lu.zSlice.value = z;
          r.setRenderTarget(S.lightRT, z);
          r.render(S.lvPass.scene, S.orthoCam);
        }
      }
      u.haloK.value = 0.005 * sstep(32.0, 36.0, t) * (1 + 5 * sstep(Math.log(0.02), Math.log(0.15), Math.log(k.D)));
      u.amb.value = 0.009 * sstep(30.0, 32.0, t);             // dark ages: the gas only faintly there
      u.gain.value = 0.8 * (1 + 0.08 * fz.mid) / (1 + 0.05 * lights.length);
      for (const [kk, dv] of NEBP) u[kk].value = dv;
      u.dustAmt.value *= outside;
      u.cavC.value.set(...cavC); u.cavR.value = cavR;
      let o3 = 0; for (let j = 0; j < 5; j++) o3 += (CHORD_O3[T.chordNameAt(t - j * 0.2)] || 0) / 5;
      u.o3bias.value = o3;
      u.shimmer.value = 0.12 + 0.25 * fz.rms;
      u.t.value = t;
      S.nebPass.render(r, S.nebRT);
      S.dnPass.uniforms.sigma.value = 1.0;
      S.dnPass.render(r, S.nebDN);
    }

    // ---- 2. per-star extinction through the nebula
    const nS = Math.min(SH.MAXB, S.births.length);
    {
      const u = S.extPass.uniforms;
      setCam(u); u.camN.value.set(...camN); u.nS.value = nS;
      for (const [kk, dv] of NEBP.slice(0, 8)) u[kk].value = dv;
      u.dustAmt.value *= outside;
      u.cavC.value.set(...cavC); u.cavR.value = cavR;
      for (let i = 0; i < nS; i++) u.sN.value[i].set(...S.births[i].nebPos);
      S.extPass.render(r, S.extRT);
    }

    // ---- 3. light shafts
    let raysOn = 0;
    {
      const u = S.raysPass.uniforms;
      RAY_STARS.forEach((bi, s) => {
        const st = stars[bi];
        const age = t - S.births[bi].t;
        u.rS.value[s].set(0, 0, 0, 0);
        if (!st || age < 0 || nebOn <= 0) return;
        const dir = unit([st.b.pos[0] - cam[0], st.b.pos[1] - cam[1], st.b.pos[2] - cam[2]]);
        const ch = sphereChord(camN, dir, 10.5);
        const dn = st.d / NU;
        const f = ch ? clamp01((dn - ch[0]) / Math.max(ch[1] - ch[0], 1e-4)) : 0;
        const onScreen = sstep(1.9, 1.1, Math.max(Math.abs(st.x), Math.abs(st.y)));
        const grow = sstep(0.0, 2.2, age);
        const I = (bi === 0 ? 1.0 : 0.4) * (0.35 * grow + 1.2 * st.fl) * onScreen * nebOn * (1 - sstep(Math.log(0.012), Math.log(0.06), Math.log(k.D)));
        u.rS.value[s].set(st.x, st.y, I, f);
        u.rC.value[s].set(...(bi === 0 ? [1.0, 0.86, 0.64] : [0.8, 0.86, 1.0]));
        raysOn = 1;
      });
      u.rayK.value = 2.6; u.beamTex.value = S.beamTex; u.beamT.value = (t * 0.012) % 1;
      if (raysOn) S.raysPass.render(r, S.raysRT);
    }

    // ---- 4. composite (full res)
    const galVis = sstep(42.5, 46.0, t) * (t < 49 ? sstep(Math.log(0.03), Math.log(0.12), Math.log(k.D)) : 1);
    {
      const u = S.compPass.uniforms;
      setCam(u);
      u.camG.value.set(...cam);
      u.nebOn.value = nebOn; u.raysOn.value = raysOn;
      const lnD = Math.log(k.D);
      u.galDiff.value = t < 50 ? sstep(Math.log(0.03), Math.log(0.25), lnD) : 1;
      u.bulgeOn.value = galVis;
      u.diffK.value = 4.5; u.bulgeK.value = 25; u.nucK.value = 60; u.dustK.value = 10;
      u.galT.value = galVis;
      u.psf.value = psf;
      u.t.value = t;
      let n = 0;
      for (let i = 0; i < nS; i++) {
        const st = stars[i];
        if (!st) { u.bP.value[i].set(0, 0, 0, 0); continue; }
        u.bP.value[i].set(st.x, st.y, st.peak, st.sp);
        u.bC.value[i].set(...st.b.col, st.fl);
        n = i + 1;
      }
      u.nB.value = n;
      // the nebula as a knot once it is small on screen
      const kn = 1 - nebOn;
      u.knot.value.set(pN.x, pN.y, rn * 0.5, pN.z > 0 && kn > 0 ? kn * 1.4 : 0);
      // the future Sun
      const PS = project(B, cam, SUN);
      const dS = PS.d;
      let sunPeak = 0, hs = 0.002;
      if (PS.z > 0 && t > 49.2) {
        sunPeak = 9.0 * sstep(49.6, 51.0, t) * Math.pow(1.7 / dS, 0.85) * (1 + 0.25 * Math.exp(-Math.pow((t - 51.0) / 0.45, 2)));
        hs = 0.004 * Math.pow(1.7 / dS, 0.55);
      }
      let kick = 0; for (const kt of S.kicks) if (t >= kt) kick += 0.4 * Math.exp(-(t - kt) / 0.14);
      u.sunP.value.set(PS.x, PS.y, sunPeak, hs);
      u.glareW.value = sstep(56.75, 57.2, t);
      const gR = t < 55.9 ? 0 : 0.02 * Math.pow(100, clamp01((t - 55.9) / 1.3));
      u.sunF.value.set(sstep(52.5, 56.5, t) * 1.2, gR, kick * sstep(55.4, 55.7, t), 0.25 + clamp01((sunPeak - 9) / 40));
      S.compPass.render(r, target);
    }

    // ---- 5. star particles (additive, instanced)
    {
      const u = S.partMat.uniforms;
      setCam(u);
      u.t.value = t; u.camPos.value.set(...cam); u.camN.value.set(...camN);
      u.galVis.value = galVis; u.localNVis.value = 1 - sstep(56.0, 57.0, t); u.localSVis.value = galVis * (1 - sstep(56.8, 57.4, t));
      u.nebOn.value = nebOn; u.psf.value = psf; u.resY.value = ctx.H;
      u.twinkle.value = 0.06 + 0.3 * fz.high;
      u.galGain.value = 0.26; u.hiiGain.value = 7; u.dSoft.value = 0.25; u.oldGain.value = 0.45; u.dustK.value = 10;
      const prev = r.autoClear;
      r.autoClear = false;
      r.setRenderTarget(target);
      r.render(S.partScene, S.orthoCam);
      r.autoClear = prev;
      r.autoClear = true;
    }
  },

  post(t) {
    return { bloom: 0.7, threshold: 1.0, knee: 0.6, bloomRadius: 1.0, vignette: 0.32, grain: 0.03, ca: 0.0012, saturation: 1.0 };
  },
};

function unit(v) { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; }
