// Chapter IV camera generator: builds the `cameras.IV` keyframes in src/timeline.js from a
// parametric path, then patches ONLY that entry (re-reading the file right before writing).
//   node src/chapters/ch4/camgen.mjs            → print diagnostics
//   node src/chapters/ch4/camgen.mjs --rates    → also print view-rotation rates
//   node src/chapters/ch4/camgen.mjs --write    → also patch timeline.js (--dry: check only)
// Shots: glare → pull-back reveal (log-space) → wide disk → fly-in to the proto-Earth →
// Theia approach → impact → ~240° orbit in the debris-ring frame (past the backlit side) →
// push-in → exact IV→V hold (disc r = 0.3056 H at the centre, Sun at view (−0.8, 0.35, 0.5)).
import fs from 'node:fs';
import path from 'node:path';
import * as G from './geom.js';

const ROOT = path.resolve(new URL('../../..', import.meta.url).pathname);
const TL = path.join(ROOT, 'src/timeline.js');
const T0 = await import(TL);
const ASPECT = 16 / 9;
const { add, sub, mul, dot, cross, norm, len, sstep, sstep5, EARTH } = G;
const D2R = Math.PI / 180;
const sph = (az, el) => [Math.cos(el * D2R) * Math.cos(az * D2R), Math.sin(el * D2R), Math.cos(el * D2R) * Math.sin(az * D2R)];
const lerp = (a, b, u) => a + (b - a) * u;
const lerpLog = (a, b, u) => Math.exp(lerp(Math.log(a), Math.log(b), u));
function slerp(a, b, u) {
  const c = Math.min(1, Math.max(-1, dot(a, b))), w = Math.acos(c);
  if (w < 1e-5) return a;
  return add(mul(a, Math.sin((1 - u) * w) / Math.sin(w)), mul(b, Math.sin(u * w) / Math.sin(w)));
}
/** Put `p` at NDC (a, b) by shifting the look-at target in the image plane. */
function aimAt(pos, p, a, b, fov, roll = 0) {
  let target = p.slice();
  for (let i = 0; i < 25; i++) {
    const f = G.camFrame({ pos, target, fov, roll }, ASPECT);
    const q = G.project(f, p), dist = len(sub(p, pos));
    target = add(target, add(mul(f.x, (q.x - a) * f.th * ASPECT * dist * 0.9), mul(f.y, (q.y - b) * f.th * dist * 0.9)));
  }
  return target;
}

// ---------------------------------------------------------------- the final frame (contract)
const RHO_F = G.FINAL_RHO;

// ---------------------------------------------------------------- pre-impact path
const AZ0 = -32;                                         // camera azimuth around the Sun
function sunShot(t) {
  // 57.2–58.0 in the glare, 58 → 61.9 pull back (log space), then a slow drifting wide shot.
  const d = t < 58 ? lerp(1.2, 1.32, (t - 57.2) / 0.8) : t < 61.9 ? lerpLog(1.32, 47, sstep5(58, 61.9, t)) : lerp(47, 43.5, sstep(61.9, 63.6, t));
  const el = lerp(38, 21, sstep(57.6, 63.2, t));
  const az = AZ0 + 22 * sstep(57.4, 64, t);
  const pos = mul(sph(az, el), d);
  const target = mul([2.4, 0, 0.6], sstep(59.5, 63.4, t));
  return { pos, target, fov: lerp(42, 44, sstep(58, 62, t)), roll: lerp(-6, 0, sstep(58, 61.5, t)) };
}
// Theia shot: below the ecliptic, the Sun upper-right; Earth centre at NDC (−0.16, −0.01) so the
// contact point on its right limb lands at IMPACT_NDC (0.05, 0.08).
const THEIA_EARTH_NDC = [-0.16, -0.01];
function theiaShot(t) {
  const u = sstep(65.6, 69.37, t);
  const dir = norm(sph(lerp(-131, -123, u), lerp(-17, -22, u)));
  const rho = lerp(2.3, 1.95, u);
  const pos = add(EARTH, mul(dir, rho));
  return { pos, target: aimAt(pos, EARTH, THEIA_EARTH_NDC[0], THEIA_EARTH_NDC[1], 40), fov: 40, roll: 0 };
}
const FLY0 = 62.9, FLY1 = 66.0;
function flyIn(t) {
  // Distance to the Earth falls in log space; the viewing DIRECTION is slerped (uniform angular
  // speed) from "at the disk centre" to the Theia framing, so the swoop never whip-pans.
  const a0 = sunShot(FLY0), b = theiaShot(FLY1);
  const u = sstep5(FLY0, FLY1, t);
  const ra = sub(a0.pos, EARTH), rb = sub(b.pos, EARTH);
  const rho = lerpLog(len(ra), len(rb), Math.pow(u, 0.85));
  const dir = slerp(norm(ra), norm(rb), sstep(FLY0, FLY1, t));
  const pos = add(EARTH, mul(dir, rho));
  const fa = norm(sub(sunShot(Math.min(t, 63.6)).target, pos));
  const fb = norm(sub(b.target, b.pos));
  const w = sstep(FLY0 + 0.2, FLY1, t);
  const fwd = slerp(fa, fb, w * w * (3 - 2 * w) * 0.5 + w * 0.5);
  return { pos, target: add(pos, mul(fwd, Math.max(1, rho * 0.5))), fov: lerp(a0.fov, b.fov, sstep(FLY0, FLY1, t)), roll: lerp(a0.roll, 0, u) };
}

