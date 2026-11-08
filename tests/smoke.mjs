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

  // Tab vybere jednotku s pohybem a najetí na vzdálené pole ukáže trasu
  if ((await page.evaluate(() => window.__game.getState().winner)) === null) {
    await page.keyboard.press('Tab');
    const picked = await page.evaluate(() => window.__game.selectedId());
    if (picked === null) throw new Error('Tab nevybral žádnou jednotku');
    const far = await page.evaluate(async () => {
      const g = await import('./src/game.js');
      const rnd = await import('./src/render.js');
      const st = window.__game.getState();
      const u = g.getUnit(st, window.__game.selectedId());
      let bestK = null;
      for (const [k] of g.reachable(st, u)) {
        const [q, r] = k.split(',').map(Number);
        const len = g.pathTo(st, u, q, r).length;
        if (!bestK || len > bestK.len) bestK = { q, r, len };
      }
      if (!bestK) return null;
      // přepočet středu pole na souřadnice stránky
      const c = rnd.tileCenter(bestK.q, bestK.r);
      const { w } = rnd.canvasSize(st);
      const rect = document.getElementById('board').getBoundingClientRect();
      const k = rect.width / w;
      return { x: rect.left + c.x * k, y: rect.top + c.y * k };
    });
    if (far) await page.mouse.move(far.x, far.y);
  }
  await mkdir('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/screenshot.png', fullPage: true });

  // najetí na město ukáže tooltip s příjmem
  const cityPt = await page.evaluate(async () => {
    const rnd = await import('./src/render.js');
    const st = window.__game.getState();
    const c = st.cities.find((x) => x.owner === 0) || st.cities[0];
    const p = rnd.tileCenter(c.q, c.r);
    const rect = document.getElementById('board').getBoundingClientRect();
    const k = rect.width / rnd.canvasSize(st).w;
    return { x: rect.left + p.x * k, y: rect.top + p.y * k };
  });
  await page.keyboard.press('Escape');
  await page.mouse.move(cityPt.x, cityPt.y);
  const tipText = await page.evaluate(() => !document.getElementById('tooltip').hidden && document.getElementById('tooltip').textContent);
  if (!tipText || !tipText.includes('zl./kolo')) throw new Error(`tooltip města chybí: ${tipText}`);
  await page.screenshot({ path: 'artifacts/screenshot-city.png' });

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
