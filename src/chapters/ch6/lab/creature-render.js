// VI lab: two renderers for lab/creatures.js poses, one fullscreen pass each, sharing the same
// primitive list (a float texture: A = (a.xyz, ra), B = (b.xyz, rb), M = (blend k, kind, thin, far)).
//
//   'sil'  : INTRICATE SILHOUETTE. The creature is a 2D signed-distance shape on its own plane
//            (exact uneven capsules, Quilez), cut-paper style (Reiniger): near-black body, eye holes
//            and mouth slits cut through, far-side limbs a shade lighter so crossing legs read.
//            Light: (1) transmission through the body along the view ray — the chord of each
//            limb, exp(−σ·chord) with σ_red ≪ σ_green < σ_blue (haemoglobin), so thin parts (ears,
//            fins, toes, fur tips) glow red-orange and every edge gets a physically thin halo;
//            (2) a sky-driven rim: the radiance of the sky just behind the edge, strongest on edges
//            facing the sun; (3) fur: the edge is broken into hair strands that transmit.
//   'real' : 3D SDF raymarch (Quilez round cones + smooth union), bounded by the creature's box:
//            skin albedo + procedural scale/wrinkle bump, wrap-lit sun, marched thickness for
//            translucency, sky fill, SDF ambient occlusion, Fresnel rim.
// Both: a telephoto camera side-on, wet sand that mirrors the sunset (and the creature), a long
// soft shadow toward the camera, the sea beyond; optional torch flame (emissive, flickering).
//
// Primitive texture: 4 texels per primitive (A, B, M, X = (fur 0..1, –, –, –)).
// Output: linear HDR (pre-tonemap), like every ch6 pass. Pure function of the uniforms.
import * as THREE from '../../../vendor/three.module.js';

export const MAXP = 240;

// A compact sunset sky, used when the caller doesn't inject ch6's GL_SKY. An injected sky chunk must
// declare the same uniforms (ch6's GL_UNIFORMS does: uSunDir … uCamPos, uT).
export const DEFAULT_SKY = /* glsl */`
uniform vec3 uSunDir, uSunCol, uSkyZen, uSkyHor, uSkyHor2, uSkyMid, uCamPos; uniform float uSunDisk, uDusk, uT;
vec3 skyColor(vec3 d, bool withSun) {
  float y = max(d.y, 0.0), mu = dot(d, uSunDir);
  vec2 a2 = normalize(d.xz + 1e-5), b2 = normalize(uSunDir.xz + 1e-5);
  float toSun = pow(max(0.5 + 0.5 * dot(a2, b2), 0.0), 2.0);
  vec3 hor = mix(uSkyHor2, uSkyHor, toSun);
  vec3 c = mix(uSkyZen, mix(uSkyMid, uSkyHor2, 0.3), exp(-y * 4.0));
  c = mix(c, hor, exp(-y * 11.0));
  float m = max(mu, 0.0);
  c += uSunCol * (0.02 * pow(m, 5.0) + 0.035 * pow(m, 24.0) + 0.09 * pow(m, 110.0) + 0.9 * pow(m, 2400.0));
  if (withSun) { float ang = acos(clamp(mu, -1.0, 1.0)); c += (1.0 - smoothstep(0.0122, 0.0135, ang)) * normalize(uSunCol + 1e-4) * 1.7 * uSunDisk; }
  return c * (1.0 - uDusk);
}`;

