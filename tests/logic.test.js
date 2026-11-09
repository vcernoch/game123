import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame, reachable, moveUnit, attack, buyUnit, endTurn, unitAt, isPassable,
  previewAttack, cloneState, pathTo, nextActiveUnit, tileAt, cityInfo, incomeOf, defenseValue,
  drainEvents, applyEvent, migrateState, STATE_VERSION,
  visibleTiles, exploredTiles, build, unitCost, rankOf, stepCost, getUnit,
  buildingCost, unitMove, factionOf, armyPower, riverBetween, riverDefense,
  rollHappening, applyHappening, cityIncome, logFor,
} from '../src/game.js';
import {
  runAITurn, goalsFor, buildSomething, pickRecruit, assignGarrisons, isWounded, planStrike,
} from '../src/ai.js';
import { decideTap } from '../src/input.js';
import { chartSvg, summaryRows } from '../src/stats.js';
import { soundFor, createLimiter, createSound, SOUND_NAMES } from '../src/sound.js';
import { readFileSync } from 'node:fs';
import { GAME_VERSION, GAME_DATE } from '../src/version.js';
import { pathExists, generateMap, dirTo } from '../src/map.js';
import { distance, key, neighbors } from '../src/hex.js';
import {
  UNIT_TYPES, TERRAIN, BUILDINGS, BUILDING_EFFECTS, RANKS, XP, FACTIONS, MAP_SIZES, RIVER, HAPPENINGS,
} from '../src/rules.js';

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
          sum += stepCost(s, path[i - 1], path[i], u);
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
  assert.equal(unitCost(s, cap, 'warrior'), UNIT_TYPES.warrior.cost - BUILDING_EFFECTS.barracksDiscount);
  // verbování v kasárnách stojí méně
  const moveAway = [...reachable(s, u).keys()][0].split(',').map(Number);
  moveUnit(s, u.id, moveAway[0], moveAway[1]);
  const g = s.gold[0];
  assert.ok(buyUnit(s, cap.id, 'warrior'));
  assert.equal(s.gold[0], g - unitCost(s, cap, 'warrior'));
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

test('řeky: tečou po hranách, jsou souměrné a nezmění rozložení mapy', () => {
  for (const [size, cfg] of Object.entries(MAP_SIZES)) {
    let total = 0;
    for (const seed of [1, 2, 3, 9, 77]) {
      const m = generateMap(seed, cfg.cols, cfg.rows, cfg.neutralCities);
      for (const t of Object.values(m.tiles)) {
        for (const d of t.rivers || []) {
          total++;
          assert.ok(d >= 0 && d < 6);
          const n = m.tiles[key(t.q + [1, 1, 0, -1, -1, 0][d], t.r + [0, -1, -1, 0, 1, 1][d])];
          if (!n) continue; // hrana na okraji mapy
          assert.ok(n.rivers && n.rivers.includes(dirTo(n, t)), `${size}/${seed}: nesouměrná hrana`);
          assert.ok(t.terrain !== 'water' && n.terrain !== 'water', 'řeka nevede po vodě');
        }
        assert.equal(new Set(t.rivers || []).size, (t.rivers || []).length, 'hrana dvakrát');
      }
      // stejný seed = stejné řeky
      assert.deepEqual(generateMap(seed, cfg.cols, cfg.rows, cfg.neutralCities).tiles, m.tiles);
    }
    assert.ok(total / 2 >= RIVER.minLength * 5, `${size}: málo řek`);
  }
});

