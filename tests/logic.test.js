import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame, reachable, moveUnit, attack, buyUnit, endTurn, unitAt, isPassable,
  previewAttack, cloneState, pathTo, nextActiveUnit, tileAt, cityInfo, incomeOf, defenseValue,
  drainEvents, applyEvent, migrateState, STATE_VERSION,
} from '../src/game.js';
import { runAITurn } from '../src/ai.js';
import { pathExists } from '../src/map.js';
import { distance, key } from '../src/hex.js';
import { UNIT_TYPES, TERRAIN } from '../src/rules.js';

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
          sum += TERRAIN[tileAt(s, path[i].q, path[i].r).terrain].cost;
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
  units: s.units.map((u) => [u.id, u.type, u.owner, u.q, u.r, u.hp]).sort((a, b) => a[0] - b[0]),
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
  assert.equal(migrateState({ version: 99 }), null);
  assert.equal(migrateState(null), null);
});
