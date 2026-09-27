// VI · LIFE: fish ↔ bird. One instanced mesh whose every vertex has a fish position and a bird
// position (same topology), so crossing the waterline is a true silhouette morph: the pectoral
// fins stretch into wings, the vertical tail fork rotates into a horizontal fan, the laterally
// compressed body rounds out. Plus breach splashes (ballistic droplets, stateless given breaches).
import { THREE } from '../../engine/gl.js';
import { GL_UNIFORMS, GL_WATER, GL_FRESNEL } from './common.js';
import { GL_LIT_AIR } from './air.js';

function creatureGeometry() {
  const pF = [], pB = [], nF = [], nB = [], part = [], idx = [];
  const NR = 10, NS = 8;
  const push = (f, b, fn, bn, k) => { pF.push(...f); pB.push(...b); nF.push(...fn); nB.push(...bn); part.push(...k); return pF.length / 3 - 1; };
  // body rings (x forward): fish tall and thin, bird round and short
  const ring = [];
  for (let i = 0; i <= NR; i++) {
    const x = -0.5 + i / NR;
    const fx = Math.max(0, 1 - Math.pow((x - 0.08) / 0.59, 2));
    const bx = Math.max(0, 1 - Math.pow((x - 0.02) / 0.52, 2));
    const hF = 0.13 * Math.pow(fx, 0.62), wF = 0.05 * Math.pow(fx, 0.7);
    const hB = 0.075 * Math.pow(bx, 0.6), wB = 0.08 * Math.pow(bx, 0.6);
    const row = [];
    for (let j = 0; j < NS; j++) {
      const a = j / NS * Math.PI * 2;
      const c = Math.cos(a), s = Math.sin(a);
      row.push(push([x, c * hF, s * wF], [x * 0.85, c * hB, s * wB], [0, c / Math.max(hF, 1e-3), s / Math.max(wF, 1e-3)], [0, c, s], [0, x, 0]));
    }
    ring.push(row);
  }
  for (let i = 0; i < NR; i++) for (let j = 0; j < NS; j++) {
    const a = ring[i][j], b = ring[i][(j + 1) % NS], c = ring[i + 1][j], d = ring[i + 1][(j + 1) % NS];
    idx.push(a, c, b, b, c, d);
  }
  // fins → wings (both sides). part = [1, span 0..1, side]
  for (const side of [-1, 1]) {
    const pts = [
      // [fish xyz], [bird xyz], span
      [[0.20, -0.02, 0.04], [0.16, 0.0, 0.05], 0],
      [[0.10, -0.03, 0.04], [-0.12, 0.0, 0.05], 0],
      [[0.10, -0.06, 0.13], [0.14, 0.02, 0.55], 0.55],
      [[0.03, -0.07, 0.12], [-0.20, 0.02, 0.52], 0.55],
      [[0.00, -0.09, 0.19], [-0.14, 0.0, 1.05], 1.0],
    ];
    const ids = pts.map(([f, b, sp]) => push([f[0], f[1], f[2] * side], [b[0], b[1], b[2] * side], [0, 1, 0], [0, 1, 0], [1, sp, side]));
    idx.push(ids[0], ids[2], ids[1], ids[1], ids[2], ids[3], ids[2], ids[4], ids[3]);
  }
  // tail: vertical fork (fish) → horizontal fan (bird)
  const tail = [
    [[-0.42, 0, 0], [-0.40, 0, 0]],
    [[-0.74, 0.17, 0], [-0.66, 0, 0.13]],
    [[-0.62, 0, 0], [-0.58, 0, 0]],
    [[-0.74, -0.17, 0], [-0.66, 0, -0.13]],
  ].map(([f, b]) => push(f, b, [0, 0, 1], [0, 1, 0], [2, 0, 0]));
  idx.push(tail[0], tail[1], tail[2], tail[0], tail[2], tail[3]);
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pF, 3));
  g.setAttribute('pB', new THREE.Float32BufferAttribute(pB, 3));
  g.setAttribute('nF', new THREE.Float32BufferAttribute(nF, 3));
  g.setAttribute('nB', new THREE.Float32BufferAttribute(nB, 3));
  g.setAttribute('part', new THREE.Float32BufferAttribute(part, 3));
  g.setIndex(idx);
  return g;
}

