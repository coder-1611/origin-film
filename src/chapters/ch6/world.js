// VI · LIFE: underwater set dressing: stromatolites (domed columns of layered microbial mat)
// and kelp. Everything is generated once at init from seeded noise.
import { THREE } from '../../engine/gl.js';
import { HERO, P0, N0, PATCH, DEG } from './layout.js';
import { fbm2, fbm3, heightAt, ORIGIN, coastR } from './terrain.js';

/** A domed column: ellipsoid cap (radii a, b, c) over a vertical column down into the floor. */
function domeGeometry(center, radii, seed, { hero = false, nTh = 96, nCap = 36, nCol = 16 } = {}) {
  const [a, b, c] = radii;
  const bottom = heightAt(center[0], center[2]) - 0.25;
  const verts = [], lam = [], idx = [];
  const rows = [];
  // rows: cap from the pole (phi = 90°) to the equator, then (non-hero) an overhang tucking
  // under the cap, then the column down into the floor
  const neck = hero ? 1.0 : 0.66 + 0.12 * ((seed * 7.31) % 1);
  const under = hero ? 0 : b * 0.45;
  for (let j = 0; j <= nCap; j++) rows.push({ phi: (90 - 90 * j / nCap) * DEG, y: null });
  const nU = hero ? 0 : 6;
  for (let j = 1; j <= nU; j++) { const u = j / nU; rows.push({ phi: 0, y: center[1] - under * u, tuck: 1 - (1 - neck) * Math.sin(u * Math.PI / 2) }); }
  const colTop = center[1] - under;
  for (let j = 1; j <= nCol; j++) rows.push({ phi: 0, y: colTop + (bottom - colTop) * j / nCol, col: true });
  for (const row of rows) {
    for (let i = 0; i <= nTh; i++) {
      const th = (i / nTh) * Math.PI * 2;
      const cp = Math.cos(row.phi), sp = Math.sin(row.phi);
      let x, y, z, flare = 1;
      if (row.y === null) { x = a * cp * Math.cos(th); y = b * sp; z = c * cp * Math.sin(th); }
      else if (!row.col) { x = a * Math.cos(th) * row.tuck; y = row.y - center[1]; z = c * Math.sin(th) * row.tuck; }
      else {
        const u = (colTop - row.y) / Math.max(1e-3, colTop - bottom);
        flare = neck * (1 - 0.08 * Math.sin(u * Math.PI) + (hero ? 0.12 : 0.3) * u * u * u);   // waist, flared foot
        flare *= 1 + 0.07 * Math.sin(row.y * 23 + seed * 5) ;                                 // growth bulges
        x = a * Math.cos(th) * flare; y = row.y - center[1]; z = c * Math.sin(th) * flare;
      }
      // knobby, cauliflower-like growth: 3D fbm displacement along the (approximate) normal,
      // strongest on the cap; gentle on the hero's live patch so the colony sits on a smooth face
      const wx = center[0] + x, wy = center[1] + y, wz = center[2] + z;
      let amp = 0.16 * Math.min(a, c);
      if (hero) {
        const d = [wx - P0[0], wy - P0[1], wz - P0[2]];
        const along = d[0] * N0[0] + d[1] * N0[1] + d[2] * N0[2];
        const lat = Math.hypot(d[0] - along * N0[0], d[1] - along * N0[1], d[2] - along * N0[2]);
        const k = Math.min(1, Math.max(0, (lat - PATCH * 0.5) / (PATCH * 0.45)));
        amp *= z < 0 ? 1 : 0.12 + 0.88 * k;
      }
      const f1 = fbm3(wx * 3.2, wy * 3.2, wz * 3.2, 3, seed * 7 | 0) - 0.5;
      const f2 = fbm3(wx * 11, wy * 11, wz * 11, 2, (seed * 13 | 0) + 5) - 0.5;
      const knob = f1 * 1.6 + f2 * 0.45;
      const capW = row.y === null ? 1.0 : 0.8;
      const rr = 1 + amp * knob * 2.2 * capW / Math.max(0.3, Math.min(a, c));
      verts.push(center[0] + x * rr, wy + (row.y === null ? amp * knob * 0.8 * Math.sin(row.phi) : 0), center[2] + z * rr);
      lam.push(wy);
    }
  }
  const W = nTh + 1;
  for (let j = 0; j < rows.length - 1; j++) for (let i = 0; i < nTh; i++) {
    const p = j * W + i, q = p + 1, r = p + W, s = r + 1;
    idx.push(p, q, r, q, s, r);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setAttribute('lam', new THREE.Float32BufferAttribute(lam, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** All stromatolites merged into one geometry; attribute `hero` marks the live-colony dome. */
export function makeStromatolites(R) {
  const parts = [];
  parts.push({ g: domeGeometry(HERO.c, HERO.r, 1.3, { hero: true, nTh: 160, nCap: 64, nCol: 20 }), hero: 1, seed: 0.5 });
  const placed = [[HERO.c[0], HERO.c[2], 0.85]];
  let tries = 0;
  while (parts.length < 20 && tries++ < 1500) {
    const az = (-50 + 86 * R()) * DEG, r = 1.5 + 7.5 * Math.pow(R(), 0.9);
    const x = ORIGIN[0] + Math.sin(az) * r, z = ORIGIN[2] - Math.cos(az) * r;
    if (r > coastR(az) - 1.8) continue;
    if (Math.abs(x) < 1.3 && z > -1.7) continue;                  // keep the camera path + foreground clear
    const a = 0.18 + 0.55 * R() * R() + (r > 4 ? 0.12 : 0);
    if (placed.some(([px, pz, pr]) => Math.hypot(px - x, pz - z) < pr + a + 0.08)) continue;
    const floor = heightAt(x, z);
    const top = Math.min(-0.14 - 0.4 * R(), floor + 0.3 + 0.8 * R());
    const b = a * (0.35 + 0.3 * R());
    const cy = top - b;
    if (cy < floor + 0.05) continue;
    placed.push([x, z, a]);
    parts.push({ g: domeGeometry([x, cy, z], [a, b, a * (0.8 + 0.3 * R())], 10 + parts.length * 3.7, { nTh: 48, nCap: 18, nCol: 8 }), hero: 0, seed: R() });
  }
  // merge
  let nv = 0, ni = 0;
  for (const p of parts) { nv += p.g.attributes.position.count; ni += p.g.index.count; }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), lam = new Float32Array(nv), hero = new Float32Array(nv), sd = new Float32Array(nv);
  const idx = new Uint32Array(ni);
  let ov = 0, oi = 0;
  for (const p of parts) {
    const g = p.g, n = g.attributes.position.count;
    pos.set(g.attributes.position.array, ov * 3); nor.set(g.attributes.normal.array, ov * 3); lam.set(g.attributes.lam.array, ov);
    hero.fill(p.hero, ov, ov + n); sd.fill(p.seed, ov, ov + n);
    const gi = g.index.array;
    for (let i = 0; i < gi.length; i++) idx[oi + i] = gi[i] + ov;
    ov += n; oi += gi.length;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('lam', new THREE.BufferAttribute(lam, 1));
  g.setAttribute('hero', new THREE.BufferAttribute(hero, 1));
  g.setAttribute('seed', new THREE.BufferAttribute(sd, 1));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return { geometry: g, placed };
}

/** Kelp: instanced stalks. Base geometry is one stalk (a twisting ribbon) plus blades. */
export function makeKelp(R, placed) {
  const verts = [], attr = [], idx = [];
  const SEG = 28;
  const addRibbon = (s0, s1, off, width, bladeSide) => {
    const base = verts.length / 3;
    for (let j = 0; j <= SEG; j++) {
      const u = j / SEG;
      const s = s0 + (s1 - s0) * u;
      const w = width * (bladeSide ? Math.sin(Math.PI * Math.min(1, u * 1.15)) * (1 - 0.3 * u) : 1);
      for (const side of [-1, 1]) {
        verts.push(side * w, s, off);
        attr.push(s, bladeSide, u, side);
      }
    }
    for (let j = 0; j < SEG; j++) { const p = base + j * 2; idx.push(p, p + 1, p + 2, p + 1, p + 3, p + 2); }
  };
  addRibbon(0, 1, 0, 0.006, 0);
  for (let b = 0; b < 7; b++) {
    const s0 = 0.18 + b * 0.115;
    addRibbon(s0, s0 + 0.32, (b % 2 ? 1 : -1) * 0.001, 0.03 + 0.012 * (b % 3), b % 2 ? 1 : -1);
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setAttribute('kp', new THREE.Float32BufferAttribute(attr, 4));
  g.setIndex(idx);
  const inst = [];
  let tries = 0;
  while (inst.length < 90 * 8 && tries++ < 6000) {
    const az = (-58 + 96 * R()) * DEG, r = 2.6 + 6.5 * Math.sqrt(R());
    const cr = coastR(az);
    if (r > cr - 1.0) continue;
    const x = ORIGIN[0] + Math.sin(az) * r, z = ORIGIN[2] - Math.cos(az) * r;
    if (Math.abs(x) < 0.9 && z > -1.8) continue;
    if (placed.some(([px, pz, pr]) => Math.hypot(px - x, pz - z) < pr + 0.12)) continue;
    const floor = heightAt(x, z);
    const height = (-floor) * (0.8 + 0.3 * R());
    inst.push(x, floor, z, height, R() * 6.28, 0.7 + 0.6 * R(), R(), 0);
  }
  const n = inst.length / 8;
  const ia = new Float32Array(inst);
  g.setAttribute('ipos', new THREE.InstancedBufferAttribute(ia.filter((_, i) => i % 8 < 4), 4));
  g.setAttribute('iprm', new THREE.InstancedBufferAttribute(ia.filter((_, i) => i % 8 >= 4), 4));
  g.instanceCount = n;
  return g;
}
