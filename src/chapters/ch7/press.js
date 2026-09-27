// Fig. 3: THE PRINTING PRESS. A Gutenberg wooden screw press in elevation, with
// patent-drawing shade lines (right and bottom edges heavier), wood grain, the great screw,
// the bar, the platen that stamps, the carriage running out on its rails, ink balls and
// freshly printed sheets drying on a cord overhead.
import { P, catmull, wavy, bolt, rrect } from './draw-util.js';

export const name = 'press';
export const PIVOT = [0, -128];
export const DROP = 50;
export const RECTS = {
  head: [-186, -300, 186, -252],
  till: [-112, -160, 112, -140],
  rails: [-236, 22, 404, 36],
  coffin: [-118, -4, 262, 22],
  nut: [-38, -296, 38, -256],
};

export function build(rng) {
  const S = [];
  const add = (d, o) => S.push({ d, ...o });
  const f = P.f;
  /** A box with shade lines: top+left thin, right+bottom heavy. */
  const box = (x0, y0, x1, y1, o) => {
    add(`M${f(x0)} ${f(y1)}L${f(x0)} ${f(y0)}L${f(x1)} ${f(y0)}`, { w: 0.8, i: 1.25, c: 'amber', ...o });
    add(`M${f(x1)} ${f(y0)}L${f(x1)} ${f(y1)}L${f(x0)} ${f(y1)}`, { w: 1.25, i: 1.5, c: 'amber', ...o, a: o.a + 0.03, b: o.b + 0.03 });
  };
  const grainIn = (x0, y0, x1, y1, n, vertical, o) => {
    let d = '';
    for (let k = 0; k < n; k++) {
      if (vertical) { const x = x0 + (x1 - x0) * (k + 0.5 + (rng() - 0.5) * 0.4) / n; d += wavy(x, y0 + 8 + rng() * 30, x + (rng() - 0.5) * 3, y1 - 8 - rng() * 40, 1.4 + rng() * 1.4, 3 + rng() * 3, rng() * 6, 40); }
      else { const y = y0 + (y1 - y0) * (k + 0.5 + (rng() - 0.5) * 0.4) / n; d += wavy(x0 + 6 + rng() * 20, y, x1 - 6 - rng() * 20, y + (rng() - 0.5) * 2, 1.2 + rng(), 4 + rng() * 3, rng() * 6, 40); }
    }
    add(d, { w: 0.38, i: 0.42, c: 'amber', seq: true, ...o });
  };

  // ---- floor with section hatching
  add('M-330 300L440 300', { g: 'static', a: 0.0, b: 0.2, w: 1.0, i: 1.0, c: 'amber' });
  let fh = '';
  for (let x = -322; x < 440; x += 12) fh += `M${x} 302L${x - 13} 315`;
  add(fh, { g: 'static', a: 0.12, b: 0.34, w: 0.4, i: 0.4, c: 'amber', seq: true });

  // ---- the two cheeks: tall posts with feet, stop-chamfers, grain, knots, pegs
  for (const s of [-1, 1]) {
    const xo = s < 0 ? -150 : 112, xi = xo + 38;
    box(xo, -252, xi, 272, { g: 'static', a: 0.03, b: 0.24, clip: ['rails', 'coffin'] });
    box(s < 0 ? -178 : 84, 272, s < 0 ? -84 : 178, 300, { g: 'static', a: 0.14, b: 0.26 });
    add(`M${xo + 5} -240L${xo + 5} 262M${xi - 5} -240L${xi - 5} 262`, { g: 'static', a: 0.22, b: 0.42, w: 0.38, i: 0.5, c: 'amber', clip: ['rails', 'coffin'] });
    add(`M${xo + 5} -240L${xo + 11} -232M${xi - 5} -240L${xi - 11} -232M${xo + 5} 262L${xo + 11} 254M${xi - 5} 262L${xi - 11} 254`,
      { g: 'static', a: 0.4, b: 0.48, w: 0.38, i: 0.5, c: 'amber', seq: true });
    grainIn(xo + 8, -246, xi - 8, 262, 3, true, { g: 'static', a: 0.34, b: 0.6, clip: ['rails', 'coffin'] });
    const kx = xo + 19, ky = 150 + rng() * 60 * s;
    add(P.ellipse(kx, ky, 3.5, 8) + P.ellipse(kx, ky, 6.5, 14), { g: 'static', a: 0.56, b: 0.64, w: 0.4, i: 0.5, c: 'amber', seq: true });
    let pegs = '';
    for (const y of [-280, -266, -154, -146, 50, 62]) pegs += P.circle(xo + 19, y, 2.8);
    add(pegs, { g: 'static', a: 0.6, b: 0.74, w: 0.5, i: 1.0, c: 'gold', seq: true });
  }

  // ---- head beam, crown moulding, finial, nut plate
  box(-186, -300, 186, -252, { g: 'static', a: 0.08, b: 0.28 });
  grainIn(-178, -296, 178, -256, 2, false, { g: 'static', a: 0.38, b: 0.58, clip: ['nut'] });
  add('M-170 -300L-170 -312C-170 -322 -162 -328 -150 -328L150 -328C162 -328 170 -322 170 -312L170 -300', { g: 'static', a: 0.18, b: 0.36, w: 0.95, i: 1.3, c: 'gold' });
  add('M-160 -310L160 -310', { g: 'static', a: 0.28, b: 0.4, w: 0.4, i: 0.55, c: 'amber' });
  add('M-8 -328L-5 -335M8 -328L5 -335' + P.circle(0, -345, 10) + P.circle(0, -345, 4), { g: 'static', a: 0.34, b: 0.44, w: 0.7, i: 1.3, c: 'gold', seq: true });
  add(rrect(-36, -294, 72, 36, 4), { g: 'static', a: 0.32, b: 0.44, w: 0.7, i: 1.2, c: 'gold' });
  add(bolt(-28, -287, 3) + bolt(28, -287, 3) + bolt(-28, -265, 3) + bolt(28, -265, 3), { g: 'static', a: 0.44, b: 0.54, w: 0.45, i: 1.0, c: 'gold', seq: true });

  // ---- till (guides the hose)
  box(-112, -160, 112, -140, { g: 'static', a: 0.14, b: 0.26 });
  add('M-106 -154L106 -154', { g: 'static', a: 0.32, b: 0.44, w: 0.38, i: 0.5, c: 'amber' });

  // ---- the great screw: body, helical threads, shading (descends with the stamp)
  add('M-22 -252L-22 -142M22 -252L22 -142', { g: 'screw', a: 0.18, b: 0.3, w: 0.85, i: 1.35, c: 'gold', clip: ['head', 'till'] });
  let th = '';
  for (let y = -250; y < -140; y += 11) th += `M-22 ${y + 7}C-8 ${y + 4} 8 ${y - 1} 22 ${y - 5}`;
  add(th, { g: 'screw', a: 0.38, b: 0.58, w: 0.6, i: 1.15, c: 'gold', seq: true, clip: ['head', 'till'] });
  add('M-16 -252L-16 -142M16 -252L16 -142', { g: 'screw', a: 0.48, b: 0.6, w: 0.35, i: 0.45, c: 'amber', clip: ['head', 'till'] });

  // ---- spindle eye, hose and platen (descend together on the stamp)
  add(rrect(-15, -142, 30, 26, 3), { g: 'hose', a: 0.22, b: 0.28, w: 0.75, i: 1.2, c: 'gold', clip: ['till'] });
  box(-30, -116, 30, -80, { g: 'hose', a: 0.22, b: 0.32 });
  add('M-24 -110L24 -110M-24 -86L24 -86', { g: 'hose', a: 0.48, b: 0.56, w: 0.38, i: 0.55, c: 'amber' });
  box(-100, -80, 100, -58, { g: 'hose', a: 0.24, b: 0.33 });
  add('M-95 -63L95 -63', { g: 'hose', a: 0.32, b: 0.37, w: 0.5, i: 0.8, c: 'gold' });
  add('M-94 -74L-34 -74M34 -74L94 -74', { g: 'hose', a: 0.58, b: 0.7, w: 0.33, i: 0.42, c: 'amber', seq: true });
  add(bolt(-86, -70, 3) + bolt(86, -70, 3), { g: 'hose', a: 0.64, b: 0.74, w: 0.45, i: 1.0, c: 'gold', seq: true });
  add('M-30 -104C-56 -102 -80 -94 -92 -80M30 -104C56 -102 80 -94 92 -80', { g: 'hose', a: 0.6, b: 0.72, w: 0.42, i: 0.7, c: 'amber', seq: false });

  // ---- the bar, pulled from the left, with a turned handle
  add('M-12 -134L-236 -126M-12 -122L-236 -117', { g: 'bar', a: 0.28, b: 0.36, w: 0.75, i: 1.3, c: 'gold', seq: false });
  add('M-236 -127C-248 -130 -258 -130 -270 -127L-282 -126C-288 -129 -296 -128 -298 -122C-296 -116 -288 -115 -282 -118L-270 -117C-258 -114 -248 -114 -236 -117',
    { g: 'bar', a: 0.33, b: 0.39, w: 0.75, i: 1.3, c: 'gold' });
  add('M-40 -129L-226 -122', { g: 'bar', a: 0.62, b: 0.72, w: 0.33, i: 0.45, c: 'amber' });

  // ---- paper on the forme, the coffin (carriage bed) running out right, rails, winter, horse
  add('M-96 -8L96 -8M-96 -8L-96 -4M96 -8L96 -4', { g: 'static', a: 0.3, b: 0.36, w: 0.6, i: 1.1, c: 'gold', seq: true });
  box(-118, -4, 262, 22, { g: 'static', a: 0.22, b: 0.33 });
  add('M-112 4L256 4M-112 14L256 14', { g: 'static', a: 0.54, b: 0.66, w: 0.35, i: 0.45, c: 'amber', seq: true });
  add(bolt(-108, 9, 2.6) + bolt(252, 9, 2.6) + bolt(130, 9, 2.6), { g: 'static', a: 0.64, b: 0.72, w: 0.45, i: 0.9, c: 'gold', seq: true });
  box(-236, 22, 404, 36, { g: 'static', a: 0.28, b: 0.5 });
  add('M-236 22L-242 26L-242 32L-236 36M404 22L410 26L410 32L404 36', { g: 'static', a: 0.48, b: 0.54, w: 0.6, i: 1.0, c: 'amber', seq: true });
  box(-112, 36, 112, 70, { g: 'static', a: 0.32, b: 0.5 });
  // the horse: an A-frame trestle carrying the rails' outer end
  add('M356 36L330 300M366 36L340 300M392 36L418 300M382 36L408 300M338 196L410 196M336 206L412 206', { g: 'static', a: 0.36, b: 0.56, w: 0.8, i: 1.15, c: 'amber', seq: false });
  // a stack of fresh paper waiting on the carriage's far end
  let stack = '';
  for (let k = 0; k < 7; k++) stack += `M${300 + k * 0.6} ${-6 - k * 3.2}L${396 - k * 0.4} ${-5 - k * 3.2}`;
  add(stack + 'M300 -4L300 -28M396 -4L396 -27', { g: 'static', a: 0.62, b: 0.76, w: 0.45, i: 0.85, c: 'gold', seq: true });

  // ---- ink balls on the rail's left end
  for (const [x, lean] of [[-196, -8], [-150, 12]]) {
    const c = Math.cos(lean * Math.PI / 180), s = Math.sin(lean * Math.PI / 180);
    const T = (px, py) => [x + px * c - py * s, 22 + px * s + py * c];
    const pts = (arr) => arr.map(([px, py]) => T(px, py));
    add(catmull(pts([[-22, 0], [-20, -12], [-11, -22], [0, -25], [11, -22], [20, -12], [22, 0]])) + P.poly(pts([[-22, 0], [22, 0]])),
      { g: 'static', a: 0.58, b: 0.7, w: 0.8, i: 1.2, c: 'amber', seq: true });
    let fur = '';
    for (let k = 0; k < 6; k++) { const u = -15 + k * 6; fur += catmull(pts([[u, -3], [u * 0.9, -11], [u * 0.6, -18]])); }
    add(fur, { g: 'static', a: 0.66, b: 0.78, w: 0.33, i: 0.45, c: 'amber', seq: true });
    add(catmull(pts([[-5, -25], [-6, -36], [-9, -43], [-5, -50], [-4, -62], [-7, -67], [0, -72]])) +
        catmull(pts([[5, -25], [6, -36], [9, -43], [5, -50], [4, -62], [7, -67], [0, -72]])),
      { g: 'static', a: 0.62, b: 0.76, w: 0.6, i: 1.1, c: 'gold', seq: false });
  }

  // ---- drying cord with four sheets (their text is struck on the stamps)
  const cordY = (x) => -392 + 22 * (1 - (x / 400) ** 2);
  add(catmull([[-320, cordY(-320)], [-160, cordY(-160)], [0, cordY(0)], [160, cordY(160)], [400, cordY(400)]]), { g: 'static', a: 0.56, b: 0.84, w: 0.5, i: 0.7, c: 'amber' });
  add('M-320 -380L-326 -372M400 -380L406 -372', { g: 'static', a: 0.8, b: 0.86, w: 0.5, i: 0.7, c: 'amber', seq: true });
  const sheets = [[-226, 0], [-300, 1], [226, 2], [300, 3]];
  for (const [x, k] of sheets) {
    const y = cordY(x) + 1, w = 64, h = 86, tilt = (rng() - 0.5) * 3;
    add(P.poly([[x - w / 2, y], [x + w / 2, y + tilt], [x + w / 2 + 1, y + h + tilt], [x - w / 2 + 1, y + h]], true),
      { g: 'static', a: 0.64 + k * 0.03, b: 0.76 + k * 0.03, w: 0.6, i: 1.0, c: 'amber' });
    add(rrect(x - 14, y - 5, 5, 10, 1) + rrect(x + 9, y - 5, 5, 10, 1), { g: 'static', a: 0.76, b: 0.84, w: 0.45, i: 0.8, c: 'amber', seq: true });
    let tx = P.rect(x - 25, y + 10, 9, 9) + `M${f(x - 23)} ${f(y + 17)}C${f(x - 22)} ${f(y + 12)} ${f(x - 19)} ${f(y + 12)} ${f(x - 18)} ${f(y + 16)}`;
    for (const col of [0, 1]) {
      const x0 = x - 26 + col * 27;
      for (let r = 0; r < 11; r++) {
        const yy = y + 12 + r * 6.2;
        let xx = x0 + (col === 0 && r < 2 ? 12 : 0);
        const end = x0 + 23 - (r === 10 ? 9 : 0);
        while (xx < end - 2) { const wl = 2.5 + rng() * 5.5; const e = Math.min(end, xx + wl); tx += `M${f(xx)} ${f(yy)}L${f(e)} ${f(yy)}`; xx = e + 1.8; }
      }
    }
    add(tx, { g: 'print' + k, a: 2, b: 2, w: 0.42, i: 1.0, c: 'gold', seq: true, printed: k });
  }
  return { strokes: S, occluders: {}, extent: [-340, -420, 440, 320] };
}

/** Platen drop (px) at time t for stamp times `hits` (anticipate, strike, dwell, release). */
export function drop(t, hits) {
  let d = 0;
  for (const tc of hits) {
    const x = t - tc;
    let v = 0;
    if (x > -0.2 && x <= 0) { const s = (x + 0.2) / 0.2; v = s * s * s; }
    else if (x > 0 && x <= 0.07) v = 1 - 0.02 * Math.sin(x / 0.07 * Math.PI);
    else if (x > 0.07 && x < 0.62) { const s = (x - 0.07) / 0.55; v = 1 - s * s * (3 - 2 * s); }
    d = Math.max(d, v);
  }
  return d * DROP;
}
