// VI lab · round 2: the "water dance" — Faraday waves and ejected droplets in the thin film of
// swash water around a booming animal's feet (after the alligator water dance: infrasonic bellowing
// vibrates the body and the water over its back erupts into a field of jumping spikes/droplets).
//
// Physics used (see docs/research/animal-realism.md §3.3):
//   · it is driven by the SAV — the ~18–20 Hz sub-audible body vibration that PRECEDES each bellow
//     (Moriarty & Holt 2011), not by the audible call; Faraday waves respond at HALF the drive:
//     9–10 Hz, λ ≈ 3 cm (≈ ⅓ of the scute spacing, matching photographs)
//   · crests pinch off droplets: alligators ~5–30 cm high (McIlhenny 1935; Vliet 1989), a caiman
//     ~75 cm; here launch 0.4–2.4 m/s → apex 0.8–30 cm, flight 0.08–0.5 s, densest at the source
//   · against the low sun each droplet is a backlit lens: a bright sun-coloured point
// Rendered as an additive overlay into the HDR target (after the creature), pure function of t.
import * as THREE from '../../../vendor/three.module.js';

const FS = /* glsl */`
precision highp float;
uniform mat4 uViewProj; uniform vec3 uCamPos; uniform mat4 uInvProj, uCamWorld;
uniform float uT, uAmp, uF0, uPx, uScale;
uniform vec4 uFeet[4];          // (x, z, radius, weight) in world metres
uniform vec3 uSunDir, uSunCol, uSkyHor;
in vec2 vUv; out vec4 fragColor;
uint h1(uint x) { x ^= x >> 16; x *= 0x7feb352du; x ^= x >> 15; x *= 0x846ca68bu; x ^= x >> 16; return x; }
float hf(uint x) { return float(h1(x)) / 4294967295.0; }
void main() {
  if (uAmp < 0.001) { fragColor = vec4(0.0); return; }
  vec4 vv = uInvProj * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
  vec3 rd = normalize(mat3(uCamWorld) * (vv.xyz / vv.w));
  vec3 col = vec3(0.0);
  // 1 · Faraday glitter on the film: a standing-wave pattern at f0/2 whose crests catch the sun
  if (rd.y < 0.0) {
    float tg = -uCamPos.y / rd.y;
    vec3 G = uCamPos + rd * tg;
    // Faraday response at half the drive: 19 Hz SAV → 9.5 Hz waves, λ ≈ 3 cm (matches photos)
    float lam = 0.03 * uScale;
    float k = 6.2832 / lam, w = 3.14159 * uF0;
    for (int i = 0; i < 4; i++) {
      vec4 F = uFeet[i];
      if (F.w <= 0.0) continue;
      vec2 d = G.xz - F.xy;
      float r = length(d);
      if (r > F.z) continue;
      float fall = (1.0 - smoothstep(0.2 * F.z, F.z, r)) * F.w;
      // two crossed standing waves (square pattern, typical of Faraday instability)
      float s = cos(k * d.x) * cos(k * d.y) * sin(w * uT);
      float glint = pow(max(s, 0.0), 6.0);
      // pixel footprint: the pattern is ~3 px at 1080p/15 m → it reads as a fine shimmering glitter
      col += (uSunCol * 0.35 + uSkyHor * 0.6) * glint * fall * uAmp * 0.9;
    }
  }
  // 2 · ejected droplets: per foot, 110 emission slots re-seeded every flight
  vec2 frag = vUv;
  for (int i = 0; i < 4; i++) {
    vec4 F = uFeet[i];
    if (F.w <= 0.0) continue;
    // screen-space bound of this foot's droplet cloud (radius F.z, up to ~0.1 m·scale high): skip
    // the 110-droplet loop for every pixel outside it
    vec4 c0 = uViewProj * vec4(F.x, 0.12, F.y, 1.0), c1 = uViewProj * vec4(F.x + F.z, 0.12, F.y, 1.0);
    if (c0.w <= 0.0) continue;
    vec2 s0 = c0.xy / c0.w * 0.5 + 0.5, s1 = c1.xy / c1.w * 0.5 + 0.5;
    float rs = length((s1 - s0) * vec2(1.7778, 1.0)) * 1.6 + 0.03;
    if (length((frag - s0) * vec2(1.7778, 1.0)) > rs) continue;
    for (int j = 0; j < 110; j++) {
      uint seed = uint(i * 977 + j * 131);
      // launch speed fixed per slot: 0.4–2.4 m/s → apex 0.8–30 cm (alligators: ~5–30 cm), most low;
      // each slot re-launches after its own flight time (never cut off mid-air)
      float v0 = (0.4 + 2.0 * pow(hf(seed + 5u), 2.2)) * sqrt(uAmp);
      float period = 2.0 * v0 / 9.81 + 0.03 + 0.1 * hf(seed + 1u);
      float cyc = (uT + period * hf(seed + 2u)) / period;
      float n = floor(cyc), tau = fract(cyc) * period;
      uint s2 = h1(seed ^ uint(n) * 2654435761u);
      float a = hf(s2) * 6.2832, rr = F.z * 0.75 * pow(hf(s2 + 3u), 1.7);
      float y = v0 * tau - 4.905 * tau * tau;
      if (y < 0.0) continue;
      if (hf(s2 + 7u) > uAmp * F.w * (1.0 - rr / F.z)) continue;   // threshold: density follows drive
      vec3 P = vec3(F.x + cos(a) * rr, y, F.y + sin(a) * rr * 0.6);
      vec4 c = uViewProj * vec4(P, 1.0);
      if (c.w <= 0.0) continue;
      vec2 sp = c.xy / c.w * 0.5 + 0.5;
      // motion streak (1/60 s exposure) along the droplet's screen velocity
      vec4 c2 = uViewProj * vec4(P + vec3(0.0, (v0 - 9.81 * tau) / 60.0, 0.0), 1.0);
      vec2 sp2 = c2.xy / c2.w * 0.5 + 0.5;
      vec2 ab = sp2 - sp, pa = frag - sp;
      float hh = clamp(dot(pa, ab) / max(dot(ab, ab), 1e-12), 0.0, 1.0);
      vec2 dd = (pa - ab * hh) / vec2(uPx * 1.7778, uPx);
      float d2 = dot(dd, dd);
      float size = 0.9 + 0.8 * hf(s2 + 9u);
      col += (uSunCol * 1.6 + vec3(0.3)) * exp(-d2 / (size * size)) * 0.9;
    }
  }
  fragColor = vec4(col, 1.0);
}`;
const VS = 'precision highp float; in vec3 position; out vec2 vUv; void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }';

