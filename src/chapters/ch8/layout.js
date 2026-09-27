// VIII · THE PROMPT: shared physical layout (metres, world y-up, desk top at y = 0, laptop
// centred on x = 0 with its front edge towards +z). Pure numbers and pure functions: imported by
// the scene builder, the screen UI and by Node tools (camera keyframe solving).

export const DEG = Math.PI / 180;

// ---------------------------------------------------------------- laptop body
export const BASE = { w: 0.3126, d: 0.2050, h: 0.0105, planR: 0.0105, edgeR: 0.0034 };
export const LID = { w: 0.3126, h: 0.2010, t: 0.0050, planR: 0.0105, edgeR: 0.0021, y0: 0.0036, zc: -0.0006 };
export const LID_TILT = 20 * DEG;                        // opened to 110°: the lid leans back 20°
export const HINGE = { y: BASE.h + 0.0010, z: -BASE.d / 2 + 0.0046, r: 0.0041, len: 0.262 };

// Display: exactly 16:9 so it can fill the film frame head-on at the end of the recursion.
export const DISPLAY = { w: 0.2944, h: 0.2944 * 9 / 16, top: 0.0092 };
DISPLAY.chin = LID.h - DISPLAY.h - DISPLAY.top;
DISPLAY.yc = LID.y0 + DISPLAY.chin + DISPLAY.h / 2;       // lid-local centre height
DISPLAY.z = LID.zc + LID.t / 2 + 0.00012;                 // lid-local face (just proud of the glass)

// Lid-local → world. Lid local frame: origin on the hinge axis, +y up the lid, +z out of the display.
export function lidToWorld([x, y, z]) {
  const c = Math.cos(-LID_TILT), s = Math.sin(-LID_TILT);
  return [x, HINGE.y + y * c - z * s, HINGE.z + y * s + z * c];
}
export const SCREEN_N = [0, Math.sin(LID_TILT), Math.cos(LID_TILT)];     // display normal (world)
export const SCREEN_UP = [0, Math.cos(LID_TILT), -Math.sin(LID_TILT)];   // display up (world)
export const SCREEN_C = lidToWorld([0, DISPLAY.yc, DISPLAY.z]);          // display centre (world)
/** Display uv (u right, v DOWN, as in the canvas) → world point. */
export function displayToWorld(u, v) {
  return lidToWorld([(u - 0.5) * DISPLAY.w, DISPLAY.yc + (0.5 - v) * DISPLAY.h, DISPLAY.z]);
}
/** Camera pose that sees the display head-on, filling a frame of vertical fov `fovDeg` exactly. */
export function headOnPose(fovDeg, fill = 1) {
  const d = (DISPLAY.h / 2) / Math.tan(fovDeg * DEG / 2) / fill;
  return { pos: SCREEN_C.map((c, i) => c + SCREEN_N[i] * d), target: [...SCREEN_C], fov: fovDeg, d };
}

// ---------------------------------------------------------------- keyboard
// Key pitch u; rows listed back → front. Columns are in key units from the left edge, matching
// the timeline's keyX model: keyX = (col − 7) / 7.5 where col is a key's left edge.
export const KB = { u: 0.0185, gap: 0.0027, cap: 0.00095, travel: 0.0013, zBack: -0.0850 };
KB.width = 14.5 * KB.u;
KB.x0 = -KB.width / 2;
export const ROW_Z = (() => {
  const fnD = 0.0092, keyD = KB.u - KB.gap;
  const z = [KB.zBack + fnD / 2];                        // fn row (half height)
  let c = KB.zBack + fnD + KB.gap + keyD / 2;
  for (let r = 0; r < 5; r++) { z.push(c); c += KB.u; }
  return z;                                               // [fn, row0 … row4]
})();
export const FN_D = 0.0092;