const COMMON = /* glsl */`
uniform sampler2D uPrims;
uniform int uN0, uN1;
uniform float uMorph;                  // 0 = set 0 … 1 = set 1
uniform vec4 uXf0, uXf1;              // per set: world offset xyz, world units per real metre
uniform mat4 uInvProj, uCamWorld;
uniform float uPx, uSeaZ, uWaterFront, uShadowOn, uScroll;
uniform vec3 uFlame; uniform float uFlameOn;
uniform vec4 uBox;                     // creature plane bbox (local xy min/max) for culling
// the walk's LOCAL frame: creature plane z = 0, ground y = 0; uRot maps local → world directions,
// uOrigin is the local origin in world space (identity / 0 = world). Optional background texture.
uniform mat3 uRot; uniform vec3 uOrigin; uniform sampler2D uBg; uniform float uBgOn;
uniform vec4 uShore;                   // sea where z < mix(shore.z, shore.w, smoothstep(shore.x, shore.y, x))
uniform vec3 uClip;                    // creature hidden below the water: depth = clamp((x0 − x)·slope, 0, max)
uniform vec4 uRip[8];                  // footfall ripples on the wet sand: (x, z, age s, amplitude)
uniform float uFlameGain;
// per set: x = chord scale (display thickness / real), y = transmission gain, z = wet sheen, w = warm (0 blood-red … 1 amber)
uniform vec4 uLook0, uLook1;
float seaZ(float x) { return mix(uShore.z, uShore.w, smoothstep(uShore.x, uShore.y, x)); }
float clipDepth(float x) { return clamp((uClip.x - x) * uClip.y, 0.0, uClip.z); }
vec3 sunL;                             // sun direction in the local frame (set in main)
vec3 skyL(vec3 dLocal, bool withSun) { return skyColor(uRot * dLocal, withSun); }
float h12(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vn2(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h12(i), h12(i + vec2(1, 0)), f.x), mix(h12(i + vec2(0, 1)), h12(i + vec2(1, 1)), f.x), f.y); }
float fbm2(vec2 p) { return 0.5 * vn2(p) + 0.25 * vn2(p * 2.03 + 7.1) + 0.125 * vn2(p * 4.1 - 3.3); }
float cro(vec2 a, vec2 b) { return a.x * b.y - a.y * b.x; }
// exact 2D uneven capsule (Quilez), also returns the parameter along the axis
float sdUC(vec2 p, vec2 pa, vec2 pb, float ra, float rb, out float hh) {
  p -= pa; pb -= pa;
  float h = dot(pb, pb);
  hh = clamp(dot(p, pb) / max(h, 1e-12), 0.0, 1.0);
  float b = ra - rb;
  if (h <= b * b + 1e-12) { return min(length(p) - ra, length(p - pb) - rb); }
  vec2 q = vec2(dot(p, vec2(pb.y, -pb.x)), dot(p, pb)) / h;
  q.x = abs(q.x);
  vec2 c = vec2(sqrt(h - b * b), b);
  float k = cro(c, q), m = dot(c, q), n = dot(q, q);
  if (k < 0.0) return sqrt(h * n) - ra;
  else if (k > c.x) return sqrt(h * (n + 1.0 - 2.0 * q.y)) - rb;
  return m - ra;
}
// exact 3D round cone (Quilez)
float sdRC(vec3 p, vec3 a, vec3 b, float r1, float r2) {
  vec3 ba = b - a; float l2 = dot(ba, ba); float rr = r1 - r2; float a2 = l2 - rr * rr; float il2 = 1.0 / max(l2, 1e-12);
  if (a2 <= 1e-10) return length(p - (r1 > r2 ? a : b)) - max(r1, r2);
  vec3 pa = p - a; float y = dot(pa, ba); float z = y - l2;
  vec3 xv = pa * l2 - ba * y; float x2 = dot(xv, xv); float y2 = y * y * l2; float z2 = z * z * l2;
  float k = sign(rr) * rr * rr * x2;
  if (sign(z) * a2 * z2 > k) return sqrt(x2 + z2) * il2 - r2;
  if (sign(y) * a2 * y2 < k) return sqrt(x2 + y2) * il2 - r1;
  return (sqrt(x2 * a2 * il2) + y * rr) * il2 - r1;
}
vec3 rayDir(vec2 uv) { vec4 v = uInvProj * vec4(uv * 2.0 - 1.0, 1.0, 1.0); return normalize(mat3(uCamWorld) * (v.xyz / v.w)); }
void fetchP(int set, int i, out vec4 A, out vec4 B, out vec4 M) {
  A = texelFetch(uPrims, ivec2(i * 4, set), 0); B = texelFetch(uPrims, ivec2(i * 4 + 1, set), 0); M = texelFetch(uPrims, ivec2(i * 4 + 2, set), 0);
}
float furOf(int set, int i) { return texelFetch(uPrims, ivec2(i * 4 + 3, set), 0).x; }
// ---- 2D silhouette field of one set: near (x) and far (y) distance + attributes of the near shape
// attr: x = chord thickness (real mm), y = fur, z = membrane/ear (thin), w = wood
void sil2(int set, vec2 p, out vec2 d, out vec4 attr, out vec4 attrF) {
  int n = set == 0 ? uN0 : uN1;
  vec4 xf = set == 0 ? uXf0 : uXf1;
  float cs = set == 0 ? uLook0.x : uLook1.x;
  float dn = 1e9, df = 1e9, cut = 1e9;
  attr = vec4(100.0, 0.0, 0.0, 0.0); attrF = attr;
  for (int i = 0; i < ${MAXP}; i++) {
    if (i >= n) break;
    vec4 A, B, M; fetchP(set, i, A, B, M);
    vec2 a = A.xy * xf.w + xf.xy, b = B.xy * xf.w + xf.xy;
    float ra = A.w * xf.w, rb = B.w * xf.w;
    // cheap reject: farther than the capsule's bounding circle + blend radius from both groups
    vec2 cmid = 0.5 * (a + b); float rbnd = 0.5 * length(b - a) + max(ra, rb) + M.x * xf.w;
    float dc = length(p - cmid) - rbnd;
    bool isFar = M.w > 0.5;
    if (dc > (isFar ? df : dn) + 0.02 * xf.w && M.y != 5.0) continue;
    float hh; float di = sdUC(p, a, b, ra, rb, hh);
    if (abs(M.y - 5.0) < 0.5) { cut = min(cut, di); continue; }
    float rl = mix(ra, rb, hh);
    float inset = rl + min(di, 0.0);
    float chord = 2.0 * sqrt(max(0.0, rl * rl - inset * inset)) / xf.w * 1000.0 * cs;  // mm (real, or displayed when cs = k)
    bool thin = abs(M.y - 1.0) < 0.5 || abs(M.y - 6.0) < 0.5;
    // z: local radius in mm (flesh) or −1 (thin sheets); w: mm per world unit
    float mmPer = 1000.0 * cs / xf.w;
    vec4 at = vec4(thin ? min(chord, M.z * 1000.0) : chord, furOf(set, i), thin ? -1.0 : rl * mmPer, mmPer);
    // fin rays: dark cores inside membranes
    if (abs(M.y - 1.0) < 0.5) at.x = mix(at.x, 3.0, (1.0 - smoothstep(0.1 * rl, 0.45 * rl, abs(inset - rl))));
    float k = M.x * xf.w;
    if (isFar) {
      if (k > 0.0) { float h = clamp(0.5 + 0.5 * (df - di) / k, 0.0, 1.0); df = mix(df, di, h) - k * h * (1.0 - h); attrF = mix(attrF, at, h); }
      else if (di < df) { df = di; attrF = at; }
    } else {
      if (k > 0.0) { float h = clamp(0.5 + 0.5 * (dn - di) / k, 0.0, 1.0); dn = mix(dn, di, h) - k * h * (1.0 - h); attr = mix(attr, at, h); }
      else if (di < dn) { dn = di; attr = at; }
    }
  }
  dn = max(dn, -cut);
  d = vec2(dn, df);
}
void silField(vec2 p, out vec2 d, out vec4 attr, out vec4 attrF) {
  vec2 d0; vec4 a0, f0;
  sil2(0, p, d0, a0, f0);
  if (uMorph > 0.001) {
    vec2 d1; vec4 a1, f1;
    sil2(1, p, d1, a1, f1);
    // mass-preserving morph: the interpolated field, inflated mid-way, united with the outgoing
    // shape eroding away and the incoming one dilating in (plain SDF lerp makes non-overlapping
    // parts vanish mid-morph)
    float w = uMorph, s = 0.32 * uXf0.w / max(uXf0.w, 1e-6) * 0.35;
    vec2 dl = mix(d0, d1, w) - 0.05 * 4.0 * w * (1.0 - w);
    vec2 du = min(d0 + s * w * w, d1 + s * (1.0 - w) * (1.0 - w));
    d = min(dl, du);
    attr = mix(a0, a1, w); attrF = mix(f0, f1, w);
  } else { d = d0; attr = a0; attrF = f0; }
}
// torch flame: a flickering teardrop of blackbody light rising from the torch head
vec3 flameAt(vec2 p, out float cov) {
  cov = 0.0;
  if (uFlameOn < 0.5) return vec3(0.0);
  vec2 q = (p - uFlame.xy) / uFlame.z;                  // flame units (1 = flame height)
  if (q.y < -0.35 || q.y > 1.4 || abs(q.x) > 0.8) return vec3(0.0);
  float t = uT;
  float n1 = fbm2(vec2(q.x * 3.0, q.y * 2.2 - t * 5.5)), n2 = fbm2(vec2(q.x * 7.0 + 3.0, q.y * 5.0 - t * 9.0));
  float sway = 0.12 * sin(t * 7.3 + q.y * 3.0) * q.y;
  float w = 0.26 * pow(max(0.0, 1.0 - q.y), 0.65) * smoothstep(-0.35, 0.05, q.y) * (0.75 + 0.5 * n1);
  float dd = abs(q.x - sway - (n2 - 0.5) * 0.25 * q.y) - w;
  float e = (1.0 - smoothstep(-0.05, 0.03, dd)) * (1.0 - smoothstep(0.3, 1.35, q.y + (n1 - 0.5) * 0.6));
  cov = e;
  float core = (1.0 - smoothstep(-0.12, 0.0, dd)) * (1.0 - smoothstep(0.0, 0.7, q.y));
  vec3 hot = vec3(1.0, 0.72, 0.38) * 9.0, mid = vec3(1.0, 0.36, 0.07) * 4.5, tip = vec3(0.9, 0.16, 0.02) * 1.4;
  vec3 c = mix(mid, hot, core);
  c = mix(c, tip, smoothstep(0.35, 1.2, q.y + (1.0 - e) * 0.3));
  return c * e * uFlameGain;
}
// ground: wet sand in front, the sea behind the shoreline (z < uSeaZ); returns shaded colour
vec3 groundAt(vec3 ro, vec3 rd, float tg, float silMirror, float mirrorFar, float shadow) {
  vec3 G = ro + rd * tg;
  bool sea = G.z < seaZ(G.x) || uWaterFront > 0.5;
  vec2 q = vec2(G.x + uScroll, G.z);
  // footfall ripples: rings spreading through the wet film from each planted foot
  vec2 rip = vec2(0.0);
  for (int i = 0; i < 8; i++) {
    vec4 R = uRip[i];
    if (R.w <= 0.0 || R.z < 0.0 || R.z > 1.6) continue;
    vec2 d = vec2(G.x - R.x, (G.z - R.y) * 1.0);
    float r = length(d), front = R.z * 1.1;
    float rf = (r - front) / 0.12;
    float ring = sin((r - front) * 38.0) * exp(-rf * rf) * exp(-R.z * 2.2) * R.w;
    rip += d / max(r, 1e-3) * ring;
  }
  // micro-normal: capillary ripples on water, a wet film with dry patches on the sand
  float wet = sea ? 1.0 : smoothstep(0.35, 0.65, fbm2(q * 0.35) + 0.25 * fbm2(q * 2.1)) * 0.8 + 0.2;
  float amp = sea ? 0.06 : 0.02;
  vec2 g = vec2(fbm2(q * vec2(0.4, 1.3) + vec2(uT * 0.25, 0.0)) - 0.5, fbm2(q * vec2(0.4, 1.3) + vec2(3.1, uT * 0.18)) - 0.5);
  vec3 n = normalize(vec3(g.x * amp + rip.x * 0.08, 1.0, g.y * amp * 3.0 + rip.y * 0.08));
  vec3 r = reflect(rd, n);
  r.y = abs(r.y);
  float F = 0.02 + 0.98 * pow(1.0 - max(dot(-rd, n), 0.0), 5.0);
  vec3 refl = skyL(normalize(r + vec3(0.0, 0.004, 0.0)), true);
  // the creature's mirror image (dark), weaker on the rougher sand
  refl = mix(refl, refl * 0.03, silMirror);
  refl = mix(refl, mix(refl * 0.03, refl, 0.12), mirrorFar * (1.0 - silMirror));
  vec3 sand = vec3(0.10, 0.075, 0.05) * (0.7 + 0.5 * fbm2(q * 3.0));
  vec3 skyAmb = skyColor(vec3(0.0, 1.0, 0.0), false) * 0.6 + skyColor(normalize(vec3(-uSunDir.x, 0.1, -uSunDir.z)), false) * 0.3;
  vec3 diff = sand * (skyAmb + uSunCol * max(uSunDir.y, 0.0) * 0.6 * shadow);
  vec3 c = mix(diff, refl, F * wet * (sea ? 1.0 : 0.92));
  return c;
}
`;

