// I · SINGULARITY (0 → 12 s, free time)
// A raymarched void around one point of light. The dim violet foam (fbm + Worley walls,
// from a baked 3D noise volume) is gravitationally lensed: every ray is bent toward the
// point during the march (deflection ∝ 1/b), so structure behind it is smeared into
// Einstein arcs. Differential rotation winds the foam into tightening spirals in the riser.
// The title ORIGIN is kinetic type in the HDR pass: SDF glyphs that assemble from specks of
// light on the leitmotif notes, settle their tracking and weight, then fall into the point.
import { getNoise3D } from './ch1/noise3d.js';
import { buildTitle, CELL, SPREAD, ATLAS_SCALE } from './ch1/title.js';

const TITLE_Y = 0.178;        // glyph cap-centre height above the point (H units)
const SUB_Y = -0.168;         // subtitle centre below the point (H units)
const PULL0 = 9.0, PULL1 = 10.2;
// Riser window and the silence, read from the timeline at init (defaults = storyboard values).
let RISE0 = 7.0, SIL = 10.5, BANG = 12.0;

let foamPass, compPass, foamRT, cam, noiseTex, title;
let speckScene, speckCam, speckMat;
const gA = [], gB = [], gC = [];

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const sstep = (a, b, x) => { const u = clamp01((x - a) / (b - a)); return u * u * (3 - 2 * u); };
const easeOut3 = (u) => 1 - Math.pow(1 - clamp01(u), 3);

// ------------------------------------------------------------------------ foam raymarch
const FOAM_FRAG = /* glsl */`
in vec2 vUv; out vec4 fragColor;
uniform highp sampler3D noiseTex;
uniform vec3 camPos; uniform mat3 camRot; uniform float tanHalf, aspect;
uniform float time, lensM, foamGain, wind, inflow, shellR, shellW, lit, bgGain, frame, RB, soften;
uniform vec2 res;
const int STEPS = 110;

float sq(float x) { return x * x; }
float foam(vec3 p, float r, out float edge) {
  // Differential (Keplerian-ish) rotation about the view axis winds structure into spirals.
  float ang = wind * pow(r + 0.3, -1.3) + time * 0.021;
  vec3 q = p;
  q.xy = rot2(ang) * q.xy;
  q *= inflow;                                  // >1: features drawn inward
  vec3 u = q * 0.26 + vec3(0.13, 0.71, 0.37 + time * 0.0045);
  vec4 w0 = texture(noiseTex, u * 0.6 + vec3(0.31, 0.12, 0.77));
  u += (w0.gba - 0.5) * 0.45;
  vec4 a = texture(noiseTex, u);
  vec4 b = texture(noiseTex, u * 2.1 + vec3(0.41, 0.17, 0.83));
  float r1 = 1.0 - abs(a.r - 0.5) * 2.0;             // ridges (sheets) of two independent fields…
  float r3 = 1.0 - abs(a.b - 0.5) * 2.0;
  float r2 = 1.0 - abs(b.g - 0.5) * 2.0;
  float fil = pow(r1 * r3, 7.0 - 3.5 * soften);      // …intersect in curves: veil filaments
  fil += 0.5 * pow(r2 * r1, 9.0);
  float w = 1.0 - smoothstep(0.0, 0.18, a.a);
  edge = clamp(fil * 3.0, 0.0, 1.0);
  float d = fil * (2.2 + 1.5 * w) + 0.012 * smoothstep(0.5, 0.8, w0.r);
  float sh = exp(-sq((r - shellR) / shellW)) + 0.18 * exp(-sq((r - shellR * 1.8) / (shellW * 1.5)));
  sh *= mix(0.28, 1.0, smoothstep(0.7, -0.7, p.z));      // the far side (lensed) dominates
  return d * sh;
}
void main() {
  vec2 ndc = vUv * 2.0 - 1.0;
  vec3 rd = normalize(camRot * vec3(ndc.x * tanHalf * aspect, ndc.y * tanHalf, -1.0));
  vec3 ro = camPos;
  vec3 col = vec3(0.0);
  float trans = 1.0;
  bool captured = false;
  vec2 hit = sphIntersect(ro, rd, vec3(0.0), RB);
  if (hit.y > 0.0) {
    vec3 p = ro + rd * max(hit.x, 0.0);
    float jit = hash13(vec3(gl_FragCoord.xy, frame));
    for (int i = 0; i < STEPS; i++) {
      float r = length(p);
      if (r > RB + 0.02 && dot(p, rd) > 0.0) break;
      if (r < 0.045) { captured = true; break; }
      float h = clamp((0.03 + 0.05 * r) * RB / 3.4, 0.012, 0.12);
      if (i == 0) h *= jit;
      // Gravitational bending toward the point: a = -M p / r^3 (total deflection 2M/b).
      rd = normalize(rd - p * (lensM / (r * r * r)) * h);
      p += rd * h;
      float edge;
      float dens = foam(p, length(p), edge);
      if (dens > 0.002) {
        float rr = length(p);
        vec3 base = mix(vec3(0.030, 0.020, 0.105), vec3(0.105, 0.045, 0.200), edge);
        vec3 glow = vec3(0.85, 0.50, 1.00) * lit / (rr * rr * 5.0 + 0.18);
        col += trans * dens * (base + glow * (0.35 + 0.65 * edge)) * h * foamGain;
        trans *= exp(-dens * 0.9 * h);
      }
    }
  }
  // The far void: a whisper of deep violet on the sky sphere, seen through the lens.
  if (!captured) {
    vec4 n = texture(noiseTex, rd * 1.6 + vec3(0.5));
    vec4 n2 = texture(noiseTex, rd * 4.1 + vec3(0.2, 0.7, 0.1));
    float neb = pow(1.0 - abs(n.b - 0.5) * 2.0, 6.0) * (0.4 + n2.r);
    col += trans * bgGain * (vec3(0.006, 0.0035, 0.016) * neb + vec3(0.0008, 0.0005, 0.002));
  }
  fragColor = vec4(col, 1.0);
}`;

