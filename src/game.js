// Pure game logic without DOM. The state is a plain JSON object (can be saved).
import { key, neighbors, distance } from './hex.js';
import { generateMap, hasRiverEdge } from './map.js';
import {
  TERRAIN, UNIT_TYPES, PLAYERS, ECONOMY, VISION, DIFFICULTY, BUILDINGS, BUILDING_EFFECTS, RANKS, XP, ROAD_COST, RIVER, FLANK, HIGH_GROUND, CHARGE, SKIRMISH, PURSUIT, INSPIRE,
  FACTIONS, NO_FACTION, MAP_SIZES, HAPPENINGS, FORTIFY, TERRITORY, RESOURCES,
  UPGRADES, UPGRADE, DISBAND, SIGHTINGS, RUINS, EXPLORE, PILLAGE, REPAIR, ROADWORK, SENTRY, VOLLEY, FORCED_MARCH, ANIM_SPEEDS, HEROES, MILESTONES, ADVISOR, GROWTH, TRADE, UNREST, FOCUS, LEVY, PERKS, SEASONS,
} from './rules.js';
import { createRng } from './rng.js';

export function createGame({
  seed = 1, size = null, cols = 14, rows = 10, neutralCities = 4, fog = true, difficulty = 'normal',
  faction = 'kingdom', aiFaction = null, happenings = true, seasons = true,
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
  for (const c of cities) { c.buildings = []; c.size = 1; c.growth = 0; }
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
    seasons: !!seasons,
    zoc: true,
    difficulty,
    factions: [faction, aiFaction],
    history: [],
    stats: emptyStats(),
    explored: PLAYERS.map(() => []),
    sightings: PLAYERS.map(() => []),
    fallen: [],
    milestones: [],
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
    seasons: !!state.seasons,
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

export const STATE_VERSION = 35;

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
  if (s.version === 18) {
    // auto-explore arrived in version 19 – a missing `explore` means no explore order
    s.version = 19;
  }
  if (s.version === 19) {
    // pillage arrived in version 20 – a missing `tile.pillagedUntil` means the resource works
    s.version = 20;
  }
  if (s.version === 20) {
    // rally points arrived in version 21 – a missing `city.rally` means none
    s.version = 21;
  }
  if (s.version === 21) {
    // road building arrived in version 22 – a missing `tile.roadBuilt` means the road came with the map
    s.version = 22;
  }
  if (s.version === 22) {
    // sentry arrived in version 23 – a missing `unit.sentry` means not on watch
    s.version = 23;
  }
  if (s.version === 23) {
    // heroes arrived in version 24: veterans already in the field get their names, kills start at 0
    s.fallen = [];
    for (const u of [...s.units].sort((a, b) => a.id - b.id)) nameHero(s, u);
    s.version = 24;
  }
  if (s.version === 24) {
    // the war timeline arrived in version 25 – it starts empty for games already in progress
    s.milestones = [];
    s.version = 25;
  }
  if (s.version === 25) {
    // city growth arrived in version 26 – every city starts at size 1
    for (const c of s.cities) { c.size = 1; c.growth = 0; }
    s.version = 26;
  }
  if (s.version === 26) {
    // unrest arrived in version 27 – a missing `city.unrest` means the city is calm
    s.version = 27;
  }
  if (s.version === 27) {
    // city focus arrived in version 28 – a missing `city.focus` means balanced
    s.version = 28;
  }
  if (s.version === 28) {
    // recruit orders arrived in version 29 – a missing `city.order` means none
    s.version = 29;
  }
  if (s.version === 29) {
    // forced march arrived in version 30 – a missing `unit.marched` means the unit didn't march
    s.version = 30;
  }
  if (s.version === 30) {
    // hit and run arrived in version 31 – a missing `unit.raided` means the unit isn't pulling back
    s.version = 31;
  }
  if (s.version === 31) {
    // pursuit arrived in version 32 – a missing `unit.pursuit` means the unit can't advance
    s.version = 32;
  }
  if (s.version === 32) {
    // chronicle places arrived in version 33 – older entries simply have none
    s.version = 33;
  }
  if (s.version === 33) {
    // perks arrived in version 34 – a unit without `perks` simply has a choice to make for each rank
    s.version = 34;
  }
  if (s.version === 34) {
    s.seasons = false; // seasons arrived in version 35 – a game in progress continues with the rules it started with
    s.version = 35;
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
    look(u.q, u.r, UNIT_TYPES[u.type].sight + (onHills ? VISION.hillsBonus : 0) + perkSight(u));
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
    if (u) { u.q = end.q; u.r = end.r; delete u.fortified; delete u.sentry; delete u.pursuit; }
  } else if (ev.type === 'attack') {
    const a = getUnit(state, ev.attackerId);
    const d = getUnit(state, ev.defenderId);
    if (d) {
      d.hp = ev.defenderHp ?? d.hp - ev.damage;
      d.xp = ev.defenderXp ?? d.xp;
      if (ev.defenderName) d.name = ev.defenderName;
      if (ev.defenderKills) d.kills = ev.defenderKills;
    }
    if (a) {
      delete a.fortified;
      delete a.sentry;
      a.hasAttacked = true;
      a.movesLeft = ev.movesLeft ?? 0;
      if (a.movesLeft > 0) a.raided = true;
      if (ev.pursuit) a.pursuit = { q: ev.pursuit.q, r: ev.pursuit.r };
      a.hp = ev.attackerHp ?? a.hp - ev.counter;
      a.xp = ev.attackerXp ?? a.xp;
      if (ev.attackerName) a.name = ev.attackerName;
      if (ev.attackerKills) a.kills = ev.attackerKills;
    }
    if (ev.killed) removeUnit(state, ev.defenderId);
    if (ev.died) removeUnit(state, ev.attackerId);
  } else if (ev.type === 'march') {
    const u = getUnit(state, ev.unitId);
    if (u) { u.marched = true; u.moved = true; u.hp = ev.hp; u.movesLeft = ev.movesLeft; delete u.fortified; delete u.sentry; }
  } else if (ev.type === 'fortify') {
    const u = getUnit(state, ev.unitId);
    if (u) { u.fortified = true; delete u.sentry; }
  } else if (ev.type === 'perk') {
    const u = getUnit(state, ev.unitId);
    if (u && !hasPerk(u, ev.perk)) u.perks = [...perksOf(u), ev.perk];
  } else if (ev.type === 'spawn') {
    state.units.push({ ...ev.unit });
  } else if (ev.type === 'capture') {
    const c = state.cities.find((x) => x.id === ev.cityId);
    if (c) {
      c.owner = ev.owner;
      delete c.rally;
      delete c.focus;
      delete c.order;
      if (ev.size) { c.size = ev.size; c.growth = 0; }
      if (ev.unrest) c.unrest = ev.unrest; else delete c.unrest;
    }
  } else if (ev.type === 'focus') {
    const c = state.cities.find((x) => x.id === ev.cityId);
    if (c) { if (ev.focus === 'balanced') delete c.focus; else c.focus = ev.focus; }
  } else if (ev.type === 'order') {
    const c = state.cities.find((x) => x.id === ev.cityId);
    if (c) delete c.order;
  } else if (ev.type === 'calm') {
    const c = state.cities.find((x) => x.id === ev.cityId);
    if (c) delete c.unrest;
  } else if (ev.type === 'grow' || ev.type === 'levy') {
    const c = state.cities.find((x) => x.id === ev.cityId);
    if (c) { c.size = ev.size; c.growth = 0; }
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
    if (u) { u.type = ev.to; u.hp = ev.hp; delete u.fortified; delete u.sentry; }
  } else if (ev.type === 'ruin') {
    const t = tileAt(state, ev.q, ev.r);
    if (t) { delete t.ruin; t.ruinGone = [...ev.knownBy]; }
    if (ev.gold) state.gold[ev.player] += ev.gold;
    const u = getUnit(state, ev.unitId);
    if (u && ev.xp !== undefined) { u.xp = ev.xp; u.hp = ev.hp; if (ev.name) u.name = ev.name; }
  } else if (ev.type === 'pillage') {
    const t = tileAt(state, ev.q, ev.r);
    if (t) t.pillagedUntil = ev.until;
    const u = getUnit(state, ev.unitId);
    if (u) { u.movesLeft = 0; u.hasAttacked = true; delete u.fortified; delete u.sentry; }
    if (ev.gold) state.gold[ev.player] += ev.gold;
  } else if (ev.type === 'repair') {
    const t = tileAt(state, ev.q, ev.r);
    if (t) delete t.pillagedUntil;
    const u = getUnit(state, ev.unitId);
    if (u) { u.movesLeft = 0; u.hasAttacked = true; delete u.fortified; delete u.sentry; }
    if (ev.gold) state.gold[ev.player] -= ev.gold;
  } else if (ev.type === 'road') {
    const t = tileAt(state, ev.q, ev.r);
    if (t) { t.road = true; t.roadBuilt = true; }
    const u = getUnit(state, ev.unitId);
    if (u) { u.movesLeft = 0; u.hasAttacked = true; delete u.fortified; delete u.sentry; }
    if (ev.gold) state.gold[ev.player] -= ev.gold;
  } else if (ev.type === 'volley') {
    const u = getUnit(state, ev.unitId);
    if (u) u.hp = ev.hp;
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
  // scouts never enter foreign cities; a skirmisher pulling back after its attack can't ride into one either
  if (!UNIT_TYPES[unit.type].noCapture && !unit.raided) return false;
  const city = cityAt(state, q, r);
  return !!city && city.owner !== unit.owner;
}

// ---------- hit and run ----------

export function isSkirmisher(unit) {
  return !!unit && SKIRMISH.types.includes(unit.type);
}

// Move points a unit keeps after attacking (0 for all but surviving skirmishers).
export function movesAfterAttack(state, unit) {
  if (!isSkirmisher(unit)) return 0;
  return Math.max(0, unit.movesLeft - SKIRMISH.moveCost);
}

// Can the unit still pull back after its attack this turn?
export function canWithdraw(state, unit) {
  return !!unit && !!unit.raided && unit.movesLeft > 0 && reachable(state, unit).size > 0;
}

// ---------- pursuit ----------

export function isPursuer(unit) {
  return !!unit && PURSUIT.types.includes(unit.type);
}

// The tile a pursuer may advance into after destroying the defender there, or null.
function pursuitFrom(state, attacker, defender) {
  if (!isPursuer(attacker) || distance(attacker, defender) !== 1) return null;
  if (!isPassable(state, defender.q, defender.r) || cityAt(state, defender.q, defender.r)) return null;
  return { q: defender.q, r: defender.r };
}

// Would destroying `defender` let `attacker` advance into its tile? (for the attack preview)
export function pursuesInto(state, attacker, defender) {
  return !!pursuitFrom(state, attacker, defender);
}

// The freed tile the unit can still advance into right now ({q, r}), or null.
export function pursuitTile(state, unit) {
  const p = unit && unit.pursuit;
  if (!p || unit.owner !== state.current || state.winner !== null) return null;
  if (distance(unit, p) !== 1 || !isFree(state, p.q, p.r) || cityAt(state, p.q, p.r)) return null;
  return p;
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
  if (cityUnrest(city) > 0) return 0; // a restless city pays nothing to its new owner
  const base = city.capital ? ECONOMY.capitalIncome : ECONOMY.cityIncome;
  const faction = state && city.owner !== null ? factionOf(state, city.owner).cityIncome || 0 : 0;
  const market = hasBuilding(city, 'market') ? BUILDING_EFFECTS.marketIncome : 0;
  const temple = hasBuilding(city, 'temple') ? BUILDING_EFFECTS.templeIncome : 0;
  const mines = state ? cityResources(state, city).filter((t) => t.resource === 'gold' && !isPillaged(state, t)).length * RESOURCES.gold.income : 0;
  const trade = state && tradeRoute(state, city) === 'linked' ? TRADE.income : 0;
  const harvest = state ? harvestGold(state, city) : 0;
  return Math.max(0, base + faction + market + temple + mines + (citySize(city) - 1) * GROWTH.income + trade + harvest + cityFocus(city).gold);
}

// ---------- city focus ----------

// Focus id of a city ('balanced' when missing, unknown or neutral).
export function focusOf(city) {
  return city.owner !== null && FOCUS.kinds[city.focus] ? city.focus : 'balanced';
}

// Focus settings of a city (see FOCUS in rules.js).
export function cityFocus(city) {
  return FOCUS.kinds[focusOf(city)];
}

// The current player sets the focus of an own city. Returns false when nothing changed.
export function setFocus(state, cityId, focus) {
  const city = state.cities.find((c) => c.id === cityId);
  if (!city || !FOCUS.kinds[focus] || city.owner !== state.current || state.winner !== null) return false;
  if (focusOf(city) === focus) return false;
  if (focus === 'balanced') delete city.focus; else city.focus = focus;
  emit(state, { type: 'focus', cityId, focus });
  return true;
}

// Focus line for panels and tooltips.
export function focusText(city) {
  const f = cityFocus(city);
  return `${f.icon} Focus: ${f.name} (${f.desc})`;
}

// ---------- trade routes ----------

// Breadth-first search from the city along road tiles to an own capital. Own cities are links, neutral and
// enemy cities are not; with `blockers` a tile with an enemy unit breaks the chain. `seen` (optional) collects
// the visited road tiles – only those can matter for this route.
function roadLinkedToCapital(state, city, blockers, seen = new Set()) {
  seen.add(key(city.q, city.r));
  const queue = [city];
  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i];
    for (const n of neighbors(cur.q, cur.r)) {
      const k = key(n.q, n.r);
      if (seen.has(k)) continue;
      const t = state.tiles[k];
      if (!t) continue;
      const c = t.road || cityAt(state, n.q, n.r) ? cityAt(state, n.q, n.r) : null;
      if (!t.road && !c) continue;
      seen.add(k);
      if (c && c.owner !== city.owner) continue;
      if (blockers && blockers.has(k)) continue;
      if (c && c.capital) return true;
      queue.push(n);
    }
  }
  return false;
}

