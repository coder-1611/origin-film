// One frame every 2 s of the delivered MP4, laid out with timecodes and chapter labels.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT, serve } from '../lib/serve.mjs';
import { launch } from '../lib/browser.mjs';
const T = await import(path.join(ROOT, 'src/timeline.js'));
const file = process.argv[2] || path.join(ROOT, 'renders/origin.mp4');
const out = process.argv[3] || path.join(ROOT, 'docs/contact-sheet.jpg');
const dir = path.join(ROOT, 'tools/verify/out/cs');
fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-vf', 'fps=1/2:round=down,scale=384:-2', '-q:v', '3', path.join(dir, 'c%03d.jpg')]);
const files = fs.readdirSync(dir).filter(f => f.endsWith('.jpg')).sort();
const cells = files.map((f, i) => {
  const t = i * 2, c = T.chapterAt(t + 1e-3);
  const mm = String(Math.floor(t / 60)).padStart(1, '0'), ss = String(t % 60).padStart(2, '0');
  return `<figure><img src="${f}"><figcaption><b>${mm}:${ss}</b><span>${c.label}</span></figcaption></figure>`;
}).join('');
fs.writeFileSync(path.join(dir, 'index.html'), `<!doctype html><meta charset=utf-8><link rel=stylesheet href="/src/assets/fonts.css"><style>
body{margin:0;background:#0b0a09;color:#f4ede2;font:500 11px Inter;padding:28px}
h1{font:300 34px 'Cormorant Garamond';letter-spacing:.3em;margin:0 0 4px}p{margin:0 0 18px;color:#9a938a;font-size:12px}
main{display:grid;grid-template-columns:repeat(10,384px);gap:10px}
figure{margin:0}img{display:block;width:384px;height:216px;object-fit:cover;background:#000}
figcaption{display:flex;justify-content:space-between;padding:5px 1px 0;color:#8f887e;letter-spacing:.08em}figcaption b{color:#f4ede2;font:500 11px 'JetBrains Mono'}
</style><h1>ORIGIN</h1><p>Contact sheet · one frame every 2 s · ${files.length} frames · from ${path.basename(file)}</p><main>${cells}</main>`);
const { srv, url } = await serve();
const b = await launch();
const p = await b.newPage();
await p.setViewport({ width: 28 * 2 + 10 * 384 + 9 * 10, height: 800 });
await p.goto(`${url}/tools/verify/out/cs/index.html`, { waitUntil: 'networkidle0' });
await p.evaluate(() => document.fonts.ready);
await p.screenshot({ path: out, fullPage: true, type: 'jpeg', quality: 88 });
await b.close(); srv.close();
console.log(`contact sheet: ${files.length} frames → ${path.relative(ROOT, out)}`);
