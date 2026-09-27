// The protoplanetary disk: a raymarched, flared gas/dust volume (half resolution) and 220k
// Keplerian dust particles. Everything rotates with Ω(r) ∝ r^-1.5 as a pure function of t.
import * as G from './geom.js';
import { WORLD, BOKEH_VERT, BOKEH_FRAG } from './glsl.js';

export const N_DUST = 400000;
const GAS_SCALE = 1.0;          // the gas volume renders at full resolution (cheap enough)

// ------------------------------------------------------------------ polar noise texture
// u = azimuth / 2π (periodic), v = log-radius across the disk. Rotated at lookup time by the
// Keplerian phase, so differential rotation shears it into spiral streaks physically.
function makeNoise(ctx) {
  const { THREE, glsl, Pass, makeTarget } = ctx;
  const rt = makeTarget(2048, 512, { wrap: THREE.RepeatWrapping });
  const pass = new Pass(glsl.all + /* glsl */`
    in vec2 vUv; out vec4 fragColor;
    void main() {
      float th = vUv.x * TAU;
      float lr = mix(log(${G.R_IN.toFixed(3)}), log(${G.R_OUT.toFixed(3)}), vUv.y);
      vec3 p = vec3(cos(th) * 7.0, sin(th) * 7.0, lr * 15.0);
      float a = fbm(p, 5) * 0.5 + 0.5;                                       // clumps
      float b = fbm(vec3(cos(th) * 16.0, sin(th) * 16.0, lr * 62.0) + 11.0, 4) * 0.5 + 0.5;  // fine streaks
      float c = fbm(vec3(cos(th) * 3.0, sin(th) * 3.0, lr * 6.0) - 7.0, 3) * 0.5 + 0.5;     // large-scale
      float d = fbm(vec3(cos(th) * 11.0, sin(th) * 11.0, lr * 30.0) + 3.0, 4) * 0.5 + 0.5;  // vertical texture
      fragColor = vec4(a, b, c, d);
    }`);
  pass.render(ctx.renderer, rt);
  return rt;
}

// ------------------------------------------------------------------ gas volume
const GAS_FRAG = (ctx) => ctx.glsl.all + WORLD + /* glsl */`
in vec2 vUv; out vec4 fragColor;
uniform sampler2D uDepth, uNoise;
uniform mat4 uInvProj, uCamWorld;
uniform vec3 uCamPos;
uniform float uNear, uFar, uT, uPsi, uGas, uLum, uKappa, uSeed, uFlare, uNearFade;
uniform vec4 uEcho;              // ages (s) of the last four kicks: light echoes of stellar flares
vec4 polar(float r, vec3 p, float yN) {
  float th = atan(p.z, p.x);
  float u = (th - omegaK(r) * (uT - T0) + uPsi) / TAU;
  float v = log(r / R_IN) / log(R_OUT / R_IN);
  // shear the 2D pattern with height, and blend two decorrelated layers, so the flared
  // envelope does not show vertical "curtains"
  vec4 a = texture(uNoise, vec2(u + 0.018 * yN, clamp(v + 0.012 * yN, 0.002, 0.998)));
  float vb = 1.0 - abs(1.0 - fract((v + 0.31 - 0.016 * yN) * 0.5) * 2.0);     // mirrored: no clamped rows
  vec4 b = texture(uNoise, vec2(u + 0.37 - 0.021 * yN, clamp(vb, 0.002, 0.998)));
  return mix(a, b, smoothstep(-1.5, 1.5, yN) * 0.6);
}
void main() {
  vec2 ndc = vUv * 2.0 - 1.0;
  vec4 vv = uInvProj * vec4(ndc, 1.0, 1.0);
  vec3 dv = normalize(vv.xyz / vv.w);
  vec3 rd = normalize(mat3(uCamWorld) * dv);
  vec3 fwd = normalize(mat3(uCamWorld) * vec3(0.0, 0.0, -1.0));
  float zd = texture(uDepth, vUv).r;
  float sceneZ = uNear * uFar / (uFar - zd * (uFar - uNear));
  float tMax = zd >= 0.99999 ? 1e5 : sceneZ / max(dot(rd, fwd), 1e-3);
  vec3 ro = uCamPos;
  // bounding slab of the flared disk
  const float YM = 7.5;
  float t0 = 0.0, t1 = min(tMax, 160.0);
  if (abs(rd.y) > 1e-5) {
    float ta = (YM - ro.y) / rd.y, tb = (-YM - ro.y) / rd.y;
    t0 = max(t0, min(ta, tb)); t1 = min(t1, max(ta, tb));
  } else if (abs(ro.y) > YM) { t1 = -1.0; }
  vec3 L = vec3(0.0); float Tr = 1.0;
  if (t1 > t0 && uGas > 0.001) {
    float t = t0 + hash13(vec3(gl_FragCoord.xy, uSeed)) * 0.05;
    for (int i = 0; i < 128; i++) {
      if (t > t1 || Tr < 0.01) break;
      vec3 p = ro + rd * t;
      float r = length(p.xz);
      float h = diskH(r);
      float ay = abs(p.y), layer = 3.2 * h;
      float dt;
      if (ay > layer || r > R_OUT || r < R_IN * 0.85) {
        dt = max((ay - layer) / (abs(rd.y) + 0.33), 0.04 + 0.03 * r);
        t += dt; continue;
      }
      dt = min(0.42 * h / max(abs(rd.y), 0.04), 0.055 * r + 0.02);
      dt *= 0.75 + 0.5 * hash13(vec3(gl_FragCoord.xy, float(i) + uSeed));
      float sig = surfaceDensity(r) * uGas;
      float vert = exp(-0.5 * ay * ay / (h * h));
      float yN = p.y / h;
      vec4 nz = polar(r, p, yN);
      float cl = smoothstep(0.28, 0.78, nz.r);
      float clump = 0.18 + 1.7 * cl * (0.45 + 1.1 * smoothstep(0.3, 0.7, nz.b)) + 0.55 * (nz.g - 0.5) + 0.08 * (nz.a - 0.5) * yN;
      // two faint spiral arms in the outer disk (trailing, following the rotation)
      float arms = 1.0 + 0.28 * smoothstep(12.0, 22.0, r) * cos(2.0 * (atan(p.z, p.x) + uPsi - omegaK(r) * (uT - T0)) - 5.5 * log(r));
      float rho = sig * vert * max(clump, 0.05) * arms / h * mix(1.0, smoothstep(0.4, 3.5, t), uNearFade);
      // illumination: flared surfaces catch starlight, the midplane is shadowed; gap walls glow
      float lit = mix(0.5, 1.0, smoothstep(0.4, 2.0, ay / h)) + 2.2 * gapWalls(r);
      vec3 l = normalize(p);
      float ph = 0.45 + 0.55 * hgPhase(dot(l, -rd), 0.55) * 0.35;
      float echo = 0.0;
      for (int k = 0; k < 4; k++) {
        float a = uEcho[k];
        if (a >= 0.0 && a < 3.0) echo += exp(-pow((length(p) - 15.0 * a - 0.8) / (0.9 + 0.5 * a), 2.0)) * exp(-a / 1.1);
      }
      vec3 em = diskTint(r) * uLum * pow(r, -0.62) * smoothstep(1.1, 3.6, r) * lit * ph * (1.0 + 1.8 * echo + 0.4 * uFlare * exp(-r * 0.35));
      float sgt = uKappa * rho;
      float a = 1.0 - exp(-sgt * dt);
      L += Tr * em / uKappa * a;
      Tr *= 1.0 - a;
      t += dt;
    }
  }
  fragColor = vec4(L, Tr);
}`;

