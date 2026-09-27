// ch3/rig.js: a scale-aware camera rig over the timeline keys (T.cameras.III).
//
// Chapter III zooms across three orders of magnitude (an HII region → a whole galaxy → one star),
// so Catmull-Rom on raw positions is useless here. Each key is decomposed into
//   distance D = |pos − target| (interpolated in log space), azimuth/elevation of pos about the
//   target, fov and roll: all with monotone cubic Hermite (no overshoot, smooth reversals).
// The look-at point is pinned to an `anchor` (the nebula or the Sun): its offset from the anchor
// is interpolated in units of D, so the anchor drifts across the screen smoothly in *time*,
// whatever the scale is doing. Keys whose anchors differ interpolate the target directly.

const DEG = Math.PI / 180;

function tangents(ts, vs) {             // Fritsch–Carlson monotone tangents
  const n = ts.length, d = [], m = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) d.push((vs[i + 1] - vs[i]) / (ts[i + 1] - ts[i]));
  if (n < 2) return m;
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], h = a * a + b * b;
    if (h > 9) { const s = 3 / Math.sqrt(h); m[i] = s * a * d[i]; m[i + 1] = s * b * d[i]; }
  }
  return m;
}
function hermite(t0, t1, v0, v1, m0, m1, t) {
  const h = t1 - t0, u = (t - t0) / h, u2 = u * u, u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * v0 + (u3 - 2 * u2 + u) * h * m0 + (-2 * u3 + 3 * u2) * v1 + (u3 - u2) * h * m1;
}

/** keys: timeline keys; anchors: { name: [x,y,z] }. Returns (t) → { pos, target, fov, roll, D, fwd }. */
export function makeRig(keys, anchors) {
  const K = keys.map((k) => {
    const off = [k.pos[0] - k.target[0], k.pos[1] - k.target[1], k.pos[2] - k.target[2]];
    const D = Math.hypot(off[0], off[1], off[2]);
    const A = anchors[k.anchor] || k.target;
    return {
      t: k.t, logD: Math.log(D), el: Math.asin(off[1] / D), az: Math.atan2(off[0], off[2]),
      fov: k.fov, roll: k.roll || 0, anchor: k.anchor, target: k.target,
      o: [(k.target[0] - A[0]) / D, (k.target[1] - A[1]) / D, (k.target[2] - A[2]) / D],
    };
  });
  for (let i = 1; i < K.length; i++) {        // unwrap azimuth
    while (K[i].az - K[i - 1].az > Math.PI) K[i].az -= 2 * Math.PI;
    while (K[i].az - K[i - 1].az < -Math.PI) K[i].az += 2 * Math.PI;
  }
  const ts = K.map(k => k.t);
  const ch = {};
  for (const c of ['logD', 'el', 'az', 'fov', 'roll']) { const vs = K.map(k => k[c]); ch[c] = { vs, ms: tangents(ts, vs) }; }
  // Offsets from the anchor: tangents within runs of equal anchors.
  const oT = K.map(() => [0, 0, 0]), tT = K.map(() => [0, 0, 0]);
  {
    let s = 0;
    while (s < K.length) {
      let e = s; while (e + 1 < K.length && K[e + 1].anchor === K[s].anchor) e++;
      for (let j = 0; j < 3; j++) {
        const m = tangents(ts.slice(s, e + 1), K.slice(s, e + 1).map(k => k.o[j]));
        for (let i = s; i <= e; i++) oT[i][j] = m[i - s];
      }
      s = e + 1;
    }
    for (let j = 0; j < 3; j++) { const m = tangents(ts, K.map(k => k.target[j])); for (let i = 0; i < K.length; i++) tT[i][j] = m[i]; }
  }

  return function sample(t) {
    const n = K.length;
    const tc = Math.min(K[n - 1].t, Math.max(K[0].t, t));
    let i = 0; while (i < n - 2 && tc >= K[i + 1].t) i++;
    const a = K[i], b = K[i + 1];
    const H = (c) => hermite(a.t, b.t, ch[c].vs[i], ch[c].vs[i + 1], ch[c].ms[i], ch[c].ms[i + 1], tc);
    const D = Math.exp(H('logD')), el = H('el'), az = H('az');
    let target;
    if (a.anchor && a.anchor === b.anchor && anchors[a.anchor]) {
      const A = anchors[a.anchor];
      target = [0, 1, 2].map(j => A[j] + D * hermite(a.t, b.t, a.o[j], b.o[j], oT[i][j], oT[i + 1][j], tc));
    } else {
      target = [0, 1, 2].map(j => hermite(a.t, b.t, a.target[j], b.target[j], tT[i][j], tT[i + 1][j], tc));
    }
    const off = [Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)];
    const pos = [target[0] + D * off[0], target[1] + D * off[1], target[2] + D * off[2]];
    return { t, pos, target, fov: H('fov'), roll: H('roll'), D, fwd: [-off[0], -off[1], -off[2]] };
  };
}

/** Camera basis (double precision) for a rig sample: right/up/fwd, tan(fov/2). */
export function basis(k, aspect) {
  const f = k.fwd;
  let r = [-f[2], 0, f[0]];                   // cross(f, up=(0,1,0))
  const rl = Math.hypot(r[0], r[1], r[2]); r = r.map(v => v / rl);
  let u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  if (k.roll) {
    const c = Math.cos(k.roll * DEG), s = Math.sin(k.roll * DEG);
    const r2 = r.map((v, j) => v * c + u[j] * s), u2 = u.map((v, j) => -r[j] * s + v * c);
    r = r2; u = u2;
  }
  return { right: r, up: u, fwd: f, tanHalf: Math.tan(k.fov * DEG / 2), aspect };
}
/** World → NDC (x right, y up) and view depth, with a basis from `basis`. */
export function project(B, cam, p) {
  const v = [p[0] - cam[0], p[1] - cam[1], p[2] - cam[2]];
  const z = v[0] * B.fwd[0] + v[1] * B.fwd[1] + v[2] * B.fwd[2];
  const x = v[0] * B.right[0] + v[1] * B.right[1] + v[2] * B.right[2];
  const y = v[0] * B.up[0] + v[1] * B.up[1] + v[2] * B.up[2];
  return { x: x / (z * B.tanHalf * B.aspect), y: y / (z * B.tanHalf), z, d: Math.hypot(v[0], v[1], v[2]) };
}
/** NDC → unit world ray direction. */
export function unproject(B, x, y) {
  const d = [0, 1, 2].map(j => B.fwd[j] + x * B.aspect * B.tanHalf * B.right[j] + y * B.tanHalf * B.up[j]);
  const l = Math.hypot(d[0], d[1], d[2]);
  return d.map(v => v / l);
}