function fsSil(skyGLSL) {
  return /* glsl */`
precision highp float; precision highp int;
${skyGLSL}
${COMMON}
in vec2 vUv; out vec4 fragColor;
vec3 shadeSil(vec3 bg, vec2 p, float d, vec4 at, float pxw, vec3 sunS, bool farSide) {
  // fine detail is sized in WORLD units (calibrated so 1 unit ≈ one 1080p pixel on the creature
  // plane), so a 960-px draft shows the same hair as the final, just less resolved
  const float HP = 0.00206;
  // hair strands: break the edge of furred regions into fine transmitting fibres
  float furW = 0.0;
  if (at.y > 0.02) {
    vec2 gd = vec2(dFdx(d), dFdy(d));
    vec2 nn = length(gd) > 1e-9 ? normalize(gd) : vec2(0.0, 1.0);
    vec2 tt = vec2(-nn.y, nn.x);
    float s1 = dot(p, tt) / HP, s2 = dot(p, nn) / HP;
    float hair = vn2(vec2(s1 * 0.55, s2 * 0.08)) * 0.75 + vn2(vec2(s1 * 1.3 + 9.0, s2 * 0.2)) * 0.25;
    furW = HP * 7.0 * at.y;
    d -= furW * pow(hair, 2.2);
  }
  float fw = max(fwidth(d), pxw * 0.5);
  float cov = clamp(0.5 - d / fw, 0.0, 1.0);
  if (cov <= 0.0) return bg;
  // light through the body along the view ray: haemoglobin-red transmission of the backlight
  float mm = at.x;
  // flesh: the chord can't be thinner than the depth inside the BLENDED outline allows (smooth-union
  // fillets lie outside every single primitive; without this they'd render as see-through bands)
  if (at.z > 0.0) { float dep = max(-d, 0.0) * at.w; mm = max(mm, 2.0 * sqrt(max(0.0, dep * (2.0 * at.z - dep)))); }
  if (furW > 0.0 && d > -furW * 1.2) mm = min(mm, mix(2.5, 0.3, smoothstep(-furW * 1.2, 0.0, d)));   // only the fringe of fibres
  vec4 look = mix(uLook0, uLook1, uMorph);
  vec3 sig = mix(vec3(0.55, 2.1, 3.6), vec3(0.4, 0.62, 1.25), look.w);
  vec3 trans = bg * exp(-sig * mm) * 0.9 * look.y;
  if (furW > 0.0 && d > -furW * 1.2) {
    // hair is keratin, not blood: fibres scatter the backlight golden-white, and only where they
    // are sparse enough to be seen through (the outer tips)
    float tipness = smoothstep(-furW * 1.2, 0.0, d);
    trans = bg * vec3(0.55, 0.42, 0.26) * tipness * tipness * 0.55;
  }
  // rim: the bright sky just behind an edge scatters round it (strongest facing the sun)
  vec2 gd = vec2(dFdx(d), dFdy(d));
  vec2 nn = length(gd) > 1e-9 ? normalize(gd) : vec2(0.0);
  float facing = 0.35 + 0.65 * max(dot(nn, sunS.xy), 0.0);
  float rim = exp(min(d, 0.0) / max(HP * 1.3, pxw * 0.7)) * facing * 0.35;
  vec3 body = vec3(0.0032, 0.0024, 0.0021) + bg * 0.004;
  vec3 c = body + trans + bg * rim;
  // wet skin: a thin specular sheen along the upward-facing edge, mirroring the sky above
  if (look.z > 0.0) {
    float up = max(nn.y, 0.0);
    float band = exp(min(d, 0.0) / max(HP * 2.2, pxw * 0.9)) * (1.0 - exp(min(d, 0.0) / max(HP * 0.5, pxw * 0.3)) * 0.6);
    c += (bg * 0.55 + skyL(vec3(0.0, 1.0, 0.0), false) * 0.8) * up * up * band * look.z;
  }
  // torch light on the edges facing the flame
  if (uFlameOn > 0.5) {
    vec2 fl = uFlame.xy + vec2(0.0, uFlame.z * 0.35);
    float dist = length(p - fl);
    float fac = max(dot(nn, normalize(fl - p)), 0.0);
    c += vec3(1.0, 0.45, 0.12) * 0.9 * uFlame.z * uFlame.z / (dist * dist + uFlame.z * uFlame.z * 0.2) * (exp(min(d, 0.0) / (HP * 3.0)) * fac * 0.8 + 0.03);
  }
  if (farSide) c = mix(c, bg * 0.35 + c, 0.07);
  return mix(bg, c, cov);
}
void main() {
  vec3 rdW = rayDir(vUv);
  vec3 rd = transpose(uRot) * rdW, ro = transpose(uRot) * (uCamPos - uOrigin);
  sunL = transpose(uRot) * uSunDir;
  float tp = -ro.z / rd.z;                               // creature plane z = 0
  vec3 P = ro + rd * tp;
  float tg = rd.y < 0.0 ? -ro.y / rd.y : 1e9;
  float pxw = uPx * tp;                                   // world size of a pixel on the plane
  // screen direction toward the sun (for rim orientation)
  vec3 sunS = normalize(vec3(sunL.x, sunL.y + 0.02, 0.0));
  vec3 col;
  if (tg < tp) {
    // ground in front of the creature plane: reflection samples the mirrored silhouette
    vec3 G = ro + rd * tg;
    vec2 m = vec2(P.x, -P.y) + (vec2(fbm2(G.xz * vec2(1.5, 5.0)), fbm2(G.xz * vec2(1.5, 5.0) + 4.0)) - 0.5) * vec2(0.03, 0.05) * uXf0.w;
    float sm = 0.0, smf = 0.0;
    if (m.x > uBox.x - 0.3 && m.x < uBox.z + 0.3 && m.y < uBox.w + 0.3 && m.y > clipDepth(m.x)) {
      vec2 d; vec4 at, af; silField(m, d, at, af);
      float fw = pxw * 3.0;
      sm = clamp(0.5 - d.x / fw, 0.0, 1.0); smf = clamp(0.5 - d.y / fw, 0.0, 1.0);
      vec3 fcol; float fcov = 0.0; fcol = flameAt(m, fcov);
    }
    // long soft shadow toward the camera (sun just above the horizon, behind the creature)
    float sh = 1.0;
    if (uShadowOn > 0.5 && sunL.y > 0.0 && G.z > 0.0 && uBgOn < 0.5) {
      float ts = -G.z / sunL.z;
      vec3 S = G + sunL * ts;
      if (S.x > uBox.x - 0.5 && S.x < uBox.z + 0.5) {
        vec2 d; vec4 at, af; silField(S.xy, d, at, af);
        float blur = ts * 0.0135 + pxw;
        sh = 1.0 - 0.85 * clamp(0.5 - min(d.x, d.y) / blur, 0.0, 1.0);
      }
    }
    vec4 bgs = texture(uBg, vUv);
    bool land = uBgOn > 1.5 && bgs.a > 0.0 && bgs.a < 2500.0;
    if (uBgOn > 0.5 && uBgOn < 1.5) col = bgs.rgb * (1.0 - 0.8 * sm - 0.1 * smf);
    else if (land) col = bgs.rgb;
    else col = groundAt(ro, rd, tg, sm, smf, sh);
    float fc; vec3 fr = flameAt(vec2(P.x, -P.y), fc);
    col += fr * 0.35;
  } else {
    col = skyL(rd, true);
    // the sea & far shore meet the sky at the horizon: ground beyond the plane
    if (rd.y < 0.0) col = groundAt(ro, rd, tg, 0.0, 0.0, 1.0);
    vec4 bgs = texture(uBg, vUv);
    if (uBgOn > 0.5 && uBgOn < 1.5) col = bgs.rgb;
    // hybrid: the chapter's air view above the horizon (sky, birds, far land) and wherever it sees land
    if (uBgOn > 1.5 && (rd.y >= 0.0 || (bgs.a > 0.0 && bgs.a < 2500.0))) col = bgs.rgb;
    if (P.x > uBox.x && P.x < uBox.z && P.y > uBox.y + clipDepth(P.x) && P.y < uBox.w) {
      vec2 d; vec4 at, af; silField(P.xy, d, at, af);
      col = shadeSil(col, P.xy, d.y, af, pxw, sunS, true);
      col = shadeSil(col, P.xy, d.x, at, pxw, sunS, false);
    }
    float fc; vec3 fl = flameAt(P.xy, fc);
    col = mix(col, fl, clamp(fc, 0.0, 1.0) * 0.85) + fl * 0.3;
  }
  fragColor = vec4(col, 1.0);
}`;
}

