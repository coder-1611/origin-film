// Master the raw score: fold the tail onto the start (loop), glue compression, loudness to
// −14 LUFS (BS.1770, gated), 4×-oversampled lookahead true-peak limiting at −1.5 dBTP.
// All dynamics run circularly so the loop point stays continuous.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './lib/serve.mjs';
import { readF32, writeWavF32, integratedLoudness, truePeakDb, glueCompress, tpLimit } from './lib/dsp.mjs';
const T = await import(path.join(ROOT, 'src/timeline.js'));

const SR = 48000, DUR = T.DURATION, TARGET = -14, CEIL = -1.5;
const raw = readF32(path.join(ROOT, 'renders/score-raw.f32'));
const n = DUR * SR;
let x = new Float32Array(n * 2);
x.set(raw.subarray(0, n * 2));
for (let i = n * 2; i < raw.length; i++) x[i - n * 2] += raw[i];           // fold the tail (past the end) onto the start
console.log('raw   LUFS', integratedLoudness(x).toFixed(2), ' TP', truePeakDb(x).toFixed(2), 'dBTP');

x = glueCompress(x, SR, { threshold: -20, ratio: 2.2, attack: 0.025, release: 0.3 });
let gainDb = TARGET - integratedLoudness(x);
let y;
for (let it = 0; it < 4; it++) {
  const g = Math.pow(10, gainDb / 20);
  const z = new Float32Array(x.length); for (let i = 0; i < x.length; i++) z[i] = x[i] * g;
  y = tpLimit(z, SR, { ceilingDb: CEIL });
  const lufs = integratedLoudness(y);
  console.log(`pass ${it}: gain ${gainDb.toFixed(2)} dB → ${lufs.toFixed(2)} LUFS`);
  if (Math.abs(lufs - TARGET) < 0.05) break;
  gainDb += TARGET - lufs;
}
const lufs = integratedLoudness(y), tp = truePeakDb(y);
// Wrap-point continuity: jump between the last and first sample vs the typical step size.
let steps = []; for (let i = 2; i < y.length; i += 2) steps.push(Math.abs(y[i] - y[i - 2]));
steps.sort((a, b) => a - b);
const wrapJump = Math.max(Math.abs(y[0] - y[y.length - 2]), Math.abs(y[1] - y[y.length - 1]));
writeWavF32(path.join(ROOT, 'renders/score.wav'), y, SR);
const report = { lufs: +lufs.toFixed(2), truePeakDbtp: +tp.toFixed(2), gainDb: +gainDb.toFixed(2), wrapJump, p99Step: steps[Math.floor(steps.length * 0.99)], medianStep: steps[steps.length >> 1] };
fs.writeFileSync(path.join(ROOT, 'renders/master.json'), JSON.stringify(report, null, 2));
console.log('master', JSON.stringify(report));
