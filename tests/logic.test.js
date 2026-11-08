import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame, reachable, moveUnit, attack, buyUnit, endTurn, unitAt, isPassable,
  previewAttack, cloneState, pathTo, nextActiveUnit, tileAt, cityInfo, incomeOf, defenseValue,
  drainEvents, applyEvent, migrateState, STATE_VERSION,
  visibleTiles, exploredTiles, build, unitCost, rankOf, stepCost, getUnit,
} from '../src/game.js';
import {
  runAITurn, goalsFor, buildSomething, pickRecruit, assignGarrisons, isWounded, planStrike,
} from '../src/ai.js';
import { decideTap } from '../src/input.js';
import { readFileSync } from 'node:fs';
import { GAME_VERSION, GAME_DATE } from '../src/version.js';
import { pathExists } from '../src/map.js';
import { distance, key, neighbors } from '../src/hex.js';
import { UNIT_TYPES, TERRAIN, BUILDINGS, BUILDING_EFFECTS, RANKS, XP } from '../src/rules.js';

test('mapa je deterministická a startovní města jsou propojená', () => {
  for (const seed of [1, 2, 3, 42, 999]) {
    const a = createGame({ seed });
    const b = createGame({ seed });
    assert.deepEqual(a.tiles, b.tiles);
    const [c0, c1] = a.cities;
    assert.ok(pathExists(a.tiles, c0, c1), `seed ${seed}`);
    assert.equal(a.cities.length, 6);
  }
});

test('každá strana začíná se dvěma jednotkami a hráč může táhnout', () => {
  const s = createGame({ seed: 5 });
  assert.equal(s.units.filter((u) => u.owner === 0).length, 2);
  assert.equal(s.units.filter((u) => u.owner === 1).length, 2);
  for (const u of s.units.filter((x) => x.owner === 0)) assert.ok(reachable(s, u).size > 0);
});

test('pohyb nepřekročí body pohybu a nevstoupí na neprůchodné pole', () => {
  const s = createGame({ seed: 7 });
  const u = s.units.find((x) => x.owner === 0);
  for (const [k, cost] of reachable(s, u)) {
    const [q, r] = k.split(',').map(Number);
    assert.ok(isPassable(s, q, r));
    assert.ok(cost <= UNIT_TYPES[u.type].move);
    assert.ok(!unitAt(s, q, r));
  }
  const [k] = reachable(s, u).keys();
  const [q, r] = k.split(',').map(Number);
  assert.ok(moveUnit(s, u.id, q, r));
  assert.equal(u.q, q);
  assert.ok(!moveUnit(s, u.id, 999, 999));
});

test('útok ubírá životy a zničená jednotka zmizí', () => {
  const s = createGame({ seed: 11 });
  const a = s.units.find((x) => x.owner === 0 && x.type === 'warrior');
  const d = s.units.find((x) => x.owner === 1);
  // přesuneme obránce vedle útočníka na průchodné pole
  const spot = Object.values(s.tiles).find(
    (t) => distance(t, a) === 1 && isPassable(s, t.q, t.r) && !unitAt(s, t.q, t.r),
  );
  d.q = spot.q;
  d.r = spot.r;
  const before = d.hp;
  const p = previewAttack(s, a, d);
  assert.ok(attack(s, a.id, d.id));
  if (p.kills) assert.ok(!s.units.includes(d));
  else assert.equal(d.hp, before - p.damage);
  assert.ok(!attack(s, a.id, d.id), 'druhý útok ve stejném tahu nejde');
});

test('verbování stojí zlato a vyžaduje volné město', () => {
  const s = createGame({ seed: 3 });
  const city = s.cities.find((c) => c.owner === 0);
  const u = unitAt(s, city.q, city.r);
  assert.ok(!buyUnit(s, city.id, 'warrior'), 'město je obsazené');
  const [k] = reachable(s, u).keys();
  const [q, r] = k.split(',').map(Number);
  moveUnit(s, u.id, q, r);
  const gold = s.gold[0];
  assert.ok(buyUnit(s, city.id, 'warrior'));
  assert.equal(s.gold[0], gold - UNIT_TYPES.warrior.cost);
});

