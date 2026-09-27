// GLSL for II · INFLATION. Particle positions are a pure function of (seed, t): a GPGPU pass
// evaluates them into a float texture (once for t, once for t - shutter), and instanced
// capsule sprites fetch them. No state is carried between frames.

// ------------------------------------------------------------------ comoving positions
export const PARTICLE_COMMON = /* glsl */`
uniform float Rxy, Rf, Rb;
// Comoving position: uniform inside an "egg" (a front half-ellipsoid toward the camera and a
// long back half-ellipsoid ahead of it). From the camera the silhouette is a circle.
vec3 comoving(uint id, out float u) {
  vec3 h = hash3U(id * 2u + 11u);
  float fr = hashU(id * 2u + 12u);
  float z = h.x * 2.0 - 1.0;
  float ph = h.y * TAU;
  float s = sqrt(max(0.0, 1.0 - z * z));
  vec3 dir = vec3(s * cos(ph), s * sin(ph), abs(z));
  dir.z *= fr < Rf / (Rf + Rb) ? Rf : -Rb;
  dir.xy *= Rxy;
  u = pow(h.z, 1.0 / 3.0);
  return dir * u;
}
`;

// Kick punches as a comoving-space warp shared by the particles and the membrane field, so the
// plasma sheets themselves bulge outward in a heated shock ring around each kick.
export const KICK_COMMON = /* glsl */`
uniform vec4 kickA[2];      // centre xyz (world), time since kick (< 0: off)
uniform vec3 C; uniform float aScale;
const float warpAmp = 0.0;           // membranes are heated, not displaced (displacement folds them)
float ksq(float x) { return x * x; }
vec3 kickWarp(vec3 q, out float kh) {
  vec3 w = vec3(0.0); kh = 0.0;
  for (int k = 0; k < 2; k++) {
    float tk = kickA[k].w;
    if (tk < 0.0) continue;
    vec3 kc = (kickA[k].xyz - C) / aScale;
    vec3 d = q - kc; float dl = length(d);
    float Rk = 5.5 * (1.0 - exp(-tk / 0.3)) / aScale;
    float env = exp(-tk / 0.55) * (1.0 - exp(-tk / 0.07));
    float sh = exp(-ksq((dl - Rk) * aScale / 1.4));
    w += d / max(dl, 1e-3) * env * warpAmp * sh / aScale;
    kh += env * (1.3 * sh + 0.5 * exp(-ksq(dl * aScale / 3.0)));
  }
  return w;
}
`;

