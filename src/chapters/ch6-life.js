// VI · LIFE (106–134 s, bars 41–54). One continuous shot, three simulations:
//   Gray-Scott reaction-diffusion (cells on a stromatolite) → L-system forest on the shore
//   (over-under at the waterline) → boids (fish school → breach → birds → murmuration at sunset).
// Every stateful sim replays deterministically from the window start (see ch6/rd.js, ch6/boids.js).
import { THREE } from '../engine/gl.js';
import { makeGlobals, WATER_MAG } from './ch6/common.js';
import { makeNoiseTexture, makeCaustics } from './ch6/textures.js';
import { makeGrayScott } from './ch6/rd.js';
import { makeTerrainGeometry } from './ch6/terrain.js';
import { makeStromatolites, makeKelp } from './ch6/world.js';
import { makeWaterView } from './ch6/water.js';
import { makeAirView } from './ch6/air.js';
import { buildForest, planFlushes, makeForestMeshes } from './ch6/forest.js';
import { makeBoids, TB0 } from './ch6/boids.js';
import { makeCreatures } from './ch6/creatures.js';
import { makeShadowUniforms, makeSunShadow } from './ch6/shadow.js';
import * as L from './ch6/layout.js';
import { makeFlockGoal } from './ch6/flock.js';

const { DEG } = L;
let shadow, boids, cre, forest, fm, G, noise, caus, rd, water, air, comp, camAir, camWater, camBase, T, wOut, aOut;
const SS = 2;                  // supersampling of the internal views (downsampled in the composite)
const RD_PORT = 0.12;          // dome-port radius (m): where the waterline crosses the lens

// ---------------------------------------------------------------- camera
function camKeys() { return T.cameras.VI; }

function setCameras(ctx, t) {
  const k = T.sampleCamera(camKeys(), t);
  ctx.applyCamera(camBase, k);
  // underwater half: the lower part of the dome port, magnified by the flat-port refraction
  const kw = { ...k, pos: [k.pos[0], Math.min(k.pos[1], -0.05), k.pos[2]], target: [k.target[0], k.target[1] + Math.min(k.pos[1], -0.05) - k.pos[1], k.target[2]] };
  kw.fov = 2 * Math.atan(Math.tan(k.fov * DEG / 2) / WATER_MAG) / DEG;
  ctx.applyCamera(camWater, kw);
  const ka = { ...k, pos: [k.pos[0], Math.max(k.pos[1], 0.03), k.pos[2]], target: [k.target[0], k.target[1] + Math.max(k.pos[1], 0.03) - k.pos[1], k.target[2]] };
  ctx.applyCamera(camAir, ka);
  return k;
}

