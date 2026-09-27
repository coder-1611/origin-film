// VI · LIFE: a parametric, stochastic, bracketed L-system and a 3D turtle (after Prusinkiewicz
// & Lindenmayer, "The Algorithmic Beauty of Plants"). The derivation produces a module string;
// the turtle turns it into branch segments (with parent links, arc length from the root and a
// pipe-model radius) and leaf clusters at the apices and along the twigs.

const D = Math.PI / 180;
const m = (s, ...p) => ({ s, p });

/** Species: axiom + productions. Productions get (params, rng) and return modules. */
export const SPECIES = {
  // Sympodial ternary tree with gravitropism (ABoP fig. 2.8): the broadleaf.
  broadleaf: {
    iterations: 6, tropism: [0, -1, 0], e: 0.20, leafOrder: 2, twig: [2, 0.5], clusterLeaves: 9, leafSize: 0.20, leafAspect: 0.55,
    axiom: [m('!', 1), m('F', 200), m('/', 45), m('A')],
    rules: {
      A: (p, R) => {
        const a = (17 + 6 * R()) * D, d1 = (94.74 + 12 * (R() - 0.5)) * D, d2 = (132.63 + 12 * (R() - 0.5)) * D;
        const out = [m('!', 1.732), m('F', 50 * (0.85 + 0.3 * R())), m('['), m('&', a), m('F', 50), m('A'), m(']'), m('/', d1),
          m('['), m('&', a), m('F', 50), m('A'), m(']'), m('/', d2)];
        if (R() < 0.85) out.push(m('['), m('&', a), m('F', 50), m('A'), m(']'));
        return out;
      },
      F: (p, R) => [m('F', p[0] * (1.109 + 0.04 * (R() - 0.5)))],
      '!': (p) => [m('!', p[0] * 1.732)],
    },
  },
  // Monopodial tree (Honda's model, ABoP fig. 2.6) with near-horizontal fronded branches: an
  // Archaeopteris-like "first tree".
  archaeopteris: {
    iterations: 9, tropism: [0, -1, 0], e: 0.10, leafOrder: 1, twig: [1, 0.9], clusterLeaves: 8, leafSize: 0.26, leafAspect: 0.3,
    axiom: [m('A', 1, 10)],
    rules: {
      A: ([l, w], R) => [m('!', w), m('F', l), m('['), m('&', (62 + 10 * R()) * D), m('B', l * 0.62, w * 0.707), m(']'), m('/', (137.5 + 8 * (R() - 0.5)) * D), m('A', l * 0.9, w * 0.707)],
      B: ([l, w], R) => [m('!', w), m('F', l), m('['), m('-', (40 + 8 * R()) * D), m('$'), m('C', l * 0.6, w * 0.707), m(']'), m('C', l * 0.9, w * 0.707)],
      C: ([l, w], R) => [m('!', w), m('F', l), m('['), m('+', (40 + 8 * R()) * D), m('$'), m('B', l * 0.6, w * 0.707), m(']'), m('B', l * 0.9, w * 0.707)],
    },
  },
  // Small bushy plant for the shore edge.
  shrub: {
    iterations: 4, tropism: [0, 1, 0], e: 0.05, leafOrder: 1, twig: [2, 0.5], clusterLeaves: 8, leafSize: 0.16, leafAspect: 0.5,
    axiom: [m('!', 1), m('F', 40), m('A')],
    rules: {
      A: (p, R) => {
        const a = (30 + 14 * R()) * D;
        return [m('!', 1.6), m('F', 30 * (0.8 + 0.4 * R())), m('['), m('&', a), m('F', 30), m('A'), m(']'), m('/', 120 * D),
          m('['), m('&', a), m('F', 30), m('A'), m(']'), m('/', 120 * D), m('['), m('&', a * 0.8), m('F', 26), m('A'), m(']')];
      },
      F: (p, R) => [m('F', p[0] * (1.06 + 0.06 * R()))],
      '!': (p) => [m('!', p[0] * 1.6)],
    },
  },
};

export function derive(sp, R) {
  let str = sp.axiom.slice();
  for (let i = 0; i < sp.iterations; i++) {
    const next = [];
    for (const mod of str) {
      const rule = sp.rules[mod.s];
      if (rule) next.push(...rule(mod.p, R)); else next.push(mod);
    }
    str = next;
  }
  return str;
}

