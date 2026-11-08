import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame, reachable, moveUnit, attack, buyUnit, endTurn, unitAt, isPassable,
  previewAttack, cloneState,
} from '../src/game.js';
import { runAITurn } from '../src/ai.js';
import { pathExists } from '../src/map.js';
import { distance, key } from '../src/hex.js';
import { UNIT_TYPES } from '../src/rules.js';

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