// ---------------------------------------------------------------- RD events
function buildRDEvents(ctx) {
  const rate = 1800, t0 = L.RD_T0;
  const S = (t) => Math.floor((t - t0) * rate + 1e-6);
  const R = T.mulberry32(0x6C1F);
  const ev = [];
  const ndc = new THREE.Vector3(), ray = new THREE.Vector3();
  const uvAt = (t, x, y) => {
    setCameras(ctx, t);
    ndc.set(x, y, 0.5).unproject(camWater);
    ray.copy(ndc).sub(camWater.position).normalize();
    const th = L.hitHero(camWater.position.toArray(), ray.toArray());
    if (th < 0) return null;
    return L.patchUV(camWater.position.toArray().map((v, i) => v + ray.getComponent(i) * th));
  };
  // the bloom: first cells appear around the macro view, and colonies further out
  const blooms = [[105.05, 0.47, 0.52], [105.2, 0.55, 0.44], [105.35, 0.52, 0.58], [105.5, 0.45, 0.42], [105.62, 0.6, 0.53],
    [105.8, 0.37, 0.55], [105.9, 0.44, 0.585], [106.3, 0.63, 0.40], [106.9, 0.30, 0.38], [107.3, 0.70, 0.62], [107.8, 0.25, 0.62], [108.4, 0.78, 0.45], [109.0, 0.2, 0.5],
    [109.4, 0.66, 0.30], [109.8, 0.34, 0.70]];
  // outlying colonies across the whole patch, so the mat is patchy and irregular at the reveal
  const Rb = T.mulberry32(0xB100);
  for (let i = 0; i < 26; i++) {
    const a = Rb() * Math.PI * 2, rr = 0.22 + 0.24 * Math.sqrt(Rb());
    blooms.push([106.2 + Rb() * 4.8, 0.5 + Math.cos(a) * rr, 0.5 + Math.sin(a) * rr * 0.9]);
  }
  for (const e of T.cellDivisions) {
    const uv = uvAt(e.t, e.x, e.y);
    if (!uv) { console.warn('[VI] division event off the patch', e.t); continue; }
    ev.push({ seedStep: S(e.t - 0.62), cleaveStep: S(e.t - 0.1), u: uv[0], v: uv[1], ang: R() * Math.PI, rad: 5.0, hue: R(), cleaveLen: Math.round(0.3 * rate), t: e.t });
  }
  // bloom seeds, kept clear of every division site (so each division is one clean cell)
  const divs = ev.slice();
  for (const [t, u, v] of blooms) {
    if (divs.some(d => Math.hypot(d.u - u, d.v - v) * 512 < 26 && Math.abs(d.t - t) < 3.5)) continue;
    ev.push({ seedStep: S(t), cleaveStep: -1e9, u, v, ang: 0, rad: 3.2, hue: R(), cleaveLen: 1 });
  }
  const colony = [{ u: 0.5, v: 0.5, r: 0.2 }];
  for (const e of ev) colony.push({ u: e.u, v: e.v, r: e.cleaveStep > 0 ? 0.1 : 0.085 + 0.04 * R() });
  return { ev, rate, t0, colony };
}

// ---------------------------------------------------------------- per-t light
// Palette keyframes (linear): golden afternoon → low sun → sunset → dusk.
const PAL = {
  t:    [114, 122, 126, 129, 131, 132.8, 134.3],
  zen:  [[0.02, 0.07, 0.26], [0.02, 0.065, 0.23], [0.028, 0.06, 0.19], [0.02, 0.038, 0.12], [0.014, 0.022, 0.07], [0.009, 0.012, 0.035], [0.004, 0.004, 0.005]],
  mid:  [[0.16, 0.28, 0.50], [0.19, 0.27, 0.44], [0.26, 0.25, 0.34], [0.26, 0.17, 0.23], [0.24, 0.10, 0.12], [0.16, 0.055, 0.06], [0.012, 0.006, 0.005]],
  hor:  [[0.86, 0.66, 0.44], [0.92, 0.62, 0.38], [0.92, 0.55, 0.30], [1.0, 0.45, 0.18], [0.95, 0.34, 0.10], [0.72, 0.22, 0.05], [0.03, 0.012, 0.004]],
  hor2: [[0.34, 0.42, 0.55], [0.36, 0.40, 0.48], [0.38, 0.34, 0.40], [0.32, 0.23, 0.30], [0.20, 0.12, 0.19], [0.10, 0.055, 0.09], [0.008, 0.005, 0.005]],
  sun:  [[3.4, 2.9, 2.2], [3.3, 2.65, 1.9], [3.1, 2.15, 1.3], [2.8, 1.55, 0.72], [2.4, 1.0, 0.30], [2.0, 0.70, 0.17], [1.2, 0.4, 0.1]],
  disk: [16, 16, 14, 12, 10, 9, 8],
};
function palAt(key, t) {
  const ts = PAL.t, v = PAL[key];
  if (t <= ts[0]) return v[0];
  for (let i = 0; i < ts.length - 1; i++) if (t < ts[i + 1]) {
    const u = T.smootherstep(ts[i], ts[i + 1], t);
    return Array.isArray(v[0]) ? v[i].map((x, j) => x + (v[i + 1][j] - x) * u) : v[i] + (v[i + 1] - v[i]) * u;
  }
  return v[v.length - 1];
}
function updateGlobals(t) {
  const pwl = T.pwl;
  G.uT.value = t;
  const sd = L.sunDir(t, pwl);
  G.uSunDir.value.set(...sd);
  // refracted sun direction under water (Snell, n = 1.333)
  const el = L.sunElev(t, pwl);
  const sinw = Math.cos(Math.max(el, 0.02)) / 1.333;
  const h = Math.hypot(sd[0], sd[2]) || 1;
  G.uSunW.value.set(sd[0] / h * sinw, Math.sqrt(1 - sinw * sinw), sd[2] / h * sinw);
  const vis = T.smootherstep(-L.SUN_R * 1.05, L.SUN_R * 0.3, el);
  G.uSunVis.value = vis;
  G.uSunCol.value.set(...palAt('sun', t)).multiplyScalar(0.15 + 0.85 * vis);
  G.uSkyZen.value.set(...palAt('zen', t));
  G.uSkyHor.value.set(...palAt('hor', t));
  G.uSkyHor2.value.set(...palAt('hor2', t));
  G.uSkyMid.value.set(...palAt('mid', t));
  G.uSunDisk.value = palAt('disk', t);
  G.uDusk.value = T.smootherstep(133.1, 134.7, t) * 0.97;
  G.uUnder.value.set(0.02, 0.10, 0.11);
  G.uWaterLight.value = 1 - 0.22 * T.smootherstep(112.5, 115, t) - 0.18 * T.smootherstep(118, 126, t);
  G.uGreen.value = T.smootherstep(113.6, 121.5, t);
  // kick envelope
  let kk = 0;
  for (const kt of T.kicks) { if (kt > t) break; if (t - kt < 0.6) kk = Math.max(kk, Math.exp(-(t - kt) / 0.14)); }
  G.uKick.value = kk;
}
function updateAudio(ctx, t) {
  const f = ctx.features.at(t);
  G.uAudio.value.set(f.low, f.mid, f.high);
}

