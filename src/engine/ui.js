// The 2D typography layer: one Canvas2D, redrawn every frame from t, uploaded as a texture
// and composited over the tonemapped image. Chapters draw into it via `drawUI(g, t, alpha, ui)`.
import { THREE } from './gl.js';
import * as T from '../timeline.js';

export const FONTS = {
  mono: '"JetBrains Mono", ui-monospace, monospace',
  serif: '"Cormorant Garamond", Georgia, serif',
  sans: '"Inter", system-ui, sans-serif',
};

export class UI {
  constructor(W, H) {
    this.W = W; this.H = H; this.s = H / 1080;          // design units are 1080p pixels
    this.canvas = document.createElement('canvas');
    this.canvas.width = W; this.canvas.height = H;
    this.g = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.flipY = false;
    this.texture.colorSpace = THREE.NoColorSpace;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;
  }

  begin() {
    const g = this.g;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.W, this.H);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    g.letterSpacing = '0px';
    g.setTransform(this.s, 0, 0, this.s, 0, 0);   // draw in 1920×1080 design units
  }
  end() { this.texture.needsUpdate = true; }

  /** Per-glyph reveal: each glyph fades/rises in with a stagger. p ∈ [0,1] overall progress. */
  glyphReveal(text, x, y, p, { font, spacing = 0, stagger = 0.06, rise = 8, color = '255,248,235', alpha = 1, align = 'left' } = {}) {
    const g = this.g;
    g.font = font;
    g.letterSpacing = '0px';
    const widths = [...text].map(ch => g.measureText(ch).width + spacing);
    const total = widths.reduce((a, b) => a + b, 0) - spacing;
    let cx = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
    const n = text.length, span = 1 + stagger * (n - 1);
    [...text].forEach((ch, i) => {
      const local = Math.min(1, Math.max(0, (p * span - i * stagger)));
      const e = 1 - Math.pow(1 - local, 3);
      if (e > 0.001) {
        g.fillStyle = `rgba(${color},${(alpha * e).toFixed(4)})`;
        g.fillText(ch, cx, y + (1 - e) * rise);
      }
      cx += widths[i];
    });
    return total;
  }

  /** The HUD: rule, chapter label (per-glyph reveal on change), year counter. */
  drawHUD(t) {
    const a = T.hudAlpha(t);
    if (a < 0.002) return;
    const g = this.g;
    const x = 72, yBase = 1080 - 70;
    const ch = T.chapterAt(t);
    const since = t - Math.max(ch.start, T.hud.fadeIn[0]);
    // Outgoing label fades as the new one arrives.
    const prev = T.chapters[T.chapters.indexOf(ch) - 1];
    g.save();
    g.globalAlpha = a;
    // hairline rule
    g.fillStyle = 'rgba(255,248,235,0.38)';
    g.fillRect(x, yBase - 46, 180 * Math.min(1, Math.max(0, (t - T.hud.fadeIn[0]) / 1.2)), 1);
    // chapter label
    const labelFont = `500 13px ${FONTS.sans}`;
    if (prev && since < 0.5) {
      this.glyphReveal(prev.label, x, yBase - 24, 1, { font: labelFont, spacing: 3.2, alpha: 0.72 * (1 - since / 0.5), color: '255,248,235' });
    }
    this.glyphReveal(ch.label, x, yBase - 24, Math.min(1, Math.max(0, (since - 0.15) / 1.1)), { font: labelFont, spacing: 3.2, alpha: 0.72, stagger: 0.05 });
    // year counter
    g.font = `500 24px ${FONTS.mono}`;
    g.letterSpacing = '1px';
    g.fillStyle = 'rgba(255,248,235,0.92)';
    const txt = T.hudText(t);
    if (txt === 'NOW') {
      const k = Math.min(1, Math.max(0, (t - T.typing.last) / 0.35));
      g.shadowColor = `rgba(255,236,200,${0.9 * (1 - k * 0.6)})`;
      g.shadowBlur = 18 * (1 - k * 0.5);
    }
    g.fillText(txt, x, yBase + 6);
    g.restore();
  }
}
