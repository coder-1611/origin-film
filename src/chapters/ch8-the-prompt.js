// VIII · THE PROMPT (T.chapterById.VIII.start → T.DURATION)
// Time literals are written against a chapter start of 160 s and re-anchored by D = start − 160.
// A laptop in a dark room, lit only by its display. The prompt is typed key by key (the keycaps
// depress and flare on every character), Enter runs the render, and the display then shows the
// film's own live output: a real recursive Droste. Each recursion level renders this scene with its
// display showing the level below (level 0 = the film's true frame 0), runs the film's real post
// chain on it, and feeds the result upward. The camera pushes in until the 16:9 display fills the
// frame exactly, where every level converges on frame 0 and the film loops.
import { buildScene } from './ch8/scene.js';
import { ScreenUI } from './ch8/screen-ui.js';
import { DOF } from './ch8/dof.js';
import * as L from './ch8/layout.js';

let END_T = 179.98;            // T.DURATION − 0.02: from here the frame IS frame 0 (byte copy)
let D = 0;                     // chapter start − 160 (set in init)
let PHASE = null;
const KMAX = 16;               // recursion depth cap
const CLASSES = [1, 0.5, 0.25, 0.125];

let S, ui, uiTex, camera, dof, T, THREE;
let presses = null;            // per typed char: key index, shift key index (or -1)
let pools = {};
let f0 = null;                 // mip-mapped copy of the film's frame 0
let keyIdxEnter;

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smoother = (a, b, x) => { const u = clamp01((x - a) / (b - a)); return u * u * u * (u * (u * 6 - 15) + 10); };
const sstep = (a, b, x) => { const u = clamp01((x - a) / (b - a)); return u * u * (3 - 2 * u); };

// ------------------------------------------------------------------ time-driven look
function screenRadiance(t) {            // what the display pours into the room (LTC light radiance)
  const wake = smoother(PHASE.wake[0], PHASE.wake[1], t);
  let L0 = 0.05 + 1.05 * wake;
  L0 *= 1 + 0.35 * Math.exp(-Math.max(0, t - T.ENTER_T) / 0.35) * (t >= T.ENTER_T ? 1 : 0);
  return L0 * (1 - smoother(178.2 + D, 179.75 + D, t));
}
function roomLight(t) { return smoother(160.25 + D, 161.6 + D, t) * (1 - smoother(177.4 + D, 179.5 + D, t)); }
function backlight(t) { return smoother(PHASE.wake[0] + 0.2, PHASE.wake[1] + 0.3, t) * (1 - 0.35 * smoother(168.2 + D, 169.5 + D, t)) * (1 - smoother(177.2 + D, 179.3 + D, t)); }
function aperture(t) {                  // blur radius at infinity, fraction of frame height
  const a = T.pwl([[159.2, 0.058], [160.3, 0.058], [160.7, 0.030], [161.6, 0.017], [167.8, 0.015], [171.6, 0.013], [175.0, 0.011], [177.0, 0.007], [178.0, 0.0]].map(([k, v]) => [k + D, v]), t);
  return a;
}
function cursorGlow(t) {                // HDR boost on the caret: a point of light, then a warm accent
  // defocused (159.2–160.0) its energy spreads over a bokeh disc, so it burns brighter; as the
  // focus racks in it settles to a warm accent that just kisses the bloom
  return 1.0 + 7.0 * (1 - smoother(159.95 + D, 160.5 + D, t)) + 2.4 * (1 - smoother(160.4 + D, 161.3 + D, t));
}
/** Focus distance factor: the macro opens defocused on the caret (VII's point, as bokeh) and racks in. */
function focusRack(t) { return 0.6 + 0.4 * smoother(159.95 + D, 160.45 + D, t); }

// Local musical reactions: the leitmotif's piano notes (the rit bars and the final resolution) and
// the bar-1 kicks before Enter swell the key backlight and the display-edge glow.
let pianoNotes = [], kickTimes = [];
function swell(list, t, tau, look = 3) {
  let v = 0;
  for (const n of list) { const dt = t - n.t; if (dt >= 0 && dt < tau * look) v += (n.vel || 1) * Math.exp(-dt / tau); }
  return v;
}

