// The giant impact's debris, every particle a pure function of the time since impact:
//  * splash: ballistic magma droplets from the contact point (most fall back);
//  * plume: incandescent rock-vapour blobs (soft sprites) expanding and cooling;
//  * ring: 60k ejecta. Launched from the impact along the flow, they wrap around the Earth and
//    shear out along Keplerian orbits into a ring; the vertical spray damps down (collisions),
//    then outer debris spirals into the growing Moon while the inner ring rains back down;
//  * fragments: hot tumbling rocks (instanced meshes, gather-DOF), some flung past the lens.
import * as G from './geom.js';
import { WORLD, BOKEH_VERT, BOKEH_FRAG } from './glsl.js';
import { rockGeometry, rockMaterial } from './rocks.js';

// Radial ringlet density (irregular: incommensurate sines), shared by the sampler and the glow shader.
const RL = [[3.1, 0.7, 0.22], [7.3, 2.1, 0.16], [11.9, 4.4, 0.12], [1.7, 5.0, 0.2], [17.3, 1.2, 0.08]];
const ringlet = (r) => RL.reduce((a, [f, ph, w]) => a + 0.7 * w * Math.sin(r * f + ph), 0.66);
const RINGLET_GLSL = `float ringlet(float r) { return 0.66 ${RL.map(([f, ph, w]) => `+ ${(0.7 * w).toFixed(3)} * sin(r * ${f.toFixed(3)} + ${ph.toFixed(3)})`).join(' ')}; }`;
const N_RING = 200000, N_SPLASH = 18000, N_PLUME = 4000, N_FRAG = 150;

const RING_COMMON = /* glsl */`
uniform float uT, uTimp, uPhiM0, uMoonW, uMoonA, uRE, uRM, uPxPerUnit, uEarthGlow, uKick;
uniform vec3 uE, uE1, uE2, uAx, uP, uN, uSunDir, uV;
vec3 ringW(float rho, float phi, float z) { return uE + uRE * (rho * cos(phi) * uE1 + rho * sin(phi) * uE2 + z * uAx); }
float earthShadow(vec3 p) {
  vec3 rel = p - uE; float al = dot(rel, uSunDir);
  if (al > 0.0) return 1.0;
  float d = length(rel - uSunDir * al);
  return smoothstep(uRE * 0.92, uRE * 1.06, d);
}
float omegaRing(float a) { return uMoonW * pow(a * uRE / uMoonA, -1.5); }   // a in Earth radii
vec3 sunLit(vec3 p) {
  vec3 l = normalize(p), v = normalize(cameraPosition - p);
  return vec3(1.0, 0.9, 0.78) * (0.25 + 0.75 * hgPhase(dot(l, v), 0.55) * 0.35) * earthShadow(p);
}
`;

