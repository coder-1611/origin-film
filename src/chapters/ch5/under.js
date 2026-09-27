// V · PALE BLUE: underwater (T.SPLASH_T → 107). Local frame, metres, surface at y = 0.
//   field: in-water radiance by view elevation, calibrated so the level camera at 105–107
//     shows the V→VI contract gradient (bottom 0.004/0.035/0.045 → top 0.05/0.22/0.24)
//   god rays: the view ray is marched through the water; each sample looks up the surface
//     caustic pattern where the refracted sun ray entered (shafts = extruded caustics)
//   splash: a white-water veil (bubble cloud) that clears from the centre and drifts up,
//     plus a burst of small fast bubbles; T.bubbles events as distinct rising bubbles
import { ATMO_CONST, ATMO_FUNCS } from './atmo.js';

export const MAX_BUBBLES = 96;

// ---------------------------------------------------------------- bubbles (pure f(t))
// Returns [x, y, r, alpha] in NDC (y up, r in NDC-y units).
export function bubbleState(T, t, aspect) {
  const out = [];
  const S = T.SPLASH_T;
  // timeline events: each is a bubble (plus two small followers) born at (x, y) at b.t
  T.bubbles.forEach((b, i) => {
    const a = t - b.t;
    if (a < 0 || a > 5) return;
    const h = T.hash1(9001 + i), h2 = T.hash1(7001 + i);
    const r0 = 0.017 + 0.01 * h;
    const trio = [[0, 0, 1], [0.012 + 0.01 * h2, -0.035, 0.55], [-0.01, -0.07 - 0.02 * h, 0.4]];
    trio.forEach(([dx, dy, s], j) => {
      const aj = a - j * 0.07;
      if (aj < 0) return;
      const rise = (0.2 + 0.08 * s) * aj + 0.035 * aj * aj;
      const y = b.y + dy * (1 - Math.exp(-aj * 3)) + rise;
      const x = b.x + dx * (1 - Math.exp(-aj * 3)) + 0.018 * Math.sin(aj * (6.5 + 3 * h2)) * s;
      const r = r0 * s * (1 + 0.12 * aj);
      const al = Math.min(1, aj / 0.06) * (1 - T.smootherstep(0.82, 1.08, y));
      if (al > 0.002) out.push([x, y, r, al]);
    });
  });
  // the entry burst: small fast bubbles streaming up past the lens
  const since = t - S;
  if (since >= 0 && since < 2.2) {
    for (let k = 0; k < 44; k++) {
      const h = T.hash1(5000 + k), h2 = T.hash1(6000 + k), h3 = T.hash1(6500 + k);
      const born = 0.02 + 0.45 * h3;
      const a = since - born;
      if (a < 0) continue;
      const x = (h * 2 - 1) * 1.05 + 0.03 * Math.sin(a * 9 + k);
      const y = -1.15 + 0.7 * h2 + (0.9 + 0.7 * h) * a + 0.25 * a * a;
      const r = 0.005 + 0.012 * h2 * h2;
      const al = Math.min(1, a / 0.05) * (1 - T.smootherstep(0.9, 1.1, y)) * (1 - T.smootherstep(1.2, 2.0, since)) * 0.85;
      if (al > 0.002 && y < 1.15) out.push([x, y, r, al]);
    }
  }
  return out.slice(0, MAX_BUBBLES);
}

