// V · PALE BLUE: the local renderer (100.36 → 102.0), in metres, Y up, heading -Z.
// It takes over inside the cloud-deck whiteout from the planet renderer.
//   sky + aerial perspective: the SAME atmosphere model as the planet (the local frame maps
//     to planet units with M2R, planet centre below, uSun = sun in the local frame)
//   CLOUD_FRAG (half res): a volumetric cumulus slab (900–1700 m), raymarched with a short
//     light march toward the sun, Beer-powder + dual-lobe HG; outputs (in-scatter, transmittance)
//   LOCAL_FRAG: ocean = sum of 28 deep-water sine waves (ω = √(gk)), each filtered against the
//     pixel footprint; the unresolved slope variance is folded into GGX roughness, so the glitter
//     stays sparkly up close and turns into a smooth glint lobe at distance without aliasing.
import { ATMO_CONST, ATMO_FUNCS } from './atmo.js';
import { COMMON } from './planet.js';

const LOCAL_COMMON = /* glsl */`
uniform vec3 uLocR, uLocU, uLocF, uSunL;
uniform float uTanHalf, uAspect, uTime, uAlt, uAlong, uWeight, uSplash, uGlitter, uVeil;
uniform vec2 uRes;

const float SLAB0 = 1000.0, SLAB1 = 2800.0;   // cumulus congestus deck

vec3 camRay(vec2 uv) {
  vec2 ndc = uv * 2.0 - 1.0;
  return normalize(uLocF + ndc.x * uAspect * uTanHalf * uLocR + ndc.y * uTanHalf * uLocU);
}
vec3 camPos() { return vec3(0.0, uAlt, -uAlong); }
vec3 toPlanet(vec3 pm) { return vec3(pm.x * M2R, 1.0 + max(pm.y, 0.0) * M2R, pm.z * M2R); }

uniform sampler2D uCov;           // deckCovP baked over ±COV_EXT metres (init)
const float COV_EXT = 25000.0;
// 2D coverage of the deck (broken, ~55%), with a cluster of towers around the descent path.
float deckCovP(vec2 xz) {
  vec2 w = xz / 5200.0;
  float c = fbmL(vec3(w, 3.7), 4.0);
  c += 0.35 * fbmL(vec3(xz / 1300.0, 9.1), 3.0);
  vec2 dp = (xz - vec2(0.0, -80.0)) / 1700.0;
  c += 0.55 * exp(-dot(dp, dp));
  return smoothstep(-0.18, 0.32, c);
}
float deckCov(vec2 xz) {
  vec2 uv = xz / (2.0 * COV_EXT) + 0.5;
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return deckCovP(xz);
  return texture(uCov, uv).r;
}
// The descent path through the deck (x = 0; z drifts with the heading speed) and the
// large-scale structure we fly through: a tower top (the brief whiteout that hides the
// renderer switch), a sunlit canyon between towers (wisps, shafts), a thin dark base layer.
vec2 pathXZ(float y) { return vec2(0.0, -(2650.0 - y) * 0.0925); }
vec4 pathShape(vec3 p) {
  float r = length(p.xz - pathXZ(p.y));
  float cap = exp(-pow(r / 600.0, 2.0) - pow((p.y - 2480.0) / 300.0, 2.0));
  float canyon = exp(-pow(r / 700.0, 4.0)) * smoothstep(1130.0, 1260.0, p.y) * (1.0 - smoothstep(2020.0, 2180.0, p.y));
  float baseL = smoothstep(1000.0, 1050.0, p.y) * (1.0 - smoothstep(1130.0, 1210.0, p.y)) * exp(-pow(r / 3000.0, 2.0))
              * smoothstep(-0.25, 0.35, snoise(vec3(p.xz / 380.0, 4.2)));   // broken: the sea shows through
  return vec4(cap, canyon, baseL, r);
}
float profile(float h, float cov) { return smoothstep(0.0, 0.18, h) * (1.0 - smoothstep(0.3 + 0.65 * cov, 1.0, h)); }
float cloudDensity(vec3 p, float lod) {
  float h = (p.y - SLAB0) / (SLAB1 - SLAB0);
  if (h < 0.0 || h > 1.0) return 0.0;
  float cov = deckCov(p.xz);
  vec4 ps = pathShape(p);
  float base = max(cov * profile(h, cov), ps.x) + 0.6 * ps.z;
  base *= 1.0 - 0.92 * ps.y;
  // wisps drifting inside the canyon
  float wisp = ps.y * smoothstep(0.3, 0.8, snoise(p / vec3(75.0, 380.0, 75.0) + vec3(0.0, uTime * 0.3, 0.0)));   // vertical streamers
  base += 0.62 * wisp;
  if (base < 0.02) return 0.0;
  vec3 q = p / 420.0 + vec3(uTime * 0.02, -uTime * 0.01, 0.0);
  float det = fbmL(q, lod);
  det -= 0.3 * (1.0 - smoothstep(0.0, 0.14, h)) * (0.5 + 0.5 * snoise(p / 90.0));   // ragged base
  float d = base - (0.42 - 0.34 * det) * (1.0 - 0.35 * base);
  return max(d, 0.0) * 0.022;
}
// Noise-free density proxy: the towers' large-scale shadows (crepuscular shafts), one lookup.
float coarseDensity(vec3 p) {
  float h = (p.y - SLAB0) / (SLAB1 - SLAB0);
  if (h < 0.0 || h > 1.0) return 0.0;
  float cov = deckCov(p.xz);
  vec4 ps = pathShape(p);
  float base = (max(cov * profile(h, cov), ps.x) + 0.6 * ps.z) * (1.0 - 0.92 * ps.y);
  return max(base - 0.3, 0.0) * 0.012;
}
float sunVisFar(vec3 p, float start) {
  float od = 0.0, ls = start;
  for (int j = 0; j < 4; j++) { od += coarseDensity(p + uSunL * ls * (float(j) + 0.5)) * ls; ls *= 2.0; }
  return exp(-od * 1.4);
}
`;

