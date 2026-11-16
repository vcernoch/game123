import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame, spawnUnit, updateExplored, reachable, moveUnit, attack, buyUnit, endTurn, unitAt, isPassable,
  previewAttack, cloneState, pathTo, nextActiveUnit, tileAt, cityInfo, incomeOf, defenseValue,
  drainEvents, applyEvent, migrateState, STATE_VERSION,
  visibleTiles, exploredTiles, build, unitCost, rankOf, stepCost, getUnit,
  buildingCost, unitMove, factionOf, armyPower, riverBetween, riverDefense, flankers, flankBonus, highGroundBonus, chargeBonus, chargeReady, movesSpent,
  rollHappening, applyHappening, cityIncome, logFor, isUndoableMove, canFortify, fortify, activeUnits, territoryMap, territoryOwner, planRoute, setOrder, runOrders, cancelOrder, cityHeal, citySight, cityResources, unitSummary, zocTiles,
  exportGame, importGame, saveFileName, stateProblem, SAVE_FORMAT, threatTiles, parseSeed, restartOptions, MAX_SEED,
  upgradeOptions, upgradeUnit, upgradeCost, canDisband, disbandRefund, disbandUnit,
  turnReport, reportText, reportIsBad, updateSightings, lastSeen, lastSeenAt, lastSeenText,
  armyOverview, unitStatus, unitWhere, ARMY_STATUS, ruinBelieved, ruinKind, exploreRuin,
  exploreTarget, canExplore, setExplore, followExplore, canPillage, pillage, isPillaged, pillageTurnsLeft, cityAt, canRepair, repair,
  rallyPath, rallyTarget, canRally, setRally, clearRally, canSwap, swapPartners, swapUnits,
  canBuildRoad, buildRoad, roadLinks, canSentry, sentry, checkSentries, SENTRY_TEXT, volleyTarget, cityVolleys,
} from '../src/game.js';
import {
  runAITurn, goalsFor, buildSomething, pickRecruit, assignGarrisons, isWounded, planStrike,
  dangerMap, dangerPenalty, moveTowardsGoal, DANGER, unexploredLand, SCOUT_WHEN_UNKNOWN, aiKnowledge,
  upgradeSomething, UPGRADE_HORSE_RADIUS, strikeLinedUp, pillageGoals, PILLAGE_DETOUR, repairGoals, REPAIR_DETOUR,
  relieveWounded, RELIEF_MIN_HP, layRoad,
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
  RESOURCES, FORTIFY, TERRITORY, ECONOMY, UNIT_TYPES, TERRAIN, BUILDINGS, BUILDING_EFFECTS, RANKS, XP, FACTIONS, MAP_SIZES, RIVER, HAPPENINGS, FLANK, HIGH_GROUND, CHARGE, REPAIR,
  UPGRADES, UPGRADE, DISBAND, RUINS, EXPLORE, PILLAGE,
  SIGHTINGS, ROADWORK, SENTRY, VOLLEY,
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
  assert.equal(keyAction('d').type, 'disband');
  assert.equal(keyAction('D').type, 'disband');
  assert.equal(keyAction('?', true).type, 'help');
  assert.equal(keyAction('Escape').type, 'escape');
  const types = Object.keys(UNIT_TYPES);
  types.forEach((t, i) => {
    assert.deepEqual(keyAction(String(i + 1)), { type: 'recruit', unitType: t });
    assert.equal(recruitKey(t), String(i + 1));
  });
  assert.equal(keyAction(String(types.length + 1)), null);
  assert.equal(keyAction('q'), null);
  // every entry has overlay text, and no key is claimed by two entries
  for (const sc of SHORTCUTS) assert.ok(sc.keys && sc.text);
  for (const [k, shift] of [['Tab', false], ['Enter', false], ['Enter', true], ['f', false], ['x', false], ['g', false], ['1', false], ['?', true]]) {
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

test('scout: sees far, never enters a foreign city, the AI sends one exploring on big maps', () => {
  const s = createGame({ seed: 3, fog: true });
  for (const t of Object.values(s.tiles)) { t.terrain = 'plains'; delete t.road; delete t.rivers; delete t.resource; }
  s.factions = [null, null];
  s.units = [];
  const neutral = s.cities.find((c) => c.owner === null);
  const home = s.cities.find((c) => c.owner === 0);
  const sc = spawnUnit(s, 'scout', 0, neutral.q + 1, neutral.r);
  sc.movesLeft = unitMove(s, sc);
  assert.equal(sc.movesLeft, 3);
  // sight 4
  const vis = visibleTiles(s, 0);
  for (const t of Object.values(s.tiles)) {
    if (distance(t, sc) <= 4) assert.ok(vis.has(key(t.q, t.r)), `sees ${t.q},${t.r}`);
  }
  // a foreign (here neutral) city is neither a destination nor a passage
  assert.ok(!reachable(s, sc).has(key(neutral.q, neutral.r)));
  assert.equal(moveUnit(s, sc.id, neutral.q, neutral.r), false);
  updateExplored(s, 0);
  assert.equal(planRoute(s, sc, neutral.q, neutral.r), null);
  const far = { q: neutral.q - 2, r: neutral.r };
  const p = pathTo(s, sc, far.q, far.r);
  if (p) assert.ok(!p.some((h) => h.q === neutral.q && h.r === neutral.r), 'walks around the city');
  // other units capture as before, and the scout may enter its own city
  const w = spawnUnit(s, 'warrior', 0, neutral.q - 1, neutral.r);
  w.movesLeft = 2;
  assert.ok(reachable(s, w).has(key(neutral.q, neutral.r)));
  const own = spawnUnit(s, 'scout', 0, home.q + 1, home.r);
  own.movesLeft = 3;
  assert.ok(reachable(s, own).has(key(home.q, home.r)));
  // AI: on a large unexplored map it wants one scout, which only explores; not on Hard, not a second one
  const big = createGame({ seed: 5, size: 'large' });
  big.current = 1;
  const know = aiKnowledge(big, 1);
  assert.ok(unexploredLand(big, know) > SCOUT_WHEN_UNKNOWN);
  const capital = big.cities.find((c) => c.owner === 1);
  big.units = big.units.filter((u) => !(u.q === capital.q && u.r === capital.r));
  big.gold[1] = 100;
  // an army that already has its fill of every other type (only the count matters here)
  const army = ['warrior', 'warrior', 'warrior', 'archer', 'archer', 'horseman', 'horseman', 'spearman'];
  const spots = [...exploredTiles(big, 1)].map((k) => k.split(',').map(Number))
    .filter(([q, r]) => isPassable(big, q, r) && !unitAt(big, q, r) && !(q === capital.q && r === capital.r));
  big.units = big.units.filter((u) => u.owner === 0)
    .concat(army.map((type, i) => ({ id: 900 + i, type, owner: 1, q: spots[i][0], r: spots[i][1], hp: 1, movesLeft: 0, xp: 0 })));
  assert.equal(pickRecruit(big, 1, capital), 'scout');
  const scout = spawnUnit(big, 'scout', 1, capital.q, capital.r);
  assert.ok(goalsFor(big, scout).every((g) => g.explore || g.ruin), 'scouts only explore (or loot ruins)');
  assert.notEqual(pickRecruit(big, 1, capital), 'scout', 'one is enough');
  const hard = createGame({ seed: 5, size: 'large', difficulty: 'hard' });
  assert.equal(unexploredLand(hard, aiKnowledge(hard, 1)), 0);
});

test('map number: typed numbers are parsed, a restart gives exactly the same starting game', () => {
  assert.deepEqual(parseSeed(''), { seed: null, ok: true });
  assert.deepEqual(parseSeed('   '), { seed: null, ok: true });
  assert.deepEqual(parseSeed(' 4242 '), { seed: 4242, ok: true });
  assert.deepEqual(parseSeed('007'), { seed: 7, ok: true });
  assert.deepEqual(parseSeed(String(MAX_SEED)), { seed: MAX_SEED, ok: true });
  for (const bad of ['abc', '-5', '1.5', '1e3', '1234567890', '12 34']) assert.equal(parseSeed(bad).ok, false, bad);
  // the same number on the same size is the same map
  assert.deepEqual(createGame({ seed: 4242, size: 'small' }).tiles, createGame({ seed: 4242, size: 'small' }).tiles);
  // restart: a game played for a while restarts as the identical fresh game, on every size and setting
  for (const size of Object.keys(MAP_SIZES)) {
    const opts = { seed: 31337, size, difficulty: 'hard', fog: false, happenings: false, faction: 'forest' };
    const fresh = createGame(opts);
    const played = createGame(opts);
    for (let i = 0; i < 6 && played.winner === null; i++) { runAITurn(played); endTurn(played); }
    assert.ok(played.turn > 1);
    assert.deepEqual(createGame(restartOptions(played)), fresh, size);
  }
  const defaults = createGame({ seed: 9 });
  assert.deepEqual(createGame(restartOptions(defaults)), defaults);
  // a save from before factions restarts with the current rules (factions picked as for a new game)
  const old = createGame({ seed: 9 });
  old.factions = undefined;
  assert.deepEqual(createGame(restartOptions(old)).factions, defaults.factions);
});

// A player 0 unit of the given type standing in its capital, ready to act (other units out of the capital).
function inCapital(type, { seed = 3, gold = 100, hp = null, xp = 0 } = {}) {
  const s = createGame({ seed, fog: false, happenings: false });
  const cap = s.cities.find((c) => c.owner === 0 && c.capital);
  s.units = s.units.filter((u) => u.q !== cap.q || u.r !== cap.r);
  const u = { id: 900, type, owner: 0, q: cap.q, r: cap.r, hp: hp ?? UNIT_TYPES[type].hp, movesLeft: 2, hasAttacked: false, xp };
  s.units.push(u);
  s.gold[0] = gold;
  return { s, cap, u };
}

test('upgrades: a unit in an own city is retrained, keeps rank and HP share, pays the difference', () => {
  // every upgrade path leads to an existing, more expensive type
  for (const [from, tos] of Object.entries(UPGRADES)) {
    for (const to of tos) {
      assert.ok(UNIT_TYPES[from] && UNIT_TYPES[to], `${from} -> ${to}`);
      assert.ok(UNIT_TYPES[to].cost > UNIT_TYPES[from].cost, `${from} -> ${to} is a step up`);
    }
  }
  const { s, cap, u } = inCapital('warrior', { hp: 5, xp: 4 });
  const opts = upgradeOptions(s, u);
  assert.deepEqual(opts.map((o) => o.type), UPGRADES.warrior);
  const spear = opts.find((o) => o.type === 'spearman');
  assert.equal(spear.cost, Math.max(UPGRADE.min, unitCost(s, cap, 'spearman') - UNIT_TYPES.warrior.cost + UPGRADE.fee));
  assert.equal(upgradeCost(s, u, 'spearman'), spear.cost);
  assert.ok(opts.every((o) => o.affordable));
  const before = cloneState(s);
  u.fortified = true;
  before.units.find((x) => x.id === u.id).fortified = true;
  assert.ok(upgradeUnit(s, u.id, 'spearman'));
  assert.equal(u.type, 'spearman');
  assert.equal(u.hp, Math.ceil((5 / UNIT_TYPES.warrior.hp) * UNIT_TYPES.spearman.hp));
  assert.equal(u.xp, 4, 'experience is kept');
  assert.equal(rankOf(u), 1);
  assert.equal(s.gold[0], 100 - spear.cost);
  assert.ok(u.hasAttacked && u.movesLeft === 0, 'upgrading ends the unit\'s turn');
  assert.ok(!u.fortified, 'retraining leaves the fortification');
  assert.ok(!upgradeUnit(s, u.id, 'horseman'), 'only once per turn');
  assert.ok(s.log.some((l) => (l.msg ?? l).includes('retrained as Spearman')));
  // the event replays exactly
  const evs = drainEvents(s);
  assert.deepEqual(evs.map((e) => e.type), ['upgrade']);
  for (const ev of evs) applyEvent(before, ev);
  assert.deepEqual(before.units.find((x) => x.id === u.id), JSON.parse(JSON.stringify({ ...u, hasAttacked: false, movesLeft: 2 })));
  // the next turn the spearman acts normally; a spearman has no further upgrade
  endTurn(s); endTurn(s);
  assert.ok(u.movesLeft > 0 && !u.hasAttacked);
  assert.deepEqual(upgradeOptions(s, u), []);
});

test('upgrades: only in an own city, before acting, with enough gold, for the current player', () => {
  // not enough gold: shown, but not allowed
  const poor = inCapital('archer', { gold: 3 });
  const [cat] = upgradeOptions(poor.s, poor.u);
  assert.equal(cat.type, 'catapult');
  assert.ok(!cat.affordable);
  assert.ok(!upgradeUnit(poor.s, poor.u.id, 'catapult'));
  assert.equal(poor.s.gold[0], 3);
  // not a listed path
  const w = inCapital('warrior');
  assert.ok(!upgradeUnit(w.s, w.u.id, 'catapult'));
  assert.ok(!upgradeUnit(w.s, w.u.id, 'nonsense'));
  // after moving this turn: no options
  const m = inCapital('warrior');
  m.u.moved = true;
  assert.deepEqual(upgradeOptions(m.s, m.u), []);
  // a freshly recruited unit cannot be upgraded the same turn
  const r = inCapital('warrior');
  r.s.units = r.s.units.filter((x) => x.id !== r.u.id);
  assert.ok(buyUnit(r.s, r.cap.id, 'warrior'));
  assert.deepEqual(upgradeOptions(r.s, unitAt(r.s, r.cap.q, r.cap.r)), []);
  // outside a city, or in a foreign one
  const out = inCapital('warrior');
  const field = Object.values(out.s.tiles).find((t) => isPassable(out.s, t.q, t.r) && !unitAt(out.s, t.q, t.r)
    && !out.s.cities.some((c) => c.q === t.q && c.r === t.r));
  out.u.q = field.q; out.u.r = field.r;
  assert.deepEqual(upgradeOptions(out.s, out.u), []);
  out.u.q = out.cap.q; out.u.r = out.cap.r;
  out.cap.owner = 1;
  assert.deepEqual(upgradeOptions(out.s, out.u), []);
  // not on the other player's turn
  const t = inCapital('warrior');
  t.s.current = 1;
  assert.deepEqual(upgradeOptions(t.s, t.u), []);
  // the scout loses its no-capture rule as a horseman; faction discounts apply to the price
  const sc = inCapital('scout');
  assert.ok(upgradeUnit(sc.s, sc.u.id, 'horseman'));
  assert.ok(!UNIT_TYPES[sc.u.type].noCapture);
  const horde = createGame({ seed: 3, fog: false, faction: 'horde' });
  const hc = horde.cities.find((c) => c.owner === 0 && c.capital);
  horde.units = horde.units.filter((x) => x.q !== hc.q || x.r !== hc.r);
  const hw = { id: 901, type: 'warrior', owner: 0, q: hc.q, r: hc.r, hp: 10, movesLeft: 2, hasAttacked: false, xp: 0 };
  horde.units.push(hw);
  assert.ok(unitCost(horde, hc, 'horseman') < UNIT_TYPES.horseman.cost);
  assert.equal(upgradeCost(horde, hw, 'horseman'),
    Math.max(UPGRADE.min, unitCost(horde, hc, 'horseman') - UNIT_TYPES.warrior.cost + UPGRADE.fee));
  // sound and JSON
  assert.equal(soundFor({ type: 'upgrade' }), 'promote');
  assert.doesNotThrow(() => JSON.stringify(sc.s));
});

test('upgrades: the AI turns a garrison warrior into a spearman against horsemen, and an idle scout into a horseman', () => {
  const s = createGame({ seed: 11, fog: false, happenings: false });
  const cap = s.cities.find((c) => c.owner === 1 && c.capital);
  s.units = s.units.filter((u) => u.owner !== 1);
  s.units.push({ id: 700, type: 'warrior', owner: 1, q: cap.q, r: cap.r, hp: 10, movesLeft: 2, hasAttacked: false, xp: 0 });
  s.current = 1;
  s.gold[1] = 60;
  const know = aiKnowledge(s, 1);
  // no horsemen around: nothing happens
  upgradeSomething(s, 1, know);
  assert.equal(getUnit(s, 700).type, 'warrior');
  // a visible enemy horseman nearby: the warrior becomes a spearman
  const near = Object.values(s.tiles).find((t) => distance(t, cap) === UPGRADE_HORSE_RADIUS && isPassable(s, t.q, t.r) && !unitAt(s, t.q, t.r));
  s.units.push({ id: 701, type: 'horseman', owner: 0, q: near.q, r: near.r, hp: 10, movesLeft: 0, hasAttacked: true, xp: 0 });
  upgradeSomething(s, 1, aiKnowledge(s, 1));
  assert.equal(getUnit(s, 700).type, 'spearman');
  assert.ok(s.gold[1] < 60);
  // only with gold to spare
  const p = createGame({ seed: 11, fog: false, happenings: false });
  const pc = p.cities.find((c) => c.owner === 1 && c.capital);
  p.units = p.units.filter((u) => u.owner !== 1);
  p.units.push({ id: 700, type: 'warrior', owner: 1, q: pc.q, r: pc.r, hp: 10, movesLeft: 2, hasAttacked: false, xp: 0 });
  p.units.push({ id: 701, type: 'horseman', owner: 0, q: near.q, r: near.r, hp: 10, movesLeft: 0, hasAttacked: true, xp: 0 });
  p.current = 1;
  p.gold[1] = 5;
  upgradeSomething(p, 1, aiKnowledge(p, 1));
  assert.equal(getUnit(p, 700).type, 'warrior');
  // a scout in a city on a known map (no fog) has nothing left to explore
  s.units.push({ id: 702, type: 'scout', owner: 1, ...(() => { const c = s.cities.find((x) => x.owner === null); c.owner = 1; return { q: c.q, r: c.r }; })(), hp: 6, movesLeft: 3, hasAttacked: false, xp: 0 });
  s.gold[1] = 60;
  assert.ok(unexploredLand(s, aiKnowledge(s, 1)) <= SCOUT_WHEN_UNKNOWN);
  upgradeSomething(s, 1, aiKnowledge(s, 1));
  assert.equal(getUnit(s, 702).type, 'horseman');
  // AI vs AI games with upgrades still finish and stay consistent
  for (const seed of [5, 6]) {
    const g = createGame({ seed, size: 'small' });
    for (let i = 0; i < 300 && g.winner === null; i++) { runAITurn(g); drainEvents(g); endTurn(g); }
    assert.ok(g.units.every((u) => UNIT_TYPES[u.type] && u.hp > 0 && u.hp <= UNIT_TYPES[u.type].hp));
  }
});

test('disbanding: an own unit is dismissed, in an own city it refunds a share of its price', () => {
  for (const [type, t] of Object.entries(UNIT_TYPES)) {
    const { s, u } = inCapital(type);
    assert.equal(disbandRefund(s, u), Math.floor(t.cost * DISBAND.refundShare), type);
    assert.ok(disbandRefund(s, u) < t.cost, `${type}: disbanding never pays more than recruiting`);
  }
  const { s, cap, u } = inCapital('catapult', { xp: 5 });
  u.moved = true; u.hasAttacked = true; // also after acting
  const before = cloneState(s);
  const refund = disbandUnit(s, u.id);
  assert.equal(refund, Math.floor(UNIT_TYPES.catapult.cost * DISBAND.refundShare));
  assert.equal(s.gold[0], 100 + refund);
  assert.equal(getUnit(s, u.id), undefined);
  assert.ok(s.log.some((l) => l.msg.includes(`disbanded Catapult (${cap.name}, +${refund} gold)`)));
  assert.equal(disbandUnit(s, u.id), false, 'a unit is disbanded only once');
  // the city can recruit again right away
  assert.ok(buyUnit(s, cap.id, 'warrior'));
  // the event replays: the unit disappears from the copy
  const evs = drainEvents(s).filter((e) => e.type === 'disband');
  assert.deepEqual(evs.map((e) => [e.unitId, e.owner, e.refund]), [[u.id, 0, refund]]);
  for (const ev of evs) applyEvent(before, ev);
  assert.equal(getUnit(before, u.id), undefined);
  assert.equal(soundFor(evs[0]), 'disband');
  // a sound exists for it
  assert.ok(SOUND_NAMES.includes('disband'));
});

test('disbanding: nothing back outside own cities; never for the other player or after the game', () => {
  const out = inCapital('horseman');
  const field = Object.values(out.s.tiles).find((t) => isPassable(out.s, t.q, t.r) && !unitAt(out.s, t.q, t.r)
    && !out.s.cities.some((c) => c.q === t.q && c.r === t.r));
  out.u.q = field.q; out.u.r = field.r;
  assert.equal(disbandRefund(out.s, out.u), 0);
  assert.equal(disbandUnit(out.s, out.u.id), 0);
  assert.equal(out.s.gold[0], 100);
  assert.ok(!getUnit(out.s, out.u.id));
  assert.ok(out.s.log.at(-1).msg.endsWith('disbanded Horseman'));
  // in a foreign city: no refund either
  const foreign = inCapital('warrior');
  foreign.cap.owner = 1;
  assert.equal(disbandRefund(foreign.s, foreign.u), 0);
  // not on the other player's turn, not an enemy unit, not after game over
  const t = inCapital('warrior');
  t.s.current = 1;
  assert.ok(!canDisband(t.s, t.u));
  assert.equal(disbandUnit(t.s, t.u.id), false);
  assert.ok(getUnit(t.s, t.u.id));
  const enemy = t.s.units.find((x) => x.owner === 1);
  t.s.current = 0;
  assert.equal(disbandUnit(t.s, enemy.id), false);
  t.s.winner = 1;
  assert.equal(disbandUnit(t.s, t.u.id), false);
  assert.equal(disbandUnit(t.s, 12345), false, 'unknown unit');
});

test('disbanding: in the fog the enemy does not see a unit disbanded far away', () => {
  const s = createGame({ seed: 3, fog: true, happenings: false });
  const mine = s.units.find((u) => u.owner === 0);
  disbandUnit(s, mine.id);
  const last = s.log.at(-1);
  assert.deepEqual(last.seen, [0]);
  assert.ok(logFor(s, 1).at(-1).hidden);
});

test('flanking: own units next to the defender raise the attack, capped, counterattack not boosted', () => {
  const s = createGame({ seed: 1, fog: false });
  const tiles = Object.values(s.tiles);
  for (const t of tiles) { t.terrain = 'plains'; delete t.rivers; delete t.road; }
  s.cities = s.cities.filter((c) => distance(c, { q: 5, r: 4 }) > 3);
  const center = tileAt(s, 5, 4);
  const around = neighbors(center.q, center.r);
  assert.equal(around.length, 6);
  const mk = (id, owner, p, type = 'warrior') => ({ id, type, owner, q: p.q, r: p.r, hp: UNIT_TYPES[type].hp, movesLeft: 2, hasAttacked: false, xp: 0 });
  const foe = mk(901, 1, center);
  const me = mk(900, 0, around[0]);
  s.units = [me, foe];
  const alone = previewAttack(s, me, foe);
  assert.equal(alone.flank, 0);
  assert.equal(flankers(s, me, foe).length, 0, 'the attacker itself never counts');
  // an enemy unit next to the defender doesn't count, nor does an own unit two tiles away
  s.units.push(mk(902, 1, around[1]), mk(903, 0, { q: center.q + 2, r: center.r - 1 }));
  assert.equal(flankBonus(s, me, foe), 0);
  // own units next to the defender: +perUnit each, up to max
  s.units = [me, foe];
  let prev = alone.damage;
  for (let i = 1; i <= 5; i++) {
    s.units.push(mk(910 + i, 0, around[i]));
    const p = previewAttack(s, me, foe);
    assert.equal(flankers(s, me, foe).length, i);
    assert.ok(Math.abs(p.flank - FLANK.perUnit * Math.min(i, FLANK.max)) < 1e-9, `flank with ${i}`);
    assert.ok(p.damage >= prev, 'more flankers never do less damage');
    assert.ok(p.counter <= alone.counter, 'the counterattack is never stronger');
    prev = p.damage;
  }
  const full = previewAttack(s, me, foe);
  assert.ok(full.damage > alone.damage, `flanked ${full.damage} > alone ${alone.damage}`);
  // a ranged attacker standing away from the target gets the bonus too
  const archer = mk(950, 0, { q: center.q + 2, r: center.r - 1 }, 'archer');
  s.units.push(archer);
  assert.ok(Math.abs(flankBonus(s, archer, foe) - FLANK.perUnit * FLANK.max) < 1e-9);
  // the real attack deals the previewed flanked damage
  s.current = 0;
  s.units = s.units.filter((u) => u.id !== 950);
  const expected = previewAttack(s, me, foe).damage;
  assert.ok(attack(s, me.id, foe.id));
  assert.equal(getUnit(s, foe.id) ? getUnit(s, foe.id).hp : 0, Math.max(0, UNIT_TYPES.warrior.hp - expected));
});

test('AI lines up melee strikes so every attacker gets the flank bonus, then strikes in plan order', () => {
  const s = createGame({ seed: 1, fog: false, difficulty: 'hard' });
  for (const t of Object.values(s.tiles)) { t.terrain = 'plains'; delete t.rivers; delete t.road; }
  s.cities = s.cities.filter((c) => distance(c, { q: 5, r: 4 }) > 4);
  s.current = 1;
  const center = tileAt(s, 5, 4);
  const mk = (id, owner, p, type = 'warrior') => ({ id, type, owner, q: p.q, r: p.r, hp: UNIT_TYPES[type].hp, movesLeft: UNIT_TYPES[type].move, hasAttacked: false, xp: 0 });
  // a tough veteran spearman of the player in the middle, three AI warriors two tiles away
  const foe = mk(901, 0, center, 'spearman');
  foe.xp = 99;
  const ring = Object.values(s.tiles).filter((t) => distance(t, center) === 2);
  const ais = [ring[0], ring[2], ring[4]].map((t, i) => mk(920 + i, 1, t));
  s.units = [foe, ...ais];
  const know = aiKnowledge(s, 1);
  const lined = [];
  for (const u of ais) {
    const plan = planStrike(s, u, know, new Map(), { lineUp: lined });
    assert.equal(typeof plan, 'object', 'a strike that does not kill alone is lined up');
    assert.equal(plan.targetId, foe.id);
    assert.ok(plan.damage > 0);
    lined.push(plan);
  }
  assert.equal(getUnit(s, foe.id).hp, UNIT_TYPES.spearman.hp, 'nobody has attacked yet');
  for (const u of ais) assert.equal(distance(getUnit(s, u.id), center), 1, 'all attackers stand next to the target');
  // the first strike now has the bonus of both others – striking one by one it would have had none
  const first = getUnit(s, lined[0].unitId);
  const p = previewAttack(s, first, foe);
  assert.ok(Math.abs(p.flank - 2 * FLANK.perUnit) < 1e-9, `first strike flanked: ${p.flank}`);
  const before = foe.hp;
  strikeLinedUp(s, lined);
  const left = getUnit(s, foe.id);
  assert.ok(!left || left.hp < before - p.damage, 'all lined-up attackers struck');
  for (const u of ais) { const a = getUnit(s, u.id); if (a) assert.ok(a.hasAttacked); }
});

test('AI line-up: a lone kill is struck at once, a doomed target is left to the lined-up attackers', () => {
  const s = createGame({ seed: 1, fog: false, difficulty: 'hard' });
  for (const t of Object.values(s.tiles)) { t.terrain = 'plains'; delete t.rivers; delete t.road; }
  s.cities = s.cities.filter((c) => distance(c, { q: 5, r: 4 }) > 4);
  s.current = 1;
  const center = tileAt(s, 5, 4);
  const mk = (id, owner, p, type = 'warrior') => ({ id, type, owner, q: p.q, r: p.r, hp: UNIT_TYPES[type].hp, movesLeft: UNIT_TYPES[type].move, hasAttacked: false, xp: 0 });
  const foe = mk(901, 0, center);
  foe.hp = 1;
  const ring = Object.values(s.tiles).filter((t) => distance(t, center) === 2);
  const a = mk(920, 1, ring[0]);
  s.units = [foe, a];
  assert.equal(planStrike(s, a, aiKnowledge(s, 1), new Map(), { lineUp: [] }), true, 'the kill is made right away');
  assert.equal(getUnit(s, foe.id), undefined);
  // a target the lined-up strikes will already destroy is not picked again
  const foe2 = mk(902, 0, center);
  const b = mk(921, 1, ring[3]);
  s.units = [foe2, b];
  const doomed = [{ unitId: 999, targetId: foe2.id, damage: foe2.hp }];
  assert.equal(planStrike(s, b, aiKnowledge(s, 1), new Map(), { lineUp: doomed }), false);
  assert.deepEqual([getUnit(s, b.id).q, getUnit(s, b.id).r], [ring[3].q, ring[3].r], 'it did not move');
});

test('high ground: an attacker on hills against a unit below gets the bonus, stacks with flanking, counter not boosted', () => {
  const s = createGame({ seed: 1, fog: false });
  for (const t of Object.values(s.tiles)) { t.terrain = 'plains'; delete t.rivers; delete t.road; }
  s.cities = s.cities.filter((c) => distance(c, { q: 5, r: 4 }) > 3);
  const center = tileAt(s, 5, 4);
  const around = neighbors(center.q, center.r);
  const mk = (id, owner, p, type = 'warrior') => ({ id, type, owner, q: p.q, r: p.r, hp: UNIT_TYPES[type].hp, movesLeft: 2, hasAttacked: false, xp: 0 });
  const foe = mk(901, 1, center);
  const me = mk(900, 0, around[0]);
  s.units = [me, foe];
  const flat = previewAttack(s, me, foe);
  assert.equal(flat.high, 0);
  // attacker on hills, defender on plains: bonus
  tileAt(s, me.q, me.r).terrain = 'hills';
  assert.equal(highGroundBonus(s, me, foe), HIGH_GROUND.atkBonus);
  const up = previewAttack(s, me, foe);
  assert.equal(up.high, HIGH_GROUND.atkBonus);
  assert.ok(up.damage > flat.damage, `high ground ${up.damage} > flat ${flat.damage}`);
  // the counterattack is never stronger; the attacker's hills defense even weakens it
  assert.ok(up.counter <= flat.counter);
  // the defender's counter from below never gets the bonus, and both on hills = no bonus
  assert.equal(highGroundBonus(s, foe, me), 0);
  tileAt(s, foe.q, foe.r).terrain = 'hills';
  assert.equal(highGroundBonus(s, me, foe), 0);
  assert.equal(previewAttack(s, me, foe).high, 0);
  tileAt(s, foe.q, foe.r).terrain = 'plains';
  // works for a ranged attacker two tiles away, too
  const archer = mk(950, 0, { q: center.q + 2, r: center.r - 1 }, 'archer');
  tileAt(s, archer.q, archer.r).terrain = 'hills';
  assert.equal(highGroundBonus(s, archer, foe), HIGH_GROUND.atkBonus);
  // stacks additively with flanking
  s.units.push(mk(911, 0, around[1]));
  const both = previewAttack(s, me, foe);
  assert.ok(Math.abs(both.flank - FLANK.perUnit) < 1e-9);
  assert.ok(both.damage >= up.damage);
  // the real attack deals the previewed damage
  s.current = 0;
  const expected = previewAttack(s, me, foe).damage;
  assert.ok(attack(s, me.id, foe.id));
  assert.equal(getUnit(s, foe.id) ? getUnit(s, foe.id).hp : 0, Math.max(0, UNIT_TYPES.warrior.hp - expected));
});

test('cavalry charge: a horseman that spent 2+ moves gets the bonus, not into forest, not for others, counter not boosted', () => {
  const s = createGame({ seed: 1, fog: false });
  for (const t of Object.values(s.tiles)) { t.terrain = 'plains'; delete t.rivers; delete t.road; }
  s.cities = s.cities.filter((c) => distance(c, { q: 5, r: 4 }) > 4);
  s.factions = [null, null];
  s.current = 0;
  const center = tileAt(s, 5, 4);
  const mk = (id, owner, p, type) => ({ id, type, owner, q: p.q, r: p.r, hp: UNIT_TYPES[type].hp, movesLeft: UNIT_TYPES[type].move, hasAttacked: false, xp: 0 });
  const foe = mk(901, 1, center, 'warrior');
  const start = Object.values(s.tiles).find((t) => distance(t, center) === 3);
  const horse = mk(900, 0, start, 'horseman');
  s.units = [horse, foe];
  // fresh horseman: no charge yet
  assert.equal(movesSpent(s, horse), 0);
  assert.equal(chargeReady(s, horse), false);
  assert.equal(chargeBonus(s, horse, foe), 0);
  // one step is not enough, two are
  horse.movesLeft = UNIT_TYPES.horseman.move - 1;
  assert.equal(chargeBonus(s, horse, foe), 0);
  horse.movesLeft = UNIT_TYPES.horseman.move - CHARGE.minMoves;
  assert.equal(chargeBonus(s, horse, foe), CHARGE.atkBonus);
  // other unit types never charge
  const w = mk(902, 0, start, 'warrior');
  w.movesLeft = 0;
  assert.equal(chargeBonus(s, w, foe), 0);
  // no charge against a defender in forest
  tileAt(s, foe.q, foe.r).terrain = 'forest';
  assert.equal(chargeBonus(s, horse, foe), 0);
  tileAt(s, foe.q, foe.r).terrain = 'plains';
  // a real move of 2 tiles next to the target, then the attack: charge in the preview and the actual damage
  horse.movesLeft = UNIT_TYPES.horseman.move;
  const next = neighbors(center.q, center.r).find((n) => distance(n, start) === 2);
  assert.ok(moveUnit(s, horse.id, next.q, next.r));
  const h = getUnit(s, horse.id);
  assert.equal(chargeReady(s, h), true);
  const p = previewAttack(s, h, foe);
  assert.equal(p.charge, CHARGE.atkBonus);
  // compare with the same horseman standing still: more damage, the counter is not stronger
  const still = { ...h, movesLeft: UNIT_TYPES.horseman.move };
  const calm = previewAttack(s, still, foe);
  assert.equal(calm.charge, 0);
  assert.ok(p.damage > calm.damage, `charge ${p.damage} > standing ${calm.damage}`);
  assert.ok(p.counter <= calm.counter);
  assert.ok(attack(s, h.id, foe.id));
  assert.equal(getUnit(s, foe.id).hp, UNIT_TYPES.warrior.hp - p.damage);
  // after attacking the charge is spent
  assert.equal(chargeReady(s, getUnit(s, horse.id)), false);
});

test('cavalry charge: the AI counts the moves it spends on the approach', () => {
  const s = createGame({ seed: 1, fog: false, difficulty: 'hard' });
  for (const t of Object.values(s.tiles)) { t.terrain = 'plains'; delete t.rivers; delete t.road; }
  s.cities = s.cities.filter((c) => distance(c, { q: 5, r: 4 }) > 5);
  s.factions = [null, null];
  s.current = 1;
  const center = tileAt(s, 5, 4);
  const mk = (id, owner, p, type) => ({ id, type, owner, q: p.q, r: p.r, hp: UNIT_TYPES[type].hp, movesLeft: UNIT_TYPES[type].move, hasAttacked: false, xp: 0 });
  const foe = mk(901, 0, center, 'warrior');
  const start = Object.values(s.tiles).find((t) => distance(t, center) === 3);
  const horse = mk(900, 1, start, 'horseman');
  s.units = [horse, foe];
  // what a charge from a neighbouring tile would deal
  const next = neighbors(center.q, center.r).find((n) => distance(n, start) === 2);
  const expected = previewAttack(s, { ...horse, q: next.q, r: next.r, movesLeft: horse.movesLeft - 2 }, foe);
  assert.equal(expected.charge, CHARGE.atkBonus);
  assert.equal(planStrike(s, horse, aiKnowledge(s, 1), new Map()), true);
  const h = getUnit(s, horse.id);
  assert.equal(distance(h, center), 1, 'the horseman rode up to the target');
  assert.ok(h.hasAttacked);
  assert.equal(getUnit(s, foe.id).hp, UNIT_TYPES.warrior.hp - expected.damage, 'the strike carried the charge');
});

test('enemy turn report: losses, wounded units, fallen attackers and lost cities from the enemy turn', () => {
  const s = createGame({ seed: 1, fog: false, happenings: false });
  for (const t of Object.values(s.tiles)) { t.terrain = 'plains'; delete t.rivers; delete t.road; }
  s.cities = s.cities.filter((c) => distance(c, { q: 5, r: 4 }) > 3);
  const center = { q: 5, r: 4 };
  const around = neighbors(center.q, center.r);
  const mk = (id, owner, p, type = 'warrior', hp = UNIT_TYPES[type].hp) => ({ id, type, owner, q: p.q, r: p.r, hp, movesLeft: 2, hasAttacked: false, xp: 0 });
  // own: a weak archer (dies), a tough spearman (wounded), a warrior that kills a weak attacker
  const weak = mk(900, 0, center, 'archer', 1);
  const tough = mk(901, 0, around[3], 'spearman');
  const strong = mk(902, 0, tileAt(s, 8, 4), 'warrior');
  const a1 = mk(910, 1, around[0], 'horseman');
  const a2 = mk(911, 1, around[2], 'warrior');
  const a3 = mk(912, 1, tileAt(s, 9, 4), 'archer', 1);
  s.units = [weak, tough, strong, a1, a2, a3];
  s.current = 1;
  const before = cloneState(s);
  assert.ok(attack(s, a1.id, weak.id));
  assert.ok(attack(s, a2.id, tough.id));
  assert.ok(attack(s, a3.id, strong.id));
  assert.ok(!getUnit(s, a3.id), 'the weak archer fell to the counter (precondition)');
  const events = drainEvents(s);
  const rep = turnReport(before, events, 0);
  assert.deepEqual(rep.lost, { archer: 1 });
  assert.equal(rep.wounded, 2, 'spearman and warrior survived their fights');
  assert.equal(rep.fell, 1);
  assert.deepEqual(rep.citiesLost, []);
  assert.deepEqual(rep.spots, [{ q: 5, r: 4, kind: 'lost' }]);
  assert.ok(reportIsBad(rep));
  const text = reportText(rep);
  assert.ok(text.startsWith('Enemy turn: you lost Archer.'), text);
  assert.ok(text.includes('2 units were wounded.') && text.includes('1 attacker fell'), text);
  // the report doesn't change `before`, and from the enemy's side nothing of this is "its" loss
  assert.equal(getUnit(before, weak.id).hp, 1);
  const theirs = turnReport(before, events, 1);
  assert.deepEqual(theirs.lost, {});
  assert.equal(reportText(theirs), '');

  // a wounded unit that is then destroyed counts only as lost; a city captured from the player is listed
  const s2 = createGame({ seed: 1, fog: false, happenings: false });
  for (const t of Object.values(s2.tiles)) { t.terrain = 'plains'; delete t.rivers; delete t.road; }
  const city = s2.cities.find((c) => c.owner === null);
  city.owner = 0;
  const near = neighbors(city.q, city.r).filter((p) => tileAt(s2, p.q, p.r));
  const guard = mk(950, 0, city, 'warrior', 2);
  const b1 = mk(960, 1, near[0], 'archer');
  const b2 = mk(961, 1, near[1], 'horseman');
  s2.units = [...s2.units.filter((u) => distance(u, city) > 3), guard, b1, b2];
  s2.current = 1;
  const before2 = cloneState(s2);
  attack(s2, b1.id, guard.id);
  if (getUnit(s2, guard.id)) attack(s2, b2.id, guard.id);
  assert.ok(!getUnit(s2, guard.id), 'guard destroyed (precondition)');
  const mover = getUnit(s2, b2.id) || getUnit(s2, b1.id);
  mover.movesLeft = 3; mover.hasAttacked = false;
  assert.ok(moveUnit(s2, mover.id, city.q, city.r));
  const rep2 = turnReport(before2, drainEvents(s2), 0);
  assert.deepEqual(rep2.lost, { warrior: 1 });
  assert.equal(rep2.wounded, 0);
  assert.deepEqual(rep2.citiesLost, [`the city ${city.name}`]);
  assert.equal(reportText(rep2), `Enemy turn: you lost Warrior and the city ${city.name}.`);

  // nothing happened to the player: no text; only attackers fell: not a bad report
  const quiet = { lost: {}, wounded: 0, fell: 0, citiesLost: [], spots: [] };
  assert.equal(reportText(quiet), '');
  assert.ok(!reportIsBad(quiet));
  assert.ok(!reportIsBad({ ...quiet, fell: 2 }));
  assert.equal(reportText({ ...quiet, lost: { warrior: 2, archer: 1 } }), 'Enemy turn: you lost Warrior ×2 and Archer.');
  assert.equal(reportText({ ...quiet, lost: { warrior: 1 }, citiesLost: ['the city A', 'your capital'] }),
    'Enemy turn: you lost Warrior, the city A and your capital.');
});

test('enemy turn report: a real AI turn gives a consistent report', () => {
  for (const seed of [3, 7, 11]) {
    const s = createGame({ seed, fog: true, happenings: false });
    for (let i = 0; i < 12 && s.winner === null; i++) {
      endTurn(s);
      drainEvents(s);
      const before = cloneState(s);
      const myBefore = s.units.filter((u) => u.owner === 0).length;
      runAITurn(s);
      const rep = turnReport(before, drainEvents(s), 0);
      const lost = Object.values(rep.lost).reduce((a, b) => a + b, 0);
      assert.equal(myBefore - s.units.filter((u) => u.owner === 0).length, lost, `seed ${seed} round ${i}`);
      assert.equal(rep.citiesLost.length, before.cities.filter((c) => c.owner === 0).length - s.cities.filter((c) => c.owner === 0).length);
      if (s.winner === null) endTurn(s);
    }
  }
});

test('last-seen markers: an enemy that leaves sight leaves a marker, seeing the tile again clears it', () => {
  const s = createGame({ seed: 1, fog: true, happenings: false });
  for (const t of Object.values(s.tiles)) { t.terrain = 'plains'; delete t.rivers; delete t.road; }
  s.cities = s.cities.filter((c) => distance(c, { q: 4, r: 4 }) > 6);
  const mk = (id, owner, q, r, type = 'warrior') => ({ id, type, owner, q, r, hp: UNIT_TYPES[type].hp, movesLeft: UNIT_TYPES[type].move, hasAttacked: false, xp: 0 });
  for (const [q, r] of [[0, 4], [2, 4], [4, 4], [5, 4], [6, 4], [10, 4]]) assert.ok(tileAt(s, q, r), `tile ${q},${r}`);
  const scout = mk(900, 0, 2, 4);
  const rider = mk(910, 1, 4, 4, 'horseman');
  const far = mk(911, 1, 10, 4, 'archer');
  s.units = [scout, rider, far];
  assert.deepEqual(updateSightings(s, 0).map((x) => x.unitId), [rider.id], 'only the unit in sight is remembered');
  assert.deepEqual(lastSeen(s, 0), [], 'a unit in sight is not a marker');

  // our unit walks away: the rider stays as a marker where it stood
  scout.q = 0;
  updateSightings(s, 0);
  assert.ok(!visibleTiles(s, 0).has(key(4, 4)), 'precondition: the rider is out of sight');
  const g = lastSeenAt(s, 0, 4, 4);
  assert.ok(g && g.unitId === rider.id && g.type === 'horseman' && g.owner === 1 && !g.left);
  assert.equal(lastSeenText(s, g), 'AI: Horseman – last seen here this turn (HP 10/10)');
  assert.ok(!lastSeen(s, 0).some((x) => x.unitId === far.id), 'a unit never seen leaves no marker');

  // markers age and are forgotten after SIGHTINGS.maxAge turns
  s.turn += SIGHTINGS.maxAge;
  updateSightings(s, 0);
  assert.ok(lastSeenAt(s, 0, 4, 4), 'still remembered at the maximum age');
  assert.ok(lastSeenText(s, g).includes(`${SIGHTINGS.maxAge} turns ago`));
  s.turn += 1;
  updateSightings(s, 0);
  assert.deepEqual(lastSeen(s, 0), [], 'forgotten when too old');

  // the rider walks out of sight: the marker sits on the first fogged tile of its path, not where it ended
  scout.q = 2;
  updateSightings(s, 0);
  s.current = 1;
  assert.ok(moveUnit(s, rider.id, 6, 4));
  const evs = drainEvents(s);
  const path = evs.find((e) => e.type === 'move').path;
  updateSightings(s, 0, evs);
  const seen = visibleTiles(s, 0);
  const walked = lastSeen(s, 0);
  assert.equal(walked.length, 1);
  assert.ok(walked[0].left && !seen.has(key(walked[0].q, walked[0].r)));
  const idx = path.findIndex((p) => p.q === walked[0].q && p.r === walked[0].r);
  assert.ok(idx > 0 && seen.has(key(path[idx - 1].q, path[idx - 1].r)), 'right after the last tile in sight');
  assert.ok(lastSeenText(s, walked[0]).includes('seen heading here'));

  // seeing the marked tile again with nobody there clears the marker
  s.current = 0;
  scout.q = walked[0].q - 2;
  updateSightings(s, 0);
  assert.ok(visibleTiles(s, 0).has(key(walked[0].q, walked[0].r)));
  assert.ok(!visibleTiles(s, 0).has(key(rider.q, rider.r)), 'precondition: the rider itself is still hidden');
  assert.deepEqual(lastSeen(s, 0), [], 'the marked tile is empty, so the marker is gone');
  // seeing the unit itself replaces the marker with its real position
  scout.q = 4;
  updateSightings(s, 0);
  assert.deepEqual(lastSeen(s, 0), []);
  assert.ok(s.sightings[0].some((x) => x.unitId === rider.id && x.q === rider.q && x.r === rider.r));

  // own units are never markers; no fog or a finished game: nothing; the state stays JSON
  assert.ok(!s.sightings[0].some((x) => x.owner === 0));
  assert.deepEqual(JSON.parse(JSON.stringify(s)).sightings, s.sightings);
  s.winner = 0;
  assert.deepEqual(updateSightings(s, 0), []);
  const open = createGame({ seed: 1, fog: false });
  assert.deepEqual(updateSightings(open, 0), []);
  assert.deepEqual(lastSeen(open, 0), []);

  // migration from version 16 adds empty markers
  const old = createGame({ seed: 2 });
  old.version = 16;
  delete old.sightings;
  const m = migrateState(old);
  assert.equal(m.version, STATE_VERSION);
  assert.deepEqual(m.sightings, [[], []]);
});

test('last-seen markers: real AI turns never put a marker on a tile in sight or keep one too long', () => {
  for (const seed of [3, 7, 11]) {
    const s = createGame({ seed, fog: true, happenings: false });
    updateSightings(s, 0);
    for (let i = 0; i < 15 && s.winner === null; i++) {
      endTurn(s);
      drainEvents(s);
      runAITurn(s);
      const events = drainEvents(s);
      if (s.winner === null) endTurn(s);
      drainEvents(s);
      updateSightings(s, 0, events);
      const seen = visibleTiles(s, 0);
      for (const g of lastSeen(s, 0)) {
        assert.ok(!seen.has(key(g.q, g.r)), `seed ${seed} round ${i}`);
        assert.ok(s.turn - g.turn <= SIGHTINGS.maxAge);
        assert.equal(g.owner, 1);
      }
      // the player's units step forward a little so sight changes
      for (const u of s.units.filter((x) => x.owner === 0)) {
        const to = [...reachable(s, u).keys()][0];
        if (to) { const [q, r] = to.split(',').map(Number); moveUnit(s, u.id, q, r); }
      }
      updateSightings(s, 0, drainEvents(s));
    }
  }
});

test('army overview lists own units by status with a fog-safe location', () => {
  const s = createGame({ seed: 5 });
  const mine = s.units.filter((u) => u.owner === 0).sort((x, y) => x.id - y.id);
  const capital = s.cities.find((c) => c.owner === 0 && c.capital);
  const enemyCity = s.cities.find((c) => c.owner === 1);
  // a fresh game: every own unit is ready, enemy units are not listed
  let ov = armyOverview(s, 0);
  assert.equal(ov.rows.length, mine.length);
  assert.ok(ov.rows.every((r) => r.status === 'ready' && s.units.find((u) => u.id === r.id).owner === 0));
  assert.equal(ov.counts.ready, mine.length);
  assert.deepEqual(Object.keys(ov.counts), Object.keys(ARMY_STATUS));

  // statuses: fortified, done, marching (order and no moves left), ready
  const [a, b] = mine;
  const c = spawnUnit(s, 'archer', 0, capital.q, capital.r);
  const d = spawnUnit(s, 'scout', 0, capital.q, capital.r);
  d.movesLeft = 3; // freshly recruited units wait a turn
  a.fortified = true;
  b.movesLeft = 0; b.hasAttacked = true;
  c.movesLeft = 0; c.hasAttacked = true; c.goto = { q: enemyCity.q, r: enemyCity.r };
  assert.equal(unitStatus(s, a), 'fortified');
  assert.equal(unitStatus(s, b), 'done');
  assert.equal(unitStatus(s, c), 'marching');
  assert.equal(unitStatus(s, d), 'ready');
  ov = armyOverview(s, 0);
  assert.deepEqual(ov.rows.map((r) => r.id), [d.id, c.id, a.id, b.id], 'ready → marching → fortified → done');
  assert.deepEqual(ov.counts, { ready: 1, marching: 1, fortified: 1, sentry: 0, done: 1 });
  // the ready list agrees with Tab
  assert.deepEqual(ov.rows.filter((r) => r.status === 'ready').map((r) => r.id), activeUnits(s, 0).map((u) => u.id));
  const row = ov.rows.find((r) => r.id === c.id);
  assert.equal(row.name, 'Archer'); assert.equal(row.symbol, 'A'); assert.equal(row.maxHp, UNIT_TYPES.archer.hp);

  // location: in a city, n tiles from the nearest explored city; an unexplored enemy city is never named
  assert.equal(unitWhere(s, d), `in ${capital.name}`);
  const fogged = s.cities.filter((x) => !exploredTiles(s, 0).has(key(x.q, x.r)));
  assert.ok(fogged.some((x) => x.id === enemyCity.id), 'the enemy capital starts in the fog');
  d.q = enemyCity.q; d.r = enemyCity.r; // stand on the enemy capital without exploring it
  const w = unitWhere(s, d);
  assert.ok(!fogged.some((x) => w.includes(x.name)), `fogged city named: ${w}`);
  assert.match(w, /^\d+ tiles? from /);
  s.fog = false;
  assert.equal(unitWhere(s, d), `in ${enemyCity.name}`, 'without fog every city is known');
  const n = neighbors(capital.q, capital.r).find((p) => !s.cities.some((x) => distance(x, p) === 0));
  d.q = n.q; d.r = n.r;
  assert.equal(unitWhere(s, d), `1 tile from ${capital.name}`);
  // no unit, no rows; the overview is plain JSON
  s.units = s.units.filter((u) => u.owner !== 0);
  assert.deepEqual(armyOverview(s, 0).rows, []);
  assert.deepEqual(JSON.parse(JSON.stringify(ov)), ov);
});

test('ancient ruins: placed fairly in pairs on every map size, deterministic', () => {
  for (const size of Object.keys(MAP_SIZES)) {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const s = createGame({ seed, size });
      const ruins = Object.values(s.tiles).filter((t) => t.ruin);
      const [home, away] = s.cities;
      const pairs = Math.max(1, Math.round((s.cols * s.rows) / RUINS.perPair));
      assert.ok(ruins.length >= 2 && ruins.length <= pairs * 2 && ruins.length % 2 === 0, `${size}/${seed}: ${ruins.length} ruins`);
      const near = ruins.filter((t) => distance(t, home) < distance(t, away));
      assert.equal(near.length * 2, ruins.length, `${size}/${seed}: half the ruins on each side`);
      // fair: the distances to "their" capital match within 1 per pair
      const own = (t) => Math.min(distance(t, home), distance(t, away));
      const a = near.map(own).sort((x, y) => x - y);
      const b = ruins.filter((t) => !near.includes(t)).map(own).sort((x, y) => x - y);
      assert.ok(Math.abs(a.reduce((x, y) => x + y, 0) - b.reduce((x, y) => x + y, 0)) <= a.length, `${size}/${seed}: fair distances`);
      for (const t of ruins) {
        assert.ok(TERRAIN[t.terrain].passable && !t.resource, 'on passable land without a resource');
        assert.ok(s.cities.every((c) => distance(c, t) >= RUINS.minCityDist), 'away from cities');
        assert.ok(own(t) >= RUINS.minCapitalDist, 'away from capitals');
        assert.ok(pathExists(s.tiles, home, t), 'reachable');
        assert.ok(ruins.every((o) => o === t || distance(o, t) >= RUINS.minRuinDist), 'apart from each other');
      }
      const again = createGame({ seed, size });
      assert.deepEqual(Object.values(again.tiles).filter((t) => t.ruin).map((t) => key(t.q, t.r)), ruins.map((t) => key(t.q, t.r)));
    }
  }
});

// A game with one ruin of the given kind at a free tile near the player's capital (rewards depend on the
// tile, so we look for a tile of that kind) and a player unit on a neighbour ready to step onto it.
function ruinSetup(kind, { fog = true, seed = 5 } = {}) {
  const s = createGame({ seed, fog, happenings: false });
  for (const t of Object.values(s.tiles)) delete t.ruin;
  const capital = s.cities[0];
  const tile = Object.values(s.tiles).find((t) => isPassable(s, t.q, t.r) && !unitAt(s, t.q, t.r)
    && !s.cities.some((c) => distance(c, t) < 2) && distance(t, capital) <= 4 && ruinKind(s, t.q, t.r) === kind
    && neighbors(t.q, t.r).filter((n) => isPassable(s, n.q, n.r) && !unitAt(s, n.q, n.r)).length >= 3);
  assert.ok(tile, `no tile for ${kind}`);
  tile.ruin = true;
  const from = neighbors(tile.q, tile.r).find((n) => isPassable(s, n.q, n.r) && !unitAt(s, n.q, n.r)
    && stepCost(s, n, tile) <= 2 && !s.cities.some((c) => distance(c, n) === 0));
  const u = spawnUnit(s, 'warrior', 0, from.q, from.r);
  u.movesLeft = 4; u.hasAttacked = false;
  drainEvents(s);
  return { s, tile, u };
}

test('ancient ruins: each reward, the event replays and the move cannot be undone', () => {
  // treasure
  let { s, tile, u } = ruinSetup('treasure');
  const gold = s.gold[0];
  let before = cloneState(s);
  assert.ok(ruinBelieved(s, tile.q, tile.r, 0));
  assert.ok(moveUnit(s, u.id, tile.q, tile.r));
  let evs = drainEvents(s);
  const ev = evs.find((e) => e.type === 'ruin');
  assert.equal(ev.kind, 'treasure');
  assert.equal(s.gold[0], gold + RUINS.kinds.treasure.gold);
  assert.ok(!tile.ruin && tile.ruinGone.includes(0));
  assert.ok(!ruinBelieved(s, tile.q, tile.r, 0));
  assert.match(logFor(s, 0).at(-1).msg, /explored ancient ruins – Treasure \(\+15 gold\)/);
  assert.equal(isUndoableMove(before, s, evs, 0), false, 'looting a ruin is not undoable');
  for (const e of evs) applyEvent(before, e);
  assert.deepEqual(snapshot(before), snapshot(s));
  assert.equal(before.gold[0], s.gold[0]);
  assert.ok(!tileAt(before, tile.q, tile.r).ruin);
  // stepping on the same tile again gives nothing
  const g2 = s.gold[0];
  assert.equal(exploreRuin(s, getUnit(s, u.id)), null);
  assert.equal(s.gold[0], g2);

  // training: +3 xp → Veteran, with the promotion heal
  ({ s, tile, u } = ruinSetup('training'));
  u.hp = 5;
  before = cloneState(s);
  moveUnit(s, u.id, tile.q, tile.r);
  assert.equal(u.xp, RUINS.kinds.training.xp);
  assert.equal(rankOf(u), 1);
  assert.equal(u.hp, 5 + XP.promotionHeal);
  for (const e of drainEvents(s)) applyEvent(before, e);
  assert.deepEqual(snapshot(before), snapshot(s));

  // map: everything within the radius becomes explored
  ({ s, tile, u } = ruinSetup('map'));
  moveUnit(s, u.id, tile.q, tile.r);
  const exp = exploredTiles(s, 0);
  for (const t of Object.values(s.tiles)) {
    if (distance(t, tile) <= RUINS.kinds.map.radius) assert.ok(exp.has(key(t.q, t.r)), 'mapped');
  }
  assert.ok(drainEvents(s).find((e) => e.type === 'ruin').revealed > 0);
  // without fog an old map would be useless, so it's treasure instead
  ({ s, tile, u } = ruinSetup('map', { fog: false }));
  const g3 = s.gold[0];
  moveUnit(s, u.id, tile.q, tile.r);
  assert.equal(s.gold[0], g3 + RUINS.kinds.treasure.gold);

  // recruits: a new warrior next to the explorer, replayed by the spawn event
  ({ s, tile, u } = ruinSetup('recruits'));
  const count = s.units.filter((x) => x.owner === 0).length;
  before = cloneState(s);
  moveUnit(s, u.id, tile.q, tile.r);
  const mine = s.units.filter((x) => x.owner === 0);
  assert.equal(mine.length, count + 1);
  const recruit = mine.find((x) => x.id === s.nextUnitId - 1);
  assert.equal(recruit.type, 'warrior');
  assert.equal(distance(recruit, tile), 1);
  assert.ok(!s.cities.some((c) => distance(c, recruit) === 0), 'not in a city');
  for (const e of drainEvents(s)) applyEvent(before, e);
  assert.deepEqual(snapshot(before), snapshot(s));
  // with no free tile around, treasure instead
  // (the unit is put straight onto the ruin, so the tile it came from doesn't count as free)
  ({ s, tile, u } = ruinSetup('recruits'));
  u.q = tile.q; u.r = tile.r;
  for (const n of neighbors(tile.q, tile.r)) {
    if (isPassable(s, n.q, n.r) && !unitAt(s, n.q, n.r)) spawnUnit(s, 'scout', 0, n.q, n.r);
  }
  const g4 = s.gold[0];
  const n4 = s.units.length;
  assert.equal(exploreRuin(s, u).kind, 'treasure');
  assert.equal(s.gold[0], g4 + RUINS.kinds.treasure.gold);
  assert.equal(s.units.length, n4);
  assert.doesNotThrow(() => JSON.stringify(s));
});

test('ancient ruins: a ruin looted in the fog stays on the map until seen, the AI goes for known ruins', () => {
  const { s, tile } = ruinSetup('treasure');
  // send the player's units away so the ruin is out of sight, then let an AI unit loot it
  s.units = s.units.filter((x) => x.owner !== 0);
  const far = s.cities[1];
  spawnUnit(s, 'warrior', 0, far.q, far.r); // the player needs a unit somewhere (sees only far away)
  s.current = 1;
  const n = neighbors(tile.q, tile.r).find((p) => isPassable(s, p.q, p.r) && !unitAt(s, p.q, p.r)
    && !visibleTiles(s, 0).has(key(p.q, p.r)));
  const ai = spawnUnit(s, 'scout', 1, n.q, n.r);
  ai.movesLeft = 3; ai.hasAttacked = false;
  updateExplored(s, 0);
  assert.ok(!visibleTiles(s, 0).has(key(tile.q, tile.r)), 'the ruin is out of the player\'s sight');
  assert.ok(goalsFor(s, ai).some((g) => g.ruin && g.q === tile.q && g.r === tile.r), 'the AI wants the ruin');
  assert.ok(moveUnit(s, ai.id, tile.q, tile.r));
  assert.deepEqual(tile.ruinGone, [1]);
  assert.ok(ruinBelieved(s, tile.q, tile.r, 0), 'the player still believes in the ruin');
  assert.ok(!ruinBelieved(s, tile.q, tile.r, 1));
  assert.ok(!logFor(s, 0).some((e) => /ruins/.test(e.msg)), 'the chronicle hides it');
  assert.ok(logFor(s, 1).some((e) => /ruins/.test(e.msg)));
  assert.ok(!goalsFor(s, ai).some((g) => g.ruin), 'a looted ruin is no goal any more');
  // when the player sees the tile again, they learn the ruin is gone
  s.current = 0;
  spawnUnit(s, 'warrior', 0, n.q, n.r); // the tile the AI scout came from is free again
  updateExplored(s, 0);
  assert.ok(!ruinBelieved(s, tile.q, tile.r, 0));
  assert.deepEqual(tile.ruinGone, [0, 1]);

  // migration from version 17: old maps have no ruins
  const old = createGame({ seed: 2 });
  old.version = 17;
  for (const t of Object.values(old.tiles)) delete t.ruin;
  const m = migrateState(old);
  assert.equal(m.version, STATE_VERSION);
  assert.ok(!Object.values(m.tiles).some((t) => t.ruin));
});

test('ancient ruins: AI armies loot ruins over a real game', () => {
  let looted = 0;
  for (const seed of [2, 6, 9]) {
    const s = createGame({ seed, happenings: false });
    const start = Object.values(s.tiles).filter((t) => t.ruin).length;
    for (let i = 0; i < 40 && s.winner === null; i++) {
      runAITurn(s);
      drainEvents(s);
      endTurn(s);
    }
    looted += start - Object.values(s.tiles).filter((t) => t.ruin).length;
    for (const t of Object.values(s.tiles)) if (t.ruinGone) assert.ok(!t.ruin && t.ruinGone.length >= 1);
  }
  assert.ok(looted >= 3, `only ${looted} ruins looted`);
});

test('auto-explore: a unit walks into the fog turn by turn until nothing reachable is left', () => {
  for (const seed of [31, 7]) {
    const s = createGame({ seed, size: 'medium', happenings: false });
    s.units = s.units.filter((u) => u.owner === 0);
    const u = s.units.find((x) => x.type === 'warrior');
    const t = exploreTarget(s, u);
    assert.ok(t && t.gain > 0, 'something to explore at the start');
    const known = exploredTiles(s, 0);
    for (let i = 1; i < t.path.length; i++) assert.equal(distance(t.path[i - 1], t.path[i]), 1);
    assert.ok(t.path.every((p) => known.has(key(p.q, p.r))), 'the route uses only explored tiles');
    assert.ok(canExplore(s, u));
    const foreign = new Set(s.cities.filter((c) => c.owner !== 0).map((c) => key(c.q, c.r)));
    let size = known.size;
    const from = { q: u.q, r: u.r };
    assert.equal(setExplore(s, u.id), 'moved');
    assert.ok(u.explore && (u.q !== from.q || u.r !== from.r), 'it walked right away');
    assert.equal(unitStatus(s, u), u.movesLeft > 0 ? 'ready' : 'marching');
    assert.ok(unitSummary(s, u).exploring);
    assert.ok(!canExplore(s, u), 'already exploring');
    let result = 'moved';
    let turns = 1;
    while (result !== 'done' && turns < 80) {
      endTurn(s); endTurn(s); // the AI has no units
      const out = runOrders(s, 0);
      assert.equal(out.length, 1);
      result = out[0].result;
      assert.notEqual(result, 'interrupted');
      assert.ok(!foreign.has(key(u.q, u.r)), 'never enters a foreign city');
      const now = exploredTiles(s, 0).size;
      assert.ok(now >= size);
      size = now;
      turns++;
    }
    assert.equal(result, 'done', `seed ${seed}: exploring ended`);
    assert.ok(!u.explore && exploreTarget(s, u) === null && !canExplore(s, u));
    assert.ok(exploredTiles(s, 0).size > Object.keys(s.tiles).length * 0.5, 'most of the map got explored');
    assert.ok(JSON.parse(JSON.stringify(s)));
  }
});

test('auto-explore: stops for enemies, cancelled by manual actions, ruins attract, no fog = nothing to do', () => {
  const base = createGame({ seed: 31, happenings: false });
  base.units = base.units.filter((x) => x.owner === 0);
  // an enemy in sight at the start of the turn stops the order without moving
  let s = cloneState(base);
  let u = s.units.find((x) => x.type === 'warrior');
  setExplore(s, u.id);
  assert.ok(u.explore);
  endTurn(s); endTurn(s);
  const spot = neighbors(u.q, u.r).find((n) => isPassable(s, n.q, n.r) && !unitAt(s, n.q, n.r));
  s.units.push({ id: 700, type: 'warrior', owner: 1, q: spot.q, r: spot.r, hp: 10, movesLeft: 0, hasAttacked: true, xp: 0 });
  const at = { q: u.q, r: u.r };
  assert.deepEqual(runOrders(s, 0), [{ unitId: u.id, result: 'interrupted' }]);
  assert.ok(!u.explore && u.q === at.q && u.r === at.r);
  // a manual move, fortify and cancelOrder end it
  s = cloneState(base);
  u = s.units.find((x) => x.type === 'warrior');
  setExplore(s, u.id);
  endTurn(s); endTurn(s);
  const [k] = reachable(s, u).keys();
  const [mq, mr] = k.split(',').map(Number);
  moveUnit(s, u.id, mq, mr);
  assert.ok(!u.explore);
  endTurn(s); endTurn(s);
  setExplore(s, u.id);
  cancelOrder(s, u.id);
  assert.ok(!u.explore);
  const w = s.units.find((x) => x.id !== u.id && canFortify(s, x));
  if (w) { w.explore = true; fortify(s, w.id); assert.ok(!w.explore); }
  // only the AI's turn: no explore for a unit of the other player
  s = cloneState(base);
  u = s.units.find((x) => x.type === 'warrior');
  endTurn(s);
  assert.ok(!canExplore(s, u) && setExplore(s, u.id) === null);
  // a believed ruin counts as RUINS bonus even when all land is known
  s = cloneState(base);
  u = s.units.find((x) => x.type === 'warrior');
  for (const t of Object.values(s.tiles)) delete t.ruin;
  s.explored[0] = Object.keys(s.tiles).sort();
  assert.equal(exploreTarget(s, u), null, 'nothing left without ruins');
  const ruinAt = [...reachable(s, u).keys()].map((x) => x.split(',').map(Number))
    .find(([q, r]) => !s.cities.some((c) => c.q === q && c.r === r));
  s.tiles[key(ruinAt[0], ruinAt[1])].ruin = true;
  const rt = exploreTarget(s, u);
  assert.ok(rt && rt.q === ruinAt[0] && rt.r === ruinAt[1] && rt.gain === EXPLORE.ruinBonus);
  assert.equal(setExplore(s, u.id), 'done', 'it loots the ruin and has nothing left');
  assert.ok(!s.tiles[key(ruinAt[0], ruinAt[1])].ruin);
  // without fog there is nothing to explore
  const nf = createGame({ seed: 31, fog: false });
  const nu = nf.units.find((x) => x.owner === 0);
  assert.equal(exploreTarget(nf, nu), null);
  assert.ok(!canExplore(nf, nu));
  // key X, migration
  assert.equal(keyAction('x').type, 'explore');
  assert.equal(keyAction('X').type, 'explore');
  const old = createGame({ seed: 2 });
  old.version = 18;
  assert.equal(migrateState(old).version, STATE_VERSION);
});

// A game where only the given unit stands on a resource of the enemy capital. raider = owner of the unit.
function pillageSetup(raider, kind, { type = 'warrior', seed = 5, fog = false } = {}) {
  const s = createGame({ seed, fog, happenings: false });
  s.units = [];
  const victimCap = s.cities.find((c) => c.capital && c.owner === 1 - raider);
  const tile = cityResources(s, victimCap).find((t) => t.resource === kind);
  assert.ok(tile, `no ${kind} at the capital`);
  s.current = raider;
  const u = spawnUnit(s, type, raider, tile.q, tile.r);
  u.movesLeft = 1; u.hasAttacked = false;
  drainEvents(s);
  return { s, u, tile, victimCap };
}

test('pillage: who can, gold, lost income and discount, the event replays, recovery after the owner\'s 4 turns', () => {
  // the player raids the AI's gold mine
  let { s, u, tile, victimCap } = pillageSetup(0, 'gold');
  const income = incomeOf(s, 1);
  const gold = s.gold[0];
  assert.ok(canPillage(s, u));
  const before = cloneState(s);
  const ev = pillage(s, u.id);
  assert.equal(ev.type, 'pillage');
  assert.equal(ev.victim, 1);
  assert.equal(s.gold[0], gold + PILLAGE.gold);
  assert.equal(u.movesLeft, 0);
  assert.ok(u.hasAttacked, 'the unit\'s turn is over');
  assert.ok(isPillaged(s, tile));
  assert.equal(incomeOf(s, 1), income - RESOURCES.gold.income);
  assert.equal(cityIncome(victimCap, s), cityIncome(victimCap, before) - RESOURCES.gold.income);
  assert.ok(!canPillage(s, u), 'not twice');
  assert.match(s.log.at(-1).msg, /pillaged gold mine near .* \(\+6 gold, out of use for 4 turns\)/);
  // replaying the event gives the same state
  const evs = drainEvents(s);
  for (const e of evs) applyEvent(before, e);
  assert.deepEqual(snapshot(before), snapshot(s));
  assert.equal(tileAt(before, tile.q, tile.r).pillagedUntil, tile.pillagedUntil);
  assert.equal(before.gold[0], s.gold[0]);
  assert.equal(getUnit(before, u.id).movesLeft, 0);
  assert.equal(isUndoableMove(cloneState(s), s, evs, 0), false);
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(s)));
  // the AI misses exactly PILLAGE.turns of its incomes, then the mine works again and the field is gone
  let missed = 0;
  for (let i = 0; i < 2 * (PILLAGE.turns + 2); i++) {
    const g = s.gold[1];
    endTurn(s);
    if (s.current !== 1) continue;
    const got = s.gold[1] - g;
    if (got === incomeOf(s, 1) && isPillaged(s, tile)) missed++;
    else assert.equal(got, income);
  }
  assert.equal(missed, PILLAGE.turns);
  assert.ok(!isPillaged(s, tile));
  assert.equal(tile.pillagedUntil, undefined);

  // the AI raids the player's horses: horsemen are no longer cheaper, the player misses its 4 turns too
  ({ s, u, tile, victimCap } = pillageSetup(1, 'horses'));
  const cheap = unitCost(s, victimCap, 'horseman');
  assert.ok(pillage(s, u.id));
  assert.equal(unitCost(s, victimCap, 'horseman'), cheap + RESOURCES.horses.discount.horseman);
  let pillagedTurns = 0;
  for (let i = 0; i < 2 * (PILLAGE.turns + 2); i++) {
    endTurn(s);
    if (s.current === 0 && isPillaged(s, tile)) {
      pillagedTurns++;
      assert.equal(pillageTurnsLeft(s, tile), PILLAGE.turns - pillagedTurns + 1);
    }
  }
  assert.equal(pillagedTurns, PILLAGE.turns);
  assert.equal(unitCost(s, victimCap, 'horseman'), cheap);
  // the enemy turn report tells the player
  ({ s, u, tile } = pillageSetup(1, 'gold'));
  const b2 = cloneState(s);
  pillage(s, u.id);
  const rep = turnReport(b2, drainEvents(s), 0);
  assert.equal(rep.pillaged, 1);
  assert.deepEqual(rep.spots, [{ q: tile.q, r: tile.r, kind: 'pillage' }]);
  assert.equal(reportText(rep), 'Enemy turn: A resource of yours was pillaged.');
  assert.ok(reportIsBad(rep));
  assert.equal(turnReport(b2, [], 0).pillaged, 0);

  // who can't: a scout, a unit that attacked or has no moves, not on the owner's turn, own or neutral land
  ({ s, u } = pillageSetup(0, 'gold', { type: 'scout' }));
  assert.ok(!canPillage(s, u));
  ({ s, u } = pillageSetup(0, 'gold'));
  u.hasAttacked = true;
  assert.ok(!canPillage(s, u));
  u.hasAttacked = false; u.movesLeft = 0;
  assert.ok(!canPillage(s, u));
  u.movesLeft = 1; s.current = 1;
  assert.equal(pillage(s, u.id), null);
  ({ s, u, victimCap } = pillageSetup(0, 'gold'));
  assert.ok(canPillage(s, u));
  victimCap.owner = 0;
  assert.ok(!canPillage(s, u), 'own territory');
  victimCap.owner = null;
  assert.ok(!canPillage(s, u), 'neutral territory');
  // a unit on a tile without a resource
  ({ s, u } = pillageSetup(0, 'gold'));
  const plain = Object.values(s.tiles).find((t) => !t.resource && isPassable(s, t.q, t.r) && territoryOwner(s, t.q, t.r) === 1 && !cityAt(s, t.q, t.r));
  u.q = plain.q; u.r = plain.r;
  assert.ok(!canPillage(s, u));
  // a fortified unit or one with an order loses it
  ({ s, u } = pillageSetup(0, 'gold'));
  u.fortified = true; u.goto = { q: 0, r: 0 };
  pillage(s, u.id);
  assert.ok(!u.fortified && !u.goto);

  // migration from version 19
  const old = createGame({ seed: 3 });
  old.version = 19;
  assert.equal(migrateState(old).version, STATE_VERSION);
});

