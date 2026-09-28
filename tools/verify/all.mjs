// Run every verification against the DELIVERED renders/origin.mp4 and write docs/VERIFICATION.md
// with the measured output pasted verbatim.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from '../lib/serve.mjs';

const file = process.argv[2] || path.join(ROOT, 'renders/origin.mp4');
const out = path.join(ROOT, 'tools/verify/out');
fs.mkdirSync(out, { recursive: true });
const run = (script, ...args) => {
  console.log(`\n=== ${script} ===`);
  const r = spawnSync('node', [path.join(ROOT, 'tools/verify', script), file, ...args], { encoding: 'utf8', maxBuffer: 1 << 28 });
  process.stdout.write(r.stdout); process.stderr.write(r.stderr);
  if (r.status !== 0) throw new Error(`${script} failed`);
  return r.stdout;
};

const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration,size:stream=codec_name,width,height,r_frame_rate,pix_fmt,bit_rate,sample_rate,channels,color_space', '-of', 'default=nw=1', file], { encoding: 'utf8' }).stdout.trim();
const loud = run('loudness.mjs');
run('sync.mjs');
run('loop.mjs');
run('cuts.mjs');
run('contact-sheet.mjs', path.join(ROOT, 'docs/contact-sheet.jpg'));
spawnSync('ffmpeg', ['-y', '-v', 'error', '-i', file, '-lavfi', 'showspectrumpic=s=1920x600:legend=1:scale=log:fscale=log:color=intensity:start=20:stop=20000', path.join(ROOT, 'docs/spectrogram.png')]);
console.log('\nspectrogram → docs/spectrogram.png');

const sync = fs.readFileSync(path.join(out, 'sync-table.md'), 'utf8');
const loop = JSON.parse(fs.readFileSync(path.join(out, 'loop.json'), 'utf8'));
const cuts = JSON.parse(fs.readFileSync(path.join(out, 'cuts.json'), 'utf8'));
const master = fs.existsSync(path.join(ROOT, 'renders/master.json')) ? fs.readFileSync(path.join(ROOT, 'renders/master.json'), 'utf8') : '{}';
const now = new Date().toISOString();

const md = `# ORIGIN: verification report

Every number below was measured from the delivered file \`${path.relative(ROOT, file)}\` by the
scripts in \`tools/verify/\` (run \`npm run verify\`). Generated ${now}.

## The file

\`\`\`
${probe}
\`\`\`

## Loudness (ffmpeg \`-af ebur128=peak=true\`, verbatim)

\`\`\`
${loud.trim()}
\`\`\`

Mastering report (renders/master.json, pre-AAC):
\`\`\`json
${master.trim()}
\`\`\`

## Loop seam

* Source frames \`f00000.jpg\` vs \`f10799.jpg\` byte-identical: **${loop.sourceFramesIdenticalBytes}**
* Decoded MP4, first vs last of ${loop.mp4Frames} frames: mean |Δ| **${loop.mp4FirstVsLast.meanAbsDiff}**, max |Δ| **${loop.mp4FirstVsLast.maxAbsDiff}**, PSNR **${loop.mp4FirstVsLast.psnrDb === 'identical' ? '∞ (identical)' : loop.mp4FirstVsLast.psnrDb + ' dB'}**.
  The encoder checks that the last source frame is byte-identical to frame 0, then reuses frame 0's own encoded IDR access unit as the last frame.
* Audio at the wrap point (t = 180.000 → 0), mastered WAV: jump **${loop.wavWrap.wrapJump}** vs local median step ${loop.wavWrap.localMedianStep}, local p99 ${loop.wavWrap.localP99Step} (**${loop.wavWrap.wrapJumpLocalPercentile}th percentile** of the steps within ±0.5 s).
* Audio at the wrap point, decoded AAC from the MP4: jump **${loop.mp4AudioWrap.wrapJump}** vs local median ${loop.mp4AudioWrap.localMedianStep}, local p99 ${loop.mp4AudioWrap.localP99Step} (**${loop.mp4AudioWrap.wrapJumpLocalPercentile}th percentile**). The AAC is encoded circularly padded (so both edges of the loop are coded with their true neighbours and the decoder has real pre-roll), and the MP4 edit list presents exactly 180.000 s. The decoder output past sample 8,640,000 is the tail of the last AAC frame, outside the presented range.

## Hard cuts

${cuts.frames} frames scanned (mean |ΔRGB| between consecutive frames at 96×54). A hard cut is an
**isolated** jump: > 6/255, > 5× the local median and > 2× both neighbouring diffs.
Isolated jumps: **${cuts.isolated.length}**, of which **unsanctioned: ${cuts.unsanctioned}**.

| t | diff | local median | sanctioned by (timeline.js) |
|---|---|---|---|
${cuts.isolated.map(s => `| ${s.t} | ${s.diff} | ${s.localMedian} | ${s.sanctioned || '**NONE**'} |`).join('\n')}

Sustained high-motion runs (fast camera moves: many consecutive large diffs, not cuts):

| from | to | frames | peak diff |
|---|---|---|---|
${cuts.sustained.map(s => `| ${s.from} | ${s.to} | ${s.frames} | ${s.peak} |`).join('\n') || '| — | — | — | — |'}

Dropout glitches (A→B→A: up to 3 frames that jump away and then return): **${cuts.glitches.length}**, unsanctioned **${cuts.unsanctionedGlitches}**.
${cuts.glitches.map(g => `* t=${g.t}: ${g.frames} frame(s), jump ${g.jump}, returns within ${g.returnDiff} (${g.sanctioned || '**UNSANCTIONED**'})`).join('\n')}

Hand-off windows (largest frame-to-frame diff inside each window vs the median motion in the 3 s before it):

| hand-off | window (s) | max diff | at t | preceding median | hard cut |
|---|---|---|---|---|---|
${cuts.handoffs.map(h => `| ${h.handoff} | ${h.window} | ${h.maxDiff} | ${h.atT} | ${h.precedingMedian} | ${h.hardCut} |`).join('\n')}

## Sync proof (kick → visual pulse)

${sync}

## Contact sheet and spectrogram

![contact sheet](contact-sheet.jpg)

![spectrogram](spectrogram.png)
`;
fs.writeFileSync(path.join(ROOT, 'docs/VERIFICATION.md'), md);
console.log('\n→ docs/VERIFICATION.md');
