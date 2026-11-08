// Čistá herní logika bez DOM. Stav je obyčejný JSON objekt (dá se uložit).
import { key, neighbors, distance } from './hex.js';
import { generateMap } from './map.js';
import { TERRAIN, UNIT_TYPES, PLAYERS, ECONOMY } from './rules.js';

export function createGame({ seed = 1, cols = 14, rows = 10, neutralCities = 4 } = {}) {
  const { tiles, cities, starts } = generateMap(seed, cols, rows, neutralCities);
  const state = {
    version: 1,
    seed,
    cols,
    rows,
    tiles,
    cities,
    units: [],
    gold: PLAYERS.map(() => ECONOMY.startGold),
    turn: 1,
    current: 0,
    winner: null,
    nextUnitId: 1,
    log: [],
  };
  starts.forEach((s, owner) => {
    spawnUnit(state, 'warrior', owner, s.q, s.r);
    const free = neighbors(s.q, s.r).find((n) => isFree(state, n.q, n.r));
    if (free) spawnUnit(state, 'archer', owner, free.q, free.r);
  });
  for (const u of state.units.filter((x) => x.owner === 0)) {
    u.movesLeft = UNIT_TYPES[u.type].move;
    u.hasAttacked = false;
  }
  return state;
}

export function cloneState(state) {
  return JSON.parse(JSON.stringify(state));
}

// ---------- dotazy ----------

export const tileAt = (state, q, r) => state.tiles[key(q, r)];
export const unitAt = (state, q, r) => state.units.find((u) => u.q === q && u.r === r);
export const cityAt = (state, q, r) => state.cities.find((c) => c.q === q && c.r === r);
export const getUnit = (state, id) => state.units.find((u) => u.id === id);

export function isPassable(state, q, r) {
  const t = tileAt(state, q, r);
  return !!t && TERRAIN[t.terrain].passable;
}

export function isFree(state, q, r) {
  return isPassable(state, q, r) && !unitAt(state, q, r);
}

export function incomeOf(state, player) {
  return state.cities
    .filter((c) => c.owner === player)
    .reduce((sum, c) => sum + (c.capital ? ECONOMY.capitalIncome : ECONOMY.cityIncome), 0);
}

// Dosažitelná pole: Map klíč -> cena pohybu. Přes vlastní jednotky lze projít, ale ne zastavit.
export function reachable(state, unit) {
  const result = new Map();
  if (unit.movesLeft <= 0) return result;
  const best = new Map([[key(unit.q, unit.r), 0]]);
  const frontier = [{ q: unit.q, r: unit.r, cost: 0 }];
  while (frontier.length) {
    frontier.sort((a, b) => a.cost - b.cost);
    const cur = frontier.shift();
    for (const n of neighbors(cur.q, cur.r)) {
      const t = tileAt(state, n.q, n.r);
      if (!t || !TERRAIN[t.terrain].passable) continue;
      const other = unitAt(state, n.q, n.r);
      if (other && other.owner !== unit.owner) continue;
      // vstup do terénu za 2 je povolen i s 1 zbývajícím bodem, pokud je to první krok
      const stepCost = TERRAIN[t.terrain].cost;
      let cost = cur.cost + stepCost;
      if (cost > unit.movesLeft) {
        if (cur.cost === 0 && unit.movesLeft > 0) cost = unit.movesLeft;
        else continue;
      }
      const k = key(n.q, n.r);
      if (best.has(k) && best.get(k) <= cost) continue;
      best.set(k, cost);
      frontier.push({ q: n.q, r: n.r, cost });
      if (!other) result.set(k, cost);
    }
  }
  return result;
}

export function attackTargets(state, unit) {
  if (unit.hasAttacked) return [];
  const range = UNIT_TYPES[unit.type].range;
  return state.units.filter((u) => u.owner !== unit.owner && distance(unit, u) <= range);
}

export function defenseValue(state, unit) {
  const t = tileAt(state, unit.q, unit.r);
  let d = UNIT_TYPES[unit.type].def * (1 + TERRAIN[t.terrain].defBonus);
  const city = cityAt(state, unit.q, unit.r);
  if (city && city.owner === unit.owner) d *= 1.25;
  return d;
}

// Odhad boje bez náhody – používá ho UI i AI.
export function previewAttack(state, attacker, defender) {
  const atk = UNIT_TYPES[attacker.type].atk * hpFactor(attacker);
  const def = defenseValue(state, defender);
  const damage = Math.max(1, Math.round((4 * atk) / def));
  const defenderHp = Math.max(0, defender.hp - damage);
  let counter = 0;
  const dist = distance(attacker, defender);
  if (defenderHp > 0 && UNIT_TYPES[defender.type].range >= dist) {
    const cAtk = UNIT_TYPES[defender.type].atk * (defenderHp / UNIT_TYPES[defender.type].hp);
    const cDef = defenseValue(state, attacker);
    counter = Math.max(1, Math.round((3 * cAtk) / cDef));
  }
  return { damage, counter, kills: defenderHp === 0, dies: attacker.hp - counter <= 0 };
}

