// Loop seam: (1) source frames 0 and 10799 byte/pixel comparison, (2) decoded MP4 first vs last
// frame pixel diff, (3) audio sample continuity at the wrap (last sample → first sample) for the
// mastered WAV and for the MP4's decoded AAC.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { ROOT } from '../lib/serve.mjs';
import { readWav, decodeAudio } from '../lib/dsp.mjs';
const file = process.argv[2] || path.join(ROOT, 'renders/origin.mp4');
const res = {};
const fdir = path.join(ROOT, 'frames/1920x1080@60');
if (fs.existsSync(path.join(fdir, 'f10799.jpg'))) {
  const a = fs.readFileSync(path.join(fdir, 'f00000.jpg')), b = fs.readFileSync(path.join(fdir, 'f10799.jpg'));
  res.sourceFramesIdenticalBytes = crypto.createHash('md5').update(a).digest('hex') === crypto.createHash('md5').update(b).digest('hex');
}
const grab = (sel) => execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-vf', `select='${sel}',format=rgb24`, '-frames:v', '1', '-f', 'rawvideo', '-'], { maxBuffer: 1 << 28 });
const nb = +JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames', '-of', 'json', file]).toString()).streams[0].nb_read_frames;
const f0 = grab('eq(n\\,0)'), fl = grab(`eq(n\\,${nb - 1})`);
let sad = 0, mx = 0, se = 0;
for (let i = 0; i < f0.length; i++) { const d = Math.abs(f0[i] - fl[i]); sad += d; mx = Math.max(mx, d); se += d * d; }
res.mp4Frames = nb;
res.mp4FirstVsLast = { meanAbsDiff: +(sad / f0.length).toFixed(4), maxAbsDiff: mx, psnrDb: se === 0 ? Infinity : +(10 * Math.log10(255 * 255 / (se / f0.length))).toFixed(2) };
function wrap(inter) {
  const n = inter.length / 2, steps = [];
  for (let i = 1; i < n; i++) steps.push(Math.max(Math.abs(inter[2 * i] - inter[2 * i - 2]), Math.abs(inter[2 * i + 1] - inter[2 * i - 1])));
  steps.sort((a, b) => a - b);
  const jump = Math.max(Math.abs(inter[0] - inter[2 * n - 2]), Math.abs(inter[1] - inter[2 * n - 1]));
  const rank = steps.findIndex(s => s >= jump) / steps.length;
  return { wrapJump: +jump.toFixed(5), medianStep: +steps[steps.length >> 1].toFixed(5), p99Step: +steps[Math.floor(steps.length * 0.99)].toFixed(5), wrapJumpPercentile: +(100 * (rank < 0 ? 1 : rank)).toFixed(1) };
}
res.wavWrap = wrap(readWav(path.join(ROOT, 'renders/score.wav')).inter);
res.mp4AudioWrap = wrap(await decodeAudio(file));
fs.writeFileSync(path.join(ROOT, 'tools/verify/out/loop.json'), JSON.stringify(res, null, 2));
console.log(JSON.stringify(res, null, 2));
