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
  await page.evaluate(() => window.__game.newGame(54321));
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
  if (!/Size [1-3]\/3/.test(tipText)) throw new Error(`city tooltip has no size: ${tipText}`);
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

  // auto-explore: the panel button (with fog) sends the selected unit into the fog, X sends the next one
  await page.evaluate(() => window.__game.newGame(31, { happenings: false }));
  await page.evaluate(() => window.__game.nextUnit());
  const exp0 = await page.evaluate(() => {
    const st = window.__game.getState();
    const u = st.units.find((x) => x.id === window.__game.selectedId());
    return { id: u.id, q: u.q, r: u.r, known: st.explored[0].length };
  });
  await page.click('#info button[data-explore]');
  await page.waitForFunction(() => !window.__game.isBusy(), null, { timeout: 5000 });
  const exp1 = await page.evaluate((id) => {
    const st = window.__game.getState();
    const u = st.units.find((x) => x.id === id);
    return { explore: !!u.explore, q: u.q, r: u.r, known: st.explored[0].length, panel: document.getElementById('info').textContent };
  }, exp0.id);
  if (!exp1.explore || (exp1.q === exp0.q && exp1.r === exp0.r) || exp1.known <= exp0.known) throw new Error(`explore did not send the unit: ${JSON.stringify(exp1)}`);
  if (!exp1.panel.includes('Exploring the fog') || !exp1.panel.includes('Stop exploring')) throw new Error('the panel does not show the explore order');
  await page.screenshot({ path: 'artifacts/screenshot-explore.png' });
  await page.evaluate(() => window.__game.nextUnit());
  const exp2id = await page.evaluate(() => window.__game.selectedId());
  if (exp2id !== null && exp2id !== exp0.id) {
    await page.keyboard.press('x');
    await page.waitForFunction(() => !window.__game.isBusy(), null, { timeout: 5000 });
    const ok = await page.evaluate((id) => !!window.__game.getState().units.find((u) => u.id === id).explore, exp2id);
    if (!ok) throw new Error('the X key did not send the unit exploring');
  }

  // sentry: the panel button puts a wounded unit to rest (eye badge, Tab moves on, end-turn count drops),
  // W puts the next one on watch; at the start of the next turn the healed one wakes with a banner line
  await page.evaluate(() => window.__game.newGame(31, { happenings: false }));
  await page.evaluate(() => window.__game.nextUnit());
  const sen0 = await page.evaluate(() => {
    const g = window.__game;
    const u = g.getState().units.find((x) => x.id === g.selectedId());
    u.hp -= 1; // wounded: the button offers rest until healed
    g.refresh();
    return { id: u.id, label: document.getElementById('end-turn').textContent };
  });
  const senBtn = await page.textContent('#info button[data-sentry]');
  if (!senBtn.includes('Rest until healed')) throw new Error(`sentry button text: ${senBtn}`);
  await page.click('#info button[data-sentry]');
  const sen1 = await page.evaluate((id) => {
    const g = window.__game;
    return { sentry: g.getState().units.find((u) => u.id === id).sentry, sel: g.selectedId(), label: document.getElementById('end-turn').textContent };
  }, sen0.id);
  const idle = (t) => Number((t.match(/· (\d+)/) || [0, 0])[1]);
  if (sen1.sentry !== 'heal' || sen1.sel === sen0.id || idle(sen1.label) !== idle(sen0.label) - 1) {
    throw new Error(`sentry did not rest the unit: ${JSON.stringify({ sen0, sen1 })}`);
  }
  if (sen1.sel !== null) {
    await page.keyboard.press('w');
    const watch = await page.evaluate((id) => window.__game.getState().units.find((u) => u.id === id).sentry, sen1.sel);
    if (watch !== 'watch') throw new Error(`the W key did not put the unit on watch: ${watch}`);
  }
  await page.screenshot({ path: 'artifacts/screenshot-sentry.png' });
  await page.evaluate(() => window.__game.endTurn());
  await page.waitForFunction(() => !window.__game.isBusy() && window.__game.getState().current === 0, null, { timeout: 15000 });
  const sen2 = await page.evaluate((id) => ({
    sentry: window.__game.getState().units.find((u) => u.id === id).sentry, notice: document.getElementById('notice').textContent,
  }), sen0.id);
  if (sen2.sentry || !sen2.notice.includes('is fully healed and ready')) throw new Error(`the rested unit did not wake: ${JSON.stringify(sen2)}`);

  // wall volley: the capital gets walls and an AI warrior next to it; ending the turn the walls shoot it
  // (a stone flies, slowed down for the screenshot), the chronicle says so and the threat overlay marks the AI's walls
  await page.evaluate(() => window.__game.newGame(31, { happenings: false, fog: false }));
  const vol = await page.evaluate(async () => {
    const g = await import('./src/game.js');
    const { neighbors } = await import('./src/hex.js');
    const st = window.__game.getState();
    const cap = st.cities.find((c) => c.owner === 0 && c.capital);
    cap.buildings = ['walls'];
    const n = neighbors(cap.q, cap.r).find((p) => g.isPassable(st, p.q, p.r) && !g.unitAt(st, p.q, p.r) && !g.cityAt(st, p.q, p.r));
    const foe = g.spawnUnit(st, 'warrior', 1, n.q, n.r);
    g.drainEvents(st);
    window.__game.refresh();
    return { id: foe.id, city: cap.name };
  });
  await page.evaluate(() => window.__game.setAnimSpeed(3));
  await page.evaluate(() => window.__game.endTurn());
  await page.waitForTimeout(700);
  await page.screenshot({ path: 'artifacts/screenshot-volley.png' });
  await page.evaluate(() => window.__game.setAnimSpeed(1));
  await page.waitForFunction(() => !window.__game.isBusy() && window.__game.getState().current === 0, null, { timeout: 15000 });
  const volLog = await page.textContent('#log');
  if (!volLog.includes(`the walls of ${vol.city} hit Warrior (−2)`)) throw new Error(`wall volley missing in the chronicle: ${volLog.slice(0, 300)}`);
  const volThreat = await page.evaluate(async () => {
    const g = await import('./src/game.js');
    const { neighbors } = await import('./src/hex.js');
    const st = window.__game.getState();
    const c = st.cities.find((x) => x.owner === 1);
    c.buildings = ['walls'];
    const t = g.threatTiles(st, 0);
    return neighbors(c.q, c.r).filter((p) => g.isPassable(st, p.q, p.r)).every((p) => t.get(`${p.q},${p.r}`) >= 1);
  });
  if (!volThreat) throw new Error('the threat overlay ignores enemy walls');

  // animation speed: the header button cycles normal → fast → off (remembered), A cycles back to normal
  const sp0 = await page.evaluate(() => window.__game.animSpeed().id);
  await page.click('#anim-speed');
  const sp1 = await page.evaluate(() => ({ ...window.__game.animSpeed(), icon: document.getElementById('anim-speed').textContent,
    pref: JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => localStorage.getItem(k).includes('animSpeed')) || 'x') || '{}').animSpeed }));
  if (sp0 !== 'normal' || sp1.id !== 'fast' || !(sp1.speed > 0 && sp1.speed < 1) || sp1.icon !== '⏩' || sp1.pref !== 'fast') {
    throw new Error(`animation speed button: ${JSON.stringify({ sp0, sp1 })}`);
  }
  await page.keyboard.press('a');
  const sp2 = await page.evaluate(() => window.__game.animSpeed());
  await page.keyboard.press('a');
  const sp3 = await page.evaluate(() => window.__game.animSpeed());
  if (sp2.id !== 'off' || sp2.speed !== 0 || sp3.id !== 'normal' || sp3.speed !== 1) throw new Error(`key A: ${JSON.stringify({ sp2, sp3 })}`);

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
  const growth = await page.locator('.growth').first().textContent();
  if (!/^Size 1\/3 · grows in 5 turns$/.test(growth.trim())) throw new Error(`city panel growth line wrong: ${growth}`);
  const trade = await page.locator('.trade.hub').first().textContent().catch(() => '');
  if (!/Trade hub/.test(trade)) throw new Error(`city panel trade line wrong: ${trade}`);
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

  // key 6 recruits a scout; its symbol is drawn and it never enters a foreign city
  await page.evaluate(() => {
    const st = window.__game.getState();
    const c = st.cities.find((x) => x.owner === 0 && x.capital);
    st.units = st.units.filter((u) => u.q !== c.q || u.r !== c.r);
    window.__game.refresh();
  });
  await page.mouse.click(capPt.x, capPt.y);
  await page.keyboard.press('6');
  await page.waitForFunction(() => !window.__game.isBusy(), null, { timeout: 5000 });
  const scout = await page.evaluate(() => {
    const st = window.__game.getState();
    const c = st.cities.find((x) => x.owner === 0 && x.capital);
    const u = st.units.find((x) => x.q === c.q && x.r === c.r);
    return u && u.type;
  });
  if (scout !== 'scout') throw new Error(`key 6 did not recruit a scout: ${scout}`);
  const scoutTitle = await page.getAttribute('#info button[data-buy="scout"]', 'title');
  if (!scoutTitle || !scoutTitle.includes('cannot capture cities')) throw new Error(`scout button title: ${scoutTitle}`);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'artifacts/screenshot-scout.png' });

  // upgrade: next turn the scout (ready to act, gold to spare) is retrained as a horseman from the panel
  await page.evaluate(() => {
    const st = window.__game.getState();
    const c = st.cities.find((x) => x.owner === 0 && x.capital);
    const u = st.units.find((x) => x.q === c.q && x.r === c.r);
    u.movesLeft = 3; u.hasAttacked = false; u.moved = false; u.xp = 3;
    st.gold[0] = 60;
    window.__game.refresh();
  });
  await page.keyboard.press('Escape');
  await page.mouse.click(capPt.x, capPt.y);
  await page.waitForSelector('#info button[data-upgrade="horseman"]:not([disabled])', { timeout: 3000 });
  await page.$eval('#info button[data-upgrade]', (b) => b.scrollIntoView({ block: 'center' }));
  await page.screenshot({ path: 'artifacts/screenshot-upgrade.png' });
  await page.click('#info button[data-upgrade="horseman"]');
  await page.waitForFunction(() => !window.__game.isBusy(), null, { timeout: 5000 });
  const upgraded = await page.evaluate(() => {
    const st = window.__game.getState();
    const c = st.cities.find((x) => x.owner === 0 && x.capital);
    const u = st.units.find((x) => x.q === c.q && x.r === c.r);
    return { type: u && u.type, xp: u && u.xp, moves: u && u.movesLeft, gold: st.gold[0],
      buttons: document.querySelectorAll('#info button[data-upgrade]').length };
  });
  if (upgraded.type !== 'horseman' || upgraded.xp !== 3 || upgraded.moves !== 0 || upgraded.gold >= 60 || upgraded.buttons) {
    throw new Error(`upgrade from the panel failed: ${JSON.stringify(upgraded)}`);
  }

  // disband: the retrained horseman is dismissed from the panel – first press arms, second press disbands
  const goldBefore = upgraded.gold;
  await page.click('#info button[data-disband]');
  const armedText = await page.textContent('#info button[data-disband]');
  if (!armedText.includes('Really disband?') || !armedText.includes('+6 gold')) throw new Error(`disband did not ask first: ${armedText}`);
  await page.$eval('#info button[data-disband]', (b) => b.scrollIntoView({ block: 'center' }));
  await page.screenshot({ path: 'artifacts/screenshot-disband.png' });
  await page.click('#info button[data-disband]');
  await page.waitForFunction(() => !window.__game.isBusy(), null, { timeout: 5000 });
  const disbanded = await page.evaluate(() => {
    const st = window.__game.getState();
    const c = st.cities.find((x) => x.owner === 0 && x.capital);
    return { unit: !!st.units.find((x) => x.q === c.q && x.r === c.r), gold: st.gold[0],
      recruit: !!document.querySelector('#info button[data-buy="warrior"]:not([disabled])') };
  });
  if (disbanded.unit || disbanded.gold !== goldBefore + 6 || !disbanded.recruit) {
    throw new Error(`disband from the panel failed: ${JSON.stringify(disbanded)}`);
  }

  // sound toggle
  await page.click('#sound');
  if ((await page.getAttribute('#sound', 'aria-pressed')) !== 'false') throw new Error('sound cannot be turned off');
  await page.click('#sound');

  // new game dialog: hard difficulty without fog
  await page.click('#new-game');
  await page.waitForSelector('#new-game-dialog[open]');
  await page.check('input[name="difficulty"][value="hard"]');
  await page.uncheck('input[name="fog"]');
  // map number: an invalid one keeps the dialog open, "Current map" fills in this game's number
  const curSeed = await page.evaluate(() => window.__game.getState().seed);
  await page.click('#seed-current');
  if ((await page.inputValue('#seed-input')) !== String(curSeed)) throw new Error('"Current map" did not fill the map number');
  await page.fill('#seed-input', 'abc');
  await page.click('#start-game');
  if (!(await page.evaluate(() => document.getElementById('new-game-dialog').open))) throw new Error('invalid map number was accepted');
  await page.fill('#seed-input', '4242');
  await page.screenshot({ path: 'artifacts/screenshot-dialog.png' });
  await page.click('#start-game');
  await page.waitForFunction(() => window.__game.getState().difficulty === 'hard', null, { timeout: 2000 }).catch(() => {});
  const opts = await page.evaluate(() => {
    const s = window.__game.getState();
    return { d: s.difficulty, fog: s.fog, seed: s.seed, open: document.getElementById('new-game-dialog').open };
  });
  if (opts.d !== 'hard' || opts.fog !== false || opts.seed !== 4242 || opts.open) throw new Error(`new game dialog: ${JSON.stringify(opts)}`);

  // heroes: a unit promoted to Veteran by a kill gets a name, shown in the unit panel and the army list
  await page.evaluate(() => window.__game.newGame(31, { happenings: false, fog: false }));
  await page.evaluate(() => window.__game.nextUnit());
  const hero = await page.evaluate(async () => {
    const g = await import('./src/game.js');
    const { neighbors } = await import('./src/hex.js');
    const w = window.__game;
    const st = w.getState();
    const u = st.units.find((x) => x.id === w.selectedId());
    const spot = neighbors(u.q, u.r).find((n) => g.isFree(st, n.q, n.r) && !g.cityAt(st, n.q, n.r));
    const foe = g.spawnUnit(st, 'warrior', 1, spot.q, spot.r);
    foe.hp = 1;
    u.xp = 2;
    g.attack(st, u.id, foe.id);
    g.drainEvents(st);
    document.getElementById('army-panel').open = true;
    w.refresh();
    return { name: u.name, kills: u.kills, panel: document.querySelector('#info .hero')?.textContent || '',
      army: document.getElementById('army').textContent, info: document.getElementById('info').textContent };
  });
  if (!hero.name || hero.kills !== 1 || hero.panel !== hero.name || !hero.army.includes(hero.name) || !hero.info.includes('1 kill')) {
    throw new Error(`heroes: ${JSON.stringify(hero)}`);
  }
  await page.screenshot({ path: 'artifacts/screenshot-hero.png' });
  await page.evaluate(() => { document.getElementById('army-panel').open = false; });

  // inspiration: an own unit next to the selected hero gets the gold badge and the tooltip names the hero
  const muse = await page.evaluate(async () => {
    const g = await import('./src/game.js');
    const { neighbors } = await import('./src/hex.js');
    const rnd = await import('./src/render.js');
    const w = window.__game;
    const st = w.getState();
    const h = st.units.find((x) => x.id === w.selectedId());
    const spot = neighbors(h.q, h.r).find((n) => g.isFree(st, n.q, n.r) && !g.cityAt(st, n.q, n.r));
    const pal = g.spawnUnit(st, 'spearman', 0, spot.q, spot.r);
    w.refresh();
    const c = rnd.tileCenter(pal.q, pal.r);
    const rect = document.getElementById('board').getBoundingClientRect();
    const k = rect.width / rnd.canvasSize(st).w;
    return { inspired: g.inspiredUnits(st, h).map((x) => x.id), pal: pal.id, name: h.name, x: rect.left + c.x * k, y: rect.top + c.y * k };
  });
  const museInfo = await page.textContent('#info');
  if (!/Inspires \d+ units? next to it/.test(museInfo)) throw new Error(`inspiration: panel "${museInfo}"`);
  if (!muse.inspired.includes(muse.pal)) throw new Error(`inspiration: ${JSON.stringify(muse)}`);
  await page.screenshot({ path: 'artifacts/screenshot-inspire.png' });
  await page.mouse.move(muse.x, muse.y);
  const museTip = await page.textContent('#tooltip');
  if (!museTip.includes(`inspired by ${muse.name}`)) throw new Error(`inspiration: tooltip "${museTip}"`);

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
    hall: document.querySelector('#stats .hall')?.textContent || '',
    timeline: [...document.querySelectorAll('#stats .timeline li')].map((li) => li.textContent),
    marks: document.querySelectorAll('#stats svg.chart .mark').length,
  }));
  if (end.winner === null || !end.banner || !end.statsOpen || end.charts !== 2 || !end.hall || end.hall.includes('Revealed')) {
    throw new Error(`game over / statistics: ${JSON.stringify(end)}`);
  }
  // war timeline: first blood and the victory are listed, the strength chart carries markers
  if (!end.timeline.some((t) => t.includes('First blood')) || !/won the war/.test(end.timeline[end.timeline.length - 1] || '') || end.marks < 2) {
    throw new Error(`war timeline: ${JSON.stringify({ timeline: end.timeline, marks: end.marks })}`);
  }
  await page.screenshot({ path: 'artifacts/screenshot-end.png', fullPage: true });
  await page.evaluate(() => document.querySelector('#stats .timeline').scrollIntoView());
  await page.screenshot({ path: 'artifacts/screenshot-timeline.png' });

  // mobile width – no horizontal scroll
  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  if (overflow) throw new Error('horizontal scroll on mobile');
  await page.screenshot({ path: 'artifacts/screenshot-mobile.png', fullPage: true });

  // "Same map again" on the game-over banner restarts the same map with the same settings
  // (looted ruins, pillaged resources and built roads are the only changes a game makes to its map – undo them before comparing)
  const endTiles = await page.evaluate(() => JSON.stringify(Object.fromEntries(Object.entries(window.__game.getState().tiles)
    .map(([k, t]) => {
      const { ruinGone, pillagedUntil, roadBuilt, ...rest } = t;
      if (roadBuilt) delete rest.road;
      return [k, ruinGone ? { ...rest, ruin: true } : rest];
    }))));
  await page.click('#banner-again');
  const again = await page.evaluate(() => {
    const s = window.__game.getState();
    return { seed: s.seed, turn: s.turn, winner: s.winner, cols: s.cols, fog: s.fog, tiles: JSON.stringify(s.tiles), info: document.getElementById('info').textContent };
  });
  if (again.seed !== 7 || again.turn !== 1 || again.winner !== null || again.cols !== 10 || again.fog !== false || again.tiles !== endTiles) {
    throw new Error(`same map again: ${JSON.stringify({ ...again, tiles: again.tiles === endTiles })}`);
  }
  if (!again.info.includes('Map 7')) throw new Error(`map number not shown: ${again.info}`);

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

  // enemy turn report: an enemy horseman destroys a weak own unit, the banner names the loss
  const report = await page.evaluate(async () => {
    const g = await import('./src/game.js');
    window.__game.newGame(777, { fog: false });
    const st = window.__game.getState();
    const mine = st.units.find((u) => u.owner === 0);
    const foe = st.units.find((u) => u.owner === 1);
    const spot = Object.values(st.tiles).find((t) => g.isPassable(st, t.q, t.r) && !g.unitAt(st, t.q, t.r)
      && Math.max(Math.abs(t.q - mine.q), Math.abs(t.r - mine.r), Math.abs(t.q + t.r - mine.q - mine.r)) === 1);
    foe.type = 'horseman'; foe.q = spot.q; foe.r = spot.r; foe.movesLeft = 4; foe.hasAttacked = false;
    mine.hp = 1;
    st.current = 1;
    const before = g.cloneState(st);
    const ok = g.attack(st, foe.id, mine.id);
    const events = g.drainEvents(st);
    st.current = 0;
    window.__game.showReport(before, events);
    const el = document.getElementById('notice');
    const mark = window.__game.lossMarks()[0];
    return { ok, text: el.textContent, hidden: el.hidden, cls: el.className, marked: !!mark && mark.q === mine.q && mark.r === mine.r };
  });
  if (!report.ok || report.hidden || report.cls !== 'bad' || !report.text.startsWith('Enemy turn: you lost') || !report.marked) {
    throw new Error(`turn report: ${JSON.stringify(report)}`);
  }
  if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)) {
    throw new Error('turn report: banner caused horizontal page scroll');
  }
  await page.screenshot({ path: 'artifacts/screenshot-report.png' });
  // ending the turn clears the banner and the marks
  const cleared = await page.evaluate(() => { window.__game.endTurn(); return window.__game.lossMarks().length; });
  if (cleared) throw new Error('turn report: loss marks not cleared at end of turn');
  await page.waitForFunction(() => !window.__game.isBusy(), null, { timeout: 15000 });

  // last-seen marker: an enemy horseman steps out of sight, a faded "?" marker stays on the tile it entered
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.evaluate(() => { window.__game.newGame(777, { fog: true }); });
  const ghost = await page.evaluate(async () => {
    const g = await import('./src/game.js');
    const hx = await import('./src/hex.js');
    const rnd = await import('./src/render.js');
    const st = window.__game.getState();
    const seen = g.visibleTiles(st, 0);
    const foe = st.units.find((u) => u.owner === 1);
    const free = (t) => t && g.isPassable(st, t.q, t.r) && !g.unitAt(st, t.q, t.r) && !g.cityAt(st, t.q, t.r)
      && g.tileAt(st, t.q, t.r).terrain === 'plains';
    let from = null; let to = null;
    for (const t of Object.values(st.tiles)) {
      if (!seen.has(hx.key(t.q, t.r)) || !free(t)) continue;
      const n = hx.neighbors(t.q, t.r).map((p) => g.tileAt(st, p.q, p.r)).find((x) => free(x) && !seen.has(hx.key(x.q, x.r)) && !(x.rivers && x.rivers.length));
      if (n && !(t.rivers && t.rivers.length)) { from = t; to = n; break; }
    }
    if (!from) return { error: 'no edge of sight found' };
    foe.type = 'horseman'; foe.q = from.q; foe.r = from.r; foe.movesLeft = 4; foe.hasAttacked = false; foe.hp = 7;
    window.__game.updateSightings();
    st.current = 1;
    const ok = g.moveUnit(st, foe.id, to.q, to.r);
    const events = g.drainEvents(st);
    st.current = 0;
    window.__game.updateSightings(events);
    const marks = window.__game.ghosts();
    const c = rnd.tileCenter(to.q, to.r);
    const rect = document.getElementById('board').getBoundingClientRect();
    const k = rect.width / rnd.canvasSize(st).w;
    return { ok, marks, to: { q: to.q, r: to.r }, x: rect.left + c.x * k, y: rect.top + c.y * k };
  });
  if (ghost.error || !ghost.ok || ghost.marks.length !== 1 || ghost.marks[0].q !== ghost.to.q || ghost.marks[0].r !== ghost.to.r) {
    throw new Error(`last seen: ${JSON.stringify(ghost)}`);
  }
  await page.mouse.move(ghost.x, ghost.y);
  const ghostTip = await page.textContent('#tooltip');
  const ghostInfo = await page.textContent('#info');
  if (!ghostTip.includes('Horseman – seen heading here') || !ghostInfo.includes('HP 7/10')) {
    throw new Error(`last seen: tooltip/panel missing (${ghostTip} | ${ghostInfo})`);
  }
  await page.screenshot({ path: 'artifacts/screenshot-lastseen.png' });

  // army panel: lists own units (ready first), the summary counts them, a click selects the unit
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.evaluate(async () => {
    const g = await import('./src/game.js');
    window.__game.newGame(54321);
    const st = window.__game.getState();
    const cap = st.cities.find((c) => c.owner === 0 && c.capital);
    const extra = g.spawnUnit(st, 'archer', 0, cap.q, cap.r);
    extra.hp = 5; extra.xp = 4; extra.movesLeft = 0; extra.hasAttacked = true; // a wounded veteran that is done
    const first = st.units.find((u) => u.owner === 0 && u.id !== extra.id);
    first.fortified = true;
    window.__game.refresh();
  });
  await page.click('#army-panel summary');
  await page.waitForSelector('#army .army-row');
  const army = await page.evaluate(() => {
    const st = window.__game.getState();
    const rows = [...document.querySelectorAll('#army .army-row')];
    return { own: st.units.filter((u) => u.owner === 0).length, rows: rows.length,
      statuses: rows.map((b) => b.querySelector('.st').textContent), ids: rows.map((b) => Number(b.dataset.army)),
      count: document.getElementById('army-count').textContent, text: document.getElementById('army').textContent };
  });
  if (army.rows !== army.own || army.statuses[0] !== 'ready' || army.statuses[army.rows - 1] !== 'done'
    || !army.statuses.includes('fortified') || !/\d+ units · \d+ ready/.test(army.count) || !army.text.includes('Archer ★')
    || !army.text.includes('5/8')) {
    throw new Error(`army panel: ${JSON.stringify(army)}`);
  }
  await page.click(`#army [data-army="${army.ids[1]}"]`);
  const armySel = await page.evaluate(() => ({ id: window.__game.selectedId(),
    sel: document.querySelector('#army .army-row.sel')?.dataset.army, info: document.getElementById('info').textContent }));
  if (armySel.id !== army.ids[1] || Number(armySel.sel) !== army.ids[1]) throw new Error(`army panel: click did not select ${JSON.stringify(armySel)}`);
  await page.screenshot({ path: 'artifacts/screenshot-army.png' });
  // phone: the zoomed map scrolls to the unit picked in the list, and nothing scrolls sideways
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => { window.__game.newGame(4242, { size: 'large', fog: false }); });
  if (!(await page.evaluate(() => document.querySelector('.board-wrap').classList.contains('zoomed')))) await page.click('#zoom');
  const far = await page.evaluate(() => {
    const st = window.__game.getState();
    const id = st.units.filter((u) => u.owner === 0)[0].id;
    // scroll the frame to the corner farthest from the unit, so selecting it has to scroll back
    const u = st.units.find((x) => x.id === id);
    const wrap = document.querySelector('.board-wrap');
    wrap.scrollTo(u.q < st.cols / 2 ? wrap.scrollWidth : 0, u.r < st.rows / 2 ? wrap.scrollHeight : 0);
    return id;
  });
  await page.evaluate(() => document.getElementById('army-panel').scrollIntoView());
  await page.click(`#army [data-army="${far}"]`);
  const armyPhone = await page.evaluate(async (id) => {
    const rnd = await import('./src/render.js');
    const st = window.__game.getState();
    const u = st.units.find((x) => x.id === id);
    const wrap = document.querySelector('.board-wrap');
    const canvas = document.getElementById('board');
    const c = rnd.tileCenter(u.q, u.r);
    const k = canvas.clientWidth / rnd.canvasSize(st).w;
    const x = c.x * k - wrap.scrollLeft; const y = c.y * k - wrap.scrollTop; // unit position inside the frame
    return { sel: window.__game.selectedId(), zoomed: wrap.classList.contains('zoomed'), x, y, w: wrap.clientWidth, h: wrap.clientHeight,
      wide: document.documentElement.scrollWidth > window.innerWidth + 1 };
  }, far);
  if (armyPhone.sel !== far || armyPhone.wide || !armyPhone.zoomed || armyPhone.x < 0 || armyPhone.x > armyPhone.w
    || armyPhone.y < 0 || armyPhone.y > armyPhone.h) throw new Error(`army panel on phone: ${JSON.stringify(armyPhone)}`);
  await page.evaluate(() => document.getElementById('army-panel').scrollIntoView());
  await page.screenshot({ path: 'artifacts/screenshot-army-mobile.png' });
  await page.click('#zoom');
  await page.keyboard.press('Escape'); // the next sections start without a selection
  await page.click('#army-panel summary');

  // advisor: an unguarded capital with an enemy close by is the first hint; clicking it selects the city;
  // collapsing the panel is remembered
  await page.setViewportSize({ width: 1280, height: 800 });
  const adv = await page.evaluate(async () => {
    const g = await import('./src/game.js');
    const hex = await import('./src/hex.js');
    window.__game.newGame(54321);
    const st = window.__game.getState();
    const cap = st.cities.find((c) => c.owner === 0 && c.capital);
    const taken = (t) => st.units.some((u) => u.q === t.q && u.r === t.r) || st.cities.some((c) => c.q === t.q && c.r === t.r);
    const spots = Object.values(st.tiles).filter((t) => g.isPassable(st, t.q, t.r) && !taken(t));
    for (const u of st.units.filter((x) => x.owner === 0 && x.q === cap.q && x.r === cap.r)) {
      const t = spots.find((x) => hex.distance(x, cap) === 1 && !taken(x));
      u.q = t.q; u.r = t.r;
    }
    const e = spots.find((x) => hex.distance(x, cap) === 2 && !taken(x));
    g.spawnUnit(st, 'horseman', 1, e.q, e.r);
    st.gold[0] = 30;
    window.__game.refresh();
    const rows = [...document.querySelectorAll('#advisor .tip-row')];
    return { name: cap.name, open: document.getElementById('advisor-panel').open, texts: rows.map((b) => b.textContent),
      first: rows[0]?.className, count: document.getElementById('advisor-count').textContent };
  });
  if (!adv.open || !/^tip-row undefended/.test(adv.first) || !adv.texts[0].includes(`${adv.name} is unguarded – an enemy Horseman is 2 tiles away.`)
    || !adv.texts.some((t) => / recruit an? [A-Z][a-z]+ in .+ \(.+\)\./.test(t)) || adv.texts.length > 3 || !/^[1-3] hints?$/.test(adv.count)) {
    throw new Error(`advisor: ${JSON.stringify(adv)}`);
  }
  await page.click('#advisor .tip-row.undefended');
  const advInfo = await page.textContent('#info');
  if (!advInfo.includes(adv.name)) throw new Error(`advisor: click did not select the city (${advInfo.slice(0, 120)})`);
  const sug = await page.evaluate(() => ({ btn: [...document.querySelectorAll('#info .buy button.suggested')].map((b) => b.dataset.buy),
    text: document.querySelector('#info .suggest')?.textContent || '' }));
  if (sug.btn.length !== 1 || !sug.text.startsWith('★ Suggested: ') || !adv.texts.some((t) => t.includes(sug.text.slice(13).split(' – ')[0]))) {
    throw new Error(`recruit suggestion: ${JSON.stringify(sug)}`);
  }
  await page.screenshot({ path: 'artifacts/screenshot-advisor.png' });
  await page.click('#advisor-panel summary');
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('game123-prefs') || '{}').advisor === false);
  if (await page.evaluate(() => document.querySelectorAll('#advisor li').length)) throw new Error('advisor: a closed panel keeps rows');
  await page.click('#advisor-panel summary');
  await page.waitForSelector('#advisor .tip-row');
  await page.keyboard.press('Escape');

  // ancient ruins: drawn on the map, described in the panel, a unit stepping on one loots it
  await page.setViewportSize({ width: 1280, height: 800 });
  const ruin = await page.evaluate(async () => {
    const g = await import('./src/game.js');
    const hx = await import('./src/hex.js');
    const rnd = await import('./src/render.js');
    window.__game.newGame(321, { fog: false, happenings: false });
    const st = window.__game.getState();
    const u = st.units.find((x) => x.owner === 0);
    let target = null; let from = null;
    for (const t of Object.values(st.tiles).filter((x) => x.ruin && x.q + x.r * 0.5 < st.cols / 2)) {
      from = hx.neighbors(t.q, t.r).map((p) => g.tileAt(st, p.q, p.r))
        .find((n) => n && g.isFree(st, n.q, n.r) && !g.cityAt(st, n.q, n.r) && g.stepCost(st, n, t) <= 2);
      if (from) { target = t; break; }
    }
    if (!target) return { error: 'no ruin with a free neighbour' };
    u.q = from.q; u.r = from.r; u.movesLeft = 2; u.hasAttacked = false; delete u.fortified;
    window.__game.refresh();
    const rect = document.getElementById('board').getBoundingClientRect();
    const k = rect.width / rnd.canvasSize(st).w;
    const pt = (p) => { const c = rnd.tileCenter(p.q, p.r); return { x: rect.left + c.x * k, y: rect.top + c.y * k }; };
    return { q: target.q, r: target.r, at: pt(target), unit: pt(u), gold: st.gold[0] };
  });
  if (ruin.error) throw new Error(`ruins: ${ruin.error}`);
  await page.mouse.move(ruin.at.x, ruin.at.y);
  const ruinInfo = await page.textContent('#info');
  if (!ruinInfo.includes('Ancient ruins')) throw new Error(`ruins: panel does not describe the ruin (${ruinInfo})`);
  await page.screenshot({ path: 'artifacts/screenshot-ruins.png' });
  await page.mouse.click(ruin.unit.x, ruin.unit.y);
  await page.mouse.click(ruin.at.x, ruin.at.y);
  await page.waitForFunction(() => !window.__game.isBusy(), null, { timeout: 5000 });
  const looted = await page.evaluate(({ q, r }) => {
    const st = window.__game.getState();
    const t = Object.values(st.tiles).find((x) => x.q === q && x.r === r);
    return { ruin: !!t.ruin, gone: t.ruinGone, log: document.getElementById('log').textContent, info: document.getElementById('info').textContent };
  }, ruin);
  if (looted.ruin || !looted.gone || !looted.log.includes('explored ancient ruins')) throw new Error(`ruins: not looted ${JSON.stringify(looted)}`);
  await page.keyboard.press('Escape'); // the next sections start without a selection

  // unrest: a player unit walks into an AI city; the city panel shows the unrest and the roof flame is drawn
  const riot = await page.evaluate(async () => {
    const hex = await import('./src/hex.js');
    const rnd = await import('./src/render.js');
    const g = await import('./src/game.js');
    window.__game.newGame(321, { fog: false, happenings: false });
    const st = window.__game.getState();
    const city = st.cities.find((c) => !c.capital);
    city.owner = 1;
    const u = st.units.find((x) => x.owner === 0);
    const from = Object.values(st.tiles).find((t) => hex.distance(t, city) === 1 && g.isPassable(st, t.q, t.r)
      && !st.units.some((x) => x.q === t.q && x.r === t.r) && !st.cities.some((c) => c.q === t.q && c.r === t.r));
    if (!from) return { error: 'no free tile next to the city' };
    u.q = from.q; u.r = from.r; u.movesLeft = 2; u.hasAttacked = false; delete u.fortified;
    window.__game.refresh();
    const rect = document.getElementById('board').getBoundingClientRect();
    const k = rect.width / rnd.canvasSize(st).w;
    const pt = (p) => { const c = rnd.tileCenter(p.q, p.r); return { x: rect.left + c.x * k, y: rect.top + c.y * k }; };
    return { id: city.id, name: city.name, at: pt(city), unit: pt(u) };
  });
  if (riot.error) throw new Error(`unrest: ${riot.error}`);
  await page.mouse.click(riot.unit.x, riot.unit.y);
  await page.mouse.click(riot.at.x, riot.at.y);
  await page.waitForFunction(() => !window.__game.isBusy(), null, { timeout: 5000 });
  await page.mouse.move(riot.unit.x, riot.unit.y);
  await page.mouse.move(riot.at.x, riot.at.y);
  const riotInfo = await page.evaluate((id) => ({ unrest: window.__game.getState().cities.find((c) => c.id === id).unrest,
    line: document.querySelector('#info .unrest')?.textContent || '', tip: document.getElementById('tooltip').textContent }), riot.id);
  if (riotInfo.unrest !== 4 || !riotInfo.line.startsWith('✊ Unrest: no income, no growth · calms in 2 turns (the garrison keeps order)')
    || !riotInfo.tip.includes('Unrest: no income')) {
    throw new Error(`unrest: ${JSON.stringify(riotInfo)}`);
  }
  await page.screenshot({ path: 'artifacts/screenshot-unrest.png' });
  await page.keyboard.press('Escape');

  // pillage: a unit on the AI's gold mine plunders it with the panel button, another one on its horses with P
  const raid = await page.evaluate(async () => {
    const g = await import('./src/game.js');
    const rnd = await import('./src/render.js');
    window.__game.newGame(321, { fog: false, happenings: false });
    const st = window.__game.getState();
    const cap = st.cities.find((c) => c.capital && c.owner === 1);
    const res = g.cityResources(st, cap);
    const mine = res.find((t) => t.resource === 'gold');
    const horses = res.find((t) => t.resource === 'horses');
    if (!mine || !horses) return { error: 'AI capital lacks a resource' };
    const mineUnits = st.units.filter((x) => x.owner === 0);
    const [a, b] = mineUnits;
    for (const [u, t] of [[a, mine], [b, horses]]) { u.q = t.q; u.r = t.r; u.movesLeft = 2; u.hasAttacked = false; delete u.fortified; }
    window.__game.refresh();
    const rect = document.getElementById('board').getBoundingClientRect();
    const k = rect.width / rnd.canvasSize(st).w;
    const pt = (p) => { const c = rnd.tileCenter(p.q, p.r); return { x: rect.left + c.x * k, y: rect.top + c.y * k }; };
    return { a: a.id, b: b.id, mine: { q: mine.q, r: mine.r, ...pt(mine) }, horses: { q: horses.q, r: horses.r, ...pt(horses) }, gold: st.gold[0] };
  });
  if (raid.error) throw new Error(`pillage: ${raid.error}`);
  await page.mouse.click(raid.mine.x, raid.mine.y);
  if (!(await page.textContent('#info')).includes('Pillage (+6 gold)')) throw new Error('pillage: no button in the unit panel');
  await page.click('#info button[data-pillage]');
  await page.waitForFunction(() => !window.__game.isBusy(), null, { timeout: 5000 });
  await page.mouse.click(raid.horses.x, raid.horses.y);
  await page.keyboard.press('p');
  await page.waitForFunction(() => !window.__game.isBusy(), null, { timeout: 5000 });
  await page.keyboard.press('Escape');
  await page.mouse.move(raid.mine.x, raid.mine.y);
  const raided = await page.evaluate((r) => {
    const st = window.__game.getState();
    const t = (p) => st.tiles[`${p.q},${p.r}`];
    return { mine: t(r.mine).pillagedUntil, horses: t(r.horses).pillagedUntil, gold: st.gold[0],
      log: document.getElementById('log').textContent, info: document.getElementById('info').textContent };
  }, raid);
  if (!raided.mine || !raided.horses || raided.gold !== raid.gold + 12) throw new Error(`pillage: not pillaged ${JSON.stringify(raided)}`);
  if (!raided.log.includes('pillaged gold mine') || !raided.info.includes('Pillaged – out of use')) throw new Error(`pillage: texts ${JSON.stringify(raided)}`);
  await page.screenshot({ path: 'artifacts/screenshot-pillage.png' });
  await page.keyboard.press('Escape');

  // repair: the AI's raid burned the player's gold mine; a unit standing on it repairs it with the panel button
  const fix = await page.evaluate(async () => {
    const g = await import('./src/game.js');
    const rnd = await import('./src/render.js');
    const st = window.__game.getState();
    const cap = st.cities.find((c) => c.capital && c.owner === 0);
    const mine = g.cityResources(st, cap).find((t) => t.resource === 'gold' || t.resource === 'horses');
    if (!mine) return { error: 'player capital lacks a resource' };
    mine.pillagedUntil = st.turn + 3;
    const u = st.units.find((x) => x.owner === 0 && x.movesLeft > 0 && !x.hasAttacked)
      || st.units.find((x) => x.owner === 0);
    u.q = mine.q; u.r = mine.r; u.movesLeft = 2; u.hasAttacked = false; delete u.fortified;
    window.__game.refresh();
    const rect = document.getElementById('board').getBoundingClientRect();
    const k = rect.width / rnd.canvasSize(st).w;
    const c = rnd.tileCenter(mine.q, mine.r);
    return { q: mine.q, r: mine.r, x: rect.left + c.x * k, y: rect.top + c.y * k, gold: st.gold[0] };
  });
  if (fix.error) throw new Error(`repair: ${fix.error}`);
  await page.mouse.click(fix.x, fix.y);
  if (!(await page.textContent('#info')).includes('Repair (3 gold)')) throw new Error('repair: no button in the unit panel');
  await page.screenshot({ path: 'artifacts/screenshot-repair.png' });
  await page.click('#info button[data-repair]');
  await page.waitForFunction(() => !window.__game.isBusy(), null, { timeout: 5000 });
  const fixed = await page.evaluate((f) => {
    const st = window.__game.getState();
    return { until: st.tiles[`${f.q},${f.r}`].pillagedUntil, gold: st.gold[0], log: document.getElementById('log').textContent };
  }, fix);
  if (fixed.until !== undefined || fixed.gold !== fix.gold - 3 || !fixed.log.includes('repaired')) throw new Error(`repair: not repaired ${JSON.stringify(fixed)}`);
  await page.keyboard.press('Escape');

  // rally point: select the capital, set a flag with the panel button and a click on the map,
  // recruit with key 1 – the recruit has a move order and leaves the city at the start of the next turn
  await page.setViewportSize({ width: 1280, height: 800 });
  const rally = await page.evaluate(async () => {
    const g = await import('./src/game.js');
    const rnd = await import('./src/render.js');
    window.__game.newGame(31, { fog: false, happenings: false });
    const st = window.__game.getState();
    const cap = st.cities.find((c) => c.capital && c.owner === 0);
    st.units = st.units.filter((u) => u.owner !== 0 || (u.q !== cap.q || u.r !== cap.r));
    st.gold[0] = 100;
    const hexDist = (a, b) => Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r), Math.abs(a.q + a.r - b.q - b.r));
    const spot = Object.values(st.tiles).find((t) => hexDist(t, cap) === 3 && g.isFree(st, t.q, t.r)
      && !g.cityAt(st, t.q, t.r) && g.canRally(st, cap, t.q, t.r));
    if (!spot) return { error: 'no tile for the flag' };
    window.__game.refresh();
    const rect = document.getElementById('board').getBoundingClientRect();
    const k = rect.width / rnd.canvasSize(st).w;
    const at = (p) => { const c = rnd.tileCenter(p.q, p.r); return { x: rect.left + c.x * k, y: rect.top + c.y * k }; };
    return { cap: { q: cap.q, r: cap.r, ...at(cap) }, spot: { q: spot.q, r: spot.r, ...at(spot) } };
  });
  if (rally.error) throw new Error(`rally: ${rally.error}`);
  await page.mouse.click(rally.cap.x, rally.cap.y);
  if (!(await page.textContent('#info')).includes('Set rally point')) throw new Error('rally: no button in the city panel');
  await page.click('#info button[data-rally]');
  if ((await page.evaluate(() => window.__game.rallyPicking())) === null) throw new Error('rally: picking did not start');
  // clicking the panel button may have scrolled the page (the side panel is long): scroll back, measure the flag tile again
  Object.assign(rally.spot, await page.evaluate(async (p) => {
    window.scrollTo(0, 0);
    const rnd = await import('./src/render.js');
    const rect = document.getElementById('board').getBoundingClientRect();
    const k = rect.width / rnd.canvasSize(window.__game.getState()).w;
    const c = rnd.tileCenter(p.q, p.r);
    return { x: rect.left + c.x * k, y: rect.top + c.y * k };
  }, rally.spot));
  await page.mouse.move(rally.spot.x, rally.spot.y);
  await page.mouse.click(rally.spot.x, rally.spot.y);
  const flagged = await page.evaluate((r) => {
    const st = window.__game.getState();
    const cap = st.cities.find((c) => c.q === r.cap.q && c.r === r.cap.r);
    return { rally: cap.rally, picking: window.__game.rallyPicking(), info: document.getElementById('info').textContent };
  }, rally);
  if (!flagged.rally || flagged.rally.q !== rally.spot.q || flagged.rally.r !== rally.spot.r || flagged.picking !== null) {
    throw new Error(`rally: flag not set ${JSON.stringify(flagged)}`);
  }
  if (!flagged.info.includes('New units march to the flag 3 tiles away')) throw new Error(`rally: panel text ${flagged.info}`);
  await page.keyboard.press('1');
  const recruit = await page.evaluate((r) => {
    const st = window.__game.getState();
    const u = st.units.find((x) => x.owner === 0 && x.q === r.cap.q && x.r === r.cap.r);
    return u ? { id: u.id, goto: u.goto } : null;
  }, rally);
  if (!recruit || !recruit.goto || recruit.goto.q !== rally.spot.q) throw new Error(`rally: recruit has no order ${JSON.stringify(recruit)}`);
  await page.screenshot({ path: 'artifacts/screenshot-rally.png' });
  await page.evaluate(() => window.__game.endTurn());
  await page.waitForFunction(() => !window.__game.isBusy() && window.__game.getState().current === 0, null, { timeout: 20000 });
  const recruitAt = await page.evaluate((id) => {
    const u = window.__game.getState().units.find((x) => x.id === id);
    return u && { q: u.q, r: u.r };
  }, recruit.id);
  if (!recruitAt || (recruitAt.q === rally.cap.q && recruitAt.r === rally.cap.r)) throw new Error(`rally: recruit did not set off ${JSON.stringify(recruitAt)}`);

  // swap places: a warrior with two own neighbours – S starts picking (blue rings), a click on one of
  // them swaps, Z undoes it
  await page.setViewportSize({ width: 1280, height: 800 });
  const swap = await page.evaluate(async () => {
    const g = await import('./src/game.js');
    const rnd = await import('./src/render.js');
    window.__game.newGame(31, { fog: false, happenings: false });
    const st = window.__game.getState();
    st.units = st.units.filter((u) => u.owner !== 0);
    const free = (t) => t && g.isFree(st, t.q, t.r) && !g.cityAt(st, t.q, t.r) && !t.ruin;
    const hexN = (t) => [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]].map(([dq, dr]) => st.tiles[`${t.q + dq},${t.r + dr}`]);
    const enemy = st.units.filter((u) => u.owner === 1);
    const far = (t) => enemy.every((e) => Math.max(Math.abs(e.q - t.q), Math.abs(e.r - t.r), Math.abs(e.q + e.r - t.q - t.r)) > 3);
    let mid = null;
    let ns = [];
    for (const t of Object.values(st.tiles)) {
      if (!free(t) || !far(t)) continue;
      ns = hexN(t).filter(free);
      if (ns.length >= 2) { mid = t; break; }
    }
    if (!mid) return { error: 'no spot' };
    const a = g.spawnUnit(st, 'warrior', 0, mid.q, mid.r);
    const b = g.spawnUnit(st, 'spearman', 0, ns[0].q, ns[0].r);
    const c = g.spawnUnit(st, 'archer', 0, ns[1].q, ns[1].r);
    for (const u of [a, b, c]) { u.movesLeft = 1; u.hasAttacked = false; }
    g.drainEvents(st);
    window.__game.refresh();
    const rect = document.getElementById('board').getBoundingClientRect();
    const k = rect.width / rnd.canvasSize(st).w;
    const at = (p) => { const cc = rnd.tileCenter(p.q, p.r); return { x: rect.left + cc.x * k, y: rect.top + cc.y * k }; };
    return { a: { id: a.id, q: a.q, r: a.r, ...at(a) }, b: { id: b.id, q: b.q, r: b.r, ...at(b) } };
  });
  if (swap.error) throw new Error(`swap: ${swap.error}`);
  await page.mouse.click(swap.a.x, swap.a.y);
  if (!(await page.textContent('#info')).includes('Swap places')) throw new Error('swap: no button in the unit panel');
  await page.keyboard.press('s');
  if ((await page.evaluate(() => window.__game.swapPicking())) !== swap.a.id) throw new Error('swap: picking did not start');
  if (!(await page.textContent('#info')).includes('Cancel swap')) throw new Error('swap: panel does not show the picking');
  await page.screenshot({ path: 'artifacts/screenshot-swap.png' });
  await page.mouse.click(swap.b.x, swap.b.y);
  await page.waitForFunction(() => !window.__game.isBusy(), null, { timeout: 10000 });
  const swapped = await page.evaluate((sw) => {
    const st = window.__game.getState();
    const pos = (id) => { const u = st.units.find((x) => x.id === id); return [u.q, u.r]; };
    return { a: pos(sw.a.id), b: pos(sw.b.id), undo: window.__game.canUndo(), picking: window.__game.swapPicking() };
  }, swap);
  if (swapped.a[0] !== swap.b.q || swapped.a[1] !== swap.b.r || swapped.b[0] !== swap.a.q || swapped.b[1] !== swap.a.r) {
    throw new Error(`swap: units did not trade tiles ${JSON.stringify(swapped)}`);
  }
  if (!swapped.undo || swapped.picking !== null) throw new Error(`swap: undo / picking state ${JSON.stringify(swapped)}`);
  await page.keyboard.press('z');
  const unswapped = await page.evaluate((id) => { const u = window.__game.getState().units.find((x) => x.id === id); return [u.q, u.r]; }, swap.a.id);
  if (unswapped[0] !== swap.a.q || unswapped[1] !== swap.a.r) throw new Error('swap: undo did not put the units back');

  // road building: a warrior next to the capital builds a road with the panel button, the tile panel names it
  const road = await page.evaluate(async () => {
    const g = await import('./src/game.js');
    const rnd = await import('./src/render.js');
    window.__game.newGame(31, { fog: false, happenings: false });
    const st = window.__game.getState();
    st.units = st.units.filter((u) => u.owner !== 0);
    st.gold[0] = 20;
    const cap = st.cities.find((c) => c.capital && c.owner === 0);
    const hexDist = (a, b) => Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r), Math.abs(a.q + a.r - b.q - b.r));
    const t = Object.values(st.tiles).find((x) => hexDist(x, cap) === 1 && g.isFree(st, x.q, x.r) && !x.road && !x.ruin
      && g.territoryOwner(st, x.q, x.r) === 0);
    if (!t) return { error: 'no tile' };
    const u = g.spawnUnit(st, 'warrior', 0, t.q, t.r);
    u.movesLeft = 2; u.hasAttacked = false;
    g.drainEvents(st);
    window.__game.refresh();
    const rect = document.getElementById('board').getBoundingClientRect();
    const k = rect.width / rnd.canvasSize(st).w;
    const c = rnd.tileCenter(t.q, t.r);
    return { q: t.q, r: t.r, x: rect.left + c.x * k, y: rect.top + c.y * k };
  });
  if (road.error) throw new Error(`road: ${road.error}`);
  await page.mouse.click(road.x, road.y);
  if (!(await page.textContent('#info')).includes('Build road (4 gold)')) throw new Error('road: no button in the unit panel');
  await page.click('#info button[data-road]');
  await page.waitForFunction(() => !window.__game.isBusy(), null, { timeout: 10000 });
  const built = await page.evaluate((p) => {
    const st = window.__game.getState();
    const t = st.tiles[`${p.q},${p.r}`];
    return { road: t.road, built: t.roadBuilt, gold: st.gold[0], log: document.getElementById('log').textContent };
  }, road);
  if (!built.road || !built.built || built.gold !== 16 || !built.log.includes('built a road')) throw new Error(`road: ${JSON.stringify(built)}`);
  await page.screenshot({ path: 'artifacts/screenshot-road.png' });

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

  // zone of control: an enemy two tiles from the selected horseman marks the tiles next to it
  await page.setViewportSize({ width: 1280, height: 800 });
  const zoc = await page.evaluate(async () => {
    const g = await import('./src/game.js');
    const rnd = await import('./src/render.js');
    window.__game.newGame(31, { fog: false });
    const st = window.__game.getState();
    const me = st.units.find((u) => u.owner === 0);
    me.type = 'horseman';
    me.movesLeft = 4;
    const foe = st.units.find((u) => u.owner === 1);
    // put the enemy on a free passable tile at distance 3 from the horseman
    const spot = Object.values(st.tiles).find((t) => g.isFree(st, t.q, t.r)
      && Math.max(Math.abs(t.q - me.q), Math.abs(t.r - me.r), Math.abs(t.q + t.r - me.q - me.r)) === 3
      && !st.cities.some((c) => c.q === t.q && c.r === t.r));
    foe.q = spot.q; foe.r = spot.r;
    const zone = g.zocTiles(st, 0);
    const reach = g.reachable(st, me);
    const stopKey = [...reach.keys()].find((k) => zone.has(k) && !st.units.some((u) => `${u.q},${u.r}` === k));
    window.__game.refresh();
    const rect = document.getElementById('board').getBoundingClientRect();
    const k = rect.width / rnd.canvasSize(st).w;
    const at = (q, r) => { const c = rnd.tileCenter(q, r); return { x: rect.left + c.x * k, y: rect.top + c.y * k }; };
    const [sq, sr] = stopKey ? stopKey.split(',').map(Number) : [0, 0];
    return { stop: stopKey ? at(sq, sr) : null, me: at(me.q, me.r) };
  });
  if (!zoc.stop) throw new Error('zoc: no reachable tile in the zone of control');
  await page.mouse.click(zoc.me.x, zoc.me.y);
  await page.mouse.move(zoc.stop.x, zoc.stop.y);
  const zocTip = await page.textContent('#tooltip');
  if (!zocTip.includes('zone of control')) throw new Error(`zoc: tooltip does not mention the zone (${zocTip})`);
  await page.screenshot({ path: 'artifacts/screenshot-zoc.png' });

  // threat overlay: T turns it on (the enemy's reach is shaded), the ⚠ button turns it off
  await page.mouse.move(5, 5);
  await page.keyboard.press('t');
  const threatOn = await page.evaluate(() => ({ on: window.__game.threatsShown(),
    pressed: document.getElementById('threats').getAttribute('aria-pressed') }));
  if (!threatOn.on || threatOn.pressed !== 'true') throw new Error(`threats: T did not turn the overlay on ${JSON.stringify(threatOn)}`);
  await page.screenshot({ path: 'artifacts/screenshot-threats.png' });
  await page.click('#threats');
  if (await page.evaluate(() => window.__game.threatsShown())) throw new Error('threats: the button did not turn the overlay off');

  // flanking: two own units next to the enemy – the attack tooltip says +20 % and the flankers get a badge
  await page.mouse.move(5, 5);
  const flank = await page.evaluate(async () => {
    const g = await import('./src/game.js');
    const hex = await import('./src/hex.js');
    const rnd = await import('./src/render.js');
    window.__game.newGame(31, { fog: false });
    const st = window.__game.getState();
    const free = (t) => t && g.isFree(st, t.q, t.r) && !st.cities.some((c) => c.q === t.q && c.r === t.r);
    const near = (p) => hex.neighbors(p.q, p.r).map((n) => g.tileAt(st, n.q, n.r)).filter(free);
    const me = st.units.find((u) => u.owner === 0);
    me.type = 'warrior'; me.hp = 10; me.movesLeft = 2; me.hasAttacked = false; me.moved = false;
    const foe = st.units.find((u) => u.owner === 1);
    // a target tile next to me with at least two more free tiles around it
    const spot = near(me).find((t) => near(t).filter((n) => hex.distance(n, me) > 0).length >= 2);
    if (!spot) return null;
    foe.q = spot.q; foe.r = spot.r;
    st.units = st.units.filter((u) => u === me || u === foe || hex.distance(u, foe) > 1);
    for (const t of near(foe).slice(0, 2)) {
      st.units.push({ id: st.nextUnitId++, type: 'warrior', owner: 0, q: t.q, r: t.r, hp: 10, movesLeft: 0, hasAttacked: true, xp: 0 });
    }
    window.__game.refresh();
    const rect = document.getElementById('board').getBoundingClientRect();
    const k = rect.width / rnd.canvasSize(st).w;
    const at = (q, r) => { const c = rnd.tileCenter(q, r); return { x: rect.left + c.x * k, y: rect.top + c.y * k }; };
    return { me: at(me.q, me.r), foe: at(foe.q, foe.r), count: g.flankers(st, me, foe).length };
  });
  if (!flank || flank.count !== 2) throw new Error(`flank: setup failed ${JSON.stringify(flank)}`);
  await page.mouse.click(flank.me.x, flank.me.y);
  await page.mouse.move(flank.foe.x + 1, flank.foe.y + 1);
  const flankTip = await page.textContent('#tooltip');
  if (!flankTip.includes('Flanking attack (+20 %)')) throw new Error(`flank: tooltip does not show the bonus (${flankTip})`);
  await page.screenshot({ path: 'artifacts/screenshot-flank.png' });
  // high ground: the attacker's tile turns into hills – the tooltip adds the bonus
  await page.evaluate(() => {
    const st = window.__game.getState();
    const me = st.units.find((u) => u.owner === 0 && u.movesLeft > 0);
    st.tiles[`${me.q},${me.r}`].terrain = 'hills';
    window.__game.refresh();
  });
  await page.mouse.move(flank.me.x, flank.me.y); // leave the target hex so the tooltip is rebuilt
  await page.mouse.move(flank.foe.x - 1, flank.foe.y - 1);
  const highTip = await page.textContent('#tooltip');
  if (!highTip.includes('high ground +20 %')) throw new Error(`high ground: tooltip does not show the bonus (${highTip})`);
  await page.screenshot({ path: 'artifacts/screenshot-highground.png' });
  // cavalry charge: the attacker becomes a horseman that has already ridden 2 move points
  await page.evaluate(() => {
    const st = window.__game.getState();
    const me = st.units.find((u) => u.owner === 0 && u.movesLeft > 0);
    me.type = 'horseman'; me.movesLeft = 2;
    const foe = st.units.find((u) => u.owner === 1 && st.units.some((m) => m === me) && Math.abs(u.q - me.q) + Math.abs(u.r - me.r) <= 2);
    if (foe) st.tiles[`${foe.q},${foe.r}`].terrain = 'plains';
    window.__game.refresh();
  });
  await page.mouse.move(flank.me.x, flank.me.y);
  await page.mouse.move(flank.foe.x + 1, flank.foe.y - 1);
  const chargeTip = await page.textContent('#tooltip');
  if (!chargeTip.includes('charge +25 %')) throw new Error(`charge: tooltip does not show the bonus (${chargeTip})`);
  if (!(await page.textContent('#info')).includes('charge ready')) throw new Error('charge: the unit panel does not say "charge ready"');
  await page.screenshot({ path: 'artifacts/screenshot-charge.png' });

  // save file: the button downloads the game, loading the file through the file input restores it,
  // a broken file shows an error and keeps the current game
  await page.evaluate(() => { window.__game.newGame(55, { fog: false }); window.__game.endTurn(); });
  await page.waitForFunction(() => !window.__game.isBusy());
  const before = await page.evaluate(() => ({ turn: window.__game.getState().turn, units: window.__game.getState().units.length }));
  await page.evaluate(() => { document.getElementById('file-panel').open = true; });
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#save-file')]);
  if (!/^hex-realm-turn-\d+-\d{4}-\d\d-\d\d\.json$/.test(download.suggestedFilename())) {
    throw new Error(`save file: odd file name ${download.suggestedFilename()}`);
  }
  const { readFile } = await import('node:fs/promises');
  const saved = await readFile(await download.path(), 'utf8');
  if (JSON.parse(saved).format !== 'hex-realm-save') throw new Error('save file: wrong format field');
  await page.evaluate(() => window.__game.newGame(56, { fog: false }));
  await page.setInputFiles('#file-input', { name: 'game.json', mimeType: 'application/json', buffer: Buffer.from(saved) });
  await page.waitForFunction((t) => window.__game.getState().turn === t, before.turn);
  const loaded = await page.evaluate(() => ({ turn: window.__game.getState().turn, units: window.__game.getState().units.length,
    seed: window.__game.getState().seed, status: document.getElementById('file-status').textContent }));
  if (loaded.seed !== 55 || loaded.units !== before.units || !loaded.status.includes('Loaded')) {
    throw new Error(`save file: load did not restore the game ${JSON.stringify(loaded)}`);
  }
  await page.setInputFiles('#file-input', { name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"oops":') });
  await page.waitForFunction(() => document.getElementById('file-status').className === 'bad');
  if ((await page.evaluate(() => window.__game.getState().seed)) !== 55) throw new Error('save file: a broken file replaced the game');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => document.getElementById('file-panel').scrollIntoView());
  if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)) {
    throw new Error('save file: panel causes horizontal scroll on mobile');
  }
  await page.screenshot({ path: 'artifacts/screenshot-file.png' });

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
