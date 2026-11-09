// Pure game logic without DOM. The state is a plain JSON object (can be saved).
import { key, neighbors, distance } from './hex.js';
import { generateMap, hasRiverEdge } from './map.js';
import {
  TERRAIN, UNIT_TYPES, PLAYERS, ECONOMY, VISION, DIFFICULTY, BUILDINGS, BUILDING_EFFECTS, RANKS, XP, ROAD_COST, RIVER,
  FACTIONS, NO_FACTION, MAP_SIZES, HAPPENINGS, FORTIFY, TERRITORY, RESOURCES,
} from './rules.js';
import { createRng } from './rng.js';

export function createGame({
  seed = 1, size = null, cols = 14, rows = 10, neutralCities = 4, fog = true, difficulty = 'normal',
  faction = 'kingdom', aiFaction = null, happenings = true,
} = {}) {
  if (MAP_SIZES[size]) ({ cols, rows, neutralCities } = MAP_SIZES[size]);
  if (!DIFFICULTY[difficulty]) difficulty = 'normal';
  if (!FACTIONS[faction]) faction = 'kingdom';
  if (!FACTIONS[aiFaction]) {
    // the AI gets a different faction than the player, chosen by seed (reproducibly)
    const others = Object.keys(FACTIONS).filter((f) => f !== faction);
    aiFaction = others[Math.abs(seed) % others.length];
  }
  const { tiles, cities, starts } = generateMap(seed, cols, rows, neutralCities);
  for (const c of cities) c.buildings = [];
  const state = {
    version: STATE_VERSION,
    seed,
    cols,
    rows,
    tiles,
    cities,
    units: [],
    gold: PLAYERS.map((p) => ECONOMY.startGold + (p.isAI ? DIFFICULTY[difficulty].startGold : 0)),
    turn: 1,
    current: 0,
    winner: null,
    nextUnitId: 1,
    log: [],
    events: [],
    fog,
    happenings: !!happenings,
    zoc: true,
    difficulty,
    factions: [faction, aiFaction],
    history: [],
    stats: emptyStats(),
    explored: PLAYERS.map(() => []),
  };
  starts.forEach((s, owner) => {
    spawnUnit(state, 'warrior', owner, s.q, s.r);
    const free = neighbors(s.q, s.r).find((n) => isFree(state, n.q, n.r));
    if (free) spawnUnit(state, 'archer', owner, free.q, free.r);
  });
  for (const u of state.units.filter((x) => x.owner === 0)) {
    u.movesLeft = unitMove(state, u);
    u.hasAttacked = false;
  }
  state.events = [];
  PLAYERS.forEach((_, p) => updateExplored(state, p));
  recordHistory(state);
  return state;
}

// ---------- statistics ----------

function emptyStats() {
  return { kills: PLAYERS.map(() => 0), losses: PLAYERS.map(() => 0), captures: PLAYERS.map(() => 0) };
}

// Army power: unit cost weighted by HP and rank (a rough but comparable number).
export function armyPower(state, player) {
  let sum = 0;
  for (const u of state.units) {
    if (u.owner !== player) continue;
    sum += UNIT_TYPES[u.type].cost * (u.hp / UNIT_TYPES[u.type].hp) * rankMult(u);
  }
  return Math.round(sum);
}

// Records the turn's state into history (once per turn; a repeated record overwrites the turn).
export function recordHistory(state) {
  if (!state.history) state.history = [];
  const entry = {
    turn: state.turn,
    power: PLAYERS.map((_, p) => armyPower(state, p)),
    cities: PLAYERS.map((_, p) => state.cities.filter((c) => c.owner === p).length),
    gold: [...state.gold],
  };
  const last = state.history[state.history.length - 1];
  if (last && last.turn === entry.turn) state.history[state.history.length - 1] = entry;
  else state.history.push(entry);
}

function countStat(state, name, player) {
  if (!state.stats) state.stats = emptyStats();
  state.stats[name][player]++;
}

export const STATE_VERSION = 16;

// Converts a saved state of an older version to the current one; returns null for an unknown format.
export function migrateState(s) {
  if (!s || typeof s !== 'object') return null;
  if (s.version === 1) {
    s.events = [];
    s.version = 2;
  }
  if (s.version === 2) {
    // fog of war: old games get it too, explored = what is visible now
    s.fog = true;
    s.explored = PLAYERS.map(() => []);
    PLAYERS.forEach((_, p) => updateExplored(s, p));
    s.version = 3;
  }
  if (s.version === 3) {
    s.difficulty = 'normal';
    s.version = 4;
  }
  if (s.version === 4) {
    for (const c of s.cities) c.buildings = [];
    s.version = 5;
  }
  if (s.version === 5) {
    for (const u of s.units) u.xp = 0;
    s.version = 6;
  }
  if (s.version === 6) {
    // roads were added in version 7 – old maps simply lack them (missing tile.road = no road)
    s.version = 7;
  }
  if (s.version === 7) {
    s.factions = [null, null]; // old games play without factions
    s.version = 8;
  }
  if (s.version === 8) {
    s.history = []; // statistics start from loading
    s.stats = emptyStats();
    s.version = 9;
  }
  if (s.version === 9) {
    // rivers were added in version 10 – old maps lack them (missing tile.rivers = no rivers)
    s.version = 10;
  }
  if (s.version === 10) {
    s.happenings = false; // a game in progress continues with the rules it started with
    s.version = 11;
  }
  if (s.version === 11) {
    // chronicle entries without `seen` are public, so old entries stay visible to everyone
    s.version = 12;
  }
  if (s.version === 12) {
    // fortify arrived in version 13 – a missing `fortified` means not fortified
    s.version = 13;
  }
  if (s.version === 13) {
    // move orders arrived in version 14 – a missing `goto` means no order
    s.version = 14;
  }
  if (s.version === 14) {
    // map resources arrived in version 15 – old maps simply have none
    s.version = 15;
  }
  if (s.version === 15) {
    s.zoc = false; // zone of control arrived in version 16 – a game in progress keeps its rules
    s.version = 16;
  }
  return s.version === STATE_VERSION ? s : null;
}

