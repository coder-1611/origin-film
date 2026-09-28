// VI lab: example harness. Renders the lab modules through the SAME pieces chapter VI uses
// (its sky/terrain/sea/haze air view and sun shadow maps, imported read-only) and the film's
// real post chain (bloom → ACES → grade), so what you see here is what the chapter will get.
//   tools/scratch/lab.html?scene=tree&w=1920&h=1080&ss=2
//   window.__lab.render({ g, t, cam, grove, ... })   → draws one frame to the canvas
//   window.__lab.time(opts, n)                         → mean ms/frame (GPU-complete)
// Everything is a pure function of the options passed: no clocks, no Math.random.
import * as THREE from '../../../vendor/three.module.js';
import { makeTarget, Pass } from '../../../engine/gl.js';
import * as glsl from '../../../engine/glsl.js';
import { Post, DEFAULT_POST } from '../../../engine/post.js';
import { makeGlobals } from '../common.js';
import { makeNoiseTexture } from '../textures.js';
import { makeTerrainGeometry, heightAt, coastR, ORIGIN } from '../terrain.js';
import { makeAirView } from '../air.js';
import { makeShadowUniforms, makeSunShadow, GL_SHADOW } from '../shadow.js';
import { growTree } from './tree.js';
import { makeTree } from './tree-render.js';
import { makeLeafAtlas } from './leaf-atlas.js';

const q = new URLSearchParams(location.search);
const W = +(q.get('w') || 1920), H = +(q.get('h') || 1080), SS = +(q.get('ss') || 2);
const SCENE = q.get('scene') || 'tree';
const DEG = Math.PI / 180;

const canvas = document.getElementById('c');
canvas.width = W; canvas.height = H;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, depth: true, stencil: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(1); renderer.setSize(W, H, false);
renderer.outputColorSpace = THREE.LinearSRGBColorSpace; renderer.toneMapping = THREE.NoToneMapping;
const gl = renderer.getContext();
const ctx = { THREE, renderer, gl, W, H, aspect: W / H, glsl, makeTarget, Pass };
const post = new Post(renderer, W, H);
const hdr = makeTarget(W, H, { depth: true });

