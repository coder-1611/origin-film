// Shared GLSL for chapter IV.
//
// Depth of field is split by what physically works best for each kind of thing:
//  * point-like emitters (dust, sparks, magma, ring debris, flashes) are drawn AFTER the gather
//    blur as scatter bokeh: each point's sprite is sized by its own circle of confusion, with
//    energy conserved (per-pixel intensity ∝ 1/area), so a bright foreground mote becomes a
//    soft, rim-lit disc the way a real lens renders it;
//  * surfaces (Sun, planetesimals, Earth, Theia, Moon, gas) are blurred by the depth-texture
//    gather pass (ch4/dof.js).
// Both use the same thin-lens CoC:  coc(d) = aperture · |1 − focus/d|  (1080p pixels, radius).
import * as G from './geom.js';

const f = (x) => (Number.isInteger(x) ? x.toFixed(1) : String(x));

export const WORLD = /* glsl */`
#define RS ${f(G.RS)}
#define RE_ORB ${f(G.RE_ORB)}
#define OMEGA_E ${f(G.OMEGA_E)}
#define R_IN ${f(G.R_IN)}
#define R_OUT ${f(G.R_OUT)}
#define T0 ${f(G.T0)}
float omegaK(float r) { return OMEGA_E * pow(r / RE_ORB, -1.5); }
float diskH(float r) { return 0.024 * pow(max(r, 0.3), 1.22); }        // flared scale height
float gapProfile(float r) {
  float g = 1.0;
  ${G.GAPS.map(([r, w, d]) => `g *= 1.0 - ${f(d)} * exp(-pow((r - ${f(r)}) / ${f(w)}, 2.0));`).join('\n  ')}
  return g;
}
// bright, directly illuminated outer walls of the gaps
float gapWalls(float r) {
  float w = 0.0;
  ${G.GAPS.map(([r, w, d]) => `w += ${f(d)} * exp(-pow((r - ${f(r + 1.35 * w)}) / ${f(0.55 * w)}, 2.0));`).join('\n  ')}
  return w;
}
float surfaceDensity(float r) {
  float inner = smoothstep(R_IN * 0.92, R_IN * 1.35, r);
  float outer = exp(-pow(r / 34.0, 4.0));
  return pow(r, -0.85) * inner * outer * gapProfile(r);
}
vec3 diskTint(float r) {
  vec3 hot = vec3(1.0, 0.70, 0.38), mid = vec3(1.0, 0.45, 0.15), cold = vec3(0.62, 0.20, 0.085);
  return mix(mix(hot, mid, smoothstep(1.4, 7.5, r)), cold, smoothstep(9.0, 26.0, r));
}
float hgPhase(float c, float g) { float g2 = g * g; return (1.0 - g2) / pow(1.0 + g2 - 2.0 * g * c, 1.5); } // ×4π normalised
`;

// Uniforms + helpers every scatter-bokeh particle shader shares.
export const BOKEH_VERT = /* glsl */`
uniform float uFocus, uAperture, uPxScale, uMaxCoc;
uniform sampler2D uDepth; uniform float uNear, uFar;
float cocPx(float d) { return min(uAperture * abs(1.0 - uFocus / max(d, 1e-4)), uMaxCoc); }
out vec3 vCol; out float vDia; out float vDist; out float vKind;
// p: world position; col: colour; E: energy (1080p pixel units); base: in-focus diameter (1080p px)
void emitPoint(vec3 p, vec3 col, float E, float base, float kind) {
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float d = -mv.z;
  gl_Position = projectionMatrix * mv;
  float c = cocPx(d);
  float dia1080 = max(base, 2.0 * c);
  float dia = max(dia1080 * uPxScale, 1.0);
  float area1080 = 0.785398 * (dia / uPxScale) * (dia / uPxScale);
  vCol = col * E / max(area1080, 0.785398);
  vDia = dia; vDist = d; vKind = kind;
  gl_PointSize = dia + 1.5;
  if (kind > 0.5 && kind < 1.5) {
    // flashes: occlusion-test the centre only, then draw the whole glow (it is a lens effect too)
    vec2 uv = gl_Position.xy / gl_Position.w * 0.5 + 0.5;
    float z = textureLod(uDepth, clamp(uv, 0.0, 1.0), 0.0).r;
    float sd = uNear * uFar / (uFar - z * (uFar - uNear));
    if (d > sd * 1.02 + 0.01) E = 0.0;
  }
  if (d < 0.004 || E <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; }
}
`;

export const BOKEH_FRAG = /* glsl */`
precision highp float;
in vec3 vCol; in float vDia; in float vDist; in float vKind;
out vec4 fragColor;
uniform sampler2D uDepth; uniform float uNear, uFar;
float viewDist(float z) { return uNear * uFar / (uFar - z * (uFar - uNear)); }
void main() {
  float sd = viewDist(texelFetch(uDepth, ivec2(gl_FragCoord.xy), 0).r);
  if (abs(vKind - 1.0) > 0.5 && vDist > sd * 1.003 + 0.0005) discard;    // hidden behind a surface
  vec2 q = (gl_PointCoord * 2.0 - 1.0) * (vDia + 1.5) / vDia;
  float r = length(q);
  float a;
  if (vKind > 1.5) {
    a = exp(-r * r * 3.2) * 2.3;                               // soft vapour blob
  } else if (vKind > 0.5) {
    // flash: hot core + wide halo + a faint horizontal streak (lens)
    float core = exp(-r * r * 60.0) * 9.0;
    float halo = 0.9 / (1.0 + r * r * 90.0) * (1.0 - smoothstep(0.7, 1.0, r));
    float streak = exp(-abs(q.y) * 90.0) * exp(-abs(q.x) * 2.6) * 0.8;
    a = core + halo + streak;
  } else {
    float k = smoothstep(2.5, 7.0, vDia);
    float gss = exp(-r * r * 2.2) * 1.9;
    float edge = clamp((1.0 - r) * vDia * 0.5 + 0.5, 0.0, 1.0);
    // a faint 7-blade aperture and a brighter rim: optical, not a flat CG disc
    float ang = atan(q.y, q.x);
    float blade = 1.0 - 0.035 * (0.5 + 0.5 * cos(ang * 7.0 + 0.6));
    edge = clamp((blade - r) * vDia * 0.5 + 0.5, 0.0, 1.0);
    float disc = edge * (0.8 + 0.34 * smoothstep(0.5, 0.98, r));
    a = mix(gss, disc, k);
  }
  if (a < 0.0015) discard;
  vec3 c = vCol * a;
  float kb = smoothstep(6.0, 14.0, vDia) * (1.0 - step(0.5, vKind));
  c *= mix(vec3(1.0), vec3(1.1, 1.0, 0.84), kb * smoothstep(0.72, 1.0, r));
  fragColor = vec4(c, 1.0);
}
`;
