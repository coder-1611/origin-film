// VI · LIFE: the underwater view.
//   G-pass: geometry writes (lit colour, signed distance). Negative distance marks the hero
//   stromatolite, whose front face carries the live Gray-Scott colony.
//   Fog pass: Beer-Lambert extinction + inscatter + volumetric god rays (caustic shafts).
//   Mat pass: deferred membrane shading of the RD field on the hero face, refracting the
//   fogged image behind it.
import { THREE } from '../../engine/gl.js';
import { FAR, GL_UNIFORMS, GL_WATER, GL_SKY, GL_FRESNEL } from './common.js';
import { HERO, P0, N0, TX, TY, PATCH } from './layout.js';

const VS_STATIC = /* glsl */`
precision highp float;
in vec3 position; in vec3 normal;
uniform mat4 modelMatrix, viewMatrix, projectionMatrix;
out vec3 vP; out vec3 vN;
#ifdef EXTRA
in float lam; in float hero; in float seed;
out float vLam; out float vHero; out float vSeed;
#endif
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vP = w.xyz; vN = normalize(mat3(modelMatrix) * normal);
#ifdef EXTRA
  vLam = lam; vHero = hero; vSeed = seed;
#endif
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

// Light arriving at an underwater point: refracted sun through caustics, spectrally attenuated
// along the path from the surface, plus a sky-dome ambient that fades with depth.
const GL_LIT_UNDER = /* glsl */`
const vec3 SIG_W = vec3(0.42, 0.155, 0.125);
vec3 litUnder(vec3 p, vec3 n, vec3 alb, float ao, float causAmt) {
  float dep = max(-p.y, 0.0);
  vec3 att = exp(-SIG_W * dep / max(uSunW.y, 0.25));
  float c = causticAt(p);
  float nl = max(dot(n, uSunW), 0.0);
  vec3 direct = uSunCol * att * nl * (0.42 + causAmt * 1.25 * min(c, 2.0)) * 0.85;
  vec3 amb = uUnder * (0.45 + 0.55 * n.y) * exp(-SIG_W * dep * 0.5) * 1.7 * ao;
  return alb * (direct + amb);
}
`;

export function makeWaterView(ctx, G, { stroma, kelpGeo, terrainGeo, W = ctx.W, H = ctx.H }) {
  const { makeTarget, Pass, glsl } = ctx;
  const gTarget = makeTarget(W, H, { depth: true });
  const fTarget = makeTarget(W, H);
  const scene = new THREE.Scene();
  const extra = { uEB: { value: -0.5 }, uET: { value: 0.1 } };
  const U = (more = {}) => ({ ...G, ...extra, ...more });
  const FRAG_HEAD = glsl.header + glsl.math + glsl.hash + GL_UNIFORMS + GL_WATER + GL_LIT_UNDER + `
