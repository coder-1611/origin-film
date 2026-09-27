// Depth of field for surfaces: circle of confusion from the scene's depth texture, then a
// scatter-as-gather bokeh blur at half resolution (golden-angle spiral; each sample contributes
// only if ITS OWN CoC reaches the centre pixel, so blurred foreground spills over sharp
// background but sharp background never bleeds onto blurred foreground). A tile-max CoC map
// bounds the loop, so in-focus regions cost almost nothing. The full-res composite also lays
// the III→IV stellar glare over the frame.
export class DOF {
  init(ctx) {
    const { THREE, glsl, Pass, makeTarget, W, H } = ctx;
    const hw = Math.ceil(W / 2), hh = Math.ceil(H / 2);
    this.prep = makeTarget(hw, hh);
    this.gatherRT = makeTarget(hw, hh);
    this.tw = Math.ceil(hw / 8); this.th = Math.ceil(hh / 8);
    this.tileA = makeTarget(this.tw, this.th, { linear: false });
    this.tileB = makeTarget(this.tw, this.th, { linear: false });
    const COC = /* glsl */`
      uniform float uNear, uFar, uFocus, uAperture, uPxScale, uMaxCoc;
      float viewDist(float z) { return uNear * uFar / (uFar - z * (uFar - uNear)); }
      float signedCoc(float d) { return clamp(uAperture * (1.0 - uFocus / d), -uMaxCoc, uMaxCoc) * uPxScale; }  // full-res px
    `;
    const cu = () => ({ uNear: { value: 0.01 }, uFar: { value: 1000 }, uFocus: { value: 10 }, uAperture: { value: 0 }, uPxScale: { value: H / 1080 }, uMaxCoc: { value: 48 } });
    this.prepPass = new Pass(glsl.header + COC + /* glsl */`
      in vec2 vUv; out vec4 fragColor;
      uniform sampler2D uColor, uDepth; uniform vec2 uTexel;
      void main() {
        float d = 1.0;
        d = min(d, texture(uDepth, vUv + uTexel * vec2(-0.5, -0.5)).r);
        d = min(d, texture(uDepth, vUv + uTexel * vec2(0.5, -0.5)).r);
        d = min(d, texture(uDepth, vUv + uTexel * vec2(-0.5, 0.5)).r);
        d = min(d, texture(uDepth, vUv + uTexel * vec2(0.5, 0.5)).r);
        // 16-texel prefilter (4 bilinear taps): single-pixel highlights spread before the gather
        vec3 c = texture(uColor, vUv + uTexel * vec2(-1.0, -1.0)).rgb + texture(uColor, vUv + uTexel * vec2(1.0, -1.0)).rgb
               + texture(uColor, vUv + uTexel * vec2(-1.0, 1.0)).rgb + texture(uColor, vUv + uTexel * vec2(1.0, 1.0)).rgb;
        c = c * 0.25;
        fragColor = vec4(min(c, vec3(400.0)), signedCoc(viewDist(d)) * 0.5);   // CoC in half-res px
      }`, { ...cu(), uColor: { value: null }, uDepth: { value: null }, uTexel: { value: new THREE.Vector2(1 / W, 1 / H) } });
    this.tileReduce = new Pass(glsl.header + /* glsl */`
      in vec2 vUv; out vec4 fragColor; uniform sampler2D uPrep; uniform vec2 uSize;
      void main() {
        ivec2 b = ivec2(gl_FragCoord.xy) * 8; float m = 0.0;
        for (int y = 0; y < 8; y++) for (int x = 0; x < 8; x++) {
          ivec2 p = min(b + ivec2(x, y), ivec2(uSize) - 1);
          m = max(m, abs(texelFetch(uPrep, p, 0).a));
        }
        fragColor = vec4(m, 0.0, 0.0, 1.0);
      }`, { uPrep: { value: null }, uSize: { value: new THREE.Vector2(hw, hh) } });
    this.tileDilate = new Pass(glsl.header + /* glsl */`
      in vec2 vUv; out vec4 fragColor; uniform sampler2D uTile; uniform vec2 uSize;
      void main() {
        ivec2 c = ivec2(gl_FragCoord.xy); float m = 0.0;
        for (int y = -3; y <= 3; y++) for (int x = -3; x <= 3; x++) {
          ivec2 p = clamp(c + ivec2(x, y), ivec2(0), ivec2(uSize) - 1);
          m = max(m, texelFetch(uTile, p, 0).r);
        }
        fragColor = vec4(m, 0.0, 0.0, 1.0);
      }`, { uTile: { value: null }, uSize: { value: new THREE.Vector2(this.tw, this.th) } });
    this.gatherPass = new Pass(glsl.header + /* glsl */`
      in vec2 vUv; out vec4 fragColor;
      uniform sampler2D uPrep, uTile; uniform vec2 uHTexel; uniform float uMaxR, uSeed;
      const float GA = 2.39996323, RAD = 0.5;
      float h12(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
      void main() {
        vec4 c0 = texture(uPrep, vUv);
        float cc = c0.a, cs = abs(cc);
        float tmax = min(texture(uTile, vUv).r, uMaxR);
        if (tmax < 0.75) { fragColor = vec4(c0.rgb, 0.0); return; }
        vec3 col = c0.rgb; float tot = 1.0, nearAcc = 0.0;
        float radius = RAD, ang = h12(gl_FragCoord.xy + uSeed) * 6.2831853;   // per-pixel spiral rotation
        for (int i = 0; i < 900; i++) {
          if (radius >= tmax) break;
          vec2 tc = vUv + vec2(cos(ang), sin(ang)) * uHTexel * radius;
          vec4 s = texture(uPrep, tc);
          float ss = abs(s.a);
          if (s.a > cc) ss = min(ss, cs * 2.0);
          float m = smoothstep(radius - 0.5, radius + 0.5, ss);
          col += mix(col / tot, s.rgb, m);
          tot += 1.0;
          if (s.a < cc - 1.0 && s.a < -0.75) nearAcc += m;
          ang += GA;
          radius += RAD / radius;
        }
        fragColor = vec4(col / tot, clamp(nearAcc / tot * 2.6, 0.0, 1.0));
      }`, { uPrep: { value: this.prep.texture }, uTile: { value: this.tileB.texture }, uHTexel: { value: new THREE.Vector2(1 / hw, 1 / hh) }, uMaxR: { value: 24 }, uSeed: { value: 0 } });
    this.compPass = new Pass(glsl.header + glsl.math + glsl.hash + glsl.noise + COC + /* glsl */`
      in vec2 vUv; out vec4 fragColor;
      uniform sampler2D uColor, uDepth, uGather;
      uniform float uGlare, uAspect, uT; uniform vec2 uGlareC;
      void main() {
        vec3 sharp = texture(uColor, vUv).rgb;
        float coc = abs(signedCoc(viewDist(texture(uDepth, vUv).r)));
        vec4 g = texture(uGather, vUv);
        float w = max(smoothstep(0.6, 2.0, coc), g.a);
        vec3 col = mix(sharp, g.rgb, w);
        if (uGlare > 0.0005) {
          // stellar glare: (1.0, 0.82, 0.55) × 3–6, brightest at the Sun, with faint lens rays
          vec2 d = (vUv - uGlareC) * vec2(uAspect, 1.0);
          float r = length(d);
          float ang = atan(d.y, d.x);
          float rays = 1.0 + 0.07 * (fbm(vec3(cos(ang) * 6.0, sin(ang) * 6.0, uT * 0.4), 3)) * smoothstep(0.05, 0.4, r);
          vec3 gcol = vec3(1.0, 0.82, 0.55) * (3.1 + 2.9 * exp(-r * r / 0.12)) * rays;
          col = mix(col, gcol, uGlare);
        }
        fragColor = vec4(col, 1.0);
      }`, { ...cu(), uColor: { value: null }, uDepth: { value: null }, uGather: { value: this.gatherRT.texture },
      uGlare: { value: 0 }, uAspect: { value: W / H }, uT: { value: 0 }, uGlareC: { value: new THREE.Vector2(0.5, 0.5) } });
  }

