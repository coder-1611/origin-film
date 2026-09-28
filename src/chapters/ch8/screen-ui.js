// VIII · THE PROMPT: what the laptop's display shows, drawn with Canvas2D as a pure function of t.
// (Times below are written against a chapter start of 160 s and re-anchored by D = start − 160.)
//   159.2 → 168.0  a dark code editor: prompt.md typed character by character (T.typedCount),
//                  soft-wrapped, markdown-tinted, auto-scrolled, with a warm block caret.
//   168.0 → 171.6  a terminal (from T.ENTER_T): `$ node tools/render.mjs` and a progress bar.
//   171.6 → …      a minimal video player whose picture is the film itself (composited in the
//                  display shader from the recursion level below; the canvas only draws chrome).
import { ED, CANVAS } from './layout.js';

const W = CANVAS.w, H = CANVAS.h;
const COL = {
  bg: '#0c0f14', tabBar: '#11141a', line: '#1b1f27', gutter: '#3a4150', gutterOn: '#a3aab6', curLine: '#12161d',
  text: '#c5cbd3', h1: '#d8a06a', h2: '#f1ca94', bullet: '#7fa6f0', roman: '#c0a0f4', num: '#efa274',
  caps: '#ffdcae', code: '#a2d47c', path: '#8fd3c7', dim: '#6d7582', status: '#8a919c',
};
const CLS = [COL.text, COL.h1, COL.h2, COL.bullet, COL.roman, COL.num, COL.caps, COL.code, COL.path];
const FALLBACK = /[\u2190-\u21ff\u2200-\u22ff]/;          // → ≤ … are not in the latin font subset