export const POS_FRAG = /* glsl */`
in vec2 vUv; out vec4 fragColor;
uniform float tau, turbA, webPull, webCell, shockR, shockEnv, sheetPull, sheetFreq;
uniform vec3 sheetPh;
uniform float kickS[2];     // seed
float sq(float x) { return x * x; }
vec3 cellPt(vec3 c) { return c + 0.1 + 0.8 * hash33(c + vec3(31.7, 11.3, 5.9)); }
// Project x (cell units) onto the nearest Voronoi edge: the line equidistant from the three
// nearest feature points (through their circumcentre, normal to their plane).
vec3 webProject(vec3 x, out float node) {
  vec3 c = floor(x);
  float d1 = 1e9, d2 = 1e9, d3 = 1e9, d4 = 1e9;
  vec3 f1 = vec3(0.0), f2 = vec3(0.0), f3 = vec3(0.0);
  for (int k = -1; k <= 1; k++) for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec3 fp = cellPt(c + vec3(float(i), float(j), float(k)));
    vec3 dv = fp - x; float d = dot(dv, dv);
    if (d < d1) { d4 = d3; d3 = d2; f3 = f2; d2 = d1; f2 = f1; d1 = d; f1 = fp; }
    else if (d < d2) { d4 = d3; d3 = d2; f3 = f2; d2 = d; f2 = fp; }
    else if (d < d3) { d4 = d3; d3 = d; f3 = fp; }
    else if (d < d4) { d4 = d; }
  }
  vec3 u = f2 - f1, v = f3 - f1;
  vec3 w = cross(u, v);
  float ww = max(dot(w, w), 1e-6);
  vec3 cc = f1 + cross(dot(u, u) * v - dot(v, v) * u, w) / (2.0 * ww);
  vec3 n = w * inversesqrt(ww);
  vec3 pr = cc + n * dot(x - cc, n);
  vec3 dl = pr - x; float L = length(dl);
  if (L > 0.55) pr = x + dl * (0.55 / L);
  node = exp(-(sqrt(d4) - sqrt(d1)) * 6.0);      // near a Voronoi vertex: a knot
  return pr;
}
void main() {
  uint id = uint(gl_FragCoord.y) * 512u + uint(gl_FragCoord.x);
  float u;
  vec3 q = comoving(id, u);
  vec3 D = vec3(0.0);
  if (turbA > 0.0) {
    D = turbA * (curl(q * 0.13 + vec3(0.0, 0.045 * tau, 0.07 * tau)) * 0.72
               + curl(q * 0.41 + vec3(0.09 * tau, 1.3, -0.05 * tau)) * 0.28);
  }
  vec3 qq = q + D;
  float heat = 0.0;
  // Plasma sheets: Newton-project onto the (slowly evolving) zero set of a noise field, so the
  // plasma folds into luminous sheets around dark voids.
  if (sheetPull > 0.0) {
    vec3 ph = sheetPh;
    vec3 x = qq * sheetFreq + ph;
    const float e = 0.03;
    for (int it = 0; it < 2; it++) {
      float F = snoise(x);
      vec3 g = vec3(snoise(x + vec3(e, 0, 0)) - F, snoise(x + vec3(0, e, 0)) - F, snoise(x + vec3(0, 0, e)) - F) / e;
      vec3 st = F * g / max(dot(g, g), 0.25);
      float sl = length(st);
      if (sl > 0.35) st *= 0.35 / sl;
      x -= st;
    }
    vec3 qs = (x - ph) / sheetFreq + (hash3U(id * 3u + 8u) - 0.5) * 0.3;
    float wi = 0.86 + 0.14 * hashU(id * 3u + 9u);
    qq = mix(qq, qs, sheetPull * wi);
  }
  if (webPull > 0.0) {
    float node;
    vec3 pr = webProject(q / webCell, node) * webCell;
    vec3 j = (hash3U(id * 3u + 5u) + hash3U(id * 3u + 6u) - 1.0) * 0.2;
    vec3 qw = pr + j + D * 0.1;
    float wi = 0.9 + 0.1 * hashU(id * 3u + 7u);
    qq = mix(qq, qw, webPull * wi);
    heat += webPull * node * 0.8;
  }
  float kh;
  qq += kickWarp(qq, kh);
  heat += kh;
  vec3 p = C + aScale * qq;
  if (shockEnv > 0.0) {
    vec3 dv = p - C; float dd = length(dv);
    float sh = exp(-sq((dd - shockR) / 1.2));
    p += dv / max(dd, 1e-3) * shockEnv * 0.9 * sh;
    heat += shockEnv * sh * 1.4;
  }
  for (int k = 0; k < 2; k++) {
    float tk = kickA[k].w;
    if (tk < 0.0) continue;
    vec3 dv = p - kickA[k].xyz; float dk = length(dv);
    float env = exp(-tk / 0.55) * (1.0 - exp(-tk / 0.07));
    p += env * exp(-sq(dk / 3.4)) * 0.45 * curl(q * 0.5 + vec3(kickS[k], 1.7, -kickS[k]));
  }
  fragColor = vec4(p, heat);
}`;

