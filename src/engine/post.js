// Post chain: HDR scene → bloom → exposure (+ kick pulses + flashes) → chromatic aberration
// → ACES → vignette → grain → dither → sRGB LDR, then the 2D UI layer composited on top.
import { THREE, Pass, makeTarget } from './gl.js';
import * as G from './glsl.js';

const PREFILTER = G.header + G.color + /* glsl */`
in vec2 vUv; out vec4 fragColor;
uniform sampler2D src; uniform float threshold; uniform float knee; uniform vec2 texel;
void main() {
  // 4-tap box on the full-res source to avoid fireflies.
  vec3 c = texture(src, vUv + texel * vec2(-0.5, -0.5)).rgb + texture(src, vUv + texel * vec2(0.5, -0.5)).rgb
         + texture(src, vUv + texel * vec2(-0.5, 0.5)).rgb + texture(src, vUv + texel * vec2(0.5, 0.5)).rgb;
  c *= 0.25;
  float br = max(c.r, max(c.g, c.b));
  float rq = clamp(br - threshold + knee, 0.0, 2.0 * knee);
  rq = rq * rq / (4.0 * knee + 1e-5);
  float w = max(rq, br - threshold) / max(br, 1e-5);
  fragColor = vec4(min(c * w, vec3(64.0)), 1.0);
}`;

const DOWN = G.header + /* glsl */`
in vec2 vUv; out vec4 fragColor;
uniform sampler2D src; uniform vec2 texel;
void main() {   // 13-tap (Jimenez 2014)
  vec3 a = texture(src, vUv + texel * vec2(-2, 2)).rgb, b = texture(src, vUv + texel * vec2(0, 2)).rgb, c = texture(src, vUv + texel * vec2(2, 2)).rgb;
  vec3 d = texture(src, vUv + texel * vec2(-2, 0)).rgb, e = texture(src, vUv).rgb, f = texture(src, vUv + texel * vec2(2, 0)).rgb;
  vec3 g = texture(src, vUv + texel * vec2(-2, -2)).rgb, h = texture(src, vUv + texel * vec2(0, -2)).rgb, i = texture(src, vUv + texel * vec2(2, -2)).rgb;
  vec3 j = texture(src, vUv + texel * vec2(-1, 1)).rgb, k = texture(src, vUv + texel * vec2(1, 1)).rgb;
  vec3 l = texture(src, vUv + texel * vec2(-1, -1)).rgb, m = texture(src, vUv + texel * vec2(1, -1)).rgb;
  vec3 o = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  fragColor = vec4(o, 1.0);
}`;

const UP = G.header + /* glsl */`
in vec2 vUv; out vec4 fragColor;
uniform sampler2D src; uniform sampler2D base; uniform vec2 texel; uniform float radius;
void main() {   // 9-tap tent upsample + add the level below
  vec2 r = texel * radius;
  vec3 s = texture(src, vUv + vec2(-r.x, r.y)).rgb + 2.0 * texture(src, vUv + vec2(0, r.y)).rgb + texture(src, vUv + r).rgb
         + 2.0 * texture(src, vUv + vec2(-r.x, 0)).rgb + 4.0 * texture(src, vUv).rgb + 2.0 * texture(src, vUv + vec2(r.x, 0)).rgb
         + texture(src, vUv - r).rgb + 2.0 * texture(src, vUv + vec2(0, -r.y)).rgb + texture(src, vUv + vec2(r.x, -r.y)).rgb;
  fragColor = vec4(texture(base, vUv).rgb + s / 16.0, 1.0);
}`;

const COMPOSITE = G.header + G.math + G.hash + G.color + /* glsl */`
in vec2 vUv; out vec4 fragColor;
uniform sampler2D scene; uniform sampler2D bloom; uniform sampler2D ui; uniform sampler2D passMask;
uniform float exposure, bloomStrength, vignette, grain, ca, uiOn, maskOn, frameSeed, aspect, lift, saturation;
uniform vec3 tint;
void main() {
  vec2 d = vUv - 0.5;
  float r2 = dot(d * vec2(aspect, 1.0), d * vec2(aspect, 1.0));
  // chromatic aberration: radial, stronger at the edges
  vec2 off = d * ca * (0.3 + r2 * 2.0);
  vec3 col;
  col.r = texture(scene, vUv - off).r;
  col.g = texture(scene, vUv).g;
  col.b = texture(scene, vUv + off).b;
  vec3 hdr = col * exposure + texture(bloom, vUv).rgb * bloomStrength;
  hdr *= tint;
  vec3 tm = aces(hdr);
  float l = luma(tm);
  tm = mix(vec3(l), tm, saturation);
  tm += lift * (1.0 - tm);
  tm *= mix(1.0, smoothstep(1.25, 0.2, r2 * 1.6), vignette);
  vec3 outc = linearToSrgb(tm);
  // Pass-through region (used by VIII's screen): no tonemap, no grade, no grain, no dither:
  // the display value goes out as-is so nested frames stay exact.
  float keep = 0.0;
  if (maskOn > 0.5) {
    keep = texture(passMask, vUv).r;
    outc = mix(outc, linearToSrgb(col), keep);
  }
  // Film grain: luminance-weighted, seeded by frame (deterministic).
  float gr = hash13(vec3(gl_FragCoord.xy, frameSeed)) + hash13(vec3(gl_FragCoord.yx + 17.0, frameSeed + 0.5)) - 1.0;
  outc += (1.0 - keep) * gr * grain * (0.35 + 0.65 * (1.0 - abs(luma(outc) - 0.45) * 1.6));
  // Triangular dither to kill banding.
  outc += (1.0 - keep) * (hash13(vec3(gl_FragCoord.xy, frameSeed + 3.1)) + hash13(vec3(gl_FragCoord.xy + 5.3, frameSeed + 7.7)) - 1.0) / 255.0;
  if (uiOn > 0.5) {
    vec4 u = texture(ui, vec2(vUv.x, 1.0 - vUv.y));
    outc = mix(outc, u.rgb, u.a);
  }
  fragColor = vec4(clamp(outc, 0.0, 1.0), 1.0);
}`;

