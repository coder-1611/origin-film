// ch3/shaders.js: GLSL for FIRST LIGHT. All passes take the camera as a double-precision basis
// computed in JS (right/up/fwd, tan(fov/2)); the nebula passes get the camera origin already
// expressed in nebula units relative to the nebula centre, so no float cancellation happens.
export const MAXL = 18;      // nebula point lights (stars born inside the nebula)
export const MAXB = 24;      // analytic stars in the composite (births + Sun)

const COMMON = /* glsl */`
precision highp sampler3D;
uniform vec3 camR, camU, camF; uniform float tanHalf, aspect;
vec3 rayDir(vec2 ndc) { return normalize(camF + ndc.x * aspect * tanHalf * camR + ndc.y * tanHalf * camU); }
float ign(vec2 p) { return hash12(p + 0.5); }
`;

// Nebula density: shared by the raymarch and the per-star extinction pass. Units: NU (radius 10).
const NEB_DENSITY = /* glsl */`
uniform sampler3D noiseTex;
uniform sampler2D hTex;               // cliff/pillar height field over (x, z): r = base, g = pillar
uniform float nebSeed, cliffY, dustAmt, gasAmt, sheetP, filK, cavR, pillarH;
uniform vec3 cavC;
float gFp;                                     // pixel footprint (NU) at the current sample
vec4 N3(vec3 q, float s) { return textureLod(noiseTex, q * s, max(0.0, log2(gFp * s * 128.0 + 1e-6))); }
// gas: sheets, filaments and billowy banks (emitting); dust: cliff, pillars and wisps (absorbing).
// The fine octaves are only fetched where the coarse field says something could be there.
float gCliff;                                  // the cliff/pillar part of the dust (for rim light)
void nebDensity(vec3 p, out float gas, out float dust, out float ox) {
  gas = 0.0; dust = 0.0; ox = 0.5; gCliff = 0.0;
  vec4 w = N3(p + vec3(21.8, 6.5, 42.9), 0.017);
  vec3 pw = p + (w.xyz - 0.5) * 7.0;
  vec4 a = N3(pw + vec3(2.3, 4.7, 7.0), 0.043);
  float r = length(p);
  float env = smoothstep(10.3, 3.0, r + (w.w - 0.5) * 9.0 + (a.b - 0.5) * 5.0);
  if (env < 0.002) return;
  vec4 b = N3(pw + vec3(4.2, 0.8, 5.8), 0.12);
  vec4 c = N3(pw + vec3(0.6, 2.6, 1.3), 0.31);
  ox = b.a;
  float cav = length(p - cavC) - cavR * (0.62 + 0.8 * a.g + 0.35 * (b.g - 0.5) + 0.3 * (w.z - 0.5));
  float inside = smoothstep(0.6, -1.4, cav);
  float shell = exp(-cav * cav / (0.35 + 0.25 * cavR)) * step(0.001, cavR) * smoothstep(0.3, 0.55, b.g + (w.y - 0.5) * 0.8);
  float tb0 = abs(a.r * 2.0 - 1.0) + 0.6 * abs(b.r * 2.0 - 1.0) + 0.42 * abs(c.r * 2.0 - 1.0);
  float bill0 = a.g * 0.55 + b.g * 0.3 + c.g * 0.2 + (w.y - 0.5) * 0.35;
  vec2 hh = textureLod(hTex, p.xz / 22.0 + 0.5, 0.0).rg;
  float h0 = cliffY + hh.r + pillarH * hh.g + 0.9 * (c.g - 0.5);
  float tb20 = abs(b.b * 2.0 - 1.0) + 0.55 * abs(c.b * 2.0 - 1.0);
  bool fine = (tb0 * filK < 1.0 || bill0 > 0.5 || h0 - p.y > -0.45 || (tb20 * 1.7 < 1.0 && a.a > 0.45));
  vec4 e = vec4(0.5), f = vec4(0.5);
  if (fine) {
    vec3 pf = pw + (b.xyz - 0.5) * 0.9;
    e = N3(pf + vec3(0.8, 0.4, 1.1), 0.83);
    f = N3(pf + vec3(0.43, 0.29, 0.05), 2.1);
  }
  // turbulence Σ|noise| over five scales: crisp creases → filaments and sheets at every scale
  float tb = tb0 + 0.3 * abs(e.r * 2.0 - 1.0) + 0.2 * abs(f.r * 2.0 - 1.0);
  float fil = pow(max(0.0, 1.0 - tb * filK), sheetP);
  // billowy cloud banks with crisp cell edges (Worley), eroded by fine turbulence
  float puff = smoothstep(0.62, 0.72, bill0 + e.g * 0.12 - (1.0 - f.g) * 0.1);
  float body = (fil * 2.4 + puff * 1.1) * (1.0 - 0.985 * inside) + shell * (0.4 + 2.4 * fil + 1.2 * puff);
  gas = env * (body + 0.015 * (1.0 - 0.8 * inside)) * gasAmt;
  // dust cliff: a height field over (x, z) so columns stand upright; billowy skins
  float h = h0 + 0.45 * (e.g - 0.5) + 0.18 * (f.g - 0.5);
  float cliff = smoothstep(-0.2, 0.45, h - p.y);
  float tb2 = tb20 + 0.35 * abs(e.b * 2.0 - 1.0);
  float wisp = pow(max(0.0, 1.0 - tb2 * 1.7), 4.0) * smoothstep(0.45, 0.62, a.a) * (1.0 - 0.85 * inside);
  gCliff = env * cliff * (0.8 + 0.8 * c.r) * 2.4 * dustAmt;
  dust = gCliff + env * wisp * 3.0 * dustAmt;
}
`;
// Bakes the (x, z) height field for the dust cliff and its pillars.
export const HEIGHT = (glsl) => glsl.header + /* glsl */`
precision highp sampler3D;
in vec2 vUv; out vec4 fragColor;
uniform sampler3D noiseTex;
void main() {
  vec2 xz = (vUv - 0.5) * 22.0;
  vec4 hA = texture(noiseTex, vec3(xz.x * 0.036 + 0.61, 0.23, xz.y * 0.036 + 0.17));
  vec4 hB = texture(noiseTex, vec3(xz.x * 0.085 + 0.13, 0.71, xz.y * 0.085 + 0.44));
  float col = smoothstep(0.66, 0.74, hA.g * 0.55 + hB.g * 0.55);
  fragColor = vec4(1.6 * (hA.r - 0.5), col * (0.75 + 0.5 * hB.r), 0.0, 1.0);
}`;

