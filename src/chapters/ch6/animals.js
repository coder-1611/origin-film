// VI · LIFE: the seven animals of the shore as POSES — pure functions of film time t. Every time,
// place and speed comes from src/march/beats.js (the same modules and seeds the audio plan uses), so
// feet plant on the plan's step times and gestures land on its gulps, breaths, strokes and calls.
// Builders: lab/creatures.js (2D silhouettes of capsules). Each record is drawn by walk-render.js on
// its own depth plane, mirrored to its heading (dir = −1: facing screen-left).
// Idle micro-motion (research §2.4): breathing on the back line, head saccade-and-hold, ear and tail
// events — seeded, never a single sine.
import { poseCreature, builderDefs } from './lab/creatures.js';
import { smoothNoise, fbmNoise, clamp, sstep, lerp } from '../../audio/nature/dsp.js';

const DEG = Math.PI / 180;
const add = (a, b, s = 1) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const rotY = (c, p, a) => { const x = p[0] - c[0], z = p[2] - c[2]; return [c[0] + x * Math.cos(a) + z * Math.sin(a), p[1], c[2] - x * Math.sin(a) + z * Math.cos(a)]; };
const rotZ = (c, p, a) => { const x = p[0] - c[0], y = p[1] - c[1]; return [c[0] + x * Math.cos(a) - y * Math.sin(a), c[1] + x * Math.sin(a) + y * Math.cos(a), p[2]]; };
const rotX = (c, p, a) => { const y = p[1] - c[1], z = p[2] - c[2]; return [p[0], c[1] + y * Math.cos(a) - z * Math.sin(a), c[2] + y * Math.sin(a) + z * Math.cos(a)]; };
const nrm3 = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/** Wrap a head builder so the whole head can pitch (z), yaw (y) and tilt (x) about the neck top. */
function orientHead(headFn, S) {
  return (r, ctx) => {
    const n0 = r.p.length;
    headFn(r, ctx, S);
    const c = ctx.neckTop;
    for (let i = n0; i < r.p.length; i++) {
      const q = r.p[i];
      for (const k of ['a', 'b']) q[k] = rotY(c, rotX(c, rotZ(c, q[k], S.pitch || 0), S.roll || 0), S.yaw || 0);
    }
  };
}
const rec = (A, t, pose, look, extra = {}) => ({ name: A.name, pose, k: A.k, world: [A.X(t), 0, A.z], look, dir: A.dir, ...extra });

// ------------------------------------------------------------------------------ tetrapod
function tetrapod(A) {
  const B = A.beh, idle = smoothNoise(A.seed % 997 + 3);
  return (t) => {
    const push = B.push(t), gape = B.gape(t), rest = B.rest(t);
    const state = {
      X: A.dir * (A.X(t) - A.x0),
      fin: (id) => { const f = A.fin(t, id); return { ...f, x: A.dir * (f.x - A.x0) }; },
      push, chest: B.chest(t), gape, throat: B.throat(t),
      headPitch: 2 + 10 * B.headUp(t) + 6 * push + 14 * gape - 7 * rest + 0.8 * idle(t * 0.7),
      tail: -0.8 * push + 0.25 * idle(t * 0.35 + 5),
    };
    // hidden below the wash where it is still in the water (the sea is behind it, on its right)
    return rec(A, t, poseCreature('tiktaalik', t, { state }), [1, 0.35, 1, 1], { clip: [A.waterX(t), 0.14 * A.dir, 0.26] });
  };
}

