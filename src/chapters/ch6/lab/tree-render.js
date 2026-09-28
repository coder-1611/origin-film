// VI lab: rendering for lab/tree.js. One tree = a continuous bark tube mesh + instanced folded
// leaves, both skinned on the GPU from a per-frame NODE TEXTURE (current position + pipe-model
// radius of every node). The CPU pass that fills it is a pure function of (g, t):
//   forward pass  → tip extension (primary growth) + hierarchical wind (trunk → limb → twig),
//   reverse pass  → pipe-model radii at g (secondary thickening).
// Crown light comes from a per-frame LEAF-DENSITY VOLUME (leaf area per m³, splatted from the
// live leaves): Beer–Lambert sun transmittance, sky visibility and clump normals (−∇density),
// so the crown is dark inside and bright on its sunlit clumps, like a real canopy.
//
// Output convention matches ch6's air view: fragColor = vec4(linear HDR colour, distance to camera).
// Lighting uniforms are ch6's globals (uSunDir, uSunCol, uSkyZen, uSkyHor2, uCamPos, uT, uDusk).
import * as THREE from '../../../vendor/three.module.js';
import { v3, mulberry32, noise1, clamp } from './rng.js';

const DENS_CELL = 0.12;          // m
const DENS_Q = 0.06;             // LAD per 8-bit step (255 → 15.3 m²/m³)
const NODE_W = 256;

// ---------------------------------------------------------------------------------------- GLSL
export const GL_TREE_COMMON = /* glsl */`
uniform float uT, uDusk, uGrow, uWind, uSigma;
uniform vec3 uSunDir, uSunCol, uSkyZen, uSkyHor, uSkyHor2, uCamPos, uWindDir;
uniform sampler2D uNodes;
uniform highp sampler3D uDens;
uniform vec3 uDMin, uDSize; uniform float uDCell;
vec4 nodeAt(float i) { int k = int(i + 0.5) * 2; return texelFetch(uNodes, ivec2(k % ${NODE_W}, k / ${NODE_W}), 0); }
vec4 nodeQ(float i) { int k = int(i + 0.5) * 2 + 1; return texelFetch(uNodes, ivec2(k % ${NODE_W}, k / ${NODE_W}), 0); }
uniform sampler2D uNodeLight;                 // per node: texel 2k = (sunT, skyVis), 2k+1 = crown normal
vec4 nodeL(float i) { int k = int(i + 0.5) * 2; return texelFetch(uNodeLight, ivec2(k % ${NODE_W}, k / ${NODE_W}), 0); }
vec3 nodeCN(float i) { int k = int(i + 0.5) * 2 + 1; return texelFetch(uNodeLight, ivec2(k % ${NODE_W}, k / ${NODE_W}), 0).xyz; }
vec3 qrot(vec4 q, vec3 v) { return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v); }
// light scattered inside the canopy by the leaves themselves (single-scattering albedo ω ≈ r + t:
// green-yellow): what keeps a real crown's interior green-dark instead of black
vec3 canopyFill(float sunT, float sky) { return uSunCol * vec3(0.055, 0.10, 0.028) * (1.0 - sunT) * (0.35 + 0.65 * sky); }
// warm penumbra (Quilez): partially shadowed light is redder than full sun
vec3 sunTint(float T) { return pow(vec3(clamp(T, 0.0, 1.0)), vec3(1.0, 1.2, 1.5)); }
float densAt(vec3 p) {
  vec3 q = (p - uDMin) / uDSize;
  if (any(lessThan(q, vec3(0.0))) || any(greaterThan(q, vec3(1.0)))) return 0.0;
  return textureLod(uDens, q, 0.0).r * ${(255 * DENS_Q).toFixed(3)};
}
// Beer–Lambert transmittance along a ray through the crown (sigma = G·Ω ≈ 0.4 per LAD)
float crownT(vec3 p, vec3 d, float len, float skip) {
  float tau = 0.0, st = len / 12.0;
  for (int i = 0; i < 12; i++) tau += densAt(p + d * (skip + (float(i) + 0.5) * st));
  return exp(-uSigma * tau * st);
}
float skyVis(vec3 p) {
  float v = crownT(p, vec3(0.0, 1.0, 0.0), 2.4, 0.08) * 0.34;
  v += crownT(p, normalize(vec3(0.8, 0.75, 0.0)), 2.2, 0.08) * 0.165;
  v += crownT(p, normalize(vec3(-0.8, 0.75, 0.0)), 2.2, 0.08) * 0.165;
  v += crownT(p, normalize(vec3(0.0, 0.75, 0.8)), 2.2, 0.08) * 0.165;
  v += crownT(p, normalize(vec3(0.0, 0.75, -0.8)), 2.2, 0.08) * 0.165;
  return v;
}
vec3 crownNormal(vec3 p, vec3 fallback) {
  float e = uDCell * 2.0;
  vec3 g = vec3(densAt(p + vec3(e, 0, 0)) - densAt(p - vec3(e, 0, 0)), densAt(p + vec3(0, e, 0)) - densAt(p - vec3(0, e, 0)), densAt(p + vec3(0, 0, e)) - densAt(p - vec3(0, 0, e)));
  float l = length(g);
  return l > 1e-3 ? normalize(-g + fallback * 0.25 * l) : fallback;
}
vec3 skyIrr(vec3 n) {
  vec3 sky = mix(uSkyHor2 * 0.8, uSkyZen * 1.4, 0.5 + 0.5 * n.y) * (0.55 + 0.45 * n.y) * 0.75;
  // light bounced off the sunlit ground (sand/grass albedo ~0.25): fills backlit stems & undersides
  vec3 bounce = vec3(0.26, 0.22, 0.15) * uSunCol * max(uSunDir.y, 0.0) * 0.5 * (0.5 - 0.5 * n.y);
  return sky + bounce;
}
`;

