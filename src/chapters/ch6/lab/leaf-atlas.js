// VI lab: a procedural leaf atlas, drawn on the CPU at init (deterministic, no image files).
// Four blades side by side, each 128×256 (blade base at v = 0, tip at v = 1):
//   0 ovate-acuminate, serrate (linden / birch)    1 elliptic, entire margin, asymmetric base
//   2 broad, doubly serrate (elm / hazel)          3 cotyledon (round seed leaf)
// Channels: R = albedo multiplier (mottling + lighter veins in reflection), G = vein mask (veins
// read DARK in transmission: that is what a backlit leaf looks like), B = distance to the margin
// (0 at the edge → 1 inside; drives edge yellowing), A = coverage (anti-aliased).
import * as THREE from '../../../vendor/three.module.js';
import { vnoise3 } from './rng.js';

export const ATLAS_VARIANTS = 4;
const CW = 128, CH = 256;

function profile(kind, y) {
  // half-width (in blade widths) as a function of v; the blade is ~0.5 as wide as it is long
  const yy = Math.min(Math.max(y, 0), 1);
  switch (kind) {
    case 0: return 0.46 * Math.pow(Math.sin(Math.PI * Math.pow(yy, 0.72)), 0.85) * (1 - 0.35 * Math.pow(yy, 6));
    case 1: return 0.36 * Math.pow(Math.sin(Math.PI * Math.pow(yy, 0.9)), 0.75);
    case 2: return 0.50 * Math.pow(Math.sin(Math.PI * Math.pow(yy, 0.62)), 0.8) * (1 - 0.3 * Math.pow(yy, 5));
    default: return 0.62 * Math.pow(Math.max(0, Math.sin(Math.PI * Math.pow(yy, 0.95))), 0.55);
  }
}
function teeth(kind, y, side) {
  // serration: a sawtooth leaning toward the tip (0 = no tooth, positive = notch depth)
  if (kind === 3 || kind === 1) return kind === 1 ? 0.004 * Math.sin(y * 60 + side) : 0;
  const n = kind === 0 ? 26 : 20;
  const f = (y * n + (side > 0 ? 0.37 : 0)) % 1;
  let d = (kind === 0 ? 0.022 : 0.03) * Math.pow(f, 1.6);
  if (kind === 2) d += 0.012 * Math.pow((y * n * 0.5 + 0.2) % 1, 2);   // doubly serrate
  return d * Math.min(1, y * 6) * Math.min(1, (1 - y) * 8);
}

/** Returns { texture, variants }: RGBA8 atlas with mipmaps. */
export function makeLeafAtlas() {
  const W = CW * ATLAS_VARIANTS, H = CH;
  const data = new Uint8Array(W * H * 4);
  const SS = 3;  // supersampling per texel for the coverage
  for (let k = 0; k < ATLAS_VARIANTS; k++) {
    for (let py = 0; py < CH; py++) for (let px = 0; px < CW; px++) {
      let cov = 0, vein = 0, alb = 0, edge = 0;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        // blade space: x in [-0.5, 0.5] (blade widths), y in [0, 1]; 6% margin all round
        const u = (px + (sx + 0.5) / SS) / CW, v = (py + (sy + 0.5) / SS) / CH;
        const x = (u - 0.5) * 1.12, y = (v - 0.03) / 0.94;
        const side = x < 0 ? -1 : 1;
        // asymmetric base for kind 1 (like elm/linden bases)
        const asym = k === 1 ? (side > 0 ? 1.0 : 0.9) : (k === 2 ? (side > 0 ? 1.0 : 0.94) : 1.0);
        const w = profile(k, y) * asym - teeth(k, y, side);
        const inside = y > 0 && y < 1 && Math.abs(x) < w;
        if (!inside) continue;
        cov += 1;
        const ax = Math.abs(x);
        // veins: midrib + pinnate secondaries curving toward the tip
        const mid = Math.max(0, 1 - ax / (k === 3 ? 0.012 : 0.016 * (1.2 - y)));
        let sec = 0;
        const nSec = k === 3 ? 3 : (k === 1 ? 7 : 9);
        for (let i = 1; i <= nSec; i++) {
          const y0 = (i / (nSec + 1)) * 0.92 - 0.02;
          const yc = y0 + ax * (k === 3 ? 0.9 : 1.15) + ax * ax * 0.8;   // curving up toward the margin
          const dd = Math.abs(y - yc) / 0.006;
          if (ax < w * 0.93) sec = Math.max(sec, Math.max(0, 1 - dd) * (1 - ax / (w + 1e-3) * 0.6));
        }
        const vv = Math.max(mid, sec * 0.8);
        vein += vv;
        // mottling: a little low-frequency blotch + fine grain
        const n1 = vnoise3(x * 9 + k * 13, y * 18, 0.5, 11), n2 = vnoise3(x * 40, y * 80, 1.5, 12);
        alb += 0.84 + 0.14 * n1 + 0.06 * n2 + 0.12 * vv;
        edge += Math.min(1, (w - ax) / 0.06);
      }
      const o = ((py) * W + k * CW + px) * 4;
      const n = SS * SS;
      if (cov > 0) {
        data[o] = Math.round(Math.min(1, alb / cov / 1.2) * 255);
        data[o + 1] = Math.round(Math.min(1, vein / cov) * 255);
        data[o + 2] = Math.round(Math.min(1, edge / cov) * 255);
      } else {
        // bleed the average interior colour into empty texels so mips don't darken the rim
        data[o] = 180; data[o + 1] = 0; data[o + 2] = 0;
      }
      data[o + 3] = Math.round(cov / n * 255);
    }
  }
  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.colorSpace = THREE.NoColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return { texture: tex, variants: ATLAS_VARIANTS, size: [W, H] };
}