  setCommon(p) {
    for (const pass of [this.prepPass, this.compPass]) {
      const u = pass.uniforms;
      u.uNear.value = p.near; u.uFar.value = p.far; u.uFocus.value = p.focus; u.uAperture.value = p.aperture; u.uMaxCoc.value = p.maxCoc;
    }
  }

  /** scene (color + depthTexture) → target, with bokeh DOF and glare. */
  run(ctx, sceneRT, target, p) {
    const r = ctx.renderer;
    this.setCommon(p);
    const blur = p.aperture > 0.05;
    if (blur) {
      this.prepPass.render(r, this.prep, { uColor: sceneRT.texture, uDepth: sceneRT.depthTexture });
      this.tileReduce.render(r, this.tileA, { uPrep: this.prep.texture });
      this.tileDilate.render(r, this.tileB, { uTile: this.tileA.texture });
      this.gatherPass.render(r, this.gatherRT, { uMaxR: 24 * ctx.H / 1080, uSeed: (Math.round(p.t * 60) % 64) * 1.37 });
    }
    this.compPass.uniforms.uAperture.value = blur ? p.aperture : 0;
    this.compPass.render(r, target, { uColor: sceneRT.texture, uDepth: sceneRT.depthTexture, uGlare: p.glare, uGlareC: p.glareC, uT: p.t,
      uGather: blur ? this.gatherRT.texture : sceneRT.texture });
  }
}