// ------------------------------------------------------------------------ composite
const COMP_FRAG = /* glsl */`
in vec2 vUv; out vec4 fragColor;
uniform sampler2D foamTex, atlas, subTex;
uniform vec2 res, atlasSize, subSize;
uniform vec4 gA[6];     // centre xy (H units), scale, alpha
uniform vec4 gB[6];     // k_parallel, k_perp, iso (1080p px, + = bolder), brightness
uniform vec4 gC[6];     // resolve, glow, -, -
uniform float lensE;    // title lens Einstein radius (H units)
uniform vec4 subA;      // centre y, reveal, alpha, brightness
uniform vec4 subB;      // x scale, y scale, half width (H units), -
uniform vec4 pt;        // core I, core r, halo I, halo r   (H units)
uniform vec4 pt2;       // glow I, glow r, offset xy (H units)
uniform vec4 flare;     // I, r, -, -
uniform float cell, spread, atlasScale;
float sq(float x) { return x * x; }
float vn2(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float a = hash12(i), b = hash12(i + vec2(1, 0)), c = hash12(i + vec2(0, 1)), d = hash12(i + vec2(1, 1));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
void main() {
  vec2 th = (gl_FragCoord.xy - 0.5 * res) / res.y;          // H units, y up, 0 = the point
  vec3 col = texture(foamTex, vUv).rgb;

  // The point: core, halo, wide glow.
  vec2 pr = th - pt2.zw;
  float r = length(pr);
  col += vec3(1.0, 0.93, 0.80) * pt.x * exp(-sq(r / pt.y));
  col += vec3(1.0, 0.80, 0.56) * pt.z * exp(-r / pt.w);
  col += vec3(0.62, 0.48, 1.00) * pt2.x * exp(-r / pt2.y);
  col += vec3(0.85, 0.90, 1.00) * flare.x * exp(-r / max(flare.y, 1e-4));

  // Title: sample source coords through a point lens (only during the fall).
  vec2 be = th;
  if (lensE > 0.0) { float r2 = max(dot(th, th), 1e-7); be = th - lensE * lensE * th / r2; }
  vec3 tcol = vec3(0.0);
  float hpx = res.y / 1080.0;
  for (int i = 0; i < 6; i++) {
    if (gA[i].w <= 0.0005) continue;
    vec2 d = be - gA[i].xy;
    vec2 u = normalize(-gA[i].xy + vec2(1e-6, 0.0));
    vec2 v = vec2(-u.y, u.x);
    vec2 loc = (dot(d, u) / gB[i].x) * u + (dot(d, v) / gB[i].y) * v;
    loc /= gA[i].z;
    vec2 apx = vec2(loc.x, -loc.y) * 1080.0 * atlasScale + 0.5 * cell;
    if (any(lessThan(apx, vec2(2.0))) || any(greaterThan(apx, vec2(cell - 2.0)))) continue;
    apx.x += float(i) * cell;
    float sd = (0.5 - texture(atlas, apx / atlasSize).r) * 2.0 * spread;       // atlas px, + outside
    float k = gA[i].z * sqrt(gB[i].x * gB[i].y);
    float sdPx = sd / atlasScale * hpx * k;
    float fill = smoothstep(0.8, -0.8, sdPx - gB[i].z * hpx);
    float n = vn2(loc * 1080.0 / 9.0 + float(i) * 17.0) * 0.65 + vn2(loc * 1080.0 / 3.5) * 0.35;
    float rs = gC[i].x * 1.2 - 0.1;
    fill *= smoothstep(n - 0.1, n + 0.1, rs);
    float glow = exp(-max(sdPx, 0.0) / (6.0 * hpx)) * smoothstep(spread, 0.45 * spread, sd) * gC[i].y;
    tcol += vec3(1.0, 0.93, 0.84) * gB[i].w * gA[i].w * (fill + glow);
  }
  // Subtitle.
  if (subA.z > 0.0005) {
    vec2 sp = be - vec2(0.0, subA.x);
    sp.x /= subB.x; sp.y /= subB.y;
    vec2 spx = vec2(sp.x * res.y + 0.5 * res.x, 0.5 * subSize.y - sp.y * res.y);
    if (spx.y > 0.0 && spx.y < subSize.y) {
      float sa = texture(subTex, spx / subSize).a;
      float xn = sp.x / subB.z * 0.5 + 0.5;
      float rv = smoothstep(xn - 0.05, xn + 0.05, subA.y * 1.1 - 0.05);
      tcol += vec3(0.88, 0.85, 1.0) * sa * rv * subA.z * subA.w;
    }
  }
  fragColor = vec4(col + tcol, 1.0);
}`;

