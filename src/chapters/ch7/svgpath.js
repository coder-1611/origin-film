// SVG path data (the `d` attribute syntax) → flattened polylines.
// Supports M L H V C S Q T A Z, absolute and relative. Pure JS, deterministic, no DOM.
// Each subpath becomes its own stroke: { pts: Float32Array [x0,y0,x1,y1,…], closed }.

const CMD = /([MmLlHhVvCcSsQqTtAaZz])|(-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/g;

function tokenize(d) {
  const out = [];
  let m;
  CMD.lastIndex = 0;
  while ((m = CMD.exec(d))) out.push(m[1] ? m[1] : parseFloat(m[2]));
  return out;
}

// Adaptive-ish flattening: segment count from the control polygon length.
function cubic(out, x0, y0, x1, y1, x2, y2, x3, y3, tol) {
  const len = Math.hypot(x1 - x0, y1 - y0) + Math.hypot(x2 - x1, y2 - y1) + Math.hypot(x3 - x2, y3 - y2);
  const n = Math.max(2, Math.min(200, Math.ceil(len / tol)));
  for (let i = 1; i <= n; i++) {
    const t = i / n, u = 1 - t;
    const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, e = t * t * t;
    out.push(a * x0 + b * x1 + c * x2 + e * x3, a * y0 + b * y1 + c * y2 + e * y3);
  }
}
function quad(out, x0, y0, x1, y1, x2, y2, tol) {
  const len = Math.hypot(x1 - x0, y1 - y0) + Math.hypot(x2 - x1, y2 - y1);
  const n = Math.max(2, Math.min(200, Math.ceil(len / tol)));
  for (let i = 1; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push(u * u * x0 + 2 * u * t * x1 + t * t * x2, u * u * y0 + 2 * u * t * y1 + t * t * y2);
  }
}
// Endpoint → centre parameterisation (SVG 1.1 F.6.5).
function arc(out, x1, y1, rx, ry, phiDeg, fa, fs, x2, y2, tol) {
  if (x1 === x2 && y1 === y2) return;
  rx = Math.abs(rx); ry = Math.abs(ry);
  if (rx < 1e-9 || ry < 1e-9) { out.push(x2, y2); return; }
  const phi = phiDeg * Math.PI / 180, cp = Math.cos(phi), sp = Math.sin(phi);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const x1p = cp * dx + sp * dy, y1p = -sp * dx + cp * dy;
  const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lam > 1) { const s = Math.sqrt(lam); rx *= s; ry *= s; }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  let co = Math.sqrt(Math.max(0, num / den));
  if (fa === fs) co = -co;
  const cxp = co * rx * y1p / ry, cyp = -co * ry * x1p / rx;
  const cx = cp * cxp - sp * cyp + (x1 + x2) / 2, cy = sp * cxp + cp * cyp + (y1 + y2) / 2;
  const ang = (ux, uy, vx, vy) => { const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy); return a; };
  const th1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dth = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!fs && dth > 0) dth -= 2 * Math.PI;
  else if (fs && dth < 0) dth += 2 * Math.PI;
  const n = Math.max(2, Math.min(720, Math.ceil(Math.abs(dth) * Math.max(rx, ry) / tol)));
  for (let i = 1; i <= n; i++) {
    const th = th1 + dth * i / n;
    const ex = rx * Math.cos(th), ey = ry * Math.sin(th);
    out.push(cp * ex - sp * ey + cx, sp * ex + cp * ey + cy);
  }
}

