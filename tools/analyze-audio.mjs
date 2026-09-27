// Analyse the mastered score into per-video-frame features the picture reacts to:
// 32 log-spaced bands (30 Hz–16 kHz, 4096-pt FFT), RMS (one frame window) and spectral-flux
// onset strength (1024-pt FFT), each normalised to [0,1] by the film's own percentiles.
// Output: src/assets/audio-features.json (base64 Uint8, stride 34) + detected onset times.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './lib/serve.mjs';
import { readWav, fft } from './lib/dsp.mjs';

const FPS = 60, NB = 32, F0 = 30, F1 = 16000;
const file = process.argv[2] || path.join(ROOT, 'renders/score.wav');
const { inter, sr } = readWav(file);
const n = inter.length / 2, mono = new Float32Array(n);
for (let i = 0; i < n; i++) mono[i] = 0.5 * (inter[2 * i] + inter[2 * i + 1]);
const frames = Math.round(n / sr * FPS);
const edges = Array.from({ length: NB + 1 }, (_, k) => F0 * Math.pow(F1 / F0, k / NB));

function spectrum(center, N) {
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const j = center - N / 2 + i;
    const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1));
    re[i] = (j >= 0 && j < n ? mono[j] : 0) * w;
  }
  fft(re, im);
  const mag = new Float64Array(N / 2);
  for (let k = 0; k < N / 2; k++) mag[k] = Math.hypot(re[k], im[k]);
  return mag;
}

const bandsDb = Array.from({ length: frames }, () => new Float64Array(NB));
const rmsDb = new Float64Array(frames), flux = new Float64Array(frames);
let prevLog = null;
for (let f = 0; f < frames; f++) {
  const c = Math.round(f / FPS * sr);
  const mag = spectrum(c, 4096), binHz = sr / 4096;
  for (let b = 0; b < NB; b++) {
    const k0 = edges[b] / binHz, k1 = edges[b + 1] / binHz;
    let e = 0, cnt = 0;
    for (let k = Math.floor(k0); k <= Math.ceil(k1); k++) {
      const wgt = Math.max(0, Math.min(k + 0.5, k1) - Math.max(k - 0.5, k0));   // fractional bin coverage
      if (wgt > 0 && k < mag.length) { e += wgt * mag[k] * mag[k]; cnt += wgt; }
    }
    bandsDb[f][b] = 10 * Math.log10(e / Math.max(cnt, 1e-9) + 1e-12);
  }
  let s = 0; const h = Math.round(sr / FPS / 2);
  for (let i = c - h; i < c + h; i++) if (i >= 0 && i < n) s += mono[i] * mono[i];
  rmsDb[f] = 10 * Math.log10(s / (2 * h) + 1e-12);
  const m2 = spectrum(c, 1024), lg = m2.map(v => Math.log1p(v * 50));
  if (prevLog) { let fl = 0; for (let k = 1; k < lg.length; k++) fl += Math.max(0, lg[k] - prevLog[k]); flux[f] = fl; }
  prevLog = lg;
  if (f % 1800 === 0) process.stdout.write(`analysing ${(f / FPS).toFixed(0)} s\r`);
}
const pct = (arr, p) => { const a = Array.from(arr).sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(p * a.length))]; };
const stride = NB + 2, out = new Uint8Array(frames * stride);
for (let b = 0; b < NB; b++) {
  const col = bandsDb.map(r => r[b]), lo = pct(col, 0.05), hi = pct(col, 0.995);
  for (let f = 0; f < frames; f++) out[f * stride + b] = Math.round(255 * Math.min(1, Math.max(0, (bandsDb[f][b] - lo) / (hi - lo))));
}
{ const lo = pct(rmsDb, 0.05), hi = pct(rmsDb, 0.995); for (let f = 0; f < frames; f++) out[f * stride + NB] = Math.round(255 * Math.min(1, Math.max(0, (rmsDb[f] - lo) / (hi - lo)))); }
const fhi = pct(flux, 0.995);
for (let f = 0; f < frames; f++) out[f * stride + NB + 1] = Math.round(255 * Math.min(1, flux[f] / fhi));
// Onsets: local maxima above an adaptive (median + δ) threshold, ≥ 60 ms apart.
const onsets = [];
for (let f = 2; f < frames - 2; f++) {
  const w = []; for (let k = Math.max(0, f - 15); k < Math.min(frames, f + 15); k++) w.push(flux[k]);
  w.sort((a, b) => a - b);
  const thr = w[w.length >> 1] + 0.12 * fhi;
  if (flux[f] > thr && flux[f] >= flux[f - 1] && flux[f] > flux[f + 1] && (!onsets.length || f / FPS - onsets[onsets.length - 1] > 0.06)) onsets.push(+(f / FPS).toFixed(4));
}
const json = { fps: FPS, frames, stride, bandsHz: edges.map(e => Math.round(e)), onsets, data: Buffer.from(out).toString('base64') };
fs.writeFileSync(path.join(ROOT, 'src/assets/audio-features.json'), JSON.stringify(json));
console.log(`\naudio-features.json: ${frames} frames × ${stride}, ${onsets.length} onsets`);