export const COV_FRAG = (glsl) => glsl.all + ATMO_CONST + ATMO_FUNCS + COMMON + LOCAL_COMMON + /* glsl */`
in vec2 vUv; out vec4 fragColor;
void main() { fragColor = vec4(deckCovP((vUv - 0.5) * 2.0 * COV_EXT), 0.0, 0.0, 1.0); }`;

export const CLOUD_FRAG = (glsl) => glsl.all + ATMO_CONST + ATMO_FUNCS + COMMON + LOCAL_COMMON + /* glsl */`
in vec2 vUv; out vec4 fragColor;
float hg(float c, float g) { float g2 = g * g; return 0.0795775 * (1.0 - g2) / pow(max(1.0 + g2 - 2.0 * g * c, 1e-4), 1.5); }
void main() {
  vec3 ro = camPos(), rd = camRay(vUv);
  // segment inside the slab, clipped by the ocean
  float tSea = rd.y < 0.0 ? -ro.y / rd.y : 1e9;
  float ta, tb;
  if (abs(rd.y) < 1e-5) { ta = 0.0; tb = 1e9; if (ro.y < SLAB0 || ro.y > SLAB1) tb = -1.0; }
  else {
    float t0 = (SLAB0 - ro.y) / rd.y, t1 = (SLAB1 - ro.y) / rd.y;
    ta = max(min(t0, t1), 0.0); tb = max(t0, t1);
  }
  tb = min(tb, tSea);
  vec3 S = vec3(0.0); float Tr = 1.0;
  if (tb > ta) {
    float far = min(tb, ta + 5000.0);
    const int N = 40;
    // interleaved gradient noise: a smoother dither than white noise after the 2x upsample
    // (offset by the frame index: a pure function of t, reads as fine grain instead of a static screen)
    float jit = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))) + 0.61803399 * floor(uTime * 60.0 + 0.5));
    float span = far - ta;
    vec3 Ts = sunTrans(vec3(0.0, 1.0 + 1300.0 * M2R, 0.0));
    vec3 sunC = uSunI * Ts;
    float c = dot(rd, uSunL);
    float ph = mix(hg(c, 0.62), hg(c, -0.18), 0.35) * 4.0 * PI;
    float phA = mix(hg(c, 0.72), 0.0795775, 0.4) * 4.0 * PI;      // haze in the gaps
    const float SIG_AIR = 1.0 / 15000.0;
    for (int i = 0; i < N; i++) {
      // quadratic spacing: fine steps near the camera resolve the wisps rushing past
      float u0 = float(i) / float(N), u1 = (float(i) + 1.0) / float(N);
      float t0s = ta + span * u0 * u0, t1s = ta + span * u1 * u1;
      float dt = t1s - t0s;
      float t = t0s + jit * dt;
      vec3 p = ro + rd * t;
      float lod = clamp(5.2 - log2(1.0 + t / 200.0), 2.0, 5.2);
      float d = cloudDensity(p, lod);
      if (d <= 0.0) {
        // clear air between the towers: sunlight shafts through the gaps (crepuscular rays)
        float vis = sunVisFar(p, 60.0);
        S += Tr * (sunC * vis * phA + uSunI * vec3(0.05, 0.07, 0.1)) * SIG_AIR * dt;
        continue;
      }
      // light: fine self-shadowing (noise) + the towers' large-scale shadows
      float od = 0.0; float ls = 40.0;
      for (int j = 0; j < 2; j++) { od += cloudDensity(p + uSunL * ls * (float(j) + 0.5), 2.0) * ls; ls *= 2.5; }
      float vfar = sunVisFar(p, 260.0);
      float beer = exp(-od * 1.6) * vfar;
      float msc = 0.35 * exp(-od * 0.4) * (0.4 + 0.6 * vfar);          // 2nd scattering octave
      float powder = 1.0 - exp(-d * 90.0);
      float hh = (p.y - SLAB0) / (SLAB1 - SLAB0);
      vec3 amb = uSunI * (vec3(0.16, 0.2, 0.28) * (0.15 + 0.85 * hh) * (0.35 + 0.65 * vfar) + vec3(0.018, 0.022, 0.03));
      amb += uSunI * vec3(0.78, 0.8, 0.84) * 0.42 * hh * hh * hh;     // multiply-scattered glow: bright tops, dark bases
      vec3 Lsc = sunC * (beer * ph + msc) * mix(0.55, 1.0, powder) + amb;
      float a = exp(-d * dt);
      S += Tr * Lsc * (1.0 - a) * 0.93;
      Tr *= a;
      if (Tr < 0.02) break;
    }
    // beyond the march budget, a horizontal ray inside the slab is solid cloud
    if (tb > far) { vec3 fogC = uSunI * vec3(0.78, 0.8, 0.84); S += Tr * fogC * (1.0 - exp(-(tb - far) / 1500.0)); Tr *= exp(-(tb - far) / 1500.0); }
  }
  // aerial perspective: distant cloud dissolves into the haze (also hides the edge-on slab rim)
  float fade = exp(-max(ta, 0.0) / 14000.0);
  S *= fade; Tr = mix(1.0, Tr, fade);
  fragColor = vec4(S, Tr);
}`;