in vec3 vP; in vec3 vN; out vec4 fragColor;`;

  // ---- sea floor / shore (the underwater side of the shared terrain) ----
  const floorMat = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3, uniforms: U(), vertexShader: VS_STATIC,
    fragmentShader: FRAG_HEAD + /* glsl */`
    void main() {
      vec3 n = normalize(vN);
      vec2 q = vP.xz;
      float rip = sin(dot(q, vec2(0.8, 2.6)) * 9.0 + texture(uNoise, q * 0.21).r * 9.0);
      float nn = texture(uNoise, q * 0.35).g;
      vec3 sand = mix(vec3(0.40, 0.36, 0.28), vec3(0.54, 0.49, 0.38), nn);
      float algae = smoothstep(0.45, 0.75, texture(uNoise, q * 0.09 + 0.3).b) * smoothstep(-1.5, -0.3, vP.y);
      vec3 alb = mix(sand, vec3(0.18, 0.30, 0.14), algae * 0.7);
      alb *= 0.9 + 0.1 * rip;
      n = normalize(n + vec3(0.05 * rip, 0.0, 0.05 * rip));
      vec3 c = litUnder(vP, n, alb, 1.0, 1.0);
      if (vP.y > 0.02) c = vec3(0.0);
      fragColor = vec4(c, distance(vP, uCamPos));
    }`,
  });
  scene.add(new THREE.Mesh(terrainGeo, floorMat));

  // ---- stromatolites ----
  const domeMat = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3, uniforms: U(), vertexShader: '#define EXTRA\n' + VS_STATIC,
    fragmentShader: FRAG_HEAD + /* glsl */`
    in float vLam; in float vHero; in float vSeed;
    void main() {
      vec3 n = normalize(vN);
      // laminated carbonate under a dark microbial skin: grey-ochre bands, pitted, crusted
      float band = sin(vLam * 170.0 + texture(uNoise, vP.xz * 0.9 + vSeed).r * 7.0);
      float band2 = sin(vLam * 57.0 + 1.7);
      float pits = texture(uNoise, vP.xy * 2.3 + vP.zx * 1.7 + vSeed * 3.0).a;
      float grain = texture(uNoise, vP.xz * 3.1 + vP.y * 2.0 + vSeed).r;
      vec3 rock = vec3(0.34, 0.30, 0.23) * (0.78 + 0.1 * band + 0.1 * band2) * (0.75 + 0.45 * grain);
      rock *= 1.0 - 0.45 * pits;
      // mature mat on the upper surfaces: dark olive film, a hint of teal-green where it's young
      float up = smoothstep(-0.3, 0.7, n.y);
      float mat = up * smoothstep(0.3, 0.55, texture(uNoise, vP.xz * 0.6 + vSeed).b + 0.25 * up);
      float cells = texture(uNoise, vP.xz * 7.0 + vSeed).a;
      vec3 matC = mix(vec3(0.07, 0.10, 0.05), vec3(0.14, 0.22, 0.10), cells);
      vec3 alb = mix(rock, matC, mat * (1.0 - vHero * 0.8));
      alb *= 1.0 + vHero * 0.35;
      // crevice darkening from the lumpy relief (screen-space curvature)
      float cav = clamp(1.0 - length(fwidth(n)) * 2.5, 0.45, 1.0);
      vec3 c = litUnder(vP, n, alb, (0.7 + 0.3 * n.y) * cav, 1.0) * mix(0.8, 1.0, cav);
      float d = distance(vP, uCamPos);
      fragColor = vec4(c, vHero > 0.5 ? -d : d);
    }`,
  });
  scene.add(new THREE.Mesh(stroma, domeMat));

  // ---- kelp ----
  const kelpMat = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3, uniforms: U(), side: THREE.DoubleSide,
    vertexShader: glsl.header + GL_UNIFORMS + /* glsl */`
    in vec3 position; in vec4 kp; in vec4 ipos; in vec4 iprm;
    uniform mat4 viewMatrix, projectionMatrix;
    out vec3 vP; out vec3 vN; out vec4 vK;
    void main() {
      float s = kp.x, H = ipos.w, ph = iprm.x;
      float z = s * H;
      // sway: a slow surge plus a travelling wave up the stalk, stronger toward the tip
      float sw = sin(uT * 0.9 + ph + s * 2.2) * 0.22 + sin(uT * 1.7 + ph * 1.3 + s * 4.0) * 0.07 + 0.08 * uKick * s;
      float sw2 = cos(uT * 0.7 + ph * 0.7 + s * 1.7) * 0.16;
      vec3 axis = vec3(sw * s * s, z, sw2 * s * s);
      float tw = ph + s * 6.0 + uT * 0.3;
      vec3 side = vec3(cos(tw), 0.0, sin(tw));
      vec3 perp = vec3(-side.z, 0.0, side.x);
      float bl = kp.y;
      vec3 p = ipos.xyz + axis + side * position.x * iprm.y;
      if (abs(bl) > 0.5) {
        // blades droop outward from the stalk
        float u = kp.z;
        p += perp * bl * u * 0.12 * iprm.y + vec3(0.0, -u * u * 0.05, 0.0);
      }
      vP = p; vN = normalize(perp + vec3(0.0, 0.25, 0.0)); vK = kp;
      gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
    }`,
    fragmentShader: FRAG_HEAD.replace('in vec3 vN;', 'in vec3 vN; in vec4 vK;') + /* glsl */`
    void main() {
      vec3 n = normalize(vN);
      vec3 v = normalize(vP - uCamPos);
      if (dot(n, v) > 0.0) n = -n;
      vec3 alb = mix(vec3(0.20, 0.17, 0.05), vec3(0.42, 0.36, 0.10), vK.z * 0.6 + 0.2 * sin(vK.x * 40.0));
      vec3 c = litUnder(vP, n, alb, 0.9, 0.6);
      // translucency: sunlight through the blade
      float dep = max(-vP.y, 0.0);
      float back = pow(max(dot(v, uSunW), 0.0), 3.0);
      c += vec3(0.55, 0.5, 0.12) * uSunCol * exp(-SIG_W * dep * 1.5) * back * 0.35;
      fragColor = vec4(c, distance(vP, uCamPos));
    }`,
  });
  const kelp = new THREE.Mesh(kelpGeo, kelpMat);
  kelp.frustumCulled = false;
  scene.add(kelp);

  // ---- the surface seen from below: Snell's window + total internal reflection ----
  const surfGeo = new THREE.PlaneGeometry(600, 600, 1, 1);
  surfGeo.rotateX(Math.PI / 2);          // faces down
  const surfMat = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3, uniforms: U(), side: THREE.DoubleSide, vertexShader: VS_STATIC,
    fragmentShader: FRAG_HEAD + GL_SKY + GL_FRESNEL + /* glsl */`
    void main() {
      vec3 v = normalize(vP - uCamPos);
      vec2 q = vP.xz;
      vec2 g = vec2(texture(uNoise, q * 0.19 + vec2(uT * 0.021, 0.0)).r - texture(uNoise, q * 0.19 + vec2(0.013, 0.0) + vec2(uT * 0.021, 0.0)).r,
                    texture(uNoise, q * 0.23 + vec2(0.0, uT * 0.017)).g - texture(uNoise, q * 0.23 + vec2(0.0, 0.013) + vec2(0.0, uT * 0.017)).g);
      vec3 n = normalize(vec3(g.x * 4.5, -1.0, g.y * 4.5));      // faces down
      vec3 t = refract(v, n, 1.333);
      vec3 col;
      vec3 r = reflect(v, n);
      vec3 refl = mix(waterInscatter(r), waterInscatter(reflect(v, vec3(0.0, -1.0, 0.0))), 0.45) * 0.9;
      if (dot(t, t) > 0.0 && t.y > 0.0) {
        float F = fresnelSchlick(abs(dot(v, n)), 0.02);
        vec3 sky = skyColor(t, true) * 0.9;
        col = mix(sky, refl, F);
      } else col = refl * 1.1 + vec3(0.004, 0.012, 0.012);
      fragColor = vec4(col, distance(vP, uCamPos));
    }`,
  });
  scene.add(new THREE.Mesh(surfGeo, surfMat));

  // ---- fog + god rays ----
  const fog = new Pass(glsl.header + glsl.math + glsl.hash + GL_UNIFORMS + GL_WATER + /* glsl */`
    in vec2 vUv; out vec4 fragColor;
    uniform sampler2D gTex; uniform mat4 invProj, camWorld; uniform float heroVis, rayGain;
    const vec3 SIG_W = vec3(0.42, 0.155, 0.125);
    void main() {
      vec4 g = texture(gTex, vUv);
      vec4 vv = invProj * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
      vec3 dir = normalize(mat3(camWorld) * (vv.xyz / vv.w));
      float d = abs(g.a);
      if (g.a < 0.0) d += pow(1.0 - heroVis, 2.0) * 40.0;
      vec3 Tr = exp(-SIG_W * min(d, 400.0));
      vec3 ins = waterInscatter(dir);
      vec3 col = g.rgb * Tr + ins * (1.0 - Tr);
      // volumetric shafts: march the first metres of the ray through the caustic light field
      float L = min(d, 6.0);
      float acc = 0.0;
      float j = hash12(gl_FragCoord.xy);
      const int NS = 20;
      for (int i = 0; i < NS; i++) {
        float s = (float(i) + j) / float(NS) * L;
        vec3 p = uCamPos + dir * s;
        if (p.y > 0.0) break;
        float sh = shaftAt(p);
        acc += pow(sh, 2.2) * exp(-0.35 * s) * exp(-0.9 * max(-p.y, 0.0)) * smoothstep(0.02, 0.25, -p.y);
      }
      acc *= L / float(NS);
      col += vec3(0.30, 0.62, 0.58) * uSunCol * acc * rayGain * (0.6 + 0.4 * pow(max(dot(dir, uSunW), 0.0), 2.0)) * (1.0 + 0.25 * uKick + 0.3 * uAudio.z);
      fragColor = vec4(col, g.a);
    }`, { gTex: { value: null }, invProj: { value: new THREE.Matrix4() }, camWorld: { value: new THREE.Matrix4() }, heroVis: { value: 1 }, rayGain: { value: 1 }, ...G, ...extra });

  // ---- deferred membrane (Gray-Scott colony) ----
  const v3 = (a) => new THREE.Vector3(...a);
  const mat = new Pass(glsl.header + glsl.math + glsl.hash + GL_UNIFORMS + GL_WATER + GL_FRESNEL + /* glsl */`
    in vec2 vUv; out vec4 fragColor;
    uniform sampler2D gTex, fTex, rdTex; uniform mat4 invProj, camWorld, viewProj;
    uniform vec3 P0, TX, TY, HC, HR; uniform float PATCH, rdN, bloomAmt, matOn, px;
    const vec3 SIG_W = vec3(0.42, 0.155, 0.125);
    vec4 cubicW(float v) {
      vec4 n = vec4(1.0, 2.0, 3.0, 4.0) - v;
      vec4 s = n * n * n;
      float x = s.x, y = s.y - 4.0 * s.x, z = s.z - 4.0 * s.y + 6.0 * s.x, w = 6.0 - x - y - z;
      return vec4(x, y, z, w) * (1.0 / 6.0);
    }
    // cubic B-spline filtering with 4 bilinear taps (Sigg & Hadwiger)
    vec4 texBicubic(sampler2D tex, vec2 uv, vec2 res) {
      uv = uv * res - 0.5;
      vec2 fxy = fract(uv); uv -= fxy;
      vec4 xc = cubicW(fxy.x), yc = cubicW(fxy.y);
      vec4 c = uv.xxyy + vec2(-0.5, 1.5).xyxy;
      vec4 s = vec4(xc.xz + xc.yw, yc.xz + yc.yw);
      vec4 o = (c + vec4(xc.yw, yc.yw) / s) / res.xxyy;
      vec4 s0 = texture(tex, o.xz), s1 = texture(tex, o.yz), s2 = texture(tex, o.xw), s3 = texture(tex, o.yw);
      float sx = s.x / (s.x + s.y), sy = s.z / (s.z + s.w);
      return mix(mix(s3, s2, sx), mix(s1, s0, sx), sy);
    }
    vec3 heroNormal(vec3 p) {
      vec3 q = p - HC;
      if (q.y < 0.0) return normalize(vec3(q.x / (HR.x * HR.x), 0.0, q.z / (HR.z * HR.z)));
      return normalize(q / (HR * HR));
    }
    void main() {
      vec4 g = texture(gTex, vUv);
      vec4 f = texture(fTex, vUv);
      if (g.a >= 0.0 || matOn < 0.5) { fragColor = vec4(f.rgb, 1.0); return; }
      vec4 vv = invProj * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
      vec3 dir = normalize(mat3(camWorld) * (vv.xyz / vv.w));
      float dist = -g.a;
      vec3 p = uCamPos + dir * dist;
      vec2 uv = vec2(dot(p - P0, TX), dot(p - P0, TY)) / PATCH + 0.5;
      float edge = smoothstep(0.0, 0.06, uv.x) * (1.0 - smoothstep(0.94, 1.0, uv.x)) * smoothstep(0.0, 0.06, uv.y) * (1.0 - smoothstep(0.94, 1.0, uv.y));
      // fade where the rock curves away from the patch plane (planar projection would smear cells)
      vec3 ng = normalize(cross(dFdx(p), dFdy(p)));
      edge *= smoothstep(0.5, 0.78, dot(heroNormal(p), cross(TX, TY))) * smoothstep(0.22, 0.42, abs(dot(ng, dir)));
      if (edge <= 0.0) { fragColor = vec4(f.rgb, 1.0); return; }
      float e = 1.0 / rdN;
      vec2 res = vec2(rdN);
      vec4 s = texBicubic(rdTex, uv, res);
      float hE = texBicubic(rdTex, uv + vec2(e, 0.0), res).g, hW = texBicubic(rdTex, uv - vec2(e, 0.0), res).g;
      float hN = texBicubic(rdTex, uv + vec2(0.0, e), res).g, hS = texBicubic(rdTex, uv - vec2(0.0, e), res).g;
      float V = s.r * edge, Hd = s.g * edge;
      vec2 gH = vec2(hE - hW, hN - hS) * 0.5 * edge;
      vec3 nD = heroNormal(p);
      vec3 n = normalize(nD - (gH.x * TX + gH.y * TY) * 16.0);
      float aa = max(fwidth(V), 1e-4);
      float body = smoothstep(0.10, 0.24, V);
      float mem = exp(-pow((V - 0.15) / (0.028 + aa * 1.3), 2.0));          // plasma membrane
      float cortex = exp(-pow((V - 0.3) / (0.02 + aa), 2.0)) * body * 0.12;  // faint inner cortex
      float nucl = smoothstep(0.275, 0.325, Hd);
      float nrim = exp(-pow((Hd - 0.29) / (0.006 + fwidth(Hd)), 2.0));
      float nucleolus = smoothstep(0.338, 0.35, Hd);
      float gran = smoothstep(0.45, 0.95, texture(uNoise, uv * 6.0 + s.b * 3.0).a) * body * (1.0 - nucl);
      // lens refraction of whatever lies behind the cell (rock, or open water early on)
      vec3 nv = n - nD;
      vec2 off = (viewProj * vec4(nv, 0.0)).xy * 0.11 * body;
      vec3 bg = texture(fTex, vUv + off).rgb;
      float hue = s.b;
      vec3 tintA = vec3(0.30, 1.0, 0.62), tintB = vec3(0.80, 1.0, 0.30), tintC = vec3(0.28, 0.9, 1.0);
      vec3 tint = hue < 0.5 ? mix(tintA, tintB, hue * 2.0) : mix(tintB, tintC, hue * 2.0 - 1.0);
      vec3 Tr = exp(-SIG_W * dist);
      vec3 base = bg * mix(vec3(1.0), tint * 0.7, body * 0.6 * Tr);   // bg is already fogged
      vec3 col = vec3(0.0);                                              // light the cell adds
      // light: caustic-modulated sun, top-lit dome shading, rim / subsurface glow, fresnel sheen
      float dep = max(-p.y, 0.0);
      vec3 att = exp(-SIG_W * dep / max(uSunW.y, 0.25));
      float c = causticAt(p);
      vec3 view = -dir;
      float ndv = max(dot(n, view), 0.0);
      float lambert = 0.35 + 0.65 * max(dot(n, uSunW), 0.0);
      vec3 h = normalize(view + uSunW);
      float spec = pow(max(dot(n, h), 0.0), 120.0) * (0.5 + 2.5 * c) * body;
      float F = fresnelSchlick(ndv, 0.03);
      vec3 env = waterInscatter(reflect(dir, n));
      float lightLvl = (0.55 + 0.9 * c) * lambert;
      float thin = body * (1.0 - smoothstep(0.2, 0.33, Hd));                 // thin cytoplasm near the rim glows most
      vec3 sss = tint * (mem * 0.6 + cortex * 0.35 + thin * 0.22 + body * 0.05) * lightLvl * bloomAmt;
      col += sss * vec3(0.26, 0.55, 0.48) * 1.7;
      col += tint * gran * 0.05 * lightLvl;
      // nucleus: denser, darker body with a bright envelope and a nucleolus
      col = mix(col, col * 0.55 + tint * vec3(0.05, 0.08, 0.06) * lightLvl, nucl * 0.8);
      base *= 1.0 - nucl * 0.35 * Tr;
      col += tint * nrim * 0.025 * lightLvl + vec3(0.6, 1.0, 0.8) * nucleolus * 0.06 * lightLvl;
      col += uSunCol * att * spec * 1.4;
      col += env * F * body * 1.3;
      // division flash: a short cyan-white bioluminescent pulse in the dividing cell
      col += vec3(0.45, 1.0, 0.85) * s.a * s.a * 0.45 * bloomAmt * body * (0.4 + 0.6 * thin + mem);
      // fog by distance, like everything else in the water
      col = mix(f.rgb, base + col * Tr, edge);
      fragColor = vec4(col, 1.0);
    }`, {
    gTex: { value: null }, fTex: { value: null }, rdTex: { value: null },
    invProj: { value: new THREE.Matrix4() }, camWorld: { value: new THREE.Matrix4() }, viewProj: { value: new THREE.Matrix4() },
    P0: { value: v3(P0) }, TX: { value: v3(TX) }, TY: { value: v3(TY) }, HC: { value: v3(HERO.c) }, HR: { value: v3(HERO.r) },
    PATCH: { value: PATCH }, rdN: { value: 512 }, bloomAmt: { value: 1 }, matOn: { value: 1 }, px: { value: 1 / H },
    ...G, ...extra,
  });

  // ---- marine snow: drifting motes with defocus, depth-tested against the G-buffer ----
  const NS = 3200;
  const snowGeo = new THREE.InstancedBufferGeometry();
  const sq = new THREE.PlaneGeometry(2, 2);
  snowGeo.setAttribute('position', sq.attributes.position);
  snowGeo.setIndex(sq.index);
  const sb = new Float32Array(NS * 4);
  let hs = 0x51A7 >>> 0;
  const rnd = () => { hs = (hs + 0x6D2B79F5) >>> 0; let t = hs; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  for (let i = 0; i < NS; i++) sb.set([rnd(), rnd(), rnd(), rnd()], i * 4);
  snowGeo.setAttribute('sb', new THREE.InstancedBufferAttribute(sb, 4));
  snowGeo.instanceCount = NS;
  const snowMat = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3, transparent: true, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false,
    uniforms: { ...G, ...extra, gTex: { value: null }, uBox: { value: 1 }, uAnchor: { value: new THREE.Vector3() }, uFocus: { value: 1 }, uAper: { value: 0.002 }, uRes: { value: new THREE.Vector2(W, H) }, uAmt: { value: 1 } },
    vertexShader: glsl.header + GL_UNIFORMS + /* glsl */`
    in vec3 position; in vec4 sb;
    uniform mat4 viewMatrix, projectionMatrix; uniform float uBox, uFocus, uAper; uniform vec3 uAnchor; uniform vec2 uRes;
    out vec2 vQ; out vec3 vP; out float vI;
    void main() {
      vec3 drift = vec3(0.012 * sin(uT * 0.21 + sb.w * 20.0), 0.006 + 0.01 * sb.w, 0.01 * cos(uT * 0.17 + sb.w * 13.0)) * uT;
      vec3 p = uAnchor + (fract(sb.xyz + (drift - uAnchor) / uBox) - 0.5) * uBox;
      vec4 vp = viewMatrix * vec4(p, 1.0);
      float d = -vp.z;
      if (d < 0.004 || p.y > -0.01) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
      float core = uBox * (0.0012 + 0.0016 * sb.w * sb.w);
      float coc = uAper * abs(d - uFocus) / max(uFocus, 1e-3);           // blur radius at the focal plane scale
      float r = core + coc * d / max(uFocus, 1e-3);
      float pxw = 2.0 * d / (projectionMatrix[1][1] * uRes.y);            // world size of one pixel at d
      r = max(r, pxw * 0.8);
      vQ = position.xy; vP = p;
      vI = (core * core) / (r * r);                                       // energy spreads with the blur
      gl_Position = projectionMatrix * (vp + vec4(position.xy * r, 0.0, 0.0));
    }`,
    fragmentShader: glsl.header + GL_UNIFORMS + GL_WATER + /* glsl */`
    in vec2 vQ; in vec3 vP; in float vI; out vec4 fragColor;
    uniform sampler2D gTex; uniform vec2 uRes; uniform float uAmt;
    void main() {
      float q = length(vQ);
      if (q > 1.0) discard;
      float d = distance(vP, uCamPos);
      if (d > abs(texture(gTex, gl_FragCoord.xy / uRes).a)) discard;      // behind the scene
      float disc = (1.0 - smoothstep(0.8, 1.0, q)) * (0.75 + 0.25 * smoothstep(0.5, 0.95, q));   // bokeh with a faint rim
      float lit = 0.25 + 1.6 * causticAt(vP);
      vec3 Tr = exp(-vec3(0.42, 0.155, 0.125) * d);
      vec3 c = vec3(0.55, 0.9, 0.85) * uSunCol * 0.05 * lit * disc * min(vI, 1.0) * Tr * uAmt;
      fragColor = vec4(c, 1.0);
    }`,
  });
  const snow = new THREE.Mesh(snowGeo, snowMat);
  snow.frustumCulled = false;
  const snowScene = new THREE.Scene();
  snowScene.add(snow);

  const clearPass = new Pass(glsl.header + `in vec2 vUv; out vec4 fragColor; void main(){ fragColor = vec4(0.0, 0.0, 0.0, ${FAR.toFixed(1)}); }`);
  const vp = new THREE.Matrix4();

  return {
    gTarget, fTarget, scene, extra, fog, mat,
    /** Render the underwater view seen by `cam` into `out`. */
    render(r, cam, out, { heroVis = 1, rayGain = 1, rdTex = null, rdN = 512, matOn = 1, bloomAmt = 1, snow: sn = null } = {}) {
      clearPass.render(r, gTarget);
      r.autoClear = false;
      r.setRenderTarget(gTarget);
      r.clearDepth();
      r.render(scene, cam);
      r.autoClear = true;
      fog.render(r, fTarget, { gTex: gTarget.texture, invProj: cam.projectionMatrixInverse, camWorld: cam.matrixWorld, heroVis, rayGain });
      vp.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
      mat.render(r, out, { gTex: gTarget.texture, fTex: fTarget.texture, rdTex, rdN, invProj: cam.projectionMatrixInverse, camWorld: cam.matrixWorld, viewProj: vp, matOn: rdTex ? matOn : 0, bloomAmt });
      if (sn) {
        const u = snowMat.uniforms;
        u.gTex.value = gTarget.texture; u.uBox.value = sn.box; u.uAnchor.value.copy(sn.anchor); u.uFocus.value = sn.focus; u.uAper.value = sn.aper; u.uAmt.value = sn.amt;
        r.autoClear = false;
        r.setRenderTarget(out);
        r.render(snowScene, cam);
        r.autoClear = true;
      }
    },
  };
}
