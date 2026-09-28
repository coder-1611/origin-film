// Minimal MP4 box patcher for gapless audio: rewrite one track's edit list (elst) so the
// presentation starts `skip` media samples in and lasts exactly `samples` samples, and set that
// track's tkhd duration and the movie's mvhd duration to match. Every packet stays in the file,
// so the AAC decoder still gets its pre-roll; only the presented range changes. Values are
// patched in place (same box sizes), so the faststart layout is untouched.
import fs from 'node:fs';

function boxes(buf, start, end) {
  const out = [];
  let p = start;
  while (p + 8 <= end) {
    let size = buf.readUInt32BE(p), hdr = 8;
    const type = buf.toString('latin1', p + 4, p + 8);
    if (size === 1) { size = Number(buf.readBigUInt64BE(p + 8)); hdr = 16; }
    else if (size === 0) size = end - p;
    out.push({ type, start: p, hdr, size, body: p + hdr, end: p + size });
    p += size;
  }
  return out;
}
const child = (buf, box, type) => boxes(buf, box.body, box.end).find(b => b.type === type);

/** Patch `file` in place. handler: 'soun' for the audio track. */
export function setGaplessEdit(file, { handler = 'soun', addSkip = 0, samples, mediaRate }) {
  const buf = fs.readFileSync(file);
  const moov = boxes(buf, 0, buf.length).find(b => b.type === 'moov');
  if (!moov) throw new Error('no moov');
  const mvhd = child(buf, moov, 'mvhd');
  const mvVer = buf[mvhd.body];
  const movieTs = mvVer === 1 ? buf.readUInt32BE(mvhd.body + 20) : buf.readUInt32BE(mvhd.body + 12);
  const segDur = Math.round(samples * movieTs / mediaRate);
  let patched = null;
  for (const trak of boxes(buf, moov.body, moov.end).filter(b => b.type === 'trak')) {
    const mdia = child(buf, trak, 'mdia');
    const hdlr = child(buf, mdia, 'hdlr');
    if (buf.toString('latin1', hdlr.body + 8, hdlr.body + 12) !== handler) continue;
    const mdhd = child(buf, mdia, 'mdhd');
    const mdTs = buf[mdhd.body] === 1 ? buf.readUInt32BE(mdhd.body + 20) : buf.readUInt32BE(mdhd.body + 12);
    if (mdTs !== mediaRate) throw new Error(`media timescale ${mdTs} ≠ ${mediaRate}`);
    const edts = child(buf, trak, 'edts');
    if (!edts) throw new Error('track has no edts/elst to patch');
    const elst = child(buf, edts, 'elst');
    const ver = buf[elst.body], count = buf.readUInt32BE(elst.body + 4);
    // Use the last entry (ffmpeg writes [empty edit?] + one media edit); make it the only media range.
    const entSize = ver === 1 ? 20 : 12, e = elst.body + 8 + (count - 1) * entSize;
    const oldMediaTime = ver === 1 ? Number(buf.readBigInt64BE(e + 8)) : buf.readInt32BE(e + 4);
    const skip = oldMediaTime + addSkip;            // keep the encoder's priming skip, add the lead-in
    if (ver === 1) { buf.writeBigUInt64BE(BigInt(segDur), e); buf.writeBigInt64BE(BigInt(skip), e + 8); }
    else { buf.writeUInt32BE(segDur, e); buf.writeInt32BE(skip, e + 4); }
    const tkhd = child(buf, trak, 'tkhd');
    if (buf[tkhd.body] === 1) buf.writeBigUInt64BE(BigInt(segDur), tkhd.body + 28); else buf.writeUInt32BE(segDur, tkhd.body + 20);
    patched = { oldMediaTime, newMediaTime: skip, segmentDuration: segDur, movieTimescale: movieTs, entries: count };
  }
  if (!patched) throw new Error('no ' + handler + ' track');
  // Movie duration = the longest track's presentation (video is exactly the same length here).
  let maxDur = 0;
  for (const trak of boxes(buf, moov.body, moov.end).filter(b => b.type === 'trak')) {
    const tkhd = child(buf, trak, 'tkhd');
    const d = buf[tkhd.body] === 1 ? Number(buf.readBigUInt64BE(tkhd.body + 28)) : buf.readUInt32BE(tkhd.body + 20);
    maxDur = Math.max(maxDur, d);
  }
  if (mvVer === 1) buf.writeBigUInt64BE(BigInt(maxDur), mvhd.body + 24); else buf.writeUInt32BE(maxDur, mvhd.body + 16);
  fs.writeFileSync(file, buf);
  return { ...patched, movieDuration: maxDur };
}