// Trade route state of a city: null (neutral), 'hub' (an own capital), 'linked' (earns TRADE.income),
// 'cut' (the road exists but enemy units stand on it) or 'none' (no road chain to an own capital).
export function tradeRoute(state, city) {
  if (city.owner === null) return null;
  if (city.capital) return 'hub';
  if (roadLinkedToCapital(state, city, tradeBlockers(state, city.owner))) return 'linked';
  return roadLinkedToCapital(state, city, null) ? 'cut' : 'none';
}

// Tiles with units hostile to `player` (optionally leaving one unit out).
function tradeBlockers(state, player, skipId = null) {
  return new Set(state.units.filter((u) => u.owner !== player && u.id !== skipId).map((u) => key(u.q, u.r)));
}

// Foreign cities whose working trade route `unit` would cut by standing on tile q,r (the unit itself
// doesn't count where it stands now). Used by the AI to pick blockade tiles.
export function routesCutBy(state, unit, q, r) {
  return tradeTargets(state, unit).filter((x) => x.seen.has(key(q, r)) && cutsAt(state, x, q, r)).map((x) => x.city);
}

// Foreign cities with a working route (not counting `unit`) and the road tiles their search touched.
export function tradeTargets(state, unit) {
  const out = [];
  for (const c of state.cities) {
    if (c.owner === null || c.owner === unit.owner || c.capital) continue;
    const blockers = tradeBlockers(state, c.owner, unit.id);
    const seen = new Set();
    if (roadLinkedToCapital(state, c, blockers, seen)) out.push({ city: c, blockers, seen });
  }
  return out;
}

// Would a unit on q,r cut the route of target x (from tradeTargets)?
export function cutsAt(state, x, q, r) {
  const t = tileAt(state, q, r);
  if (!t || !t.road || cityAt(state, q, r)) return false;
  const blockers = new Set(x.blockers);
  blockers.add(key(q, r));
  return !roadLinkedToCapital(state, x.city, blockers);
}

// Trade route line for the city panel and tooltip (only for the viewer's own cities).
export function tradeText(state, city) {
  const r = tradeRoute(state, city);
  if (r === 'hub') return 'Trade hub: roads bring gold from linked cities';
  if (r === 'linked') return `Trade route to the capital: +${TRADE.income} gold${cityUnrest(city) ? ' once the unrest ends' : ''}`;
  if (r === 'cut') return 'Trade route cut: an enemy blocks the road';
  if (r === 'none') return 'No trade route: no road to the capital';
  return '';
}

// Own cities whose trade route is cut by enemy units (for the advisor and the turn report).
export function cutRoutes(state, player) {
  return state.cities.filter((c) => c.owner === player && tradeRoute(state, c) === 'cut');
}

// ---------- unrest ----------
// A city taken from another player resists its new owner: no income and no growth while `city.unrest` > 0.
// Neutral cities join willingly. The counter drops at the start of each of the owner's turns – faster
// with an own unit inside – so a conqueror who leaves a garrison gets the city working sooner.

// Owner's turns of unrest left (0 = calm; a missing field counts as calm).
export function cityUnrest(city) {
  return Number.isInteger(city.unrest) && city.unrest > 0 ? city.unrest : 0;
}

// How much the unrest drops at the start of the owner's next turn.
export function unrestCalm(state, city) {
  const g = unitAt(state, city.q, city.r);
  return g && g.owner === city.owner ? UNREST.garrisonCalm : 1;
}

// Owner's turns until the city is calm if the garrison situation stays as it is now (0 = calm).
export function unrestTurnsLeft(state, city) {
  return Math.ceil(cityUnrest(city) / unrestCalm(state, city));
}

// Unrest line for panels and tooltips ('' for a calm city).
export function unrestText(state, city) {
  if (!cityUnrest(city)) return '';
  const left = unrestTurnsLeft(state, city);
  const when = `calms in ${left} turn${left === 1 ? '' : 's'}`;
  const g = unitAt(state, city.q, city.r);
  const how = g && g.owner === city.owner ? 'the garrison keeps order' : 'a garrison would calm it faster';
  return `Unrest: no income, no growth · ${when} (${how})`;
}

// At the start of a player's turn their restless cities calm down (before growth and income, so a city
// that becomes calm pays the same turn). Returns the cities that became calm.
export function calmCities(state, player) {
  if (state.winner !== null) return [];
  const calmed = [];
  for (const city of state.cities.filter((c) => c.owner === player && cityUnrest(c) > 0)) {
    city.unrest = Math.max(0, cityUnrest(city) - unrestCalm(state, city));
    if (city.unrest > 0) continue;
    delete city.unrest;
    calmed.push(city);
    emit(state, { type: 'calm', cityId: city.id, player });
    addLog(state, `${PLAYERS[player].name}: ${city.name} accepted its new rulers`, { by: player, at: [city] });
  }
  return calmed;
}

// ---------- city growth ----------

// City size 1..GROWTH.maxSize (a missing size counts as 1).
export function citySize(city) {
  return Number.isInteger(city.size) ? Math.min(GROWTH.maxSize, Math.max(1, city.size)) : 1;
}

// Owner's turns still needed to reach the next size (null at the largest size or for a neutral city).
// A commerce focus halts growth (null too); a granary halves the wait.
export function growthLeft(city) {
  const size = citySize(city);
  const rate = cityFocus(city).growth;
  if (city.owner === null || size >= GROWTH.maxSize || !rate) return null;
  return Math.max(1, Math.ceil((GROWTH.turns[size - 1] - (city.growth || 0)) / rate));
}

// An enemy unit next to the city halts its growth (a siege).
export function citySieged(state, city) {
  if (city.owner === null) return false;
  return neighbors(city.q, city.r).some((n) => {
    const u = unitAt(state, n.q, n.r);
    return u && u.owner !== city.owner;
  });
}

// Growth text for panels and tooltips.
export function growthText(state, city) {
  const size = citySize(city);
  const base = `Size ${size}/${GROWTH.maxSize}`;
  if (city.owner === null) return `${base} · neutral cities don't grow`;
  if (size >= GROWTH.maxSize) return `${base} · fully grown`;
  if (cityUnrest(city)) return `${base} · growth halted: unrest`;
  if (citySieged(state, city)) return `${base} · growth halted: enemy at the gates`;
  if (!cityFocus(city).growth) return `${base} · growth halted: ${cityFocus(city).name.toLowerCase()} focus`;
  const left = growthLeft(city);
  return `${base} · grows in ${left} turn${left === 1 ? '' : 's'}`;
}

// At the start of a player's turn their cities grow (before income, so a new size pays at once).
// Returns the cities that grew.
export function growCities(state, player) {
  if (state.winner !== null) return [];
  const grown = [];
  for (const city of state.cities.filter((c) => c.owner === player)) {
    const size = citySize(city);
    const rate = cityFocus(city).growth;
    if (size >= GROWTH.maxSize || !rate || citySieged(state, city) || cityUnrest(city)) continue;
    city.growth = (city.growth || 0) + rate;
    if (city.growth < GROWTH.turns[size - 1]) continue;
    city.size = size + 1;
    city.growth = 0;
    grown.push(city);
    emit(state, { type: 'grow', cityId: city.id, player, size: city.size });
    addLog(state, `${PLAYERS[player].name}: ${city.name} grew to size ${city.size}`, { by: player, at: [city] });
  }
  return grown;
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
// A fortress focus adds its bonus (siege engines ignore both, see defenseValue).
export function cityDefenseMult(city) {
  return (1 + CITY_DEF_BONUS) * (hasBuilding(city, 'walls') ? 1 + BUILDING_EFFECTS.wallsDefense : 1) * (1 + cityFocus(city).defBonus);
}

// Unit cost when recruiting in the given city (barracks and the owner's faction make it cheaper).
export function unitCost(state, city, type) {
  let discount = hasBuilding(city, 'barracks') ? BUILDING_EFFECTS.barracksDiscount : 0;
  const fd = city.owner !== null ? factionOf(state, city.owner).unitDiscount : null;
  if (fd && fd[type]) discount += fd[type];
  for (const t of cityResources(state, city).filter((x) => !isPillaged(state, x))) discount += (RESOURCES[t.resource].discount || {})[type] || 0;
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
    size: citySize(city),
    unrest: cityUnrest(city),
    focus: focusOf(city),
  };
}

// Cost of a step from tile `from` to the neighboring tile `to` (roads are cheaper, otherwise the target tile's terrain).
// unit (optional) determines the faction – Forest Folk move through forest more cheaply.
export function stepCost(state, from, to, unit = null) {
  const a = tileAt(state, from.q, from.r);
  const b = tileAt(state, to.q, to.r);
  if (a && b && a.road && b.road) return ROAD_COST; // road across a river = bridge
  const river = riverBetween(state, from, to) ? riverCrossCost(state) : 0;
  let cost = TERRAIN[b.terrain].cost;
  if (unit && b.terrain === 'forest') {
    const fc = factionOf(state, unit.owner).forestCost;
    if (fc) cost = fc;
  }
  // a pathfinder crosses forest and hills like plains
  if (unit && hasPerk(unit, 'pathfinder') && (b.terrain === 'forest' || b.terrain === 'hills')) cost = Math.min(cost, PERKS.kinds.pathfinder.roughCost);
  return cost + river;
}

// Does a river flow between neighboring tiles a, b?
export function riverBetween(state, a, b) {
  return hasRiverEdge(state.tiles, a, b);
}

// Defense bonus for a unit attacked in melee across a river (0 if no river between them).
// A frozen river (winter) gives no defense.
export function riverDefense(state, attacker, defender) {
  if (seasonKind(state).frozen) return 0;
  return distance(attacker, defender) === 1 && riverBetween(state, attacker, defender) ? RIVER.defBonus : 0;
}

// Extra move points for crossing a river now: more in spring (thaw), nothing in winter (frozen).
export function riverCrossCost(state) {
  const k = seasonKind(state);
  return k.frozen ? 0 : RIVER.crossCost + (k.riverExtra || 0);
}

// ---------- seasons ----------
// The season follows from the round (state.turn), so nothing is stored apart from the `seasons` option.

// Season id for a round, or null when the game plays without seasons.
export function seasonAt(state, turn = state.turn) {
  if (!state.seasons) return null;
  return SEASONS.order[Math.floor((Math.max(1, turn) - 1) / SEASONS.length) % SEASONS.order.length];
}

// The current season's settings ({} without seasons, so callers can read effects safely).
export function seasonKind(state) {
  const id = seasonAt(state);
  return id ? SEASONS.kinds[id] : {};
}

// Season summary for the HUD: { id, name, icon, text, turnsLeft (rounds including this one), next } or null.
export function seasonInfo(state) {
  const id = seasonAt(state);
  if (!id) return null;
  const turnsLeft = SEASONS.length - ((state.turn - 1) % SEASONS.length);
  const next = seasonAt(state, state.turn + turnsLeft);
  return { id, ...SEASONS.kinds[id], turnsLeft, next };
}

// Did a new season start with this round? (Round 1 doesn't count – the game simply starts in spring.)
export function seasonStarted(state) {
  return state.turn > 1 && !!seasonAt(state) && seasonAt(state) !== seasonAt(state, state.turn - 1);
}

// Winter frost: does this unit freeze at the end of its owner's turn (outside own territory; a city of its own
// is territory)? Returns the HP it would lose (0 = none).
export function frostLoss(state, unit) {
  const k = seasonKind(state);
  if (!k.frost || territoryOwner(state, unit.q, unit.r) === unit.owner) return 0;
  const city = cityAt(state, unit.q, unit.r);
  if (city && city.owner === unit.owner) return 0;
  return Math.max(0, Math.min(k.frost, unit.hp - SEASONS.frostMinHp));
}

