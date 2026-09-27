// Loudness of the DELIVERED file via ffmpeg's ebur128 (EBU R128 / BS.1770), true peak on.
import path from 'node:path';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { ROOT } from '../lib/serve.mjs';
const file = process.argv[2] || path.join(ROOT, 'renders/origin.mp4');
const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-'], { encoding: 'utf8' });
const log = r.stderr;
const summary = log.slice(log.lastIndexOf('Summary:'));
fs.writeFileSync(path.join(ROOT, 'tools/verify/out/ebur128.txt'), summary);
console.log(summary.trim());
