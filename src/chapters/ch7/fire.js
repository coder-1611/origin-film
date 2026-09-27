// Fig. 1: FIRE. A campfire as a luminous engraving: licking flame tongues with inner
// flow lines, a coal bed, two crossed logs with bark and end-grain, a ring of hearth
// stones, ground hatching and smoke. Local px at 1080p, y down, origin = the ember.
import { P, blob, catmull, wavy } from './draw-util.js';

export const name = 'fire';

export function build(rng) {
  const S = [];
  const add = (d, o) => S.push({ d, ...o });

  // ---- coal bed: spreads left and right out of the ember first
  add('M0 9C-20 12 -40 11 -64 5', { g: 'coals', a: 0.0, b: 0.07, w: 0.9, i: 1.8, c: 'hot' });
  add('M0 9C20 12 42 11 66 5', { g: 'coals', a: 0.0, b: 0.07, w: 0.9, i: 1.8, c: 'hot' });
  add(blob(-34, 16, 12, 5, rng) + blob(-6, 20, 10, 4.5, rng) + blob(24, 17, 13, 5, rng) + blob(50, 13, 8, 4, rng) + blob(-56, 11, 8, 4, rng),
    { g: 'coals', a: 0.05, b: 0.2, w: 0.6, i: 1.3, c: 'hot', seq: true });

  // ---- flame tongues: each is a left and right edge rising from the coal bed to a tip.
  // tg = tongue id (edges of one tongue flicker together).
  const T = (tg, a, b, i, ...ds) => ds.forEach(d => add(d, { g: 'flame', tg, a, b, w: 0.95, i, c: 'gold' }));
  // A: the central tongue
  T(0, 0.05, 0.34, 2.1,
    'M-52 6C-90 -36 -86 -94 -54 -136C-28 -170 -46 -208 -28 -248C-16 -274 -4 -296 6 -318',
    'M54 6C88 -42 74 -100 44 -144C22 -176 40 -216 28 -252C20 -278 12 -300 6 -318');
  // F: its hot inner core
  T(0, 0.08, 0.3, 2.4,
    'M-24 -2C-44 -52 -30 -100 -12 -140C-2 -162 -10 -178 -2 -198',
    'M26 -2C40 -56 22 -104 12 -142C6 -164 4 -182 -2 -198');
  // B (left) and C (right)
  T(1, 0.12, 0.4, 1.8,
    'M-66 6C-112 -16 -136 -64 -116 -104C-98 -136 -124 -162 -112 -202',
    'M-30 -20C-56 -54 -56 -94 -80 -126C-96 -148 -106 -172 -112 -202');
  T(2, 0.1, 0.42, 1.85,
    'M68 6C130 -18 142 -80 114 -124C96 -152 126 -192 116 -238',
    'M36 -24C64 -64 58 -106 84 -144C100 -168 110 -198 116 -238');
  // D (far left) and E (far right): small outer licks
  T(3, 0.2, 0.46, 1.5,
    'M-112 10C-160 -2 -186 -34 -170 -62C-160 -80 -176 -90 -168 -106',
    'M-104 -4C-126 -18 -140 -44 -152 -68C-158 -82 -164 -94 -168 -106');
  T(4, 0.2, 0.47, 1.5,
    'M112 10C168 0 190 -38 170 -72C160 -90 178 -104 172 -124',
    'M104 -6C130 -20 138 -50 152 -78C160 -94 168 -108 172 -124');
  // G, H: tongues tucked between the big ones
  T(5, 0.22, 0.46, 1.4, 'M-58 -8C-74 -42 -60 -82 -72 -112C-78 -128 -70 -140 -66 -154');
  T(6, 0.22, 0.46, 1.4, 'M60 -8C78 -46 64 -92 76 -126C80 -144 74 -158 70 -172');
  // flow lines inside the tongues (engraver's hatching that follows the flame)
  T(0, 0.26, 0.52, 1.0,
    'M-38 -24C-54 -78 -36 -122 -32 -162', 'M36 -28C46 -84 30 -128 32 -172',
    'M-14 -212C-20 -238 -8 -264 0 -286', 'M14 -206C18 -232 10 -258 4 -280');
  T(0, 0.3, 0.56, 0.8,
    'M-22 -40C-32 -90 -18 -128 -16 -176', 'M20 -44C28 -94 14 -134 16 -182',
    'M-46 -60C-58 -104 -44 -140 -40 -186C-38 -206 -30 -224 -26 -240', 'M48 -70C58 -112 44 -150 40 -196C38 -216 34 -232 32 -246');
  T(0, 0.34, 0.5, 1.3, 'M30 -228C50 -248 60 -272 52 -296C48 -306 40 -310 34 -305');
  T(11, 0.24, 0.5, 1.2, 'M-40 -10C-56 -50 -44 -92 -54 -128C-58 -142 -52 -154 -50 -168');
  T(3, 0.3, 0.52, 1.1, 'M-118 14C-150 8 -170 -12 -178 -32C-184 -46 -198 -50 -206 -42C-210 -36 -206 -30 -200 -32');
  T(4, 0.3, 0.52, 1.1, 'M118 14C150 8 172 -14 180 -36C186 -50 200 -54 208 -46C212 -40 208 -34 202 -36');
  T(1, 0.28, 0.54, 0.9, 'M-70 -40C-92 -76 -88 -116 -100 -152', 'M-54 -30C-74 -64 -70 -100 -84 -136');
  T(2, 0.3, 0.56, 0.85, 'M60 -40C80 -80 76 -120 92 -160');
  T(2, 0.28, 0.54, 0.9, 'M78 -58C96 -98 92 -140 106 -184');
  // curled tips and detached wisps
  T(0, 0.32, 0.46, 1.4, 'M6 -318C12 -334 30 -336 32 -322C33 -312 24 -308 19 -313');
  T(1, 0.36, 0.5, 1.2, 'M-112 -202C-118 -216 -134 -218 -136 -205C-137 -196 -128 -193 -124 -198');
  T(7, 0.36, 0.6, 1.5, 'M-24 -300C-44 -314 -46 -338 -36 -364C-28 -344 -16 -326 -24 -300Z');
  T(8, 0.38, 0.62, 1.4, 'M48 -276C34 -292 36 -312 50 -336C58 -314 62 -294 48 -276Z');
  T(9, 0.42, 0.64, 1.2, 'M-96 -228C-110 -240 -110 -258 -100 -274C-94 -260 -88 -244 -96 -228Z');
  T(10, 0.42, 0.66, 1.2, 'M130 -262C120 -276 122 -292 134 -306C140 -290 142 -276 130 -262Z');

  // ---- logs. L1 in front (lower-left → right), L2 behind it (crossing the other way).
  const L1 = { x0: -214, y0: 74, x1: 198, y1: 40, r: 25 };
  const L2 = { x0: -176, y0: 30, x1: 236, y1: 92, r: 21 };
  const logPoly = (L) => {
    const dx = L.x1 - L.x0, dy = L.y1 - L.y0, len = Math.hypot(dx, dy), nx = -dy / len, ny = dx / len;
    return [[L.x0 + nx * L.r, L.y0 + ny * L.r], [L.x1 + nx * L.r, L.y1 + ny * L.r], [L.x1 - nx * L.r, L.y1 - ny * L.r], [L.x0 - nx * L.r, L.y0 - ny * L.r]];
  };
  const logStrokes = (L, a, b, id) => {
    const dx = L.x1 - L.x0, dy = L.y1 - L.y0, len = Math.hypot(dx, dy), ux = dx / len, uy = dy / len, nx = -uy, ny = ux;
    const at = (s, o) => [L.x0 + ux * s + nx * o, L.y0 + uy * s + ny * o];
    const edge = (o) => { const pts = []; for (let k = 0; k <= 8; k++) { const s = (k / 8) * len; pts.push(at(s, o + (rng() - 0.5) * 3.2)); } return catmull(pts); };
    add(edge(-L.r), { g: 'static', a, b: a + 0.18, w: 0.85, i: 1.3, c: 'amber', occ: id === 2 ? ['L1', 'coalbed'] : ['coalbed'] });
    add(edge(L.r), { g: 'static', a: a + 0.02, b: a + 0.2, w: 1.0, i: 1.3, c: 'amber', occ: id === 2 ? ['L1', 'coalbed'] : ['coalbed'] });
    // end grain on the cool end
    const ang = Math.atan2(dy, dx) * 180 / Math.PI;
    const [ex, ey] = at(0, 0);
    add(P.ellipse(ex, ey, L.r * 0.42, L.r, ang) + P.ellipse(ex + ux * 1.5, ey + uy * 1.5, L.r * 0.27, L.r * 0.64, ang) + P.ellipse(ex + ux * 2.5, ey + uy * 2.5, L.r * 0.12, L.r * 0.3, ang),
      { g: 'static', a: a + 0.12, b: a + 0.3, w: 0.7, i: 1.1, c: 'amber', seq: true, occ: id === 2 ? ['L1', 'stones'] : ['stones'] });
    const [cx0, cy0] = at(2, -L.r * 0.1), [cx1, cy1] = at(3, -L.r * 0.9);
    add(`M${P.f(cx0)} ${P.f(cy0)}L${P.f(cx1)} ${P.f(cy1)}`, { g: 'static', a: a + 0.25, b: a + 0.3, w: 0.5, i: 0.9, c: 'amber' });
    // charred end: jagged, with glowing cracks
    let d = '';
    const p0 = at(len, -L.r);
    d += `M${P.f(p0[0])} ${P.f(p0[1])}`;
    for (let k = 1; k <= 6; k++) { const o = -L.r + (2 * L.r) * k / 6; const [x, y] = at(len + (k % 2 ? 7 : -3) + (rng() - 0.5) * 4, o); d += `L${P.f(x)} ${P.f(y)}`; }
    add(d, { g: 'static', a: a + 0.1, b: a + 0.24, w: 0.8, i: 1.6, c: 'hot', occ: id === 2 ? ['L1'] : [] });
    // bark: short strokes along the length
    let bark = '';
    for (let k = 0; k < 26; k++) {
      const s = 14 + rng() * (len - 40), o = (rng() * 2 - 1) * L.r * 0.78, l = 16 + rng() * 34;
      const bend = (rng() - 0.5) * 5;
      const [x0, y0] = at(s, o), [xm, ym] = at(s + l / 2, o + bend), [x1, y1] = at(s + l, o + (rng() - 0.5) * 3);
      bark += `M${P.f(x0)} ${P.f(y0)}Q${P.f(xm)} ${P.f(ym)} ${P.f(x1)} ${P.f(y1)}`;
    }
    add(bark, { g: 'static', a: a + 0.18, b: a + 0.42, w: 0.5, i: 0.75, c: 'amber', seq: true, occ: id === 2 ? ['L1', 'coalbed', 'stones'] : ['coalbed', 'stones'] });
    // engraver's shading: short hatches across the underside
    let sh = '';
    for (let s2 = 16; s2 < len - 14; s2 += 8 + rng() * 3) {
      const [x0, y0] = at(s2, L.r * (0.35 + rng() * 0.15)), [x1, y1] = at(s2 + 4, L.r * 0.92);
      sh += `M${P.f(x0)} ${P.f(y0)}L${P.f(x1)} ${P.f(y1)}`;
    }
    add(sh, { g: 'static', a: a + 0.2, b: a + 0.46, w: 0.38, i: 0.55, c: 'amber', seq: true, occ: id === 2 ? ['L1', 'coalbed', 'stones'] : ['coalbed', 'stones'] });
    // a knot
    const [kx, ky] = at(len * 0.34, L.r * 0.2);
    add(P.ellipse(kx, ky, 7, 4, ang) + `M${P.f(kx - 16)} ${P.f(ky - 7)}Q${P.f(kx)} ${P.f(ky - 14)} ${P.f(kx + 16)} ${P.f(ky - 6)}`,
      { g: 'static', a: a + 0.3, b: a + 0.4, w: 0.55, i: 0.9, c: 'amber', seq: true, occ: id === 2 ? ['L1'] : [] });
  };
  logStrokes(L1, 0.34, 0.7, 1);
  logStrokes(L2, 0.42, 0.78, 2);

  // ---- hearth stones (front arc) + two behind
  const stones = [
    [-270, 94, 30, 21], [-220, 124, 34, 23], [-152, 143, 38, 24], [-76, 153, 37, 23], [4, 157, 40, 24],
    [84, 153, 37, 23], [158, 142, 38, 24], [222, 121, 32, 22], [270, 93, 28, 20],
  ];
  const stonePolys = [];
  stones.forEach(([x, y, rx, ry], k) => {
    const d = blob(x, y, rx, ry, rng, { n: 10, jit: 0.12, rot: rng() * 6, flat: 0.25 });
    stonePolys.push({ x, y, rx: rx * 1.02, ry: ry * 1.02 });
    const a = 0.52 + (k / stones.length) * 0.3;
    add(d, { g: 'static', a, b: a + 0.16, w: 0.95, i: 1.15, c: 'amber' });
    // lit upper face: short arcs following the curvature
    let h = '';
    for (let j = 0; j < 3; j++) {
      const rr = 0.72 - j * 0.2, s0 = 200 + rng() * 20, s1 = 320 - rng() * 20;
      const pts = [];
      for (let q = 0; q <= 6; q++) { const aa = (s0 + (s1 - s0) * q / 6) * Math.PI / 180; pts.push([x + Math.cos(aa) * rx * rr, y + Math.sin(aa) * ry * rr * 0.9]); }
      h += catmull(pts);
    }
    add(h, { g: 'static', a: a + 0.1, b: a + 0.22, w: 0.5, i: 0.75, c: 'gold', seq: true });
    // shadow contour at the base
    add(`M${P.f(x - rx * 0.8)} ${P.f(y + ry * 0.55)}Q${P.f(x)} ${P.f(y + ry * 0.95)} ${P.f(x + rx * 0.85)} ${P.f(y + ry * 0.5)}`,
      { g: 'static', a: a + 0.12, b: a + 0.2, w: 0.45, i: 0.55, c: 'amber' });
  });
  add(blob(-236, 54, 22, 13, rng, { flat: 0.2 }), { g: 'static', a: 0.6, b: 0.72, w: 0.7, i: 0.8, c: 'amber', occ: ['L1', 'L2', 'stones'] });
  add(blob(244, 52, 22, 13, rng, { flat: 0.2 }), { g: 'static', a: 0.62, b: 0.74, w: 0.7, i: 0.8, c: 'amber', occ: ['L1', 'L2', 'stones'] });

  // ---- ground: a broken contour, hatching, tufts and pebbles
  add('M-360 176C-300 172 -250 178 -190 175M-160 178C-100 181 -40 177 20 180C80 183 130 178 190 176M214 175C262 172 310 177 364 174',
    { g: 'static', a: 0.7, b: 0.92, w: 0.7, i: 0.8, c: 'amber', seq: true, occ: ['stones'] });
  let gh = '';
  for (let k = 0; k < 34; k++) {
    const x = -340 + k * 20 + (rng() - 0.5) * 8, y = 184 + rng() * 10, l = 8 + rng() * 14;
    gh += `M${P.f(x)} ${P.f(y)}L${P.f(x + l)} ${P.f(y + 0.5)}`;
  }
  add(gh, { g: 'static', a: 0.78, b: 0.98, w: 0.45, i: 0.45, c: 'amber', seq: true });
  for (const [x, y] of [[-318, 175], [-196, 176], [206, 176], [318, 174]]) {
    add(`M${x - 6} ${y}Q${x - 8} ${y - 10} ${x - 12} ${y - 16}M${x} ${y}Q${x + 1} ${y - 12} ${x - 1} ${y - 22}M${x + 5} ${y}Q${x + 9} ${y - 9} ${x + 14} ${y - 14}`,
      { g: 'static', a: 0.84, b: 0.98, w: 0.5, i: 0.7, c: 'amber', seq: true });
  }
  let peb = '';
  for (let k = 0; k < 9; k++) peb += P.circle(-300 + rng() * 600, 190 + rng() * 10, 1.5 + rng() * 2);
  add(peb, { g: 'static', a: 0.86, b: 1.0, w: 0.45, i: 0.6, c: 'amber', seq: true });

  // ---- smoke curling up from the tips
  add(wavy(-8, -366, -30, -500, 12, 1.6, 0.3), { g: 'smoke', a: 0.62, b: 0.95, w: 0.6, i: 0.42, c: 'amber', fadeEnd: true });
  add(wavy(38, -350, 70, -492, 10, 1.4, 2.1), { g: 'smoke', a: 0.66, b: 0.98, w: 0.55, i: 0.36, c: 'amber', fadeEnd: true });
  add(wavy(-52, -330, -86, -440, 8, 1.1, 4.0), { g: 'smoke', a: 0.7, b: 1.0, w: 0.5, i: 0.3, c: 'amber', fadeEnd: true });
  add('M-30 -500C-40 -514 -26 -526 -16 -518C-8 -512 -14 -502 -22 -506', { g: 'smoke', a: 0.9, b: 1.0, w: 0.5, i: 0.3, c: 'amber' });

  // Occluders (local polygons): front log hides the back one, stones hide log ends.
  const occluders = {
    L1: [logPoly(L1)],
    L2: [logPoly(L2)],
    coalbed: [[[-62, 4], [-30, -2], [30, -2], [64, 4], [40, 24], [-40, 24]]],
    stones: stonePolys.map(({ x, y, rx, ry }) => { const p = []; for (let k = 0; k < 16; k++) { const a = k / 16 * Math.PI * 2; p.push([x + Math.cos(a) * rx, y + Math.sin(a) * ry]); } return p; }),
  };
  return { strokes: S, occluders, extent: [-380, -530, 380, 210] };
}

// ---- animation: flame flicker (path noise that grows with height), smoke drift.
// g: 1 = flame, 2 = smoke (group codes assigned by the chapter module).
export function deform(g, tg, x, y, t, k, out) {
  if (g === 1) {                       // flame
    const h = Math.max(0, -y);
    const amp = (1.2 + 15 * Math.pow(h / 320, 1.25)) * k.flick;
    const ph = tg * 1.917;
    const dx = amp * (0.62 * Math.sin(0.029 * y + 8.3 * t + ph) + 0.38 * Math.sin(0.067 * y + 13.1 * t + ph * 2.3));
    const stretch = 1 + k.flick * (0.055 * Math.sin(5.1 * t + ph) + 0.035 * Math.sin(11.3 * t + ph * 0.7)) + k.leap;
    out[0] = x * (1 + 0.03 * k.leap) + dx; out[1] = y * stretch;
    return;
  }
  if (g === 2) {                       // smoke
    const h = Math.max(0, -y - 330);
    out[0] = x + (4 + h * 0.12) * Math.sin(0.021 * y + 1.7 * t) + h * 0.08 * Math.sin(0.6 * t);
    out[1] = y - 6 * Math.sin(0.9 * t);
    return;
  }
  out[0] = x; out[1] = y;
}
