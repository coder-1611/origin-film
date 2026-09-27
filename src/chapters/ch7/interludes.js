// The frieze between the plates: a continuous hand-drawn ground line joining each figure's
// ground, and three small interlude engravings standing on it (a storage jar, a book with
// quill and inkpot, a pair of meshing gears). Decoration only: no timeline events.
import { P, catmull, hatchPoly } from './draw-util.js';

const f = P.f;

/** Ground connectors in frieze px (x = wx·960, y down from screen centre). */
export const GROUND = [
  // [x, y] control points of each connector; ends meet the figures' own ground lines
  { pts: [[-360, 176], [-600, 176], [-900, 182], [-1300, 178]] },
  { pts: [[364, 174], [520, 192], [620, 204], [770, 204], [1000, 220], [1250, 238], [1500, 258]] },
  { pts: [[2340, 258], [2470, 266], [2560, 270], [2720, 270], [2900, 280], [3150, 292], [3510, 300]] },
  { pts: [[4280, 300], [4380, 290], [4450, 284], [4620, 284], [4800, 250], [5050, 200], [5290, 150]] },
  { pts: [[6230, 150], [6500, 156], [6900, 150]] },
];

export function buildGround(rng) {
  const S = [];
  GROUND.forEach((g, k) => {
    S.push({ d: catmull(g.pts), g: 'static', w: 0.75, i: 0.85, c: 'amber', ground: k });
    // tufts, pebbles and a little section hatching under the line
    let dd = '';
    const x0 = g.pts[0][0], x1 = g.pts[g.pts.length - 1][0];
    const yAt = (x) => { const p = g.pts; for (let i = 0; i < p.length - 1; i++) if (x <= p[i + 1][0]) { const u = (x - p[i][0]) / (p[i + 1][0] - p[i][0]); return p[i][1] + (p[i + 1][1] - p[i][1]) * (u * u * (3 - 2 * u)); } return p[p.length - 1][1]; };
    for (let x = x0 + 30; x < x1 - 20; x += 16 + rng() * 26) {
      const y = yAt(x) + 3, l = 6 + rng() * 9;
      dd += `M${f(x)} ${f(y + 1)}L${f(x - l * 0.8)} ${f(y + l * 0.6)}`;
    }
    S.push({ d: dd, g: 'static', w: 0.36, i: 0.32, c: 'amber', seq: true, ground: k, sub: true });
    let tuft = '';
    for (let x = x0 + 60; x < x1 - 40; x += 120 + rng() * 160) {
      const y = yAt(x);
      tuft += `M${f(x - 5)} ${f(y)}Q${f(x - 7)} ${f(y - 8)} ${f(x - 11)} ${f(y - 13)}M${f(x)} ${f(y)}Q${f(x + 1)} ${f(y - 10)} ${f(x - 1)} ${f(y - 18)}M${f(x + 4)} ${f(y)}Q${f(x + 8)} ${f(y - 7)} ${f(x + 12)} ${f(y - 11)}`;
      if (rng() < 0.5) tuft += P.circle(x + 24 + rng() * 20, y - 2, 1.6 + rng() * 1.5);
    }
    S.push({ d: tuft, g: 'static', w: 0.45, i: 0.55, c: 'amber', seq: true, ground: k, sub: true });
  });
  return { strokes: S, occluders: {}, extent: [-1400, -200, 7000, 400] };
}

