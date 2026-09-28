// VI · LIFE (106–154 s, bars 41–64). One continuous shot:
//   Gray-Scott reaction-diffusion (cells on a stromatolite) → a space-colonization forest sprouting
//   on the shore (over-under at the waterline) → boids (fish school → breach → birds → a murmuration)
//   → the march: a silhouette walker evolving tetrapod → human on wet sand before the setting sun,
//   feet planting on every footstep; the human raises a torch whose flame takes the sun's last
//   glint at the exact centre and becomes the ember of chapter VII.
// Every stateful sim replays deterministically from the window start (see ch6/rd.js, ch6/boids.js);
// everything else is a pure function of t.
import { THREE } from '../engine/gl.js';
import { makeGlobals, WATER_MAG, GL_UNIFORMS, GL_SKY } from './ch6/common.js';
import { makeNoiseTexture, makeCaustics } from './ch6/textures.js';
import { makeGrayScott } from './ch6/rd.js';
import { makeTerrainGeometry } from './ch6/terrain.js';
import { makeStromatolites, makeKelp } from './ch6/world.js';
import { makeWaterView } from './ch6/water.js';
import { makeAirView } from './ch6/air.js';
import { makeGrove } from './ch6/grove.js';
import { makeMarch } from './ch6/march.js';
import { MARCH_FRAME } from './ch6/camera.js';
import { makeCreatureRenderer } from './ch6/lab/creature-render.js';
import { makeBoids, TB0 } from './ch6/boids.js';
import { makeCreatures } from './ch6/creatures.js';
import { makeShadowUniforms, makeSunShadow } from './ch6/shadow.js';
import * as L from './ch6/layout.js';
import { makeFlockGoal } from './ch6/flock.js';

const { DEG } = L;
let marchSwitchT = 122, shadow, boids, cre, grove, march, walkR, walkFrame, mOut, G, noise, caus, rd, water, air, comp, camAir, camWater, camBase, T, wOut, aOut;
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
// (times are set in init from the timeline: forest, breach, march, torch, the chapter's end)
const PAL = {
  t:    [114, 120, 125, 129, 135, 145, 151.2, 154.4],
  zen:  [[0.02, 0.065, 0.22], [0.02, 0.055, 0.19], [0.018, 0.045, 0.15], [0.015, 0.035, 0.12], [0.012, 0.025, 0.085], [0.009, 0.016, 0.05], [0.005, 0.007, 0.018], [0.003, 0.003, 0.004]],
  mid:  [[0.18, 0.26, 0.44], [0.22, 0.24, 0.38], [0.26, 0.22, 0.30], [0.28, 0.17, 0.22], [0.26, 0.12, 0.15], [0.19, 0.075, 0.08], [0.06, 0.022, 0.022], [0.008, 0.004, 0.003]],
  hor:  [[0.95, 0.68, 0.42], [1.0, 0.60, 0.33], [1.05, 0.52, 0.24], [1.05, 0.45, 0.16], [0.98, 0.37, 0.11], [0.8, 0.26, 0.07], [0.28, 0.08, 0.025], [0.02, 0.008, 0.003]],
  hor2: [[0.36, 0.40, 0.50], [0.36, 0.34, 0.42], [0.33, 0.26, 0.34], [0.28, 0.19, 0.27], [0.22, 0.13, 0.20], [0.13, 0.07, 0.11], [0.04, 0.022, 0.03], [0.006, 0.004, 0.004]],
  sun:  [[3.2, 2.4, 1.5], [3.0, 2.05, 1.15], [2.8, 1.7, 0.8], [2.6, 1.25, 0.45], [2.4, 0.95, 0.28], [2.1, 0.72, 0.18], [1.2, 0.4, 0.1], [1.0, 0.3, 0.08]],
  disk: [14, 13, 12, 11, 10, 9, 8, 8],
};
let TK = null;     // key times from the timeline (set in init)
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
  G.uDusk.value = T.smootherstep(TK.torch + 0.3, TK.end - 0.4, t) * 0.97;
  G.uGlint.value = T.smootherstep(TK.torch - 0.45, TK.torch - 0.08, t) * (1 - T.smootherstep(TK.torch - 0.015, TK.torch + 0.02, t));
  G.uUnder.value.set(0.02, 0.10, 0.11);
  G.uWaterLight.value = 1 - 0.22 * T.smootherstep(112.5, 115, t) - 0.12 * T.smootherstep(118, TK.breach - 1, t);
  G.uGreen.value = T.smootherstep(113.6, TK.forestEnd - 0.5, t);
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
      float dark = exp(-(s / (px * 3.2)) * (s / (px * 3.2)));
      float lip = exp(-((s - px * 3.5) / (px * (1.4 + 3.0 * surf))) * ((s - px * 3.5) / (px * (1.4 + 3.0 * surf))));
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
      const ember = T.smootherstep(TK.end - 1.8, TK.end - 1.0, t);
      const dusk = T.smootherstep(TK.end - 1.8, TK.end + 0.6, t) * 0.985;
      // surfacing: the port rises through the surface (≈113.6–114.3), leaving droplets that dry off
      const surf = T.smootherstep(113.72, 113.95, t) * (1 - T.smootherstep(114.2, 114.65, t));
      const drops = T.smootherstep(113.9, 114.1, t) * (1 - T.smootherstep(114.6, 115.8, t));
      pass.render(r, target, { ...u, pxw, uNoise: noise.texture, kick: G.uKick.value, ember, dusk, surf, drops });
    },
  };
}