/** Parse `d` → [{ pts: number[], closed }]. tol = target flattening step (units of d). */
export function parsePath(d, tol = 2.0) {
  const tk = tokenize(d);
  const subs = [];
  let cur = null, i = 0, cmd = null;
  let x = 0, y = 0, sx = 0, sy = 0, lcx = 0, lcy = 0, lqx = 0, lqy = 0, prev = '';
  const num = () => tk[i++];
  const start = (nx, ny) => { cur = { pts: [nx, ny], closed: false }; subs.push(cur); sx = nx; sy = ny; };
  while (i < tk.length) {
    if (typeof tk[i] === 'string') cmd = tk[i++];
    else if (cmd === 'M') cmd = 'L';
    else if (cmd === 'm') cmd = 'l';
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    const ox = rel ? x : 0, oy = rel ? y : 0;
    if (C === 'Z') {
      if (cur) { if (x !== sx || y !== sy) cur.pts.push(sx, sy); cur.closed = true; }
      x = sx; y = sy; prev = 'Z';
      cur = null;
      continue;
    }
    if (!cur && C !== 'M') start(x, y);
    switch (C) {
      case 'M': { const nx = ox + num(), ny = oy + num(); start(nx, ny); x = nx; y = ny; break; }
      case 'L': { const nx = ox + num(), ny = oy + num(); cur.pts.push(nx, ny); x = nx; y = ny; break; }
      case 'H': { const nx = (rel ? x : 0) + num(); cur.pts.push(nx, y); x = nx; break; }
      case 'V': { const ny = (rel ? y : 0) + num(); cur.pts.push(x, ny); y = ny; break; }
      case 'C': {
        const x1 = ox + num(), y1 = oy + num(), x2 = ox + num(), y2 = oy + num(), nx = ox + num(), ny = oy + num();
        cubic(cur.pts, x, y, x1, y1, x2, y2, nx, ny, tol); lcx = x2; lcy = y2; x = nx; y = ny; break;
      }
      case 'S': {
        const x1 = (prev === 'C' || prev === 'S') ? 2 * x - lcx : x, y1 = (prev === 'C' || prev === 'S') ? 2 * y - lcy : y;
        const x2 = ox + num(), y2 = oy + num(), nx = ox + num(), ny = oy + num();
        cubic(cur.pts, x, y, x1, y1, x2, y2, nx, ny, tol); lcx = x2; lcy = y2; x = nx; y = ny; break;
      }
      case 'Q': {
        const x1 = ox + num(), y1 = oy + num(), nx = ox + num(), ny = oy + num();
        quad(cur.pts, x, y, x1, y1, nx, ny, tol); lqx = x1; lqy = y1; x = nx; y = ny; break;
      }
      case 'T': {
        const x1 = (prev === 'Q' || prev === 'T') ? 2 * x - lqx : x, y1 = (prev === 'Q' || prev === 'T') ? 2 * y - lqy : y;
        const nx = ox + num(), ny = oy + num();
        quad(cur.pts, x, y, x1, y1, nx, ny, tol); lqx = x1; lqy = y1; x = nx; y = ny; break;
      }
      case 'A': {
        const rx = num(), ry = num(), rot = num(), fa = num(), fs = num(), nx = ox + num(), ny = oy + num();
        arc(cur.pts, x, y, rx, ry, rot, fa ? 1 : 0, fs ? 1 : 0, nx, ny, tol); x = nx; y = ny; break;
      }
      default: i++;
    }
    prev = C;
  }
  return subs.filter(s => s.pts.length >= 4);
}

/** Subdivide so no segment is longer than maxLen; returns { pts, cum (arc length at each vertex), len }. */
export function densify(pts, maxLen) {
  const out = [pts[0], pts[1]];
  for (let k = 2; k < pts.length; k += 2) {
    const x0 = out[out.length - 2], y0 = out[out.length - 1], x1 = pts[k], y1 = pts[k + 1];
    const L = Math.hypot(x1 - x0, y1 - y0);
    if (L < 1e-6) continue;
    const n = Math.max(1, Math.ceil(L / maxLen));
    for (let j = 1; j <= n; j++) out.push(x0 + (x1 - x0) * j / n, y0 + (y1 - y0) * j / n);
  }
  const nv = out.length / 2, cum = new Float32Array(nv);
  for (let v = 1; v < nv; v++) cum[v] = cum[v - 1] + Math.hypot(out[2 * v] - out[2 * v - 2], out[2 * v + 1] - out[2 * v - 1]);
  return { pts: Float32Array.from(out), cum, len: cum[nv - 1] || 0 };
}

