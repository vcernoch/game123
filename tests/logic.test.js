import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame, reachable, moveUnit, attack, buyUnit, endTurn, unitAt, isPassable,
  previewAttack, cloneState, pathTo, nextActiveUnit, tileAt, cityInfo, incomeOf, defenseValue,
  drainEvents, applyEvent, migrateState, STATE_VERSION,
  visibleTiles, exploredTiles, build, unitCost, rankOf, stepCost, getUnit,
  buildingCost, unitMove, factionOf, armyPower, riverBetween, riverDefense,
  rollHappening, applyHappening, cityIncome, logFor, isUndoableMove, canFortify, fortify, activeUnits, territoryMap, territoryOwner, planRoute, setOrder, runOrders, cancelOrder, cityHeal, citySight, cityResources, unitSummary, zocTiles,
  exportGame, importGame, saveFileName, stateProblem, SAVE_FORMAT, threatTiles,
} from '../src/game.js';
import {
  runAITurn, goalsFor, buildSomething, pickRecruit, assignGarrisons, isWounded, planStrike,
  dangerMap, dangerPenalty, moveTowardsGoal, DANGER,
} from '../src/ai.js';
import { decideTap } from '../src/input.js';
import { SHORTCUTS, keyAction, recruitKey } from '../src/keys.js';
import { chartSvg, summaryRows } from '../src/stats.js';
import { soundFor, createLimiter, createSound, SOUND_NAMES } from '../src/sound.js';
import { readFileSync } from 'node:fs';
import { GAME_VERSION, GAME_DATE } from '../src/version.js';
import { pathExists, generateMap, dirTo } from '../src/map.js';
import { distance, key, neighbors } from '../src/hex.js';
import {
  RESOURCES, FORTIFY, TERRITORY, ECONOMY, UNIT_TYPES, TERRAIN, BUILDINGS, BUILDING_EFFECTS, RANKS, XP, FACTIONS, MAP_SIZES, RIVER, HAPPENINGS,
} from '../src/rules.js';

test('map is deterministic and starting cities are connected', () => {
  for (const seed of [1, 2, 3, 42, 999]) {
    const a = createGame({ seed });
    const b = createGame({ seed });
    assert.deepEqual(a.tiles, b.tiles);
    const [c0, c1] = a.cities;
    assert.ok(pathExists(a.tiles, c0, c1), `seed ${seed}`);
    assert.equal(a.cities.length, 6);
  }
});

test('each side starts with two units and the player can move', () => {
  const s = createGame({ seed: 5 });
  assert.equal(s.units.filter((u) => u.owner === 0).length, 2);
  assert.equal(s.units.filter((u) => u.owner === 1).length, 2);
  for (const u of s.units.filter((x) => x.owner === 0)) assert.ok(reachable(s, u).size > 0);
});

