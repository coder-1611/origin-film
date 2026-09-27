// V · PALE BLUE: shared atmosphere model (planet units, R_ground = 1).
// Rayleigh + Mie single scattering with a precomputed transmittance LUT (Bruneton/Hillaire
// parameterisation). Scale heights are exaggerated ~2.8x relative to the real Earth so the
// limb reads at 330 px, with the scattering coefficients divided by the same factor so the
// vertical optical depth (and therefore sky colour) stays physically right.
// There is deliberately no ozone layer: 3.9 billion years ago there was no free oxygen.

export const ATMO_CONST = /* glsl */`
const float RG = 1.0;
const float RT = 1.042;
const float HR = 0.0042;                    // Rayleigh scale height (≈ 27 km visual)
const float HM = 0.0008;                    // Mie scale height
const vec3  BR = vec3(11.0, 25.7, 62.75);   // Rayleigh scattering per planet radius
const float BM = 7.2;                       // Mie scattering (a touch hazier than today)
const float BME = 8.0;                      // Mie extinction
const float MIE_G = 0.78;
// metres → planet units in the local (flat ocean) renderer: same exaggeration as HR.
const float M2R = 0.0042 / 8000.0;
`;

// LUT: x = mu mapping, y = altitude mapping. Rendered once at init.
export const LUT_FRAG = (glsl) => glsl.header + glsl.math + ATMO_CONST + /* glsl */`
in vec2 vUv; out vec4 fragColor;
void main() {
  float H = sqrt(RT * RT - RG * RG);
  float xr = vUv.y, xmu = vUv.x;
  float rho = H * xr;
  float r = sqrt(rho * rho + RG * RG);
  float dmin = RT - r, dmax = rho + H;
  float d = dmin + xmu * (dmax - dmin);
  float mu = d < 1e-7 ? 1.0 : (H * H - rho * rho - d * d) / (2.0 * r * d);
  mu = clamp(mu, -1.0, 1.0);
  // integrate optical depth from (r, mu) to the top of the atmosphere
  vec3 ro = vec3(0.0, r, 0.0), rd = vec3(sqrt(max(0.0, 1.0 - mu * mu)), mu, 0.0);
  const int N = 80;
  float dt = d / float(N);
  float tR = 0.0, tM = 0.0;
  for (int i = 0; i < N; i++) {
    vec3 p = ro + rd * (float(i) + 0.5) * dt;
    float h = max(0.0, length(p) - RG);
    tR += exp(-h / HR) * dt; tM += exp(-h / HM) * dt;
  }
  fragColor = vec4(exp(-(BR * tR + BME * tM)), 1.0);
}`;

// Runtime functions. Needs uniforms: uTrans (LUT), uSun, uAtmo (density scale 0..1),
// uHaze (Mie scale), uSunI (sun irradiance), uMS (multiple-scattering fudge).
export const ATMO_FUNCS = /* glsl */`
uniform sampler2D uTrans;
uniform vec3 uSun;
uniform float uAtmo, uHaze, uSunI, uMS;

vec2 lutUV(float r, float mu) {
  float H = sqrt(RT * RT - RG * RG);
  float rho = sqrt(max(0.0, r * r - RG * RG));
  float disc = r * r * (mu * mu - 1.0) + RT * RT;
  float d = max(0.0, -r * mu + sqrt(max(disc, 0.0)));
  float dmin = RT - r, dmax = rho + H;
  float xmu = (d - dmin) / max(dmax - dmin, 1e-6);
  float xr = rho / H;
  // texel-centre remap (256 x 64 LUT)
  return vec2(0.5 / 256.0 + xmu * (255.0 / 256.0), 0.5 / 64.0 + clamp(xr, 0.0, 1.0) * (63.0 / 64.0));
}
// Transmittance of sunlight reaching point p (planet units), incl. the planet's shadow
// with a soft penumbra (sun disc + a little artistic softening).
vec3 sunTrans(vec3 p) {
  float r = max(length(p), RG + 1e-6);
  float mu = dot(p, uSun) / r;
  vec3 T = texture(uTrans, lutUV(r, mu)).rgb;
  T = pow(max(T, vec3(1e-6)), vec3(uAtmo));
  float muH = -sqrt(max(0.0, 1.0 - (RG * RG) / (r * r)));
  return T * smoothstep(-0.010, 0.006, mu - muH);
}
float phaseR(float c) { return 0.0596831 * (1.0 + c * c); }
float phaseM(float c) {       // Cornette-Shanks
  float g = MIE_G, g2 = g * g;
  return 0.1193662 * (1.0 - g2) * (1.0 + c * c) / ((2.0 + g2) * pow(max(1.0 + g2 - 2.0 * g * c, 1e-4), 1.5));
}
// Single scattering along ro + rd * [t0, t1]. Returns in-scatter S (already × sun irradiance)
// and transmittance Tr. If tS in (t0, t1): also returns the in-scatter and transmittance
// accumulated up to tS (for compositing a cloud layer at that depth).
// dist: sample-distribution exponent (1 = uniform, 2 = denser near t0).
void atmoMarch(vec3 ro, vec3 rd, float t0, float t1, float tS, int N, float dist,
               out vec3 S, out vec3 Tr, out vec3 SS, out vec3 TS) {
  float c = dot(rd, uSun);
  float pr = phaseR(c), pm = phaseM(c);
  vec3 tau = vec3(0.0); S = vec3(0.0); SS = vec3(0.0); TS = vec3(1.0);
  bool split = tS > t0 && tS < t1;
  float span = t1 - t0;
  float prevT = t0;
  for (int i = 0; i < 64; i++) {
    if (i >= N) break;
    float u1 = pow((float(i) + 1.0) / float(N), dist);
    float tn = t0 + span * u1;
    float dt = tn - prevT;
    float tm = prevT + 0.5 * dt;
    vec3 p = ro + rd * tm;
    float r = length(p);
    float h = max(0.0, r - RG);
    float dR = exp(-h / HR) * uAtmo, dM = exp(-h / HM) * uAtmo * uHaze;
    vec3 ext = (BR * dR + BME * dM) * dt;
    vec3 Tv = exp(-(tau + 0.5 * ext));
    vec3 Ts = sunTrans(p);
    float muS = dot(p, uSun) / r;
    // cheap multiple-scattering term: isotropic, carries light a little past the terminator
    vec3 ms = uMS * vec3(0.55, 0.75, 1.0) * smoothstep(-0.28, 0.35, muS) * (0.25 + 0.75 * Ts.b);
    vec3 scat = (BR * dR * (pr * Ts + ms) + BM * dM * (pm * Ts + ms)) * dt;
    if (split && prevT < tS && tn >= tS) {
      // split inside this step: attribute proportionally
      float f = (tS - prevT) / dt;
      SS = S + Tv * scat * f;
      TS = exp(-(tau + ext * f));
    }
    S += Tv * scat;
    tau += ext;
    prevT = tn;
  }
  S *= uSunI; SS *= uSunI;
  Tr = exp(-tau);
  if (!split) { SS = S; TS = Tr; if (tS <= t0) { SS = vec3(0.0); TS = vec3(1.0); } }
}
`;
