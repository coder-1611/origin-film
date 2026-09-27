// The young Sun: an animated emissive surface (granulation, starspots, limb darkening) and a
// camera-facing corona with streamers and kick-driven flares. Plus the background stars.
import * as G from './geom.js';

export class Sun {
  init(ctx) {
    const { THREE, glsl } = ctx;
    this.u = { uT: { value: 0 }, uFlare: { value: 0 }, uI: { value: 20 }, uCorona: { value: 1 } };
    const surf = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3, uniforms: this.u,
      vertexShader: /* glsl */`
        out vec3 vW;
        void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: glsl.header + glsl.math + glsl.hash + glsl.noise + /* glsl */`
        in vec3 vW; out vec4 fragColor;
        uniform float uT, uFlare, uI;
        float cells(vec3 x) {                        // Voronoi F2−F1: bright granules, dark lanes
          vec3 i = floor(x), f = fract(x); float f1 = 9.0, f2 = 9.0;
          for (int k = 0; k < 27; k++) {
            vec3 o = vec3(float(k % 3), float((k / 3) % 3), float(k / 9)) - 1.0;
            vec3 r = o + hash33(i + o) - f; float d = dot(r, r);
            if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
          }
          return sqrt(f2) - sqrt(f1);
        }
        void main() {
          vec3 n = normalize(vW);
          vec3 V = normalize(cameraPosition - vW);
          float mu = clamp(dot(n, V), 0.0, 1.0);
          // slow differential rotation of the surface
          float lat = n.y;
          float rotA = uT * (0.05 + 0.03 * (1.0 - lat * lat));
          vec3 q = vec3(n.x * cos(rotA) - n.z * sin(rotA), n.y, n.x * sin(rotA) + n.z * cos(rotA));
          vec3 wq = q * 17.0 + 0.35 * vec3(snoise(q * 6.0 + uT * 0.15), snoise(q * 6.0 - uT * 0.13 + 4.0), snoise(q * 6.0 + 9.0));
          float gran = smoothstep(0.0, 0.35, cells(wq));
          float fine = fbm(q * 40.0 + uT * 0.2, 3) * 0.5 + 0.5;
          float spots = smoothstep(0.52, 0.72, fbm(q * 2.3 + 3.0, 4) * 0.5 + 0.5) * smoothstep(0.7, 0.2, abs(lat));
          float fac = smoothstep(0.35, 0.6, fbm(q * 5.0 - 2.0, 3) * 0.5 + 0.5);   // bright faculae
          float limb = 1.0 - 0.62 * (1.0 - mu) - 0.2 * (1.0 - mu) * (1.0 - mu);
          float I = limb * (0.72 + 0.28 * gran) * (0.9 + 0.2 * fine) * (1.0 - 0.72 * spots) * (1.0 + 0.25 * fac * (1.0 - mu));
          vec3 hot = vec3(1.0, 0.86, 0.64), cool = vec3(1.0, 0.52, 0.2);
          vec3 col = mix(cool, hot, smoothstep(0.25, 0.95, I)) * I * uI * (1.0 + 0.35 * uFlare);
          fragColor = vec4(col, 1.0);
        }`,
    });
    this.sphere = new THREE.Mesh(new THREE.SphereGeometry(G.RS, 160, 96), surf);
    this.sphere.frustumCulled = false;

    // Corona: billboard at the Sun's centre (the sphere hides the inner part via depth test).
    const CS = 26;   // half-size in Sun radii (the spikes reach far; the glow does not)
    this.coronaU = { uT: { value: 0 }, uFlare: { value: 0 }, uFlareAng: { value: 0 }, uAmt: { value: 1 }, uSpike: { value: 1 }, uSize: { value: CS * G.RS } };
    const cor = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3, uniforms: this.coronaU, transparent: true, depthWrite: false, depthTest: true,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
      vertexShader: /* glsl */`
        uniform float uSize; out vec2 vP;
        void main() {
          vec4 c = viewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          vec3 vp = c.xyz + vec3(position.xy * uSize, 0.0);
          vP = position.xy * uSize / ${G.RS.toFixed(3)};
          gl_Position = projectionMatrix * vec4(vp, 1.0);
        }`,
      fragmentShader: glsl.header + glsl.math + glsl.hash + glsl.noise + /* glsl */`
        in vec2 vP; out vec4 fragColor;
        uniform float uT, uFlare, uFlareAng, uAmt, uSpike;
        void main() {
          float rho = length(vP);
          if (rho < 0.98) discard;
          float ang = atan(vP.y, vP.x);
          vec2 cs = vec2(cos(ang), sin(ang));
          float x = rho - 1.0;
          float streak = fbm(vec3(cs * 2.2, x * 0.35 - uT * 0.08), 4) * 0.5 + 0.5;
          float fine = fbm(vec3(cs * 9.0, x * 0.8 - uT * 0.2), 3) * 0.5 + 0.5;
          float k = pow(rho, -3.2) * 0.9;                                            // K-corona
          float s = pow(rho, -2.4) * smoothstep(0.35, 0.95, streak) * (0.5 + 0.6 * fine) * 0.7;   // streamers
          // six faint diffraction spikes: reads instantly as a star
          float sa = mod(ang + 0.3, PI / 3.0) - PI / 6.0;
          float spike = exp(-abs(sa) * rho * 9.0) * pow(rho, -1.6) * 0.45 * smoothstep(1.0, 1.6, rho) * (1.0 - smoothstep(6.0, 13.0, rho));
          // flare: a bright loop + ejecta toward uFlareAng
          float da = abs(mod(ang - uFlareAng + PI, TAU) - PI);
          float fl = uFlare * exp(-da * da * 22.0) * exp(-x * 1.6) * 2.6
                   + uFlare * exp(-x * 5.0) * 0.8;
          float edge = 1.0 - smoothstep(14.0, 25.5, rho);
          vec3 col = mix(vec3(1.0, 0.62, 0.3), vec3(1.0, 0.86, 0.66), exp(-x * 1.2));
          vec3 c = (col * (k + s + fl) * 2.2 + vec3(1.0, 0.9, 0.75) * spike * uSpike) * edge * uAmt;
          fragColor = vec4(c, 1.0);
        }`,
    });
    this.corona = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), cor);
    this.corona.frustumCulled = false;
    this.corona.renderOrder = 5;

    // ---------------------------------------------------------------- stars
    const N = 6500, rng = ctx.T.mulberry32(0x57A2);
    const pos = new Float32Array(N * 3), col = new Float32Array(N * 3), sz = new Float32Array(N);
    const bb = (K) => {       // rough blackbody tint
      const t = (K - 3000) / 9000;
      return [1.0, 0.72 + 0.28 * Math.min(1, t * 1.4), 0.45 + 0.6 * Math.min(1, t)].map((v) => Math.min(1, v));
    };
    for (let i = 0; i < N; i++) {
      const z = rng() * 2 - 1, a = rng() * Math.PI * 2, s = Math.sqrt(1 - z * z);
      pos.set([s * Math.cos(a) * 900, z * 900, s * Math.sin(a) * 900], i * 3);
      const m = Math.pow(rng(), 7.0);                    // magnitude distribution: mostly faint
      const c = bb(3000 + 9000 * rng() * rng() + 1500 * rng());
      const I = 0.05 + 2.4 * m;
      col.set([c[0] * I, c[1] * I, c[2] * I], i * 3);
      sz[i] = 1.1 + 1.6 * m;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aCol', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(sz, 1));
    this.starU = { uAmt: { value: 1 }, uPxScale: { value: ctx.H / 1080 }, uCam: { value: new THREE.Vector3() } };
    this.stars = new THREE.Points(g, new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3, uniforms: this.starU, transparent: true, depthTest: false, depthWrite: false,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
      vertexShader: /* glsl */`
        in vec3 aCol; in float aSize; uniform float uAmt, uPxScale; uniform vec3 uCam; out vec3 vC; out float vS;
        void main() {
          vec4 mv = viewMatrix * vec4(uCam + position, 1.0);       // at infinity: follows the camera
          gl_Position = projectionMatrix * mv;
          float d = max(aSize * uPxScale, 1.0);
          gl_PointSize = d + 1.0; vS = d;
          vC = aCol * uAmt * (aSize * aSize) / (d * d / (uPxScale * uPxScale));
        }`,
      fragmentShader: /* glsl */`
        precision highp float; in vec3 vC; in float vS; out vec4 fragColor;
        void main() { vec2 q = (gl_PointCoord * 2.0 - 1.0) * (vS + 1.0) / vS; float a = exp(-dot(q, q) * 2.4) * 1.6; fragColor = vec4(vC * a, 1.0); }`,
    }));
    this.stars.frustumCulled = false;
    this.stars.renderOrder = -10;
  }
}
