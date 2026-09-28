# ORIGIN — Score

Every sound is synthesised in code: oscillators, noise, filters, envelopes, Karplus-Strong
buffers and a procedurally generated convolution impulse response. There are no samples.
The score is data in `src/timeline.js`. `src/audio/engine.js` turns that data into a
Web Audio graph, rendered offline (`OfflineAudioContext`, 48 kHz stereo) for the film or
scheduled live for the player.

## Form

| Section | Bars | Time | Key / tempo | Texture |
|---|---|---|---|---|
| I · Singularity | — | 0–12 | D, free | Sub-bass drone (D1+A1+D2), leitmotif on pure sine, riser 7.0–10.5, **digital silence 10.5–12.0** |
| II · Inflation | 1–7 | 12–32 | D minor, 84 | IMPACT on 1.1, supersaw choir pad, sub bass, half-time drums (kick 1 & 3, snare 3) from bar 2 |
| III · First Light | 8–17 | 32–58 | D minor, 84→101.5 | Pads, FM-bell star births, leitmotif on bells (12–13), riser + kick on every beat in bar 17 |
| IV · Accretion | 18–28 | 58–81.99 | D minor → pivot, 101.5→118.6 | Drums in, arpeggiated plucks, riser bar 22, **Theia IMPACT 23.1**, ring/moon pads, C (V of F) in 27–28 |
| V · Pale Blue | 29–40 | 81.99–106 | **F major**, 118.6→120 | Open pads, Karplus-Strong arpeggios, soft kick 33–38, whoosh 37, splash 39.1, bubbles |
| VI · Life | 41–64 | 106–154 | F major, 120 | Marimba ostinato + leitmotif, cell-division pops, soft four-on-the-floor from 45, hats; from 128 the groove gives way to a string bed and the shore's own sound: surf, wind, flock, and synthesised animals on their own clocks; the torch |
| VII · Fire to Fiber | 65–77 | 154–180 | F major, 120 | Full drums, sub bass, **supersaw lead leitmotif**, crackle, clanks, hiss, arc zaps |
| VIII · The Prompt | 78–84 | 180–196 | → D minor, 120 → rit. → 60 | Typing: keyclicks accelerating into a granular riser; Enter 82.1; leitmotif on piano-pluck |
| (coda) | — | 196–200 | D, free | Drone returns; final E→D resolution; loops to 0:00 |

## Tempo map (exact, in `timeline.tempo`)

```
 0.0000 – 12.0000   free time (no grid)
12.0000 – 33.3509   84 BPM
33.3509 – 83.9824   linear accelerando 84 → 120 BPM
83.9824 – 188.0000  120 BPM
188.0000 – 196.0000 linear ritardando 120 → 60 BPM
196.0000 – 200.0000 free time
```
The breakpoints were solved numerically so that bars 18, 29 and 41 land on 58.000 s,
81.988 s and 106.000 s.

## Harmony (one chord per bar)

```
II   1 Dm   2 Dm   3 Bb   4 F    5 C    6 Gm   7 A7sus4→A
III  8 Dm9  9 Dm  10 Bbmaj7 11 Bb 12 Gm9 13 Gm 14 Dm/F 15 Bb 16 C 17 A
IV  18 Dm  19 Dm  20 Bb  21 C   22 A   23 Dm  24 Bb  25 Gm  26 Dm  27 C  28 C7
V   29 F   30 C/E 31 Dm  32 Bb  33 F   34 C   35 Bb  36 Bb  37 Gm  38 C  39 F  40 F
VI  41 F   42 Am  43 Bb  44 C   45 F   46 Am  47 Bb  48 C   49 Dm  50 Bb  51 F   52 C
    53 Dm  54 Bb  55 F   56 C   57 Dm  58 Bb  59 F   60 C   61 Dm  62 Gm  63 Bb  64 C
VII 65 F   66 C   67 Dm  68 Bb  69 F   70 C   71 Bb  72 C   73 Dm  74 Bb 75 F/A 76 Gm 77 C
VIII 78 Bb 79 Gm  80 Bb  81 A   82 Dm  83 Bb  84 Gm→A   (196) D
```

## Leitmotif

Five notes, scale degrees **1 5 4 3 2** with the rhythm long, short, short, short, long,
unresolved on purpose. It resolves only once, on the last note of the film (E → D at 196 s),
which is also the first sound of the loop.

| Statement | Where | Pitches | Voice |
|---|---|---|---|
| 1 | I, 3.0–7.0 s (free) | D4 A4 G4 F4 E4 | pure sine, long reverb; each note reveals a title glyph |
| 2 | III bars 12–13 | D5 A5 G5 F5 E5 | FM bells (ratio 3.5, index decays) |
| 3 | VI bars 45–48 (×2), and again at 59 as the mammals arrive | F4 C5 Bb4 A4 G4 | marimba (modal, 3 partials) |
| 4 | VII bars 65–72 (×2 + answer) | F4 C5 Bb4 A4 G4 | supersaw lead, harmonised in 3rds on the repeat |
| 5 | VIII bars 82–84 → 196 | D4 A4 G4 F4 E4 → **D4** | Karplus-Strong piano-like pluck, ritardando |

