// ORIGIN · VII · FIRE TO FIBER (134.000–160.000 s, bars 55–67)
// ----------------------------------------------------------------------------------------
// Technique: SVG path draw-on → night Earth with great-circle arcs.
//
// Four engravings authored as real SVG path data (ch7/fire.js, wheel.js, press.js,
// engine.js) are flattened once, given a hand-drawn wobble and hidden-line occlusion, then
// drawn on every frame as dash-offset reveals (per-stroke windows, staggered order) with
// white-hot pen tips that cool to amber. Lines are GPU capsules (MAX-blended so joints
// don't bead) rendered as HDR light, plus a two-scale glow. The frieze sits at
// T.friezeX(item.wx, t). The engine's strokes unspool into the graticule of an
// orthographic globe that follows T.globeView/T.globeProject exactly; then a night Earth
// (land mask + coastline glow + atmosphere) carries ~10k city/suburb/rural lights and the
// T.arcs great circles, lifted in proportion to distance, with fibre pulses and a
// landing flash at a.t + 0.92·dur. Finally everything falls away but Round Rock.
// Pure function of t: every frame rebuilds its geometry from t alone.
// ----------------------------------------------------------------------------------------
import { parsePath, densify } from './ch7/svgpath.js';
import { SegBatch, SpriteBatch } from './ch7/lines.js';
import * as FIRE from './ch7/fire.js';
import * as WHEEL from './ch7/wheel.js';
import * as PRESS from './ch7/press.js';
import * as ENGINE from './ch7/engine.js';
import { landMask, buildLights, graticule, unit } from './ch7/globe.js';
import * as INTER from './ch7/interludes.js';

const COL = { amber: [1.0, 0.5, 0.19], gold: [1.0, 0.66, 0.32], hot: [1.0, 0.8, 0.52] };
const HOT = [1.0, 0.8, 0.56];
const CYAN = [0.5, 0.8, 1.0];
const WARM_BLACK = [0.012, 0.008, 0.006];
const EMBER = [1.0, 0.45, 0.12];
const RR_COL = [1.0, 0.86, 0.66];
const D2R = Math.PI / 180;
const LINE_GAIN = 0.5;          // engraving lines sit just under the bloom threshold; only fresh strokes burn over it

const sat = (x) => x < 0 ? 0 : x > 1 ? 1 : x;
const sstep = (a, b, x) => { const u = sat((x - a) / (b - a)); return u * u * (3 - 2 * u); };
const sm5 = (a, b, x) => { const u = sat((x - a) / (b - a)); return u * u * u * (u * (u * 6 - 15) + 10); };

let S = null;   // chapter state (built once in init; nothing in it depends on render history)

// ------------------------------------------------------------------ compile the drawings
function compile(T) {
  const rng = T.mulberry32(0xF1BE7);
  const mods = { fire: FIRE, wheel: WHEEL, press: PRESS, engine: ENGINE };
  const VX = [], VY = [], VS = [];
  const items = [];
  // truck solve: time at which friezeX(wx, t) = x (monotone truck)
  const tAtX = (wx, x) => {
    let lo = 120, hi = 170;
    if (T.friezeX(wx, lo) <= x) return lo;
    for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; T.friezeX(wx, m) > x ? lo = m : hi = m; }
    return (lo + hi) / 2;
  };
  const defs = T.frieze.items.map(it => ({ ...it, mod: mods[it.name] }));
  // interludes between the plates (decoration; positions are ours, motion is the same truck)
  // each sits in the right third of a plate's hold and draws once that plate is done
  defs.push({ name: 'jar', wx: 0.72, mod: { build: INTER.buildJar }, deco: true, host: 'fire' });
  defs.push({ name: 'book', wx: 2.75, mod: { build: INTER.buildBook }, deco: true, host: 'wheel' });
  defs.push({ name: 'gears', wx: 4.72, mod: { build: INTER.buildGears }, deco: true, host: 'press' });
  defs.push({ name: 'ground', wx: 0, mod: { build: INTER.buildGround }, deco: true, ground: true });
  for (const it of defs) {
    const mod = it.mod;
    const built = mod.build(rng);
    // Each plate draws while the camera holds on it, inside its frieze window. The press
    // must exist before its first clank (the window's first instant), so its machinery is
    // laid down in the 0.9 s it takes to settle into the hold; its details finish after.
    let drawS, drawE;
    const firstClank = (T.sfx.find(e => e.type === 'clank') || { t: it.t0 }).t;
    if (it.name === 'fire') { drawS = it.t0; drawE = it.t0 + 1.75; }
    else if (it.name === 'press') { drawS = firstClank - 0.9; drawE = drawS + 1.8; }
    else if (it.ground) { drawS = 134.9; drawE = 136; }
    else if (it.deco) {
      const host = items.find(h => h.name === it.host);
      drawS = host.drawE - 0.3; drawE = drawS + 1.0;
    } else { drawS = Math.max(it.t0, tAtX(it.wx, 0.001)); drawE = drawS + (it.name === 'engine' ? 1.6 : 1.5); }
    const item = { name: it.name, wx: it.wx, t0: it.t0 ?? drawS, t1: it.t1 ?? drawE, drawS, drawE, mod, deco: !!it.deco, extent: built.extent, strokes: [], groups: {} };
    // the wheel: its tyre is swept on with the whoosh, and it rolls once it is drawn
    if (it.name === 'wheel') item.spinT0 = drawE - 0.15;
    const occ = built.occluders || {};
    const inside = (x, y, names) => {
      for (const nm of names) for (const poly of (occ[nm] || [])) {
        let c = false;
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
          const [xi, yi] = poly[i], [xj, yj] = poly[j];
          if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
        }
        if (c) return true;
      }
      return false;
    };
    const rects = mod.RECTS || {};
    for (const e of built.strokes) {
      let subs = parsePath(e.d, 1.0).map(s => s.pts);
      if (e.occ && e.occ.length) {
        const out = [];
        for (const pts of subs) {
          const dn = densify(pts, 1.5).pts;
          let cur = [];
          for (let k = 0; k < dn.length; k += 2) {
            if (inside(dn[k], dn[k + 1], e.occ)) { if (cur.length >= 4) out.push(cur); cur = []; }
            else cur.push(dn[k], dn[k + 1]);
          }
          if (cur.length >= 4) out.push(cur);
        }
        subs = out;
      }
      const pieces = subs.map(p => densify(p, 5)).filter(p => p.len > 1.2);
      if (!pieces.length) continue;
      const total = pieces.reduce((a, p) => a + p.len, 0);
      let acc = 0;
      const gname = e.g || 'static';
      if (!(gname in item.groups)) item.groups[gname] = Object.keys(item.groups).length;
      if (e.a === undefined) { e.a = 0; e.b = 1; }
      pieces.forEach((pc, idx) => {
        let a = e.a, b = e.b;
        if (e.seq && pieces.length > 1) {
          const Dw = e.b - e.a, c = acc / total, dur = Math.max(Dw * 0.12, Dw * pc.len / total * 1.25);
          a = e.a + (Dw - dur) * c / Math.max(1e-6, 1 - pc.len / total);
          a = Math.min(a, e.b - dur); b = a + dur;
        }
        acc += pc.len;
        // hand-drawn wobble: perpendicular low-frequency noise along arc length
        const wob = e.wob ?? (gname === 'flame' ? 0.35 : 0.6);
        const l1 = 70 + rng() * 90, l2 = 22 + rng() * 26, p1 = rng() * 6.28, p2 = rng() * 6.28;
        const P = pc.pts, n = P.length / 2, v0 = VX.length;
        for (let k = 0; k < n; k++) {
          const kp = Math.max(0, k - 1), kn = Math.min(n - 1, k + 1);
          let tx = P[2 * kn] - P[2 * kp], ty = P[2 * kn + 1] - P[2 * kp + 1];
          const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
          const s = pc.cum[k];
          const o = wob * (0.65 * Math.sin(6.2832 * s / l1 + p1) + 0.35 * Math.sin(6.2832 * s / l2 + p2));
          VX.push(P[2 * k] - ty * o); VY.push(P[2 * k + 1] + tx * o); VS.push(s);
        }
        const col = COL[e.c || 'amber'], I = e.i ?? 1;
        const closed = Math.hypot(P[0] - P[P.length - 2], P[1] - P[P.length - 1]) < 0.5;
        let ta = drawS + a * (drawE - drawS), tb = drawS + b * (drawE - drawS);
        if (e.ground !== undefined) {
          const xs = (e.ground === 0 ? INTER.GROUND[0].pts[0][0] : INTER.GROUND[e.ground].pts[0][0]) / 960;
          const t0g = Math.max(134.85, tAtX(xs, 1.06)) + (e.sub ? 0.25 : 0);
          const dur = Math.max(0.6, pc.len / 850) + (e.sub ? 0.4 : 0);
          ta = t0g + (e.seq ? a : 0) * dur; tb = e.seq ? ta + Math.max(0.12, (b - a) * dur) : t0g + dur;
        }
        item.strokes.push({
          g: gname, gi: item.groups[gname], tg: e.tg || 0, v0, n, len: pc.len, ta, tb, a, b,
          w: e.w ?? 0.8, I, r: col[0] * I * LINE_GAIN, gg: col[1] * I * LINE_GAIN, bb: col[2] * I * LINE_GAIN, closed, fadeEnd: !!e.fadeEnd,
          clip: e.clip ? e.clip.map(nm => rects[nm]).filter(Boolean) : null, printed: e.printed ?? -1,
        });
      });
    }
    items.push(item);
  }
  return { items, VX: Float32Array.from(VX), VY: Float32Array.from(VY), VS: Float32Array.from(VS) };
}