// ------------------------------------------------------------------------------ tree scene
async function makeTreeScene() {
  const G = { ...makeGlobals(), ...makeShadowUniforms() };
  const noise = makeNoiseTexture(ctx);
  G.uNoise.value = noise.texture;
  const IW = W * SS, IH = H * SS;
  const terrainGeo = makeTerrainGeometry();
  const air = makeAirView(ctx, G, { terrainGeo, W: IW, H: IH });
  const aOut = makeTarget(IW, IH);
  const shadow = makeSunShadow(G);
  const atlas = makeLeafAtlas();
  const cam = new THREE.PerspectiveCamera(50, W / H, 0.03, 8000);
  const shadowHook = GL_SHADOW + 'float extShadow(vec3 p, vec3 n) { return sunShadow(p, n); }';

  // placement on the chapter's shore: azimuth (deg, + = right of -z) and metres inland
  const at = (az, land) => { const r = coastR(az * DEG) + land; const x = ORIGIN[0] + Math.sin(az * DEG) * r, z = ORIGIN[2] - Math.cos(az * DEG) * r; return [x, heightAt(x, z) - 0.03, z]; };
  const specs = [
    { id: 'hero', az: -4, land: 2.2, yaw: 0.4, scale: 1.0, grow: { seed: 1, species: 'linden' } },
    { id: 'g1', az: -24, land: 6.5, yaw: 2.1, scale: 1.2, grow: { seed: 2, species: 'oak' } },
    { id: 'g2', az: 15, land: 4.5, yaw: 4.0, scale: 1.0, grow: { seed: 3, species: 'birch', height: 6.5 } },
    { id: 'g3', az: 30, land: 11, yaw: 1.0, scale: 1.35, grow: { seed: 4, species: 'maple' } },
    { id: 'g4', az: -40, land: 14, yaw: 5.2, scale: 1.5, grow: { seed: 5, species: 'linden', radius: 2.0 } },
    { id: 'g5', az: 6, land: 16, yaw: 3.3, scale: 1.6, grow: { seed: 6, species: 'maple', radius: 2.3 } },
  ];
  const trees = [];
  const tInit = performance.now();
  for (const s of specs) {
    const skel = growTree(s.grow);
    const tr = makeTree(skel, { pos: at(s.az, s.land), yaw: s.yaw, scale: s.scale }, G, { atlas, extShadowGLSL: shadowHook, densStride: s.id === 'hero' ? 1 : 3 });
    tr.spec = s;
    trees.push(tr);
  }
  const initMs = performance.now() - tInit;

  // simplified over-under composite (the chapter's dome port, without waves/droplets)
  const comp = new Pass(glsl.header + glsl.math + glsl.hash + /* glsl */`
    in vec2 vUv; out vec4 fragColor;
    uniform sampler2D aTex, uNoise; uniform mat4 invProj, camWorld; uniform vec3 camPos; uniform float pxw, t, split;
    void main() {
      vec3 A = texture(aTex, vUv).rgb;
      if (split < 0.5) { fragColor = vec4(A, 1.0); return; }
      vec4 vv = invProj * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
      vec3 dir = normalize(mat3(camWorld) * (vv.xyz / vv.w));
      float rD = 0.12;
      vec3 q = camPos + dir * rD;
      float s = q.y - 0.004 * sin(q.x * 3.1 + t * 1.9) - 0.003 * sin(q.x * 7.3 - t * 2.7 + 1.3);
      float px = pxw * rD;
      float m = smoothstep(-px, px, s);
      // underwater: the V→VI teal field with a soft caustic shimmer
      float e = dir.y;
      vec3 Wc = mix(vec3(0.004, 0.035, 0.045), vec3(0.05, 0.22, 0.24), clamp(0.5 + e * 1.4, 0.0, 1.0));
      Wc *= 0.85 + 0.3 * texture(uNoise, vUv * vec2(3.0, 1.2) + vec2(t * 0.02, 0.0)).g;
      vec3 c = mix(Wc, A, m);
      float dark = exp(-pow(s / (px * 3.2), 2.0));
      float lip = exp(-pow((s - px * 3.5) / (px * 1.4), 2.0));
      c = c * (1.0 - 0.8 * dark) + A * lip * 0.9;
      fragColor = vec4(c, 1.0);
    }`, { aTex: { value: null }, uNoise: { value: noise.texture }, invProj: { value: new THREE.Matrix4() }, camWorld: { value: new THREE.Matrix4() },
    camPos: { value: new THREE.Vector3() }, pxw: { value: 0.001 }, t: { value: 0 }, split: { value: 1 } });
  const down = new Pass(glsl.header + `in vec2 vUv; out vec4 fragColor; uniform sampler2D src; uniform vec2 texel;
    void main() { vec3 c = texture(src, vUv + texel * vec2(-0.25, -0.25)).rgb + texture(src, vUv + texel * vec2(0.25, -0.25)).rgb
      + texture(src, vUv + texel * vec2(-0.25, 0.25)).rgb + texture(src, vUv + texel * vec2(0.25, 0.25)).rgb; fragColor = vec4(c * 0.25, 1.0); }`,
    { src: { value: null }, texel: { value: new THREE.Vector2(1 / W, 1 / H) } });
  const aDown = makeTarget(W, H);

  function setLight(sunAz, sunEl) {
    const e = sunEl * DEG, a = sunAz * DEG;
    G.uSunDir.value.set(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e));
    // afternoon palette of ch6 (linear), as at ~114 s
    G.uSunCol.value.set(3.4, 2.9, 2.2);
    G.uSkyZen.value.set(0.02, 0.07, 0.26); G.uSkyMid.value.set(0.16, 0.28, 0.50);
    G.uSkyHor.value.set(0.86, 0.66, 0.44); G.uSkyHor2.value.set(0.34, 0.42, 0.55);
    G.uSunDisk.value = 16; G.uSunVis.value = 1; G.uDusk.value = 0; G.uGreen.value = 1; G.uWaterLight.value = 0.8;
  }
  const CAMS = {
    // the chapter's over-under framing (~118 s)
    ou: { pos: [0, 0.004, 0.35], target: [0, 0.004, -2.65], fov: 50, split: 1 },
    // a little above the water: the whole grove, no split
    wide: { pos: [0, 0.9, 0.9], target: [0, 2.6, -12], fov: 50, split: 0 },
  };
  return {
    trees, initMs, G,
    stats: () => trees.map(t => ({ id: t.spec.id, ...t.stats })),
    heroPos: () => trees[0].bbox,
    render(o) {
      const t = o.t ?? 118;
      setLight(o.sunAz ?? 40, o.sunEl ?? 30);
      G.uT.value = t;
      let k = CAMS[o.cam || 'ou'];
      if (o.camPos) k = { ...k, pos: o.camPos, target: o.camTarget, fov: o.fov ?? k.fov, split: o.split ?? 0 };
      cam.position.set(...k.pos); cam.up.set(0, 1, 0); cam.lookAt(new THREE.Vector3(...k.target));
      cam.fov = k.fov; cam.aspect = W / H; cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
      G.uCamPos.value.copy(cam.position);
      const tj = performance.now();
      for (const tr of trees) {
        const vis = o.only ? o.only.includes(tr.spec.id) : (o.grove !== false || tr.spec.id === 'hero');
        tr.group.visible = tr.barkDepth.visible = tr.leafDepth.visible = vis;
        if (!vis) continue;
        // grove: either fixed (gGrove) or staggered behind the hero (each tree starts a little later)
        const delay = { hero: 0, g1: 0.1, g2: 0.18, g3: 0.3, g4: 0.24, g5: 0.36 }[tr.spec.id] || 0;
        const g = tr.spec.id === 'hero' ? (o.g ?? 1) : (o.stagger ? Math.min(1, Math.max(0, ((o.g ?? 1) - delay) / (1 - delay))) : (o.gGrove ?? 1));
        tr.update(g, t, renderer);
      }
      const jsMs = performance.now() - tj;
      if (!this._added) {
        for (const tr of trees) { air.scene.add(tr.group); shadow.scene.add(tr.barkDepth, tr.leafDepth); }
        this._added = true;
      }
      shadow.render(renderer, G.uSunDir.value);
      air.render(renderer, cam, aOut);
      down.render(renderer, aDown, { src: aOut.texture, texel: new THREE.Vector2(1 / IW, 1 / IH) });
      comp.render(renderer, hdr, { aTex: aDown.texture, invProj: cam.projectionMatrixInverse, camWorld: cam.matrixWorld, camPos: cam.position,
        pxw: 2 * Math.tan(cam.fov * DEG / 2) / H, t, split: k.split });
      post.run(hdr, { ...DEFAULT_POST, bloom: 0.5, vignette: 0.3, grain: 0.022, ca: 0.0012, saturation: 1.05, ...(o.post || {}) }, null,
        { frameSeed: Math.round(t * 60) % 100000, uiOn: false });
      return { jsMs };
    },
  };
}