// ---- helpers that EMIT path data (so procedural detail is still authored as `d`) ----
const f = (v) => (Math.round(v * 100) / 100).toString();
export const P = {
  f,
  line: (x0, y0, x1, y1) => `M${f(x0)} ${f(y0)}L${f(x1)} ${f(y1)}`,
  circle: (cx, cy, r) => `M${f(cx + r)} ${f(cy)}A${f(r)} ${f(r)} 0 1 1 ${f(cx - r)} ${f(cy)}A${f(r)} ${f(r)} 0 1 1 ${f(cx + r)} ${f(cy)}`,
  ellipse: (cx, cy, rx, ry, rot = 0) => {
    const c = Math.cos(rot * Math.PI / 180), s = Math.sin(rot * Math.PI / 180);
    const ax = cx + rx * c, ay = cy + rx * s, bx = cx - rx * c, by = cy - rx * s;
    return `M${f(ax)} ${f(ay)}A${f(rx)} ${f(ry)} ${f(rot)} 1 1 ${f(bx)} ${f(by)}A${f(rx)} ${f(ry)} ${f(rot)} 1 1 ${f(ax)} ${f(ay)}`;
  },
  /** Circular arc from angle a0 to a1 (degrees, y-down screen convention: +deg = clockwise). */
  arc: (cx, cy, r, a0, a1) => {
    // split into ≤120° pieces so full circles (coincident endpoints) survive
    const D = Math.PI / 180, n = Math.max(1, Math.ceil(Math.abs(a1 - a0) / 120)), sweep = a1 > a0 ? 1 : 0;
    let d = `M${f(cx + r * Math.cos(a0 * D))} ${f(cy + r * Math.sin(a0 * D))}`;
    for (let k = 1; k <= n; k++) {
      const a = a0 + (a1 - a0) * k / n;
      d += `A${f(r)} ${f(r)} 0 0 ${sweep} ${f(cx + r * Math.cos(a * D))} ${f(cy + r * Math.sin(a * D))}`;
    }
    return d;
  },
  poly: (pts, close = false) => pts.map((p, i) => `${i ? 'L' : 'M'}${f(p[0])} ${f(p[1])}`).join('') + (close ? 'Z' : ''),
  rect: (x, y, w, h) => `M${f(x)} ${f(y)}H${f(x + w)}V${f(y + h)}H${f(x)}Z`,
  /** Dashed straight line (for centre/construction lines): dash, gap, optional dot. */
  dashed: (x0, y0, x1, y1, dash = 14, gap = 6, dot = false) => {
    const L = Math.hypot(x1 - x0, y1 - y0), ux = (x1 - x0) / L, uy = (y1 - y0) / L;
    let s = 0, out = '';
    while (s < L) {
      const e = Math.min(L, s + dash);
      out += `M${f(x0 + ux * s)} ${f(y0 + uy * s)}L${f(x0 + ux * e)} ${f(y0 + uy * e)}`;
      s = e + gap;
      if (dot && s < L) { const e2 = Math.min(L, s + 1.5); out += `M${f(x0 + ux * s)} ${f(y0 + uy * s)}L${f(x0 + ux * e2)} ${f(y0 + uy * e2)}`; s = e2 + gap; }
    }
    return out;
  },
  dashedArc: (cx, cy, r, a0, a1, dashDeg = 4, gapDeg = 2.5) => {
    let out = '';
    for (let a = a0; a < a1; a += dashDeg + gapDeg) out += P.arc(cx, cy, r, a, Math.min(a1, a + dashDeg));
    return out;
  },
  arrow: (x, y, ang, size = 9) => {   // open arrowhead pointing along ang (deg) with its tip at (x, y)
    const D = Math.PI / 180, a1 = (ang + 180 - 22) * D, a2 = (ang + 180 + 22) * D;
    return `M${f(x + size * Math.cos(a1))} ${f(y + size * Math.sin(a1))}L${f(x)} ${f(y)}L${f(x + size * Math.cos(a2))} ${f(y + size * Math.sin(a2))}`;
  },
};

/** Parallel hatch lines clipped to a convex-or-not polygon (even-odd scanline), as path data. */
export function hatch(poly, angleDeg, spacing, { jitter = 0, rng = null, inset = 0, skip = 0 } = {}) {
  const a = angleDeg * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
  // rotate polygon so hatch lines are horizontal
  const rp = poly.map(([x, y]) => [x * ca + y * sa, -x * sa + y * ca]);
  let y0 = Infinity, y1 = -Infinity;
  for (const p of rp) { y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
  let out = '';
  let k = 0;
  for (let yy = y0 + spacing * 0.5; yy < y1; yy += spacing, k++) {
    if (skip && rng && rng() < skip) continue;
    const xs = [];
    for (let i = 0; i < rp.length; i++) {
      const [ax, ay] = rp[i], [bx, by] = rp[(i + 1) % rp.length];
      if ((ay <= yy && by > yy) || (by <= yy && ay > yy)) xs.push(ax + (yy - ay) / (by - ay) * (bx - ax));
    }
    xs.sort((p, q) => p - q);
    for (let j = 0; j + 1 < xs.length; j += 2) {
      let xa = xs[j] + inset, xb = xs[j + 1] - inset;
      if (jitter && rng) { xa += (rng() - 0.5) * jitter; xb += (rng() - 0.5) * jitter; }
      if (xb - xa < 2) continue;
      const X0 = xa * ca - yy * sa, Y0 = xa * sa + yy * ca, X1 = xb * ca - yy * sa, Y1 = xb * sa + yy * ca;
      out += `M${f(X0)} ${f(Y0)}L${f(X1)} ${f(Y1)}`;
    }
  }
  return out;
}
