// Helpers for authoring the frieze drawings. Everything returns SVG path data strings.
import { P } from './svgpath.js';

const f = P.f;

/** Smooth closed blob through n jittered radial points (Catmull-Rom → cubic Béziers). */
export function blob(cx, cy, rx, ry, rng, { n = 9, jit = 0.14, rot = 0, flat = 0 } = {}) {
  const pts = [];
  for (let k = 0; k < n; k++) {
    const a = rot + (k / n) * Math.PI * 2;
    let r = 1 + (rng() - 0.5) * 2 * jit;
    let y = Math.sin(a) * ry * r;
    if (flat && y > 0) y *= 1 - flat;          // flatten the bottom (stones sit on the ground)
    pts.push([cx + Math.cos(a) * rx * r, cy + y]);
  }
  return catmull(pts, true);
}

/** Catmull-Rom spline through points → cubic Bézier path data. */
export function catmull(pts, closed = false, tension = 1) {
  const n = pts.length;
  const get = (i) => closed ? pts[(i + n) % n] : pts[Math.max(0, Math.min(n - 1, i))];
  let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2);
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6 * tension, p1[1] + (p2[1] - p0[1]) / 6 * tension];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6 * tension, p2[1] - (p3[1] - p1[1]) / 6 * tension];
    d += `C${f(c1[0])} ${f(c1[1])} ${f(c2[0])} ${f(c2[1])} ${f(p2[0])} ${f(p2[1])}`;
  }
  return d + (closed ? 'Z' : '');
}

/** Wavy line (wood grain / smoke) from (x0,y0) to (x1,y1) with a sine wobble. */
export function wavy(x0, y0, x1, y1, amp, waves, phase = 0, steps = 24) {
  const L = Math.hypot(x1 - x0, y1 - y0), ux = (x1 - x0) / L, uy = (y1 - y0) / L;
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const s = i / steps, o = Math.sin(phase + s * waves * Math.PI * 2) * amp * Math.sin(Math.PI * s) ** 0.3;
    pts.push([x0 + ux * L * s - uy * o, y0 + uy * L * s + ux * o]);
  }
  return catmull(pts);
}

/** Bolt head: small circle with a centre dot-cross. */
export function bolt(x, y, r = 4) {
  return P.circle(x, y, r) + `M${f(x - r * 0.45)} ${f(y)}L${f(x + r * 0.45)} ${f(y)}`;
}

/** Ring of bolts on a circle. */
export function boltRing(cx, cy, R, n, r = 3, a0 = 0) {
  let d = '';
  for (let k = 0; k < n; k++) { const a = a0 + (k / n) * Math.PI * 2; d += P.circle(cx + Math.cos(a) * R, cy + Math.sin(a) * R, r); }
  return d;
}

/** Row of bolts along a line. */
export function boltRow(x0, y0, x1, y1, n, r = 3) {
  let d = '';
  for (let k = 0; k < n; k++) { const s = n === 1 ? 0.5 : k / (n - 1); d += P.circle(x0 + (x1 - x0) * s, y0 + (y1 - y0) * s, r); }
  return d;
}

/** Cylinder shading (engraving): vertical lines denser toward both edges. */
export function cylHatch(x0, x1, y0, y1, n = 7, side = 'both') {
  let d = '';
  for (let k = 1; k <= n; k++) {
    const u = k / (n + 1);
    const e = 0.5 - 0.5 * Math.cos(u * Math.PI);           // cosine spacing: dense near edges
    const xs = [];
    if (side !== 'right') xs.push(x0 + (x1 - x0) * e * 0.5);
    if (side !== 'left') xs.push(x1 - (x1 - x0) * e * 0.5);
    for (const x of xs) d += `M${f(x)} ${f(y0)}L${f(x)} ${f(y1)}`;
  }
  return d;
}

/** Horizontal cylinder shading. */
export function cylHatchH(x0, x1, y0, y1, n = 5) {
  let d = '';
  for (let k = 1; k <= n; k++) {
    const u = k / (n + 1), e = 0.5 - 0.5 * Math.cos(u * Math.PI);
    const ya = y0 + (y1 - y0) * e * 0.5, yb = y1 - (y1 - y0) * e * 0.5;
    d += `M${f(x0)} ${f(ya)}L${f(x1)} ${f(ya)}M${f(x0)} ${f(yb)}L${f(x1)} ${f(yb)}`;
  }
  return d;
}

/** Section hatching band (45°) between two horizontal lines. */
export function sectionBand(x0, x1, y0, y1, spacing = 10, angle = -45) {
  const pts = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  return hatchPoly(pts, angle, spacing);
}

/** Even-odd hatch of a polygon (re-exported shape of svgpath.hatch without options). */
export function hatchPoly(poly, angleDeg, spacing) {
  const a = angleDeg * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
  const rp = poly.map(([x, y]) => [x * ca + y * sa, -x * sa + y * ca]);
  let y0 = Infinity, y1 = -Infinity;
  for (const p of rp) { y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
  let out = '';
  for (let yy = y0 + spacing * 0.5; yy < y1; yy += spacing) {
    const xs = [];
    for (let i = 0; i < rp.length; i++) {
      const [ax, ay] = rp[i], [bx, by] = rp[(i + 1) % rp.length];
      if ((ay <= yy && by > yy) || (by <= yy && ay > yy)) xs.push(ax + (yy - ay) / (by - ay) * (bx - ax));
    }
    xs.sort((p, q) => p - q);
    for (let j = 0; j + 1 < xs.length; j += 2) {
      const xa = xs[j], xb = xs[j + 1];
      if (xb - xa < 1.5) continue;
      out += `M${f(xa * ca - yy * sa)} ${f(xa * sa + yy * ca)}L${f(xb * ca - yy * sa)} ${f(xb * sa + yy * ca)}`;
    }
  }
  return out;
}

/** Rounded rectangle. */
export function rrect(x, y, w, h, r) {
  return `M${f(x + r)} ${f(y)}H${f(x + w - r)}A${f(r)} ${f(r)} 0 0 1 ${f(x + w)} ${f(y + r)}V${f(y + h - r)}A${f(r)} ${f(r)} 0 0 1 ${f(x + w - r)} ${f(y + h)}H${f(x + r)}A${f(r)} ${f(r)} 0 0 1 ${f(x)} ${f(y + h - r)}V${f(y + r)}A${f(r)} ${f(r)} 0 0 1 ${f(x + r)} ${f(y)}Z`;
}

/** Tapered bar between two points (two edge lines + optional rounded ends). */
export function taper(x0, y0, x1, y1, w0, w1) {
  const L = Math.hypot(x1 - x0, y1 - y0), ux = (x1 - x0) / L, uy = (y1 - y0) / L, nx = -uy, ny = ux;
  return `M${f(x0 + nx * w0)} ${f(y0 + ny * w0)}L${f(x1 + nx * w1)} ${f(y1 + ny * w1)}` +
         `M${f(x0 - nx * w0)} ${f(y0 - ny * w0)}L${f(x1 - nx * w1)} ${f(y1 - ny * w1)}`;
}

export { P };
