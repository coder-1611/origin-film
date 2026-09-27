// The film: renders any t to pixels as a pure function of t.
//   active chapters (timeline.activeChapters) → each renders linear HDR into its own target
//   → hand-off blend → post (bloom, exposure + kick pulses + flashes, ACES, grade, grain)
//   → 2D UI layer (HUD + chapter typography) → LDR → canvas.
// Chapter VIII may take over the final composite (renderFinal) to build its real recursion.
import { THREE, makeTarget, Pass } from './gl.js';
import { Post, DEFAULT_POST, lerpPost } from './post.js';
import { UI, FONTS } from './ui.js';
import { Features } from './features.js';
import * as G from './glsl.js';
import * as T from '../timeline.js';

export const CHAPTER_FILES = {
  I: 'ch1-singularity.js', II: 'ch2-inflation.js', III: 'ch3-first-light.js', IV: 'ch4-accretion.js',
  V: 'ch5-pale-blue.js', VI: 'ch6-life.js', VII: 'ch7-fire-to-fiber.js', VIII: 'ch8-the-prompt.js',
};

const STUB_FRAG = G.header + /* glsl */`
in vec2 vUv; out vec4 fragColor; uniform vec3 hue; uniform float t;
void main() { float v = 0.12 + 0.1 * vUv.y + 0.04 * sin(t * 2.0 + vUv.x * 6.0); fragColor = vec4(hue * v, 1.0); }`;

function stubChapter(id, err) {
  const hues = { I: [0.5, 0.5, 0.9], II: [1, 0.6, 0.3], III: [0.4, 0.6, 1], IV: [1, 0.8, 0.4], V: [0.3, 0.6, 1], VI: [0.3, 1, 0.6], VII: [1, 0.7, 0.3], VIII: [0.7, 0.7, 0.8] };
  let pass;
  return {
    id, stub: true, error: err ? String(err && err.stack || err) : null,
    init() { pass = new Pass(STUB_FRAG, { hue: { value: new THREE.Vector3(...hues[id]) }, t: { value: 0 } }); },
    render(ctx, t, target) { pass.render(ctx.renderer, target, { t }); },
    drawUI(g, t, alpha) {
      g.save(); g.globalAlpha = alpha; g.fillStyle = '#fff'; g.font = `400 42px ${FONTS.serif}`; g.textAlign = 'center';
      g.fillText(`${id} · ${T.chapterById[id].name}`, 960, 520);
      g.font = `400 16px ${FONTS.mono}`; g.fillText(err ? 'ERROR: ' + String(err).slice(0, 140) : 'pending', 960, 560);
      g.restore();
    },
  };
}

export class Film {
  constructor(canvas, { W = 1920, H = 1080, fps = 60, solo = null, featuresUrl = 'src/assets/audio-features.json', quality = 1 } = {}) {
    Object.assign(this, { canvas, W, H, fps, solo, featuresUrl, quality });
    this.chapters = {};
    this.frameZero = null;
  }

