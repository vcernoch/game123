// Smoke test in a headless browser: the game loads, doesn't crash and a few turns can be played.
// Saves a screenshot to artifacts/screenshot.png (for visual checks).
import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { startServer } from '../tools/serve.mjs';

const candidates = [process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].filter(Boolean);
const executablePath = candidates.find((p) => existsSync(p));
if (!executablePath) {
  console.error('Chrome/Chromium not found. Set CHROME_PATH.');
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
  // first visit: the new game dialog acts as the main menu
  await page.waitForSelector('#new-game-dialog[open]', { timeout: 2000 });
  await page.screenshot({ path: 'artifacts/screenshot-menu.png' });
  await page.click('#new-game-dialog button[value="cancel"]');
  await page.evaluate(() => window.__game.newGame(12345));
  await page.evaluate(() => window.__game.setAnimSpeed(0.25));
  const shownVersion = await page.textContent('#version');
  const expected = await page.evaluate(() => window.__game.version);
  if (shownVersion !== `v${expected}`) throw new Error(`header version mismatch: ${shownVersion}`);

  // click the player's unit and a tile it can move to
  const box = await page.locator('#board').boundingBox();
  if (!box) throw new Error('canvas is not visible');

  for (let i = 0; i < 5; i++) {
    await page.evaluate(() => window.__game.endTurn());
    await page.waitForFunction(() => !window.__game.isBusy(), null, { timeout: 5000 });
  }
  const turn = await page.evaluate(() => window.__game.getState().turn);
  if (turn < 6 && (await page.evaluate(() => window.__game.getState().winner)) === null) {
    throw new Error(`turns are not advancing (turn=${turn})`);
  }
  // the chronicle must not reveal AI actions in the fog of war: no line may be an entry the player didn't see
  const leak = await page.evaluate(() => {
    const st = window.__game.getState();
    if (st.winner !== null) return null;
    const line = (e) => `${e.turn}. ${e.msg}`;
    const pub = new Set(st.log.filter((e) => !e.seen || e.seen.includes(0)).map(line));
    const secret = new Set(st.log.filter((e) => e.seen && !e.seen.includes(0)).map(line).filter((l) => !pub.has(l)));
    return [...document.querySelectorAll('#log li')].map((li) => li.textContent).find((t) => secret.has(t)) || null;
  });
  if (leak) throw new Error(`chronicle reveals an action in fog: ${leak}`);
  await page.click('#board', { position: { x: box.width / 2, y: box.height / 2 } });

  // Tab selects a unit with moves left and hovering a distant tile shows the path
  if ((await page.evaluate(() => window.__game.getState().winner)) === null) {
    await page.keyboard.press('Tab');
    const picked = await page.evaluate(() => window.__game.selectedId());
    if (picked === null) throw new Error('Tab selected no unit');
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
      // convert the tile center to page coordinates
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

  // hovering a city shows a tooltip with its income
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
  if (!tipText || !tipText.includes('gold/turn')) throw new Error(`city tooltip missing: ${tipText}`);
  // hovering a unit shows its stats
  const unitPt = await page.evaluate(async () => {
    const rnd = await import('./src/render.js');
    const st = window.__game.getState();
    const u = st.units.find((x) => x.owner === 0);
    if (!u) return null;
    const p = rnd.tileCenter(u.q, u.r);
    const rect = document.getElementById('board').getBoundingClientRect();
    const k = rect.width / rnd.canvasSize(st).w;
    return { x: rect.left + p.x * k, y: rect.top + p.y * k };
  });
  if (unitPt) {
    await page.mouse.move(unitPt.x + 1, unitPt.y + 1);
    const ut = await page.evaluate(() => !document.getElementById('tooltip').hidden && document.getElementById('tooltip').textContent);
    if (!ut || !/HP \d+\/\d+/.test(ut) || !ut.includes('Defense')) throw new Error(`unit tooltip missing: ${ut}`);
    await page.screenshot({ path: 'artifacts/screenshot-unit-tip.png' });
  }
  await page.screenshot({ path: 'artifacts/screenshot-city.png' });

  // AI turn at full speed: capture a frame mid-animation
  await page.evaluate(() => window.__game.setAnimSpeed(1));
  const unitsBefore = await page.evaluate(() => window.__game.getState().units.length);
  await page.evaluate(() => window.__game.endTurn());
  await page.waitForFunction(() => window.__game.isBusy(), null, { timeout: 2000 });
  await page.waitForTimeout(900);
  await page.screenshot({ path: 'artifacts/screenshot-anim.png' });
  await page.waitForFunction(() => !window.__game.isBusy(), null, { timeout: 15000 });
  if (unitsBefore === 0) throw new Error('no units');

  // player move: after the animation the unit stands on the target
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
    if (!at || at.q !== moved.q || at.r !== moved.r) throw new Error('unit did not move on click');
  }

  // undo move: without fog every ordinary move can be undone – via the panel button and the Z key
  await page.evaluate(() => window.__game.newGame(777, { fog: false }));
  const undoMove = await page.evaluate(async () => {
    const g = await import('./src/game.js');
    const rnd = await import('./src/render.js');
    const st = window.__game.getState();
    window.__game.nextUnit();
    const u = g.getUnit(st, window.__game.selectedId());
    const k = [...g.reachable(st, u).keys()].find((key) => {
      const [q, r] = key.split(',').map(Number);
      return !g.cityAt(st, q, r);
    });
    const [q, r] = k.split(',').map(Number);
    const c = rnd.tileCenter(q, r);
    const rect = document.getElementById('board').getBoundingClientRect();
    const s = rect.width / rnd.canvasSize(st).w;
    return { id: u.id, from: { q: u.q, r: u.r }, x: rect.left + c.x * s, y: rect.top + c.y * s };
  });
  const posOf = (id) => page.evaluate((i) => { const u = window.__game.getState().units.find((x) => x.id === i); return u && { q: u.q, r: u.r }; }, id);
  for (const how of ['button', 'key']) {
    await page.mouse.click(undoMove.x, undoMove.y);
    await page.waitForFunction(() => !window.__game.isBusy(), null, { timeout: 5000 });
    if (!(await page.evaluate(() => window.__game.canUndo()))) throw new Error('move without fog cannot be undone');
    if (how === 'button') await page.locator('#info').screenshot({ path: 'artifacts/screenshot-undo.png' });
    if (how === 'button') await page.click('#info button[data-undo]');
    else await page.keyboard.press('z');
    const pos = await posOf(undoMove.id);
    if (!pos || pos.q !== undoMove.from.q || pos.r !== undoMove.from.r) throw new Error(`undo move (${how}) did not return the unit`);
    if (await page.evaluate(() => window.__game.canUndo())) throw new Error('an entry remained on the stack after undo');
  }

  // fortify: the undone unit hasn't acted, so it can dig in via the panel button; F fortifies the next one
  await page.click('#info button[data-fortify]');
  const fort = await page.evaluate((id) => {
    const st = window.__game.getState();
    return { first: !!st.units.find((u) => u.id === id).fortified, next: window.__game.selectedId() };
  }, undoMove.id);
  if (!fort.first) throw new Error('the fortify button did not fortify the unit');
  if (fort.next !== null) {
    await page.keyboard.press('f');
    const ok = await page.evaluate((id) => !!window.__game.getState().units.find((u) => u.id === id).fortified, fort.next);
    if (!ok) throw new Error('the F key did not fortify the next unit');
  }
  await page.screenshot({ path: 'artifacts/screenshot-fortify.png' });

  // move order: hovering a far known tile shows a dashed route, a click sends the unit, it walks on next turn
  await page.evaluate(() => window.__game.newGame(31, { fog: false }));
  const order = await page.evaluate(async () => {
    const g = await import('./src/game.js');
    const rnd = await import('./src/render.js');
    const st = window.__game.getState();
    window.__game.nextUnit();
    const u = g.getUnit(st, window.__game.selectedId());
    const reach = g.reachable(st, u);
    let best = null;
    for (const t of Object.values(st.tiles)) {
      if (reach.has(`${t.q},${t.r}`) || g.unitAt(st, t.q, t.r) || g.cityAt(st, t.q, t.r)) continue;
      const r = g.planRoute(st, u, t.q, t.r);
      if (r && r.turns === 3 && (!best || r.path.length > best.len)) best = { q: t.q, r: t.r, len: r.path.length };
    }
    const c = rnd.tileCenter(best.q, best.r);
    const rect = document.getElementById('board').getBoundingClientRect();
    const k = rect.width / rnd.canvasSize(st).w;
    return { id: u.id, q: best.q, r: best.r, x: rect.left + c.x * k, y: rect.top + c.y * k };
  });
  await page.mouse.move(order.x, order.y);
  await page.screenshot({ path: 'artifacts/screenshot-order.png' });
  await page.mouse.click(order.x, order.y);
  await page.waitForFunction(() => !window.__game.isBusy(), null, { timeout: 5000 });
  const afterOrder = await page.evaluate((id) => { const u = window.__game.getState().units.find((x) => x.id === id); return { goto: u.goto, q: u.q, r: u.r }; }, order.id);
  if (!afterOrder.goto || afterOrder.goto.q !== order.q) throw new Error(`move order not set: ${JSON.stringify(afterOrder)}`);
  await page.evaluate(() => window.__game.endTurn());
  await page.waitForFunction(() => !window.__game.isBusy() && window.__game.getState().current === 0, null, { timeout: 15000 });
  const walked = await page.evaluate((id) => { const u = window.__game.getState().units.find((x) => x.id === id); return u && { q: u.q, r: u.r, goto: u.goto }; }, order.id);
  if (walked && walked.q === afterOrder.q && walked.r === afterOrder.r && walked.goto) throw new Error('the unit did not walk on at the start of the turn');

  // end-turn reminder: with idle units the first press only asks, the second ends the turn
  await page.evaluate(() => window.__game.newGame(4242));
  const label0 = await page.textContent('#end-turn');
  if (!/End turn · \d+/.test(label0)) throw new Error(`end-turn button does not count idle units: ${label0}`);
  await page.click('#end-turn');
  const armed = await page.evaluate(() => ({ turn: window.__game.getState().turn, cur: window.__game.getState().current, text: document.getElementById('end-turn').textContent }));
  if (armed.turn !== 1 || armed.cur !== 0 || armed.text !== 'Really end?') throw new Error(`first press ended the turn: ${JSON.stringify(armed)}`);
  await page.click('#end-turn');
  await page.waitForFunction(() => !window.__game.isBusy() && window.__game.getState().turn === 2, null, { timeout: 15000 });

  // building: in a fresh game select the capital and build a market via the panel button
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
  if (!(await marketBtn.count())) throw new Error('city panel is missing the build button');
  await marketBtn.click();
  const hasMarket = await page.evaluate(() => window.__game.getState().cities.find((c) => c.owner === 0 && c.capital).buildings.includes('market'));
  if (!hasMarket) throw new Error('market was not built');
  await page.screenshot({ path: 'artifacts/screenshot-city-panel.png' });

  // number key recruits in the selected city (the capital must be empty first)
  await page.evaluate(() => {
    const st = window.__game.getState();
    const c = st.cities.find((x) => x.owner === 0 && x.capital);
    st.units = st.units.filter((u) => u.q !== c.q || u.r !== c.r);
    window.__game.refresh();
  });
  await page.mouse.click(capPt.x, capPt.y);
  await page.keyboard.press('2');
  await page.waitForFunction(() => !window.__game.isBusy(), null, { timeout: 5000 });
  const recruited = await page.evaluate(() => {
    const st = window.__game.getState();
    const c = st.cities.find((x) => x.owner === 0 && x.capital);
    const u = st.units.find((x) => x.q === c.q && x.r === c.r);
    return u && u.type;
  });
  if (recruited !== 'archer') throw new Error(`key 2 did not recruit an archer: ${recruited}`);

  // ? opens the shortcut overlay, Esc closes it
  await page.keyboard.press('?');
  if (!(await page.evaluate(() => document.getElementById('keys-dialog').open))) throw new Error('? did not open the shortcuts');
  await page.screenshot({ path: 'artifacts/screenshot-keys.png' });
  await page.keyboard.press('Escape');
  if (await page.evaluate(() => document.getElementById('keys-dialog').open)) throw new Error('Esc did not close the shortcuts');

  // sound toggle
  await page.click('#sound');
  if ((await page.getAttribute('#sound', 'aria-pressed')) !== 'false') throw new Error('sound cannot be turned off');
  await page.click('#sound');

  // new game dialog: hard difficulty without fog
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
  if (opts.d !== 'hard' || opts.fog !== false || opts.open) throw new Error(`new game dialog: ${JSON.stringify(opts)}`);

  // game over: small map played out by the AI for both players, then the statistics screen
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
    throw new Error(`game over / statistics: ${JSON.stringify(end)}`);
  }
  await page.screenshot({ path: 'artifacts/screenshot-end.png', fullPage: true });

  // mobile width – no horizontal scroll
  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  if (overflow) throw new Error('horizontal scroll on mobile');
  await page.screenshot({ path: 'artifacts/screenshot-mobile.png', fullPage: true });

  // touch phone: zoomed map, tap = preview, second tap = move
  const touchCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const phone = await touchCtx.newPage();
  phone.on('pageerror', (e) => errors.push(`pageerror (touch): ${e.message}`));
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
  if ((await phone.evaluate(() => window.__game.selectedId())) !== plan.id) throw new Error('touch: unit was not selected');
  pt = await tilePoint(plan.to.q, plan.to.r);
  await phone.touchscreen.tap(pt.x, pt.y);
  const afterFirst = await phone.evaluate((id) => window.__game.getState().units.find((u) => u.id === id), plan.id);
  if (afterFirst.q !== plan.from.q || afterFirst.r !== plan.from.r) throw new Error('touch: move happened without confirmation');
  if (!(await phone.$('#info .confirm'))) throw new Error('touch: confirmation prompt missing');
  await phone.screenshot({ path: 'artifacts/screenshot-touch.png' });
  await phone.touchscreen.tap(pt.x, pt.y);
  await phone.waitForFunction(() => !window.__game.isBusy(), null, { timeout: 5000 });
  const afterSecond = await phone.evaluate((id) => window.__game.getState().units.find((u) => u.id === id), plan.id);
  if (afterSecond.q !== plan.to.q || afterSecond.r !== plan.to.r) throw new Error('touch: second tap did not move the unit');
  if (await phone.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)) {
    throw new Error('touch: zoomed map caused horizontal page scroll');
  }
  await touchCtx.close();

  // random event: plague at the capital shows the notice banner and removes HP
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
  if (plague.hidden || !plague.text.includes('Plague') || !plague.hits) throw new Error(`happening: ${JSON.stringify(plague)}`);
  await page.screenshot({ path: 'artifacts/screenshot-happening.png' });

  // rivers: large map without fog, hovering a river tile shows its description in the panel
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
  if (!riverTile) throw new Error('rivers: large map has no river');
  await page.mouse.move(riverTile.x, riverTile.y);
  const riverInfo = await page.textContent('#info');
  if (!riverInfo.includes('river')) throw new Error(`rivers: panel does not describe the river (${riverInfo})`);
  await page.screenshot({ path: 'artifacts/screenshot-rivers.png' });

  if (errors.length) throw new Error(errors.join('\n'));
  console.log(`SMOKE OK – turn ${turn}, screenshots in artifacts/`);
} catch (e) {
  failed = true;
  console.error('SMOKE FAIL:', e.message);
} finally {
  await browser.close();
  server.close();
}
process.exit(failed ? 1 : 0);
