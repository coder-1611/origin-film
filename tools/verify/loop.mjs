// Loop seam: (1) source frames 0 and 10799 byte/pixel comparison, (2) decoded MP4 first vs last
// frame pixel diff, (3) audio sample continuity at the wrap (last sample → first sample) for the
// mastered WAV and for the MP4's decoded AAC.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { ROOT } from '../lib/serve.mjs';
import { readWav, decodeAudio } from '../lib/dsp.mjs';
const T = await import(path.join(ROOT, 'src/timeline.js'));
const file = process.argv[2] || path.join(ROOT, 'renders/origin.mp4');
const res = {};
const fdir = path.join(ROOT, 'frames/1920x1080@60'), lastF = `f${String(T.FRAMES - 1).padStart(5, '0')}.jpg`;
if (fs.existsSync(path.join(fdir, lastF))) {
  const a = fs.readFileSync(path.join(fdir, 'f00000.jpg')), b = fs.readFileSync(path.join(fdir, lastF));
  res.sourceFramesIdenticalBytes = crypto.createHash('md5').update(a).digest('hex') === crypto.createHash('md5').update(b).digest('hex');
}
const grab = (sel) => execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-vf', `select='${sel}',format=rgb24`, '-frames:v', '1', '-f', 'rawvideo', '-'], { maxBuffer: 1 << 28 });
const nb = +JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames', '-of', 'json', file]).toString()).streams[0].nb_read_frames;
const f0 = grab('eq(n\\,0)'), fl = grab(`eq(n\\,${nb - 1})`);
let sad = 0, mx = 0, se = 0;
for (let i = 0; i < f0.length; i++) { const d = Math.abs(f0[i] - fl[i]); sad += d; mx = Math.max(mx, d); se += d * d; }
res.mp4Frames = nb;
res.mp4FirstVsLast = { meanAbsDiff: +(sad / f0.length).toFixed(4), maxAbsDiff: mx, psnrDb: se === 0 ? 'identical' : +(10 * Math.log10(255 * 255 / (se / f0.length))).toFixed(2) };
// Continuity at the true wrap point (t = DURATION, where the video loops): the jump from the
// sample just before the end to sample 0, against the step statistics of the 0.5 s either side.
function wrap(inter, sr = 48000) {
  const N = T.DURATION * sr, W = sr / 2, steps = [];
  const step = (i, j) => Math.max(Math.abs(inter[2 * i] - inter[2 * j]), Math.abs(inter[2 * i + 1] - inter[2 * j + 1]));
  for (let i = N - W; i < N; i++) steps.push(step(i, i - 1));
  for (let i = 1; i < W; i++) steps.push(step(i, i - 1));
  steps.sort((a, b) => a - b);
  const jump = step(0, N - 1);
  const rank = steps.findIndex(s => s >= jump);
  return { samplesDecoded: inter.length / 2, wrapJump: +jump.toFixed(5), localMedianStep: +steps[steps.length >> 1].toFixed(5), localP99Step: +steps[Math.floor(steps.length * 0.99)].toFixed(5), wrapJumpLocalPercentile: +(100 * (rank < 0 ? 1 : rank / steps.length)).toFixed(1) };
}
res.wavWrap = wrap(readWav(path.join(ROOT, 'renders/score.wav')).inter);
res.mp4AudioWrap = wrap(await decodeAudio(file));
fs.writeFileSync(path.join(ROOT, 'tools/verify/out/loop.json'), JSON.stringify(res, null, 2));
console.log(JSON.stringify(res, null, 2));