// ---------------------------------------------------------------- keys
function r4(x) { return Math.round(x * 1e4) / 1e4; }
function key(t, k, extra = {}) {
  return { t: r4(t), pos: k.pos.map(r4), target: k.target.map(r4), fov: r4(k.fov), roll: r4(k.roll || 0), ...extra };
}
const keys = [];
const push = (t, k, extra) => keys.push(key(t, k, extra));
for (let t = 57.2; t < FLY0 - 1e-6; t += (t < 58 ? 0.4 : t < 62 ? 0.2 : 0.35)) push(t, sunShot(t));
for (let t = FLY0; t < FLY1 - 1e-6; t += 0.2) push(t, flyIn(t));
for (let t = 66.0; t < T0.THEIA_T - 0.1; t += 0.4) push(t, theiaShot(t));
push(T0.THEIA_T, theiaShot(T0.THEIA_T));

// Impact geometry from these keys (the chapter recomputes the same thing at init).
const Tfake = { ...T0, cameras: { ...T0.cameras, IV: keys } };
const g = G.impactGeom(Tfake, ASPECT);

// ---------------------------------------------------------------- orbit → push-in → hold
// The orbit runs in the debris ring's own frame (pole = ring axis), so the ring stays open.
// φ = 0 points sunward in the ring plane; the sweep passes φ = 180° (eclipse: Sun behind Earth).
const FK = G.finalKey(g.axis, 25, -1);
const V_F = FK.dir;
console.log('final key: roll', FK.roll.toFixed(2), 'ring open', FK.open.toFixed(1), 'axis·x', FK.axisX.toFixed(4));
const vT = norm(sub(theiaShot(T0.THEIA_T).pos, EARTH));
const AX = g.axis;
const R1 = norm(sub([-1, 0, 0], mul(AX, dot([-1, 0, 0], AX)))), R2 = cross(AX, R1);
const toRing = (v) => ({ phi: Math.atan2(dot(v, R2), dot(v, R1)) / D2R, el: Math.asin(dot(v, AX)) / D2R });
const fromRing = (phi, el) => norm(add(add(mul(R1, Math.cos(el * D2R) * Math.cos(phi * D2R)), mul(R2, Math.cos(el * D2R) * Math.sin(phi * D2R))), mul(AX, Math.sin(el * D2R))));
const rT = toRing(vT), rF = toRing(V_F);
// Go the way round that passes through φ = 180°.
let phiF = rF.phi;
const through180 = (a, b) => { const lo = Math.min(a, b), hi = Math.max(a, b); return ((180 >= lo && 180 <= hi) || (-180 >= lo && -180 <= hi)); };
if (!through180(rT.phi, phiF)) phiF += (phiF < rT.phi ? 360 : -360);
const T1 = T0.THEIA_T, TP = T0.bt(28), TF = G.FINAL.t;
const EL_RING = Math.sign(rF.el || 1) * 27;
function orbit(t) {
  const u = sstep(T1 + 0.2, TP + 0.45, t);
  const w = u * u * (3 - 2 * u) * 0.4 + u * 0.6;
  const phi = lerp(rT.phi, phiF, w);
  const el = t < 74 ? lerp(rT.el, EL_RING, sstep(T1 + 0.2, 72.5, t)) : lerp(EL_RING, rF.el, sstep(76.5, TP + 0.45, t));
  const rho = t < T1 + 2.2 ? lerp(1.95, 3.35, sstep(T1 + 0.1, T1 + 2.2, t)) : lerp(3.35, 3.6, sstep(T1 + 2.2, 76, t)) - 0.3 * sstep(76, TP, t);
  const pos = add(EARTH, mul(fromRing(phi, el), rho));
  const off = 1 - sstep(T1, T1 + 3.5, t);
  const roll = FK.roll * sstep(71.0, TP + 0.45, t);
  // while the Moon gathers (upper left), make room for it: the Earth drifts right and down
  const mo = sstep(75.0, 76.8, t) * (1 - sstep(79.0, TP + 0.35, t));
  const ax = THEIA_EARTH_NDC[0] * off + 0.16 * mo, ay = THEIA_EARTH_NDC[1] * off - 0.26 * mo;
  return { pos, target: aimAt(pos, EARTH, ax, ay, 40, roll), fov: 40, roll };
}
console.log('ring frame: theia φ', rT.phi.toFixed(1), 'el', rT.el.toFixed(1), ' final φ', phiF.toFixed(1), 'el', rF.el.toFixed(1));
const HOLD = { pos: FK.pos, target: EARTH.slice(), fov: G.FINAL.fov, roll: FK.roll };
function pushIn(t) {
  const a = orbit(TP);
  const u = sstep(TP, TF - 0.01, t);
  const e = 1 - Math.pow(1 - u, 2.2);                              // ease-out: lands with no velocity
  const ra = sub(a.pos, EARTH);
  const dir = slerp(norm(ra), V_F, e);
  const rho = lerpLog(len(ra), RHO_F, e);
  const pos = add(EARTH, mul(dir, rho));
  return { pos, target: add(mul(a.target, 1 - e), mul(EARTH, e)), fov: lerp(a.fov, G.FINAL.fov, e), roll: lerp(a.roll, FK.roll, e) };
}
for (let t = T1 + 0.25; t < TP - 1e-6; t += 0.4) push(t, orbit(t));
for (let t = TP; t < TF - 0.25; t += 0.2) push(t, pushIn(t), t + 0.2 >= TF - 0.25 ? { ease: 'out' } : {});
push(TF - 0.01, HOLD); push(TF, HOLD); push(83.0, HOLD);
for (let i = 1; i < keys.length; i++) if (keys[i].t <= keys[i - 1].t) throw new Error('keys out of order at ' + keys[i].t);

