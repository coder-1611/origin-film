// Render the score offline in Chrome (OfflineAudioContext) → renders/score-raw.f32 (pre-master).
//   --from 125 --to 155   audition a window instead → renders/audition-125-155.wav (quick iteration)
import { serve } from './lib/serve.mjs';
import { launch } from './lib/browser.mjs';

const { srv, url } = await serve();
const browser = await launch();
try {
  const page = await browser.newPage();
  page.on('console', (m) => console.log(m.text()));
  page.on('pageerror', (e) => console.log('[page:exception]', e.message));
  await page.goto(`${url}/audio.html`, { waitUntil: 'load' });
  const t0 = Date.now();
  const argv = process.argv.slice(2), opt = (k) => { const i = argv.indexOf('--' + k); return i < 0 ? null : +argv[i + 1]; };
  const from = opt('from'), to = opt('to');
  const r = await page.evaluate((o) => window.__renderScore(o), from !== null ? { from, to } : {});
  if (from !== null) {
    const { readF32, writeWavF32 } = await import('./lib/dsp.mjs');
    const path = (await import('node:path')).default, { ROOT } = await import('./lib/serve.mjs');
    const f = path.join(ROOT, `renders/audition-${from}-${to}`);
    writeWavF32(f + '.wav', readF32(f + '.f32'), 48000);
    console.log('audition →', f + '.wav');
  }
  console.log(`score-raw.f32: ${r.frames} frames @ ${r.sampleRate} Hz, peak ${(20 * Math.log10(r.peak)).toFixed(2)} dBFS, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
} finally { await browser.close(); srv.close(); }