// ------------------------------------------------------------------------ specks
const SPECK_VERT = /* glsl */`
precision highp float;
in vec3 position;
in vec4 aTgt;     // glyph-local target xy (H units), glyph index, rand
in vec4 aRnd;
uniform float time, aspect, lensE, hpx;
uniform vec4 gA[6]; uniform vec4 gB[6];
uniform float gT[6];
out vec2 vP; out float vHalf; out float vR; out vec3 vCol;
const float TAU = 6.28318530718;
float sq(float x) { return x * x; }
vec2 xf(int i, vec2 l) {
  vec2 c = gA[i].xy;
  vec2 u = normalize(-c + vec2(1e-6, 0.0)), v = vec2(-u.y, u.x);
  l *= gA[i].z;
  vec2 w = dot(l, u) * gB[i].x * u + dot(l, v) * gB[i].y * v;
  return c + w;
}
vec2 lensFwd(vec2 b) {                         // source -> primary image
  if (lensE <= 0.0) return b;
  float rb = max(length(b), 1e-6);
  return b * (0.5 + 0.5 * sqrt(1.0 + 4.0 * lensE * lensE / (rb * rb)));
}
vec2 pathAt(int i, float t, out float u) {
  float ts = gT[i] - 0.10 + aRnd.x * 0.34;
  float dur = 0.55 + aRnd.y * 0.6;
  u = (t - ts) / dur;
  float e = 1.0 - pow(1.0 - clamp(u, 0.0, 1.0), 3.0);
  float R0 = 0.025 + 0.13 * pow(aRnd.z, 1.4);
  float ph = aTgt.w * TAU;
  float spin = (aRnd.w * 2.0 - 1.0) * 0.8 + 2.4;
  vec2 off = R0 * (1.0 - e) * vec2(cos(ph + spin * e), sin(ph + spin * e));
  return lensFwd(xf(i, aTgt.xy) + off);
}
void main() {
  int i = int(aTgt.z + 0.5);
  float u, u0;
  vec2 p1 = pathAt(i, time, u);
  vec2 p0 = pathAt(i, time - 1.0 / 320.0, u0);
  float land = gT[i] - 0.10 + aRnd.x * 0.34 + 0.55 + aRnd.y * 0.6;
  float I = 0.0;
  if (u > 0.0) {
    I = smoothstep(0.0, 0.3, u) * (0.9 + 1.1 * aRnd.w) * (0.55 + 0.45 * sin(time * 37.0 + aRnd.x * 91.0));
    I += 3.0 * exp(-sq(u - 1.0) / 0.003);
    if (u > 1.0) I *= exp(-(time - land) / 0.28);
  }
  I *= gA[i].w;
  if (I < 0.003) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec2 s1 = p1 * hpx * 1080.0, s0 = p0 * hpx * 1080.0;         // px from centre
  vec2 dd = s1 - s0; float len = length(dd);
  vec2 dir = len > 1e-4 ? dd / len : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  float r = max(1.0 * hpx, 0.8);
  vec2 mid = 0.5 * (s0 + s1);
  float hl = 0.5 * len;
  vec2 pos = mid + dir * position.x * (hl + 2.5 * r) + nrm * position.y * 2.5 * r;
  vP = vec2(position.x * (hl + 2.5 * r), position.y * 2.5 * r);
  vHalf = hl; vR = r;
  vec3 warm = vec3(1.0, 0.86, 0.64), cool = vec3(0.78, 0.70, 1.0);
  vCol = mix(warm, cool, step(0.72, aRnd.z)) * I / (1.0 + 2.0 * len / (3.14159 * r));
  vec2 ndc = pos / (vec2(aspect, 1.0) * 540.0 * hpx);
  gl_Position = vec4(ndc, 0.0, 1.0);
}`;