/** makeWaterDance(ctx, G) → { render(renderer, target, cam, { t, amp, feet: [[x, z], …], f0, H, radius, scale }) } */
export function makeWaterDance(ctx, G) {
  const U = {
    uViewProj: { value: new THREE.Matrix4() }, uCamPos: { value: new THREE.Vector3() }, uInvProj: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() },
    uT: { value: 0 }, uAmp: { value: 0 }, uF0: { value: 29 }, uPx: { value: 1 / 1080 }, uScale: { value: 1 },
    uFeet: { value: [0, 1, 2, 3].map(() => new THREE.Vector4()) }, uSunDir: G.uSunDir, uSunCol: G.uSunCol, uSkyHor: G.uSkyHor,
  };
  const mat = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: VS, fragmentShader: FS, uniforms: U, depthTest: false, depthWrite: false, transparent: true, blending: THREE.AdditiveBlending });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false;
  const scene = new THREE.Scene(); scene.add(mesh);
  const ocam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  return {
    render(renderer, target, cam, o) {
      U.uViewProj.value.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
      U.uCamPos.value.copy(cam.position); U.uInvProj.value.copy(cam.projectionMatrixInverse); U.uCamWorld.value.copy(cam.matrixWorld);
      U.uT.value = o.t; U.uAmp.value = o.amp; U.uF0.value = o.f0 ?? 29; U.uPx.value = 2 * Math.tan(cam.fov * Math.PI / 360) / o.H * 0.5 / Math.tan(cam.fov * Math.PI / 360); U.uScale.value = o.scale ?? 1;
      U.uPx.value = 1 / o.H;
      for (let i = 0; i < 4; i++) { const f = o.feet[i]; if (f) U.uFeet.value[i].set(f[0], f[1], o.radius ?? 1.1, 1); else U.uFeet.value[i].set(0, 0, 1, 0); }
      const ac = renderer.autoClear; renderer.autoClear = false;
      renderer.setRenderTarget(target); renderer.render(scene, ocam);
      renderer.autoClear = ac;
    },
  };
}
