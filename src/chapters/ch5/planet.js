// V · PALE BLUE: the orbital planet renderer (analytic ray-sphere, one fullscreen pass).
//   molten crust + lava crack network (Voronoi F2-F1, domain-warped)  → cools, oceans fill
//   fbm continents with ridged mountains and finite-difference normals (pixel-footprint LOD)
//   ocean: GGX + Smith + Schlick, wind-roughness field and wave-slope noise → a gliding glint
//   cloud shell: warped fbm + cyclone swirls, bump-lit tops, shadows cast on the surface
//   Rayleigh + Mie single scattering through the shell (LUT sun transmittance), Earth's shadow
//   in the atmosphere gives the gold/red terminator band. Sparse stars behind.
import { ATMO_CONST, ATMO_FUNCS } from './atmo.js';

export const COMMON = /* glsl */`
const mat3 OCT_ROT = mat3(0.00, 0.80, 0.60, -0.80, 0.36, -0.48, -0.60, -0.48, 0.64);
// fbm with fractional octave count (the last octave fades in: no LOD popping)
float fbmL(vec3 p, float oct) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 14; i++) {
    float w = clamp(oct - float(i), 0.0, 1.0);
    if (w <= 0.0) break;
    s += a * w * snoise(p);
    p = OCT_ROT * p * 2.03 + vec3(17.1, -3.7, 9.3);
    a *= 0.5;
  }
  return s;
}
float ridgedL(vec3 p, float oct) {
  float a = 0.5, s = 0.0, prev = 1.0;
  for (int i = 0; i < 12; i++) {
    float w = clamp(oct - float(i), 0.0, 1.0);
    if (w <= 0.0) break;
    float n = 1.0 - abs(snoise(p));
    n = n * n;
    s += a * w * n * prev;
    prev = n;
    p = OCT_ROT * p * 2.07 + vec3(-5.3, 12.1, 3.9);
    a *= 0.5;
  }
  return s;
}
float D_GGX(float NoH, float a) { float a2 = a * a; float d = NoH * NoH * (a2 - 1.0) + 1.0; return a2 / (PI * d * d + 1e-7); }
float V_Smith(float NoV, float NoL, float a) {
  float a2 = a * a;
  float gv = NoL * sqrt(NoV * NoV * (1.0 - a2) + a2);
  float gl = NoV * sqrt(NoL * NoL * (1.0 - a2) + a2);
  return 0.5 / (gv + gl + 1e-6);
}
float fresnelW(float c) { float m = 1.0 - clamp(c, 0.0, 1.0); float m2 = m * m; return 0.02 + 0.98 * m2 * m2 * m; }
vec3 rotAxis(vec3 p, vec3 ax, float a) { float c = cos(a), s = sin(a); return p * c + cross(ax, p) * s + ax * dot(ax, p) * (1.0 - c); }
`;