// ---------------------------------------------------------------- over-under composite
// A half-submerged dome port: a pixel sees water if its ray leaves the port below the
// (wavy) waterline. The underwater half comes from the magnified water camera.
function makeComposite(ctx) {
  const pass = new ctx.Pass(ctx.glsl.header + ctx.glsl.math + ctx.glsl.hash + /* glsl */`
    in vec2 vUv; out vec4 fragColor;
    uniform sampler2D wTex, aTex, uNoise; uniform mat4 invProj, camWorld; uniform vec3 camPos;
    uniform float mode, t, rD, pxw, kick, ember, dusk, aspect, surf, drops;
    float wave(vec2 q) {
      return 0.0045 * sin(q.x * 3.1 + t * 1.9) + 0.003 * sin(q.x * 7.3 - t * 2.7 + 1.3) + 0.0025 * sin(t * 1.3 + 0.4)
           + 0.004 * kick * sin(q.x * 11.0 + t * 9.0);
    }
    vec3 finish(vec3 c) {
      // dusk: everything settles to the warm black the next chapter starts from
      c = mix(c, vec3(0.012, 0.008, 0.006), dusk);
      // the sun's last glint → the ember at the exact centre (VI → VII contract)
      if (ember > 0.0) {
        vec2 d = (vUv - 0.5) * vec2(aspect, 1.0);
        float r = length(d);
        float core = (1.0 - smoothstep(0.0052, 0.0062, r));
        vec3 E = vec3(1.0, 0.45, 0.12);
        c = mix(c, E * 4.0, core * ember);
        c += E * ember * (0.55 * exp(-r / 0.011) + 0.12 * exp(-r / 0.04)) * (1.0 - core);
      }
      return c;
    }
    void main() {
      if (mode > 1.5) { fragColor = vec4(finish(texture(aTex, vUv).rgb), 1.0); return; }
      if (mode > 0.5) { fragColor = vec4(finish(texture(wTex, vUv).rgb), 1.0); return; }
      vec4 vv = invProj * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
      vec3 dir = normalize(mat3(camWorld) * (vv.xyz / vv.w));
      vec3 q = camPos + dir * rD;
      float s = q.y - wave(q.xz);                       // + above the waterline on the port
      float px = pxw * rD;
      float m = smoothstep(-px, px, s);
      // the water film clinging above the line refracts the air image downward; while the port
      // rises through the surface the film is thick, rippled and draining
      float filmW = px * (18.0 + 110.0 * surf);
      float film = exp(-max(s, 0.0) / filmW) * step(0.0, s);
      vec2 fr = (vec2(texture(uNoise, vUv * vec2(6.0, 2.2) + vec2(0.0, t * 0.9)).r, texture(uNoise, vUv * vec2(5.0, 1.7) + vec2(0.3, t * 1.3)).g) - 0.5);
      vec2 offA = vec2(fr.x * 0.03 * surf, -0.012 - 0.03 * surf + fr.y * 0.02 * surf) * film;
      vec3 A = texture(aTex, vUv + offA).rgb;
      A = mix(A, A * vec3(0.8, 0.95, 0.95) + vec3(0.0, 0.01, 0.012), film * (0.5 + 0.3 * surf));
      // droplets left on the port above the line, sliding down and drying off
      if (drops > 0.0 && s > px) {
        vec2 fc = vUv * vec2(aspect, 1.0);
        float slide = (t - 113.7) * 0.05;
        for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
          vec2 cell = floor((fc + vec2(0.0, slide)) * 9.0) + vec2(float(i), float(j));
          vec3 h = vec3(hash12(cell + 0.5), hash12(cell + 7.3), hash12(cell + 13.1));
          float dw = clamp((0.42 * drops - h.x) / 0.1, 0.0, 1.0);        // each droplet dries off smoothly
          if (dw <= 0.0) continue;
          float r = 0.006 + 0.018 * h.y * h.y;
          vec2 cpos = (cell + 0.2 + 0.6 * vec2(h.y, h.z)) / 9.0 - vec2(0.0, slide * (0.8 + 0.6 * h.z));
          vec2 dd = (fc - cpos) / r;
          float l = length(dd);
          if (l < 1.0) {
            vec2 luv = vUv - dd * r / vec2(aspect, 1.0) * 1.8;             // a tiny inverted lens image
            vec3 L = texture(aTex, luv).rgb * 0.9;
            float rim = smoothstep(0.7, 1.0, l);
            float hi = exp(-dot(dd - vec2(-0.35, 0.4), dd - vec2(-0.35, 0.4)) * 18.0);
            vec3 D = mix(L, A * 0.35, rim * 0.8) + vec3(1.0, 0.97, 0.9) * hi * 0.9;
            A = mix(A, D, dw * (1.0 - smoothstep(0.92, 1.0, l)));
          }
        }
      }
      vec3 Wc = texture(wTex, vUv).rgb;
      vec3 c = mix(Wc, A, m);
      // meniscus: a dark refracting line with a bright lip catching the sky just above it;
      // brighter while the surface slides over the lens
      float dark = exp(-pow(s / (px * 3.2), 2.0));
      float lip = exp(-pow((s - px * 3.5) / (px * (1.4 + 3.0 * surf)), 2.0));
      c = c * (1.0 - 0.8 * dark) + A * lip * (0.9 + 1.4 * surf) + vec3(0.02, 0.03, 0.03) * lip;
      c += A * 0.35 * surf * exp(-abs(s) / (px * 25.0));
      fragColor = vec4(finish(c), 1.0);
    }`, { wTex: { value: null }, aTex: { value: null }, uNoise: { value: null }, invProj: { value: new THREE.Matrix4() }, camWorld: { value: new THREE.Matrix4() },
    camPos: { value: new THREE.Vector3() }, mode: { value: 0 }, t: { value: 0 }, rD: { value: RD_PORT }, pxw: { value: 1 }, kick: { value: 0 },
    ember: { value: 0 }, dusk: { value: 0 }, aspect: { value: ctx.aspect }, surf: { value: 0 }, drops: { value: 0 } });
  return {
    render(r, target, u) {
      const pxw = 2 * Math.tan(camBase.fov * DEG / 2) / ctx.H;
      const t = u.t;
      const ember = T.smootherstep(133.15, 133.6, t);
      const dusk = T.smootherstep(133.3, 134.9, t) * 0.985;
      // surfacing: the port rises through the surface (≈113.6–114.3), leaving droplets that dry off
      const surf = T.smootherstep(113.72, 113.95, t) * (1 - T.smootherstep(114.2, 114.65, t));
      const drops = T.smootherstep(113.9, 114.1, t) * (1 - T.smootherstep(114.6, 115.8, t));
      pass.render(r, target, { ...u, pxw, uNoise: noise.texture, kick: G.uKick.value, ember, dusk, surf, drops });
    },
  };
}

