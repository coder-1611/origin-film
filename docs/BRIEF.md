# ORIGIN: the chapter builder's brief

You are building one chapter of **ORIGIN**, a 3-minute film rendered from HTML/JS/GLSL.
Several builders are working in parallel on different chapters. This brief is the contract
between them. Read it fully, then read:

1. `STORYBOARD.md`: your chapter's section, plus the hand-offs into and out of it.
2. `SCORE.md`: what the music does under your chapter. Your picture reacts to it.
3. `src/timeline.js`: the single source of truth for times, events, positions and cameras.
4. `src/chapters/_template.js`: the shape of a chapter module.
5. `src/engine/film.js` and `src/engine/post.js`: how your output is composited.

The bar is a **showcase film**. It should be cinematic, coherent and breathtaking, not
programmer art. That means proper lighting, depth cues, atmospheric perspective, restrained
colour, motion with easing and weight, and considered composition. Each chapter shows off a
distinct technique, named in the storyboard table. Make that technique the star.

## Hard rules

1. **Every frame is a pure function of `t`.** No `Date.now`, `performance.now`,
   `Math.random`, `setTimeout` or `requestAnimationFrame` in chapter code. Use
   `T.mulberry32(seed)` / `T.hash1(n)` in JS, and `hash11/12/13/33`, `snoise`, `fbm`, `curl` in
   GLSL (`ctx.glsl`).
2. **Stateful simulations** (reaction-diffusion, boids, stateful particles) must use
   **deterministic replay**: a fixed timestep, starting from a fixed state at the start of your
   chapter window. Cache the last simulated step. If the requested `t` is behind the cache,
   re-simulate from the start. Same `t` → same pixels, whatever was rendered before. The render
   farm splits the frame range across workers, so your first frame may be anywhere in the window.
   Prove it with `--determinism` (below).
3. **Files you may create:** `src/chapters/chN-name.js` (the file name is fixed in
   `CHAPTER_FILES` in `src/engine/film.js`) and anything under `src/chapters/chN/`.
   **Files you may edit:** only your own entry in `cameras` in `src/timeline.js`. Re-read the file
   right before editing, because other builders edit their entries concurrently. Never reformat it.
   Do **not** edit engine files, other chapters, the docs, or timeline event data. If you need an
   engine change or a timeline change, say so in your final report and I'll make it.
4. **Output:** `render(ctx, t, target)` writes **linear HDR** into `target`: half-float, `ctx.W×ctx.H`,
   with a depth buffer. Overwrite every pixel. 1.0 is bright white paper, and highlights can go
   far above (bloom threshold ≈ 1.0, ACES tonemap afterwards). Don't tonemap or gamma-encode
   yourself.
5. **Renderer state is shared.** If you change `renderer.autoClear`, the clear colour, the viewport
   or the scissor, restore it (`autoClear = true`, clear colour black, alpha 1) before returning.
   Set your clear colour yourself before each clear. `ctx.clear(target, [r,g,b])` does it for you.
6. **Resolution independent.** Use `ctx.W`, `ctx.H` and `ctx.aspect`. Never hard-code 1920. Drafts
   render at 960×540. Pixel-sized contracts below are given in fractions of H.
7. **Performance budget: ≤ 120 ms per 1080p frame** on this M4, plus a one-time init of a few
   seconds at most. There are 10,800 frames. Use half-res passes for heavy volumetrics and
   upsample.
8. **Render your whole window**, `T.chapterWindow(id)`, which includes the hand-off overlaps
   either side of your start and end. The compositor calls you for every t in it.
9. **Don't add a global kick flash.** The compositor already multiplies exposure on every kick
   (`T.kickPulse`) and on the flash events (`T.flashes`). You *should* add local reactions, such as
   turbulence bursts, star pulses or line glow, using `T.kicks`, notes and `ctx.features`.

## What the timeline gives you

