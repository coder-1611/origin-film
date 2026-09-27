// Fig. 4: THE STEAM ENGINE. A horizontal mill engine in side elevation with the cylinder
// cut away: piston, rod, crosshead in its guides, connecting rod, crank and a six-spoke
// flywheel in its pit, a slide valve worked by an eccentric, a flyball governor, steam
// and exhaust pipes, a pressure gauge, bedplate and brick foundation.
// Kinematics are exact slider-crank; the stroke ends land on the beats (hiss events).
import { P, catmull, bolt, boltRow, sectionBand, cylHatchH } from './draw-util.js';

export const name = 'engine';
export const FC = [192, 0];          // flywheel / crankshaft centre (lands on screen centre at bar 63)
export const RF = 205;               // flywheel radius
const CR = 60, LR = 290;             // crank radius, connecting-rod length
const ECC = 16, VY = -80, LE = Math.hypot(FC[0] - (-40), (FC[1] + ECC) - VY);
export const GOV = [-110, -200];

/** Slider-crank state at crank angle th (radians, y-down; th = 0 → crank pin on the right). */
export function kin(th) {
  const px = FC[0] + CR * Math.cos(th), py = FC[1] + CR * Math.sin(th);
  const xx = px - Math.sqrt(LR * LR - py * py);
  const ex = FC[0] + ECC * Math.cos(th + Math.PI / 2), ey = FC[1] + ECC * Math.sin(th + Math.PI / 2);
  const vx = ex - Math.sqrt(LE * LE - (ey - VY) * (ey - VY));
  return { px, py, xx, ex, ey, vx };
}
export const K0 = kin(0);