// ---------- city territory ----------

// Territory: Map tile key -> city id. Depends only on city positions, so it's the same all game.
export function territoryMap(state) {
  const map = new Map();
  for (const t of Object.values(state.tiles)) {
    if (t.terrain === 'water') continue;
    let best = null;
    let bestD = Infinity;
    for (const c of state.cities) {
      const d = distance(t, c);
      if (d <= TERRITORY.radius && (d < bestD || (d === bestD && c.id < best.id))) { best = c; bestD = d; }
    }
    if (best) map.set(key(t.q, t.r), best.id);
  }
  return map;
}

// Owner of the territory on a tile: player index, null for a neutral city, undefined outside any territory.
export function territoryOwner(state, q, r) {
  const id = territoryMap(state).get(key(q, r));
  if (id === undefined) return undefined;
  return state.cities.find((c) => c.id === id).owner;
}

// ---------- fog of war ----------

// Tiles the player currently sees (a Set of keys). Without fog they see everything.
export function visibleTiles(state, player) {
  const seen = new Set();
  if (!state.fog || state.winner !== null) {
    for (const k of Object.keys(state.tiles)) seen.add(k);
    return seen;
  }
  const look = (q, r, radius) => {
    for (let dq = -radius; dq <= radius; dq++) {
      for (let dr = Math.max(-radius, -dq - radius); dr <= Math.min(radius, -dq + radius); dr++) {
        const k = key(q + dq, r + dr);
        if (state.tiles[k]) seen.add(k);
      }
    }
  };
  for (const u of state.units) {
    if (u.owner !== player) continue;
    const onHills = tileAt(state, u.q, u.r).terrain === 'hills';
    look(u.q, u.r, UNIT_TYPES[u.type].sight + (onHills ? VISION.hillsBonus : 0));
  }
  for (const c of state.cities) if (c.owner === player) look(c.q, c.r, citySight(c));
  return seen;
}

// Adds currently visible tiles to the explored ones (state.explored[player] is a sorted array of keys).
export function updateExplored(state, player) {
  if (!state.explored) return;
  const all = new Set(state.explored[player] || []);
  for (const k of visibleTiles(state, player)) all.add(k);
  state.explored[player] = [...all].sort();
}

// Explored tiles as a Set (for fast lookups while drawing).
export function exploredTiles(state, player) {
  if (!state.fog) return new Set(Object.keys(state.tiles));
  return new Set(state.explored ? state.explored[player] : []);
}

// ---------- events for animations ----------
// Actions write what happened into state.events (JSON). The UI takes them via drainEvents()
// and replays them on a copy of the pre-action state using applyEvent().

function emit(state, ev) {
  (state.events ||= []).push(ev);
}

export function drainEvents(state) {
  const evs = state.events || [];
  state.events = [];
  return evs;
}

export function applyEvent(state, ev) {
  if (ev.type === 'move') {
    const u = getUnit(state, ev.unitId);
    const end = ev.path[ev.path.length - 1];
    if (u) { u.q = end.q; u.r = end.r; delete u.fortified; }
  } else if (ev.type === 'attack') {
    const a = getUnit(state, ev.attackerId);
    const d = getUnit(state, ev.defenderId);
    if (d) {
      d.hp = ev.defenderHp ?? d.hp - ev.damage;
      d.xp = ev.defenderXp ?? d.xp;
    }
    if (a) {
      delete a.fortified;
      a.hp = ev.attackerHp ?? a.hp - ev.counter;
      a.xp = ev.attackerXp ?? a.xp;
    }
    if (ev.killed) removeUnit(state, ev.defenderId);
    if (ev.died) removeUnit(state, ev.attackerId);
  } else if (ev.type === 'fortify') {
    const u = getUnit(state, ev.unitId);
    if (u) u.fortified = true;
  } else if (ev.type === 'spawn') {
    state.units.push({ ...ev.unit });
  } else if (ev.type === 'capture') {
    const c = state.cities.find((x) => x.id === ev.cityId);
    if (c) c.owner = ev.owner;
  } else if (ev.type === 'happening') {
    if (ev.gold) state.gold[ev.player] += ev.gold;
    for (const h of ev.hits || []) {
      const u = getUnit(state, h.unitId);
      if (u) u.hp = h.hp;
    }
  } else if (ev.type === 'build') {
    const c = state.cities.find((x) => x.id === ev.cityId);
    if (c && !hasBuilding(c, ev.building)) c.buildings = [...(c.buildings || []), ev.building];
  }
}

export function cloneState(state) {
  return JSON.parse(JSON.stringify(state));
}

// ---------- queries ----------

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

export const CITY_DEF_BONUS = 0.25;

export const hasBuilding = (city, b) => !!city.buildings && city.buildings.includes(b);

// ---------- factions ----------

export function factionOf(state, player) {
  const id = state && state.factions ? state.factions[player] : null;
  return FACTIONS[id] || NO_FACTION;
}

export function unitMove(state, unit) {
  const bonus = factionOf(state, unit.owner).moveBonus;
  return UNIT_TYPES[unit.type].move + ((bonus && bonus[unit.type]) || 0);
}

export function buildingCost(state, player, building) {
  const d = factionOf(state, player).buildingDiscount;
  return Math.max(1, BUILDINGS[building].cost - ((d && d[building]) || 0));
}

// Terrain defense bonus for a unit (Forest Folk get extra in forest).
export function terrainDefense(state, unit, tile) {
  const f = factionOf(state, unit.owner);
  return TERRAIN[tile.terrain].defBonus + (tile.terrain === 'forest' ? f.forestDefense || 0 : 0);
}

