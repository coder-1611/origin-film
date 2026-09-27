// Serve the live player: node tools/serve-cli.mjs [port]  → http://127.0.0.1:8080/
import { serve } from './lib/serve.mjs';
const { url } = await serve(+(process.argv[2] || 8080));
console.log(`ORIGIN live player → ${url}/   (?w=1920&h=1080 for full res, ?info for the debug overlay)`);
