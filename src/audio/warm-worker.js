// Off-main-thread warm-up for the live player: synthesises every precomputed sound (the drone,
// the shore's ambience and animal voices, the fire crackle, the keyclicks) in film order and
// transfers the arrays back, so playback never stalls on synthesis. The engine falls back to
// synthesising on demand if a sound isn't ready yet.
import * as T from '../timeline.js';
import { droneData, keysData, crackleData, natureData, natureKey } from './engine.js';

const sr = T.SAMPLE_RATE;
const send = (key, L, R) => postMessage({ key, L, R }, [L.buffer, R.buffer]);
{ const [L, R] = droneData(sr); send('drone', L, R); }
const jobs = [];
for (const e of T.sfx) {
  if (e.type === 'nature') jobs.push([e.t, natureKey(e), () => natureData(sr, e)]);
  else if (e.type === 'crackle') jobs.push([e.t, 'crackle', () => { const [L, R] = crackleData(sr, e); return { L, R }; }]);
  else if (e.type === 'keys') jobs.push([e.t, 'keys', () => { const [L, R] = keysData(sr, e); return { L, R }; }]);
}
jobs.sort((a, b) => a[0] - b[0]);
const seen = new Set();
for (const [, key, run] of jobs) {
  if (seen.has(key)) continue;
  seen.add(key);
  const x = run();
  send(key, x.L, x.R);
}
postMessage({ done: true, count: seen.size + 1 });
