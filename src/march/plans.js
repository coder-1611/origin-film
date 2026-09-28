// ORIGIN · VI march timing: the TIME STRUCTURE of the synthesised voices whose recipes don't export
// it (src/audio/nature/voices.js). Each function replays exactly the same seeded draws, in the same
// order, as the voice's own planning loop, so a gesture (a chest pump on each pant, a gaping hiss)
// lands on the sound the audio engine renders from the same seed. Verified against the rendered
// audio (see tools/verify notes in the VI report). Pure JS.
import { mulberry32, gauss, clamp, lerp } from '../audio/nature/dsp.js';

export const lognorm = (R, m, s) => m * Math.exp(s * gauss(R));

/**
 * pantHoot(sr, { seed, full }) → its element list, times relative to the call's start:
 *   { intro: [{t, d}], pants: [{t, d, inhale: [t, d]}], climax: [{t, d}], letdown: [{t, d}], end }
 */
export function pantHootPlan({ seed = 1, full = true } = {}) {
  const R = mulberry32(seed);
  const intro = [], pants = [], climax = [], letdown = [];
  let t = 0.05;
  if (full) for (let k = 0; k < 3 + Math.floor(R() * 2); k++) { const d = 0.25 + 0.15 * R(); R(); intro.push({ t, d }); t += d + 0.15 + 0.15 * R(); }
  const nb = 5 + Math.floor(R() * 3);
  for (let k = 0; k < nb; k++) {
    const u = k / (nb - 1), per = lerp(1 / 3, 1 / 6, u) * (1 + 0.08 * gauss(R));
    gauss(R);                                                          // (the voice draws the pant's f0 here)
    pants.push({ t, d: per * 0.55, inhale: [t + per * 0.58, per * 0.38] });
    t += per;
  }
  t += 0.03;
  for (let k = 0; k < 2 + Math.floor(R() * 2); k++) { const d = 0.25 + 0.25 * R(); R(); R(); climax.push({ t, d }); t += d + 0.08 + 0.1 * R(); }
  for (let k = 0; k < 2; k++) { const d = 0.2 + 0.1 * R(); letdown.push({ t, d }); t += d + 0.18 + 0.1 * k; }
  return { intro, pants, climax, letdown, end: t };
}

/** lizardHiss(sr, { seed, count }) → [[t, d], …] relative to the call's start. */
export function lizardHissPlan({ seed = 1, count = 2 } = {}) {
  const R = mulberry32(seed), plan = [];
  let t = 0.05;
  for (let k = 0; k < count; k++) { const d = clamp(lognorm(R, k ? 0.55 : 0.95, 0.25), 0.4, 1.5); plan.push([t, d]); t += d + 0.3 + 0.3 * R(); }
  return plan;
}

/** foxBarks(sr, { seed, count }) → [[t, d], …] relative to the call's start. */
export function foxBarksPlan({ seed = 1, count = 4 } = {}) {
  const R = mulberry32(seed), plan = [];
  let t = 0.05;
  for (let k = 0; k < count; k++) { const d = 0.12 + 0.08 * R(); plan.push([t, d]); t += d + clamp(0.35 + 0.06 * k + 0.12 * R(), 0.3, 0.75); }
  return plan;
}
