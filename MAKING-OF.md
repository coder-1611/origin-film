# Making ORIGIN

ORIGIN is a 3-minute film, 13.8 billion years in one unbroken camera move. It was written
entirely in HTML, JavaScript and GLSL by Claude (Opus 5.5) working in Claude Code, from a
single prompt (the text typed on screen in chapter VIII is that prompt, verbatim). There are
no video frameworks, no stock footage, no samples and no API keys. The renderer, the
synthesiser, the mastering chain and the verification tools were all written for this film.

## Architecture

**Every frame is a pure function of `t`.** `window.__seek(t)` renders any time in any order,
which is what lets four GPU workers split the frame range and resume after a crash. There is
no `Math.random`, `Date.now` or `requestAnimationFrame` timing in film code. Randomness comes
from seeded mulberry32 and PCG hashes. The chapters with state (reaction-diffusion, boids)
replay deterministically from a fixed start, so a frame rendered cold matches one rendered in
sequence. `snap.mjs --determinism` checks this.

**One source of truth.** `src/timeline.js` holds:
- the tempo map;
- the chord chart;
- every note (1,597 of them);
- every SFX cue;
- every picture event (star births, collisions, bubbles, cell divisions, leaf flushes, fibre arcs);
- every typed character's timestamp and key position;
- the camera keyframes and the HUD clock.

The score and the picture both import it. When a bell rings in chapter III, a star ignites at
the screen position that the bell is panned to, because both read the same event.

**The accelerando was solved, not guessed.** The tempo ramps 84 → 120 BPM between two
breakpoints (33.3509 s and 83.9824 s), found by Newton's method so that the chapter boundaries
at 58, 82 and 106 s land exactly on downbeats.

**The pipeline:**
- **Picture:** Three.js as GL plumbing; per-chapter HDR targets; hand-off blending; a custom
  post chain (13-tap bloom pyramid, ACES, chromatic aberration, vignette, deterministic grain,
  triangular dither); a Canvas2D typography layer for the HUD. Chrome renders it headless on the
  Apple M4 GPU through ANGLE/Metal. The renderer refuses to run on SwiftShader.
- **Sound:** a Web Audio graph in an `OfflineAudioContext`:
  - FM bells, supersaw pads and lead, a formant choir;
  - Karplus-Strong strings and a piano-like pluck, modal marimba;
  - synthesised drums and granular fire crackle;
  - 6,420 individually panned keyclicks.

  The reverb is a convolution with a procedurally generated impulse response. Mastering is
  JavaScript: a glue compressor, BS.1770 loudness to −14 LUFS, and a 4× oversampled lookahead
  true-peak limiter. All of it runs circularly, so the loop point sees its own neighbours.

## The eight chapters

| | Technique | Built by |
|---|---|---|
| I | Raymarched void with gravitational lensing (rays bend ∝ 1/b), a glyph-by-glyph title assembled from ~1,400 specks per letter | builder 1 |
| II | 1,048,576 particles as closed-form functions of time, a blackbody cooling ramp, a cosmic web | builder 1 |
| III | Half-res volumetric fbm nebula with baked light volumes and god rays; a density-wave galaxy of ~219k particles | builder 2 |
| IV | Three.js scene graph: a Keplerian disk of 400k grains, the Theia impact, a debris ring → the Moon; depth-of-field bokeh | builder 3 |
| V | A procedural planet: Rayleigh + Mie scattering, a GGX sun glint, cyclone clouds; one continuous dive into the sea | builder 4 |
| VI | Gray-Scott reaction-diffusion → an L-system forest (176 trees) → 420 boids that turn from fish into birds | builder 5 |
| VII | Hand-authored SVG path data drawn on as HDR light; a night Earth with ~10k lights and great-circle fibre arcs | builder 6 |
| VIII | A Three.js laptop; the prompt typed live; **real recursion**: the film's own output rendered back onto the screen, up to 16 levels | builder 7 |

The chapters were built in parallel by seven Claude subagents from one shared brief
(`docs/BRIEF.md`). The brief was a contract: the ctx API, the determinism rules, the
performance budget and exact hand-off specs. For example, "the Earth disc at the exact centre,
radius 0.3056 H, lit from the upper-left" is shared by IV and V, and both measured it at 330.x px.

## Review loop

I reviewed every chapter's contact sheet and sent targeted fixes. The measured draft pass
caught things eyes would miss:
- **The Big Bang peaked 0.3 s after the downbeat.** Fixed: it's now white-hot on exactly
  frames 12.000 and 12.017.
- **A 3-frame dropout of the steam engine at 149.0.** The glitch detector exists because of it.
- **An auto-scroll jump in the editor at 166.15.** Fixed: the scroll now eases continuously.
- **An AAC click at the loop point.** Fixed with circular padding and an edit-list trim.
- **Two bugs in the tools themselves:**
  - The contact-sheet labels were 2 s off, from ffmpeg's rate-based frame picker.
  - An envelope onset detector fooled by sustained bass, replaced by a matched filter against
    the synthesised kick waveform.

## The loop

The last frame is frame 0: VIII's recursion bottoms out in the film's actual frame 0, and the
final frame copies it exactly. The encoder checks the source frames are byte-identical, then
reuses frame 0's own IDR access unit as the last frame, so the decoded MP4 is pixel-identical at
both ends. On the audio side:
- The drone's partials and LFOs sit on multiples of 1/180 Hz, so it's exactly periodic.
- Reverb tails past 180 s fold back onto the start.
- The AAC is encoded circularly padded, so the decoder gets real pre-roll. The MP4 edit list is
  then rewritten so the presentation is exactly samples 0–8,640,000. Container, video and audio
  durations are all exactly 180.000 s, and the decoded seam jump is smaller than the median
  sample step around it.
- Along the way I found that x264 `qpfile`s are silently ignored through ffmpeg: that parser
  lives in the x264 command-line tool, not the library. Reusing frame 0's encoded IDR was the
  cleaner answer anyway.

## Numbers

| Measure | Value |
|---|---|
| Final render | 10,800 frames at 1920×1080 in 4.8 minutes (4 workers, ~38 fps) |
| Encode | about 7.5 minutes |
| Draft | 5,400 frames at 960×540 in 1.6 minutes |
| Score render | about 5–8 minutes in `OfflineAudioContext` (single-threaded, while sharing the machine) |
| Codebase | the chapters are ~12.9k lines; engine, audio and tools ~3.4k (measured with `wc -l`) |

`docs/VERIFICATION.md` has every measured result, pasted from the tools' output.

## What I'd do with more time

- Real coastline data for the night Earth, instead of hand-drawn outlines.
- A proper bokeh-and-motion-blur pass shared across chapters.
- Hand-shaped (not generated) melodies for the lead in VII.
- A second pass on the forest's leaf geometry.