// ------------------------------------------------------------------ sprites
export const SPRITE_VERT = /* glsl */`
in vec3 position;
uniform sampler2D posNow, posPrev;
uniform mat4 viewProj, prevViewProj;
uniform vec2 res;
uniform float projScale, sizeW, intensity, tempK, kappa, soft, shellGlow, rMin, rMax, tau, hotAmp, nearFade, white, spark, rRef;
out vec2 vP; out float vHalf; out float vR; out vec3 vCol; out float vSoft;
float sq(float x) { return x * x; }
void cull() { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vCol = vec3(0.0); }
void main() {
  int id = gl_InstanceID;
  ivec2 tc = ivec2(id & 511, id >> 9);
  vec4 P = texelFetch(posNow, tc, 0);
  vec4 P0 = texelFetch(posPrev, tc, 0);
  vec4 c1 = viewProj * vec4(P.xyz, 1.0);
  float depth = c1.w;
  if (depth < 0.12) { cull(); return; }
  vec4 c0 = prevViewProj * vec4(P0.xyz, 1.0);
  vec2 s1 = c1.xy / c1.w * 0.5 * res;
  vec2 s0 = c0.w > 0.12 ? c0.xy / c0.w * 0.5 * res : s1;
  vec2 lim = 0.5 * res + 60.0;
  if ((abs(s1.x) > lim.x || abs(s1.y) > lim.y) && (abs(s0.x) > lim.x || abs(s0.y) > lim.y)) { cull(); return; }
  uint uid = uint(id);
  vec3 h = hash3U(uid * 5u + 1u);
  float h4 = hashU(uid * 5u + 2u);
  float u; vec3 q = comoving(uid, u);
  // Luminosity: log-normal spread, rare hot sparks, and slowly drifting hot spots.
  float lum = exp((h.x - 0.5) * 2.0) * (1.0 + spark * step(0.996, h.y));
  float hot = snoise(q * 0.075 + vec3(0.0, 0.03 * tau, 0.05 * tau));
  lum *= mix(1.0, 0.25 + 1.6 * smoothstep(-0.35, 0.75, hot), hotAmp);
  float rTrue = sizeW * (0.55 + 0.9 * h.z) * projScale / depth;
  float r = clamp(rTrue, rMin, rMax);
  float peak = lum * intensity * min(1.0, sq(rTrue / r));
  peak *= min(1.0, pow(rRef / r, 1.6));                 // defocus: near sprites fade to soft discs
  peak *= smoothstep(0.4 * nearFade, nearFade, depth) * exp(-kappa * depth) * (1.0 - smoothstep(70.0, 95.0, depth));
  // Fireball limb: the outer layer glows during the eruption (the shock front).
  peak *= 1.0 + shellGlow * smoothstep(0.86, 0.99, u);
  float heat = P.w;
  peak *= 1.0 + 1.5 * heat;
  vec2 dd = s1 - s0; float len = length(dd);
  float maxLen = 0.32 * res.y;
  if (len > maxLen) { s0 = s1 - dd / len * maxLen; dd = s1 - s0; len = maxLen; }
  vec2 dir = len > 1e-4 ? dd / len : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  float hl = 0.5 * len;
  float ext = 2.6 * r;
  vec2 mid = 0.5 * (s0 + s1);
  vec2 pos = mid + dir * position.x * (hl + ext) + nrm * position.y * ext;
  vP = vec2(position.x * (hl + ext), position.y * ext);
  vHalf = hl; vR = r; vSoft = soft;
  float K = tempK * (0.8 + 0.4 * h4) * (1.0 + 0.5 * heat);
  vec3 bb = blackbody(K);
  bb = mix(bb, vec3(0.92, 0.95, 1.0) * max(bb.r, max(bb.g, bb.b)), white * smoothstep(0.2, 1.2, lum * (1.0 + heat)));
  vCol = bb * peak / (1.0 + 2.0 * len / (PI * r));
  gl_Position = vec4(pos / (0.5 * res), 0.0, 1.0);
}`;

export const SPRITE_FRAG = /* glsl */`
in vec2 vP; in float vHalf; in float vR; in vec3 vCol; in float vSoft;
out vec4 fragColor;
void main() {
  vec2 q = vP; q.x = max(abs(q.x) - vHalf, 0.0);
  float d2 = dot(q, q) / (vR * vR);
  float a = exp(-d2 * 2.2) + vSoft * 0.16 * exp(-sqrt(d2) * 1.5);
  fragColor = vec4(vCol * a, 1.0);
}`;