// ---------------------------------------------------------------- light volume (80³, per frame)
// Flux from every newborn star (with its growing reach and light-echo shell), the high-ionisation
// inner-zone flux (drives O-III) and the wind-cavity carve factor, baked once per frame so the march
// pays one trilinear fetch per step instead of a loop over all lights.
export const LIGHTVOL = (glsl) => glsl.header + /* glsl */`
in vec2 vUv; out vec4 fragColor;
uniform float zSlice, res, halfExt;
uniform int nL;
uniform vec3 lPos[${MAXL}];
uniform vec4 lPar[${MAXL}];
uniform float o3r;
void main() {
  vec3 p = (vec3(gl_FragCoord.xy, zSlice + 0.5) / res * 2.0 - 1.0) * halfExt;
  float F = 0.0, F2 = 0.0, carve = 1.0;
  for (int k = 0; k < ${MAXL}; k++) {
    if (k >= nL) break;
    vec3 v = lPos[k] - p; float r2 = dot(v, v), r = sqrt(r2);
    vec4 L = lPar[k];
    float reach = exp(-r / max(L.y, 0.05));
    float sh = L.w * exp(-(r - 1.3 * L.y) * (r - 1.3 * L.y) * 1.2);
    float fk = L.x * (reach + sh) / (r2 + 0.5);
    F += fk;
    F2 += fk * exp(-r / max(L.y * o3r, 0.05));
    carve *= smoothstep(L.z * 0.35, L.z, r);
  }
  fragColor = vec4(F, F2, carve, 1.0);
}`;