test('konec tahu dá příjem a obnoví pohyb', () => {
  const s = createGame({ seed: 4 });
  const gold1 = s.gold[1];
  endTurn(s);
  assert.equal(s.current, 1);
  assert.ok(s.gold[1] > gold1);
  for (const u of s.units.filter((x) => x.owner === 1)) assert.equal(u.movesLeft, UNIT_TYPES[u.type].move);
  endTurn(s);
  assert.equal(s.turn, 2);
});

test('AI vs AI odehraje 120 kol bez chyby a bez porušení pravidel', () => {
  let finished = 0;
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const s = createGame({ seed });
    for (let i = 0; i < 240 && s.winner === null; i++) {
      runAITurn(s);
      endTurn(s);
      const seen = new Set();
      for (const u of s.units) {
        const k = key(u.q, u.r);
        assert.ok(!seen.has(k), `dvě jednotky na ${k} (seed ${seed})`);
        seen.add(k);
        assert.ok(isPassable(s, u.q, u.r));
        assert.ok(u.hp > 0);
      }
      assert.ok(s.gold.every((g) => g >= 0));
    }
    if (s.winner !== null) finished++;
    JSON.parse(JSON.stringify(cloneState(s)));
  }
  assert.ok(finished >= 1, 'aspoň jedna hra AI vs AI by měla skončit');
});

test('trasa vede po sousedních polích a její cena odpovídá dosahu', () => {
  for (const seed of [3, 7, 11, 21]) {
    const s = createGame({ seed });
    for (const u of s.units.filter((x) => x.owner === 0)) {
      const reach = reachable(s, u);
      for (const [k, cost] of reach) {
        const [q, r] = k.split(',').map(Number);
        const path = pathTo(s, u, q, r);
        assert.ok(path, `trasa na ${k}`);
        assert.deepEqual(path[0], { q: u.q, r: u.r });
        assert.deepEqual(path[path.length - 1], { q, r });
        let sum = 0;
        for (let i = 1; i < path.length; i++) {
          assert.equal(distance(path[i - 1], path[i]), 1);
          assert.ok(isPassable(s, path[i].q, path[i].r));
          sum += stepCost(s, path[i - 1], path[i]);
        }
        // cena je buď součet terénu, nebo zkrácená na zbývající body (velký první krok)
        assert.ok(cost === sum || (path.length === 2 && cost === u.movesLeft), `seed ${seed} ${k}`);
      }
      assert.equal(pathTo(s, u, u.q, u.r), null);
    }
  }
});

test('Tab vybírá cyklicky jednotky, které ještě mohou jednat', () => {
  const s = createGame({ seed: 5 });
  const [a, b] = s.units.filter((u) => u.owner === 0).sort((x, y) => x.id - y.id);
  assert.equal(nextActiveUnit(s, 0).id, a.id);
  assert.equal(nextActiveUnit(s, 0, a.id).id, b.id);
  assert.equal(nextActiveUnit(s, 0, b.id).id, a.id);
  a.movesLeft = 0;
  a.hasAttacked = true;
  assert.equal(nextActiveUnit(s, 0, b.id).id, b.id);
  b.movesLeft = 0;
  b.hasAttacked = true;
  assert.equal(nextActiveUnit(s, 0), null);
});

test('informace o městě souhlasí s příjmem a obranou', () => {
  const s = createGame({ seed: 9 });
  const sum = s.cities.filter((c) => c.owner === 0).reduce((a, c) => a + cityInfo(s, c).income, 0);
  assert.equal(sum, incomeOf(s, 0));
  const capital = s.cities.find((c) => c.owner === 0 && c.capital);
  const info = cityInfo(s, capital);
  const u = unitAt(s, capital.q, capital.r);
  assert.ok(u && u.owner === 0, 'v hlavním městě stojí vlastní jednotka');
  assert.equal(info.garrison.id, u.id);
  const mult = defenseValue(s, u) / UNIT_TYPES[u.type].def;
  assert.equal(Math.round((mult - 1) * 100), info.defensePct);
  const neutral = s.cities.find((c) => c.owner === null);
  assert.equal(cityInfo(s, neutral).garrison, null);
});

