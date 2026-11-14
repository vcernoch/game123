// Pure game logic without DOM. The state is a plain JSON object (can be saved).
import { key, neighbors, distance } from './hex.js';
import { generateMap, hasRiverEdge } from './map.js';
import {
  TERRAIN, UNIT_TYPES, PLAYERS, ECONOMY, VISION, DIFFICULTY, BUILDINGS, BUILDING_EFFECTS, RANKS, XP, ROAD_COST, RIVER, FLANK, HIGH_GROUND, CHARGE,
  FACTIONS, NO_FACTION, MAP_SIZES, HAPPENINGS, FORTIFY, TERRITORY, RESOURCES,
  UPGRADES, UPGRADE, DISBAND, SIGHTINGS, RUINS,
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
    sightings: PLAYERS.map(() => []),
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

// ---------- map numbers ----------

export const MAX_SEED = 999999999;

// Map number typed by the player: '' = random (null), digits = that map, anything else = invalid.
// Returns { seed: number|null, ok: boolean }.
export function parseSeed(text) {
  const t = String(text ?? '').trim();
  if (!t) return { seed: null, ok: true };
  if (!/^\d{1,9}$/.test(t)) return { seed: null, ok: false };
  return { seed: Number(t), ok: true };
}

// Options for createGame that start the same game again: same map, sides, difficulty and rules.
export function restartOptions(state) {
  const options = {
    seed: state.seed,
    cols: state.cols,
    rows: state.rows,
    neutralCities: state.cities.length - PLAYERS.length,
    fog: state.fog !== false,
    happenings: !!state.happenings,
    difficulty: state.difficulty || 'normal',
  };
  if (state.factions && state.factions[0]) {
    options.faction = state.factions[0];
    options.aiFaction = state.factions[1];
  }
  return options;
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

export const STATE_VERSION = 18;

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
  if (s.version === 16) {
    s.sightings = PLAYERS.map(() => []); // last-seen markers arrived in version 17
    s.version = 17;
  }
  if (s.version === 17) {
    // ancient ruins arrived in version 18 – old maps simply have none
    s.version = 18;
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
  for (const k of visibleTiles(state, player)) {
    all.add(k);
    learnRuinGone(state.tiles[k], player);
  }
  state.explored[player] = [...all].sort();
}

// Explored tiles as a Set (for fast lookups while drawing).
export function exploredTiles(state, player) {
  if (!state.fog) return new Set(Object.keys(state.tiles));
  return new Set(state.explored ? state.explored[player] : []);
}

// ---------- last-seen markers ----------
// state.sightings[viewer] = [{ unitId, type, owner, q, r, hp, turn, left? }]: enemy units the viewer has
// seen but can't see now. `turn` is when it was last seen; `left` means it was seen walking out of
// sight onto that tile. The UI calls updateSightings after every action and after the enemy turn.

// Updates the viewer's markers. events = what happened since the last update (enemy moves are used
// to place a marker on the tile where a unit walked into the fog). Returns the new list.
export function updateSightings(state, viewer, events = []) {
  if (!state.sightings) state.sightings = PLAYERS.map(() => []);
  if (!state.fog || state.winner !== null) {
    state.sightings[viewer] = [];
    return state.sightings[viewer];
  }
  const visible = visibleTiles(state, viewer);
  const byId = new Map((state.sightings[viewer] || []).map((s) => [s.unitId, s]));
  // units seen walking out of sight: the first fogged tile after the last visible one on their path
  for (const ev of events) {
    if (ev.type !== 'move') continue;
    const u = getUnit(state, ev.unitId);
    if (!u || u.owner === viewer) continue;
    let last = -1;
    ev.path.forEach((p, i) => { if (visible.has(key(p.q, p.r))) last = i; });
    if (last < 0 || last === ev.path.length - 1) continue;
    const at = ev.path[last + 1];
    byId.set(u.id, { unitId: u.id, type: u.type, owner: u.owner, q: at.q, r: at.r, hp: u.hp, turn: state.turn, left: true });
  }
  // units in sight now replace their old marker; markers on tiles in sight with nobody there are dropped
  for (const u of state.units) {
    if (u.owner !== viewer && visible.has(key(u.q, u.r))) byId.delete(u.id);
  }
  const list = [];
  for (const s of byId.values()) {
    if (visible.has(key(s.q, s.r))) continue;
    if (state.turn - s.turn > SIGHTINGS.maxAge) continue;
    list.push(s);
  }
  // remember the units in sight now, so a later update knows where they were
  for (const u of state.units) {
    if (u.owner !== viewer && visible.has(key(u.q, u.r))) {
      list.push({ unitId: u.id, type: u.type, owner: u.owner, q: u.q, r: u.r, hp: u.hp, turn: state.turn });
    }
  }
  state.sightings[viewer] = list;
  return list;
}

// Markers to draw: the viewer's sightings of units out of sight now (tiles in fog only).
export function lastSeen(state, viewer) {
  if (!state.fog || state.winner !== null || !state.sightings) return [];
  const visible = visibleTiles(state, viewer);
  return (state.sightings[viewer] || []).filter((s) => !visible.has(key(s.q, s.r)));
}

// Marker on a tile (for the tooltip), or null.
export function lastSeenAt(state, viewer, q, r) {
  return lastSeen(state, viewer).find((s) => s.q === q && s.r === r) || null;
}

// "Enemy Horseman, last seen this turn (HP 8/10)" – tooltip text for a marker.
export function lastSeenText(state, s) {
  const ago = state.turn - s.turn;
  const when = ago <= 0 ? 'this turn' : ago === 1 ? '1 turn ago' : `${ago} turns ago`;
  const what = `${PLAYERS[s.owner].name}: ${UNIT_TYPES[s.type].name}`;
  return `${what} – ${s.left ? 'seen heading here' : 'last seen here'} ${when} (HP ${s.hp}/${UNIT_TYPES[s.type].hp})`;
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
  } else if (ev.type === 'upgrade') {
    const u = getUnit(state, ev.unitId);
    if (u) { u.type = ev.to; u.hp = ev.hp; delete u.fortified; }
  } else if (ev.type === 'ruin') {
    const t = tileAt(state, ev.q, ev.r);
    if (t) { delete t.ruin; t.ruinGone = [...ev.knownBy]; }
    if (ev.gold) state.gold[ev.player] += ev.gold;
    const u = getUnit(state, ev.unitId);
    if (u && ev.xp !== undefined) { u.xp = ev.xp; u.hp = ev.hp; }
  } else if (ev.type === 'disband') {
    removeUnit(state, ev.unitId); // gold is not replayed, as for recruiting and upgrades
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

// Units that can't capture (scouts) never step into a foreign city – neither to stop nor to pass through.
export function cityForbidden(state, unit, q, r) {
  if (!UNIT_TYPES[unit.type].noCapture) return false;
  const city = cityAt(state, q, r);
  return !!city && city.owner !== unit.owner;
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

// Flanking: other units of the attacker's owner next to the defender (the attacker itself never counts).
export function flankers(state, attacker, defender) {
  return state.units.filter((u) => u.owner === attacker.owner && u.id !== attacker.id && distance(u, defender) === 1);
}

// Attack bonus from flanking (0 … FLANK.perUnit × FLANK.max).
export function flankBonus(state, attacker, defender) {
  return FLANK.perUnit * Math.min(FLANK.max, flankers(state, attacker, defender).length);
}

// High ground: attack bonus for an attacker on hills against a defender below it (0 otherwise).
export function highGroundBonus(state, attacker, defender) {
  const high = (u) => { const t = tileAt(state, u.q, u.r); return !!t && HIGH_GROUND.terrain.includes(t.terrain); };
  return high(attacker) && !high(defender) ? HIGH_GROUND.atkBonus : 0;
}

// Movement points the unit has spent so far this turn.
export function movesSpent(state, unit) {
  return Math.max(0, unitMove(state, unit) - unit.movesLeft);
}

// Can the unit charge (enough movement spent this turn)? Ignores the target's terrain.
export function chargeReady(state, unit) {
  return CHARGE.types.includes(unit.type) && !unit.hasAttacked && movesSpent(state, unit) >= CHARGE.minMoves;
}

// Cavalry charge: attack bonus for a horseman that moved far enough this turn (0 against a defender in forest).
export function chargeBonus(state, attacker, defender) {
  if (!chargeReady(state, attacker)) return 0;
  const t = tileAt(state, defender.q, defender.r);
  return t && CHARGE.blockedBy.includes(t.terrain) ? 0 : CHARGE.atkBonus;
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
      if (!t || !TERRAIN[t.terrain].passable || cityForbidden(state, unit, n.q, n.r)) continue;
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

// Enemy threat for the threat overlay: Map key -> number of enemy units (visible to the player) that
// could attack the tile next turn – walking with full movement, then shooting/striking within range.
// Only explored passable tiles are returned, so the overlay doesn't reveal unknown land.
// `know` ({ sees(q, r), knows(q, r) }) replaces the player's fog view – the AI passes its own knowledge.
export function threatTiles(state, player, know = null) {
  const out = new Map();
  if (!know) {
    const visible = visibleTiles(state, player);
    const explored = exploredTiles(state, player);
    know = { sees: (q, r) => visible.has(key(q, r)), knows: (q, r) => explored.has(key(q, r)) };
  }
  for (const e of state.units) {
    if (e.owner === player || !know.sees(e.q, e.r)) continue;
    const ghost = { ...e, movesLeft: unitMove(state, e) };
    const spots = [key(e.q, e.r), ...searchMoves(state, ghost).result.keys()];
    const range = UNIT_TYPES[e.type].range;
    const hit = new Set();
    for (const k of spots) {
      const [q, r] = k.split(',').map(Number);
      for (let dq = -range; dq <= range; dq++) {
        for (let dr = Math.max(-range, -dq - range); dr <= Math.min(range, -dq + range); dr++) {
          if (know.knows(q + dq, r + dr) && isPassable(state, q + dq, r + dr)) hit.add(key(q + dq, r + dr));
        }
      }
    }
    for (const t of hit) out.set(t, (out.get(t) || 0) + 1);
  }
  return out;
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
  if (cityForbidden(state, unit, q, r)) return null;
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
      if (!explored.has(k) || !isPassable(state, n.q, n.r) || blocked(n.q, n.r) || cityForbidden(state, unit, n.q, n.r)) continue;
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

// ---------- army overview ----------
// Order of the statuses in the army list: units that still need orders come first.
export const ARMY_STATUS = {
  ready:     { order: 0, label: 'ready' },
  marching:  { order: 1, label: 'marching' },
  fortified: { order: 2, label: 'fortified' },
  done:      { order: 3, label: 'done' },
};

// What a unit is doing this turn: ready (can still move or attack), marching (has a move order and no
// moves left), fortified, or done.
export function unitStatus(state, unit) {
  if (unit.fortified) return 'fortified';
  if (unit.movesLeft > 0 || attackTargets(state, unit).length > 0) return 'ready'; // same rule as activeUnits / Tab
  return unit.goto ? 'marching' : 'done';
}

// Where a unit stands, in words for the army list: "in Oakford" or "2 tiles from Oakford". Only cities
// the player has explored are named (an own city is always explored), so nothing leaks through the fog.
export function unitWhere(state, unit, explored = exploredTiles(state, unit.owner)) {
  let best = null;
  let bestD = Infinity;
  for (const c of state.cities) {
    if (!explored.has(key(c.q, c.r))) continue;
    const d = distance(unit, c);
    // ties: prefer an own city, then the lower id (stable)
    if (d < bestD || (d === bestD && c.owner === unit.owner && best.owner !== unit.owner)) { best = c; bestD = d; }
  }
  if (!best) return 'far from any city';
  if (bestD === 0) return `in ${best.name}`;
  return `${bestD} tile${bestD === 1 ? '' : 's'} from ${best.name}`;
}

// The player's units for the army list: [{ id, type, name, symbol, hp, maxHp, rank, status, where }],
// units that still need orders first, then marching, fortified and done; by id inside a group.
// counts = number of units per status.
export function armyOverview(state, player) {
  const explored = exploredTiles(state, player);
  const rows = state.units.filter((u) => u.owner === player).map((u) => {
    const t = UNIT_TYPES[u.type];
    return {
      id: u.id, type: u.type, name: t.name, symbol: t.symbol, hp: u.hp, maxHp: t.hp,
      rank: rankOf(u), status: unitStatus(state, u), where: unitWhere(state, u, explored),
    };
  });
  rows.sort((a, b) => ARMY_STATUS[a.status].order - ARMY_STATUS[b.status].order || a.id - b.id);
  const counts = Object.fromEntries(Object.keys(ARMY_STATUS).map((s) => [s, rows.filter((r) => r.status === s).length]));
  return { rows, counts };
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
  const flank = flankBonus(state, attacker, defender);
  const high = highGroundBonus(state, attacker, defender);
  const charge = chargeBonus(state, attacker, defender);
  const atk = attackPower(state, attacker, defender) * hpFactor(attacker) * (1 + flank + high + charge);
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
  return { damage, counter, kills: defenderHp === 0, dies: attacker.hp - counter <= 0, flank, high, charge };
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
  if (tileAt(state, q, r).ruin && state.winner === null) exploreRuin(state, unit);
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

// ---------- unit upgrades ----------

// Price of upgrading the unit to type `to` in the city it stands in (see UPGRADE in rules.js).
export function upgradeCost(state, unit, to) {
  const city = cityAt(state, unit.q, unit.r);
  if (!city) return null;
  return Math.max(UPGRADE.min, unitCost(state, city, to) - UNIT_TYPES[unit.type].cost + UPGRADE.fee);
}

// Upgrade options of a unit right now: [{ type, cost, affordable }]. Empty unless the unit is the current
// player's, stands in an own city and hasn't moved or attacked this turn (a fortified unit may still upgrade).
export function upgradeOptions(state, unit) {
  if (!unit || unit.owner !== state.current || state.winner !== null || unit.moved || unit.hasAttacked) return [];
  const city = cityAt(state, unit.q, unit.r);
  if (!city || city.owner !== unit.owner) return [];
  return (UPGRADES[unit.type] || []).map((type) => {
    const cost = upgradeCost(state, unit, type);
    return { type, cost, affordable: state.gold[unit.owner] >= cost };
  });
}

// Retrains the unit into type `to`: keeps XP and the HP share (rounded up), ends its turn. Returns true/false.
export function upgradeUnit(state, unitId, to) {
  const unit = getUnit(state, unitId);
  const opt = upgradeOptions(state, unit).find((o) => o.type === to);
  if (!opt || !opt.affordable) return false;
  const from = unit.type;
  state.gold[unit.owner] -= opt.cost;
  unit.hp = Math.max(1, Math.ceil((unit.hp / UNIT_TYPES[from].hp) * UNIT_TYPES[to].hp));
  unit.type = to;
  unit.movesLeft = 0;
  unit.hasAttacked = true;
  delete unit.fortified;
  delete unit.goto;
  emit(state, { type: 'upgrade', unitId: unit.id, from, to, hp: unit.hp });
  const city = cityAt(state, unit.q, unit.r);
  addLog(state, `${PLAYERS[unit.owner].name}: ${UNIT_TYPES[from].name} retrained as ${UNIT_TYPES[to].name} (${city.name})`,
    { by: unit.owner, at: [city] });
  return true;
}

// ---------- disbanding ----------

// Gold returned for disbanding the unit where it stands now: a share of the base price in an own city, else 0.
export function disbandRefund(state, unit) {
  const city = cityAt(state, unit.q, unit.r);
  if (!city || city.owner !== unit.owner) return 0;
  return Math.floor(UNIT_TYPES[unit.type].cost * DISBAND.refundShare);
}

// Whether the unit can be disbanded right now: an own unit of the current player while the game runs.
export function canDisband(state, unit) {
  return !!unit && unit.owner === state.current && state.winner === null;
}

// Dismisses the unit (see DISBAND in rules.js). Returns the refunded gold, or false if not allowed.
export function disbandUnit(state, unitId) {
  const unit = getUnit(state, unitId);
  if (!canDisband(state, unit)) return false;
  const refund = disbandRefund(state, unit);
  state.gold[unit.owner] += refund;
  removeUnit(state, unit.id);
  emit(state, { type: 'disband', unitId: unit.id, owner: unit.owner, refund, q: unit.q, r: unit.r });
  const city = cityAt(state, unit.q, unit.r);
  addLog(state, `${PLAYERS[unit.owner].name}: disbanded ${UNIT_TYPES[unit.type].name}${refund ? ` (${city.name}, +${refund} gold)` : ''}`,
    { by: unit.owner, at: [unit] });
  return refund;
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

// ---------- ancient ruins ----------
// tile.ruin = an unexplored ruin. Once explored it is gone, and tile.ruinGone lists the players who know
// that (the explorer and whoever saw it happen; others learn it when they next see the tile). Until
// then a player still believes the ruin is there, so a ruin looted in the fog doesn't give anything away.

function learnRuinGone(tile, player) {
  if (tile && tile.ruinGone && !tile.ruinGone.includes(player)) {
    tile.ruinGone = [...tile.ruinGone, player].sort();
  }
}

// Does the viewer believe there is an unexplored ruin on the tile? (They must also have explored it to know.)
export function ruinBelieved(state, q, r, viewer) {
  const t = tileAt(state, q, r);
  return !!t && (!!t.ruin || (!!t.ruinGone && !t.ruinGone.includes(viewer)));
}

// The reward of a ruin depends only on the seed and the tile, so the same game gives the same rewards.
export function ruinKind(state, q, r) {
  const rng = createRng((state.seed * 7349 + q * 911 + r * 397 + 4242) >>> 0);
  const kinds = Object.entries(RUINS.kinds);
  let roll = rng.next() * kinds.reduce((sum, [, k]) => sum + k.weight, 0);
  for (const [id, k] of kinds) {
    if ((roll -= k.weight) < 0) return id;
  }
  return kinds[kinds.length - 1][0];
}

// Tile next to the unit where ruin recruits can appear (free land, no city, no other ruin), or null.
function recruitSpot(state, unit) {
  return neighbors(unit.q, unit.r).find((n) => isFree(state, n.q, n.r) && !cityAt(state, n.q, n.r)
    && !tileAt(state, n.q, n.r).ruin) || null;
}

// The unit standing on a ruin explores it. Returns the 'ruin' event or null when there is no ruin.
export function exploreRuin(state, unit) {
  const tile = tileAt(state, unit.q, unit.r);
  if (!tile || !tile.ruin) return null;
  let kind = ruinKind(state, tile.q, tile.r);
  if (kind === 'map' && !state.fog) kind = 'treasure'; // nothing to reveal without fog
  const spot = kind === 'recruits' ? recruitSpot(state, unit) : null;
  if (kind === 'recruits' && !spot) kind = 'treasure';
  const info = RUINS.kinds[kind];
  const player = unit.owner;
  const knownBy = seenBy(state, { by: player, at: [tile] });
  const ev = { type: 'ruin', unitId: unit.id, player, q: tile.q, r: tile.r, kind, gold: 0, knownBy };
  delete tile.ruin;
  tile.ruinGone = state.fog ? knownBy : PLAYERS.map((_, p) => p);
  ev.knownBy = tile.ruinGone;
  let detail = '';
  if (kind === 'treasure') {
    ev.gold = info.gold;
    state.gold[player] += info.gold;
    detail = ` (+${info.gold} gold)`;
  } else if (kind === 'map') {
    const all = new Set(state.explored[player]);
    const before = all.size;
    for (const t of Object.values(state.tiles)) if (distance(t, tile) <= info.radius) all.add(key(t.q, t.r));
    state.explored[player] = [...all].sort();
    ev.revealed = all.size - before;
    detail = ` (${ev.revealed} tiles mapped)`;
  }
  const who = PLAYERS[player].name;
  addLog(state, `${who}: ${UNIT_TYPES[unit.type].name} explored ancient ruins – ${info.name}${detail}`, { seen: knownBy });
  if (kind === 'training') {
    gainXp(state, unit, info.xp);
    ev.xp = unit.xp;
    ev.hp = unit.hp;
  }
  emit(state, ev);
  if (kind === 'recruits') spawnUnit(state, info.unit, player, spot.q, spot.r);
  return ev;
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

// ---------- enemy turn report ----------
// What the enemy did to the viewer during its turn, for the banner at the start of the viewer's turn.
// before = state before the enemy turn, events = what happened in it. The events are replayed on a copy,
// so units recruited during the turn are known too. Only things the viewer always knows about are
// counted (attacks on own units, lost cities), so nothing hidden in the fog leaks out.
// Returns { lost: { type: count }, wounded, fell, citiesLost: [phrases like 'the city Oakford'], spots: [{ q, r, kind }] }.
export function turnReport(before, events, viewer) {
  const st = cloneState(before);
  const rep = { lost: {}, wounded: 0, fell: 0, citiesLost: [], spots: [] };
  const wounded = new Set();
  for (const ev of events) {
    if (ev.type === 'attack') {
      const a = getUnit(st, ev.attackerId);
      const d = getUnit(st, ev.defenderId);
      if (a && d && d.owner === viewer && a.owner !== viewer) {
        if (ev.killed) {
          rep.lost[d.type] = (rep.lost[d.type] || 0) + 1;
          rep.spots.push({ q: d.q, r: d.r, kind: 'lost' });
          wounded.delete(d.id);
        } else {
          wounded.add(d.id);
        }
        if (ev.died) rep.fell++;
      }
    } else if (ev.type === 'capture') {
      const c = st.cities.find((x) => x.id === ev.cityId);
      if (c && c.owner === viewer && ev.owner !== viewer) {
        rep.citiesLost.push(c.name === 'Your Capital' ? 'your capital' : `the city ${c.name}`);
        rep.spots.push({ q: c.q, r: c.r, kind: 'city' });
      }
    } else if (ev.type === 'disband') {
      wounded.delete(ev.unitId);
    }
    applyEvent(st, ev);
  }
  rep.wounded = wounded.size;
  return rep;
}

// "Warrior ×2, Archer and the city Oakford" style list.
function joinList(items) {
  return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

// One sentence for the banner; '' when the enemy didn't touch the viewer.
export function reportText(rep) {
  const losses = Object.entries(rep.lost).map(([t, n]) => `${UNIT_TYPES[t].name}${n > 1 ? ` ×${n}` : ''}`);
  losses.push(...rep.citiesLost);
  const parts = [];
  if (losses.length) parts.push(`you lost ${joinList(losses)}.`);
  if (rep.wounded) parts.push(`${rep.wounded} unit${rep.wounded === 1 ? ' was' : 's were'} wounded.`);
  if (rep.fell) parts.push(`${rep.fell} attacker${rep.fell === 1 ? '' : 's'} fell to your counterattacks.`);
  if (!parts.length) return '';
  return `Enemy turn: ${parts.join(' ')}`;
}

// Whether the report contains a loss (the banner turns red).
export function reportIsBad(rep) {
  return Object.keys(rep.lost).length > 0 || rep.citiesLost.length > 0 || rep.wounded > 0;
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