```js
const T = ctx.T;                         // the timeline module
T.chapterById.III.start / .end           // your chapter's bounds (downbeats)
T.bt(bar, beat)                          // time of a bar/beat (1-based, fractional beats ok)
T.barBeat(t), T.bpmAt(t), T.chordAt(t)   // {bar, beat, free}, tempo, {name, pcs, bass}
T.notes                                  // every note {t, dur, inst, midi, vel, x?}
T.notesIn('bell', t0, t1)
T.kicks                                  // kick times (sorted)
T.sfx                                    // SFX cues {t, dur, type, vel, x, ...}
T.starBirths, T.collisions, T.bubbles, T.cellDivisions, T.leafFlushes, T.arcs  // picture events
T.typing = {text, times, keyX, keyRow, start, last, enter}; T.typedCount(t)
T.flashes, T.THEIA_T, T.SPLASH_T, T.BREACH_T, T.ENTER_T
T.frieze, T.friezeX(wx, t), T.friezeCamX(t)          // VII frieze layout
T.cities, T.globeView(t), T.globeProject(t, lat, lon)  // VII globe (orthographic)
T.cameras.X, T.sampleCamera(keys, t)     // your keyframes, Catmull-Rom sampled
T.mulberry32, T.hash1, T.smootherstep, T.pwl
```

**Screen positions** in events are NDC: `x ∈ [-1, 1]` from left to right and `y ∈ [-1, 1]` from
bottom to top. The mixer pans each sound by its event's `x`, so when an event has `(x, y)`, the
visual thing must happen **at that screen position at that time**. For 3D chapters, unproject it
through your camera at the event time, then let it live in the world. Sync is the point of the
film.

**Audio features:** `ctx.features.at(t)` → `{bands: Float32Array(32), rms, onset, low, mid, high}`,
all in [0, 1], from the analysed master. They are **zeros until the score is rendered**, so design
it to look right with zeros and use the features to add life (a turbulence gain, a glow, a
shimmer). Keep the reaction in proportion.

## ctx API

`THREE` (r186), `renderer`, `gl`, `W`, `H`, `aspect`, `fps`, `draft`, `quality`, `T`,
`features`, `glsl` (`header`, `math`, `hash`, `noise`, `color`, `all`, `fsVert`),
`makeTarget(w, h, {float=true, depth=false, linear=true, wrap, type})`,
`Pass(fragGLSL, uniforms)` (fullscreen RawShaderMaterial, GLSL3; the fragment starts with
`glsl.header` or `glsl.all` and declares `in vec2 vUv; out vec4 fragColor;`),
`pass.render(renderer, target, {uniformName: value})`, `clear(target, rgb)`,
`applyCamera(perspCam, T.sampleCamera(keys, t))`, `FONTS` (`serif` = Cormorant Garamond,
`mono` = JetBrains Mono, `sans` = Inter), `frameSeed(t)`.

Chapter module: `{ id, async init(ctx), render(ctx, t, target), post?(t), drawUI?(g, t, alpha, ui) }`.
`post(t)` returns overrides of `DEFAULT_POST`: `exposure, bloom, threshold, knee, bloomRadius,
vignette, grain, ca, lift, saturation, tint`. `drawUI` draws Canvas2D in **1920×1080 design units**
(already scaled) with sRGB colours. `ui.glyphReveal(text, x, y, p, opts)` does per-glyph reveals.
Keep typography sparse and elegant. The HUD (bottom-left) is drawn for you, so keep clear of it.

## Hand-off contracts (both sides must honour these)

