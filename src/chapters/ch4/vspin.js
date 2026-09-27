// Chapter V's planet spin (a snapshot of src/chapters/ch5/path.js, used only if that module
// can't be imported). IV's Earth adopts this frame from 81 s so the hand-off crack networks match.
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function omega(t) {
  const k = [[81.0, 0.05], [82.3, 0.05], [83.4, 0.42], [84.4, 0.42], [86.6, 0.03], [200, 0.03]];
  for (let i = 0; i < k.length - 1; i++) {
    if (t < k[i + 1][0]) { const u = smooth(k[i][0], k[i + 1][0], t); return k[i][1] + (k[i + 1][1] - k[i][1]) * u; }
  }
  return k[k.length - 1][1];
}
export function spinAngle(t) {
  const a = 81.0, b = Math.max(a, t);
  const n = 2 * Math.max(1, Math.ceil((b - a) / 0.05));
  const h = (b - a) / n;
  let s = omega(a) + omega(b);
  for (let i = 1; i < n; i++) s += omega(a + i * h) * (i % 2 ? 4 : 2);
  return -s * h / 3;
}
const AXIS = norm([Math.sin(23.4 * Math.PI / 180), Math.cos(23.4 * Math.PI / 180), 0.12]);
export function spinMatrix(phi) {
  const Y = AXIS, X = norm(cross(Y, [0, 0, 1])), Z = cross(X, Y);
  const c = Math.cos(phi), s = Math.sin(phi);
  return [add(mul(X, c), mul(Z, -s)), Y, add(mul(X, s), mul(Z, c))];
}
/** Prefer chapter V's live module (stays in sync if V changes); fall back to this snapshot. */
export async function loadVSpin() {
  try {
    const m = await import('../ch5/path.js');
    if (typeof m.spinAngle === 'function' && typeof m.spinMatrix === 'function' && m.spinMatrix(0).length === 3) return { spinAngle: m.spinAngle, spinMatrix: m.spinMatrix, live: true };
  } catch (e) { /* V not available: use the snapshot */ }
  return { spinAngle, spinMatrix, live: false };
}