// City income; with state, the owner's faction bonus is included too.
export function cityIncome(city, state = null) {
  const base = city.capital ? ECONOMY.capitalIncome : ECONOMY.cityIncome;
  const faction = state && city.owner !== null ? factionOf(state, city.owner).cityIncome || 0 : 0;
  const market = hasBuilding(city, 'market') ? BUILDING_EFFECTS.marketIncome : 0;
  const temple = hasBuilding(city, 'temple') ? BUILDING_EFFECTS.templeIncome : 0;
  const mines = state ? cityResources(state, city).filter((t) => t.resource === 'gold').length * RESOURCES.gold.income : 0;
  return base + faction + market + temple + mines;
}

// Resource tiles in the city's territory.
export function cityResources(state, city) {
  const terr = territoryMap(state);
  return Object.values(state.tiles).filter((t) => t.resource && terr.get(key(t.q, t.r)) === city.id);
}

// Healing per turn for a unit standing in its own city (an infirmary heals more).
export function cityHeal(city) {
  return ECONOMY.healInCity + (hasBuilding(city, 'infirmary') ? BUILDING_EFFECTS.infirmaryHeal : 0);
}

// How far a city sees (a watchtower sees farther).
export function citySight(city) {
  return VISION.city + (hasBuilding(city, 'watchtower') ? BUILDING_EFFECTS.watchtowerSight : 0);
}

// Garrison defense multiplier in an own city (city + walls, if any).
export function cityDefenseMult(city) {
  return (1 + CITY_DEF_BONUS) * (hasBuilding(city, 'walls') ? 1 + BUILDING_EFFECTS.wallsDefense : 1);
}

// Unit cost when recruiting in the given city (barracks and the owner's faction make it cheaper).
export function unitCost(state, city, type) {
  let discount = hasBuilding(city, 'barracks') ? BUILDING_EFFECTS.barracksDiscount : 0;
  const fd = city.owner !== null ? factionOf(state, city.owner).unitDiscount : null;
  if (fd && fd[type]) discount += fd[type];
  for (const t of cityResources(state, city)) discount += (RESOURCES[t.resource].discount || {})[type] || 0;
  return Math.max(1, UNIT_TYPES[type].cost - discount);
}

export function incomeOf(state, player) {
  const base = state.cities.filter((c) => c.owner === player).reduce((sum, c) => sum + cityIncome(c, state), 0);
  return Math.max(0, base + difficultyOf(state, player).incomeBonus);
}

// Difficulty settings for the given player (the human always has neutral values).
export function difficultyOf(state, player) {
  if (!PLAYERS[player].isAI) return DIFFICULTY.normal;
  return DIFFICULTY[state.difficulty] || DIFFICULTY.normal;
}

// City tooltip summary: income, garrison defense bonus (terrain + city) and healing.
export function cityInfo(state, city) {
  const tile = tileAt(state, city.q, city.r);
  const owner = city.owner === null ? null : { owner: city.owner };
  const defMult = (1 + (owner ? terrainDefense(state, owner, tile) : TERRAIN[tile.terrain].defBonus)) * cityDefenseMult(city);
  const garrison = unitAt(state, city.q, city.r) || null;
  return {
    income: cityIncome(city, state),
    defensePct: Math.round((defMult - 1) * 100),
    heal: cityHeal(city),
    garrison: garrison && garrison.owner === city.owner ? garrison : null,
  };
}

// Cost of a step from tile `from` to the neighboring tile `to` (roads are cheaper, otherwise the target tile's terrain).
// unit (optional) determines the faction – Forest Folk move through forest more cheaply.
export function stepCost(state, from, to, unit = null) {
  const a = tileAt(state, from.q, from.r);
  const b = tileAt(state, to.q, to.r);
  if (a && b && a.road && b.road) return ROAD_COST; // road across a river = bridge
  const river = riverBetween(state, from, to) ? RIVER.crossCost : 0;
  if (unit && b.terrain === 'forest') {
    const fc = factionOf(state, unit.owner).forestCost;
    if (fc) return fc + river;
  }
  return TERRAIN[b.terrain].cost + river;
}

// Does a river flow between neighboring tiles a, b?
export function riverBetween(state, a, b) {
  return hasRiverEdge(state.tiles, a, b);
}

// Defense bonus for a unit attacked in melee across a river (0 if no river between them).
export function riverDefense(state, attacker, defender) {
  return distance(attacker, defender) === 1 && riverBetween(state, attacker, defender) ? RIVER.defBonus : 0;
}

// Searches reachable tiles (Dijkstra). Returns costs and predecessors so a path can be built.
// Own units can be passed through but not stopped on.
function searchMoves(state, unit) {
  const result = new Map();
  const parent = new Map();
  if (unit.movesLeft <= 0) return { result, parent };
  const zoc = zocTiles(state, unit.owner);
  const start = key(unit.q, unit.r);
  const best = new Map([[start, 0]]);
  const frontier = [{ q: unit.q, r: unit.r, cost: 0 }];
  while (frontier.length) {
    frontier.sort((a, b) => a.cost - b.cost);
    const cur = frontier.shift();
    // a unit that entered an enemy zone of control stops there
    if (key(cur.q, cur.r) !== start && zoc.has(key(cur.q, cur.r))) continue;
    for (const n of neighbors(cur.q, cur.r)) {
      const t = tileAt(state, n.q, n.r);
      if (!t || !TERRAIN[t.terrain].passable) continue;
      const other = unitAt(state, n.q, n.r);
      if (other && other.owner !== unit.owner) continue;
      // entering cost-2 terrain is allowed with 1 point left if it's the first step
      let cost = cur.cost + stepCost(state, cur, n, unit);
      if (cost > unit.movesLeft) {
        if (cur.cost === 0 && unit.movesLeft > 0) cost = unit.movesLeft;
        else continue;
      }
      const k = key(n.q, n.r);
      if (best.has(k) && best.get(k) <= cost) continue;
      best.set(k, cost);
      parent.set(k, key(cur.q, cur.r));
      frontier.push({ q: n.q, r: n.r, cost });
      if (!other) result.set(k, cost);
    }
  }
  return { result, parent };
}