// ------------------------------------------------------------------ plasma fog (half-res)
export const FOG_FRAG = /* glsl */`
in vec2 vUv; out vec4 fragColor;
uniform highp sampler3D noiseTex;
uniform vec3 camPos; uniform mat3 camRot; uniform float tanHalf, aspect;
uniform float tau, kappa, fogLevel, tempK, shockR, shockEnv, limb, frame, sheetGlow, sheetFreq;
uniform vec3 sheetPh;
uniform float Rxy, Rf, Rb;
float sq(float x) { return x * x; }
void main() {
  vec2 ndc = vUv * 2.0 - 1.0;
  vec3 rd = normalize(camRot * vec3(ndc.x * tanHalf * aspect, ndc.y * tanHalf, -1.0));
  float jit = hash13(vec3(gl_FragCoord.xy, frame));
  const int N = 48;
  const float S0 = 0.3, S1 = 80.0;
  float lr = log(S1 / S0);
  float ke = max(kappa, 0.0035);
  vec3 col = vec3(0.0);
  vec3 ph = sheetPh;
  float Fp = 0.0, sp = 0.0;
  for (int i = 0; i < N; i++) {
    float x = (float(i) + jit) / float(N);
    float s = S0 * exp(lr * x);
    float ds = s * lr / float(N);
    vec3 p = camPos + rd * s;
    vec3 q = (p - C) / aScale;
    vec3 e = q / vec3(Rxy, Rxy, q.z > 0.0 ? Rf : Rb);
    float el = length(e);
    float m = smoothstep(1.03, 0.9, el);
    if (m <= 0.0) { sp = s; Fp = 0.0; continue; }
    vec3 uvw = q * 0.06 + vec3(0.1, 0.4, 0.2 + tau * 0.006);
    vec4 n1 = texture(noiseTex, uvw);
    vec4 n2 = texture(noiseTex, uvw * 2.9 + vec3(0.31, 0.77, 0.05));
    float f = n1.r * 0.62 + n2.g * 0.38;
    float dens = smoothstep(0.3, 0.78, f);
    dens = 0.06 + 1.5 * dens * dens;
    float K = tempK * (0.78 + 0.4 * dens);
    vec3 em = blackbody(K) * dens * fogLevel * ke * mix(1.0, 0.12, sheetGlow);
    em += blackbody(tempK * 1.25) * limb * exp(-sq((el - 0.97) / 0.05)) * 0.35;
    float dc = length(p - C);
    em += blackbody(tempK * 1.3) * shockEnv * exp(-sq((dc - shockR) / 0.38)) * 0.75 * (0.3 + dens);
    col += em * m * exp(-kappa * s) * ds;
    // Plasma membranes: the zero set of F (the same sheets the particles are pulled onto),
    // added analytically at each crossing; brightness ~ 1/|cos| (path through a thin sheet).
    if (sheetGlow > 0.0) {
      float khs;
      vec3 xs = (q - kickWarp(q, khs)) * sheetFreq + ph;
      float F = snoise(xs);
      if (i > 0 && F * Fp < 0.0) {
        float w = Fp / (Fp - F);
        float sc = mix(sp, s, w);
        vec3 pc = camPos + rd * sc;
        vec3 qc = (pc - C) / aScale;
        float kh;
        vec3 xc = (qc - kickWarp(qc, kh)) * sheetFreq + ph;
        float F0 = snoise(xc);
        const float h = 0.02;
        vec3 g = vec3(snoise(xc + vec3(h, 0, 0)), snoise(xc + vec3(0, h, 0)), snoise(xc + vec3(0, 0, h))) - F0;
        float mu = abs(dot(rd, normalize(g + 1e-6)));
        float hv = smoothstep(0.3, 0.8, n1.b * 0.6 + n2.r * 0.4);
        float hot = (0.08 + 1.8 * hv * hv) * (1.0 + 1.3 * kh) * smoothstep(0.5, 4.0, sc);
        float lim = 0.2 + 1.0 / max(mu, 0.11) - 1.0;
        col += blackbody(tempK * (0.85 + 0.35 * hv)) * sheetGlow * fogLevel * 0.2 * hot * lim * m * exp(-kappa * sc);
      }
      Fp = F;
    }
    sp = s;
  }
  // Kick shock rings: a thin luminous bubble expanding from each kick centre (limb-brightened).
  for (int k = 0; k < 2; k++) {
    float tk = kickA[k].w;
    if (tk < 0.0) continue;
    float Rk = 4.2 * (1.0 - exp(-tk / 0.3));
    float env = exp(-tk / 0.4) * (1.0 - exp(-tk / 0.05));
    vec2 hit = sphIntersect(camPos, rd, kickA[k].xyz, Rk);
    if (hit.y <= 0.0) continue;
    for (int j = 0; j < 2; j++) {
      float sh = j == 0 ? hit.x : hit.y;
      if (sh <= 0.3) continue;
      vec3 ph2 = camPos + rd * sh;
      vec3 nn = normalize(ph2 - kickA[k].xyz);
      float mu = abs(dot(rd, nn));
      float lim = max(min(1.0 / max(mu, 1e-3), 5.0) - 1.2, 0.0);
      vec4 kn = texture(noiseTex, nn * 1.3 + vec3(float(k) * 0.37, tk * 0.3, 0.5));
      float patchy = pow(smoothstep(0.3, 0.8, kn.r), 1.5) * (0.3 + 1.2 * kn.b);
      col += blackbody(tempK * 1.35) * env * 0.22 * lim * patchy * fogLevel * 3.0 * exp(-kappa * sh);
    }
  }
  fragColor = vec4(col, 1.0);
}`;