test('pillage: the AI raids enemy resources it stands on or walks to, but not pillaged ones', () => {
  // an AI horseman standing on the player's gold mine with nothing to attack pillages it
  let { s, u, tile } = pillageSetup(1, 'gold');
  u.movesLeft = 4;
  runAITurn(s);
  assert.ok(isPillaged(s, tile), 'pillaged');
  assert.ok(drainEvents(s).some((e) => e.type === 'pillage' && e.unitId === u.id && e.gold === PILLAGE.gold));
  assert.ok(s.log.some((e) => /AI: Warrior pillaged/.test(e.msg)));
  // a horseman a few tiles away from a known enemy resource gets it as a goal, a pillaged one is not a goal
  ({ s, u, tile } = pillageSetup(1, 'gold', { type: 'horseman' }));
  const know = aiKnowledge(s, 1);
  const away = Object.values(s.tiles).find((t) => isPassable(s, t.q, t.r) && distance(t, tile) === 2 && !cityAt(s, t.q, t.r));
  u.q = away.q; u.r = away.r;
  assert.ok(pillageGoals(s, u, know).some((g) => g.q === tile.q && g.r === tile.r));
  assert.ok(goalsFor(s, u, know).some((g) => g.pillage));
  tile.pillagedUntil = s.turn + 2;
  assert.ok(!pillageGoals(s, u, know).some((g) => g.q === tile.q && g.r === tile.r));
  // own resources and far ones are never goals
  for (const g of pillageGoals(s, u, know)) {
    assert.ok(distance(g, u) <= PILLAGE_DETOUR);
    assert.equal(territoryOwner(s, g.q, g.r), 0);
  }
  // real games stay consistent: replays still match and pillaged tiles always recover
  for (const seed of [2, 6]) {
    const g = createGame({ seed, happenings: false });
    for (let i = 0; i < 80 && g.winner === null; i++) {
      runAITurn(g); // both sides played by the AI
      endTurn(g);
      for (const t of Object.values(g.tiles)) {
        if (t.pillagedUntil !== undefined) assert.ok(t.pillagedUntil - g.turn <= PILLAGE.turns + 1);
      }
    }
  }
});