// Zone of control: tiles next to an enemy unit the mover can see. A unit that steps into such a tile
// must stop there (it may still attack); leaving a zone from the starting tile is free. Hidden enemies
// don't reveal themselves by stopping a unit. Returns a Set of keys (empty if the game has no ZoC).
export function zocTiles(state, player) {
  const zoc = new Set();
  if (!state.zoc) return zoc;
  const visible = state.fog ? visibleTiles(state, player) : null;
  for (const e of state.units) {
    if (e.owner === player || (visible && !visible.has(key(e.q, e.r)))) continue;
    for (const n of neighbors(e.q, e.r)) if (state.tiles[key(n.q, n.r)]) zoc.add(key(n.q, n.r));
  }
  return zoc;
}

// Reachable tiles: Map key -> movement cost.
export function reachable(state, unit) {
  return searchMoves(state, unit).result;
}

// Cheapest path to the target tile as an array of {q, r} from the start (inclusive) to the target.
// Returns null if the target isn't reachable this turn.
export function pathTo(state, unit, q, r) {
  const { result, parent } = searchMoves(state, unit);
  const target = key(q, r);
  if (!result.has(target)) return null;
  const path = [];
  for (let k = target; k !== undefined; k = parent.get(k)) {
    const [pq, pr] = k.split(',').map(Number);
    path.unshift({ q: pq, r: pr });
  }
  return path;
}

// ---------- multi-turn move orders ----------

// Route to a far tile for a player's unit, using only what the player knows: explored passable tiles,
// blocked by enemy units the player can see right now (own units can be walked through).
// Returns { path: [{q,r}…] from the unit to the target, turns } or null. turns = turns needed
// counting the current one (by the same rules as reachable(): a first step may use up the last points).
export function planRoute(state, unit, q, r) {
  const target = key(q, r);
  const explored = exploredTiles(state, unit.owner);
  const visible = visibleTiles(state, unit.owner);
  const blocked = (tq, tr) => {
    const o = unitAt(state, tq, tr);
    return o && o.owner !== unit.owner && visible.has(key(tq, tr));
  };
  if (!explored.has(target) || !isPassable(state, q, r) || (unit.q === q && unit.r === r)) return null;
  const occupant = unitAt(state, q, r);
  if (occupant && (occupant.owner === unit.owner || visible.has(target))) return null;
  const best = new Map([[key(unit.q, unit.r), 0]]);
  const parent = new Map();
  const frontier = [{ q: unit.q, r: unit.r, cost: 0 }];
  while (frontier.length) {
    frontier.sort((a, b) => a.cost - b.cost);
    const cur = frontier.shift();
    if (key(cur.q, cur.r) === target) break;
    for (const n of neighbors(cur.q, cur.r)) {
      const k = key(n.q, n.r);
      if (!explored.has(k) || !isPassable(state, n.q, n.r) || blocked(n.q, n.r)) continue;
      const cost = cur.cost + stepCost(state, cur, n, unit);
      if (best.has(k) && best.get(k) <= cost) continue;
      best.set(k, cost);
      parent.set(k, key(cur.q, cur.r));
      frontier.push({ q: n.q, r: n.r, cost });
    }
  }
  if (!best.has(target)) return null;
  const path = [];
  for (let k = target; k !== undefined; k = parent.get(k)) {
    const [pq, pr] = k.split(',').map(Number);
    path.unshift({ q: pq, r: pr });
  }
  return { path, turns: routeTurns(state, unit, path) };
}

function routeTurns(state, unit, path) {
  const full = unitMove(state, unit);
  let left = unit.movesLeft;
  let fresh = left === full; // a first step this turn may use up the last points
  let turns = 1;
  for (let i = 1; i < path.length; i++) {
    const c = stepCost(state, path[i - 1], path[i], unit);
    if (c > left && !(fresh && left > 0)) {
      turns++;
      left = full;
    }
    left = Math.max(0, left - c);
    fresh = false;
  }
  return turns;
}

// Gives a unit a move order and starts walking right away. Returns the result of followOrder.
export function setOrder(state, unitId, q, r) {
  const unit = getUnit(state, unitId);
  if (!unit || unit.owner !== state.current || state.winner !== null || !planRoute(state, unit, q, r)) return null;
  delete unit.fortified;
  unit.goto = { q, r };
  return followOrder(state, unit);
}

export function cancelOrder(state, unitId) {
  const unit = getUnit(state, unitId);
  if (unit) delete unit.goto;
}

// Visible enemy units within `radius` of the unit (used to interrupt move orders).
function enemyInSight(state, unit, radius = 2) {
  const visible = visibleTiles(state, unit.owner);
  return state.units.some((u) => u.owner !== unit.owner && distance(u, unit) <= radius && visible.has(key(u.q, u.r)));
}

// One turn of walking along a move order: goes to the farthest tile on the route reachable this turn.
// Result: 'arrived' | 'moved' | 'blocked' (no way – order cancelled) | 'interrupted' (enemy in sight –
// order cancelled so the player decides) | 'idle' (no moves left).
export function followOrder(state, unit) {
  const goal = unit.goto;
  if (!goal) return 'idle';
  if (unit.movesLeft <= 0) return 'idle';
  const route = planRoute(state, unit, goal.q, goal.r);
  if (!route) { delete unit.goto; return 'blocked'; }
  const reach = reachable(state, unit);
  let stop = null;
  for (let i = route.path.length - 1; i > 0; i--) {
    const p = route.path[i];
    if (reach.has(key(p.q, p.r))) { stop = p; break; }
  }
  if (!stop) { delete unit.goto; return 'blocked'; }
  moveUnit(state, unit.id, stop.q, stop.r);
  const u = getUnit(state, unit.id);
  if (!u) return 'blocked';
  if (u.q === goal.q && u.r === goal.r) return 'arrived';
  if (enemyInSight(state, u)) return 'interrupted';
  u.goto = goal;
  return 'moved';
}