// ---- a storage jar and a shallow bowl (wx ≈ 0.72, ground y 204)
export function buildJar(rng) {
  const S = [], add = (d, o) => S.push({ d, ...o });
  const gy = 204;
  const prof = [[16, 0], [30, -8], [42, -34], [44, -58], [38, -82], [22, -98], [15, -104], [16, -114], [22, -118]];
  const side = (sg) => catmull(prof.map(([x, y]) => [sg * x, gy + y]));
  add(side(-1), { g: 'static', a: 0.0, b: 0.35, w: 0.9, i: 1.25, c: 'gold' });
  add(side(1), { g: 'static', a: 0.03, b: 0.38, w: 1.1, i: 1.35, c: 'gold' });
  add(`M-22 ${gy - 118}C-10 ${gy - 122} 10 ${gy - 122} 22 ${gy - 118}M-16 ${gy}C-6 ${gy + 2} 6 ${gy + 2} 16 ${gy}`, { g: 'static', a: 0.3, b: 0.45, w: 0.7, i: 1.1, c: 'gold', seq: true });
  add(`M-17 ${gy - 102}C-40 ${gy - 110} -52 ${gy - 92} -38 ${gy - 80}M17 ${gy - 102}C40 ${gy - 110} 52 ${gy - 92} 38 ${gy - 80}`, { g: 'static', a: 0.4, b: 0.58, w: 0.75, i: 1.1, c: 'gold', seq: false });
  // painted bands: two rules, a zigzag and a wave
  const wAt = (y) => { let best = 0; for (let i = 0; i < prof.length - 1; i++) { const [xa, ya] = prof[i], [xb, yb] = prof[i + 1]; if ((y - ya) * (y - yb) <= 0) best = xa + (xb - xa) * (y - ya) / ((yb - ya) || 1); } return best; };
  let bands = '';
  for (const y of [-72, -66, -30]) { const w = wAt(y) - 2; bands += `M${f(-w)} ${f(gy + y)}C${f(-w * 0.4)} ${f(gy + y + 4)} ${f(w * 0.4)} ${f(gy + y + 4)} ${f(w)} ${f(gy + y)}`; }
  add(bands, { g: 'static', a: 0.45, b: 0.66, w: 0.5, i: 0.85, c: 'amber', seq: true });
  let zz = `M${f(-wAt(-58) + 3)} ${gy - 58}`;
  for (let k = 1; k <= 12; k++) { const x = -wAt(-58) + 3 + k * (2 * wAt(-58) - 6) / 12; zz += `L${f(x)} ${gy - (k % 2 ? 46 : 58) + 2 * Math.abs(x) / 44}`; }
  add(zz, { g: 'static', a: 0.55, b: 0.72, w: 0.45, i: 0.8, c: 'gold' });
  let hs = '';
  for (let y = -94; y < -6; y += 6) { const w = wAt(y); hs += `M${f(w - 3)} ${f(gy + y)}L${f(w - 9 - Math.abs(y + 50) * 0.04)} ${f(gy + y + 3)}`; }
  add(hs, { g: 'static', a: 0.6, b: 0.8, w: 0.36, i: 0.5, c: 'amber', seq: true });
  // a shallow bowl beside it
  add(`M58 ${gy - 20}C62 ${gy - 4} 104 ${gy - 4} 108 ${gy - 20}M58 ${gy - 20}C70 ${gy - 25} 96 ${gy - 25} 108 ${gy - 20}M72 ${gy - 6}L94 ${gy - 6}L92 ${gy}L74 ${gy}Z`,
    { g: 'static', a: 0.55, b: 0.8, w: 0.7, i: 1.0, c: 'amber', seq: true });
  return { strokes: S, occluders: {}, extent: [-70, gy - 140, 120, gy + 10] };
}

