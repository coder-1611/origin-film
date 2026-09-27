// The render farm: N headless Chrome workers (real GPU) split the frame range, each frame is
// window.__seek(t) + a JPEG capture; resumable (existing frames are skipped); then ffmpeg
// encodes H.264 CRF 16 yuv420p (BT.709) + AAC 320k with the mastered score.
//   node tools/render.mjs                         final: 1920×1080 @ 60 → renders/origin.mp4
//   node tools/render.mjs --draft                 540p @ 30 → renders/origin-draft.mp4
//   --workers 4  --from 0 --to 10800 (frame indices)  --encode-only  --no-encode
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { serve, ROOT } from './lib/serve.mjs';
import { launch, openFilm, grab } from './lib/browser.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i < 0 ? d : (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true); };
const draft = !!opt('draft', false);
const W = +opt('w', draft ? 960 : 1920), H = +opt('h', draft ? 540 : 1080), FPS = +opt('fps', draft ? 30 : 60);
const TOTAL = FPS * 180;
const from = +opt('from', 0), to = +opt('to', TOTAL);
const workers = +opt('workers', 4);
const dir = path.join(ROOT, 'frames', `${W}x${H}@${FPS}`);
const outName = opt('name', draft ? 'origin-draft.mp4' : 'origin.mp4');
fs.mkdirSync(dir, { recursive: true });
const fname = (i) => path.join(dir, `f${String(i).padStart(5, '0')}.jpg`);

if (!opt('encode-only', false)) {
  const todo = [];
  for (let i = from; i < to; i++) { try { if (fs.statSync(fname(i)).size > 1000) continue; } catch {} todo.push(i); }
  console.log(`${W}×${H} @ ${FPS} fps: ${to - from} frames in range, ${todo.length} to render, ${workers} workers`);
  if (todo.length) {
    const { srv, url } = await serve();
    const chunk = Math.ceil(todo.length / workers);
    const parts = Array.from({ length: workers }, (_, k) => todo.slice(k * chunk, (k + 1) * chunk)).filter(p => p.length);
    let done = 0; const t0 = Date.now();
    const tick = setInterval(() => {
      const el = (Date.now() - t0) / 1000, rate = done / Math.max(1, el);
      console.log(`  ${done}/${todo.length} frames  ${rate.toFixed(1)} fps  ETA ${((todo.length - done) / Math.max(rate, 1e-6) / 60).toFixed(1)} min`);
    }, 15000);
    await Promise.all(parts.map(async (frames, k) => {
      const browser = await launch();
      try {
        const { page, info } = await openFilm(browser, url, { W, H, quiet: true });
        if (k === 0) console.log('  GPU:', info.gpu, '| chapters:', JSON.stringify(info.chapters), '| features:', info.features);
        const bad = Object.entries(info.chapters).filter(([, v]) => v !== 'ok');
        if (bad.length && !opt('allow-stubs', false)) throw new Error('chapters not ready: ' + JSON.stringify(bad));
        for (const i of frames) { await grab(page, i / FPS, { W, H, type: 'jpeg', quality: 95, path: fname(i) }); done++; }
      } finally { await browser.close(); }
    }));
    clearInterval(tick);
    srv.close();
    console.log(`rendered ${todo.length} frames in ${((Date.now() - t0) / 60000).toFixed(1)} min`);
  }
}

if (!opt('no-encode', false)) {
  const missing = []; for (let i = 0; i < TOTAL; i++) if (!fs.existsSync(fname(i))) missing.push(i);
  if (missing.length) { console.log(`not encoding: ${missing.length} frames missing (first ${missing[0]})`); process.exit(0); }
  const wav = path.join(ROOT, 'renders/score.wav');
  const out = path.join(ROOT, 'renders', outName);
  const args = ['-y', '-v', 'error', '-stats', '-framerate', String(FPS), '-i', path.join(dir, 'f%05d.jpg'), '-i', wav,
    '-map', '0:v', '-map', '1:a',
    '-vf', 'scale=in_range=full:out_range=tv:in_color_matrix=bt601:out_color_matrix=bt709,format=yuv420p',
    '-c:v', 'libx264', '-preset', draft ? 'medium' : 'slow', '-crf', '16', '-pix_fmt', 'yuv420p',
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
    '-c:a', 'aac', '-b:a', '320k', '-ar', '48000', '-t', '180', '-movflags', '+faststart', out];
  console.log('encoding →', path.relative(ROOT, out));
  const r = spawnSync('ffmpeg', args, { stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status);
  console.log('done:', path.relative(ROOT, out), (fs.statSync(out).size / 1e6).toFixed(1), 'MB');
}