const SPECK_FRAG = /* glsl */`
precision highp float;
in vec2 vP; in float vHalf; in float vR; in vec3 vCol;
out vec4 fragColor;
void main() {
  vec2 q = vP; q.x = max(abs(q.x) - vHalf, 0.0);
  float d2 = dot(q, q) / (vR * vR);
  float a = exp(-d2 * 1.6) + 0.12 * exp(-sqrt(d2) * 1.4);
  fragColor = vec4(vCol * a, 1.0);
}`;

// ------------------------------------------------------------------------ timing (pure f(t))
function glyphState(T, i, t, gx) {
  const Ti = T.titleGlyphTimes[i];
  const resolve = sstep(Ti + 0.28, Ti + 1.05, t);
  const appear = t >= Ti - 0.12 ? 1 : 0;
  // Tracking settle: glyphs arrive a little wide and ease into their final spacing.
  const settle = easeOut3((t - Ti) / 1.9);
  const dx = (gx >= 0 ? 1 : -1) * 0.022 * (1 - settle) * (0.4 + Math.abs(gx) * 2.2);
  // Weight settle: resolves a touch heavy, relaxes to the 300 weight.
  const iso = 2.6 * (1 - sstep(Ti + 0.45, Ti + 2.4, t));
  let bright = 1.0 + 0.3 * (1 - sstep(Ti + 0.5, Ti + 2.0, t));
  let glow = 0.045 + 0.08 * (1 - sstep(Ti + 0.4, Ti + 1.8, t));
  // The fall (9.0-10.2): inner glyphs go first; accelerating, spaghettified, lensed, gone.
  const rank = [3, 1, 0, 0, 1, 3][i] * 0.5 + (i > 2 ? 0.12 : 0);
  const p0 = PULL0 + 0.19 * rank, p1 = Math.min(PULL1, p0 + 0.78);
  const s = clamp01((t - p0) / (p1 - p0));
  const e = Math.pow(s, 2.3);
  let cx = gx + dx, cy = TITLE_Y;
  const ang = -0.5 * e;                                            // swirl the same way as the foam
  const ca = Math.cos(ang), sa = Math.sin(ang);
  let x = cx * (1 - e), y = cy * (1 - e);
  const xr = x * ca - y * sa, yr = x * sa + y * ca;
  bright *= 1 + 2.2 * e;
  glow += 0.5 * e;
  const alpha = appear * (1 - sstep(0.55, 1.0, s));
  return {
    A: [xr, yr, 1 - 0.3 * e, alpha],
    B: [1 + 2.6 * e, Math.max(0.12, 1 - 0.62 * e), iso, bright],
    C: [resolve, glow, 0, 0],
  };
}

