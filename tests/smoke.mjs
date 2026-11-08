// Smoke test v headless prohlížeči: hra se načte, nepadá a dá se odehrát pár tahů.
// Vytvoří screenshot do artifacts/screenshot.png (pro kontrolu vzhledu).
import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { startServer } from '../tools/serve.mjs';

const candidates = [process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].filter(Boolean);
const executablePath = candidates.find((p) => existsSync(p));
if (!executablePath) {
  console.error('Nenalezen Chrome/Chromium. Nastav CHROME_PATH.');
  process.exit(2);
}

const server = await startServer(0);
const url = `http://127.0.0.1:${server.address().port}/index.html`;
const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] });
const errors = [];
let failed = false;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  await page.goto(url);
  await page.waitForFunction(() => window.__game);
  await page.evaluate(() => window.__game.newGame(12345));

  // klik na hráčovu jednotku a na pole, kam může jít
  const box = await page.locator('#board').boundingBox();
  if (!box) throw new Error('canvas není vidět');

  for (let i = 0; i < 5; i++) {
    await page.evaluate(() => window.__game.endTurn());
    await page.waitForFunction(() => !window.__game.isBusy(), null, { timeout: 5000 });
  }
  const turn = await page.evaluate(() => window.__game.getState().turn);
  if (turn < 6 && (await page.evaluate(() => window.__game.getState().winner)) === null) {
    throw new Error(`kola nepřibývají (turn=${turn})`);
  }
  await page.click('#board', { position: { x: box.width / 2, y: box.height / 2 } });
  await mkdir('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/screenshot.png', fullPage: true });

  // mobilní šířka – žádný vodorovný scroll
  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  if (overflow) throw new Error('na mobilu je vodorovný scroll');
  await page.screenshot({ path: 'artifacts/screenshot-mobile.png', fullPage: true });

  if (errors.length) throw new Error(errors.join('\n'));
  console.log(`SMOKE OK – kolo ${turn}, screenshoty v artifacts/`);
} catch (e) {
  failed = true;
  console.error('SMOKE FAIL:', e.message);
} finally {
  await browser.close();
  server.close();
}
process.exit(failed ? 1 : 0);