export function build(rng) {
  const S = [];
  const add = (d, o) => S.push({ d, ...o });
  const f = P.f;
  const [fx, fy] = FC;
  const X0 = K0.xx;

  // ---- construction: the engine's axis and the flywheel centre lines
  add(P.dashed(-470, 0, 450, 0, 26, 6, true), { g: 'static', a: -0.28, b: -0.08, w: 0.4, i: 0.45, c: 'amber' });
  add(P.dashed(fx, -250, fx, 240, 22, 6, true), { g: 'static', a: -0.24, b: -0.06, w: 0.4, i: 0.45, c: 'amber' });

  // ---- floor with the flywheel pit
  add('M-470 150L-40 150L-40 228L430 228L430 150L470 150', { g: 'static', a: -0.22, b: 0.12, w: 1.0, i: 1.0, c: 'amber' });
  let fh = '';
  for (let x = -462; x < -44; x += 12) fh += `M${x} 152L${x - 12} 164`;
  for (let x = -30; x < 430; x += 12) fh += `M${x} 230L${x - 12} 242`;
  for (let y = 162; y < 226; y += 12) fh += `M-42 ${y}L-54 ${y + 12}M432 ${y}L444 ${y + 12}`;
  add(fh, { g: 'static', a: 0.14, b: 0.42, w: 0.4, i: 0.38, c: 'amber', seq: true });

  // ---- brick foundation and bedplate
  let brick = '';
  for (let r = 0; r < 4; r++) {
    const y = 104 + r * 11.5;
    brick += `M-420 ${f(y)}L-52 ${f(y)}`;
    for (let x = -420 + (r % 2) * 18; x < -52; x += 36) brick += `M${x} ${f(y)}L${x} ${f(y + 11.5)}`;
  }
  add(brick, { g: 'static', a: 0.12, b: 0.42, w: 0.4, i: 0.42, c: 'amber', seq: true });
  add('M-424 104L-424 70L-56 70L-56 104Z', { g: 'static', a: 0.06, b: 0.26, w: 1.05, i: 1.3, c: 'amber' });
  add('M-420 78L-60 78M-420 98L-60 98', { g: 'static', a: 0.2, b: 0.34, w: 0.4, i: 0.55, c: 'amber', seq: true });
  add(boltRow(-400, 74, -80, 74, 9, 2.6), { g: 'static', a: 0.4, b: 0.6, w: 0.45, i: 0.9, c: 'gold', seq: true });

  // ---- main bearing pedestal in the pit (behind the flywheel)
  add(`M150 228L166 30L218 30L234 228`, { g: 'static', a: 0.18, b: 0.36, w: 0.8, i: 1.0, c: 'amber' });
  add(P.rect(162, -28, 60, 58) + 'M162 -8L222 -8', { g: 'static', a: 0.24, b: 0.4, w: 0.8, i: 1.1, c: 'amber', seq: true });
  add(bolt(170, -18, 3) + bolt(214, -18, 3), { g: 'static', a: 0.4, b: 0.46, w: 0.45, i: 0.9, c: 'gold', seq: true });

  // ---- cylinder, cut away: walls in section, covers, gland, saddle feet
  add('M-372 -60L-208 -60M-372 60L-208 60M-372 -44L-208 -44M-372 44L-208 44', { g: 'static', a: 0.1, b: 0.3, w: 1.0, i: 1.5, c: 'gold', seq: false });
  add(sectionBand(-372, -208, -60, -44, 7) + sectionBand(-372, -208, 44, 60, 7), { g: 'static', a: 0.34, b: 0.58, w: 0.35, i: 0.55, c: 'amber', seq: true });
  add(P.rect(-384, -72, 12, 144) + P.rect(-208, -72, 12, 144), { g: 'static', a: 0.2, b: 0.36, w: 0.9, i: 1.3, c: 'gold', seq: true });
  add(P.rect(-196, -14, 16, 28) + 'M-192 -14L-192 14', { g: 'static', a: 0.32, b: 0.4, w: 0.7, i: 1.2, c: 'gold', seq: true });
  let cb = '';
  for (const y of [-64, -36, 36, 64]) cb += P.rect(-390, y - 3, 6, 6) + P.rect(-196, y - 3, 6, 6);
  add(cb, { g: 'static', a: 0.5, b: 0.66, w: 0.45, i: 0.9, c: 'gold', seq: true });
  add('M-350 60L-350 70M-320 60L-320 70M-262 60L-262 70M-232 60L-232 70', { g: 'static', a: 0.3, b: 0.38, w: 0.8, i: 1.1, c: 'amber', seq: true });

  // ---- piston + rod + crosshead (translate with the crosshead)
  add(P.rect(X0 - 200, -43, 26, 86), { g: 'xh', a: 0.18, b: 0.3, w: 0.9, i: 1.6, c: 'gold' });
  add(`M${X0 - 194} -43L${X0 - 194} 43M${X0 - 188} -43L${X0 - 188} 43M${X0 - 180} -43L${X0 - 180} 43`, { g: 'xh', a: 0.28, b: 0.36, w: 0.4, i: 0.8, c: 'amber', seq: true });
  add(`M${X0 - 174} -4.5L${X0 - 14} -4.5M${X0 - 174} 4.5L${X0 - 14} 4.5`, { g: 'xh', a: 0.22, b: 0.32, w: 0.7, i: 1.4, c: 'gold', seq: false });
  add(P.rect(X0 - 15, -18, 30, 36) + `M${X0 - 24} -18L${X0 + 24} -18M${X0 - 24} 18L${X0 + 24} 18` + P.circle(X0, 0, 5), { g: 'xh', a: 0.26, b: 0.38, w: 0.8, i: 1.4, c: 'gold', seq: true });
  // guides + brackets
  add('M-196 -24L-24 -24M-196 -20L-24 -20M-196 20L-24 20M-196 24L-24 24', { g: 'static', a: 0.26, b: 0.44, w: 0.7, i: 1.1, c: 'amber', seq: false });
  add('M-196 24L-196 70M-186 24L-186 70M-34 24L-34 70M-24 24L-24 70M-196 -24L-196 -34L-186 -34L-186 -24M-34 -24L-34 -34L-24 -34L-24 -24',
    { g: 'static', a: 0.36, b: 0.5, w: 0.7, i: 1.0, c: 'amber', seq: true });

  // ---- flywheel (rotates): rim, curved spokes, hub, balance weight, crank, eccentric
  add(P.arc(fx, fy, RF, -90, 270), { g: 'fly', a: 0.14, b: 0.44, w: 1.2, i: 1.8, c: 'gold' });
  add(P.arc(fx, fy, RF - 15, -60, 300), { g: 'fly', a: 0.18, b: 0.48, w: 0.85, i: 1.35, c: 'gold' });
  add(P.arc(fx, fy, RF - 7, 0, 360), { g: 'fly', a: 0.3, b: 0.56, w: 0.35, i: 0.55, c: 'amber' });
  for (let k = 0; k < 6; k++) {
    const a0 = k * 60 + 30;
    const edge = (side) => {
      const pts = [];
      for (let j = 0; j <= 8; j++) {
        const u = j / 8, r = 40 + u * (RF - 15 - 40);
        const a = (a0 + 11 * Math.sin(Math.PI * u)) * Math.PI / 180;
        const w = (8 - 3 * u) * side;
        const tx = -Math.sin(a), ty = Math.cos(a);
        pts.push([fx + Math.cos(a) * r + tx * w, fy + Math.sin(a) * r + ty * w]);
      }
      return catmull(pts);
    };
    const o = 0.3 + k * 0.035;
    add(edge(1) + edge(-1), { g: 'fly', a: o, b: o + 0.16, w: 0.8, i: 1.35, c: 'amber', seq: false });
  }
  add(P.circle(fx, fy, 40) + P.circle(fx, fy, 30), { g: 'fly', a: 0.32, b: 0.46, w: 0.85, i: 1.4, c: 'gold', seq: true });
  add(P.circle(fx, fy, 13) + `M${fx - 4} ${fy - 13}L${fx - 4} ${fy - 18}L${fx + 4} ${fy - 18}L${fx + 4} ${fy - 13}`, { g: 'fly', a: 0.42, b: 0.5, w: 0.7, i: 1.6, c: 'hot', seq: true });
  {
    const D = Math.PI / 180, r0 = 150, r1 = RF - 15, b0 = 330 + 12 - 60, b1 = 330 + 48 - 60;
    const p = (r, a) => `${f(fx + r * Math.cos(a * D))} ${f(fy + r * Math.sin(a * D))}`;
    add(`M${p(r1, b0)}L${p(r0, b0)}A${r0} ${r0} 0 0 1 ${p(r0, b1)}L${p(r1, b1)}`, { g: 'fly', a: 0.54, b: 0.66, w: 0.8, i: 1.3, c: 'gold' });
    let wh = '';
    for (const r of [160, 170, 180]) wh += P.arc(fx, fy, r, b0 + 3, b1 - 3);
    add(wh, { g: 'fly', a: 0.62, b: 0.72, w: 0.35, i: 0.55, c: 'amber', seq: true });
  }
  // crank arm and pin (outboard, drawn with the wheel)
  add(`M${fx + 4} ${fy - 20}L${fx + CR - 2} ${fy - 13}M${fx + 4} ${fy + 20}L${fx + CR - 2} ${fy + 13}` + P.arc(fx + CR, fy, 14, -70, 70) + P.circle(fx + CR, fy, 6),
    { g: 'fly', a: 0.42, b: 0.56, w: 0.8, i: 1.4, c: 'gold', seq: true });
  add(P.circle(fx, fy + ECC, 25), { g: 'fly', a: 0.56, b: 0.64, w: 0.6, i: 1.0, c: 'amber' });

  // ---- connecting rod (rigid body, rest pose X0 → P0)
  const px0 = K0.px;
  add(`M${X0 + 12} -7L${px0 - 18} -11M${X0 + 12} 7L${px0 - 18} 11`, { g: 'rod', a: 0.3, b: 0.44, w: 0.9, i: 1.5, c: 'gold', seq: false });
  add(P.circle(X0, 0, 12) + P.circle(px0, 0, 19) + P.circle(px0, 0, 8) + `M${px0 - 19} -6L${px0 - 27} -6M${px0 - 19} 6L${px0 - 27} 6`,
    { g: 'rod', a: 0.36, b: 0.48, w: 0.75, i: 1.4, c: 'gold', seq: true });
  add(P.dashed(X0 + 16, 0, px0 - 22, 0, 18, 5, true), { g: 'rod', a: 0.6, b: 0.7, w: 0.3, i: 0.4, c: 'amber' });

  // ---- steam chest, ports, slide valve + rod, eccentric rod
  add(P.rect(-350, -104, 120, 44), { g: 'static', a: 0.28, b: 0.44, w: 0.95, i: 1.35, c: 'gold' });
  add('M-346 -98L-234 -98', { g: 'static', a: 0.4, b: 0.48, w: 0.4, i: 0.6, c: 'amber' });
  add('M-338 -60L-362 -44M-326 -60L-350 -44M-242 -60L-218 -44M-254 -60L-230 -44M-298 -60L-298 -44M-282 -60L-282 -44', { g: 'static', a: 0.46, b: 0.56, w: 0.5, i: 0.9, c: 'amber', seq: true });
  add(P.rect(-316, -84, 52, 22) + 'M-306 -62L-306 -72L-274 -72L-274 -62', { g: 'valve', a: 0.5, b: 0.6, w: 0.7, i: 1.2, c: 'gold', seq: true });
  add(`M-264 -76L${K0.vx} -76M-264 -84L${K0.vx} -84` + P.circle(K0.vx, VY, 6), { g: 'valve', a: 0.52, b: 0.64, w: 0.6, i: 1.1, c: 'gold', seq: true });
  add('M-226 -90L-214 -90L-214 -70L-226 -70M-70 -90L-58 -90L-58 -70L-70 -70M-64 -70L-64 -24', { g: 'static', a: 0.56, b: 0.64, w: 0.6, i: 1.0, c: 'amber', seq: true });
  {
    const ex = K0.ex, ey = K0.ey, vx = K0.vx, L = Math.hypot(ex - vx, ey - VY), ux = (ex - vx) / L, uy = (ey - VY) / L, nx = -uy, ny = ux;
    add(`M${f(vx + ux * 8 + nx * 4)} ${f(VY + uy * 8 + ny * 4)}L${f(ex - ux * 30 + nx * 5)} ${f(ey - uy * 30 + ny * 5)}M${f(vx + ux * 8 - nx * 4)} ${f(VY + uy * 8 - ny * 4)}L${f(ex - ux * 30 - nx * 5)} ${f(ey - uy * 30 - ny * 5)}` + P.circle(ex, ey, 30),
      { g: 'ecc', a: 0.6, b: 0.74, w: 0.6, i: 1.1, c: 'amber', seq: true });
  }

  // ---- steam supply: pipe up from the chest, stop valve with handwheel, off to the boiler
  add('M-296 -104L-296 -196M-280 -104L-280 -178L-470 -178M-296 -196L-470 -196', { g: 'static', a: 0.46, b: 0.72, w: 0.8, i: 1.1, c: 'amber', seq: false });
  add('M-302 -112L-274 -112M-302 -150L-274 -150M-360 -202L-360 -172M-430 -202L-430 -172', { g: 'static', a: 0.6, b: 0.7, w: 0.7, i: 1.0, c: 'amber', seq: true });
  add('M-288 -196L-288 -220' + P.circle(-288, -224, 16) + 'M-304 -224L-272 -224M-288 -240L-288 -208' + P.circle(-288, -224, 3),
    { g: 'static', a: 0.68, b: 0.8, w: 0.65, i: 1.2, c: 'gold', seq: true });
  // pressure gauge on its syphon
  add('M-230 -104C-230 -118 -220 -120 -220 -132L-220 -140' + P.circle(-220, -158, 18) + P.circle(-220, -158, 14),
    { g: 'static', a: 0.66, b: 0.8, w: 0.6, i: 1.1, c: 'gold', seq: true });
  let gt = '';
  for (let k = 0; k <= 8; k++) { const a = (135 + k * 33.75) * Math.PI / 180; gt += `M${f(-220 + Math.cos(a) * 11)} ${f(-158 + Math.sin(a) * 11)}L${f(-220 + Math.cos(a) * 14)} ${f(-158 + Math.sin(a) * 14)}`; }
  add(gt, { g: 'static', a: 0.76, b: 0.86, w: 0.35, i: 0.8, c: 'amber', seq: true });
  add('M-220 -158L-229 -166', { g: 'needle', a: 0.84, b: 0.9, w: 0.5, i: 1.6, c: 'hot' });

  // ---- exhaust: from the chest's back end round to a flared stack (steam puffs here)
  add('M-350 -74L-430 -74L-430 -300M-350 -90L-414 -90L-414 -300', { g: 'static', a: 0.5, b: 0.74, w: 0.8, i: 1.1, c: 'amber', seq: false });
  add('M-436 -300L-408 -300M-440 -312L-436 -300M-404 -312L-408 -300M-442 -316L-402 -316', { g: 'static', a: 0.72, b: 0.8, w: 0.7, i: 1.1, c: 'amber', seq: true });
  add(cylHatchH(-430, -414, -300, -300, 0) + 'M-426 -290L-426 -110M-418 -290L-418 -110', { g: 'static', a: 0.7, b: 0.86, w: 0.3, i: 0.4, c: 'amber', seq: false });

  // ---- flyball governor on a column over the guides (arms and balls animate)
  const [gx, gy] = GOV;
  add(`M${gx} ${gy - 12}L${gx} -24M${gx - 12} -24L${gx + 12} -24L${gx + 8} -38L${gx - 8} -38Z`, { g: 'static', a: 0.6, b: 0.74, w: 0.65, i: 1.1, c: 'amber', seq: true });
  add(P.circle(gx, gy - 16, 5) + `M${gx - 5} ${gy - 5}L${gx + 5} ${gy - 5}`, { g: 'static', a: 0.7, b: 0.78, w: 0.6, i: 1.2, c: 'gold', seq: true });
  add(`M${gx} ${gy}L${gx} ${gy + 62}`, { g: 'govL', a: 0.72, b: 0.82, w: 0.6, i: 1.2, c: 'gold' });
  add(`M${gx} ${gy}L${gx} ${gy + 62}`, { g: 'govR', a: 0.72, b: 0.82, w: 0.6, i: 1.2, c: 'gold' });
  add(P.circle(gx, gy + 62, 12) + P.arc(gx, gy + 62, 7, 200, 290), { g: 'ballL', a: 0.8, b: 0.9, w: 0.7, i: 1.5, c: 'gold', seq: true });
  add(P.circle(gx, gy + 62, 12) + P.arc(gx, gy + 62, 7, 200, 290), { g: 'ballR', a: 0.8, b: 0.9, w: 0.7, i: 1.5, c: 'gold', seq: true });
  add(P.rect(gx - 7, gy + 40, 14, 10), { g: 'sleeve', a: 0.82, b: 0.9, w: 0.55, i: 1.0, c: 'amber' });

  return { strokes: S, occluders: {}, extent: [-480, -330, 450, 250] };
}

/** Crank angle at time t: 60 rpm from the downbeat of bar 61, a stroke per beat. */
export function crank(t, t0) {
  return t <= t0 ? 0 : Math.PI * (t - t0) / 0.5;
}