// ------------------------------------------------------------------ keyboard
function buildPresses() {
  const ty = T.typing, n = ty.text.length;
  const key = new Int16Array(n), shift = new Int16Array(n).fill(-1);
  const shiftL = L.KEYS.findIndex(k => k.shift && k.align === 'left');
  const shiftR = L.KEYS.findIndex(k => k.shift && k.align === 'right');
  const shifted = '~!@#$%^&*()_+{}|:"<>?';
  for (let i = 0; i < n; i++) {
    const c = ty.text[i];
    key[i] = L.keyForTyped(ty.keyX[i], ty.keyRow[i]);
    if ((c >= 'A' && c <= 'Z') || shifted.includes(c)) shift[i] = ty.keyX[i] < 0 ? shiftR : shiftL;
  }
  keyIdxEnter = L.KEYS.findIndex(k => k.enter);
  return { key, shift };
}
function keyPresses(t, out) {
  out.fill(0);
  const ty = T.typing;
  const i1 = T.typedCount(t), i0 = T.typedCount(t - 0.32);
  const rate = (i1 - T.typedCount(t - 0.08)) / 0.08;
  const rel = Math.min(0.075, Math.max(0.0035, 1.1 / Math.max(rate, 1)));
  const atk = Math.min(0.012, rel * 0.4);
  for (let i = i0; i < i1; i++) {
    const dt = t - ty.times[i];
    const e = dt < atk ? dt / atk : Math.exp(-(dt - atk) / rel);
    const k = presses.key[i];
    if (e > out[k]) out[k] = e;
    const s = presses.shift[i];
    if (s >= 0) { const es = dt < atk ? dt / atk : Math.exp(-(dt - atk) / (rel * 1.8)); if (es > out[s]) out[s] = es; }
  }
  // Enter at T.ENTER_T: a full, deliberate press
  const de = t - T.ENTER_T + 0.015;
  if (de >= 0) out[keyIdxEnter] = Math.max(out[keyIdxEnter], de < 0.015 ? de / 0.015 : Math.exp(-(de - 0.015) / 0.14));
}

// ------------------------------------------------------------------ render resources
function pool(ctx, cls) {
  if (pools[cls]) return pools[cls];
  const w = Math.max(16, Math.round(ctx.W * cls)), h = Math.max(9, Math.round(ctx.H * cls));
  const msaa = new THREE.WebGLRenderTarget(w, h, {
    type: THREE.HalfFloatType, samples: 4, depthBuffer: true, stencilBuffer: false,
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false,
  });
  msaa.depthTexture = new THREE.DepthTexture(w, h);
  msaa.texture.colorSpace = THREE.NoColorSpace;
  const mask = new THREE.WebGLRenderTarget(w, h, { type: THREE.UnsignedByteType, samples: 4, depthBuffer: false, generateMipmaps: false });
  mask.texture.colorSpace = THREE.NoColorSpace;
  const ldr = [0, 1].map(() => {
    const rt = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.UnsignedByteType, depthBuffer: false, generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
    });
    rt.texture.colorSpace = THREE.NoColorSpace;
    rt.texture.anisotropy = 8;
    return rt;
  });
  pools[cls] = {
    w, h, msaa, mask, ldr, flip: 0,
    hdr: ctx.makeTarget(w, h),
    half: [ctx.makeTarget(Math.ceil(w / 2), Math.ceil(h / 2)), ctx.makeTarget(Math.ceil(w / 2), Math.ceil(h / 2))],
  };
  return pools[cls];
}