export const LOCAL_FRAG = (glsl) => glsl.all + ATMO_CONST + ATMO_FUNCS + COMMON + LOCAL_COMMON + /* glsl */`
in vec2 vUv; out vec4 fragColor;
uniform sampler2D uClouds;

vec3 skyRad(vec3 ro, vec3 rd, int N) {
  vec3 rp = toPlanet(ro);
  vec2 ta = sphIntersect(rp, rd, vec3(0.0), RT);
  float t1 = max(ta.y, 0.0);
  vec3 S, Tr, SS, TS;
  atmoMarch(rp, rd, 0.0, t1, 1e9, N, 2.0, S, Tr, SS, TS);
  // the sun disc, if it is ever in view
  float sd = dot(rd, uSunL);
  S += Tr * vec3(1.0, 0.96, 0.9) * 40.0 * smoothstep(0.99996, 0.99999, sd);
  return S;
}

vec2 waveSlope(vec2 x, float fp, float tt, out float lost) {
  // 40 deep-water waves, jittered wavelengths and directions (no lattice), each filtered
  // against the footprint; plus a noise chop octave. Unresolved slope variance → roughness.
  vec2 g = vec2(0.0); lost = 0.0;
  float lambda = 140.0;
  // bend the crests (short-crested sea): low-frequency domain warp
  x += 18.0 * vec2(snoise(vec3(x / 260.0, 1.3)), snoise(vec3(x / 260.0 + 7.1, 4.2)));
  x += 3.0 * vec2(snoise(vec3(x / 37.0, 2.1)), snoise(vec3(x / 37.0 - 3.3, 5.7)));
  const float windAng = 0.35;
  for (int i = 0; i < 40; i++) {
    float fi = float(i);
    vec3 h = hash33(vec3(fi, 3.7, 11.3));
    float ang = windAng + (h.x - 0.5) * 3.0 * (0.3 + 0.7 * fi / 40.0);
    vec2 d = vec2(cos(ang), sin(ang));
    float lam = lambda * (0.8 + 0.4 * h.y);
    float k = 6.2831853 / lam;
    float w = sqrt(9.81 * k);
    float steep = 0.03 * (0.6 + 0.8 * h.z);
    float filt = smoothstep(1.6 * fp, 4.5 * fp, lam);
    g += d * steep * filt * cos(dot(d, x) * k - w * tt + h.z * 6.2831853 + 3.0 * h.x);
    lost += 0.5 * steep * steep * (1.0 - filt * filt);
    lambda *= 0.86;
  }
  // chop: noise gradient at ~0.6 m, only where resolved
  float cf = smoothstep(0.08, 0.02, fp);
  if (cf > 0.0) {
    vec3 q = vec3(x * 1.6, tt * 0.9);
    float e = 0.15;
    float n0 = snoise(q), nx = snoise(q + vec3(e, 0.0, 0.0)), nz = snoise(q + vec3(0.0, e, 0.0));
    g += cf * 0.06 * vec2(nx - n0, nz - n0) / e / 1.6;
  }
  lost += 0.5 * 0.06 * 0.06 * (1.0 - cf);
  return g;
}

void main() {
  vec3 ro = camPos(), rd = camRay(vUv);
  float pixAng = 2.0 * uTanHalf / uRes.y;
  vec3 L = uSunL;
  vec3 col;
  float horizonDip = -sqrt(2.0 * max(uAlt, 1.0) * M2R);
  if (rd.y >= horizonDip * 0.5 || rd.y >= -1e-4) {
    col = skyRad(ro, rd, 22);
  } else {
    float t = -ro.y / rd.y;
    vec3 p = ro + rd * t;
    float fp = t * pixAng / max(-rd.y, 0.035);
    float lost;
    vec2 g = waveSlope(p.xz, fp, uTime, lost);
    vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
    vec3 V = -rd;
    if (dot(n, V) < 0.02) n = normalize(n + V * (0.02 - dot(n, V)));
    float a = sqrt(0.02 * 0.02 + 2.0 * lost);
    vec3 H = normalize(V + L);
    float NoL = max(dot(n, L), 0.0), NoV = max(dot(n, V), 1e-3), NoH = max(dot(n, H), 0.0);
    float F = fresnelW(dot(V, H));
    float spec = D_GGX(NoH, a) * V_Smith(NoV, NoL, a) * F * NoL;
    vec3 Ts = sunTrans(vec3(0.0, 1.0, 0.0));
    // cloud shadow from the deck (2D coverage along the sun ray at mid-slab)
    vec3 ps = p + L * ((SLAB0 + SLAB1) * 0.5 / max(L.y, 0.05));
    float sh = 1.0 - 0.85 * smoothstep(0.1, 0.8, deckCov(ps.xz));   // baked lookup (procedural beyond ±25 km)
    vec3 R = reflect(rd, n); R.y = abs(R.y) + 0.01; R = normalize(R);
    float Fv = fresnelW(NoV);
    vec3 skyR = skyRad(vec3(p.x, 1.0, p.z), R, 10);
    vec3 skyAmb = uSunI * vec3(0.05, 0.09, 0.16);
    vec3 body = vec3(0.003, 0.016, 0.045) * (uSunI * Ts * L.y * sh + skyAmb);
    // light through the backs of wave crests (subsurface): turquoise where slopes face the sun
    float sss = pow(clamp(dot(rd.xz, L.xz) * 0.5 + 0.5, 0.0, 1.0), 3.0) * clamp(dot(g, normalize(L.xz)) * 6.0, 0.0, 1.0);
    body += vec3(0.0, 0.022, 0.024) * sss * uSunI * Ts * sh;
    col = Fv * skyR * mix(1.0, 0.8, 1.0 - sh) + (1.0 - Fv) * body + PI * uSunI * Ts * spec * sh * (1.0 + 0.5 * uGlitter);
    // aerial perspective
    vec3 S, Tr, SS, TS;
    atmoMarch(toPlanet(ro), rd, 0.0, t * M2R, 1e9, 10, 1.0, S, Tr, SS, TS);
    col = col * Tr + S;
  }
  // half-res volumetrics: soft 4-tap upsample hides the march dither
  vec2 hx = 1.5 / uRes;                   // ≈ 0.75 half-res texel
  vec4 cl = 0.25 * (texture(uClouds, vUv + vec2(hx.x, hx.y)) + texture(uClouds, vUv + vec2(-hx.x, hx.y))
                  + texture(uClouds, vUv + vec2(hx.x, -hx.y)) + texture(uClouds, vUv - hx));
  col = col * cl.a + cl.rgb;
  // the last of the cloud base lifts smoothly off the lens
  col = mix(col, uSunI * vec3(0.70, 0.74, 0.80), uVeil);
  // the plunge: the splash crown rises around the lens (foam closes in from the frame edges)
  // while spray droplets streak outward past the camera
  if (uSplash > 0.0) {
    vec2 q = (vUv * 2.0 - 1.0) * vec2(uAspect, 1.0);
    float r = length(q * vec2(0.8, 1.0)), ang = atan(q.y, q.x);
    float n = fbm(vec3(q * 2.6, uTime * 4.0), 5) * 0.5 + 0.5;
    float n2 = fbm(vec3(q * 9.0, uTime * 6.0 + 3.0), 3) * 0.5 + 0.5;
    float front = mix(2.3, 1.2, uSplash);     // closes only to the periphery: the full white is the 102.000 flash
    float foam = smoothstep(front - 0.05, front + 0.45, r + 0.9 * (n - 0.5));
    foam *= 0.55 + 0.45 * smoothstep(0.3, 0.7, n2);
    vec3 foamC = mix(vec3(0.35, 0.55, 0.62), vec3(1.0, 1.02, 1.05), n2) * uSunI * (0.8 + 0.5 * n);
    col = mix(col, foamC, clamp(foam, 0.0, 1.0) * 0.85);
    // spray mist: the air fills with thrown-up droplets as the surface arrives
    col = mix(col, vec3(0.75, 0.88, 0.95) * uSunI * (0.8 + 0.4 * n), 0.12 * uSplash);
    float cells = 70.0;
    float ca = floor(ang / 6.2831853 * cells);
    vec3 h = hash33(vec3(ca, 1.0, 7.0));
    float aC = (ca + 0.5 + 0.7 * (h.x - 0.5)) / cells * 6.2831853;
    float da = abs(mod(ang - aC + 3.14159, 6.2831853) - 3.14159) * r;
    float sp = smoothstep(0.35, 1.0, uSplash);
    float head = 0.35 + (1.2 + 1.4 * h.y) * sp;
    float len = 0.03 + 0.22 * h.z * sp;
    float along = smoothstep(head - len, head, r) * (1.0 - smoothstep(head, head + 0.006, r));
    float w = 0.0012 + 0.0022 * h.z;
    float drop = along * exp(-da * da / (w * w)) * step(0.62, h.y) * (1.0 - foam) * step(0.001, sp);
    col += vec3(0.85, 0.95, 1.0) * drop * 1.6 * uSunI;
  }
  fragColor = vec4(col, uWeight);
}`;