test('movement does not exceed move points or enter impassable tiles', () => {
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

test('attack reduces HP and a destroyed unit disappears', () => {
  const s = createGame({ seed: 11 });
  const a = s.units.find((x) => x.owner === 0 && x.type === 'warrior');
  const d = s.units.find((x) => x.owner === 1);
  // move the defender next to the attacker onto a passable tile
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
  assert.ok(!attack(s, a.id, d.id), 'no second attack in the same turn');
});

test('recruiting costs gold and requires a free city', () => {
  const s = createGame({ seed: 3 });
  const city = s.cities.find((c) => c.owner === 0);
  const u = unitAt(s, city.q, city.r);
  assert.ok(!buyUnit(s, city.id, 'warrior'), 'the city is occupied');
  const [k] = reachable(s, u).keys();
  const [q, r] = k.split(',').map(Number);
  moveUnit(s, u.id, q, r);
  const gold = s.gold[0];
  assert.ok(buyUnit(s, city.id, 'warrior'));
  assert.equal(s.gold[0], gold - UNIT_TYPES.warrior.cost);
});

test('ending the turn gives income and restores movement', () => {
  const s = createGame({ seed: 4 });
  const gold1 = s.gold[1];
  endTurn(s);
  assert.equal(s.current, 1);
  assert.ok(s.gold[1] > gold1);
  for (const u of s.units.filter((x) => x.owner === 1)) assert.equal(u.movesLeft, UNIT_TYPES[u.type].move);
  endTurn(s);
  assert.equal(s.turn, 2);
});

test('AI vs AI plays 120 turns without errors or rule violations', () => {
  let finished = 0;
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const s = createGame({ seed });
    for (let i = 0; i < 240 && s.winner === null; i++) {
      runAITurn(s);
      endTurn(s);
      const seen = new Set();
      for (const u of s.units) {
        const k = key(u.q, u.r);
        assert.ok(!seen.has(k), `two units on ${k} (seed ${seed})`);
        seen.add(k);
        assert.ok(isPassable(s, u.q, u.r));
        assert.ok(u.hp > 0);
      }
      assert.ok(s.gold.every((g) => g >= 0));
    }
    if (s.winner !== null) finished++;
    JSON.parse(JSON.stringify(cloneState(s)));
  }
  assert.ok(finished >= 1, 'at least one AI vs AI game should finish');
});

test('path runs over neighboring tiles and its cost matches reachability', () => {
  for (const seed of [3, 7, 11, 21]) {
    const s = createGame({ seed });
    for (const u of s.units.filter((x) => x.owner === 0)) {
      const reach = reachable(s, u);
      for (const [k, cost] of reach) {
        const [q, r] = k.split(',').map(Number);
        const path = pathTo(s, u, q, r);
        assert.ok(path, `path to ${k}`);
        assert.deepEqual(path[0], { q: u.q, r: u.r });
        assert.deepEqual(path[path.length - 1], { q, r });
        let sum = 0;
        for (let i = 1; i < path.length; i++) {
          assert.equal(distance(path[i - 1], path[i]), 1);
          assert.ok(isPassable(s, path[i].q, path[i].r));
          sum += stepCost(s, path[i - 1], path[i], u);
        }
        // the cost is either the terrain sum, or capped to the remaining points (big first step)
        assert.ok(cost === sum || (path.length === 2 && cost === u.movesLeft), `seed ${seed} ${k}`);
      }
      assert.equal(pathTo(s, u, u.q, u.r), null);
    }
  }
});

test('Tab cycles through units that can still act', () => {
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

test('city info matches income and defense', () => {
  const s = createGame({ seed: 9 });
  const sum = s.cities.filter((c) => c.owner === 0).reduce((a, c) => a + cityInfo(s, c).income, 0);
  assert.equal(sum, incomeOf(s, 0));
  const capital = s.cities.find((c) => c.owner === 0 && c.capital);
  const info = cityInfo(s, capital);
  const u = unitAt(s, capital.q, capital.r);
  assert.ok(u && u.owner === 0, 'an own unit stands in the capital');
  assert.equal(info.garrison.id, u.id);
  const mult = defenseValue(s, u) / UNIT_TYPES[u.type].def;
  assert.equal(Math.round((mult - 1) * 100), info.defensePct);
  const neutral = s.cities.find((c) => c.owner === null);
  assert.equal(cityInfo(s, neutral).garrison, null);
});

// summary that must match after replaying events
const snapshot = (s) => ({
  units: s.units.map((u) => [u.id, u.type, u.owner, u.q, u.r, u.hp, u.xp, !!u.fortified]).sort((a, b) => a[0] - b[0]),
  cities: s.cities.map((c) => [c.id, c.owner]),
});

test('replaying AI turn events gives the same state as the real turn', () => {
  for (const seed of [1, 4, 8, 15]) {
    const s = createGame({ seed });
    let checkedAttack = false;
    for (let i = 0; i < 60 && s.winner === null; i++) {
      drainEvents(s);
      const before = cloneState(s);
      runAITurn(s);
      const evs = drainEvents(s);
      for (const ev of evs) applyEvent(before, ev);
      assert.deepEqual(snapshot(before), snapshot(s), `seed ${seed}, step ${i}`);
      if (evs.some((e) => e.type === 'attack')) checkedAttack = true;
      assert.doesNotThrow(() => JSON.stringify(evs));
      endTurn(s);
    }
    assert.ok(checkedAttack, `seed ${seed}: no attack in the simulation`);
  }
});

test('movement records the path in the event and the state stays serializable', () => {
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

test('old saved state (version 1) is migrated, unknown is discarded', () => {
  const old = createGame({ seed: 2 });
  old.version = 1;
  delete old.events;
  const m = migrateState(old);
  assert.equal(m.version, STATE_VERSION);
  assert.deepEqual(m.events, []);
  assert.ok(m.fog && m.explored[0].length > 0, 'migration computes explored tiles');
  assert.equal(migrateState({ version: 99 }), null);
  assert.equal(migrateState(null), null);
});

test('fog of war: you see around your units and cities, explored tiles are remembered', () => {
  const s = createGame({ seed: 6 });
  const vis = visibleTiles(s, 0);
  for (const u of s.units.filter((x) => x.owner === 0)) {
    assert.ok(vis.has(key(u.q, u.r)));
    const sight = UNIT_TYPES[u.type].sight;
    for (const k of Object.keys(s.tiles)) {
      const [q, r] = k.split(',').map(Number);
      if (distance(u, { q, r }) <= sight) assert.ok(vis.has(k), `tile ${k} in sight`);
    }
  }
  // the enemy capital is far away at the start and you can't see it
  const enemyCap = s.cities.find((c) => c.owner === 1 && c.capital);
  assert.ok(!vis.has(key(enemyCap.q, enemyCap.r)));
  assert.ok(vis.size < Object.keys(s.tiles).length);
  // explored ⊇ visible and doesn't shrink after moving
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
  // without fog or after game over everything is visible
  const open = createGame({ seed: 6, fog: false });
  assert.equal(visibleTiles(open, 0).size, Object.keys(open.tiles).length);
  s.winner = 0;
  assert.equal(visibleTiles(s, 0).size, Object.keys(s.tiles).length);
});

test('game version matches package.json and has a valid format', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(GAME_VERSION, pkg.version);
  assert.match(GAME_VERSION, /^\d+\.\d+\.\d+$/);
  assert.match(GAME_DATE, /^\d{4}-\d{2}-\d{2}$/);
});

test('difficulty: normal AI cannot see through fog, hard AI can and has more gold', () => {
  const normal = createGame({ seed: 4 });
  const hard = createGame({ seed: 4, difficulty: 'hard' });
  const easy = createGame({ seed: 4, difficulty: 'easy' });
  assert.equal(normal.difficulty, 'normal');
  assert.equal(createGame({ seed: 4, difficulty: 'nesmysl' }).difficulty, 'normal');
  assert.ok(hard.gold[1] > normal.gold[1] && normal.gold[1] > easy.gold[1]);
  assert.equal(hard.gold[0], easy.gold[0], 'the player always has the same starting gold');
  assert.ok(incomeOf(hard, 1) > incomeOf(normal, 1) && incomeOf(normal, 1) > incomeOf(easy, 1));
  assert.equal(incomeOf(hard, 0), incomeOf(easy, 0));

  const myCap = normal.cities.find((c) => c.owner === 0 && c.capital);
  const aiUnit = normal.units.find((u) => u.owner === 1);
  const goalsN = goalsFor(normal, aiUnit);
  assert.ok(!goalsN.some((g) => g.q === myCap.q && g.r === myCap.r && !g.explore), 'normal AI does not know the player capital');
  assert.ok(goalsN.every((g) => g.explore), 'at the start normal AI only explores');
  const aiUnitH = hard.units.find((u) => u.owner === 1);
  assert.ok(goalsFor(hard, aiUnitH).some((g) => g.q === myCap.q && g.r === myCap.r), 'hard AI sees everything');
});

test('difficulty matters: hard AI does better than easy', () => {
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
  assert.ok(hard > easy, `hard ${hard} > easy ${easy}`);
});

test('touch: first tap shows a preview, second tap on the same tile performs the action', () => {
  const s = createGame({ seed: 7 });
  const u = s.units.find((x) => x.owner === 0);
  const [k] = reachable(s, u).keys();
  const [q, r] = k.split(',').map(Number);
  // mouse: move right away
  assert.deepEqual(decideTap(s, { selectedId: u.id }, q, r), { type: 'move', unitId: u.id, q, r });
  // touch: preview first, then move
  const first = decideTap(s, { selectedId: u.id, confirm: true }, q, r);
  assert.equal(first.type, 'preview');
  assert.equal(first.kind, 'move');
  const second = decideTap(s, { selectedId: u.id, confirm: true, pending: { q: first.q, r: first.r } }, q, r);
  assert.equal(second.type, 'move');
  // tapping elsewhere cancels the preview (select), tapping off the map does nothing
  const elsewhere = decideTap(s, { selectedId: u.id, confirm: true, pending: { q, r } }, u.q, u.r);
  assert.equal(elsewhere.type, 'select');
  assert.equal(elsewhere.unitId, u.id);
  assert.equal(decideTap(s, { selectedId: u.id }, 999, 999).type, 'none');
});

test('touch: attack needs confirmation and a unit hidden in fog cannot be selected', () => {
  const s = createGame({ seed: 7 });
  const u = s.units.find((x) => x.owner === 0);
  const enemy = s.units.find((x) => x.owner === 1);
  // enemy far away in fog: tapping it does not select it
  assert.equal(decideTap(s, { selectedId: null }, enemy.q, enemy.r).unitId, null);
  // move the enemy next to our unit (tile free and passable)
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

test('buildings: cost gold, cannot be built twice and have an effect', () => {
  const s = createGame({ seed: 3 });
  const cap = s.cities.find((c) => c.owner === 0 && c.capital);
  const neutral = s.cities.find((c) => c.owner === null);
  s.gold[0] = 100;
  const incomeBefore = incomeOf(s, 0);
  assert.ok(build(s, cap.id, 'market'));
  assert.equal(s.gold[0], 100 - BUILDINGS.market.cost);
  assert.ok(!build(s, cap.id, 'market'), 'no second market');
  assert.ok(!build(s, neutral.id, 'walls'), 'not in a foreign city');
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
  // recruiting with barracks costs less
  const moveAway = [...reachable(s, u).keys()][0].split(',').map(Number);
  moveUnit(s, u.id, moveAway[0], moveAway[1]);
  const g = s.gold[0];
  assert.ok(buyUnit(s, cap.id, 'warrior'));
  assert.equal(s.gold[0], g - unitCost(s, cap, 'warrior'));
  s.gold[0] = 0;
  assert.ok(!build(s, cap.id, 'nesmysl'));
});

test('buildings: AI builds from surplus and an old game gets empty buildings', () => {
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

// Sets up a fight: our unit of type `type` and an `enemyType` enemy next to it on plains.
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

test('experience: attack and defense give XP, a kill gives more', () => {
  const { s, me, foe } = duel(3);
  attack(s, me.id, foe.id);
  assert.equal(me.xp, XP.attack);
  assert.equal(foe.xp, XP.defend);
  const d2 = duel(3);
  d2.foe.hp = 1;
  attack(d2.s, d2.me.id, d2.foe.id);
  assert.equal(d2.me.xp, XP.attack + XP.kill);
});

test('experience: promotion raises strength and heals, ranks follow thresholds', () => {
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
  // promotion during an attack: just below the threshold + weakened
  const p = duel(4);
  p.me.xp = RANKS[1].xp - XP.attack;
  p.me.hp = 4;
  p.foe.hp = 1;
  attack(p.s, p.me.id, p.foe.id);
  assert.equal(rankOf(p.me), 1);
  assert.equal(p.me.hp, 4 + XP.promotionHeal);
  assert.ok(p.s.log.some((l) => l.msg.includes('promoted')));
});

test('spearman is strong against horsemen in attack and defense', () => {
  const asWarrior = duel(6, 'warrior', 'horseman');
  const asSpear = duel(6, 'spearman', 'horseman');
  const w = previewAttack(asWarrior.s, asWarrior.me, asWarrior.foe);
  const k = previewAttack(asSpear.s, asSpear.me, asSpear.foe);
  assert.ok(k.damage > w.damage, `spearman ${k.damage} > warrior ${w.damage}`);
  // a horseman attacking a spearman takes a stronger counter than from a warrior
  const hw = previewAttack(asWarrior.s, asWarrior.foe, asWarrior.me);
  const hk = previewAttack(asSpear.s, asSpear.foe, asSpear.me);
  assert.ok(hk.damage < hw.damage, 'spearman defends better against a horseman');
  assert.ok(hk.counter > hw.counter, 'and strikes back harder');
  // no bonus against a warrior
  const plain = duel(6, 'spearman', 'warrior');
  assert.equal(defenseValue(plain.s, plain.me, plain.foe), defenseValue(plain.s, plain.me));
});

test('catapult is strong against city garrisons and ignores walls', () => {
  const { s, me, foe } = duel(8, 'catapult', 'warrior');
  const field = previewAttack(s, me, foe);
  // put the enemy into a city with walls
  const city = s.cities.find((c) => c.owner === 1);
  foe.q = city.q;
  foe.r = city.r;
  city.buildings = ['walls'];
  // catapult at range 2
  const spot = Object.values(s.tiles).find((t) => distance(t, city) === 2 && isPassable(s, t.q, t.r) && !unitAt(s, t.q, t.r));
  me.q = spot.q;
  me.r = spot.r;
  const catVsCity = previewAttack(s, me, foe);
  const archer = { ...me, id: 902, type: 'archer', hp: UNIT_TYPES.archer.hp };
  s.units.push(archer);
  const archVsCity = previewAttack(s, archer, foe);
  assert.ok(defenseValue(s, foe, me) < defenseValue(s, foe, archer), 'walls do not apply against a catapult');
  assert.ok(catVsCity.damage > archVsCity.damage * 1.5, `catapult ${catVsCity.damage} vs archer ${archVsCity.damage}`);
  assert.ok(catVsCity.damage >= field.damage * 0.8);
});

test('AI recruits new units too and answers horsemen with spearmen', () => {
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

test('roads connect all cities and speed up movement', () => {
  for (const seed of [1, 2, 3, 9, 77]) {
    const s = createGame({ seed });
    const roads = Object.values(s.tiles).filter((t) => t.road);
    assert.ok(roads.length >= s.cities.length, `seed ${seed}: too few roads`);
    for (const c of s.cities) assert.ok(s.tiles[key(c.q, c.r)].road, `city ${c.name} without a road`);
    // roads lead from the first city to all the others
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
    for (const c of s.cities) assert.ok(seen.has(key(c.q, c.r)), `seed ${seed}: ${c.name} off the network`);
    assert.ok(roads.every((t) => isPassable(s, t.q, t.r)));
  }
  // a step along a road is cheaper than over terrain
  const s = createGame({ seed: 1 });
  const a = Object.values(s.tiles).find((t) => t.road && neighbors(t.q, t.r).some((n) => s.tiles[key(n.q, n.r)]?.road));
  const b = neighbors(a.q, a.r).map((n) => s.tiles[key(n.q, n.r)]).find((t) => t && t.road);
  assert.ok(stepCost(s, a, b) < TERRAIN[b.terrain].cost);
  // an old game (version 6) loads without roads
  const old = createGame({ seed: 1 });
  old.version = 6;
  for (const t of Object.values(old.tiles)) delete t.road;
  assert.equal(migrateState(old).version, STATE_VERSION);
});

test('rivers: flow along edges, are symmetric and do not change the map layout', () => {
  for (const [size, cfg] of Object.entries(MAP_SIZES)) {
    let total = 0;
    for (const seed of [1, 2, 3, 9, 77]) {
      const m = generateMap(seed, cfg.cols, cfg.rows, cfg.neutralCities);
      for (const t of Object.values(m.tiles)) {
        for (const d of t.rivers || []) {
          total++;
          assert.ok(d >= 0 && d < 6);
          const n = m.tiles[key(t.q + [1, 1, 0, -1, -1, 0][d], t.r + [0, -1, -1, 0, 1, 1][d])];
          if (!n) continue; // edge at the map border
          assert.ok(n.rivers && n.rivers.includes(dirTo(n, t)), `${size}/${seed}: asymmetric edge`);
          assert.ok(t.terrain !== 'water' && n.terrain !== 'water', 'river does not run over water');
        }
        assert.equal(new Set(t.rivers || []).size, (t.rivers || []).length, 'edge twice');
      }
      // same seed = same rivers
      assert.deepEqual(generateMap(seed, cfg.cols, cfg.rows, cfg.neutralCities).tiles, m.tiles);
    }
    assert.ok(total / 2 >= RIVER.minLength * 5, `${size}: too few rivers`);
  }
});

test('rivers: crossing costs extra movement, a bridge does not, a defender behind a river gets a bonus', () => {
  const s = createGame({ seed: 1, fog: false });
  const tiles = Object.values(s.tiles);
  // without a river between a, b the cost is unchanged; with a river crossCost is added
  const a = tiles.find((t) => t.terrain === 'plains' && !t.road);
  const b = neighbors(a.q, a.r).map((n) => s.tiles[key(n.q, n.r)]).find((t) => t && t.terrain === 'plains' && !t.road);
  const plain = stepCost(s, a, b);
  delete a.rivers; delete b.rivers;
  a.rivers = [dirTo(a, b)];
  b.rivers = [dirTo(b, a)];
  assert.ok(riverBetween(s, a, b) && riverBetween(s, b, a));
  assert.equal(stepCost(s, a, b), plain + RIVER.crossCost);
  // bridge: road on both sides
  a.road = true; b.road = true;
  assert.ok(stepCost(s, a, b) < plain);
  delete a.road; delete b.road;
  // fighting across a river: only the defender gets the bonus, not the counterattack
  s.units = [];
  const me = { id: 900, type: 'warrior', owner: 0, q: a.q, r: a.r, hp: 10, movesLeft: 2, hasAttacked: false, xp: 0 };
  const foe = { id: 901, type: 'warrior', owner: 1, q: b.q, r: b.r, hp: 10, movesLeft: 0, hasAttacked: true, xp: 0 };
  s.units.push(me, foe);
  const across = previewAttack(s, me, foe);
  assert.equal(riverDefense(s, me, foe), RIVER.defBonus);
  a.rivers = []; b.rivers = [];
  const dry = previewAttack(s, me, foe);
  assert.equal(riverDefense(s, me, foe), 0);
  assert.ok(across.damage < dry.damage, `across river ${across.damage} < without ${dry.damage}`);
  // reach: a neighboring tile across a river is reachable only with enough movement
  a.rivers = [dirTo(a, b)]; b.rivers = [dirTo(b, a)];
  s.units = [me];
  me.movesLeft = 2;
  assert.equal(reachable(s, me).get(key(b.q, b.r)), plain + RIVER.crossCost);
  // an old game (version 9) loads without rivers
  const old = createGame({ seed: 1 });
  old.version = 9;
  for (const t of Object.values(old.tiles)) delete t.rivers;
  assert.equal(migrateState(old).version, STATE_VERSION);
});

test('random events: harvest, plague and revolt have the right effect', () => {
  const s = createGame({ seed: 5, fog: false });
  const cap = s.cities.find((c) => c.owner === 0 && c.capital);
  // harvest
  const gold = s.gold[0];
  const h = applyHappening(s, 0, 'harvest', cap);
  assert.equal(s.gold[0], gold + HAPPENINGS.kinds.harvest.gold);
  assert.equal(h.gold, HAPPENINGS.kinds.harvest.gold);
  // plague: units in and next to the city (foreign too) lose HP but don't die; distant ones don't
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
  // revolt: a city without a garrison loses its taxes, with a garrison it doesn't
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
  // a revolt never takes more gold than the player has
  s.units.pop();
  s.gold[0] = 1;
  applyHappening(s, 0, 'revolt', town);
  assert.equal(s.gold[0], 0);
  // replaying the event gives the same state
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

test('random events: deterministic, can be disabled, frequency matches', () => {
  // same seed = same events; with events off nothing happens
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
  // nothing happens before turn fromTurn; frequency roughly per chance
  let hits = 0;
  let tries = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const s = createGame({ seed, fog: false });
    assert.equal(rollHappening(s, 0), null, 'no event in turn 1');
    for (let turn = HAPPENINGS.fromTurn; turn < HAPPENINGS.fromTurn + 10; turn++) {
      const t = cloneState(s);
      t.turn = turn;
      tries++;
      if (rollHappening(t, 0)) hits++;
    }
  }
  const rate = hits / tries;
  assert.ok(rate > HAPPENINGS.chance * 0.5 && rate < HAPPENINGS.chance * 1.6, `frequency ${rate}`);
  // an old game (version 10) continues without events
  const old = createGame({ seed: 1 });
  old.version = 10;
  delete old.happenings;
  const m = migrateState(old);
  assert.equal(m.version, STATE_VERSION);
  assert.equal(m.happenings, false);
});

test('better AI: a threatened empty city gets a garrison', () => {
  const s = createGame({ seed: 3, fog: false, difficulty: 'hard' });
  endTurn(s); // it's the AI's turn and its units have move points
  const city = s.cities.find((c) => c.owner === 1 && c.capital);
  const inCity = unitAt(s, city.q, city.r);
  // empty the city: move the unit to a free neighboring tile
  const out = neighbors(city.q, city.r).find((n) => isPassable(s, n.q, n.r) && !unitAt(s, n.q, n.r));
  inCity.q = out.q; inCity.r = out.r;
  // enemy two tiles from the city
  const spot = Object.values(s.tiles).find((t) => distance(t, city) === 2 && isPassable(s, t.q, t.r) && !unitAt(s, t.q, t.r) && !s.cities.some((c) => c.q === t.q && c.r === t.r));
  s.units.push({ id: 700, type: 'warrior', owner: 0, q: spot.q, r: spot.r, hp: 10, movesLeft: 0, hasAttacked: true, xp: 0 });
  const g = assignGarrisons(s, 1);
  assert.ok([...g.values()].some((c) => c.id === city.id), 'the city has an assigned garrison');
  runAITurn(s);
  const holder = unitAt(s, city.q, city.r);
  assert.ok(holder && holder.owner === 1, 'after the AI turn its unit stands in the city');
});

test('better AI: a badly wounded unit retreats instead of attacking', () => {
  const { s, me, foe } = duel(5, 'warrior', 'warrior');
  // AI is player 1 => swap roles: foe belongs to the AI and is nearly dead
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
  assert.ok(after, 'the wounded unit survived the turn');
  assert.equal(me.hp, 10, 'it did not attack suicidally');
  assert.ok(distance(after, me) >= before, 'odstoupila');
});

test('better AI: moves to a good tile and finishes a weakened enemy', () => {
  const { s, me, foe } = duel(5, 'warrior', 'horseman');
  s.current = 1;
  s.difficulty = 'hard';
  // the AI horseman (foe) stands farther away; our warrior is weakened – the AI should ride up and destroy it
  me.hp = 2;
  const far = Object.values(s.tiles).find((t) => distance(t, me) === 3 && isPassable(s, t.q, t.r) && reachableFrom(s, foe, t));
  foe.q = far.q; foe.r = far.r;
  foe.movesLeft = UNIT_TYPES.horseman.move;
  foe.hasAttacked = false;
  assert.ok(planStrike(s, foe));
  assert.equal(getUnit(s, me.id), undefined, 'weakened warrior destroyed');
});

// helper: can tile t be reached (regardless of whose turn it is)
function reachableFrom(s, unit, t) {
  const saved = { q: unit.q, r: unit.r };
  unit.q = t.q; unit.r = t.r;
  const ok = isPassable(s, t.q, t.r) && !s.units.some((u) => u !== unit && u.q === t.q && u.r === t.r);
  unit.q = saved.q; unit.r = saved.r;
  return ok;
}

test('factions: each has its bonuses and the AI gets a different one than the player', () => {
  for (const f of Object.keys(FACTIONS)) {
    const s = createGame({ seed: 10, faction: f });
    assert.equal(s.factions[0], f);
    assert.ok(FACTIONS[s.factions[1]] && s.factions[1] !== f, `AI has a different faction than ${f}`);
  }
  assert.equal(createGame({ seed: 10, faction: 'nesmysl' }).factions[0], 'kingdom');
  assert.equal(createGame({ seed: 10, faction: 'horde', aiFaction: 'forest' }).factions[1], 'forest');

  // Kingdom: +1 gold per city, cheaper walls
  const k = createGame({ seed: 10, faction: 'kingdom', aiFaction: 'horde' });
  const h = createGame({ seed: 10, faction: 'horde', aiFaction: 'kingdom' });
  assert.equal(incomeOf(k, 0), incomeOf(h, 0) + 1);
  assert.ok(buildingCost(k, 0, 'walls') < buildingCost(h, 0, 'walls'));

  // Horde: cheaper and faster horsemen
  const hCap = h.cities.find((c) => c.owner === 0);
  const kCap = k.cities.find((c) => c.owner === 0);
  assert.ok(unitCost(h, hCap, 'horseman') < unitCost(k, kCap, 'horseman'));
  const rider = { type: 'horseman', owner: 0 };
  assert.equal(unitMove(h, rider), UNIT_TYPES.horseman.move + 1);
  assert.equal(unitMove(k, rider), UNIT_TYPES.horseman.move);

  // Forest Folk: forest costs 1 and extra defense in forest
  const fo = createGame({ seed: 10, faction: 'forest', aiFaction: 'kingdom' });
  const forest = Object.values(fo.tiles).find((t) => t.terrain === 'forest' && !t.road);
  const from = neighbors(forest.q, forest.r).map((n) => fo.tiles[key(n.q, n.r)]).find((t) => t && !t.road);
  const elf = { type: 'warrior', owner: 0, q: forest.q, r: forest.r, xp: 0 };
  const man = { ...elf, owner: 1 };
  assert.equal(stepCost(fo, from, forest, elf), 1);
  assert.equal(stepCost(fo, from, forest, man), TERRAIN.forest.cost);
  assert.ok(defenseValue(fo, elf) > defenseValue(fo, man));

  // Horde: loot for capturing a neutral city
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

test('factions: an old game has no factions and AI vs AI with factions finishes', () => {
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

test('map sizes: all generate connected and a game on them finishes', () => {
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
    assert.ok(g.winner !== null || g.turn > 150, `${size}: game got stuck`);
  }
  assert.equal(createGame({ seed: 1, size: 'nesmysl' }).cols, 14);
});

test('sounds: every event has a sound and the limiter prevents cacophony', () => {
  assert.equal(soundFor({ type: 'move' }), 'step');
  assert.equal(soundFor({ type: 'attack', killed: true }), 'kill');
  assert.equal(soundFor({ type: 'attack' }), 'hit');
  assert.equal(soundFor({ type: 'attack', promoted: true }), 'promote');
  assert.equal(soundFor({ type: 'capture', owner: 0 }, 0), 'capture');
  assert.equal(soundFor({ type: 'capture', owner: 1 }, 0), 'lose');
  assert.equal(soundFor({ type: 'nic' }), null);
  // all events the game produces have an existing sound
  const s = createGame({ seed: 4, fog: false });
  for (let i = 0; i < 40 && s.winner === null; i++) {
    runAITurn(s);
    for (const ev of drainEvents(s)) {
      const name = soundFor(ev);
      assert.ok(name && SOUND_NAMES.includes(name), `event ${ev.type} has no sound`);
    }
    endTurn(s);
  }
  const limit = createLimiter(100);
  assert.ok(limit('hit', 0));
  assert.ok(!limit('hit', 50), 'not the same sound again right away');
  assert.ok(limit('step', 50), 'a different sound is fine');
  assert.ok(limit('hit', 150));
  // Node has no AudioContext – playback must not crash
  const snd = createSound();
  assert.doesNotThrow(() => snd.play('hit'));
});

test('statistics: per-turn history, counters and chart', () => {
  const s = createGame({ seed: 4, fog: false });
  assert.equal(s.history.length, 1);
  assert.equal(s.history[0].turn, 1);
  assert.equal(armyPower(s, 0), s.history[0].power[0]);
  for (let i = 0; i < 400 && s.winner === null; i++) { runAITurn(s); endTurn(s); }
  assert.ok(s.winner !== null);
  const turns = s.history.map((e) => e.turn);
  assert.deepEqual(turns, [...new Set(turns)], 'each turn only once');
  assert.equal(turns[turns.length - 1], s.turn, 'the last record is from game over');
  assert.equal(s.history[s.history.length - 1].cities[1 - s.winner], 0, 'the loser has no cities');
  const total = s.stats.kills[0] + s.stats.kills[1];
  assert.equal(total, s.stats.losses[0] + s.stats.losses[1], 'what one destroyed, the other lost');
  assert.ok(total > 0 && s.stats.captures[s.winner] > 0);
  const svg = chartSvg(s.history);
  assert.equal((svg.match(/<polyline/g) || []).length, 2);
  assert.ok(!svg.includes('NaN'));
  assert.ok(!chartSvg([s.history[0]]).includes('NaN'), 'chart with a single point');
  assert.ok(!chartSvg([]).includes('NaN'), 'empty chart');
  assert.equal(summaryRows(s).length, 4);
  // the state stays JSON and an old game gets empty statistics
  assert.deepEqual(JSON.parse(JSON.stringify(s)).stats, s.stats);
  const old = createGame({ seed: 4 });
  old.version = 8;
  delete old.history;
  delete old.stats;
  const m = migrateState(old);
  assert.deepEqual(m.history, []);
  assert.deepEqual(m.stats.kills, [0, 0]);
});

test('chronicle: the player does not see enemy actions in fog, but sees own and visible ones', () => {
  const s = createGame({ seed: 7 });
  const aiCap = s.cities.find((c) => c.owner === 1 && c.capital);
  assert.ok(!visibleTiles(s, 0).has(key(aiCap.q, aiCap.r)), 'the enemy capital is in fog at the start');
  // the AI recruits and builds in fog
  s.current = 1;
  s.gold[1] = 200;
  const g = unitAt(s, aiCap.q, aiCap.r);
  if (g) s.units = s.units.filter((u) => u !== g);
  assert.ok(buyUnit(s, aiCap.id, 'warrior'));
  assert.ok(build(s, aiCap.id, 'market'));
  const mine = logFor(s, 1).slice(-2);
  assert.ok(mine.every((l) => !l.hidden), 'the AI sees its own actions');
  const hidden = logFor(s, 0);
  const last = hidden[hidden.length - 1];
  assert.ok(last.hidden, 'the player does not see actions in fog');
  assert.equal(last.count, 2, 'consecutive hidden actions merge into one line');
  assert.ok(!hidden.some((l) => l.msg.includes('recruited')));
  // a fight where the player is attacked is always visible (even if the attacker is in fog and the defender dies)
  const victim = s.units.find((u) => u.owner === 0);
  const spot = neighbors(victim.q, victim.r).find((n) => isPassable(s, n.q, n.r) && !unitAt(s, n.q, n.r));
  const archer = { id: 999, type: 'archer', owner: 1, q: spot.q, r: spot.r, hp: 10, movesLeft: 0, hasAttacked: false, xp: 0 };
  s.units.push(archer);
  victim.hp = 1;
  assert.ok(attack(s, archer.id, victim.id));
  const after = logFor(s, 0);
  assert.ok(after[after.length - 1].msg.includes('destroyed'), 'the player sees the loss of their own unit');
  // non-public entries go into JSON and everything is revealed after game over
  const copy = JSON.parse(JSON.stringify(s));
  copy.winner = 1;
  assert.ok(logFor(copy, 0).every((l) => !l.hidden));
  // without fog nothing is hidden
  const open = createGame({ seed: 7, fog: false });
  open.current = 1;
  open.gold[1] = 200;
  const cap2 = open.cities.find((c) => c.owner === 1 && c.capital);
  build(open, cap2.id, 'market');
  assert.ok(logFor(open, 0).every((l) => !l.hidden));
  // an old game (version 11) loads and its entries stay public
  const old = createGame({ seed: 3 });
  old.version = 11;
  old.log = [{ turn: 1, msg: 'AI: something' }];
  const m = migrateState(old);
  assert.equal(m.version, STATE_VERSION);
  assert.equal(logFor(m, 0)[0].msg, 'AI: something');
});

test('undo move: only a move that revealed nothing', () => {
  // tries a move and returns whether it can be undone (the pre-move state stays untouched)
  const tryMove = (s, unit, q, r) => {
    const before = cloneState(s);
    assert.ok(moveUnit(s, unit.id, q, r));
    const ok = isUndoableMove(before, s, s.events, 0);
    drainEvents(s);
    return { ok, before };
  };
  const s = createGame({ seed: 21 });
  const u = s.units.find((x) => x.owner === 0 && x.type === 'warrior');
  const explored = exploredTiles(s, 0);
  const dests = [...reachable(s, u).keys()].map((k) => s.tiles[k]);
  let safe = null;
  let revealing = null;
  for (const t of dests) {
    const trial = cloneState(s);
    const tu = getUnit(trial, u.id);
    const { ok } = tryMove(trial, tu, t.q, t.r);
    const grew = exploredTiles(trial, 0).size > explored.size;
    if (grew) assert.equal(ok, false, 'a move that explores a new tile cannot be undone');
    if (ok && !safe) safe = t;
    if (grew && !revealing) revealing = t;
  }
  assert.ok(safe, 'at least one move inside explored territory can be undone');
  assert.ok(revealing, 'at least one move reveals a new tile');
  const orig = JSON.parse(JSON.stringify(s));
  const { ok, before } = tryMove(s, u, safe.q, safe.r);
  assert.ok(ok);
  assert.deepEqual(JSON.parse(JSON.stringify(before)), orig, 'the pre-move state can be restored unchanged');

  // a newly visible enemy (even on an already explored tile) locks the move
  const e = createGame({ seed: 21 });
  e.explored[0] = Object.keys(e.tiles).sort();
  const eu = e.units.find((x) => x.owner === 0 && x.type === 'warrior');
  const vis0 = visibleTiles(e, 0);
  let spot = null;
  for (const k of reachable(e, eu).keys()) {
    const t = e.tiles[k];
    const trial = cloneState(e);
    getUnit(trial, eu.id).q = t.q;
    getUnit(trial, eu.id).r = t.r;
    const extra = [...visibleTiles(trial, 0)].find((v) => !vis0.has(v) && isPassable(e, e.tiles[v].q, e.tiles[v].r)
      && !unitAt(e, e.tiles[v].q, e.tiles[v].r) && !e.cities.some((c) => c.q === e.tiles[v].q && c.r === e.tiles[v].r));
    if (extra) { spot = { dest: t, enemy: e.tiles[extra] }; break; }
  }
  assert.ok(spot);
  const clean = cloneState(e);
  assert.equal(tryMove(clean, getUnit(clean, eu.id), spot.dest.q, spot.dest.r).ok, true, 'without an enemy it can be undone');
  e.units.push({ id: 900, type: 'warrior', owner: 1, q: spot.enemy.q, r: spot.enemy.r, hp: 10, movesLeft: 0, hasAttacked: true, xp: 0 });
  assert.equal(tryMove(e, eu, spot.dest.q, spot.dest.r).ok, false, 'a revealed enemy locks the move');

  // capturing a city cannot be undone
  const c = createGame({ seed: 21, fog: false });
  const city = c.cities.find((x) => x.owner === null);
  const cu = c.units.find((x) => x.owner === 0);
  const near = neighbors(city.q, city.r).find((n) => isPassable(c, n.q, n.r) && !unitAt(c, n.q, n.r));
  cu.q = near.q;
  cu.r = near.r;
  cu.movesLeft = 5;
  assert.equal(tryMove(c, cu, city.q, city.r).ok, false);
  // an action other than a move (attack) cannot be undone
  const p = duel(4);
  const pb = cloneState(p.s);
  assert.ok(attack(p.s, p.me.id, p.foe.id));
  assert.equal(isUndoableMove(pb, p.s, p.s.events, 0), false);
});

test('fortify: +defense until the unit moves or attacks, Tab skips it', () => {
  const { s, me, foe } = duel(6);
  const base = defenseValue(s, me, foe);
  const before = previewAttack(s, foe, me).damage;
  assert.ok(canFortify(s, me));
  assert.ok(fortify(s, me.id));
  assert.equal(me.movesLeft, 0);
  assert.ok(me.hasAttacked, 'fortifying ends the unit\'s turn');
  assert.ok(!fortify(s, me.id), 'cannot fortify twice');
  assert.ok(Math.abs(defenseValue(s, me, foe) - base * (1 + FORTIFY.defBonus)) < 1e-9);
  assert.ok(previewAttack(s, foe, me).damage <= before);
  assert.deepEqual(drainEvents(s).map((e) => e.type), ['fortify']);
  // the fortification lasts into the next turns
  endTurn(s);
  endTurn(s);
  assert.ok(me.fortified);
  assert.equal(nextActiveUnit(s, 0, null)?.id === me.id, false, 'Tab skips fortified units');
  // moving breaks it
  const to = [...reachable(s, me).keys()][0].split(',').map(Number);
  assert.ok(moveUnit(s, me.id, to[0], to[1]));
  assert.ok(!me.fortified);
  assert.ok(!canFortify(s, me), 'a unit that moved this turn cannot fortify');
  // attacking breaks it too (and the attacker does not keep the bonus for the counter)
  const d2 = duel(6);
  d2.me.fortified = true;
  assert.ok(attack(d2.s, d2.me.id, d2.foe.id));
  assert.ok(!d2.me.fortified);
  // only the current player's units; replaying the event sets the flag
  const d3 = duel(6);
  assert.ok(!canFortify(d3.s, d3.foe));
  const copy = cloneState(d3.s);
  fortify(d3.s, d3.me.id);
  for (const ev of drainEvents(d3.s)) applyEvent(copy, ev);
  assert.ok(getUnit(copy, d3.me.id).fortified);
  // JSON round-trip and migration
  assert.ok(JSON.parse(JSON.stringify(d3.s)).units.find((u) => u.id === d3.me.id).fortified);
  const old = createGame({ seed: 2 });
  old.version = 12;
  assert.equal(migrateState(old).version, STATE_VERSION);
});

test('fortify: an AI garrison with nothing to attack digs in', () => {
  const s = createGame({ seed: 11, fog: false });
  const cap = s.cities.find((c) => c.owner === 1 && c.capital);
  s.units = s.units.filter((u) => u.owner !== 1 || (u.q === cap.q && u.r === cap.r));
  if (!unitAt(s, cap.q, cap.r)) s.units.push({ id: 500, type: 'warrior', owner: 1, q: cap.q, r: cap.r, hp: 10, movesLeft: 2, hasAttacked: false, xp: 0 });
  const g = unitAt(s, cap.q, cap.r);
  // an enemy two tiles away triggers the garrison but is out of reach of an attack
  const far = Object.values(s.tiles).find((t) => distance(t, cap) === 2 && isPassable(s, t.q, t.r) && !unitAt(s, t.q, t.r));
  s.units.push({ id: 501, type: 'warrior', owner: 0, q: far.q, r: far.r, hp: 10, movesLeft: 0, hasAttacked: true, xp: 0 });
  s.current = 1;
  g.movesLeft = 2; g.hasAttacked = false; g.moved = false;
  runAITurn(s);
  const after = getUnit(s, g.id);
  assert.ok(after && after.q === cap.q && after.r === cap.r);
  assert.ok(after.fortified, 'the garrison fortified');
});

test('active units: who can still act (end-turn reminder and Tab)', () => {
  const { s, me } = duel(9);
  assert.deepEqual(activeUnits(s, 0).map((u) => u.id), [me.id]);
  me.movesLeft = 0;
  assert.equal(activeUnits(s, 0).length, 1, 'an attack is still possible');
  me.hasAttacked = true;
  assert.equal(activeUnits(s, 0).length, 0);
  assert.equal(nextActiveUnit(s, 0), null);
  me.hasAttacked = false;
  me.movesLeft = 2;
  me.fortified = true;
  assert.equal(activeUnits(s, 0).length, 0, 'fortified units are not nagged about');
  assert.equal(activeUnits(s, 1).length, 0, 'not the AI\'s turn: its units have no moves');
});

test('territory: nearest city within the radius, no water, resting heals more', () => {
  for (const size of ['small', 'medium', 'large']) {
    const s = createGame({ seed: 13, size });
    const terr = territoryMap(s);
    for (const [k, id] of terr) {
      const t = s.tiles[k];
      assert.notEqual(t.terrain, 'water');
      const c = s.cities.find((x) => x.id === id);
      const d = distance(t, c);
      assert.ok(d <= TERRITORY.radius);
      for (const o of s.cities) assert.ok(distance(t, o) > d || (distance(t, o) === d && o.id >= id), 'nearest city wins');
    }
    for (const c of s.cities) assert.equal(terr.get(key(c.q, c.r)), c.id, 'a city tile belongs to its city');
    for (const t of Object.values(s.tiles)) {
      const inside = s.cities.some((c) => distance(t, c) <= TERRITORY.radius) && t.terrain !== 'water';
      assert.equal(terr.has(key(t.q, t.r)), inside);
    }
  }
  // owner follows the city; healing of a resting unit
  const s = createGame({ seed: 13, fog: false });
  const cap = s.cities.find((c) => c.owner === 0 && c.capital);
  const near = Object.values(s.tiles).find((t) => distance(t, cap) === 1 && isPassable(s, t.q, t.r) && !unitAt(s, t.q, t.r));
  assert.equal(territoryOwner(s, near.q, near.r), 0);
  const outside = Object.values(s.tiles).find((t) => isPassable(s, t.q, t.r) && territoryOwner(s, t.q, t.r) === undefined && !unitAt(s, t.q, t.r));
  s.units = [];
  const a = { id: 1, type: 'warrior', owner: 0, q: near.q, r: near.r, hp: 4, movesLeft: 2, hasAttacked: false, xp: 0, moved: false };
  const b = { id: 2, type: 'warrior', owner: 0, q: outside.q, r: outside.r, hp: 4, movesLeft: 2, hasAttacked: false, xp: 0, moved: false };
  s.units.push(a, b);
  endTurn(s);
  assert.equal(a.hp, 4 + TERRITORY.healIdle);
  assert.equal(b.hp, 4 + ECONOMY.healIdle);
  const neutral = s.cities.find((c) => c.owner === null);
  assert.equal(territoryOwner(s, neutral.q, neutral.r), null);
  neutral.owner = 1;
  assert.equal(territoryOwner(s, neutral.q, neutral.r), 1);
});

test('move orders: a far target is walked over several turns', () => {
  const s = createGame({ seed: 31, fog: false });
  s.units = s.units.filter((u) => u.owner === 0);
  const u = s.units.find((x) => x.type === 'warrior');
  // the farthest passable free tile with a route
  let target = null;
  for (const t of Object.values(s.tiles)) {
    if (!isPassable(s, t.q, t.r) || unitAt(s, t.q, t.r) || s.cities.some((c) => c.q === t.q && c.r === t.r)) continue;
    const r = planRoute(s, u, t.q, t.r);
    if (r && (!target || r.turns > target.route.turns)) target = { t, route: r };
  }
  assert.ok(target && target.route.turns >= 3, 'a target at least 3 turns away');
  const { path } = target.route;
  for (let i = 1; i < path.length; i++) assert.equal(distance(path[i - 1], path[i]), 1);
  assert.equal(setOrder(s, u.id, target.t.q, target.t.r), 'moved');
  assert.ok(u.goto, 'the order stays on the unit');
  assert.equal(u.movesLeft, 0, 'it walked as far as it could this turn');
  let turns = 1;
  let result = 'moved';
  while (result === 'moved' && turns < 20) {
    endTurn(s); endTurn(s); // AI does nothing
    result = runOrders(s, 0)[0].result;
    turns++;
  }
  assert.equal(result, 'arrived');
  assert.equal(turns, target.route.turns, 'the turn estimate was right');
  assert.ok(u.q === target.t.q && u.r === target.t.r && !u.goto);
  assert.equal(runOrders(s, 0).length, 0);
  assert.ok(JSON.parse(JSON.stringify(s)));
});

test('move orders: interrupted by an enemy, cancelled by manual actions, no route through the unknown', () => {
  const base = createGame({ seed: 31, fog: false });
  base.units = base.units.filter((x) => x.owner === 0);
  const pick = (s) => {
    const u = s.units.find((x) => x.type === 'warrior');
    const t = Object.values(s.tiles).find((x) => {
      const r = isPassable(s, x.q, x.r) && !unitAt(s, x.q, x.r) && planRoute(s, u, x.q, x.r);
      return r && r.turns >= 3;
    });
    return { u, t };
  };
  // an enemy comes into sight → the order stops at the start of the turn without moving
  let s = cloneState(base);
  let { u, t } = pick(s);
  setOrder(s, u.id, t.q, t.r);
  endTurn(s); endTurn(s);
  const spot = neighbors(u.q, u.r).find((n) => isPassable(s, n.q, n.r) && !unitAt(s, n.q, n.r));
  s.units.push({ id: 700, type: 'warrior', owner: 1, q: spot.q, r: spot.r, hp: 10, movesLeft: 0, hasAttacked: true, xp: 0 });
  const at = { q: u.q, r: u.r };
  assert.equal(runOrders(s, 0)[0].result, 'interrupted');
  assert.ok(!u.goto && u.q === at.q && u.r === at.r);
  // a manual move, an attack or fortify cancels the order; cancelOrder too
  s = cloneState(base);
  ({ u, t } = pick(s));
  setOrder(s, u.id, t.q, t.r);
  endTurn(s); endTurn(s);
  const [k] = reachable(s, u).keys();
  const [mq, mr] = k.split(',').map(Number);
  moveUnit(s, u.id, mq, mr);
  assert.ok(!u.goto);
  setOrder(s, u.id, t.q, t.r);
  cancelOrder(s, u.id);
  assert.ok(!u.goto);
  // with fog: an unexplored tile can't be a target, the route only uses explored tiles
  const f = createGame({ seed: 31 });
  const fu = f.units.find((x) => x.owner === 0);
  const known = exploredTiles(f, 0);
  const unknown = Object.values(f.tiles).find((x) => !known.has(key(x.q, x.r)) && isPassable(f, x.q, x.r));
  assert.equal(planRoute(f, fu, unknown.q, unknown.r), null);
  assert.equal(setOrder(f, fu.id, unknown.q, unknown.r), null);
  for (const x of Object.values(f.tiles)) {
    const r = known.has(key(x.q, x.r)) && planRoute(f, fu, x.q, x.r);
    if (r) assert.ok(r.path.every((p) => known.has(key(p.q, p.r))));
  }
  // migration
  const old = createGame({ seed: 2 });
  old.version = 13;
  assert.equal(migrateState(old).version, STATE_VERSION);
});

test('move orders: a tap on a far known tile gives an order (touch needs confirmation)', () => {
  const s = createGame({ seed: 31, fog: false });
  const u = s.units.find((x) => x.owner === 0 && x.type === 'warrior');
  const reach = reachable(s, u);
  const far = Object.values(s.tiles).find((t) => !reach.has(key(t.q, t.r)) && !unitAt(s, t.q, t.r)
    && !s.cities.some((c) => c.q === t.q && c.r === t.r) && planRoute(s, u, t.q, t.r));
  assert.deepEqual(decideTap(s, { selectedId: u.id }, far.q, far.r), { type: 'goto', unitId: u.id, q: far.q, r: far.r });
  const first = decideTap(s, { selectedId: u.id, confirm: true }, far.q, far.r);
  assert.equal(first.kind, 'goto');
  assert.equal(decideTap(s, { selectedId: u.id, confirm: true, pending: { q: far.q, r: far.r } }, far.q, far.r).type, 'goto');
  // a far own city is still selected, a foreign one can be marched to
  s.units = s.units.filter((x) => x.owner !== 1);
  const enemyCap = s.cities.find((c) => c.owner === 1);
  if (!reach.has(key(enemyCap.q, enemyCap.r))) assert.equal(decideTap(s, { selectedId: u.id }, enemyCap.q, enemyCap.r).type, 'goto');
  const myCity = s.cities.find((c) => c.owner === 0);
  if (myCity.q !== u.q || myCity.r !== u.r) assert.notEqual(decideTap(s, { selectedId: u.id }, myCity.q, myCity.r).type, 'goto');
});

test('new buildings: watchtower, infirmary, temple, academy', () => {
  const s = createGame({ seed: 17 });
  const cap = s.cities.find((c) => c.owner === 0 && c.capital);
  s.gold[0] = 500;
  s.units = s.units.filter((u) => u.owner !== 0);
  // watchtower: the city sees farther
  const seenBefore = visibleTiles(s, 0).size;
  assert.ok(build(s, cap.id, 'watchtower'));
  assert.equal(citySight(cap), 4);
  assert.ok(visibleTiles(s, 0).size > seenBefore);
  // temple: +1 gold, revolt suppressed even without a garrison
  const income = cityIncome(cap, s);
  assert.ok(build(s, cap.id, 'temple'));
  assert.equal(cityIncome(cap, s), income + BUILDING_EFFECTS.templeIncome);
  const city = s.cities.find((c) => c.owner === null);
  city.owner = 0;
  city.buildings = ['temple'];
  const goldBefore = s.gold[0];
  const rev = applyHappening(s, 0, 'revolt', city);
  assert.ok(rev.suppressed && rev.reason === 'temple');
  assert.equal(s.gold[0], goldBefore);
  // infirmary: more healing, plague contained
  assert.ok(build(s, cap.id, 'infirmary'));
  assert.equal(cityHeal(cap), ECONOMY.healInCity + BUILDING_EFFECTS.infirmaryHeal);
  assert.equal(cityInfo(s, cap).heal, cityHeal(cap));
  const w = { id: 900, type: 'warrior', owner: 0, q: cap.q, r: cap.r, hp: 2, movesLeft: 2, hasAttacked: false, xp: 0, moved: true };
  s.units.push(w);
  const plague = applyHappening(s, 0, 'plague', cap);
  assert.ok(plague.suppressed && plague.reason === 'infirmary' && plague.hits.length === 0);
  assert.equal(w.hp, 2);
  endTurn(s);
  assert.equal(w.hp, 2 + cityHeal(cap));
  endTurn(s);
  // academy: recruits start as Veterans (and the replayed spawn event agrees)
  s.units = s.units.filter((u) => u.id !== w.id);
  assert.ok(build(s, cap.id, 'academy'));
  drainEvents(s);
  const copy = cloneState(s);
  assert.ok(buyUnit(s, cap.id, 'archer'));
  const a = unitAt(s, cap.q, cap.r);
  assert.equal(a.xp, BUILDING_EFFECTS.academyXp);
  assert.equal(rankOf(a), 1);
  for (const ev of drainEvents(s)) applyEvent(copy, ev);
  assert.equal(unitAt(copy, cap.q, cap.r).xp, a.xp);
  // a city without an academy recruits Recruits
  const other = s.cities.find((c) => c.owner === 0 && !c.capital);
  other.buildings = [];
  assert.ok(buyUnit(s, other.id, 'warrior'));
  assert.equal(unitAt(s, other.q, other.r).xp, 0);
});

test('resources: placed fairly in territories, add income and cheaper horsemen', () => {
  for (const size of ['small', 'medium', 'large']) {
    for (const seed of [1, 5, 9, 33]) {
      const s = createGame({ seed, size });
      const res = Object.values(s.tiles).filter((t) => t.resource);
      for (const t of res) {
        assert.ok(RESOURCES[t.resource]);
        assert.ok(isPassable(s, t.q, t.r));
        assert.ok(!s.cities.some((c) => c.q === t.q && c.r === t.r));
        assert.notEqual(territoryOwner(s, t.q, t.r), undefined, 'every resource lies in some territory');
      }
      // both capitals get exactly one of each
      for (const cap of s.cities.filter((c) => c.capital)) {
        const kinds = cityResources(s, cap).map((t) => t.resource).sort();
        assert.deepEqual(kinds, ['gold', 'horses'], `${size}/${seed}`);
      }
      // deterministic for a given seed
      assert.deepEqual(createGame({ seed, size }).tiles, s.tiles);
    }
  }
  const s = createGame({ seed: 5 });
  const cap = s.cities.find((c) => c.owner === 0 && c.capital);
  const withMine = cityIncome(cap, s);
  const mine = cityResources(s, cap).find((t) => t.resource === 'gold');
  delete mine.resource;
  assert.equal(cityIncome(cap, s), withMine - RESOURCES.gold.income);
  const pasture = cityResources(s, cap).find((t) => t.resource === 'horses');
  const cheap = unitCost(s, cap, 'horseman');
  assert.equal(unitCost(s, cap, 'warrior'), UNIT_TYPES.warrior.cost, 'only horsemen get cheaper');
  delete pasture.resource;
  assert.equal(unitCost(s, cap, 'horseman'), cheap + RESOURCES.horses.discount.horseman);
  const old = createGame({ seed: 2 });
  old.version = 14;
  assert.equal(migrateState(old).version, STATE_VERSION);
});

test('unit summary for the tooltip: effective stats and reasons', () => {
  const { s, me } = duel(6);
  const a = unitSummary(s, me);
  assert.equal(a.name, UNIT_TYPES[me.type].name);
  assert.equal(a.hp, me.hp);
  assert.equal(a.defense, Math.round(defenseValue(s, me) * 10) / 10);
  assert.deepEqual(a.notes, [], 'plains, no city');
  me.fortified = true;
  me.xp = RANKS[1].xp;
  const b = unitSummary(s, me);
  assert.ok(b.fortified && b.notes.includes('fortified'));
  assert.equal(b.rank, RANKS[1].name);
  assert.ok(b.defense > a.defense && b.attack > a.attack);
  // in an own city with walls
  const cap = s.cities.find((c) => c.owner === 0 && c.capital);
  cap.buildings = ['walls'];
  me.q = cap.q; me.r = cap.r;
  assert.ok(unitSummary(s, me).notes.includes('city with walls'));
});

test('keyboard shortcuts: one table for keys and the overlay', () => {
  assert.deepEqual(keyAction('Tab'), { type: 'nextUnit' });
  assert.deepEqual(keyAction('Enter'), { type: 'endTurn', force: false });
  assert.deepEqual(keyAction('Enter', true), { type: 'endTurn', force: true });
  assert.deepEqual(keyAction('e'), { type: 'endTurn', force: false });
  assert.equal(keyAction('F').type, 'fortify');
  assert.equal(keyAction('z').type, 'undo');
  assert.equal(keyAction('?', true).type, 'help');
  assert.equal(keyAction('Escape').type, 'escape');
  const types = Object.keys(UNIT_TYPES);
  types.forEach((t, i) => {
    assert.deepEqual(keyAction(String(i + 1)), { type: 'recruit', unitType: t });
    assert.equal(recruitKey(t), String(i + 1));
  });
  assert.equal(keyAction(String(types.length + 1)), null);
  assert.equal(keyAction('x'), null);
  // every entry has overlay text, and no key is claimed by two entries
  for (const sc of SHORTCUTS) assert.ok(sc.keys && sc.text);
  for (const [k, shift] of [['Tab', false], ['Enter', false], ['Enter', true], ['f', false], ['1', false], ['?', true]]) {
    assert.equal(SHORTCUTS.filter((sc) => sc.match(k, shift)).length, 1, `${k}${shift ? '+shift' : ''}`);
  }
});

test('zone of control: entering a tile next to a visible enemy stops the unit', () => {
  const s = createGame({ seed: 3, fog: false });
  for (const t of Object.values(s.tiles)) { t.terrain = 'plains'; delete t.road; delete t.rivers; }
  s.units = [];
  const me = { id: 900, type: 'horseman', owner: 0, q: 2, r: 4, hp: 10, movesLeft: 4, hasAttacked: false, xp: 0 };
  const foe = { id: 901, type: 'warrior', owner: 1, q: 5, r: 4, hp: 10, movesLeft: 0, hasAttacked: true, xp: 0 };
  s.units.push(me, foe);
  const zoc = zocTiles(s, 0);
  assert.equal(zoc.size, 6, 'the six neighbours of the enemy');
  assert.ok(!zocTiles(s, 1).has(key(4, 4)), 'own units make no zone for their owner');
  const reach = reachable(s, me);
  // the tile in front of the enemy is reachable, but the unit can't walk past through the zone
  assert.equal(reach.get(key(4, 4)), 2);
  assert.ok(!reach.has(key(6, 4)), 'behind the enemy needs passing through the zone');
  for (const [k, cost] of reach) {
    const path = pathTo(s, me, ...k.split(',').map(Number));
    assert.equal(path.length - 1, cost, 'all plains: cost = steps');
    // no intermediate tile of the path lies in the zone
    for (const p of path.slice(1, -1)) assert.ok(!zoc.has(key(p.q, p.r)), `path to ${k} passes the zone`);
  }
  // without the enemy the same tile is reachable
  s.units = [me];
  assert.ok(reachable(s, me).has(key(6, 4)));
  // starting inside the zone the unit may leave it (and stops again on the next zone tile)
  s.units = [me, foe];
  me.q = 4; me.r = 4;
  const out = reachable(s, me);
  assert.ok(out.has(key(1, 4)), 'walks away from the enemy');
  // moveUnit follows the same rules and the attack after stopping still works
  me.q = 2; me.r = 4; me.movesLeft = 4;
  assert.ok(!moveUnit(s, me.id, 6, 4));
  assert.ok(moveUnit(s, me.id, 4, 4));
  assert.equal(me.movesLeft, 2);
  assert.ok(attack(s, me.id, foe.id));
});

test('zone of control: hidden enemies have none, old games keep playing without it', () => {
  const s = createGame({ seed: 3, fog: true });
  for (const t of Object.values(s.tiles)) { t.terrain = 'plains'; delete t.road; delete t.rivers; }
  s.units = [];
  s.cities.forEach((c) => { c.owner = null; });
  const me = { id: 900, type: 'warrior', owner: 0, q: 1, r: 1, hp: 10, movesLeft: 2, hasAttacked: false, xp: 0 };
  const far = { id: 901, type: 'warrior', owner: 1, q: 1 + UNIT_TYPES.warrior.sight + 2, r: 1, hp: 10, movesLeft: 0, hasAttacked: true, xp: 0 };
  s.units.push(me, far);
  assert.ok(!visibleTiles(s, 0).has(key(far.q, far.r)), 'the enemy is in the fog');
  assert.equal(zocTiles(s, 0).size, 0);
  s.fog = false;
  assert.equal(zocTiles(s, 0).size, 6, 'without fog the same enemy has a zone');
  const old = createGame({ seed: 3 });
  old.version = 15;
  delete old.zoc;
  const m = migrateState(old);
  assert.equal(m.version, STATE_VERSION);
  assert.equal(m.zoc, false);
  assert.equal(zocTiles(m, 0).size, 0);
  assert.equal(createGame({ seed: 3 }).zoc, true);
});

test('save file: export and import give back the same game', () => {
  const s = createGame({ seed: 8, size: 'small' });
  for (let i = 0; i < 6; i++) endTurn(s);
  s.events.push({ type: 'move', unitId: 1, path: [] });
  const text = exportGame(s, '1.2.3', '2026-11-09T10:00:00.000Z');
  const file = JSON.parse(text);
  assert.equal(file.format, SAVE_FORMAT);
  assert.equal(file.gameVersion, '1.2.3');
  assert.equal(file.saved, '2026-11-09T10:00:00.000Z');
  assert.equal(s.events.length, 1, 'exporting does not touch the game');
  const { state, error } = importGame(text);
  assert.equal(error, undefined);
  const expected = cloneState(s);
  expected.events = [];
  assert.deepEqual(state, expected);
  // the bare state (as kept in localStorage) is accepted too, and the game goes on
  const bare = importGame(JSON.stringify(expected));
  assert.deepEqual(bare.state, expected);
  endTurn(bare.state);
  assert.equal(bare.state.turn, s.turn + (s.current === 1 ? 1 : 0));
  assert.equal(saveFileName(s, new Date('2026-11-09T10:00:00Z')), `hex-realm-turn-${s.turn}-2026-11-09.json`);
});

test('save file: broken, foreign, newer and old files', () => {
  const s = createGame({ seed: 8 });
  const err = (text) => importGame(text).error || '';
  assert.match(err('not json {'), /not valid JSON/);
  assert.match(err('42'), /does not contain/);
  assert.match(err(JSON.stringify({ format: 'other-game', state: s })), /not a Hex Realm/);
  assert.match(err(JSON.stringify({ hello: 1 })), /does not contain/);
  assert.match(err(JSON.stringify({ ...s, version: STATE_VERSION + 1 })), /newer version/);
  assert.match(err(JSON.stringify({ ...s, version: 0 })), /unknown format/);
  // damaged contents are reported, not loaded
  const damaged = (change) => { const c = cloneState(s); change(c); return err(exportGame(c)); };
  assert.match(damaged((c) => { c.units[1].q = c.units[0].q; c.units[1].r = c.units[0].r; }), /damaged \(two units/);
  assert.match(damaged((c) => { c.units[0].q = 999; }), /damaged \(unit .* off the map/);
  assert.match(damaged((c) => { c.units[0].type = 'dragon'; }), /damaged \(bad unit/);
  assert.match(damaged((c) => { c.gold = [1]; }), /damaged \(bad gold/);
  assert.match(damaged((c) => { c.current = 5; }), /damaged \(bad current/);
  assert.match(damaged((c) => { c.tiles = null; }), /damaged/);
  assert.equal(stateProblem(s), null);
  // an old save is migrated on import (version 15 = before the zone of control)
  const old = cloneState(s);
  old.version = 15;
  delete old.zoc;
  const m = importGame(JSON.stringify(old));
  assert.equal(m.state.version, STATE_VERSION);
  assert.equal(m.state.zoc, false);
});

test('threat overlay: tiles visible enemies could attack next turn', () => {
  const s = createGame({ seed: 3, fog: false });
  for (const t of Object.values(s.tiles)) { t.terrain = 'plains'; delete t.road; delete t.rivers; }
  s.factions = [null, null];
  s.units = [];
  const foe = { id: 901, type: 'warrior', owner: 1, q: 7, r: 4, hp: 10, movesLeft: 0, hasAttacked: true, xp: 0 };
  s.units.push(foe);
  // a warrior walks 2 and strikes 1 tile: everything within distance 3, even if it already moved this turn
  let threat = threatTiles(s, 0);
  for (const t of Object.values(s.tiles)) {
    assert.equal(threat.has(key(t.q, t.r)), distance(t, foe) <= 3, `tile ${t.q},${t.r}`);
  }
  // an archer walks 2 and shoots 2 (reach 4); where both reach, the count is 2
  const archer = { id: 902, type: 'archer', owner: 1, q: 11, r: 1, hp: 8, movesLeft: 2, hasAttacked: false, xp: 0 };
  s.units.push(archer);
  threat = threatTiles(s, 0);
  for (const t of Object.values(s.tiles)) {
    const expected = (distance(t, foe) <= 3 ? 1 : 0) + (distance(t, archer) <= 4 ? 1 : 0);
    assert.equal(threat.get(key(t.q, t.r)) || 0, expected, `tile ${t.q},${t.r}`);
  }
  assert.ok([...threat.values()].includes(2), 'some tiles are threatened twice');
  // the enemy's own threat map is about our units: none here
  assert.equal(threatTiles(s, 1).size, 0);
  // terrain and units count: a mountain wall stops the walk, own units block and their zone stops it
  const wall = Object.values(s.tiles).filter((t) => t.q === 5);
  wall.forEach((t) => { t.terrain = 'mountain'; });
  s.units = [foe];
  threat = threatTiles(s, 0);
  assert.ok(!threat.has(key(4, 4)), 'cannot strike over the mountain wall');
  assert.ok(!threat.has(key(5, 4)), 'mountains are not threatened tiles');
  wall.forEach((t) => { t.terrain = 'plains'; });
  // fog: a hidden enemy is no threat, unexplored tiles are never marked
  const f = createGame({ seed: 3, fog: true });
  const hidden = f.units.filter((u) => u.owner === 1).filter((u) => !visibleTiles(f, 0).has(key(u.q, u.r)));
  assert.ok(hidden.length > 0);
  const ft = threatTiles(f, 0);
  const explored = exploredTiles(f, 0);
  for (const k of ft.keys()) assert.ok(explored.has(k));
  assert.equal(ft.size, 0, 'at the start the enemy is out of sight');
});

test('AI danger: archers keep out of reach, melee units avoid pile-ons, the map follows losses', () => {
  const s = createGame({ seed: 3, fog: false });
  for (const t of Object.values(s.tiles)) { t.terrain = 'plains'; delete t.road; delete t.rivers; delete t.resource; }
  s.factions = [null, null];
  s.zoc = false;
  const w = (id, q, r) => ({ id, type: 'warrior', owner: 0, q, r, hp: 10, movesLeft: 2, hasAttacked: false, xp: 0 });
  s.units = [w(1, 4, 4), w(2, 4, 5), w(3, 4, 3),
    { id: 4, type: 'archer', owner: 1, q: 9, r: 4, hp: 8, movesLeft: 2, hasAttacked: false, xp: 0 }];
  s.current = 1;
  const archer = getUnit(s, 4);
  // penalties: an archer fears even one attacker, a melee unit only a second one; wounded more; own city none
  assert.equal(dangerPenalty(s, archer, 9, 4, 0), 0);
  assert.equal(dangerPenalty(s, archer, 9, 4, 1), DANGER.ranged);
  const warrior = { ...w(5, 9, 4), owner: 1 };
  assert.equal(dangerPenalty(s, warrior, 9, 4, 1), 0);
  assert.equal(dangerPenalty(s, warrior, 9, 4, 3), 2 * DANGER.melee);
  assert.ok(dangerPenalty(s, { ...warrior, hp: 5 }, 9, 4, 3) > dangerPenalty(s, warrior, 9, 4, 3));
  const home = s.cities.find((c) => c.owner === 1);
  assert.equal(dangerPenalty(s, archer, home.q, home.r, 3), 0);
  // the danger map is the threat map from the AI's side
  const danger = dangerMap(s, 1);
  assert.deepEqual([...danger.get()], [...threatTiles(s, 1)]);
  assert.equal(danger.get().get(key(7, 4)), 2);
  assert.equal(danger.get().get(key(6, 4)), 3);
  // without danger the archer walks into reach of two warriors, with it it stays on a safe tile
  const blind = cloneState(s);
  moveTowardsGoal(blind, getUnit(blind, 4));
  const b = getUnit(blind, 4);
  assert.ok((danger.get().get(key(b.q, b.r)) || 0) > 0, 'the old behaviour walks into danger');
  const wise = cloneState(s);
  moveTowardsGoal(wise, getUnit(wise, 4), dangerMap(wise, 1).get());
  const a = getUnit(wise, 4);
  assert.ok(a.q !== 9 || a.r !== 4, 'it still moves');
  assert.equal(danger.get().get(key(a.q, a.r)) || 0, 0, 'and ends out of reach');
  // a fallen enemy is noticed: the map is recomputed
  s.units = s.units.filter((u) => u.id !== 1 && u.id !== 2);
  assert.equal(danger.get().get(key(6, 4)), 1);
  // fog: the AI on Normal fears only enemies it can see
  const f = createGame({ seed: 3, fog: true });
  assert.equal(dangerMap(f, 1).get().size, 0, 'at the start the player is out of sight');
});