export default {
  id: 'VI',

  async init(ctx) {
    T = ctx.T;
    G = { ...makeGlobals(), ...makeShadowUniforms() };
    camBase = new THREE.PerspectiveCamera(50, ctx.aspect, 0.004, 8000);
    camWater = new THREE.PerspectiveCamera(50, ctx.aspect, 0.004, 800);
    camAir = new THREE.PerspectiveCamera(50, ctx.aspect, 0.03, 8000);
    noise = makeNoiseTexture(ctx);
    caus = makeCaustics(ctx);
    G.uNoise.value = noise.texture;
    G.uCaus.value = caus.rt.texture;
    const { ev, rate, t0, colony } = buildRDEvents(ctx);
    rd = makeGrayScott(ctx, { N: 512, rate, t0, tEnd: L.RD_T1, events: ev, colony });
    const R = T.mulberry32(0x5170);
    const terrainGeo = makeTerrainGeometry();
    const { geometry: stroma, placed } = makeStromatolites(R);
    const kelpGeo = makeKelp(R, placed);
    const IW = ctx.W * SS, IH = ctx.H * SS;
    water = makeWaterView(ctx, G, { stroma, kelpGeo, terrainGeo, W: IW, H: IH });
    air = makeAirView(ctx, G, { terrainGeo, W: IW, H: IH });
    forest = buildForest(T);
    const vpm = new THREE.Matrix4();
    let lastT = null, e = null, cy = 0;
    forest.plan = planFlushes(T, forest, (t, p) => {
      if (t !== lastT) { setCameras(ctx, t); vpm.multiplyMatrices(camAir.projectionMatrix, camAir.matrixWorldInverse); e = vpm.elements; cy = camBase.position.y; lastT = t; }
      const w = e[3] * p[0] + e[7] * p[1] + e[11] * p[2] + e[15];
      if (w <= 0.05) return { ok: false };
      const x = (e[0] * p[0] + e[4] * p[1] + e[8] * p[2] + e[12]) / w, y = (e[1] * p[0] + e[5] * p[1] + e[9] * p[2] + e[13]) / w;
      const d = [p[0] - camBase.position.x, p[1] - cy, p[2] - camBase.position.z];
      const dy = d[1] / Math.hypot(...d);
      return { x, y, ok: cy + dy * RD_PORT > 0.01 };
    });
    fm = makeForestMeshes(ctx, G, forest);
    boids = makeBoids(T, { n: 420, goal: makeFlockGoal(T) });
    cre = makeCreatures(ctx, G, boids.n);
    water.scene.add(cre.fish);
    air.scene.add(cre.birds, cre.drops);
    air.scene.add(fm.branches, fm.leaves);
    shadow = makeSunShadow(G);
    shadow.scene.add(fm.barkDepth, fm.leafDepth);
    wOut = ctx.makeTarget(IW, IH);
    aOut = ctx.makeTarget(IW, IH);
    comp = makeComposite(ctx);
    // calibrate the water gradient: at 105 s the frame's bottom/top edges hit the contract colours
    setCameras(ctx, 105.0);
    const k = T.sampleCamera(camKeys(), 105.0);
    const pitch = Math.asin((k.target[1] - k.pos[1]) / Math.hypot(...k.target.map((v, i) => v - k.pos[i])));
    const hf = camWater.fov * DEG / 2;
    water.extra.uEB.value = pitch - hf;
    water.extra.uET.value = pitch + hf;
  },

  render(ctx, t, target) {
    const r = ctx.renderer;
    updateGlobals(t);
    updateAudio(ctx, t);
    const k = setCameras(ctx, t);
    // which media does the frame see? (waterline on the dome port vs. the frame's ray elevations)
    const ys = [];
    for (const [x, y] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 1], [0, -1]]) {
      const v = new THREE.Vector3(x, y, 0.5).unproject(camBase).sub(camBase.position).normalize();
      ys.push(camBase.position.y + v.y * RD_PORT);
    }
    const lo = Math.min(...ys), hi = Math.max(...ys);
    const crossing = Math.abs(camBase.position.y) < 0.16;       // render both media through the whole surfacing
    const needW = lo < 0.03 || crossing, needA = hi > -0.03 || crossing;
    caus.update(r, t * 0.3);
    const flockOn = t >= TB0;
    cre.fish.visible = cre.birds.visible = cre.drops.visible = flockOn;
    if (flockOn) cre.update(boids, boids.ensure(t), t);
    if (needW) {
      let rdTex = null;
      if (t < 127) rdTex = rd.display(r, t);
      const heroVis = T.smootherstep(107.2, 111.5, t);
      G.uCamPos.value.copy(camWater.position);
      const rayGain = (0.12 + 0.88 * T.smootherstep(107.0, 111.0, t)) * (1 - 0.35 * T.smootherstep(113, 115, t));   // faint through the V→VI hand-off
      // marine snow: a small box of motes around the lens in macro, a big one at the waterline
      const macro = 1 - T.smootherstep(111.0, 113.6, t);
      const box = 0.55 + (4.0 - 0.55) * (1 - macro);
      const fwd = new THREE.Vector3(); camWater.getWorldDirection(fwd);
      const anchor = camWater.position.clone().addScaledVector(fwd, box * 0.45);
      const hit = new THREE.Vector3(...L.P0).distanceTo(camWater.position);
      const focus = macro > 0.5 ? hit : 2.6;
      water.render(r, camWater, wOut, { heroVis, rdTex, rayGain, snow: { box, anchor, focus, aper: 0.0035 + 0.004 * macro, amt: 0.8 + 0.6 * macro } });
    }
    if (needA) {
      G.uCamPos.value.copy(camAir.position);
      fm.barkMat.uniforms.uPx.value = 2 * Math.tan(camAir.fov * DEG / 2) / (ctx.H * SS);
      shadow.render(r, G.uSunDir.value);
      air.render(r, camAir, aOut);
    }
    comp.render(r, target, { wTex: wOut.texture, aTex: aOut.texture, mode: needW && needA ? 0 : (needW ? 1 : 2),
      invProj: camBase.projectionMatrixInverse, camWorld: camBase.matrixWorld, camPos: camBase.position, t });
    r.setRenderTarget(null);
  },

  // Post: dreamy macro, crisper daylight over-under, rich warm sunset.
  post(t) {
    const ss = T.smootherstep;
    const a = ss(111, 114.5, t), b = ss(128.5, 131, t);
    const mix3 = (x, y, z) => x + (y - x) * a + (z - y) * b;
    return {
      bloom: mix3(0.72, 0.5, 0.8), threshold: 1.0, knee: 0.6, bloomRadius: 1.0,
      vignette: mix3(0.42, 0.3, 0.45), grain: mix3(0.032, 0.026, 0.03), ca: 0.0012,
      saturation: mix3(1.0, 1.05, 1.08),
    };
  },
};