export class Debris {
  init(ctx, geom, moon) {
    const { THREE, T, glsl } = ctx;
    this.g = geom; this.moon = moon;
    const rng = T.mulberry32(0xDEB2);
    const common = {
      uT: { value: 0 }, uTimp: { value: T.THEIA_T }, uPhiM0: { value: moon.phi81 - G.MOON_W * G.FINAL.t }, uMoonW: { value: G.MOON_W },
      uMoonA: { value: G.MOON_A }, uRE: { value: G.RE }, uRM: { value: G.RM }, uPxPerUnit: { value: 1000 }, uEarthGlow: { value: 0 }, uKick: { value: 0 },
      uE: { value: new THREE.Vector3(...G.EARTH) }, uE1: { value: new THREE.Vector3(...geom.e1) }, uE2: { value: new THREE.Vector3(...geom.e2) },
      uAx: { value: new THREE.Vector3(...geom.axis) }, uP: { value: new THREE.Vector3(...geom.P) }, uN: { value: new THREE.Vector3(...geom.n) },
      uSunDir: { value: new THREE.Vector3(-1, 0, 0) }, uV: { value: new THREE.Vector3(...geom.v) },
      uFocus: { value: 10 }, uAperture: { value: 0 }, uPxScale: { value: ctx.H / 1080 }, uMaxCoc: { value: 90 },
      uDepth: { value: null }, uNear: { value: 0.01 }, uFar: { value: 1000 },
    };
    this.u = common;
    const mat = (vs) => new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3, uniforms: common, transparent: true, depthTest: false, depthWrite: false,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
      vertexShader: glsl.math + glsl.hash + glsl.color + WORLD + BOKEH_VERT + RING_COMMON + vs, fragmentShader: BOKEH_FRAG,
    });
    const pts = (n, attrs, vs) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      for (const [k, arr] of Object.entries(attrs)) geo.setAttribute(k, new THREE.BufferAttribute(arr, 4));
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
      const p = new THREE.Points(geo, mat(vs));
      p.frustumCulled = false;
      return p;
    };

    // ---------------------------------------------------------------- ring / ejecta
    {
      const a0 = new Float32Array(N_RING * 4), a1 = new Float32Array(N_RING * 4), a2 = new Float32Array(N_RING * 4);
      for (let i = 0; i < N_RING; i++) {
        // final orbit radius (Earth radii): the Roche zone out past the Moon's orbit
        let aR;
        do { aR = 1.4 + 4.9 * Math.pow(rng(), 0.9); } while (rng() > ringlet(aR));   // ringlets
        a0.set([aR, rng() * Math.PI * 2, (rng() * 2 - 1), rng()], i * 4);
        const feed = aR > 3.5;
        const capT = feed ? 76.0 + 3.1 * Math.pow(rng(), 0.9) : 76.2 + 3.6 * rng();
        a1.set([0.35 + 0.9 * rng(), 1.0 + 1.8 * rng(), capT, feed ? 1.0 + 0.9 * rng() : 1.2 + 1.2 * rng()], i * 4);
        a2.set([0.12 + 0.45 * Math.pow(rng(), 2.2), 0.8 + 0.6 * rng(), feed ? 1 : 2, 0.04 + rng() * 0.33], i * 4);
      }
      this.ring = pts(N_RING, { a0, a1, a2 }, /* glsl */`
        in vec4 a0; in vec4 a1; in vec4 a2;
        void main() {
          float aR = a0.x, Phi = a0.y, z0 = a0.z, sd = a0.w;
          float tau = uT - uTimp - a2.w;
          if (tau <= 0.0) { emitPoint(uE, vec3(0.0), 0.0, 1.0, 0.0); return; }
          float Tr = a1.x, Tphi = a1.y, capT = a1.z, capD = a1.w;
          float w = omegaRing(aR);
          // radius: launched fast, overshoots in a plume, settles onto its orbit
          float rho = 1.0 + (aR - 1.0) * (1.0 - exp(-tau / Tr)) + 1.6 * (0.4 + sd) * tau * exp(-tau / 0.55);
          // along the orbit: the jet leaves along the flow, then Keplerian shear spreads it into a ring
          float phi = 0.25 * (1.0 - exp(-tau / 0.3)) + Phi * (1.0 - exp(-tau / Tphi)) + w * tau
                    + (fract(sd * 7.31) - 0.5) * 1.1 * tau * exp(-tau / 0.45);          // early cone of spray
          float z = z0 * (0.85 * exp(-tau / 1.5) + 0.05) * sin(w * tau * 1.3 + sd * 20.0) * (0.6 + 0.4 * aR / 7.0)
                  + (sd - 0.5) * 1.3 * tau * exp(-tau / 0.5);
          float E = a2.x * 0.9 * (1.0 + 0.35 * uKick * (0.5 + 0.5 * sin(sd * 50.0)));
          float heat = exp(-tau / 1.2) * 0.55 + 0.42 * exp(-tau / 9.0) * (0.45 + 1.1 * exp(-(aR - 1.4) / 1.3)) + 0.08 * (fract(sd * 13.7) - 0.5);
          // the Moon gathers the outer ring; the inner ring rains back onto the Earth
          float c = smoothstep(capT, capT + capD, uT);
          vec3 p;
          if (a2.z > 0.5 && a2.z < 1.5) {
            float phiM = uPhiM0 + uMoonW * uT;
            float d = mod(phiM - phi + PI, TAU) - PI;
            float cs = c * c * (3.0 - 2.0 * c);
            float ph2 = phi + d * cs;
            float r2 = mix(rho, uMoonA / uRE, cs);
            p = ringW(r2, ph2, z * (1.0 - cs));
            vec3 mp = ringW(uMoonA / uRE, phiM, 0.0);
            vec3 off = normalize(vec3(sin(sd * 91.0), cos(sd * 53.0), sin(sd * 27.0 + 1.0)));
            p = mix(p, mp + off * uRM * 1.2 * (1.0 - c), smoothstep(0.55, 1.0, c));
            heat += 0.9 * smoothstep(0.35, 0.85, c) * (1.0 - smoothstep(0.9, 1.0, c));    // accretion heats it
            E *= 1.0 - smoothstep(0.93, 1.0, c);
          } else {
            float rf = mix(rho, 1.0, c * c);
            p = ringW(rf, phi, z * (1.0 - c));
            heat += 0.6 * smoothstep(0.7, 1.0, c);
            E *= 1.0 - smoothstep(0.9, 1.0, c);
          }
          E *= 1.0 - smoothstep(80.0, 80.6, uT);
          vec3 col = blackbody(800.0 + 2600.0 * heat) * (0.35 + 2.6 * heat * heat) * 1.5 + sunLit(p) * 0.16
                   + vec3(1.0, 0.45, 0.15) * uEarthGlow * 0.4;
          emitPoint(p, col, E, a2.y, 0.0);
        }`);
    }

    // ---------------------------------------------------------------- the ring's smooth glow
    // Same equations as the particles, integrated: arc coverage grows from the impact point and
    // shears with Ω(ρ); the radial profile settles; the Moon's zone and the inner ring deplete.
    {
      const basis = new THREE.Matrix4().makeBasis(new THREE.Vector3(...geom.e1), new THREE.Vector3(...geom.e2), new THREE.Vector3(...geom.axis));
      const m = new THREE.Mesh(new THREE.RingGeometry(1.2 * G.RE, 6.6 * G.RE, 360, 48), new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3, uniforms: common, transparent: true, depthWrite: false, side: THREE.DoubleSide,
        blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
        vertexShader: /* glsl */`out vec2 vP; out vec3 vW; void main() { vP = position.xy; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
        fragmentShader: glsl.header + glsl.math + glsl.hash + glsl.noise + glsl.color + WORLD + RINGLET_GLSL + RING_COMMON + /* glsl */`
          in vec2 vP; in vec3 vW; out vec4 fragColor;
          void main() {
            float tau = uT - uTimp;
            if (tau <= 0.0) discard;
            float rho = length(vP) / uRE, phi = atan(vP.y, vP.x);
            float w = omegaRing(rho);
            float span = TAU * (1.0 - exp(-tau / 1.9));
            float rel = mod(phi - 0.25 - w * tau, TAU);
            float cover = span > TAU - 0.4 ? 1.0 : smoothstep(span + 0.25, span - 0.35, rel) * smoothstep(-0.05, 0.25, rel);
            float settle = smoothstep(0.6, 3.2, tau);
            float prof = smoothstep(1.35, 1.9, rho) * smoothstep(6.4, 5.0, rho) * clamp(ringlet(rho), 0.0, 1.0);
            float grain = fbm(vec3(rho * 7.0, cos(phi - w * tau) * 3.0, sin(phi - w * tau) * 3.0), 4) * 0.5 + 0.5;
            float feedDep = rho > 3.5 ? 1.0 - smoothstep(76.3, 79.6, uT) : 1.0 - smoothstep(76.4, 80.0, uT);
            float heat = exp(-tau / 1.2) * 0.55 + 0.42 * exp(-tau / 9.0) * (0.45 + 1.1 * exp(-(rho - 1.4) / 1.3));
            vec3 col = blackbody(800.0 + 2600.0 * heat) * (0.35 + 2.6 * heat * heat) * 1.5 + sunLit(vW) * 0.12;
            float I = cover * settle * prof * (0.45 + 0.9 * grain) * feedDep * (1.0 - smoothstep(80.0, 80.6, uT));
            fragColor = vec4(col * I * 0.17, 1.0);
          }`,
      }));
      m.quaternion.setFromRotationMatrix(basis);
      m.position.set(...G.EARTH);
      m.frustumCulled = false; m.renderOrder = 4;
      this.glow = m;
    }

    // ---------------------------------------------------------------- magma splash
    {
      const a0 = new Float32Array(N_SPLASH * 4), a1 = new Float32Array(N_SPLASH * 4);
      for (let i = 0; i < N_SPLASH; i++) {
        // direction: a cone around the forward-tilted normal
        const th = Math.acos(1 - rng() * 0.75), ph = rng() * Math.PI * 2;
        a0.set([th, ph, 0.45 + 2.0 * Math.pow(rng(), 1.6), rng() * 0.12], i * 4);
        a1.set([0.4 + 1.6 * rng() * rng(), 0.9 + 1.4 * rng(), rng(), rng()], i * 4);
      }
      this.splash = pts(N_SPLASH, { a0, a1 }, /* glsl */`
        in vec4 a0; in vec4 a1;
        void main() {
          float tau = uT - uTimp - a0.w;
          if (tau <= 0.0 || tau > 4.5) { emitPoint(uE, vec3(0.0), 0.0, 1.0, 0.0); return; }
          vec3 axis = normalize(uN + uE2 * 0.75);
          vec3 t1 = normalize(cross(axis, uAx)), t2 = cross(axis, t1);
          vec3 dir = axis * cos(a0.x) + (t1 * cos(a0.y) + t2 * sin(a0.y)) * sin(a0.x);
          float sp = a0.z * uRE;                           // world units / s
          float g = 1.35 * uRE;
          vec3 p = uP + dir * sp * tau - uN * 0.5 * g * tau * tau + uE2 * 0.25 * uRE * tau;
          float inside = step(length(p - uE), uRE * 0.995);
          float heat = exp(-tau / (0.7 + 0.8 * a1.z));
          float E = a1.x * 3.0 * (1.0 - inside) * smoothstep(4.5, 3.0, tau);
          vec3 col = blackbody(900.0 + 3200.0 * heat) * (0.2 + 3.0 * heat);
          emitPoint(p, col, E, a1.y, 0.0);
        }`);
    }

    // ---------------------------------------------------------------- vapour plume
    {
      const a0 = new Float32Array(N_PLUME * 4), a1 = new Float32Array(N_PLUME * 4);
      for (let i = 0; i < N_PLUME; i++) {
        const th = Math.acos(1 - rng() * 1.1), ph = rng() * Math.PI * 2;
        a0.set([th, ph, 0.6 + 2.4 * rng(), rng() * 0.15], i * 4);
        a1.set([0.02 + 0.06 * rng() * rng(), 0.3 + 0.9 * rng(), rng(), rng()], i * 4);
      }
      this.plume = pts(N_PLUME, { a0, a1 }, /* glsl */`
        in vec4 a0; in vec4 a1;
        void main() {
          float tau = uT - uTimp - a0.w;
          if (tau <= 0.0 || tau > 5.0) { emitPoint(uE, vec3(0.0), 0.0, 1.0, 0.0); return; }
          vec3 axis = normalize(uN + uE2 * 0.5);
          vec3 t1 = normalize(cross(axis, uAx)), t2 = cross(axis, t1);
          vec3 dir = axis * cos(a0.x) + (t1 * cos(a0.y) + t2 * sin(a0.y)) * sin(a0.x);
          float s = a0.z * uRE * (1.0 - exp(-tau / 0.9)) * 1.3;
          vec3 p = uP + dir * s + uE2 * uRE * 0.6 * (1.0 - exp(-tau / 1.2));
          // the plume is swept along the flow and around the planet
          float size = a1.x * (0.4 + 1.6 * (1.0 - exp(-tau / 0.7)));        // world units
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          float d = max(-mv.z, 0.05);
          float basePx = size * uPxPerUnit / d * 2.0 / uPxScale;           // → 1080p px
          float heat = exp(-tau / 0.8);
          float E = a1.y * 0.035 * basePx * basePx * exp(-tau / (0.7 + 0.8 * a1.z)) * smoothstep(0.0, 0.06, tau);
          vec3 col = blackbody(900.0 + 2400.0 * heat * (0.5 + a1.w)) * (0.25 + 1.1 * heat);
          emitPoint(p, col, E, basePx, 2.0);
        }`);
    }

    // ---------------------------------------------------------------- fragments (meshes)
    this.fragMat = rockMaterial(ctx);
    const fgeo = rockGeometry(THREE, 911, 3, [1, 0.75, 0.6]);
    this.frag = new THREE.InstancedMesh(fgeo, this.fragMat, N_FRAG);
    this.frag.geometry = fgeo.clone();
    this.frag.geometry.setAttribute('aHeat', new THREE.InstancedBufferAttribute(new Float32Array(N_FRAG * 4), 4));
    this.frag.frustumCulled = false;
    const camImp = G.camFrame(T.sampleCamera(T.cameras.IV, T.THEIA_T + 1.2), ctx.W / ctx.H);
    this.frags = [];
    for (let i = 0; i < N_FRAG; i++) {
      const lens = i < 9;              // a few are flung toward the lens: bokeh
      let v;
      if (lens) {
        const aim = G.add(G.add(camImp.pos, G.mul(camImp.x, (rng() - 0.5) * 0.9)), G.mul(camImp.y, (rng() - 0.5) * 0.6));
        const d = G.sub(aim, geom.P);
        v = G.mul(G.norm(d), G.len(d) / (1.6 + 1.6 * rng()));
      } else {
        const axis = G.norm(G.add(geom.n, G.mul(geom.e2, 0.8)));
        const r = G.norm([rng() - 0.5, rng() - 0.5, rng() - 0.5]);
        v = G.mul(G.norm(G.add(axis, G.mul(r, 0.9))), G.RE * (0.5 + 2.2 * rng()));
      }
      this.frags.push({ v, ax: G.norm([rng() - 0.5, rng() - 0.5, rng() - 0.5]), w: 1 + 5 * rng(), s: G.RE * (lens ? 0.05 + 0.05 * rng() : 0.012 + 0.035 * rng() * rng()), lens, d0: rng() * 0.1 });
    }
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._v = new THREE.Vector3(); this._s = new THREE.Vector3(); this._a = new THREE.Vector3();
  }
  sceneObjects() { return [this.frag, this.glow]; }
  fxObjects() { return [this.plume, this.ring, this.splash]; }

  update(ctx, t, camera, P, sceneRT) {
    const u = this.u, T = ctx.T;
    u.uT.value = t;
    u.uFocus.value = P.focus; u.uAperture.value = P.aperture; u.uDepth.value = sceneRT.depthTexture; u.uNear.value = P.near; u.uFar.value = P.far;
    u.uPxPerUnit.value = ctx.H / (2 * Math.tan(camera.fov * Math.PI / 360));
    const E = G.earthPos(t);
    u.uSunDir.value.set(...G.norm(G.mul(E, -1)));
    const on = t > T.THEIA_T - 0.05;
    this.ring.visible = on && t < 80.7; this.glow.visible = on && t < 80.7; this.splash.visible = on && t < T.THEIA_T + 4.6; this.plume.visible = on && t < T.THEIA_T + 5.2;
    // fragments
    const age = t - T.THEIA_T;
    const heat = this.frag.geometry.attributes.aHeat;
    this.frags.forEach((f, i) => {
      const tau = age - f.d0;
      const vis = tau > 0 && tau < (f.lens ? 4.0 : 6.0);
      const drag = f.lens ? tau : 1.6 * (1 - Math.exp(-tau / 1.6));
      const p = vis ? G.add(this.g.P, G.mul(f.v, drag)) : this.g.P;
      this._q.setFromAxisAngle(this._a.set(...f.ax), f.w * Math.max(tau, 0));
      const s = vis ? f.s * (f.lens ? 1 : 1 - G.sstep(4.5, 6, tau)) : 0;
      this._m.compose(this._v.set(...p), this._q, this._s.set(s, s, s));
      this.frag.setMatrixAt(i, this._m);
      heat.setXYZW(i, vis ? Math.exp(-tau / 1.4) : 0, 1.0, i * 0.37, 0.4);
    });
    this.frag.instanceMatrix.needsUpdate = true; heat.needsUpdate = true;
  }
}