function hpFactor(unit) {
  return 0.5 + 0.5 * (unit.hp / UNIT_TYPES[unit.type].hp);
}

// ---------- akce (vrací true/false podle úspěchu) ----------

export function spawnUnit(state, type, owner, q, r) {
  const t = UNIT_TYPES[type];
  const unit = {
    id: state.nextUnitId++,
    type,
    owner,
    q,
    r,
    hp: t.hp,
    movesLeft: 0,
    hasAttacked: true,
  };
  state.units.push(unit);
  return unit;
}

export function moveUnit(state, unitId, q, r) {
  const unit = getUnit(state, unitId);
  if (!unit || unit.owner !== state.current || state.winner !== null) return false;
  const cost = reachable(state, unit).get(key(q, r));
  if (cost === undefined) return false;
  unit.q = q;
  unit.r = r;
  unit.movesLeft = Math.max(0, unit.movesLeft - cost);
  unit.moved = true;
  const city = cityAt(state, q, r);
  if (city && city.owner !== unit.owner) {
    const prev = city.owner;
    city.owner = unit.owner;
    addLog(state, `${PLAYERS[unit.owner].name}: dobyto město ${city.name}`);
    if (prev !== null) checkWinner(state);
  }
  return true;
}

export function attack(state, attackerId, defenderId) {
  const a = getUnit(state, attackerId);
  const d = getUnit(state, defenderId);
  if (!a || !d || a.owner !== state.current || state.winner !== null) return false;
  if (!attackTargets(state, a).includes(d)) return false;
  const res = previewAttack(state, a, d);
  d.hp -= res.damage;
  a.hasAttacked = true;
  a.movesLeft = 0;
  a.moved = true;
  const aName = UNIT_TYPES[a.type].name;
  const dName = UNIT_TYPES[d.type].name;
  if (d.hp <= 0) {
    removeUnit(state, d.id);
    addLog(state, `${PLAYERS[a.owner].name}: ${aName} zničil jednotku ${dName}`);
  } else {
    a.hp -= res.counter;
    addLog(state, `${PLAYERS[a.owner].name}: ${aName} útočí na ${dName} (−${res.damage}, protiúder −${res.counter})`);
    if (a.hp <= 0) {
      removeUnit(state, a.id);
      addLog(state, `${aName} padl v boji`);
    }
  }
  checkWinner(state);
  return true;
}

export function buyUnit(state, cityId, type) {
  const city = state.cities.find((c) => c.id === cityId);
  const t = UNIT_TYPES[type];
  if (!city || !t || city.owner !== state.current || state.winner !== null) return false;
  if (state.gold[state.current] < t.cost || unitAt(state, city.q, city.r)) return false;
  state.gold[state.current] -= t.cost;
  spawnUnit(state, type, state.current, city.q, city.r);
  addLog(state, `${PLAYERS[state.current].name}: naverbován ${t.name} v ${city.name}`);
  return true;
}

export function endTurn(state) {
  if (state.winner !== null) return false;
  // léčení jednotek hráče, který končí tah
  for (const u of state.units.filter((x) => x.owner === state.current)) {
    const city = cityAt(state, u.q, u.r);
    const heal = city && city.owner === u.owner ? ECONOMY.healInCity : u.moved ? 0 : ECONOMY.healIdle;
    u.hp = Math.min(UNIT_TYPES[u.type].hp, u.hp + heal);
  }
  state.current = (state.current + 1) % PLAYERS.length;
  if (state.current === 0) state.turn++;
  state.gold[state.current] += incomeOf(state, state.current);
  for (const u of state.units.filter((x) => x.owner === state.current)) {
    u.movesLeft = UNIT_TYPES[u.type].move;
    u.hasAttacked = false;
    u.moved = false;
  }
  return true;
}

function removeUnit(state, id) {
  state.units = state.units.filter((u) => u.id !== id);
}

function checkWinner(state) {
  for (let p = 0; p < PLAYERS.length; p++) {
    const hasCity = state.cities.some((c) => c.owner === p);
    if (!hasCity) {
      state.winner = (p + 1) % PLAYERS.length;
      addLog(state, `Konec hry – vítěz: ${PLAYERS[state.winner].name}`);
      return;
    }
  }
}

function addLog(state, msg) {
  state.log.push({ turn: state.turn, msg });
  if (state.log.length > 50) state.log.shift();
}
