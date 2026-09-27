// Title assets for chapter I, built once at init from real Cormorant Garamond glyphs:
//   * an SDF atlas (one cell per glyph of ORIGIN), 2x supersampled against 1080p
//   * the glyph layout (ink centres in H units, relative to the screen centre)
//   * speck targets: points sampled from each glyph's ink, used by the converge animation
//   * the subtitle as an alpha texture at the render resolution
import { mulberry32 } from '../../timeline.js';

export const TITLE = 'ORIGIN';
export const DESIGN_PX = 150;          // title size at 1080p
export const ATLAS_SCALE = 2;          // atlas px per design px
export const TRACKING = 0.46;          // extra space between glyphs, in em
export const SPREAD = 40;              // SDF spread in atlas px
export const CELL = 448;               // atlas cell (square), atlas px
export const SPECKS_PER_GLYPH = 1400;

// Felzenszwalb & Huttenlocher 1D squared EDT (as used by Mapbox TinySDF).
function edt1d(grid, offset, stride, length, f, v, z) {
  v[0] = 0; z[0] = -1e20; z[1] = 1e20;
  for (let q = 0; q < length; q++) f[q] = grid[offset + q * stride];
  for (let q = 1, k = 0, s = 0; q < length; q++) {
    do {
      const r = v[k];
      s = (f[q] - f[r] + q * q - r * r) / (q - r) / 2;
    } while (s <= z[k] && --k > -1);
    k++; v[k] = q; z[k] = s; z[k + 1] = 1e20;
  }
  for (let q = 0, k = 0; q < length; q++) {
    while (z[k + 1] < q) k++;
    const r = v[k], qr = q - r;
    grid[offset + q * stride] = f[r] + qr * qr;
  }
}
function edt(grid, w, h) {
  const n = Math.max(w, h);
  const f = new Float64Array(n), v = new Uint16Array(n), z = new Float64Array(n + 1);
  for (let x = 0; x < w; x++) edt1d(grid, x, w, h, f, v, z);
  for (let y = 0; y < h; y++) edt1d(grid, y * w, 1, w, f, v, z);
}

export function buildTitle(ctx) {
  const { THREE, FONTS, W, H } = ctx;
  const font = (px) => `300 ${px}px ${FONTS.serif}`;
  // --- layout at design size (1080p px) ---
  const m = document.createElement('canvas').getContext('2d');
  m.font = font(DESIGN_PX);
  const capH = m.measureText('I').actualBoundingBoxAscent;
  const glyphs = [...TITLE].map(ch => {
    const mm = m.measureText(ch);
    return { ch, adv: mm.width, l: mm.actualBoundingBoxLeft, r: mm.actualBoundingBoxRight };
  });
  const track = TRACKING * DESIGN_PX;
  const total = glyphs.reduce((a, g) => a + g.adv, 0) + track * (glyphs.length - 1);
  let pen = -total / 2;
  for (const g of glyphs) {
    g.cx = pen + (g.r - g.l) / 2;            // ink centre x (design px, relative to centre)
    pen += g.adv + track;
  }
  // --- atlas: each glyph ink-centred in its cell, at 2x ---
  const AW = CELL * glyphs.length, AH = CELL;
  const cv = document.createElement('canvas');
  cv.width = AW; cv.height = AH;
  const g2 = cv.getContext('2d', { willReadFrequently: true });
  g2.fillStyle = '#fff';
  g2.font = font(DESIGN_PX * ATLAS_SCALE);
  g2.textBaseline = 'alphabetic';
  g2.textAlign = 'left';
  glyphs.forEach((g, i) => {
    const cx = i * CELL + CELL / 2, cy = CELL / 2;
    const x = cx - (g.r - g.l) / 2 * ATLAS_SCALE;
    const y = cy + capH / 2 * ATLAS_SCALE;
    g2.fillText(g.ch, x, y);
  });
  const img = g2.getImageData(0, 0, AW, AH).data;
  const N = AW * AH, INF = 1e20;
  const outer = new Float64Array(N), inner = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const a = img[i * 4 + 3] / 255;
    if (a >= 0.999) { outer[i] = 0; inner[i] = INF; }
    else if (a <= 0.001) { outer[i] = INF; inner[i] = 0; }
    else { const d = 0.5 - a; outer[i] = d > 0 ? d * d : 0; inner[i] = d < 0 ? d * d : 0; }
  }
  edt(outer, AW, AH); edt(inner, AW, AH);
  const sdf = new Uint8Array(N * 4);
  for (let i = 0; i < N; i++) {
    const d = Math.sqrt(outer[i]) - Math.sqrt(inner[i]);          // + outside, − inside
    const v = Math.max(0, Math.min(255, Math.round((0.5 - d / (2 * SPREAD)) * 255)));
    sdf[i * 4] = v; sdf[i * 4 + 1] = v; sdf[i * 4 + 2] = v; sdf[i * 4 + 3] = 255;
  }
  const atlas = new THREE.DataTexture(sdf, AW, AH, THREE.RGBAFormat, THREE.UnsignedByteType);
  atlas.minFilter = THREE.LinearFilter; atlas.magFilter = THREE.LinearFilter;
  atlas.wrapS = atlas.wrapT = THREE.ClampToEdgeWrapping;
  atlas.generateMipmaps = false; atlas.flipY = false; atlas.colorSpace = THREE.NoColorSpace;
  atlas.needsUpdate = true;

  // --- speck targets: sampled from the glyph ink (glyph-local, H units, y up) ---
  const rnd = mulberry32(0x0816ab);
  const targets = [];
  glyphs.forEach((g, i) => {
    const x0 = i * CELL, got = [];
    let guard = 0;
    while (got.length < SPECKS_PER_GLYPH && guard++ < 400000) {
      const px = x0 + rnd() * CELL, py = rnd() * CELL;
      const a = img[((py | 0) * AW + (px | 0)) * 4 + 3];
      if (a > 150) got.push([(px - x0 - CELL / 2) / (ATLAS_SCALE * 1080), -(py - CELL / 2) / (ATLAS_SCALE * 1080)]);
    }
    for (const p of got) targets.push({ glyph: i, x: p[0], y: p[1] });
  });

  // --- subtitle texture at render resolution ---
  const s = H / 1080;
  const subText = '13.8 billion years  ·  one unbroken shot';
  const subPx = 30 * s;
  const sc = document.createElement('canvas');
  sc.width = W; sc.height = Math.ceil(90 * s);
  const sg = sc.getContext('2d');
  sg.font = `italic 300 ${subPx}px ${FONTS.serif}`;
  sg.letterSpacing = `${(0.16 * subPx).toFixed(2)}px`;
  sg.fillStyle = '#fff';
  sg.textAlign = 'center';
  sg.textBaseline = 'middle';
  sg.fillText(subText, W / 2 + 0.08 * subPx, sc.height / 2);
  const subW = sg.measureText(subText).width;
  const subTex = new THREE.CanvasTexture(sc);
  subTex.flipY = false; subTex.colorSpace = THREE.NoColorSpace;
  subTex.minFilter = THREE.LinearFilter; subTex.magFilter = THREE.LinearFilter; subTex.generateMipmaps = false;
  subTex.needsUpdate = true;

  return {
    glyphs: glyphs.map(g => ({ ch: g.ch, x: g.cx / 1080 })),   // H units
    capH: capH / 1080,
    atlas, atlasSize: [AW, AH],
    targets,
    subTex, subSize: [sc.width, sc.height], subHalfW: subW / 2 / H,  // H units
  };
}
