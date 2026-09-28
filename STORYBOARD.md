# ORIGIN — Storyboard

13.8 billion years in one unbroken camera move. 180.000 s, 1920×1080, 60 fps
(10,800 frames; frame *n* shows *t = n/60*; the last frame, n = 10799, is pixel-identical
to frame 0).

Every time in this document is also a value in `src/timeline.js`, which is the source of
truth. If this document and the code disagree, the code wins, and this document gets fixed.

**Musical grid.** Bar 1 is the Big Bang at 12.000 s. Tempo is 84 BPM through bar 8,
accelerating linearly to 120 BPM (33.351 s → 83.982 s), 120 BPM until 168.000 s, then a
ritardando to 60 BPM (168 → 176 s), then free time. Chapter boundaries are downbeats.

| # | Chapter | In | Out | Bars | Technique (the one this chapter shows off) |
|---|---|---|---|---|---|
| I | SINGULARITY | 0.000 | 12.000 | free | Raymarched GLSL void + per-glyph kinetic type |
| II | INFLATION | 12.000 | 32.000 | 1–7 | 250k GPU particles, curl noise, blackbody colour |
| III | FIRST LIGHT | 32.000 | 58.000 | 8–17 | Volumetric fbm raymarch + god rays → density-wave galaxy |
| IV | ACCRETION | 58.000 | 81.988 | 18–28 | Three.js scene graph, custom bloom + DOF + grain |
| V | PALE BLUE | 81.988 | 106.000 | 29–40 | Procedural planet: terrain, ocean glint, atmospheric scattering, clouds |
| VI | LIFE | 106.000 | 134.000 | 41–54 | Gray-Scott reaction-diffusion → growing forest → boids → the evolution march |
| VII | FIRE TO FIBER | 134.000 | 160.000 | 55–67 | SVG path draw-on → night-Earth with great-circle arcs |
| VIII | THE PROMPT | 160.000 | 180.000 | 68–74 + free | UI compositing + real recursive feedback (Droste) |

**No hard cuts.** Every hand-off is a match-move, a scale dissolve, or an object becoming
the next scene's object. A single-frame jump is allowed only on a storyboarded beat, and
all of them are data in `timeline.js`:
- the **flash events**: Big Bang 12.000, Theia impact 69.367, splash 102.000, Enter 168.000;
- the **story beats**: the collapse to a pinprick at 10.5 and the first star at 32.000;
- the **star births** in III, each a flash;
- the **kick exposure pulses**.

`tools/verify/cuts.mjs` checks the delivered MP4 for isolated jumps, A→B→A dropouts and
hand-off windows.

**HUD.** Present from 1.0 s (fade in to 2.5 s) until 174 s (fade out by 175.5 s). Bottom-left:
a thin rule, the chapter label (`II · INFLATION`), and the year counter in JetBrains Mono,
ticking down on a piecewise log scale (anchors in `timeline.hud.anchors`). Below one year
it counts days → hours → minutes → seconds, and it reads **NOW** on the last keystroke.

---

## I · SINGULARITY — 0.000 → 12.000 (free time)

Camera: slow dolly toward the point, 0 → 10.5 s, accelerating slightly in the riser.

| t | Beat |
|---|---|
| 0.000 | **Frame 0.** Near-black void, one point of light dead centre (core ≈3 px, halo ≈40 px). Raymarched faint violet "foam" around it, gravitationally lensed into rings. |
| 1.0–2.5 | HUD fades in: `13,800,000,000 YEARS AGO`. |
| 3.0 / 4.2 / 5.0 / 5.8 / 7.0 | Leitmotif on a pure sine (D A G F E). The glyphs **O R I G I** of the title materialise on these notes, each glyph assembling from specks of light that converge, with its own tracking and weight settle. |
| 7.6 | **N** lands on the sub-bass swell. |
| 7.8 | Subtitle `13.8 billion years · one unbroken shot` (Cormorant italic). |
| 7.0–10.5 | Riser: the point brightens, lensing rings tighten, the foam spirals inward. |
| 9.0–10.2 | The title glyphs drift toward the point and are swallowed by it, as if pulled in by gravity. |
| 10.5 | **Silence.** The point collapses to a pinprick over 0.25 s (a visual inhale), and the foam vanishes. |
| 10.5–12.0 | Black and a trembling pinprick, 1.5 s of digital silence. |

**Out → II (11.96–12.00):** the pinprick *is* the origin of the explosion. It fades over the
last 2 frames, and at exactly 12.000, on the downbeat and the impact, a white-hot core fills
the frame. 12.000 and 12.017 are the two brightest frames of the chapter. Inflation completes in
~0.02 s, and plasma structure reads by ~12.12.

## II · INFLATION — 12.000 → 32.000 (bars 1–7, 84 BPM)

Camera: inside the fireball. Slow roll (~12°) plus a steady forward dolly that continues
into III.

