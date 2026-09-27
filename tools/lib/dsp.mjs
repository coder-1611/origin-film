// Audio DSP for mastering, analysis and verification (pure JS, Float32 interleaved stereo).
import fs from 'node:fs';

export function readF32(path) { const b = fs.readFileSync(path); return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4).slice(); }

export function writeWavF32(path, inter, sr, ch = 2) {
  const data = Buffer.from(inter.buffer, inter.byteOffset, inter.byteLength);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(3, 20); h.writeUInt16LE(ch, 22);
  h.writeUInt32LE(sr, 24); h.writeUInt32LE(sr * ch * 4, 28); h.writeUInt16LE(ch * 4, 32); h.writeUInt16LE(32, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  fs.writeFileSync(path, Buffer.concat([h, data]));
}

export function readWav(path) {
  const b = fs.readFileSync(path);
  let p = 12, fmt = null, data = null;
  while (p < b.length - 8) {
    const id = b.toString('ascii', p, p + 4), sz = b.readUInt32LE(p + 4);
    if (id === 'fmt ') fmt = { format: b.readUInt16LE(p + 8), ch: b.readUInt16LE(p + 10), sr: b.readUInt32LE(p + 12), bits: b.readUInt16LE(p + 22) };
    if (id === 'data') data = b.subarray(p + 8, p + 8 + sz);
    p += 8 + sz + (sz & 1);
  }
  let inter;
  if (fmt.format === 3) inter = new Float32Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.length));
  else if (fmt.bits === 16) { inter = new Float32Array(data.length / 2); for (let i = 0; i < inter.length; i++) inter[i] = data.readInt16LE(i * 2) / 32768; }
  else throw new Error('unsupported wav');
  return { ...fmt, inter };
}

/** Decode any media file's audio to float32 interleaved stereo via ffmpeg. */
export async function decodeAudio(file, sr = 48000) {
  const { execFileSync } = await import('node:child_process');
  const buf = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'f32le', '-ac', '2', '-ar', String(sr), '-'], { maxBuffer: 1 << 30 });
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4).slice();
}

// ---------------------------------------------------------------- BS.1770-4 loudness
function biquad(x, b, a) {
  const y = new Float64Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = b[0] * x[i] + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
  }
  return y;
}
const KW = { // 48 kHz coefficients from ITU-R BS.1770
  s1b: [1.53512485958697, -2.69169618940638, 1.19839281085285], s1a: [1, -1.69065929318241, 0.73248077421585],
  s2b: [1.0, -2.0, 1.0], s2a: [1, -1.99004745483398, 0.99007225036621],
};
export function integratedLoudness(inter, sr = 48000) {
  if (sr !== 48000) throw new Error('K-weighting coefficients are for 48 kHz');
  const n = inter.length / 2;
  const chans = [0, 1].map(c => { const x = new Float64Array(n); for (let i = 0; i < n; i++) x[i] = inter[2 * i + c]; return biquad(biquad(x, KW.s1b, KW.s1a), KW.s2b, KW.s2a); });
  const blk = Math.round(0.4 * sr), hop = Math.round(0.1 * sr);
  const z = [];
  for (let s = 0; s + blk <= n; s += hop) {
    let e = 0;
    for (const y of chans) { let a = 0; for (let i = s; i < s + blk; i++) a += y[i] * y[i]; e += a / blk; }
    z.push(e);
  }
  const L = (e) => -0.691 + 10 * Math.log10(e);
  const abs = z.filter(e => L(e) > -70);
  const mean = (a) => a.reduce((p, q) => p + q, 0) / a.length;
  const rel = L(mean(abs)) - 10;
  const gated = abs.filter(e => L(e) > rel);
  return L(mean(gated));
}

// ---------------------------------------------------------------- true peak (4× oversampling)
const OS = 4, TAPS = 12;          // 12 taps per phase → 48-tap windowed-sinc interpolator
const PH = (() => {
  const ph = [];
  for (let p = 0; p < OS; p++) {
    const h = new Float64Array(TAPS);
    for (let k = 0; k < TAPS; k++) {
      const x = (k - TAPS / 2 + 1) - p / OS;          // distance in input samples
      const sinc = Math.abs(x) < 1e-9 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
      const w = 0.42 + 0.5 * Math.cos(Math.PI * x / (TAPS / 2)) + 0.08 * Math.cos(2 * Math.PI * x / (TAPS / 2));
      h[k] = sinc * Math.max(0, w);
    }
    ph.push(h);
  }
  return ph;
})();
/** Per-sample true-peak estimate (max |oversampled| in the interval following each sample), one channel. */
export function tpEnvelope(x) {
  const n = x.length, out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let m = Math.abs(x[i]);
    for (let p = 1; p < OS; p++) {
      const h = PH[p]; let s = 0;
      for (let k = 0; k < TAPS; k++) { const j = i + k - TAPS / 2 + 1; if (j >= 0 && j < n) s += h[k] * x[j]; }
      m = Math.max(m, Math.abs(s));
    }
    out[i] = m;
  }
  return out;
}
export function truePeakDb(inter) {
  const n = inter.length / 2; let m = 0;
  for (let c = 0; c < 2; c++) { const x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = inter[2 * i + c]; const e = tpEnvelope(x); for (let i = 0; i < n; i++) if (e[i] > m) m = e[i]; }
  return 20 * Math.log10(m);
}