// ------------------------------------------------------------------------------ amphibian
function amphibian(A) {
  const B = A.beh, D = builderDefs('salamander'), breath = smoothNoise(A.seed % 991 + 1);
  return (t) => {
    const lift = B.lift(t), yaw = B.yaw(t);
    const S = { pitch: (10 * lift + 1.5 * breath(t * 0.4)) * DEG, yaw: B.scanYaw * yaw * DEG };
    // a temnospondyl on land holds its belly clear of the sand on sturdier limbs than a newt's
    const ov = {
      clock: A.clock, offs: A.offs, duty: A.duty, call: 0.9 * B.throat(t),
      hp: 0.0148 * (1 + 0.04 * lift), shH: 0.0152 * (1 + 0.25 * lift) + 0.0004 * breath(t * 0.5),
      hind: { ...D.hind, l1: 0.0148, l2: 0.0138, r: D.hind.r.map(r => r * 1.2) },
      fore: { ...D.fore, l1: 0.0122, l2: 0.012, r: D.fore.r.map(r => r * 1.2) },
      head: orientHead(D.head, S),
    };
    return rec(A, t, poseCreature('salamander', t, ov), [A.k, 0.35, 1, 1]);
  };
}

// ------------------------------------------------------------------------------ lizard
function lizard(A) {
  const B = A.beh, D = builderDefs('lizard');
  return (t) => {
    const v = A.W.speed(t), dart = clamp(v / 1.1);
    const rs = B.raise(t), al = B.alarm(t), hs = B.hiss(t), tf = B.tongue(t);
    const ov = {
      clock: A.clock, offs: A.offs, duty: A.duty, bob: 0, call: hs, noCuts: 1,
      undulate: 0.016 * dart, travel: 0.6,
      hp: 0.036 + 0.006 * dart + 0.004 * rs - 0.005 * al + 0.004 * hs, shH: 0.038 + 0.006 * dart + 0.012 * rs - 0.006 * al + 0.008 * hs,
      trunkR: D.trunkR.map(r => r * (1 + 0.08 * hs)),
      neck: { len: 0.022, deg: 12 + 22 * rs - 10 * al + 10 * hs, r0: 0.0125, r1: 0.011 * (1 + 0.15 * hs) },
      tail: { len: 0.3, r0: 0.0115, r1: 0.0008, deg: -9, droop: -0.12, curl: 0.004 + 0.01 * al, wave: 0.03 * dart, lag: 0.3 },
    };
    const pose = poseCreature('lizard', t, ov);
    const hd = pose.prims.filter(p => p.slot && p.slot.startsWith('head:'));
    if (hs > 0.01) {   // the throat inflates under the open jaw (a defensive hiss)
      const n = hd[0].a;
      pose.prims.push({ a: add(n, [-0.004, -0.009, 0]), b: add(n, [0.012, -0.012, 0]), ra: 0.007 * hs, rb: 0.006 * hs, k: 0.004, kind: 0, thick: 0.012, far: 0, slot: 'x:throat' });
    }
    if (tf > 0.01) {   // one forked tongue-flick, backlit
      let tip = hd[0].b; for (const p of hd) if (p.b[0] > tip[0]) tip = p.b;
      const L = 0.035 * tf, a = [tip[0] - 0.002, tip[1] - 0.002, 0], m = [a[0] + L * 0.7, a[1] - 0.003, 0];
      pose.prims.push({ a, b: m, ra: 0.0009, rb: 0.0007, k: 0, kind: 6, thick: 0.0006, far: 0, slot: 'x:tongue' });
      for (const s of [1, -1]) pose.prims.push({ a: m, b: [m[0] + L * 0.3, m[1] + s * 0.004 * tf, 0], ra: 0.0006, rb: 0.0002, k: 0, kind: 6, thick: 0.0004, far: 0, slot: 'x:fork' + s });
    }
    return rec(A, t, pose, [A.k, 0.6, 0.35, 1]);
  };
}

