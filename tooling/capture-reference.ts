import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const output = process.argv[2];
if (!output) throw new Error('Provide a private output directory for reference captures.');
const directory = resolve(output);
await mkdir(directory, { recursive: true, mode: 0o700 });
const url = 'https://openai.com/index/hugging-face-incident-and-the-road-ahead/';
const browser = await chromium.launch({ executablePath: process.env.SWARM_REFERENCE_BROWSER ?? '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', headless: process.env.SWARM_REFERENCE_HEADED !== '1' });
try {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  if (!response?.ok()) throw new Error(`Reference navigation returned HTTP ${response?.status()}.`);
  await page.locator('canvas').waitFor({ state: 'visible', timeout: 20_000 });
  await page.screenshot({ path: `${directory}/reference-page.png` });
  const metadata = await page.locator('canvas').evaluate(canvas => ({ width: (canvas as HTMLCanvasElement).width, height: (canvas as HTMLCanvasElement).height, engine: canvas.getAttribute('data-engine'), bounds: canvas.getBoundingClientRect().toJSON() }));
  const started = Date.now(); const frames = [];
  for (let index = 0; index < 22; index++) {
    const delay = started + index * 1000 - Date.now();
    if (delay > 0) await Bun.sleep(delay);
    const name = `frame-${String(index).padStart(3,'0')}.png`;
    // Compositor screenshots retain WebGL pixels even when preserveDrawingBuffer is false.
    await page.locator('canvas').screenshot({ path: `${directory}/${name}` });
    frames.push({name,elapsedMs:Date.now()-started});
  }
  await writeFile(`${directory}/reference.json`,JSON.stringify({url,capturedAt:new Date().toISOString(),metadata,frames,errors,note:'Captured rendered pixels from the live public canvas. No original implementation code copied. Pixel/motion validation pending.'},null,2));
  console.log(JSON.stringify({directory,frames:frames.length,metadata,errors}));
} finally { await browser.close(); }