// ---------------------------------------------------------------- nebula raymarch (half res, MRT)
export const NEBULA = (glsl) => glsl.header + glsl.math + glsl.hash + COMMON + NEB_DENSITY + /* glsl */`
in vec2 vUv;
layout(location = 0) out vec4 o0;     // emission rgb, total transmittance
layout(location = 1) out vec4 o1;     // transmittance at 1/4, 1/2, 3/4, 1 of the chord
uniform vec3 camN;                    // camera origin, nebula units relative to the nebula centre
uniform vec2 res;
uniform float pxAng;                  // radians per half-res pixel
uniform sampler3D lightTex;           // baked flux (r), inner-zone flux (g), cavity carve (b)
const float LV_HALF = 11.0;
uniform float amb, gain, o3bias, shimmer, t, dustS, gasS, rimK, o3K, nearClip, o3lo, o3hi, fmax, o3r, haloK;
const int STEPS = 96;
uniform int nSteps;
void main() {
  vec2 ndc = vUv * 2.0 - 1.0;
  vec3 rd = rayDir(ndc);
  vec2 hit = sphIntersect(camN, rd, vec3(0.0), 10.5);
  o0 = vec4(0.0, 0.0, 0.0, 1.0); o1 = vec4(1.0);
  if (hit.y <= 0.0) return;
  float t0 = max(hit.x, 0.0), t1 = hit.y;
  // ordered (4×4 Bayer) depth jitter: the 5×5 denoise then averages all 16 phases
  ivec2 bq = ivec2(gl_FragCoord.xy) & 3;
  const float BAYER[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
  float jit = (BAYER[bq.y * 4 + bq.x] + 0.5) / 16.0;
  float tt = t0;
  float T = 1.0; vec3 C = vec3(0.0);
  vec4 prof = vec4(-1.0);
  const vec3 HA = vec3(1.0, 0.055, 0.11);
  const vec3 O3 = vec3(0.0, 0.62, 0.58);
  for (int i = 0; i < STEPS; i++) {
    if (i >= nSteps) break;
    float u0 = float(i) / float(nSteps), u1 = float(i + 1) / float(nSteps);
    float sa = t0 + (t1 - t0) * u0 * u0 * (1.35 - 0.35 * u0), sb = t0 + (t1 - t0) * u1 * u1 * (1.35 - 0.35 * u1);
    sa = mix(sa, t0 + (t1 - t0) * u0, 0.35); sb = mix(sb, t0 + (t1 - t0) * u1, 0.35);
    float ds = sb - sa;
    tt = sa + ds * jit;
    vec3 p = camN + rd * tt;
    gFp = tt * pxAng;
    float gas, dust, ox; nebDensity(p, gas, dust, ox);
    float nearF = smoothstep(0.4, nearClip, tt);
    gas *= nearF; dust *= nearF;
    vec3 lv = textureLod(lightTex, p / (2.0 * LV_HALF) + 0.5, 0.0).rgb;
    float F = lv.r, F2 = lv.g, carve = lv.b;
    float g = gas * carve, d = dust * mix(1.0, carve, 0.9);
    float Fs = F / (1.0 + F / fmax);
    float o3w = smoothstep(o3lo, o3hi, (F2 / (F + 1e-4)) * clamp(0.3 + 1.2 * ox + o3bias, 0.0, 2.0));
    float fl = Fs * (1.0 + shimmer * (ox - 0.5));
    float gg = g * g / (g + 0.6);                                 // recombination ∝ n²
    vec3 em = gg * fl * (HA * 1.25 * (1.0 - 0.95 * o3w) + O3 * o3w * o3K) * gain;
    em += g * amb * HA;
    em += HA * haloK * smoothstep(10.5, 3.5, length(p) + (ox - 0.5) * 5.0) * (0.4 + 0.6 * ox) * gain;
    float dc = gCliff * nearF * mix(1.0, carve, 0.9);
    float rim = dc * exp(-dc * 2.2);
    em += rim * fl * vec3(1.0, 0.36, 0.2) * rimK * gain;
    em += d * fl * vec3(0.5, 0.62, 1.0) * 0.025 * gain;
    float sig = g * gasS + d * dustS;
    float a = exp(-sig * ds);
    C += T * em * (1.0 - a) / max(sig, 1e-4);
    T *= a;
    float f = (tt - t0) / (t1 - t0);
    if (f <= 0.25) prof.x = T;
    if (f <= 0.5) prof.y = T;
    if (f <= 0.75) prof.z = T;
    if (T < 0.004) break;
  }
  if (prof.x < 0.0) prof.x = T;
  if (prof.y < 0.0) prof.y = T;
  if (prof.z < 0.0) prof.z = T;
  o0 = vec4(C, T);
  o1 = vec4(prof.xyz, T);
}`;

// ---------------------------------------------------------------- denoise (half res)
// A small Gaussian over the march output: the per-pixel depth jitter trades banding for fine noise,
// and this takes the noise back out before the upsample.
export const DENOISE = (glsl) => glsl.header + /* glsl */`
in vec2 vUv; out vec4 fragColor;
uniform sampler2D src; uniform vec2 texel; uniform float sigma;
void main() {
  vec4 acc = vec4(0.0); float wsum = 0.0;
  for (int j = -2; j <= 2; j++) for (int i = -2; i <= 2; i++) {
    float w = exp(-float(i * i + j * j) / (2.0 * sigma * sigma));
    acc += texture(src, vUv + vec2(i, j) * texel) * w; wsum += w;
  }
  fragColor = acc / wsum;
}`;