// ------------------------------------------------------------------ shaders
function makeShaders(ctx) {
  const { glsl } = ctx;
  const BG = glsl.all + /* glsl */`
in vec2 vUv; out vec4 fragColor;
uniform float aspect, H, camX, friezeAmt, gridAmt, globeAmt, fireAmt, t;
uniform vec2 fireP;
uniform float gR, gLon0, gLat0, bodyAmt, landAmt, atmoAmt, starAmt, dawnAmt, outAmt;
uniform sampler2D land;
uniform vec3 warm;
float gridLine(float c, float period, float px) {
  float d = abs(fract(c / period + 0.5) - 0.5) * period;
  return 1.0 - smoothstep(0.0, px, d);
}
void main() {
  vec2 ndc = vUv * 2.0 - 1.0;
  float s = H / 1080.0;
  vec3 col = warm;
  // ---- frieze: a barely-there blueprint grid in parallax behind the drawings + firelight
  if (friezeAmt > 0.001) {
    vec2 g = vec2(ndc.x * 960.0 * aspect / (16.0 / 9.0) + camX * 0.42 * 960.0, ndc.y * 540.0);
    float px = 0.9 / s;
    float minor = max(gridLine(g.x, 48.0, px), gridLine(g.y, 48.0, px));
    float major = max(gridLine(g.x, 240.0, px * 1.3), gridLine(g.y, 240.0, px * 1.3));
    float band = exp(-ndc.y * ndc.y * 1.4);
    col += vec3(1.0, 0.6, 0.3) * (minor * 0.0035 + major * 0.006) * band * gridAmt * friezeAmt;
    vec2 d = (ndc - fireP) * vec2(aspect, 1.0);
    col += vec3(1.0, 0.36, 0.08) * fireAmt * (0.05 * exp(-dot(d, d) * 5.5) + 0.02 * exp(-dot(d, d) * 1.2));
  }
  // ---- globe
  if (globeAmt > 0.001) {
    vec3 gcol = vec3(0.0012, 0.0017, 0.0036);
    // stars (screen-fixed, hashed per 5px cell)
    vec2 sp = gl_FragCoord.xy / s / 5.0;
    vec2 cell = floor(sp);
    float h = hash12(cell);
    if (h < 0.022) {
      vec2 c = cell + 0.2 + 0.6 * vec2(hash12(cell + 7.1), hash12(cell + 3.3));
      float dd = length((sp - c) * 5.0);
      float b = pow(hash12(cell + 1.7), 7.0) * 0.7 + 0.02;
      gcol += vec3(0.85, 0.9, 1.0) * b * exp(-dd * dd / 0.9) * starAmt;
    }
    vec2 p = vec2(ndc.x * aspect, ndc.y) / max(gR, 1e-4);
    float rho2 = dot(p, p), rho = sqrt(rho2);
    float pxR = max(gR, 1e-4) * 540.0 * s;                // globe radius in target pixels
    vec2 sunDir = normalize(vec2(0.82, 0.42));
    float sunSide = max(0.0, dot(p / max(rho, 1e-4), sunDir));
    if (rho > 1.0) {
      float hp = (rho - 1.0) * pxR / s;                    // height above the limb in 1080p px
      float halo = exp(-hp / 7.0) * 0.14 + exp(-hp / 34.0) * 0.035 + exp(-hp / 120.0) * 0.008;
      vec3 hc = mix(vec3(0.16, 0.42, 1.0), vec3(1.0, 0.72, 0.42), pow(sunSide, 6.0) * dawnAmt);
      gcol += hc * halo * atmoAmt * (1.0 + 2.2 * pow(sunSide, 5.0) * dawnAmt);
    } else {
      float z = sqrt(max(0.0, 1.0 - rho2));
      vec3 v = vec3(p, z);
      float la0 = gLat0 * PI / 180.0;
      float wy = v.y * cos(la0) + v.z * sin(la0);
      float wz = -v.y * sin(la0) + v.z * cos(la0);
      float lat = asin(clamp(wy, -1.0, 1.0));
      float lon = gLon0 * PI / 180.0 + atan(v.x, wz);
      vec2 uv = vec2(lon / TAU + 0.5, 0.5 - lat / PI);
      float lv = texture(land, uv).r;
      float fw = max(fwidth(lv), 1e-4);
      float dpx = abs(lv - 0.5) / fw;                     // screen px to the coastline
      float coast = exp(-dpx * dpx / (1.3 * s * s)) * smoothstep(0.0, 0.02, fw * 40.0);
      lv = smoothstep(0.5 - fw, 0.5 + fw, lv);
      vec3 ocean = vec3(0.0035, 0.008, 0.02);
      vec3 ground = vec3(0.009, 0.0105, 0.016);
      float shade = 0.5 + 0.5 * z;
      vec3 body = mix(ocean, ground, lv * landAmt) * shade;
      body += vec3(0.010, 0.026, 0.05) * coast * landAmt * (0.3 + 0.7 * z);
      // atmosphere scattering at the limb, warmer on the dawn side
      float rim = pow(1.0 - z, 3.0);
      body += mix(vec3(0.05, 0.14, 0.36), vec3(0.5, 0.36, 0.26), pow(sunSide, 5.0) * dawnAmt) * rim * 0.3 * atmoAmt;
      // a thin dawn sliver on the upper-right limb
      float day = smoothstep(0.9, 1.0, dot(v, normalize(vec3(sunDir * 1.0, -0.12))) + 0.02);
      body += vec3(0.08, 0.16, 0.3) * day * dawnAmt * 0.6;
      float edge = clamp((1.0 - rho) * pxR + 0.5, 0.0, 1.0);
      gcol = mix(gcol, body, bodyAmt * edge);
    }
    col = mix(col, gcol, globeAmt);
  }
  fragColor = vec4(col * outAmt, 1.0);
}`;
  const DOWN = glsl.header + /* glsl */`
in vec2 vUv; out vec4 fragColor; uniform sampler2D src; uniform vec2 texel;
void main() {
  vec3 c = texture(src, vUv + texel * vec2(-0.5, -0.5)).rgb + texture(src, vUv + texel * vec2(0.5, -0.5)).rgb
         + texture(src, vUv + texel * vec2(-0.5, 0.5)).rgb + texture(src, vUv + texel * vec2(0.5, 0.5)).rgb;
  fragColor = vec4(c * 0.25, 1.0);
}`;
  const BLUR = glsl.header + /* glsl */`
in vec2 vUv; out vec4 fragColor; uniform sampler2D src; uniform vec2 dir;
void main() {
  const float w0 = 0.2270270, w1 = 0.3162162, w2 = 0.0702703;
  vec3 c = texture(src, vUv).rgb * w0
    + (texture(src, vUv + dir * 1.3846154).rgb + texture(src, vUv - dir * 1.3846154).rgb) * w1
    + (texture(src, vUv + dir * 3.2307692).rgb + texture(src, vUv - dir * 3.2307692).rgb) * w2;
  fragColor = vec4(c, 1.0);
}`;
  const COMP = glsl.header + /* glsl */`
in vec2 vUv; out vec4 fragColor;
uniform sampler2D bg, lines, g1, g2; uniform float a1, a2; uniform vec3 tint;
uniform vec2 bkC, bkH, bkS; uniform vec3 bkCol;
void main() {
  vec3 c = texture(bg, vUv).rgb + texture(lines, vUv).rgb
         + (texture(g1, vUv).rgb * a1 + texture(g2, vUv).rgb * a2) * tint;
  // Round Rock's light at the end: a soft box, product of two smooth steps (normal-CDF edges)
  if (bkCol.r > 0.0) {
    vec2 q = (bkH - abs(gl_FragCoord.xy - bkC)) / max(bkS, vec2(0.25));
    vec2 phi = 1.0 / (1.0 + exp(-1.702 * q));
    c += bkCol * phi.x * phi.y;
  }
  fragColor = vec4(c, 1.0);
}`;
  return { BG, DOWN, BLUR, COMP };
}