// shrnutí, které musí po přehrání událostí sedět
const snapshot = (s) => ({
  units: s.units.map((u) => [u.id, u.type, u.owner, u.q, u.r, u.hp, u.xp]).sort((a, b) => a[0] - b[0]),
  cities: s.cities.map((c) => [c.id, c.owner]),
});

test('přehrání událostí AI tahu dá stejný stav jako skutečný tah', () => {
  for (const seed of [1, 4, 8, 15]) {
    const s = createGame({ seed });
    let checkedAttack = false;
    for (let i = 0; i < 60 && s.winner === null; i++) {
      drainEvents(s);
      const before = cloneState(s);
      runAITurn(s);
      const evs = drainEvents(s);
      for (const ev of evs) applyEvent(before, ev);
      assert.deepEqual(snapshot(before), snapshot(s), `seed ${seed}, krok ${i}`);
      if (evs.some((e) => e.type === 'attack')) checkedAttack = true;
      assert.doesNotThrow(() => JSON.stringify(evs));
      endTurn(s);
    }
    assert.ok(checkedAttack, `seed ${seed}: v simulaci žádný útok`);
  }
});

test('pohyb zapisuje trasu do události a stav zůstává serializovatelný', () => {
  const s = createGame({ seed: 7 });
  assert.equal(s.version, STATE_VERSION);
  assert.deepEqual(s.events, []);
  const u = s.units.find((x) => x.owner === 0);
  const [k] = reachable(s, u).keys();
  const [q, r] = k.split(',').map(Number);
  moveUnit(s, u.id, q, r);
  const [ev] = drainEvents(s);
  assert.equal(ev.type, 'move');
  assert.deepEqual(ev.path[ev.path.length - 1], { q, r });
  assert.deepEqual(s.events, []);
  assert.deepEqual(JSON.parse(JSON.stringify(s)), s);
});

test('starý uložený stav (verze 1) se převede, neznámý se zahodí', () => {
  const old = createGame({ seed: 2 });
  old.version = 1;
  delete old.events;
  const m = migrateState(old);
  assert.equal(m.version, STATE_VERSION);
  assert.deepEqual(m.events, []);
  assert.ok(m.fog && m.explored[0].length > 0, 'migrace dopočítá prozkoumaná pole');
  assert.equal(migrateState({ version: 99 }), null);
  assert.equal(migrateState(null), null);
});

test('mlha války: vidíš okolí svých jednotek a měst, prozkoumané se pamatuje', () => {
  const s = createGame({ seed: 6 });
  const vis = visibleTiles(s, 0);
  for (const u of s.units.filter((x) => x.owner === 0)) {
    assert.ok(vis.has(key(u.q, u.r)));
    const sight = UNIT_TYPES[u.type].sight;
    for (const k of Object.keys(s.tiles)) {
      const [q, r] = k.split(',').map(Number);
      if (distance(u, { q, r }) <= sight) assert.ok(vis.has(k), `pole ${k} v dohledu`);
    }
  }
  // nepřátelské hlavní město je na začátku daleko a nevidíš ho
  const enemyCap = s.cities.find((c) => c.owner === 1 && c.capital);
  assert.ok(!vis.has(key(enemyCap.q, enemyCap.r)));
  assert.ok(vis.size < Object.keys(s.tiles).length);
  // prozkoumané ⊇ viditelné a po pohybu neubývá
  const before = exploredTiles(s, 0);
  for (const k of vis) assert.ok(before.has(k));
  const u = s.units.find((x) => x.owner === 0);
  let far = null;
  for (const [k] of reachable(s, u)) {
    const [q, r] = k.split(',').map(Number);
    if (!far || distance(u, { q, r }) > distance(u, far)) far = { q, r };
  }
  moveUnit(s, u.id, far.q, far.r);
  const after = exploredTiles(s, 0);
  for (const k of before) assert.ok(after.has(k));
  assert.ok(after.size >= before.size);
  // bez mlhy nebo po konci hry je vidět všechno
  const open = createGame({ seed: 6, fog: false });
  assert.equal(visibleTiles(open, 0).size, Object.keys(open.tiles).length);
  s.winner = 0;
  assert.equal(visibleTiles(s, 0).size, Object.keys(s.tiles).length);
});