function fsReal(skyGLSL) {
  return /* glsl */`
precision highp float; precision highp int;
${skyGLSL}
${COMMON}
uniform vec3 uBoxMin, uBoxMax;
uniform vec3 uAlb0, uAlb1, uAlb0b, uAlb1b; uniform vec4 uSkin0, uSkin1;   // skin: x scales, y fur, z wet, w spots
in vec2 vUv; out vec4 fragColor;
float map3(int set, vec3 p, out float cutd) {
  int n = set == 0 ? uN0 : uN1;
  vec4 xf = set == 0 ? uXf0 : uXf1;
  float d = 1e9; cutd = 1e9;
  for (int i = 0; i < ${MAXP}; i++) {
    if (i >= n) break;
    vec4 A, B, M; fetchP(set, i, A, B, M);
    vec3 a = A.xyz * xf.w + xf.xyz, b = B.xyz * xf.w + xf.xyz;
    float ra = A.w * xf.w, rb = B.w * xf.w, k = M.x * xf.w;
    vec3 cm = 0.5 * (a + b); float rbnd = 0.5 * length(b - a) + max(ra, rb);
    float dc = length(p - cm) - rbnd;
    if (dc > d + k + 0.01) continue;
    float di = sdRC(p, a, b, ra, rb);
    if (abs(M.y - 5.0) < 0.5) { cutd = min(cutd, di); continue; }
    if (abs(M.y - 1.0) < 0.5 || abs(M.y - 6.0) < 0.5) di = max(di, -di - 0.004 * xf.w) + 0.0;   // thin sheets stay thin
    if (k > 0.0) { float h = clamp(0.5 + 0.5 * (d - di) / k, 0.0, 1.0); d = mix(d, di, h) - k * h * (1.0 - h); }
    else d = min(d, di);
  }
  return d;
}
float mapS(vec3 p) {
  float c0; float d = map3(0, p, c0);
  if (uMorph > 0.001) { float c1; float d1 = map3(1, p, c1); float w = uMorph;
    d = min(mix(d, d1, w) - 0.05 * 4.0 * w * (1.0 - w), min(d + 0.11 * w * w, d1 + 0.11 * (1.0 - w) * (1.0 - w))); }
  return d;
}
vec3 calcN(vec3 p, float e) {
  vec2 k = vec2(1, -1);
  vec3 g = k.xyy * mapS(p + k.xyy * e) + k.yyx * mapS(p + k.yyx * e) + k.yxy * mapS(p + k.yxy * e) + k.xxx * mapS(p + k.xxx * e);
  float l = length(g);
  return l > 1e-9 && l < 1e9 ? g / l : vec3(0.0, 0.0, 1.0);          // never NaN (a NaN becomes a bloom firefly)
}
vec2 boxHit(vec3 ro, vec3 rd) {
  vec3 ir = 1.0 / rd, t0 = (uBoxMin - ro) * ir, t1 = (uBoxMax - ro) * ir;
  vec3 tmin = min(t0, t1), tmax = max(t0, t1);
  return vec2(max(max(tmin.x, tmin.y), tmin.z), min(min(tmax.x, tmax.y), tmax.z));
}
void main() {
  vec3 rdW = rayDir(vUv);
  vec3 rd = transpose(uRot) * rdW, ro = transpose(uRot) * (uCamPos - uOrigin);
  sunL = transpose(uRot) * uSunDir;
  float tp = -ro.z / rd.z;
  vec3 P = ro + rd * tp;
  float tg = rd.y < 0.0 ? -ro.y / rd.y : 1e9;
  float pxw = uPx * tp;
  vec3 bg;
  float tMax = min(tg, 1e8);
  if (tg < 1e8) {
    // ground: reflection uses the mirrored 2D silhouette (a backlit creature mirrors as a dark shape)
    vec3 G = ro + rd * tg;
    vec2 m = vec2(P.x, -P.y);
    float sm = 0.0, smf = 0.0, sh = 1.0;
    if (tg < tp && m.x > uBox.x - 0.3 && m.x < uBox.z + 0.3) {
      vec2 d; vec4 at, af; silField(m, d, at, af);
      sm = clamp(0.5 - d.x / (pxw * 3.0), 0.0, 1.0); smf = clamp(0.5 - d.y / (pxw * 3.0), 0.0, 1.0);
    }
    if (uShadowOn > 0.5 && G.z > 0.0) {
      float ts = -G.z / sunL.z; vec3 S = G + sunL * ts;
      if (S.x > uBox.x - 0.5 && S.x < uBox.z + 0.5) { vec2 d; vec4 at, af; silField(S.xy, d, at, af); sh = 1.0 - 0.85 * clamp(0.5 - min(d.x, d.y) / (ts * 0.0135 + pxw), 0.0, 1.0); }
    }
    bg = uBgOn > 0.5 ? texture(uBg, vUv).rgb * (1.0 - 0.8 * sm - 0.1 * smf) : groundAt(ro, rd, tg, sm, smf, sh);
  } else bg = uBgOn > 0.5 ? texture(uBg, vUv).rgb : skyL(rd, true);
  vec3 col = bg;
  vec2 bh = boxHit(ro, rd);
  if (bh.x < bh.y && bh.y > 0.0) {
    float t = max(bh.x, 0.0), tEnd = min(bh.y, tMax);
    float hit = -1.0, minD = 1e9, minT = t;
    for (int i = 0; i < 110; i++) {
      if (t > tEnd) break;
      vec3 p = ro + rd * t;
      float d = mapS(p);
      float px = uPx * t;
      if (d < minD / 1.0 && d / px < minD) { minD = d / px; minT = t; }
      if (d < px * 0.3) { hit = t; break; }
      t += max(d * 0.9, px * 0.25);
    }
    float cov = hit > 0.0 ? 1.0 : clamp(1.0 - minD, 0.0, 1.0) * (minD < 1.0 ? 1.0 : 0.0);   // edge AA from the closest approach
    if (cov > 0.0) {
      float th = hit > 0.0 ? hit : minT;
      vec3 p = ro + rd * th;
      float px = uPx * th;
      vec3 n = calcN(p, px * 0.5);
      vec3 v = -rd, L = sunL;
      int set = uMorph > 0.5 ? 1 : 0;
      vec4 xf = set == 0 ? uXf0 : uXf1;
      vec4 skin = mix(uSkin0, uSkin1, uMorph);
      vec3 alb = mix(uAlb0, uAlb1, uMorph), alb2 = mix(uAlb0b, uAlb1b, uMorph);
      vec3 q = (p - xf.xyz) / xf.w;
      // pattern: belly/back two-tone + spots; bump: scales (cellular) or wrinkles; fur sheen
      float back = smoothstep(-0.3, 0.6, n.y);
      alb = mix(alb2, alb, back);
      float sp = smoothstep(0.62, 0.7, vn2(q.xy * 60.0 / max(skin.w, 1e-3))) * step(0.001, skin.w);
      alb = mix(alb, vec3(0.28, 0.2, 0.03), sp);
      float sc = 0.0;
      if (skin.x > 0.0) { vec2 g = q.xy * skin.x; sc = abs(fract(g.x + 0.5 * floor(g.y)) - 0.5) + abs(fract(g.y) - 0.5); }
      vec3 bump = vec3(vn2(q.xy * 400.0) - 0.5, vn2(q.yx * 400.0 + 3.0) - 0.5, 0.0) * 0.25 + vec3(0.0, 0.0, 0.0);
      n = normalize(n + bump * (skin.y > 0.5 ? 0.6 : 0.25) + vec3(0.0, sc * 0.25, 0.0));
      float nl = dot(n, L);
      // translucency: march through the body toward the sun
      float thick = 0.0, st = 0.02 * xf.w;
      for (int j = 1; j <= 10; j++) { float dd = mapS(p - n * px + L * st * float(j)); if (dd < 0.0) thick += st; }
      vec3 T = exp(-vec3(0.55, 2.1, 3.6) * thick / xf.w * 1000.0) * skyL(L, false) * 0.35;
      // ambient occlusion
      float ao = 0.0, sca = 1.0;
      for (int j = 1; j <= 5; j++) { float hh = 0.012 * xf.w * float(j); ao += (hh - mapS(p + n * hh)) * sca; sca *= 0.8; }
      ao = clamp(1.0 - 3.0 * ao / xf.w * 3.0, 0.0, 1.0);
      vec3 skyN = skyL(normalize(n + vec3(0.0, 0.3, 0.0)), false);
      float wrap = max((nl + 0.35) / 1.35, 0.0);
      vec3 c = alb * (uSunCol * wrap * 0.8 + skyN * ao * 0.9) + alb * T * 3.0 * (1.0 - wrap);
      float fres = pow(1.0 - max(dot(n, v), 0.0), 4.0);
      c += skyL(reflect(rd, n), false) * fres * (skin.z > 0.0 ? 0.6 : 0.25) * ao;
      if (skin.y > 0.5) c += alb * skyL(-v, false) * pow(1.0 - max(dot(n, v), 0.0), 2.0) * 0.8;   // fur fuzz: backlit halo
      if (uFlameOn > 0.5) { vec3 fl = uFlame + vec3(0.0, uFlame.z * 0.35, 0.0) - p; float dl = length(fl); c += alb * vec3(1.0, 0.45, 0.12) * 1.5 * uFlame.z * uFlame.z / (dl * dl + 0.02) * max(dot(n, fl / dl), 0.0); }
      if (any(isnan(c)) || any(isinf(c))) c = vec3(0.0);
      col = mix(bg, c, cov);
    }
  }
  float fc; vec3 fl = flameAt(P.xy, fc);
  if (tg >= tp) col = mix(col, fl, clamp(fc, 0.0, 1.0) * 0.85) + fl * 0.3;
  fragColor = vec4(col, 1.0);
}`;
}

