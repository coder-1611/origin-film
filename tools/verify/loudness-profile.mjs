// Momentary loudness (400 ms, K-weighted) every second + a check that 10.5–12.0 is silent.
import path from 'node:path';
import { ROOT } from '../lib/serve.mjs';
import { readWav } from '../lib/dsp.mjs';
const file = process.argv[2] || path.join(ROOT, 'renders/score.wav');
const { inter, sr } = readWav(file);
const n = inter.length / 2;
function biquad(x, b, a) { const y = new Float64Array(x.length); let x1 = 0, x2 = 0, y1 = 0, y2 = 0; for (let i = 0; i < x.length; i++) { const v = b[0] * x[i] + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2; x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v; } return y; }
const kw = (x) => biquad(biquad(x, [1.53512485958697, -2.69169618940638, 1.19839281085285], [1, -1.69065929318241, 0.73248077421585]), [1, -2, 1], [1, -1.99004745483398, 0.99007225036621]);
const ch = [0, 1].map(c => { const x = new Float64Array(n); for (let i = 0; i < n; i++) x[i] = inter[2 * i + c]; return kw(x); });
const out = [];
for (let t = 0.5; t < n / sr; t += 1) {
  const s = Math.floor((t - 0.2) * sr), e = Math.floor((t + 0.2) * sr); let m = 0;
  for (const y of ch) for (let i = s; i < e; i++) m += y[i] * y[i] / (e - s);
  out.push(`${t.toFixed(1).padStart(5)}:${(-0.691 + 10 * Math.log10(m + 1e-20)).toFixed(1).padStart(6)}`);
}
for (let i = 0; i < out.length; i += 10) console.log(out.slice(i, i + 10).join('  '));
let maxSil = 0; for (let i = Math.floor(10.55 * sr); i < Math.floor(11.99 * sr); i++) maxSil = Math.max(maxSil, Math.abs(inter[2 * i]), Math.abs(inter[2 * i + 1]));
console.log('max |sample| in silence 10.55–11.99 s:', maxSil.toExponential(2));
