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
| VI · Life | 41–54 | 106–134 | F major, 120 | Marimba ostinato + leitmotif, cell-division pops, soft four-on-the-floor from 45, hats |
| VII · Fire to Fiber | 55–67 | 134–160 | F major, 120 | Full drums, sub bass, **supersaw lead leitmotif**, crackle, clanks, hiss, arc zaps |
| VIII · The Prompt | 68–74 | 160–176 | → D minor, 120 → rit. → 60 | Typing: keyclicks accelerating into a granular riser; Enter 72.1; leitmotif on piano-pluck |
| (coda) | — | 176–180 | D, free | Drone returns; final E→D resolution; loops to 0:00 |

## Tempo map (exact, in `timeline.tempo`)

```
 0.0000 – 12.0000   free time (no grid)
12.0000 – 33.3509   84 BPM
33.3509 – 83.9824   linear accelerando 84 → 120 BPM
83.9824 – 168.0000  120 BPM
168.0000 – 176.0000 linear ritardando 120 → 60 BPM
176.0000 – 180.0000 free time
```
The breakpoints were solved numerically so that bars 18, 29 and 41 land on 58.000 s,
81.988 s and 106.000 s.

## Harmony (one chord per bar)

```
II   1 Dm   2 Dm   3 Bb   4 F    5 C    6 Gm   7 A7sus4→A
III  8 Dm9  9 Dm  10 Bbmaj7 11 Bb 12 Gm9 13 Gm 14 Dm/F 15 Bb 16 C 17 A
IV  18 Dm  19 Dm  20 Bb  21 C   22 A   23 Dm  24 Bb  25 Gm  26 Dm  27 C  28 C7
V   29 F   30 C/E 31 Dm  32 Bb  33 F   34 C   35 Bb  36 Bb  37 Gm  38 C  39 F  40 F
VI  41 F   42 Am  43 Bb  44 C   45 F   46 Am  47 Bb  48 C   49 Dm  50 Bb 51 F 52 C 53 Bb 54 C
VII 55 F   56 C   57 Dm  58 Bb  59 F   60 C   61 Bb  62 C   63 Dm  64 Bb 65 F/A 66 Gm 67 C
VIII 68 Bb 69 Gm  70 Bb  71 A   72 Dm  73 Bb  74 Gm→A   (176) D
```

## Leitmotif

Five notes, scale degrees **1 5 4 3 2** with the rhythm long, short, short, short, long,
unresolved on purpose. It resolves only once, on the last note of the film (E → D at 176 s),
which is also the first sound of the loop.

| Statement | Where | Pitches | Voice |
|---|---|---|---|
| 1 | I, 3.0–7.0 s (free) | D4 A4 G4 F4 E4 | pure sine, long reverb; each note reveals a title glyph |
| 2 | III bars 12–13 | D5 A5 G5 F5 E5 | FM bells (ratio 3.5, index decays) |
| 3 | VI bars 45–48 (×2) | F4 C5 Bb4 A4 G4 | marimba (modal, 3 partials) |
| 4 | VII bars 55–62 (×2 + answer) | F4 C5 Bb4 A4 G4 | supersaw lead, harmonised in 3rds on the repeat |
| 5 | VIII bars 72–74 → 176 | D4 A4 G4 F4 E4 → **D4** | Karplus-Strong piano-like pluck, ritardando |

## Instruments (all in `src/audio/engine.js`)

* **Drone:** additive sines whose frequencies are multiples of 1/180 Hz (D1 ≈ 36.711 Hz), with
  amplitude LFOs also on 1/180 Hz multiples, so the drone is exactly periodic over the film.
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
  −1.5 dBTP (0.5 dB of margin for the AAC encode). The result is verified with `ffmpeg -af ebur128=peak=true`.

## Loop

Rendering runs to 186 s, and the tail past 180 s is folded (added) back onto the start, so reverb
and the limiter see the wrap as continuous. The drone is exactly 180 s-periodic. The last 4 s are
drone plus the resolving pluck, so the fold is gentle.