// ------------------------------------------------------------------ module
export default {
  id: 'VII',

  async init(ctx) {
    const { THREE, T, W, H, makeTarget, Pass } = ctx;
    const cmp = compile(T);
    const mask = landMask(2048, 1024);
    const lights = buildLights(T, mask, T.mulberry32(0x516E7));
    const grat = graticule();

    // land texture with mipmaps (the globe is minified early on)
    const tex = new THREE.DataTexture(mask.data, mask.W, mask.H, THREE.RedFormat, THREE.UnsignedByteType);
    tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = true; tex.flipY = false; tex.colorSpace = THREE.NoColorSpace;
    tex.needsUpdate = true;

    const sh = makeShaders(ctx);
    const U = (v) => ({ value: v });
    const bgPass = new Pass(sh.BG, {
      aspect: U(ctx.aspect), H: U(H), camX: U(0), friezeAmt: U(1), gridAmt: U(1), globeAmt: U(0), fireAmt: U(0), t: U(0),
      fireP: U(new THREE.Vector2()), gR: U(0.5), gLon0: U(0), gLat0: U(0), bodyAmt: U(0), landAmt: U(0), atmoAmt: U(0),
      starAmt: U(0), dawnAmt: U(0), outAmt: U(1), land: U(tex), warm: U(new THREE.Vector3(...WARM_BLACK)),
    });
    const down = new Pass(sh.DOWN, { src: U(null), texel: U(new THREE.Vector2()) });
    const blur = new Pass(sh.BLUR, { src: U(null), dir: U(new THREE.Vector2()) });
    const comp = new Pass(sh.COMP, { bg: U(null), lines: U(null), g1: U(null), g2: U(null), a1: U(1), a2: U(1), tint: U(new THREE.Vector3(1, 1, 1)),
      bkC: U(new THREE.Vector2()), bkH: U(new THREE.Vector2(1, 1)), bkS: U(new THREE.Vector2(1, 1)), bkCol: U(new THREE.Vector3()) });

    const T2 = (w, h) => makeTarget(Math.max(4, Math.round(w)), Math.max(4, Math.round(h)));
    S = {
      ...cmp, mask, lights, grat, tex, bgPass, down, blur, comp,
      bgT: T2(W, H), lineT: T2(W, H), h2: T2(W / 2, H / 2), h4: T2(W / 4, H / 4), h4b: T2(W / 4, H / 4), h8: T2(W / 8, H / 8), h8b: T2(W / 8, H / 8),
      seg: new SegBatch(ctx, 160000, 'max'),
      spr: new SpriteBatch(ctx, 40000),
      scratch: [0, 0],
      kicks: T.kicks,
      lead: T.notes.filter(n => n.inst === 'lead'),
      clanks: T.sfx.filter(e => e.type === 'clank').map(e => e.t),
      hiss: T.sfx.filter(e => e.type === 'hiss').map(e => e.t),
      whoosh: (T.sfx.find(e => e.type === 'whoosh' && Math.abs(e.t - T.frieze.items[1].t0) < 0.6) || { t: T.frieze.items[1].t0 }).t,
      cityU: T.cities.map(([, la, lo]) => unit(la, lo)),
    };
    S.rrIdx = T.cities.findIndex(c => c[0] === 'Round Rock');
    S.engine = S.items.find(i => i.name === 'engine');
    S.fire = S.items.find(i => i.name === 'fire');
    for (const it of S.items) {
      it.gcode = {};
      for (const g in it.groups) it.gcode[g] = g === 'flame' ? 1 : g === 'smoke' ? 2 : 0;
    }
    // printed sheets: text is struck on the clank times
    const press = S.items.find(i => i.name === 'press');
    for (const st of press.strokes) if (st.printed >= 0) {
      const tc = S.clanks[st.printed] ?? press.t0;
      st.ta = tc + 0.03 + st.a * 0; st.tb = tc + 0.42;
    }
    // whole-stroke text order inside each sheet (seq within [0.03, 0.42] after the hit)
    for (let k = 0; k < 4; k++) {
      const list = press.strokes.filter(s => s.printed === k);
      list.forEach((s, i) => { const tc = S.clanks[k] ?? press.t0; const u = i / Math.max(1, list.length); s.ta = tc + 0.03 + u * 0.36; s.tb = s.ta + 0.05; });
    }
    S.friezeXFn = T.friezeX;
    ctx0 = ctx;
    buildUnspool(ctx, T);
  },

  render(ctx, t, target) {
    const { renderer: r, W, H, T } = ctx;
    const sc = H / 1080;
    S.seg.begin(); S.spr.begin();
    S.bk = null;
    const env = envelopes(ctx, t);

    const friezeOn = t < 151.2;
    const globeOn = t > 148.95;
    let fireAmt = 0, fireP = [0, 0];
    if (friezeOn) {
      const res = drawFrieze(ctx, t, env, sc);
      fireAmt = res.fireAmt; fireP = res.fireP;
    }
    let G = null;
    if (globeOn) G = drawGlobe(ctx, t, env, sc);

    // ---- background
    const camX = T.friezeCamX(t);
    const gT = sm5(149.3, 150.6, t);
    const view = T.globeView(t);
    S.bgPass.render(r, S.bgT, {
      camX, friezeAmt: 1 - gT, gridAmt: sstep(133.8, 135.5, t) * (1 - sstep(148.6, 149.6, t)), globeAmt: gT, fireAmt, t,
      fireP: new ctx.THREE.Vector2(fireP[0], fireP[1]),
      gR: Math.max(1e-4, view.r), gLon0: view.lon0, gLat0: view.lat0,
      bodyAmt: G ? G.bodyAmt : 0, landAmt: G ? G.landAmt : 0, atmoAmt: G ? G.atmoAmt : 0, starAmt: G ? G.starAmt : 0,
      dawnAmt: G ? G.dawnAmt : 0, outAmt: 1,
    });

    // ---- lines + sprites
    r.autoClear = false;
    ctx.clear(S.lineT, [0, 0, 0]);
    S.seg.render(r, S.lineT, 2.2 * sc, 0.05);
    S.spr.render(r, S.lineT);
    r.autoClear = true;

    // ---- glow: ½ → ¼ (blur) → ⅛ (blur)
    const V2 = (x, y) => new ctx.THREE.Vector2(x, y);
    S.down.render(r, S.h2, { src: S.lineT.texture, texel: V2(1 / W, 1 / H) });
    S.down.render(r, S.h4, { src: S.h2.texture, texel: V2(2 / W, 2 / H) });
    S.blur.render(r, S.h4b, { src: S.h4.texture, dir: V2(4 / W, 0) });
    S.blur.render(r, S.h4, { src: S.h4b.texture, dir: V2(0, 4 / H) });
    S.down.render(r, S.h8, { src: S.h4.texture, texel: V2(4 / W, 4 / H) });
    S.blur.render(r, S.h8b, { src: S.h8.texture, dir: V2(8 / W, 0) });
    S.blur.render(r, S.h8, { src: S.h8b.texture, dir: V2(0, 8 / H) });

    const warmTint = [1.0, 0.6, 0.3], coolTint = [0.75, 0.92, 1.15];
    const tint = warmTint.map((w, i) => w + (coolTint[i] - w) * gT);
    const glowGain = (1 + 0.12 * env.kick + 0.5 * env.feat.rms);
    S.comp.render(r, target, {
      bg: S.bgT.texture, lines: S.lineT.texture, g1: S.h4.texture, g2: S.h8.texture,
      a1: (0.42 - 0.12 * gT) * glowGain, a2: (0.36 - 0.1 * gT) * glowGain, tint: new ctx.THREE.Vector3(...tint),
      bkC: new ctx.THREE.Vector2(S.bk ? S.bk.cx : 0, S.bk ? S.bk.cy : 0), bkH: new ctx.THREE.Vector2(S.bk ? S.bk.hx : 1, S.bk ? S.bk.hy : 1),
      bkS: new ctx.THREE.Vector2(S.bk ? S.bk.sx : 1, S.bk ? S.bk.sy : 1), bkCol: new ctx.THREE.Vector3(...(S.bk ? S.bk.col : [0, 0, 0])),
    });
    r.setRenderTarget(null);
  },

  post(t) {
    const g = sm5(149.5, 151, t);
    return {
      bloom: 0.62 - 0.1 * g, threshold: 1.0, knee: 0.6, bloomRadius: 1.0,
      vignette: 0.38, grain: 0.03 - 0.008 * g, ca: 0.0012, saturation: 1.0, lift: 0.0,
    };
  },

  drawUI(g, t, alpha, ui) {
    if (!S) return;
    // Round Rock's label while the arcs converge (gone before the single-point hand-off)
    const la = sstep(157.15, 157.6, t) * (1 - sstep(158.45, 158.85, t)) * alpha;
    if (la > 0.003) {
      const c = ctx0.T.cities[S.rrIdx], p = ctx0.T.globeProject(t, c[1], c[2]);
      const x = (p.x * 0.5 + 0.5) * 1920, y = (0.5 - p.y * 0.5) * 1080;
      g.save();
      g.strokeStyle = `rgba(255,236,210,${(0.45 * la).toFixed(3)})`; g.lineWidth = 1;
      g.beginPath(); g.moveTo(x + 9, y - 9); g.lineTo(x + 34, y - 34); g.lineTo(x + 58, y - 34); g.stroke();
      ui.glyphReveal('ROUND ROCK, TEXAS', x + 64, y - 30, sstep(157.2, 157.9, t), { font: `500 13px ${ctx0.FONTS.mono}`, spacing: 2.2, alpha: 0.82 * la, color: '255,238,214', stagger: 0.04, rise: 4 });
      ui.glyphReveal('30.51° N  97.68° W', x + 64, y - 12, sstep(157.35, 158.1, t), { font: `400 11px ${ctx0.FONTS.mono}`, spacing: 1.6, alpha: 0.5 * la, color: '200,225,255', stagger: 0.03, rise: 3 });
      g.restore();
    }
    // Small engraved plate numbers under each figure, riding with the frieze.
    if (t > 150.5) return;
    for (const it of S.items) {
      const x = 960 + S.friezeXFn(it.wx, t) * 960;
      if (x < -200 || x > 2120) continue;
      const shown = sstep(it.drawE - 0.4, it.drawE + 0.5, t) * (it.name === 'engine' ? 1 - sstep(148.8, 149.4, t) : 1);
      if (shown < 0.01) continue;
      const label = PLATES[it.name];
      if (!label) continue;
      const y = 540 + label.y;
      g.save();
      ui.glyphReveal(label.fig, x, y, shown, { font: `italic 400 17px ${ctx0.FONTS.serif}`, spacing: 1.5, align: 'center', alpha: 0.62 * alpha, color: '255,214,160', stagger: 0.08 });
      g.restore();
    }
  },
};

const PLATES = {
  fire: { fig: 'Fig. 1 — Ignis', y: 262 },
  wheel: { fig: 'Fig. 2 — Rota', y: 330 },
  press: { fig: 'Fig. 3 — Prelum', y: 356 },
  engine: { fig: 'Fig. 4 — Machina vaporis', y: 296 },
};
let ctx0 = null;

// ------------------------------------------------------------------ envelopes (music)
function envelopes(ctx, t) {
  const K = S.kicks;
  let lo = 0, hi = K.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (K[m] <= t) lo = m + 1; else hi = m; }
  let kick = 0;
  for (let i = lo - 1; i >= Math.max(0, lo - 3); i--) kick += Math.exp(-(t - K[i]) / 0.13);
  let lead = 0;
  for (const n of S.lead) { const d = t - n.t; if (d >= 0 && d < 0.8) lead += n.vel * Math.exp(-d / 0.24); }
  const feat = ctx.features.at(t);
  return { kick, lead, feat };
}

