// Per-frame audio features analysed from the mastered WAV (tools/analyze-audio.mjs):
// 32 log-spaced bands (30 Hz – 16 kHz), RMS and onset strength, all normalised to [0,1].
// Visuals read them through `at(t)`, alongside the symbolic note data in timeline.js.
export const NBANDS = 32;

export class Features {
  constructor() { this.ok = false; this.fps = 60; this.frames = 0; this.data = null; this.stride = NBANDS + 2; }

  async load(url) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error(res.status);
      const j = await res.json();
      const bin = atob(j.data);
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      this.data = u8; this.fps = j.fps; this.frames = j.frames; this.stride = j.stride;
      this.onsets = j.onsets || [];
      this.ok = true;
    } catch (e) {
      console.warn('[features] not available yet: visuals get zeros', String(e));
    }
    return this;
  }

  /** Features at time t (linear interpolation between analysis frames). */
  at(t) {
    const out = { bands: new Float32Array(NBANDS), rms: 0, onset: 0, low: 0, mid: 0, high: 0 };
    if (!this.ok) return out;
    const f = Math.max(0, Math.min(this.frames - 1.001, t * this.fps));
    const i = Math.floor(f), u = f - i, s = this.stride, d = this.data;
    const a = i * s, b = (i + 1) * s;
    for (let k = 0; k < NBANDS; k++) out.bands[k] = (d[a + k] * (1 - u) + d[b + k] * u) / 255;
    out.rms = (d[a + NBANDS] * (1 - u) + d[b + NBANDS] * u) / 255;
    out.onset = (d[a + NBANDS + 1] * (1 - u) + d[b + NBANDS + 1] * u) / 255;
    let lo = 0, mi = 0, hi = 0;
    for (let k = 0; k < 8; k++) lo += out.bands[k];
    for (let k = 8; k < 20; k++) mi += out.bands[k];
    for (let k = 20; k < 32; k++) hi += out.bands[k];
    out.low = lo / 8; out.mid = mi / 12; out.high = hi / 12;
    return out;
  }
}