function pointState(ctx, t) {
  const f = ctx.features.at(t);
  const breath = 1 + 0.05 * Math.sin(2 * Math.PI * t / 3.7) + 0.03 * Math.sin(2 * Math.PI * t / 1.9 + 1.3)
    + 0.5 * f.low + 0.3 * f.rms;
  const rz = sstep(RISE0, SIL, t), r2 = rz * rz;
  const c = sstep(SIL, SIL + 0.25, t);           // the inhale
  let coreI = 30 * breath * (1 + 3.0 * r2);
  let coreR = 0.0026 * (1 + 0.25 * r2);
  let haloI = 0.55 * breath * (1 + 2.2 * r2);
  let haloR = 0.0105 * (1 + 0.8 * r2);
  let glowI = 0.035 * breath * (1 + 3.0 * r2);
  let glowR = 0.034 * (1 + 0.6 * r2);
  // Collapse to a pinprick.
  coreR = coreR * (1 - c) + 0.0011 * c;
  coreI = coreI * (1 - c) + 14 * c;
  haloI *= 1 - c * 0.93; haloR = haloR * (1 - c) + 0.0022 * c;
  glowI *= (1 - c) * (1 - c); glowR *= 1 - 0.8 * c;
  let ox = 0, oy = 0;
  if (t > SIL) {                                  // tremble (deterministic, sub-pixel)
    const k = sstep(SIL + 0.05, SIL + 0.4, t) * (1 - sstep(BANG - 0.03, BANG, t));
    ox = 0.00042 * k * (Math.sin(t * 71.3) * 0.6 + Math.sin(t * 131.7 + 1.1) * 0.4);
    oy = 0.00042 * k * (Math.sin(t * 83.9 + 2.0) * 0.6 + Math.sin(t * 117.1 + 0.3) * 0.4);
    const fl = 1 + 0.28 * k * Math.sin(t * 47.0) * Math.sin(t * 29.3 + 2.0);
    coreI *= fl; haloI *= fl;
  }
  // 12.000: the pinprick detonates (hand-off to II's eruption).
  let flI = 0, flR = 0.001;
  if (t >= BANG) {
    const x = (t - BANG) / 0.15;
    flR = 0.003 + 0.004 * Math.min(x, 1);           // the pinprick flares into a star…
    flI = 5 * Math.exp(-x * 0.8);                    // …and fades under the flash
    coreI *= 1 + 2 * x; ox = oy = 0;
  }
  return { pt: [coreI, coreR, haloI, haloR], pt2: [glowI, glowR, ox, oy], flare: [flI, flR, 0, 0] };
}