// ------------------------------------------------------------------ per-frame state
function prepare(ctx, t) {
  const k = T.sampleCamera(T.cameras.VIII, t);
  ctx.applyCamera(camera, k);
  const st = ui.update(t);
  if (st.changed) uiTex.needsUpdate = true;
  const du = S.displayUniforms;
  du.uUI.value = uiTex;
  du.uWake.value = st.wake;
  du.uGain.value = 1.0;
  du.uRefl.value = 0.004 * (st.video ? 0 : 1);
  if (st.cursor && st.cursor.on > 0.001) {
    const c = st.cursor;
    du.uCursorRect.value.set(c.x0 / L.CANVAS.w, 1 - c.y1 / L.CANVAS.h, c.x1 / L.CANVAS.w, 1 - c.y0 / L.CANVAS.h);
    const g = cursorGlow(t) * c.on;
    du.uCursor.value.set(1.0 * g, 0.9 * g, 0.76 * g);
  } else du.uCursor.value.set(0, 0, 0);
  if (st.video && st.video.alpha > 0) {
    const v = st.video;
    du.uVideoRect.value.set(v.x / L.CANVAS.w, 1 - (v.y + v.h) / L.CANVAS.h, (v.x + v.w) / L.CANVAS.w, 1 - v.y / L.CANVAS.h);
    du.uVideoOn.value = v.alpha;
  } else du.uVideoOn.value = 0;

  // lights
  const rad = screenRadiance(t);
  const cool = st.mode === 'terminal' ? [0.86, 0.9, 1.0] : st.mode === 'player' ? [0.8, 0.84, 1.0] : [0.82, 0.88, 1.0];
  S.screenLight.color.setRGB(cool[0], cool[1], cool[2]);
  S.screenLight.intensity = rad;
  S.glassUniforms.uBleed.value = rad * (0.035 + 0.05 * smoother(171.6 + D, 173.0 + D, t)) * (1 + 0.9 * swell(pianoNotes, t, 0.7)) * (1 - smoother(177.1 + D, 178.4 + D, t));
  const room = roomLight(t);
  S.room.moon.intensity = S.room.moonI * room;
  S.room.warm.intensity = S.room.warmI * room;
  S.room.fill.intensity = S.room.fillI * room;
  for (const [m, k] of S.envMats) m.envMapIntensity = k * room;
  S.winUniforms.uAmt.value = room;
  S.wallUniforms.uRoom.value = room;
  const note = swell(pianoNotes, t, 0.55);
  const back = backlight(t) * (1 + 0.55 * note + 0.35 * swell(kickTimes, t, 0.12));
  S.keyUniforms.uBack.value = back;
  S.well.material.emissiveIntensity = 0.05 * back;
  keyPresses(t, S.keyUniforms.uPress.value);

  // focus: the display plane (the caret during the macro)
  const fwd = new THREE.Vector3(); camera.getWorldDirection(fwd);
  const fp = new THREE.Vector3(...L.SCREEN_C);
  const focus = fp.sub(camera.position).dot(fwd) * focusRack(t);
  return { st, focus, coc: aperture(t) };
}

/** Render the scene (display showing `videoTex`) into pool p's HDR target. */
function renderLevel(ctx, p, prep, videoTex, hdrOut) {
  const r = ctx.renderer;
  S.displayUniforms.uVideo.value = videoTex;
  if (videoTex && videoTex.image) S.displayUniforms.uVideoSize.value.set(videoTex.image.width, videoTex.image.height);
  r.setRenderTarget(p.msaa);
  r.setClearColor(0x000000, 1);
  r.clear(true, true, false);
  r.render(S.scene, camera);
  dof.run(r, p.msaa, p.half, hdrOut, { camera, focus: prep.focus, cocH: prep.coc });
}

function renderMask(ctx, p, prep) {
  const r = ctx.renderer;
  const v = prep.st.video;
  // video rect (display uv, v down) → lid-local plane transform
  const cx = (v.x + v.w / 2) / L.CANVAS.w, cy = (v.y + v.h / 2) / L.CANVAS.h;
  const m = S.maskMesh;
  S.display.updateWorldMatrix(true, false);
  const local = new THREE.Matrix4().compose(
    new THREE.Vector3((cx - 0.5) * L.DISPLAY.w, (0.5 - cy) * L.DISPLAY.h, 0),
    new THREE.Quaternion(),
    new THREE.Vector3(v.w / L.CANVAS.w * L.DISPLAY.w, v.h / L.CANVAS.h * L.DISPLAY.h, 1));
  m.matrix.multiplyMatrices(S.display.matrixWorld, local);
  m.matrixWorld.copy(m.matrix);
  m.material.color.setRGB(v.alpha, v.alpha, v.alpha);
  r.setRenderTarget(p.mask);
  r.setClearColor(0x000000, 1);
  r.clear(true, false, false);
  r.render(S.maskScene, camera);
}

/** Screen-space size of the video rect: the recursion's per-level scale factor. */
function nestScale(prep) {
  const v = prep.st.video;
  const pts = [[v.x, v.y], [v.x + v.w, v.y], [v.x, v.y + v.h], [v.x + v.w, v.y + v.h]];
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  for (const [px, py] of pts) {
    const w = L.displayToWorld(px / L.CANVAS.w, py / L.CANVAS.h);
    const q = new THREE.Vector3(...w).project(camera);
    x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y);
  }
  return Math.max((x1 - x0) / 2, (y1 - y0) / 2);
}

function postParams(t) {
  const fin = smoother(177.2 + D, 179.6 + D, t);
  return {
    exposure: 1.0 + 0.9 * smoother(171.4 + D, 172.6 + D, t) * (1 - smoother(177.6 + D, 179.4 + D, t)),
    bloom: 0.62 * (1 - fin), threshold: 0.72, knee: 0.5, bloomRadius: 1.15,
    vignette: 0.42 * (1 - fin),
    grain: 0.026 * (1 - smoother(170.6 + D, 171.6 + D, t)),
    ca: 0.0012 * (1 - smoother(170.6 + D, 171.5 + D, t)),
    lift: 0, saturation: 1.0, tint: [1, 1, 1],
  };
}