const BLEND = G.header + /* glsl */`
in vec2 vUv; out vec4 fragColor;
uniform sampler2D a; uniform sampler2D b; uniform float w;
void main() { fragColor = vec4(mix(texture(a, vUv).rgb, texture(b, vUv).rgb, w), 1.0); }`;

const COPY = G.header + /* glsl */`
in vec2 vUv; out vec4 fragColor; uniform sampler2D src;
void main() { fragColor = texture(src, vUv); }`;

export const DEFAULT_POST = {
  exposure: 1.0, bloom: 0.55, threshold: 1.0, knee: 0.6, bloomRadius: 1.0,
  vignette: 0.35, grain: 0.035, ca: 0.0015, lift: 0.0, saturation: 1.0, tint: [1, 1, 1],
};

export class Post {
  constructor(renderer, W, H) {
    this.renderer = renderer; this.W = W; this.H = H;
    this.prefilter = new Pass(PREFILTER, { src: { value: null }, threshold: { value: 1 }, knee: { value: 0.5 }, texel: { value: new THREE.Vector2() } });
    this.down = new Pass(DOWN, { src: { value: null }, texel: { value: new THREE.Vector2() } });
    this.up = new Pass(UP, { src: { value: null }, base: { value: null }, texel: { value: new THREE.Vector2() }, radius: { value: 1 } });
    this.comp = new Pass(COMPOSITE, {
      scene: { value: null }, bloom: { value: null }, ui: { value: null }, passMask: { value: null },
      exposure: { value: 1 }, bloomStrength: { value: 0.5 }, vignette: { value: 0.3 }, grain: { value: 0.03 }, ca: { value: 0.001 },
      uiOn: { value: 0 }, maskOn: { value: 0 }, frameSeed: { value: 0 }, aspect: { value: W / H }, lift: { value: 0 }, saturation: { value: 1 },
      tint: { value: new THREE.Vector3(1, 1, 1) },
    });
    this.blendPass = new Pass(BLEND, { a: { value: null }, b: { value: null }, w: { value: 0 } });
    this.copyPass = new Pass(COPY, { src: { value: null } });
    // Bloom mip chain from half resolution down.
    this.levels = [];
    let w = W / 2, h = H / 2;
    for (let i = 0; i < 7 && w >= 4 && h >= 4; i++) { this.levels.push(makeTarget(w, h)); w /= 2; h /= 2; }
    this.ups = this.levels.map(l => makeTarget(l.width, l.height));
    this.black = makeTarget(4, 4);
  }

  blend(a, b, w, out) { this.blendPass.render(this.renderer, out, { a: a.texture, b: b.texture, w }); }
  copy(srcTex, out) { this.copyPass.render(this.renderer, out, { src: srcTex }); }

  /**
   * hdr: WebGLRenderTarget with linear HDR scene. p: post params. out: LDR target (or null).
   * extra: { pulse, flash, frameSeed, uiTex, uiOn, maskTex }
   */
  run(hdr, p, out, extra = {}) {
    const r = this.renderer, L = this.levels;
    let bloomTex = this.black.texture;
    if (p.bloom > 0.0005) {
      this.prefilter.render(r, L[0], { src: hdr.texture, threshold: p.threshold, knee: Math.max(1e-3, p.knee), texel: new THREE.Vector2(1 / this.W, 1 / this.H) });
      for (let i = 1; i < L.length; i++) this.down.render(r, L[i], { src: L[i - 1].texture, texel: new THREE.Vector2(1 / L[i - 1].width, 1 / L[i - 1].height) });
      // Upsample: ups[n-1] = L[n-1]; ups[i] = L[i] + up(ups[i+1])
      const n = L.length;
      this.copy(L[n - 1].texture, this.ups[n - 1]);
      for (let i = n - 2; i >= 0; i--) {
        this.up.render(r, this.ups[i], { src: this.ups[i + 1].texture, base: L[i].texture, texel: new THREE.Vector2(1 / this.ups[i + 1].width, 1 / this.ups[i + 1].height), radius: p.bloomRadius });
      }
      bloomTex = this.ups[0].texture;
    }
    const exp = p.exposure * (1 + (extra.pulse || 0)) * (1 + (extra.flash || 0));
    this.comp.render(r, out, {
      scene: hdr.texture, bloom: bloomTex, ui: extra.uiTex || this.black.texture,
      passMask: extra.maskTex || this.black.texture, maskOn: extra.maskTex ? 1 : 0,
      exposure: exp, bloomStrength: p.bloom / L.length * 2.2, vignette: p.vignette, grain: p.grain, ca: p.ca,
      uiOn: extra.uiOn ? 1 : 0, frameSeed: extra.frameSeed || 0, aspect: this.W / this.H, lift: p.lift, saturation: p.saturation,
      tint: new THREE.Vector3(...p.tint),
    });
  }
}

export function lerpPost(a, b, w) {
  const o = {};
  for (const k in DEFAULT_POST) {
    const x = a[k] ?? DEFAULT_POST[k], y = b[k] ?? DEFAULT_POST[k];
    o[k] = Array.isArray(x) ? x.map((v, i) => v + (y[i] - v) * w) : x + (y - x) * w;
  }
  return o;
}
