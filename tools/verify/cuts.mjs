// Hard-cut detector: mean absolute RGB difference between consecutive frames of the delivered
// MP4. A spike is a frame whose diff is > 5× the local median (±1 s) AND > 6/255. Every spike
// must be sanctioned: a flash event (timeline.flashes) or a kick pulse. Also reports the largest
// diff inside each chapter hand-off window vs that chapter's typical motion.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../lib/serve.mjs';
import { decodeFrames, probeFps } from './lib.mjs';
const T = await import(path.join(ROOT, 'src/timeline.js'));
const file = process.argv[2] || path.join(ROOT, 'renders/origin.mp4');
const { fps } = probeFps(file);
const V = decodeFrames(file, 96, 54, 'rgb');
const diff = new Float64Array(V.n);
for (let i = 1; i < V.n; i++) { const a = V.frame(i - 1), b = V.frame(i); let s = 0; for (let k = 0; k < a.length; k++) s += Math.abs(a[k] - b[k]); diff[i] = s / a.length; }
const med = (i) => { const w = []; for (let k = Math.max(1, i - fps); k < Math.min(V.n, i + fps); k++) w.push(diff[k]); w.sort((a, b) => a - b); return w[w.length >> 1]; };
const spikes = [];
for (let i = 1; i < V.n; i++) {
  const m = med(i);
  if (diff[i] > 6 && diff[i] > 5 * Math.max(m, 0.4)) {
    const t = i / fps;
    const flash = T.flashes.find(f => t >= f.t - 1.5 / fps && t <= f.t + 3 / fps);
    const kick = T.kicks.find(k => t >= k - 1.5 / fps && t <= k + 2.5 / fps);
    spikes.push({ frame: i, t: +t.toFixed(3), diff: +diff[i].toFixed(2), localMedian: +m.toFixed(2), sanctioned: flash ? `flash:${flash.name}` : kick ? 'kick pulse' : null });
  }
}
const handoffs = T.transitions.map(tr => {
  const a = Math.floor(tr.a * fps), b = Math.ceil(tr.b * fps);
  let mx = 0, at = a; for (let i = a; i <= b && i < V.n; i++) if (diff[i] > mx) { mx = diff[i]; at = i; }
  let ctx = []; for (let i = Math.max(1, a - 3 * fps); i < a; i++) ctx.push(diff[i]); ctx.sort((x, y) => x - y);
  return { handoff: `${tr.from}→${tr.to}`, window: `${tr.a}–${tr.b}`, maxDiff: +mx.toFixed(2), atT: +(at / fps).toFixed(3), precedingMedian: +(ctx[ctx.length >> 1] || 0).toFixed(2), spike: spikes.some(s => s.frame >= a && s.frame <= b && !s.sanctioned) };
});
const unsanctioned = spikes.filter(s => !s.sanctioned);
const report = { frames: V.n, fps, spikes, unsanctioned: unsanctioned.length, handoffs };
fs.writeFileSync(path.join(ROOT, 'tools/verify/out/cuts.json'), JSON.stringify(report, null, 2));
console.log('spikes:', spikes.length, '| unsanctioned:', unsanctioned.length);
for (const s of spikes) console.log(`  t=${s.t}  diff ${s.diff} (local median ${s.localMedian})  ${s.sanctioned || 'UNSANCTIONED'}`);
console.table(handoffs);