// ------------------------------------------------------------------------------ theropod
function theropod(A) {
  const B = A.beh, bout = B.bout, B0 = B.B0;
  const breath = smoothNoise(A.seed + 5), tremor = fbmNoise(A.seed + 9, 3), jit = smoothNoise(A.seed + 21);
  return (t) => {
    const ph = A.W.phase(t), v = A.W.speed(t), walking = clamp(v / A.walkV);
    // inverted-pendulum bob: highest at each mid-stance; pitch see-saw once per step (±1.2°)
    const bob = 0.015 * walking * Math.cos(2 * Math.PI * 2 * (ph - 0.3));
    const pitch = (2.0 * walking * Math.sin(2 * Math.PI * 2 * (ph - 0.05)) + 1.5 * B.settle(t)) * DEG;
    const inflate = B.inflate(t), hd = B.headDown(t), bm = B.boom(t), gp = B.gulp(t), sv = B.sav(t);
    const vib = Math.max(sv, 0.4 * bm) * (0.6 + 0.4 * tremor(t * 30));
    const chest = 1 + 0.07 * inflate * (1 - 0.5 * hd) + 0.012 * breath(t * 0.25);
    const hp = 1.0 + bob + 0.025 * inflate * (1 - hd) - 0.04 * hd + 0.0025 * vib * jit(t * 57);
    const shX = 0.62;
    const shH = hp - 0.03 + Math.tan(pitch) * shX - 0.06 * hd;
    // head held level in the world while walking (head stabilisation): solve the neck angle
    const nk = { len: 0.56, r0: 0.125 * (1 + 0.25 * hd), r1: 0.068 * (1 + 0.6 * hd + 0.2 * gp), s: 0.055 * (1 - hd) };
    const neckBaseY = shH + 0.26 * chest * 0.25;
    const yHead = 1.0 - 0.03 + Math.sin(60 * DEG) * nk.len + 0.25 * 0.26;
    const stab = Math.asin(clamp((yHead - neckBaseY) / nk.len, -1, 1)) / DEG;
    nk.deg = lerp(lerp(60, stab, walking), -32, hd) + 6 * inflate * (1 - hd) + B.headSacc(t) * (1 - hd) - 4 * gp;
    const tailDeg = 9 + 5 * hd - 3 * walking * Math.sin(2 * Math.PI * 2 * (ph - 0.05));
    const ov = {
      clock: A.clock, offs: A.offs, duty: A.duty, bob: 0, pitchOsc: 0, headNod: 0, hp, shH,
      call: 0.07 * B.onset(t),                                   // the mouth parts for the onset pulse only
      trunkR: [0.18, 0.235 * chest, 0.26 * chest, 0.17 * chest],
      neck: nk, tail: { len: 1.66, r0: 0.19, r1: 0.006, deg: tailDeg, droop: 0.36 - 0.08 * hd, curl: 0.13, wave: 0.06 * walking, lag: 0.3, n: 8, pow: 1.45 },
    };
    const pose = poseCreature('theropod', t, ov);
    // the inflated throat sac (closed-mouth display): a smooth swelling under the lowered neck, ~2× its width
    if (hd > 0.01 || gp > 0.01) {
      const sp = pose.prims.filter(p => p.slot && p.slot.startsWith('spine:'));
      const nTop = sp[sp.length - 1], nMid = sp[sp.length - 3];
      const sw = Math.max(hd * (0.55 + 0.45 * Math.max(sv, bm, sstep(B.sacAt - 0.2, B.sacAt, t))), 0.35 * gp) * (1 + 0.04 * vib);
      const c0 = add(nMid.b, [0.02, -0.06 * sw, 0]), c1 = add(nTop.b, [-0.02, -0.07 * sw, 0]);
      pose.prims.push({ a: c0, b: c1, ra: 0.1 * sw, rb: 0.085 * sw, k: 0.06, kind: 0, thick: 0.2, far: 0, slot: 'x:sac' });
    }
    const r = rec(A, t, pose, [A.k, 0.6, 0, 0.6]);
    // the water dance: world feet (walk-local x, z) and the SAV drive
    let savF = bout.booms[0].sav[2];
    for (const b of bout.booms) if (t >= B0 + b.sav[0] - 0.5) savF = b.sav[2];
    r.dance = { amp: sv, f0: savF, feet: pose.feet.map(f => [A.x0 + A.dir * f.x * A.k, A.z + f.z * A.k]) };
    return r;
  };
}