// ---------------------------------------------------------------- per-star extinction (MAXB × 1)
export const EXTINCTION = (glsl) => glsl.header + glsl.math + glsl.hash + COMMON + NEB_DENSITY + /* glsl */`
in vec2 vUv; out vec4 fragColor;
uniform vec3 camN;
uniform vec3 sN[${MAXB}];     // star positions, nebula units
uniform int nS;
uniform float dustS, gasS;
void main() {
  int k = int(gl_FragCoord.x);
  if (k >= nS) { fragColor = vec4(1.0); return; }
  vec3 to = sN[k] - camN; float len = length(to); vec3 rd = to / max(len, 1e-6);
  vec2 hit = sphIntersect(camN, rd, vec3(0.0), 10.5);
  float tau = 0.0;
  if (hit.y > 0.0) {
    float a = max(hit.x, 0.0), b = min(hit.y, len);
    if (b > a) {
      float ds = (b - a) / 40.0;
      for (int i = 0; i < 40; i++) {
        float s = a + (float(i) + 0.5) * ds;
        gFp = 0.03;
        float gas, dust, ox; nebDensity(camN + rd * s, gas, dust, ox);
        float carve = smoothstep(0.3, 1.6, len - s);           // the star's own cavity
        tau += (gas * gasS + dust * dustS) * carve * ds;
      }
    }
  }
  fragColor = vec4(exp(-tau));
}`;

// ---------------------------------------------------------------- light shafts (half res)
// Screen-space volumetric scattering (Mitchell, GPU Gems 3) from up to three bright stars. The
// occlusion source is each star's halo seen through the gas in front of it (transmittance at the
// star's depth), so dust lanes throw dark streaks and gaps throw beams.
export const RAYS = (glsl) => glsl.header + glsl.math + glsl.hash + /* glsl */`
in vec2 vUv; out vec4 fragColor;
uniform sampler2D neb0, neb1;
uniform vec4 rS[3];      // ndc xy, intensity, depth fraction in the chord
uniform vec3 rC[3];
uniform float aspect, rayK, beamT;
uniform sampler2D beamTex;
float ign(vec2 p) { return hash12(p + 0.5); }
float Tat(vec2 uv, float f) {
  vec4 p = texture(neb1, uv);
  float t4 = f * 4.0;
  if (t4 < 1.0) return mix(1.0, p.x, t4);
  if (t4 < 2.0) return mix(p.x, p.y, t4 - 1.0);
  if (t4 < 3.0) return mix(p.y, p.z, t4 - 2.0);
  return mix(p.z, p.w, clamp(t4 - 3.0, 0.0, 1.0));
}
void main() {
  vec3 acc = vec3(0.0);
  float j = ign(gl_FragCoord.xy);
  for (int s = 0; s < 3; s++) {
    if (rS[s].z <= 0.0) continue;
    vec2 L = rS[s].xy * 0.5 + 0.5;
    vec2 dv = (L - vUv);
    const int NS = 32;
    float sum = 0.0, w = 1.0;
    for (int i = 0; i < NS; i++) {
      float f = (float(i) + j) / float(NS);
      vec2 uv = vUv + dv * f * 0.97;
      vec2 dn = (uv - L) * vec2(aspect, 1.0) * 2.0;
      float r2 = dot(dn, dn);
      float src = 1.0 / (1.0 + r2 * 900.0) + 0.1 / (1.0 + r2 * 40.0);
      vec3 em = texture(neb0, uv).rgb;
      float lum = dot(em, vec3(0.3, 0.5, 0.2));
      float Ts = Tat(uv, rS[s].w);
      src = (src + max(lum - 0.1, 0.0) * 0.5 / (1.0 + r2 * 3.0)) * Ts * Ts;
      sum += src * w;
      w *= 0.985;
    }
    vec2 dn0 = (vUv - L) * vec2(aspect, 1.0) * 2.0;
    float fall = 1.0 / (1.0 + dot(dn0, dn0) * 2.5);
    // crepuscular structure: beams and shadows that stream from the star (slowly turning)
    float ang = atan(dn0.y, dn0.x);
    float bp = pow(texture(beamTex, vec2(ang / 6.2831853 + 0.5 + float(s) * 0.37, beamT)).r, 2.0);
    float beams = mix(1.0, 0.3 + 1.6 * bp, smoothstep(0.03, 0.35, length(dn0)));
    fall *= beams;
    acc += rC[s] * rS[s].z * sum / float(NS) * fall * rayK;
  }
  fragColor = vec4(acc, 1.0);
}`;