function foamState(ctx, t) {
  const f = ctx.features.at(t);
  const rz = sstep(RISE0, SIL, t);
  const c = sstep(SIL, SIL + 0.25, t);
  const ramp = Math.pow(rz, 2.2);
  return {
    foamGain: 0.36 * (1 + 0.45 * ramp + 0.35 * f.low) * Math.pow(1 - c, 2) * (t < SIL + 0.3 ? 1 : 0),
    wind: 0.045 * t + 2.4 * ramp + 4.0 * c,
    inflow: Math.exp(0.018 * t + 1.0 * ramp + 1.3 * c),
    shellR: 1.35 * Math.exp(-1.0 * ramp) * (1 - 0.75 * c),
    shellW: 0.7 * (1 - 0.45 * ramp) * (1 - 0.5 * c),
    lensM: 0.085 * (1 + 0.3 * ramp),
    lit: 0.22 * (1 + 2.2 * ramp) * (1 + 0.4 * f.low),
    soften: ramp,
    bgGain: 1 - sstep(SIL, SIL + 0.12, t),
    RB: 0,
  };
}

export default {
  id: 'I',

  async init(ctx) {
    const { THREE, glsl, Pass, W, H } = ctx;
    const T = ctx.T;
    const riser = T.sfx.find(e => e.type === 'riser' && e.t < T.chapterById.I.end);
    if (riser) RISE0 = riser.t;
    SIL = T.silence ? T.silence[0] : (riser ? riser.t + riser.dur : SIL);
    BANG = T.chapterById.II.start;
    noiseTex = getNoise3D(THREE);
    title = buildTitle(ctx);
    cam = new THREE.PerspectiveCamera(40, ctx.aspect, 0.01, 100);
    foamRT = ctx.makeTarget(Math.round(W / 2), Math.round(H / 2));
    foamPass = new Pass(glsl.all + FOAM_FRAG, {
      noiseTex: { value: noiseTex }, camPos: { value: new THREE.Vector3() }, camRot: { value: new THREE.Matrix3() },
      tanHalf: { value: 0.36 }, aspect: { value: ctx.aspect }, res: { value: new THREE.Vector2(foamRT.width, foamRT.height) },
      time: { value: 0 }, lensM: { value: 0.05 }, foamGain: { value: 1 }, wind: { value: 0 }, inflow: { value: 1 },
      shellR: { value: 1.7 }, shellW: { value: 0.85 }, lit: { value: 0.2 }, bgGain: { value: 1 }, frame: { value: 0 }, RB: { value: 3.4 }, soften: { value: 0 },
    });
    for (let i = 0; i < 6; i++) { gA.push(new THREE.Vector4()); gB.push(new THREE.Vector4()); gC.push(new THREE.Vector4()); }
    compPass = new Pass(glsl.all + COMP_FRAG, {
      foamTex: { value: foamRT.texture }, atlas: { value: title.atlas }, subTex: { value: title.subTex },
      res: { value: new THREE.Vector2(W, H) }, atlasSize: { value: new THREE.Vector2(...title.atlasSize) },
      subSize: { value: new THREE.Vector2(...title.subSize) },
      gA: { value: gA }, gB: { value: gB }, gC: { value: gC }, lensE: { value: 0 },
      subA: { value: new THREE.Vector4() }, subB: { value: new THREE.Vector4(1, 1, title.subHalfW, 0) },
      pt: { value: new THREE.Vector4() }, pt2: { value: new THREE.Vector4() }, flare: { value: new THREE.Vector4() },
      cell: { value: CELL }, spread: { value: SPREAD }, atlasScale: { value: ATLAS_SCALE },
    });

    // Specks: instanced capsules, one per sampled ink point.
    const n = title.targets.length;
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    const tgt = new Float32Array(n * 4), rr = new Float32Array(n * 4);
    const rnd = ctx.T.mulberry32(0x51ec);
    title.targets.forEach((p, k) => {
      tgt.set([p.x, p.y, p.glyph, rnd()], k * 4);
      rr.set([rnd(), rnd(), rnd(), rnd()], k * 4);
    });
    geo.setAttribute('aTgt', new THREE.InstancedBufferAttribute(tgt, 4));
    geo.setAttribute('aRnd', new THREE.InstancedBufferAttribute(rr, 4));
    geo.instanceCount = n;
    speckMat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: SPECK_VERT,
      fragmentShader: SPECK_FRAG,
      uniforms: {
        time: { value: 0 }, aspect: { value: ctx.aspect }, lensE: { value: 0 }, hpx: { value: H / 1080 },
        gA: { value: gA }, gB: { value: gB }, gT: { value: ctx.T.titleGlyphTimes.slice() },
      },
      blending: THREE.AdditiveBlending, transparent: true, depthTest: false, depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, speckMat);
    mesh.frustumCulled = false;
    speckScene = new THREE.Scene(); speckScene.add(mesh);
    speckCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  },

  render(ctx, t, target) {
    const { T, renderer: r } = ctx;
    // Camera (timeline keys).
    ctx.applyCamera(cam, T.sampleCamera(T.cameras.I, t));
    const fu = foamPass.uniforms;
    fu.camPos.value.copy(cam.position);
    fu.camRot.value.setFromMatrix4(cam.matrixWorld);
    fu.tanHalf.value = Math.tan(cam.fov * Math.PI / 360);
    const fs = foamState(ctx, t);
    fs.RB = Math.min(3.4, Math.max(0.9, fs.shellR * 1.8 + fs.shellW * 3.4));
    Object.assign(fu.time, { value: t });
    for (const k in fs) fu[k].value = fs[k];
    fu.frame.value = ctx.frameSeed(t) % 997;
    if (fs.foamGain > 0 || fs.bgGain > 0) foamPass.render(r, foamRT);
    else ctx.clear(foamRT, [0, 0, 0]);                  // the foam is gone after the inhale

    // Title + point.
    for (let i = 0; i < 6; i++) {
      const s = glyphState(T, i, t, title.glyphs[i].x);
      gA[i].set(...s.A); gB[i].set(...s.B); gC[i].set(...s.C);
    }
    const lensE = 0.042 * Math.pow(sstep(PULL0, PULL1, t), 0.7);
    const sub = { reveal: clamp01((t - 7.8) / 1.5), alpha: t >= 7.8 ? 1 : 0 };
    const ss = clamp01((t - 9.0) / 0.8), se = Math.pow(ss, 2.0);
    const cu = compPass.uniforms;
    cu.lensE.value = lensE;
    cu.subA.value.set(SUB_Y * (1 - 0.55 * se), sub.reveal, sub.alpha * (1 - sstep(0.2, 0.85, ss)), 0.55 * (1 + 0.8 * se));
    cu.subB.value.set(Math.max(0.05, 1 - 0.6 * se), 1, title.subHalfW, 0);
    const ps = pointState(ctx, t);
    cu.pt.value.set(...ps.pt); cu.pt2.value.set(...ps.pt2); cu.flare.value.set(...ps.flare);
    compPass.render(r, target);

    // Specks (additive over the composite).
    if (t > T.titleGlyphTimes[0] - 0.2 && t < PULL1 + 0.1) {
      speckMat.uniforms.time.value = t;
      speckMat.uniforms.lensE.value = lensE;
      r.autoClear = false;
      r.setRenderTarget(target);
      r.render(speckScene, speckCam);
      r.autoClear = true;
    }
  },

  post(t) {
    return { bloom: 0.62, threshold: 0.9, knee: 0.7, bloomRadius: 1.0, vignette: 0.42, grain: 0.03, ca: 0.0012, saturation: 1.0 };
  },
};