const VS = /* glsl */`
in vec3 position; in vec3 pB; in vec3 nF; in vec3 nB; in vec3 part;
in vec4 iP; in vec4 iV; in vec4 iX;
uniform mat4 viewMatrix, projectionMatrix;
out vec3 vP; out vec3 vN; out float vM; out float vX; out float vPart; out vec3 vL; out float vTr;
void main() {
  float m = iP.w;                               // 0 fish … 1 bird
  vec3 p = mix(position, pB, m);
  vec3 n = normalize(mix(normalize(nF), nB, m));
  float ph = iV.w;
  // swimming: a travelling wave down the body, strongest at the tail
  float sw = sin(ph - p.x * 7.0) * 0.07 * (0.55 - p.x) * (1.0 - m);
  p.z += sw;
  // flapping: wings rotate about the body axis, the tip lagging
  if (part.x > 0.5 && part.x < 1.5) {
    float fl = sin(ph * 0.55 - part.y * 0.8) * mix(0.25, 0.9, m) * part.y;
    p.y += fl * abs(p.z) * 0.9;
    n = normalize(n + vec3(0.0, 0.0, -part.z * fl * 0.5));
  }
  float sc = iX.x;
  vec3 f = normalize(iV.xyz);
  vec3 r = normalize(cross(f, vec3(0.0, 1.0, 0.0)) + vec3(1e-4, 0.0, 0.0));
  vec3 u = cross(r, f);
  float bank = iX.y;
  vec3 r2 = r * cos(bank) + u * sin(bank), u2 = u * cos(bank) - r * sin(bank);
  vec3 w = iP.xyz + (f * p.x + u2 * p.y + r2 * p.z) * sc;
  vP = w; vN = normalize(f * n.x + u2 * n.y + r2 * n.z); vM = m; vX = p.x; vPart = part.x; vL = p; vTr = iX.z;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}`;

