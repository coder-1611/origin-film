// VI · LIFE: the above-water view.
//   Sky pass (analytic sunset sky + far ridges) → geometry (terrain, forest, birds) writing
//   (lit colour, distance) → air pass: aerial perspective + the sea surface (Fresnel mirror of
//   the rendered frame, analytic-sky fallback, sun glitter).
import { THREE } from '../../engine/gl.js';
import { FAR, GL_UNIFORMS, GL_SKY, GL_FRESNEL } from './common.js';
import { SUN_AZ } from './layout.js';
import { GL_SHADOW } from './shadow.js';

export const GL_LIT_AIR = /* glsl */`
vec3 litAir(vec3 p, vec3 n, vec3 alb, float ao, float shadow) {
  float nl = max(dot(n, uSunDir), 0.0);
  vec3 sky = mix(uSkyHor2 * 0.8, uSkyZen * 1.4, 0.5 + 0.5 * n.y) * (0.55 + 0.45 * n.y) * 0.75;
  vec3 bounce = vec3(0.35, 0.3, 0.22) * uSunCol * 0.04 * (0.5 - 0.5 * n.y);
  return alb * (uSunCol * nl * shadow * 0.95 + sky * ao + bounce) * (1.0 - uDusk);
}
`;

// Far ridges beyond the terrain mesh (left of the headland), as an elevation profile in azimuth.
const GL_RIDGE = /* glsl */`
uniform float uHeadAz;
float ridgeElev(float az) {
  float a = az;
  float r = 0.010 + 0.012 * texture(uNoise, vec2(a * 0.35, 0.37)).b + 0.006 * texture(uNoise, vec2(a * 1.3, 0.71)).g;
  return r * (1.0 - smoothstep(uHeadAz - 0.12, uHeadAz + 0.02, a));
}
`;

