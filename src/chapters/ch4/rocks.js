// Planetesimals (instanced, sunlit rocks on Keplerian orbits), protoplanets in the gaps, and the
// timeline's collisions: every T.collisions {t, x, y} is unprojected through the camera at t onto
// the disk plane, then lives in the Keplerian flow. Two bodies converge, and at exactly t a flash
// fires at that screen position, throwing sparks and hot tumbling fragments.
import * as G from './geom.js';
import { WORLD, BOKEH_VERT, BOKEH_FRAG } from './glsl.js';

// ------------------------------------------------------------------ deterministic JS noise
function h3(x, y, z, s) {
  let n = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 2147483647) + Math.imul(s, 1274126177)) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, y, z, s) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const fx = x - xi, fy = y - yi, fz = z - zi;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
  const L = (a, b, t) => a + (b - a) * t;
  const c = (i, j, k) => h3(xi + i, yi + j, zi + k, s);
  return L(L(L(c(0, 0, 0), c(1, 0, 0), u), L(c(0, 1, 0), c(1, 1, 0), u), v), L(L(c(0, 0, 1), c(1, 0, 1), u), L(c(0, 1, 1), c(1, 1, 1), u), v), w);
}
function fbm3(x, y, z, s, oct = 4) { let a = 0.5, f = 1, t = 0; for (let i = 0; i < oct; i++) { t += a * (vnoise(x * f, y * f, z * f, s + i) - 0.5); a *= 0.5; f *= 2.03; } return t; }

/** A potato-shaped, cratered rock of radius ~1. */
export function rockGeometry(THREE, seed, detail = 3, stretch = [1, 0.8, 0.66]) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const p = g.attributes.position;
  const craters = [];
  const R = (k) => h3(seed, k, 7, 99);
  for (let k = 0; k < 7; k++) {
    const z = R(k * 3) * 2 - 1, a = R(k * 3 + 1) * 6.283, s = Math.sqrt(1 - z * z);
    craters.push([s * Math.cos(a), z, s * Math.sin(a), 0.18 + 0.35 * R(k * 3 + 2)]);
  }
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    let r = 1 + 0.42 * fbm3(x * 1.1, y * 1.1, z * 1.1, seed, 3) + 0.12 * fbm3(x * 3.7, y * 3.7, z * 3.7, seed + 17, 3);
    for (const [cx, cy, cz, cr] of craters) {
      const d = Math.acos(Math.max(-1, Math.min(1, x * cx + y * cy + z * cz))) / cr;
      if (d < 1.4) r += d < 1 ? -0.09 * cr * (1 - d * d) : 0.05 * cr * (1.4 - d) / 0.4 * (d - 1) / 0.4;
    }
    p.setXYZ(i, x * r * stretch[0], y * r * stretch[1], z * r * stretch[2]);
  }
  g.computeVertexNormals();
  return g;
}