test('řeky: přechod stojí pohyb navíc, most ne, obránce za řekou má bonus', () => {
  const s = createGame({ seed: 1, fog: false });
  const tiles = Object.values(s.tiles);
  // bez řeky mezi a, b se cena nezmění; s řekou přibude crossCost
  const a = tiles.find((t) => t.terrain === 'plains' && !t.road);
  const b = neighbors(a.q, a.r).map((n) => s.tiles[key(n.q, n.r)]).find((t) => t && t.terrain === 'plains' && !t.road);
  const plain = stepCost(s, a, b);
  delete a.rivers; delete b.rivers;
  a.rivers = [dirTo(a, b)];
  b.rivers = [dirTo(b, a)];
  assert.ok(riverBetween(s, a, b) && riverBetween(s, b, a));
  assert.equal(stepCost(s, a, b), plain + RIVER.crossCost);
  // most: silnice na obou stranách
  a.road = true; b.road = true;
  assert.ok(stepCost(s, a, b) < plain);
  delete a.road; delete b.road;
  // boj přes řeku: bonus má jen napadený, protiúder ne
  s.units = [];
  const me = { id: 900, type: 'warrior', owner: 0, q: a.q, r: a.r, hp: 10, movesLeft: 2, hasAttacked: false, xp: 0 };
  const foe = { id: 901, type: 'warrior', owner: 1, q: b.q, r: b.r, hp: 10, movesLeft: 0, hasAttacked: true, xp: 0 };
  s.units.push(me, foe);
  const across = previewAttack(s, me, foe);
  assert.equal(riverDefense(s, me, foe), RIVER.defBonus);
  a.rivers = []; b.rivers = [];
  const dry = previewAttack(s, me, foe);
  assert.equal(riverDefense(s, me, foe), 0);
  assert.ok(across.damage < dry.damage, `přes řeku ${across.damage} < bez ${dry.damage}`);
  // dosah: přes řeku se na sousední pole dostane jen s dostatkem pohybu
  a.rivers = [dirTo(a, b)]; b.rivers = [dirTo(b, a)];
  s.units = [me];
  me.movesLeft = 2;
  assert.equal(reachable(s, me).get(key(b.q, b.r)), plain + RIVER.crossCost);
  // stará hra (verze 9) se načte bez řek
  const old = createGame({ seed: 1 });
  old.version = 9;
  for (const t of Object.values(old.tiles)) delete t.rivers;
  assert.equal(migrateState(old).version, STATE_VERSION);
});

test('náhodné události: úroda, mor a vzpoura mají správný účinek', () => {
  const s = createGame({ seed: 5, fog: false });
  const cap = s.cities.find((c) => c.owner === 0 && c.capital);
  // úroda
  const gold = s.gold[0];
  const h = applyHappening(s, 0, 'harvest', cap);
  assert.equal(s.gold[0], gold + HAPPENINGS.kinds.harvest.gold);
  assert.equal(h.gold, HAPPENINGS.kinds.harvest.gold);
  // mor: jednotky ve městě a vedle něj (i cizí) ztratí životy, ale nezemřou; vzdálené ne
  const far = { id: 950, type: 'warrior', owner: 1, q: cap.q, r: cap.r, hp: 10, movesLeft: 0, hasAttacked: true, xp: 0 };
  const spot = Object.values(s.tiles).find((t) => distance(t, cap) >= 3 && isPassable(s, t.q, t.r) && !unitAt(s, t.q, t.r));
  far.q = spot.q; far.r = spot.r;
  s.units.push(far);
  const near = s.units.filter((u) => distance(u, cap) <= 1);
  assert.ok(near.length >= 1);
  near[0].hp = 2;
  const before = new Map(s.units.map((u) => [u.id, u.hp]));
  const p = applyHappening(s, 0, 'plague', cap);
  for (const u of near) assert.equal(u.hp, Math.max(1, before.get(u.id) - HAPPENINGS.kinds.plague.damage));
  assert.equal(far.hp, 10);
  assert.equal(p.hits.length, near.length);
  // vzpoura: město bez posádky přijde o daně, s posádkou ne
  const town = s.cities.find((c) => c.owner === null);
  town.owner = 0;
  s.units = s.units.filter((u) => u.q !== town.q || u.r !== town.r);
  s.gold[0] = 30;
  const r1 = applyHappening(s, 0, 'revolt', town);
  assert.equal(s.gold[0], 30 - cityIncome(town, s));
  assert.equal(r1.suppressed, false);
  s.units.push({ id: 951, type: 'warrior', owner: 0, q: town.q, r: town.r, hp: 10, movesLeft: 0, hasAttacked: true, xp: 0 });
  const r2 = applyHappening(s, 0, 'revolt', town);
  assert.ok(r2.suppressed);
  assert.equal(s.gold[0], 30 - cityIncome(town, s));
  // vzpoura nikdy nevezme víc zlata, než hráč má
  s.units.pop();
  s.gold[0] = 1;
  applyHappening(s, 0, 'revolt', town);
  assert.equal(s.gold[0], 0);
  // přehrání události dá stejný stav
  const a = createGame({ seed: 5, fog: false });
  const b = cloneState(a);
  const c = a.cities.find((x) => x.owner === 0);
  drainEvents(a);
  applyHappening(a, 0, 'plague', c);
  applyHappening(a, 0, 'harvest', c);
  for (const ev of drainEvents(a)) applyEvent(b, ev);
  assert.deepEqual(b.units, a.units);
  assert.deepEqual(b.gold, a.gold);
});

