// VI · LIFE: the shore renderer for the march — the intricate-silhouette pass of lab/creature-render.js
// generalised to a documentary shot: up to three SEPARATE animals, each a 2D signed-distance
// silhouette on its own depth plane (walk-local z), mirrored to its heading; a telephoto depth of
// field (planes away from the focus distance soften by their circle of confusion); wet sand that
// mirrors every animal standing beyond it; the sea beyond a curving shoreline; the chapter's air view
// above the horizon; the torch flame. One fullscreen pass, linear HDR, a pure function of uniforms.
//
// Light (as in the lab): backlit transmission through each body along the view ray (the chord of
// each limb, haemoglobin-red for skin, golden for fur tips), a sky-driven rim facing the sun, a wet
// sheen on wet skin, fur fibres on furred edges. Frame: walk-local metres (ground y = 0, camera on
// +z looking along −z); uRot/uOrigin place it in the chapter's world so its camera can be used.
import { THREE } from '../../engine/gl.js';

export const MAXP = 240, NSET = 3;

const FS = (skyGLSL) => /* glsl */`
precision highp float; precision highp int;
${skyGLSL}
uniform sampler2D uPrims;
uniform int uNS;                       // animals drawn (sorted far → near)
uniform int uN[${NSET}];
uniform vec4 uXf[${NSET}];             // per animal: plane x, y offset, plane z, world units per model unit
uniform vec4 uLook[${NSET}];           // chord scale, transmission gain, wet sheen, warm (0 blood … 1 amber)
uniform vec4 uBox[${NSET}];            // plane-space bbox (x0, y0, x1, y1)
uniform float uCoc[${NSET}];           // defocus blur radius on that plane (world m)
uniform mat4 uInvProj, uCamWorld;
uniform float uPx;
uniform vec3 uFlame; uniform float uFlameOn, uFlameGain, uFlameZ;
uniform mat3 uRot; uniform vec3 uOrigin; uniform sampler2D uBg; uniform float uBgOn;
uniform vec2 uShoreP[8]; uniform int uShoreN;   // shoreline: sea where z < seaZ(x), smooth through (x, z) points
uniform vec3 uClip[${NSET}];           // per animal: hidden below the water, depth = clamp((x0 − x)·slope, 0, max)
uniform vec4 uRip[8];                  // footfall ripples on the wet film: (x, z, age s, amplitude)
in vec2 vUv; out vec4 fragColor;

float seaZ(float x) {
  if (x <= uShoreP[0].x) return uShoreP[0].y;
  for (int i = 0; i < 7; i++) {
    if (i + 1 >= uShoreN) break;
    vec2 a = uShoreP[i], b = uShoreP[i + 1];
    if (x < b.x) return mix(a.y, b.y, smoothstep(a.x, b.x, x));
  }
  return uShoreP[uShoreN - 1].y;
}
float clipDepth(int s, float x) { vec3 c = uClip[s]; return clamp((c.x - x) * c.y, 0.0, c.z); }
vec3 sunL;
vec3 skyL(vec3 dLocal, bool withSun) { return skyColor(uRot * dLocal, withSun); }
float h12(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vn2(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h12(i), h12(i + vec2(1, 0)), f.x), mix(h12(i + vec2(0, 1)), h12(i + vec2(1, 1)), f.x), f.y); }
float fbm2(vec2 p) { return 0.5 * vn2(p) + 0.25 * vn2(p * 2.03 + 7.1) + 0.125 * vn2(p * 4.1 - 3.3); }
float cro(vec2 a, vec2 b) { return a.x * b.y - a.y * b.x; }
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
vec3 rayDir(vec2 uv) { vec4 v = uInvProj * vec4(uv * 2.0 - 1.0, 1.0, 1.0); return normalize(mat3(uCamWorld) * (v.xyz / v.w)); }
// the 2D field of one animal: near (x) and far-side (y) distance + attributes (chord mm, fur, flesh radius mm, mm per unit)
void sil2(int set, vec2 p, out vec2 d, out vec4 attr, out vec4 attrF) {
  int n = uN[set];
  vec4 xf = uXf[set];
  float cs = uLook[set].x;
  float dn = 1e9, df = 1e9, cut = 1e9;
  attr = vec4(100.0, 0.0, 0.0, 0.0); attrF = attr;
  for (int i = 0; i < ${MAXP}; i++) {
    if (i >= n) break;
    vec4 A = texelFetch(uPrims, ivec2(i * 4, set), 0), B = texelFetch(uPrims, ivec2(i * 4 + 1, set), 0), M = texelFetch(uPrims, ivec2(i * 4 + 2, set), 0);
    vec2 a = A.xy * xf.w + xf.xy, b = B.xy * xf.w + xf.xy;
    float ra = A.w * xf.w, rb = B.w * xf.w;
    vec2 cmid = 0.5 * (a + b); float rbnd = 0.5 * length(b - a) + max(ra, rb) + M.x * xf.w;
    float dc = length(p - cmid) - rbnd;
    bool isFar = M.w > 0.5;
    if (dc > (isFar ? df : dn) + 0.02 * xf.w && M.y != 5.0) continue;
    float hh; float di = sdUC(p, a, b, ra, rb, hh);
    if (abs(M.y - 5.0) < 0.5) { cut = min(cut, di); continue; }
    float rl = mix(ra, rb, hh);
    float inset = rl + min(di, 0.0);
    float chord = 2.0 * sqrt(max(0.0, rl * rl - inset * inset)) / xf.w * 1000.0 * cs;
    bool thin = abs(M.y - 1.0) < 0.5 || abs(M.y - 6.0) < 0.5;
    float mmPer = 1000.0 * cs / xf.w;
    float fur = texelFetch(uPrims, ivec2(i * 4 + 3, set), 0).x;
    vec4 at = vec4(thin ? min(chord, M.z * 1000.0) : chord, fur, thin ? -1.0 : rl * mmPer, mmPer);
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
vec3 flameAt(vec2 p, out float cov) {
  cov = 0.0;
  if (uFlameOn < 0.5) return vec3(0.0);
  vec2 q = (p - uFlame.xy) / uFlame.z;
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
vec3 groundAt(vec3 ro, vec3 rd, float tg, float silMirror, float mirrorFar, bool forceSea) {
  vec3 G = ro + rd * tg;
  bool sea = forceSea || G.z < seaZ(G.x);
  vec2 q = G.xz;
  vec2 rip = vec2(0.0);
  for (int i = 0; i < 8; i++) {
    vec4 R = uRip[i];
    if (R.w <= 0.0 || R.z < 0.0 || R.z > 1.6) continue;
    vec2 d = vec2(G.x - R.x, G.z - R.y);
    float r = length(d), front = R.z * 1.1;
    float rf = (r - front) / 0.12;
    float ring = sin((r - front) * 38.0) * exp(-rf * rf) * exp(-R.z * 2.2) * R.w;
    rip += d / max(r, 1e-3) * ring;
  }
  // the swash: a thin, bright film for a metre up the sand from the sea's edge
  float edge = G.z - seaZ(G.x);
  float swash = sea ? 0.0 : 1.0 - smoothstep(0.0, 1.2, edge + 0.4 * (fbm2(q * vec2(0.8, 0.3)) - 0.5));
  float wet = sea ? 1.0 : max(swash, smoothstep(0.35, 0.65, fbm2(q * 0.35) + 0.25 * fbm2(q * 2.1)) * 0.8 + 0.2);
  float amp = sea ? 0.06 : mix(0.02, 0.008, swash);
  vec2 g = vec2(fbm2(q * vec2(0.4, 1.3) + vec2(uT * 0.25, 0.0)) - 0.5, fbm2(q * vec2(0.4, 1.3) + vec2(3.1, uT * 0.18)) - 0.5);
  vec3 n = normalize(vec3(g.x * amp + rip.x * 0.08, 1.0, g.y * amp * 3.0 + rip.y * 0.08));
  vec3 r = reflect(rd, n);
  r.y = abs(r.y);
  float F = 0.02 + 0.98 * pow(1.0 - max(dot(-rd, n), 0.0), 5.0);
  vec3 refl = skyL(normalize(r + vec3(0.0, 0.004, 0.0)), true);
  refl = mix(refl, refl * 0.03, silMirror);
  refl = mix(refl, mix(refl * 0.03, refl, 0.12), mirrorFar * (1.0 - silMirror));
  vec3 sand = vec3(0.10, 0.075, 0.05) * (0.7 + 0.5 * fbm2(q * 3.0));
  vec3 skyAmb = skyColor(vec3(0.0, 1.0, 0.0), false) * 0.6 + skyColor(normalize(vec3(-uSunDir.x, 0.1, -uSunDir.z)), false) * 0.3;
  vec3 diff = sand * (skyAmb + uSunCol * max(uSunDir.y, 0.0) * 0.6);
  return mix(diff, refl, F * wet * (sea ? 1.0 : 0.92));
}
vec3 shadeSil(vec3 bg, vec2 p, float d, vec4 at, float pxw, vec3 sunS, bool farSide, vec4 look, float coc) {
  const float HP = 0.00206;
  float furW = 0.0;
  if (at.y > 0.02 && coc < HP * 3.0) {
    vec2 gd = vec2(dFdx(d), dFdy(d));
    vec2 nn = length(gd) > 1e-9 ? normalize(gd) : vec2(0.0, 1.0);
    vec2 tt = vec2(-nn.y, nn.x);
    float s1 = dot(p, tt) / HP, s2 = dot(p, nn) / HP;
    float hair = vn2(vec2(s1 * 0.55, s2 * 0.08)) * 0.75 + vn2(vec2(s1 * 1.3 + 9.0, s2 * 0.2)) * 0.25;
    furW = HP * 7.0 * at.y;
    d -= furW * pow(hair, 2.2);
  }
  // defocus: a soft edge as wide as the circle of confusion (a dark shape against a bright sky)
  float fw = max(max(fwidth(d), pxw * 0.5), 2.0 * coc);
  float cov = clamp(0.5 - d / fw, 0.0, 1.0);
  if (cov <= 0.0) return bg;
  float mm = at.x;
  // flesh: the chord can't be thinner than the depth inside the BLENDED outline allows — the chord of a
  // disc of the local radius at that depth, up to its full diameter (past the centre it stays 2R)
  if (at.z > 0.0) { float dep = min(max(-d, 0.0) * at.w, at.z); mm = max(mm, 2.0 * sqrt(max(0.0, dep * (2.0 * at.z - dep)))); }
  if (furW > 0.0 && d > -furW * 1.2) mm = min(mm, mix(2.5, 0.3, smoothstep(-furW * 1.2, 0.0, d)));
  vec3 sig = mix(vec3(0.55, 2.1, 3.6), vec3(0.4, 0.62, 1.25), look.w);
  vec3 trans = bg * exp(-sig * mm) * 0.9 * look.y;
  if (furW > 0.0 && d > -furW * 1.2) {
    float tipness = smoothstep(-furW * 1.2, 0.0, d);
    trans = bg * vec3(0.55, 0.42, 0.26) * tipness * tipness * 0.55;
  }
  vec2 gd = vec2(dFdx(d), dFdy(d));
  vec2 nn = length(gd) > 1e-9 ? normalize(gd) : vec2(0.0);
  float facing = 0.35 + 0.65 * max(dot(nn, sunS.xy), 0.0);
  float rw = max(max(HP * 1.3, pxw * 0.7), coc);
  float rim = exp(min(d, 0.0) / rw) * facing * 0.35 * (HP * 1.3 / max(rw, HP * 1.3));
  // (the body's faint ambient tint and the far-side lift must not carry the sun's HDR glitter
  // straight through an opaque body: they see a capped background)
  vec3 bgl = min(bg, vec3(2.0));
  vec3 body = vec3(0.0032, 0.0024, 0.0021) + bgl * 0.004;
  vec3 c = body + trans + min(bg, vec3(12.0)) * rim;
  if (look.z > 0.0) {
    float up = max(nn.y, 0.0);
    float band = exp(min(d, 0.0) / max(HP * 2.2, pxw * 0.9)) * (1.0 - exp(min(d, 0.0) / max(HP * 0.5, pxw * 0.3)) * 0.6);
    c += (bgl * 0.55 + skyL(vec3(0.0, 1.0, 0.0), false) * 0.8) * up * up * band * look.z * smoothstep(8.0, 25.0, at.z);   // (on bodies, not on fine digits)
  }
  if (uFlameOn > 0.5) {
    vec2 fl = uFlame.xy + vec2(0.0, uFlame.z * 0.35);
    float dist = length(p - fl);
    float fac = max(dot(nn, normalize(fl - p)), 0.0);
    c += vec3(1.0, 0.45, 0.12) * 0.9 * uFlame.z * uFlame.z / (dist * dist + uFlame.z * uFlame.z * 0.2) * (exp(min(d, 0.0) / (HP * 3.0)) * fac * 0.8 + 0.03);
  }
  if (farSide) c = mix(c, bgl * 0.35 + c, 0.07);
  return mix(bg, c, cov);
}
void main() {
  vec3 rdW = rayDir(vUv);
  vec3 rd = transpose(uRot) * rdW, ro = transpose(uRot) * (uCamPos - uOrigin);
  sunL = transpose(uRot) * uSunDir;
  float tg = rd.y < 0.0 ? -ro.y / rd.y : 1e9;
  vec3 sunS = normalize(vec3(sunL.x, sunL.y + 0.02, 0.0));
  vec4 bgs = texture(uBg, vUv);
  bool land = uBgOn > 1.5 && bgs.a > 0.0 && bgs.a < 2500.0;
  vec3 col;
  if (rd.y < 0.0) {
    // the wet sand mirrors every animal standing beyond this ground point (dark, a little broken up)
    vec3 G = ro + rd * tg;
    float sm = 0.0, smf = 0.0;
    for (int s = 0; s < ${NSET}; s++) {
      if (s >= uNS) break;
      float tp = (uXf[s].z - ro.z) / rd.z;
      if (tp <= tg) continue;
      vec3 P = ro + rd * tp;
      vec2 m = vec2(P.x, -P.y) + (vec2(fbm2(G.xz * vec2(1.5, 5.0)), fbm2(G.xz * vec2(1.5, 5.0) + 4.0)) - 0.5) * vec2(0.03, 0.05) * uXf[s].w;
      vec4 B = uBox[s];
      if (m.x > B.x - 0.3 && m.x < B.z + 0.3 && m.y < B.w + 0.3 && m.y > clipDepth(s, m.x)) {
        vec2 d; vec4 at, af; sil2(s, m, d, at, af);
        float fw = max(uPx * tp * 3.0, 2.0 * uCoc[s]);
        sm = max(sm, clamp(0.5 - d.x / fw, 0.0, 1.0)); smf = max(smf, clamp(0.5 - d.y / fw, 0.0, 1.0));
      }
    }
    col = land ? bgs.rgb : groundAt(ro, rd, tg, sm, smf, false);
    if (uFlameOn > 0.5) { float tf = (uFlameZ - ro.z) / rd.z; if (tf > tg) { vec3 P = ro + rd * tf; float fc; col += flameAt(vec2(P.x, -P.y), fc) * 0.35; } }
  } else col = uBgOn > 1.5 ? bgs.rgb : skyL(rd, true);
  // the animals, far → near
  for (int s = 0; s < ${NSET}; s++) {
    if (s >= uNS) break;
    float tp = (uXf[s].z - ro.z) / rd.z;
    if (tp <= 0.0 || tp >= tg) continue;
    vec3 P = ro + rd * tp;
    vec4 B = uBox[s];
    if (P.x > B.x && P.x < B.z && P.y > B.y && P.y < B.w) {
      vec2 d; vec4 at, af; sil2(s, P.xy, d, at, af);
      float pxw = uPx * tp, cd = clipDepth(s, P.x);
      if (P.y > cd) {
        col = shadeSil(col, P.xy, d.y, af, pxw, sunS, true, uLook[s], uCoc[s]);
        col = shadeSil(col, P.xy, d.x, at, pxw, sunS, false, uLook[s], uCoc[s]);
      } else if (rd.y < 0.0) {
        // still in the wash: the water's surface (at the wash's height) lies in front of this part of
        // the body — it mirrors the sky, darkened a little by the body under it
        float cov = clamp(0.5 - min(d.x, d.y) / max(fwidth(d.x), pxw), 0.0, 1.0);
        if (cov > 0.0) {
          float tw = (cd - ro.y) / rd.y;
          col = mix(col, groundAt(ro, rd, tw, 0.0, 0.0, true) * 0.72, cov);
        }
      }
    }
  }
  if (uFlameOn > 0.5) {
    float tf = (uFlameZ - ro.z) / rd.z;
    if (tf > 0.0 && tf < tg) { vec3 P = ro + rd * tf; float fc; vec3 fl = flameAt(P.xy, fc); col = mix(col, fl, clamp(fc, 0.0, 1.0) * 0.85) + fl * 0.3; }
  }
  fragColor = vec4(col, 1.0);
}`;