| Boundary | Window | Shared state |
|---|---|---|
| **0:00 (frame 0)** | — | Ch I at t = 0: near-black void, one point of light at the exact centre (core ≈ 0.003 H radius, halo ≈ 0.04 H). No text. Ch VIII's last frame *is* this frame. |
| **I → II** | 11.95–12.15 | Ch I: black with a trembling pinprick at the exact centre. Ch II for t < 12.000: **pure black**. At 12.000 exactly, the explosion erupts from the centre pixel. The engine adds the Big Bang flash. |
| **II → III** | 30.0–33.0 | Both dark. II: dim deep-red ember filaments. III: darkness with nebula gas faintly appearing. Both keep a **forward camera flow** (things stream outward from the centre) at a similar speed. III's first star ignites at the exact centre at 32.000. |
| **III → IV** | 57.2–58.6 | The frame is **filled by gold-white stellar glare**: linear ≈ (1.0, 0.82, 0.55) × 3–6 everywhere, brightest at the centre. III ends in it, and IV starts in it and pulls back out. |
| **IV → V** | 81.0–83.0 | **Earth disc at the exact centre, radius 0.3056 H** (330 px at 1080p). Sunlight from the upper-left (direction toward the sun ≈ normalize(-0.8, 0.35, 0.5)). Molten look: dark basalt crust with glowing orange crack networks. Black space and sparse faint stars. No Moon in frame. V starts identical and cools. |
| **V → VI** | 105.0–107.0 | Underwater, looking level. A teal field running from linear (0.004, 0.035, 0.045) at the bottom to (0.05, 0.22, 0.24) at the top, with soft caustic light and faint god rays from above. No other dominant features. VI's cells bloom inside it. |
| **VI → VII** | 133.0–135.0 | VI: dusk sky darkening to near-black. The sun's last glint is a **small ember at the exact centre**, linear ≈ (1.0, 0.45, 0.12) × 4, radius ≈ 0.006 H plus glow. VII: warm black (0.012, 0.008, 0.006) with the same ember at the centre, and the fire drawing grows from it. |
| **VII → VIII** | 159.2–160.6 | A **single warm-white point at the exact centre** (Round Rock's light), with everything else dark. VIII: a macro on the blinking text cursor, the same warm-white block at the centre, pulling back. |
| **VIII → loop** | 172.7–180 | VIII's recursion bottoms out at frame 0 (`api.frameZero()`), and the last frame is an exact copy of it. See the VIII notes. |

## Palette (keep the film coherent)

I: violet-black void, white-gold point. II: blackbody white-blue → gold → orange → deep red.
III: crimson H-α, teal O-III, gold stars. The galaxy has a warm core and blue-white arms.
IV: warm gold, dusty orange, a red Theia, magma. V: deep ocean blues, cloud white, gold terminator.
VI: teal → greens → sunset orange/indigo. VII: amber/gold line-light on warm black, then a navy night
Earth with gold city lights and cyan-white arcs. VIII: a dark room lit by cool screen light, warm key accents.

## Verify before you report (in this order)

```bash
node tools/snap.mjs --chapter III --every 2 --w 960 --h 540 --solo III --sheet --out tools/verify/out/III
#   → look at tools/verify/out/III/sheet.jpg (Read it), and at single frames at full size
node tools/snap.mjs --from 57.0 --to 58.8 --step 0.2 --w 960 --h 540 --sheet --out tools/verify/out/III-out
#   → hand-offs (neighbours may still be stubs; judge your half against the contract)
node tools/snap.mjs --t 40,45.5,50 --determinism --w 960 --h 540 --solo III
#   → must print IDENTICAL
node tools/snap.mjs --t 40,50 --solo III          # 1080p: report ms/frame
```

Iterate until **you** would put it in a showreel. Then report back with: what you built
(techniques), the per-frame ms at 1080p, the determinism result, any timeline camera edits,
the events you consumed, known weaknesses, and any engine or timeline change you need.

## Chapter VIII notes: the real recursion

VIII may take over the final composite. Implement `wantsFinal(t)`, which returns true in the
recursion phase, and `renderFinal(ctx, t, out, api)`, which writes the finished LDR frame into `out`:

* `api.frameZero()` → an LDR `WebGLRenderTarget` holding the film's actual frame 0 (the full
  pipeline at t = 0). This is the bottom of the recursion.
* `api.post(hdrTarget, postParams, ldrTarget, { maskTex })` runs the film's real post chain plus
  the HUD/UI layer for this t. `maskTex` (R channel, 0..1) marks pass-through pixels that skip
  exposure, tonemapping and grading, so an LDR image shown on the screen stays exact. Decode that
  texture sRGB → linear into the HDR target, and pass-through re-encodes it losslessly (≤ 0.5/255).
  Grain, dither and CA still apply unless you set `grain: 0, ca: 0`.
* `api.copy(tex, target)` is a straight copy.

This is real feedback, not a fake. For levels k = 1…K: render the laptop scene with its screen
showing level k−1 (level 0 = `frameZero`), then run it through `api.post` into a ping-pong LDR
target. The top level is the frame. Every level uses the same camera at the same t, so the
image is a true fixed point. As the camera pushes in until the screen exactly fills the frame
(head-on, 16:9), every level converges to frame 0. Fade post (grain, vignette, bloom, CA, UI)
to zero as the screen fills the frame, and at the last frame (t ≥ 179.98) write
`api.copy(api.frameZero().texture, out)`, so the last frame is byte-identical to frame 0.
Before `wantsFinal` turns on, the screen shows your editor/terminal UI through the normal
`render()` path.