test('náhodné události: deterministické, dají se vypnout, četnost sedí', () => {
  // stejný seed = stejné události; bez událostí se nic nestane
  const run = (happenings) => {
    const s = createGame({ seed: 21, happenings });
    const kinds = [];
    for (let i = 0; i < 80 && s.winner === null; i++) {
      runAITurn(s);
      endTurn(s);
      for (const ev of drainEvents(s)) if (ev.type === 'happening') kinds.push(`${s.turn}:${ev.kind}`);
    }
    return kinds;
  };
  assert.deepEqual(run(true), run(true));
  assert.equal(run(false).length, 0);
  // před kolem fromTurn se nic neděje; četnost zhruba podle chance
  let hits = 0;
  let tries = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const s = createGame({ seed, fog: false });
    assert.equal(rollHappening(s, 0), null, 'v 1. kole žádná událost');
    for (let turn = HAPPENINGS.fromTurn; turn < HAPPENINGS.fromTurn + 10; turn++) {
      const t = cloneState(s);
      t.turn = turn;
      tries++;
      if (rollHappening(t, 0)) hits++;
    }
  }
  const rate = hits / tries;
  assert.ok(rate > HAPPENINGS.chance * 0.5 && rate < HAPPENINGS.chance * 1.6, `četnost ${rate}`);
  // stará hra (verze 10) pokračuje bez událostí
  const old = createGame({ seed: 1 });
  old.version = 10;
  delete old.happenings;
  const m = migrateState(old);
  assert.equal(m.version, STATE_VERSION);
  assert.equal(m.happenings, false);
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

test('frakce: každá má své bonusy a AI dostane jinou než hráč', () => {
  for (const f of Object.keys(FACTIONS)) {
    const s = createGame({ seed: 10, faction: f });
    assert.equal(s.factions[0], f);
    assert.ok(FACTIONS[s.factions[1]] && s.factions[1] !== f, `AI má jinou frakci než ${f}`);
  }
  assert.equal(createGame({ seed: 10, faction: 'nesmysl' }).factions[0], 'kingdom');
  assert.equal(createGame({ seed: 10, faction: 'horde', aiFaction: 'forest' }).factions[1], 'forest');

  // Království: +1 zlato za město, levnější hradby
  const k = createGame({ seed: 10, faction: 'kingdom', aiFaction: 'horde' });
  const h = createGame({ seed: 10, faction: 'horde', aiFaction: 'kingdom' });
  assert.equal(incomeOf(k, 0), incomeOf(h, 0) + 1);
  assert.ok(buildingCost(k, 0, 'walls') < buildingCost(h, 0, 'walls'));

  // Horda: levnější a rychlejší jezdci
  const hCap = h.cities.find((c) => c.owner === 0);
  const kCap = k.cities.find((c) => c.owner === 0);
  assert.ok(unitCost(h, hCap, 'horseman') < unitCost(k, kCap, 'horseman'));
  const rider = { type: 'horseman', owner: 0 };
  assert.equal(unitMove(h, rider), UNIT_TYPES.horseman.move + 1);
  assert.equal(unitMove(k, rider), UNIT_TYPES.horseman.move);

  // Lesní lid: les za 1 a obrana v lese navíc
  const fo = createGame({ seed: 10, faction: 'forest', aiFaction: 'kingdom' });
  const forest = Object.values(fo.tiles).find((t) => t.terrain === 'forest' && !t.road);
  const from = neighbors(forest.q, forest.r).map((n) => fo.tiles[key(n.q, n.r)]).find((t) => t && !t.road);
  const elf = { type: 'warrior', owner: 0, q: forest.q, r: forest.r, xp: 0 };
  const man = { ...elf, owner: 1 };
  assert.equal(stepCost(fo, from, forest, elf), 1);
  assert.equal(stepCost(fo, from, forest, man), TERRAIN.forest.cost);
  assert.ok(defenseValue(fo, elf) > defenseValue(fo, man));

  // Horda: kořist za dobytí neutrálního města
  for (const [faction, loot] of [['horde', FACTIONS.horde.captureGold], ['kingdom', 0]]) {
    const g = createGame({ seed: 10, faction, fog: false });
    const city = g.cities.find((c) => c.owner === null);
    const u = g.units.find((x) => x.owner === 0);
    const spot = neighbors(city.q, city.r).find((n) => isPassable(g, n.q, n.r) && !unitAt(g, n.q, n.r));
    u.q = spot.q; u.r = spot.r; u.movesLeft = 9;
    const gold = g.gold[0];
    assert.ok(moveUnit(g, u.id, city.q, city.r));
    assert.equal(g.gold[0], gold + loot, faction);
  }
});

test('frakce: stará hra je bez frakcí a AI vs AI s frakcemi doběhne', () => {
  const old = createGame({ seed: 4 });
  old.version = 7;
  delete old.factions;
  const m = migrateState(old);
  assert.deepEqual(m.factions, [null, null]);
  assert.equal(factionOf(m, 0).name, '—');
  for (const faction of Object.keys(FACTIONS)) {
    const s = createGame({ seed: 21, faction });
    for (let i = 0; i < 120 && s.winner === null; i++) { runAITurn(s); endTurn(s); }
    for (const u of s.units) assert.ok(u.movesLeft <= unitMove(s, u));
  }
});

test('velikosti mapy: všechny se vygenerují propojené a hra na nich doběhne', () => {
  for (const [size, m] of Object.entries(MAP_SIZES)) {
    for (const seed of [1, 2, 3]) {
      const s = createGame({ seed, size });
      assert.equal(s.cols, m.cols);
      assert.equal(s.rows, m.rows);
      assert.equal(Object.keys(s.tiles).length, m.cols * m.rows);
      assert.equal(s.cities.length, m.neutralCities + 2);
      for (const c of s.cities) assert.ok(pathExists(s.tiles, s.cities[0], c), `${size}/${seed}: ${c.name}`);
    }
    const g = createGame({ seed: 5, size });
    for (let i = 0; i < 400 && g.winner === null; i++) { runAITurn(g); endTurn(g); }
    assert.ok(g.winner !== null || g.turn > 150, `${size}: hra se zasekla`);
  }
  assert.equal(createGame({ seed: 1, size: 'nesmysl' }).cols, 14);
});

test('zvuky: každá událost má zvuk a omezovač brání kakofonii', () => {
  assert.equal(soundFor({ type: 'move' }), 'step');
  assert.equal(soundFor({ type: 'attack', killed: true }), 'kill');
  assert.equal(soundFor({ type: 'attack' }), 'hit');
  assert.equal(soundFor({ type: 'attack', promoted: true }), 'promote');
  assert.equal(soundFor({ type: 'capture', owner: 0 }, 0), 'capture');
  assert.equal(soundFor({ type: 'capture', owner: 1 }, 0), 'lose');
  assert.equal(soundFor({ type: 'nic' }), null);
  // všechny události, které hra vyrobí, mají existující zvuk
  const s = createGame({ seed: 4, fog: false });
  for (let i = 0; i < 40 && s.winner === null; i++) {
    runAITurn(s);
    for (const ev of drainEvents(s)) {
      const name = soundFor(ev);
      assert.ok(name && SOUND_NAMES.includes(name), `událost ${ev.type} bez zvuku`);
    }
    endTurn(s);
  }
  const limit = createLimiter(100);
  assert.ok(limit('hit', 0));
  assert.ok(!limit('hit', 50), 'stejný zvuk hned znovu ne');
  assert.ok(limit('step', 50), 'jiný zvuk ano');
  assert.ok(limit('hit', 150));
  // v Node není AudioContext – přehrání nesmí spadnout
  const snd = createSound();
  assert.doesNotThrow(() => snd.play('hit'));
});

test('statistiky: historie po kolech, počítadla a graf', () => {
  const s = createGame({ seed: 4, fog: false });
  assert.equal(s.history.length, 1);
  assert.equal(s.history[0].turn, 1);
  assert.equal(armyPower(s, 0), s.history[0].power[0]);
  for (let i = 0; i < 400 && s.winner === null; i++) { runAITurn(s); endTurn(s); }
  assert.ok(s.winner !== null);
  const turns = s.history.map((e) => e.turn);
  assert.deepEqual(turns, [...new Set(turns)], 'každé kolo jen jednou');
  assert.equal(turns[turns.length - 1], s.turn, 'poslední záznam je z konce hry');
  assert.equal(s.history[s.history.length - 1].cities[1 - s.winner], 0, 'poražený nemá města');
  const total = s.stats.kills[0] + s.stats.kills[1];
  assert.equal(total, s.stats.losses[0] + s.stats.losses[1], 'co jeden zničil, druhý ztratil');
  assert.ok(total > 0 && s.stats.captures[s.winner] > 0);
  const svg = chartSvg(s.history);
  assert.equal((svg.match(/<polyline/g) || []).length, 2);
  assert.ok(!svg.includes('NaN'));
  assert.ok(!chartSvg([s.history[0]]).includes('NaN'), 'graf s jedním bodem');
  assert.ok(!chartSvg([]).includes('NaN'), 'prázdný graf');
  assert.equal(summaryRows(s).length, 4);
  // stav zůstává JSON a stará hra dostane prázdné statistiky
  assert.deepEqual(JSON.parse(JSON.stringify(s)).stats, s.stats);
  const old = createGame({ seed: 4 });
  old.version = 8;
  delete old.history;
  delete old.stats;
  const m = migrateState(old);
  assert.deepEqual(m.history, []);
  assert.deepEqual(m.stats.kills, [0, 0]);
});

test('kronika: akce soupeře v mlze hráč nevidí, vlastní a viditelné ano', () => {
  const s = createGame({ seed: 7 });
  const aiCap = s.cities.find((c) => c.owner === 1 && c.capital);
  assert.ok(!visibleTiles(s, 0).has(key(aiCap.q, aiCap.r)), 'nepřátelské hlavní město je na začátku v mlze');
  // AI naverbuje a postaví v mlze
  s.current = 1;
  s.gold[1] = 200;
  const g = unitAt(s, aiCap.q, aiCap.r);
  if (g) s.units = s.units.filter((u) => u !== g);
  assert.ok(buyUnit(s, aiCap.id, 'warrior'));
  assert.ok(build(s, aiCap.id, 'market'));
  const mine = logFor(s, 1).slice(-2);
  assert.ok(mine.every((l) => !l.hidden), 'AI vidí své akce');
  const hidden = logFor(s, 0);
  const last = hidden[hidden.length - 1];
  assert.ok(last.hidden, 'hráč akce v mlze nevidí');
  assert.equal(last.count, 2, 'po sobě jdoucí skryté akce se slijí do jednoho řádku');
  assert.ok(!hidden.some((l) => l.msg.includes('naverbován')));
  // boj, kde je hráč napaden, vidí vždy (i když útočník stojí v mlze a obránce padne)
  const victim = s.units.find((u) => u.owner === 0);
  const spot = neighbors(victim.q, victim.r).find((n) => isPassable(s, n.q, n.r) && !unitAt(s, n.q, n.r));
  const archer = { id: 999, type: 'archer', owner: 1, q: spot.q, r: spot.r, hp: 10, movesLeft: 0, hasAttacked: false, xp: 0 };
  s.units.push(archer);
  victim.hp = 1;
  assert.ok(attack(s, archer.id, victim.id));
  const after = logFor(s, 0);
  assert.ok(after[after.length - 1].msg.includes('zničil'), 'hráč vidí ztrátu vlastní jednotky');
  // neveřejné záznamy jdou do JSON a po konci hry se odkryje vše
  const copy = JSON.parse(JSON.stringify(s));
  copy.winner = 1;
  assert.ok(logFor(copy, 0).every((l) => !l.hidden));
  // bez mlhy se nic neskrývá
  const open = createGame({ seed: 7, fog: false });
  open.current = 1;
  open.gold[1] = 200;
  const cap2 = open.cities.find((c) => c.owner === 1 && c.capital);
  build(open, cap2.id, 'market');
  assert.ok(logFor(open, 0).every((l) => !l.hidden));
  // stará hra (verze 11) se načte a její záznamy zůstanou veřejné
  const old = createGame({ seed: 3 });
  old.version = 11;
  old.log = [{ turn: 1, msg: 'AI: něco' }];
  const m = migrateState(old);
  assert.equal(m.version, STATE_VERSION);
  assert.equal(logFor(m, 0)[0].msg, 'AI: něco');
});
