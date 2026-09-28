// VI · LIFE: world layout shared by JS (placement, event unprojection) and the shaders.
// Units are metres. y is up, the sea surface is y = 0, the over-under shot looks toward -z.
export const DEG = Math.PI / 180;

// Hero stromatolite: an ellipsoidal cap whose front face carries the live Gray-Scott colony.
export const HERO = { c: [0.0, -0.67, -2.2], r: [0.78, 0.45, 0.70] };
export const PATCH_TILT = 12 * DEG;                      // the patch faces 12° up
// Patch centre on the ellipsoid where the surface normal is tilted PATCH_TILT upward.
const phi = Math.atan(Math.tan(PATCH_TILT) * HERO.r[1] / HERO.r[2]);
export const P0 = [HERO.c[0], HERO.c[1] + HERO.r[1] * Math.sin(phi), HERO.c[2] + HERO.r[2] * Math.cos(phi)];
export const N0 = [0, Math.sin(PATCH_TILT), Math.cos(PATCH_TILT)];
export const TX = [1, 0, 0];
export const TY = [0, Math.cos(PATCH_TILT), -Math.sin(PATCH_TILT)];
export const PATCH = 0.62;                               // live RD domain edge length (m)

export const RD_T0 = 105.0, RD_T1 = 114.6;               // RD is simulated inside this window

/** Patch uv (0..1) of a world point, planar projection along N0. */
export function patchUV(p) {
  const d = [p[0] - P0[0], p[1] - P0[1], p[2] - P0[2]];
  return [(d[0] * TX[0] + d[1] * TX[1] + d[2] * TX[2]) / PATCH + 0.5, (d[0] * TY[0] + d[1] * TY[1] + d[2] * TY[2]) / PATCH + 0.5];
}
/** Ray / hero-ellipsoid intersection (nearest t, or -1). */
export function hitHero(ro, rd) {
  const [a, b, c] = HERO.r;
  const o = [(ro[0] - HERO.c[0]) / a, (ro[1] - HERO.c[1]) / b, (ro[2] - HERO.c[2]) / c];
  const d = [rd[0] / a, rd[1] / b, rd[2] / c];
  const A = d[0] * d[0] + d[1] * d[1] + d[2] * d[2], B = o[0] * d[0] + o[1] * d[1] + o[2] * d[2], C = o[0] * o[0] + o[1] * o[1] + o[2] * o[2] - 1;
  const h = B * B - A * C;
  if (h < 0) return -1;
  return (-B - Math.sqrt(h)) / A;
}

// Sun: fixed azimuth (to the right of -z), elevation falling to the horizon at the end.
export const SUN_AZ = 50 * DEG;
export const SUN_R = 0.0135;                             // angular radius (rad), matches GL_SKY
export function sunElev(t, pwl) {
  // golden afternoon over the sprouting forest → low for the breach → sitting on the horizon for the
  // march (sinking slowly) → its top limb meets the horizon as the torch catches (151.0)
  const R = SUN_R / DEG;
  return pwl([[105, 20], [114, 11], [120, 8.2], [124, 5.6], [126, 4.0], [127.6, 1.25], [138, 0.95], [146, 0.6], [150, 0.05], [151.0, -R], [151.6, -1.4], [157, -3]], t) * DEG;
}
export function sunDir(t, pwl) {
  const e = sunElev(t, pwl);
  return [Math.sin(SUN_AZ) * Math.cos(e), Math.sin(e), -Math.cos(SUN_AZ) * Math.cos(e)];
}
