// Render the score offline in Chrome (OfflineAudioContext) → renders/score-raw.f32 (pre-master).
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
  const r = await page.evaluate(() => window.__renderScore());
  console.log(`score-raw.f32: ${r.frames} frames @ ${r.sampleRate} Hz, peak ${(20 * Math.log10(r.peak)).toFixed(2)} dBFS, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
} finally { await browser.close(); srv.close(); }