// At the start of a player's turn: units with orders walk on. An enemy already in sight stops the order
// before moving. Returns [{ unitId, result }].
export function runOrders(state, player) {
  const out = [];
  for (const unit of state.units.filter((u) => u.owner === player && u.goto)) {
    if (state.winner !== null) break;
    if (enemyInSight(state, unit)) {
      delete unit.goto;
      out.push({ unitId: unit.id, result: 'interrupted' });
      continue;
    }
    out.push({ unitId: unit.id, result: followOrder(state, unit) });
  }
  return out;
}

// Own units that can still move or attack, sorted by id. Fortified units are left alone (like sleeping
// units); they can still be selected by clicking. Used by Tab and by the end-turn reminder.
export function activeUnits(state, player) {
  const canAct = (u) => !u.fortified && (u.movesLeft > 0 || attackTargets(state, u).length > 0);
  return state.units.filter((u) => u.owner === player && canAct(u)).sort((a, b) => a.id - b.id);
}

// The next own unit that can still move or attack (for the Tab key).
// Cycles by id after unit afterId; returns null if there is none.
export function nextActiveUnit(state, player, afterId = null) {
  const mine = activeUnits(state, player);
  if (!mine.length) return null;
  return mine.find((u) => afterId === null || u.id > afterId) || mine[0];
}

// Can the move be undone? before/after = state before and after the action of player `viewer`, events = what it caused.
// Only a plain move that revealed nothing new can be undone: no capture or promotion,
// no newly explored tile, and no foreign unit or foreign city on newly visible tiles.
export function isUndoableMove(before, after, events, viewer) {
  if (after.winner !== null || before.current !== viewer || after.current !== viewer) return false;
  if (events.length !== 1 || events[0].type !== 'move') return false;
  if (exploredTiles(after, viewer).size !== exploredTiles(before, viewer).size) return false;
  const wasVisible = visibleTiles(before, viewer);
  for (const k of visibleTiles(after, viewer)) {
    if (wasVisible.has(k)) continue;
    const t = after.tiles[k];
    const u = unitAt(after, t.q, t.r);
    const c = cityAt(after, t.q, t.r);
    if ((u && u.owner !== viewer) || (c && c.owner !== viewer)) return false;
  }
  return true;
}

// Can the unit fortify now? Only an own unit of the current player that hasn't moved or attacked this turn.
export function canFortify(state, unit) {
  return !!unit && unit.owner === state.current && state.winner === null
    && !unit.fortified && !unit.moved && !unit.hasAttacked;
}

// Fortifies the unit: it ends its turn and gets +FORTIFY.defBonus defense until it moves or attacks.
export function fortify(state, unitId) {
  const unit = getUnit(state, unitId);
  if (!canFortify(state, unit)) return false;
  unit.fortified = true;
  delete unit.goto;
  unit.movesLeft = 0;
  unit.hasAttacked = true;
  emit(state, { type: 'fortify', unitId: unit.id });
  return true;
}

export function attackTargets(state, unit) {
  if (unit.hasAttacked) return [];
  const range = UNIT_TYPES[unit.type].range;
  return state.units.filter((u) => u.owner !== unit.owner && distance(unit, u) <= range);
}

// ---------- experience ----------

export function rankOf(unit) {
  let rank = 0;
  RANKS.forEach((r, i) => { if ((unit.xp || 0) >= r.xp) rank = i; });
  return rank;
}

export const rankMult = (unit) => 1 + XP.rankBonus * rankOf(unit);

// Adds experience; heals the unit a bit on promotion. Returns true if a promotion happened.
function gainXp(state, unit, amount) {
  const before = rankOf(unit);
  unit.xp = (unit.xp || 0) + amount;
  if (rankOf(unit) <= before) return false;
  unit.hp = Math.min(UNIT_TYPES[unit.type].hp, unit.hp + XP.promotionHeal);
  addLog(state, `${PLAYERS[unit.owner].name}: ${UNIT_TYPES[unit.type].name} promoted to ${RANKS[rankOf(unit)].name}`, {
    by: unit.owner, at: [unit],
  });
  return true;
}

// Unit strength multiplier against a specific opponent (spearman vs. horseman…).
export function vsMult(unit, other) {
  const bonus = other && UNIT_TYPES[unit.type].bonusVs ? UNIT_TYPES[unit.type].bonusVs[other.type] || 0 : 0;
  return 1 + bonus;
}

// Everything worth knowing about a unit, for the hover tooltip. Attack and defense are the effective
// values where it stands (rank, terrain, river-free, city, walls, fortify), without bonuses against
// a specific enemy type. `notes` lists the reasons for the defense bonus.
export function unitSummary(state, unit) {
  const t = UNIT_TYPES[unit.type];
  const def = defenseValue(state, unit);
  const notes = [];
  const tile = tileAt(state, unit.q, unit.r);
  const terr = terrainDefense(state, unit, tile);
  if (terr) notes.push(`${TERRAIN[tile.terrain].name.toLowerCase()} +${Math.round(terr * 100)} %`);
  const city = cityAt(state, unit.q, unit.r);
  if (city && city.owner === unit.owner) notes.push(hasBuilding(city, 'walls') ? 'city with walls' : 'city');
  if (unit.fortified) notes.push('fortified');
  return {
    name: t.name,
    owner: unit.owner,
    hp: unit.hp,
    maxHp: t.hp,
    attack: Math.round(t.atk * rankMult(unit) * 10) / 10,
    defense: Math.round(def * 10) / 10,
    baseDefense: t.def,
    range: t.range,
    move: unitMove(state, unit),
    rank: RANKS[rankOf(unit)].name,
    xp: unit.xp || 0,
    fortified: !!unit.fortified,
    marching: !!unit.goto,
    notes,
  };
}

