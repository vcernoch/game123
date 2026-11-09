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
  // první návštěva: dialog nové hry funguje jako hlavní menu
  await page.waitForSelector('#new-game-dialog[open]', { timeout: 2000 });
  await page.screenshot({ path: 'artifacts/screenshot-menu.png' });
  await page.click('#new-game-dialog button[value="cancel"]');
  await page.evaluate(() => window.__game.newGame(12345));
  await page.evaluate(() => window.__game.setAnimSpeed(0.25));
  const shownVersion = await page.textContent('#version');
  const expected = await page.evaluate(() => window.__game.version);
  if (shownVersion !== `v${expected}`) throw new Error(`verze v záhlaví nesedí: ${shownVersion}`);

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

  // tah AI v plné rychlosti: zachytit snímek uprostřed animace
  await page.evaluate(() => window.__game.setAnimSpeed(1));
  const unitsBefore = await page.evaluate(() => window.__game.getState().units.length);
  await page.evaluate(() => window.__game.endTurn());
  await page.waitForFunction(() => window.__game.isBusy(), null, { timeout: 2000 });
  await page.waitForTimeout(900);
  await page.screenshot({ path: 'artifacts/screenshot-anim.png' });
  await page.waitForFunction(() => !window.__game.isBusy(), null, { timeout: 15000 });
  if (unitsBefore === 0) throw new Error('žádné jednotky');

  // pohyb hráče: po animaci stojí jednotka na cíli
  const moved = await page.evaluate(async () => {
    const g = await import('./src/game.js');
    const rnd = await import('./src/render.js');
    const st = window.__game.getState();
    if (st.winner !== null) return { skip: true };
    window.__game.nextUnit();
    const u = g.getUnit(st, window.__game.selectedId());
    if (!u) return { skip: true };
    const [k] = g.reachable(st, u).keys();
    if (!k) return { skip: true };
    const [q, r] = k.split(',').map(Number);
    const c = rnd.tileCenter(q, r);
    const rect = document.getElementById('board').getBoundingClientRect();
    const s = rect.width / rnd.canvasSize(st).w;
    return { id: u.id, q, r, x: rect.left + c.x * s, y: rect.top + c.y * s };
  });
  if (!moved.skip) {
    await page.mouse.click(moved.x, moved.y);
    await page.waitForFunction(() => !window.__game.isBusy(), null, { timeout: 5000 });
    const at = await page.evaluate((id) => window.__game.getState().units.find((u) => u.id === id), moved.id);
    if (!at || at.q !== moved.q || at.r !== moved.r) throw new Error('jednotka se nepřesunula kliknutím');
  }

  // stavba: v čerstvé hře vyber hlavní město a postav trh tlačítkem v panelu
  await page.evaluate(() => { window.__game.newGame(12345); window.__game.getState().gold[0] = 99; });
  const capPt = await page.evaluate(async () => {
    const rnd = await import('./src/render.js');
    const st = window.__game.getState();
    const c = st.cities.find((x) => x.owner === 0 && x.capital);
    const p = rnd.tileCenter(c.q, c.r);
    const rect = document.getElementById('board').getBoundingClientRect();
    const k = rect.width / rnd.canvasSize(st).w;
    return { x: rect.left + p.x * k, y: rect.top + p.y * k };
  });
  await page.mouse.click(capPt.x, capPt.y);
  const marketBtn = page.locator('button[data-build="market"]');
  if (!(await marketBtn.count())) throw new Error('v panelu města chybí tlačítko stavby');
  await marketBtn.click();
  const hasMarket = await page.evaluate(() => window.__game.getState().cities.find((c) => c.owner === 0 && c.capital).buildings.includes('market'));
  if (!hasMarket) throw new Error('trh se nepostavil');
  await page.screenshot({ path: 'artifacts/screenshot-city-panel.png' });

  // přepínač zvuku
  await page.click('#sound');
  if ((await page.getAttribute('#sound', 'aria-pressed')) !== 'false') throw new Error('zvuk nejde vypnout');
  await page.click('#sound');

  // dialog nové hry: těžká obtížnost bez mlhy
  await page.click('#new-game');
  await page.waitForSelector('#new-game-dialog[open]');
  await page.check('input[name="difficulty"][value="hard"]');
  await page.uncheck('input[name="fog"]');
  await page.screenshot({ path: 'artifacts/screenshot-dialog.png' });
  await page.click('#start-game');
  await page.waitForFunction(() => window.__game.getState().difficulty === 'hard', null, { timeout: 2000 }).catch(() => {});
  const opts = await page.evaluate(() => {
    const s = window.__game.getState();
    return { d: s.difficulty, fog: s.fog, open: document.getElementById('new-game-dialog').open };
  });
  if (opts.d !== 'hard' || opts.fog !== false || opts.open) throw new Error(`dialog nové hry: ${JSON.stringify(opts)}`);

  // konec hry: malá mapa dohraná AI za oba hráče, pak obrazovka se statistikami
  await page.evaluate(async () => {
    const g = await import('./src/game.js');
    const ai = await import('./src/ai.js');
    window.__game.newGame(7, { size: 'small', fog: false });
    const st = window.__game.getState();
    for (let i = 0; i < 400 && st.winner === null; i++) { ai.runAITurn(st); g.endTurn(st); }
    g.drainEvents(st);
    window.__game.refresh();
  });
  const end = await page.evaluate(() => ({
    winner: window.__game.getState().winner,
    banner: !document.getElementById('banner').hidden,
    statsOpen: document.getElementById('stats-panel').open,
    charts: document.querySelectorAll('#stats svg.chart').length,
  }));
  if (end.winner === null || !end.banner || !end.statsOpen || end.charts !== 2) {
    throw new Error(`konec hry / statistiky: ${JSON.stringify(end)}`);
  }
  await page.screenshot({ path: 'artifacts/screenshot-end.png', fullPage: true });

  // mobilní šířka – žádný vodorovný scroll
  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  if (overflow) throw new Error('na mobilu je vodorovný scroll');
  await page.screenshot({ path: 'artifacts/screenshot-mobile.png', fullPage: true });

  // dotykový telefon: přiblížená mapa, klepnutí = náhled, druhé klepnutí = pohyb
  const touchCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const phone = await touchCtx.newPage();
  phone.on('pageerror', (e) => errors.push(`pageerror (dotyk): ${e.message}`));
  await phone.goto(url);
  await phone.waitForFunction(() => window.__game);
  await phone.waitForSelector('#new-game-dialog[open]', { timeout: 2000 });
  await phone.screenshot({ path: 'artifacts/screenshot-menu-mobile.png' });
  await phone.tap('#new-game-dialog button[value="cancel"]');
  await phone.evaluate(() => { window.__game.newGame(12345); window.__game.setAnimSpeed(0); });
  await phone.tap('#zoom');
  const tilePoint = (q, r) => phone.evaluate(async ([q, r]) => {
    const rnd = await import('./src/render.js');
    const st = window.__game.getState();
    const c = rnd.tileCenter(q, r);
    const rect = document.getElementById('board').getBoundingClientRect();
    const k = rect.width / rnd.canvasSize(st).w;
    return { x: rect.left + c.x * k, y: rect.top + c.y * k };
  }, [q, r]);
  const plan = await phone.evaluate(async () => {
    const g = await import('./src/game.js');
    const st = window.__game.getState();
    const u = st.units.find((x) => x.owner === 0 && x.type === 'archer') || st.units.find((x) => x.owner === 0);
    const [k] = g.reachable(st, u).keys();
    const [q, r] = k.split(',').map(Number);
    return { id: u.id, from: { q: u.q, r: u.r }, to: { q, r } };
  });
  let pt = await tilePoint(plan.from.q, plan.from.r);
  await phone.touchscreen.tap(pt.x, pt.y);
  if ((await phone.evaluate(() => window.__game.selectedId())) !== plan.id) throw new Error('dotyk: jednotka se nevybrala');
  pt = await tilePoint(plan.to.q, plan.to.r);
  await phone.touchscreen.tap(pt.x, pt.y);
  const afterFirst = await phone.evaluate((id) => window.__game.getState().units.find((u) => u.id === id), plan.id);
  if (afterFirst.q !== plan.from.q || afterFirst.r !== plan.from.r) throw new Error('dotyk: pohyb proběhl bez potvrzení');
  if (!(await phone.$('#info .confirm'))) throw new Error('dotyk: chybí výzva k potvrzení');
  await phone.screenshot({ path: 'artifacts/screenshot-touch.png' });
  await phone.touchscreen.tap(pt.x, pt.y);
  await phone.waitForFunction(() => !window.__game.isBusy(), null, { timeout: 5000 });
  const afterSecond = await phone.evaluate((id) => window.__game.getState().units.find((u) => u.id === id), plan.id);
  if (afterSecond.q !== plan.to.q || afterSecond.r !== plan.to.r) throw new Error('dotyk: druhé klepnutí nepohnulo jednotkou');
  if (await phone.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)) {
    throw new Error('dotyk: přiblížená mapa způsobila vodorovný scroll stránky');
  }
  await touchCtx.close();

  // náhodná událost: mor u hlavního města ukáže pruh s oznámením a ubere životy
  const plague = await page.evaluate(async () => {
    const g = await import('./src/game.js');
    window.__game.newGame(777, { fog: false });
    const st = window.__game.getState();
    const cap = st.cities.find((c) => c.owner === 0);
    const ev = g.applyHappening(st, 0, 'plague', cap);
    window.__game.showNotice([ev]);
    return { hits: ev.hits.length, text: document.getElementById('notice').textContent,
      hidden: document.getElementById('notice').hidden };
  });
  if (plague.hidden || !plague.text.includes('Mor') || !plague.hits) throw new Error(`událost: ${JSON.stringify(plague)}`);
  await page.screenshot({ path: 'artifacts/screenshot-happening.png' });

  // řeky: velká mapa bez mlhy, najetí na pole u řeky ukáže popis v panelu
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.evaluate(() => { window.__game.newGame(4242, { size: 'large', fog: false }); });
  const riverTile = await page.evaluate(async () => {
    const rnd = await import('./src/render.js');
    const st = window.__game.getState();
    const t = Object.values(st.tiles).find((x) => x.rivers && x.rivers.length
      && !st.units.some((u) => u.q === x.q && u.r === x.r) && !st.cities.some((c) => c.q === x.q && c.r === x.r));
    if (!t) return null;
    const c = rnd.tileCenter(t.q, t.r);
    const rect = document.getElementById('board').getBoundingClientRect();
    const k = rect.width / rnd.canvasSize(st).w;
    return { x: rect.left + c.x * k, y: rect.top + c.y * k };
  });
  if (!riverTile) throw new Error('řeky: velká mapa nemá žádnou řeku');
  await page.mouse.move(riverTile.x, riverTile.y);
  const riverInfo = await page.textContent('#info');
  if (!riverInfo.includes('řeka')) throw new Error(`řeky: panel nepopisuje řeku (${riverInfo})`);
  await page.screenshot({ path: 'artifacts/screenshot-rivers.png' });

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