## Instruments (all in `src/audio/engine.js`)

* **Drone:** additive sines, each rounded to a whole number of cycles over the film (D1 ≈ 36.71 Hz), with
  amplitude LFOs also on whole cycles, so the drone is exactly periodic over the film.
* **Sine lead:** a sine plus a gentle vibrato and long reverb send.
* **FM bell:** carrier + modulator (ratio 3.5), decaying modulation index. It plays star births and the motif.
* **Supersaw:** 7 detuned saws → lowpass with an envelope, used for the pad (slow attack) and the lead.
* **Sub bass:** sine + triangle through a waveshaper for mild saturation.
* **Kick:** a sine with a pitch sweep 150 → 45 Hz and a noise click. **Snare:** bandpassed noise plus a
  185 Hz body. **Hats:** highpassed noise, closed and open.
* **Karplus-Strong:** JS-generated buffers, deterministic excitation from a seeded PRNG. Used for V's
  arpeggios and VIII's piano-pluck (brighter excitation plus two slightly inharmonic sine partials).
* **Marimba:** modal synthesis (partials 1, 3.99, 10.7, with fast upper decay) plus a mallet noise tick.
* **Riser:** a noise bandpass sweep plus rising detuned saws plus a swell. **Impact:** a sub drop (90 → 28 Hz), a
  lowpassed noise burst and a long reverb send.
* **SFX:** whoosh (a swept, panned noise band), bubble chirps, cell pops, fire crackle (a granular
  noise-grain stream), metallic FM clanks, steam hiss, arc zaps (sine chirps with FM),
  keyclicks (bandpassed noise tick plus a 200 Hz thock, gain ∝ 1/√rate).
* **The shore (VI, 128–151 s):** the groove stops. A slow string ensemble (narrow detune, 1.8 s bow
  attack) holds the harmony, and the sound of the place comes forward. It is all synthesised from
  the research in `docs/research/animal-realism.md` (`src/audio/nature/`) and scheduled from each
  animal's own clock (`timeline.march.events`), so nothing lands on the beat:
  - **Ambience:** surf as individual waves (lognormal ~8.5 s periods with sets, the break peaking
    at 300–500 Hz, swash fizz and backwash), gusting wind, and a distant gull and tern flock.
  - **Footsteps:** each scaled by mass (thump ∝ m^−1/3 in frequency, m^2/3 in level) and placed
    outdoors by distance, with air absorption and a ground reflection.
  - **The theropod's closed-mouth boom:** f0 ≈ 33 Hz, 91 % of its energy at 20–100 Hz, after
    gulps, an inhale and a sub-audible vibration, modelled on the cassowary and the crocodilian.
  - **The rest of the cast:** the tetrapod's haul-out, the lizard's hiss, a distant fox's barks,
    and the chimp's pant-hoot build and climax.
  - **Ducking:** the music ducks 5 dB under the calls.

  The torch catches with a whoomph and a crackle that hands over to VII's fire.

## Mix

* **Buses:** music, drums, SFX, reverb send.
* **Sidechain:** every kick in `timeline` writes a duck envelope (−7 dB, 150 ms release) onto the music
  bus gain. The duck is driven by the same kick events as the drum and the visual pulse.
* **Reverb:** a `ConvolverNode` whose IR is generated from seeded stereo noise, with an exponential decay
  (RT60 4.2 s), early reflections, and a progressive lowpass so the tail darkens.
* **Pan:** each positioned SFX pans by its on-screen x (`event.x ∈ [-1, 1]`, equal-power). Star
  births, arcs, crackles, keyclicks, whooshes and bubbles all carry x.
* **Master (in-graph):** a glue compressor (−18 dB, 2.5:1, 20 ms / 250 ms) → a peak limiter.
* **Mastering (offline, `tools/master.mjs`):** measure integrated loudness (BS.1770 / EBU R128,
  gated), apply a gain to reach −14 LUFS, then a 4× oversampled lookahead true-peak limiter at
  −2.0 dBTP (1 dB of margin: the AAC encode overshoots by up to ~0.6 dB). The result is verified with `ffmpeg -af ebur128=peak=true`.

## Loop

Rendering runs to 206 s, and the tail past 200 s is folded (added) back onto the start, so reverb
and the limiter see the wrap as continuous. The drone is exactly periodic over the film's 200 s. The last 4 s are
drone plus the resolving pluck, so the fold is gentle.
