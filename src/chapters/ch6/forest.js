// VI · LIFE: the L-system forest. Trees are derived once at init; growth is a pure function of t:
// each tree has a growth front advancing along arc length from the root, so every branch
// appears after its parent, thickens as its subtree grows (pipe model), and every leaf cluster
// is born when the front reaches it (or, if a flush claims it, on that marimba note).
import { THREE } from '../../engine/gl.js';
import { SPECIES, derive, interpret } from './lsystem.js';
import { heightAt, coastR, ORIGIN, fbm2 } from './terrain.js';
import { DEG } from './layout.js';
import { GL_UNIFORMS } from './common.js';
import { GL_LIT_AIR } from './air.js';
import { GL_SHADOW } from './shadow.js';

// Growth: the branching front runs ahead (a small, already-branched sapling appears early) while
// the whole plant scales up around its base, like a real sapling filling out.
const EASE_P = 2.4, SC0 = 0.28, SC_P = 0.85;
const u01 = (tr, t) => Math.min(1, Math.max(0, (t - tr.t0) / tr.dur));
export const frontAt = (tr, t) => tr.sTot * (1 - Math.pow(1 - u01(tr, t), EASE_P));
export const scaleAt = (tr, t) => SC0 + (1 - SC0) * Math.pow(u01(tr, t), SC_P);
export const readyTime = (tr, s) => tr.t0 + tr.dur * (1 - Math.pow(Math.max(0, 1 - s / tr.sTot), 1 / EASE_P));
/** World position of a (fully grown) point of tree tr at time t. */
export const grownPos = (tr, p, t) => { const k = scaleAt(tr, t); return [tr.pos[0] + (p[0] - tr.pos[0]) * k, tr.pos[1] + (p[1] - tr.pos[1]) * k, tr.pos[2] + (p[2] - tr.pos[2]) * k]; };

function placeTrees(R) {
  const trees = [];
  const at = (az, land) => { const r = coastR(az * DEG) + land; const x = ORIGIN[0] + Math.sin(az * DEG) * r, z = ORIGIN[2] - Math.cos(az * DEG) * r; return [x, heightAt(x, z) - 0.05, z]; };
  const add = (o) => { trees.push(o); return o; };
  // heroes: A (bar 45 motif) is a fast sapling near the water; B (bar 47 motif) the big tree
  add({ sp: 'broadleaf', pos: at(-13, 2.6), h: 5.2, t0: 112.2, dur: 2.9, seed: 11, hero: 'A', iters: 6 });
  add({ sp: 'broadleaf', pos: at(9, 7.0), h: 10.5, t0: 114.0, dur: 6.0, seed: 23, hero: 'B', iters: 6 });
  // fixed dressing: archaeopteris stands left, a headland grove right (late flushes live here)
  const fixed = [
    ['archaeopteris', -31, 5, 9.5], ['archaeopteris', -24, 12, 11.5], ['archaeopteris', -38, 16, 8.5], ['archaeopteris', -18, 22, 12],
    ['broadleaf', -3, 16, 8.0], ['archaeopteris', 2, 26, 12.5], ['broadleaf', 18, 5, 7.0], ['archaeopteris', 24, 6, 9.5],
    ['broadleaf', 29, 9, 8.5], ['archaeopteris', 33, 12, 10.5], ['broadleaf', 37, 10, 7.5], ['archaeopteris', 39.5, 16, 9.0],
    ['broadleaf', 31, 22, 9.0], ['broadleaf', -45, 7, 7.5],
  ];
  for (const [sp, az, land, h] of fixed) {
    add({ sp, pos: at(az + (R() - 0.5) * 2, land), h: h * (0.9 + 0.2 * R()), t0: 114.0 + land * 0.13 + R() * 1.2, dur: 4.5 + h * 0.25, seed: Math.floor(R() * 1e6), iters: SPECIES[sp].iterations });
  }
  // far forest: smaller derivations
  let tries = 0;
  while (trees.length < 150 && tries++ < 9000) {
    const az = -56 + 98 * R(), land = 20 + 150 * R() * R();
    const p = at(az, land);
    if (az > 22 && land > 45) continue;
    if (trees.some(t => Math.hypot(t.pos[0] - p[0], t.pos[2] - p[2]) < 3.2 + t.h * 0.25 + land * 0.02)) continue;
    const sp = R() < 0.5 ? 'archaeopteris' : 'broadleaf';
    const lod = land > 60 ? 2 : 1;
    add({ sp, pos: p, h: 7 + 8 * R(), t0: 114.6 + land * 0.04 + R() * 2.0, dur: 5 + 2 * R(), seed: Math.floor(R() * 1e6), iters: SPECIES[sp].iterations - lod, far: land > 60 });
  }
  // shore shrubs
  tries = 0;
  let ns = 0;
  while (ns < 26 && tries++ < 4000) {
    const az = -50 + 88 * R(), land = 0.6 + 4 * R();
    const p = at(az, land);
    if (trees.some(t => Math.hypot(t.pos[0] - p[0], t.pos[2] - p[2]) < 1.6)) continue;
    add({ sp: 'shrub', pos: p, h: 0.7 + 1.1 * R(), t0: 113.0 + R() * 2.2, dur: 1.8 + R(), seed: Math.floor(R() * 1e6), iters: 4 });
    ns++;
  }
  return trees;
}