test('verze hry souhlasí s package.json a má platný formát', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(GAME_VERSION, pkg.version);
  assert.match(GAME_VERSION, /^\d+\.\d+\.\d+$/);
  assert.match(GAME_DATE, /^\d{4}-\d{2}-\d{2}$/);
});

test('obtížnost: AI na normální nevidí přes mlhu, na těžké ano a má víc zlata', () => {
  const normal = createGame({ seed: 4 });
  const hard = createGame({ seed: 4, difficulty: 'hard' });
  const easy = createGame({ seed: 4, difficulty: 'easy' });
  assert.equal(normal.difficulty, 'normal');
  assert.equal(createGame({ seed: 4, difficulty: 'nesmysl' }).difficulty, 'normal');
  assert.ok(hard.gold[1] > normal.gold[1] && normal.gold[1] > easy.gold[1]);
  assert.equal(hard.gold[0], easy.gold[0], 'hráč má vždy stejné startovní zlato');
  assert.ok(incomeOf(hard, 1) > incomeOf(normal, 1) && incomeOf(normal, 1) > incomeOf(easy, 1));
  assert.equal(incomeOf(hard, 0), incomeOf(easy, 0));

  const myCap = normal.cities.find((c) => c.owner === 0 && c.capital);
  const aiUnit = normal.units.find((u) => u.owner === 1);
  const goalsN = goalsFor(normal, aiUnit);
  assert.ok(!goalsN.some((g) => g.q === myCap.q && g.r === myCap.r && !g.explore), 'normální AI nezná hráčovo hlavní město');
  assert.ok(goalsN.every((g) => g.explore), 'na začátku normální AI jen průzkumničí');
  const aiUnitH = hard.units.find((u) => u.owner === 1);
  assert.ok(goalsFor(hard, aiUnitH).some((g) => g.q === myCap.q && g.r === myCap.r), 'těžká AI vidí vše');
});

test('obtížnost má znát: těžká AI si vede lépe než snadná', () => {
  const score = (difficulty) => {
    let total = 0;
    for (const seed of [11, 12, 13, 14, 15, 16]) {
      const s = createGame({ seed, difficulty });
      for (let i = 0; i < 80 && s.winner === null; i++) { runAITurn(s); endTurn(s); }
      total += s.winner === 1 ? 10 : s.winner === 0 ? -10 : s.cities.filter((c) => c.owner === 1).length;
    }
    return total;
  };
  const easy = score('easy');
  const hard = score('hard');
  assert.ok(hard > easy, `těžká ${hard} > snadná ${easy}`);
});

test('dotyk: první klepnutí ukáže náhled, druhé na stejné pole provede akci', () => {
  const s = createGame({ seed: 7 });
  const u = s.units.find((x) => x.owner === 0);
  const [k] = reachable(s, u).keys();
  const [q, r] = k.split(',').map(Number);
  // myš: rovnou pohyb
  assert.deepEqual(decideTap(s, { selectedId: u.id }, q, r), { type: 'move', unitId: u.id, q, r });
  // dotyk: nejdřív náhled, pak pohyb
  const first = decideTap(s, { selectedId: u.id, confirm: true }, q, r);
  assert.equal(first.type, 'preview');
  assert.equal(first.kind, 'move');
  const second = decideTap(s, { selectedId: u.id, confirm: true, pending: { q: first.q, r: first.r } }, q, r);
  assert.equal(second.type, 'move');
  // klepnutí jinam náhled zruší (výběr), klepnutí mimo mapu nic
  const elsewhere = decideTap(s, { selectedId: u.id, confirm: true, pending: { q, r } }, u.q, u.r);
  assert.equal(elsewhere.type, 'select');
  assert.equal(elsewhere.unitId, u.id);
  assert.equal(decideTap(s, { selectedId: u.id }, 999, 999).type, 'none');
});

