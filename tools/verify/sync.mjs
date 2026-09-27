// Sync proof: for every kick in timeline.js, find (a) the kick's onset in the DELIVERED audio and
// (b) the visual exposure pulse in the DELIVERED video (largest frame-to-frame luminance rise near
// the kick), and print the table. Pass = the pulse lands on the first frame at/after the kick
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
// Audio: low-band (35–160 Hz) envelope at 1 ms resolution.
const SR = 48000, A = await decodeAudio(file, SR), n = A.length / 2;
const lp = (x, fc) => { const a = Math.exp(-2 * Math.PI * fc / SR); const y = new Float64Array(x.length); let s = 0; for (let i = 0; i < x.length; i++) { s = a * s + (1 - a) * x[i]; y[i] = s; } return y; };
const mono = new Float64Array(n); for (let i = 0; i < n; i++) mono[i] = 0.5 * (A[2 * i] + A[2 * i + 1]);
const band = (() => { const l1 = lp(mono, 160), l2 = lp(mono, 35); const y = new Float64Array(n); for (let i = 0; i < n; i++) y[i] = l1[i] - l2[i]; return y; })();
const hop = SR / 1000, env = new Float64Array(Math.floor(n / hop));
for (let j = 0; j < env.length; j++) { let m = 0; for (let i = j * hop; i < (j + 1) * hop; i++) m = Math.max(m, Math.abs(band[i])); env[j] = m; }
function audioOnset(tk) {
  // Onset = first ms where the low-band envelope rises past 50 % of its peak in [tk-20ms, tk+60ms],
  // measured from the pre-hit floor.
  const a = Math.max(0, Math.round((tk - 0.02) * 1000)), b = Math.min(env.length - 1, Math.round((tk + 0.06) * 1000));
  let pk = 0, pki = a; for (let j = a; j <= b; j++) if (env[j] > pk) { pk = env[j]; pki = j; }
  let floor = Infinity; for (let j = a; j <= pki; j++) floor = Math.min(floor, env[j]);
  const thr = floor + 0.5 * (pk - floor);
  let j = a; while (j < pki && env[j] < thr) j++;
  // walk back to the start of the rise
  while (j > a && env[j - 1] < env[j] && env[j - 1] > floor + 0.1 * (pk - floor)) j--;
  return j / 1000;
}
const rows = []; let pass = 0;
for (const tk of T.kicks) {
  if (tk >= T.DURATION) continue;
  const n0 = Math.ceil(tk * fps - 1e-6);
  let best = -Infinity, bi = n0;
  for (let i = Math.max(1, n0 - 3); i <= Math.min(V.n - 1, n0 + 3); i++) { const d = luma[i] - luma[i - 1]; if (d > best) { best = d; bi = i; } }
  const ao = audioOnset(tk);
  const dFrameKick = bi - n0, dFrameAudio = (bi / fps - ao) * fps;
  const ok = Math.abs(dFrameKick) <= 1 && dFrameAudio > -1 && dFrameAudio < 2 && best > 0;
  if (ok) pass++;
  const bb = T.barBeat(tk + 1e-6);
  rows.push({ bar: bb.free ? '—' : `${bb.bar}:${bb.beat.toFixed(2)}`, t: tk, audio: ao, frame: bi, dKick: dFrameKick, dAudio: dFrameAudio, dl: best, ok });
}
const lines = ['| # | bar:beat | kick t (timeline) | audio onset (measured) | Δ audio | pulse frame (measured) | Δ vs kick frame | Δ vs audio (frames) | Δluma | ok |', '|---|---|---|---|---|---|---|---|---|---|'];
rows.forEach((r, i) => lines.push(`| ${i + 1} | ${r.bar} | ${r.t.toFixed(4)} | ${r.audio.toFixed(3)} | ${((r.audio - r.t) * 1000).toFixed(0)} ms | ${r.frame} | ${r.dKick >= 0 ? '+' : ''}${r.dKick} | ${r.dAudio.toFixed(2)} | ${r.dl.toFixed(2)} | ${r.ok ? '✓' : '✗'} |`));
const summary = `${pass}/${rows.length} kicks: visual pulse within ±1 frame of the kick frame and of the measured audio onset (video ${fps} fps, ${V.n} frames).`;
fs.writeFileSync(path.join(ROOT, 'tools/verify/out/sync-table.md'), summary + '\n\n' + lines.join('\n') + '\n');
console.log(lines.slice(0, 2).concat(lines.slice(2).filter((_, i) => i < 12 || !rows[i].ok)).join('\n'));
console.log('…\n' + summary);