// ------------------------------------------------------------------ frieze
const AFF_ID = [1, 0, 0, 1, 0, 0];
const rotAbout = (cx, cy, th) => { const c = Math.cos(th), s = Math.sin(th); return [c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy]; };
const trans = (dx, dy) => [1, 0, 0, 1, dx, dy];
const rigid = (p0x, p0y, q0x, q0y, px, py, qx, qy) => {
  const a = Math.atan2(qy - py, qx - px) - Math.atan2(q0y - p0y, q0x - p0x), c = Math.cos(a), s = Math.sin(a);
  return [c, s, -s, c, px - (c * p0x - s * p0y), py - (s * p0x + c * p0y)];
};
const mul = (A, B) => [A[0] * B[0] + A[2] * B[1], A[1] * B[0] + A[3] * B[1], A[0] * B[2] + A[2] * B[3], A[1] * B[2] + A[3] * B[3], A[0] * B[4] + A[2] * B[5] + A[4], A[1] * B[4] + A[3] * B[5] + A[5]];

/** Per-frame group transforms (affine) and gains for one item. */
function itemPose(it, t, env) {
  const M = {}, gain = {};
  for (const g in it.groups) { M[g] = AFF_ID; gain[g] = 1; }
  const k = { flick: 0, leap: 0 };
  let fx = null;
  if (it.name === 'fire') {
    k.flick = sstep(134.1, 134.9, t);
    k.leap = 0.05 * env.kick * k.flick + 0.03 * env.lead;
    gain.flame = 1 + 0.12 * Math.sin(t * 17.3) * k.flick + 0.1 * env.kick;
    gain.coals = 1 + 0.25 * Math.sin(t * 11.1 + 1) * k.flick;
  } else if (it.name === 'gears') {
    const { A, B } = INTER.GEARS;
    const phi = Math.atan2(B.cy - A.cy, B.cx - A.cx);
    const w = 1.1 * Math.max(0, t - (it.drawE - 0.4)) + 0.35 * sstep(it.drawE - 0.4, it.drawE + 1.2, t);
    const a0 = phi - 2 * Math.PI * 0.46 / A.n, b0 = phi + Math.PI - 2 * Math.PI * 0.96 / B.n;
    M.gearA = rotAbout(A.cx, A.cy, a0 + w);
    M.gearB = rotAbout(B.cx, B.cy, b0 - w * A.n / B.n);
  } else if (it.name === 'wheel') {
    const th = WHEEL.spin(t, it.spinT0);
    M.rot = rotAbout(WHEEL.C[0], WHEEL.C[1], th);
    fx = { th, w: (WHEEL.spin(t + 0.01, it.spinT0) - WHEEL.spin(t - 0.01, it.spinT0)) / 0.02 };
  } else if (it.name === 'press') {
    const dr = PRESS.drop(t, S.clanks), u = dr / PRESS.DROP;
    let sx = 0, sy = 0, flash = 0;
    for (const tc of S.clanks) {
      const x = t - tc;
      if (x >= 0 && x < 0.4) {
        const e = Math.exp(-x / 0.07);
        sy += 2.4 * e * Math.sin(2 * Math.PI * 26 * x); sx += 1.2 * e * Math.sin(2 * Math.PI * 19 * x + 1);
        flash += Math.exp(-x / 0.12);
      }
    }
    const shake = trans(sx, sy);
    for (const g in M) M[g] = shake;
    M.screw = mul(shake, trans(0, dr));
    M.hose = mul(shake, trans(0, dr));
    const [pvx, pvy] = PRESS.PIVOT;
    const bar = mul(trans(pvx, pvy + dr), mul(rotAbout(0, 0, -6 * D2R * u), mul([Math.cos(52 * D2R * u), 0, 0, 1, 0, 0], trans(-pvx, -pvy))));
    M.bar = mul(shake, bar);
    gain.hose = 1 + 1.1 * flash; gain.static = 1 + 0.35 * flash; gain.screw = 1 + 0.6 * flash; gain.bar = 1 + 0.5 * flash;
    fx = { flash, dr };
  } else if (it.name === 'engine') {
    const th = crankAngle(t);
    const K = ENGINE.kin(th), K0 = ENGINE.K0;
    const [fcx, fcy] = ENGINE.FC;
    M.fly = rotAbout(fcx, fcy, th);
    M.rod = rigid(K0.xx, 0, K0.px, K0.py, K.xx, 0, K.px, K.py);
    M.xh = trans(K.xx - K0.xx, 0);
    M.valve = trans(K.vx - K0.vx, 0);
    M.ecc = rigid(K0.vx, -80, K0.ex, K0.ey, K.vx, -80, K.ex, K.ey);
    const run = sstep(145.9, 146.8, t);
    let pk = 0;
    for (const h of S.hiss) { const x = t - h; if (x >= 0 && x < 0.5) pk += Math.exp(-x / 0.1); }
    M.needle = rotAbout(-220, -158, (95 * run + 9 * pk) * D2R);
    const psi = (18 + 20 * run) * D2R, phi = 2 * th;
    const [gx, gy] = ENGINE.GOV, Lb = 62;
    const armM = (sgn) => { const c = sgn * Math.sin(psi) * Math.cos(phi), d = Math.cos(psi); return [1, 0, c, d, gx - (gx + c * gy), gy - d * gy]; };
    M.govL = armM(-1); M.govR = armM(1);
    M.ballL = trans(-Lb * Math.sin(psi) * Math.cos(phi), Lb * Math.cos(psi) - Lb);
    M.ballR = trans(Lb * Math.sin(psi) * Math.cos(phi), Lb * Math.cos(psi) - Lb);
    M.sleeve = trans(0, -(Math.cos(18 * D2R) - Math.cos(psi)) * 60);
    const behind = Math.sin(phi);
    gain.ballL = gain.govL = 1 - 0.35 * sat(behind);
    gain.ballR = gain.govR = 1 - 0.35 * sat(-behind);
    fx = { th, K, pk, run };
  }
  return { M, gain, k, fx };
}

function crankAngle(t) {
  const H = S.hiss;
  if (!H.length || t <= H[0]) return 0;
  for (let i = 0; i < H.length - 1; i++) if (t < H[i + 1]) return Math.PI * (i + (t - H[i]) / (H[i + 1] - H[i]));
  const dt = H.length > 1 ? H[H.length - 1] - H[H.length - 2] : 0.5;
  return Math.PI * (H.length - 1 + (t - H[H.length - 1]) / dt);
}

/** Clip a segment against rects (local coords); calls emit(x0,y0,x1,y1,u0,u1) for visible parts. */
function clipEmit(x0, y0, x1, y1, rects, ri, u0, u1, emit) {
  if (!rects || ri >= rects.length) { emit(x0, y0, x1, y1, u0, u1); return; }
  const [rx0, ry0, rx1, ry1] = rects[ri];
  const dx = x1 - x0, dy = y1 - y0;
  let tin = 0, tout = 1;
  const pp = [-dx, dx, -dy, dy], qq = [x0 - rx0, rx1 - x0, y0 - ry0, ry1 - y0];
  for (let i = 0; i < 4; i++) {
    if (Math.abs(pp[i]) < 1e-9) { if (qq[i] < 0) { tin = 1; tout = 0; break; } }
    else { const r = qq[i] / pp[i]; if (pp[i] < 0) tin = Math.max(tin, r); else tout = Math.min(tout, r); }
  }
  if (tin >= tout) { clipEmit(x0, y0, x1, y1, rects, ri + 1, u0, u1, emit); return; }
  if (tin > 1e-4) clipEmit(x0, y0, x0 + dx * tin, y0 + dy * tin, rects, ri + 1, u0, u0 + (u1 - u0) * tin, emit);
  if (tout < 1 - 1e-4) clipEmit(x0 + dx * tout, y0 + dy * tout, x1, y1, rects, ri + 1, u0 + (u1 - u0) * tout, u1, emit);
}

function itemAnchor(ctx, it, t) {
  const ax = ctx.T.friezeX(it.wx, t);
  return [(ax * 0.5 + 0.5) * ctx.W, ctx.H * 0.5];
}

/** Emit one stroke's visible part. mode: normal draw-on. Returns tip (local) or null. */
function emitStroke(ctx, it, st, pose, t, AX, AY, sc, gainAll, alpha) {
  const q = (t - st.ta) / (st.tb - st.ta);
  if (q <= 0 || alpha <= 0.001) return;
  const qq = q >= 1 ? 1 : q;
  const L = st.len, Lv = qq * L;
  const { VX, VY, VS, seg, spr, scratch } = S;
  const M = pose.M[st.g] || AFF_ID, gcode = it.gcode[st.g], k = pose.k;
  const g = (pose.gain[st.g] ?? 1) * gainAll * alpha;
  const dur = st.tb - st.ta;
  const heatAmt = 1.1 * Math.min(1.4, st.I);
  let px = 0, py = 0, pr = 0, pg = 0, pb = 0, pw = 0, ps = 0, have = false;
  const v0 = st.v0, n = st.n;
  for (let j = 0; j < n; j++) {
    const v = v0 + j;
    let s = VS[v], lx = VX[v], ly = VY[v], last = false;
    if (s > Lv && j > 0) {
      const sp = VS[v - 1], u = (Lv - sp) / Math.max(1e-6, s - sp);
      lx = VX[v - 1] + (lx - VX[v - 1]) * u; ly = VY[v - 1] + (ly - VY[v - 1]) * u; s = Lv; last = true;
    }
    if (gcode) { FIRE.deform(gcode, st.tg, lx, ly, t, k, scratch); lx = scratch[0]; ly = scratch[1]; }
    const tx = M[0] * lx + M[2] * ly + M[4], ty = M[1] * lx + M[3] * ly + M[5];
    // pen pressure: taper at the stroke ends (not on closed loops), gentle swell mid-stroke
    let tw = 1, ti = 1;
    if (!st.closed) { const e = Math.min(1, s / 9) * Math.min(1, (L - s) / 13); tw = 0.4 + 0.6 * e; ti = 0.55 + 0.45 * e; }
    tw *= 1 + 0.12 * Math.sin(Math.PI * s / Math.max(1, L));
    if (st.fadeEnd) ti *= 1 - 0.85 * s / Math.max(1, L);
    const age = t - (st.ta + (s / L) * dur);
    const heat = age >= 0 ? Math.exp(-age / 0.22) : 0;
    const cr = st.r * ti * g + HOT[0] * heat * heatAmt * alpha, cg = st.gg * ti * g + HOT[1] * heat * heatAmt * alpha, cb = st.bb * ti * g + HOT[2] * heat * heatAmt * alpha;
    const w = st.w * tw * sc * (1 + 0.5 * heat);
    if (have) {
      if (st.clip) {
        clipEmit(px, py, tx, ty, st.clip, 0, 0, 1, (x0, y0, x1, y1, u0, u1) => {
          seg.seg(AX + x0 * sc, AY - y0 * sc, AX + x1 * sc, AY - y1 * sc, pw + (w - pw) * u0, pw + (w - pw) * u1,
            pr + (cr - pr) * u0, pg + (cg - pg) * u0, pb + (cb - pb) * u0, pr + (cr - pr) * u1, pg + (cg - pg) * u1, pb + (cb - pb) * u1);
        });
      } else {
        seg.seg(AX + px * sc, AY - py * sc, AX + tx * sc, AY - ty * sc, pw, w, pr, pg, pb, cr, cg, cb);
      }
    }
    px = tx; py = ty; pr = cr; pg = cg; pb = cb; pw = w; ps = s; have = true;
    if (last) break;
  }
  if (qq < 1 && have) {
    // the burning pen tip
    const b = 1.5 * Math.min(1.3, st.I) * alpha * Math.min(1, st.len * qq / 12);
    spr.add(AX + px * sc, AY - py * sc, 0.9 * sc, 2.8 * sc, HOT[0] * b, HOT[1] * b, HOT[2] * b, 0.5);
  }
}

