// The proto-Earth, Theia and the Moon: analytic-sphere impostors drawn on slightly oversized
// meshes (exact silhouettes, coverage anti-aliasing, analytic normals), plus the impact
// shockwave ring and flash. The Earth evolves: crusted proto-Earth → melt front racing out
// from the impact → magma ocean → crust plates with glowing crack networks (the IV→V look).
import * as G from './geom.js';
import { FxPoints } from './rocks.js';

const SPHERE_COMMON = /* glsl */`
uniform vec3 uC; uniform float uR, uPix;       // centre, radius, pixel angular size (rad / px)
uniform mat3 uRot;                             // world → body-local rotation
uniform vec3 uSun;                             // direction toward the Sun (unit)
uniform float uSunI;
in vec3 vW; out vec4 fragColor;
// returns false if the pixel's ray misses; fills n (world normal), q (local), cov (AA coverage)
bool hitSphere(out vec3 n, out vec3 q, out float cov, out vec3 pos) {
  vec3 rd = normalize(vW - cameraPosition);
  vec3 oc = cameraPosition - uC;
  float b = dot(oc, rd);
  float c = dot(oc, oc) - uR * uR;
  float dca = length(oc - rd * b);                  // closest approach of the ray to the centre
  float dist = max(-b, 1e-4);
  cov = clamp((uR - dca) / (dist * uPix) + 0.5, 0.0, 1.0);
  if (cov <= 0.0) return false;
  float h = b * b - c;
  float tt = -b - sqrt(max(h, 0.0));
  pos = cameraPosition + rd * tt;
  n = normalize(pos - uC);
  if (h < 0.0) { n = normalize(oc - rd * b); pos = uC + n * uR; }      // AA fringe just outside the limb
  q = uRot * n;
  return true;
}
vec3 vor3(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  float f1 = 8.0, f2 = 8.0, id = 0.0;
  for (int k = 0; k < 27; k++) {
    vec3 o = vec3(float(k % 3), float((k / 3) % 3), float(k / 9)) - 1.0;
    vec3 h = hash33(i + o + vec3(0.5));
    vec3 r = o + h - f; float d = dot(r, r);
    if (d < f1) { f2 = f1; f1 = d; id = h.z; } else if (d < f2) f2 = d;
  }
  return vec3(sqrt(f1), sqrt(f2), id);
}
`;
const VERT = /* glsl */`
out vec3 vW;
void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;

function sphereMaterial(ctx, body, extraUniforms) {
  const { THREE, glsl } = ctx;
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: {
      uC: { value: new THREE.Vector3() }, uR: { value: 1 }, uPix: { value: 0.001 }, uRot: { value: new THREE.Matrix3() },
      uSun: { value: new THREE.Vector3(-1, 0, 0) }, uSunI: { value: 1.35 }, uT: { value: 0 }, ...extraUniforms,
    },
    vertexShader: VERT,
    fragmentShader: glsl.header + glsl.math + glsl.hash + glsl.noise + glsl.color + SPHERE_COMMON + body,
    transparent: true, depthWrite: true, depthTest: true,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  });
}

// ------------------------------------------------------------------ Earth
const EARTH_BODY = /* glsl */`
uniform float uT, uAge, uCool, uPre, uCrack, uAtmo, uEarthKick;
uniform vec3 uImp;                 // impact site, body-local
float lavaCracks(vec3 q, float wid1, float wid2, float fp, out float halo, out float plateAge, out float fine) {
  vec3 jag = vec3(snoise(q * 41.0), snoise(q * 41.0 + 5.3), snoise(q * 41.0 - 9.1));
  vec3 w = q * 3.4 + 0.2 * vec3(snoise(q * 2.2), snoise(q * 2.2 + 19.1), snoise(q * 2.2 - 7.7)) + 0.028 * jag;
  vec3 v1 = vor3(w);
  float e1 = v1.y - v1.x;
  float aa1 = fp * 3.2 * 1.5;
  float wv = wid1 + 0.018 * smoothstep(-0.4, 0.8, snoise(q * 5.0 + 2.0)) * smoothstep(0.1, 0.017, wid1);
  float c1 = (1.0 - smoothstep(0.0, wv + aa1, e1)) * (wv / (wv + aa1));
  vec3 w2 = q * 12.0 + 0.25 * vec3(snoise(q * 7.0 + 3.0), snoise(q * 7.0 - 5.0), snoise(q * 7.0 + 8.0)) + 0.08 * jag;
  vec3 v2 = vor3(w2);
  float e2 = v2.y - v2.x;
  float aa2 = fp * 11.0 * 1.5;
  fine = (1.0 - smoothstep(0.0, wid2 + aa2, e2)) * (wid2 / (wid2 + aa2)) * smoothstep(0.25 + 0.5 * (wid1 - 0.016), 0.02, e1)
       * smoothstep(0.35 + 0.4 * v2.z, 0.6 + 0.4 * v2.z, 1.0);
  halo = exp(-e1 * 26.0);
  plateAge = hashU(uint(v1.z * 65535.0));
  return c1;
}
void main() {
  vec3 n, q, pos; float cov;
  if (!hitSphere(n, q, cov, pos)) discard;
  vec3 V = normalize(cameraPosition - pos);
  float ndl = dot(n, uSun);
  float fp = uPix * length(cameraPosition - pos) / uR;            // pixel footprint on the unit sphere
  // --- melt front from the impact
  float ang = acos(clamp(dot(q, uImp), -1.0, 1.0));
  float front = uAge > 0.0 ? PI * 1.08 * (1.0 - exp(-uAge / 1.05)) : -1.0;
  float melted = uAge > 0.0 ? smoothstep(front + 0.45, front - 0.55, ang + 0.2 * snoise(q * 3.0)) : 0.0;
  // local cooling: the impact site stays hottest longest
  float cool = mix(uPre, uCool * (0.75 + 0.25 * smoothstep(0.0, 1.6, ang)), melted);
  float wid1 = mix(0.13, 0.016, cool), wid2 = mix(0.09, 0.03, cool);
  float halo, pa, fine;
  float crack = lavaCracks(q, wid1, wid2, fp, halo, pa, fine);
  float live = smoothstep(pa * 0.75, pa * 0.75 + 0.3, 1.0);
  float pulse = 0.55 + 0.45 * smoothstep(-0.6, 0.7, snoise(q * 4.0 + vec3(0.0, 0.0, (uT - 81.0) * 0.5)));
  float Tk = mix(2300.0, 1450.0, cool);
  vec3 magma = blackbody(Tk) * 5.0;
  vec3 hotV = vec3(1.0, 0.46, 0.12), warm = vec3(0.85, 0.14, 0.025);
  // crust skin: fresh black basalt, dull red while young
  float nv = snoise(q * 24.0) * 0.5 + 0.5, nv2 = snoise(q * 70.0 + 5.0) * 0.5 + 0.5;
  vec3 crust = vec3(0.036, 0.033, 0.031) * (0.6 + 0.7 * nv) * (0.75 + 0.5 * nv2);
  vec3 lit = crust * uSunI * max(ndl, 0.0);
  float plate = smoothstep(0.2, 0.9, snoise(q * 1.7 + 4.0));
  vec3 cr = mix(magma, hotV * 5.5, smoothstep(0.45, 0.95, cool));
  vec3 em = (cr * crack * live + warm * 0.9 * fine * (1.0 - crack)) * pulse * uCrack;
  em += warm * (0.07 * halo * pulse + 0.006 * plate) * live * uCrack;
  em += blackbody(1150.0) * 0.55 * pow(1.0 - cool, 1.5) * (1.0 - crack) * (0.5 + nv);   // the magma ocean's skin glows while young
  // the impact site: white-hot, then a long-lived glowing basin
  em += blackbody(mix(5000.0, 1800.0, clamp(uAge / 4.0, 0.0, 1.0))) * exp(-ang * ang / 0.05) * (uAge > 0.0 ? 30.0 * exp(-uAge / 1.4) + 1.5 * exp(-uAge / 6.0) : 0.0);
  // the shock front racing over the surface
  em += vec3(1.0, 0.48, 0.16) * exp(-pow((ang - front) / 0.26, 2.0)) * (uAge > 0.0 ? 1.4 * exp(-uAge / 0.8) : 0.0) * (0.6 + 0.4 * snoise(q * 6.0 + uAge));
  vec3 col = lit + em * (1.0 + 0.3 * uEarthKick);
  // hot rock-vapour limb (gone by the hand-off)
  float rim = pow(1.0 - max(dot(n, V), 0.0), 3.0);
  col += vec3(1.0, 0.42, 0.12) * rim * uAtmo * 1.2;
  fragColor = vec4(col * cov, cov);
}`;

// ------------------------------------------------------------------ Theia
const THEIA_BODY = /* glsl */`
uniform float uT, uHeat; uniform vec3 uHeatDir;
void main() {
  vec3 n, q, pos; float cov;
  if (!hitSphere(n, q, cov, pos)) discard;
  float f = fbm(q * 2.4 + 3.0, 5) * 0.5 + 0.5;
  float maria = smoothstep(0.45, 0.62, fbm(q * 1.3 - 5.0, 4) * 0.5 + 0.5);
  vec3 v = vor3(q * 6.0);
  float crater = smoothstep(0.05, 0.0, abs(v.x - 0.32)) * 0.3 - smoothstep(0.3, 0.0, v.x) * 0.15;
  vec3 alb = mix(vec3(0.34, 0.14, 0.07), vec3(0.2, 0.075, 0.045), maria) * (0.75 + 0.5 * f) * (1.0 + crater);
  // bump
  vec3 bn = normalize(n + 0.2 * vec3(snoise(q * 9.0), snoise(q * 9.0 + 3.0), snoise(q * 9.0 - 6.0)) * 0.5);
  float ndl = max(dot(bn, uSun), 0.0);
  vec3 col = alb * uSunI * ndl + alb * 0.01;
  // tidal/compression heating on the face turned toward the Earth, just before contact
  float face = smoothstep(0.55, 1.0, dot(n, uHeatDir));
  float cr = smoothstep(0.08, 0.0, abs(snoise(q * 5.0)));
  col += vec3(1.0, 0.36, 0.08) * uHeat * face * (0.6 + 3.0 * cr);
  fragColor = vec4(col * cov, cov);
}`;

// ------------------------------------------------------------------ Moon
const MOON_BODY = /* glsl */`
uniform float uT, uHot, uEarthGlow; uniform vec3 uEarthDir;
void main() {
  vec3 n, q, pos; float cov;
  if (!hitSphere(n, q, cov, pos)) discard;
  float f = fbm(q * 3.0, 5) * 0.5 + 0.5;
  vec3 alb = vec3(0.12, 0.115, 0.11) * (0.7 + 0.6 * f);
  float ndl = max(dot(n, uSun), 0.0);
  vec3 v = vor3(q * 4.0);
  float crack = 1.0 - smoothstep(0.0, mix(0.02, 0.25, uHot), v.y - v.x);
  vec3 col = alb * (uSunI * ndl + uEarthGlow * max(dot(n, uEarthDir), 0.0)) ;
  col += blackbody(mix(1200.0, 2400.0, uHot)) * uHot * (0.4 + 5.0 * crack) * (0.7 + 0.3 * f);
  fragColor = vec4(col * cov, cov);
}`;

export class Worlds {
  init(ctx, geom, moon, vspin) {
    const { THREE, T } = ctx;
    this.g = geom; this.moon = moon;
    this.earthMat = sphereMaterial(ctx, EARTH_BODY, {
      uAge: { value: -1 }, uCool: { value: 1 }, uPre: { value: 1 }, uCrack: { value: 0.4 }, uAtmo: { value: 0 }, uEarthKick: { value: 0 },
      uImp: { value: new THREE.Vector3(1, 0, 0) },
    });
    this.theiaMat = sphereMaterial(ctx, THEIA_BODY, { uHeat: { value: 0 }, uHeatDir: { value: new THREE.Vector3() } });
    this.moonMat = sphereMaterial(ctx, MOON_BODY, { uHot: { value: 1 }, uEarthGlow: { value: 0 }, uEarthDir: { value: new THREE.Vector3() } });
    const geo = new THREE.SphereGeometry(1.035, 96, 64);   // oversized: the shader cuts the exact limb
    this.earth = new THREE.Mesh(geo, this.earthMat);
    this.theia = new THREE.Mesh(geo, this.theiaMat);
    this.moonMesh = new THREE.Mesh(geo, this.moonMat);
    for (const m of [this.earth, this.theia, this.moonMesh]) { m.frustumCulled = false; m.renderOrder = 1; }

    // Earth orientation. From 81 s on it IS chapter V's planet frame, q = S(φ(t))·Cᵀ·n (C = our
    // final camera basis = V's view space), so the two crack networks coincide through the
    // IV→V dissolve. Before 81 s the same spin is extended backwards (rate 0.05 rad/s at 81 s,
    // livelier after the impact), so the rotation is continuous.
    this.vspin = vspin;
    const f81 = G.camFrame(T.sampleCamera(T.cameras.IV, G.FINAL.t), ctx.W / ctx.H);
    this.C = [f81.x, f81.y, f81.z];
    const wMine = (t) => 0.05 + 0.14 * G.sstep(T.THEIA_T, T.THEIA_T + 2.5, t) * (1 - G.sstep(76.5, 80.0, t));
    const N = 2600, t0 = 57.0, dt = (G.FINAL.t - t0) / N;
    this.phiTab = new Float64Array(N + 1);          // φ(t) = ∫_t^81 ω  (t < 81), Simpson per cell
    for (let i = N - 1; i >= 0; i--) {
      const a = t0 + i * dt;
      this.phiTab[i] = this.phiTab[i + 1] + dt / 6 * (wMine(a) + 4 * wMine(a + dt / 2) + wMine(a + dt));
    }
    this.phiAt = (t) => {
      if (t >= G.FINAL.t) return this.vspin.spinAngle(t);
      const x = Math.max(0, (t - t0) / dt), i = Math.min(N - 1, Math.floor(x)), u = x - i;
      return this.phiTab[i] * (1 - u) + this.phiTab[i + 1] * u;
    };
    /** world → body-local, as rows */
    this.bodyRows = (t) => {
      const S = this.vspin.spinMatrix(this.phiAt(t));
      return S.map((row) => G.add(G.add(G.mul(this.C[0], row[0]), G.mul(this.C[1], row[1])), G.mul(this.C[2], row[2])));
    };
    const Ri = this.bodyRows(T.THEIA_T);
    this.impLocal = new THREE.Vector3(G.dot(Ri[0], geom.n), G.dot(Ri[1], geom.n), G.dot(Ri[2], geom.n));

    // shockwave ring in the tangent plane at the contact point
    this.shockU = { uAge: { value: -1 }, uT: { value: 0 } };
    this.shock = new THREE.Mesh(new THREE.RingGeometry(0.02, 1.0, 256, 8), new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3, uniforms: this.shockU, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
      vertexShader: /* glsl */`out vec2 vP; void main() { vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: ctx.glsl.header + ctx.glsl.math + ctx.glsl.hash + ctx.glsl.noise + /* glsl */`
        in vec2 vP; out vec4 fragColor; uniform float uAge, uT;
        void main() {
          float r = length(vP), a = atan(vP.y, vP.x);
          vec2 cs = vec2(cos(a), sin(a));
          float br = fbm(vec3(cs * 4.0, uAge * 1.2 + r * 3.0), 5) * 0.5 + 0.5;
          float fil = fbm(vec3(cs * 18.0, r * 9.0 - uAge * 2.0), 3) * 0.5 + 0.5;
          // a turbulent vapour front: sharp leading edge, a long fading wake inside it
          float lead = smoothstep(1.0, 0.965, r);
          float wake = exp(-(1.0 - r) / (0.08 + 0.12 * br)) * lead;
          float I = wake * (0.25 + 1.3 * smoothstep(0.35, 0.8, br)) * (0.6 + 0.8 * fil);
          vec3 col = mix(vec3(1.0, 0.42, 0.12), vec3(1.0, 0.86, 0.7), exp(-(1.0 - r) / 0.03) * exp(-uAge / 0.6));
          fragColor = vec4(col * I * 1.5 * exp(-uAge / 0.5) * smoothstep(0.0, 0.04, uAge), 1.0);
        }`,
    }));
    this.shock.frustumCulled = false;
    this.shock.renderOrder = 6;
    const nrm = new THREE.Vector3(...geom.axis);   // the shock spreads in the debris-ring plane
    this.shock.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), nrm);
    this.shock.position.set(...geom.P);
    this.fx = new FxPoints(ctx, 8);
    this.T = T;
    this._m3 = new THREE.Matrix3(); this._m4 = new THREE.Matrix4(); this._q = new THREE.Quaternion();
  }
  sceneObjects() { return [this.earth, this.theia, this.moonMesh, this.shock]; }
  fxObjects() { return [this.fx.points]; }
  earthPosAt(t) { return G.earthPos(t); }
  theiaPosAt(t) {
    const g = this.g, T = this.T;
    const s = t < T.THEIA_T ? G.theiaRemaining(g, T, t) : -0.35 * G.RT * G.sstep(T.THEIA_T, T.THEIA_T + 0.5, t) * 2.0;
    return G.add(g.theiaC, G.mul(g.v, -s));
  }
  moonPosAt(t) { return G.ringPos(this.g, G.MOON_A, this.moon.phi81 + G.MOON_W * (t - G.FINAL.t)); }
  /** 0 → 1: how much of the Moon has gathered (matches the debris capture schedule). */
  moonMass(t) { return G.sstep(76.1, 79.7, t); }

  setBody(mat, c, R, rotQ, camera, ctx, sunDir, sunI) {
    const u = mat.uniforms;
    u.uC.value.set(c[0], c[1], c[2]); u.uR.value = R;
    u.uPix.value = 2 * Math.tan(camera.fov * Math.PI / 360) / ctx.H;
    this._m4.makeRotationFromQuaternion(rotQ.clone().invert());
    u.uRot.value.setFromMatrix4(this._m4);
    u.uSun.value.set(...sunDir); u.uSunI.value = sunI;
  }

  update(ctx, t, camera, P, sceneRT) {
    const T = ctx.T, g = this.g;
    const age = t - T.THEIA_T;
    const E = G.earthPos(t);
    const sunDir = G.norm(G.mul(E, -1));
    const sunI = 1.35 * (1 + 0.0 * t);
    // --- Earth
    this.earth.position.set(...E); this.earth.scale.setScalar(G.RE);
    this.setBody(this.earthMat, E, G.RE, this._q.identity(), camera, ctx, sunDir, sunI);
    const Rr = this.bodyRows(t);
    this.earthMat.uniforms.uRot.value.set(Rr[0][0], Rr[0][1], Rr[0][2], Rr[1][0], Rr[1][1], Rr[1][2], Rr[2][0], Rr[2][1], Rr[2][2]);
    const eu = this.earthMat.uniforms;
    eu.uT.value = t; eu.uAge.value = age; eu.uImp.value.copy(this.impLocal);
    eu.uCool.value = G.sstep(T.THEIA_T + 0.8, 80.6, t) ** 0.8;
    eu.uPre.value = 1.0;
    eu.uCrack.value = t < T.THEIA_T ? 0.16 : 1.0;
    eu.uAtmo.value = age > 0 ? Math.exp(-age / 3.0) * (1 - G.sstep(78, 80.5, t)) : 0;
    // --- Theia
    const tp = this.theiaPosAt(t);
    const tScale = t < T.THEIA_T ? 1 : Math.max(0, 1 - G.sstep(T.THEIA_T, T.THEIA_T + 0.55, t));
    const theiaOn = t > 64 && tScale > 0.001;
    this.theia.visible = theiaOn;
    if (theiaOn) {
      // tidal stretch toward the Earth in the last half second
      this.theia.position.set(...tp); this.theia.scale.setScalar(G.RT * 1.0 * tScale);
      this.setBody(this.theiaMat, tp, G.RT * tScale, this._q.setFromAxisAngle(new ctx.THREE.Vector3(0.3, 1, 0.2).normalize(), 0.15 * t), camera, ctx, sunDir, sunI);
      const tu = this.theiaMat.uniforms;
      tu.uT.value = t; tu.uHeat.value = Math.pow(G.sstep(T.THEIA_T - 0.7, T.THEIA_T, t), 2.0) * 1.2 * tScale;
      tu.uHeatDir.value.set(...G.norm(G.sub(E, tp)));
    }
    // --- Moon
    const mm = this.moonMass(t);
    const mOn = mm > 0.001;
    this.moonMesh.visible = mOn;
    if (mOn) {
      const mp = this.moonPosAt(t);
      const R = G.RM * Math.cbrt(mm);
      this.moonMesh.position.set(...mp); this.moonMesh.scale.setScalar(R);
      this.setBody(this.moonMat, mp, R, this._q.setFromAxisAngle(new ctx.THREE.Vector3(...g.axis), 0.4 * t), camera, ctx, G.norm(G.mul(mp, -1)), sunI);
      const mu = this.moonMat.uniforms;
      mu.uT.value = t; mu.uHot.value = 1 - G.sstep(77.5, 81.5, t) * 0.75;
      mu.uEarthGlow.value = 0.6 * (1 - G.sstep(76, 81, t) * 0.7); mu.uEarthDir.value.set(...G.norm(G.sub(E, mp)));
    }
    // --- shockwave + flash
    this.shockU.uAge.value = age; this.shockU.uT.value = t;
    this.shock.visible = age > 0 && age < 4;
    if (this.shock.visible) this.shock.scale.setScalar(G.RE * (0.25 + 3.6 * (1 - Math.exp(-age / 0.6))));
    this.fx.begin();
    if (age >= 0 && age < 4) {
      const I = 40000 * Math.exp(-age / 0.08) + 5000 * Math.exp(-age / 0.45) + 700 * Math.exp(-age / 2.0);
      this.fx.add(g.P, [1.0, 0.9, 0.78], I, 160 * (0.8 + 0.6 * Math.exp(-age / 0.5)), 1);
    }
    this.fx.end(P, sceneRT.depthTexture);
    this.earthGlow = age > 0 ? 0.05 + 0.6 * Math.exp(-age / 2.5) : 0;
  }
}
