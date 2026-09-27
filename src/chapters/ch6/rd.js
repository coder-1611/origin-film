// VI · LIFE: GPU Gray-Scott reaction-diffusion (mitosis regime) with deterministic replay.
//
// State texture (RGBA32F, N×N): r = U (substrate), g = V (catalyst = the cells),
// b = lineage hue (inherited from the V-weighted neighbourhood, so each colony keeps a tint),
// a = division glow (set by a cleavage event, decays per step).
//
// Replay contract: step s is always the same GPU pass with the same inputs, so the state after
// S steps is a pure function of S. S(t) = floor((t - t0) * rate), capped at maxStep. Seeking
// backwards resets to the initial state and re-simulates. Events (seeds / cleavages) are keyed
// to step indices, never to frame times.
import { THREE } from '../../engine/gl.js';

const MAXEV = 4;   // active-event slots per step (JS picks the events live at each step)

export function makeGrayScott(ctx, { N = 512, rate = 1800, t0 = 105, tEnd = 114.5, events = [], f = 0.0367, k = 0.0649, colony = [] }) {
  const { glsl, Pass, makeTarget } = ctx;
  const mk = () => makeTarget(N, N, { type: THREE.FloatType, linear: true });
  const tex = [mk(), mk()];
  const maxStep = Math.floor((tEnd - t0) * rate);

  // Event slots: evA = (seedStep, cleaveStep, u, v), evB = (angle, radiusPx, hue, cleaveLen)
  const evA = [], evB = [];
  for (let i = 0; i < MAXEV; i++) { evA.push(new THREE.Vector4(-1e9, -1e9, -9, -9)); evB.push(new THREE.Vector4(0, 0, 0, 1)); }
  const live = (e, s) => (s >= e.seedStep && s < e.seedStep + 4) || (s >= e.cleaveStep - e.cleaveLen * 0.9 && s < e.cleaveStep + e.cleaveLen);
  let lastSet = '';
  function setEvents(s) {
    const act = events.filter(e => live(e, s)).slice(0, MAXEV);
    const key = act.map(e => events.indexOf(e)).join(',');
    if (key === lastSet) return;
    lastSet = key;
    for (let i = 0; i < MAXEV; i++) {
      const e = act[i];
      if (e) { evA[i].set(e.seedStep, e.cleaveStep, e.u, e.v); evB[i].set(e.ang, e.rad, e.hue, e.cleaveLen); }
      else { evA[i].set(-1e9, -1e9, -9, -9); evB[i].set(0, 0, 0, 1); }
    }
  }

  // colony mask: where the mat may live. Outside it the kill rate rises and spots die, so the
  // colony edge is ragged and made of cells rather than a clipped square.
  const MAXC = 64;
  const cPts = [];
  for (let i = 0; i < MAXC; i++) { const c = colony[i]; cPts.push(c ? new THREE.Vector3(c.u, c.v, c.r) : new THREE.Vector3(-9, -9, 0)); }
  const must = events.filter(e => e.cleaveStep > 0).slice(0, 16).map(e => new THREE.Vector2(e.u, e.v));
  while (must.length < 16) must.push(new THREE.Vector2(-9, -9));
  const mask = makeTarget(256, 256, { type: THREE.HalfFloatType, linear: true });
  new Pass(glsl.header + glsl.hash + glsl.noise + /* glsl */`
    in vec2 vUv; out vec4 fragColor; uniform vec3 pts[${MAXC}]; uniform vec2 must[16];
    void main() {
      float m = 0.0;
      vec2 w = vec2(vnoise(vec3(vUv * 9.0, 1.3)), vnoise(vec3(vUv * 9.0, 7.7))) - 0.5;
      vec2 q = vUv + w * 0.06;
      for (int i = 0; i < ${MAXC}; i++) {
        vec3 p = pts[i];
        m = max(m, 1.0 - smoothstep(p.z * 0.55, p.z, length(q - p.xy)));
      }
      // irregular fade toward the domain border, then guaranteed life at every division site
      float bd = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y)) + (vnoise(vec3(vUv * 14.0, 3.1)) - 0.5) * 0.09;
      m *= smoothstep(0.06, 0.2, bd);
      for (int i = 0; i < 16; i++) m = max(m, (1.0 - smoothstep(0.045, 0.075, length(q - must[i]))));
      fragColor = vec4(m, 0.0, 0.0, 1.0);
    }`, { pts: { value: cPts }, must: { value: must } }).render(ctx.renderer, mask);

  const init = new Pass(glsl.header + /* glsl */`
    in vec2 vUv; out vec4 fragColor;
    void main() { fragColor = vec4(1.0, 0.0, 0.0, 0.0); }`);

  const step = new Pass(glsl.header + glsl.hash + /* glsl */`
    in vec2 vUv; out vec4 fragColor;
    uniform sampler2D src, cmask; uniform float N, stepI, F, K;
    uniform vec4 evA[${MAXEV}]; uniform vec4 evB[${MAXEV}];
    vec4 at(ivec2 p) {
      if (p.x < 0 || p.y < 0 || p.x >= int(N) || p.y >= int(N)) return vec4(1.0, 0.0, 0.0, 0.0);
      return texelFetch(src, p, 0);
    }
    void main() {
      ivec2 p = ivec2(gl_FragCoord.xy);
      vec4 c = at(p);
      vec4 n = at(p + ivec2(0, 1)), s = at(p - ivec2(0, 1)), e = at(p + ivec2(1, 0)), w = at(p - ivec2(1, 0));
      vec4 ne = at(p + ivec2(1, 1)), nw = at(p + ivec2(-1, 1)), se = at(p + ivec2(1, -1)), sw = at(p + ivec2(-1, -1));
      vec4 lap = 0.2 * (n + s + e + w) + 0.05 * (ne + nw + se + sw) - c;
      float U = c.r, V = c.g;
      float uvv = U * V * V;
      float U2 = U + (1.0 * lap.r - uvv + F * (1.0 - U));
      float Kl = mix(0.0765, K, texture(cmask, vUv).r);
      float V2 = V + (0.5 * lap.g + uvv - (Kl + F) * V);
      // lineage hue: inherit from the V-weighted neighbourhood
      float wsum = c.g * 2.0 + 0.5 * (n.g + s.g + e.g + w.g) + 0.25 * (ne.g + nw.g + se.g + sw.g);
      float hsum = c.g * 2.0 * c.b + 0.5 * (n.g * n.b + s.g * s.b + e.g * e.b + w.g * w.b) + 0.25 * (ne.g * ne.b + nw.g * nw.b + se.g * se.b + sw.g * sw.b);
      float hue = wsum > 1e-4 ? hsum / wsum : c.b;
      float glow = c.a * 0.9975 + 0.05 * lap.a;
      vec2 px = gl_FragCoord.xy;
      for (int i = 0; i < ${MAXEV}; i++) {
        vec4 A = evA[i], B = evB[i];
        if (A.z < -1.0) continue;
        vec2 cp = A.zw * N;
        float d = length(px - cp);
        // seed: a small disc of catalyst held for a few steps
        if (stepI >= A.x && stepI < A.x + 4.0 && d < B.y) {
          float r = hash12(px + vec2(float(i) * 7.1, 3.3));
          U2 = 0.5 + 0.02 * r; V2 = 0.25 + 0.02 * r; hue = B.z;
        }
        // division: the cell first stretches across the future furrow, then the furrow pinches
        // in from both sides of the membrane toward the centre (an hourglass), then separates
        float el0 = A.y - B.w * 0.9;
        if (stepI >= el0 && stepI < A.y + B.w) {
          vec2 dir = vec2(cos(B.x), sin(B.x));
          vec2 q = px - cp;
          float along = dot(q, dir), across = dot(q, vec2(-dir.y, dir.x));
          if (stepI < A.y) {
            float lobe = exp(-(pow(abs(across) - B.y * 0.75, 2.0) + along * along * 1.3) / (B.y * B.y * 0.22));
            V2 += 0.0035 * lobe;
          } else {
            float prog = (stepI - A.y) / B.w;
            float reach = B.y * 1.5 * (1.0 - prog * 0.95);                 // furrow tips move inward
            float fur = exp(-across * across / 2.2) * smoothstep(reach - 2.0, reach + 1.0, abs(along)) * step(abs(along), B.y * 2.2);
            V2 -= 0.09 * fur;
            U2 += 0.09 * fur;
            float lobe = exp(-(pow(abs(across) - B.y * 0.8, 2.0) + along * along) / (B.y * B.y * 0.3));
            V2 += 0.002 * lobe;
            glow = max(glow, exp(-d * d / (B.y * B.y * 3.0)) * sin(3.14159 * min(prog * 1.6, 1.0)));
          }
        }
      }
      fragColor = vec4(clamp(U2, 0.0, 1.0), clamp(V2, 0.0, 1.0), hue, clamp(glow, 0.0, 1.0));
    }`, {
    src: { value: null }, cmask: { value: mask.texture }, N: { value: N }, stepI: { value: 0 }, F: { value: f }, K: { value: k },
    evA: { value: evA }, evB: { value: evB },
  });

  // display field (per frame): r = V, g = dome height (Gaussian-blurred V), b = hue, a = glow
  const disp = makeTarget(N, N, { type: THREE.FloatType, linear: true });
  const prep = new Pass(glsl.header + /* glsl */`
    in vec2 vUv; out vec4 fragColor; uniform sampler2D src; uniform float N;
    void main() {
      ivec2 p = ivec2(gl_FragCoord.xy);
      vec4 c = texelFetch(src, p, 0);
      float acc = 0.0, ws = 0.0;
      for (int y = -4; y <= 4; y++) for (int x = -4; x <= 4; x++) {
        ivec2 q = clamp(p + ivec2(x, y), ivec2(0), ivec2(int(N) - 1));
        float w = exp(-float(x * x + y * y) / (2.0 * 2.6 * 2.6));
        acc += texelFetch(src, q, 0).g * w; ws += w;
      }
      fragColor = vec4(c.g, acc / ws, c.b, c.a);
    }`, { src: { value: null }, N: { value: N } });
  let dispStep = -2;

  const st = { cur: 0, step: -1 };
  function reset(r) { init.render(r, tex[0]); st.cur = 0; st.step = 0; dispStep = -2; }
  function stepTo(r, S) {
    if (st.step < 0 || S < st.step) reset(r);
    const u = step.uniforms;
    while (st.step < S) {
      u.src.value = tex[st.cur].texture;
      u.stepI.value = st.step;
      setEvents(st.step);
      r.setRenderTarget(tex[1 - st.cur]);
      r.render(step.scene, step._cam || (step._cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)));
      st.cur = 1 - st.cur; st.step++;
    }
  }
  return {
    N, rate, t0, maxStep, tex,
    stepAt(t) { return Math.max(0, Math.min(maxStep, Math.floor((t - t0) * rate + 1e-6))); },
    /** Advance/replay the simulation to time t; returns the state texture. */
    ensure(r, t) { stepTo(r, this.stepAt(t)); return tex[st.cur].texture; },
    /** Advance/replay to t and return the display field for the membrane shader. */
    display(r, t) {
      stepTo(r, this.stepAt(t));
      if (dispStep !== st.step) { prep.render(r, disp, { src: tex[st.cur].texture }); dispStep = st.step; }
      return disp.texture;
    },
    get state() { return st; },
  };
}