// ------------------------------------------------------------------------------ fox
function foxHead(r, { neckTop }, S) {
  const d = nrm3([1, -0.35, 0]);
  const cr = add(neckTop, [0.02, 0.012, 0]);
  const tip = add(cr, d, 0.14);
  r.cone(add(cr, [-0.02, 0.005, 0]), add(cr, [0.03, -0.002, 0]), 0.05, 0.046, { k: 0.02, kind: 2 });
  r.cone(add(cr, [0.02, -0.005, 0]), tip, 0.04, 0.011, { k: 0.02, kind: 2 });
  r.cone(add(cr, [0.02, -0.03, 0]), add(tip, [-0.03, -0.012, 0]), 0.022, 0.008, { k: 0.01 });
  r.cone(tip, add(tip, [0.004, -0.002, 0]), 0.011, 0.01, { k: 0.004 });
  // ears rotate independently about their base (swivel toward sounds): seeded events, not a cycle
  for (const [dz, far, a] of [[0.03, 0, S.earL], [-0.03, 1, S.earR]]) {
    const b = add(cr, [-0.022 + (far ? 0.012 : 0), 0.04, dz]);
    const tp = add(b, [0.012 * Math.cos(a) - 0.04 * Math.sin(a), 0.085 * (1 - 0.12 * Math.abs(a)), 0.05 * Math.sin(a) * (dz > 0 ? 1 : -1)]);
    r.cone(b, tp, 0.022, 0.003, { kind: 6, thick: 0.0045, k: 0.01, far });
  }
  for (let i = 0; i < 4; i++) { const w0 = add(tip, [-0.03, -0.01 + i * 0.004, 0.02]); r.cone(w0, add(w0, [0.1 * Math.cos(-0.25 + i * 0.15), 0.1 * Math.sin(-0.25 + i * 0.15), 0]), 0.0009, 0.0003, { kind: 6, thick: 0.0005 }); }
}
function fox(A) {
  const B = A.beh, quiver = smoothNoise(A.seed + 9), breath = smoothNoise(A.seed + 13);
  const trotV = 1.6, tailP = (t) => { let v = 0; for (const e of B.tailFlick) { if (e > t) break; const d = t - e; v = Math.max(v, d < 0.08 ? d / 0.08 : Math.exp(-(d - 0.08) / 0.25)); } return v; };
  return (t) => {
    const ph = A.W.phase(t), v = A.W.speed(t), trot = clamp(v / trotV);
    // trot: a bouncing gait, lowest at mid-stance of each diagonal pair
    const bob = -0.008 * trot * Math.cos(2 * Math.PI * 2 * (ph - 0.225));
    const sn = B.sniff(t), lb = B.look(t), br = 0.003 * breath(t * 0.9) * (1 - trot);
    const S = {
      pitch: (-4 * trot + 6 * (1 - trot) - 38 * sn) * DEG + 0.02 * sn * quiver(t * 30),
      yaw: 2.4 * lb, roll: B.tilt(t), earL: B.earL(t), earR: B.earR(t),
    };
    const ov = {
      clock: A.clock, offs: A.offs, duty: A.duty, bob: 0, headNod: 0, call: 0,
      hp: 0.35 + bob - 0.01 * sn, shH: 0.36 + bob * 0.7 - 0.05 * sn + br,
      neck: { len: 0.15, deg: 38 - 30 * sn, r0: 0.06, r1: 0.045 },
      tail: { len: 0.42, r0: 0.03, r1: 0.022, deg: -20 + 8 * tailP(t), droop: 0.35, curl: 0.03, wave: 0.02 * trot, lag: 0.35, vwave: 0.4 },
      head: orientHead(foxHead, S),
    };
    return rec(A, t, poseCreature('mammal', t, ov), [1.9, 1, 0, 0]);
  };
}