test('dotyk: útok potřebuje potvrzení a skrytou jednotku v mlze nejde vybrat', () => {
  const s = createGame({ seed: 7 });
  const u = s.units.find((x) => x.owner === 0);
  const enemy = s.units.find((x) => x.owner === 1);
  // nepřítel daleko v mlze: klepnutí na něj ho nevybere
  assert.equal(decideTap(s, { selectedId: null }, enemy.q, enemy.r).unitId, null);
  // přesuneme nepřítele vedle naší jednotky (pole volné a průchozí)
  const spot = neighbors(u.q, u.r).find((n) => isPassable(s, n.q, n.r) && !unitAt(s, n.q, n.r));
  enemy.q = spot.q;
  enemy.r = spot.r;
  const first = decideTap(s, { selectedId: u.id, confirm: true }, spot.q, spot.r);
  assert.equal(first.type, 'preview');
  assert.equal(first.kind, 'attack');
  assert.equal(first.targetId, enemy.id);
  const second = decideTap(s, { selectedId: u.id, confirm: true, pending: spot }, spot.q, spot.r);
  assert.deepEqual(second, { type: 'attack', unitId: u.id, targetId: enemy.id });
});

test('budovy: stojí zlato, nejdou postavit dvakrát a mají účinek', () => {
  const s = createGame({ seed: 3 });
  const cap = s.cities.find((c) => c.owner === 0 && c.capital);
  const neutral = s.cities.find((c) => c.owner === null);
  s.gold[0] = 100;
  const incomeBefore = incomeOf(s, 0);
  assert.ok(build(s, cap.id, 'market'));
  assert.equal(s.gold[0], 100 - BUILDINGS.market.cost);
  assert.ok(!build(s, cap.id, 'market'), 'druhý trh ne');
  assert.ok(!build(s, neutral.id, 'walls'), 'cizí město ne');
  assert.equal(incomeOf(s, 0), incomeBefore + BUILDING_EFFECTS.marketIncome);

  const u = unitAt(s, cap.q, cap.r);
  const defBefore = defenseValue(s, u);
  const pctBefore = cityInfo(s, cap).defensePct;
  assert.ok(build(s, cap.id, 'walls'));
  assert.ok(Math.abs(defenseValue(s, u) - defBefore * (1 + BUILDING_EFFECTS.wallsDefense)) < 1e-9);
  assert.ok(cityInfo(s, cap).defensePct > pctBefore);
  const mult = defenseValue(s, u) / UNIT_TYPES[u.type].def;
  assert.equal(Math.round((mult - 1) * 100), cityInfo(s, cap).defensePct);

  assert.ok(build(s, cap.id, 'barracks'));
  assert.equal(unitCost(cap, 'warrior'), UNIT_TYPES.warrior.cost - BUILDING_EFFECTS.barracksDiscount);
  // verbování v kasárnách stojí méně
  const moveAway = [...reachable(s, u).keys()][0].split(',').map(Number);
  moveUnit(s, u.id, moveAway[0], moveAway[1]);
  const g = s.gold[0];
  assert.ok(buyUnit(s, cap.id, 'warrior'));
  assert.equal(s.gold[0], g - unitCost(cap, 'warrior'));
  s.gold[0] = 0;
  assert.ok(!build(s, cap.id, 'nesmysl'));
});