function drawFrieze(ctx, t, env, sc) {
  const { W, H, T } = ctx;
  const gainAll = 1 + 0.08 * env.kick + 0.07 * env.lead + 0.35 * env.feat.rms;
  let fireAmt = 0, fireP = [0, 0];
  for (const it of S.items) {
    const [AX, AY] = itemAnchor(ctx, it, t);
    const [ex0, ey0, ex1, ey1] = it.extent;
    if (AX + ex1 * sc < -40 || AX + ex0 * sc > W + 40) continue;
    if (t < it.drawS - 0.05 && it.name !== 'fire') continue;
    // the engine hands its lines to the globe from 149 s
    const eng = it.name === 'engine';
    if (eng && t > 149.0) continue;
    const pose = itemPose(it, t, env);
    const alpha = eng ? 1 : 1 - sstep(148.9, 149.6, t);
    if (alpha <= 0.001) continue;
    for (const st of it.strokes) emitStroke(ctx, it, st, pose, t, AX, AY, sc, gainAll, alpha);
    if (it.name === 'fire') {
      const r = fireFx(ctx, it, pose, t, AX, AY, sc, env);
      fireAmt = r.amt; fireP = r.p;
    } else if (it.name === 'press') pressFx(ctx, it, pose, t, AX, AY, sc);
    else if (it.name === 'wheel') wheelFx(ctx, it, pose, t, AX, AY, sc, alpha);
    else if (eng) engineFx(ctx, it, pose, t, AX, AY, sc, 1);
  }
  return { fireAmt, fireP };
}

// ---- fire: the ember (VI→VII contract), sparks, firelight
function fireFx(ctx, it, pose, t, AX, AY, sc, env) {
  const { W, H, T } = ctx;
  const spr = S.spr, seg = S.seg;
  const lit = sstep(134.0, 134.7, t);
  // Ember at the exact centre until the fire takes it (same colour/size as VI's glint).
  const Hh = ctx.H;
  const rc = 0.006 * Hh * (1 - 0.35 * lit);
  const fl = 1 + 0.18 * lit * Math.sin(t * 23.0) * Math.sin(t * 7.7 + 1);
  const eb = 4 * fl;
  spr.add(AX, AY, rc, 0.016 * Hh * (1 + 1.2 * lit), EMBER[0] * eb, EMBER[1] * eb, EMBER[2] * eb, 0.22 + 0.2 * lit);
  // sparks rising from the flames
  if (lit > 0.01) {
    for (let i = 0; i < 34; i++) {
      const P = 1.1 + 1.3 * T.hash1(i * 7 + 1), off = T.hash1(i * 13 + 5) * P;
      const x0 = 134.2 + off;
      if (t < x0) continue;
      const cyc = Math.floor((t - x0) / P), a = (t - x0) - cyc * P;
      const h1 = T.hash1(i * 1009 + cyc * 17), h2 = T.hash1(i * 311 + cyc * 29 + 3), h3 = T.hash1(i * 71 + cyc * 5 + 9);
      const sx = (h1 - 0.5) * 150, sy = -40 - h2 * 170, v = 150 + 140 * h3;
      const pos = (aa) => [sx + Math.sin(aa * 2.6 + h1 * 9) * 22 * aa + (h3 - 0.5) * 40 * aa, sy - aa * v - aa * aa * 40];
      const [x1, y1] = pos(a), [x0p, y0p] = pos(Math.max(0, a - 0.035));
      const life = Math.sin(Math.PI * a / P);
      const b = life * life * (0.7 + 0.6 * Math.sin(t * 31 + i)) * 1.8 * lit;
      if (b < 0.02) continue;
      seg.seg(AX + x0p * sc, AY - y0p * sc, AX + x1 * sc, AY - y1 * sc, 0.5 * sc, 0.7 * sc, 1.0 * b, 0.62 * b, 0.28 * b, 1.0 * b, 0.8 * b, 0.5 * b);
    }
  }
  const pAmt = lit * (1 + 0.15 * Math.sin(t * 9.1) + 0.1 * Math.sin(t * 23.7) + 0.2 * env.kick);
  return { amt: 0.2 + 0.8 * pAmt, p: [(AX / W) * 2 - 1, (AY + 110 * lit * sc) / H * 2 - 1] };
}

// ---- wheel: motion streaks trailing the spokes while it spins up on the whoosh
function wheelFx(ctx, it, pose, t, AX, AY, sc, alpha) {
  const fx = pose.fx;
  if (!fx || fx.w <= 0.05) return;
  const seg = S.seg, [cx, cy] = WHEEL.C;
  const sp = Math.min(1, fx.w / (2 * Math.PI * 0.42));
  const trail = 0.38 * sp;
  for (let k = 0; k < 12; k++) {
    const a0 = (k * 30 + 5) * D2R + fx.th;
    for (const [r, amp] of [[96, 0.7], [150, 1.0], [200, 0.8]]) {
      let px = 0, py = 0;
      for (let j = 0; j <= 8; j++) {
        const a = a0 - trail * j / 8, x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
        if (j) {
          const b0 = 0.16 * amp * sp * alpha * (1 - (j - 1) / 8), b1 = 0.16 * amp * sp * alpha * (1 - j / 8);
          seg.seg(AX + px * sc, AY - py * sc, AX + x * sc, AY - y * sc, 0.5 * sc, 0.5 * sc,
            b0, 0.55 * b0, 0.22 * b0, b1, 0.55 * b1, 0.22 * b1);
        }
        px = x; py = y;
      }
    }
  }
}

// ---- press: impact light along the platen and flying sparks
function pressFx(ctx, it, pose, t, AX, AY, sc) {
  const spr = S.spr, seg = S.seg;
  for (const tc of S.clanks) {
    const x = t - tc;
    if (x < 0 || x > 0.5) continue;
    const e = Math.exp(-x / 0.06);
    for (let k = -7; k <= 7; k++) {
      const lx = k * 13.5, ly = -8;
      spr.add(AX + lx * sc, AY - ly * sc, 0.7 * sc, 5 * sc, 1.0 * e * 1.1, 0.8 * e * 1.1, 0.55 * e * 1.1, 0.6);
    }
    for (let k = 0; k < 14; k++) {
      const side = k % 2 ? 1 : -1, h = ctx.T.hash1(k * 91 + Math.round(tc * 10));
      const vx = side * (160 + 260 * h), vy = -60 - 160 * ctx.T.hash1(k * 37 + 5);
      const p = (a) => [side * 100 + vx * a, -8 + vy * a + 600 * a * a];
      const [x1, y1] = p(x), [x0, y0] = p(Math.max(0, x - 0.03));
      const b = Math.exp(-x / 0.18) * 1.6;
      seg.seg(AX + x0 * sc, AY - y0 * sc, AX + x1 * sc, AY - y1 * sc, 0.45 * sc, 0.6 * sc, b, 0.7 * b, 0.35 * b, b, 0.85 * b, 0.6 * b);
    }
  }
}

