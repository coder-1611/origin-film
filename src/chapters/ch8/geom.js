// Procedural geometry for VIII: smooth "rounded slabs" (a rounded rectangle in plan with a
// rounded vertical edge profile), the shape of a unibody laptop, its lid, trackpad and keycaps.
// Normals are analytic, so aluminium highlights run smoothly around every corner.

/**
 * Rounded slab centred on the origin: width w (x), depth d (z), height h (y).
 * planR: corner radius seen from above. edgeR: radius of the top/bottom edge roll-off.
 */
export function roundedSlab(THREE, w, d, h, planR, edgeR, { segC = 8, segE = 5, bottom = true } = {}) {
  edgeR = Math.min(edgeR, h / 2 - 1e-6, planR - 1e-6);
  const a = w / 2, b = d / 2;
  const corners = [[a - planR, b - planR, 0], [-(a - planR), b - planR, Math.PI / 2], [-(a - planR), -(b - planR), Math.PI], [a - planR, -(b - planR), 1.5 * Math.PI]];
  const outline = [];                                     // { cx, cz, th }
  for (const [cx, cz, th0] of corners) for (let i = 0; i <= segC; i++) outline.push({ cx, cz, th: th0 + (i / segC) * Math.PI / 2 });
  const N = outline.length;
  // Vertical profile rings: φ from −π/2 (bottom face) to +π/2 (top face).
  const rings = [];
  const phis = [];
  if (bottom) for (let i = 0; i <= segE; i++) phis.push(-Math.PI / 2 + (i / segE) * Math.PI / 2);
  else phis.push(0);
  for (let i = 0; i <= segE; i++) phis.push((i / segE) * Math.PI / 2);
  const pos = [], nor = [], uv = [], idx = [];
  const push = (x, y, z, nx, ny, nz) => { pos.push(x, y, z); nor.push(nx, ny, nz); uv.push(x / w + 0.5, z / d + 0.5); return pos.length / 3 - 1; };
  phis.forEach((phi, ri) => {
    const top = ri >= (bottom ? segE + 1 : 1);
    const c = Math.cos(phi), s = Math.sin(phi);
    const delta = edgeR * (1 - c);
    const y = top ? h / 2 - edgeR + edgeR * s : -h / 2 + edgeR + edgeR * s;
    const ring = [];
    for (const o of outline) {
      const r = planR - delta;
      const nx = Math.cos(o.th), nz = Math.sin(o.th);
      ring.push(push(o.cx + r * nx, y, o.cz + r * nz, nx * c, s, nz * c));
    }
    rings.push(ring);
  });
  const tri = (i0, i1, i2) => {
    // Orient each triangle so its winding agrees with the vertex normals (outward).
    const p = (i) => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
    const A = p(i0), B = p(i1), C = p(i2);
    const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    const n = [0, 1, 2].map(k => nor[i0 * 3 + k] + nor[i1 * 3 + k] + nor[i2 * 3 + k]);
    if (cx * n[0] + cy * n[1] + cz * n[2] >= 0) idx.push(i0, i1, i2); else idx.push(i0, i2, i1);
  };
  for (let r = 0; r < rings.length - 1; r++) {
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N;
      const a0 = rings[r][i], a1 = rings[r][j], b0 = rings[r + 1][i], b1 = rings[r + 1][j];
      tri(a0, a1, b1); tri(a0, b1, b0);
    }
  }
  // caps
  const capTop = push(0, h / 2, 0, 0, 1, 0);
  const topRing = rings[rings.length - 1];
  const topCapRing = topRing.map(i => push(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2], 0, 1, 0));
  for (let i = 0; i < N; i++) tri(capTop, topCapRing[i], topCapRing[(i + 1) % N]);
  if (bottom) {
    const capBot = push(0, -h / 2, 0, 0, -1, 0);
    const botCapRing = rings[0].map(i => push(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2], 0, -1, 0));
    for (let i = 0; i < N; i++) tri(capBot, botCapRing[i], botCapRing[(i + 1) % N]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** Flat rounded rectangle in the xz plane (normal +y), centred on the origin. */
export function roundedRectPlane(THREE, w, d, r, seg = 8) {
  const s = new THREE.Shape();
  const a = w / 2, b = d / 2;
  s.moveTo(-a + r, -b);
  s.lineTo(a - r, -b); s.absarc(a - r, -b + r, r, -Math.PI / 2, 0, false);
  s.lineTo(a, b - r); s.absarc(a - r, b - r, r, 0, Math.PI / 2, false);
  s.lineTo(-a + r, b); s.absarc(-a + r, b - r, r, Math.PI / 2, Math.PI, false);
  s.lineTo(-a, -b + r); s.absarc(-a + r, -b + r, r, Math.PI, 1.5 * Math.PI, false);
  const g = new THREE.ShapeGeometry(s, seg);
  g.rotateX(Math.PI / 2);                               // xy → xz, normal −z → +y? fix below
  const n = g.getAttribute('normal');
  for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
  // rotateX(+90°) maps +y to +z and the face normal (0,0,1) to (0,-1,0): flip winding to face up.
  const idx = g.getIndex();
  for (let i = 0; i < idx.count; i += 3) { const t = idx.getX(i + 1); idx.setX(i + 1, idx.getX(i + 2)); idx.setX(i + 2, t); }
  const uv = g.getAttribute('uv'), p = g.getAttribute('position');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, p.getX(i) / w + 0.5, p.getZ(i) / d + 0.5);
  return g;
}
