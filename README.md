# ORIGIN

**13.8 billion years in one unbroken camera move**, from the Big Bang to a person typing the
prompt that made this film. It runs 3 minutes at 1920×1080 and 60 fps. It is written entirely in
HTML, JS and GLSL, and its score is synthesised in code. There are no video frameworks, no stock
anything and no samples. Its last frame is its first, so it loops forever.

| | |
|---|---|
| Film | `renders/origin.mp4` (rendered locally, gitignored; `npm run render`) |
| Live player | `npm run serve` → http://127.0.0.1:8080/ plays the same code in real time with live Web Audio |
| Storyboard | [STORYBOARD.md](STORYBOARD.md) |
| Score | [SCORE.md](SCORE.md) |
| How it was made | [MAKING-OF.md](MAKING-OF.md) |
| Measured verification | [docs/VERIFICATION.md](docs/VERIFICATION.md) (loudness, sync table, loop seam, cut detection) |
| Contact sheet | [docs/contact-sheet.jpg](docs/contact-sheet.jpg) |

## Pipeline

```
npm install
npm run audio     # score → OfflineAudioContext (Chrome) → master (−14 LUFS, −1.5 dBTP) → per-frame features
npm run draft     # 960×540 @ 30 fps preview → renders/origin-draft.mp4
npm run render    # 1920×1080 @ 60 fps, 4 GPU workers, resumable → renders/origin.mp4
npm run verify    # measures the delivered MP4 → docs/VERIFICATION.md
npm run snap -- --t 12.5,69.4 --w 960 --h 540   # any frame(s) to images
```

`src/timeline.js` is the single source of truth for tempo, harmony, every note and SFX cue,
every picture event, every camera keyframe and the HUD clock. The score (`src/audio/`) and the
picture (`src/engine/`, `src/chapters/`) both read it.
