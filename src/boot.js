// Boot for both modes. ?mode=render gives a bare W×H canvas driven by window.__seek(t);
// otherwise the live player (src/player.js) takes over.
import { Film } from './engine/film.js';

const q = new URLSearchParams(location.search);
const mode = q.get('mode') || 'live';
const W = +(q.get('w') || (mode === 'render' ? 1920 : 1280)), H = +(q.get('h') || (mode === 'render' ? 1080 : 720));
const solo = q.get('solo') ? q.get('solo').split(',') : null;

const FONT_FACES = [
  '400 16px "JetBrains Mono"', '500 16px "JetBrains Mono"', '700 16px "JetBrains Mono"',
  '300 16px "Cormorant Garamond"', '400 16px "Cormorant Garamond"', '500 16px "Cormorant Garamond"',
  'italic 300 16px "Cormorant Garamond"', 'italic 400 16px "Cormorant Garamond"',
  '300 16px "Inter"', '400 16px "Inter"', '500 16px "Inter"', '600 16px "Inter"',
];

async function boot() {
  document.body.classList.add(mode);
  await Promise.all(FONT_FACES.map(f => document.fonts.load(f)));
  await document.fonts.ready;
  const canvas = document.getElementById('film');
  canvas.width = W; canvas.height = H;
  // ?nofeat: audio features off (zeros), for exact A/B comparisons across audio re-renders.
  const film = await new Film(canvas, { W, H, solo, quality: +(q.get('q') || 1), featuresUrl: q.has('nofeat') ? null : undefined }).init();
  film.fixSeed = q.has('fixseed');   // A/B comparisons: grain/dither pattern independent of t
  window.__film = film;
  window.__seek = (t) => film.seek(t);
  window.__info = () => ({
    gpu: film.gpu, W, H,
    fonts: FONT_FACES.map(f => [f, document.fonts.check(f)]),
    chapters: Object.fromEntries(Object.entries(film.chapters).map(([k, m]) => [k, m.stub ? (m.error ? 'ERROR: ' + m.error.slice(0, 300) : 'stub') : 'ok'])),
    features: film.features.ok,
  });
  if (mode !== 'render') {
    const { startPlayer } = await import('./player.js');
    await startPlayer(film);
  }
  return film;
}
window.__ready = boot().catch(e => { console.error('[boot] ' + (e && e.stack || e)); throw e; });
