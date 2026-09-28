// Sync proof: for every kick in timeline.js, find (a) the kick's onset in the DELIVERED audio and
// (b) the visual exposure pulse in the DELIVERED video (the largest luminance impulse near the
// kick: each frame's mean luma minus the linear trend of the two frames before it), and print
// the table. Pass = the pulse lands on the first frame at/after the kick
// (±1 frame) and within ±1 frame of the measured audio onset.
import path from 'node:path';
import fs from 'node:fs';
import { ROOT } from '../lib/serve.mjs';
import { decodeAudio } from '../lib/dsp.mjs';
import { decodeFrames, probeFps } from './lib.mjs';
const T = await import(path.join(ROOT, 'src/timeline.js'));
const file = process.argv[2] || path.join(ROOT, 'renders/origin.mp4');
const { fps } = probeFps(file);
const V = decodeFrames(file, 160, 90, 'gray');
const luma = new Float64Array(V.n);
for (let i = 0; i < V.n; i++) { const f = V.frame(i); let s = 0; for (let k = 0; k < f.length; k++) s += f[k]; luma[i] = s / f.length; }
// Audio onset by matched filter: the kick is synthesised (src/audio/engine.js i_kick: a sine
// sweeping 160→52 Hz in 55 ms, then →44 Hz), so its waveform is known. Cross-correlate that
// template against the DELIVERED audio (mono, low-passed, decimated to 8 kHz) at lags within
// ±40 ms of each timeline kick; the best-aligned lag is the measured onset.
const SR = 48000, A = await decodeAudio(file, SR), n = A.length / 2;
const DEC = 6, SR2 = SR / DEC;                                  // 8 kHz
const lpA = Math.exp(-2 * Math.PI * 400 / SR);
const x = new Float64Array(Math.floor(n / DEC));
{ let s1 = 0, s2 = 0; for (let i = 0; i < n; i++) { const v = 0.5 * (A[2 * i] + A[2 * i + 1]); s1 = lpA * s1 + (1 - lpA) * v; s2 = lpA * s2 + (1 - lpA) * s1; if (i % DEC === 0 && i / DEC < x.length) x[i / DEC] = s2; } }
const TL = Math.round(0.12 * SR2), tpl = new Float64Array(TL);
{ let ph = 0; for (let i = 0; i < TL; i++) {
    const t = i / SR2;
    const f = t < 0.055 ? 160 * Math.pow(52 / 160, t / 0.055) : 52 * Math.pow(44 / 52, Math.min(1, (t - 0.055) / 0.345));
    ph += 2 * Math.PI * f / SR2;
    const amp = t < 0.002 ? t / 0.002 : (t < 0.03 ? 1 : Math.exp(-(t - 0.03) / 0.09));
    tpl[i] = Math.sin(ph) * amp;
  } }
let tn = 0; for (const v of tpl) tn += v * v; tn = Math.sqrt(tn);
function audioOnset(tk) {
  const c = Math.round(tk * SR2), L = Math.round(0.04 * SR2);
  let best = -Infinity, bl = 0;
  for (let lag = -L; lag <= L; lag++) {
    const s0 = c + lag; if (s0 < 0 || s0 + TL >= x.length) continue;
    let dot = 0, e = 0; for (let i = 0; i < TL; i++) { dot += x[s0 + i] * tpl[i]; e += x[s0 + i] * x[s0 + i]; }
    const ncc = dot / (Math.sqrt(e) * tn + 1e-12);
    if (ncc > best) { best = ncc; bl = lag; }
  }
  return (c + bl) / SR2;
}
const rows = []; let pass = 0;
for (const tk of T.kicks) {
  if (tk >= T.DURATION) continue;
  const n0 = Math.ceil(tk * fps - 1e-6);
  // Impulse detector: residual of each frame against the linear trend of the two before it
  // (second difference), so smooth brightness ramps (dives, fades, draw-ons) cancel out.
  let best = -Infinity, bi = n0;
  for (let i = Math.max(2, n0 - 3); i <= Math.min(V.n - 1, n0 + 3); i++) { const d = luma[i] - (2 * luma[i - 1] - luma[i - 2]); if (d > best) { best = d; bi = i; } }
  const ao = audioOnset(tk);
  const dFrameKick = bi - n0, dFrameAudio = (bi / fps - ao) * fps;
  const ok = Math.abs(dFrameKick) <= 1 && dFrameAudio > -1 && dFrameAudio < 2 && best > 0;
  if (ok) pass++;
  const bb = T.barBeat(tk + 1e-6);
  rows.push({ bar: bb.free ? '—' : `${bb.bar}:${bb.beat.toFixed(2)}`, t: tk, audio: ao, frame: bi, dKick: dFrameKick, dAudio: dFrameAudio, dl: best, ok });
}
const lines = ['| # | bar:beat | kick t (timeline) | audio onset (measured) | Δ audio | pulse frame (measured) | Δ vs kick frame | Δ vs audio (frames) | impulse (luma) | ok |', '|---|---|---|---|---|---|---|---|---|---|'];
rows.forEach((r, i) => lines.push(`| ${i + 1} | ${r.bar} | ${r.t.toFixed(4)} | ${r.audio.toFixed(3)} | ${((r.audio - r.t) * 1000).toFixed(0)} ms | ${r.frame} | ${r.dKick >= 0 ? '+' : ''}${r.dKick} | ${r.dAudio.toFixed(2)} | ${r.dl.toFixed(2)} | ${r.ok ? '✓' : '✗'} |`));
const summary = `${pass}/${rows.length} kicks: visual pulse within ±1 frame of the kick frame and of the measured audio onset (video ${fps} fps, ${V.n} frames).`;
fs.writeFileSync(path.join(ROOT, 'tools/verify/out/sync-table.md'), summary + '\n\n' + lines.join('\n') + '\n');
console.log(lines.slice(0, 2).concat(lines.slice(2).filter((_, i) => i < 12 || !rows[i].ok)).join('\n'));
console.log('…\n' + summary);