// ---- engine: steam puffs at the stack on each hiss, drain-cock jets, cylinder steam glow
function engineFx(ctx, it, pose, t, AX, AY, sc, alpha) {
  const spr = S.spr, seg = S.seg;
  const fx = pose.fx;
  if (!fx || alpha <= 0) return;
  for (let hi = 0; hi < S.hiss.length; hi++) {
    const h = S.hiss[hi], a = t - h;
    if (a < 0 || a > 1.1) continue;
    const fade = Math.pow(1 - a / 1.1, 1.6) * alpha * sstep(it.drawS + 0.72 * (it.drawE - it.drawS), it.drawE, h);
    for (let j = 0; j < 4; j++) {
      const hh = ctx.T.hash1(hi * 13 + j);
      const cx = -422 + (hh - 0.5) * 30 * a + j * 6 * a * 10 * (hh - 0.3), cy = -322 - a * (95 + 40 * hh) - j * 16 * Math.pow(a, 0.7);
      const rad = 5 + 30 * Math.pow(a, 0.6) * (0.6 + 0.5 * hh);
      const a0 = hh * 6.28, span = 4.2;
      let px = 0, py = 0;
      for (let k = 0; k <= 18; k++) {
        const ang = a0 + span * k / 18, rr = rad * (1 - 0.35 * k / 18);
        const x = cx + Math.cos(ang) * rr, y = cy + Math.sin(ang) * rr;
        if (k) { const b = 0.7 * fade * (1 - k / 22); seg.seg(AX + px * sc, AY - py * sc, AX + x * sc, AY - y * sc, 0.55 * sc, 0.55 * sc, b, 0.62 * b, 0.34 * b, b, 0.62 * b, 0.34 * b); }
        px = x; py = y;
      }
    }
    // drain-cock jets under the cylinder
    if (a < 0.35) {
      const e = (1 - a / 0.35) * alpha * sstep(it.drawS + 0.3 * (it.drawE - it.drawS), it.drawS + 0.5 * (it.drawE - it.drawS), h);
      for (const [x0, dir] of [[-360, -1], [-220, 1]]) {
        for (let j = 0; j < 3; j++) {
          const l = 18 + 40 * a + j * 8, ang = (100 + dir * (18 + j * 10)) * D2R;
          const xa = x0, ya = 62, xb = x0 + Math.cos(ang) * l * -dir * -1, yb = 62 + Math.sin(ang) * l;
          seg.seg(AX + xa * sc, AY - ya * sc, AX + xb * sc, AY - yb * sc, 0.5 * sc, 0.3 * sc, 0.8 * e, 0.6 * e, 0.4 * e, 0.1 * e, 0.07 * e, 0.05 * e);
        }
      }
    }
  }
  // steam glow in the working chamber (alternates each stroke)
  if (fx.run > 0.01) {
    const X = fx.K.xx, pistonL = X - 200, pistonR = X - 174;
    const ph = ((fx.th / Math.PI) % 2 + 2) % 2;
    const front = ph < 1;
    const x0 = front ? pistonR : -372, x1 = front ? -208 : pistonL;
    const cut = Math.exp(-(ph % 1) * 2.2);
    const b = 0.22 * cut * fx.run * alpha;
    for (let k = 0; k < 4; k++) {
      const xx = x0 + (x1 - x0) * (k + 0.5) / 4;
      spr.add(AX + xx * sc, AY, 0, Math.max(6, (x1 - x0) / 5) * sc, 1.0 * b, 0.8 * b, 0.6 * b, 1);
    }
  }
}

// ------------------------------------------------------------------ globe
function viewRot(v) {
  const lo = v.lon0 * D2R, la = v.lat0 * D2R;
  return { cl: Math.cos(lo), sl: Math.sin(lo), ca: Math.cos(la), sa: Math.sin(la) };
}
/** world unit vector → view (x, y, z); z > 0 faces the camera. Identical to T.globeProject. */
function toView(R, wx, wy, wz, out) {
  const x = wx * R.cl - wz * R.sl, z1 = wx * R.sl + wz * R.cl;
  out[0] = x; out[1] = wy * R.ca - z1 * R.sa; out[2] = wy * R.sa + z1 * R.ca;
}

function buildUnspool(ctx, T) {
  // Split the graticule into as many pieces as the engine has strokes (minus the rim loops,
  // which become the limb), then match strokes to pieces by angle around the screen centre.
  const eng = S.engine;
  const strokes = eng.strokes;
  const rims = [], rest = [];
  strokes.forEach((st, i) => { if (st.g === 'fly' && st.closed && st.len > 1000) rims.push(i); else rest.push(i); });
  const lines = S.grat;
  const lens = lines.map(l => { let L = 0; for (let k = 1; k < l.pts.length; k++) { const a = l.pts[k - 1], b = l.pts[k]; L += Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); } return L; });
  const total = lens.reduce((a, b) => a + b, 0);
  const n = rest.length, K = 40;
  const pieceLen = total / n;
  const pieces = [];
  // walk all lines, cutting pieces of equal length
  lines.forEach((l, li) => {
    const cum = [0];
    for (let k = 1; k < l.pts.length; k++) { const a = l.pts[k - 1], b = l.pts[k]; cum.push(cum[k - 1] + Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])); }
    const cnt = Math.max(1, Math.round(lens[li] / pieceLen));
    for (let p = 0; p < cnt; p++) {
      const s0 = lens[li] * p / cnt, s1 = lens[li] * (p + 1) / cnt;
      const pts = new Float32Array(K * 3);
      for (let j = 0; j < K; j++) {
        const s = s0 + (s1 - s0) * j / (K - 1);
        let k = 1; while (k < cum.length - 1 && cum[k] < s) k++;
        const u = (s - cum[k - 1]) / Math.max(1e-9, cum[k] - cum[k - 1]);
        const a = l.pts[k - 1], b = l.pts[k];
        let x = a[0] + (b[0] - a[0]) * u, y = a[1] + (b[1] - a[1]) * u, z = a[2] + (b[2] - a[2]) * u;
        const m = Math.hypot(x, y, z); pts[j * 3] = x / m; pts[j * 3 + 1] = y / m; pts[j * 3 + 2] = z / m;
      }
      pieces.push({ pts, kind: l.kind });
    }
  });
  // angles at the moment of the hand-over
  const tRef = 150.0, v = T.globeView(tRef), R = viewRot(v), o = [0, 0, 0];
  const pieceAng = pieces.map((p, i) => {
    let sx = 0, sy = 0, sz = 0;
    for (let j = 0; j < K; j++) { toView(R, p.pts[j * 3], p.pts[j * 3 + 1], p.pts[j * 3 + 2], o); sx += o[0]; sy += o[1]; sz += o[2]; }
    return { i, a: Math.atan2(sy, sx), front: sz > 0 };
  });
  const tS = 149.2, pose = itemPose(eng, tS, { kick: 0, lead: 0, feat: { rms: 0 } });
  const [AX] = [(T.friezeX(eng.wx, tS) * 0.5 + 0.5) * ctx.W];
  const strokeInfo = rest.map((si) => {
    const st = strokes[si], M = pose.M[st.g] || AFF_ID;
    let sx = 0, sy = 0, c = 0;
    for (let j = 0; j < st.n; j += 2) {
      const lx = S.VX[st.v0 + j], ly = S.VY[st.v0 + j];
      sx += M[0] * lx + M[2] * ly + M[4]; sy += M[1] * lx + M[3] * ly + M[5]; c++;
    }
    const x = (AX - ctx.W / 2) / (ctx.H / 1080) + sx / c, y = -(sy / c);
    return { si, a: Math.atan2(y, x), d: Math.hypot(x, y) };
  });
  pieceAng.sort((p, q) => p.a - q.a);
  strokeInfo.sort((p, q) => p.a - q.a);
  const maxD = Math.max(...strokeInfo.map(s => s.d));
  const map = [];
  // rotate the pairing so front-facing pieces go to the strokes nearest the centre
  strokeInfo.forEach((s, k) => {
    const p = pieces[pieceAng[Math.floor(k * pieceAng.length / strokeInfo.length)].i];
    const s0 = 149.02 + 0.98 * Math.pow(1 - s.d / maxD, 1.1) + 0.08 * ctx.T.hash1(s.si * 3 + 1);
    map.push({ si: s.si, piece: p, s0, s1: s0 + 0.48 });
  });
  S.unspool = { map, rims, K, pieces };
}