// ---------------------------------------------------------------- composite (full res)
export const COMPOSITE = (glsl) => glsl.header + glsl.math + glsl.hash + COMMON + /* glsl */`
in vec2 vUv; out vec4 fragColor;
uniform sampler2D neb0, rays, galMap, extTex;
uniform sampler3D noiseTex;
uniform vec2 halfRes, res;
uniform float nebOn, raysOn;
uniform vec3 camG;                  // camera, galaxy units
uniform float galDiff, bulgeOn, dustK, EXT, galT, diffK, bulgeK, nucK;
uniform int nB;
uniform vec4 bP[${MAXB}];            // ndc xy, peak, spike gain
uniform vec4 bC[${MAXB}];            // rgb, flash (0..1)
uniform vec4 sunP;                   // ndc xy, peak, halo size
uniform vec4 sunF;                   // streak gain, glare fill, kick pulse, spike gain
uniform vec4 knot;                   // ndc xy, radius (ndc-y), brightness
uniform float glareW;
uniform float psf;                   // core sigma, ndc-y units
uniform float t;

// Bicubic B-spline from 4 bilinear taps (smooth half-res upsample).
vec4 bicubic(sampler2D tex, vec2 uv, vec2 tsz) {
  vec2 p = uv * tsz - 0.5, f = fract(p), i = floor(p);
  vec2 w0 = (1.0 - f) * (1.0 - f) * (1.0 - f) / 6.0;
  vec2 w1 = (4.0 - 6.0 * f * f + 3.0 * f * f * f) / 6.0;
  vec2 w2 = (1.0 + 3.0 * f + 3.0 * f * f - 3.0 * f * f * f) / 6.0;
  vec2 w3 = f * f * f / 6.0;
  vec2 g0 = w0 + w1, g1 = w2 + w3;
  vec2 h0 = (w1 / g0 - 1.0 + i + 0.5) / tsz, h1 = (w3 / g1 + 1.0 + i + 0.5) / tsz;
  return g0.y * (g0.x * texture(tex, vec2(h0.x, h0.y)) + g1.x * texture(tex, vec2(h1.x, h0.y)))
       + g1.y * (g0.x * texture(tex, vec2(h0.x, h1.y)) + g1.x * texture(tex, vec2(h1.x, h1.y)));
}

// Plummer-like bulge line integral: ∫ ds / (k² + σ²)² antiderivative.
float plF(float s, float k) { float k2 = k * k; return s / (2.0 * k2 * (k2 + s * s)) + atan(s / k) / (2.0 * k2 * k); }

vec3 galaxy(vec3 ro, vec3 rd, out float Tdust) {
  vec3 col = vec3(0.0); Tdust = 1.0;
  float ay = abs(rd.y);
  float tc = -1.0;
  if (ro.y * rd.y < 0.0) {
    tc = -ro.y / rd.y;
    vec2 xz = ro.xz + rd.xz * tc;
    vec4 m = texture(galMap, xz / (2.0 * EXT) + 0.5);
    float path = 1.0 / max(ay, 0.07);
    vec4 n1 = texture(noiseTex, vec3(xz * 2.3, 0.37));
    vec4 n2 = texture(noiseTex, vec3(xz * 9.0, 0.61));
    // sub-texel structure, faded in by the pixel footprint: creased dust filaments, mottled star clouds
    float foot = tc * 2.0 * tanHalf / res.y;
    float fineV = smoothstep(0.004, 0.0009, foot);
    vec4 n3 = texture(noiseTex, vec3(xz * 27.0, 0.13));
    vec4 n4 = texture(noiseTex, vec3(xz * 73.0, 0.83));
    float tbd = abs(n3.r * 2.0 - 1.0) + 0.6 * abs(n4.r * 2.0 - 1.0);
    float fil = pow(max(0.0, 1.0 - tbd * 1.25), 3.0);
    float armness = smoothstep(0.03, 0.4, m.g + m.b);
    float feather = (0.45 + 1.1 * n1.r) * (0.6 + 0.8 * n2.g);
    float dust = m.b * feather * (1.0 + fineV * (1.6 * fil - 0.5)) + fil * armness * 0.18 * fineV;
    Tdust = exp(-dust * dustK * min(path, 6.0));
    float near = smoothstep(0.003, 0.03, tc);
    float mott = mix(1.0, 0.55 + 0.9 * n4.g * n3.g * 2.0, fineV);
    vec3 old = vec3(1.0, 0.76, 0.50) * m.r * 0.16;
    vec3 yng = vec3(0.52, 0.68, 1.0) * m.g * 0.26 * (0.55 + 0.9 * n2.r);
    vec3 hii = vec3(1.0, 0.28, 0.46) * m.a * 0.10;
    vec3 sb = (old * mix(1.0, mott, 0.7) + yng * mott + hii) * min(path, 5.0) * diffK * mix(1.0, 0.2, fineV);
    col += sb * 0.5 * (1.0 + Tdust) * near * galDiff;
  }
  if (bulgeOn > 0.0) {
    const float q = 0.62, c = 0.055;
    vec3 sc = vec3(1.0, 1.0 / q, 1.0);
    vec3 o = ro * sc, d = rd * sc;
    float L = length(d), od = dot(o, d);
    float s0 = -od / (L * L);
    float b2 = max(dot(o, o) - od * od / (L * L), 0.0);
    float k = sqrt(b2 + c * c);
    float sCam = L * (0.0 - s0);
    float full = 3.14159265 / (2.0 * k * k * k);
    float front, back;
    if (tc > 0.0) { float sc2 = L * (tc - s0); front = plF(sc2, k) - plF(sCam, k); back = 3.14159265 / (4.0 * k * k * k) - plF(sc2, k); }
    else { front = 3.14159265 / (4.0 * k * k * k) - plF(sCam, k); back = 0.0; }
    float I = (front + back * Tdust) / L;
    // a second, tighter nucleus
    const float c2 = 0.012;
    float k2 = sqrt(b2 + c2 * c2);
    float I2;
    if (tc > 0.0) { float sc2 = L * (tc - s0); I2 = (plF(sc2, k2) - plF(sCam, k2)) + (3.14159265 / (4.0 * k2 * k2 * k2) - plF(sc2, k2)) * Tdust; }
    else I2 = 3.14159265 / (4.0 * k2 * k2 * k2) - plF(sCam, k2);
    I2 /= L;
    col += (vec3(1.0, 0.74, 0.46) * I * 1.1e-5 * bulgeK + vec3(1.0, 0.86, 0.66) * I2 * 1.2e-8 * nucK) * bulgeOn;
  }
  return col;
}

vec3 spikes(vec2 d, float amp, float len) {
  // JWST-like: three long spike pairs (vertical, ±60°) and one short horizontal pair.
  vec3 s = vec3(0.0);
  float w = psf * 0.55;
  for (int i = 0; i < 4; i++) {
    float a = i == 3 ? 0.0 : 1.5707963 + float(i) * 1.0471976;
    vec2 u = vec2(cos(a), sin(a));
    float al = abs(dot(d, u)), pe = abs(d.x * u.y - d.y * u.x);
    float Ls = len * (i == 3 ? 0.35 : 1.0);
    vec3 fall = exp(-al / (Ls * vec3(1.18, 1.0, 0.84)));
    s += exp(-pe * pe / (2.0 * w * w)) * fall * (i == 3 ? 0.5 : 1.0);
  }
  return s * amp;
}

vec3 star(vec2 p, vec2 c, float peak, vec3 col, float sp, float flash) {
  vec2 d = (p - c);
  float r2 = dot(d, d);
  float s2 = psf * psf;
  float core = exp(-r2 / (2.0 * s2));
  float hs = psf * (6.0 + 10.0 * flash);
  float halo = 1.0 / pow(1.0 + r2 / (hs * hs), 1.5);
  vec3 o = col * peak * (core + 0.01 * halo * (1.0 + 2.0 * flash));
  if (sp > 0.0) o += col * spikes(d, sp * peak * 0.0045, psf * (22.0 + 22.0 * flash) * sqrt(max(sp, 0.0)));
  return o;
}

void main() {
  vec2 ndc = vUv * 2.0 - 1.0;
  vec2 p = vec2(ndc.x * aspect, ndc.y);            // ndc-y units, isotropic
  vec3 rd = rayDir(ndc);
  float Tdust;
  vec3 col = galaxy(camG, rd, Tdust) * galT;
  if (nebOn > 0.0) {
    vec4 n = bicubic(neb0, vUv, halfRes);
    col = col * mix(1.0, n.a, nebOn) + n.rgb * nebOn;
  }
  if (raysOn > 0.0) col += bicubic(rays, vUv, halfRes).rgb * raysOn;
  // the nebula as a distant HII knot (takes over from the raymarch as it shrinks)
  if (knot.w > 0.0) {
    vec2 d = p - vec2(knot.x * aspect, knot.y);
    float r = knot.z;
    vec4 nz = texture(noiseTex, vec3(d / max(r, 1e-4) * 0.08 + 0.3, 0.52));
    float g = exp(-dot(d, d) / (2.0 * r * r)) * (0.6 + 0.8 * nz.g);
    col += vec3(1.0, 0.30, 0.52) * knot.w * g + vec3(0.8, 0.85, 1.0) * knot.w * 0.8 * exp(-dot(d, d) / (2.0 * r * r * 0.06));
  }
  for (int k = 0; k < ${MAXB}; k++) {
    if (k >= nB) break;
    vec4 P = bP[k];
    if (P.z <= 0.0) continue;
    vec2 c = vec2(P.x * aspect, P.y);
    vec2 dd = p - c;
    float ext = max(texelFetch(extTex, ivec2(k, 0), 0).r, k == 0 ? 0.8 : 0.3);
    col += star(p, c, P.z * ext, bC[k].rgb, P.w, bC[k].a);
  }
  // the future Sun
  if (sunP.z > 0.0) {
    vec2 c = vec2(sunP.x * aspect, sunP.y), d = p - c;
    float r2 = dot(d, d);
    vec3 gold = vec3(1.0, 0.82, 0.55);
    float pk = sunP.z * (1.0 + sunF.z);
    float hs = sunP.w;
    col += gold * pk * exp(-r2 / (2.0 * psf * psf * (1.0 + hs * 400.0)));
    col += gold * pk * 0.02 / pow(1.0 + r2 / (hs * hs), 1.25);
    col += gold * pk * 0.0025 / (1.0 + r2 / (hs * hs * 40.0));
    col += vec3(1.0, 0.86, 0.62) * spikes(d, sunF.w * pk * 0.004, psf * 40.0 + hs * 2.0);
    // anamorphic streak (cool, horizontal)
    float st = exp(-abs(d.y) / (psf * (1.5 + hs * 14.0))) / pow(1.0 + abs(d.x) / (0.08 + hs * 2.0), 1.6);
    col += vec3(0.62, 0.78, 1.0) * st * sunF.x * pk * 0.006;
  }
  // III → IV glare contract: linear ≈ (1.0, 0.82, 0.55) × 3–6, brightest at the centre
  if (sunF.y > 0.0) {
    // the star's glare swells from the centre (a halo whose scale grows exponentially) and settles
    // exactly onto the III → IV contract field by 57.2
    vec2 c = vec2(sunP.x * aspect, sunP.y);
    float r2 = dot(p - c, p - c);
    vec3 gold = vec3(1.0, 0.82, 0.55);
    float rho = sunF.y;
    col += gold * 6.0 / (1.0 + r2 / (rho * rho)) * smoothstep(0.0, 0.05, rho);
    vec3 glare = gold * (3.0 + 3.0 * exp(-dot(p, p) / 0.55));
    col = mix(col, glare, glareW);
  }
  fragColor = vec4(max(col, vec3(0.0)), 1.0);
}`;

