// VIII · THE PROMPT: physically-shaped depth of field.
//   A: full → half res, colour + linear depth packed in alpha
//   B: half-res scatter-as-gather bokeh (golden-angle spiral, Gustafsson 2018)
//   C: full-res composite, blending the blur in by the per-pixel circle of confusion
// The circle of confusion is expressed as a fraction of the frame height, so the same shot
// blurs identically at any render resolution (the recursion renders deep levels smaller).

export class DOF {
  constructor(ctx) {
    const { Pass, glsl, THREE } = ctx;
    this.texA = new THREE.Vector2(); this.texB = new THREE.Vector2();
    const LIN = /* glsl */`
      uniform float uNear, uFar;
      float linZ(float d) { float z = d * 2.0 - 1.0; return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear)); }`;
    this.a = new Pass(glsl.header + LIN + /* glsl */`
      in vec2 vUv; out vec4 fragColor;
      uniform sampler2D uColor; uniform sampler2D uDepth; uniform vec2 uTexel;
      void main() {
        vec2 o = uTexel * 0.5;
        vec3 c = texture(uColor, vUv + vec2(-o.x, -o.y)).rgb + texture(uColor, vUv + vec2(o.x, -o.y)).rgb
               + texture(uColor, vUv + vec2(-o.x, o.y)).rgb + texture(uColor, vUv + vec2(o.x, o.y)).rgb;
        float z = min(min(linZ(texture(uDepth, vUv + vec2(-o.x, -o.y)).r), linZ(texture(uDepth, vUv + vec2(o.x, -o.y)).r)),
                      min(linZ(texture(uDepth, vUv + vec2(-o.x, o.y)).r), linZ(texture(uDepth, vUv + vec2(o.x, o.y)).r)));
        fragColor = vec4(min(c * 0.25, vec3(60.0)), z);
      }`, { uColor: { value: null }, uDepth: { value: null }, uTexel: { value: null }, uNear: { value: 0.01 }, uFar: { value: 20 } });
    this.b = new Pass(glsl.header + /* glsl */`
      in vec2 vUv; out vec4 fragColor;
      uniform sampler2D uSrc; uniform vec2 uTexel; uniform float uFocus, uScale, uMax, uStep;
      const float GA = 2.39996323;
      float coc(float z) { return min(uMax, uScale * abs(1.0 - uFocus / max(z, 1e-4))); }
      void main() {
        vec4 c0 = texture(uSrc, vUv);
        float cs = coc(c0.a);
        vec3 acc = c0.rgb; float tot = 1.0;
        float rad = 0.9, ang = 0.0;
        for (int i = 0; i < 128; i++) {
          if (rad >= uMax) break;
          vec4 s = texture(uSrc, vUv + vec2(cos(ang), sin(ang)) * uTexel * rad);
          float ss = coc(s.a);
          if (s.a > c0.a) ss = clamp(ss, 0.0, cs * 2.0);
          float m = smoothstep(rad - 1.2, rad + 1.2, ss);
          acc += mix(acc / tot, s.rgb, m);
          tot += 1.0; rad += uStep / rad; ang += GA;
        }
        fragColor = vec4(acc / tot, cs);
      }`, { uSrc: { value: null }, uTexel: { value: null }, uFocus: { value: 1 }, uScale: { value: 0 }, uMax: { value: 8 }, uStep: { value: 1.1 } });
    this.c = new Pass(glsl.header + LIN + /* glsl */`
      in vec2 vUv; out vec4 fragColor;
      uniform sampler2D uColor; uniform sampler2D uDepth; uniform sampler2D uBlur;
      uniform float uFocus, uScale, uMax;
      void main() {
        vec3 sharp = texture(uColor, vUv).rgb;
        float z = linZ(texture(uDepth, vUv).r);
        float c = min(uMax, uScale * abs(1.0 - uFocus / max(z, 1e-4))) * 2.0;   // full-res px
        vec3 blur = texture(uBlur, vUv).rgb;
        fragColor = vec4(mix(sharp, blur, smoothstep(0.7, 2.2, c)), 1.0);
      }`, { uColor: { value: null }, uDepth: { value: null }, uBlur: { value: null }, uNear: { value: 0.01 }, uFar: { value: 20 }, uFocus: { value: 1 }, uScale: { value: 0 }, uMax: { value: 8 } });
    this.copy = new Pass(glsl.header + `in vec2 vUv; out vec4 fragColor; uniform sampler2D uSrc; void main(){ fragColor = vec4(texture(uSrc, vUv).rgb, 1.0); }`, { uSrc: { value: null } });
  }

  /**
   * src: resolved scene target (texture + depthTexture). half: [A, B] half-res float targets.
   * cocH: blur radius at infinity as a fraction of frame height. focus: view-space distance.
   */
  run(r, src, half, out, { camera, focus, cocH, maxH = 0.024 }) {
    const H = src.height;
    const hw = half[0].width, hh = half[0].height;
    if (cocH * H < 0.35) { this.copy.render(r, out, { uSrc: src.texture }); return; }
    const scaleHalf = cocH * hh, maxHalf = Math.max(1.5, Math.min(Math.max(maxH, cocH * 0.5) * hh, scaleHalf * 1.6));
    const step = Math.max(1.1, maxHalf * maxHalf / 230);    // ≤ ~115 taps whatever the radius
    const common = { uNear: camera.near, uFar: camera.far };
    this.texA.set(1 / src.width, 1 / src.height);
    this.texB.set(1 / hw, 1 / hh);
    this.a.render(r, half[0], { ...common, uColor: src.texture, uDepth: src.depthTexture, uTexel: this.texA });
    this.b.render(r, half[1], { uSrc: half[0].texture, uTexel: this.texB, uFocus: focus, uScale: scaleHalf, uMax: maxHalf, uStep: step });
    this.c.render(r, out, { ...common, uColor: src.texture, uDepth: src.depthTexture, uBlur: half[1].texture, uFocus: focus, uScale: scaleHalf, uMax: maxHalf });
  }
}