// Unit defense; attacker (optional) determines type bonuses and siege.
export function defenseValue(state, unit, attacker = null) {
  const t = tileAt(state, unit.q, unit.r);
  let d = UNIT_TYPES[unit.type].def * rankMult(unit) * (1 + terrainDefense(state, unit, t)) * vsMult(unit, attacker);
  if (unit.fortified) d *= 1 + FORTIFY.defBonus;
  const city = cityAt(state, unit.q, unit.r);
  if (city && city.owner === unit.owner) {
    const siege = attacker && UNIT_TYPES[attacker.type].siege;
    d *= siege ? 1 + CITY_DEF_BONUS : cityDefenseMult(city); // siege engines ignore walls
  }
  return d;
}

// Attack strength including rank, type bonus and city siege.
function attackPower(state, unit, target) {
  let atk = UNIT_TYPES[unit.type].atk * rankMult(unit) * vsMult(unit, target);
  const siege = UNIT_TYPES[unit.type].siege;
  if (siege && target && cityAt(state, target.q, target.r)) atk *= 1 + siege;
  return atk;
}

// Combat estimate without randomness – used by both UI and AI.
export function previewAttack(state, attacker, defender) {
  const atk = attackPower(state, attacker, defender) * hpFactor(attacker);
  const def = defenseValue(state, defender, attacker) * (1 + riverDefense(state, attacker, defender));
  const damage = Math.max(1, Math.round((4 * atk) / def));
  const defenderHp = Math.max(0, defender.hp - damage);
  let counter = 0;
  const dist = distance(attacker, defender);
  if (defenderHp > 0 && UNIT_TYPES[defender.type].range >= dist) {
    const cAtk = attackPower(state, defender, attacker) * (defenderHp / UNIT_TYPES[defender.type].hp);
    const cDef = defenseValue(state, attacker, defender);
    counter = Math.max(1, Math.round((3 * cAtk) / cDef));
  }
  return { damage, counter, kills: defenderHp === 0, dies: attacker.hp - counter <= 0 };
}

function hpFactor(unit) {
  return 0.5 + 0.5 * (unit.hp / UNIT_TYPES[unit.type].hp);
}

// ---------- actions (return true/false on success) ----------

export function spawnUnit(state, type, owner, q, r, xp = 0) {
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
    xp,
  };
  state.units.push(unit);
  emit(state, { type: 'spawn', unit: { ...unit } });
  updateExplored(state, owner);
  return unit;
}

export function moveUnit(state, unitId, q, r) {
  const unit = getUnit(state, unitId);
  if (!unit || unit.owner !== state.current || state.winner !== null) return false;
  const path = pathTo(state, unit, q, r);
  if (!path) return false;
  const cost = reachable(state, unit).get(key(q, r));
  emit(state, { type: 'move', unitId: unit.id, path });
  unit.q = q;
  unit.r = r;
  unit.movesLeft = Math.max(0, unit.movesLeft - cost);
  unit.moved = true;
  delete unit.fortified;
  delete unit.goto; // a manual move cancels a move order (followOrder puts it back)
  const city = cityAt(state, q, r);
  if (city && city.owner !== unit.owner) {
    const prev = city.owner;
    city.owner = unit.owner;
    emit(state, { type: 'capture', cityId: city.id, owner: unit.owner });
    countStat(state, 'captures', unit.owner);
    const loot = factionOf(state, unit.owner).captureGold || 0;
    state.gold[unit.owner] += loot;
    addLog(state, `${PLAYERS[unit.owner].name}: captured ${city.name}${loot ? ` (loot ${loot} gold)` : ''}`, {
      by: unit.owner, at: [city], also: prev === null ? [] : [prev],
    });
    if (prev !== null) checkWinner(state);
  }
  updateExplored(state, unit.owner);
  return true;
}

export function attack(state, attackerId, defenderId) {
  const a = getUnit(state, attackerId);
  const d = getUnit(state, defenderId);
  if (!a || !d || a.owner !== state.current || state.winner !== null) return false;
  if (!attackTargets(state, a).includes(d)) return false;
  delete a.fortified; // attacking leaves the fortification before the fight
  delete a.goto;
  const res = previewAttack(state, a, d);
  d.hp -= res.damage;
  a.hasAttacked = true;
  a.movesLeft = 0;
  a.moved = true;
  const aName = UNIT_TYPES[a.type].name;
  const dName = UNIT_TYPES[d.type].name;
  // the fight is seen by both participants and anyone who sees at least one of the tiles (computed before units are lost)
  const fight = { by: a.owner, at: [{ q: a.q, r: a.r }, { q: d.q, r: d.r }], also: [d.owner] };
  fight.seen = seenBy(state, fight);
  const ev = { type: 'attack', attackerId: a.id, defenderId: d.id, damage: res.damage, counter: 0, killed: d.hp <= 0, died: false };
  emit(state, ev);
  if (d.hp <= 0) {
    removeUnit(state, d.id);
    addLog(state, `${PLAYERS[a.owner].name}: ${aName} destroyed ${dName}`, fight);
    countStat(state, 'kills', a.owner);
    countStat(state, 'losses', d.owner);
    ev.promoted = gainXp(state, a, XP.attack + XP.kill);
  } else {
    a.hp -= res.counter;
    ev.counter = res.counter;
    ev.died = a.hp <= 0;
    addLog(state, `${PLAYERS[a.owner].name}: ${aName} attacks ${dName} (−${res.damage}, counter −${res.counter})`, fight);
    if (a.hp <= 0) {
      removeUnit(state, a.id);
      addLog(state, `${aName} fell in battle`, fight);
      countStat(state, 'kills', d.owner);
      countStat(state, 'losses', a.owner);
    } else {
      ev.promoted = gainXp(state, a, XP.attack);
    }
    ev.defenderPromoted = gainXp(state, d, XP.defend);
  }
  // resulting values, so replaying the event is exact even with a promotion
  ev.attackerHp = a.hp;
  ev.attackerXp = a.xp;
  ev.defenderHp = d.hp;
  ev.defenderXp = d.xp;
  checkWinner(state);
  return true;
}