// ---- an open book, and a quill standing in an inkpot (wx ≈ 2.75, ground y 270)
export function buildBook(rng) {
  const S = [], add = (d, o) => S.push({ d, ...o });
  const gy = 270;
  add(`M-86 ${gy}L86 ${gy}L80 ${gy - 8}L-80 ${gy - 8}Z`, { g: 'static', a: 0.0, b: 0.25, w: 0.9, i: 1.2, c: 'amber' });
  // page blocks (left & right), each a stack of curves
  for (const sg of [-1, 1]) {
    let d = '';
    for (let k = 0; k < 5; k++) {
      const y0 = gy - 10 - k * 2.2, x1 = sg * (78 - k * 1.2);
      d += `M0 ${f(y0 - 4)}C${f(sg * 20)} ${f(y0 - 18 - k * 1.5)} ${f(sg * 52)} ${f(y0 - 20 - k * 1.5)} ${f(x1)} ${f(y0 - 6 - k * 2)}`;
    }
    add(d, { g: 'static', a: 0.12, b: 0.45, w: 0.55, i: 1.0, c: 'gold', seq: true });
    add(`M${sg * 80} ${gy - 8}L${sg * 72} ${gy - 26}`, { g: 'static', a: 0.2, b: 0.3, w: 0.6, i: 1.0, c: 'amber' });
    // lines of text following the page curvature
    let tx = '';
    for (let r = 0; r < 5; r++) {
      const u0 = 0.14, u1 = 0.86;
      let u = u0;
      while (u < u1) {
        const e = Math.min(u1, u + 0.05 + rng() * 0.1);
        const pt = (uu) => { const x = sg * uu * 72, y = gy - 24 - 14 * Math.sin(Math.PI * Math.pow(uu, 0.8)) + r * 3.6 + 2; return [x, y]; };
        const [xa, ya] = pt(u), [xb, yb] = pt(e);
        tx += `M${f(xa)} ${f(ya)}L${f(xb)} ${f(yb)}`;
        u = e + 0.03;
      }
    }
    add(tx, { g: 'static', a: 0.4, b: 0.75, w: 0.35, i: 0.7, c: 'gold', seq: true });
  }
  add(`M0 ${gy - 14}L0 ${gy - 8}`, { g: 'static', a: 0.3, b: 0.36, w: 0.6, i: 1.0, c: 'gold' });
  // inkpot
  const ix = 128;
  add(`M${ix - 16} ${gy}C${ix - 22} ${gy - 8} ${ix - 22} ${gy - 20} ${ix - 12} ${gy - 24}L${ix - 8} ${gy - 30}L${ix + 8} ${gy - 30}L${ix + 12} ${gy - 24}C${ix + 22} ${gy - 20} ${ix + 22} ${gy - 8} ${ix + 16} ${gy}Z` +
    `M${ix - 9} ${gy - 30}C${ix - 4} ${gy - 33} ${ix + 4} ${gy - 33} ${ix + 9} ${gy - 30}`, { g: 'static', a: 0.3, b: 0.55, w: 0.8, i: 1.15, c: 'gold', seq: true });
  // the quill: a curved spine with barbs either side
  const spine = [[ix + 2, gy - 24], [ix - 6, gy - 70], [ix - 24, gy - 120], [ix - 52, gy - 164], [ix - 84, gy - 196]];
  add(catmull(spine), { g: 'static', a: 0.45, b: 0.62, w: 0.7, i: 1.2, c: 'gold' });
  let barbs = '';
  for (let k = 0; k < 26; k++) {
    const u = 0.3 + 0.68 * k / 25, i0 = Math.min(3, Math.floor(u * 4)), fr = u * 4 - i0;
    const a = spine[i0], b = spine[i0 + 1];
    const x = a[0] + (b[0] - a[0]) * fr, y = a[1] + (b[1] - a[1]) * fr;
    const tx = b[0] - a[0], ty = b[1] - a[1], tl = Math.hypot(tx, ty), nx = -ty / tl, ny = tx / tl;
    const len = 14 * Math.sin(Math.PI * (u - 0.3) / 0.7) + 3;
    for (const sg of [-1, 1]) barbs += `M${f(x)} ${f(y)}Q${f(x + nx * sg * len * 0.6 - tx / tl * 3)} ${f(y + ny * sg * len * 0.6 - ty / tl * 3)} ${f(x + nx * sg * len - tx / tl * 8)} ${f(y + ny * sg * len - ty / tl * 8)}`;
  }
  add(barbs, { g: 'static', a: 0.55, b: 0.9, w: 0.38, i: 0.75, c: 'amber', seq: true });
  return { strokes: S, occluders: {}, extent: [-100, gy - 210, 160, gy + 10] };
}