// The AI pillaged the player's resource; a player unit then stands on it, ready to repair.
function repairSetup(kind = 'gold', { type = 'warrior' } = {}) {
  const { s, u: raider, tile, victimCap } = pillageSetup(1, kind);
  assert.ok(pillage(s, raider.id));
  s.units = s.units.filter((x) => x.id !== raider.id);
  drainEvents(s);
  s.current = 0;
  const u = spawnUnit(s, type, 0, tile.q, tile.r);
  u.movesLeft = 1; u.hasAttacked = false;
  drainEvents(s);
  return { s, u, tile, cap: victimCap };
}

test('repair: an own unit rebuilds a pillaged resource for gold, income returns at once, the event replays', () => {
  let { s, u, tile, cap } = repairSetup('gold');
  const income = incomeOf(s, 0);
  const gold = s.gold[0];
  assert.ok(isPillaged(s, tile));
  assert.ok(canRepair(s, u));
  const before = cloneState(s);
  const ev = repair(s, u.id);
  assert.equal(ev.type, 'repair');
  assert.equal(ev.gold, REPAIR.gold);
  assert.ok(ev.saved >= 1);
  assert.equal(s.gold[0], gold - REPAIR.gold);
  assert.ok(!isPillaged(s, tile));
  assert.equal(tile.pillagedUntil, undefined, 'the field is gone');
  assert.equal(incomeOf(s, 0), income + RESOURCES.gold.income);
  assert.equal(u.movesLeft, 0);
  assert.ok(u.hasAttacked, 'the unit\'s turn is over');
  assert.ok(!canRepair(s, u), 'not twice');
  assert.match(s.log.at(-1).msg, /^You: Warrior repaired gold mine near .* \(−3 gold\)$/);
  const evs = drainEvents(s);
  for (const e of evs) applyEvent(before, e);
  assert.deepEqual(snapshot(before), snapshot(s));
  assert.equal(before.gold[0], s.gold[0]);
  assert.equal(isUndoableMove(cloneState(s), s, evs, 0), false);
  assert.equal(soundFor(ev, 0), 'repair');
  assert.ok(SOUND_NAMES.includes('repair'));
  // a repaired resource can be pillaged again
  s.current = 1;
  s.units = s.units.filter((x) => x.id !== u.id);
  const again = spawnUnit(s, 'warrior', 1, tile.q, tile.r);
  again.movesLeft = 1; again.hasAttacked = false;
  assert.ok(canPillage(s, again));
  // horses: the discount is back right away; scouts can repair too
  ({ s, u, cap } = repairSetup('horses', { type: 'scout' }));
  const dear = unitCost(s, cap, 'horseman');
  assert.ok(repair(s, u.id));
  assert.equal(unitCost(s, cap, 'horseman'), dear - RESOURCES.horses.discount.horseman);

  // who can't: no gold, attacked, no moves, not own turn, a working resource, enemy territory
  ({ s, u } = repairSetup());
  s.gold[0] = REPAIR.gold - 1;
  assert.ok(!canRepair(s, u));
  assert.ok(canRepair(s, u, { affordable: false }), 'the button shows, disabled');
  assert.equal(repair(s, u.id), null);
  s.gold[0] = 50;
  u.hasAttacked = true;
  assert.ok(!canRepair(s, u));
  u.hasAttacked = false; u.movesLeft = 0;
  assert.ok(!canRepair(s, u));
  u.movesLeft = 1; s.current = 1;
  assert.ok(!canRepair(s, u));
  s.current = 0;
  ({ s, u, tile, cap } = repairSetup());
  delete tile.pillagedUntil;
  assert.ok(!canRepair(s, u), 'nothing to repair');
  ({ s, u, tile, cap } = repairSetup());
  cap.owner = 1; // the land now belongs to the enemy
  assert.ok(!canRepair(s, u), 'not in enemy territory');
  // orders and fortification are dropped
  ({ s, u } = repairSetup());
  u.fortified = true; u.goto = { q: 0, r: 0 };
  repair(s, u.id);
  assert.ok(!u.fortified && !u.goto);
  // key R
  assert.deepEqual(keyAction('r'), { type: 'repair' });
  assert.deepEqual(keyAction('R'), { type: 'repair' });
});