export function buyUnit(state, cityId, type) {
  const city = state.cities.find((c) => c.id === cityId);
  const t = UNIT_TYPES[type];
  if (!city || !t || city.owner !== state.current || state.winner !== null) return false;
  const cost = unitCost(state, city, type);
  if (state.gold[state.current] < cost || unitAt(state, city.q, city.r)) return false;
  state.gold[state.current] -= cost;
  const xp = hasBuilding(city, 'academy') ? BUILDING_EFFECTS.academyXp : 0; // academy: starts as a Veteran
  spawnUnit(state, type, state.current, city.q, city.r, xp);
  addLog(state, `${PLAYERS[state.current].name}: recruited ${t.name} (${city.name})`, { by: state.current, at: [city] });
  return true;
}

// Builds a building in an own city. Returns true/false on success.
export function build(state, cityId, building) {
  const city = state.cities.find((c) => c.id === cityId);
  const b = BUILDINGS[building];
  if (!city || !b || city.owner !== state.current || state.winner !== null) return false;
  const cost = buildingCost(state, state.current, building);
  if (hasBuilding(city, building) || state.gold[state.current] < cost) return false;
  state.gold[state.current] -= cost;
  city.buildings = [...(city.buildings || []), building];
  emit(state, { type: 'build', cityId, building });
  addLog(state, `${PLAYERS[state.current].name}: built ${b.name} (${city.name})`, { by: state.current, at: [city] });
  return true;
}

export function endTurn(state) {
  if (state.winner !== null) return false;
  // heal units of the player ending the turn
  for (const u of state.units.filter((x) => x.owner === state.current)) {
    const city = cityAt(state, u.q, u.r);
    const restHeal = territoryOwner(state, u.q, u.r) === u.owner ? TERRITORY.healIdle : ECONOMY.healIdle;
    const heal = city && city.owner === u.owner ? cityHeal(city) : u.moved ? 0 : restHeal;
    u.hp = Math.min(UNIT_TYPES[u.type].hp, u.hp + heal);
  }
  state.current = (state.current + 1) % PLAYERS.length;
  if (state.current === 0) {
    state.turn++;
    recordHistory(state);
  }
  state.gold[state.current] += incomeOf(state, state.current);
  for (const u of state.units.filter((x) => x.owner === state.current)) {
    u.movesLeft = unitMove(state, u);
    u.hasAttacked = false;
    u.moved = false;
  }
  if (state.happenings) rollHappening(state, state.current);
  return true;
}

// ---------- random events ----------

// The event RNG is derived from the seed, turn and player – the state need not carry generator state
// and the same game yields the same events.
function happeningRng(state, player) {
  return createRng((state.seed * 7919 + state.turn * 131 + player * 17 + 12345) >>> 0);
}

// Rolls for a random event for the player at the start of their turn. Returns the event or null.
export function rollHappening(state, player) {
  if (state.winner !== null || state.turn < HAPPENINGS.fromTurn) return null;
  const rng = happeningRng(state, player);
  if (rng.next() >= HAPPENINGS.chance) return null;
  const cities = state.cities.filter((c) => c.owner === player);
  if (!cities.length) return null;
  const kinds = Object.entries(HAPPENINGS.kinds);
  let roll = rng.next() * kinds.reduce((sum, [, k]) => sum + k.weight, 0);
  let kind = kinds[kinds.length - 1][0];
  for (const [id, k] of kinds) {
    if ((roll -= k.weight) < 0) { kind = id; break; }
  }
  // revolt only in an ordinary city; if the player has none, nothing happens
  const pool = kind === 'revolt' ? cities.filter((c) => !c.capital) : cities;
  if (!pool.length) return null;
  return applyHappening(state, player, kind, rng.pick(pool));
}

// Applies an event of the given kind in the given city (exported for tests).
export function applyHappening(state, player, kind, city) {
  const info = HAPPENINGS.kinds[kind];
  const ev = { type: 'happening', kind, player, cityId: city.id, gold: 0, hits: [], suppressed: false };
  const who = PLAYERS[player].name;
  const where = { by: player, at: [city] };
  if (kind === 'harvest') {
    ev.gold = info.gold;
    state.gold[player] += info.gold;
    addLog(state, `${who}: ${info.name} in ${city.name} (+${info.gold} gold)`, where);
  } else if (kind === 'plague' && hasBuilding(city, 'infirmary')) {
    ev.suppressed = true;
    ev.reason = 'infirmary';
    addLog(state, `${who}: ${info.name} in ${city.name} – the infirmary contained it`, where);
  } else if (kind === 'plague') {
    for (const u of state.units) {
      if (distance(u, city) > 1 || u.hp <= 1) continue;
      u.hp = Math.max(1, u.hp - info.damage);
      ev.hits.push({ unitId: u.id, hp: u.hp });
      if (!where.also) where.also = [];
      where.also.push(u.owner); // the owner of an infected unit also learns about it
    }
    addLog(state, `${who}: ${info.name} in ${city.name}${ev.hits.length ? ` – units infected: ${ev.hits.length}` : ''}`, where);
  } else if (kind === 'revolt') {
    const g = unitAt(state, city.q, city.r);
    if (hasBuilding(city, 'temple')) {
      ev.suppressed = true;
      ev.reason = 'temple';
      addLog(state, `${who}: ${info.name} in ${city.name} – the temple kept the peace`, where);
    } else if (g && g.owner === player) {
      ev.suppressed = true;
      ev.reason = 'garrison';
      addLog(state, `${who}: ${info.name} in ${city.name} – the garrison kept order`, where);
    } else {
      ev.gold = -Math.min(state.gold[player], cityIncome(city, state));
      state.gold[player] += ev.gold;
      addLog(state, `${who}: ${info.name} in ${city.name} – the city paid no taxes this turn (${ev.gold} gold)`, where);
    }
  }
  emit(state, ev);
  return ev;
}