| t | Beat |
|---|---|
| 12.000 (1.1) | **BANG.** Sanctioned flash: white-hot for exactly 2 frames (12.000, 12.017), decaying over 0.3 s. 1,048,576 particles inflate ×10⁴ in 0.022 s, then decelerate. A shockwave ring. |
| 12–20.6 (1–3) | Quark-gluon plasma: white-blue, turbulent curl noise, colour = blackbody temperature. Kicks on beats 1 and 3 (from bar 2) punch the turbulence. |
| 20.6–26.3 (4–5) | Cooling: yellow → orange. At bar 5 (23.43) comes recombination, "first light passes through": the fog opacity drops and the plasma turns transparent. |
| 26.3–32 (6–7) | Dark ages: deep red embers drift into filaments, a cosmic web, and the camera flies through it. Bar 7 is an A7sus chord, tension. |

**Out → III (30.0–33.0):** the web dims into darkness while III's gas fades in along the same
forward motion. It is a slow 3 s dissolve, so no frame changes more than a few percent.

## III · FIRST LIGHT — 32.000 → 58.000 (bars 8–17, 84 → 101.5 BPM)

| t | Beat |
|---|---|
| 32.000 (8.1) | Darkness. **The first star ignites** at screen centre: an FM bell, the first entry in `timeline.starBirths`. |
| 32–43 (8–11) | Volumetric fbm nebula: crimson H-α, teal O-III, dark dust lanes. Every star birth is a flash at its timeline screen position and a bell pitched to the current chord. God rays stream from the brightest stars through the gas. The camera drifts forward through the nebula. |
| 43–50.7 (12–14) | The camera leaves the nebula and rises. **Reveal: a spiral galaxy** of 150k density-wave particles, with a bulge glow, dust lanes and pink HII knots. The leitmotif plays on FM bells (bars 12–13). Births continue as twinkles in the arms. |
| 50.7–58 (15–17) | **The dive.** The camera accelerates toward one star in an outer arm, the future Sun. A lens flare builds, a riser plays in bars 16–17, and the kick lands on every beat in bar 17. |
| 57.2–58.0 | The star's glow fills the frame in gold-white. |

**Out → IV (57.2–58.6):** the full-frame gold glow is shared by both chapters, and IV starts
inside the proto-Sun's glare.

## IV · ACCRETION — 58.000 → 81.988 (bars 18–28, 101.5 → 118.6 BPM)

Three.js scene. The chapter's own post chain adds bokeh DOF on the foreground debris,
heavier bloom and grain.

| t | Beat |
|---|---|
| 58.000 (18.1) | Pull back out of the glare: the young Sun, then the protoplanetary disk (Keplerian dust/gas, inner rings faster, gaps carved by protoplanets). Drums enter. |
| 58–67.2 (18–21) | Planetesimals collide with small flashes and ticks. The camera settles on the proto-Earth's orbit. |
| 67.2–69.4 (22) | Riser. **Theia**, reddish and Mars-sized, approaches from screen-right. |
| **69.367 (23.1)** | **IMPACT** near screen centre (x = +0.05). Sanctioned flash, shockwave, a magma splash and a debris plume. |
| 69.4–75.8 (23–25) | The debris settles into a ring around the glowing Earth while the camera orbits. |
| 75.8–79.95 (26–27) | The ring coalesces into **the Moon**. |
| 79.95–81.99 (28) | Push in. By 81.0 the Moon has exited left. At 81.988 the molten Earth is a disc at the exact screen centre, radius 330 px, lit from the left. |

**Out → V (81.0–83.0):** the same disc sits at the same position and radius in both chapters,
and V starts molten and cools.

## V · PALE BLUE — 81.988 → 106.000 (bars 29–40, F major, 120 BPM)

| t | Beat |
|---|---|
| 81.988 (29.1) | Key change to F major. Molten disc (r = 330 px, centred). |
| 82–85 | Time-lapse: lava cracks fade, oceans fill, the first clouds form. |
| 84–96 (30–35) | **The pale blue dot:** a slow orbit, a sun glint gliding across the ocean, a Rayleigh-blue limb, a sunset band on the terminator, clouds drifting, a faint night side. |
| 96–100 (36–37) | Descent. The limb flattens and the sky turns blue as the camera enters the atmosphere. A whoosh sounds at bar 37 (98.0). |
| 100–102 (38) | Through the cloud deck (a brief whiteout), then open ocean below, with waves and glitter. |
| **102.000 (39.1)** | **Plunge.** Sanctioned splash flash. Underwater. |
| 102–106 (39–40) | Light shafts from above, caustics, rising bubbles (each one a bubble chirp), deep teal. |

**Out → VI (105.0–107.0):** a shared teal underwater field with caustics. VI's cells bloom
inside it.

## VI · LIFE — 106.000 → 134.000 (bars 41–54, 120 BPM)