export function makeCreatures(ctx, G, n) {
  const { glsl } = ctx;
  const geo = creatureGeometry();
  const iP = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
  const iV = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
  const iX = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
  for (const a of [iP, iV, iX]) a.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('iP', iP); geo.setAttribute('iV', iV); geo.setAttribute('iX', iX);
  geo.instanceCount = n;

  const fishMat = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3, uniforms: { ...G }, side: THREE.DoubleSide,
    vertexShader: glsl.header + VS,
    fragmentShader: glsl.header + GL_UNIFORMS + GL_WATER + GL_FRESNEL + /* glsl */`
    in vec3 vP; in vec3 vN; in float vM; in float vX; in float vPart; in vec3 vL; in float vTr; out vec4 fragColor;
    void main() {
      if (vP.y > 0.0) discard;
      vec3 v = normalize(vP - uCamPos);
      vec3 n = normalize(vN);
      if (dot(n, v) > 0.0) n = -n;
      vec3 rf = reflect(v, n);
      float up = n.y;
      // mirror-silver flanks reflecting the water light field, dark blue-green back
      vec3 env = waterInscatter(rf) * 3.2 + uUnder * 0.6;
      float F = fresnelSchlick(max(dot(-v, n), 0.0), 0.35);
      vec3 silver = env * F * vec3(0.9, 1.0, 1.02);
      vec3 back = vec3(0.010, 0.028, 0.045);
      // countershading in the fish's own frame: dark blue-green back, silver flank, white belly
      float ly = vL.y;
      vec3 c = mix(silver * 1.1 + vec3(0.02, 0.03, 0.03), back + silver * 0.15, smoothstep(0.015, 0.06, ly));
      c = mix(c, silver * 1.4 + vec3(0.06, 0.08, 0.08), (1.0 - smoothstep(-0.08, -0.03, ly)));
      c += silver * 0.9 * exp(-pow((ly - 0.008) / 0.01, 2.0)) * step(-0.35, vX);      // lateral line
      c *= 0.85 + 0.3 * vTr;
      // the school's flash: flanks turning into the sun
      float dep = max(-vP.y, 0.0);
      vec3 att = exp(-vec3(0.42, 0.155, 0.125) * dep / max(uSunW.y, 0.25));
      float gl = pow(max(dot(rf, uSunW), 0.0), 14.0);
      c += uSunCol * att * gl * (1.2 + 3.0 * causticAt(vP)) * (1.0 - smoothstep(0.5, 0.9, up));
      c *= vPart > 1.5 ? 0.6 : 1.0;
      fragColor = vec4(c, distance(vP, uCamPos));
    }`,
  });
  const birdMat = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3, uniforms: { ...G }, side: THREE.DoubleSide,
    vertexShader: glsl.header + VS,
    fragmentShader: glsl.header + GL_UNIFORMS + GL_LIT_AIR + GL_WATER + GL_FRESNEL + /* glsl */`
    in vec3 vP; in vec3 vN; in float vM; in float vX; in float vPart; in vec3 vL; in float vTr; out vec4 fragColor;
    void main() {
      if (vP.y < 0.0) discard;
      vec3 v = normalize(vP - uCamPos);
      vec3 n = normalize(vN);
      if (dot(n, v) > 0.0) n = -n;
      // still-silver fish body just out of the water → dark bird silhouette
      vec3 skyRefl = mix(uSkyHor, uSkyZen, 0.5 + 0.5 * reflect(v, n).y);
      vec3 silver = skyRefl * fresnelSchlick(max(dot(-v, n), 0.0), 0.4) * 1.4 + uSunCol * pow(max(dot(reflect(v, n), uSunDir), 0.0), 20.0) * 2.0;
      vec3 bird = litAir(vP, n, vec3(0.022, 0.019, 0.017), 0.45, 0.6);
      float rim = pow(1.0 - abs(dot(n, v)), 6.0) * pow(max(dot(v, uSunDir), 0.0), 8.0);
      bird += uSunCol * rim * 0.05 * (1.0 - uDusk);
      vec3 c = mix(silver, bird, smoothstep(0.15, 0.8, vM));
      fragColor = vec4(c * (1.0 - uDusk * 0.9), distance(vP, uCamPos));
    }`,
  });
  const fish = new THREE.Mesh(geo, fishMat);
  const birds = new THREE.Mesh(geo, birdMat);
  fish.frustumCulled = birds.frustumCulled = false;

  // ---- breach splashes ----
  const ND = 3;
  const dropGeo = new THREE.InstancedBufferGeometry();
  const q = new THREE.PlaneGeometry(1, 1);
  dropGeo.setAttribute('position', q.attributes.position);
  dropGeo.setAttribute('uv', q.attributes.uv);
  dropGeo.setIndex(q.index);
  const dA = new THREE.InstancedBufferAttribute(new Float32Array(n * ND * 4), 4);
  const dB = new THREE.InstancedBufferAttribute(new Float32Array(n * ND * 4), 4);
  dA.setUsage(THREE.DynamicDrawUsage); dB.setUsage(THREE.DynamicDrawUsage);
  dropGeo.setAttribute('dA', dA); dropGeo.setAttribute('dB', dB);
  dropGeo.instanceCount = 0;
  const dropMat = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3, uniforms: { ...G }, transparent: false,
    vertexShader: glsl.header + GL_UNIFORMS + /* glsl */`
    in vec3 position; in vec2 uv; in vec4 dA; in vec4 dB;
    uniform mat4 viewMatrix, projectionMatrix;
    out vec2 vUv; out float vA; out vec3 vP;
    void main() {
      float age = uT - dA.w;
      vec3 v0 = dB.xyz;
      vec3 p = dA.xyz + v0 * age + vec3(0.0, -4.9, 0.0) * age * age;
      vec3 vel = v0 + vec3(0.0, -9.8, 0.0) * age;
      if (age < 0.0 || age > 1.4 || p.y < -0.01) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
      vec3 fw = normalize(p - uCamPos);
      vec3 side = normalize(cross(fw, normalize(vel + vec3(0.0, 1e-3, 0.0))));
      vec3 along = normalize(vel);
      float len = dB.w * 1.5 + length(vel) * 0.012;
      vec3 w = p + side * position.x * dB.w + along * position.y * len;
      vUv = uv; vA = 1.0 - age / 1.4; vP = w;
      gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
    }`,
    fragmentShader: glsl.header + GL_UNIFORMS + /* glsl */`
    in vec2 vUv; in float vA; in vec3 vP; out vec4 fragColor;
    void main() {
      float d = length((vUv - 0.5) * 2.0);
      if (d > 1.0) discard;
      vec3 c = (uSkyHor * 0.3 + uSunCol * 0.22) * exp(-d * d * 3.0) * vA * 1.2;
      fragColor = vec4(c, distance(vP, uCamPos));
    }`,
  });
  const drops = new THREE.Mesh(dropGeo, dropMat);
  drops.frustumCulled = false;
  let dropCount = -1;

  return {
    fish, birds, drops,
    /** Push the boid state at t into the instance buffers. */
    update(boids, f, t) {
      const { P, P0, V, air, breachT, trait } = boids;
      const a = iP.array, b = iV.array, c = iX.array;
      for (let i = 0; i < boids.n; i++) {
        const x = P0[i * 3] + (P[i * 3] - P0[i * 3]) * f, y = P0[i * 3 + 1] + (P[i * 3 + 1] - P0[i * 3 + 1]) * f, z = P0[i * 3 + 2] + (P[i * 3 + 2] - P0[i * 3 + 2]) * f;
        // morph as the body crosses the waterline (and a little after, in the air)
        const m = air[i] ? Math.min(1, Math.max(0, (t - breachT[i]) / 0.22)) * Math.min(1, Math.max(0, (y + 0.02) / 0.25)) : 0;
        const mm = m * m * (3 - 2 * m);
        a[i * 4] = x; a[i * 4 + 1] = y; a[i * 4 + 2] = z; a[i * 4 + 3] = mm;
        const vx = V[i * 3], vy = V[i * 3 + 1], vz = V[i * 3 + 2];
        b[i * 4] = vx; b[i * 4 + 1] = vy; b[i * 4 + 2] = vz;
        const sp = Math.hypot(vx, vy, vz);
        b[i * 4 + 3] = t * (air[i] ? 22 : 16) * (0.85 + 0.3 * trait[i]) + trait[i] * 30;
        c[i * 4] = (0.085 + 0.2 * mm) * (0.85 + 0.3 * trait[i]);
        c[i * 4 + 1] = air[i] ? Math.sin(t * 1.3 + trait[i] * 9) * 0.35 : 0;
        c[i * 4 + 2] = trait[i]; c[i * 4 + 3] = sp;
      }
      iP.needsUpdate = iV.needsUpdate = iX.needsUpdate = true;
      const br = boids.breaches;
      if (br.length !== dropCount) {
        dropCount = br.length;
        const A = dA.array, B = dB.array;
        let k = 0;
        for (const e of br) {
          for (let j = 0; j < ND; j++) {
            const h = (s) => { const x = Math.sin((e.i * 97.13 + j * 13.7 + s) * 12.9898) * 43758.5453; return x - Math.floor(x); };
            A.set([e.x + (h(1) - 0.5) * 0.05, 0.005, e.z + (h(2) - 0.5) * 0.05, e.t + h(3) * 0.05], k * 4);
            B.set([e.vx * 0.3 + (h(4) - 0.5) * 1.0, 0.9 + 2.0 * h(5), e.vz * 0.3 + (h(6) - 0.5) * 1.0, 0.0025 + 0.004 * h(7)], k * 4);
            k++;
          }
        }
        dropGeo.instanceCount = k;
        dA.needsUpdate = dB.needsUpdate = true;
      }
    },
  };
}