/** Build all trees (geometry data in world space) + the leaf clusters for flush planning. */
export function buildForest(T) {
  const R = T.mulberry32(0xF0E5);
  const trees = placeTrees(R);
  const segs = [], clusters = [];
  trees.forEach((tr, ti) => {
    const sp = SPECIES[tr.sp];
    const r = T.mulberry32(tr.seed);
    const str = derive({ ...sp, iterations: tr.iters }, r);
    const res = interpret(sp, str, r, tr.h);
    tr.sTot = res.sTot;
    const yaw = r() * Math.PI * 2, cy = Math.cos(yaw), sy = Math.sin(yaw);
    const W = (p) => [tr.pos[0] + p[0] * cy - p[2] * sy, tr.pos[1] + p[1], tr.pos[2] + p[0] * sy + p[2] * cy];
    const rTip = tr.h * (tr.sp === 'shrub' ? 0.003 : 0.0011);
    const radius = (tips) => rTip * Math.pow(tips, 0.44);
    const firstChild = new Map();
    res.segs.forEach((s, i) => { if (s.parent >= 0 && !firstChild.has(s.parent)) firstChild.set(s.parent, i); });
    const base = segs.length;
    res.segs.forEach((s, i) => {
      const r0 = radius(s.tips);
      const ch = firstChild.get(i);
      const r1 = ch !== undefined ? Math.min(r0, radius(res.segs[ch].tips)) : r0 * 0.7;
      segs.push({ a: W(s.a), b: W(s.b), s0: s.s0, len: s.len, r0, r1, sMax: s.sMax, order: s.order, tree: ti });
    });
    // crown centre for self-shadowing
    let cx = 0, cyy = 0, cz = 0;
    for (const c of res.clusters) { const p = W(c.p); cx += p[0]; cyy += p[1]; cz += p[2]; }
    const n = Math.max(1, res.clusters.length);
    tr.crown = [cx / n, cyy / n, cz / n];
    let cr = 0;
    for (const c of res.clusters) { const p = W(c.p); cr = Math.max(cr, Math.hypot(p[0] - tr.crown[0], (p[1] - tr.crown[1]) * 1.4, p[2] - tr.crown[2])); }
    tr.crownR = cr || 1;
    for (const c of res.clusters) {
      const p = W(c.p);
      const H = [c.H[0] * cy - c.H[2] * sy, c.H[1], c.H[0] * sy + c.H[2] * cy];
      const ready = readyTime(tr, c.s);
      clusters.push({ p, H, tree: ti, ready, birth: ready + 0.12 + 0.6 * r(), flush: 0, seg: base + c.seg });
    }
  });
  return { trees, segs, clusters };
}

/**
 * Flush planning: each T.leafFlushes event claims a group of ready, still-bare clusters that are
 * visible (in the air part of the frame) at the event time. Motif notes claim a whole limb of
 * the nearest well-placed tree. `project(t, p)` → {x, y, ok} in NDC.
 */
