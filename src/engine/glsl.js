// Shared GLSL ES 3.00 chunks. Chapters concatenate what they need:
//   const frag = glsl.header + glsl.hash + glsl.noise + `...main...`;
// Everything is deterministic: no time sources except uniforms you pass in.

export const header = /* glsl */`
precision highp float;
precision highp int;
precision highp sampler2D;
`;

// Fullscreen-triangle vertex shader for RawShaderMaterial (GLSL3).
export const fsVert = /* glsl */`
precision highp float;
in vec3 position;
out vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const hash = /* glsl */`
// pcg-based integer hashes (bit-exact across runs on the same GPU)
uint pcg(uint v) { uint s = v * 747796405u + 2891336453u; uint w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u; return (w >> 22u) ^ w; }
uvec3 pcg3(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}
float hash11(float p) { return float(pcg(floatBitsToUint(p))) / 4294967295.0; }
float hash12(vec2 p) { return float(pcg(pcg(floatBitsToUint(p.x)) + floatBitsToUint(p.y))) / 4294967295.0; }
float hash13(vec3 p) { return float(pcg3(floatBitsToUint(p)).x) / 4294967295.0; }
vec3 hash33(vec3 p) { return vec3(pcg3(floatBitsToUint(p))) / 4294967295.0; }
float hashU(uint a) { return float(pcg(a)) / 4294967295.0; }
vec3 hash3U(uint a) { return vec3(pcg3(uvec3(a, a * 1103515245u + 12345u, a ^ 0x9E3779B9u))) / 4294967295.0; }
`;

export const noise = /* glsl */`
// Value noise 3D (smooth), gradient-free, cheap.
float vnoise(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = hash13(i), n100 = hash13(i + vec3(1,0,0)), n010 = hash13(i + vec3(0,1,0)), n110 = hash13(i + vec3(1,1,0));
  float n001 = hash13(i + vec3(0,0,1)), n101 = hash13(i + vec3(1,0,1)), n011 = hash13(i + vec3(0,1,1)), n111 = hash13(i + vec3(1,1,1));
  return mix(mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y), mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y), f.z);
}
// Simplex noise 3D (Ashima / Stefan Gustavson, MIT). Range ~[-1, 1].
vec4 _perm(vec4 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }
vec4 _tis(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v) {
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod(i, 289.0);
  vec4 p = _perm(_perm(_perm(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 1.0 / 7.0;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = _tis(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}
float fbm(vec3 p, int oct) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 8; i++) { if (i >= oct) break; s += a * snoise(p); p = p * 2.02 + vec3(17.1, -3.7, 9.3); a *= 0.5; }
  return s;
}
float vfbm(vec3 p, int oct) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 8; i++) { if (i >= oct) break; s += a * vnoise(p); p = p * 2.03 + vec3(1.7, 9.2, -4.1); a *= 0.5; }
  return s;
}
// Divergence-free curl noise (Bridson): curl of a 3-component simplex potential.
vec3 curl(vec3 p) {
  const float e = 0.08;
  vec3 dx = vec3(e, 0, 0), dy = vec3(0, e, 0), dz = vec3(0, 0, e);
  #define POT(q) vec3(snoise(q), snoise(q + vec3(31.4, -7.1, 12.9)), snoise(q + vec3(-19.3, 44.7, 3.3)))
  vec3 px0 = POT(p - dx), px1 = POT(p + dx);
  vec3 py0 = POT(p - dy), py1 = POT(p + dy);
  vec3 pz0 = POT(p - dz), pz1 = POT(p + dz);
  #undef POT
  float x = (py1.z - py0.z) - (pz1.y - pz0.y);
  float y = (pz1.x - pz0.x) - (px1.z - px0.z);
  float z = (px1.y - px0.y) - (py1.x - py0.x);
  return vec3(x, y, z) / (2.0 * e);
}
`;

export const color = /* glsl */`
// Blackbody colour for temperature K (approx. 1000 K – 40000 K), linear RGB, max component 1.
vec3 blackbody(float K) {
  K = clamp(K, 1000.0, 40000.0) / 100.0;
  vec3 c;
  c.r = K <= 66.0 ? 1.0 : clamp(1.29293618606 * pow(K - 60.0, -0.1332047592), 0.0, 1.0);
  c.g = K <= 66.0 ? clamp(0.39008157876 * log(K) - 0.63184144378, 0.0, 1.0) : clamp(1.12989086089 * pow(K - 60.0, -0.0755148492), 0.0, 1.0);
  c.b = K >= 66.0 ? 1.0 : (K <= 19.0 ? 0.0 : clamp(0.54320678911 * log(K - 10.0) - 1.19625408914, 0.0, 1.0));
  return pow(c, vec3(2.2));   // to linear
}
vec3 srgbToLinear(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
vec3 linearToSrgb(vec3 c) { c = max(c, 0.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
// ACES filmic (Narkowicz fit), input linear, output linear [0,1].
vec3 aces(vec3 x) { const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14; return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0); }
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
`;

export const math = /* glsl */`
#define PI 3.14159265358979
#define TAU 6.28318530717959
mat2 rot2(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
float sat(float x) { return clamp(x, 0.0, 1.0); }
float remap(float x, float a, float b) { return clamp((x - a) / (b - a), 0.0, 1.0); }
float smootherstep(float a, float b, float x) { float t = remap(x, a, b); return t * t * t * (t * (t * 6.0 - 15.0) + 10.0); }
// Ray-sphere: returns (tNear, tFar) or (-1,-1).
vec2 sphIntersect(vec3 ro, vec3 rd, vec3 c, float r) {
  vec3 oc = ro - c; float b = dot(oc, rd); float cc = dot(oc, oc) - r * r; float h = b * b - cc;
  if (h < 0.0) return vec2(-1.0); h = sqrt(h); return vec2(-b - h, -b + h);
}
`;

export const all = header + math + hash + noise + color;
