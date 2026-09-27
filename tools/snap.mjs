// Render specific times to images, for development and review.
//   node tools/snap.mjs --t 0,12.5,40            (1920×1080 PNGs into tools/verify/out/snap/)
//   node tools/snap.mjs --from 30 --to 34 --step 0.5 --w 960 --h 540
//   node tools/snap.mjs --chapter IV --every 2   (every 2 s across the chapter's full window)
//   --solo II         load only chapter II (others become stubs): faster iteration
//   --out dir         output directory       --png   lossless PNG instead of JPEG
//   --sheet           also write a contact sheet (sheet.jpg) of the grabs
//   --determinism     re-render each t after a random seek and compare pixels
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { serve, ROOT } from './lib/serve.mjs';
import { launch, openFilm, grab } from './lib/browser.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => {
  if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]);
  return acc;
}, []));
const W = +(args.w || 1920), H = +(args.h || 1080);
const out = path.resolve(args.out || path.join(ROOT, 'tools/verify/out/snap'));
fs.mkdirSync(out, { recursive: true });

const T = await import(path.join(ROOT, 'src/timeline.js'));
let times = [];
if (args.t) times = String(args.t).split(',').map(Number);
else if (args.chapter) {
  const [s, e] = T.chapterWindow(args.chapter);
  const step = +(args.every || 2);
  for (let t = s; t < e - 1e-6; t += step) times.push(+t.toFixed(4));
  times.push(+(e - 1 / 60).toFixed(4));
} else if (args.from !== undefined) {
  for (let t = +args.from; t <= +args.to + 1e-9; t += +(args.step || 1)) times.push(+t.toFixed(4));
}
if (!times.length) { console.log('no times given'); process.exit(1); }

const { srv, url } = await serve();
const browser = await launch();
try {
  const { page, info } = await openFilm(browser, url, { W, H, solo: args.solo });
  console.log('GPU:', info.gpu, '| chapters:', JSON.stringify(info.chapters), '| features:', info.features);
  const type = args.png ? 'png' : 'jpeg';
  const files = [];
  for (const t of times) {
    const t0 = performance.now();
    const file = path.join(out, `t${t.toFixed(3).padStart(8, '0')}.${type === 'png' ? 'png' : 'jpg'}`);
    await grab(page, t, { W, H, type, path: file });
    files.push(file);
    console.log(`t=${t.toFixed(3)}  ${(performance.now() - t0).toFixed(0)} ms  → ${path.relative(ROOT, file)}`);
  }
  if (args.determinism) {
    const crypto = await import('node:crypto');
    const hashAt = async (t) => crypto.createHash('md5').update(await grab(page, t, { W, H, type: 'png' })).digest('hex');
    for (const t of times) {
      const a = await hashAt(t);
      await grab(page, Math.max(0, t - 7.3), { W, H });     // disturb any cached state
      const b = await hashAt(t);
      console.log(`determinism t=${t}: ${a === b ? 'IDENTICAL' : 'DIFFERENT'} (${a.slice(0, 8)} / ${b.slice(0, 8)})`);
    }
  }
  if (args.sheet && files.length > 1) {
    const cols = Math.min(6, files.length);
    const list = path.join(out, 'list.txt');
    fs.writeFileSync(list, files.map(f => `file '${f}'`).join('\n'));
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-vf', `scale=480:-1,tile=${cols}x${Math.ceil(files.length / cols)}`, '-frames:v', '1', path.join(out, 'sheet.jpg')]);
    console.log('sheet →', path.relative(ROOT, path.join(out, 'sheet.jpg')));
  }
} finally {
  await browser.close();
  srv.close();
}