export function planFlushes(T, forest, project) {
  const { trees, clusters } = forest;
  const R = T.mulberry32(0xF1A5);
  const used = new Set();
  const plan = [];
  for (const ev of T.leafFlushes) {
    const te = ev.t;
    const cand = [];
    clusters.forEach((c, i) => {
      if (used.has(i) || c.ready > te - 0.04) return;
      const pr = project(te, grownPos(trees[c.tree], c.p, te));
      if (!pr.ok || Math.abs(pr.x) > 0.9 || Math.abs(pr.y) > 0.9) return;
      cand.push({ i, c, pr });
    });
    if (!cand.length) { plan.push({ ev, n: 0 }); continue; }
    let group;
    if (ev.motif) {
      // the tree with the most visible bare clusters, weighted by proximity (screen size)
      const score = new Map();
      for (const k of cand) {
        const tr = trees[k.c.tree];
        const d = Math.hypot(tr.pos[0] - ORIGIN[0], tr.pos[2] - ORIGIN[2]);
        score.set(k.c.tree, (score.get(k.c.tree) || 0) + (tr.hero ? 10 : 1) / Math.max(4, d) * (1 - 0.6 * Math.min(1, Math.abs(k.pr.x))));
      }
      const best = [...score.entries()].sort((a, b) => b[1] - a[1])[0][0];
      const mine = cand.filter(k => k.c.tree === best);
      const focus = mine[Math.floor(R() * mine.length)];
      mine.sort((a, b) => dist(a.c.p, focus.c.p) - dist(b.c.p, focus.c.p));
      group = mine.slice(0, Math.max(30, Math.floor(mine.length * 0.45)));
    } else {
      const focus = cand[Math.floor(R() * cand.length)];
      const mine = cand.filter(k => k.c.tree === focus.c.tree);
      mine.sort((a, b) => dist(a.c.p, focus.c.p) - dist(b.c.p, focus.c.p));
      const late = te > 125.8 ? 2.2 : 1;           // far trees at sunset: bigger bursts so each note reads
      group = mine.slice(0, Math.round((10 + Math.floor(R() * 8)) * late));
    }
    for (const k of group) { used.add(k.i); clusters[k.i].birth = te; clusters[k.i].flush = ev.motif ? 2 : 1; }
    plan.push({ ev, n: group.length, tree: group[0] && group[0].c.tree });
  }
  // clusters born naturally must not steal a flush's thunder: nothing else pops within 0.25 s of
  // a flush on the same tree (keeps each burst readable)
  return plan;
}
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Instanced branch cylinders + leaf cards, rendered in the air view. */
export function makeForestMeshes(ctx, G, forest) {
  const { glsl } = ctx;
  const { trees, segs, clusters } = forest;
  // ---- branches ----
  const cyl = new THREE.CylinderGeometry(1, 1, 1, 7, 1, true);
  cyl.translate(0, 0.5, 0);
  const bg = new THREE.InstancedBufferGeometry();
  bg.setAttribute('position', cyl.attributes.position);
  bg.setAttribute('normal', cyl.attributes.normal);
  bg.setIndex(cyl.index);
  const n = segs.length;
  const iA = new Float32Array(n * 4), iB = new Float32Array(n * 4), iR = new Float32Array(n * 4), iT = new Float32Array(n * 4), iO = new Float32Array(n * 4);
  segs.forEach((s, i) => {
    const tr = trees[s.tree];
    iA.set([...s.a, s.s0], i * 4); iB.set([...s.b, s.len], i * 4);
    iR.set([s.r0, s.r1, s.sMax, s.order], i * 4); iT.set([tr.t0, tr.dur, tr.sTot, tr.h], i * 4); iO.set([...tr.pos, 0], i * 4);
  });
  bg.setAttribute('iA', new THREE.InstancedBufferAttribute(iA, 4));
  bg.setAttribute('iB', new THREE.InstancedBufferAttribute(iB, 4));
  bg.setAttribute('iR', new THREE.InstancedBufferAttribute(iR, 4));
  bg.setAttribute('iT', new THREE.InstancedBufferAttribute(iT, 4));
  bg.setAttribute('iO', new THREE.InstancedBufferAttribute(iO, 4));
  bg.instanceCount = n;
  const WIND = /* glsl */`
  vec3 wind(vec3 p, float hgt, float amt) {
    float k = amt * hgt * hgt;
    return vec3(sin(uT * 1.1 + p.x * 0.21 + p.z * 0.13), 0.0, cos(uT * 0.9 + p.z * 0.17)) * k;
  }
  float grow(vec4 iT, float t) { float u = clamp((t - iT.x) / iT.y, 0.0, 1.0); return iT.z * (1.0 - pow(1.0 - u, ${EASE_P.toFixed(2)})); }
  float gscale(float t0, float dur, float t) { float u = clamp((t - t0) / dur, 0.0, 1.0); return ${SC0.toFixed(3)} + ${(1 - SC0).toFixed(3)} * pow(u, ${SC_P.toFixed(3)}); }
  `;
  const BARK_VS = glsl.header + GL_UNIFORMS + WIND + /* glsl */`
    in vec3 position; in vec3 normal; in vec4 iA, iB, iR, iT, iO;
    uniform mat4 viewMatrix, projectionMatrix; uniform float uPx;
    out vec3 vP; out vec3 vN; out float vOrd;
    void main() {
      float front = grow(iT, uT);
      float f = clamp((front - iA.w) / iB.w, 0.0, 1.0);
      float thick = sqrt(clamp((front - iA.w) / max(iR.z - iA.w, 1e-3), 0.0, 1.0));
      float gs = gscale(iT.x, iT.y, uT);
      vec3 a = iO.xyz + (iA.xyz - iO.xyz) * gs, b = iO.xyz + (mix(iA.xyz, iB.xyz, f) - iO.xyz) * gs;
      vec3 ax = b - a;
      float L = length(ax);
      vec3 H = L > 1e-5 ? ax / L : vec3(0.0, 1.0, 0.0);
      vec3 S = normalize(abs(H.y) < 0.95 ? cross(H, vec3(0.0, 1.0, 0.0)) : cross(H, vec3(1.0, 0.0, 0.0)));
      vec3 Uv = cross(S, H);
      float r = mix(iR.x, iR.y, position.y) * mix(0.12, 1.0, thick) * gs;
      vec3 pw = a + H * L * position.y;
      float dcam = distance(pw, uCamPos);
      r = max(r, dcam * uPx * 0.45);                     // never thinner than ~1 px (no shimmering)
      if (f <= 0.0) r = 0.0;
      vec3 nn = S * position.x + Uv * position.z;
      pw += nn * r;
      vP = pw; vN = nn; vOrd = iR.w;
      gl_Position = projectionMatrix * viewMatrix * vec4(pw, 1.0);
    }`;
  const barkMat = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3, uniforms: { ...G, uPx: { value: 0.001 } },
    vertexShader: BARK_VS,
    fragmentShader: glsl.header + GL_UNIFORMS + GL_LIT_AIR + GL_SHADOW + /* glsl */`
    in vec3 vP; in vec3 vN; in float vOrd; out vec4 fragColor;
    void main() {
      vec3 n = normalize(vN);
      float nz = texture(uNoise, vP.xz * 2.0 + vP.y * 1.3).r;
      vec3 alb = mix(vec3(0.16, 0.12, 0.085), vec3(0.28, 0.22, 0.15), nz) * (vOrd > 2.5 ? 1.2 : 1.0);
      vec3 c = litAir(vP, n, alb, 0.7, sunShadow(vP, n));
      fragColor = vec4(c, distance(vP, uCamPos));
    }`,
  });
  const branches = new THREE.Mesh(bg, barkMat);
  branches.frustumCulled = false;

  // ---- leaves: per cluster, several cards fanned around the twig tip ----
  const LR = T_rng(0x1EAF);
  const lP = [], lD = [], lS = [], lC = [], lO = [], lG = [];
  for (const c of clusters) {
    const tr = trees[c.tree];
    const sp = SPECIES[tr.sp];
    const dist = Math.hypot(tr.pos[0] - ORIGIN[0], tr.pos[2] - ORIGIN[2]);
    const far = dist > 45;
    const count = Math.max(3, Math.round(sp.clusterLeaves * (far ? 0.6 : 1)));
    const size = sp.leafSize * (tr.sp === 'shrub' ? 0.9 : Math.pow(tr.h / 10, 0.5)) * (tr.far ? 2.4 : (far ? 1.6 : 1));
    const dc = [c.p[0] - tr.crown[0], (c.p[1] - tr.crown[1]) * 1.4, c.p[2] - tr.crown[2]];
    const ao = Math.min(1, Math.max(0, Math.hypot(...dc) / tr.crownR));
    for (let k = 0; k < count; k++) {
      const u = LR(), v = LR(), w = LR();
      // direction: around the twig heading, drooping a little
      let d = [c.H[0] + (u - 0.5) * 1.6, c.H[1] + (v - 0.5) * 1.2 - 0.25, c.H[2] + (w - 0.5) * 1.6];
      const l = Math.hypot(...d); d = d.map(x => x / l);
      const off = size * 0.6;
      const p = [c.p[0] + (LR() - 0.5) * off, c.p[1] + (LR() - 0.5) * off * 0.7, c.p[2] + (LR() - 0.5) * off];
      let s = [LR() - 0.5, LR() * 0.3, LR() - 0.5];
      lP.push(...p, size * (0.7 + 0.6 * LR()));
      lD.push(...d, c.birth + k * 0.012);
      lS.push(...s, LR());
      lC.push(ao, c.flush, tr.sp === 'archaeopteris' ? 1 : (tr.sp === 'shrub' ? 2 : 0), sp.leafAspect);
      lO.push(...tr.pos, 0);
      lG.push(tr.t0, tr.dur, 0, 0);
    }
  }
  const quad = new THREE.PlaneGeometry(1, 1);
  quad.translate(0, 0.5, 0);
  const lg = new THREE.InstancedBufferGeometry();
  lg.setAttribute('position', quad.attributes.position);
  lg.setAttribute('uv', quad.attributes.uv);
  lg.setIndex(quad.index);
  lg.setAttribute('lP', new THREE.InstancedBufferAttribute(new Float32Array(lP), 4));
  lg.setAttribute('lD', new THREE.InstancedBufferAttribute(new Float32Array(lD), 4));
  lg.setAttribute('lS', new THREE.InstancedBufferAttribute(new Float32Array(lS), 4));
  lg.setAttribute('lC', new THREE.InstancedBufferAttribute(new Float32Array(lC), 4));
  lg.setAttribute('lO', new THREE.InstancedBufferAttribute(new Float32Array(lO), 4));
  lg.setAttribute('lG', new THREE.InstancedBufferAttribute(new Float32Array(lG), 4));
  lg.instanceCount = lP.length / 4;
  const LEAF_VS = glsl.header + GL_UNIFORMS + /* glsl */`
    in vec3 position; in vec2 uv; in vec4 lP, lD, lS, lC, lO, lG;
    uniform mat4 viewMatrix, projectionMatrix;
    out vec3 vP; out vec3 vN; out vec2 vUv; out vec4 vC; out float vAge;
    void main() {
      float age = uT - lD.w;
      if (age < 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
      // pop: fast unfurl with a small overshoot
      float x = clamp(age / 0.42, 0.0, 1.0);
      float sc = 1.0 - exp(-5.0 * x) * cos(7.5 * x);
      sc = age > 0.42 ? 1.0 - 0.02 * exp(-5.0 * x) : sc;
      vec3 d = lD.xyz;
      vec3 s = normalize(cross(d, normalize(lS.xyz + vec3(0.0, 0.0, 0.001))));
      float gu = clamp((uT - lG.x) / lG.y, 0.0, 1.0);
      float gs = ${SC0.toFixed(3)} + ${(1 - SC0).toFixed(3)} * pow(gu, ${SC_P.toFixed(3)});
      float size = lP.w * sc * sqrt(gs);
      vec3 base = lO.xyz + (lP.xyz - lO.xyz) * gs;
      vec3 p = base + d * position.y * size + s * position.x * size * lC.w * 1.6;
      // flutter
      float flut = 0.015 * (1.0 + 1.2 * uKick + 1.5 * uAudio.z);
      p += vec3(sin(uT * 2.3 + lS.w * 30.0), cos(uT * 1.9 + lS.w * 20.0) * 0.5, sin(uT * 1.7 + lS.w * 11.0)) * flut * position.y * size * 4.0;
      vP = p; vN = normalize(cross(d, s)); vUv = uv; vC = lC; vAge = age;
      gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
    }`;
  const leafMat = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3, uniforms: { ...G }, side: THREE.DoubleSide,
    vertexShader: LEAF_VS,
    fragmentShader: glsl.header + GL_UNIFORMS + GL_LIT_AIR + GL_SHADOW + /* glsl */`
    in vec3 vP; in vec3 vN; in vec2 vUv; in vec4 vC; in float vAge; out vec4 fragColor;
    void main() {
      // leaf silhouette: pointed ellipse along uv.y
      float y = vUv.y, x = (vUv.x - 0.5) * 2.0;
      float wdt = sin(3.14159 * pow(y, 0.8)) * 0.95;
      if (abs(x) > wdt) discard;
      vec3 v = normalize(vP - uCamPos);
      vec3 n = normalize(vN);
      if (dot(n, v) > 0.0) n = -n;
      float ao = mix(0.3, 1.0, vC.x);
      float mature = smoothstep(0.3, 3.5, vAge);
      vec3 fresh = vec3(0.30, 0.52, 0.06);
      vec3 old = vC.z > 0.5 && vC.z < 1.5 ? vec3(0.05, 0.13, 0.05) : (vC.z > 1.5 ? vec3(0.10, 0.16, 0.04) : vec3(0.07, 0.15, 0.035));
      vec3 alb = mix(fresh, old, mature) * (0.85 + 0.3 * abs(x));
      alb *= 1.0 - 0.25 * (1.0 - smoothstep(0.0, 0.05, abs(x)));     // midrib
      float sh = sunShadow(vP, n) * mix(0.55, 1.0, vC.x);
      vec3 c = litAir(vP, n, alb, ao, sh);
      // translucency: low sun shining through the leaf toward the eye (only where it reaches)
      float tr = pow(max(dot(v, uSunDir), 0.0), 4.0) * 1.4 + 0.06;
      c += alb * vec3(1.0, 1.1, 0.45) * uSunCol * tr * sh * 0.5 * (1.0 - uDusk);
      // flush glow: fresh leaves on a marimba note flare, the motif notes most of all
      float fl = vC.y > 1.5 ? 2.2 : (vC.y > 0.5 ? 1.0 : 0.0);
      float far = clamp(distance(vP, uCamPos) / 35.0, 0.0, 1.0);
      vec3 flc = mix(vec3(0.75, 1.0, 0.28), vec3(1.0, 0.72, 0.25), (1.0 - smoothstep(0.02, 0.1, uSunDir.y)));
      c += flc * fl * exp(-vAge / 0.4) * 0.55 * (1.0 + 3.5 * far) * (1.0 - uDusk * 0.5);
      fragColor = vec4(c, distance(vP, uCamPos));
    }`,
  });
  const leaves = new THREE.Mesh(lg, leafMat);
  leaves.frustumCulled = false;
  // shadow casters: same vertex shaders, depth only (leaves alpha-tested)
  const DEPTH_FS = glsl.header + 'out vec4 fragColor; void main() { fragColor = vec4(1.0); }';
  const LEAF_DEPTH_FS = glsl.header + 'in vec2 vUv; out vec4 fragColor; void main() { float x = (vUv.x - 0.5) * 2.0; if (abs(x) > sin(3.14159 * pow(vUv.y, 0.8)) * 0.95) discard; fragColor = vec4(1.0); }';
  const barkDepth = new THREE.Mesh(bg, new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, uniforms: barkMat.uniforms, vertexShader: BARK_VS, fragmentShader: DEPTH_FS }));
  const leafDepth = new THREE.Mesh(lg, new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, uniforms: leafMat.uniforms, vertexShader: LEAF_VS, fragmentShader: LEAF_DEPTH_FS, side: THREE.DoubleSide }));
  barkDepth.frustumCulled = leafDepth.frustumCulled = false;
  return { branches, leaves, barkMat, leafMat, barkDepth, leafDepth, leafCount: lg.instanceCount, segCount: n };
}
function T_rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