function removeUnit(state, id) {
  state.units = state.units.filter((u) => u.id !== id);
}

function checkWinner(state) {
  for (let p = 0; p < PLAYERS.length; p++) {
    const hasCity = state.cities.some((c) => c.owner === p);
    if (!hasCity) {
      state.winner = (p + 1) % PLAYERS.length;
      addLog(state, `Game over – winner: ${PLAYERS[state.winner].name}`);
      recordHistory(state);
      return;
    }
  }
}

// Chronicle entry. Without `where` the entry is public (game over…). With `where` = { by, at, also, seen }
// `seen` is stored: players who saw the action – its author, players in `also` and those who currently see
// any of the `at` tiles. Without fog everyone sees, so `seen` isn't stored.
function addLog(state, msg, where = null) {
  const entry = { turn: state.turn, msg };
  if (where && state.fog) entry.seen = where.seen || seenBy(state, where);
  state.log.push(entry);
  if (state.log.length > LOG_LIMIT) state.log.shift();
}

const LOG_LIMIT = 50;

function seenBy(state, { by = null, at = [], also = [] }) {
  const seen = new Set(also);
  if (by !== null) seen.add(by);
  PLAYERS.forEach((_, p) => {
    if (seen.has(p)) return;
    const vis = visibleTiles(state, p);
    if (at.some((h) => vis.has(key(h.q, h.r)))) seen.add(p);
  });
  return [...seen].sort();
}

// Chronicle from a player's view (oldest first). Entries the player didn't see are merged into one
// line "Enemy actions in the fog of war (N)" with a count; after game over everything is visible.
export function logFor(state, viewer) {
  const out = [];
  for (const e of state.log) {
    if (!e.seen || e.seen.includes(viewer) || state.winner !== null) {
      out.push({ turn: e.turn, msg: e.msg });
      continue;
    }
    const last = out[out.length - 1];
    if (last && last.hidden && last.turn === e.turn) last.count++;
    else out.push({ turn: e.turn, hidden: true, count: 1 });
  }
  for (const e of out) if (e.hidden) e.msg = `Enemy actions in the fog of war (${e.count})`;
  return out;
}

// ---------- save files ----------
// A save file is JSON: { format, gameVersion, saved, state }. importGame also accepts a bare state
// (the shape kept in localStorage). Imported states are migrated and checked before use.

export const SAVE_FORMAT = 'hex-realm-save';

export function exportGame(state, gameVersion = '', saved = new Date().toISOString()) {
  const clean = cloneState(state);
  clean.events = []; // pending animations don't belong in a file
  return JSON.stringify({ format: SAVE_FORMAT, gameVersion, saved, state: clean });
}

// File name for a save: hex-realm-turn-7-2026-11-09.json
export function saveFileName(state, date = new Date()) {
  return `hex-realm-turn-${state.turn}-${date.toISOString().slice(0, 10)}.json`;
}

// Parses a save file. Returns { state } or { error: 'reason in English' }; never throws.
export function importGame(text) {
  let data;
  try { data = JSON.parse(text); } catch { return { error: 'The file is not valid JSON.' }; }
  if (!data || typeof data !== 'object') return { error: 'The file does not contain a saved game.' };
  if (data.format !== undefined && data.format !== SAVE_FORMAT) return { error: 'This is not a Hex Realm save file.' };
  const raw = data.format === SAVE_FORMAT ? data.state : data;
  if (!raw || typeof raw !== 'object' || typeof raw.version !== 'number') {
    return { error: 'The file does not contain a saved game.' };
  }
  if (raw.version > STATE_VERSION) return { error: 'The save comes from a newer version of the game.' };
  let state;
  let problem = null;
  try {
    state = migrateState(raw);
    if (state) problem = stateProblem(state);
  } catch {
    problem = 'it cannot be read';
  }
  if (problem) return { error: `The saved game is damaged (${problem}).` };
  if (!state) return { error: 'The saved game has an unknown format.' };
  state.events = [];
  return { state };
}

// Basic sanity check of a state's shape; returns a short description of the first problem or null.
export function stateProblem(s) {
  const isInt = (x) => Number.isInteger(x);
  if (!s.tiles || typeof s.tiles !== 'object' || Array.isArray(s.tiles)) return 'no map';
  for (const [k, t] of Object.entries(s.tiles)) {
    if (!t || k !== key(t.q, t.r) || !TERRAIN[t.terrain]) return `bad tile ${k}`;
  }
  if (!Array.isArray(s.cities) || !s.cities.length) return 'no cities';
  if (!Array.isArray(s.units)) return 'no units';
  if (!Array.isArray(s.gold) || s.gold.length !== PLAYERS.length || !s.gold.every(Number.isFinite)) return 'bad gold';
  if (!isInt(s.turn) || s.turn < 1) return 'bad turn';
  if (!isInt(s.current) || s.current < 0 || s.current >= PLAYERS.length) return 'bad current player';
  const validOwner = (o) => o === null || (isInt(o) && o >= 0 && o < PLAYERS.length);
  for (const c of s.cities) {
    if (!c || !s.tiles[key(c.q, c.r)] || !validOwner(c.owner)) return `bad city ${c && c.name}`;
  }
  const taken = new Set();
  for (const u of s.units) {
    if (!u || !UNIT_TYPES[u.type] || !isInt(u.owner) || u.owner < 0 || u.owner >= PLAYERS.length) return 'bad unit';
    const k = key(u.q, u.r);
    if (!s.tiles[k] || !TERRAIN[s.tiles[k].terrain].passable) return `unit ${u.id} off the map`;
    if (taken.has(k)) return `two units on ${k}`;
    taken.add(k);
    if (!Number.isFinite(u.hp) || u.hp <= 0) return `unit ${u.id} has no HP`;
  }
  if (s.winner !== null && s.winner !== undefined && !validOwner(s.winner)) return 'bad winner';
  return null;
}