function drawGlobe(ctx, t, env, sc) {
  const { W, H, T } = ctx;
  const aspect = W / H;
  const v = T.globeView(t);
  const R = viewRot(v);
  const rN = v.r;                          // radius in half-heights
  const toPx = (x, y, out) => { out[0] = (x * rN / aspect * 0.5 + 0.5) * W; out[1] = (y * rN * 0.5 + 0.5) * H; };
  const seg = S.seg, spr = S.spr;
  const o = [0, 0, 0], p = [0, 0];
  const out = 1 - sstep(158.75, 159.2, t);           // everything but Round Rock falls away
  const bodyAmt = sm5(149.9, 150.9, t) * (1 - sstep(158.8, 159.25, t));
  const landAmt = sm5(150.2, 151.6, t) * out;
  const atmoAmt = sm5(149.7, 151.0, t) * (1 - sstep(158.4, 159.1, t));
  const starAmt = sm5(150.0, 151.2, t) * (1 - sstep(157.4, 158.8, t));
  const dawnAmt = sm5(150.5, 152.5, t) * (1 - sstep(157.0, 158.5, t));
  const zoom = Math.pow(Math.max(0.4, rN) / 0.8, 0.32);
  const kickG = 1 + 0.22 * env.kick + 0.3 * env.feat.high;

  // ---- unspool (149–150.6) and the graticule
  const U = S.unspool, eng = S.engine;
  const u = (t - 149.0) / 1.6;
  const settle = sm5(150.45, 151.7, t);
  const frontI = (0.3 * (1 - settle) + 0.045 * settle) * (1 - sstep(156.5, 158.0, t));
  const backI = 0.1 * (1 - sm5(150.1, 150.9, t));
  if (t < 158.3 && rN > 1e-3) {
    const pose = t < 150.9 ? itemPose(eng, t, env) : null;
    const [EAX, EAY] = itemAnchor(ctx, eng, t);
    const K = U.K;
    const fcS = pose ? [EAX + (pose.M.fly[4] + pose.M.fly[0] * ENGINE.FC[0] + pose.M.fly[2] * ENGINE.FC[1]) * sc, EAY - (pose.M.fly[5] + pose.M.fly[1] * ENGINE.FC[0] + pose.M.fly[3] * ENGINE.FC[1]) * sc] : null;
    const limbPx = rN * H * 0.5;
    // rim loops → the limb (a similarity: flywheel centre → screen centre, radius → globe radius)
    for (const si of U.rims) {
      const st = eng.strokes[si];
      const m = sm5(149.15, 149.75, t);
      const rimR = st.len / (2 * Math.PI) * sc;
      if (m >= 1 && t > 150.8) continue;               // the body's own edge takes over
      const I = (1 - m) * 1 + m * 0.6 * (1 - sm5(150.2, 150.9, t));
      if (I < 0.01) continue;
      let px = 0, py = 0;
      for (let j = 0; j <= 96; j++) {
        const s = st.len * j / 96;
        const [lx, ly] = sampleLocal(st, s);
        let X, Y;
        if (!pose || !fcS) {
          const a = j / 96 * Math.PI * 2;
          X = W / 2 + Math.cos(a) * limbPx; Y = H / 2 + Math.sin(a) * limbPx;
        } else {
          const M = pose.M.fly;
          const tx = M[0] * lx + M[2] * ly + M[4], ty = M[1] * lx + M[3] * ly + M[5];
          X = EAX + tx * sc; Y = EAY - ty * sc;
        }
        if (fcS && pose) {
          // centre glides to the screen centre; the radius only locks on once the growing
          // globe has caught up with the flywheel (≈149.5 s), so the rim never shrinks
          const mr = sm5(149.48, 149.78, t);
          const R2 = rimR + (Math.max(rimR, limbPx) - rimR) * mr;
          const kx = W / 2 + (X - fcS[0]) * R2 / rimR, ky = H / 2 + (Y - fcS[1]) * R2 / rimR;
          X += (kx - X) * m; Y += (ky - Y) * m;
        }
        if (j) {
          const c0 = mix3(COL.gold, CYAN, m), b = I * kickG * (0.9 - 0.35 * m);
          seg.seg(px, py, X, Y, 0.9 * sc, 0.9 * sc, c0[0] * b, c0[1] * b, c0[2] * b, c0[0] * b, c0[1] * b, c0[2] * b);
        }
        px = X; py = Y;
      }
    }
    // other strokes → graticule pieces. Each engine line is pulled off from its start like
    // thread from a spool (its remnant shortens), a filament carries it across, and it is
    // wound onto its graticule piece (which draws on as the remnant is used up).
    for (const mp of U.map) {
      const st = eng.strokes[mp.si], piece = mp.piece;
      const pr = sm5(mp.s0, mp.s1, t);
      let sx = 0, sy = 0;
      if (pr < 1 && pose) {
        const M = pose.M[st.g] || AFF_ID;
        const b = kickG * (1 + 0.6 * Math.sin(Math.PI * pr));
        emitRange(st, M, pr * st.len, st.len, EAX, EAY, sc, st.r * b, st.gg * b, st.bb * b);
        const [lx, ly] = sampleLocal(st, pr * st.len);
        sx = EAX + (M[0] * lx + M[2] * ly + M[4]) * sc; sy = EAY - (M[1] * lx + M[3] * ly + M[5]) * sc;
      }
      if (pr <= 0) continue;
      const hIdx = pr * (K - 1);
      let px = 0, py = 0, pr0 = 0, pg0 = 0, pb0 = 0, pv = false, hx = 0, hy = 0;
      for (let j = 0; j <= Math.ceil(hIdx); j++) {
        const jj = Math.min(j, hIdx), j0 = Math.floor(jj), j1 = Math.min(K - 1, j0 + 1), f = jj - j0;
        const wx = piece.pts[j0 * 3] + (piece.pts[j1 * 3] - piece.pts[j0 * 3]) * f;
        const wy = piece.pts[j0 * 3 + 1] + (piece.pts[j1 * 3 + 1] - piece.pts[j0 * 3 + 1]) * f;
        const wz = piece.pts[j0 * 3 + 2] + (piece.pts[j1 * 3 + 2] - piece.pts[j0 * 3 + 2]) * f;
        toView(R, wx, wy, wz, o);
        toPx(o[0], o[1], p);
        const facing = sstep(-0.05, 0.08, o[2]);
        const I = (frontI * facing + backI * (1 - facing)) * kickG;
        const cr = CYAN[0] * I, cg = CYAN[1] * I, cb = CYAN[2] * I;
        if (pv && I > 0.0015) seg.seg(px, py, p[0], p[1], 0.6 * sc, 0.6 * sc, pr0, pg0, pb0, cr, cg, cb);
        px = p[0]; py = p[1]; pr0 = cr; pg0 = cg; pb0 = cb; pv = true; hx = p[0]; hy = p[1];
      }
      if (pr < 1 && pose) {
        // the filament between spool and globe, bowed so everything winds the same way
        const e = Math.pow(Math.sin(Math.PI * pr), 0.7);
        const dx = hx - sx, dy = hy - sy;
        const cx = (sx + hx) / 2 - dy * 0.28, cy = (sy + hy) / 2 + dx * 0.28;
        let qx = sx, qy = sy;
        for (let k = 1; k <= 14; k++) {
          const u2 = k / 14, a0 = (1 - u2) * (1 - u2), a1 = 2 * (1 - u2) * u2, a2 = u2 * u2;
          const X = a0 * sx + a1 * cx + a2 * hx, Y = a0 * sy + a1 * cy + a2 * hy;
          const c0 = mix3(COL.gold, CYAN, (k - 1) / 14), c1 = mix3(COL.gold, CYAN, u2), b = 0.34 * e;
          seg.seg(qx, qy, X, Y, 0.45 * sc, 0.45 * sc, c0[0] * b, c0[1] * b, c0[2] * b, c1[0] * b, c1[1] * b, c1[2] * b);
          qx = X; qy = Y;
        }
        const hb = 1.1 * e;
        spr.add(hx, hy, 0.8 * sc, 2.6 * sc, 0.8 * hb, 0.95 * hb, 1.0 * hb, 0.5);
      }
    }
    // the engine's steam still breathes while it unspools
    if (pose && t < 149.6) engineFx(ctx, eng, pose, t, EAX, EAY, sc, 1 - sstep(149.0, 149.5, t));
  }

  // ---- city lights
  const L = S.lights;
  const lightsOn = t - 150.05;
  const cityFlash = new Float32Array(T.cities.length);
  for (const a of T.arcs) {
    const tl = a.t + a.dur * 0.92, x = t - tl;
    if (x >= 0 && x < 1.2) cityFlash[a.to] += Math.exp(-x / 0.35);
  }
  if (lightsOn > -0.1 && out > 0.001) {
    const lonC = v.lon0;
    for (let i = 0; i < L.n; i++) {
      toView(R, L.x[i], L.y[i], L.z[i], o);
      if (o[2] < 0.005) continue;
      // lights switch on in a wave from the east limb to the west, over ~1.4 s
      const dl = ((L.lon[i] - lonC + 540) % 360) - 180;          // east of centre → dark first
      const ton = 0.2 + 1.2 * (1 - sat((dl + 90) / 180)) + 0.25 * L.ph[i];
      const on = sstep(ton, ton + 0.3, lightsOn);
      if (on <= 0) continue;
      toPx(o[0], o[1], p);
      if (p[0] < -20 || p[0] > W + 20 || p[1] < -20 || p[1] > H + 20) continue;
      const limb = 0.25 + 0.75 * Math.sqrt(o[2]);
      const tw = 1 + 0.12 * Math.sin(t * (3 + 4 * L.ph[i]) + L.ph[i] * 40);
      const kind = L.kind[i];
      let b = L.b[i] * on * limb * tw * out * (1 + 0.5 * (1 - on) * on * 4);
      const ci = L.city[i];
      if (ci >= 0) b *= 1 + 0.9 * cityFlash[ci];
      const zs = zoom * sc;
      if (kind === 0) {
        spr.add(p[0], p[1], 0.9 * zs, 3.0 * zs, 0.62 * b, 0.42 * b, 0.22 * b, 0.4);
      } else {
        const s = L.s[i];
        spr.add(p[0], p[1], 0.6 * s * zs, 1.4 * s * zs, 0.72 * b, 0.42 * b, 0.17 * b, 0.45);
      }
    }
  }

  // ---- arcs (great circles lifted ∝ distance), fibre pulses, landing flashes
  const arcOut = 1 - sstep(158.85, 159.17, t);
  for (const a of T.arcs) {
    const tl = a.t + a.dur * 0.92;
    const life = a.converge ? 4.0 : 2.4;
    if (t < a.t || t > tl + life || arcOut <= 0) continue;
    const A = S.cityU[a.from], B = S.cityU[a.to];
    const dot = Math.max(-1, Math.min(1, A[0] * B[0] + A[1] * B[1] + A[2] * B[2]));
    const om = Math.acos(dot), so = Math.sin(om) || 1e-6;
    const hgt = 0.025 + 0.2 * om / Math.PI;
    const tau = (t - a.t) / (tl - a.t);
    const head = tau >= 1 ? 1 : 0.5 - 0.5 * Math.cos(Math.PI * tau);
    const fade = t < tl ? 1 : Math.exp(-(t - tl) / (a.converge ? 1.6 : 0.9));
    const N = 90, nh = Math.max(1, Math.ceil(head * N));
    let px = 0, py = 0, pr = 0, pg = 0, pb = 0, pv = false, lvx = -1, lvy = -1;
    for (let j = 0; j <= nh; j++) {
      const s = Math.min(head, j / N);
      const wa = Math.sin((1 - s) * om) / so, wb = Math.sin(s * om) / so;
      const lift = 1 + hgt * Math.sin(Math.PI * s);
      const wx = (A[0] * wa + B[0] * wb) * lift, wy = (A[1] * wa + B[1] * wb) * lift, wz = (A[2] * wa + B[2] * wb) * lift;
      toView(R, wx, wy, wz, o);
      const vis = Math.max(sstep(-0.02, 0.05, o[2]), sstep(1.0, 1.04, o[0] * o[0] + o[1] * o[1]));
      toPx(o[0], o[1], p);
      if (vis > 0.5) { lvx = p[0]; lvy = p[1]; }
      // brightness: a comet head, a faint fibre, and pulses running A → B
      const behind = head - s;
      let I = 0.26 * fade + 1.2 * Math.exp(-behind / 0.05) * (t < tl + 0.05 ? 1 : 0);
      if (t > a.t + 0.25) for (let k = 0; k < 3; k++) {
        const ps = ((t - a.t) * 0.85 - k / 3) % 1;
        if (ps > 0 && ps < head) I += 1.0 * fade * Math.exp(-((s - ps) * (s - ps)) / 0.0006);
      }
      I *= vis * arcOut * kickG;
      const warm = a.converge ? sstep(0.45, 1.0, s) : 0;
      const c = mix3(CYAN, [1.0, 0.8, 0.55], warm);
      const cr = c[0] * I, cg = c[1] * I, cb = c[2] * I;
      if (pv) seg.seg(px, py, p[0], p[1], 0.55 * sc, 0.55 * sc, pr, pg, pb, cr, cg, cb);
      px = p[0]; py = p[1]; pr = cr; pg = cg; pb = cb; pv = true;
    }
    if (t < tl) {
      const b = 3.2 * arcOut;
      spr.add(px, py, 1.0 * sc, 3.2 * sc, 0.85 * b, 0.95 * b, 1.0 * b, 0.5);
    }
    // landing: flash + a ring spreading over the surface
    const x = t - tl;
    if (x >= 0 && x < 0.9) {
      toView(R, B[0], B[1], B[2], o);
      if (o[2] > 0) {
        toPx(o[0], o[1], p);
        const e = Math.exp(-x / 0.1) * arcOut;
        const isRR = a.to === S.rrIdx;
        const fb = (isRR ? 5 : 7) * e;
        spr.add(p[0], p[1], 1.4 * sc * zoom, 6 * sc * zoom, fb, 0.92 * fb, 0.8 * fb, 0.5);
        if (!(isRR && t > 159.0)) {
          const ring = (0.3 + 3.2 * (1 - Math.exp(-x / 0.22))) * D2R * (isRR ? 0.5 : 1);
          const rb = 0.9 * Math.exp(-x / 0.3) * arcOut * (isRR ? sat((159.05 - t) / 0.3) : 1);
          if (rb > 0.01) ringOnSphere(ctx, R, B, ring, rb, sc, toPx);
        }
      } else if (lvx >= 0) {
        // landing behind the Earth: a glint where the fibre dips over the limb
        const e = Math.exp(-x / 0.12) * arcOut * 3.2;
        spr.add(lvx, lvy, 1.0 * sc, 5 * sc, 0.8 * e, 0.92 * e, 1.0 * e, 0.5);
      }
    }
  }

  // ---- Round Rock: the light everything converges on; alone at the end
  {
    const B = S.cityU[S.rrIdx];
    toView(R, B[0], B[1], B[2], o);
    if (o[2] > 0 && t > 149.9) {
      toPx(o[0], o[1], p);
      const on = sstep(150.4, 151.2, t);
      const charge = cityFlash[S.rrIdx];
      if (t < 158.6) {
        const b = on * (2.6 + 1.2 * sstep(156.8, 158.5, t) + 1.6 * charge);
        spr.add(p[0], p[1], 1.2 * sc * zoom, 3.6 * sc * zoom, RR_COL[0] * b, RR_COL[1] * b, RR_COL[2] * b, 0.28);
      } else S.bk = rrBokeh(t, p[0], p[1], sc, zoom, charge);
    }
  }
  return { bodyAmt, landAmt, atmoAmt, starAmt, dawnAmt };
}