// ---- meshing gears (wx ≈ 4.72, ground y 284); they turn once drawn
export const GEARS = (() => {
  const gy = 284;
  const A = { cx: -34, cy: gy - 68, n: 14, rr: 56, rt: 68 };
  const B = { n: 9, rr: 34, rt: 45 };
  const d = A.rr + 6 + B.rr + 5;
  B.cy = gy - 46; B.cx = A.cx + Math.sqrt(d * d - (B.cy - A.cy) ** 2);
  return { A, B, gy };
})();
function gearPath(g) {
  const pts = [];
  const n = g.n;
  for (let k = 0; k < n; k++) {
    const a0 = (k / n) * Math.PI * 2, st = Math.PI * 2 / n;
    for (const [fr, r] of [[0.0, g.rr], [0.18, g.rr], [0.3, g.rt], [0.62, g.rt], [0.74, g.rr]]) {
      const a = a0 + st * fr; pts.push([g.cx + Math.cos(a) * r, g.cy + Math.sin(a) * r]);
    }
  }
  return P.poly(pts, true);
}
export function buildGears(rng) {
  const S = [], add = (d, o) => S.push({ d, ...o });
  const { A, B, gy } = GEARS;
  add(gearPath(A), { g: 'gearA', a: 0.0, b: 0.45, w: 0.85, i: 1.3, c: 'gold' });
  add(P.circle(A.cx, A.cy, A.rr - 8) + P.circle(A.cx, A.cy, 16) + P.circle(A.cx, A.cy, 7), { g: 'gearA', a: 0.2, b: 0.5, w: 0.7, i: 1.15, c: 'gold', seq: true });
  let sp = '';
  for (let k = 0; k < 5; k++) {
    const a = k / 5 * Math.PI * 2, c = Math.cos(a), s = Math.sin(a), nx = -s, ny = c;
    for (const o of [-4.5, 4.5]) sp += `M${f(A.cx + c * 16 + nx * o)} ${f(A.cy + s * 16 + ny * o)}L${f(A.cx + c * (A.rr - 8) + nx * o * 1.4)} ${f(A.cy + s * (A.rr - 8) + ny * o * 1.4)}`;
  }
  add(sp, { g: 'gearA', a: 0.4, b: 0.65, w: 0.6, i: 1.0, c: 'amber', seq: true });
  add(gearPath(B), { g: 'gearB', a: 0.25, b: 0.62, w: 0.8, i: 1.25, c: 'gold' });
  add(P.circle(B.cx, B.cy, 11) + P.circle(B.cx, B.cy, 5), { g: 'gearB', a: 0.5, b: 0.66, w: 0.65, i: 1.1, c: 'gold', seq: true });
  let holes = '';
  for (let k = 0; k < 4; k++) { const a = k / 4 * Math.PI * 2 + 0.4; holes += P.circle(B.cx + Math.cos(a) * 21, B.cy + Math.sin(a) * 21, 5); }
  add(holes, { g: 'gearB', a: 0.6, b: 0.78, w: 0.5, i: 0.9, c: 'amber', seq: true });
  // a trestle bearing for each axle
  add(`M${f(A.cx - 30)} ${gy}L${f(A.cx)} ${f(A.cy)}L${f(A.cx + 30)} ${gy}M${f(B.cx - 20)} ${gy}L${f(B.cx)} ${f(B.cy)}L${f(B.cx + 20)} ${gy}`,
    { g: 'static', a: 0.1, b: 0.4, w: 0.55, i: 0.6, c: 'amber', seq: true, occ: ['disc'] });
  const disc = (g) => { const p = []; for (let k = 0; k < 24; k++) { const a = k / 24 * Math.PI * 2; p.push([g.cx + Math.cos(a) * (g.rr - 9), g.cy + Math.sin(a) * (g.rr - 9)]); } return p; };
  return { strokes: S, occluders: { disc: [disc(A), disc(B)] }, extent: [A.cx - 80, gy - 150, B.cx + 60, gy + 10] };
}