export function makeAirView(ctx, G, { terrainGeo, W = ctx.W, H = ctx.H }) {
  const { makeTarget, Pass, glsl } = ctx;
  const gTarget = makeTarget(W, H, { depth: true });
  const scene = new THREE.Scene();
  const extra = { uHeadAz: { value: SUN_AZ - 0.1 } };
  const U = (more = {}) => ({ ...G, ...extra, ...more });

  const sky = new Pass(glsl.header + glsl.math + glsl.hash + GL_UNIFORMS + GL_SKY + GL_RIDGE + /* glsl */`
    in vec2 vUv; out vec4 fragColor; uniform mat4 invProj, camWorld;
    void main() {
      vec4 vv = invProj * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
      vec3 d = normalize(mat3(camWorld) * (vv.xyz / vv.w));
      vec3 c = skyColor(d, true);
      float az = atan(d.x, -d.z);
      float re = ridgeElev(az);
      if (d.y < re && d.y > -0.05) {
        vec3 haze = skyColor(normalize(vec3(d.x, 0.004, d.z)), false);
        vec3 hill = mix(vec3(0.03, 0.05, 0.08) * (1.0 - uDusk), haze, 0.6);
        c = hill;
      }
      fragColor = vec4(c, ${FAR.toFixed(1)});
    }`, { invProj: { value: new THREE.Matrix4() }, camWorld: { value: new THREE.Matrix4() }, ...G, ...extra });

  const VS = /* glsl */`
  precision highp float;
  in vec3 position; in vec3 normal;
  uniform mat4 modelMatrix, viewMatrix, projectionMatrix;
  out vec3 vP; out vec3 vN;
  void main() { vec4 w = modelMatrix * vec4(position, 1.0); vP = w.xyz; vN = normal; gl_Position = projectionMatrix * viewMatrix * w; }`;

  const landMat = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3, uniforms: U({ uCanopy: { value: null }, uCanopyBox: { value: new THREE.Vector4(-60, -120, 120, 120) } }), vertexShader: VS,
    fragmentShader: glsl.header + glsl.math + glsl.hash + GL_UNIFORMS + GL_LIT_AIR + GL_SHADOW + /* glsl */`
    in vec3 vP; in vec3 vN; out vec4 fragColor;
    uniform sampler2D uCanopy; uniform vec4 uCanopyBox;
    void main() {
      if (vP.y < -0.03) { fragColor = vec4(0.0, 0.0, 0.0, distance(vP, uCamPos)); return; }
      vec3 n = normalize(vN);
      vec2 q = vP.xz;
      float n1 = texture(uNoise, q * 0.013).g, n2 = texture(uNoise, q * 0.09).r, n3 = texture(uNoise, q * 0.6).a;
      // bare ground: sand at the waterline, then weathered rock and soil
      float wet = (1.0 - smoothstep(0.0, 0.1, vP.y));
      vec3 sand = mix(vec3(0.40, 0.34, 0.26), vec3(0.16, 0.13, 0.10), wet);
      vec3 rock = mix(vec3(0.17, 0.15, 0.12), vec3(0.28, 0.24, 0.19), n2) * (0.8 + 0.3 * n3);
      float steep = 1.0 - smoothstep(0.55, 0.85, n.y);
      vec3 ground = mix(sand, rock, smoothstep(0.12, 0.3, vP.y + n2 * 0.12));
      // life spreads inland from the shore: mosses → grasses → forest floor
      float front = uGreen * 1.25 - 0.1;
      float g = 1.0 - smoothstep(front - 0.18, front, n1 * 0.55 + 0.45 * clamp(vP.y / 12.0, 0.0, 1.0) + 0.08 * (1.0 - n2));
      g *= smoothstep(0.18, 0.5, vP.y) * (1.0 - steep * 0.5);
      g = max(g, smoothstep(0.0, 1.0, uGreen) * smoothstep(20.0, 60.0, length(vP.xz)) * 0.9);
      vec3 moss = mix(vec3(0.05, 0.09, 0.025), vec3(0.13, 0.17, 0.05), n2) * (0.8 + 0.4 * n3);
      vec3 alb = mix(ground, moss, g);
      // canopy occlusion from the forest (top-down density map)
      float sh = sunShadow(vP, n);
      vec3 c = litAir(vP, n, alb, 0.75 + 0.25 * sh, sh);
      fragColor = vec4(c, distance(vP, uCamPos));
    }`,
  });
  scene.add(new THREE.Mesh(terrainGeo, landMat));

  // aerial perspective + the sea seen from above
  const airPass = new Pass(glsl.header + glsl.math + glsl.hash + GL_UNIFORMS + GL_SKY + GL_FRESNEL + /* glsl */`
    in vec2 vUv; out vec4 fragColor;
    uniform sampler2D gTex; uniform mat4 invProj, camWorld, viewProj; uniform float uPxA;
    // sea: directional sine waves; each fades out (into roughness) as the pixel footprint nears its wavelength
    vec2 seaSlope(vec2 q, float foot, out float sig2) {
      vec2 s = vec2(0.0); sig2 = 0.0;
      for (int i = 0; i < 14; i++) {
        float fi = float(i);
        float ang = 0.5 + 1.1 * sin(fi * 2.399 + 0.7) + 0.35 * sin(fi * 5.1);   // spread around the wind
        vec2 dir = vec2(cos(ang), sin(ang));
        float lam = 5.0 * pow(0.76, fi) * (0.85 + 0.3 * fract(fi * 0.618));
        float k = 6.28318 / lam;
        float sa = 0.05 * (1.0 + uKick * 0.2) * (0.7 + 0.6 * fract(fi * 0.382));
        float ph = k * dot(dir, q) - sqrt(9.81 * k) * uT * 0.7 + fi * 1.9 + 3.0 * sin(dot(q, vec2(0.031, 0.047)) + fi);
        float fade = 1.0 - smoothstep(lam * 0.3, lam * 1.1, foot);
        // wave groups: amplitude varies slowly across the sea, so the pattern never tiles
        float grp = 0.45 + 1.1 * texture(uNoise, q * (0.012 + 0.004 * fi) + vec2(fi * 0.37, fi * 0.11) + uT * 0.004).b;
        sa *= grp;
        // slightly peaked (trochoid-like) profile
        float cph = cos(ph);
        s += dir * (cph + 0.25 * cos(2.0 * ph)) * sa * fade;
        sig2 += 0.55 * sa * sa * (1.0 - fade);
      }
      // fine capillary ripples from the noise texture (mip-filtered by the hardware)
      vec2 w = texture(uNoise, q * 0.9 + vec2(uT * 0.05, uT * 0.02)).rg - texture(uNoise, q * 0.9 + vec2(0.011, 0.007) + vec2(uT * 0.05, uT * 0.02)).rg;
      s += w * 0.7 * (1.0 - smoothstep(0.008, 0.05, foot));
      sig2 += 0.004 * smoothstep(0.008, 0.05, foot);
      return s;
    }
    vec3 haze(vec3 c, float d, vec3 dir) {
      if (d >= ${(FAR - 1).toFixed(1)}) return c;
      float f = 1.0 - exp(-d * 0.0011);
      vec3 hz = skyColor(normalize(vec3(dir.x, max(dir.y, 0.0) * 0.35 + 0.01, dir.z)), false);
      return mix(c, hz, f);
    }
    vec3 sceneAt(vec3 dir) {
      vec4 cp = viewProj * vec4(dir, 0.0);
      vec2 suv = cp.xy / cp.w * 0.5 + 0.5;
      if (cp.w > 0.0 && suv.x > 0.001 && suv.x < 0.999 && suv.y > 0.001 && suv.y < 0.999) {
        vec4 g = texture(gTex, suv);
        return haze(g.rgb, g.a, dir);
      }
      return skyColor(dir, true);
    }
    void main() {
      vec4 vv = invProj * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
      vec3 dir = normalize(mat3(camWorld) * (vv.xyz / vv.w));
      vec4 g = texture(gTex, vUv);
      vec3 col = haze(g.rgb, g.a, dir);
      if (dir.y < 0.0) {
        float tp = -uCamPos.y / dir.y;
        if (tp < g.a) {
          vec3 p = uCamPos + dir * tp;
          float foot = tp * uPxA / max(-dir.y, 0.004) * 0.7;
          float sig2;
          vec2 sl = seaSlope(p.xz, foot, sig2);
          vec3 n = normalize(vec3(-sl.x, 1.0, -sl.y));
          vec3 r = reflect(dir, n);
          // unresolved roughness spreads the reflection lobe upward on average (a rough sea
          // mirrors a higher, darker patch of sky than a flat one)
          r.y = max(abs(r.y), 0.0015) + sqrt(sig2) * 0.9;
          r = normalize(r);
          float F = fresnelSchlick(max(dot(-dir, n), 0.0), 0.02);
          vec3 refl = sceneAt(r);
          vec3 body = (uSkyZen * 0.12 + vec3(0.004, 0.018, 0.02)) * (1.0 - uDusk);
          vec3 wc = mix(body, refl * 0.9, F);
          // glitter: Beckmann distribution of the unresolved facets (+ the resolved normal)
          vec3 hv = normalize(uSunDir - dir);
          float a2 = max(2.0 * sig2 + 0.005, 1e-4);
          float c = max(dot(n, hv), 1e-3), c2 = c * c;
          float D = exp(-(1.0 - c2) / (c2 * a2)) / (3.14159 * a2 * c2 * c2);
          wc += uSunCol * uSunVis * D * F * 0.012 * (1.0 - uDusk);
          col = haze(wc, tp, dir);
        }
      }
      fragColor = vec4(col, g.a);
    }`, { gTex: { value: null }, invProj: { value: new THREE.Matrix4() }, camWorld: { value: new THREE.Matrix4() }, viewProj: { value: new THREE.Matrix4() }, uPxA: { value: 0.001 }, ...G, ...extra });

  const vp = new THREE.Matrix4();
  return {
    gTarget, scene, extra, landMat,
    render(r, cam, out) {
      airPass.uniforms.uPxA.value = 2 * Math.tan(cam.fov * Math.PI / 360) / H;
      sky.render(r, gTarget, { invProj: cam.projectionMatrixInverse, camWorld: cam.matrixWorld });
      r.autoClear = false;
      r.setRenderTarget(gTarget);
      r.clearDepth();
      r.render(scene, cam);
      r.autoClear = true;
      vp.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
      airPass.render(r, out, { gTex: gTarget.texture, invProj: cam.projectionMatrixInverse, camWorld: cam.matrixWorld, viewProj: vp });
    },
  };
}