/** Phase times, re-anchored to the chapter's start (D = VIII.start − 160). */
export function makePhase(T) {
  const D = T.chapterById.VIII.start - 160;
  return {
    D,
    wake: [160.1 + D, 161.0 + D],  // display content fades up; before it only the caret is lit
    terminal: T.ENTER_T,
    player: T.renderBar.t1,
    playerOpen: 0.3,
    full: [172.7 + D, 173.45 + D], // player → fullscreen
  };
}
let PHASE = null;

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const sstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const smoother = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * t * (t * (t * 6 - 15) + 10); };
const fmtInt = (n) => Math.round(n).toLocaleString('en-US');
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export class ScreenUI {
  constructor(T, FONTS) {
    this.T = T; this.F = FONTS;
    this.P = PHASE = makePhase(T);
    this.canvas = document.createElement('canvas');
    this.canvas.width = W; this.canvas.height = H;
    this.g = this.canvas.getContext('2d');
    this.lastKey = '';
    this.layout();
  }

  // ------------------------------------------------------------ text layout (once)
  layout() {
    const text = this.T.typing.text, n = text.length;
    const cls = new Uint8Array(n);
    // markdown-ish tinting per logical line
    let s = 0;
    const lines = text.split('\n');
    for (const ln of lines) {
      const set = (a, b, c) => { for (let i = a; i < b; i++) cls[s + i] = c; };
      const re = (rx, c) => { rx.lastIndex = 0; let m; while ((m = rx.exec(ln))) set(m.index, m.index + m[0].length, c); };
      re(/\d[\d.,]*(?:[x×]\d+)?/g, 5);
      re(/\b[A-Z][A-Z0-9-]{2,}\b/g, 6);
      re(/[\w.-]*\/[\w./-]*|\b[\w-]+\.(?:js|mjs|md|html|json|mp4|wav|png|jpg)\b|\bwindow\.__seek\(t\)/g, 8);
      re(/`[^`]*`/g, 7);
      if (/^#+ /.test(ln)) { const k = ln.indexOf(' '); set(0, k, 1); set(k, ln.length, 2); }
      let m;
      if ((m = /^(\s*)(- |\d+\. )/.exec(ln))) set(m[1].length, m[1].length + m[2].length - 1, 3);
      if ((m = /^([IVX]+\.)\s*(\d:\d\d–\d:\d\d)?/.exec(ln))) { set(0, m[1].length, 4); if (m[2]) { const k = ln.indexOf(m[2]); set(k, k + m[2].length, 5); } }
      s += ln.length + 1;
    }
    // soft wrap at ED.cols (word boundaries), continuation lines keep the line's indent
    const vline = new Int32Array(n + 1), vcol = new Int32Array(n + 1);
    const vis = [];                         // { start, end, logical, first, indent }
    let L = 0, start = 0;
    lines.forEach((ln, li) => {
      // continuation indent: same as the line's text (after any bullet); chapter rows hang at 16
      const indent = (/^(\s*(?:- |\d+\. )?)/.exec(ln) || ['', ''])[1].length;
      const baseIndent = /^[IVX]+\.\s*\d/.test(ln) ? 16 : indent;
      let i = 0, first = true;
      if (ln.length === 0) { vis.push({ start, end: start, logical: li + 1, first: true, indent: 0 }); vline[start] = L; vcol[start] = 0; L++; }
      while (i < ln.length) {
        const ind = first ? 0 : Math.min(baseIndent, 20);
        const room = ED.cols - ind;
        let end = Math.min(ln.length, i + room);
        if (end < ln.length) {
          const sp = ln.lastIndexOf(' ', end);
          if (sp > i) end = sp + 1;
        }
        vis.push({ start: start + i, end: start + end, logical: li + 1, first, indent: ind });
        for (let k = i; k < end; k++) { vline[start + k] = L; vcol[start + k] = ind + (k - i); }
        L++; i = end; first = false;
      }
      // the newline char sits after the last glyph of the line
      const nl = start + ln.length;
      if (nl < n) {
        if (ln.length > 0) { vline[nl] = L - 1; vcol[nl] = vcol[nl - 1] + 1; }
      }
      start += ln.length + 1;
    });
    // caret position before char i (i = n: after the last char)
    const cLine = new Int32Array(n + 1), cCol = new Int32Array(n + 1);
    for (let i = 0; i <= n; i++) {
      if (i === 0) { cLine[i] = 0; cCol[i] = 0; continue; }
      const p = i - 1;
      if (text[p] === '\n') { cLine[i] = vline[p] + 1; cCol[i] = 0; }
      else if (i < n && vline[i] !== vline[p] && text[i] !== '\n') { cLine[i] = vline[i]; cCol[i] = vcol[i]; }
      else { cLine[i] = vline[p]; cCol[i] = vcol[p] + 1; }
    }
    // logical line / column for the status bar
    const lnNo = new Int32Array(n + 1), colNo = new Int32Array(n + 1);
    let a = 1, b = 1;
    for (let i = 0; i <= n; i++) { lnNo[i] = a; colNo[i] = b; if (i < n) { if (text[i] === '\n') { a++; b = 1; } else b++; } }
    // scroll: target first-visible line whenever the caret moves down; events for a smooth follow
    const keep = Math.floor(ED.visLines) - 3;
    const tgt = (i) => Math.max(0, cLine[i] - keep);
    const ev = [];
    let prev = 0;
    for (let i = 0; i <= n; i++) {
      const v = tgt(i);
      if (v !== prev) { ev.push({ t: i === 0 ? this.T.typing.start : this.T.typing.times[i - 1], d: v - prev }); prev = v; }
    }
    // glide width per scroll step: 0.3 s at typing speeds, narrowing as lines stream past (≈3 line
    // periods) so the view never falls behind the caret when typing stops dead at ~110 lines/s
    for (let j = 0; j < ev.length; j++) {
      const a = ev[Math.max(0, j - 2)].t, b = ev[Math.min(ev.length - 1, j + 2)].t;
      const span = Math.min(ev.length - 1, j + 2) - Math.max(0, j - 2);
      const rate = span > 0 ? span / Math.max(1e-4, b - a) : 1;
      ev[j].w = Math.min(0.3, Math.max(0.045, 3 / rate));
    }
    Object.assign(this, { cls, vis, vline, vcol, cLine, cCol, lnNo, colNo, scrollEv: ev, keep, nChars: n, totalLines: L });
  }

  /**
   * Scroll (in lines) as a smooth, pure function of t. Every change of the scroll target (the caret
   * moving onto a new line) glides through a smootherstep CENTRED on its keystroke (0.3 s wide at
   * typing speed, narrower as lines stream by): the view eases a little before the line breaks and
   * settles a little after, so it never lags the caret (at 7,000 cps the glides overlap into one
   * even stream).
   */
  scrollAt(t, count) {
    let s = 0;
    for (const e of this.scrollEv) {
      if (e.t - e.w * 0.5 > t + 0.3) break;
      const u = (t - e.t) / e.w + 0.5;
      if (u <= 0) continue;
      s += e.d * (u >= 1 ? 1 : u * u * u * (u * (u * 6 - 15) + 10));
    }
    const line = this.cLine[count];
    const vis = Math.floor(ED.visLines);
    return Math.max(0, Math.min(Math.max(s, line - vis + 1.05), line - 0.2));   // safety only
  }

  // ------------------------------------------------------------ public: state + draw
  /** Everything the display needs at t. Redraws the canvas only when its content changed. */
  update(t) {
    const T = this.T;
    const st = { mode: 'editor', wake: 1, cursor: null, video: null, changed: false };
    if (t >= PHASE.player) this.player(t, st);
    else if (t >= PHASE.terminal) this.terminal(t, st);
    else this.editor(t, st);
    return st;
  }

  begin(key) {
    if (key === this.lastKey) return false;
    this.lastKey = key;
    return true;
  }

  // ------------------------------------------------------------ editor
  editor(t, st) {
    const T = this.T;
    const count = T.typedCount(t);
    const scroll = this.scrollAt(t, count);
    st.wake = smoother(PHASE.wake[0], PHASE.wake[1], t);
    // caret: solid through the hand-off, one soft blink before the first key, solid while typing
    let on = 1;
    if (t < T.typing.start) {
      const b = t - (160.56 + PHASE.D);
      on = 1 - sstep(0.0, 0.06, b) + sstep(0.26, 0.32, b);
      on = clamp01(on);
    }
    const line = this.cLine[count], col = this.cCol[count];
    const cy = ED.areaTop + ED.top + (line - scroll) * ED.lineH;
    const cx = ED.textX + col * ED.charW;
    const pad = 5;
    st.cursor = { x0: cx, y0: cy + pad, x1: cx + ED.charW, y1: cy + ED.lineH - pad, on };
    st.count = count;
    const key = `e|${count}|${scroll.toFixed(3)}|${on.toFixed(3)}`;
    if (!this.begin(key)) return;
    st.changed = true;
    this.drawEditor(count, scroll, line, on);
  }

  drawEditor(count, scroll, caretLine, caretOn) {
    const g = this.g, F = this.F, text = this.T.typing.text;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.fillStyle = COL.bg; g.fillRect(0, 0, W, H);
    // --- tab bar
    g.fillStyle = COL.tabBar; g.fillRect(0, 0, W, ED.tabH);
    g.fillStyle = COL.line; g.fillRect(0, ED.tabH - 1, W, 1);
    const tabs = [['prompt.md', true, 'md'], ['timeline.js', false, 'js'], ['STORYBOARD.md', false, 'md'], ['SCORE.md', false, 'md']];
    let x = 0;
    g.font = `500 25px ${F.sans}`;
    for (const [name, active, kind] of tabs) {
      const w = Math.max(230, g.measureText(name).width + 118);
      if (active) {
        g.fillStyle = COL.bg; g.fillRect(x, 0, w, ED.tabH);
        g.fillStyle = '#e2a45e'; g.fillRect(x, 0, w, 3);
      }
      g.fillStyle = COL.line; g.fillRect(x + w - 1, 10, 1, ED.tabH - 20);
      // file icon
      g.font = `700 17px ${F.sans}`;
      g.fillStyle = kind === 'md' ? (active ? '#6fa3e0' : '#44607f') : (active ? '#e8c65a' : '#7a6a34');
      g.fillText(kind === 'md' ? 'M↓' : 'JS', x + 24, 40);
      g.font = `500 25px ${F.sans}`;
      g.fillStyle = active ? '#e6e9ee' : '#6a7280';
      g.fillText(name, x + 64, 41);
      if (active && count > 0) { g.fillStyle = '#c9ced6'; g.beginPath(); g.arc(x + w - 32, 33, 6, 0, Math.PI * 2); g.fill(); }
      x += w;
    }
    // --- text area
    const top = ED.areaTop, bot = ED.areaBot, textRight = W - ED.minimapW;
    g.save();
    g.beginPath(); g.rect(0, top, textRight, bot - top); g.clip();
    const y0 = top + ED.top - scroll * ED.lineH;
    // current line
    g.fillStyle = COL.curLine; g.fillRect(0, y0 + caretLine * ED.lineH, textRight, ED.lineH);
    const first = Math.max(0, Math.floor(scroll) - 1), last = Math.min(this.vis.length - 1, Math.ceil(scroll + ED.visLines) + 1);
    const base = ED.lineH * 0.5 + ED.font * 0.36;
    for (let v = first; v <= last; v++) {
      const L = this.vis[v];
      const ly = y0 + v * ED.lineH;
      const visible = L.start < count || (L.start === count && v <= caretLine);
      // gutter numbers for lines that exist
      if (L.first && (L.start < count || v <= caretLine)) {
        g.font = `400 34px ${F.mono}`;
        g.textAlign = 'right';
        g.fillStyle = v === caretLine || (this.vline[Math.max(0, count - 1)] === v) ? COL.gutterOn : COL.gutter;
        g.fillText(String(L.logical), ED.gutterW - 22, ly + base - 2);
        g.textAlign = 'left';
      }
      if (!visible) continue;
      const end = Math.min(L.end, count);
      let i = L.start;
      while (i < end) {
        const c = this.cls[i];
        let j = i + 1;
        while (j < end && this.cls[j] === c && !FALLBACK.test(text[j]) && !FALLBACK.test(text[i])) j++;
        const run = text.slice(i, j).replace(/\n/g, '');
        if (run.length) {
          g.font = `${c === 2 ? 700 : c === 6 ? 500 : 400} ${ED.font}px ${F.mono}`;
          g.fillStyle = CLS[c];
          const gx = ED.textX + (L.indent + (i - L.start)) * ED.charW;
          if (FALLBACK.test(run)) { g.textAlign = 'center'; g.fillText(run, gx + ED.charW / 2, ly + base); g.textAlign = 'left'; }
          else g.fillText(run, gx, ly + base);
        }
        i = j;
      }
    }
    // caret (warm white block; the display shader adds an HDR glow on top)
    if (caretOn > 0.001) {
      const cy = y0 + caretLine * ED.lineH + 5, cx = ED.textX + this.cCol[count] * ED.charW;
      g.globalAlpha = caretOn;
      g.fillStyle = '#fff2dc'; g.fillRect(cx, cy, ED.charW, ED.lineH - 10);
      g.globalAlpha = 1;
    }
    g.restore();
    // --- gutter rule
    g.fillStyle = '#161a21'; g.fillRect(ED.gutterW, top, 1, bot - top);
    // --- minimap
    const mx = textRight + 14, mw = ED.minimapW - 24, rowH = 3.4;
    const mmTop = top + 14;
    const mmScroll = Math.max(0, (this.cLine[count] + 4) * rowH - (bot - top - 28));
    g.save();
    g.beginPath(); g.rect(textRight, top, ED.minimapW, bot - top); g.clip();
    g.fillStyle = 'rgba(255,255,255,0.045)';
    g.fillRect(textRight + 6, mmTop + scroll * rowH - mmScroll, ED.minimapW - 12, ED.visLines * rowH);
    const lastV = this.cLine[count];
    for (let v = 0; v <= lastV && v < this.vis.length; v++) {
      const L = this.vis[v];
      const yy = mmTop + v * rowH - mmScroll;
      if (yy < top - 4 || yy > bot) continue;
      const end = Math.min(L.end, count);
      let i = L.start;
      while (i < end) {
        const c = this.cls[i];
        let j = i + 1;
        while (j < end && this.cls[j] === c) j++;
        const seg = text.slice(i, j);
        const lead = seg.length - seg.trimStart().length;
        const len = seg.trim().length;
        if (len) {
          g.fillStyle = CLS[c];
          g.globalAlpha = 0.55;
          g.fillRect(mx + (L.indent + (i - L.start) + lead) * (mw / ED.cols), yy, len * (mw / ED.cols), rowH - 1.2);
        }
        i = j;
      }
    }
    g.globalAlpha = 1;
    g.restore();
    g.fillStyle = COL.line; g.fillRect(textRight, top, 1, bot - top);
    // --- status bar
    g.fillStyle = '#0a0c10'; g.fillRect(0, bot, W, H - bot);
    g.fillStyle = COL.line; g.fillRect(0, bot, W, 1);
    g.font = `400 23px ${F.sans}`;
    g.fillStyle = COL.status;
    g.fillText('main', 58, bot + 31);
    g.strokeStyle = COL.status; g.lineWidth = 2;
    g.beginPath(); g.arc(34, bot + 15, 4, 0, 6.3); g.moveTo(34, bot + 19); g.lineTo(34, bot + 33); g.stroke();
    g.fillText(`${fmtInt(count)} characters`, 150, bot + 31);
    g.textAlign = 'right';
    g.fillText(`Ln ${this.lnNo[count]}, Col ${this.colNo[count]}      Spaces: 2      UTF-8      LF      Markdown`, W - 34, bot + 31);
    g.textAlign = 'left';
  }

  // ------------------------------------------------------------ terminal
  terminal(t, st) {
    const T = this.T;
    const rb = T.renderBar;
    const u = clamp01((t - rb.t0) / (rb.t1 - rb.t0));
    const frames = Math.floor(T.FRAMES * u + 1e-9);
    // bar head pulse on each of the 12 render ticks (the SFX cues)
    let pulse = 0;
    for (let k = 0; k < 12; k++) { const tk = rb.t0 + (rb.t1 - rb.t0) * (k / 11); if (t >= tk) pulse = Math.max(pulse, Math.exp(-(t - tk) / 0.12)); }
    const lines = Math.min(6, Math.floor((t - PHASE.terminal) / 0.055));
    const blink = ((t - PHASE.terminal) % 1.0) < 0.55 ? 1 : 0;
    st.mode = 'terminal';
    st.cursor = null;
    const key = `t|${frames}|${lines}|${pulse.toFixed(2)}|${blink}|${t >= rb.t1 ? 1 : 0}`;
    if (!this.begin(key)) return;
    st.changed = true;
    this.drawTerminal(t, u, frames, lines, pulse, blink, 1);
  }

  drawTerminal(t, u, frames, lines, pulse, blink, alpha) {
    const g = this.g, F = this.F;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = alpha;
    g.fillStyle = '#090b0e'; g.fillRect(0, 0, W, H);
    // title bar
    g.fillStyle = '#13161b'; g.fillRect(0, 0, W, 58);
    g.fillStyle = COL.line; g.fillRect(0, 57, W, 1);
    [['#e5645d', 40], ['#e2b04a', 72], ['#5bb85c', 104]].forEach(([c, x]) => { g.fillStyle = c; g.globalAlpha = alpha * 0.8; g.beginPath(); g.arc(x, 29, 9, 0, 6.3); g.fill(); });
    g.globalAlpha = alpha;
    g.font = `500 24px ${F.sans}`; g.fillStyle = '#8a919c'; g.textAlign = 'center';
    g.fillText('origin-film — zsh — 110×28', W / 2, 37); g.textAlign = 'left';
    const fs = 40, lh = 62, cw = fs * 0.6, x0 = 64;
    let y = 150;
    const put = (parts, yy) => { let x = x0; for (const [s, c, w] of parts) { g.font = `${w || 400} ${fs}px ${F.mono}`; g.fillStyle = c; g.fillText(s, x, yy); x += s.length * cw; } return x; };
    put([['~/Projects/origin-film', '#7fa6f0'], [' on ', '#5d6572'], ['main', '#c0a0f4']], y); y += lh;
    put([['$ ', '#a2d47c', 700], ['node tools/render.mjs', '#e6e9ee']], y); y += lh * 1.35;
    const rows = [
      [['ORIGIN', '#ffdcae', 700], [`  ${fmtInt(this.T.FRAMES)} frames · 1920×1080 · 60 fps · 8 workers`, '#9aa3ae']],
      [['gpu    ', '#5d6572'], ['ANGLE Metal Renderer: Apple M4', '#c5cbd3']],
      [['audio  ', '#5d6572'], ['renders/origin.wav · −14.0 LUFS · −1.5 dBTP', '#c5cbd3']],
      [['fonts  ', '#5d6572'], ['JetBrains Mono · Cormorant Garamond · Inter', '#c5cbd3']],
    ];
    for (let i = 0; i < rows.length; i++) { if (lines > i) put([['  ', '#000'], ...rows[i]], y); y += lh; }
    y += lh * 0.5;
    if (lines >= 5) {
      // progress bar
      const bx = x0 + cw * 2, bw = 1010, bh = 26, by = y - 24;
      g.fillStyle = '#1a1e25'; g.fillRect(bx, by, bw, bh);
      const fw = bw * u;
      const grd = g.createLinearGradient(bx, 0, bx + bw, 0);
      grd.addColorStop(0, '#c9863f'); grd.addColorStop(1, '#ffd9a0');
      g.fillStyle = grd; g.fillRect(bx, by, fw, bh);
      if (u > 0 && u < 1) {
        g.fillStyle = `rgba(255,244,225,${0.55 + 0.45 * pulse})`;
        g.fillRect(bx + fw - 6, by - 3 * pulse, 6, bh + 6 * pulse);
      }
      const pct = Math.floor(u * 100);
      put([[' '.repeat(Math.ceil((bw + 36) / cw) + 2), '#000'], [`${fmtInt(frames).padStart(6)} / ${fmtInt(this.T.FRAMES)}`, '#e6e9ee', 500], [`  ${String(pct).padStart(3)}%`, '#ffdcae', 500]], y);
      y += lh;
      const el = Math.max(0, (t - this.T.renderBar.t0)) * 360;
      const fps = frames > 0 ? frames / Math.max(1e-3, el) : 0;
      const eta = frames > 0 ? (this.T.FRAMES - frames) / Math.max(1e-3, fps) : 0;
      put([['  ', '#000'], [`${fps.toFixed(1)} fps · elapsed ${mmss(el)} · eta ${mmss(eta)}`, '#6d7582']], y);
      y += lh * 1.35;
    }
    if (t >= this.T.renderBar.t1) {
      // ✓ line
      g.strokeStyle = '#a2d47c'; g.lineWidth = 5; g.lineCap = 'round'; g.lineJoin = 'round';
      g.beginPath(); g.moveTo(x0 + 4, y - 14); g.lineTo(x0 + 12, y - 5); g.lineTo(x0 + 28, y - 27); g.stroke();
      put([['  ', '#000'], ['renders/origin.mp4', '#8fd3c7'], [`  ${mmss(this.T.DURATION)} · 1920×1080 · 60 fps`, '#9aa3ae']], y);
      y += lh;
    }
    // prompt / caret
    if (t < this.T.renderBar.t0 || t >= this.T.renderBar.t1) {
      const x = t >= this.T.renderBar.t1 ? put([['$ ', '#a2d47c', 700], ['open renders/origin.mp4', '#e6e9ee']], y) : x0 + 0;
      if (blink || t < this.T.renderBar.t0) { g.fillStyle = '#fff2dc'; g.fillRect(x + (t >= this.T.renderBar.t1 ? 0 : 0), y - fs * 0.8, cw, fs); }
    }
    g.globalAlpha = 1;
  }

  // ------------------------------------------------------------ player
  playerRect(t) {
    const f = smoother(PHASE.full[0], PHASE.full[1], t);
    const open = smoother(PHASE.player, PHASE.player + PHASE.playerOpen, t);
    const sc = 0.94 + 0.06 * open;
    const w0 = 1600 * sc, h0 = 900 * sc, cx0 = W / 2, cy0 = 60 + 450;
    const w = w0 + (W - w0) * f, h = h0 + (H - h0) * f;
    const cx = cx0 + (W / 2 - cx0) * f, cy = cy0 + (H / 2 - cy0) * f;
    return { x: cx - w / 2, y: cy - h / 2, w, h, open, full: f };
  }

  player(t, st) {
    const r = this.playerRect(t);
    st.mode = 'player';
    st.video = { x: r.x, y: r.y, w: r.w, h: r.h, alpha: r.open };
    const chrome = r.open * (1 - smoother(PHASE.full[0], PHASE.full[0] + 0.3, t));
    const key = `p|${r.x.toFixed(2)}|${r.w.toFixed(2)}|${chrome.toFixed(3)}|${Math.floor(t)}|${(t / this.T.DURATION).toFixed(4)}`;
    if (!this.begin(key)) return;
    st.changed = true;
    const g = this.g, F = this.F;
    // the terminal underneath, dimming as the player opens
    if (r.open < 1) this.drawTerminal(t, 1, this.T.FRAMES, 6, 0, 1, 1);
    else { g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.fillStyle = '#000'; g.fillRect(0, 0, W, H); }
    g.globalAlpha = r.open;
    g.fillStyle = '#050608'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#000'; g.fillRect(r.x, r.y, r.w, r.h);
    g.globalAlpha = 1;
    if (chrome > 0.002) {
      g.globalAlpha = chrome;
      g.font = `500 25px ${F.sans}`; g.fillStyle = '#9aa3ae'; g.textAlign = 'center';
      g.fillText('origin.mp4', W / 2, r.y - 18);
      g.textAlign = 'left';
      const cy = r.y + r.h + 58;
      // pause glyph (it is playing)
      g.fillStyle = '#e6e9ee';
      g.fillRect(190, cy - 17, 8, 30); g.fillRect(206, cy - 17, 8, 30);
      g.font = `500 24px ${F.mono}`; g.fillStyle = '#c5cbd3';
      g.fillText(mmss(t), 250, cy + 8);
      g.textAlign = 'right'; g.fillText(mmss(this.T.DURATION), W - 190, cy + 8); g.textAlign = 'left';
      const sx = 350, sw = W - 190 - 90 - sx;
      g.fillStyle = '#2a2f38'; g.fillRect(sx, cy - 3, sw, 6);
      const px = sx + sw * (t / this.T.DURATION);
      g.fillStyle = '#e6e9ee'; g.fillRect(sx, cy - 3, px - sx, 6);
      g.beginPath(); g.arc(px, cy, 10, 0, 6.3); g.fill();
      g.globalAlpha = 1;
    }
  }
}
