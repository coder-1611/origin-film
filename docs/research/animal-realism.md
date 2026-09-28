# Animal realism for the ORIGIN shore sequence (round 2)

Chapter VI, 128–151 s. Seven separate animals, a continuous golden-hour camera drift along the
shore, no morphing, an ambient bed instead of drums/marimba. This doc tells the builder **how each
animal moves, behaves and sounds**, with numbers, and ships working, deterministic prototypes.

| Deliverable | Where |
|---|---|
| Gait clock (variable speed, natural stops, stride variability, no foot sliding) | `src/chapters/ch6/lab/gait2.js` |
| Behaviour beats: theropod (full), fox, lizard | `src/chapters/ch6/lab/beats.js` |
| Water dance (Faraday droplets driven by the sub-audible vibration) | `src/chapters/ch6/lab/water-dance.js` |
| Voices, footsteps, surf, wind, flock, torch, all synthesised | `src/chapters/ch6/lab/voices.js` + `dsp.js` |
| Harnesses | `lab/beats-harness.js` (`lab.html?scene=beats`), `tools/scratch/lab-audio.mjs`, `tools/scratch/lab-mux.mjs` |
| Evidence | `tools/verify/out/lab-r2/`, `tools/verify/out/lab-audio/` |

The one edit to shared lab code: `lab/creatures.js` `quadruped()` takes an optional
`P.clock` (3 lines). Without a clock the output is byte-identical (verified with an A/B PNG
render of t = 139.0; `march.js` doesn't pass one).

---

## 0. Diagnosis: the coordinator's four points, checked frame by frame

I rendered 128–151 s at 1/15 s steps (345 frames, `lab-r2/march-before/`). The motion strips are
`s-*.jpg` and the overview is `overview.jpg`.

**(a) Everything is on the beat grid: confirmed, and total.**
- All 92 footstep and call events of the march sit exactly on the 1/8-note grid at 120 BPM (mean
  offset **0.00 ms**; random timing would give 15.6 ms).
- Every animal's gait period was forced to a musical value: T = 1.0 s or 0.25 s, 2/4/8 steps per
  second.
- The calls land on beat 1 (the dinosaur "roars" at 138.000 and 140.000, exactly 2 s apart).
- People bind a movement and a sound as "together" within ±300–450 ms, and footfalls are exactly
  what they bind beats to ([PMC6711538](https://pmc.ncbi.nlm.nih.gov/articles/PMC6711538/)). So
  a 2 Hz stride under a 120 BPM track reads as dancing whatever the phase. Shifting the phase
  won't fix it; the grid has to go.

**(b) Morphing: confirmed.**
- Mid-morph frames are chimeras (e.g. t = 141.9 half theropod, half fox; t = 147.7 ape rising
  into human).
- The morph also forced every animal into the same procession pace and screen path.

**(c) Gaits biomechanically wrong: confirmed. The biggest single cause is scale × cadence, which
the diagnosis missed.** To fill the frame, small animals were drawn huge but kept small-animal
cadence:

| Stage | Shown as | Cadence shown | Natural cadence at that size | Froude shown |
|---|---|---|---|---|
| Amphibian | ×16 → a **3.2 m** salamander | 4 footfalls/s | ~1 footfall/s (cycle ≈ 2 s) | 0.44 (a salamander walks near 0.05) |
| Lizard | ×7.5 → a **3.4 m** lizard | **8 footfalls/s**, walking trot at 1.8 m/s | ~1–1.3 Hz stride | **1.22**, a sprint |
| Tetrapod | 3.6 m | crutch cycle 1.0 s | 2.5–3 s plus rests | 0.28 |

- A giant body with a toy's step rate is the "silly" read: it looks like a wind-up toy.
- Also seen:
  - constant speed, with nobody ever stopping except the human;
  - the fox trotting at 4 Hz with a stiff tail;
  - the theropod's head bobbing twice per stride, with its mouth gaping and **teeth showing**
    (Cullen et al. 2023 found theropods most likely had lips covering the teeth);
  - identical left/right timing everywhere.

**(d) The roar: confirmed, and it's the wrong kind of sound.**
- `before/roar-138.wav`: a sawtooth growl at 70–95 Hz with 23 Hz FM, plus a noise formant sweeping
  350 → 900 → 260 Hz, through tanh saturation. Centroid 140 Hz, 30 % of energy at 100–500 Hz.
  It is also buried under drums and marimba (`before/march-128-151.png`).
- That is the Hollywood open-mouth roar. The evidence (§3.1) points to **closed-mouth booming**
  for big theropods: near-sinusoidal energy at ~25–45 Hz and its first harmonics, no
  broadband roar.

Round-1 note: my own round-1 lab gaits used published duty factors and offsets (Hildebrand et
al.). The rhythm and scale overrides in `march.js` broke them. The gait engine itself (world-locked
stance feet, IK) is sound; what was missing was a clock that can change speed and stop.

---

## 1. Locomotion: parameters per animal

### 1.1 The scaling rules (put these in the engine)
- **Froude number** Fr = v²/(g·h), where h is hip height. Relative stride λ/h ≈ 2.3·Fr^0.3 (Alexander
  1976). Unhurried walks sit at Fr ≈ 0.1–0.25; animals change gait near Fr 0.5.
- **Cadence follows size.** At equal Fr, f ∝ 1/√h. At a fixed leg length, f = v^0.4·g^0.3 / (2.3·h^0.7)
  (what `gait2.js` integrates). **Cadence that's wrong for the size is the #1 "silly" cue.**
- **Sprawlers break Froude scaling** (hip height is tiny compared with their reach). Use measured
  data in body lengths (SVL = snout–vent length) per second instead. `gait2.js` has `fExp`/`vRef`
  for this.
- **Walks are inverted pendulums:** the COM is highest at mid-stance. Only trots and runs bounce
  (lowest at mid-stance).
- **Stride variability:** stride-time CV 2–3 %, long-range (1/f-like) correlated (Hausdorff
  1995; DFA α ≈ 0.95). Use per-cycle placement jitter of ~1–3 % of leg length and 1–2 % L/R
  asymmetry.

### 1.2 Master table: at the size to show each animal

Sizes are my recommendations: show each animal at its real size and let the camera come
closer for small animals (§2.3). Sources are in §6, and "EST" marks my estimates.

| Animal (as shown) | Hip h | Gait, phase from LH (fraction of cycle) | Duty | Speed | Stride λ | Cycle | COM | Spine / tail / head |
|---|---|---|---|---|---|---|---|---|
| **Tetrapod**, 2 m | ~0.2 m | Both forelimbs in phase (crutching); hind limbs brace; tail pushes | Push phase 45 %, recovery 52 % | ~0.19 m/s while moving | 0.54 m (0.27 BL) per crutch | **2.5–3 s** per crutch, plus **0.6–1.2 s rests** | Chest *lifts* on the push, belly drops and rests | Small bend in sync with the push (±5–10°, EST); head pitches +5–10° on the push |
| **Amphibian**, 1.7 m temnospondyl (salamander kinematics) | ~0.2 m | Lateral-sequence (LS), diagonal couplets: LH 0, LF 0.4, RH 0.5, RF 0.9 | 0.74–0.77 | ~0.3 m/s (EST) | 0.66–0.84 SVL | **~1.8–2.2 s** (DER) | Pelvis ±2.5 % SVL | **Standing wave, nodes at the girdles**; trunk 55–66° total bend; pelvis rotates 33–38°, pectoral girdle 23° **counter-rotating**; feet barely lifted (≤12 % SVL) |
| **Lizard**, monitor 1.35 m (k = 3) | 0.17 m | Walk: LS, phase ~0.4 (LH 0, LF 0.4, RH 0.5, RF 0.9). Darts: same, faster | 0.72–0.75 | Walk 0.2–0.3 m/s; **darts ~1.1 m/s** | ~0.9 SVL | Walk 1.0–1.5 s; darts ~0.6 s | Walk: pendulum | Standing wave → travelling wave with speed; pelvis ±15°; tail travelling wave, lag 0.25–0.4 cycle base → tip (EST) |
| **Theropod**, Allosaurus-class (6 m, hip 2 m, k = 2) | 2.0 m | Biped, L 0 / R 0.5 | 0.60–0.65 | **1.7 m/s** | 2.6–2.8 m | **1.43–1.52 s** (0.66–0.70 Hz; steps 0.71–0.76 s apart) | Pendulum, 3–5 % h peak-to-peak (6–10 cm); lateral 1–2 % h | Pitch ±1.5–3°; roll ±2–3° toward the stance leg; **tail yaws toward the retracting leg** plus a vertical bob at step rate; **head translation damped 50–80 %** (no pigeon bob) |
| Theropod, Coelophysis (3 m, hip 0.95 m) | 0.95 m | same | same | 1.2–1.4 m/s | 1.25–1.35 m | ~1.0 s | same | same |
| **Fox**, real (shoulder 0.37 m) | 0.35 m | **Trot**: LH+RF 0, RH+LF 0.5 (2 % diagonal lag). Walk alternative: LS 0/0.25/0.5/0.75 | Trot < 0.5 (0.45); walk 0.65 | Trot **1.6 m/s** | 0.59 m | **2.6–2.7 Hz** (0.37 s) | Trot bounces 2–4 % of leg length, lowest at mid-stance | Head and withers move out of phase; tail near horizontal, lags 0.1–0.2 cycle |
| **Chimp**, real | 0.5 m | Diagonal-sequence (DS): LH 0, RF 0.1, RH 0.5, LF 0.6, **alternating with LS from stride to stride** | 0.65–0.67 | 0.84 m/s | ~0.9 m | **~1.2 s** | Low pendulum, 1.5–2.5 cm | Trunk ~30° above horizontal; feet overstride the hands; hind limbs carry 1.5× the force |
| **Human**, *H. erectus* 1.7 m | 0.9 m | Biped, L 0 / R 0.5 | 0.61 (10 % double support each) | 1.34 m/s; **~1.1 m/s at end of day** | 1.41 m | 1.08 s (112 steps/min); 100–105 steps/min tired | +4–5 cm vertical (highest in single support); ±2 cm lateral | Pelvis rotation ±4.6°, obliquity ±4.2°; knee peaks 60° at 72 % of the cycle; toe clearance 1.3 cm; arms ~25° opposite the legs; head pitch counters the bob |

**Foot trajectories**, all animals:
- Stance feet are world-locked (`gait2.foot()`: max slide 0.00 m, measured).
- Swing is a fast eased arc that peaks **early**, just after lift-off, then skims.
- Swing height is small: human 1.3 cm toe clearance; salamander barely lifted; theropod peak
  ~10–15 % of leg length.
- Swing height scales with stride length, so short braking steps lift less (implemented).

**Theropod foot**, from the Gatesy 1999 trackways:
- The foot enters down and forward at ~45°, with the metatarsus inclined 25–30° through early
  stance (**hip-driven, not knee-driven**).
- The toes are splayed at touch-down and **converge fully as the foot lifts**.
- Trackways are narrow: pace angulation ~170°, feet land near the midline.

### 1.3 The gait clock (`gait2.js`): why it fixes "silly"
- It integrates X = ∫v dt and phase = ∫f(v) dt from a **speed plan** (keyframes), so animals
  accelerate, brake and stand still. Stride length shrinks with speed (λ ∝ v^0.6).
- **Stops land in a support window.** The deceleration is re-timed so the stop phase has every
  foot planted (a biped in double support). A foot caught mid-swing finishes its swing and
  plants.
- The `freeze: {foot, s}` option instead stops with a chosen foot **held raised**. Lizards pause
  at a limb-cycle extreme.
- Stride variability comes from 1/f-like fbm on frequency (CV ≈ 2.5 %) plus seeded per-cycle
  placement jitter.
- Checked numerically. At hip 2 m and 1.6 m/s: 0.64 Hz, and the phase stays flat through a 2.2 s
  stop. Plant intervals 0.70, 0.72, then a 0.96 s braking step. Stance slide 0.00 m.

---

## 2. Behaviour: what a documentary camera catches in 3–4 s

### 2.1 Practitioner principles

These come from Framestore (Prehistoric Planet), Tippett (Jurassic Park), MPC (The Lion King)
and Rhythm & Hues (Life of Pi):

1. **Take every behaviour from a living animal.** No human gestures (on Timon, human gestures
   "broke the character"). Dinosaur eyes get "precisely zero" human attributes.
2. **Restraint.** "The more you exaggerate it like traditional animation does, it loses its
   realism." Keep bobs and sways at the measured amplitudes above.
3. **Eyes lead, head follows.** In silhouette this becomes a head **saccade-and-hold**: fixations
   of 0.2–0.6 s with quick 10–40° shifts. This is the strongest life cue at distance.
4. **Secondary motion is weight.** Hips wiggle, the body rocks, the tail follows (the Walking
   with Dinosaurs Allosaurus looked "horribly wooden" without it).
5. **Life in stillness.** Breathing, a gust in the fur. Intermittent animals spend about **50 %
   of locomotion time paused** (Kramer & McLaughlin 2001).
6. **Asymmetry.** Ears move independently, one foot stays raised during a freeze, the tail lags.

### 2.2 Beat sheets, in film time

Film windows are the coordinator's. Local timings come from the prototypes where they exist.

**Tetrapod haul-out, 128.0–131.0.** A mudskipper/seal model: both forelimbs crutch together,
the belly drags, and each move starts with the head lifting.

| t | Beat |
|---|---|
| 128.0 | Wash recedes; head already up; water sheets off the skull |
| 128.4 | Head and neck lift first |
| 128.6–129.3 | Lunge: both forelimbs plant, a push-up lifts the chest; the body gains 0.2–0.25 BL; the belly drags; the tail pushes |
| 129.3–130.2 | **Full stop.** Chest drops onto the sand; 1–2 throat pulses at ~1.5 Hz; **an air gulp** at ~129.7 (snout tips up, jaw opens ~0.3 s) |
| 130.2–130.9 | A second, weaker lunge. One fin slips (bichirs slip more often on land) |
| 130.9–131.0 | Head lowers and rests; water trickles off the flank |

Sound: `tetrapodHaulOut()`, with its lunge and gulp times set from this table. It is an exhale
puff per push, belly-drag grains, drip pops and the gulp click. **No calls**: acoustic
communication evolved much later in each lineage.

**Amphibian, 131.0–134.0.** A 1.7 m temnospondyl with salamander kinematics.

| t | Beat |
|---|---|
| 131.0–132.3 | One slow stride (cycle ~2 s); S-shaped standing wave; diagonal limbs move together |
| 132.3–133.1 | **Pause at maximum bend with one forefoot raised** |
| 133.1–133.5 | Head lifts and swings ~15° to scan; throat pulses at 1.5 Hz |
| 133.5–134.0 | The foot sets down; half a stride resumes |

Sound: footfall pats and a breath. A frog-style call (`frogCall()`) is **anachronistic** here:
frogs join the soundscape in the Upper Jurassic (Senter 2008). Use it only as deliberate poetic
licence, softly and distant.

**Lizard, 134.0–137.5** (implemented: `makeLizardBeat`, `beats-lizard.jpg`). A monitor.

| t | Beat |
|---|---|
| 134.0–135.0 | **Dart**: 2–3 bursts of 0.22–0.42 s with 0.08–0.2 s hitches (Avery 1987: 0.30 s bursts, 0.12 s pauses); strong body and tail undulation |
| 135.0–136.5 | **Freeze**, near forefoot held raised. The duration comes from a heavy-tailed draw |
| 135.6 | Head rises ~22° to eye the sky with one eye |
| 136.0 | One forked **tongue-flick**, ~0.25 s, backlit |
| 136.5–137.5 | Hold, then a dart out |

Sound: claw clicks per plant (`footstep({m: 6, kind: 'claw'})`). Tongue flicks are silent. A hiss
(`lizardHiss()`) belongs only to a threat, for instance if the theropod's footfalls come
close.

**Theropod, 137.5–142.0**, the centrepiece (implemented: `makeTheropodBeat`,
`theropod-beat-av.mp4`). The display model is the **cassowary** (Mack & Jones 2003): gulps, an
inhale that raises the body, the head thrown down, then the boom. The neck skin inflates to about
twice its width, "the entire bird vibrated visibly". The crocodilian adds the SAV, the
sub-audible vibration that comes before the boom.

| t (film) | Local | Beat |
|---|---|---|
| 137.5 | 0.0 | Walks in. 1.7 m/s, strides 0.66–0.70 Hz. Head held level in the world; pelvis see-saw ±2°; COM bob 3 cm; tail counter-swing |
| 138.2–139.0 | 0.7–1.5 | **Braking step**: shorter and slower (0.96 s interval); feet finish in double support; body pitch settles with a damped wobble |
| 139.0–139.5 | 1.5–2.0 | Head **saccade-and-holds** (2–3 small jumps) |
| 139.17 / 139.47 | 1.67 / 1.97 | **Two gulps**: throat pumps, tiny wet clicks |
| 139.85–140.4 | 2.35–2.9 | **Inhale**: chest swells 7 %, body rises 2.5 %, a short nasal intake |
| 140.44 | 2.94 | Head drops low, **mouth shut**; tail lifts |
| 140.44–141.75 | 2.94–4.25 | **SAV** at 18.9 Hz: the body trembles, and the swash at its feet **erupts into jumping droplets** (the water dance, §3.3). Throat sac inflating |
| 141.8–143.2 | 4.30–5.70 | **Boom** at f0 ≈ 33 Hz, 1.4 s, closed mouth; sac about 2× the neck width; body vibrates. The tail of the boom rings across the drift into the fox's shot. That is fine: off-screen sound is documentary grammar |
| (146.4) | (8.9) | The second boom of the bout, **off-screen and distant** under the ape shot. The bout continues; nothing is on a grid |

**Fox, 142.0–145.0** (implemented: `makeFoxBeat`, `beats-fox.jpg`).

| t | Beat |
|---|---|
| 142.0–143.2 | Trots in at 1.6 m/s, **2.6–2.7 Hz** (deliberately off 2 Hz); the tail trails |
| 143.25 | **Stops within one stride**; head rises |
| 143.35–144.2 | **Ears rotate independently.** Seeded events: one leads, the other follows 0.1–0.2 s later at a different angle. Head tilts ~15° |
| 144.25–144.75 | **Nose dips to the sand** for ~0.5 s, with a micro-quiver (not a visible 5 Hz bob) |
| 145.0–145.3 | **Looks back over the shoulder**, holds |

Sound: pad steps (`footstep({m: 6, kind: 'paw'})`). The fox itself stays silent; optionally a
**distant** contact-bark series from another fox (`foxBarks()`).

**Ape, 145.0–148.0.** A chimp, real size.

| t | Beat |
|---|---|
| 145.0–146.3 | Knuckle-walks: rump above the shoulders, head low, a lateral roll, strides ~1.2 s. Switches between diagonal- and lateral-sequence from stride to stride |
| 146.3–146.8 | **Stops and sits back onto its haunches.** Don't stand it up to scan: only 2 of 97 wild bipedal bouts were for scanning (Hunt) |
| 146.8–147.2 | **Scratches** its forearm: 4–6 irregular strokes of ~0.12 s; the eyes, then the head, turn to the sun |
| 147.2–148.0 | **Pant-hoot**: lips funnel; build-up pants with the chest pumping (accelerating 3 → 6 per second); **piloerection** (silhouette grows ~10 %); the head throws up at the climax |

Sound: `pantHoot()`. Its build-up and climax start ~1.5 s before the visible climax (the
introduction plays over the walk), and the let-down runs under the human's entrance. A **distant
reply pant-hoot** from other chimps ~8 s later (mean chorus gap 7.96 s) would sit under the
torch moment.

**Early human, 148.0–151.0.**

| t | Beat |
|---|---|
| 148.0–149.3 | Walks at ~1.1 m/s, ~1.7 steps/s, a tired end-of-day cadence; torch carried low at the side, unlit |
| 149.3–149.9 | **The last two steps shorten**; a controlled stop brings the feet together; weight settles back |
| 149.9–150.2 | Stillness; the head lifts toward the horizon (large gaze shift: eyes first, head supplies ~80 %) |
| 150.2–150.9 | A tiny anticipatory dip, then **the torch rises over ~0.7 s**, ease-in-out with a slight overshoot |
| 151.0 | **It catches**: `torch()`, a whoomph then a crackle burst of 8–15/s settling to 1–3/s; flame flicker 8–12 Hz |

### 2.3 Scale and camera
- Show every animal at its **real size**. The camera's drift eases **closer and lower** for
  small animals: lizard and fox at ~3.5 m, camera at 0.2–0.35 m height; theropod at ~15 m,
  camera at 1.25 m. A telephoto documentary does exactly this.
- The theropod's scale then reads by contrast. **Never scale a small body up while keeping its
  cadence** (see §0c).
- The camera follows each animal with a **lag**: a critically damped average of the animal's x
  over the last ~1.2–1.6 s (`beats-harness.js`). Never lock it to the animal.

### 2.4 Idle micro-motions that read at silhouette scale

At 12–15 m, 1080p gives about 2 px per cm.

| Motion | Rate / duration | Amplitude | Reads in silhouette? |
|---|---|---|---|
| Head saccade + hold | Fixations 0.2–0.6 s | 10–40° | **Yes. The strongest cue** |
| Ear rotation / flick (fox, chimp) | Events (lognormal gaps), ~0.12 s turns | Up to 150° | **Yes** |
| Tail flick / swish | Events every 1–3 s | Large | **Yes** |
| Breathing, human / chimp | f = 53.5·M^−0.26 per minute: human ~18, chimp ~20, fox ~34 | Mm–cm | Marginal. Carry it on the shoulder/back line, ×2–3 |
| Breathing, theropod | ~2–8 per minute | cm | Less than one breath per shot: let the display inflation carry it |
| Postural sway, human | 0.1–0.5 Hz | RMS 7–9 mm | Subliminal, but keep it |
| Throat pulse (amphibian, tetrapod) | 1.5 Hz | mm | Only on a big animal |
| Blinks | Human 17/min, chimp 19/min | — | No |
| Fur or feathers in wind | Gusty, 0.3–3 Hz | cm tufts | **Yes, on the backlit rim** |

---

## 3. Sound: recipes, prototypes, verdicts

Every recipe is a pure function (sr, params, seed) → Float32Array in `lab/voices.js` (DSP kit in
`lab/dsp.js`). Render, spectrogram and measure them with `node tools/scratch/lab-audio.mjs`.

The output lands in `tools/verify/out/lab-audio/<name>.wav|png`, with measurements in
`analysis.json` and `analysis.txt`. Overview sheets: `voices-sheet.png`, `steps-sheet.png`.

Everything is placed with `outdoor()`: 1/r, air absorption, a ground reflection, and a short
open-beach tail (RT 0.4–0.9 s). **Do not route animals through the concert-hall IR.**

### 3.1 Theropod: why a boom, not a roar
- **Closed-mouth calling is a big-animal behaviour.** Calling into an inflating neck cavity
  evolved **≥16 times** in archosaurs (Riede et al. 2016), almost always in large species (only
  4 of 52 closed-mouth callers are under 100 g). The authors conclude some non-avian dinosaurs
  could do it.
- **The skin makes it nearly a pure tone.** The oesophageal wall and skin low-pass the sound, so
  higher harmonics are weak.
- **No syrinx, so no birdsong** (the Vegavis syrinx is late; Clarke et al. 2016). The larynx was
  probably a modifier, not a source (Yoshida et al. 2023).
- **Senter (2008) argues most displays were non-vocal.** Hisses, jaw claps and stomps are
  therefore also valid vocabulary.
- **Real archosaur displays have a silent body-vibration component.** The alligator's **SAV** at
  18–20 Hz precedes each bellow and shortens through the bout: 1.35 s for the first, 0.55 s by
  the fifth.
- **The sound designers agree.** Julia Clarke: "we might feel these sounds more than we would
  hear them." Prehistoric Planet: "It sounds like this, but it's bigger."

**Recipe** (`boomPlan()` + `theropodBoom()`; the bout plan is shared with the animation):

| Stage | Parameters |
|---|---|
| Gulps | 2 wet clicks (bandpass 700 Hz, τ 15 ms) plus a 55 Hz throat thump, lognormal 0.15–0.4 s apart |
| Inhale | 0.45–0.65 s of nasal turbulence, bandpass sweeping 250 → 700 Hz |
| SAV | 18.5–20 Hz sine, felt more than heard, 0.25 s fades; length 1.35 − 0.2·(boom index) s. Droplet-rattle grains (1.5–4.5 kHz, 3 ms) gated by the rectified f/2 Faraday envelope |
| Onset pulse | 0.15–0.3 s, f0 **200 → 100 Hz**, mouth-open formants 143/430/715 Hz (1.1 m tract, F = (2i−1)c/4L), period-doubled (cassowary) |
| Boom | Rosenberg pulse train, **f0 one value per individual in 28–45 Hz** (lab: 31–33). Starts 12 % high, settles over 50 ms, drifts ±3 % (1–5 Hz), AM 10–20 % at a random 5–20 Hz, falls 13 % over the last 0.3 s. Jitter 2 %, shimmer 8 %, OQ 0.55. Length lognormal (median 1.35 s, 0.8–2.0) |
| Filter | Sac resonance at **1.1·f0** (Q ≈ 4) plus 2.1·f0 and 3.1·f0 (the 2nd and 3rd harmonics carry the pitch on small speakers); skin low-pass 12 dB/oct at 3.2·f0 and 400 Hz; mouth formants leak only in the onset |
| Nonlinear phenomena | Per boom: **25 % subharmonic** (f0/2, 100–300 ms), **10 % biphonation** (second source at 1.37·f0), 8 % a 50 ms frequency jump (Fitch et al. 2002; NLP rates guided by Riede 2007) |
| Bout | 2–7 booms, **gaps lognormal (median 3.5 s, 2–8 s)** |
| Threat vocabulary (optional) | Hiss: two noise bands 150–400 Hz + 2–8 kHz, 30 ms attack, 0.4–3 s. Jaw clap: 0.16 s crack at 50–425 Hz |

**Measured, lab vs published:**

| | Published | Lab (`theropod-boom.wav` at 14 m) |
|---|---|---|
| f0 | Cassowary 23–32, capercaillie 29, alligator bellow ~55, bustard 40–54 Hz | **29.4 Hz** median (YIN), p90 31.3 |
| Energy | Near-pure tone, harmonics weak | **91.5 % in 20–100 Hz**; centroid **35 Hz**; H2/H3/H4 at −14/−19/−21 dB |
| SAV | 18–20 Hz, 1.35 s → 0.55 s | 18.9 Hz, 1.31 s then 1.13 s |
| Before (`movie-roar-before`) | — | Centroid 140 Hz, 30.5 % in 100–500 Hz, broadband formant noise |

A/B spectrograms: `roar-vs-boom-low.png`, and the top row of `voices-sheet.png`.

**Verdict: convincing, by the numbers and the physics.**
- The spectrogram has the look of published cassowary and capercaillie boom spectrograms: a
  bright fundamental line with a sparse harmonic ladder, an onset pulse, and a sub-audible band
  before it.
- **Caveat: most speakers reproduce nothing below ~40–60 Hz.** The 2nd and 3rd harmonics
  (60–100 Hz) plus the onset pulse are what laptops will play. Keep the sac resonances as shipped;
  don't low-pass harder.
- In the mix, put the boom about 10 dB over the surf in the low band.

### 3.2 The other voices

| Sound | Published description | Recipe (key parameters) | Lab measurement | Verdict |
|---|---|---|---|---|
| **Frog** "jug-o-rum" (bullfrog) | Pulse rate 80–135 Hz; **bimodal** energy at 200–300 Hz and 1200–1600 Hz; notes 480–595 ms, gaps 500–530 ms, 2–12 notes; 1–3 AM humps per note | Pulse train 95–120 Hz (jitter 1 %, OQ 0.35), resonators 250 Hz (Q 3) and 1.4 kHz (Q 5, +high band), vocal-sac LP 2 kHz, 1–3 humps | f0 **111.7 Hz**; 71.6 % at 100–500 Hz, **26 % at 0.5–2 kHz**; notes 0.48–0.6 s | Good bullfrog. **Anachronistic** for a Palaeozoic amphibian (see beat sheet) |
| **Lizard hiss** (monitor) | Broadband, ~white; 1.5–9 kHz, peak ~4 kHz; no temporal pattern | Pink noise HP 1.5k / LP 9k / peak +8 dB at 4 kHz; throat resonance 1 kHz; attack 25 ms, pressure decay τ 0.4 s; 0.4–1.5 s, pairs 0.3–0.6 s apart | Centroid **4086 Hz**, 89.6 % in 2–8 kHz, peak 3.9–4.1 kHz | Matches. Use only as a threat |
| **Fox** contact bark "wow-wow-wow" | Max f0 600–1200 Hz; energy 700–3600 Hz; 3–7 syllables | Syllables 120–200 ms, f0 700 → 1000 → 750 Hz, noisy "w" offglide, formants 1.2/2.6/3.8 kHz (+700), jitter 2 %, shimmer 8 %, chaotic onset; gaps 0.35 s rising to 0.6 s | f0 **924 Hz** (857–1008); 99.8 % in 0.5–8 kHz | Reads as a fox bark. Syllable timing is an estimate |
| **Chimp pant-hoot** | Intro hoos 300–600 Hz; build-up exhales 200–500 Hz with noisy inhales, 5.3 ± 4.1 exhales; climax screams 800–2000 Hz (mean peak **1170 Hz**), **55 % with nonlinear phenomena**; falling let-down | Intro 3–4 hoos (450–550 Hz); build-up 5–7 voiced exhales (300 → 450 Hz) + **unvoiced inhales**, accelerating 3 → 6 pairs/s; climax 2–3 screams 900–1250 Hz, 55 % biphonation at 1.41·f0; let-down 2 falling hoos | f0 p10 333, median 502, p90 **1162 Hz**; visually matches the published phase structure (`chimp-pant-hoot.png`) | Convincing structure. Full call ~7 s, so start it early (beat sheet) |
| **Tetrapod** | No calls (acoustic communication evolved much later) | Exhale puff per push (bandpass 900 → 400 Hz, 0.25–0.45 s), belly-drag grains LP 5 kHz, drips (Minnaert f = 3.26 kHz·mm / r), gulp click + 70 Hz thump | Centroid 1.18 kHz | Right in kind |
| **Torch** (Farnell) | Crackles band-passed at 1500 + 500·decay(ms), Q 1; hiss HP 1 kHz × squared slow noise; lapping ~30 Hz clipped | Whoomph (bandpass 150 → 600 Hz, 0.8 s), then crackles at 10/s for 2 s settling to 2/s | Crackle band 1.5–16 kHz; lapping 20–100 Hz | Standard, works |

### 3.3 The water dance
**Physics.** It is driven by the **SAV**, not by the audible call.
- The body vibrates at 18–20 Hz. The water over it responds as **Faraday waves at half the drive,
  9–10 Hz**, with **λ ≈ 3 cm** (≈ ⅓ of the scute spacing, matching photos; Moriarty & Holt 2011).
- Crests pinch off droplets: **~5 cm** (McIlhenny 1935) to **~30 cm** (Vliet 1989) in alligators,
  ~75 cm in a 2.8 m caiman.
- The posture: head oblique, tail arched, back just awash.
- Capillary–gravity dispersion ω² = (gk + σk³/ρ)·tanh(kh). Check: a 19 Hz drive gives 9.5 Hz
  waves at λ 3.5 cm in deep water, 3.1 cm in a 6 mm film. A 29 Hz drive would give 1.6 cm.

**Visual** (`water-dance.js`, `lab-r2/beats-v1/dance-sav-crop.png`):
- A square Faraday glitter pattern at λ 3 cm around each planted foot, shimmering at 9.5 Hz.
- Droplets per foot: 110 slots, launch speed 0.4–2.4 m/s (apex 0.8–30 cm, most low). Each slot
  re-launches after its own flight time, so none is cut off mid-air. The density follows the SAV
  envelope.
- Each droplet is a backlit sun-coloured point with a 1/60 s motion streak.

It is additive over the HDR image. Screen-space bounded: **~+5 ms at 1080p** (measured, 13.9 ms
during the dance vs 8.0 ms booming without it).

**Sound:** the SAV sine plus droplet-rattle grains (in `theropodBoom`).

**Honesty note.** A theropod standing in swash making a water dance is an **extrapolation** from
crocodilians, and cassowaries do vibrate visibly. It is the most striking plausible image
available, and it is physically consistent. Label it as speculative in the credits if needed.

### 3.4 Footsteps (`footstep({m, v, ground, kind})`)
Physics scaling:
- Thump frequency f = 120·(m/60 kg)^(−1/3) Hz. Sand acts as a spring: stiffness ∝ contact radius ∝
  m^(1/3).
- Amplitude ∝ m^(2/3).
- Contact-noise centre 1700·(m/60)^(−0.25) Hz, about half the hard-floor centroid (3.1–3.8 kHz),
  because it's sand.
- Plantigrade heel → ball double hit ~100–150 ms apart.
- Wet sand: little crunch (cohesive), plus a **suction release** on lift (noise sweeping
  350 → 1600 Hz over 60 ms) and small bubble pops.

| Animal | Mass | Thump | Lab centroid | Relative level (vs human) |
|---|---|---|---|---|
| Salamander | 0.3 kg | — (sand swallows it) | 4.95 kHz | −40 dB |
| Monitor lizard | 6 kg | — | 3.66 kHz | −28 dB |
| Fox | 6 kg | — | 3.31 kHz | −25 dB |
| Chimp (knuckle) | 45 kg | 132 Hz | 2.13 kHz | −8 dB |
| Human | 55 kg | 124 Hz | 1.47 kHz | 0 dB |
| Theropod | 1500 kg | **41 Hz** (43.5 % in 20–100 Hz) | 0.52 kHz | **+10 dB** |

Every plant sound is **triggered by the gait clock's own plant times**, never by a beat
(`lab-mux.mjs` does exactly this).

### 3.5 Ambience
- **Surf** (`surf()`) is built as **wave events**:
  - Period lognormal around 8.5 s, with sets of ~7–12 waves.
  - Each wave: a break (pink + brown roar, **peak 300–500 Hz** (+5 dB at 450), 0.3–0.8 s attack),
    swash fizz (Minnaert bubble pops, 1–6 kHz), then a backwash hiss that drains back.
  - The break travels along the shore (a pan sweep). A far-surf bed keeps the high band alive
    between breaks.
  - Measured: 43.8 % of energy in 100–500 Hz (published: broad maximum at 300–500 Hz).
- **Wind:** Farnell's recipe. Gust fbm at 0.05–0.3 Hz drives the bandpass centre and level;
  faint whistles only when gusting.
- **Flock:** clustered Poisson bursts of gull "kyow"s (f0 0.9–1.6 kHz, 1.8/3.2 kHz formants), tern
  down-slurs (2.5–4 kHz) and wader up-sweeps, placed 60–200 m away with heavy air absorption.
- **Mix balance:** surf bed 60–65 dB(A) as reference; wind −10 dB; gulls −15 dB; theropod boom
  +10 dB in the low band. The ambient music pad should duck ~4–6 dB under the calls.

---

## 4. Timing: each animal on its own clock

- **Delete the grid.**
  - No footstep, call or behaviour time may be derived from `bt()`, `beatAt()` or `timeAtBeat()`.
  - The `T.footsteps` / call events should be **generated from each animal's gait clock and bout
    plan** (the audio engine reads them), not the other way round.
  - Keep steady rates away from 2, 4, 1 and 0.67 Hz (the 120 BPM family); the prototypes run
    2.6–2.7 Hz (fox) and 0.66–0.70 Hz (theropod strides).
- **Seeded irregularity** (all in `gait2.js` / `voices.js`; each animal gets its own seed, e.g.
  a hash of its name):
  1. **Speed plans** with seeded ±4–5 % keyframe variation; deceleration re-timed to a support
     phase.
  2. **Stride period:** 1/f-like fbm modulation, CV 2–3 % (Hausdorff), plus per-cycle placement
     jitter (1–3 % of leg length).
  3. **Pauses, bout gaps, burst lengths:** **lognormal** (median m, log-SD 0.25–0.5). Rest bouts
     are long-tailed.
  4. **Discrete events** (ear flicks, tail twitches, saccades, blinks): `eventTimes(seed, a, b,
     median, logSD, minGap)` renewal process. Gamma-like, never periodic.
  5. **Idle oscillators:** 2–3 incommensurate sines (ratios 1 : 1.618 : 2.414) or seeded fbm.
     Never a single sin(ωt).
  6. **Couple events to causes:** blinks to head turns, ear flicks to a pause, the torch catch to
     the raise.
- **Measured:**
  - Before: all 92 events **0.00 ms** off the 1/8-note grid.
  - After (27 events from the prototypes placed at their film times): mean offset **15.4 ms**,
    which is uniform (random would be 15.6 ms).
  - Theropod plant intervals 0.70 / 0.72 / 0.96 s. Boom onsets are 4.6 s apart, not 2.000.
- **Determinism:** 5 behaviour shots (walk, SAV + water dance, boom, fox, lizard) print IDENTICAL on
  the seek-and-return test, and all 19 WAVs are bit-identical across two renders.

---

## 5. API sketch for the builder

```js
import { makeGaitClock, eventTimes, pulses } from './ch6/lab/gait2.js';
import { makeTheropodBeat, makeFoxBeat, makeLizardBeat } from './ch6/lab/beats.js';
import { makeWaterDance } from './ch6/lab/water-dance.js';
import { theropodBoom, boomPlan, footstep, surf, wind, flock, foxBarks, pantHoot, lizardHiss,
         tetrapodHaulOut, torch, frogCall } from './ch6/lab/voices.js';   // audio: plain Float32Arrays
import { outdoor } from './ch6/lab/dsp.js';

// any animal: drive the existing gait engine with a clock (speed plan in world metres)
const clock = makeGaitClock({ plan: [[-2, 1.6], [0.9, 1.55], [1.25, 0], [60, 0]], h: 0.35, duty: 0.45,
                              offs: { LH: 0, RF: 0.02, RH: 0.5, LF: 0.52 }, seed: hash('fox'), fScale: 1.21 });
poseCreature('mammal', t, { clock, offs, duty: 0.45, hp, shH, neck, tail, head });   // P.clock hook
clock.tOfPhase(k - off)        // → exact plant times for footfall SFX (not a beat grid)

// the theropod centrepiece: pose + display state + footfalls + the bout plan shared with audio
const B = makeTheropodBeat({ k: 2, seed: 7 });           // local t = film t − 137.5
const s = B.at(tLocal);        // { pose, sav, savF, boom, vib, inflate, headDown, gulp, feet }
const dance = makeWaterDance(ctx, G);                     // after the creature pass, additive into HDR
dance.render(r, target, cam, { t: tLocal, amp: s.sav, f0: s.savF, feet: s.feet.map(f => [f.x*k, f.z*k]), H, radius: 1.3 });

// audio (engine init): precompute buffers exactly like ksData/makeIR, then schedule at event times
const boom = outdoor(48000, theropodBoom(48000, { seed: 7*7+1, plan: B.bout }), { distance: 15, hs: 1.8 });
B.falls   // [{t, foot}] → footstep({ m: 1500, kind: 'claw', ground: 'wet', seed }) at each t
```

Integration notes:
- **Local frames.** The beats work in walk-local metres like `march.js`: x forward, y up, the
  creature plane at z = 0. The theropod beat uses k = 2 and a hip of 2 m.
- **Species `head` overrides.** Fox ears, head pitch/yaw and the lizard tongue are passed through
  the builder's `head` / extra-primitive hooks. The throat sac is an extra primitive (`slot:
  'x:sac'`).
- **Teeth.** Remove the visible tooth row on a closed mouth: theropods most likely had lips
  (Cullen et al. 2023).
- **Theropod size.** The prototype shows an Allosaurus-class animal (6 m). For Coelophysis (3 m),
  use k = 1 with hip 1 m: strides ~1.0 Hz, 1.2–1.4 m/s.
- **Costs** (1080p, M4):

| Scene | ms/frame |
|---|---|
| Theropod walk | 10.7 |
| Theropod during the SAV + water dance | 13.9 (the dance adds ~5 ms) |
| Theropod booming | 8.0 |
| Fox | 4.0 |
| Lizard | 8.8 |

  Audio precompute: 10–230 ms per sound (a 23 s boom bout is 230 ms). Pose JS is under 0.1 ms.

---

## 6. Sources

Locomotion:
- **Scaling and gait families.** Alexander 1976/2006 (https://pmc.ncbi.nlm.nih.gov/articles/PMC1634776/); trackway speed equations (https://pmc.ncbi.nlm.nih.gov/articles/PMC7254686/); Usherwood & Self Davies 2017 on footfall families (https://pmc.ncbi.nlm.nih.gov/articles/PMC5599235/).
- **Human.** Demes et al. 2015, including the Orendurff human data (https://www.umass.edu/locomotion/pdfs/ajpa-2014.pdf); Kadaba 1990 (https://trama.deib.polimi.it/allegati/Kadaba_1990.pdf); Winter 1992 on toe clearance (https://pubmed.ncbi.nlm.nih.gov/1728048/); Hirasaki 1999 and Pozzo 1990 on head stabilisation (https://link.springer.com/article/10.1007/BF00230842); Pontzer 2009 on arm swing (https://journals.biologists.com/jeb/article/212/4/523/18953/).
- **Homo erectus.** Bennett 2009 (https://www.science.org/doi/10.1126/science.1168132); Dingwall 2013; Hatala 2016 (https://www.nature.com/articles/srep28766).
- **Early tetrapods and mudskippers.** Pace & Gibb 2009 (https://journals.biologists.com/jeb/article/212/14/2279/18314/); Pierce, Clack & Hutchinson 2012 (https://www.nature.com/articles/nature11124); McInroe 2016 (https://www.science.org/doi/10.1126/science.aaf0984); Kawano & Blob 2013 (https://academic.oup.com/icb/article/53/2/283/806410); Nyakatura 2019 on Orobates (https://www.nature.com/articles/s41586-018-0851-2).
- **Salamanders and lizards.** Ashley-Ross 1994 (https://users.wfu.edu/rossma/Ashley-Ross%20JEB%201994B.pdf) and 2009 (http://users.wfu.edu/rossma/NewtWalking.pdf); fire salamander (https://pmc.ncbi.nlm.nih.gov/articles/PMC7671131/); Frolich & Biewener 1992; iguana hip in vivo (https://pmc.ncbi.nlm.nih.gov/articles/PMC4089344/); Ritter 1992 (https://journals.biologists.com/jeb/article/173/1/1/736/); Farley & Ko 1997 (https://journals.biologists.com/jeb/article/200/16/2177/7607/); Varanus XROMM (https://pmc.ncbi.nlm.nih.gov/articles/PMC7217971/).
- **Theropods.** Gatesy et al. 1999 on 3D trackways (https://cs.brown.edu/courses/cs137/2017/readings/Gatesy_3DTracks_Nature99.pdf); Persons & Currie 2011 on the caudofemoralis (https://anatomypubs.onlinelibrary.wiley.com/doi/10.1002/ar.21290); Bishop et al. 2021 on tail swing (https://www.science.org/doi/10.1126/sciadv.abi7348); van Bijlert 2021 on T. rex walking (https://ui.adsabs.harvard.edu/abs/2021RSOS....801441V); Hutchinson & Garcia 2002 (https://www.nature.com/articles/4151018a); Bellatoripes trackways (https://en.wikipedia.org/wiki/Bellatoripes); Cullen et al. 2023 on theropod lips (Science, doi:10.1126/science.abo7877).
- **Birds.** Troje & Frost 2000 on head bobbing (https://www.biomotionlab.ca/Text/TrojeFrost00.pdf); Necker 2007.
- **Fox and dogs.** Heglund & Taylor 1988 (https://journals.biologists.com/jeb/article/138/1/301/5532/); Maes 2008 on dogs (https://journals.biologists.com/jeb/article/211/1/138/17472/); head timing in walking ungulates (https://royalsocietypublishing.org/rspb/article/283/1843/20161908/78334/).
- **Apes.** Pontzer 2014 (https://www.sciencedirect.com/science/article/pii/S0047248413002273); Finestone 2018 (https://onlinelibrary.wiley.com/doi/10.1002/ajpa.23397); D'Août 2004 (https://pmc.ncbi.nlm.nih.gov/articles/PMC1571309/); gorilla knuckle-walking (https://pmc.ncbi.nlm.nih.gov/articles/PMC12575676/).
- **Variability.** Hausdorff 1995 (https://journals.physiology.org/doi/abs/10.1152/jappl.1995.78.1.349); stride-time CV vs speed (https://pmc.ncbi.nlm.nih.gov/articles/PMC2731039/).
- **Procedural animation practice.** Spore, Hecker 2008 (https://www.chrishecker.com/images/c/cb/Sporeanim-siggraph08.pdf); Rosen, GDC 2014 (https://www.gdcvault.com/play/1020583/Animation-Bootcamp-An-Indie-Approach); Little Polygon (https://blog.littlepolygon.com/posts/loco1/).

Behaviour:
- **Intermittent locomotion.** Kramer & McLaughlin 2001 (https://bioone.org/journals/american-zoologist/volume-41/issue-2/0003-1569(2001)041%5B0137:TBEOIL%5D2.0.CO;2/); Avery 1987 (https://zslpublications.onlinelibrary.wiley.com/doi/abs/10.1111/j.1469-7998.1987.tb07452.x).
- **Displays and breathing.** Mack & Jones 2003 on cassowaries (https://pngibr.com/wp-content/uploads/2025/02/2003-Mack-Auk.pdf); ostrich (https://pmc.ncbi.nlm.nih.gov/articles/PMC10941561/); Stahl breathing allometry via Fahlman 2025 (https://pmc.ncbi.nlm.nih.gov/articles/PMC12400827/).
- **Chimpanzee.** Pant-hoot phases (https://pmc.ncbi.nlm.nih.gov/articles/PMC5674848/); display tempo (https://pmc.ncbi.nlm.nih.gov/articles/PMC11614530/); Hunt's bipedal bouts via Frontiers 2024 (https://www.frontiersin.org/journals/ecology-and-evolution/articles/10.3389/fevo.2024.1321115/full).
- **Fox senses.** Ears and pounce (https://www.wildlifeonline.me.uk/animals/article/red-fox-senses).
- **Audio–visual binding.** PMC6711538 (https://pmc.ncbi.nlm.nih.gov/articles/PMC6711538/).
- **Practitioners.** vfxblog on Tippett (https://vfxblog.com/dinosaurinputdevice/); befores & afters on Prehistoric Planet (https://beforesandafters.com/2022/06/08/those-close-ups-are-where-it-all-lives-and-breathes/); postPerspective (https://postperspective.com/combining-wildlife-footage-and-vfx-for-apples-prehistoric-planet/); Framestore (https://www.framestore.com/work/prehistoric-planet-ice-age); Benton, The Science of Walking with Dinosaurs (https://cpb-eu-w2.wpmucdn.com/blogs.bristol.ac.uk/dist/5/537/files/2019/08/2003scienceWWD.pdf).

Acoustics:
- **Closed-mouth calling and dinosaur voices.** Riede et al. 2016 (https://celiason.github.io/pdfs/coos.pdf); Clarke et al. 2016 (https://www.nature.com/articles/nature19852); Yoshida et al. 2023 (https://www.nature.com/articles/s42003-023-04513-x); Senter 2008 (https://www.tandfonline.com/doi/full/10.1080/08912960903033327).
- **Crocodilians.** Reber et al. 2015 (https://pmc.ncbi.nlm.nih.gov/articles/PMC4528706/) and 2017 (https://pmc.ncbi.nlm.nih.gov/articles/PMC5431764/); crocodylian meta-analysis (https://pmc.ncbi.nlm.nih.gov/articles/PMC12828176/); Todd 2007 (https://pubmed.ncbi.nlm.nih.gov/18189580/); Moriarty & Holt via ScienceNews (https://www.sciencenews.org/article/gators-go-courtin-fancy-physics); caiman water dance (https://www.biotaxa.org/hn/article/download/10993/14651).
- **Booming birds.** Capercaillie (https://pmc.ncbi.nlm.nih.gov/articles/PMC7353911/); Riede et al. 2004 on doves (https://doi.org/10.1242/jeb.01256).
- **Nonlinear phenomena and voice measures.** Fitch, Neubauer & Herzel 2002 (https://www.sciencedirect.com/science/article/abs/pii/S0003347201919128); Riede, Arcadi & Owren 2007 (https://pubmed.ncbi.nlm.nih.gov/17407912/); Praat on jitter and shimmer (https://www.fon.hum.uva.nl/praat/manual/Voice_2__Jitter.html).
- **Other calls.** Desai 2022 on pant-hoots (https://pmc.ncbi.nlm.nih.gov/articles/PMC9786991/); chorus timing (https://pmc.ncbi.nlm.nih.gov/articles/PMC12699367/); bullfrog (https://pmc.ncbi.nlm.nih.gov/articles/PMC1201406/, https://pmc.ncbi.nlm.nih.gov/articles/PMC9667906/); red fox, Newton-Fisher 1993 (https://bioacoustics.info/article/structure-and-function-red-fox-vulpes-vulpes-vocalisations); hissing review 2025 (https://pmc.ncbi.nlm.nih.gov/articles/PMC12585882/); Chen & Wiens 2020 on the origins of acoustic communication (https://pmc.ncbi.nlm.nih.gov/articles/PMC6969000/).
- **Sound design and ambience.** Farnell, *Designing Sound*: footsteps, wind, birds, fire (https://aspress.co.uk/sd/practical26.html, practical18, practical28, practical11); Bolin & Åbom 2010 on surf noise (https://pubmed.ncbi.nlm.nih.gov/21117726/); Minnaert resonance; dinosaur sound design, Twenty Thousand Hertz (https://www.20k.org/episodes/tyrannosaurusfx) and A Sound Effect on Prehistoric Planet (https://www.asoundeffect.com/prehistoric-planet-ice-age-sound/).

**Gaps:**
- Paywalled: alligator bout timing (Vliet 1989); Pontzer 2014, Bishop 2021 and van Bijlert 2021
  (numbers from abstracts and excerpts).
- Estimates: fox syllable timing and chimp phase durations. The airborne surf peak comes from
  figure axes.
- The Coelophysis bone lengths were checked only via a search summary (they suggest a smaller
  hip than 1 m).