// Key list: { id, label, sub?, row (-1 = fn, 0..4), col (left edge, in u), w (in u), small? }
export const KEYS = (() => {
  const k = [];
  const add = (row, col, w, label, extra = {}) => k.push({ row, col, w, label, ...extra });
  // fn row: esc (1.5u), F1–F12, Touch ID
  add(-1, 0, 1.5, 'esc', { small: true, align: 'left' });
  for (let i = 1; i <= 12; i++) add(-1, 1.5 + (i - 1), 1, 'F' + i, { small: true });
  add(-1, 13.5, 1, '', { touchId: true });
  // number row
  const r0 = '`1234567890-=', r0s = '~!@#$%^&*()_+';
  for (let i = 0; i < 13; i++) add(0, i, 1, r0[i], { sub: r0s[i], ch: r0[i] });
  add(0, 13, 1.5, 'delete', { small: true, align: 'right' });
  // qwerty
  add(1, 0, 1.5, 'tab', { small: true, align: 'left' });
  const r1 = 'qwertyuiop[]\\', r1s = 'QWERTYUIOP{}|';
  for (let i = 0; i < 13; i++) add(1, 1.5 + i, 1, i < 10 ? r1s[i] : r1[i], { sub: i < 10 ? null : r1s[i], ch: r1[i] });
  // asdf
  add(2, 0, 1.8, 'caps lock', { small: true, align: 'left' });
  const r2 = "asdfghjkl;'", r2s = 'ASDFGHJKL:"';
  for (let i = 0; i < 11; i++) add(2, 1.8 + i, 1, i < 9 ? r2s[i] : r2[i], { sub: i < 9 ? null : r2s[i], ch: r2[i] });
  add(2, 12.8, 1.7, 'return', { small: true, align: 'right', enter: true });
  // zxcv
  add(3, 0, 2.3, 'shift', { small: true, align: 'left', shift: true });
  const r3 = 'zxcvbnm,./', r3s = 'ZXCVBNM<>?';
  for (let i = 0; i < 10; i++) add(3, 2.3 + i, 1, i < 7 ? r3s[i] : r3[i], { sub: i < 7 ? null : r3s[i], ch: r3[i] });
  add(3, 12.3, 2.2, 'shift', { small: true, align: 'right', shift: true });
  // bottom row
  add(4, 0, 1, 'fn', { small: true, align: 'left' });
  add(4, 1, 1, 'control', { small: true, align: 'left' });
  add(4, 2, 1, 'option', { small: true, align: 'left' });
  add(4, 3, 1.25, 'command', { small: true, align: 'left' });
  add(4, 4.25, 5, '', { space: true });
  add(4, 9.25, 1.25, 'command', { small: true, align: 'right' });
  add(4, 10.5, 1, 'option', { small: true, align: 'right' });
  add(4, 11.5, 1, '◀', { arrow: 'l', half: 'low' });
  add(4, 12.5, 1, '▲', { arrow: 'u', half: 'high' });
  add(4, 12.5, 1, '▼', { arrow: 'd', half: 'low' });
  add(4, 13.5, 1, '▶', { arrow: 'r', half: 'low' });
  k.forEach((key, i) => { key.id = i; });
  return k;
})();

/** World-space centre + size of a key (x, z, width, depth). */
export function keyRect(key) {
  const w = key.w * KB.u - KB.gap;
  let x = KB.x0 + (key.col + key.w / 2) * KB.u;
  let z, d;
  if (key.row < 0) { z = ROW_Z[0]; d = FN_D; }
  else {
    z = ROW_Z[key.row + 1]; d = KB.u - KB.gap;
    if (key.half) { const hd = (d - 0.0012) / 2; d = hd; z += key.half === 'high' ? -(hd + 0.0012) / 2 : (hd + 0.0012) / 2; }
  }
  return { x, z, w, d };
}

/** Key index for a typed character, from the timeline's (keyX, keyRow) model. */
export function keyForTyped(keyX, keyRow) {
  const col = keyX * 7.5 + 7;
  if (keyRow >= 4) return KEYS.findIndex(k => k.space);
  let best = -1, bd = 1e9;
  for (const k of KEYS) {
    if (k.row !== keyRow || k.half) continue;
    const d = Math.abs(k.col - col);
    if (d < bd) { bd = d; best = k.id; }
  }
  return best;
}

// Keyboard well (black tray) and trackpad.
export const WELL = { x: 0, z: (KB.zBack - 0.0030 + ROW_Z[5] + (KB.u - KB.gap) / 2 + 0.0030) / 2, w: KB.width + 0.0060, r: 0.0035 };
WELL.d = (ROW_Z[5] + (KB.u - KB.gap) / 2 + 0.0030) - (KB.zBack - 0.0030);
export const PAD = { w: 0.1300, d: 0.0680, r: 0.0060 };
PAD.z = ROW_Z[5] + (KB.u - KB.gap) / 2 + 0.0090 + PAD.d / 2;

// ---------------------------------------------------------------- screen canvas (editor) layout
export const CANVAS = { w: 1920, h: 1080 };
export const ED = {
  tabH: 64, statusH: 46, gutterW: 132, textX: 158, top: 18,
  font: 44, lineH: 66, charW: 44 * 0.6, cols: 61, minimapW: 118,
};
ED.areaTop = ED.tabH;
ED.areaBot = CANVAS.h - ED.statusH;
ED.visLines = (ED.areaBot - ED.areaTop - ED.top) / ED.lineH;
/** Canvas-pixel centre of the caret cell at (visual line, column) with scroll (in lines). */
export function caretCanvas(line, col, scroll = 0) {
  return [ED.textX + (col + 0.5) * ED.charW, ED.areaTop + ED.top + (line - scroll + 0.5) * ED.lineH];
}