export const UNDER_FRAG = (glsl) => glsl.all + ATMO_CONST + ATMO_FUNCS + /* glsl */`
in vec2 vUv; out vec4 fragColor;
uniform vec3 uLocR, uLocU, uLocF, uSunL;
uniform float uTanHalf, uAspect, uTime, uDepth, uSince, uAlong, uKick, uHigh, uNBub;
uniform vec2 uRes;
uniform vec4 uBub[${MAX_BUBBLES}];

// refracted sun direction (toward the sun, under water)
vec3 sunUnder() {
  vec2 h = uSunL.xz;
  float hl = length(h);
  float s = hl / 1.333;
  return normalize(vec3(h / max(hl, 1e-5) * s, sqrt(1.0 - s * s)));
}
vec3 fieldRad(vec3 rd, vec3 Lr, float depth) {
  // A·exp(K·sinθ): matches the contract at θ = ±20° (fov 40, level camera)
  const vec3 A = vec3(0.01414, 0.0877, 0.1039), K = vec3(3.69, 2.69, 2.44);
  // exact inside ±0.36 (the contract's ±20°), softly saturating beyond (looking up/down)
  float s = rd.y, as = abs(s);
  if (as > 0.36) as = 0.36 + 0.5 * (1.0 - exp(-(as - 0.36) / 0.5));
  s = sign(s) * as;
  vec3 c = A * exp(K * s);
  float sg = max(dot(rd, Lr), 0.0);
  c *= 1.0 + 0.12 * pow(sg, 6.0) * smoothstep(-0.1, 0.4, rd.y) + 0.25 * pow(sg, 40.0);
  // shallower right after the plunge: brighter and a touch greener-white
  c *= exp(-(depth - 7.5) * 0.09);
  return c;
}
// surface caustic network, used for the shafts
float caust(vec2 p, float tt, float blur) {
  float a = clamp(1.0 - abs(snoise(vec3(p * 0.9, tt * 0.35))), 0.0, 1.0);
  float b = clamp(1.0 - abs(snoise(vec3(p * 1.9 + 7.3, tt * 0.5 + 3.0))), 0.0, 1.0);
  float e1 = mix(7.0, 2.5, blur), e2 = mix(9.0, 3.0, blur);
  return pow(a, e1) * 0.75 + pow(b, e2) * 0.4 * (1.0 - blur);
}

void main() {
  vec2 ndc = vUv * 2.0 - 1.0;
  vec3 rd = normalize(uLocF + ndc.x * uAspect * uTanHalf * uLocR + ndc.y * uTanHalf * uLocU);
  vec3 Lr = sunUnder();
  float depth = uDepth;
  vec3 ro = vec3(0.0, -depth, -uAlong);
  vec3 col = fieldRad(rd, Lr, depth);

  // god rays / volumetric caustics
  float jit = hash12(gl_FragCoord.xy + fract(uTime * 7.13) * 0.0);
  float sh = 0.0;
  const int NS = 22;
  float maxT = 22.0;
  for (int i = 0; i < NS; i++) {
    float t = (float(i) + jit) / float(NS) * maxT;
    vec3 p = ro + rd * t;
    if (p.y > -0.05) break;
    vec2 s = p.xz + Lr.xz / Lr.y * (-p.y);
    float blur = clamp((-p.y) / 14.0 + t / 30.0, 0.0, 1.0);   // deeper / farther → softer beams
    float c = caust(s * 0.32, uTime, blur);
    float att = exp(-0.09 * t) * exp(-0.16 * (-p.y) / Lr.y);
    sh += c * att;
  }
  sh *= maxT / float(NS);
  // forward-peaked water phase function (HG, g = 0.65), normalised so looking ~45° off the sun ≈ 1
  float cph = dot(rd, Lr);
  float hgp = 0.5775 / pow(1.4225 - 1.3 * cph, 1.5) / 1.6;
  sh *= hgp * (0.35 + 0.65 * smoothstep(-0.45, 0.25, rd.y));
  float shaftK = 0.0045 * (1.0 + 0.35 * uKick + 0.4 * uHigh);
  col += vec3(0.30, 0.85, 0.80) * sh * shaftK * (1.0 + 2.0 * exp(-uSince / 0.6));

  // marine snow: faint specks, twinkling as caustic light passes over them
  {
    vec3 p = rd * 70.0;
    vec3 b = floor(p - 0.5);
    float pixAng = 2.0 * uTanHalf / uRes.y;
    for (int k = 0; k < 8; k++) {
      vec3 c = b + vec3(float(k & 1), float((k >> 1) & 1), float((k >> 2) & 1));
      vec3 h = hash33(c + 0.5);
      if (h.x > 0.05) continue;
      vec3 sp = normalize(c + hash33(c + 13.5));
      float d = length(cross(rd, sp));
      float sz = pixAng * (1.2 + 3.0 * h.y);
      float tw = 0.3 + 0.7 * caust(sp.xz * 30.0 + h.z * 9.0, uTime * 1.3, 0.0);
      col += vec3(0.4, 0.8, 0.8) * 0.02 * tw * exp(-d * d / (sz * sz));
    }
  }

  // white water after the plunge: a rising cloud of tiny bubbles that clears from the centre
  if (uSince < 1.2) {
    vec2 q = ndc * vec2(uAspect, 1.0);
    float r = length(q * vec2(0.8, 1.0));
    float rise = uSince * 1.9 + uSince * uSince * 1.2;
    float n = fbm(vec3(q * 1.7 + vec2(0.0, -rise), uSince * 1.2), 4) * 0.5 + 0.5;
    float front = 0.05 + 2.1 * pow(clamp(uSince / 0.75, 0.0, 1.0), 0.65);
    float mask = smoothstep(front - 0.3, front + 0.35, r + 0.7 * (n - 0.5) - 0.25 * ndc.y);
    mask *= 1.0 - smoothstep(0.5, 1.2, uSince);
    mask = max(mask, 1.0 - smoothstep(0.0, 0.1, uSince));
    // bubble speckle: many tiny bright points, streaked upward
    vec3 sq = vec3(q.x * 30.0, (q.y - rise * 0.6) * 16.0, uSince * 4.0);
    float sp = smoothstep(0.45, 0.95, snoise(sq)) + 0.6 * smoothstep(0.5, 0.95, snoise(sq * 2.1 + 5.0));
    vec3 milky = vec3(0.34, 0.62, 0.64) * (0.8 + 0.6 * n);
    col = mix(col, milky, clamp(mask, 0.0, 1.0) * 0.8);
    col += vec3(0.8, 1.0, 1.0) * sp * mask * 0.9;
  }

  // bubbles (screen space)
  vec2 pix = vec2(ndc.x * uAspect, ndc.y);
  for (int i = 0; i < ${MAX_BUBBLES}; i++) {
    if (float(i) >= uNBub) break;
    vec4 b = uBub[i];
    vec2 d = (pix - vec2(b.x * uAspect, b.y)) / b.z;
    float wob = sin(uTime * 23.0 + float(i) * 1.7);
    d *= vec2(0.9 + 0.06 * wob, 1.12 - 0.06 * wob);        // oblate, wobbling
    float l = length(d);
    if (l > 1.4) continue;
    float px = (2.0 / uRes.y) / b.z;                 // one pixel in bubble units
    float body = 1.0 - smoothstep(1.0 - px, 1.0 + px, l);
    float rim = smoothstep(0.62, 0.98, l) * body;
    float top = clamp(0.5 + 0.6 * d.y, 0.0, 1.0);
    vec3 rimC = vec3(0.7, 0.95, 0.95) * (0.35 + 1.1 * top);
    vec2 hp = d - vec2(-0.32, 0.42);
    float hl = exp(-dot(hp, hp) / 0.018);
    // interior: the (darker) water from below, refracted and flipped
    vec3 inside = col * (0.62 + 0.3 * clamp(0.5 - 0.6 * d.y, 0.0, 1.0));
    vec3 bc = mix(inside, rimC, rim * 0.8) + vec3(1.4, 1.6, 1.6) * hl * body;
    col = mix(col, bc, body * b.w);
    // faint halo so tiny bubbles still read
    col += vec3(0.1, 0.25, 0.25) * b.w * 0.08 * exp(-max(l - 1.0, 0.0) * 6.0) * (1.0 - body);
  }
  fragColor = vec4(col, 1.0);
}`;