// ------------------------------------------------------------------------------ ape
function ape(A) {
  const B = A.beh, D = builderDefs('ape'), breath = smoothNoise(A.seed % 983 + 7), sway = smoothNoise(A.seed % 983 + 11);
  return (t) => {
    const s = B.sit(t), sc = B.scratch(t), scing = B.scratching(t), pump = B.pump(t), pilo = B.pilo(t), thr = B.throw(t);
    const gaze = B.gaze(t), fun = B.funnel(t), scr = B.scream(t);
    const grow = 1 + 0.1 * pilo, chest = 1 + 0.045 * pump + 0.01 * breath(t * 0.33);
    // sitting on its haunches: the rump drops back onto the ground, the trunk leans forward (~60°),
    // the head juts ahead of the shoulders; the hind feet stay where they were planted
    const hp = lerp(0.5, 0.2, s), pelX = -0.12 * s;
    const shX = lerp(0.36, 0.13, s), shH = lerp(0.74, 0.62, s) + 0.012 * pump + 0.004 * breath(t * 0.33);
    const S = { pitch: (16 * gaze * s + 26 * thr + 2 * sway(t * 0.6)) * DEG };
    // hands: the far arm props straight down to the knuckles in front; the near hand hangs over its
    // knee, then scratches along the far forearm (each stroke up and back); both leave the ground as
    // the ape sits back
    const limbTarget = (id, foot) => {
      if (s <= 0.001 || !id.endsWith('F')) return null;
      const w = sstep(0.25, 1, s);
      let tgt;
      if (id === 'RF') tgt = [0.31, 0.0, -0.12];
      else {
        const u = sc, restP = [0.21, 0.27, 0.12], scrP = [0.27 - 0.05 * u, 0.2 + 0.07 * u, 0.1];
        tgt = [lerp(restP[0], scrP[0], scing), lerp(restP[1], scrP[1], scing), lerp(restP[2], scrP[2], scing)];
      }
      return [lerp(foot[0], tgt[0], w), lerp(foot[1], tgt[1], w), lerp(foot[2], tgt[2], w)];
    };
    const ov = {
      clock: A.clock, offs: A.offs, duty: A.duty, shX0: D.shX, pelX, hp, shX, shH,
      bob: D.bob * (1 - s), pitchOsc: D.pitchOsc * (1 - s), headNod: D.headNod * (1 - s),
      trunkR: D.trunkR.map(r => r * grow * chest), furScale: 0.4 + 0.35 * pilo,
      neck: { len: 0.08, deg: lerp(25, 34, s), r0: 0.085 * grow, r1: 0.07 * grow },
      call: Math.max(0.55 * fun, scr), limbTarget, head: orientHead(D.head, S),
    };
    return rec(A, t, poseCreature('ape', t, ov), [1, 1, 0, 0]);
  };
}

// ------------------------------------------------------------------------------ human
function human(A) {
  const B = A.beh, D = builderDefs('human'), sway = smoothNoise(A.seed % 977 + 3), sway2 = smoothNoise(A.seed % 977 + 8), breath = smoothNoise(A.seed % 977 + 5);
  return (t) => {
    const Xw = A.X(t), dip = B.dip(t), st = B.settle(t), gz = B.gaze(t);
    // postural sway 0.1–0.5 Hz (two incommensurate noises), breathing on the shoulders
    const sw = st * (0.006 * sway(t * 0.23) + 0.004 * sway2(t * 0.41));
    const S = { pitch: (17 * gz - 3 * dip) * DEG };
    const ov = {
      clock: A.clock, offs: A.offs, duty: A.duty, pelX: -0.012 * st + sw, shX: D.shX - 0.01 * st + sw * 1.4,
      hp: D.hp - 0.032 * dip, shH: D.shH - 0.034 * dip + 0.003 * breath(t * 0.3),
      raise: B.raise(t), armRelax: B.relax(t),
      torchTarget: [A.dir * (B.flame[0] - Xw) / A.k, B.flame[1] / A.k],
      head: orientHead(D.head, S),
    };
    const pose = poseCreature('human', t, ov);
    const r = rec(A, t, pose, [1, 1, 0, 0]);
    r.flame = [Xw + A.dir * pose.flame[0] * A.k, pose.flame[1] * A.k];
    return r;
  };
}

const MAKERS = { tetrapod, amphibian, lizard, theropod, fox, ape, human };
/** makeAnimals(cast) → { name: (t) → record } */
export function makeAnimals(cast) {
  const out = {};
  for (const [n, f] of Object.entries(MAKERS)) out[n] = f(cast[n]);
  return out;
}