// ---------------------------------------------------------------- dynamics (circular)
/** Wrap-around extension so processing sees the loop as continuous. */
function circularRun(inter, pad, fn) {
  const n = inter.length / 2, P = Math.min(pad, n);
  const ext = new Float32Array((n + 2 * P) * 2);
  ext.set(inter.subarray((n - P) * 2), 0); ext.set(inter, P * 2); ext.set(inter.subarray(0, P * 2), (n + P) * 2);
  const out = fn(ext);
  return out.slice(P * 2, (P + n) * 2);
}

/** Stereo-linked RMS glue compressor. */
export function glueCompress(inter, sr, { threshold = -18, ratio = 2.5, attack = 0.02, release = 0.25, makeup = 0 } = {}) {
  return circularRun(inter, sr * 2, (x) => {
    const n = x.length / 2, out = new Float32Array(x.length);
    const aA = Math.exp(-1 / (attack * sr)), aR = Math.exp(-1 / (release * sr)), aRms = Math.exp(-1 / (0.03 * sr));
    let ms = 0, gDb = 0;
    for (let i = 0; i < n; i++) {
      const l = x[2 * i], r = x[2 * i + 1];
      ms = aRms * ms + (1 - aRms) * 0.5 * (l * l + r * r);
      const lev = 10 * Math.log10(ms + 1e-12);
      const over = lev - threshold;
      const target = over > 0 ? -over * (1 - 1 / ratio) : 0;
      gDb = target < gDb ? aA * gDb + (1 - aA) * target : aR * gDb + (1 - aR) * target;
      const g = Math.pow(10, (gDb + makeup) / 20);
      out[2 * i] = l * g; out[2 * i + 1] = r * g;
    }
    return out;
  });
}

/** Lookahead true-peak limiter (stereo-linked): min over lookahead, box smoothing, slow release. */
export function tpLimit(inter, sr, { ceilingDb = -1.5, lookahead = 0.005, release = 0.08 } = {}) {
  const ceil = Math.pow(10, ceilingDb / 20);
  return circularRun(inter, sr * 2, (x) => {
    const n = x.length / 2;
    const L = new Float32Array(n), R = new Float32Array(n);
    for (let i = 0; i < n; i++) { L[i] = x[2 * i]; R[i] = x[2 * i + 1]; }
    const eL = tpEnvelope(L), eR = tpEnvelope(R);
    const need = new Float32Array(n);
    for (let i = 0; i < n; i++) { const pk = Math.max(eL[i], eR[i]); need[i] = pk > ceil ? ceil / pk : 1; }
    const la = Math.max(1, Math.round(lookahead * sr));
    // sliding min over [i, i+la) (monotonic deque)
    const gmin = new Float32Array(n), dq = new Int32Array(n); let h = 0, t = 0;
    for (let i = n - 1; i >= 0; i--) {
      while (t > h && need[dq[t - 1]] >= need[i]) t--;
      dq[t++] = i;
      while (dq[h] >= i + la) h++;
      gmin[i] = need[dq[h]];
    }
    // box smoothing over the previous la samples (running sum)
    const gs = new Float32Array(n); let acc = 0;
    for (let i = 0; i < n; i++) { acc += gmin[i]; if (i >= la) acc -= gmin[i - la]; gs[i] = acc / Math.min(i + 1, la); }
    const rel = 1 - Math.exp(-1 / (release * sr));
    const out = new Float32Array(x.length); let g = 1;
    for (let i = 0; i < n; i++) {
      g = Math.min(gs[i], g + (1 - g) * rel);
      out[2 * i] = L[i] * g; out[2 * i + 1] = R[i] * g;
    }
    return out;
  });
}

// ---------------------------------------------------------------- FFT (radix-2, in place)
export function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci, vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi; re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}