const VS = 'precision highp float; in vec3 position; out vec2 vUv; void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }';

/**
 * makeWalkRenderer({ skyGLSL, uniforms }) → { render(renderer, target, cam, o) }
 *   o.list:  [{ pose, k, world: [x, y, planeZ], look, dir (±1) }] — at most three animals
 *   o.frame: { rot: Matrix3 (local → world), origin: Vector3 }; o.bg: the chapter's air view (hybrid)
 *   o.dof:   { focus (m), aperture (m) }; o.flame: [x, y, size] on plane o.flameZ; o.flameGain
 *   o.shore: [[x, z], …] (≤ 8, ascending x); o.ripples: [[x, z, age, amp], …]
 *   a record's clip: [x0, slope, max] hides it below the water where it is still in the wash
 */
export function makeWalkRenderer({ skyGLSL, uniforms = {} }) {
  const data = new Float32Array(4 * MAXP * NSET * 4);
  const tex = new THREE.DataTexture(data, 4 * MAXP, NSET, THREE.RGBAFormat, THREE.FloatType);
  tex.minFilter = tex.magFilter = THREE.NearestFilter; tex.needsUpdate = true;
  const V4 = () => Array.from({ length: NSET }, () => new THREE.Vector4());
  const U = {
    ...uniforms,
    uPrims: { value: tex }, uNS: { value: 0 }, uN: { value: new Array(NSET).fill(0) },
    uXf: { value: V4() }, uLook: { value: V4() }, uBox: { value: V4() }, uCoc: { value: new Array(NSET).fill(0) },
    uInvProj: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() }, uCamPos: uniforms.uCamPos || { value: new THREE.Vector3() },
    uPx: { value: 0.001 }, uFlame: { value: new THREE.Vector3() }, uFlameOn: { value: 0 }, uFlameGain: { value: 1 }, uFlameZ: { value: 0 },
    uRot: { value: new THREE.Matrix3() }, uOrigin: { value: new THREE.Vector3() }, uBgOn: { value: 0 },
    uBg: { value: (() => { const t = new THREE.DataTexture(new Uint8Array(4), 1, 1); t.needsUpdate = true; return t; })() },
    uShoreP: { value: Array.from({ length: 8 }, () => new THREE.Vector2()) }, uShoreN: { value: 1 },
    uClip: { value: Array.from({ length: NSET }, () => new THREE.Vector3(-1e3, 0, 0)) },
    uRip: { value: Array.from({ length: 8 }, () => new THREE.Vector4(0, 0, -1, 0)) },
  };
  const mat = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: VS, fragmentShader: FS(skyGLSL), uniforms: U, depthTest: false, depthWrite: false });
  const tri = new THREE.BufferGeometry();
  tri.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  const mesh = new THREE.Mesh(tri, mat); mesh.frustumCulled = false;
  const scene = new THREE.Scene(); scene.add(mesh);
  const ocam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const tmp = new THREE.Vector3(), rotT = new THREE.Matrix3();

  function upload(set, C) {
    const P = C.pose.prims, dir = C.dir || 1;
    const n = Math.min(MAXP, P.length);
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (let i = 0; i < n; i++) {
      const p = P[i], o = (set * 4 * MAXP + i * 4) * 4;
      const ax = p.a[0] * dir, bx = p.b[0] * dir;
      data.set([ax, p.a[1], p.a[2], p.ra, bx, p.b[1], p.b[2], p.rb, p.k, p.kind, p.thick, p.far, p.fur ?? (p.kind === 2 ? 1 : 0), 0, 0, 0], o);
      const r = Math.max(p.ra, p.rb) + p.k;
      x0 = Math.min(x0, ax - r, bx - r); x1 = Math.max(x1, ax + r, bx + r);
      y0 = Math.min(y0, p.a[1] - r, p.b[1] - r); y1 = Math.max(y1, p.a[1] + r, p.b[1] + r);
    }
    U.uN.value[set] = n;
    U.uLook.value[set].set(...(C.look || [1, 1, 0, 0]));
    U.uXf.value[set].set(C.world[0], C.world[1], C.world[2], C.k);
    const pad = 0.05 * C.k;
    U.uBox.value[set].set(x0 * C.k + C.world[0] - pad, y0 * C.k + C.world[1] - pad, x1 * C.k + C.world[0] + pad, y1 * C.k + C.world[1] + pad);
  }
  return {
    material: mat, uniforms: U,
    render(renderer, target, cam, o) {
      const list = (o.list || []).slice(0, NSET).sort((a, b) => a.world[2] - b.world[2]);
      // the lens: camera position in the walk frame (for each plane's distance → circle of confusion)
      if (o.frame) { U.uRot.value.copy(o.frame.rot); U.uOrigin.value.copy(o.frame.origin); } else { U.uRot.value.identity(); U.uOrigin.value.set(0, 0, 0); }
      rotT.copy(U.uRot.value).transpose();
      tmp.copy(cam.position).sub(U.uOrigin.value).applyMatrix3(rotT);
      list.forEach((C, i) => {
        upload(i, C);
        if (C.clip) U.uClip.value[i].set(...C.clip); else U.uClip.value[i].set(-1e3, 0, 0);
        const D = Math.max(0.05, tmp.z - C.world[2]), f = o.dof ? o.dof.focus : D;
        U.uCoc.value[i] = o.dof ? 0.5 * o.dof.aperture * Math.abs(D - f) / Math.max(f, 0.05) : 0;
      });
      U.uNS.value = list.length;
      tex.needsUpdate = true;
      U.uInvProj.value.copy(cam.projectionMatrixInverse); U.uCamWorld.value.copy(cam.matrixWorld); U.uCamPos.value.copy(cam.position);
      U.uPx.value = 2 * Math.tan(cam.fov * Math.PI / 360) / o.H;
      if (o.flame) { U.uFlameOn.value = 1; U.uFlame.value.set(...o.flame); U.uFlameZ.value = o.flameZ ?? 0; } else U.uFlameOn.value = 0;
      U.uFlameGain.value = o.flameGain ?? 1;
      if (o.bg) { U.uBg.value = o.bg; U.uBgOn.value = 2; } else U.uBgOn.value = 0;
      const sh = o.shore || [[0, -3]];
      U.uShoreN.value = Math.min(8, sh.length);
      for (let i = 0; i < 8; i++) { const p = sh[Math.min(i, sh.length - 1)]; U.uShoreP.value[i].set(p[0], p[1]); }
      for (let i = 0; i < 8; i++) { const r = o.ripples && o.ripples[i]; if (r) U.uRip.value[i].set(...r); else U.uRip.value[i].set(0, 0, -1, 0); }
      renderer.setRenderTarget(target);
      renderer.render(scene, ocam);
    },
  };
}
