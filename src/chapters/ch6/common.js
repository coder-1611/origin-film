// VI · LIFE: shared uniforms + GLSL for every pass and material of the chapter, so light,
// colour and media stay coherent between the underwater view, the air view and the composite.
import { THREE } from '../../engine/gl.js';

export const FAR = 3000.0;          // "no hit" distance written by background passes
export const WATER_MAG = 1.2;       // flat-port magnification of the underwater view

/** One uniform object shared (by reference) by every material. */
export function makeGlobals() {
  return {
    uT: { value: 0 },
    uSunDir: { value: new THREE.Vector3(0, 0.3, -1).normalize() },   // toward the sun (air)
    uSunW: { value: new THREE.Vector3(0, 1, 0) },                     // toward the sun, refracted into the water
    uSunCol: { value: new THREE.Vector3(1, 0.9, 0.8) },
    uSkyZen: { value: new THREE.Vector3(0.1, 0.2, 0.4) },
    uSkyHor: { value: new THREE.Vector3(0.8, 0.6, 0.5) },       // horizon toward the sun
    uSkyHor2: { value: new THREE.Vector3(0.6, 0.6, 0.7) },      // horizon away from the sun
    uSkyMid: { value: new THREE.Vector3(0.4, 0.4, 0.5) },       // the belt between horizon and zenith
    uSunDisk: { value: 14 },
    uSunVis: { value: 1 },
    uWaterLight: { value: 1 },
    uGlint: { value: 0 },          // the sun's last glint on the horizon (a point that hands over to the torch)
    uDusk: { value: 0 },            // 0 = afternoon … 1 = full dusk (sky darkening to black)
    uCamPos: { value: new THREE.Vector3() },
    uCaus: { value: null },          // animated caustics (R: sharp, G: soft), repeat-wrapped
    uNoise: { value: null },         // static tileable fbm noise (RGBA), repeat-wrapped
    uRD: { value: null },            // Gray-Scott state
    uKick: { value: 0 },            // kick envelope (0..1)
    uAudio: { value: new THREE.Vector3() },   // analysed low / mid / high (zeros until the score exists)
    uGreen: { value: 0 },           // shore greening 0..1
    uUnder: { value: new THREE.Vector3(0.02, 0.12, 0.13) },   // underwater ambient
  };
}

export const GL_UNIFORMS = /* glsl */`
uniform float uT, uDusk, uKick, uGreen, uSunDisk, uSunVis, uWaterLight, uGlint;
uniform vec3 uSunDir, uSunW, uSunCol, uSkyZen, uSkyHor, uSkyHor2, uSkyMid, uCamPos, uUnder, uAudio;
uniform sampler2D uCaus, uNoise;
`;

// ------------------------------------------------------------------ underwater light
// Inscattered water colour seen along a ray of infinite length. Per-channel log-linear in the
// ray elevation, calibrated to the V→VI contract: at the 105 s framing the bottom edge reads
// (0.004, 0.035, 0.045) and the top edge (0.05, 0.22, 0.24).
export const GL_WATER = /* glsl */`
const vec3 W_BOT = vec3(0.004, 0.035, 0.045);
const vec3 W_TOP = vec3(0.05, 0.22, 0.24);
uniform float uEB, uET;            // elevations (radians) of the contract's bottom/top edges
vec3 waterInscatter(vec3 d) {
  float e = asin(clamp(d.y, -1.0, 1.0));
  float u = (e - uEB) / (uET - uEB);
  u = u < 0.0 ? u * 0.6 : (u > 1.0 ? 1.0 + (u - 1.0) * 0.55 : u);
  u = clamp(u, -0.6, 1.9);
  vec3 c = W_BOT * pow(W_TOP / W_BOT, vec3(u));
  // forward scattering toward the refracted sun
  float fs = pow(max(dot(d, uSunW), 0.0), 6.0);
  c *= 1.0 + 0.35 * fs;
  return c * mix(vec3(1.0), vec3(1.05, 1.0, 0.86), uGreen * 0.5) * uWaterLight;
}
// Caustic light at a point under water: the pattern at the surface point up-sun, spread by depth.
float causticAt(vec3 p) {
  float dep = max(-p.y, 0.0);
  vec2 q = p.xz + uSunW.xz / max(uSunW.y, 0.2) * dep;
  float lod = clamp(log2(1.0 + dep * 2.2), 0.0, 4.0);
  float c = textureLod(uCaus, q * 0.55, lod).r;
  return c * (1.0 + 0.3 * uKick + 0.35 * uAudio.x);
}
float shaftAt(vec3 p) {
  float dep = max(-p.y, 0.0);
  vec2 q = p.xz + uSunW.xz / max(uSunW.y, 0.2) * dep;
  return textureLod(uCaus, q * 0.16, 4.5).g;
}
`;