// ---- Round Rock's last light → VIII's caret, as one object seen through a racking lens.
// Soft box (half-size h, edge σ, 1080p px; peak HDR luminance P). Keyframes from 159.95 are
// measured in VIII's own linear-HDR frames; before that the 0.012 H point defocuses into
// VIII's bokeh (44×48 px at half max, taller soft edges) at constant energy, so it dims as
// it grows.
const BK = [
  [159.95, 22, 24, 6.6, 12.1, 3.33], [160.05, 21, 22, 6.8, 12.1, 3.56], [160.10, 18, 20, 6.6, 11.7, 4.12],
  [160.15, 14, 18, 6.1, 10.5, 4.92], [160.20, 10.5, 18.5, 5.1, 7.0, 5.48], [160.25, 9, 18, 3.9, 4.3, 5.64],
  [160.30, 8.5, 18, 2.1, 1.6, 4.8], [160.40, 8.5, 18.5, 0.4, 0.4, 3.57],
];
const VIII_COL = [1.0 / 0.911, 0.9 / 0.911, 0.76 / 0.911];            // (1, .9, .76) at unit luminance
const RR_COLN = [1.0 / 0.876, 0.86 / 0.876, 0.66 / 0.876];
function rrBokeh(t, x, y, sc, zoom, charge) {
  const E_BK = 4 * 22 * 24 * 3.4;                                   // VIII's bokeh energy at 159.2–159.6
  let hx, hy, sx, sy, E;
  if (t < 159.2) {                                                  // the city light gathers into the point
    const u = sstep(158.6, 159.2, t);
    const e0 = 4 * 2.2 * 2.2 * (2.6 + 1.2 + 1.6 * charge) * 1.3;
    hx = hy = 2.2 + 3.8 * u; sx = sy = 2.6 - 1.0 * u;
    E = Math.exp(Math.log(e0) + (Math.log(E_BK) - Math.log(e0)) * u * u);
  } else if (t < BK[0][0]) {                                        // defocus: 0.012 H point → VIII's bokeh
    const u = sm5(159.2, BK[0][0], t), k = BK[0];
    hx = 6 + (k[1] - 6) * u; hy = 6 + (k[2] - 6) * u; sx = 1.6 + (k[3] - 1.6) * u; sy = 1.6 + (k[4] - 1.6) * u;
    E = E_BK + (4 * k[1] * k[2] * k[5] - E_BK) * u;
  } else {                                                          // follow VIII's rack into focus
    let i = 0; while (i < BK.length - 2 && t >= BK[i + 1][0]) i++;
    const a = BK[i], b = BK[i + 1], u = sat((t - a[0]) / (b[0] - a[0]));
    const L = (j) => a[j] + (b[j] - a[j]) * u;
    hx = L(1); hy = L(2); sx = L(3); sy = L(4);
    E = 4 * hx * hy * L(5) * (1 - sstep(160.3, 160.45, t));        // VIII carries it from here
  }
  const P = E / (4 * hx * hy);
  const m = sstep(159.2, 159.7, t), col = mix3(RR_COLN, VIII_COL, m);
  return { cx: x, cy: y - 0.5 * sc * m, hx: hx * sc, hy: hy * sc, sx: sx * sc, sy: sy * sc, col: [col[0] * P, col[1] * P, col[2] * P] };
}

function ringOnSphere(ctx, R, B, ang, b, sc, toPx) {
  // orthonormal basis around B
  const up = Math.abs(B[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  let e1 = [up[1] * B[2] - up[2] * B[1], up[2] * B[0] - up[0] * B[2], up[0] * B[1] - up[1] * B[0]];
  const l1 = Math.hypot(...e1); e1 = e1.map(x => x / l1);
  const e2 = [B[1] * e1[2] - B[2] * e1[1], B[2] * e1[0] - B[0] * e1[2], B[0] * e1[1] - B[1] * e1[0]];
  const c = Math.cos(ang), s = Math.sin(ang), o = [0, 0, 0], p = [0, 0];
  let px = 0, py = 0, pv = false;
  for (let k = 0; k <= 40; k++) {
    const a = k / 40 * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
    const w = [B[0] * c + (e1[0] * ca + e2[0] * sa) * s, B[1] * c + (e1[1] * ca + e2[1] * sa) * s, B[2] * c + (e1[2] * ca + e2[2] * sa) * s];
    toView(R, w[0], w[1], w[2], o);
    toPx(o[0], o[1], p);
    const vis = o[2] > 0 ? b : 0;
    if (pv && vis > 0) S.seg.seg(px, py, p[0], p[1], 0.55 * sc, 0.55 * sc, 0.75 * vis, 0.92 * vis, 1.0 * vis, 0.75 * vis, 0.92 * vis, 1.0 * vis);
    px = p[0]; py = p[1]; pv = true;
  }
}

/** Emit a stroke between arc lengths s0..s1 (fully drawn, flat colour) under affine M. */
function emitRange(st, M, s0, s1, AX, AY, sc, r, g, b) {
  const { VX, VY, VS, seg } = S;
  if (s1 - s0 < 0.5) return;
  const w = st.w * sc;
  let [lx, ly] = sampleLocal(st, s0);
  let px = AX + (M[0] * lx + M[2] * ly + M[4]) * sc, py = AY - (M[1] * lx + M[3] * ly + M[5]) * sc;
  for (let j = 0; j < st.n; j++) {
    const v = st.v0 + j;
    if (VS[v] <= s0) continue;
    let x = VX[v], y = VY[v];
    if (VS[v] > s1) { [x, y] = sampleLocal(st, s1); }
    const X = AX + (M[0] * x + M[2] * y + M[4]) * sc, Y = AY - (M[1] * x + M[3] * y + M[5]) * sc;
    seg.seg(px, py, X, Y, w, w, r, g, b, r, g, b);
    px = X; py = Y;
    if (VS[v] > s1) break;
  }
}

function sampleLocal(st, s) {
  const { VX, VY, VS } = S;
  const v0 = st.v0, n = st.n;
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (VS[v0 + m] <= s) lo = m; else hi = m; }
  const a = v0 + lo, b = v0 + hi, u = (s - VS[a]) / Math.max(1e-6, VS[b] - VS[a]);
  const cu = u < 0 ? 0 : u > 1 ? 1 : u;
  return [VX[a] + (VX[b] - VX[a]) * cu, VY[a] + (VY[b] - VY[a]) * cu];
}
const mix3 = (a, b, m) => [a[0] + (b[0] - a[0]) * m, a[1] + (b[1] - a[1]) * m, a[2] + (b[2] - a[2]) * m];
const colKey = (st) => st.bb / Math.max(1e-6, st.r) > 0.4 ? 'hot' : st.gg / Math.max(1e-6, st.r) > 0.6 ? 'gold' : 'amber';