export class Disk {
  init(ctx) {
    const { THREE, Pass } = ctx;
    this.noise = makeNoise(ctx);
    this.half = ctx.makeTarget(ctx.W * GAS_SCALE, ctx.H * GAS_SCALE);
    this.gas = new Pass(GAS_FRAG(ctx), {
      uDepth: { value: null }, uNoise: { value: this.noise.texture },
      uInvProj: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() }, uCamPos: { value: new THREE.Vector3() },
      uNear: { value: 0.01 }, uFar: { value: 1000 }, uT: { value: 0 }, uPsi: { value: 0 }, uGas: { value: 1 }, uLum: { value: 1 },
      uKappa: { value: 0.9 }, uSeed: { value: 0 }, uFlare: { value: 0 }, uNearFade: { value: 0 }, uEcho: { value: new THREE.Vector4(-1, -1, -1, -1) },
    });
    // composite: dst = gas.rgb + dst · transmittance
    this.comp = new Pass(ctx.glsl.header + /* glsl */`
      in vec2 vUv; out vec4 fragColor; uniform sampler2D uGasTex;
      void main() { fragColor = texture(uGasTex, vUv); }`, { uGasTex: { value: this.half.texture } },
      { blending: THREE.CustomBlending, transparent: true });
    const m = this.comp.material;
    m.blendSrc = THREE.OneFactor; m.blendDst = THREE.SrcAlphaFactor; m.blendEquation = THREE.AddEquation;
    m.blendSrcAlpha = THREE.ZeroFactor; m.blendDstAlpha = THREE.OneFactor;