const VS = 'precision highp float; in vec3 position; out vec2 vUv; void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }';

/**
 * makeCreatureRenderer({ mode: 'sil' | 'real', skyGLSL, uniforms })
 *   uniforms: shared sky uniforms (uSunDir, uSunCol, uSkyZen, uSkyHor, uSkyHor2, uSkyMid, uSunDisk, uDusk, …)
 * render(renderer, target, cam, { A, B?, morph, t, H, seaZ, waterFront, flame, scroll, frame?, bg? })
 *   A / B: { pose (from poseCreature), world: [x, y, z], k: world units per real metre, skin, alb }
 *          (or a morphCreatures() result as A with B = null)
 *   frame: { rot: THREE.Matrix3 (local→world), origin: THREE.Vector3 } places the walk's local frame
 *          (creature plane z = 0, ground y = 0) anywhere in a chapter's world, so its camera can be used
 *   bg:    a texture to use instead of the built-in sky / wet sand (e.g. ch6's air-view image)
 */
export function makeCreatureRenderer({ mode = 'sil', skyGLSL = DEFAULT_SKY, uniforms = {} } = {}) {
  const data = new Float32Array(4 * MAXP * 2 * 4);
  const tex = new THREE.DataTexture(data, 4 * MAXP, 2, THREE.RGBAFormat, THREE.FloatType);
  tex.minFilter = tex.magFilter = THREE.NearestFilter; tex.needsUpdate = true;
  const U = {
    ...uniforms,
    uPrims: { value: tex }, uN0: { value: 0 }, uN1: { value: 0 }, uMorph: { value: 0 },
    uXf0: { value: new THREE.Vector4() }, uXf1: { value: new THREE.Vector4() },
    uInvProj: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() }, uCamPos: { value: new THREE.Vector3() },
    uT: uniforms.uT || { value: 0 }, uPx: { value: 0.001 }, uSeaZ: { value: -3 }, uWaterFront: { value: 0 }, uShadowOn: { value: 1 }, uScroll: { value: 0 },
    uFlame: { value: new THREE.Vector3() }, uFlameOn: { value: 0 }, uBox: { value: new THREE.Vector4() },
    uBoxMin: { value: new THREE.Vector3() }, uBoxMax: { value: new THREE.Vector3() },
    uAlb0: { value: new THREE.Vector3() }, uAlb1: { value: new THREE.Vector3() }, uAlb0b: { value: new THREE.Vector3() }, uAlb1b: { value: new THREE.Vector3() },
    uSkin0: { value: new THREE.Vector4() }, uSkin1: { value: new THREE.Vector4() },
    uRot: { value: new THREE.Matrix3() }, uOrigin: { value: new THREE.Vector3() }, uBgOn: { value: 0 },
    uShore: { value: new THREE.Vector4(0, 1, -3, -3) }, uClip: { value: new THREE.Vector3(-1e3, 0, 0) },
    uRip: { value: Array.from({ length: 8 }, () => new THREE.Vector4(0, 0, -1, 0)) }, uFlameGain: { value: 1 },
    uLook0: { value: new THREE.Vector4(1, 1, 0, 0) }, uLook1: { value: new THREE.Vector4(1, 1, 0, 0) },
    uBg: { value: (() => { const t = new THREE.DataTexture(new Uint8Array(4), 1, 1); t.needsUpdate = true; return t; })() },
  };
  for (const k of ['uSunDir', 'uSunCol', 'uSkyZen', 'uSkyHor', 'uSkyHor2', 'uSkyMid']) if (!U[k]) U[k] = { value: new THREE.Vector3(0.3, 0.3, 0.3) };
  if (!U.uSunDisk) U.uSunDisk = { value: 10 };
  if (!U.uDusk) U.uDusk = { value: 0 };
  const mat = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: VS, fragmentShader: mode === 'real' ? fsReal(skyGLSL) : fsSil(skyGLSL), uniforms: U, depthTest: false, depthWrite: false });
  const tri = new THREE.BufferGeometry();
  tri.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  const mesh = new THREE.Mesh(tri, mat); mesh.frustumCulled = false;
  const scene = new THREE.Scene(); scene.add(mesh);
  const ocam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  function upload(set, C) {
    const P = C.pose.prims;
    const n = Math.min(MAXP, P.length);
    for (let i = 0; i < n; i++) {
      const p = P[i], o = (set * 4 * MAXP + i * 4) * 4;
      data.set([p.a[0], p.a[1], p.a[2], p.ra, p.b[0], p.b[1], p.b[2], p.rb, p.k, p.kind, p.thick, p.far, p.fur ?? (p.kind === 2 ? 1 : 0), 0, 0, 0], o);
    }
    (set ? U.uN1 : U.uN0).value = n;
    (set ? U.uLook1 : U.uLook0).value.set(...(C.look || [1, 1, 0, 0]));
    (set ? U.uXf1 : U.uXf0).value.set(C.world[0], C.world[1], C.world[2], C.k);
    if (C.alb) (set ? U.uAlb1 : U.uAlb0).value.set(...C.alb[0]), (set ? U.uAlb1b : U.uAlb0b).value.set(...C.alb[1]);
    if (C.skin) (set ? U.uSkin1 : U.uSkin0).value.set(...C.skin);
    // bounds (world)
    let b = [1e9, 1e9, 1e9, -1e9, -1e9, -1e9];
    for (let i = 0; i < n; i++) {
      const p = P[i], r = Math.max(p.ra, p.rb) + p.k;
      for (const q of [p.a, p.b]) for (let c = 0; c < 3; c++) {
        const w = q[c] * C.k + C.world[c];
        b[c] = Math.min(b[c], w - r * C.k); b[c + 3] = Math.max(b[c + 3], w + r * C.k);
      }
    }
    return b;
  }
  return {
    material: mat, uniforms: U,
    render(renderer, target, cam, o) {
      const bA = upload(0, o.A);
      let bb = bA;
      if (o.B && o.morph > 0.001) {
        const bB = upload(1, o.B);
        bb = bA.map((v, i) => i < 3 ? Math.min(v, bB[i]) : Math.max(v, bB[i]));
        U.uMorph.value = o.morph;
      } else U.uMorph.value = 0;
      tex.needsUpdate = true;
      const pad = 0.05 * o.A.k;
      U.uBox.value.set(bb[0] - pad, bb[1] - pad, bb[3] + pad, bb[4] + pad);
      U.uBoxMin.value.set(bb[0] - pad, bb[1] - pad, bb[2] - pad); U.uBoxMax.value.set(bb[3] + pad, bb[4] + pad, bb[5] + pad);
      U.uInvProj.value.copy(cam.projectionMatrixInverse); U.uCamWorld.value.copy(cam.matrixWorld); U.uCamPos.value.copy(cam.position);
      U.uPx.value = 2 * Math.tan(cam.fov * Math.PI / 360) / o.H;
      U.uT.value = o.t;
      U.uScroll.value = o.scroll ?? 0;
      U.uSeaZ.value = o.seaZ ?? -3; U.uWaterFront.value = o.waterFront ? 1 : 0;
      if (o.flame) { U.uFlameOn.value = 1; U.uFlame.value.set(...o.flame); } else U.uFlameOn.value = 0;
      // local frame of the walk (defaults: world) and optional background (e.g. ch6's air view output)
      if (o.frame) { U.uRot.value.copy(o.frame.rot); U.uOrigin.value.copy(o.frame.origin); } else { U.uRot.value.identity(); U.uOrigin.value.set(0, 0, 0); }
      if (o.bg) { U.uBg.value = o.bg; U.uBgOn.value = o.hybrid ? 2 : 1; } else U.uBgOn.value = 0;
      if (o.shore) U.uShore.value.set(...o.shore); else U.uShore.value.set(0, 1, o.seaZ ?? -3, o.seaZ ?? -3);
      if (o.clip) U.uClip.value.set(...o.clip); else U.uClip.value.set(-1e3, 0, 0);
      for (let i = 0; i < 8; i++) { const r = o.ripples && o.ripples[i]; if (r) U.uRip.value[i].set(...r); else U.uRip.value[i].set(0, 0, -1, 0); }
      U.uFlameGain.value = o.flameGain ?? 1;
      renderer.setRenderTarget(target);
      renderer.render(scene, ocam);
    },
  };
}