test('budovy: AI staví z přebytku a stará hra dostane prázdné budovy', () => {
  const s = createGame({ seed: 5 });
  s.current = 1;
  s.gold[1] = 200;
  buildSomething(s, 1);
  const aiCap = s.cities.find((c) => c.owner === 1 && c.capital);
  assert.ok(aiCap.buildings.includes('market'));
  assert.ok(s.gold[1] >= 0);
  const old = createGame({ seed: 5 });
  old.version = 4;
  for (const c of old.cities) delete c.buildings;
  const m = migrateState(old);
  assert.equal(m.version, STATE_VERSION);
  assert.ok(m.cities.every((c) => Array.isArray(c.buildings)));
  assert.ok(m.units.every((u) => u.xp === 0));
});

// Postaví souboj: naše jednotka typu `type` a nepřítel `enemyType` vedle ní na pláni.
function duel(seed, type = 'warrior', enemyType = 'warrior') {
  const s = createGame({ seed, fog: false });
  s.units = [];
  const free = Object.values(s.tiles).filter((t) => t.terrain === 'plains' && !s.cities.some((c) => c.q === t.q && c.r === t.r));
  const a = free.find((t) => neighbors(t.q, t.r).some((n) => free.some((f) => f.q === n.q && f.r === n.r)));
  const b = free.find((f) => distance(f, a) === 1);
  const me = { id: 900, type, owner: 0, q: a.q, r: a.r, hp: UNIT_TYPES[type].hp, movesLeft: 2, hasAttacked: false, xp: 0 };
  const foe = { id: 901, type: enemyType, owner: 1, q: b.q, r: b.r, hp: UNIT_TYPES[enemyType].hp, movesLeft: 0, hasAttacked: true, xp: 0 };
  s.units.push(me, foe);
  return { s, me, foe };
}

test('zkušenosti: útok a obrana dávají XP, zničení víc', () => {
  const { s, me, foe } = duel(3);
  attack(s, me.id, foe.id);
  assert.equal(me.xp, XP.attack);
  assert.equal(foe.xp, XP.defend);
  const d2 = duel(3);
  d2.foe.hp = 1;
  attack(d2.s, d2.me.id, d2.foe.id);
  assert.equal(d2.me.xp, XP.attack + XP.kill);
});

test('zkušenosti: povýšení zvýší sílu a vyléčí, hodnosti podle prahů', () => {
  assert.equal(rankOf({ xp: 0 }), 0);
  assert.equal(rankOf({ xp: RANKS[1].xp }), 1);
  assert.equal(rankOf({ xp: RANKS[2].xp + 5 }), 2);
  assert.equal(rankOf({}), 0);
  const { s, me, foe } = duel(4);
  const base = previewAttack(s, me, foe);
  const baseDef = defenseValue(s, me);
  me.xp = RANKS[2].xp;
  const elite = previewAttack(s, me, foe);
  assert.ok(elite.damage >= base.damage);
  assert.ok(Math.abs(defenseValue(s, me) - baseDef * (1 + 2 * XP.rankBonus)) < 1e-9);
  // povýšení během útoku: těsně pod prahem + oslabený
  const p = duel(4);
  p.me.xp = RANKS[1].xp - XP.attack;
  p.me.hp = 4;
  p.foe.hp = 1;
  attack(p.s, p.me.id, p.foe.id);
  assert.equal(rankOf(p.me), 1);
  assert.equal(p.me.hp, 4 + XP.promotionHeal);
  assert.ok(p.s.log.some((l) => l.msg.includes('povýšen')));
});

test('kopiník je silný proti jezdcům v útoku i v obraně', () => {
  const asWarrior = duel(6, 'warrior', 'horseman');
  const asSpear = duel(6, 'spearman', 'horseman');
  const w = previewAttack(asWarrior.s, asWarrior.me, asWarrior.foe);
  const k = previewAttack(asSpear.s, asSpear.me, asSpear.foe);
  assert.ok(k.damage > w.damage, `kopiník ${k.damage} > válečník ${w.damage}`);
  // jezdec útočí na kopiníka a dostane silnější protiúder než od válečníka
  const hw = previewAttack(asWarrior.s, asWarrior.foe, asWarrior.me);
  const hk = previewAttack(asSpear.s, asSpear.foe, asSpear.me);
  assert.ok(hk.damage < hw.damage, 'kopiník se proti jezdci lépe brání');
  assert.ok(hk.counter > hw.counter, 'a silněji vrací úder');
  // proti válečníkovi bonus nemá
  const plain = duel(6, 'spearman', 'warrior');
  assert.equal(defenseValue(plain.s, plain.me, plain.foe), defenseValue(plain.s, plain.me));
});