// ---- small vector helpers ----
const v = (x, y, z) => [x, y, z];
const addv = (a, b, s = 1) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
function rot(vec, axis, ang) {       // Rodrigues
  const c = Math.cos(ang), s = Math.sin(ang), k = axis;
  const kv = cross(k, vec), kd = dot(k, vec);
  return [vec[0] * c + kv[0] * s + k[0] * kd * (1 - c), vec[1] * c + kv[1] * s + k[1] * kd * (1 - c), vec[2] * c + kv[2] * s + k[2] * kd * (1 - c)];
}

/**
 * Interpret a module string. Returns { segs, clusters, height } in local units (y up), scaled so
 * the plant's height is `height` metres.
 */
export function interpret(sp, str, R, height) {
  const segs = [], clusters = [];
  let st = { p: v(0, 0, 0), H: v(0, 1, 0), Lf: v(-1, 0, 0), U: v(0, 0, 1), w: 1, order: 0, s: 0, seg: -1 };
  const stack = [];
  const T = sp.tropism;
  for (const mod of str) {
    switch (mod.s) {
      case 'F': {
        const len = mod.p[0];
        // tropism: bend the heading toward T by e·|H×T| (ABoP eq. 2.3)
        const hxT = cross(st.H, T), mag = Math.hypot(...hxT);
        if (mag > 1e-5) {
          const ax = [hxT[0] / mag, hxT[1] / mag, hxT[2] / mag], a = sp.e * mag;
          st.H = norm(rot(st.H, ax, a)); st.Lf = norm(rot(st.Lf, ax, a)); st.U = norm(rot(st.U, ax, a));
        }
        const b = addv(st.p, st.H, len);
        segs.push({ a: st.p, b, order: st.order, s0: st.s, len, parent: st.seg, w: st.w });
        st.seg = segs.length - 1;
        st.p = b; st.s += len;
        if (st.order >= sp.twig[0] && R() < sp.twig[1]) clusters.push({ p: b, H: st.H, s: st.s, order: st.order, seg: st.seg });
        break;
      }
      case '+': st.H = rot(st.H, st.U, mod.p[0]); st.Lf = rot(st.Lf, st.U, mod.p[0]); break;
      case '-': st.H = rot(st.H, st.U, -mod.p[0]); st.Lf = rot(st.Lf, st.U, -mod.p[0]); break;
      case '&': st.H = rot(st.H, st.Lf, mod.p[0]); st.U = rot(st.U, st.Lf, mod.p[0]); break;
      case '^': st.H = rot(st.H, st.Lf, -mod.p[0]); st.U = rot(st.U, st.Lf, -mod.p[0]); break;
      case '/': st.Lf = rot(st.Lf, st.H, mod.p[0]); st.U = rot(st.U, st.H, mod.p[0]); break;
      case '\\': st.Lf = rot(st.Lf, st.H, -mod.p[0]); st.U = rot(st.U, st.H, -mod.p[0]); break;
      case '$': { const Lf = norm(cross([0, 1, 0], st.H)); if (Math.hypot(...Lf) > 0.1) { st.Lf = Lf; st.U = cross(st.H, Lf); } break; }
      case '!': st.w = mod.p[0]; break;
      case '[': stack.push({ ...st }); st = { ...st, order: st.order + 1 }; break;
      case ']': st = stack.pop(); break;
      default:
        // an apex: a bud that becomes a leaf cluster
        if (st.order >= sp.leafOrder) clusters.push({ p: st.p, H: st.H, s: st.s, order: st.order, seg: st.seg, apex: true });
    }
  }
  // pipe model: radius ∝ (tips in subtree)^0.45; subtree max arc length for thickening
  const tips = new Float32Array(segs.length), sMax = new Float32Array(segs.length);
  const hasChild = new Uint8Array(segs.length);
  for (const s of segs) if (s.parent >= 0) hasChild[s.parent] = 1;
  for (let i = segs.length - 1; i >= 0; i--) {
    const s = segs[i];
    if (!hasChild[i]) tips[i] += 1;
    sMax[i] = Math.max(sMax[i], s.s0 + s.len);
    if (s.parent >= 0) { tips[s.parent] += tips[i]; sMax[s.parent] = Math.max(sMax[s.parent], sMax[i]); }
  }
  let maxY = 0, sTot = 0;
  for (const s of segs) { maxY = Math.max(maxY, s.b[1]); sTot = Math.max(sTot, s.s0 + s.len); }
  const k = height / maxY;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    s.a = s.a.map(x => x * k); s.b = s.b.map(x => x * k); s.s0 *= k; s.len *= k; s.sMax = sMax[i] * k;
    s.tips = tips[i];
  }
  for (const c of clusters) { c.p = c.p.map(x => x * k); c.s *= k; }
  return { segs, clusters, sTot: sTot * k, height };
}
