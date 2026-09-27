// Shared helpers: decode the delivered MP4 into small per-frame arrays for measurement.
import { execFileSync } from 'node:child_process';
export function decodeFrames(file, w, h, fmt = 'gray') {
  const bpp = fmt === 'gray' ? 1 : 3;
  const buf = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-vf', `scale=${w}:${h}:flags=area,format=${fmt === 'gray' ? 'gray' : 'rgb24'}`, '-f', 'rawvideo', '-'], { maxBuffer: 2 ** 32 });
  const size = w * h * bpp, n = Math.floor(buf.length / size);
  return { n, size, frame: (i) => buf.subarray(i * size, (i + 1) * size) };
}
export function probeFps(file) {
  const r = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=r_frame_rate,nb_frames', '-of', 'json', file]).toString();
  const s = JSON.parse(r).streams[0]; const [a, b] = s.r_frame_rate.split('/').map(Number); return { fps: a / b, frames: +s.nb_frames };
}