test('repair: the AI walks back to its pillaged resources and repairs them', () => {
  // the player pillages the AI's gold mine; an AI warrior standing on it repairs it on its turn
  let { s, u: raider, tile } = pillageSetup(0, 'gold');
  assert.ok(pillage(s, raider.id));
  s.units = s.units.filter((x) => x.id !== raider.id);
  endTurn(s);
  assert.equal(s.current, 1);
  const w = spawnUnit(s, 'warrior', 1, tile.q, tile.r);
  w.movesLeft = 1; w.hasAttacked = false;
  s.gold[1] = 40;
  drainEvents(s);
  runAITurn(s);
  assert.ok(!isPillaged(s, tile), 'repaired');
  assert.ok(drainEvents(s).some((e) => e.type === 'repair' && e.unitId === w.id));
  // a unit nearby gets it as a goal; a resource that recovers next round, a far one or an enemy one does not
  ({ s, u: raider, tile } = pillageSetup(0, 'gold'));
  pillage(s, raider.id);
  s.current = 1;
  const away = Object.values(s.tiles).find((t) => isPassable(s, t.q, t.r) && distance(t, tile) === 2 && !cityAt(s, t.q, t.r));
  const h = spawnUnit(s, 'horseman', 1, away.q, away.r);
  assert.ok(repairGoals(s, h).some((g) => g.q === tile.q && g.r === tile.r && g.repair));
  assert.ok(goalsFor(s, h, aiKnowledge(s, 1)).some((g) => g.repair));
  for (const g of repairGoals(s, h)) {
    assert.ok(distance(g, h) <= REPAIR_DETOUR);
    assert.equal(territoryOwner(s, g.q, g.r), 1);
  }
  tile.pillagedUntil = s.turn + 1;
  assert.ok(!repairGoals(s, h).some((g) => g.q === tile.q && g.r === tile.r), 'recovers soon anyway');
  // real AI-vs-AI games: pillaged resources get repaired now and then, the state stays consistent
  let repairs = 0;
  for (const seed of [2, 6, 9]) {
    const g = createGame({ seed, happenings: false });
    for (let i = 0; i < 80 && g.winner === null; i++) {
      runAITurn(g);
      repairs += drainEvents(g).filter((e) => e.type === 'repair').length;
      endTurn(g);
      assert.ok(g.gold.every((x) => x >= 0));
    }
  }
  assert.ok(repairs >= 1, 'the AI repairs in real games');
});

