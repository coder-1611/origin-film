// VI · LIFE: procedural textures. A static tileable noise texture (init) and the animated
// caustic texture (per frame, a pure function of t).
import { THREE } from '../../engine/gl.js';

function mipTarget(n, type = THREE.HalfFloatType) {
  const rt = new THREE.WebGLRenderTarget(n, n, {
    type, format: THREE.RGBAFormat, wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping,
    minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: true, depthBuffer: false,
  });
  rt.texture.colorSpace = THREE.NoColorSpace;
  return rt;
}

export function makeNoiseTexture(ctx, n = 512) {
  const rt = mipTarget(n);
  const pass = new ctx.Pass(ctx.glsl.header + ctx.glsl.hash + /* glsl */`
    in vec2 vUv; out vec4 fragColor;
    // periodic value noise on a lattice of period P
    float pn(vec2 x, float P, float s) {
      vec2 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
      vec2 i1 = mod(i + 1.0, P); i = mod(i, P);
      float a = hash12(i + s), b = hash12(vec2(i1.x, i.y) + s), c = hash12(vec2(i.x, i1.y) + s), d = hash12(i1 + s);
      return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
    }
    float pfbm(vec2 uv, float P, float s, int oct) {
      float a = 0.5, v = 0.0, tot = 0.0;
      for (int i = 0; i < 6; i++) { if (i >= oct) break; v += a * pn(uv * P, P, s + float(i) * 13.1); tot += a; P *= 2.0; a *= 0.5; }
      return v / tot;
    }
    // periodic cellular (F1) noise
    float pcell(vec2 uv, float P, float s) {
      vec2 x = uv * P, i = floor(x), f = fract(x);
      float m = 9.0;
      for (int y = -1; y <= 1; y++) for (int xx = -1; xx <= 1; xx++) {
        vec2 o = vec2(float(xx), float(y));
        vec2 c = mod(i + o, P);
        vec2 j = vec2(hash12(c + s), hash12(c + s + 7.7));
        m = min(m, length(o + 0.15 + 0.7 * j - f));
      }
      return m;
    }
    void main() {
      vec2 uv = vUv;
      float a = pfbm(uv, 8.0, 1.0, 5);
      float b = pfbm(uv, 4.0, 5.0, 5);
      float c = pfbm(uv, 2.0, 9.0, 4);
      float d = 1.0 - smoothstep(0.15, 0.55, pcell(uv, 64.0, 3.0));
      fragColor = vec4(a, b, c, d);
    }`);
  pass.render(ctx.renderer, rt);
  return rt;
}

export function makeCaustics(ctx, n = 512) {
  const rt = mipTarget(n);
  const pass = new ctx.Pass(ctx.glsl.header + /* glsl */`
    in vec2 vUv; out vec4 fragColor; uniform float time;
    // tileable water caustic (after Dave Hoskins / joltz0r), period 1 in uv
    float caus(vec2 uv, float time) {
      const float TAU = 6.28318530718;
      vec2 p = mod(uv * TAU, TAU) - 250.0;
      vec2 i = p;
      float c = 1.0, inten = 0.005;
      for (int n = 0; n < 5; n++) {
        float t = time * (1.0 - (3.5 / float(n + 1)));
        i = p + vec2(cos(t - i.x) + sin(t + i.y), sin(t - i.y) + cos(t + i.x));
        c += 1.0 / length(vec2(p.x / (sin(i.x + t) / inten), p.y / (cos(i.y + t) / inten)));
      }
      c /= 5.0;
      c = 1.17 - pow(c, 1.4);
      return pow(abs(c), 8.0);
    }
    void main() {
      float a = caus(vUv * 2.0, time);
      float b = caus(vUv, time * 0.6 + 11.0);
      fragColor = vec4(min(a, 4.0), min(b, 4.0), 0.0, 1.0);
    }`, { time: { value: 0 } });
  return { rt, update(r, t) { pass.render(r, rt, { time: t }); } };
}