export default {
  id: 'VIII',

  async init(ctx) {
    ({ T, THREE } = ctx);
    D = T.chapterById.VIII.start - 160;
    END_T = T.DURATION - 0.02;
    S = buildScene(ctx);
    ui = new ScreenUI(T, ctx.FONTS);
    PHASE = ui.P;
    uiTex = new THREE.CanvasTexture(ui.canvas);
    uiTex.colorSpace = THREE.NoColorSpace;
    uiTex.generateMipmaps = true;
    uiTex.minFilter = THREE.LinearMipmapLinearFilter;
    uiTex.magFilter = THREE.LinearFilter;
    uiTex.anisotropy = ctx.renderer.capabilities.getMaxAnisotropy();
    camera = new THREE.PerspectiveCamera(30, ctx.aspect, 0.01, 12);
    dof = new DOF(ctx);
    presses = buildPresses();
    pianoNotes = T.notesIn('piano', 159 + D, 181 + D).map(n => ({ t: n.t, vel: n.vel }));
    kickTimes = T.kicks.filter(k => k >= 159 + D && k < 181 + D).map(k => ({ t: k, vel: 1 }));
    // warm up: allocate the full-res level and compile every program once
    pool(ctx, 1);
    ctx.renderer.compile(S.scene, camera);
    ctx.renderer.setRenderTarget(null);
  },

  render(ctx, t, target) {
    const prep = prepare(ctx, t);
    renderLevel(ctx, pool(ctx, 1), prep, null, target);
    const r = ctx.renderer;
    r.setRenderTarget(null);
    r.setClearColor(0x000000, 1);
    r.autoClear = true;
  },

  post(t) { return postParams(t); },

  wantsFinal(t) { return t >= PHASE.player; },

  renderFinal(ctx, t, out, api) {
    const r = ctx.renderer;
    if (t >= END_T) { api.copy(api.frameZero().texture, out); return; }
    const prep = prepare(ctx, t);
    const pp = postParams(t);
    const v = prep.st.video;
    const top = pool(ctx, 1);
    if (!v || v.alpha <= 0) {
      renderLevel(ctx, top, prep, null, top.hdr);
      api.post(top.hdr, pp, out);
    } else {
      if (!f0) {
        f0 = new THREE.WebGLRenderTarget(ctx.W, ctx.H, { type: THREE.UnsignedByteType, depthBuffer: false, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter });
        f0.texture.colorSpace = THREE.NoColorSpace;
        f0.texture.anisotropy = 8;
        api.copy(api.frameZero().texture, f0);
      }
      const sigmaRaw = nestScale(prep);
      const sigma = Math.min(0.9999, sigmaRaw);
      let K = Math.max(1, Math.min(KMAX, Math.ceil(Math.log(0.6 / ctx.H) / Math.log(sigma))));
      // Landing: once each nested ring is a sliver of a pixel, the innermost levels are optically
      // identical to frame 0 (dropping them moves nothing by more than 0.3 px), but every level adds
      // a pass of dither. Shed them so the last frames converge on frame 0 as cleanly as possible.
      const ringPx = Math.max(0, 1 - sigmaRaw) * ctx.W / 2;
      K = Math.min(K, Math.max(2, KMAX - Math.floor(0.3 / Math.max(ringPx, 1e-9))));
      let prev = f0.texture;
      for (let k = 1; k <= K; k++) {
        const j = K - k;                                   // depth below the visible frame
        const need = Math.min(1, 1.05 * Math.pow(sigma, j));
        let cls = CLASSES[0];
        for (const c of CLASSES) if (c >= need) cls = c;
        if (k === K) cls = 1;
        const p = pool(ctx, cls);
        renderLevel(ctx, p, prep, prev, p.hdr);
        renderMask(ctx, p, prep);
        const dst = k === K ? out : p.ldr[p.flip ^= 1];
        // Inner levels get their own dither/grain seed: with one shared seed every level would add
        // the SAME ±1 LSB dither to the same pixel (they map onto each other as σ → 1), and 16
        // levels would stack it coherently into ±16 LSB of fixed-pattern noise.
        const seed = k === K ? api.extra.frameSeed : (api.extra.frameSeed + 7919 * k) % 100000;
        api.post(p.hdr, pp, dst, { maskTex: p.mask.texture, frameSeed: seed });
        prev = dst.texture;
      }
      this._last = { sigma, K };                           // stats for tooling only
    }
    r.setRenderTarget(null);
    r.setClearColor(0x000000, 1);
    r.autoClear = true;
  },
};