// ------------------------------------------------------------------ sky
export const GL_SKY = /* glsl */`
vec3 skyHorizon(vec3 d) {
  vec2 a = normalize(d.xz + 1e-5), b = normalize(uSunDir.xz + 1e-5);
  float az = 0.5 + 0.5 * dot(a, b);
  return mix(uSkyHor2, uSkyHor, pow(max(az, 0.0), 2.2));
}
vec3 skyColor(vec3 d, bool withSun) {
  float y = max(d.y, 0.0);
  float mu = dot(d, uSunDir);
  vec3 hor = skyHorizon(d);
  vec2 a2 = normalize(d.xz + 1e-5), b2 = normalize(uSunDir.xz + 1e-5);
  float toSun = pow(max(0.5 + 0.5 * dot(a2, b2), 0.0), 2.0);
  // zenith → mid belt → bright horizon band (thin and hot toward the sun)
  vec3 mid = mix(mix(uSkyMid, uSkyHor2, 0.45), uSkyMid, toSun);
  vec3 c = mix(uSkyZen, mid, exp(-y * 4.0));
  c = mix(c, hor, exp(-y * 11.0));
  c = mix(c, hor * 1.35, exp(-y * 38.0) * (0.4 + 0.6 * toSun));
  // Mie forward scattering around the sun
  float m = max(mu, 0.0);
  float lowSun = (1.0 - smoothstep(0.02, 0.12, uSunDir.y));
  c += uSunCol * uSunVis * (mix(0.06, 0.02, lowSun) * pow(m, 5.0) + mix(0.05, 0.035, lowSun) * pow(m, 24.0) + mix(0.14, 0.09, lowSun) * pow(m, 110.0) + 0.9 * pow(m, 2400.0));
  // clouds: thin high streaks, lit from below by the low sun
  if (d.y > 0.0) {
    vec2 cp = d.xz / (d.y + 0.05) * 0.3 + vec2(uT * 0.003, uT * 0.001);
    float cl = texture(uNoise, cp * vec2(0.045, 0.16)).g * 0.6 + texture(uNoise, cp * vec2(0.17, 0.5) + 0.3).b * 0.4;
    cl = smoothstep(0.5, 0.78, cl) * smoothstep(0.015, 0.1, d.y) * (1.0 - smoothstep(0.3, 0.6, d.y));
    vec3 lit = hor * 1.1 + uSunCol * uSunVis * 0.35 * pow(m, 4.0);
    vec3 dark = mix(uSkyZen, uSkyHor2, 0.5) * 0.7;
    vec3 cc = mix(dark, lit, 0.35 + 0.65 * pow(max(0.5 + 0.5 * mu, 0.0), 3.0));
    c = mix(c, cc, cl * 0.7);
  }
  if (withSun) {
    float sr = 0.0135;
    float ang = acos(clamp(mu, -1.0, 1.0));
    float disc = 1.0 - smoothstep(sr * 0.9, sr, ang);
    float limb = sqrt(max(1.0 - (ang / sr) * (ang / sr), 0.0));
    c += disc * normalize(uSunCol + 1e-4) * 1.7 * uSunDisk * (0.55 + 0.45 * limb);
    if (uGlint > 0.0) {
      // the last glint: a hot point where the top limb meets the horizon
      vec3 gd = normalize(vec3(uSunDir.x, 0.0, uSunDir.z));
      float a = acos(clamp(dot(d, gd), -1.0, 1.0));
      c += vec3(1.0, 0.5, 0.16) * uGlint * (26.0 * exp(-(a / 0.0016) * (a / 0.0016)) + 1.6 * exp(-a / 0.012));
    }
  }
  return c * (1.0 - uDusk);
}
`;

export const GL_FRESNEL = /* glsl */`
float fresnelSchlick(float c, float f0) { return f0 + (1.0 - f0) * pow(1.0 - clamp(c, 0.0, 1.0), 5.0); }
`;