| t | Beat |
|---|---|
| 106 (41.1) | Macro underwater. **Reaction-diffusion cells** bloom: translucent, lit membranes. Every `timeline.cellDivisions` event (106–111.4) seeds a split at its (x, y), heard as a pop pitched to the chord. |
| 106–113.5 (41–44) | Colonies divide. The camera pulls back to show mats on shallow rock, then rises through the surface; the meniscus sweeps down the frame. |
| 114–120 (45–47) | **Over-under shot** at the waterline. Above it, a **forest sprouts naturally**: seedlings, then saplings, then young trees, with buds unfolding into leaves on the marimba (`timeline.leafFlushes`, bars 45–47, motif flushes most prominent). Below it, stromatolites and kelp. |
| 120–121 (48) | A **fish school** gathers below the waterline. |
| **121.0 (48.3)** | **The breach.** Fish leap the surface and become birds as they cross the waterline. The flock rises into the sky and stays there as a murmuration over the sunset. |
| 122.5–133 (49–54) | **The march.** On the shore at golden hour, sun on the horizon at centre, a procession walks left to right toward it, silhouetted, each stage the lead walker in turn (`timeline.march`): tetrapod hauling out of the water (122.5), amphibian (124), reptile (125), **dinosaur** (126, a roar on the bar-51 downbeat, stomping on every beat), small mammal (128), ape (129), **early human** (130). Every footstep in `timeline.footsteps` is a foot planting at that instant, panned to `marchX(t)`. |
| 132–133 | The human stops at the exact centre in front of the setting sun, raises a torch, and it **catches at 133.0**. |
| 133–134 | Night falls. The human and the land sink into darkness; the torch flame remains, a small ember at the exact centre. |

**Out → VII (133.0–135.0):** the torch's flame, the first fire humans made, *becomes* the ember that the fire drawing grows from.

## VII · FIRE TO FIBER — 134.000 → 160.000 (bars 55–67, 120 BPM)

Glowing amber line-art on warm black: SVG path data drawn on with animated dash offsets.
The camera trucks right along one continuous frieze. It holds on each plate while that plate
draws and animates, and glides to the next between them (`timeline.frieze.truck`). The supersaw
anthem plays.

| t | Beat |
|---|---|
| 134–138 (55–56) | **Fire:** flames draw themselves from the ember, then flicker. Synthesised crackle is panned to the flames. |
| 138–142 (57–58) | **Wheel:** drawn on, then it rolls. |
| 142–146 (59–60) | **Printing press:** the platen stamps on beats 1 and 3, with a metallic FM clank. |
| 146–150 (61–62) | **Steam engine:** the flywheel spins, the piston pumps on every beat, steam hisses. |
| 149–151 | The engine's lines unspool into latitude/longitude lines that wrap into a wireframe globe. |
| 150–157 (63–66) | **Night Earth:** city lights at real coordinates. Great-circle arcs light up on the 8th notes, each with a zap panned to its landing city's screen x. Data pulses run along the fibres. |
| 157–160 (66.2–67) | Every arc converges on **Round Rock, Texas**. The camera zooms into that light until it is a single point at the exact centre (159.2–160). |

**Out → VIII (159.2–160.6):** that city light *becomes* the blinking text cursor.

## VIII · THE PROMPT — 160.000 → 180.000 (bars 68–74 + free time)

Three.js dark room: a laptop on a desk, lit only by its screen.

| t | Beat |
|---|---|
| 160.0 (68.1) | Macro on the blinking cursor. The camera pulls back 160 → 161.5 to reveal the editor, the laptop and the room. |
| 161.0 → 167.85 | **The prompt is typed**, the exact text in `src/assets/prompt.txt`. It starts at human speed ("Build a 3-minute film called ORIGIN…") and accelerates exponentially to thousands of characters per second. The editor scrolls, the keys depress, and every character gets a keyclick panned by its key's x. The HUD falls through days, hours, minutes and seconds, and reads **NOW** on the last keystroke. |
| **168.000 (72.1)** | **Enter** (sanctioned flash). The screen becomes a terminal: `$ node tools/render.mjs` and a progress bar filling to 10,800 / 10,800 (168.3–171.6). The ritardando begins, and the leitmotif returns on a solo piano-like pluck. |
| 171.6–172.7 | The terminal gives way to a player showing the film's live output: the laptop inside the laptop inside the laptop. This is real feedback, the rendered output texture re-rendered onto the screen, iterated, with frame 0 at the bottom of the recursion. |
| 172.7 → 179.983 | Push into the screen, which turns head-on. The nested screens rush outward, and HUD and post effects fade to zero as the screen fills the frame. The drone rises back in. |
| **179.983 (frame 10799)** | **Lands on frame 0.** The last frame is byte-identical to the first rendered frame, so the MP4 loops. |

---

## Loop contract
* Visual: `frames/f10799` equals `frames/f00000` exactly. `verify/loop.mjs` diffs the source frames and the
  decoded MP4 frames.
* Audio: the drone's partials and LFOs sit on multiples of 1/180 Hz, so they are exactly
  periodic over the film. Everything that rings past 180 s is folded back onto the start, so
  the wrap is sample-continuous. `verify/loop.mjs` checks the jump at the wrap point
  against the local sample-to-sample distribution.
