// A/B pixel check for a timeline shift: for every reference PNG t<time>.png in --ref, render the
// film now at (time + --shift) with the same settings (960×540, --nofeat, --fixseed) and report
// the mean/max per-channel difference. Used to prove VII/VIII are unchanged after VI grew by 20 s.
//   node tools/verify/ab.mjs --ref tools/verify/out/ref-shift --shift 20 --from 135.25 --to 180 --solo VII,VIII
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { serve, ROOT } from '../lib/serve.mjs';
import { launch, openFilm, grab } from '../lib/browser.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => {
  if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]);
  return acc;
}, []));
const ref = path.resolve(args.ref), shift = +args.shift, from = +(args.from ?? 0), to = +(args.to ?? 1e9);
const W = 960, H = 540;
const refs = fs.readdirSync(ref).filter(f => /^t[\d.]+\.png$/.test(f)).map(f => ({ f, t: parseFloat(f.slice(1)) })).filter(r => r.t >= from && r.t <= to).sort((a, b) => a.t - b.t);
const out = path.join(ROOT, 'tools/verify/out/ab'); fs.mkdirSync(out, { recursive: true });
const raw = (file) => execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 28 });
const { srv, url } = await serve();
const browser = await launch();
let worst = { mean: 0, max: 0, t: null }, bad = 0;
try {
  const { page } = await openFilm(browser, url, { W, H, solo: args.solo, quiet: true, extraQuery: '&nofeat=1&fixseed=1' });
  for (const r of refs) {
    const file = path.join(out, `t${(r.t + shift).toFixed(3)}.png`);
    await grab(page, r.t + shift, { W, H, type: 'png', path: file });
    const a = raw(path.join(ref, r.f)), b = raw(file);
    let s = 0, m = 0; for (let i = 0; i < a.length; i++) { const d = Math.abs(a[i] - b[i]); s += d; if (d > m) m = d; }
    const mean = s / a.length, ok = mean < 0.05 && m <= 3;
    if (!ok) bad++;
    if (mean > worst.mean) worst = { mean, max: m, t: r.t };
    console.log(`ref ${r.t.toFixed(3)} → now ${(r.t + shift).toFixed(3)}  mean ${mean.toFixed(4)}  max ${m}  ${ok ? 'same' : 'DIFFERENT'}`);
  }
} finally { await browser.close(); srv.close(); }
console.log(`\n${refs.length - bad}/${refs.length} frames identical within tolerance (mean < 0.05, max ≤ 3). Worst: mean ${worst.mean.toFixed(4)} max ${worst.max} at ref t=${worst.t}`);
