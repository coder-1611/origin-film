// Hard-cut detector on the DELIVERED MP4. Mean absolute RGB difference between consecutive
// frames (96×54). A hard cut shows up as an ISOLATED jump: one frame whose diff is > 6/255,
// > 5× the local median (±1 s) and > 2× both neighbours' diffs. Fast camera moves produce
// SUSTAINED runs instead; those are reported separately for review. Every isolated jump must
// sit on a storyboarded beat from timeline.js: a flash, a kick pulse, a star birth or a story beat.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../lib/serve.mjs';
import { decodeFrames, probeFps } from './lib.mjs';
const T = await import(path.join(ROOT, 'src/timeline.js'));
const file = process.argv[2] || path.join(ROOT, 'renders/origin.mp4');
const { fps } = probeFps(file);
const V = decodeFrames(file, 96, 54, 'rgb');
const diff = new Float64Array(V.n + 1);
for (let i = 1; i < V.n; i++) { const a = V.frame(i - 1), b = V.frame(i); let s = 0; for (let k = 0; k < a.length; k++) s += Math.abs(a[k] - b[k]); diff[i] = s / a.length; }
const med = (i) => { const w = []; for (let k = Math.max(1, i - fps); k < Math.min(V.n, i + fps); k++) w.push(diff[k]); w.sort((a, b) => a - b); return w[w.length >> 1]; };
const f = 1 / fps;
function sanction(t) {
  const fl = T.flashes.find(x => t >= x.t - 2 * f && t <= x.t + Math.max(3 * f, 3 * x.dur)); if (fl) return `flash: ${fl.name}`;
  const sb = T.storyBeats.find(x => t >= x.t - 2 * f && t <= x.t + x.dur + 2 * f); if (sb) return `story beat: ${sb.name}`;
  const st = T.starBirths.find(x => t >= x.t - 1.5 * f && t <= x.t + 3 * f); if (st) return 'star birth';
  const k = T.kicks.find(x => t >= x - 1.5 * f && t <= x + 2.5 * f); if (k !== undefined) return 'kick pulse';
  return null;
}
const isolated = [], sustained = [];
let run = null;
for (let i = 1; i < V.n; i++) {
  const m = med(i), big = diff[i] > 6 && diff[i] > 5 * Math.max(m, 0.4);
  if (!big) { if (run) { sustained.push(run); run = null; } continue; }
  const iso = diff[i] > 2 * Math.max(diff[i - 1], diff[i + 1] || 0);
  const t = +(i * f).toFixed(3);
  if (iso) isolated.push({ frame: i, t, diff: +diff[i].toFixed(2), localMedian: +m.toFixed(2), sanctioned: sanction(i * f) });
  else if (!run) run = { from: t, to: t, peak: +diff[i].toFixed(2), frames: 1, sanctioned: sanction(i * f) };
  else { run.to = t; run.frames++; run.peak = Math.max(run.peak, +diff[i].toFixed(2)); run.sanctioned = run.sanctioned || sanction(i * f); }
}
if (run) sustained.push(run);
// Dropout/glitch detector (A→B→A): frames i..i+g-1 (g ≤ 3) that differ strongly from frame i-1
// while frame i+g returns close to frame i-1. Catches flickers that the isolated-jump test misses
// because both edges of the glitch are big. Kick pulses/flashes are excluded (they decay, not return).
const dist = (a, b) => { const A = V.frame(a), B = V.frame(b); let s = 0; for (let k = 0; k < A.length; k++) s += Math.abs(A[k] - B[k]); return s / A.length; };
const glitches = [];
for (let i = 1; i < V.n - 4; i++) {
  const d0 = diff[i];
  if (d0 < 5) continue;
  for (let g = 1; g <= 3; g++) {
    const back = dist(i - 1, i + g);
    if (back < 0.45 * d0 && diff[i + g] > 0.6 * d0) {
      const t = +(i * f).toFixed(3);
      const sn = sanction(i * f);   // kick pulses and star births brighten-and-decay; they never excuse a dropout
      glitches.push({ t, frames: g, jump: +d0.toFixed(2), returnDiff: +back.toFixed(2), sanctioned: sn && /^(flash|story)/.test(sn) ? sn : null });
      i += g; break;
    }
  }
}
const handoffs = T.transitions.map(tr => {
  const a = Math.floor(tr.a * fps), b = Math.ceil(tr.b * fps);
  let mx = 0, at = a; for (let i = a; i <= b && i < V.n; i++) if (diff[i] > mx) { mx = diff[i]; at = i; }
  const ctx = []; for (let i = Math.max(1, a - 3 * fps); i < a; i++) ctx.push(diff[i]); ctx.sort((x, y) => x - y);
  const cut = isolated.find(s => s.frame >= a && s.frame <= b && !s.sanctioned);
  return { handoff: `${tr.from}→${tr.to}`, window: `${tr.a}–${tr.b}`, maxDiff: +mx.toFixed(2), atT: +(at * f).toFixed(3), precedingMedian: +(ctx[ctx.length >> 1] || 0).toFixed(2), hardCut: cut ? `at ${cut.t}` : 'none' };
});
const unsanctioned = isolated.filter(s => !s.sanctioned);
const report = { frames: V.n, fps, isolated, unsanctioned: unsanctioned.length, sustained, glitches, unsanctionedGlitches: glitches.filter(g => !g.sanctioned).length, handoffs };
fs.writeFileSync(path.join(ROOT, 'tools/verify/out/cuts.json'), JSON.stringify(report, null, 2));
console.log(`isolated jumps: ${isolated.length} | unsanctioned: ${unsanctioned.length}`);
for (const s of isolated) console.log(`  t=${s.t}  diff ${s.diff} (local median ${s.localMedian})  ${s.sanctioned || 'UNSANCTIONED'}`);
console.log(`sustained high-motion runs (camera moves, not cuts): ${sustained.length}`);
for (const s of sustained) console.log(`  ${s.from}–${s.to}  ${s.frames} frames, peak ${s.peak}${s.sanctioned ? '  (' + s.sanctioned + ')' : ''}`);
console.log(`dropout glitches (A→B→A): ${glitches.length}`);
for (const g of glitches) console.log(`  t=${g.t}  ${g.frames} frame(s), jump ${g.jump}, returns within ${g.returnDiff}  ${g.sanctioned || 'UNSANCTIONED'}`);
console.table(handoffs);