export const PLANET_FRAG = (glsl) => glsl.all + ATMO_CONST + ATMO_FUNCS + COMMON + /* glsl */`
in vec2 vUv; out vec4 fragColor;
uniform vec3 uCamPos, uCamR, uCamU, uCamF;
uniform float uTanHalf, uAspect;
uniform vec2 uRes;
uniform mat3 uSpin, uCSpin;       // world → planet-fixed, world → cloud-fixed
uniform float uTime, uCloudT;
uniform float uMolten, uCrust, uSea, uCloud, uFog, uStars, uKick, uShimmer;
uniform vec4 uOcean[4];           // planet-fixed ocean basins (descent point, glint track) + depth
uniform vec4 uCyc[3];             // cloud-fixed cyclone centres (xyz) + strength (w)
uniform vec4 uDeck;               // cloud-fixed centre of the deck we dive through + amount
uniform vec4 uClear[3];           // cloud-fixed points along the sun glint's track: keep them mostly clear

const float RC = 1.0036;          // cloud shell radius

// grazing sunlight near the terminator: long path through the limb → gold, then red
vec3 termTint(float mu) {
  float g = smoothstep(0.32, 0.0, mu);
  return mix(vec3(1.0), vec3(1.0, 0.62, 0.32), g) * mix(vec3(1.0), vec3(1.0, 0.7, 0.55), smoothstep(0.08, -0.02, mu));
}
// ---------------------------------------------------------------- stars
vec3 starField(vec3 rd, float pixAng) {
  vec3 col = vec3(0.0);
  for (int layer = 0; layer < 2; layer++) {
    float sc = layer == 0 ? 120.0 : 260.0;
    float dens = layer == 0 ? 0.012 : 0.006;
    vec3 p = rd * sc;
    vec3 b = floor(p - 0.5);
    for (int k = 0; k < 8; k++) {
      vec3 c = b + vec3(float(k & 1), float((k >> 1) & 1), float((k >> 2) & 1));
      vec3 h = hash33(c + vec3(0.5, 17.5, float(layer) * 91.5));
      if (h.x > dens) continue;
      vec3 sp = normalize(c + hash33(c + vec3(3.5, 7.5, 11.5)));
      float d = length(cross(rd, sp));
      float mag = pow(h.y, 9.0);
      float bri = (layer == 0 ? 0.55 : 0.22) * (0.015 + mag * 1.4);
      float sig = pixAng * (0.55 + 0.5 * mag);
      vec3 tint = mix(vec3(1.0, 0.72, 0.5), vec3(0.65, 0.78, 1.0), h.z);
      col += tint * bri * exp(-d * d / (2.0 * sig * sig)) * (pixAng * pixAng) / (sig * sig);
    }
  }
  return col;
}

// ---------------------------------------------------------------- terrain
float terrain(vec3 q, float oct) {
  vec3 w = q * 1.55;
  vec3 wp = vec3(snoise(w * 0.8 + vec3(3.1, 0.0, 0.0)), snoise(w * 0.8 + vec3(-7.3, 1.1, 5.0)), snoise(w * 0.8 + vec3(11.0, -4.0, 2.0)));
  w += 0.55 * wp;
  float cont = fbmL(w, min(oct, 5.0));
  float m = ridgedL(q * 4.2 + wp, max(oct - 2.0, 0.0));
  float h = cont + 0.42 * (m - 0.35) * smoothstep(-0.02, 0.3, cont);
  // island arcs / volcanic chains along ridges of a second field
  float arc = clamp(1.0 - abs(snoise(q * 2.3 + vec3(9.0))), 0.0, 1.0);
  h += 0.22 * pow(arc, 18.0) * smoothstep(-0.35, -0.05, cont) * (0.5 + 0.5 * snoise(q * 18.0));
  for (int i = 0; i < 4; i++) {
    vec3 dq = q - uOcean[i].xyz;
    h -= uOcean[i].w * exp(-dot(dq, dq) / 0.07);
  }
  return h;
}

// ---------------------------------------------------------------- lava cracks (Voronoi F2-F1)
vec3 vor(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  float f1 = 8.0, f2 = 8.0; float id = 0.0;
  for (int k = 0; k < 27; k++) {
    vec3 o = vec3(float(k % 3), float((k / 3) % 3), float(k / 9)) - 1.0;
    vec3 h = hash33(i + o + vec3(0.5));
    vec3 r = o + h - f;
    float d = dot(r, r);
    if (d < f1) { f2 = f1; f1 = d; id = h.z; } else if (d < f2) f2 = d;
  }
  return vec3(sqrt(f1), sqrt(f2), id);
}
// returns emission (linear, HDR)
vec3 lava(vec3 q, float fp) {
  if (uMolten <= 0.001) return vec3(0.0);
  vec3 jag = vec3(snoise(q * 41.0), snoise(q * 41.0 + 5.3), snoise(q * 41.0 - 9.1));
  vec3 w = q * 3.4 + 0.2 * vec3(snoise(q * 2.2), snoise(q * 2.2 + 19.1), snoise(q * 2.2 - 7.7)) + 0.028 * jag;
  vec3 v1 = vor(w);
  float e1 = v1.y - v1.x;
  float aa = fp * 3.2 * 1.5;
  float wid = 0.016 + 0.018 * smoothstep(-0.4, 0.8, snoise(q * 5.0 + 2.0));
  float c1 = 1.0 - smoothstep(0.0, wid + aa, e1);
  c1 *= wid / (wid + aa);
  float halo1 = exp(-e1 * 26.0);
  vec3 w2 = q * 12.0 + 0.25 * vec3(snoise(q * 7.0 + 3.0), snoise(q * 7.0 - 5.0), snoise(q * 7.0 + 8.0)) + 0.08 * jag;
  vec3 v2 = vor(w2);
  float e2 = v2.y - v2.x;
  float aa2 = fp * 11.0 * 1.5;
  float c2 = (1.0 - smoothstep(0.0, 0.03 + aa2, e2)) * 0.03 / (0.03 + aa2);
  // each plate cools at its own pace
  float age = hashU(uint(v1.z * 65535.0));
  float live = smoothstep(age * 0.75, age * 0.75 + 0.3, uMolten);
  float live2 = smoothstep(0.35 + 0.4 * v2.z, 0.6 + 0.4 * v2.z, uMolten) * smoothstep(0.25, 0.02, e1) ;
  float pulse = 0.55 + 0.45 * smoothstep(-0.6, 0.7, snoise(q * 4.0 + vec3(0.0, 0.0, uTime * 0.5)));
  vec3 hot = vec3(1.0, 0.46, 0.12), warm = vec3(0.85, 0.14, 0.025);
  float plate = smoothstep(0.2, 0.9, snoise(q * 1.7 + 4.0));      // a few hotter plates
  vec3 em = hot * 5.5 * c1 * live * pulse + warm * 0.9 * c2 * live2 * (1.0 - c1) * pulse
          + warm * (0.07 * halo1 * pulse + 0.006 * plate) * live;
  return em;
}

// ---------------------------------------------------------------- clouds
// Weather-like fields: cyclones wind the domain (log-spiral), latitude-dependent zonal shear
// (jets, trades) streaks it into bands, a two-level curl-like warp makes it flow, a climatology
// sets where cloud lives (storm tracks, dry subtropics, ITCZ), trade-wind cumulus streets fill
// the trade belts, and fine billows erode a crisp coverage threshold. Returns
// (coverage = crisp alpha, thickness = soft optical depth for shading).
vec3 vnoise3(vec3 p) { return vec3(snoise(p), snoise(p + vec3(31.3, -17.1, 7.7)), snoise(p + vec3(-11.9, 23.5, -41.3))); }
vec3 swirl(vec3 p, vec4 cyc) {
  float d = length(p - cyc.xyz);
  float a = cyc.w * 2.9 * exp(-d * d / 0.04) * (1.0 - exp(-d * 45.0)) / (0.3 + d * 7.0);
  return rotAxis(p, cyc.xyz, a);
}
vec3 rotY(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z); }

vec2 cloudEval(vec3 qc, float oct) {
  vec3 p = qc;
  for (int i = 0; i < 3; i++) p = swirl(p, uCyc[i]);
  float lat = p.y;
  // zonal shear: jets and trades drag longitudes apart → banded, streaky structure
  p = rotY(p, 0.2 * sin(lat * 5.2) + 0.08 * sin(lat * 13.0 + 1.3));
  vec3 w = p * vec3(2.3, 2.8, 2.3) + vec3(uCloudT * 0.05, 0.0, uCloudT * 0.03);
  vec3 q1 = vnoise3(w * 0.85);
  vec3 q2 = vnoise3(w * 1.9 + 1.6 * q1 + vec3(4.1, 0.0, -2.3));
  vec3 ww = w + 0.34 * q1 + 0.2 * q2;
  float n = fbmL(ww, min(oct, 5.0));
  // weather systems come in patches: a low-frequency organiser with clear gaps between
  n += 0.22 * snoise(p * 1.3 + vec3(2.0, 5.0, uCloudT * 0.02));
  float alat = abs(lat);
  n += 0.2 * exp(-pow((alat - 0.63) / 0.15, 2.0))      // mid-latitude storm tracks
     - 0.2 * exp(-pow((alat - 0.40) / 0.10, 2.0))      // subtropical highs: clear
     + 0.15 * exp(-pow(lat / 0.07, 2.0));              // ITCZ
  // cyclones: spiral arms and a clear eye
  for (int i = 0; i < 3; i++) {
    vec3 c = uCyc[i].xyz; float s = uCyc[i].w;
    vec3 v = qc - c; float d = length(v);
    vec3 e1 = normalize(cross(c, vec3(0.0, 1.0, 0.0))), e2 = cross(c, e1);
    float ang = atan(dot(v, e2), dot(v, e1));
    float arms = cos(2.0 * ang - sign(s) * 11.0 * log(d + 0.004));
    float env = exp(-d * d / 0.018);
    n += abs(s) * (env * (0.16 * arms + 0.22) + 0.35 * exp(-pow((d - 0.02) / 0.012, 2.0)) - 1.1 * exp(-pow(d / 0.009, 2.0)));
  }
  vec3 dd = qc - uDeck.xyz;
  n += uDeck.w * exp(-dot(dd, dd) / 0.012);
  for (int i = 0; i < 3; i++) { vec3 dc = qc - uClear[i].xyz; n -= uClear[i].w * exp(-dot(dc, dc) / 0.03); }
  float thr = mix(0.95, 0.1, uCloud);
  // erosion: billowy fine detail eats into the edges → crisp fractal boundaries
  float det = 0.0;
  // (isotropic, lightly warped domain: cauliflower billows, not combed fibres)
  if (oct > 3.0) det = (1.0 - abs(fbmL(p * 15.0 + 0.5 * q1, min(oct - 3.0, 4.0)) * 1.7)) - 0.55;
  float cov = smoothstep(thr, thr + 0.1, n + 0.22 * det);
  float thick = smoothstep(thr, thr + 0.9, n + 0.3 * det);   // tops keep relief even in dense decks
  // trade-wind cumulus streets: rows of small cumulus aligned with the flow
  float trade = smoothstep(0.1, 0.2, alat) * (1.0 - smoothstep(0.36, 0.48, alat));
  if (trade > 0.0 && oct > 4.0) {
    float rows = pow(0.5 + 0.5 * sin(lat * 520.0 + 6.0 * q1.x), 2.0);
    vec3 vc = vor(p * 115.0 + q1);
    float cu = (1.0 - smoothstep(0.18, 0.42, vc.x - 0.12 * det)) * rows * trade * smoothstep(-0.2, 0.3, q2.y) * clamp(oct - 4.0, 0.0, 1.0);
    cu *= 1.0 - smoothstep(0.05, 0.3, cov);          // only in otherwise clear air
    cov = max(cov, 0.5 * cu);
    thick = max(thick, 0.25 * cu);
  }
  // cirrus: thin streaky veils in the storm tracks
  float ci = fbmL(ww * vec3(1.6, 5.0, 1.6) + 2.0 * q1, min(oct, 4.0));
  float cir = 0.28 * smoothstep(0.2, 0.7, ci) * smoothstep(0.35, 0.6, alat);
  cov = max(cov, cir); thick = max(thick, cir * 0.4);
  float on = smoothstep(0.0, 0.15, uCloud);
  return vec2(cov, thick) * on;
}
float cloudCov(vec3 qc, float oct) { return cloudEval(qc, oct).x; }

// ---------------------------------------------------------------- surface

vec3 tangentA(vec3 n) { vec3 a = abs(n.y) < 0.9 ? vec3(0, 1, 0) : vec3(1, 0, 0); return normalize(cross(a, n)); }

vec3 shadeSurface(vec3 p, vec3 rd, float fp, float dist, out float isWater) {
  vec3 N = normalize(p);
  vec3 q = uSpin * N;
  vec3 V = -rd;
  float oct = clamp(log2(0.5 / (1.55 * max(fp, 1e-7))) - 0.5 - 8.0 * uFog, 1.0, 11.0);
  float h = terrain(q, oct);
  isWater = step(h, uSea);
  vec3 L = uSun;
  vec3 Ts = sunTrans(p) * termTint(dot(N, uSun));
  // cloud shadow: where the sun ray from p crosses the cloud shell
  float csh = 1.0;
  if (uCloud > 0.01) {
    float b = dot(p, L), c = dot(p, p) - RC * RC;
    float tcs = -b + sqrt(max(b * b - c, 0.0));
    vec3 pc = p + L * tcs;
    float cov = cloudCov(uCSpin * normalize(pc), clamp(oct - 2.0, 1.0, 6.0));
    csh = 1.0 - 0.82 * cov;
  }
  float NoLs = dot(N, L);
  vec3 sky = uSunI * uAtmo * vec3(0.035, 0.07, 0.15) * smoothstep(-0.2, 0.5, NoLs);
  vec3 col;
  if (isWater > 0.5) {
    float depth = uSea - h;
    // wind roughness field (sunglint streaks / calm slicks) and wave slopes
    vec3 qw = q * vec3(7.0, 26.0, 7.0) + vec3(0.0, uTime * 0.01, 0.0);
    float wOct = clamp(log2(0.5 / (26.0 * max(fp, 1e-7))) - 1.0, 1.0, 3.5);
    float wind = 0.7 * fbmL(q * 4.0, 2.0) + 0.42 * fbmL(qw, wOct);
    float rough = mix(0.055, 0.24, smoothstep(-0.55, 0.45, wind));
    // closer in, more of the slope variance is resolved by the normal noise
    float res = clamp(log2(0.02 / max(fp, 1e-7)) / 8.0, 0.0, 1.0);
    rough = mix(rough, rough * 0.55, res);
    vec3 t1 = tangentA(N), t2 = cross(N, t1);
    float sOct = clamp(log2(0.5 / (40.0 * max(fp, 1e-7))), 0.0, 5.0);
    vec3 qs = q * 40.0 + vec3(uTime * 0.02, 0.0, 0.0);
    vec2 sl = vec2(fbmL(qs, sOct), fbmL(qs + vec3(31.0, 7.0, -11.0), sOct)) * (0.015 + 0.2 * res * res);
    vec3 Nw = normalize(N + (t1 * sl.x + t2 * sl.y) * isWater);
    vec3 H = normalize(V + L);
    float NoL = max(dot(Nw, L), 0.0), NoV = max(dot(Nw, V), 1e-3), NoH = max(dot(Nw, H), 0.0);
    float F = fresnelW(dot(V, H));
    float spec = D_GGX(NoH, rough) * V_Smith(NoV, NoL, rough) * F * NoL;
    float Fv = fresnelW(NoV);
    vec3 deep = vec3(0.0030, 0.0105, 0.030);
    vec3 shallow = vec3(0.016, 0.07, 0.075);
    vec3 alb = mix(shallow, deep, smoothstep(0.0, 0.07, depth));
    // early oceans: murky, iron-green, steaming
    alb = mix(alb, vec3(0.02, 0.028, 0.022), uCrust * 0.7);
    col = alb * (uSunI * Ts * max(NoLs, 0.0) * csh + sky) * (1.0 - Fv)
        + Fv * uSunI * uAtmo * vec3(0.05, 0.10, 0.22) * smoothstep(-0.1, 0.4, NoLs)
        + PI * uSunI * Ts * spec * csh * (1.0 + 0.6 * uShimmer);
  } else {
    // mountain normals from the terrain gradient
    vec3 t1 = tangentA(N), t2 = cross(N, t1);
    float eps = max(fp * 1.5, 2e-5);
    vec3 qa = uSpin * normalize(N + t1 * eps), qb = uSpin * normalize(N + t2 * eps);
    float ha = terrain(qa, oct), hb = terrain(qb, oct);
    float bump = 0.0045 + 0.004 * (1.0 - clamp(fp * 400.0, 0.0, 1.0));
    vec3 Nt = normalize(N - (t1 * (ha - h) + t2 * (hb - h)) / eps * bump);
    float el = h - uSea;
    float nv = snoise(q * 24.0) * 0.5 + 0.5;
    float nv2 = snoise(q * 70.0 + 5.0) * 0.5 + 0.5;
    vec3 sand = vec3(0.30, 0.25, 0.19), ochre = vec3(0.17, 0.13, 0.095), umber = vec3(0.105, 0.085, 0.065);
    vec3 basalt = vec3(0.06, 0.058, 0.055), grey = vec3(0.15, 0.145, 0.14), olive = vec3(0.085, 0.09, 0.07);
    float nv3 = snoise(q * 9.0 - 3.0) * 0.5 + 0.5;
    vec3 a = mix(ochre, umber, smoothstep(0.25, 0.75, nv));
    a = mix(a, olive, smoothstep(0.55, 0.85, nv3) * 0.7);
    a = mix(a, sand, smoothstep(0.62, 0.9, nv2) * 0.6);
    a = mix(sand, a, smoothstep(0.0, 0.012 + 0.02 * nv2, el) * 0.7 + 0.3);
    a = mix(a, mix(basalt, grey, nv2), smoothstep(0.1, 0.34, el + 0.12 * nv));
    a = mix(a, vec3(0.62, 0.64, 0.68), smoothstep(0.52, 0.62, el + 0.08 * nv2) * 0.8);
    // fresh crust: black basalt with slight variation
    vec3 crust = vec3(0.036, 0.033, 0.031) * (0.6 + 0.7 * nv) * (0.75 + 0.5 * nv2);
    a = mix(a, crust, uCrust);
    float NoL = max(dot(Nt, L), 0.0);
    col = a * (uSunI * Ts * NoL * csh + sky);
  }
  col += lava(q, fp);
  return col;
}

void main() {
  vec2 ndc = vUv * 2.0 - 1.0;
  vec3 rd = normalize(uCamF + ndc.x * uAspect * uTanHalf * uCamR + ndc.y * uTanHalf * uCamU);
  vec3 ro = uCamPos;
  float pixAng = 2.0 * uTanHalf / uRes.y;

  vec3 bgStars = starField(rd, pixAng) * uStars;
  // sun disc (in case it ever enters the frame)
  float sd = dot(rd, uSun);
  vec3 sunDisc = vec3(1.0, 0.95, 0.88) * 60.0 * smoothstep(0.99996, 0.99999, sd);

  vec2 ta = sphIntersect(ro, rd, vec3(0.0), RT);
  vec2 tg = sphIntersect(ro, rd, vec3(0.0), RG);
  // closest approach (for limb anti-aliasing)
  float tca = max(-dot(ro, rd), 0.0);
  float bca = length(ro + rd * tca);
  float edgePx = (bca - RG) / max(tca * pixAng, 1e-9);

  vec3 col;
  if (ta.y <= 0.0) {
    col = bgStars + sunDisc;
  } else {
    float t0 = max(ta.x, 0.0);
    bool hit = tg.x > 0.0;
    float cov = hit ? 1.0 : 0.0;
    float t1 = hit ? tg.x : ta.y;
    // limb AA: treat pixels within a pixel of the limb as partially covered
    vec3 pS = hit ? ro + rd * tg.x : vec3(0.0);
    if (abs(edgePx) < 0.75 && tca > 0.0) {
      cov = clamp(0.5 - edgePx / 1.5, 0.0, 1.0);
      if (!hit) { pS = normalize(ro + rd * tca) * RG; }
    }
    // cloud shell intersection (first crossing in front of the camera, before the ground)
    float tc = -1.0;
    vec2 tcs = sphIntersect(ro, rd, vec3(0.0), RC);
    if (uCloud > 0.01 && tcs.y > 0.0) {
      tc = tcs.x > 0.0 ? tcs.x : tcs.y;
      if (hit && tc > tg.x) tc = -1.0;
    }
    vec3 S, Tr, SS, TS;
    atmoMarch(ro, rd, t0, t1, tc > 0.0 ? tc : 1e9, 28, 1.0, S, Tr, SS, TS);

    // cloud first, so the terrain under opaque cloud is never evaluated
    float cA = 0.0; vec3 cCol = vec3(0.0);
    if (tc > 0.0) {
      vec3 pc = ro + rd * tc;
      vec3 Nc = normalize(pc);
      float dist = tc;
      float fpc = dist * pixAng;
      float oct = clamp(log2(0.5 / (2.6 * max(fpc, 1e-7))) - 0.3 - 8.0 * uFog, 1.0, 10.0);
      vec3 qc = uCSpin * Nc;
      vec2 ce = cloudEval(qc, oct);
      float c0 = ce.x;
      float graze = smoothstep(0.015, 0.09, abs(dot(Nc, rd)));
      c0 *= graze;
      if (c0 > 0.002) {
        float th0 = ce.y;
        // bump-lit tops from the (smooth) thickness field
        vec3 t1 = tangentA(Nc), t2 = cross(Nc, t1);
        float eps = max(fpc * 2.0, 3e-5);
        float tA = cloudEval(uCSpin * normalize(Nc + t1 * eps), oct).y;
        float tB = cloudEval(uCSpin * normalize(Nc + t2 * eps), oct).y;
        float bumpK = 0.004 + 0.009 * (1.0 - clamp(fpc * 300.0, 0.0, 1.0));
        vec3 Nb = normalize(Nc - (t1 * (tA - th0) + t2 * (tB - th0)) / eps * bumpK);
        vec3 Tsc = sunTrans(pc) * termTint(dot(Nc, uSun));
        float mu = dot(Nc, uSun);
        // soft self-shadowing: thicker cloud upstream (toward the sun) shades this spot, and
        // the shadow reaches further as the sun gets low (long shadows near the terminator)
        float selfSh = 1.0;
        vec3 sT = uSun - Nc * mu; float sl = length(sT);
        if (sl > 1e-4) {
          float reach = max(clamp(0.0022 / max(mu, 0.06), 0.002, 0.03), fpc * 3.0);
          float tU = cloudEval(uCSpin * normalize(Nc + sT / sl * reach), oct - 1.0).y;
          selfSh = 1.0 - 0.72 * smoothstep(0.0, 0.4, tU - th0);
        }
        float NoL = dot(Nb, uSun);
        float lit = clamp(0.5 + 0.5 * NoL, 0.0, 1.0);
        lit = lit * lit * 0.8 + 0.2 * smoothstep(-0.12, 0.25, mu);
        lit *= smoothstep(-0.08, 0.12, mu);
        vec3 amb = uSunI * uAtmo * vec3(0.08, 0.11, 0.18) * smoothstep(-0.15, 0.4, mu);
        vec3 cc = vec3(0.95, 0.96, 0.98) * (uSunI * Tsc * lit * selfSh * (0.42 + 0.58 * th0) + amb);
        // steam clouds early on are greyer
        cc *= mix(1.0, 0.7, uCrust);
        cA = c0 * (0.55 + 0.45 * smoothstep(0.0, 0.6, th0));    // thin veils stay translucent
        cCol = cc;
      }
    }
    vec3 bg = bgStars * Tr + sunDisc * Tr;
    if (cov > 0.0 && cA < 0.985) {   // opaque cloud hides the ground: skip the terrain
      float dist = length(pS - ro);
      float fp = dist * pixAng;
      float isW;
      vec3 sc = shadeSurface(pS, rd, fp, dist, isW);
      bg = mix(bg, sc * Tr, cov);
    }
    col = S * (1.0 + 0.16 * uKick) + bg;       // the limb breathes on the soft kicks

    if (cA > 0.0) {
      vec3 behind = col - SS;              // in-scatter behind the cloud + attenuated surface
      col = SS + TS * cCol * cA + behind * (1.0 - cA);
    }
  }
  // whiteout as the camera enters the cloud deck
  col = mix(col, vec3(0.9, 0.93, 0.97) * uSunI * 0.62, uFog);
  fragColor = vec4(col, 1.0);
}`;