test('katapult je silný proti posádce města a ignoruje hradby', () => {
  const { s, me, foe } = duel(8, 'catapult', 'warrior');
  const field = previewAttack(s, me, foe);
  // dáme nepřítele do města s hradbami
  const city = s.cities.find((c) => c.owner === 1);
  foe.q = city.q;
  foe.r = city.r;
  city.buildings = ['walls'];
  // katapult na dostřel 2
  const spot = Object.values(s.tiles).find((t) => distance(t, city) === 2 && isPassable(s, t.q, t.r) && !unitAt(s, t.q, t.r));
  me.q = spot.q;
  me.r = spot.r;
  const catVsCity = previewAttack(s, me, foe);
  const archer = { ...me, id: 902, type: 'archer', hp: UNIT_TYPES.archer.hp };
  s.units.push(archer);
  const archVsCity = previewAttack(s, archer, foe);
  assert.ok(defenseValue(s, foe, me) < defenseValue(s, foe, archer), 'hradby proti katapultu neplatí');
  assert.ok(catVsCity.damage > archVsCity.damage * 1.5, `katapult ${catVsCity.damage} vs lučištník ${archVsCity.damage}`);
  assert.ok(catVsCity.damage >= field.damage * 0.8);
});

test('AI verbuje i nové jednotky a na jezdce odpovídá kopiníky', () => {
  const s = createGame({ seed: 2, fog: false });
  const cap = s.cities.find((c) => c.owner === 1 && c.capital);
  s.current = 1;
  s.gold[1] = 100;
  for (let i = 0; i < 3; i++) {
    const u = s.units.find((x) => x.owner === 0);
    s.units.push({ ...u, id: 800 + i, type: 'horseman' });
  }
  assert.equal(pickRecruit(s, 1, cap), 'spearman');
  const seen = new Set();
  for (const seed of [1, 2, 3]) {
    const g = createGame({ seed });
    for (let i = 0; i < 80 && g.winner === null; i++) {
      runAITurn(g);
      endTurn(g);
      for (const u of g.units) seen.add(u.type);
    }
  }
  assert.ok(seen.has('spearman') && seen.has('catapult'), [...seen].join(','));
});

test('silnice spojují všechna města a zrychlují pohyb', () => {
  for (const seed of [1, 2, 3, 9, 77]) {
    const s = createGame({ seed });
    const roads = Object.values(s.tiles).filter((t) => t.road);
    assert.ok(roads.length >= s.cities.length, `seed ${seed}: málo silnic`);
    for (const c of s.cities) assert.ok(s.tiles[key(c.q, c.r)].road, `město ${c.name} bez silnice`);
    // po silnicích se dá dojít z prvního města do všech ostatních
    const start = key(s.cities[0].q, s.cities[0].r);
    const seen = new Set([start]);
    const queue = [s.cities[0]];
    while (queue.length) {
      const cur = queue.shift();
      for (const n of neighbors(cur.q, cur.r)) {
        const k = key(n.q, n.r);
        if (!seen.has(k) && s.tiles[k] && s.tiles[k].road) { seen.add(k); queue.push(n); }
      }
    }
    for (const c of s.cities) assert.ok(seen.has(key(c.q, c.r)), `seed ${seed}: ${c.name} mimo síť`);
    assert.ok(roads.every((t) => isPassable(s, t.q, t.r)));
  }
  // krok po silnici je levnější než po terénu
  const s = createGame({ seed: 1 });
  const a = Object.values(s.tiles).find((t) => t.road && neighbors(t.q, t.r).some((n) => s.tiles[key(n.q, n.r)]?.road));
  const b = neighbors(a.q, a.r).map((n) => s.tiles[key(n.q, n.r)]).find((t) => t && t.road);
  assert.ok(stepCost(s, a, b) < TERRAIN[b.terrain].cost);
  // stará hra (verze 6) se načte bez silnic
  const old = createGame({ seed: 1 });
  old.version = 6;
  for (const t of Object.values(old.tiles)) delete t.road;
  assert.equal(migrateState(old).version, STATE_VERSION);
});