// ---------------------------------------------------------------- the march
// The silhouette walker, the wet sand and the sea below the horizon (lab renderer, walk-local
// frame), over this chapter's own air view above it (sky, murmuration, far land): one image.
const SHORE = [-5.0, -1.4, 8.0, -2.4];          // sea where z < mix(8, −2.4, smoothstep(−5, −1.4, x))
function renderMarch(ctx, t) {
  const w = march.at(t);
  let flame = null, gain = 0;
  const u = t - T.march.torch;
  if (w.flame && u > -0.02) {
    // the catch: the glint's light passes straight into a flame that flares, then settles
    const grow = T.smootherstep(-0.015, 0.05, u);
    gain = grow * (1 + 1.1 * Math.exp(-Math.max(0, u - 0.03) / 0.16));
    const size = 0.24 * (0.25 + 0.75 * T.smootherstep(0.0, 0.3, u)) * (0.95 + 0.1 * Math.sin(t * 11.0) * Math.sin(t * 4.3 + 1.0));
    flame = [w.flame[0], w.flame[1], size];
  }
  walkR.render(ctx.renderer, mOut, camAir, {
    A: w.A, t, H: ctx.H, flame, flameGain: gain, frame: walkFrame, bg: aOut.texture, hybrid: true,
    shore: SHORE, clip: [march.clipX0, 0.12, 0.25], ripples: march.ripples(t), scroll: 0,
  });
}

export default {
  id: 'VI',

  async init(ctx) {
    T = ctx.T;
    TK = { breach: T.BREACH_T, march: T.march.t0, stand: T.march.standAt, torch: T.march.torch, end: T.chapterById.VI.end,
      forestEnd: T.leafFlushes[T.leafFlushes.length - 1].t + 0.25 };
    PAL.t = [114, 120, TK.breach - 1, TK.march + 1, TK.march + 7, TK.stand - 5, TK.torch + 0.2, TK.end + 0.4];
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
    boids = makeBoids(T, { n: 420, goal: makeFlockGoal(T) });
    cre = makeCreatures(ctx, G, boids.n);
    water.scene.add(cre.fish);
    air.scene.add(cre.birds, cre.drops);
    shadow = makeSunShadow(G);
    grove = makeGrove(ctx, G, T);
    grove.addTo(air.scene, shadow.scene);
    march = makeMarch(T);
    walkR = makeCreatureRenderer({ mode: 'sil', skyGLSL: GL_UNIFORMS + GL_SKY, uniforms: G });
    const X = MARCH_FRAME.X, Z = MARCH_FRAME.Z;
    walkFrame = { rot: new THREE.Matrix3().set(X[0], 0, Z[0], X[1], 1, Z[1], X[2], 0, Z[2]), origin: new THREE.Vector3(...MARCH_FRAME.O) };
    mOut = ctx.makeTarget(ctx.W, ctx.H);
    // the march's ground replaces the air view's below the horizon: switch while the camera looks
    // up at the flock (horizon below the frame by > 1°), i.e. the last such moment before it levels
    for (let tt = TK.breach + 0.4; tt <= TK.breach + 2.4; tt += 1 / 240) {
      const k = T.sampleCamera(camKeys(), tt);
      const d = k.target.map((v, i) => v - k.pos[i]);
      const pitch = Math.asin(d[1] / Math.hypot(...d)) / DEG;
      if (pitch - k.fov / 2 > 1.0) marchSwitchT = tt;
    }
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
      if (t < TK.breach + 2) rdTex = rd.display(r, t);
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
    const marchOn = t >= marchSwitchT;
    if (needA) {
      G.uCamPos.value.copy(camAir.position);
      grove.update(t, r, camAir);
      shadow.render(r, G.uSunDir.value);
      air.render(r, camAir, aOut);
      if (marchOn) renderMarch(ctx, t);
    }
    comp.render(r, target, { wTex: wOut.texture, aTex: marchOn && needA ? mOut.texture : aOut.texture, mode: needW && needA ? 0 : (needW ? 1 : 2),
      invProj: camBase.projectionMatrixInverse, camWorld: camBase.matrixWorld, camPos: camBase.position, t });
    r.setRenderTarget(null);
  },

  // Post: dreamy macro, crisper daylight over-under, restrained bloom while the silhouettes walk
  // (heavier bloom veils them), a warmer glow once night falls around the flame.
  post(t) {
    const ss = T.smootherstep;
    const a = ss(111, 114.5, t), b = ss(TK.breach + 0.5, TK.breach + 1.5, t), c = ss(TK.torch + 0.4, TK.end - 0.6, t);
    const mix4 = (w, x, y, z) => w + (x - w) * a + (y - x) * b + (z - y) * c;
    return {
      bloom: mix4(0.72, 0.5, 0.5, 0.7), threshold: mix4(1.0, 1.0, 1.15, 1.0), knee: 0.6, bloomRadius: 1.0,
      vignette: mix4(0.42, 0.3, 0.42, 0.5), grain: mix4(0.032, 0.026, 0.03, 0.03), ca: 0.0012,
      saturation: mix4(1.0, 1.05, 1.08, 1.05),
    };
  },
};