// ------------------------------------------------------------------ glow chain + composite
export const DOWN_FRAG = /* glsl */`
in vec2 vUv; out vec4 fragColor; uniform sampler2D src; uniform vec2 texel;
void main() {
  vec3 c = texture(src, vUv + texel * vec2(-0.5, -0.5)).rgb + texture(src, vUv + texel * vec2(0.5, -0.5)).rgb
         + texture(src, vUv + texel * vec2(-0.5, 0.5)).rgb + texture(src, vUv + texel * vec2(0.5, 0.5)).rgb;
  fragColor = vec4(c * 0.25, 1.0);
}`;
export const BLUR_FRAG = /* glsl */`
in vec2 vUv; out vec4 fragColor; uniform sampler2D src; uniform vec2 dir;
void main() {
  vec3 c = texture(src, vUv).rgb * 0.2270270;
  c += (texture(src, vUv + dir * 1.3846154).rgb + texture(src, vUv - dir * 1.3846154).rgb) * 0.3162162;
  c += (texture(src, vUv + dir * 3.2307692).rgb + texture(src, vUv - dir * 3.2307692).rgb) * 0.0702703;
  fragColor = vec4(c, 1.0);
}`;
export const COMP_FRAG = /* glsl */`
in vec2 vUv; out vec4 fragColor;
uniform sampler2D partTex, fogTex, glowA, glowB;
uniform float on, glowGain, glowGain2;
uniform vec4 core;      // eruption core: intensity, radius (H units)
uniform vec2 res;
uniform float trim;     // partial compensation of the engine's bang flash (core excluded)
void main() {
  if (on < 0.5) { fragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  vec3 c = texture(partTex, vUv).rgb + texture(fogTex, vUv).rgb;
  vec3 g1 = texture(glowA, vUv).rgb, g2 = texture(glowB, vUv).rgb;
  c += glowGain * (g1 + g1 * min(luma(g1), 4.0) * 0.5) + glowGain2 * g2;
  c *= trim;
  if (core.x > 0.0) {
    float r = length(gl_FragCoord.xy - 0.5 * res) / res.y;
    float k = r / max(core.y, 1e-5);
    c += vec3(0.82, 0.9, 1.0) * core.x * (exp(-k * k * 2.0) + 0.25 * exp(-k * 1.2));
  }
  fragColor = vec4(c, 1.0);
}`;