// ---------------------------------------------------------------- diagnostics
const T2 = { ...T0, cameras: { ...T0.cameras, IV: keys } };
const g2 = G.impactGeom(T2, ASPECT);
const moon = G.moonPhase81(T2, g2, ASPECT);
const sunDirView = (t) => { const f = G.camFrame(T0.sampleCamera(keys, t), ASPECT); const s = norm(sub([0, 0, 0], EARTH)); return [dot(s, f.x), dot(s, f.y), dot(s, f.z)].map(v => v.toFixed(3)).join(','); };
console.log('keys:', keys.length, ' final ρ', RHO_F.toFixed(5), ' V_F', V_F.map(v => v.toFixed(4)).join(','));
console.log('impact P', g2.P.map(v => v.toFixed(3)).join(','), ' obliquity', g2.obliquity.toFixed(1), '° approach', g2.approachD.toFixed(3), ' axis', g2.axis.map(v => v.toFixed(3)).join(','));
console.log('moon φ81', moon.phi81.toFixed(3), ' margin', moon.margin.toFixed(3));
for (const t of [66.05, 67.5, T0.THEIA_T, 71, 73, 75, 76.5, 78, 79.5, 80.3, 80.8, 81, 81.5, 82.5]) {
  const k = T0.sampleCamera(keys, t), f = G.camFrame(k, ASPECT);
  const e = G.project(f, EARTH);
  const rH = Math.tan(Math.asin(Math.min(1, G.RE / len(sub(EARTH, k.pos))))) / (2 * f.th);
  const phi = moon.phi81 + G.MOON_W * (t - G.FINAL.t);
  const m = G.project(f, G.ringPos(g2, G.MOON_A, phi));
  const vd = norm(sub(k.pos, EARTH));
  const ringOpen = Math.asin(Math.abs(dot(vd, g2.axis))) / D2R;
  const th = G.project(f, G.add(g2.theiaC, G.mul(g2.v, -Math.max(0, G.theiaRemaining(g2, T0, t)))));
  console.log(`t=${t.toFixed(2)} earth ndc (${e.x.toFixed(3)},${e.y.toFixed(3)}) rH ${rH.toFixed(4)} ρ ${len(sub(EARTH, k.pos)).toFixed(3)} sunView ${sunDirView(t)} moon (${m.x.toFixed(2)},${m.y.toFixed(2)},d${m.d.toFixed(2)}) ringOpen ${ringOpen.toFixed(0)}° theia x ${th.x.toFixed(2)}`);
}