    // ---------------------------------------------------------------- dust
    const rng = ctx.T.mulberry32(0x4ACC);
    const aP = new Float32Array(N_DUST * 4), aQ = new Float32Array(N_DUST * 4);
    const gapAt = (r) => G.GAPS.reduce((g, [gr, w, d]) => g * (1 - d * Math.exp(-(((r - gr) / w) ** 2))), 1);
    let i = 0;
    while (i < N_DUST) {
      // p(r) ∝ Σ(r)·r with Σ ∝ r^-0.85 → sample r ∝ u^(1/1.15) then reject by gaps/taper
      const u = rng();
      const r = G.R_IN * 0.95 + (G.R_OUT - G.R_IN) * Math.pow(u, 1.35);
      const acc = gapAt(r) * Math.exp(-((r / 34) ** 4)) * (0.35 + 0.65 * Math.min(1, r / 3)) * (0.6 + 0.4 * Math.exp(-(((r - 10) / 4) ** 2)) + 0.25);
      if (rng() > acc) continue;
      const g = Math.sqrt(-2 * Math.log(Math.max(rng(), 1e-9))) * Math.cos(6.2832 * rng());
      aP[i * 4] = r; aP[i * 4 + 1] = rng() * Math.PI * 2; aP[i * 4 + 2] = g * 0.9; aP[i * 4 + 3] = rng();
      const big = rng();
      aQ[i * 4] = 0.9 + 1.4 * rng() * rng();                       // in-focus diameter (1080p px)
      aQ[i * 4 + 1] = 0.08 + 2.6 * Math.pow(rng(), 5) * (big > 0.995 ? 5 : 1);  // albedo·size: mostly faint, a few bright
      aQ[i * 4 + 2] = big > 0.985 ? 1 : 0;                            // glinting grain
      aQ[i * 4 + 3] = rng();
      i++;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N_DUST * 3), 3));
    geo.setAttribute('aP', new THREE.BufferAttribute(aP, 4));
    geo.setAttribute('aQ', new THREE.BufferAttribute(aQ, 4));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
    this.dustU = {
      uT: { value: 0 }, uPsi: { value: 0 }, uDust: { value: 1 }, uLum: { value: 1 }, uShimmer: { value: 0 }, uLocal: { value: 0 },
      uEcho: { value: new THREE.Vector4(-1, -1, -1, -1) }, uEarth: { value: new THREE.Vector3(...G.EARTH) },
      uFocus: { value: 10 }, uAperture: { value: 0 }, uPxScale: { value: ctx.H / 1080 }, uMaxCoc: { value: 90 },
      uDepth: { value: null }, uNear: { value: 0.01 }, uFar: { value: 1000 },
    };
    this.dustMat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3, uniforms: this.dustU, transparent: true, depthTest: false, depthWrite: false,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendEquation: THREE.AddEquation,
      vertexShader: ctx.glsl.hash + WORLD + BOKEH_VERT + /* glsl */`
        in vec4 aP; in vec4 aQ;
        uniform float uT, uPsi, uDust, uLum, uShimmer, uLocal;
        uniform vec4 uEcho; uniform vec3 uEarth;
        void main() {
          float r = aP.x;
          float ph = aP.y + omegaK(r) * (uT - T0);          // world orbital phase
          float th = ph - uPsi;                              // key space
          float h = diskH(r);
          float y = aP.z * h * cos(ph + aP.w * 6.2832);     // inclined orbits bob through the midplane
          vec3 p = vec3(r * cos(th), y, r * sin(th));
          vec3 l = normalize(p), v = normalize(cameraPosition - p);
          float ill = pow(r, -0.95) * smoothstep(1.6, 6.0, r) * (0.5 + 0.5 * smoothstep(0.2, 1.6, abs(y) / h)) * (1.0 + 1.5 * gapWalls(r));
          float dc = length(cameraPosition - p);
          float prox = pow(45.0 / max(dc, 0.25), 0.7);        // nearer grains are brighter
          float phase = 0.3 + 0.7 * min(hgPhase(dot(l, v), 0.6) * 0.3, 1.6);
          float echo = 0.0;
          for (int k = 0; k < 4; k++) {
            float a = uEcho[k];
            if (a >= 0.0 && a < 3.0) echo += exp(-pow((r - 15.0 * a - 0.8) / 1.1, 2.0)) * exp(-a / 1.0);
          }
          float glint = aQ.z * pow(max(0.0, sin(uT * (2.0 + 5.0 * aQ.w) + aQ.w * 40.0)), 24.0) * (6.0 + 10.0 * uShimmer);
          float shimmer = 1.0 + uShimmer * 0.5 * (0.5 + 0.5 * sin(aQ.w * 90.0 + uT * 9.0));
          // near the proto-Earth the camera is inside the dust: keep those motes (bokeh) visible
          float near = uLocal * exp(-length(p - uEarth) * 0.8);
          float E = aQ.y * uLum * ill * prox * phase * (1.0 + 1.8 * echo + glint) * shimmer * uDust * (1.0 + 1.2 * near) * (1.0 - 0.75 * uLocal * smoothstep(3.0, 0.4, dc));
          vec3 col = diskTint(r) * mix(vec3(1.0), vec3(1.05, 0.95, 0.85), aQ.w);
          emitPoint(p, col, E, aQ.x, 0.0);
        }`,
      fragmentShader: BOKEH_FRAG,
    });
    this.dust = new THREE.Points(geo, this.dustMat);
    this.dust.frustumCulled = false;
    this.dustScene = new THREE.Scene();
    this.dustScene.add(this.dust);
  }
}
