// Launch real Chrome (GPU via ANGLE/Metal) and open the film page in render mode.
import puppeteer from 'puppeteer-core';

export const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
export const ARGS = [
  '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader=false',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
  '--autoplay-policy=no-user-gesture-required', '--force-color-profile=srgb', '--hide-scrollbars',
];

export async function launch() {
  return puppeteer.launch({ executablePath: CHROME, headless: true, args: ARGS, protocolTimeout: 0 });
}

/** Open index.html?mode=render at W×H, wait for boot, assert a real GPU. Returns { page, info }. */
export async function openFilm(browser, baseUrl, { W = 1920, H = 1080, solo = null, quiet = false, extraQuery = '' } = {}) {
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  const logs = [];
  page.on('console', (m) => { const s = `[page:${m.type()}] ${m.text()}`; logs.push(s); if (!quiet || m.type() === 'error') console.log(s); });
  page.on('pageerror', (e) => { const s = `[page:exception] ${e.message}`; logs.push(s); console.log(s); });
  const q = `mode=render&w=${W}&h=${H}${solo ? '&solo=' + solo : ''}${extraQuery}`;
  await page.goto(`${baseUrl}/index.html?${q}`, { waitUntil: 'load', timeout: 0 });
  await page.evaluate(() => window.__ready);
  const info = await page.evaluate(() => window.__info());
  if (/swiftshader|llvmpipe|software/i.test(info.gpu)) throw new Error('Refusing to render on a software rasteriser: ' + info.gpu);
  if (!/Apple|Metal|ANGLE/i.test(info.gpu)) console.warn('[warn] unexpected GPU string:', info.gpu);
  return { page, info, logs };
}

/** Seek to t and capture the canvas region. */
export async function grab(page, t, { W, H, type = 'jpeg', quality = 95, path } = {}) {
  await page.evaluate((t) => window.__seek(t), t);
  return page.screenshot({ type, quality: type === 'jpeg' ? quality : undefined, path, clip: { x: 0, y: 0, width: W, height: H }, optimizeForSpeed: true });
}