// ---------------------------------------------------------------- particles (instanced quads)
export const PARTICLE_VERT = (glsl) => glsl.header + /* glsl */`
precision highp sampler3D;
in vec3 position;
in vec4 aOrb; in vec4 aExt; in vec4 aCol;
uniform float t, tRef;
uniform vec3 camPos, camR, camU, camF; uniform float tanHalf, aspect;
uniform float psf, galVis, localNVis, localSVis, nebOn, twinkle, resY, EXT, dustK, galGain, hiiGain, dSoft, oldGain;
uniform vec3 camN; uniform float NU;
uniform vec3 nebC;
uniform sampler2D neb1, galMap;
uniform sampler3D noiseTex;
out vec3 vCol; out vec2 vQ; out float vKind;
float Tat(vec2 uv, float f) {
  vec4 p = texture(neb1, uv);
  float t4 = f * 4.0;
  if (t4 < 1.0) return mix(1.0, p.x, t4);
  if (t4 < 2.0) return mix(p.x, p.y, t4 - 1.0);
  if (t4 < 3.0) return mix(p.y, p.z, t4 - 2.0);
  return mix(p.z, p.w, clamp(t4 - 3.0, 0.0, 1.0));
}
void main() {
  float pop = aExt.z;
  float u = aOrb.w + aExt.y * (t - tRef) * step(pop, 1.5);
  vec2 l = vec2(aOrb.x * cos(u), aOrb.y * sin(u));
  float c = cos(aOrb.z), s = sin(aOrb.z);
  vec3 wp = vec3(l.x * c - l.y * s, aExt.x, l.x * s + l.y * c);
  vec3 v = wp - camPos;
  float z = dot(v, camF);
  gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  vCol = vec3(0.0); vQ = vec2(0.0); vKind = 0.0;
  if (z < 1e-6) return;
  float vis = pop > 5.5 ? localSVis : (pop > 4.5 ? smoothstep(aExt.w, aExt.w + 1.4, t) * localNVis : galVis);
  if (vis <= 0.0) return;
  vec2 ndc = vec2(dot(v, camR) / (z * tanHalf * aspect), dot(v, camU) / (z * tanHalf));
  if (abs(ndc.x) > 1.3 || abs(ndc.y) > 1.3) return;
  float d2 = dot(v, v);
  // galaxy dust between the star and the camera (thin mid-plane layer)
  float atten = 1.0;
  float side = camPos.y >= 0.0 ? 1.0 : -1.0;
  float behind = clamp(0.5 - wp.y * side / 0.008, 0.0, 1.0);
  if (pop > 1.5 && pop < 3.5) behind = max(behind, 0.65);      // young stars sit inside the dust layer
  if (behind > 0.0 && abs(camPos.y - wp.y) > 1e-7) {
    float k = wp.y / (wp.y - camPos.y);
    vec2 xz = wp.xz + (camPos.xz - wp.xz) * k;
    float dd = textureLod(galMap, xz / (2.0 * EXT) + 0.5, 0.0).b;
    float n1 = textureLod(noiseTex, vec3(xz * 2.3, 0.37), 0.0).r;
    float ay = abs(v.y) / sqrt(d2);
    atten = mix(1.0, exp(-dd * (0.45 + 1.1 * n1) * dustK * min(1.0 / max(ay, 0.07), 6.0)), behind);
  }
  // the nebula's gas/dust in front of the star
  if (nebOn > 0.0) {
    vec3 rd = v / sqrt(d2);
    vec3 oc = camN; float b = dot(oc, rd); float cc = dot(oc, oc) - 110.25; float h = b * b - cc;
    if (h > 0.0) {
      h = sqrt(h);
      float t0 = max(-b - h, 0.0), t1 = -b + h;
      float dn = sqrt(d2) / NU;
      if (t1 > 0.0 && dn > t0) {
        float f = clamp((dn - t0) / max(t1 - t0, 1e-4), 0.0, 1.0);
        atten *= mix(1.0, Tat(ndc * 0.5 + 0.5, f), nebOn);
      }
    }
  }
  // Galaxy particles are star clouds with a physical size: far away they are points, up close
  // they resolve into soft blobs of constant surface brightness and hand over to the disk layer.
  // Local populations (the nebula's and the Sun's neighbours) are true point stars.
  float sp = pop < 0.5 ? 0.0045 : (pop < 1.5 ? 0.004 : (pop < 2.5 ? 0.00012 : (pop < 3.5 ? 0.0001 : (pop < 4.5 ? aExt.y : 0.0))));
  float sig0 = max(psf, 1.5 / resY);
  float sig = max(sig0, sp / (z * tanHalf));
  float sa = sig * tanHalf;
  float gainP = pop > 4.5 ? 1.0 : galGain * (pop < 1.5 ? oldGain : 1.0);
  float tw = 1.0 + twinkle * (pop > 1.5 ? 1.0 : 0.3) * sin(t * (1.3 + 2.9 * aExt.w) + aExt.w * 61.0);
  // galaxy particles are whole associations: they stop brightening (and fade) once the camera is
  // inside their neighbourhood; the local populations carry the resolved stars there.
  float d2e = pop < 4.5 ? max(d2, dSoft * dSoft) : d2;
  float near = pop < 4.5 ? smoothstep(dSoft * 0.25, dSoft, sqrt(d2)) : 1.0;
  float peak = aCol.w / d2e / (6.2831853 * sa * sa) * vis * atten * tw * gainP * near;
  if (pop > 3.5 && pop < 4.5) peak *= hiiGain;
  if (pop < 1.5) peak *= smoothstep(0.018, 0.007, sig);  // resolved clouds dissolve into the disk light
  else if (pop < 4.5) peak *= smoothstep(0.02, 0.008, sig);
  if (peak > 9.0) { sig *= pow(peak / 9.0, 0.07); peak = 9.0 + log(peak / 9.0) * 2.5; }
  if (peak < 0.004) return;
  float sz = sig * sqrt(2.0 * log(peak / 0.004));
  vec3 col = aCol.rgb;
  vKind = (pop > 3.5 && pop < 4.5) ? 1.0 + fract(aExt.w * 7.13) : 0.0;
  vCol = col * peak;
  vQ = position.xy * sz / sig;
  gl_Position = vec4(ndc + position.xy * sz * vec2(1.0 / aspect, 1.0), 0.0, 1.0);
}`;

export const PARTICLE_FRAG = (glsl) => glsl.header + /* glsl */`
precision highp sampler3D;
in vec3 vCol; in vec2 vQ; in float vKind;
uniform sampler3D noiseTex;
out vec4 fragColor;
void main() {
  float r2 = dot(vQ, vQ);
  float I = exp(-0.5 * r2);
  if (vKind > 0.5) {
    float n = texture(noiseTex, vec3(vQ * 0.09 + vKind * 0.37, vKind * 0.5)).g;
    I = exp(-0.5 * r2 * (0.7 + 0.8 * n)) * (0.55 + 0.9 * n);
  }
  fragColor = vec4(vCol * I, 1.0);
}`;