  async init(log = console.log) {
    const { W, H } = this;
    const r = this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas, antialias: false, alpha: false, depth: true, stencil: false,
      preserveDrawingBuffer: true, powerPreference: 'high-performance',
    });
    r.setPixelRatio(1);
    r.setSize(W, H, false);
    r.outputColorSpace = THREE.LinearSRGBColorSpace;
    r.toneMapping = THREE.NoToneMapping;
    r.autoClear = true;
    const gl = r.getContext();
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    this.gpu = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'unknown';

    this.hdr = [makeTarget(W, H, { depth: true }), makeTarget(W, H, { depth: true })];
    this.mixTarget = makeTarget(W, H);
    this.ldr = makeTarget(W, H, { float: false });
    this.post = new Post(r, W, H);
    this.ui = new UI(W, H);
    this.features = await new Features().load(this.featuresUrl);
    this.copy = new Pass(G.header + `in vec2 vUv; out vec4 fragColor; uniform sampler2D src; void main(){ fragColor = texture(src, vUv); }`, { src: { value: null } });

    this.ctx = {
      THREE, renderer: r, gl, W, H, aspect: W / H, fps: this.fps, quality: this.quality, draft: W < 1920,
      T, timeline: T, features: this.features, glsl: G, makeTarget, Pass, FONTS, film: this,
      frameSeed: (t) => Math.round(t * 60),
      /** Apply a timeline camera sample ({pos,target,fov,roll}) to a THREE.PerspectiveCamera. */
      applyCamera: (cam, k) => {
        cam.position.set(...k.pos);
        cam.up.set(0, 1, 0);
        cam.lookAt(new THREE.Vector3(...k.target));
        if (k.roll) cam.rotateZ(k.roll * Math.PI / 180);
        cam.fov = k.fov; cam.aspect = W / H;
        cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
        return cam;
      },
      /** Clear a target to a colour (linear). */
      clear: (target, c = [0, 0, 0]) => { r.setRenderTarget(target); r.setClearColor(new THREE.Color(c[0], c[1], c[2]), 1); r.clear(true, true, false); },
    };

    for (const c of T.chapters) {
      const id = c.id;
      if (this.solo && !this.solo.includes(id)) { this.chapters[id] = stubChapter(id); continue; }
      let mod;
      try {
        mod = (await import(`../chapters/${CHAPTER_FILES[id]}`)).default;
        await mod.init(this.ctx);
      } catch (e) {
        log(`[film] chapter ${id} failed: ${e && e.stack || e}`);
        mod = stubChapter(id, e);
      }
      this.chapters[id] = mod;
    }
    for (const id in this.chapters) if (this.chapters[id].stub) await this.chapters[id].init(this.ctx);
    return this;
  }

  /** Frame 0 as a full LDR frame (the bottom of VIII's recursion). Cached: t = 0 never changes. */
  getFrameZero() {
    if (!this.frameZero) {
      this.frameZero = makeTarget(this.W, this.H, { float: false });
      this.renderTo(0, this.frameZero);
    }
    return this.frameZero;
  }

  postParams(mod, t) { return { ...DEFAULT_POST, ...(mod.post ? mod.post(t) : {}) }; }

  drawUI(t, act) {
    const ui = this.ui;
    ui.begin();
    for (const a of act) {
      const m = this.chapters[a.chapter.id];
      if (m.drawUI) { ui.g.save(); m.drawUI(ui.g, t, a.weight, ui); ui.g.restore(); }
    }
    ui.g.save(); ui.drawHUD(t); ui.g.restore();
    ui.end();
  }

  /** Render the complete frame at t into an LDR target. */
  renderTo(t, out) {
    const act = T.activeChapters(t);
    const r = this.renderer;
    const extra = { pulse: T.kickPulse(t), flash: T.flashAt(t), frameSeed: Math.round(t * 60) % 100000, uiOn: true };

    // Chapter VIII can own the final composite (its recursion needs the whole pipeline).
    const top = act[act.length - 1];
    const topMod = this.chapters[top.chapter.id];
    if (act.length === 1 && topMod.renderFinal && topMod.wantsFinal && topMod.wantsFinal(t)) {
      this.getFrameZero();                 // before we draw this frame's UI
      this.drawUI(t, act);
      const api = {
        post: (hdr, p, target, more = {}) => this.post.run(hdr, { ...DEFAULT_POST, ...p }, target, { ...extra, uiTex: this.ui.texture, ...more }),
        frameZero: () => this.getFrameZero(),
        copy: (tex, target) => this.copy.render(r, target, { src: tex }),
        uiTexture: this.ui.texture,
        extra,
      };
      topMod.renderFinal(this.ctx, t, out, api);
      return;
    }

    let params;
    let hdr;
    if (act.length === 1) {
      const m = this.chapters[act[0].chapter.id];
      m.render(this.ctx, t, this.hdr[0]);
      params = this.postParams(m, t);
      hdr = this.hdr[0];
    } else {
      const [a, b] = act;
      const ma = this.chapters[a.chapter.id], mb = this.chapters[b.chapter.id];
      ma.render(this.ctx, t, this.hdr[0]);
      mb.render(this.ctx, t, this.hdr[1]);
      this.post.blend(this.hdr[0], this.hdr[1], b.weight, this.mixTarget);
      params = lerpPost(this.postParams(ma, t), this.postParams(mb, t), b.weight);
      hdr = this.mixTarget;
    }
    this.drawUI(t, act);
    this.post.run(hdr, params, out, { ...extra, uiTex: this.ui.texture });
  }

  /** Render t to the canvas and wait until the GPU has finished. */
  async seek(t) {
    this.renderTo(t, this.ldr);
    this.copy.render(this.renderer, null, { src: this.ldr.texture });
    const gl = this.renderer.getContext();
    const px = new Uint8Array(4);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);   // forces completion
    return t;
  }
}