export function rockMaterial(ctx) {
  const { THREE, glsl } = ctx;
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: { uSunE: { value: 125 }, uEarth: { value: new THREE.Vector3(...G.EARTH) }, uEarthGlow: { value: 0 }, uT: { value: 0 } },
    vertexShader: /* glsl */`
      in vec4 aHeat;           // heat, albedo, seed, -
      out vec3 vN; out vec3 vW; out vec3 vO; out vec4 vH;
      void main() {
        mat4 m = modelMatrix * instanceMatrix;
        vec4 w = m * vec4(position, 1.0);
        vW = w.xyz; vN = normalize(mat3(m) * normal); vO = position; vH = aHeat;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: glsl.header + glsl.math + glsl.hash + glsl.noise + glsl.color + /* glsl */`
      in vec3 vN; in vec3 vW; in vec3 vO; in vec4 vH; out vec4 fragColor;
      uniform float uSunE, uEarthGlow, uT; uniform vec3 uEarth;
      void main() {
        vec3 q = vO * 3.0 + vH.z * 17.0;
        vec3 n = normalize(normalize(vN) + 0.28 * vec3(snoise(q * 2.0), snoise(q * 2.0 + 7.1), snoise(q * 2.0 - 3.3)));
        vec3 L = normalize(-vW);
        float r = length(vW);
        float E = uSunE * pow(max(r, 0.9), -1.4);
        float ndl = max(dot(n, L), 0.0);
        float grit = 0.65 + 0.55 * (fbm(q, 4) * 0.5 + 0.5);
        vec3 alb = mix(vec3(0.1, 0.085, 0.07), vec3(0.14, 0.115, 0.095), vH.w) * vH.y * grit;
        vec3 V = normalize(cameraPosition - vW);
        float rim = pow(1.0 - max(dot(n, V), 0.0), 3.0);
        vec3 col = alb * (E * ndl * vec3(1.0, 0.88, 0.72) + 0.012 + 0.05 * rim * E * 0.02);
        // hot fragments: glowing cracks that cool
        float heat = vH.x;
        if (heat > 0.001) {
          // dark crust with glowing fissures; the fissures narrow as the rock cools
          float w = mix(0.03, 0.22, heat);
          float cr = 1.0 - smoothstep(0.0, w, abs(snoise(q * 1.4)));
          float cr2 = 1.0 - smoothstep(0.0, w * 0.6, abs(snoise(q * 3.3 + 5.0)));
          float K = 900.0 + 2600.0 * heat;
          col += blackbody(K) * (heat * 4.0 * max(cr, cr2 * 0.7) + heat * heat * 0.25);
        }
        // light from the hot proto-Earth after the impact
        vec3 le = uEarth - vW; float de = length(le);
        col += alb * uEarthGlow * max(dot(n, le / de), 0.0) / (de * de + 0.05) * vec3(1.0, 0.45, 0.15);
        fragColor = vec4(col, 1.0);
      }`,
  });
}

// ------------------------------------------------------------------ fx points (CPU-driven)
export class FxPoints {
  constructor(ctx, max) {
    const { THREE } = ctx;
    this.max = max; this.n = 0;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 3); this.prm = new Float32Array(max * 3);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aCol', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aPrm', new THREE.BufferAttribute(this.prm, 3).setUsage(THREE.DynamicDrawUsage));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
    this.geo = g;
    this.u = { uFocus: { value: 10 }, uAperture: { value: 0 }, uPxScale: { value: ctx.H / 1080 }, uMaxCoc: { value: 90 },
      uDepth: { value: null }, uNear: { value: 0.01 }, uFar: { value: 1000 } };
    this.points = new THREE.Points(g, new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3, uniforms: this.u, transparent: true, depthTest: false, depthWrite: false,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
      vertexShader: BOKEH_VERT + /* glsl */`
        in vec3 aCol; in vec3 aPrm;      // energy, base diameter, kind
        void main() { emitPoint(position, aCol, aPrm.x, aPrm.y, aPrm.z); }`,
      fragmentShader: BOKEH_FRAG,
    }));
    this.points.frustumCulled = false;
  }
  begin() { this.n = 0; }
  add(p, c, E, base, kind = 0) {
    if (this.n >= this.max || !(E > 0)) return;
    const i = this.n++;
    this.pos.set(p, i * 3); this.col.set(c, i * 3); this.prm[i * 3] = E; this.prm[i * 3 + 1] = base; this.prm[i * 3 + 2] = kind;
  }
  end(P, depthTex) {
    this.geo.setDrawRange(0, this.n);
    for (const k of ['position', 'aCol', 'aPrm']) this.geo.attributes[k].needsUpdate = true;
    this.u.uFocus.value = P.focus; this.u.uAperture.value = P.aperture; this.u.uDepth.value = depthTex;
    this.u.uNear.value = P.near; this.u.uFar.value = P.far;
  }
}

/** Blackbody-ish tint (linear) for a temperature in K, JS side. */
export function bbJS(K) {
  const t = Math.min(1, Math.max(0, (K - 1000) / 6000));
  return [1.0, Math.min(1, 0.18 + 0.9 * t), Math.min(1, 0.02 + 0.95 * t * t)];
}

// ------------------------------------------------------------------ the rocks
const N_FIELD = 1200, FRAGS = 10, SPARKS = 36;

export class Rocks {
  init(ctx, geom) {
    const { THREE, T, W, H } = ctx;
    const rng = T.mulberry32(0xB0CC);
    this.mat = rockMaterial(ctx);
    // --- field
    this.field = [];
    for (let i = 0; i < N_FIELD; i++) {
      let r;
      if (i < 110) {                 // the neighbourhood of the proto-Earth's orbit (the fly-in)
        do { r = 8.3 + 3.4 * rng(); } while (Math.abs(r - G.RE_ORB) < 0.45 && rng() < 0.85);
      } else r = 1.8 + 30 * Math.pow(rng(), 1.3);
      const u = rng();
      const s = i < 110 ? 0.003 * Math.exp(2.3 * u * u) : 0.006 * Math.exp(2.0 * u);
      const ax = G.norm([rng() - 0.5, rng() - 0.5, rng() - 0.5]);
      this.field.push({ r, th0: rng() * Math.PI * 2, y: (rng() * 2 - 1) * 0.022 * Math.pow(r, 1.22) * 0.8, s,
        ax, w: 0.2 + 1.3 * rng(), a0: rng() * 6.28, alb: 0.7 + 0.6 * rng(), tint: rng(), geo: i % 3 });
    }
    const geos = [0, 1, 2].map((k) => rockGeometry(THREE, 11 + k * 5, 3, [[1, 0.8, 0.66], [1, 0.9, 0.85], [1, 0.62, 0.55]][k]));
    this.meshes = geos.map((g, k) => {
      const n = this.field.filter((f) => f.geo === k).length;
      const m = new THREE.InstancedMesh(g, this.mat, n);
      const heat = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
      m.geometry = g.clone(); m.geometry.setAttribute('aHeat', heat);
      m.frustumCulled = false;
      return m;
    });
    this.field.forEach((f) => { f.idx = this.meshes[f.geo].userData.k = (this.meshes[f.geo].userData.k ?? -1) + 1; });
    for (const f of this.field) { const a = this.meshes[f.geo].geometry.attributes.aHeat; a.setXYZW(f.idx, 0, f.alb, f.tint * 7.3, f.tint); }
    // --- protoplanets (in the gaps)
    const pgeo = rockGeometry(THREE, 77, 5, [1, 0.97, 0.95]);
    this.protoMesh = new THREE.InstancedMesh(pgeo, this.mat, G.PROTOPLANETS.length);
    this.protoMesh.geometry = pgeo.clone();
    this.protoMesh.geometry.setAttribute('aHeat', new THREE.InstancedBufferAttribute(new Float32Array(G.PROTOPLANETS.length * 4).map((_, i) => [0.0, 1.2, i * 3.1, 0.5][i % 4]), 4));
    this.protoMesh.frustumCulled = false;

    // --- collisions: unproject each event through the camera at its time
    const aspect = W / H;
    this.coll = T.collisions.filter((c) => c.t > 57 && c.t < 83).map((c, i) => {
      const f = G.camFrame(T.sampleCamera(T.cameras.IV, c.t), aspect);
      const d = G.rayDir(f, c.x, c.y);
      let dist = Math.abs(d[1]) > 1e-4 ? -f.pos[1] / d[1] : -1;
      const camToEarth = G.len(G.sub(G.earthPos(c.t), f.pos));
      const maxD = Math.max(3.0, Math.min(60, camToEarth * 1.6));
      if (!(dist > 0.6) || dist > maxD) dist = Math.min(maxD, Math.max(1.2, 0.55 * camToEarth));
      const P = G.add(f.pos, G.mul(d, dist));
      const r = Math.hypot(P[0], P[2]);
      const thW = Math.atan2(P[2], P[0]) + G.psi(c.t);
      const R = T.mulberry32(0xC011 + i * 97);
      const flat = (v) => G.norm([v[0], v[1] * 0.35, v[2]]);
      const dA = flat([R() - 0.5, R() - 0.5, R() - 0.5]);
      const dB = G.norm(G.add(G.mul(dA, -1), G.mul(flat([R() - 0.5, R() - 0.5, R() - 0.5]), 0.7)));
      const scale = Math.min(Math.max(dist, 0.8), 60);
      const size = Math.min(0.045, Math.max(0.006, 0.004 * scale));
      const frags = [], sparks = [];
      for (let k = 0; k < FRAGS; k++) frags.push({ v: G.mul(G.norm([R() - 0.5, (R() - 0.5) * 0.6, R() - 0.5]), (0.25 + R()) * 0.03 * scale),
        ax: G.norm([R() - 0.5, R() - 0.5, R() - 0.5]), w: 2 + 5 * R(), s: size * (0.2 + 0.35 * R()), a0: R() * 6.28 });
      for (let k = 0; k < SPARKS; k++) sparks.push({ v: G.mul(G.norm([R() - 0.5, (R() - 0.5) * 0.5, R() - 0.5]), (0.3 + 2.2 * R() * R()) * 0.045 * scale),
        life: 0.35 + 1.1 * R(), K: 4200 + 3000 * R(), b: 0.5 + R() });
      return { t: c.t, x: c.x, y: c.y, r, thW, yW: P[1], P0: P, dA, dB, vr: 0.05 * scale, size, dist: scale, frags, sparks };
    });
    const cgeo = rockGeometry(THREE, 303, 3, [1, 0.85, 0.75]);
    const nC = this.coll.length * (2 + FRAGS);
    this.collMesh = new THREE.InstancedMesh(cgeo, this.mat, nC);
    this.collMesh.geometry = cgeo.clone();
    this.collMesh.geometry.setAttribute('aHeat', new THREE.InstancedBufferAttribute(new Float32Array(nC * 4), 4));
    this.collMesh.frustumCulled = false;
    this.fx = new FxPoints(ctx, this.coll.length * (SPARKS + 1) + G.PROTOPLANETS.length + 8);

    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._v = new THREE.Vector3(); this._s = new THREE.Vector3(); this._a = new THREE.Vector3();
  }
  sceneObjects() { return [...this.meshes, this.protoMesh, this.collMesh]; }
  fxObjects() { return [this.fx.points]; }

  /** Key-space position at t of a point that was at (r, world angle thW, y) at time t0. */
  flowPos(r, thW, y, t0, t) {
    const a = thW + G.omega(r) * (t - t0) - G.psi(t);
    return [r * Math.cos(a), y, r * Math.sin(a)];
  }
  setInst(mesh, i, p, ax, ang, s) {
    this._q.setFromAxisAngle(this._a.set(ax[0], ax[1], ax[2]), ang);
    this._m.compose(this._v.set(p[0], p[1], p[2]), this._q, this._s.set(s, s, s));
    mesh.setMatrixAt(i, this._m);
  }

  update(ctx, t, camera, P, sceneRT) {
    this.mat.uniforms.uT.value = t;
    // field
    const psi = G.psi(t);
    const clear = 1 - G.sstep(77.2, 80.2, t);          // the neighbourhood is swept clean before the hand-off
    const E = G.earthPos(t);
    const TP = this.theiaPos ? this.theiaPos(t) : [1e9, 0, 0];
    for (const f of this.field) {
      const a = f.th0 + G.omega(f.r) * (t - G.T0) - psi;
      const p = [f.r * Math.cos(a), f.y * Math.cos(a * 3 + f.a0), f.r * Math.sin(a)];
      const dE = Math.hypot(p[0] - E[0], p[1] - E[1], p[2] - E[2]);
      const dT = Math.hypot(p[0] - TP[0], p[1] - TP[1], p[2] - TP[2]);
      // the proto-Earth has swept its surroundings clear; the impact sweeps up most of the rest
      const keep = G.sstep(0.6, 1.6, dE) * G.sstep(0.15, 0.45, dT) * (f.tint < 0.35 ? 1 : 1 - G.sstep(69.4 + f.tint * 2, 70.4 + f.tint * 2, t));
      this.setInst(this.meshes[f.geo], f.idx, p, f.ax, f.a0 + f.w * t, f.s * clear * keep);
    }
    for (const m of this.meshes) m.instanceMatrix.needsUpdate = true;
    this.fx.begin();
    G.PROTOPLANETS.forEach(([r, th0, s], i) => {
      const a = th0 + G.omega(r) * (t - G.T0) - psi;
      const p = [r * Math.cos(a), 0, r * Math.sin(a)];
      this.setInst(this.protoMesh, i, p, [0, 1, 0], t * 0.3 + i, s);
      // accreting protoplanets glow faintly inside their gaps (visible in the wide shot)
      const dc = Math.max(0.5, camera.position.distanceTo(this._v.set(p[0], p[1], p[2])));
      this.fx.add(p, [1.0, 0.62, 0.3], (60 + 400 * s) * Math.min(1, 30 / dc) * (1 - G.sstep(64, 67, t)), 3, 1);
    });
    this.protoMesh.instanceMatrix.needsUpdate = true;
    // collisions
    const cm = this.collMesh, heat = cm.geometry.attributes.aHeat;
    let k = 0;
    for (const c of this.coll) {
      const tau = t - c.t;
      const Pc = this.flowPos(c.r, c.thW, c.yW, c.t, t);
      const pre = tau < 0 && tau > -2.6;
      for (const [dir, s0] of [[c.dA, 1.0], [c.dB, 0.8]]) {
        const s = pre ? c.size * s0 : 0;
        const off = (c.vr * Math.max(0, -tau) + c.size * s0);
        this.setInst(cm, k, G.add(Pc, G.mul(dir, off)), [0.3, 0.8, 0.5], t * 0.7 + s0 * 3, s);
        heat.setXYZW(k, pre ? Math.max(0, 1 + tau / 0.25) * 0.6 : 0, 1.0, s0 * 5, 0.3);
        k++;
      }
      for (const f of c.frags) {
        const on = tau >= 0 && tau < 7;
        const drag = 1 - Math.exp(-Math.max(tau, 0) / 2.5);
        const p = G.add(Pc, G.mul(f.v, drag * 2.5));
        const fade = on ? 1 - G.sstep(5.5, 7, tau) : 0;
        this.setInst(cm, k, p, f.ax, f.a0 + f.w * Math.max(tau, 0), f.s * fade);
        heat.setXYZW(k, on ? Math.exp(-tau / 0.9) : 0, 0.9, f.a0, 0.5);
        k++;
      }
      if (tau >= -0.001 && tau < 3) {
        const dc = Math.max(0.3, camera.position.distanceTo(this._v.set(Pc[0], Pc[1], Pc[2])));
        const loud = Math.pow(12 / dc, 0.45);
        const I = 20000 * Math.exp(-tau / 0.07) + 2400 * Math.exp(-tau / 0.35) + 300 * Math.exp(-tau / 1.2);
        this.fx.add(Pc, [1.0, 0.85, 0.62], I * loud, 64 * (0.7 + 0.5 * Math.exp(-tau / 0.4)), 1);
        for (const sp of c.sparks) {
          if (tau > sp.life * 2) continue;
          const drag = 1 - Math.exp(-tau / 0.9);
          const p = G.add(Pc, G.mul(sp.v, drag * 0.9));
          const cool = Math.exp(-tau / sp.life);
          const col = bbJS(1200 + (sp.K - 1200) * cool);
          this.fx.add(p, col, 260 * sp.b * cool * cool * loud, 1.6, 0);
        }
      }
    }
    cm.instanceMatrix.needsUpdate = true; heat.needsUpdate = true;
    this.fx.end(P, sceneRT.depthTexture);
  }
}
