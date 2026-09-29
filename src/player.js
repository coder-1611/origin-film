// The live player: the same film code rendered in real time, the same score synthesised live
// by Web Audio. The audio clock is the master: every animation frame renders t = the audio's
// current film time (frames drop if the GPU is slower than the display; sync never drifts).
import * as T from './timeline.js';
import { ScoreEngine } from './audio/engine.js';

const fmt = (t) => {
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`;
};
const el = (tag, cls, parent, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; if (parent) parent.appendChild(e); return e; };

export async function startPlayer(film) {
  const q = new URLSearchParams(location.search);
  const body = document.body;
  body.classList.add('player');

  // ------------------------------------------------------------------ DOM
  const gate = el('div', 'gate', body);
  el('div', 'gate-title', gate, 'ORIGIN');
  el('div', 'gate-sub', gate, '13.8 billion years in one unbroken shot');
  const playBig = el('button', 'gate-play', gate, '<span>Play</span>');
  el('div', 'gate-note', gate, 'Rendered live in your browser: every frame is WebGL, every sound is synthesised as you watch.');

  const ui = el('div', 'controls', body);
  const bar = el('div', 'scrub', ui);
  const track = el('div', 'scrub-track', bar);
  const fill = el('div', 'scrub-fill', track);
  const head = el('div', 'scrub-head', track);
  const hover = el('div', 'scrub-hover', bar);
  for (const c of T.chapters) {
    const m = el('div', 'marker', track);
    m.style.left = (c.start / T.DURATION * 100) + '%';
    m.style.width = ((c.end - c.start) / T.DURATION * 100) + '%';
    el('span', 'marker-label', m, c.id);
    m.title = c.label;
  }
  const row = el('div', 'row', ui);
  const playBtn = el('button', 'btn play', row);
  const time = el('div', 'time', row);
  const chap = el('div', 'chap', row);
  const spacer = el('div', 'spacer', row);
  const qualSel = el('select', 'qual', row);
  [['960x540', '540p'], ['1280x720', '720p'], ['1920x1080', '1080p']].forEach(([v, l]) => {
    const o = el('option', null, qualSel, l); o.value = v;
    if (v === `${film.W}x${film.H}`) o.selected = true;
  });
  const infoBtn = el('button', 'btn text', row, 'Info');
  const muteBtn = el('button', 'btn text', row, 'Mute');
  const fsBtn = el('button', 'btn text', row, 'Full screen');
  const hud = el('pre', 'debug', body);
  const keys = el('div', 'keys', body, 'space play/pause · ←/→ 5 s · shift+←/→ 1 frame · [ ] chapter · I info · M mute · F full screen');

  // ------------------------------------------------------------------ state
  let ctx = null, engine = null, playing = false, filmT = +(q.get('t') || 0), muted = false;
  const cache = { ks: new Map(), buffers: {}, data: {} };
  // Synthesise the heavy precomputed sounds off the main thread from page load (see warm-worker.js).
  try {
    const warm = new Worker(new URL('./audio/warm-worker.js', import.meta.url), { type: 'module' });
    warm.onmessage = (m) => { if (m.data.key) cache.data[m.data.key] = { L: m.data.L, R: m.data.R }; else if (m.data.done) warm.terminate(); };
  } catch (err) { console.warn('[player] warm-up worker unavailable; sounds synthesise on demand', err); }
  let masterGain = 1;
  try { const m = await (await fetch('src/assets/master.json', { cache: 'no-store' })).json(); masterGain = Math.pow(10, (m.gainDb || 0) / 20); } catch {}
  let showInfo = q.has('info'), lastRenderMs = 0, fpsEMA = 0, lastFrameAt = 0, pumpTimer = null;

  function ensureAudio() {
    if (!ctx) ctx = new AudioContext({ sampleRate: T.SAMPLE_RATE, latencyHint: 'playback' });
    if (ctx.state === 'suspended') ctx.resume();
  }
  function startAudioAt(t) {
    if (engine) { engine.dispose(); engine = null; }
    if (!ctx || t >= T.DURATION) return;
    engine = new ScoreEngine(ctx, { live: true, masterGain: muted ? 0 : masterGain, cache }).build();
    engine.startLive(t);
    engine.pump(t + 1.5);
  }
  const nowFilm = () => (playing && engine ? ctx.currentTime - engine.origin : filmT);

  // Pre-compile every chapter's shaders while the play screen is up: render the film off-screen at
  // moments that cover each chapter's distinct phases (WebGL compiles a program on first draw, which
  // otherwise lands as a visible hitch at the Big Bang, the nebula, the glare, Theia…). Each step is
  // one frame; it stops as soon as playback starts.
  const WARM = [0.05, 5, 12.02, 12.3, 20, 30.5, 32.2, 40, 46, 52, 57.4, 60.8, 69.4, 72, 78, 82.5, 90, 98, 100.5, 102.2, 104,
    107, 115, 122, 126.2, 130, 139, 141, 144, 147, 150.5, 152, 155, 160, 170, 178, 180.5, 184, 188.6, 192.5, 196, 199.5];
  let warmI = 0, warmStop = false;
  const warmStep = () => {
    if (warmStop || warmI >= WARM.length) return;
    try { film.renderTo(WARM[warmI++], film.ldr); } catch (e) { console.warn('[player] warm frame failed', e); }
    setTimeout(warmStep, 0);
  };
  setTimeout(warmStep, 100);

  function play() {
    warmStop = true;
    ensureAudio();
    if (filmT >= T.DURATION - 0.02) filmT = 0;
    playing = true;
    startAudioAt(filmT);
    clearInterval(pumpTimer);
    pumpTimer = setInterval(() => { if (engine && playing) engine.pump(nowFilm() + 1.5); }, 250);
    body.classList.add('playing');
  }
  function pause() {
    filmT = nowFilm();
    playing = false;
    clearInterval(pumpTimer);
    if (engine) { engine.dispose(); engine = null; }
    body.classList.remove('playing');
  }
  function seek(t, keepPlaying = playing) {
    filmT = Math.max(0, Math.min(T.DURATION - 1 / 60, t));
    if (keepPlaying) { playing = true; startAudioAt(filmT); } else if (engine) { engine.dispose(); engine = null; }
    draw(true);
  }

  // ------------------------------------------------------------------ render loop
  function draw(force = false) {
    let t = nowFilm();
    if (playing && t >= T.DURATION) {                  // the film loops, as designed
      filmT = 0; startAudioAt(0); t = 0;
    }
    if (!playing && !force) return;
    const t0 = performance.now();
    film.renderTo(t, film.ldr);
    film.copy.render(film.renderer, null, { src: film.ldr.texture });
    lastRenderMs = performance.now() - t0;
    const now = performance.now();
    if (lastFrameAt) fpsEMA = fpsEMA ? fpsEMA * 0.9 + 0.1 * (1000 / (now - lastFrameAt)) : 1000 / (now - lastFrameAt);
    lastFrameAt = now;
    if (!playing) filmT = t;
    updateUI(t);
  }
  function loop() { draw(); requestAnimationFrame(loop); }

  function updateUI(t) {
    const p = t / T.DURATION;
    fill.style.width = (p * 100) + '%';
    head.style.left = (p * 100) + '%';
    time.textContent = `${fmt(t)} / ${fmt(T.DURATION)}`;
    chap.textContent = T.chapterAt(t).label;
    playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    if (showInfo) {
      const bb = T.barBeat(t);
      hud.textContent = [
        `t          ${t.toFixed(3)} s`,
        `frame      ${Math.floor(t * 60 + 1e-6)} / ${T.FRAMES}`,
        `bar:beat   ${bb.free ? 'free time' : `${bb.bar}:${bb.beat.toFixed(2)}`}`,
        `tempo      ${bb.free ? '—' : T.bpmAt(t).toFixed(1) + ' BPM'}`,
        `chord      ${T.chordNameAt(t)}  (${T.keyAt(t).key})`,
        `chapter    ${T.chapterAt(t).label}`,
        `render     ${lastRenderMs.toFixed(1)} ms · ${fpsEMA.toFixed(0)} fps · ${film.W}×${film.H}`,
        `gpu        ${film.gpu.replace(/^ANGLE \((.*)\)$/, '$1').slice(0, 44)}`,
      ].join('\n');
    }
    hud.style.display = showInfo ? 'block' : 'none';
  }

  // ------------------------------------------------------------------ input
  playBig.onclick = () => { gate.classList.add('gone'); play(); };
  playBtn.onclick = () => (playing ? pause() : play());
  infoBtn.onclick = () => { showInfo = !showInfo; infoBtn.classList.toggle('on', showInfo); draw(true); };
  muteBtn.onclick = () => {
    muted = !muted; muteBtn.classList.toggle('on', muted); muteBtn.textContent = muted ? 'Unmute' : 'Mute';
    if (engine) engine.out.gain.setTargetAtTime(muted ? 0 : masterGain, ctx.currentTime, 0.02);
  };
  fsBtn.onclick = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen());
  qualSel.onchange = () => {
    const [w, h] = qualSel.value.split('x');
    const u = new URL(location.href); u.searchParams.set('w', w); u.searchParams.set('h', h); u.searchParams.set('t', nowFilm().toFixed(2));
    location.href = u.toString();
  };
  const tAtX = (x) => { const r = track.getBoundingClientRect(); return Math.max(0, Math.min(1, (x - r.left) / r.width)) * T.DURATION; };
  let dragging = false, wasPlaying = false;
  bar.addEventListener('pointerdown', (e) => { dragging = true; wasPlaying = playing; if (playing) pause(); bar.setPointerCapture(e.pointerId); seek(tAtX(e.clientX), false); });
  bar.addEventListener('pointermove', (e) => {
    const t = tAtX(e.clientX);
    hover.style.left = ((t / T.DURATION) * 100) + '%';
    hover.textContent = `${fmt(t)} · ${T.chapterAt(t).label}`;
    if (dragging) seek(t, false);
  });
  bar.addEventListener('pointerup', () => { if (!dragging) return; dragging = false; if (wasPlaying) play(); });
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'SELECT') return;
    const t = nowFilm();
    if (e.code === 'Space') { e.preventDefault(); gate.classList.add('gone'); playing ? pause() : play(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); seek(t + (e.shiftKey ? 1 / 60 : 5)); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); seek(t - (e.shiftKey ? 1 / 60 : 5)); }
    else if (e.key === ']') { const c = T.chapters.find(c => c.start > t + 0.01); if (c) seek(c.start); }
    else if (e.key === '[') { const prev = [...T.chapters].reverse().find(c => c.start < t - 0.5); seek(prev ? prev.start : 0); }
    else if (e.key === 'i' || e.key === 'I' || e.key === 'd' || e.key === 'D') infoBtn.onclick();
    else if (e.key === 'm' || e.key === 'M') muteBtn.onclick();
    else if (e.key === 'f' || e.key === 'F') fsBtn.onclick();
  });
  let idle;
  const wake = () => { body.classList.add('awake'); clearTimeout(idle); idle = setTimeout(() => body.classList.remove('awake'), 2600); };
  window.addEventListener('pointermove', wake); window.addEventListener('keydown', wake); wake();

  infoBtn.classList.toggle('on', showInfo);
  draw(true);
  requestAnimationFrame(loop);
}
