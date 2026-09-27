// Fig. 2: THE WHEEL. A spoked cart wheel (iron tyre, six felloes, twelve tapered spokes,
// banded nave) inside a fixed blueprint: centre lines, a protractor ring and a diameter
// dimension. The wheel group spins about C; the drawing around it stays put.
import { P, taper, catmull } from './draw-util.js';

export const name = 'wheel';
export const C = [0, -22];
const R = 280;

export function build(rng) {
  const S = [];
  const add = (d, o) => S.push({ d, ...o });
  const [cx, cy] = C;
  const D = Math.PI / 180;
  const pol = (r, a) => [cx + r * Math.cos(a * D), cy + r * Math.sin(a * D)];

  // ---- blueprint first: centre lines and construction ring (dim, thin)
  add(P.dashed(cx - 350, cy, cx + 350, cy, 22, 6, true), { g: 'static', a: -0.4, b: -0.16, w: 0.45, i: 0.55, c: 'amber', seq: false });
  add(P.dashed(cx, cy - 350, cx, cy + 318, 22, 6, true), { g: 'static', a: -0.36, b: -0.12, w: 0.45, i: 0.55, c: 'amber', seq: false });
  add(P.dashedArc(cx, cy, 306, -90, 270, 5, 2.2), { g: 'static', a: -0.3, b: 0.08, w: 0.45, i: 0.5, c: 'amber', seq: true });
  let ticks = '';
  for (let a = -90; a < 270; a += 10) {
    const long = (a + 90) % 30 === 0;
    const [x0, y0] = pol(310, a), [x1, y1] = pol(long ? 324 : 316, a);
    ticks += `M${P.f(x0)} ${P.f(y0)}L${P.f(x1)} ${P.f(y1)}`;
  }
  add(ticks, { g: 'static', a: 0.62, b: 0.88, w: 0.5, i: 0.6, c: 'amber', seq: true });

  // ---- iron tyre, with nails
  add(P.arc(cx, cy, R, -90, 270), { g: 'rot', a: 0.0, b: 0.6, w: 1.15, i: 1.7, c: 'gold' });
  add(P.arc(cx, cy, R - 12, -80, 280), { g: 'rot', a: 0.04, b: 0.6, w: 0.8, i: 1.3, c: 'gold' });
  let nails = '';
  for (let k = 0; k < 18; k++) { const [x, y] = pol(R - 6, k * 20 + 10); nails += P.circle(x, y, 2.6); }
  add(nails, { g: 'rot', a: 0.5, b: 0.78, w: 0.55, i: 1.3, c: 'gold', seq: true });

  // ---- felloes: inner rim, six joints with dowels, and wood grain
  add(P.arc(cx, cy, 228, -60, 300), { g: 'rot', a: 0.18, b: 0.5, w: 0.95, i: 1.4, c: 'amber' });
  for (let k = 0; k < 6; k++) {
    const a = k * 60 + 15;
    const [x0, y0] = pol(228, a), [x1, y1] = pol(R - 12, a);
    add(`M${P.f(x0)} ${P.f(y0)}L${P.f(x1)} ${P.f(y1)}` + P.circle(...pol(242, a - 4), 2) + P.circle(...pol(256, a + 4), 2),
      { g: 'rot', a: 0.46 + k * 0.03, b: 0.56 + k * 0.03, w: 0.7, i: 1.2, c: 'amber', seq: true });
    let grain = '';
    grain += P.arc(cx, cy, 238 + rng() * 4, a + 6, a + 26 + rng() * 8);
    grain += P.arc(cx, cy, 250 + rng() * 4, a + 22, a + 44 + rng() * 8);
    grain += P.arc(cx, cy, 244 + rng() * 5, a + 40, a + 56);
    add(grain, { g: 'rot', a: 0.56 + k * 0.035, b: 0.72 + k * 0.035, w: 0.45, i: 0.7, c: 'amber', seq: true });
  }

  // ---- twelve tapered spokes, each with a grain line and a tenon collar at the rim
  for (let k = 0; k < 12; k++) {
    const a = k * 30 + 5;
    const [x0, y0] = pol(62, a), [x1, y1] = pol(228, a);
    const o = 0.3 + ((k * 5) % 12) / 12 * 0.26;
    add(taper(x0, y0, x1, y1, 11, 7), { g: 'rot', a: o, b: o + 0.16, w: 0.85, i: 1.35, c: 'amber' });
    const [g0x, g0y] = pol(84, a + 1.2), [g1x, g1y] = pol(200, a + 0.5);
    add(`M${P.f(g0x)} ${P.f(g0y)}L${P.f(g1x)} ${P.f(g1y)}`, { g: 'rot', a: o + 0.12, b: o + 0.24, w: 0.4, i: 0.6, c: 'amber' });
    // collar where the spoke meets the felloe
    const [c0x, c0y] = pol(214, a - 2.6), [c1x, c1y] = pol(214, a + 2.6);
    add(`M${P.f(c0x)} ${P.f(c0y)}L${P.f(c1x)} ${P.f(c1y)}`, { g: 'rot', a: o + 0.14, b: o + 0.2, w: 0.5, i: 0.8, c: 'amber' });
  }

  // ---- the nave (hub): bands, bolts, axle and linchpin
  add(P.circle(cx, cy, 62), { g: 'rot', a: 0.24, b: 0.4, w: 1.0, i: 1.5, c: 'gold' });
  add(P.circle(cx, cy, 54) + P.circle(cx, cy, 38), { g: 'rot', a: 0.3, b: 0.5, w: 0.7, i: 1.2, c: 'gold', seq: true });
  let bolts = '';
  for (let k = 0; k < 6; k++) { const [x, y] = pol(46, k * 60 + 35); bolts += P.circle(x, y, 3.2); }
  add(bolts, { g: 'rot', a: 0.5, b: 0.66, w: 0.55, i: 1.3, c: 'gold', seq: true });
  add(P.circle(cx, cy, 17) + P.circle(cx, cy, 7), { g: 'rot', a: 0.4, b: 0.56, w: 0.8, i: 1.7, c: 'hot', seq: true });
  add(`M${cx - 26} ${cy - 3}L${cx + 26} ${cy - 3}M${cx - 26} ${cy + 3}L${cx + 26} ${cy + 3}` + P.circle(cx + 30, cy, 4),
    { g: 'rot', a: 0.56, b: 0.66, w: 0.55, i: 1.2, c: 'gold', seq: true });

  // ---- diameter dimension above the wheel (fixed)
  const yd = cy - 346;
  add(`M${cx - R} ${cy - 8}L${cx - R} ${yd - 12}M${cx + R} ${cy - 8}L${cx + R} ${yd - 12}`, { g: 'static', a: 0.72, b: 0.86, w: 0.45, i: 0.55, c: 'amber', seq: false });
  add(`M${cx - R + 2} ${yd}L${cx - 12} ${yd}M${cx + 12} ${yd}L${cx + R - 2} ${yd}` + P.arrow(cx - R, yd, 180, 10) + P.arrow(cx + R, yd, 0, 10),
    { g: 'static', a: 0.8, b: 0.96, w: 0.5, i: 0.75, c: 'amber', seq: true });
  add(P.circle(cx, yd, 6.5) + `M${cx - 7} ${yd + 7}L${cx + 7} ${yd - 7}`, { g: 'static', a: 0.92, b: 1.0, w: 0.5, i: 0.9, c: 'gold', seq: true });

  // ---- ground: a line with section hatching, a rut and pebbles
  const yg = cy + R;
  add(`M${cx - 420} ${yg}L${cx + 420} ${yg}`, { g: 'static', a: 0.36, b: 0.62, w: 0.9, i: 1.0, c: 'amber' });
  let hat = '';
  for (let x = cx - 410; x < cx + 410; x += 13) {
    const l = 10 + ((x * 7919) % 5);
    hat += `M${P.f(x)} ${yg + 2}L${P.f(x - l)} ${P.f(yg + 2 + l)}`;
  }
  add(hat, { g: 'static', a: 0.5, b: 0.8, w: 0.4, i: 0.42, c: 'amber', seq: true });
  // rut the wheel has pressed: a shallow dip line trailing left
  add(catmull([[cx - 380, yg + 26], [cx - 250, yg + 24], [cx - 120, yg + 25], [cx - 30, yg + 22]]), { g: 'static', a: 0.66, b: 0.82, w: 0.45, i: 0.45, c: 'amber' });

  return { strokes: S, occluders: {}, extent: [-430, -390, 430, 300] };
}

/** Spin angle (radians, clockwise on screen) — spins up from the whoosh at bar 57. */
export function spin(t, t0) {
  const dur = 0.9, wmax = 2 * Math.PI * 0.42;
  const x = t - t0;
  if (x <= 0) return 0;
  if (x < dur) { const u = x / dur; return wmax * dur * (u * u * u - u * u * u * u / 2); }
  return wmax * (dur * 0.5 + (x - dur));
}