// Does winter keep the unit from healing (it stands outside its own territory)?
export function frostBound(state, unit) {
  return !!seasonKind(state).frost && territoryOwner(state, unit.q, unit.r) !== unit.owner
    && !(cityAt(state, unit.q, unit.r) && cityAt(state, unit.q, unit.r).owner === unit.owner);
}

// Gold an owned city gets from the autumn harvest (size 2+, calm).
export function harvestGold(state, city) {
  const k = seasonKind(state);
  if (!k.harvest || city.owner === null || citySize(city) < 2 || cityUnrest(city) > 0) return 0;
  return k.harvest;
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
  if (unit.movesLeft <= 0) {
    // pursuit: one free step into the tile of the destroyed defender
    const p = pursuitTile(state, unit);
    if (p) { result.set(key(p.q, p.r), 0); parent.set(key(p.q, p.r), key(unit.q, unit.r)); }
    return { result, parent };
  }
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
// could attack the tile next turn – walking with full movement, then shooting/striking within range –
// plus one for each known enemy city with walls next to it (wall volley).
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
  // known enemy cities with walls shoot the tiles around them at the end of their owner's turn
  for (const c of state.cities) {
    if (c.owner === null || c.owner === player || !hasBuilding(c, 'walls') || !know.knows(c.q, c.r)) continue;
    for (const t of Object.values(state.tiles)) {
      if (distance(t, c) > VOLLEY.range || (t.q === c.q && t.r === c.r)) continue;
      if (know.knows(t.q, t.r) && isPassable(state, t.q, t.r)) out.set(key(t.q, t.r), (out.get(key(t.q, t.r)) || 0) + 1);
    }
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
  delete unit.sentry;
  unit.goto = { q, r };
  return followOrder(state, unit);
}

export function cancelOrder(state, unitId) {
  const unit = getUnit(state, unitId);
  if (unit) { delete unit.goto; delete unit.explore; delete unit.sentry; }
}

// Visible enemy units within `radius` of the unit (used to interrupt move orders).
function enemyInSight(state, unit, radius = EXPLORE.enemyRadius) {
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

// At the start of a player's turn: units on watch wake up when needed ('alert' / 'healed', see
// checkSentries), then units with orders walk on. An enemy already in sight stops the order before
// moving. Returns [{ unitId, result }].
export function runOrders(state, player) {
  const out = checkSentries(state, player);
  for (const unit of state.units.filter((u) => u.owner === player && (u.goto || u.explore))) {
    if (state.winner !== null) break;
    if (enemyInSight(state, unit)) {
      delete unit.goto;
      delete unit.explore;
      out.push({ unitId: unit.id, result: 'interrupted' });
      continue;
    }
    out.push({ unitId: unit.id, result: unit.explore ? followExplore(state, unit) : followOrder(state, unit) });
  }
  return out;
}

// ---------- auto-explore ----------
// unit.explore = true: at the start of each turn (and right when given) the unit walks towards the best
// tile to look from. Only what the player knows is used (explored tiles, visible enemies), foreign
// cities are never entered, so exploring can't capture anything or bump into a known enemy.

// Unexplored tiles the unit would see standing on (q, r).
function unexploredInSight(state, unit, q, r, explored) {
  const tile = tileAt(state, q, r);
  const radius = UNIT_TYPES[unit.type].sight + (tile.terrain === 'hills' ? VISION.hillsBonus : 0);
  let n = 0;
  for (let dq = -radius; dq <= radius; dq++) {
    for (let dr = Math.max(-radius, -dq - radius); dr <= Math.min(radius, -dq + radius); dr++) {
      const k = key(q + dq, r + dr);
      if (state.tiles[k] && !explored.has(k)) n++;
    }
  }
  return n;
}

// The best tile to explore from: { q, r, gain, cost, path } or null when there is nothing left the unit
// can reach. gain = unexplored tiles in sight from there (+ EXPLORE.ruinBonus for a believed ruin),
// cost = movement points; the score gain / (1 + cost / move) prefers near and rich tiles. Deterministic.
export function exploreTarget(state, unit) {
  if (!state.fog || state.winner !== null) return null;
  const explored = exploredTiles(state, unit.owner);
  const visible = visibleTiles(state, unit.owner);
  const move = Math.max(1, unitMove(state, unit));
  const start = key(unit.q, unit.r);
  const best = new Map([[start, 0]]);
  const parent = new Map();
  const frontier = [{ q: unit.q, r: unit.r, cost: 0 }];
  const done = new Set();
  let pick = null;
  while (frontier.length) {
    frontier.sort((a, b) => a.cost - b.cost);
    const cur = frontier.shift();
    const ck = key(cur.q, cur.r);
    if (done.has(ck)) continue;
    done.add(ck);
    const occupied = unitAt(state, cur.q, cur.r);
    if (ck !== start && !occupied) {
      let gain = unexploredInSight(state, unit, cur.q, cur.r, explored);
      if (ruinBelieved(state, cur.q, cur.r, unit.owner)) gain += EXPLORE.ruinBonus;
      if (gain > 0) {
        const score = gain / (1 + cur.cost / move);
        if (!pick || score > pick.score + 1e-9) pick = { q: cur.q, r: cur.r, gain, cost: cur.cost, score };
      }
    }
    for (const n of neighbors(cur.q, cur.r)) {
      const k = key(n.q, n.r);
      if (!explored.has(k) || !isPassable(state, n.q, n.r)) continue;
      const city = cityAt(state, n.q, n.r);
      if (city && city.owner !== unit.owner) continue;
      const other = unitAt(state, n.q, n.r);
      if (other && other.owner !== unit.owner && visible.has(k)) continue;
      const cost = cur.cost + stepCost(state, cur, n, unit);
      if (best.has(k) && best.get(k) <= cost) continue;
      best.set(k, cost);
      parent.set(k, ck);
      frontier.push({ q: n.q, r: n.r, cost });
    }
  }
  if (!pick) return null;
  const path = [];
  for (let k = key(pick.q, pick.r); k !== undefined; k = parent.get(k)) {
    const [pq, pr] = k.split(',').map(Number);
    path.unshift({ q: pq, r: pr });
  }
  return { q: pick.q, r: pick.r, gain: pick.gain, cost: pick.cost, path };
}

// Can the unit be sent exploring now? Own unit of the current player, with moves, and something to find.
export function canExplore(state, unit) {
  return !!unit && unit.owner === state.current && state.winner === null && state.fog
    && !unit.explore && unit.movesLeft > 0 && !!exploreTarget(state, unit);
}

// Sends the unit exploring and starts walking right away. Returns the result of followExplore or null.
export function setExplore(state, unitId) {
  const unit = getUnit(state, unitId);
  if (!canExplore(state, unit)) return null;
  delete unit.fortified;
  delete unit.sentry;
  delete unit.goto;
  unit.explore = true;
  return followExplore(state, unit);
}

// One turn of exploring: up to EXPLORE.legsPerTurn legs, each walking as far as it can towards the
// current best tile (re-picked after every leg, because the view changes).
// Result: 'moved' | 'done' (nothing left to explore – order ends) | 'interrupted' (enemy in sight –
// order ends) | 'idle' (no moves left).
export function followExplore(state, unit) {
  if (!unit.explore) return 'idle';
  if (unit.movesLeft <= 0) return 'idle';
  let moved = false;
  for (let leg = 0; leg < EXPLORE.legsPerTurn && unit.movesLeft > 0; leg++) {
    const target = exploreTarget(state, unit);
    if (!target) { delete unit.explore; return 'done'; }
    const reach = reachable(state, unit);
    let stop = null;
    for (let i = target.path.length - 1; i > 0; i--) {
      const p = target.path[i];
      if (reach.has(key(p.q, p.r))) { stop = p; break; }
    }
    if (!stop) {
      // no tile of the route can be reached this turn (e.g. an own unit stands on the first step and
      // the next one is too expensive): get as close to the target as possible instead
      let bestD = distance(unit, target);
      for (const [k, cost] of reach) {
        const [q, r] = k.split(',').map(Number);
        const city = cityAt(state, q, r);
        if (city && city.owner !== unit.owner) continue;
        const d = distance({ q, r }, target);
        if (d < bestD || (stop && d === bestD && cost < stop.cost)) { bestD = d; stop = { q, r, cost }; }
      }
    }
    if (!stop) break; // the way is blocked this turn – try again next turn
    moveUnit(state, unit.id, stop.q, stop.r);
    unit.explore = true; // moveUnit cancels orders
    moved = true;
    if (enemyInSight(state, unit)) { delete unit.explore; return 'interrupted'; }
  }
  if (!exploreTarget(state, unit)) { delete unit.explore; return 'done'; }
  return moved ? 'moved' : 'idle';
}

// Own units that can still move or attack, sorted by id. Fortified units and units on watch are left
// alone (like sleeping units); they can still be selected by clicking. Used by Tab and by the end-turn reminder.
export function activeUnits(state, player) {
  const canAct = (u) => !u.fortified && !u.sentry && (u.movesLeft > 0 || attackTargets(state, u).length > 0);
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
  sentry:    { order: 3, label: 'on watch' },
  done:      { order: 4, label: 'done' },
};

// What a unit is doing this turn: ready (can still move or attack), marching (has a move order and no
// moves left), fortified, on watch (sentry), or done.
export function unitStatus(state, unit) {
  if (unit.fortified) return 'fortified';
  if (unit.sentry) return 'sentry';
  if (unit.movesLeft > 0 || attackTargets(state, unit).length > 0) return 'ready'; // same rule as activeUnits / Tab
  return unit.goto || unit.explore ? 'marching' : 'done';
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
      id: u.id, type: u.type, name: t.name, hero: u.name || null, kills: u.kills || 0, symbol: t.symbol, hp: u.hp, maxHp: t.hp,
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
  // a single move, or the two moves of a swap
  const isSwap = events.length === 2 && events.every((e) => e.type === 'move' && e.swap !== undefined);
  if (!isSwap && (events.length !== 1 || events[0].type !== 'move')) return false;
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

// ---------- sentry ----------
// unit.sentry = 'watch' | 'heal': the unit stays where it is and is skipped by Tab, the end-turn reminder
// and the "ready" count, until an enemy shows up near it ('heal' also ends when it is fully healed). It
// keeps its moves, so it can still be clicked and given orders; any action wakes it.

// Panel line for a unit on watch, by mode.
export const SENTRY_TEXT = {
  watch: `👁 On watch – Tab skips it until an enemy comes within ${SENTRY.radius} tiles`,
  heal: `👁 Resting until healed – or until an enemy comes within ${SENTRY.radius} tiles`,
};

// Can the unit go on watch? An own unit of the current player that isn't fortified or on watch already.
export function canSentry(state, unit) {
  return !!unit && unit.owner === state.current && state.winner === null && !unit.fortified && !unit.sentry;
}

// Puts the unit on watch. A wounded unit rests until healed ('heal'), a healthy one just keeps watch.
// Cancels a move or explore order. Returns the mode or null.
export function sentry(state, unitId) {
  const unit = getUnit(state, unitId);
  if (!canSentry(state, unit)) return null;
  delete unit.goto;
  delete unit.explore;
  unit.sentry = unit.hp < UNIT_TYPES[unit.type].hp ? 'heal' : 'watch';
  return unit.sentry;
}

// Start of the player's turn: wakes units on watch. An enemy in sight within SENTRY.radius → 'alert';
// a resting unit back at full HP → 'healed'. Returns [{ unitId, result }] for the banner.
export function checkSentries(state, player) {
  const out = [];
  for (const unit of state.units.filter((u) => u.owner === player && u.sentry)) {
    if (enemyInSight(state, unit, SENTRY.radius)) {
      delete unit.sentry;
      out.push({ unitId: unit.id, result: 'alert' });
    } else if (unit.sentry === 'heal' && unit.hp >= UNIT_TYPES[unit.type].hp) {
      delete unit.sentry;
      out.push({ unitId: unit.id, result: 'healed' });
    }
  }
  return out;
}

// ---------- forced march ----------

// Why the unit can't force-march now (a short reason), or null if it can.
export function forcedMarchProblem(state, unit) {
  if (!unit) return 'no unit';
  if (state.winner !== null) return 'the game is over';
  if (unit.owner !== state.current) return 'not your turn';
  if (unit.marched) return 'already on a forced march';
  if (unit.moved || unit.hasAttacked || unit.movesLeft < unitMove(state, unit)) return 'it has already acted this turn';
  if (unit.hp <= FORCED_MARCH.hpCost) return 'too weak to march';
  return null;
}

export const canForceMarch = (state, unit) => forcedMarchProblem(state, unit) === null;

// Forced march: +FORCED_MARCH.bonus move points now for FORCED_MARCH.hpCost HP; the unit can't attack this turn
// and won't heal at its end (it counts as moved). Leaves fortify, watch, move orders and exploring.
// Emits a replayable 'march' event.
export function forceMarch(state, unitId) {
  const unit = getUnit(state, unitId);
  if (!canForceMarch(state, unit)) return false;
  unit.marched = true;
  unit.moved = true;
  unit.hp -= FORCED_MARCH.hpCost;
  unit.movesLeft += FORCED_MARCH.bonus;
  delete unit.fortified;
  delete unit.sentry;
  delete unit.goto;
  delete unit.explore;
  emit(state, { type: 'march', unitId: unit.id, q: unit.q, r: unit.r, hp: unit.hp, hpCost: FORCED_MARCH.hpCost, movesLeft: unit.movesLeft });
  return true;
}

// Tiles the unit could reach with a forced march (Map key -> cost), without changing anything.
// Empty if it can't march.
export function marchReach(state, unit) {
  if (!canForceMarch(state, unit)) return new Map();
  return searchMoves(state, { ...unit, movesLeft: unit.movesLeft + FORCED_MARCH.bonus }).result;
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
  delete unit.sentry;
  delete unit.goto;
  delete unit.explore;
  unit.movesLeft = 0;
  unit.hasAttacked = true;
  emit(state, { type: 'fortify', unitId: unit.id });
  return true;
}

export function attackTargets(state, unit) {
  if (unit.hasAttacked || unit.marched) return [];
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
  const was = unitTitle(unit);
  const named = nameHero(state, unit);
  const where = { by: unit.owner, at: [unit] };
  addLog(state, `${PLAYERS[unit.owner].name}: ${was} promoted to ${RANKS[rankOf(unit)].name}${named ? ` – now known as ${unit.name}` : ''}`, where);
  // the war timeline notes only each side's first hero (veterans are common later on)
  const first = named && ![...state.units, ...(state.fallen || [])].some((u) => u !== unit && u.owner === unit.owner && u.name);
  if (first) addMilestone(state, 'hero', unit.owner, `${cap(whose(unit.owner))} first hero: ${was} earned the name ${unit.name}`, where);
  return true;
}

// ---------- perks ----------
// unit.perks = ['drill', …]: one perk per rank above Recruit, chosen by the owner (see PERKS in rules.js).
// The number still to choose is derived from the rank, so a promotion needs no extra field.
export const perksOf = (unit) => (Array.isArray(unit.perks) ? unit.perks : []);
export const hasPerk = (unit, perk) => perksOf(unit).includes(perk);
export const perkChoices = (unit) => Math.max(0, rankOf(unit) - perksOf(unit).length);
export const perkAttackMult = (unit) => 1 + (hasPerk(unit, 'drill') ? PERKS.kinds.drill.atk : 0);
export const perkSight = (unit) => (hasPerk(unit, 'lookout') ? PERKS.kinds.lookout.sight : 0);

// Perks the unit could learn now (none when it has no choice left).
export function perkOptions(unit) {
  if (!perkChoices(unit)) return [];
  return Object.keys(PERKS.kinds).filter((p) => !hasPerk(unit, p));
}

// Why the unit can't learn the perk (text), or null. Choosing is free and doesn't use the unit's turn.
export function perkProblem(state, unit, perk) {
  if (state.winner !== null) return 'The game is over.';
  if (!unit || unit.owner !== state.current) return 'Not your unit or not your turn.';
  if (!PERKS.kinds[perk]) return 'Unknown perk.';
  if (hasPerk(unit, perk)) return 'The unit already knows it.';
  if (!perkChoices(unit)) return 'The unit has no perk to choose – it gets one with each promotion.';
  return null;
}

export function learnPerk(state, unitId, perk) {
  const unit = getUnit(state, unitId);
  if (perkProblem(state, unit, perk)) return false;
  unit.perks = [...perksOf(unit), perk];
  emit(state, { type: 'perk', unitId: unit.id, perk, q: unit.q, r: unit.r });
  addLog(state, `${PLAYERS[unit.owner].name}: ${unitTitle(unit)} learned ${PERKS.kinds[perk].name}`, { by: unit.owner, at: [unit] });
  return true;
}

// Extra healing from a medic: the unit itself or an own unit next to it knows Medic (never adds up).
export function medicBonus(state, unit) {
  const medic = state.units.some((m) => m.owner === unit.owner && hasPerk(m, 'medic') && distance(m, unit) <= 1);
  return medic ? PERKS.kinds.medic.heal : 0;
}

// "⚔ Drill, 🌲 Pathfinder" for panels and tooltips ('' without perks).
export const perkText = (unit) => perksOf(unit).map((p) => `${PERKS.kinds[p].icon} ${PERKS.kinds[p].name}`).join(', ');

// ---------- heroes ----------
// A unit reaching HEROES.minRank gets a name (unit.name) for life; unit.kills counts its kills.
// Named units that leave the game are remembered in state.fallen for the hall of fame.

// "Aldric (Warrior)" for a named unit, "Warrior" otherwise.
export function unitTitle(unit) {
  const type = UNIT_TYPES[unit.type].name;
  return unit.name ? `${unit.name} (${type})` : type;
}

// A free name for the unit, chosen from the seed and the unit id (reproducible). Names used by any
// living or remembered unit are skipped; when all are taken, a numeral is added ("Aldric II").
export function heroName(state, unit) {
  const names = HEROES.names;
  const used = new Set([...state.units, ...(state.fallen || [])].map((u) => u.name).filter(Boolean));
  const start = Math.abs(state.seed * 31 + unit.id * 7) % names.length;
  for (let round = 1; ; round++) {
    const suffix = round === 1 ? '' : ` ${['', '', 'II', 'III', 'IV', 'V'][round] || round}`;
    for (let i = 0; i < names.length; i++) {
      const n = names[(start + i) % names.length] + suffix;
      if (!used.has(n)) return n;
    }
  }
}

// Names the unit if it has earned a rank worth a name and has none yet. Returns true when it did.
function nameHero(state, unit) {
  if (unit.name || rankOf(unit) < HEROES.minRank) return false;
  unit.name = heroName(state, unit);
  return true;
}

// Remembers a named unit that leaves the game (fate: 'fell' | 'disbanded').
function rememberHero(state, unit, fate) {
  if (!unit.name) return;
  if (!state.fallen) state.fallen = [];
  state.fallen.push({ name: unit.name, type: unit.type, owner: unit.owner, xp: unit.xp || 0, kills: unit.kills || 0, fate, turn: state.turn });
}

// The player's best units of the game: living and remembered named units plus any unit with kills,
// best first (kills, then experience, then the living). Each row: { name, type, kills, xp, rank, fate }.
export function hallOfFame(state, player, limit = HEROES.hallSize) {
  const living = state.units.filter((u) => u.owner === player && (u.name || u.kills))
    .map((u) => ({ name: u.name || null, type: u.type, kills: u.kills || 0, xp: u.xp || 0, fate: 'alive', id: u.id }));
  const gone = (state.fallen || []).filter((f) => f.owner === player)
    .map((f) => ({ name: f.name, type: f.type, kills: f.kills, xp: f.xp, fate: f.fate, turn: f.turn }));
  return [...living, ...gone]
    .sort((a, b) => b.kills - a.kills || b.xp - a.xp || (a.fate === 'alive' ? 0 : 1) - (b.fate === 'alive' ? 0 : 1))
    .slice(0, limit)
    .map((h) => ({ ...h, rank: rankOf(h) }));
}

// ---------- war timeline ----------
// state.milestones: [{ turn, kind, player, text, seen? }] – the turning points of the game (see MILESTONES).
// `seen` works like in the chronicle: who witnessed it (stored only with fog). Strength leads aren't
// stored but derived from state.history (leadChanges), so they need no bookkeeping.

// "your" / "the AI's" – the owner as seen by the human player.
export function whose(player) {
  return PLAYERS[player].isAI ? `the ${PLAYERS[player].name}'s` : 'your';
}
const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);

function addMilestone(state, kind, player, text, where = null) {
  if (!state.milestones) state.milestones = [];
  const m = { turn: state.turn, kind, player, text };
  if (where && state.fog) m.seen = where.seen || seenBy(state, where);
  state.milestones.push(m);
  if (state.milestones.length > MILESTONES.limit) {
    // full: forget the oldest ordinary entry, the unique turning points stay
    const i = state.milestones.findIndex((x) => !MILESTONES.keep.includes(x.kind));
    state.milestones.splice(i < 0 ? 0 : i, 1);
  }
}

// Milestones of a unit kill: the game's first kill and the fall of a named hero.
function killMilestones(state, killer, victim, where) {
  const st = state.stats || emptyStats();
  const kills = st.kills.reduce((a, b) => a + b, 0); // counted after this call
  const killerName = `${whose(killer.owner)} ${unitTitle(killer)}`;
  if (kills === 0) {
    addMilestone(state, 'firstBlood', killer.owner, `First blood: ${killerName} destroyed ${whose(victim.owner)} ${unitTitle(victim)}`, where);
  }
  const k = victim.kills || 0;
  if (victim.name && k >= MILESTONES.fallKills) {
    addMilestone(state, 'heroFell', victim.owner, `${cap(whose(victim.owner))} hero ${victim.name} (${k} kills) fell to ${killerName}`, where);
  }
}

// Turns where the strength lead changed hands: [{ turn, kind: 'lead', player, text }]. A side leads when
// its army power is at least MILESTONES.leadRatio times the other's (and not tiny); in between nobody does.
export function leadChanges(history) {
  const out = [];
  let leader = null;
  for (const e of history || []) {
    if (!Array.isArray(e.power) || e.power.length !== 2) continue;
    const [a, b] = e.power;
    let now = null;
    if (Math.max(a, b) >= MILESTONES.leadMin) {
      if (a >= b * MILESTONES.leadRatio) now = 0;
      else if (b >= a * MILESTONES.leadRatio) now = 1;
    }
    if (now === null || now === leader) continue;
    leader = now;
    const who = PLAYERS[now].isAI ? `The ${PLAYERS[now].name}'s` : 'Your';
    out.push({ turn: e.turn, kind: 'lead', player: now, text: `${who} army pulls ahead (${e.power[now]} : ${e.power[1 - now]})` });
  }
  return out;
}

// The war timeline from a player's view, oldest first: stored milestones the viewer witnessed (all of
// them once the game is over) merged with the strength leads. Same-turn entries keep their order.
export function timelineFor(state, viewer) {
  const over = state.winner !== null && state.winner !== undefined;
  const stored = (state.milestones || []).filter((m) => over || !m.seen || m.seen.includes(viewer))
    .map(({ turn, kind, player, text }) => ({ turn, kind, player, text }));
  const leads = leadChanges(state.history);
  const out = [];
  // merge by turn; a lead is measured at the start of its turn, so it comes before that turn's events
  let i = 0;
  for (const m of stored) {
    while (i < leads.length && leads[i].turn <= m.turn) out.push(leads[i++]);
    out.push(m);
  }
  while (i < leads.length) out.push(leads[i++]);
  return out;
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
  const muse = inspiredBy(state, unit);
  if (muse) notes.push(`inspired by ${muse.name} +${Math.round(INSPIRE.defBonus * 100)} %`);
  return {
    name: t.name,
    hero: unit.name || null,
    kills: unit.kills || 0,
    owner: unit.owner,
    hp: unit.hp,
    maxHp: t.hp,
    attack: Math.round(t.atk * rankMult(unit) * perkAttackMult(unit) * 10) / 10,
    defense: Math.round(def * 10) / 10,
    baseDefense: t.def,
    range: t.range,
    move: unitMove(state, unit),
    rank: RANKS[rankOf(unit)].name,
    xp: unit.xp || 0,
    fortified: !!unit.fortified,
    forcedMarch: !!unit.marched,
    hitAndRun: !!unit.raided,
    pursuit: !!pursuitTile(state, unit),
    marching: !!unit.goto,
    exploring: !!unit.explore,
    sentry: unit.sentry || null,
    perks: perksOf(unit),
    perkChoices: perkChoices(unit),
    notes,
  };
}

// The named own hero (other than the unit itself) that inspires the unit, or null. The highest-ranked
// one, then the lowest id, so the answer is stable.
export function inspiredBy(state, unit) {
  let best = null;
  for (const h of state.units) {
    if (!h.name || h.id === unit.id || h.owner !== unit.owner || h.hp <= 0) continue;
    if (distance(h, unit) > INSPIRE.range) continue;
    if (!best || rankOf(h) > rankOf(best) || (rankOf(h) === rankOf(best) && h.id < best.id)) best = h;
  }
  return best;
}

// Own units a hero inspires (empty for a unit without a name).
export function inspiredUnits(state, hero) {
  if (!hero.name) return [];
  return state.units.filter((u) => u.id !== hero.id && u.owner === hero.owner && distance(u, hero) <= INSPIRE.range);
}

// Defense bonus from a nearby hero (0 or INSPIRE.defBonus).
export function inspireBonus(state, unit) {
  return inspiredBy(state, unit) ? INSPIRE.defBonus : 0;
}

// Unit defense; attacker (optional) determines type bonuses and siege.
export function defenseValue(state, unit, attacker = null) {
  const t = tileAt(state, unit.q, unit.r);
  let d = UNIT_TYPES[unit.type].def * rankMult(unit) * (1 + terrainDefense(state, unit, t)) * vsMult(unit, attacker);
  if (unit.fortified) d *= 1 + FORTIFY.defBonus;
  d *= 1 + inspireBonus(state, unit);
  const city = cityAt(state, unit.q, unit.r);
  if (city && city.owner === unit.owner) {
    const siege = attacker && UNIT_TYPES[attacker.type].siege;
    d *= siege ? 1 + CITY_DEF_BONUS : cityDefenseMult(city); // siege engines ignore walls
  }
  return d;
}

// Attack strength including rank, type bonus and city siege.
function attackPower(state, unit, target) {
  let atk = UNIT_TYPES[unit.type].atk * rankMult(unit) * perkAttackMult(unit) * vsMult(unit, target);
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
  const inspired = inspireBonus(state, defender);
  return { damage, counter, kills: defenderHp === 0, dies: attacker.hp - counter <= 0, flank, high, charge, inspired };
}

function hpFactor(unit) {
  return 0.5 + 0.5 * (unit.hp / UNIT_TYPES[unit.type].hp);
}

// ---------- actions (return true/false on success) ----------

// `extra` is merged into the new unit before the spawn event (e.g. a move order from a rally point).
export function spawnUnit(state, type, owner, q, r, xp = 0, extra = {}) {
  const t = UNIT_TYPES[type];
  const unit = {
    ...extra,
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
  nameHero(state, unit); // e.g. an academy recruit starts as a Veteran
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
  delete unit.sentry;
  delete unit.goto; // a manual move cancels a move order (followOrder puts it back)
  delete unit.explore; // … and an explore order (followExplore puts it back)
  delete unit.pursuit; // a pursuit is a single step (or lost once the unit moves otherwise)
  const city = cityAt(state, q, r);
  if (city && city.owner !== unit.owner) {
    const prev = city.owner;
    city.owner = unit.owner;
    delete city.rally; // the old owner's rally point means nothing to the new one
    delete city.focus; // … nor does their focus
    delete city.order; // … nor their recruit order
    city.size = Math.max(1, citySize(city) - GROWTH.captureLoss); // a conquered city shrinks …
    city.growth = 0; // … and starts growing anew
    if (prev !== null) city.unrest = UNREST.turns; // the people of a conquered city resist (neutral ones join willingly)
    else delete city.unrest;
    emit(state, { type: 'capture', cityId: city.id, owner: unit.owner, size: city.size, unrest: cityUnrest(city) });
    countStat(state, 'captures', unit.owner);
    const loot = factionOf(state, unit.owner).captureGold || 0;
    state.gold[unit.owner] += loot;
    const where = { by: unit.owner, at: [city], also: prev === null ? [] : [prev] };
    addLog(state, `${PLAYERS[unit.owner].name}: captured ${city.name}${loot ? ` (loot ${loot} gold)` : ''}`, where);
    const capital = city.capital && prev !== null;
    const what = prev === null ? `neutral ${city.name}` : capital ? `${whose(prev)} capital` : `${whose(prev)} ${city.name}`;
    addMilestone(state, capital ? 'capital' : 'capture', unit.owner, `${cap(whose(unit.owner))} ${unitTitle(unit)} took ${what}`, where);
    if (prev !== null) checkWinner(state);
  }
  if (tileAt(state, q, r).ruin && state.winner === null) exploreRuin(state, unit);
  updateExplored(state, unit.owner);
  return true;
}

// ---------- swapping places ----------
// Two neighbouring own units trade tiles in one step, so a fresh unit can relieve a wounded one at the
// front line (normally the front tile is occupied and the back unit can only walk around it).
// Both need a move left; each pays the step cost into the other's tile (a single step is always allowed
// with any points left, as for the first step of a normal move).

// Can `unit` swap places with `other` right now?
export function canSwap(state, unit, other) {
  if (!unit || !other || unit.id === other.id || state.winner !== null) return false;
  if (unit.owner !== state.current || other.owner !== unit.owner) return false;
  if (distance(unit, other) !== 1 || unit.movesLeft <= 0 || other.movesLeft <= 0) return false;
  if (unit.hasAttacked || other.hasAttacked) return false;
  return !cityForbidden(state, unit, other.q, other.r) && !cityForbidden(state, other, unit.q, unit.r);
}

// Own units the unit could swap with now (for the panel and the map highlight).
export function swapPartners(state, unit) {
  if (!unit) return [];
  return state.units.filter((o) => canSwap(state, unit, o));
}

// Swaps the two units. Emits two one-step move events (replayable, animated, undoable like a move).
export function swapUnits(state, unitId, otherId) {
  const a = getUnit(state, unitId);
  const b = getUnit(state, otherId);
  if (!canSwap(state, a, b)) return false;
  const pa = { q: a.q, r: a.r };
  const pb = { q: b.q, r: b.r };
  const costA = stepCost(state, pa, pb, a);
  const costB = stepCost(state, pb, pa, b);
  emit(state, { type: 'move', unitId: a.id, path: [pa, pb], swap: b.id });
  emit(state, { type: 'move', unitId: b.id, path: [pb, pa], swap: a.id });
  for (const [u, to, cost] of [[a, pb, costA], [b, pa, costB]]) {
    u.q = to.q;
    u.r = to.r;
    u.movesLeft = Math.max(0, u.movesLeft - cost);
    u.moved = true;
    delete u.fortified;
    delete u.sentry;
    delete u.goto;
    delete u.explore;
  }
  addLog(state, `${PLAYERS[a.owner].name}: ${UNIT_TYPES[a.type].name} and ${UNIT_TYPES[b.type].name} swapped places`, {
    by: a.owner, at: [pa, pb],
  });
  updateExplored(state, a.owner);
  return true;
}

export function attack(state, attackerId, defenderId) {
  const a = getUnit(state, attackerId);
  const d = getUnit(state, defenderId);
  if (!a || !d || a.owner !== state.current || state.winner !== null) return false;
  if (!attackTargets(state, a).includes(d)) return false;
  delete a.fortified; // attacking leaves the fortification before the fight
  delete a.sentry;
  delete a.goto;
  const res = previewAttack(state, a, d);
  const keep = movesAfterAttack(state, a); // hit and run: skirmishers keep some moves to pull back
  d.hp -= res.damage;
  a.hasAttacked = true;
  a.movesLeft = keep;
  if (keep > 0) a.raided = true; // marks the hit-and-run until the end of the turn
  a.moved = true;
  const aName = unitTitle(a);
  const dName = unitTitle(d);
  // the fight is seen by both participants and anyone who sees at least one of the tiles (computed before units are lost)
  const fight = { by: a.owner, at: [{ q: a.q, r: a.r }, { q: d.q, r: d.r }], also: [d.owner] };
  fight.seen = seenBy(state, fight);
  const ev = { type: 'attack', attackerId: a.id, defenderId: d.id, damage: res.damage, counter: 0, killed: d.hp <= 0, died: false, movesLeft: keep };
  emit(state, ev);
  if (d.hp <= 0) {
    const chase = pursuitFrom(state, a, d); // computed while the defender still stands there
    removeUnit(state, d.id);
    if (chase) { a.pursuit = chase; ev.pursuit = { ...chase }; }
    a.kills = (a.kills || 0) + 1;
    rememberHero(state, d, 'fell');
    addLog(state, `${PLAYERS[a.owner].name}: ${aName} destroyed ${dName}`, fight);
    killMilestones(state, a, d, fight);
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
      d.kills = (d.kills || 0) + 1;
      rememberHero(state, a, 'fell');
      addLog(state, `${aName} fell in battle`, fight);
      killMilestones(state, d, a, fight);
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
  if (a.name) ev.attackerName = a.name;
  if (d.name) ev.defenderName = d.name;
  if (a.kills) ev.attackerKills = a.kills;
  if (d.kills) ev.defenderKills = d.kills;
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
  // rally point: the recruit gets a move order there and sets off at the start of the next turn
  const goal = rallyTarget(state, city);
  const extra = goal ? { goto: goal } : {};
  delete city.order; // recruiting here fulfils a waiting order
  spawnUnit(state, type, state.current, city.q, city.r, xp, extra);
  addLog(state, `${PLAYERS[state.current].name}: recruited ${t.name} (${city.name})`, { by: state.current, at: [city] });
  return true;
}

// ---------- levy ----------
// A grown city can trade a size for a free warrior on its tile – an emergency defence when gold runs out.

// Why the city can't levy right now (a short text for the panel), or null when it can.
export function levyProblem(state, city) {
  if (state.winner !== null) return 'the game is over';
  if (!city || city.owner === null || city.owner !== state.current) return 'not your city';
  if (cityUnrest(city)) return 'the city is in unrest';
  if (citySize(city) < LEVY.minSize) return `the city must be size ${LEVY.minSize} or more`;
  if (unitAt(state, city.q, city.r)) return 'the city is occupied';
  return null;
}

export function canLevy(state, city) {
  return levyProblem(state, city) === null;
}

// The current player levies a unit in an own city: the city shrinks, the unit appears like a recruit.
export function levy(state, cityId) {
  const city = state.cities.find((c) => c.id === cityId);
  if (!canLevy(state, city)) return false;
  city.size = Math.max(1, citySize(city) - LEVY.sizeCost);
  city.growth = 0;
  emit(state, { type: 'levy', cityId, size: city.size, player: city.owner });
  const goal = rallyTarget(state, city);
  spawnUnit(state, LEVY.type, city.owner, city.q, city.r, 0, goal ? { goto: goal } : {});
  addLog(state, `${PLAYERS[city.owner].name}: levied a ${UNIT_TYPES[LEVY.type].name} in ${city.name} (size ${city.size})`, { by: city.owner, at: [city] });
  return true;
}

// ---------- recruit orders ----------
// city.order = a unit type the player ordered in a city that couldn't recruit it right away (not enough gold,
// or the city tile is taken). At the start of the owner's turn, after income and random events, the order is
// bought like a normal recruit as soon as there is gold and room; until then it waits. Recruiting anything in
// the city fulfils the order. A captured city loses it. Player comfort – the AI recruits directly.

// Why the current player can't order `type` in the city (a short text), or null when they can.
export function recruitOrderProblem(state, city, type) {
  if (state.winner !== null) return 'the game is over';
  if (!city || city.owner === null || city.owner !== state.current) return 'not your city';
  if (!Object.hasOwn(UNIT_TYPES, type)) return 'unknown unit';
  return null;
}

// Places (or replaces) the order of an own city. Returns false when nothing changed.
export function setRecruitOrder(state, cityId, type) {
  const city = state.cities.find((c) => c.id === cityId);
  if (recruitOrderProblem(state, city, type) !== null || city.order === type) return false;
  city.order = type;
  return true;
}

export function clearRecruitOrder(state, cityId) {
  const city = state.cities.find((c) => c.id === cityId);
  if (!city || city.owner !== state.current || !city.order) return false;
  delete city.order;
  return true;
}

// What stops the city's order from being bought now: 'occupied', 'gold' or null (it would be bought).
export function recruitOrderBlocker(state, city) {
  if (!city || !city.order || city.owner === null) return null;
  if (unitAt(state, city.q, city.r)) return 'occupied';
  if (state.gold[city.owner] < unitCost(state, city, city.order)) return 'gold';
  return null;
}

// Order line for the panel and the tooltip, or '' without an order.
export function recruitOrderText(state, city) {
  if (!city || !city.order || city.owner === null) return '';
  const name = UNIT_TYPES[city.order].name;
  const cost = unitCost(state, city, city.order);
  const why = recruitOrderBlocker(state, city);
  const wait = why === 'occupied' ? ' – waits until the city tile is free'
    : why === 'gold' ? ` – waits for gold (${state.gold[city.owner]}/${cost})` : '';
  return `Ordered: ${name} (${cost} gold), bought at the start of your turn${wait}`;
}

// Start of the player's turn: every order that has gold and room is bought, cities in id order.
// Emits an 'order' event before the recruit's 'spawn'. Returns the fulfilled orders.
export function fillRecruitOrders(state, player) {
  const done = [];
  if (state.winner !== null || state.current !== player) return done;
  for (const city of [...state.cities].sort((a, b) => a.id - b.id)) {
    if (city.owner !== player || !city.order || recruitOrderBlocker(state, city)) continue;
    const type = city.order;
    const cost = unitCost(state, city, type);
    emit(state, { type: 'order', cityId: city.id, player, unitType: type, cost });
    if (buyUnit(state, city.id, type)) done.push({ cityId: city.id, type, cost });
  }
  return done;
}

// ---------- rally points ----------
// city.rally = { q, r }: units recruited in the city get a move order to that tile (see buyUnit),
// so a stream of recruits walks to the front without a click each. Player-only comfort – the AI moves
// its own recruits. A captured city loses its rally point.

// Cheapest path from the city to (q, r) over tiles its owner has explored and that are passable;
// units are ignored (they move). Returns [{q,r}…] including both ends, or null.
export function rallyPath(state, city, q, r) {
  if (!city || city.owner === null) return null;
  const explored = exploredTiles(state, city.owner);
  const target = key(q, r);
  if (!explored.has(target) || !isPassable(state, q, r) || (city.q === q && city.r === r)) return null;
  const best = new Map([[key(city.q, city.r), 0]]);
  const parent = new Map();
  const frontier = [{ q: city.q, r: city.r, cost: 0 }];
  while (frontier.length) {
    frontier.sort((a, b) => a.cost - b.cost);
    const cur = frontier.shift();
    if (key(cur.q, cur.r) === target) break;
    for (const n of neighbors(cur.q, cur.r)) {
      const k = key(n.q, n.r);
      if (!explored.has(k) || !isPassable(state, n.q, n.r)) continue;
      const cost = cur.cost + stepCost(state, cur, n);
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
  return path;
}

// Can the current player set the rally point of this city to (q, r)? An own city, an explored
// passable tile other than the city itself, reachable over known land.
export function canRally(state, city, q, r) {
  return !!city && city.owner === state.current && state.winner === null && !!rallyPath(state, city, q, r);
}

// Where a recruit of the city should march: the rally point, or – when an own unit already stands
// there – the nearest tile around it that is free of own units and reachable (rings 1 and 2, in a
// fixed order). null = no rally point or no room.
export function rallyTarget(state, city) {
  if (!city || !city.rally) return null;
  const { q, r } = city.rally;
  const free = (t) => {
    const o = unitAt(state, t.q, t.r);
    return !(o && o.owner === city.owner) && !!rallyPath(state, city, t.q, t.r);
  };
  if (free({ q, r })) return { q, r };
  const seen = new Set([key(q, r)]);
  let ring = [{ q, r }];
  for (let d = 1; d <= 2; d++) {
    const next = [];
    for (const t of ring) {
      for (const n of neighbors(t.q, t.r)) {
        const k = key(n.q, n.r);
        if (seen.has(k) || !tileAt(state, n.q, n.r)) continue;
        seen.add(k);
        next.push(n);
      }
    }
    const spot = next.find(free);
    if (spot) return { q: spot.q, r: spot.r };
    ring = next;
  }
  return null;
}

export function setRally(state, cityId, q, r) {
  const city = state.cities.find((c) => c.id === cityId);
  if (!canRally(state, city, q, r)) return false;
  city.rally = { q, r };
  return true;
}

export function clearRally(state, cityId) {
  const city = state.cities.find((c) => c.id === cityId);
  if (!city || city.owner !== state.current || !city.rally) return false;
  delete city.rally;
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
  delete unit.sentry;
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
  rememberHero(state, unit, 'disbanded');
  emit(state, { type: 'disband', unitId: unit.id, owner: unit.owner, refund, q: unit.q, r: unit.r });
  const city = cityAt(state, unit.q, unit.r);
  addLog(state, `${PLAYERS[unit.owner].name}: disbanded ${unitTitle(unit)}${refund ? ` (${city.name}, +${refund} gold)` : ''}`,
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
  cityVolleys(state, state.current);
  const frozen = [];
  // heal units of the player ending the turn (winter frost instead outside own territory)
  for (const u of state.units.filter((x) => x.owner === state.current)) {
    const city = cityAt(state, u.q, u.r);
    const restHeal = territoryOwner(state, u.q, u.r) === u.owner ? TERRITORY.healIdle : ECONOMY.healIdle;
    const frost = frostLoss(state, u);
    const heal = frostBound(state, u) ? 0 : city && city.owner === u.owner ? cityHeal(city) : u.moved ? 0 : restHeal;
    u.hp = Math.min(UNIT_TYPES[u.type].hp, u.hp + heal + (heal > 0 ? medicBonus(state, u) : 0)) - frost;
    if (frost) frozen.push(u);
    delete u.marched; // a forced march lasts only for the turn it was made in
    delete u.raided; // … and so does a hit and run
    delete u.pursuit; // … and a pursuit
  }
  if (frozen.length) {
    addLog(state, `${PLAYERS[state.current].name}: winter frost – ${frozen.length} ${frozen.length === 1 ? 'unit' : 'units'} outside home lost HP`, {
      by: state.current, at: frozen,
    });
  }
  state.current = (state.current + 1) % PLAYERS.length;
  if (state.current === 0) {
    state.turn++;
    recoverPillaged(state);
    recordHistory(state);
    if (seasonStarted(state)) {
      const k = seasonKind(state);
      addLog(state, `${k.icon} ${k.name} has come: ${k.text}`);
    }
  }
  calmCities(state, state.current);
  growCities(state, state.current);
  state.gold[state.current] += incomeOf(state, state.current);
  for (const u of state.units.filter((x) => x.owner === state.current)) {
    u.movesLeft = unitMove(state, u);
    u.hasAttacked = false;
    u.moved = false;
  }
  if (state.happenings) rollHappening(state, state.current);
  fillRecruitOrders(state, state.current); // after income and events, so a harvest can pay for it
  return true;
}

// ---------- animation speed (viewer preference) ----------

// The speed entry for a saved preference id. Without a valid saved choice the system "reduce motion"
// setting picks 'off', otherwise 'normal'.
export function animSpeedOf(id, reducedMotion = false) {
  return ANIM_SPEEDS.find((s) => s.id === id) || ANIM_SPEEDS.find((s) => s.id === (reducedMotion ? 'off' : 'normal'));
}

// The next speed after `id` (normal → fast → off → normal).
export function nextAnimSpeed(id) {
  const i = ANIM_SPEEDS.findIndex((s) => s.id === id);
  return ANIM_SPEEDS[(i + 1) % ANIM_SPEEDS.length];
}

// ---------- wall volley ----------

// The enemy unit a city's walls would shoot now, or null: an owned city with walls, an enemy unit within
// VOLLEY.range that still has more than VOLLEY.minHp; the weakest first, then the lowest id.
export function volleyTarget(state, city) {
  if (city.owner === null || !hasBuilding(city, 'walls')) return null;
  const targets = state.units.filter((u) => u.owner !== city.owner && distance(u, city) <= VOLLEY.range && u.hp > VOLLEY.minHp);
  targets.sort((a, b) => a.hp - b.hp || a.id - b.id);
  return targets[0] || null;
}

// End of the player's turn: each of their walled cities shoots once. Emits 'volley' events.
export function cityVolleys(state, player) {
  for (const city of state.cities.filter((c) => c.owner === player)) {
    const u = volleyTarget(state, city);
    if (!u) continue;
    const damage = Math.min(VOLLEY.damage, u.hp - VOLLEY.minHp);
    u.hp -= damage;
    emit(state, { type: 'volley', cityId: city.id, player, unitId: u.id, victim: u.owner, damage, hp: u.hp, q: u.q, r: u.r });
    addLog(state, `${PLAYERS[player].name}: the walls of ${city.name} hit ${UNIT_TYPES[u.type].name} (−${damage})`, {
      by: player, also: [u.owner], at: [city],
    });
  }
}

// ---------- road building ----------
// A built road works like a road from the map (tile.road) – both sides can use it; `tile.roadBuilt` only
// remembers that it was built during the game.

// Can the unit lay a road on the tile it stands on? An own unit of the current player (any kind) that hasn't
// attacked and has moves left, on a roadless tile of its own territory that is not a city.
// `affordable` = also checks the gold.
export function canBuildRoad(state, unit, { affordable = true } = {}) {
  if (!unit || unit.owner !== state.current || state.winner !== null) return false;
  if (unit.hasAttacked || unit.movesLeft <= 0) return false;
  const tile = tileAt(state, unit.q, unit.r);
  if (!tile || tile.road || cityAt(state, unit.q, unit.r)) return false;
  if (territoryOwner(state, unit.q, unit.r) !== unit.owner) return false;
  return !affordable || state.gold[unit.owner] >= ROADWORK.gold;
}

// Own road tiles and own cities next to the tile: a new road there joins the network (used by the AI and the panel).
export function roadLinks(state, q, r) {
  return neighbors(q, r).filter((n) => {
    const t = tileAt(state, n.q, n.r);
    return t && (t.road || cityAt(state, n.q, n.r));
  }).length;
}

// Lays a road under the unit. Returns the 'road' event or null when not allowed.
export function buildRoad(state, unitId) {
  const unit = getUnit(state, unitId);
  if (!canBuildRoad(state, unit)) return null;
  const tile = tileAt(state, unit.q, unit.r);
  tile.road = true;
  tile.roadBuilt = true;
  state.gold[unit.owner] -= ROADWORK.gold;
  unit.movesLeft = 0;
  unit.hasAttacked = true;
  delete unit.fortified;
  delete unit.goto;
  delete unit.explore;
  delete unit.sentry;
  const ev = { type: 'road', unitId: unit.id, player: unit.owner, q: tile.q, r: tile.r, gold: ROADWORK.gold };
  emit(state, ev);
  addLog(state, `${PLAYERS[unit.owner].name}: ${UNIT_TYPES[unit.type].name} built a road (−${ROADWORK.gold} gold)`, { by: unit.owner, at: [tile] });
  return ev;
}

// ---------- pillage ----------
// tile.pillagedUntil = the round in which a pillaged resource works again (see PILLAGE in rules.js).

// Is the resource on this tile pillaged (out of use) right now?
export function isPillaged(state, tile) {
  return !!tile && tile.pillagedUntil !== undefined && state.turn < tile.pillagedUntil;
}

// Rounds until a pillaged resource works again (0 = it works).
export function pillageTurnsLeft(state, tile) {
  return isPillaged(state, tile) ? tile.pillagedUntil - state.turn : 0;
}

// At the start of a round, resources whose time is up recover (the field is removed to keep the state small).
function recoverPillaged(state) {
  for (const t of Object.values(state.tiles)) {
    if (t.pillagedUntil !== undefined && state.turn >= t.pillagedUntil) delete t.pillagedUntil;
  }
}

// Can the unit pillage the tile it stands on? An own unit of the current player that can still capture
// (not a scout), hasn't attacked and has moves left, on a working resource in another player's territory.
export function canPillage(state, unit) {
  if (!unit || unit.owner !== state.current || state.winner !== null) return false;
  if (UNIT_TYPES[unit.type].noCapture || unit.hasAttacked || unit.movesLeft <= 0) return false;
  const tile = tileAt(state, unit.q, unit.r);
  if (!tile || !tile.resource || isPillaged(state, tile) || cityAt(state, unit.q, unit.r)) return false;
  const realm = territoryOwner(state, unit.q, unit.r);
  return realm !== undefined && realm !== null && realm !== unit.owner;
}

// Pillages the resource under the unit. Returns the 'pillage' event or null when not allowed.
export function pillage(state, unitId) {
  const unit = getUnit(state, unitId);
  if (!canPillage(state, unit)) return null;
  const tile = tileAt(state, unit.q, unit.r);
  const victim = territoryOwner(state, unit.q, unit.r);
  const city = state.cities.find((c) => c.id === territoryMap(state).get(key(tile.q, tile.r)));
  // the owner misses exactly PILLAGE.turns of its own turns: if it moves before the pillager in a round, its
  // next turn is in the next round
  tile.pillagedUntil = state.turn + PILLAGE.turns + (victim < unit.owner ? 1 : 0);
  state.gold[unit.owner] += PILLAGE.gold;
  unit.movesLeft = 0;
  unit.hasAttacked = true;
  delete unit.fortified;
  delete unit.goto;
  delete unit.explore;
  delete unit.sentry;
  const ev = { type: 'pillage', unitId: unit.id, player: unit.owner, victim, q: tile.q, r: tile.r,
    resource: tile.resource, gold: PILLAGE.gold, until: tile.pillagedUntil };
  emit(state, ev);
  addLog(state, `${PLAYERS[unit.owner].name}: ${UNIT_TYPES[unit.type].name} pillaged ${RESOURCES[tile.resource].name.toLowerCase()} near ${city.name} (+${PILLAGE.gold} gold, out of use for ${PILLAGE.turns} turns)`,
    { by: unit.owner, also: [victim], at: [tile] });
  return ev;
}

// Can the unit repair the tile it stands on? An own unit of the current player (any kind) that hasn't attacked
// and has moves left, on a pillaged resource in its own territory. `affordable` = also checks the gold.
export function canRepair(state, unit, { affordable = true } = {}) {
  if (!unit || unit.owner !== state.current || state.winner !== null) return false;
  if (unit.hasAttacked || unit.movesLeft <= 0) return false;
  const tile = tileAt(state, unit.q, unit.r);
  if (!tile || !tile.resource || !isPillaged(state, tile)) return false;
  if (territoryOwner(state, unit.q, unit.r) !== unit.owner) return false;
  return !affordable || state.gold[unit.owner] >= REPAIR.gold;
}

// Repairs the pillaged resource under the unit. Returns the 'repair' event or null when not allowed.
export function repair(state, unitId) {
  const unit = getUnit(state, unitId);
  if (!canRepair(state, unit)) return null;
  const tile = tileAt(state, unit.q, unit.r);
  const city = state.cities.find((c) => c.id === territoryMap(state).get(key(tile.q, tile.r)));
  const left = pillageTurnsLeft(state, tile);
  delete tile.pillagedUntil;
  state.gold[unit.owner] -= REPAIR.gold;
  unit.movesLeft = 0;
  unit.hasAttacked = true;
  delete unit.fortified;
  delete unit.goto;
  delete unit.explore;
  delete unit.sentry;
  const ev = { type: 'repair', unitId: unit.id, player: unit.owner, q: tile.q, r: tile.r, resource: tile.resource, gold: REPAIR.gold, saved: left };
  emit(state, ev);
  addLog(state, `${PLAYERS[unit.owner].name}: ${UNIT_TYPES[unit.type].name} repaired ${RESOURCES[tile.resource].name.toLowerCase()} near ${city.name} (−${REPAIR.gold} gold)`,
    { by: unit.owner, at: [tile] });
  return ev;
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
  addLog(state, `${who}: ${UNIT_TYPES[unit.type].name} explored ancient ruins – ${info.name}${detail}`, { seen: knownBy, place: tile });
  if (kind === 'training') {
    gainXp(state, unit, info.xp);
    ev.xp = unit.xp;
    ev.hp = unit.hp;
    if (unit.name) ev.name = unit.name;
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
      addMilestone(state, 'victory', state.winner, `${PLAYERS[state.winner].isAI ? `The ${PLAYERS[state.winner].name}` : 'You'} won the war`);
      recordHistory(state);
      return;
    }
  }
}

// Chronicle entry. Without `where` the entry is public (game over…). With `where` = { by, at, also, seen, place }
// `seen` is stored: players who saw the action – its author, players in `also` and those who currently see
// any of the `at` tiles. Without fog everyone sees, so `seen` isn't stored. The entry also keeps the tile it
// happened on (q, r) – `place`, else the last of `at` (the defender of a fight) – so the chronicle can point at it.
function addLog(state, msg, where = null) {
  const entry = { turn: state.turn, msg };
  const place = where && (where.place || (where.at && where.at[where.at.length - 1]));
  if (place) { entry.q = place.q; entry.r = place.r; }
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
// A seen entry with a place carries its tile (q, r); a hidden one never does, so nothing leaks.
export function logFor(state, viewer) {
  const out = [];
  for (const e of state.log) {
    if (!e.seen || e.seen.includes(viewer) || state.winner !== null) {
      out.push(e.q === undefined ? { turn: e.turn, msg: e.msg } : { turn: e.turn, msg: e.msg, q: e.q, r: e.r });
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
// Returns { lost: { type: count }, wounded, fell, citiesLost: [phrases like 'the city Oakford'], pillaged, spots: [{ q, r, kind }] }.
export function turnReport(before, events, viewer) {
  const st = cloneState(before);
  const rep = { lost: {}, wounded: 0, fell: 0, citiesLost: [], pillaged: 0, spots: [] };
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
    } else if (ev.type === 'volley' && ev.victim === viewer && ev.player !== viewer) {
      wounded.add(ev.unitId);
    } else if (ev.type === 'disband') {
      wounded.delete(ev.unitId);
    } else if (ev.type === 'pillage' && ev.victim === viewer && ev.player !== viewer) {
      rep.pillaged++; // the owner always notices: the resource stops paying
      rep.spots.push({ q: ev.q, r: ev.r, kind: 'pillage' });
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
  if (rep.pillaged) parts.push(`${rep.pillaged === 1 ? 'A resource' : `${rep.pillaged} resources`} of yours ${rep.pillaged === 1 ? 'was' : 'were'} pillaged.`);
  if (rep.wounded) parts.push(`${rep.wounded} unit${rep.wounded === 1 ? ' was' : 's were'} wounded.`);
  if (rep.fell) parts.push(`${rep.fell} attacker${rep.fell === 1 ? '' : 's'} fell to your counterattacks.`);
  if (!parts.length) return '';
  return `Enemy turn: ${parts.join(' ')}`;
}

// Whether the report contains a loss (the banner turns red).
export function reportIsBad(rep) {
  return Object.keys(rep.lost).length > 0 || rep.citiesLost.length > 0 || rep.wounded > 0 || (rep.pillaged || 0) > 0;
}

// ---------- enemy turn replay ----------
// Where an event happens, to decide whether a viewer saw it (the animation and the replay use the same
// rule). st = the state right before the event (after it for a spawn or capture, as the animation shows
// those first). Returns the tiles, [] for something never shown (a city's focus is the owner's secret)
// or null for turn bookkeeping without a place (income, growth, random events – nothing to watch).
export function eventTiles(st, ev) {
  const at = (p) => (p ? [{ q: p.q, r: p.r }] : []);
  const city = () => at(st.cities.find((c) => c.id === ev.cityId));
  if (ev.type === 'move') return ev.path.map((p) => ({ q: p.q, r: p.r }));
  if (ev.type === 'attack') return [...at(getUnit(st, ev.attackerId)), ...at(getUnit(st, ev.defenderId))];
  if (ev.type === 'capture' || ev.type === 'levy') return city();
  if (ev.type === 'spawn') return at(ev.unit);
  if (ev.type === 'fortify' || ev.type === 'upgrade') return at(getUnit(st, ev.unitId));
  if (ev.type === 'volley') return [...at(ev), ...city()];
  if (ev.type === 'focus' || ev.type === 'perk') return []; // the owner's choice – nothing to watch
  if (['march', 'disband', 'ruin', 'pillage', 'repair', 'road'].includes(ev.type)) return at(ev);
  return null;
}

// Whether the viewer sees an event with a place (see eventTiles) on the state st.
export function eventSeen(st, ev, viewer) {
  const tiles = eventTiles(st, ev);
  if (!tiles || !tiles.length) return false;
  const vis = visibleTiles(st, viewer);
  return tiles.some((t) => vis.has(key(t.q, t.r)));
}

// The enemy's turn as the viewer can watch it again: { before, events, seen } with a private copy of
// the state before the turn, or null when the viewer saw nothing happen (then there is nothing to replay).
// The events are replayed on a copy exactly like the animation does, so visibility is judged at the
// moment of each event – a unit walking out of sight counts, one that stayed in the fog doesn't.
export function enemyTurnReplay(before, events, viewer) {
  const st = cloneState(before);
  let seen = 0;
  for (const ev of events) {
    const early = ev.type === 'spawn' || ev.type === 'capture';
    if (early) applyEvent(st, ev);
    if (eventSeen(st, ev, viewer)) seen++;
    if (!early) applyEvent(st, ev);
  }
  return seen ? { before: cloneState(before), events: events.map((e) => ({ ...e })), seen } : null;
}

// ---------- advisor ----------
// A short list of hints for the player's turn – one per kind, most urgent first (ADVISOR in rules.js).
// Uses only what the player knows: visible enemy units, explored cities and ruins. Each hint is
// { kind, icon, text, q, r, unitId?, cityId? } – (q, r) is the tile to look at, unitId / cityId what to select.
// Nothing for the other player's turn or after the game ends.

export function adviseTurn(state, player) {
  if (state.winner !== null || state.current !== player) return [];
  const visible = visibleTiles(state, player);
  const explored = exploredTiles(state, player);
  const enemies = state.units.filter((u) => u.owner !== player && visible.has(key(u.q, u.r)));
  const mine = state.units.filter((u) => u.owner === player).sort((a, b) => a.id - b.id);
  const cities = state.cities.filter((c) => c.owner === player).sort((a, b) => (b.capital ? 1 : 0) - (a.capital ? 1 : 0) || a.id - b.id);
  const gold = state.gold[player];
  const moves = new Map(mine.filter((u) => u.movesLeft > 0).map((u) => [u.id, reachable(state, u)]));
  const tips = [];
  const add = (kind, text, at, extra = {}) => tips.push({ kind, icon: ADVISOR.kinds[kind].icon, text, q: at.q, r: at.r, ...extra });

  // an own city with nobody in it and a visible enemy close by
  let worst = null;
  for (const c of cities) {
    const guard = unitAt(state, c.q, c.r);
    if (guard && guard.owner === player) continue;
    for (const e of enemies) {
      const d = distance(c, e);
      if (d <= ADVISOR.dangerRange && (!worst || d < worst.d)) worst = { c, e, d };
    }
  }
  if (worst) {
    // no gold for any recruit there? a grown city can still levy a warrior
    const broke = Object.keys(UNIT_TYPES).every((t) => gold < unitCost(state, worst.c, t));
    const levyTip = broke && canLevy(state, worst.c) ? ` No gold to recruit – levy a ${UNIT_TYPES[LEVY.type].name} there (costs a size).` : '';
    // nobody reaches the city this turn, but a forced march would get a unit there
    const cityKey = key(worst.c.q, worst.c.r);
    const marcher = [...moves.values()].some((m) => m.has(cityKey)) ? null
      : mine.find((u) => marchReach(state, u).has(cityKey));
    const marchTip = marcher ? ` A forced march (🥾) gets ${marcher.name ? '' : 'your '}${unitTitle(marcher)} there in time (−${FORCED_MARCH.hpCost} HP).` : '';
    add('undefended', `${worst.c.name} is unguarded – an enemy ${UNIT_TYPES[worst.e.type].name} is ${worst.d} tile${worst.d === 1 ? '' : 's'} away.${marchTip}${levyTip}`,
      worst.c, { cityId: worst.c.id, ...(levyTip ? { levy: true } : {}), ...(marcher ? { marchUnitId: marcher.id } : {}) });
  }

  // a sure kill without losing the attacker (weakest target first)
  let kill = null;
  for (const u of mine) {
    for (const t of attackTargets(state, u)) {
      if (!visible.has(key(t.q, t.r))) continue;
      const p = previewAttack(state, u, t);
      if (p.kills && !p.dies && (!kill || t.hp < kill.t.hp)) kill = { u, t };
    }
  }
  if (kill) {
    add('finish', `${unitTitle(kill.u)} can finish off the enemy ${UNIT_TYPES[kill.t.type].name} (${kill.t.hp} HP).`, kill.u, { unitId: kill.u.id });
  }

  // a badly wounded unit that enemies can reach next turn (in an own city it heals anyway)
  const threats = enemies.length ? threatTiles(state, player) : new Map();
  const hurt = mine.find((u) => {
    const city = cityAt(state, u.q, u.r);
    return u.movesLeft > 0 && !u.hasAttacked && u.hp <= UNIT_TYPES[u.type].hp * ADVISOR.woundedShare
      && threats.has(key(u.q, u.r)) && !(city && city.owner === player);
  });
  if (hurt) {
    add('wounded', `${unitTitle(hurt)} is badly wounded (${hurt.hp}/${UNIT_TYPES[hurt.type].hp} HP) and within enemy reach – pull it back to rest.`,
      hurt, { unitId: hurt.id });
  }

  // a known foreign city a unit can walk into this turn (enemy capitals, then enemy cities, then neutral ones)
  const targets = state.cities.filter((c) => c.owner !== player && explored.has(key(c.q, c.r)))
    .sort((a, b) => (a.owner === null) - (b.owner === null) || (b.capital ? 1 : 0) - (a.capital ? 1 : 0) || a.id - b.id);
  capture: for (const c of targets) {
    for (const u of mine) {
      if (moves.has(u.id) && moves.get(u.id).has(key(c.q, c.r))) {
        add('capture', `${unitTitle(u)} can capture ${c.name} this turn.`, u, { unitId: u.id });
        break capture;
      }
    }
  }

  // a known ruin within reach
  ruin: for (const u of mine) {
    for (const k of moves.get(u.id)?.keys() || []) {
      const [q, r] = k.split(',').map(Number);
      if (explored.has(k) && ruinBelieved(state, q, r, player)) {
        add('ruin', `${unitTitle(u)} can explore the ruins this turn.`, u, { unitId: u.id });
        break ruin;
      }
    }
  }

  // an own pillaged resource that can be repaired
  if (gold >= REPAIR.gold) {
    const terr = territoryMap(state);
    const tile = Object.values(state.tiles).find((t) => t.resource && isPillaged(state, t)
      && territoryOwner(state, t.q, t.r) === player);
    if (tile) {
      const city = state.cities.find((c) => c.id === terr.get(key(tile.q, tile.r)));
      const on = unitAt(state, tile.q, tile.r);
      const now = on && canRepair(state, on);
      add('repair', now
        ? `${unitTitle(on)} can repair the ${RESOURCES[tile.resource].name.toLowerCase()} near ${city.name} (${REPAIR.gold} gold).`
        : `The ${RESOURCES[tile.resource].name.toLowerCase()} near ${city.name} is pillaged – a unit standing on it can repair it (${REPAIR.gold} gold).`,
      tile, now ? { unitId: on.id } : {});
    }
  }

  // a restless city without a garrison that a unit can walk into this turn (nearest unit first)
  unrest: for (const c of cities.filter((x) => cityUnrest(x) && !unitAt(state, x.q, x.r))) {
    const near = mine.filter((u) => moves.get(u.id)?.has(key(c.q, c.r))).sort((a, b) => distance(a, c) - distance(b, c) || a.id - b.id);
    if (!near.length) continue;
    add('unrest', `${c.name} is in unrest – move ${unitTitle(near[0])} in as a garrison to calm it faster.`,
      near[0], { unitId: near[0].id, cityId: c.id });
    break unrest;
  }

  // a trade route cut by an enemy the player can see on the road (hidden blockers stay hidden)
  const enemyKeys = new Set(enemies.map((e) => key(e.q, e.r)));
  for (const c of cities) {
    if (tradeRoute(state, c) !== 'cut' || roadLinkedToCapital(state, c, enemyKeys)) continue;
    const onRoad = enemies.filter((e) => tileAt(state, e.q, e.r).road).sort((a, b) => distance(a, c) - distance(b, c) || a.id - b.id);
    if (!onRoad.length) continue;
    const e = onRoad[0];
    add('trade', `The trade route from ${c.name} is cut – drive the enemy ${UNIT_TYPES[e.type].name} off the road (+${TRADE.income} gold).`,
      e, { cityId: c.id });
    break;
  }

  // a promoted unit with a perk still to choose (the lowest id, so the hint is stable)
  const learner = state.units.find((u) => u.owner === player && perkChoices(u));
  if (learner) {
    add('perk', `${unitTitle(learner)} was promoted – choose a perk for it (${Object.values(PERKS.kinds).map((k) => k.name).join(', ')}).`,
      learner, { unitId: learner.id });
  }

  // a city focus that only costs gold: a fully grown city that isn't on commerce, a fortress with no
  // visible enemy near (one hint at most)
  const grown = cities.find((c) => citySize(c) >= GROWTH.maxSize && !cityUnrest(c) && focusOf(c) !== 'commerce' && focusOf(c) !== 'fortress');
  const idleFort = cities.find((c) => focusOf(c) === 'fortress' && !enemies.some((e) => distance(c, e) <= ADVISOR.dangerRange));
  if (grown) {
    add('focus', `${grown.name} is fully grown – switch its focus from ${cityFocus(grown).name} to Commerce (+${FOCUS.kinds.commerce.gold} gold a turn).`,
      grown, { cityId: grown.id, focus: 'commerce' });
  } else if (idleFort) {
    add('focus', `No enemy in sight near ${idleFort.name} – its Fortress focus costs ${-FOCUS.kinds.fortress.gold} gold a turn.`,
      idleFort, { cityId: idleFort.id, focus: 'balanced' });
  }

  // gold to spend: recruit in a free city (naming the suggested type), otherwise build
  // (keeping enough for a recruit later)
  const free = cities.find((c) => !unitAt(state, c.q, c.r)
    && Object.keys(UNIT_TYPES).some((type) => unitCost(state, c, type) <= gold));
  if (free) {
    const pick = suggestRecruit(state, player, free);
    add('recruit', `You have ${gold} gold – recruit ${withArticle(UNIT_TYPES[pick.type].name)} in ${free.name} (${pick.reason}).`,
      free, { cityId: free.id, unitType: pick.type });
  } else {
    build: for (const b of ADVISOR.buildOrder) {
      for (const c of cities) {
        const cost = buildingCost(state, player, b);
        if (!hasBuilding(c, b) && cost + ADVISOR.buildReserve <= gold) {
          const name = BUILDINGS[b].name.toLowerCase();
          const what = name.endsWith('s') ? name : `a ${name}`; // "walls", "barracks" take no article
          add('build', `You have ${gold} gold – build ${what} in ${c.name} (${cost} gold).`, c, { cityId: c.id });
          break build;
        }
      }
    }
  }

  return tips.sort((a, b) => ADVISOR.kinds[a.kind].order - ADVISOR.kinds[b.kind].order).slice(0, ADVISOR.limit);
}

// "an Archer", "a Spearman"
function withArticle(word) {
  return `${/^[AEIOU]/i.test(word) ? 'an' : 'a'} ${word}`;
}

// "1 enemy horseman", "3 enemy horsemen"
function enemyCount(n, type) {
  const name = UNIT_TYPES[type].name.toLowerCase();
  return `${n} enemy ${n === 1 ? name : (/man$/.test(name) ? name.replace(/man$/, 'men') : `${name}s`)}`;
}

// Recruit suggestion for an own free city: { type, reason } or null (not own, occupied, no gold).
// Pure and fog-safe – it only looks at visible enemies and explored cities. In order:
// spearmen against enemy horsemen nearby, a catapult for a near known enemy city (when the army has
// none and few enemies are around), archers behind a melee line / warriors when enemies are near,
// a scout when much of the fog is unexplored, a horseman to grab a known neutral city, else a warrior.
// A type the player can't afford is skipped; the fallback is the cheapest affordable type.
export function suggestRecruit(state, player, city) {
  if (!city || state.winner !== null || city.owner !== player || unitAt(state, city.q, city.r)) return null;
  const gold = state.gold[player];
  const can = (type) => unitCost(state, city, type) <= gold;
  const affordable = Object.keys(UNIT_TYPES).filter(can);
  if (!affordable.length) return null;
  const cfg = ADVISOR.recruit;
  const visible = visibleTiles(state, player);
  const explored = exploredTiles(state, player);
  const near = state.units.filter((u) => u.owner !== player && visible.has(key(u.q, u.r)) && distance(u, city) <= cfg.range);
  const mine = state.units.filter((u) => u.owner === player);
  const picks = [];

  const horses = near.filter((u) => u.type === 'horseman').length;
  if (horses && horses * 2 >= near.length) picks.push(['spearman', `counters the ${enemyCount(horses, 'horseman')} nearby`]);

  const siege = state.cities
    .filter((c) => c.owner !== null && c.owner !== player && explored.has(key(c.q, c.r)) && distance(c, city) <= cfg.siegeRange)
    .sort((a, b) => distance(a, city) - distance(b, city) || a.id - b.id)[0];
  if (siege && near.length < 2 && !mine.some((u) => UNIT_TYPES[u.type].siege)) {
    picks.push(['catapult', hasBuilding(siege, 'walls') ? `ignores the walls of ${siege.name}` : `strong against the garrison of ${siege.name}`]);
  }

  if (near.length) {
    const ranged = mine.filter((u) => UNIT_TYPES[u.type].range > 1).length;
    const melee = mine.length - ranged;
    if (melee >= 2 && ranged * 2 < melee) picks.push(['archer', 'supports your front line from 2 tiles away']);
    picks.push(['warrior', `a solid defender against the ${near.length} enem${near.length === 1 ? 'y' : 'ies'} nearby`]);
  } else {
    const unknown = 1 - explored.size / Object.keys(state.tiles).length;
    if (state.fog !== false && unknown >= cfg.unknownShare && !mine.some((u) => u.type === 'scout')) {
      picks.push(['scout', `${Math.round(unknown * 100)} % of the map is still unexplored`]);
    }
    const neutral = state.cities
      .filter((c) => c.owner === null && explored.has(key(c.q, c.r)))
      .sort((a, b) => distance(a, city) - distance(b, city) || a.id - b.id)[0];
    if (neutral) picks.push(['horseman', `fast enough to take ${neutral.name}`]);
  }
  picks.push(['warrior', 'the cheapest all-round unit']);

  const hit = picks.find(([type]) => can(type));
  if (hit) return { type: hit[0], reason: hit[1] };
  const cheapest = affordable.sort((a, b) => unitCost(state, city, a) - unitCost(state, city, b) || a.localeCompare(b))[0];
  return { type: cheapest, reason: 'the best you can afford now' };
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
    if (c.rally !== undefined && !(c.rally && s.tiles[key(c.rally.q, c.rally.r)])) return `bad rally point of ${c.name}`;
    if (c.size !== undefined && !(isInt(c.size) && c.size >= 1 && c.size <= GROWTH.maxSize)) return `bad size of ${c.name}`;
    if (c.growth !== undefined && !(isInt(c.growth) && c.growth >= 0 && c.growth < 100)) return `bad growth of ${c.name}`;
    if (c.focus !== undefined && !(Object.hasOwn(FOCUS.kinds, c.focus) && c.focus !== 'balanced' && c.owner !== null)) return `bad focus of ${c.name}`;
    if (c.order !== undefined && !(Object.hasOwn(UNIT_TYPES, c.order) && c.owner !== null)) return `bad order of ${c.name}`;
    if (c.unrest !== undefined && !(isInt(c.unrest) && c.unrest >= 0 && c.unrest <= UNREST.turns)) return `bad unrest of ${c.name}`;
  }
  const taken = new Set();
  for (const u of s.units) {
    if (!u || !UNIT_TYPES[u.type] || !isInt(u.owner) || u.owner < 0 || u.owner >= PLAYERS.length) return 'bad unit';
    const k = key(u.q, u.r);
    if (!s.tiles[k] || !TERRAIN[s.tiles[k].terrain].passable) return `unit ${u.id} off the map`;
    if (taken.has(k)) return `two units on ${k}`;
    taken.add(k);
    if (!Number.isFinite(u.hp) || u.hp <= 0) return `unit ${u.id} has no HP`;
    if (u.marched !== undefined && u.marched !== true) return `unit ${u.id} has a bad forced march`;
    if (u.raided !== undefined && u.raided !== true) return `unit ${u.id} has a bad hit and run`;
    if (u.pursuit !== undefined && !(u.pursuit && isInt(u.pursuit.q) && isInt(u.pursuit.r) && distance(u, u.pursuit) === 1)) return `unit ${u.id} has a bad pursuit`;
    if (u.sentry !== undefined && u.sentry !== 'watch' && u.sentry !== 'heal') return `unit ${u.id} has a bad watch order`;
    if (u.perks !== undefined && !(Array.isArray(u.perks) && u.perks.length < RANKS.length && new Set(u.perks).size === u.perks.length
      && u.perks.every((p) => Object.hasOwn(PERKS.kinds, p)))) return `unit ${u.id} has bad perks`;
    if (u.name !== undefined && !(typeof u.name === 'string' && u.name.length > 0 && u.name.length <= 40)) return `unit ${u.id} has a bad name`;
    if (u.kills !== undefined && !(isInt(u.kills) && u.kills >= 0)) return `unit ${u.id} has bad kills`;
  }
  if (s.fallen !== undefined) {
    if (!Array.isArray(s.fallen)) return 'bad hall of fame';
    for (const f of s.fallen) {
      if (!f || typeof f.name !== 'string' || f.name.length > 40 || !UNIT_TYPES[f.type] || !validOwner(f.owner)
        || !isInt(f.kills) || f.kills < 0 || !isInt(f.xp) || f.xp < 0) return 'bad hall of fame';
    }
  }
  if (s.milestones !== undefined) {
    if (!Array.isArray(s.milestones) || s.milestones.length > MILESTONES.limit) return 'bad war timeline';
    for (const m of s.milestones) {
      if (!m || !isInt(m.turn) || m.turn < 1 || !MILESTONES.kinds[m.kind] || m.kind === 'lead' || !validOwner(m.player) || m.player === null
        || typeof m.text !== 'string' || m.text.length > 200) return 'bad war timeline';
      if (m.seen !== undefined && !(Array.isArray(m.seen) && m.seen.every((p) => validOwner(p) && p !== null))) return 'bad war timeline';
    }
  }
  if (s.log !== undefined) {
    if (!Array.isArray(s.log)) return 'bad chronicle';
    for (const e of s.log) {
      if (!e || !isInt(e.turn) || typeof e.msg !== 'string') return 'bad chronicle';
      if ((e.q !== undefined || e.r !== undefined) && !s.tiles[key(e.q, e.r)]) return 'bad chronicle place';
    }
  }
  if (s.seasons !== undefined && typeof s.seasons !== 'boolean') return 'bad seasons';
  if (s.winner !== null && s.winner !== undefined && !validOwner(s.winner)) return 'bad winner';
  return null;
}