// A game without units, happenings or fog, with the player's capital and a free tile 3 steps away.
function rallySetup() {
  const s = createGame({ seed: 3, fog: false, happenings: false });
  s.units = [];
  const cap = s.cities.find((c) => c.owner === 0 && c.capital);
  const spot = Object.values(s.tiles).find((t) => distance(t, cap) === 3 && !cityAt(s, t.q, t.r)
    && rallyPath(s, cap, t.q, t.r) && neighbors(t.q, t.r).every((n) => !tileAt(s, n.q, n.r) || !cityAt(s, n.q, n.r)));
  s.gold[0] = 200;
  return { s, cap, spot };
}

// Ends the player's turn, lets the AI pass, and walks the player's orders. Returns the runOrders result.
function passRound(s) {
  endTurn(s);
  endTurn(s);
  return runOrders(s, 0);
}

test('rally points: recruits get a move order to the flag, walk there, a taken flag sends them next to it', () => {
  const { s, cap, spot } = rallySetup();
  assert.ok(spot, 'a test tile exists');
  // where a flag may stand
  assert.ok(!canRally(s, cap, cap.q, cap.r), 'not on the city itself');
  const rock = Object.values(s.tiles).find((t) => !isPassable(s, t.q, t.r));
  assert.ok(!canRally(s, cap, rock.q, rock.r), 'not on impassable terrain');
  const enemyCap = s.cities.find((c) => c.owner === 1);
  assert.ok(!canRally(s, enemyCap, spot.q, spot.r), 'not for a foreign city');
  assert.equal(rallyTarget(s, cap), null, 'no flag yet');
  assert.ok(setRally(s, cap.id, spot.q, spot.r));
  assert.deepEqual(cap.rally, { q: spot.q, r: spot.r });
  const path = rallyPath(s, cap, spot.q, spot.r);
  assert.deepEqual(path[0], { q: cap.q, r: cap.r });
  assert.deepEqual(path.at(-1), { q: spot.q, r: spot.r });
  for (let i = 1; i < path.length; i++) assert.equal(distance(path[i - 1], path[i]), 1);

  // a recruit gets the order; the spawn event carries it
  const before = cloneState(s);
  assert.ok(buyUnit(s, cap.id, 'warrior'));
  const u = unitAt(s, cap.q, cap.r);
  assert.deepEqual(u.goto, { q: spot.q, r: spot.r });
  assert.equal(unitStatus(s, u), 'marching');
  for (const e of drainEvents(s)) applyEvent(before, e);
  assert.deepEqual(getUnit(before, u.id).goto, u.goto);
  // it walks off at the start of the next turns and arrives
  let arrived = false;
  for (let i = 0; i < 6 && !arrived; i++) {
    const res = passRound(s);
    arrived = res.some((o) => o.unitId === u.id && o.result === 'arrived');
  }
  assert.ok(arrived, 'the recruit reached the flag');
  assert.deepEqual({ q: u.q, r: u.r }, { q: spot.q, r: spot.r });
  assert.equal(u.goto, undefined);
  // the flag is taken: the next recruit heads for a free tile next to it
  assert.ok(buyUnit(s, cap.id, 'archer'));
  const v = unitAt(s, cap.q, cap.r);
  assert.ok(v.goto);
  assert.equal(distance(v.goto, spot), 1);
  assert.ok(!unitAt(s, v.goto.q, v.goto.r));
  assert.deepEqual(rallyTarget(s, cap), v.goto, 'deterministic');
  // saving keeps the flag; a broken flag is rejected on import
  const loaded = migrateState(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(loaded.cities.find((c) => c.id === cap.id).rally, cap.rally);
  assert.equal(stateProblem(loaded), null);
  loaded.cities.find((c) => c.id === cap.id).rally = { q: 999, r: 999 };
  assert.match(stateProblem(loaded), /rally/);
  // removing the flag: recruits stay put
  passRound(s);
  assert.ok(clearRally(s, cap.id));
  assert.equal(cap.rally, undefined);
  assert.ok(!clearRally(s, cap.id), 'nothing to remove');
  assert.ok(buyUnit(s, cap.id, 'warrior'));
  assert.equal(unitAt(s, cap.q, cap.r).goto, undefined);
  // only the current player may set or clear flags
  s.current = 1;
  assert.ok(!setRally(s, cap.id, spot.q, spot.r));
  s.current = 0;
  // an old save (version 20) migrates without flags
  const old = JSON.parse(JSON.stringify(createGame({ seed: 5 })));
  old.version = 20;
  assert.equal(migrateState(old).version, STATE_VERSION);
  assert.ok(migrateState(JSON.parse(JSON.stringify({ ...old, version: 20 }))).cities.every((c) => c.rally === undefined));
});

test('rally points: a captured city loses its flag (also when replayed), unexplored land can\'t be picked, key G', () => {
  const { s, cap, spot } = rallySetup();
  assert.ok(setRally(s, cap.id, spot.q, spot.r));
  const n = neighbors(cap.q, cap.r).find((t) => isPassable(s, t.q, t.r));
  s.current = 1;
  const raider = spawnUnit(s, 'warrior', 1, n.q, n.r);
  raider.movesLeft = 2; raider.hasAttacked = false;
  drainEvents(s);
  const before = cloneState(s);
  assert.ok(moveUnit(s, raider.id, cap.q, cap.r));
  assert.equal(cap.owner, 1);
  assert.equal(cap.rally, undefined, 'the flag is gone');
  for (const e of drainEvents(s)) applyEvent(before, e);
  assert.equal(before.cities.find((c) => c.id === cap.id).rally, undefined, 'replay removes it too');

  // with fog: the flag only goes on explored land; picking on the map
  const f = createGame({ seed: 3 });
  const fcap = f.cities.find((c) => c.owner === 0 && c.capital);
  const explored = exploredTiles(f, 0);
  const dark = Object.values(f.tiles).find((t) => !explored.has(key(t.q, t.r)) && isPassable(f, t.q, t.r));
  assert.ok(!canRally(f, fcap, dark.q, dark.r), 'not in the unexplored fog');
  const near = [...explored].map((k) => tileAt(f, ...k.split(',').map(Number)))
    .find((t) => isPassable(f, t.q, t.r) && distance(t, fcap) === 2 && !cityAt(f, t.q, t.r));
  assert.deepEqual(decideTap(f, { selectedId: null, pending: null, rallyCityId: fcap.id }, near.q, near.r),
    { type: 'rally', cityId: fcap.id, q: near.q, r: near.r });
  assert.deepEqual(decideTap(f, { selectedId: null, pending: null, rallyCityId: fcap.id }, dark.q, dark.r), { type: 'rallyCancel' });
  assert.deepEqual(decideTap(f, { selectedId: null, pending: null, rallyCityId: fcap.id }, fcap.q, fcap.r), { type: 'rallyCancel' });
  // without picking, a tap selects as before
  assert.equal(decideTap(f, { selectedId: null, pending: null }, fcap.q, fcap.r).type, 'select');
  assert.equal(keyAction('g').type, 'rally');
  assert.equal(keyAction('G').type, 'rally');
});

// Two own units on neighbouring plains tiles away from cities (no fog), all other units removed.
function swapSetup(seed = 5) {
  const s = createGame({ seed, fog: false });
  s.units = [];
  const plain = (t) => t && t.terrain === 'plains' && !cityAt(s, t.q, t.r) && !t.ruin
    && s.cities.every((c) => distance(c, t) >= 3);
  let a = null;
  let b = null;
  let foe = null; // a free tile next to a, on the far side from b (for an enemy at the front)
  for (const t of Object.values(s.tiles)) {
    if (!plain(t)) continue;
    const near = neighbors(t.q, t.r).map((x) => tileAt(s, x.q, x.r));
    const n = near.find((x) => plain(x) && !riverBetween(s, t, x) && !(t.road && x.road));
    const f = n && near.find((x) => x && isPassable(s, x.q, x.r) && !cityAt(s, x.q, x.r) && distance(x, n) === 2);
    if (f) { a = t; b = n; foe = f; break; }
  }
  const front = spawnUnit(s, 'warrior', 0, a.q, a.r);
  const back = spawnUnit(s, 'spearman', 0, b.q, b.r);
  for (const u of [front, back]) { u.movesLeft = unitMove(s, u); u.hasAttacked = false; }
  drainEvents(s);
  return { s, a, b, foe, front, back };
}

test('swap places: neighbours trade tiles, pay a step, orders end, the events replay and undo works', () => {
  const { s, a, b, front, back } = swapSetup();
  front.fortified = false;
  back.goto = { q: 0, r: 0 };
  assert.ok(canSwap(s, front, back));
  assert.deepEqual(swapPartners(s, front).map((u) => u.id), [back.id]);
  const before = cloneState(s);
  const fm = front.movesLeft;
  const bm = back.movesLeft;
  assert.ok(swapUnits(s, front.id, back.id));
  assert.deepEqual([front.q, front.r], [b.q, b.r]);
  assert.deepEqual([back.q, back.r], [a.q, a.r]);
  assert.equal(front.movesLeft, fm - stepCost(s, a, b, front));
  assert.equal(back.movesLeft, bm - stepCost(s, b, a, back));
  assert.ok(front.moved && back.moved);
  assert.equal(back.goto, undefined, 'a swap cancels a move order');
  assert.match(s.log.at(-1).msg, /^You: Warrior and Spearman swapped places$/);
  const evs = drainEvents(s);
  assert.equal(evs.length, 2);
  assert.ok(evs.every((e) => e.type === 'move' && e.path.length === 2));
  const replay = cloneState(before);
  for (const e of evs) applyEvent(replay, e);
  assert.deepEqual(snapshot(replay), snapshot(s));
  assert.ok(isUndoableMove(before, s, evs, 0), 'a swap that reveals nothing can be undone');
  // a plain pair of moves is not a swap
  assert.equal(isUndoableMove(before, s, evs.map(({ swap, ...e }) => e), 0), false);

  // fortified units leave their fortification; one move point left is enough even for a costly tile
  const t2 = swapSetup();
  t2.front.fortified = true;
  t2.front.movesLeft = 0.5;
  assert.ok(swapUnits(t2.s, t2.front.id, t2.back.id));
  assert.equal(t2.front.fortified, undefined);
  assert.equal(t2.front.movesLeft, 0);
});

test('swap places: who can\'t, picking on the map, key S, the AI relieves a wounded unit at the front', () => {
  const { s, a, b, front, back } = swapSetup();
  const cases = [
    ['no moves', () => { getUnit(s, back.id).movesLeft = 0; }],
    ['attacked', () => { getUnit(s, front.id).hasAttacked = true; }],
    ['not neighbours', () => { getUnit(s, back.id).q += 5; }],
    ['enemy unit', () => { getUnit(s, back.id).owner = 1; }],
    ['not own turn', () => { s.current = 1; }],
    ['game over', () => { s.winner = 1; }],
  ];
  for (const [why, spoil] of cases) {
    const keep = cloneState(s);
    spoil();
    assert.ok(!canSwap(s, getUnit(s, front.id), getUnit(s, back.id)), why);
    assert.ok(!swapUnits(s, front.id, back.id), why);
    Object.assign(s, keep);
  }
  assert.ok(!canSwap(s, front, front), 'not with itself');
  assert.ok(canSwap(s, getUnit(s, front.id), getUnit(s, back.id)), 'state restored');
  s.units = [getUnit(s, front.id), getUnit(s, back.id)];
  Object.assign(front, s.units[0]); Object.assign(back, s.units[1]);
  s.units = [front, back];

  // picking: a tap on the partner swaps, anything else cancels
  assert.deepEqual(decideTap(s, { selectedId: front.id, pending: null, swapUnitId: front.id, confirm: true }, b.q, b.r),
    { type: 'swap', unitId: front.id, otherId: back.id });
  assert.deepEqual(decideTap(s, { selectedId: front.id, pending: null, swapUnitId: front.id }, a.q, a.r), { type: 'swapCancel' });
  const empty = neighbors(a.q, a.r).find((t) => isPassable(s, t.q, t.r) && !unitAt(s, t.q, t.r));
  assert.deepEqual(decideTap(s, { selectedId: front.id, pending: null, swapUnitId: front.id }, empty.q, empty.r), { type: 'swapCancel' });
  // without picking, a tap on an own neighbour still selects it
  assert.equal(decideTap(s, { selectedId: front.id, pending: null }, b.q, b.r).type, 'select');
  assert.equal(keyAction('s').type, 'swap');
  assert.equal(keyAction('S').type, 'swap');

  // AI: a wounded warrior next to an enemy swaps with a healthy spearman behind it
  const ai = swapSetup();
  ai.s.current = 1;
  for (const u of [ai.front, ai.back]) u.owner = 1;
  ai.front.hp = 2;
  spawnUnit(ai.s, 'warrior', 0, ai.foe.q, ai.foe.r);
  const know = aiKnowledge(ai.s, 1);
  // not when the partner is hurt too, or holds a city as garrison
  ai.back.hp = Math.floor(UNIT_TYPES.spearman.hp * RELIEF_MIN_HP) - 1;
  assert.equal(relieveWounded(ai.s, ai.front, know), null);
  ai.back.hp = UNIT_TYPES.spearman.hp;
  assert.equal(relieveWounded(ai.s, ai.front, know, new Map([[ai.back.id, {}]])), null);
  assert.equal(relieveWounded(ai.s, ai.front, know).id, ai.back.id);
  assert.deepEqual([ai.back.q, ai.back.r], [ai.a.q, ai.a.r], 'the fresh spearman holds the front');
  assert.deepEqual([ai.front.q, ai.front.r], [ai.b.q, ai.b.r]);
  // no enemy next to it = no reason to swap
  const calm = swapSetup();
  calm.s.current = 1;
  for (const u of [calm.front, calm.back]) u.owner = 1;
  calm.front.hp = 2;
  assert.equal(relieveWounded(calm.s, calm.front, aiKnowledge(calm.s, 1)), null);
});

// A roadless plains tile in the player's territory, two tiles from its capital, with a player warrior on it.
function roadSetup(seed = 3) {
  const s = createGame({ seed, fog: false });
  const cap = s.cities.find((c) => c.capital && c.owner === 0);
  s.units = s.units.filter((u) => u.owner !== 0);
  const tile = Object.values(s.tiles).find((t) => t.terrain === 'plains' && !t.road && !t.ruin && !cityAt(s, t.q, t.r)
    && territoryOwner(s, t.q, t.r) === 0 && distance(t, cap) === 1);
  const u = spawnUnit(s, 'warrior', 0, tile.q, tile.r);
  u.movesLeft = 2; u.hasAttacked = false;
  s.gold[0] = 30;
  drainEvents(s);
  return { s, cap, tile, u };
}

test('road building: a unit lays a road in own territory, it costs gold and the turn, moves get cheaper, the event replays', () => {
  const { s, cap, tile, u } = roadSetup();
  assert.ok(canBuildRoad(s, u));
  assert.ok(roadLinks(s, tile.q, tile.r) >= 1, 'next to the capital');
  const before = cloneState(s);
  const ev = buildRoad(s, u.id);
  assert.equal(ev.type, 'road');
  assert.equal(s.gold[0], 30 - ROADWORK.gold);
  assert.ok(tile.road && tile.roadBuilt);
  assert.equal(u.movesLeft, 0);
  assert.ok(u.hasAttacked, 'the unit\'s turn is over');
  assert.ok(!canBuildRoad(s, u), 'not twice');
  assert.match(s.log.at(-1).msg, /^You: Warrior built a road \(−4 gold\)$/);
  // capitals sit on the road network, so stepping between them is now a road step
  if (tileAt(s, cap.q, cap.r).road) assert.equal(stepCost(s, cap, tile), 0.5);
  const evs = drainEvents(s);
  for (const e of evs) applyEvent(before, e);
  assert.deepEqual(snapshot(before), snapshot(s));
  assert.equal(before.gold[0], s.gold[0]);
  assert.ok(tileAt(before, tile.q, tile.r).roadBuilt);
  assert.equal(isUndoableMove(cloneState(s), s, evs, 0), false);
  assert.equal(soundFor(ev, 0), 'build');
  // saves keep the road, an old save migrates
  const back = importGame(exportGame(s, GAME_VERSION));
  assert.ok(back.state.tiles[key(tile.q, tile.r)].roadBuilt);
  const old = cloneState(s);
  old.version = 21;
  assert.equal(migrateState(old).version, STATE_VERSION);
  assert.equal(keyAction('b').type, 'road');
  assert.equal(keyAction('B').type, 'road');
});

test('road building: who can\'t, and the AI extends its network with spare gold', () => {
  const t = roadSetup();
  const cases = [
    ['no gold', (s) => { s.gold[0] = ROADWORK.gold - 1; }],
    ['attacked', (s, u) => { u.hasAttacked = true; }],
    ['no moves', (s, u) => { u.movesLeft = 0; }],
    ['not own turn', (s) => { s.current = 1; }],
    ['already a road', (s, u) => { tileAt(s, u.q, u.r).road = true; }],
    ['in a city', (s, u) => { const c = s.cities.find((x) => x.owner === 0); u.q = c.q; u.r = c.r; }],
    ['outside own territory', (s, u) => {
      const far = Object.values(s.tiles).find((x) => isPassable(s, x.q, x.r) && !x.road && !cityAt(s, x.q, x.r) && territoryOwner(s, x.q, x.r) !== 0);
      u.q = far.q; u.r = far.r;
    }],
  ];
  for (const [why, spoil] of cases) {
    const s = cloneState(t.s);
    const u = getUnit(s, t.u.id);
    spoil(s, u);
    assert.ok(!canBuildRoad(s, u), why);
    assert.equal(buildRoad(s, u.id), null, why);
  }
  // short of gold the button still shows (disabled)
  const poor = cloneState(t.s);
  poor.gold[0] = 1;
  assert.ok(canBuildRoad(poor, getUnit(poor, t.u.id), { affordable: false }));

  // AI: an idle unit next to its capital builds a road only with spare gold and no enemy close by
  const s = createGame({ seed: 3, fog: false });
  s.current = 1;
  const cap = s.cities.find((c) => c.capital && c.owner === 1);
  s.units = [];
  const tile = Object.values(s.tiles).find((x) => isPassable(s, x.q, x.r) && !x.road && !x.ruin && !cityAt(s, x.q, x.r)
    && territoryOwner(s, x.q, x.r) === 1 && distance(x, cap) === 1);
  const w = spawnUnit(s, 'warrior', 1, tile.q, tile.r);
  w.movesLeft = 2; w.hasAttacked = false;
  s.gold[1] = ROADWORK.aiReserve + ROADWORK.gold - 1;
  assert.equal(layRoad(s, 1), null, 'keeps its reserve');
  s.gold[1] += 1;
  const foe = neighbors(tile.q, tile.r).find((n) => isPassable(s, n.q, n.r) && !cityAt(s, n.q, n.r));
  const enemy = spawnUnit(s, 'warrior', 0, foe.q, foe.r);
  assert.equal(layRoad(s, 1), null, 'not with an enemy next to it');
  s.units = s.units.filter((x) => x.id !== enemy.id);
  assert.equal(layRoad(s, 1).type, 'road');
  assert.ok(tile.road);
  assert.equal(s.gold[1], ROADWORK.aiReserve);
  // AI-vs-AI games build some roads, always in their own territory and never go into debt
  let roads = 0;
  for (const seed of [7, 10]) {
    const g = createGame({ seed });
    for (let i = 0; i < 80 && g.winner === null; i++) {
      runAITurn(g);
      for (const e of drainEvents(g).filter((x) => x.type === 'road')) {
        roads++;
        assert.ok(g.gold[e.player] >= ROADWORK.aiReserve);
      }
      if (g.winner === null) endTurn(g);
      drainEvents(g);
    }
  }
  assert.ok(roads >= 1, `roads built: ${roads}`);
});

// duel() with the enemy moved out of the sentry radius (to a free passable tile).
function farDuel(seed) {
  const d = duel(seed);
  const far = Object.values(d.s.tiles).find((t) => isPassable(d.s, t.q, t.r) && distance(t, d.me) > SENTRY.radius + 2
    && !unitAt(d.s, t.q, t.r) && !d.s.cities.some((c) => c.q === t.q && c.r === t.r));
  d.foe.q = far.q; d.foe.r = far.r;
  return d;
}

test('sentry: a unit on watch is skipped by Tab and wakes when an enemy comes near', () => {
  const { s, me, foe } = farDuel(6);
  assert.ok(canSentry(s, me));
  assert.equal(sentry(s, me.id), 'watch', 'a healthy unit keeps watch');
  assert.equal(me.movesLeft, 2, 'going on watch costs no moves');
  assert.equal(sentry(s, me.id), null, 'not twice');
  assert.equal(unitStatus(s, me), 'sentry');
  assert.deepEqual(activeUnits(s, 0), [], 'Tab and the end-turn reminder skip it');
  assert.equal(nextActiveUnit(s, 0, null), null);
  assert.equal(armyOverview(s, 0).counts.sentry, 1);
  assert.equal(unitSummary(s, me).sentry, 'watch');
  assert.ok(SENTRY_TEXT.watch && SENTRY_TEXT.heal);
  assert.deepEqual(drainEvents(s), [], 'nothing to animate');
  // quiet turns: it stays on watch
  endTurn(s); endTurn(s);
  assert.deepEqual(runOrders(s, 0), []);
  assert.equal(me.sentry, 'watch');
  // an enemy walks next to it: at the start of the turn it wakes up and counts as ready again
  endTurn(s);
  const n = neighbors(me.q, me.r).find((p) => isPassable(s, p.q, p.r) && !unitAt(s, p.q, p.r));
  foe.q = n.q; foe.r = n.r;
  endTurn(s);
  assert.deepEqual(runOrders(s, 0), [{ unitId: me.id, result: 'alert' }]);
  assert.ok(!me.sentry);
  assert.deepEqual(activeUnits(s, 0).map((u) => u.id), [me.id]);
  // keyboard
  assert.equal(keyAction('w').type, 'sentry');
  assert.equal(keyAction('W').type, 'sentry');
});

test('sentry: a wounded unit rests until healed; any order or action wakes it; rules and saves', () => {
  const { s, me } = farDuel(6);
  me.hp = UNIT_TYPES.warrior.hp - 1;
  assert.equal(sentry(s, me.id), 'heal', 'a wounded unit rests until healed');
  endTurn(s); endTurn(s); // resting heals at least 1
  assert.equal(me.hp, UNIT_TYPES.warrior.hp);
  assert.deepEqual(checkSentries(s, 0), [{ unitId: me.id, result: 'healed' }]);
  assert.ok(!me.sentry);
  // a far enemy doesn't wake a sentry, a wounded one that is not yet healed keeps resting
  me.hp = 2;
  sentry(s, me.id);
  assert.deepEqual(checkSentries(s, 0), []);
  // actions wake it: move, attack, fortify, move order, cancel (the "Wake up" button)
  const wakers = [
    ['move', (d) => { const [k] = reachable(d.s, d.me).keys(); const [q, r] = k.split(',').map(Number); assert.ok(moveUnit(d.s, d.me.id, q, r)); }],
    ['attack', (d) => assert.ok(attack(d.s, d.me.id, d.foe.id))],
    ['fortify', (d) => assert.ok(fortify(d.s, d.me.id))],
    ['cancel', (d) => cancelOrder(d.s, d.me.id)],
  ];
  for (const [name, act] of wakers) {
    const d = duel(6);
    sentry(d.s, d.me.id);
    act(d);
    assert.ok(!d.me.sentry, `${name} wakes the unit`);
  }
  const d = farDuel(6);
  sentry(d.s, d.me.id);
  const goal = Object.values(d.s.tiles).find((t) => planRoute(d.s, d.me, t.q, t.r) && distance(t, d.me) >= 4);
  assert.ok(setOrder(d.s, d.me.id, goal.q, goal.r));
  assert.ok(!d.me.sentry && d.me.goto, 'a move order wakes it');
  // going on watch cancels a move order; replaying a move clears the flag on the copy too
  const e = farDuel(6);
  e.me.goto = { q: goal.q, r: goal.r };
  sentry(e.s, e.me.id);
  assert.ok(!e.me.goto);
  const copy = cloneState(e.s);
  const [k] = reachable(e.s, e.me).keys();
  const [q, r] = k.split(',').map(Number);
  moveUnit(e.s, e.me.id, q, r);
  for (const ev of drainEvents(e.s)) applyEvent(copy, ev);
  assert.ok(!getUnit(copy, e.me.id).sentry);
  // who can't: the enemy's unit, a fortified unit, after the game ended
  const f = farDuel(6);
  assert.ok(!canSentry(f.s, f.foe), 'not the other player\'s unit');
  f.me.fortified = true;
  assert.ok(!canSentry(f.s, f.me), 'a fortified unit already sleeps');
  const g = farDuel(6);
  g.s.winner = 1;
  assert.ok(!canSentry(g.s, g.me));
  // saves keep it, a bad value is rejected, an old save migrates
  const h = farDuel(6);
  sentry(h.s, h.me.id);
  const back = importGame(exportGame(h.s, GAME_VERSION));
  assert.equal(back.state.units.find((u) => u.id === h.me.id).sentry, 'watch');
  h.me.sentry = 'nap';
  assert.match(stateProblem(h.s), /watch order/);
  const old = createGame({ seed: 2 });
  old.version = 22;
  assert.equal(migrateState(old).version, STATE_VERSION);
});

// Player 0's capital with walls and two free neighbour tiles for enemy units (no other units on the map).
function wallSetup(seed = 4, fog = false) {
  const s = createGame({ seed, fog });
  s.units = [];
  const city = s.cities.find((c) => c.owner === 0 && c.capital);
  city.buildings = ['walls'];
  const [n1, n2] = neighbors(city.q, city.r).filter((p) => isPassable(s, p.q, p.r) && !cityAt(s, p.q, p.r));
  return { s, city, n1, n2 };
}

test('wall volley: a walled city shoots the weakest adjacent enemy at the end of its owner\'s turn', () => {
  const { s, city, n1, n2 } = wallSetup();
  const strong = spawnUnit(s, 'warrior', 1, n1.q, n1.r);
  const weak = spawnUnit(s, 'horseman', 1, n2.q, n2.r);
  weak.hp = 5;
  drainEvents(s);
  assert.equal(volleyTarget(s, city).id, weak.id, 'the weakest first');
  const before = cloneState(s);
  endTurn(s);
  assert.equal(weak.hp, 5 - VOLLEY.damage);
  assert.equal(strong.hp, UNIT_TYPES.warrior.hp, 'one shot per city');
  const evs = drainEvents(s).filter((e) => e.type === 'volley');
  assert.equal(evs.length, 1);
  assert.deepEqual({ ...evs[0] }, { type: 'volley', cityId: city.id, player: 0, unitId: weak.id, victim: 1, damage: VOLLEY.damage, hp: 3, q: n2.q, r: n2.r });
  assert.equal(soundFor(evs[0], 0), 'hit');
  assert.match(s.log.at(-1).msg, /walls of .* hit Horseman \(−2\)/);
  // replay gives the same HP, the victim's turn report counts it as wounded
  for (const e of evs) applyEvent(before, e);
  assert.equal(getUnit(before, weak.id).hp, weak.hp);
  const rep = turnReport(cloneState(s), evs, 1);
  assert.equal(rep.wounded, 1);
  assert.equal(turnReport(cloneState(s), evs, 0).wounded, 0, 'the shooter is not wounded');
  // the AI ending its turn: player 0's walls stay silent
  assert.equal(s.current, 1);
  endTurn(s);
  assert.ok(weak.hp >= 3, 'not shot (resting may heal it)');
  assert.deepEqual(drainEvents(s).filter((e) => e.type === 'volley'), []);
  // never below minHp: 2 HP takes 1, a unit at minHp is skipped for the next one
  weak.hp = 2;
  cityVolleys(s, 0);
  assert.equal(weak.hp, VOLLEY.minHp);
  cityVolleys(s, 0);
  assert.equal(weak.hp, VOLLEY.minHp, 'walls never finish a unit');
  assert.equal(strong.hp, UNIT_TYPES.warrior.hp - VOLLEY.damage, 'the next target');
  assert.equal(s.units.length, 2);
});

test('wall volley: who shoots and who is hit; threat overlay; AI games', () => {
  const t = wallSetup();
  // no walls, out of range, own units: nothing
  const own = spawnUnit(t.s, 'warrior', 0, t.n1.q, t.n1.r);
  assert.equal(volleyTarget(t.s, t.city), null, 'own units are never hit');
  const far = Object.values(t.s.tiles).find((x) => isPassable(t.s, x.q, x.r) && distance(x, t.city) === VOLLEY.range + 1 && !cityAt(t.s, x.q, x.r));
  spawnUnit(t.s, 'warrior', 1, far.q, far.r);
  assert.equal(volleyTarget(t.s, t.city), null, 'out of range');
  const foe = spawnUnit(t.s, 'warrior', 1, t.n2.q, t.n2.r);
  assert.equal(volleyTarget(t.s, t.city).id, foe.id);
  t.city.buildings = [];
  assert.equal(volleyTarget(t.s, t.city), null, 'no walls, no volley');
  t.city.buildings = ['walls'];
  t.city.owner = null;
  assert.equal(volleyTarget(t.s, t.city), null, 'neutral cities don\'t shoot');
  t.city.owner = 0;
  cityVolleys(t.s, 1);
  assert.equal(foe.hp, UNIT_TYPES.warrior.hp, 'only the owner\'s walls shoot');
  assert.ok(own);
  // threat overlay: tiles next to a known enemy walled city count one more threat; unknown city – none
  const w = wallSetup(4, true);
  const enemyCity = w.s.cities.find((c) => c.owner === 1);
  enemyCity.buildings = ['walls'];
  const nb = neighbors(enemyCity.q, enemyCity.r).find((p) => isPassable(w.s, p.q, p.r));
  assert.ok(!threatTiles(w.s, 0).has(key(nb.q, nb.r)), 'the city is in the fog');
  w.s.fog = false;
  assert.equal(threatTiles(w.s, 0).get(key(nb.q, nb.r)), 1);
  assert.ok(!threatTiles(w.s, 0).has(key(enemyCity.q, enemyCity.r)), 'not the city tile itself');
  assert.ok(!threatTiles(w.s, 1).has(key(nb.q, nb.r)), 'own walls are no threat');
  // real AI-vs-AI games: volleys only from walled cities of the player ending the turn, never kill
  let shots = 0;
  for (const seed of [1, 7, 13]) {
    const s = createGame({ seed });
    for (let i = 0; i < 120 && s.winner === null; i++) {
      runAITurn(s);
      drainEvents(s);
      const ending = s.current;
      const n = s.units.length;
      endTurn(s);
      for (const e of drainEvents(s).filter((x) => x.type === 'volley')) {
        shots++;
        const c = s.cities.find((x) => x.id === e.cityId);
        assert.equal(e.player, ending);
        assert.ok(c.owner === ending && c.buildings.includes('walls'));
        assert.ok(e.hp >= VOLLEY.minHp && e.damage > 0 && e.damage <= VOLLEY.damage);
      }
      assert.equal(s.units.length, n, 'a volley never kills');
    }
  }
  assert.ok(shots > 0, 'walls shoot in real games');
});