// ------------------------------------------------------------------------------ boot
let scene;
async function boot() {
  if (SCENE === 'tree') scene = await makeTreeScene();
  else {
    const mod = await import('./creature-harness.js');
    scene = await mod.makeCreatureScene(ctx, { post, hdr, W, H });
  }
  const finish = () => { const px = new Uint8Array(4); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); };
  window.__lab = {
    info: () => ({ gpu: (() => { const d = gl.getExtension('WEBGL_debug_renderer_info'); return d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : '?'; })(),
      W, H, SS, scene: SCENE, initMs: scene.initMs, stats: scene.stats ? scene.stats() : null }),
    render: (o) => { const r = scene.render(o || {}); finish(); return r; },
    time: (o, n = 10) => {
      scene.render(o); finish();
      const t0 = performance.now(); let js = 0;
      for (let i = 0; i < n; i++) { const r = scene.render({ ...o, t: (o.t ?? 118) + i / 60, ...(o.gStep ? { g: Math.min(1, (o.g ?? 0.5) + i * o.gStep) } : {}), ...(o.evoStep ? { evo: (o.evo ?? 0) + i * o.evoStep } : {}) }); js += r.jsMs || 0; finish(); }
      return { ms: (performance.now() - t0) / n, jsMs: js / n };
    },
  };
  return true;
}
window.__ready = boot().catch(e => { console.error('[lab] ' + (e && e.stack || e)); throw e; });