if (process.argv.includes('--rates')) {
  let prev = null, peak = [0, 0];
  for (let t = 57.2; t <= 83.0; t += 0.05) {
    const f = G.camFrame(T0.sampleCamera(keys, t), ASPECT), fwd = G.mul(f.z, -1);
    if (prev) { const r = Math.acos(Math.min(1, dot(prev, fwd))) * 180 / Math.PI / 0.05; if (r > peak[0]) peak = [r, t]; }
    prev = fwd;
  }
  console.log('peak view rotation', peak[0].toFixed(1), 'deg/s at t =', peak[1].toFixed(2));
  for (let t = 63; t <= 66.01; t += 0.25) {
    const f = G.camFrame(T0.sampleCamera(keys, t), ASPECT), g2 = G.camFrame(T0.sampleCamera(keys, t + 0.05), ASPECT);
    const r = Math.acos(Math.min(1, dot(G.mul(f.z, -1), G.mul(g2.z, -1)))) * 180 / Math.PI / 0.05;
    const sp = G.project(f, [0, 0, 0]);
    console.log(' ', t.toFixed(2), r.toFixed(1), 'deg/s  sun', sp.d > 0 ? sp.x.toFixed(2) + ',' + sp.y.toFixed(2) : 'behind');
  }
}
if (process.argv.includes('--write')) {
  const fmt = (k) => `{ t: ${k.t}, pos: [${k.pos.join(', ')}], target: [${k.target.join(', ')}], fov: ${k.fov}, roll: ${k.roll}${k.ease ? `, ease: '${k.ease}'` : ''} }`;
  const entry = '  IV:   [ ' + keys.map(fmt).join(',\n          ') + ' ],   // generated: src/chapters/ch4/camgen.mjs\n';
  const src = fs.readFileSync(TL, 'utf8');              // re-read right before writing
  // The entry ends at the first line after `IV:   [` that ends in "],": nothing else is touched
  // (other chapters keep comments between entries).
  const a = src.indexOf('\n  IV:   [') + 1;
  if (a <= 0) throw new Error('could not find the IV camera entry');
  const m = /\} \],[^\n]*\n/g; m.lastIndex = a;
  const hit = m.exec(src);
  const b = hit.index + hit[0].length;
  const old = src.slice(a, b);
  if (old.includes('\n  V:') || !old.startsWith('  IV:   [') || /\n\s*\/\//.test(old)) throw new Error('IV entry boundary looks wrong');
  if (process.argv.includes('--dry')) { console.log('would replace', old.split('\n').length - 1, 'lines'); process.exit(0); }
  fs.writeFileSync(TL, src.slice(0, a) + entry + src.slice(b));
  console.log('patched cameras.IV in', path.relative(ROOT, TL));
}