test('lepší AI: ohrožené prázdné město dostane posádku', () => {
  const s = createGame({ seed: 3, fog: false, difficulty: 'hard' });
  endTurn(s); // na tahu je AI a její jednotky mají body pohybu
  const city = s.cities.find((c) => c.owner === 1 && c.capital);
  const inCity = unitAt(s, city.q, city.r);
  // vyklidit město: jednotku přesuneme na volné sousední pole
  const out = neighbors(city.q, city.r).find((n) => isPassable(s, n.q, n.r) && !unitAt(s, n.q, n.r));
  inCity.q = out.q; inCity.r = out.r;
  // nepřítel dvě pole od města
  const spot = Object.values(s.tiles).find((t) => distance(t, city) === 2 && isPassable(s, t.q, t.r) && !unitAt(s, t.q, t.r) && !s.cities.some((c) => c.q === t.q && c.r === t.r));
  s.units.push({ id: 700, type: 'warrior', owner: 0, q: spot.q, r: spot.r, hp: 10, movesLeft: 0, hasAttacked: true, xp: 0 });
  const g = assignGarrisons(s, 1);
  assert.ok([...g.values()].some((c) => c.id === city.id), 'město má přidělenou posádku');
  runAITurn(s);
  const holder = unitAt(s, city.q, city.r);
  assert.ok(holder && holder.owner === 1, 'po tahu AI v městě stojí její jednotka');
});

test('lepší AI: těžce zraněná jednotka ustoupí místo útoku', () => {
  const { s, me, foe } = duel(5, 'warrior', 'warrior');
  // AI je hráč 1 => otočíme role: foe patří AI a je skoro mrtvý
  s.current = 1;
  s.difficulty = 'hard';
  foe.hp = 2;
  foe.movesLeft = 2;
  foe.hasAttacked = false;
  me.hp = 10;
  assert.ok(isWounded(foe));
  const before = distance(foe, me);
  runAITurn(s);
  const after = getUnit(s, foe.id);
  assert.ok(after, 'zraněná jednotka přežila tah');
  assert.equal(me.hp, 10, 'nezaútočila sebevražedně');
  assert.ok(distance(after, me) >= before, 'odstoupila');
});

test('lepší AI: dojde na výhodné pole a dorazí oslabeného nepřítele', () => {
  const { s, me, foe } = duel(5, 'warrior', 'horseman');
  s.current = 1;
  s.difficulty = 'hard';
  // AI jezdec (foe) stojí dál; náš válečník je oslabený – AI by měla dojet a zničit ho
  me.hp = 2;
  const far = Object.values(s.tiles).find((t) => distance(t, me) === 3 && isPassable(s, t.q, t.r) && reachableFrom(s, foe, t));
  foe.q = far.q; foe.r = far.r;
  foe.movesLeft = UNIT_TYPES.horseman.move;
  foe.hasAttacked = false;
  assert.ok(planStrike(s, foe));
  assert.equal(getUnit(s, me.id), undefined, 'oslabený válečník zničen');
});

// pomocník: dá se na pole t dojet (bez ohledu na to, kdo zrovna táhne)
function reachableFrom(s, unit, t) {
  const saved = { q: unit.q, r: unit.r };
  unit.q = t.q; unit.r = t.r;
  const ok = isPassable(s, t.q, t.r) && !s.units.some((u) => u !== unit && u.q === t.q && u.r === t.r);
  unit.q = saved.q; unit.r = saved.r;
  return ok;
}
