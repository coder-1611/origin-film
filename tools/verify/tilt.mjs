// Long-term average spectrum in octave bands (dB relative to the 1 kHz octave), per section.
import path from 'node:path';
import { ROOT } from '../lib/serve.mjs';
import { readWav, fft } from '../lib/dsp.mjs';
const { inter, sr } = readWav(process.argv[2] || path.join(ROOT, 'renders/score.wav'));
const n = inter.length / 2, N = 8192;
const oct = [31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
const secs = [['I', 0, 10.5], ['II', 12, 32], ['III', 32, 58], ['IV', 58, 82], ['V', 82, 106], ['VI', 106, 134], ['VII', 134, 160], ['VIII', 160, 180], ['ALL', 0, 180]];
for (const [name, a, b] of secs) {
  const acc = new Float64Array(N / 2); let cnt = 0;
  for (let s = Math.floor(a * sr); s + N < Math.floor(b * sr); s += N) {
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < N; i++) re[i] = 0.5 * (inter[2 * (s + i)] + inter[2 * (s + i) + 1]) * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1)));
    fft(re, im); for (let k = 0; k < N / 2; k++) acc[k] += re[k] * re[k] + im[k] * im[k]; cnt++;
  }
  const e = oct.map(fc => { let s = 0; for (let k = 1; k < N / 2; k++) { const f = k * sr / N; if (f >= fc / Math.SQRT2 && f < fc * Math.SQRT2) s += acc[k]; } return 10 * Math.log10(s / cnt + 1e-20); });
  const ref = e[5];
  console.log(name.padEnd(5), oct.map((f, i) => `${f >= 1000 ? f / 1000 + 'k' : f}:${(e[i] - ref).toFixed(0).padStart(4)}`).join(' '));
}