// ---------------------------------------------------------------------------------------- build
/**
 * Build a renderable tree from growTree() output.
 *   placement: { pos:[x,y,z], yaw, scale }
 *   shared:    uniforms object shared by reference (uT, uSunDir, uSunCol, uSkyZen, uSkyHor, uSkyHor2,
 *              uCamPos, uDusk); missing ones are created.
 *   opts:      { atlas, extShadowGLSL, wind, leafTop, leafBot, leafTrans, young, barkYoung, barkOld }
 * update(g, t, renderer) must run once per frame before drawing (CPU skeleton pass + node-light pass).
 */
export function makeTree(skel, placement, shared, opts = {}) {
  const { pos: P0 = [0, 0, 0], yaw = 0, scale = 1 } = placement;
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const toW = (p) => [P0[0] + (p[0] * cy - p[2] * sy) * scale, P0[1] + p[1] * scale, P0[2] + (p[0] * sy + p[2] * cy) * scale];
  const rotW = (d) => [d[0] * cy - d[2] * sy, d[1], d[0] * sy + d[2] * cy];
  const n = skel.n, par = skel.parent;
  const rest = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) rest.set(toW([skel.pos[i * 3], skel.pos[i * 3 + 1], skel.pos[i * 3 + 2]]), i * 3);
  const o = skel.opts;
  const H = o.height * scale;
  const R = mulberry32((skel.opts.seed * 31 + 7) >>> 0);

  // ---- per-chain wind parameters (pivot-painter style hierarchy, evaluated on the CPU)
  const finalR = pipeRadii(skel, 1.01, scale);
  const chainW = skel.chains.map((c, ci) => {
    const first = c.nodes[0], last = c.nodes[c.nodes.length - 1];
    const L = Math.max(0.05, (skel.s[last] - (c.attach >= 0 ? skel.s[c.attach] : 0)) * scale);
    const r = Math.max(0.002, finalR[first]);
    // cantilever: f ∝ r / L²; amplitude grows with L and falls with stiffness
    const f = clamp(0.9 * (r / 0.01) / (L * L) + 0.55, 0.45, 3.2);
    const A = ci === 0 ? 0 : clamp(0.035 * L * Math.pow(0.012 / r, 0.35), 0.004, 0.16);
    return { L, f, A, ph: R() * 6.283, ph2: R() * 6.283, s0: c.attach >= 0 ? skel.s[c.attach] * scale : 0 };
  });

  // ---- node texture
  const rows = Math.ceil(n * 2 / NODE_W);
  const nodeData = new Float32Array(NODE_W * rows * 4);
  const nodeTex = new THREE.DataTexture(nodeData, NODE_W, rows, THREE.RGBAFormat, THREE.FloatType);
  nodeTex.minFilter = nodeTex.magFilter = THREE.NearestFilter;
  nodeTex.needsUpdate = true;

  // ---- density volume (world-aligned box around the finished crown)
  const L = skel.leaves;
  let bmin = [1e9, 1e9, 1e9], bmax = [-1e9, -1e9, -1e9];
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) { bmin[c] = Math.min(bmin[c], rest[i * 3 + c]); bmax[c] = Math.max(bmax[c], rest[i * 3 + c]); }
  bmin = bmin.map(v => v - 0.5 * scale); bmax = bmax.map(v => v + 0.5 * scale);
  const cell = DENS_CELL * scale;
  const dims = bmin.map((v, c) => Math.max(4, Math.ceil((bmax[c] - v) / cell)));
  const dsize = dims.map(d => d * cell);
  const DN = dims[0] * dims[1] * dims[2];
  const dAcc = new Float32Array(DN), dTmp = new Float32Array(DN), dByte = new Uint8Array(DN);
  const densTex = new THREE.Data3DTexture(dByte, dims[0], dims[1], dims[2]);
  densTex.format = THREE.RedFormat; densTex.type = THREE.UnsignedByteType;
  densTex.minFilter = densTex.magFilter = THREE.LinearFilter;
  densTex.wrapS = densTex.wrapT = densTex.wrapR = THREE.ClampToEdgeWrapping;
  densTex.unpackAlignment = 1;
  densTex.needsUpdate = true;
  const leafRest = new Float32Array(L.n * 3);
  for (let l = 0; l < L.n; l++) {
    const h = L.host[l];
    const off = rotW([L.off[l * 3], L.off[l * 3 + 1], L.off[l * 3 + 2]]), ax = rotW([L.axis[l * 3], L.axis[l * 3 + 1], L.axis[l * 3 + 2]]);
    for (let c = 0; c < 3; c++) leafRest[l * 3 + c] = rest[h * 3 + c] + (off[c] + ax[c] * L.size[l] * 0.5) * scale;
  }

  // ---- uniforms
  const U = shared;
  const need = { uT: 0, uDusk: 0, uSunDir: new THREE.Vector3(0, 0.5, -1).normalize(), uSunCol: new THREE.Vector3(3, 2.6, 2),
    uSkyZen: new THREE.Vector3(0.03, 0.08, 0.25), uSkyHor: new THREE.Vector3(0.8, 0.65, 0.45), uSkyHor2: new THREE.Vector3(0.35, 0.42, 0.55), uCamPos: new THREE.Vector3() };
  for (const k in need) if (!U[k]) U[k] = { value: need[k] };
  if (!U.uWind) U.uWind = { value: opts.wind ?? 1 };
  if (!U.uWindDir) U.uWindDir = { value: new THREE.Vector3(1, 0, 0.25).normalize() };
  const own = {
    uGrow: { value: 0 }, uSigma: { value: 0.4 }, uNodes: { value: nodeTex }, uDens: { value: densTex },
    uDMin: { value: new THREE.Vector3(...bmin) }, uDSize: { value: new THREE.Vector3(...dsize) }, uDCell: { value: cell },
    uAtlas: { value: opts.atlas.texture }, uUnfold: { value: o.unfold }, uScale: { value: scale }, uBaseY: { value: P0[1] },
    uLeafTop: { value: new THREE.Vector3(...(opts.leafTop || [0.048, 0.090, 0.028])) },
    uLeafBot: { value: new THREE.Vector3(...(opts.leafBot || [0.085, 0.120, 0.058])) },
    uLeafTrans: { value: new THREE.Vector3(...(opts.leafTrans || [0.070, 0.125, 0.018])) },
    uYoung: { value: new THREE.Vector3(...(opts.young || [0.110, 0.150, 0.040])) },
    uBarkYoung: { value: new THREE.Vector3(...(opts.barkYoung || [0.13, 0.112, 0.085])) },
    uBarkOld: { value: new THREE.Vector3(...(opts.barkOld || [0.165, 0.152, 0.135])) },
    uBirch: { value: skel.opts.bark === 'birch' ? 1 : 0 },
  };
  // per-node crown lighting (one small GPU pass per frame instead of marching the volume at every
  // leaf vertex): sun transmittance, sky visibility, clump normal
  const lightRT = new THREE.WebGLRenderTarget(NODE_W, rows, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false });
  own.uNodeLight = { value: lightRT.texture };
  own.uNodeCount = { value: n };
  const uniforms = { ...U, ...own };
  const lightMat = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3, uniforms, depthTest: false, depthWrite: false,
    vertexShader: 'precision highp float; in vec3 position; void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: /* glsl */`
    precision highp float; precision highp sampler3D;
    ${GL_TREE_COMMON}
    uniform float uNodeCount;
    out vec4 fragColor;
    void main() {
      int k = int(gl_FragCoord.y) * ${NODE_W} + int(gl_FragCoord.x);
      int node = k / 2;
      if (float(node) >= uNodeCount) { fragColor = vec4(1.0, 1.0, 0.0, 1.0); return; }
      vec3 p = nodeAt(float(node)).xyz;
      vec3 c = vec3(uDMin.x + uDSize.x * 0.5, uDMin.y + uDSize.y * 0.45, uDMin.z + uDSize.z * 0.5);
      if ((k & 1) == 0) fragColor = vec4(crownT(p, uSunDir, 3.2, 0.12), skyVis(p), 0.0, 1.0);
      else fragColor = vec4(crownNormal(p, normalize(p - c + vec3(0.0, 1e-3, 0.0))), 1.0);
    }`,
  });
  const lightTri = new THREE.BufferGeometry();
  lightTri.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  const lightScene = new THREE.Scene(); const lightMesh = new THREE.Mesh(lightTri, lightMat); lightMesh.frustumCulled = false; lightScene.add(lightMesh);
  const lightCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const extShadow = opts.extShadowGLSL || 'float extShadow(vec3 p, vec3 n) { return 1.0; }';

  // ---------------------------------------------------------------- bark geometry
  const bark = buildBark(skel, rest, finalR, rotW, scale);
  const BARK_VS = /* glsl */`
    precision highp float; precision highp sampler3D;
    ${GL_TREE_COMMON}
    uniform mat4 viewMatrix, projectionMatrix; uniform float uBaseY, uScale;
    in vec3 position; in vec3 aRad; in vec3 aTan; in vec4 aInfo;   // info: node, radiusNode, around (0..1), arc length
    in float aFlare;
    out vec3 vP; out vec3 vN; out vec3 vT; out vec2 vUV; out float vR; out float vSun; out float vSky; out float vH;
    void main() {
      vec4 a = nodeAt(aInfo.x), b = nodeAt(aInfo.y);
      vec4 qa = nodeQ(aInfo.y);
      vec3 rad = qrot(qa, aRad), tng = qrot(qa, aTan);
      float r = b.w;
      float h = max(a.y - uBaseY, 0.0) / uScale;
      float fl = aFlare * exp(-h / 0.20);
      r *= 1.0 + fl * (0.7 + 0.35 * cos(aInfo.z * 6.2832 * 5.0 + 1.3) + 0.15 * cos(aInfo.z * 6.2832 * 3.0));
      vec3 p = a.xyz + rad * r;
      vP = p; vN = rad; vT = tng; vR = r; vH = h;
      vUV = vec2(aInfo.z * max(r, 0.004) * 6.2832, aInfo.w);
      vec4 nl = nodeL(aInfo.x);
      vSun = nl.x; vSky = nl.y;
      // unborn rings collapse onto their node (zero-area triangles; never fling vertices off-screen,
      // which would smear slivers across the frame from the last live ring)
      gl_Position = projectionMatrix * viewMatrix * vec4(r > 0.0 ? p : a.xyz, 1.0);
    }`;
  const barkMat = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3, uniforms,
    vertexShader: BARK_VS,
    fragmentShader: /* glsl */`
    precision highp float; precision highp sampler3D;
    ${GL_TREE_COMMON}
    uniform vec3 uBarkYoung, uBarkOld; uniform float uBirch;
    ${extShadow}
    in vec3 vP; in vec3 vN; in vec3 vT; in vec2 vUV; in float vR; in float vSun; in float vSky; in float vH;
    out vec4 fragColor;
    float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
    float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
    void main() {
      vec3 n = normalize(vN), T = normalize(vT);
      vec3 B = normalize(cross(T, n));
      // young trees keep smooth periderm with horizontal lenticels; fissured rhytidome only at
      // the base of the trunk; current-year shoots are greener / redder
      float age = smoothstep(0.004, 0.035, vR);
      float base = age * (1.0 - smoothstep(0.15, 1.6, vH)) * smoothstep(0.03, 0.07, vR);
      vec2 q = vec2(vUV.x * 26.0, vUV.y * 3.2);
      float f1 = vn(q + vec2(0.0, vn(q * 0.5) * 2.0));
      float f2 = vn(q * vec2(2.3, 1.7) + 7.1);
      float fiss = (1.0 - smoothstep(0.05, 0.30, abs(f1 - 0.5))) * base;
      float len = smoothstep(0.8, 0.9, vn(vec2(vUV.x * 55.0, vUV.y * 9.0))) * (0.4 + 0.6 * age);
      vec3 shoot = vec3(0.10, 0.085, 0.045);
      vec3 alb = mix(shoot, mix(uBarkYoung, uBarkOld, age), smoothstep(0.0, 0.6, age));
      alb *= (0.85 + 0.3 * f2) * (1.0 - 0.5 * fiss);
      if (uBirch > 0.5) {
        // birch: chalky white periderm with dark horizontal lenticel dashes and dark base
        vec3 wht = vec3(0.52, 0.50, 0.47) * (0.85 + 0.2 * f2);
        float dash = smoothstep(0.72, 0.8, vn(vec2(vUV.x * 14.0, vUV.y * 16.0))) * smoothstep(0.3, 0.7, vn(vec2(vUV.x * 3.0, vUV.y * 30.0)));
        wht = mix(wht, vec3(0.06, 0.05, 0.045), clamp(dash + fiss * 1.5 + (1.0 - smoothstep(0.1, 0.6, vH)) * 0.6, 0.0, 1.0));
        alb = mix(alb, wht, smoothstep(0.1, 0.5, age));
      } else {
        alb *= 1.0 - 0.35 * len;
      }
      // algae/lichen dusting on the shaded side of older wood
      alb = mix(alb, vec3(0.10, 0.12, 0.075), age * 0.3 * smoothstep(0.55, 0.8, vn(vUV * vec2(4.0, 1.5) + 3.0)) * (0.8 - 0.5 * n.y));
      vec3 nb = normalize(n + B * (vn(q + vec2(0.05, 0.0)) - f1) * 2.0 * base - n * fiss * 0.3);
      vec3 L = uSunDir;
      // shadow maps can't resolve twigs (texel ≫ radius → self-shadow acne): thin wood relies on the crown volume
      float sh = vSun * mix(1.0, extShadow(vP, nb), smoothstep(0.006, 0.02, vR));
      float cav = 1.0 - 0.6 * fiss;
      vec3 c = alb * (uSunCol * sunTint(sh) * max(dot(nb, L), 0.0) + skyIrr(nb) * vSky * cav + canopyFill(vSun, vSky) * cav);
      c *= 1.0 - uDusk;
      fragColor = vec4(c, distance(vP, uCamPos));
    }`,
  });
  const barkMesh = new THREE.Mesh(bark.geometry, barkMat);
  barkMesh.frustumCulled = false;

  // ---------------------------------------------------------------- leaf geometry
  const lg = new THREE.InstancedBufferGeometry();
  const qv = [], qi = [];
  for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) qv.push(i - 1, j * 0.5, 0);
  for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) { const a = j * 3 + i, b = a + 1, c = a + 3, d = c + 1; qi.push(a, b, c, b, d, c); }
  lg.setAttribute('position', new THREE.Float32BufferAttribute(qv, 3));
  lg.setIndex(qi);
  const iOff = new Float32Array(L.n * 4), iAx = new Float32Array(L.n * 4), iNr = new Float32Array(L.n * 4), iLf = new Float32Array(L.n * 4);
  const iTn = new Float32Array(L.n * 3);
  for (let l = 0; l < L.n; l++) {
    const off = rotW([L.off[l * 3], L.off[l * 3 + 1], L.off[l * 3 + 2]]).map(v => v * scale);
    iOff.set([...off, L.host[l]], l * 4);
    iAx.set([...rotW([L.axis[l * 3], L.axis[l * 3 + 1], L.axis[l * 3 + 2]]), L.variant[l]], l * 4);
    iNr.set([...rotW([L.nrm[l * 3], L.nrm[l * 3 + 1], L.nrm[l * 3 + 2]]), L.seed[l]], l * 4);
    iLf.set([L.birth[l], L.death[l], L.size[l] * scale, 0], l * 4);
    iTn.set(rotW([L.tan[l * 3], L.tan[l * 3 + 1], L.tan[l * 3 + 2]]), l * 3);
  }
  lg.setAttribute('iTn', new THREE.InstancedBufferAttribute(iTn, 3));
  lg.setAttribute('iOff', new THREE.InstancedBufferAttribute(iOff, 4));
  lg.setAttribute('iAx', new THREE.InstancedBufferAttribute(iAx, 4));
  lg.setAttribute('iNr', new THREE.InstancedBufferAttribute(iNr, 4));
  lg.setAttribute('iLf', new THREE.InstancedBufferAttribute(iLf, 4));
  lg.instanceCount = L.n;
  const LEAF_VS = /* glsl */`
    precision highp float; precision highp sampler3D;
    ${GL_TREE_COMMON}
    uniform mat4 viewMatrix, projectionMatrix; uniform float uUnfold;
    in vec3 position; in vec4 iOff, iAx, iNr, iLf; in vec3 iTn;
    out vec3 vP; out vec3 vN; out vec3 vCN; out vec2 vUV; out vec4 vL; out float vSun; out float vSky;
    vec3 rotA(vec3 v, vec3 k, float a) { float c = cos(a), s = sin(a); return v * c + cross(k, v) * s + k * dot(k, v) * (1.0 - c); }
    void main() {
      float age = uGrow - iLf.x;
      float die = clamp((uGrow - iLf.y) / 0.035, 0.0, 1.0);
      if (age <= 0.0 || die >= 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
      // the first leaves of a seedling open fast (the plant is small); later flushes take longer
      float unf = smoothstep(0.0, uUnfold * (0.3 + 0.7 * smoothstep(0.0, 0.15, iLf.x)), age);
      float open = smoothstep(0.15, 1.0, unf);
      vec4 h = nodeAt(iOff.w);
      vec4 hq = nodeQ(iOff.w);
      float seed = iNr.w;
      vec3 pet = qrot(hq, iOff.xyz);
      vec3 iax = qrot(hq, iAx.xyz), inr = qrot(hq, iNr.xyz);
      vec3 petDir = normalize(pet + vec3(0.0, 1e-4, 0.0));
      // bud → blade: starts folded, pointing along the shoot, then turns out and opens
      // a bud hugs the shoot (leaf primordia wrapped round the apex), then turns out as it opens
      vec3 budDir = normalize(qrot(hq, iTn) + petDir * 0.3);
      vec3 ax = normalize(mix(budDir, iax, smoothstep(0.1, 0.9, unf)));
      vec3 nr = normalize(inr - ax * dot(inr, ax));
      // flutter: gusty, per-leaf phase, twisting about the petiole and pitching
      float gust = 0.55 + 0.45 * sin(uT * 0.9 + dot(h.xyz, uWindDir) * 0.8 + 1.7 * sin(uT * 0.37));
      // leaf flutter 3–5 Hz (aspen-like measurements), two incommensurate components, per-leaf phase
      float fl = uWind * gust * (0.22 * sin(uT * (19.0 + 9.0 * seed) + seed * 40.0) + 0.09 * sin(uT * (31.0 + 12.0 * seed) + seed * 17.0));
      ax = rotA(ax, petDir, fl); nr = rotA(nr, petDir, fl);
      float pitch = uWind * gust * 0.12 * sin(uT * (13.0 + 6.0 * seed) + seed * 9.0);
      vec3 sd0 = normalize(cross(ax, nr));
      ax = rotA(ax, sd0, pitch); nr = rotA(nr, sd0, pitch);
      vec3 sd = normalize(cross(ax, nr));
      // sun leaves (outer crown) end up a little smaller & flatter than shade leaves
      float size = iLf.z * mix(0.22, 1.0, unf) * (1.0 - 0.35 * die);
      float fold = mix(1.2, 0.30 + 0.15 * fract(seed * 13.0), open);
      float u = position.x, v = position.y;
      vec3 base = h.xyz + pet * mix(0.25, 1.0, unf);
      float hw = 0.29 * size;
      vec3 p = base + ax * v * size + sd * u * hw * cos(fold) + nr * abs(u) * hw * sin(fold);
      p -= vec3(0.0, 1.0, 0.0) * v * v * size * 0.16 * open;                       // tip droops
      p += nr * (v - v * v) * size * 0.05 * (1.0 - 2.0 * fract(seed * 7.0));         // blade arch
      p.y -= die * die * 0.25;                                                       // shed leaves drop
      vN = normalize(nr * cos(fold) - sd * sign(u) * sin(fold));
      vP = p;
      vUV = vec2((iAx.w + (u * 0.5 + 0.5)) / 4.0, v);
      vL = vec4(age, die, seed, iAx.w);
      vec3 hp = h.xyz + pet;
      vec4 nl = nodeL(iOff.w);
      vSun = nl.x; vSky = nl.y; vCN = nodeCN(iOff.w);
      gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
    }`;
  const leafMat = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3, uniforms, side: THREE.DoubleSide,
    vertexShader: LEAF_VS,
    fragmentShader: /* glsl */`
    precision highp float; precision highp sampler3D;
    ${GL_TREE_COMMON}
    uniform sampler2D uAtlas; uniform vec3 uLeafTop, uLeafBot, uLeafTrans, uYoung; uniform float uUnfold;
    ${extShadow}
    in vec3 vP; in vec3 vN; in vec3 vCN; in vec2 vUV; in vec4 vL; in float vSun; in float vSky;
    out vec4 fragColor;
    void main() {
      vec4 tx = texture(uAtlas, vUV);
      // anti-aliased alpha test (Golus): undo mip alpha shrinkage, then sharpen to the pixel
      vec2 ts = vec2(textureSize(uAtlas, 0));
      vec2 dx = dFdx(vUV * ts), dy = dFdy(vUV * ts);
      float mip = max(0.0, 0.5 * log2(max(dot(dx, dx), dot(dy, dy))));
      float a = tx.a * (1.0 + mip * 0.25);
      a = (a - 0.5) / max(fwidth(a), 1e-4) + 0.5;
      if (a < 0.5) discard;
      vec3 V = normalize(uCamPos - vP);
      vec3 nl = normalize(vN);
      bool top = dot(nl, V) > 0.0;
      vec3 ns = top ? nl : -nl;
      float seed = vL.z, age = vL.x, die = vL.y;
      // per-leaf colour: value ±18 %, a hue drift toward yellow or blue-green, sun vs shade leaves
      float v1 = fract(seed * 7.31), v2 = fract(seed * 13.7), v3 = fract(seed * 3.93);
      vec3 hue = vec3(1.0 + 0.10 * (v2 - 0.5), 1.0, 1.0 - 0.35 * (v2 - 0.5));
      float val = 0.82 + 0.36 * v1;
      vec3 albT = uLeafTop * hue * val, albB = uLeafBot * hue * val, trn = uLeafTrans * hue * (0.85 + 0.3 * v3);
      float shade = 1.0 - vSky;                    // shade leaves: thinner, lighter, more translucent
      albT = mix(albT, albT * vec3(1.15, 1.2, 1.1), shade * 0.6);
      trn *= 1.0 + 0.5 * shade;
      // young leaves: lighter, yellower, more translucent (they mature over ~0.3 of growth)
      float young = 1.0 - smoothstep(uUnfold * 0.5, uUnfold * 5.0, age);
      albT = mix(albT, uYoung * hue, young); albB = mix(albB, uYoung * hue * 1.1, young); trn = mix(trn, uYoung * vec3(1.2, 1.3, 0.9), young);
      // dying (shed) leaves yellow first
      vec3 yel = vec3(0.30, 0.20, 0.03);
      albT = mix(albT, yel * 0.6, die); albB = mix(albB, yel * 0.7, die); trn = mix(trn, yel, die);
      float mottle = tx.r * 1.2, vein = tx.g, edge = tx.b;
      vec3 alb = (top ? albT : albB) * mottle;
      alb = mix(alb * vec3(1.3, 1.1, 0.7), alb, smoothstep(0.0, 0.5, edge));      // slightly paler margin
      // lighting: diffuse normal blended toward the clump normal (volume, not speckle)
      vec3 cn = vCN;
      vec3 nd = normalize(mix(ns, cn * (dot(cn, V) < -0.2 ? 0.6 : 1.0), 0.55));
      vec3 L = uSunDir;
      float sh = vSun * extShadow(vP, ns);
      float ndl = max(dot(nd, L), 0.0);
      // transmission: light arriving on the far face of the blade (true blade normal), veins dark
      float tl = max(-dot(ns, L), 0.0);
      float fwd = pow(max(dot(-V, L), 0.0), 8.0);
      vec3 T = trn * (1.0 - 0.55 * vein) * tl * (0.75 + 1.4 * fwd);
      // waxy cuticle: GGX, rough-ish, stronger on the upper face
      vec3 Hh = normalize(L + V);
      float nh = max(dot(ns, Hh), 0.0), a2 = top ? 0.09 : 0.25;
      float D = a2 / (3.14159 * pow(nh * nh * (a2 - 1.0) + 1.0, 2.0));
      float F = 0.03 + 0.97 * pow(1.0 - max(dot(V, Hh), 0.0), 5.0);
      float spec = D * F * max(dot(ns, L), 0.0) * 0.25 * (top ? 1.0 : 0.3);
      vec3 c = uSunCol * sunTint(sh) * (alb * ndl + T + vec3(spec));
      c += alb * skyIrr(nd) * (0.25 + 0.75 * vSky);
      c += (alb + trn * 0.5) / 0.1 * canopyFill(vSun, vSky) * 0.1;
      // a flush: buds that have just opened on this note glow, backlit and bright, for a moment
      // (growth steps on every marimba note; the leitmotif's steps are three times larger)
      float fresh = exp(-age / 0.010) * (1.0 - die);
      c += (uYoung * vec3(1.3, 1.5, 0.8) * (0.6 + 1.6 * fwd) + trn * 1.2) * uSunCol * fresh * 0.55;
      c *= 1.0 - uDusk;
      fragColor = vec4(c, distance(vP, uCamPos));
    }`,
  });
  const leafMesh = new THREE.Mesh(lg, leafMat);
  leafMesh.frustumCulled = false;

  // depth-only casters for an external shadow map (ch6's makeSunShadow scene)
  const DEPTH_FS = 'precision highp float; out vec4 fragColor; void main() { fragColor = vec4(1.0); }';
  const LEAF_DEPTH_FS = `precision highp float; uniform sampler2D uAtlas; in vec2 vUV; out vec4 fragColor;
    void main() { if (texture(uAtlas, vUV).a < 0.5) discard; fragColor = vec4(1.0); }`;
  const barkDepth = new THREE.Mesh(bark.geometry, new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, uniforms, vertexShader: BARK_VS, fragmentShader: DEPTH_FS }));
  const leafDepth = new THREE.Mesh(lg, new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, uniforms, vertexShader: LEAF_VS, fragmentShader: LEAF_DEPTH_FS, side: THREE.DoubleSide }));
  barkDepth.frustumCulled = leafDepth.frustumCulled = false;

  const group = new THREE.Group();
  group.add(barkMesh, leafMesh);

  // ---------------------------------------------------------------- per-frame update
  const cur = new Float32Array(n * 3), wind = new Float32Array(n * 3), A = new Float32Array(n), rad = new Float32Array(n);
  const pn = o.pipeN, aLeaf = Math.pow(o.leafPipe * scale, pn), rMin = o.rMin * scale;
  const chainOf = skel.chainOf, dG = skel.dG;
  let lastDensG = -1;
  const Wd = U.uWindDir.value;
  // shoot unfurling (Pirk et al. 2012; SpeedTree "unfurl"): a new lateral emerges nearly along
  // its parent axis and opens to its final angle over UNFURL of growth. One rotation per chain,
  // composed down the hierarchy, applied to the chain's rest offsets (and, on the GPU, to its
  // ring frames and leaves through the per-node quaternion).
  const UNFURL = 0.06;
  const chainU = skel.chains.map((c) => {
    if (c.attach < 0) return null;
    const f = c.nodes[0], a = c.attach, pa = par[a];
    const Pn = (i) => [rest[i * 3], rest[i * 3 + 1], rest[i * 3 + 2]];
    const dc = v3.norm(v3.sub(Pn(f), Pn(a))), dp = pa >= 0 ? v3.norm(v3.sub(Pn(a), Pn(pa))) : [0, 1, 0];
    const cr = v3.cross(dc, dp), sn = v3.len(cr);
    return { ax: sn > 1e-6 ? v3.scale(cr, 1 / sn) : [1, 0, 0], ang: Math.atan2(sn, v3.dot(dc, dp)), b: skel.birth[f] };
  });
  const NCH = skel.chains.length, chainQ = new Float32Array(NCH * 4);
  const chainParent = skel.chains.map(c => c.attach >= 0 ? chainOf[c.attach] : -1);
  function update(g, t, renderer) {
    own.uGrow.value = g;
    const w = U.uWind.value;
    const wx = Wd.x, wz = Wd.z;
    // chain rotations (hierarchical quaternions)
    for (let ci = 0; ci < NCH; ci++) {
      const cu = chainU[ci];
      let lx = 0, ly = 0, lz = 0, lw = 1;
      if (cu) {
        const u = clamp((g - cu.b) / UNFURL), uu = u * u * (3 - 2 * u);
        const th = (1 - uu) * cu.ang * 0.82, sh = Math.sin(th / 2);
        lx = cu.ax[0] * sh; ly = cu.ax[1] * sh; lz = cu.ax[2] * sh; lw = Math.cos(th / 2);
      }
      const pc = chainParent[ci];
      if (pc < 0) { chainQ[ci * 4] = lx; chainQ[ci * 4 + 1] = ly; chainQ[ci * 4 + 2] = lz; chainQ[ci * 4 + 3] = lw; continue; }
      const px = chainQ[pc * 4], py = chainQ[pc * 4 + 1], pz = chainQ[pc * 4 + 2], pw = chainQ[pc * 4 + 3];
      chainQ[ci * 4] = pw * lx + px * lw + py * lz - pz * ly;
      chainQ[ci * 4 + 1] = pw * ly - px * lz + py * lw + pz * lx;
      chainQ[ci * 4 + 2] = pw * lz + px * ly - py * lx + pz * lw;
      chainQ[ci * 4 + 3] = pw * lw - px * lx - py * ly - pz * lz;
    }
    // global gust (travels along the wind): slow swell + faster buffets
    const gustAt = (x) => 0.6 + 0.4 * noise1(t * 0.45 - x * 0.08, 3) + 0.18 * noise1(t * 1.7 - x * 0.3, 9);
    // forward: wind displacement (hierarchical), unfurl rotation and tip extension
    for (let i = 0; i < n; i++) {
      const ci = chainOf[i], cw = chainW[ci];
      const p = par[i];
      const rx = rest[i * 3], ry = rest[i * 3 + 1], rz = rest[i * 3 + 2];
      let dx = 0, dy = 0, dz = 0;
      if (ci === 0) {
        const hh = Math.max(0, ry - P0[1]) / H;
        const gst = gustAt(P0[0] * wx + P0[2] * wz);
        const k = w * 0.035 * H * hh * hh * (0.55 * gst + 0.25 * Math.sin(t * 2.1 + 0.3) * gst);
        dx = wx * k; dz = wz * k;
      } else {
        const att = skel.chains[ci].attach;
        const s = (skel.s[i] * scale - cw.s0) / cw.L;
        const gst = gustAt(rx * wx + rz * wz);
        const osc = Math.sin(t * cw.f * 6.2832 + cw.ph) * (0.6 + 0.4 * gst) + 0.35 * gst;
        const k = w * cw.A * s * s;
        dx = wind[att * 3] + wx * k * osc + 0.3 * k * Math.sin(t * cw.f * 4.7 + cw.ph2);
        dy = wind[att * 3 + 1] + k * 0.6 * Math.sin(t * cw.f * 6.2832 + cw.ph + 1.1);
        dz = wind[att * 3 + 2] + wz * k * osc;
      }
      wind[i * 3] = dx; wind[i * 3 + 1] = dy; wind[i * 3 + 2] = dz;
      if (p < 0) { cur[0] = rx; cur[1] = ry; cur[2] = rz; continue; }
      const e = clamp((g - skel.birth[i]) / dG);
      // rest offset from the parent, rotated by this chain's quaternion
      const ox = rx - rest[p * 3], oy = ry - rest[p * 3 + 1], oz = rz - rest[p * 3 + 2];
      const qx = chainQ[ci * 4], qy = chainQ[ci * 4 + 1], qz = chainQ[ci * 4 + 2], qw = chainQ[ci * 4 + 3];
      const tx = 2 * (qy * oz - qz * oy), ty = 2 * (qz * ox - qx * oz), tz = 2 * (qx * oy - qy * ox);
      const vx = ox + qw * tx + (qy * tz - qz * ty), vy = oy + qw * ty + (qz * tx - qx * tz), vz = oz + qw * tz + (qx * ty - qy * tx);
      cur[i * 3] = cur[p * 3] + e * (vx + dx - wind[p * 3]);
      cur[i * 3 + 1] = cur[p * 3 + 1] + e * (vy + dy - wind[p * 3 + 1]);
      cur[i * 3 + 2] = cur[p * 3 + 2] + e * (vz + dz - wind[p * 3 + 2]);
    }
    // reverse: pipe model at g
    const LB = skel.leafBirthByNode;
    for (let i = n - 1; i >= 0; i--) {
      if (g < skel.birth[i]) { A[i] = 0; rad[i] = 0; continue; }
      let a = A[i] = A[i] || 0;
      let nl = 0; for (const b of LB[i]) if (b <= g) nl++;
      a += nl * aLeaf;
      A[i] = 0;
      const e = clamp((g - skel.birth[i]) / dG);
      rad[i] = Math.max(rMin * (0.35 + 0.65 * e), Math.pow(a, 1 / pn));
      if (par[i] >= 0) A[par[i]] += Math.pow(rad[i], pn);
    }
    A.fill(0);
    for (let i = 0; i < n; i++) {
      const ci = chainOf[i];
      nodeData[i * 8] = cur[i * 3]; nodeData[i * 8 + 1] = cur[i * 3 + 1]; nodeData[i * 8 + 2] = cur[i * 3 + 2]; nodeData[i * 8 + 3] = rad[i];
      nodeData[i * 8 + 4] = chainQ[ci * 4]; nodeData[i * 8 + 5] = chainQ[ci * 4 + 1]; nodeData[i * 8 + 6] = chainQ[ci * 4 + 2]; nodeData[i * 8 + 7] = chainQ[ci * 4 + 3];
    }
    nodeTex.needsUpdate = true;
    if (g !== lastDensG) { splatDensity(g); lastDensG = g; }
    if (renderer) {
      const prev = renderer.getRenderTarget();
      renderer.setRenderTarget(lightRT);
      renderer.render(lightScene, lightCam);
      renderer.setRenderTarget(prev);
    }
  }
  function splatDensity(g) {
    dAcc.fill(0);
    const [nx, ny, nz] = dims, inv = 1 / cell, cellVol = cell ** 3;
    const stride = opts.densStride || 1;                  // background trees: splat every Nth leaf ×N
    for (let l = 0; l < L.n; l += stride) {
      const age = g - L.birth[l];
      if (age <= 0 || g > L.death[l] + 0.035) continue;
      const unf = Math.min(1, age / o.unfold);
      const sz = L.size[l] * scale * (0.22 + 0.78 * unf);
      const area = 0.35 * sz * sz / cellVol * stride;
      const fx = (leafRest[l * 3] - bmin[0]) * inv - 0.5, fy = (leafRest[l * 3 + 1] - bmin[1]) * inv - 0.5, fz = (leafRest[l * 3 + 2] - bmin[2]) * inv - 0.5;
      const ix = Math.floor(fx), iy = Math.floor(fy), iz = Math.floor(fz);
      const ax = fx - ix, ay = fy - iy, az = fz - iz;
      for (let c = 0; c < 8; c++) {
        const X = ix + (c & 1), Y = iy + ((c >> 1) & 1), Z = iz + (c >> 2);
        if (X < 0 || Y < 0 || Z < 0 || X >= nx || Y >= ny || Z >= nz) continue;
        const wgt = ((c & 1) ? ax : 1 - ax) * (((c >> 1) & 1) ? ay : 1 - ay) * ((c >> 2) ? az : 1 - az);
        dAcc[(Z * ny + Y) * nx + X] += area * wgt;
      }
    }
    // separable 1-2-1 blur (x, y, z): leaf area is diffuse at the scale of a clump
    blur3(dAcc, dTmp, dims);
    for (let i = 0; i < DN; i++) dByte[i] = Math.min(255, Math.round(dAcc[i] / DENS_Q));
    densTex.needsUpdate = true;
  }
  return {
    group, bark: barkMesh, leaves: leafMesh, barkDepth, leafDepth, barkMat, leafMat, uniforms: own, update,
    stats: { nodes: n, leaves: L.n, barkVerts: bark.verts, barkTris: bark.tris, grid: dims },
    densityGLSL: GL_TREE_COMMON, bbox: [bmin, bmax],
  };
}

function blur3(a, tmp, [nx, ny, nz]) {
  // separable 1-2-1 along x, y, z (allocation-free; zero outside the box)
  const sx = 1, sy = nx, sz = nx * ny;
  const pass = (src, dst, st, n, stride2, n2, stride3, n3) => {
    for (let k = 0; k < n3; k++) for (let j = 0; j < n2; j++) {
      const base = k * stride3 + j * stride2;
      let prev = 0, cur = src[base];
      for (let i = 0; i < n; i++) {
        const idx = base + i * st;
        const next = i < n - 1 ? src[idx + st] : 0;
        dst[idx] = 0.25 * prev + 0.5 * cur + 0.25 * next;
        prev = cur; cur = next;
      }
    }
  };
  pass(a, tmp, sx, nx, sy, ny, sz, nz);     // x lines
  pass(tmp, a, sy, ny, sx, nx, sz, nz);     // y lines
  pass(a, tmp, sz, nz, sx, nx, sy, ny);     // z lines
  a.set(tmp);
}

/** Final (or any g) pipe-model radii, used for LOD/wind stiffness at build time. */
function pipeRadii(skel, g, scale) {
  const o = skel.opts, n = skel.n, pn = o.pipeN, aLeaf = Math.pow(o.leafPipe * scale, pn);
  const A = new Float32Array(n), r = new Float32Array(n);
  for (let i = n - 1; i >= 0; i--) {
    if (g < skel.birth[i]) continue;
    let nl = 0; for (const b of skel.leafBirthByNode[i]) if (b <= g) nl++;
    r[i] = Math.max(o.rMin * scale, Math.pow(A[i] + nl * aLeaf, 1 / pn));
    if (skel.parent[i] >= 0) A[skel.parent[i]] += Math.pow(r[i], pn);
  }
  return r;
}

/** Continuous generalized-cylinder mesh along each chain, parallel-transport frames. */
function buildBark(skel, rest, finalR, rotW, scale) {
  const pos = [], rad = [], tan = [], info = [], flare = [], idx = [];
  const P = (i) => [rest[i * 3], rest[i * 3 + 1], rest[i * 3 + 2]];
  for (let ci = 0; ci < skel.chains.length; ci++) {
    const c = skel.chains[ci];
    const ring = c.attach >= 0 ? [c.attach, ...c.nodes] : c.nodes.slice();
    const rBase = finalR[c.nodes[0]];
    const M = rBase > 0.05 ? 16 : rBase > 0.02 ? 11 : rBase > 0.008 ? 7 : 5;
    let frame = null;
    const base = pos.length / 3;
    for (let k = 0; k < ring.length; k++) {
      const i = ring[k];
      const a = P(ring[Math.max(0, k - 1)]), b = P(ring[Math.min(ring.length - 1, k + 1)]);
      const T = v3.norm(v3.sub(b, a));
      if (!frame) frame = v3.perp(T);
      else { frame = v3.norm(v3.sub(frame, v3.scale(T, v3.dot(frame, T)))); }
      const B = v3.cross(T, frame);
      const rNode = (k === 0 && c.attach >= 0) ? c.nodes[0] : i;
      const arc = skel.s[i] * scale;
      const isTrunk = ci === 0 ? 1 : 0;
      for (let m = 0; m <= M; m++) {
        const th = m / M * Math.PI * 2;
        const d = v3.add(v3.scale(frame, Math.cos(th)), B, Math.sin(th));
        pos.push(...P(i)); rad.push(...d); tan.push(...T);
        info.push(i, rNode, m / M, arc); flare.push(isTrunk);
      }
      if (k > 0) {
        const r0 = base + (k - 1) * (M + 1), r1 = base + k * (M + 1);
        for (let m = 0; m < M; m++) idx.push(r0 + m, r0 + m + 1, r1 + m, r0 + m + 1, r1 + m + 1, r1 + m);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aRad', new THREE.Float32BufferAttribute(rad, 3));
  g.setAttribute('aTan', new THREE.Float32BufferAttribute(tan, 3));
  g.setAttribute('aInfo', new THREE.Float32BufferAttribute(info, 4));
  g.setAttribute('aFlare', new THREE.Float32BufferAttribute(flare, 1));
  g.setIndex(idx);
  return { geometry: g, verts: pos.length / 3, tris: idx.length / 3 };
}
