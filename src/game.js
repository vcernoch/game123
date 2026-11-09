// Čistá herní logika bez DOM. Stav je obyčejný JSON objekt (dá se uložit).
import { key, neighbors, distance } from './hex.js';
import { generateMap, hasRiverEdge } from './map.js';
import {
  TERRAIN, UNIT_TYPES, PLAYERS, ECONOMY, VISION, DIFFICULTY, BUILDINGS, BUILDING_EFFECTS, RANKS, XP, ROAD_COST, RIVER,
  FACTIONS, NO_FACTION, MAP_SIZES, HAPPENINGS,
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
    // AI dostane jinou frakci než hráč, vybranou podle seedu (opakovatelně)
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

// ---------- statistiky ----------

function emptyStats() {
  return { kills: PLAYERS.map(() => 0), losses: PLAYERS.map(() => 0), captures: PLAYERS.map(() => 0) };
}

// Síla armády: cena jednotek vážená životy a hodností (hrubé, ale srovnatelné číslo).
export function armyPower(state, player) {
  let sum = 0;
  for (const u of state.units) {
    if (u.owner !== player) continue;
    sum += UNIT_TYPES[u.type].cost * (u.hp / UNIT_TYPES[u.type].hp) * rankMult(u);
  }
  return Math.round(sum);
}

// Zapíše stav kola do historie (jednou za kolo; opakovaný zápis kolo přepíše).
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

export const STATE_VERSION = 12;

// Převede uložený stav starší verze na aktuální; neznámý formát vrátí null.
export function migrateState(s) {
  if (!s || typeof s !== 'object') return null;
  if (s.version === 1) {
    s.events = [];
    s.version = 2;
  }
  if (s.version === 2) {
    // mlha války: staré hry ji dostanou taky, prozkoumané je to, co je vidět teď
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
    // silnice přibyly až ve verzi 7 – staré mapy je prostě nemají (tile.road chybí = bez silnice)
    s.version = 7;
  }
  if (s.version === 7) {
    s.factions = [null, null]; // staré hry hrají bez frakcí
    s.version = 8;
  }
  if (s.version === 8) {
    s.history = []; // statistiky začnou od načtení
    s.stats = emptyStats();
    s.version = 9;
  }
  if (s.version === 9) {
    // řeky přibyly ve verzi 10 – staré mapy je nemají (tile.rivers chybí = bez řek)
    s.version = 10;
  }
  if (s.version === 10) {
    s.happenings = false; // rozehraná hra pokračuje podle pravidel, se kterými začala
    s.version = 11;
  }
  if (s.version === 11) {
    // záznamy kroniky bez `seen` jsou veřejné, takže staré záznamy zůstanou vidět všem
    s.version = 12;
  }
  return s.version === STATE_VERSION ? s : null;
}

// ---------- mlha války ----------

// Pole, která hráč právě vidí (Set klíčů). Bez mlhy vidí všechno.
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
  for (const c of state.cities) if (c.owner === player) look(c.q, c.r, VISION.city);
  return seen;
}

// Přidá aktuálně viditelná pole mezi prozkoumaná (state.explored[player] je seřazené pole klíčů).
export function updateExplored(state, player) {
  if (!state.explored) return;
  const all = new Set(state.explored[player] || []);
  for (const k of visibleTiles(state, player)) all.add(k);
  state.explored[player] = [...all].sort();
}

// Prozkoumaná pole jako Set (pro rychlé dotazy při kreslení).
export function exploredTiles(state, player) {
  if (!state.fog) return new Set(Object.keys(state.tiles));
  return new Set(state.explored ? state.explored[player] : []);
}

// ---------- události pro animace ----------
// Akce zapisují do state.events, co se stalo (JSON). UI si je vybere přes drainEvents()
// a přehraje je na kopii stavu z doby před akcí pomocí applyEvent().

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
    if (u) { u.q = end.q; u.r = end.r; }
  } else if (ev.type === 'attack') {
    const a = getUnit(state, ev.attackerId);
    const d = getUnit(state, ev.defenderId);
    if (d) {
      d.hp = ev.defenderHp ?? d.hp - ev.damage;
      d.xp = ev.defenderXp ?? d.xp;
    }
    if (a) {
      a.hp = ev.attackerHp ?? a.hp - ev.counter;
      a.xp = ev.attackerXp ?? a.xp;
    }
    if (ev.killed) removeUnit(state, ev.defenderId);
    if (ev.died) removeUnit(state, ev.attackerId);
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

export const CITY_DEF_BONUS = 0.25;

export const hasBuilding = (city, b) => !!city.buildings && city.buildings.includes(b);

// ---------- frakce ----------

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

// Obranný bonus terénu pro jednotku (Lesní lid má v lese navíc).
export function terrainDefense(state, unit, tile) {
  const f = factionOf(state, unit.owner);
  return TERRAIN[tile.terrain].defBonus + (tile.terrain === 'forest' ? f.forestDefense || 0 : 0);
}

// Příjem města; se state se započítá i bonus frakce majitele.
export function cityIncome(city, state = null) {
  const base = city.capital ? ECONOMY.capitalIncome : ECONOMY.cityIncome;
  const faction = state && city.owner !== null ? factionOf(state, city.owner).cityIncome || 0 : 0;
  return base + faction + (hasBuilding(city, 'market') ? BUILDING_EFFECTS.marketIncome : 0);
}

// Násobitel obrany posádky ve vlastním městě (město + případné hradby).
export function cityDefenseMult(city) {
  return (1 + CITY_DEF_BONUS) * (hasBuilding(city, 'walls') ? 1 + BUILDING_EFFECTS.wallsDefense : 1);
}

// Cena jednotky při verbování v daném městě (kasárna a frakce majitele zlevňují).
export function unitCost(state, city, type) {
  let discount = hasBuilding(city, 'barracks') ? BUILDING_EFFECTS.barracksDiscount : 0;
  const fd = city.owner !== null ? factionOf(state, city.owner).unitDiscount : null;
  if (fd && fd[type]) discount += fd[type];
  return Math.max(1, UNIT_TYPES[type].cost - discount);
}

export function incomeOf(state, player) {
  const base = state.cities.filter((c) => c.owner === player).reduce((sum, c) => sum + cityIncome(c, state), 0);
  return Math.max(0, base + difficultyOf(state, player).incomeBonus);
}

// Nastavení obtížnosti pro daného hráče (člověk má vždy neutrální hodnoty).
export function difficultyOf(state, player) {
  if (!PLAYERS[player].isAI) return DIFFICULTY.normal;
  return DIFFICULTY[state.difficulty] || DIFFICULTY.normal;
}

// Souhrn pro tooltip města: příjem, bonus obrany posádky (terén + město) a léčení.
export function cityInfo(state, city) {
  const tile = tileAt(state, city.q, city.r);
  const owner = city.owner === null ? null : { owner: city.owner };
  const defMult = (1 + (owner ? terrainDefense(state, owner, tile) : TERRAIN[tile.terrain].defBonus)) * cityDefenseMult(city);
  const garrison = unitAt(state, city.q, city.r) || null;
  return {
    income: cityIncome(city, state),
    defensePct: Math.round((defMult - 1) * 100),
    heal: ECONOMY.healInCity,
    garrison: garrison && garrison.owner === city.owner ? garrison : null,
  };
}

// Cena kroku z pole `from` na sousední pole `to` (silnice zlevňují, jinak terén cílového pole).
// unit (nepovinná) určuje frakci – Lesní lid chodí lesem levněji.
export function stepCost(state, from, to, unit = null) {
  const a = tileAt(state, from.q, from.r);
  const b = tileAt(state, to.q, to.r);
  if (a && b && a.road && b.road) return ROAD_COST; // silnice přes řeku = most
  const river = riverBetween(state, from, to) ? RIVER.crossCost : 0;
  if (unit && b.terrain === 'forest') {
    const fc = factionOf(state, unit.owner).forestCost;
    if (fc) return fc + river;
  }
  return TERRAIN[b.terrain].cost + river;
}

// Teče mezi sousedními poli a, b řeka?
export function riverBetween(state, a, b) {
  return hasRiverEdge(state.tiles, a, b);
}

// Bonus obránce napadeného zblízka přes řeku (0, když řeka mezi nimi neteče).
export function riverDefense(state, attacker, defender) {
  return distance(attacker, defender) === 1 && riverBetween(state, attacker, defender) ? RIVER.defBonus : 0;
}

// Prohledá dosažitelná pole (Dijkstra). Vrací ceny i předchůdce, aby šla složit trasa.
// Přes vlastní jednotky lze projít, ale ne zastavit.
function searchMoves(state, unit) {
  const result = new Map();
  const parent = new Map();
  if (unit.movesLeft <= 0) return { result, parent };
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

// Dosažitelná pole: Map klíč -> cena pohybu.
export function reachable(state, unit) {
  return searchMoves(state, unit).result;
}

// Nejlevnější trasa na cílové pole jako pole {q, r} od startu (včetně) po cíl.
// Vrací null, pokud cíl není v tomto tahu dosažitelný.
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

// Další vlastní jednotka, která se ještě může hýbat nebo útočit (pro klávesu Tab).
// Prochází podle id cyklicky za jednotkou afterId; vrací null, když žádná není.
export function nextActiveUnit(state, player, afterId = null) {
  const canAct = (u) => u.movesLeft > 0 || attackTargets(state, u).length > 0;
  const mine = state.units.filter((u) => u.owner === player && canAct(u)).sort((a, b) => a.id - b.id);
  if (!mine.length) return null;
  return mine.find((u) => afterId === null || u.id > afterId) || mine[0];
}

// Dá se pohyb vrátit? before/after = stav před a po akci hráče `viewer`, events = co akce vyvolala.
// Vrátit jde jen obyčejný pohyb, který hráči neprozradil nic nového: žádné dobytí ani povýšení,
// žádné nově prozkoumané pole a na nově viditelných polích žádná cizí jednotka ani cizí město.
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

export function attackTargets(state, unit) {
  if (unit.hasAttacked) return [];
  const range = UNIT_TYPES[unit.type].range;
  return state.units.filter((u) => u.owner !== unit.owner && distance(unit, u) <= range);
}

// ---------- zkušenosti ----------

export function rankOf(unit) {
  let rank = 0;
  RANKS.forEach((r, i) => { if ((unit.xp || 0) >= r.xp) rank = i; });
  return rank;
}

export const rankMult = (unit) => 1 + XP.rankBonus * rankOf(unit);

// Přidá zkušenosti; při povýšení jednotku trochu vyléčí. Vrací true, když došlo k povýšení.
function gainXp(state, unit, amount) {
  const before = rankOf(unit);
  unit.xp = (unit.xp || 0) + amount;
  if (rankOf(unit) <= before) return false;
  unit.hp = Math.min(UNIT_TYPES[unit.type].hp, unit.hp + XP.promotionHeal);
  addLog(state, `${PLAYERS[unit.owner].name}: ${UNIT_TYPES[unit.type].name} povýšen na ${RANKS[rankOf(unit)].name}`, {
    by: unit.owner, at: [unit],
  });
  return true;
}

// Násobek síly jednotky proti konkrétnímu protivníkovi (kopiník proti jezdci…).
export function vsMult(unit, other) {
  const bonus = other && UNIT_TYPES[unit.type].bonusVs ? UNIT_TYPES[unit.type].bonusVs[other.type] || 0 : 0;
  return 1 + bonus;
}

// Obrana jednotky; attacker (nepovinný) určuje bonusy proti typu a obléhání.
export function defenseValue(state, unit, attacker = null) {
  const t = tileAt(state, unit.q, unit.r);
  let d = UNIT_TYPES[unit.type].def * rankMult(unit) * (1 + terrainDefense(state, unit, t)) * vsMult(unit, attacker);
  const city = cityAt(state, unit.q, unit.r);
  if (city && city.owner === unit.owner) {
    const siege = attacker && UNIT_TYPES[attacker.type].siege;
    d *= siege ? 1 + CITY_DEF_BONUS : cityDefenseMult(city); // obléhací stroj hradby ignoruje
  }
  return d;
}

// Útočná síla včetně hodnosti, bonusu proti typu a obléhání města.
function attackPower(state, unit, target) {
  let atk = UNIT_TYPES[unit.type].atk * rankMult(unit) * vsMult(unit, target);
  const siege = UNIT_TYPES[unit.type].siege;
  if (siege && target && cityAt(state, target.q, target.r)) atk *= 1 + siege;
  return atk;
}

// Odhad boje bez náhody – používá ho UI i AI.
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
    xp: 0,
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
  const city = cityAt(state, q, r);
  if (city && city.owner !== unit.owner) {
    const prev = city.owner;
    city.owner = unit.owner;
    emit(state, { type: 'capture', cityId: city.id, owner: unit.owner });
    countStat(state, 'captures', unit.owner);
    const loot = factionOf(state, unit.owner).captureGold || 0;
    state.gold[unit.owner] += loot;
    addLog(state, `${PLAYERS[unit.owner].name}: dobyto město ${city.name}${loot ? ` (kořist ${loot} zl.)` : ''}`, {
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
  const res = previewAttack(state, a, d);
  d.hp -= res.damage;
  a.hasAttacked = true;
  a.movesLeft = 0;
  a.moved = true;
  const aName = UNIT_TYPES[a.type].name;
  const dName = UNIT_TYPES[d.type].name;
  // boj vidí oba účastníci a každý, kdo vidí aspoň jedno z polí (spočítáno před ztrátou jednotek)
  const fight = { by: a.owner, at: [{ q: a.q, r: a.r }, { q: d.q, r: d.r }], also: [d.owner] };
  fight.seen = seenBy(state, fight);
  const ev = { type: 'attack', attackerId: a.id, defenderId: d.id, damage: res.damage, counter: 0, killed: d.hp <= 0, died: false };
  emit(state, ev);
  if (d.hp <= 0) {
    removeUnit(state, d.id);
    addLog(state, `${PLAYERS[a.owner].name}: ${aName} zničil jednotku ${dName}`, fight);
    countStat(state, 'kills', a.owner);
    countStat(state, 'losses', d.owner);
    ev.promoted = gainXp(state, a, XP.attack + XP.kill);
  } else {
    a.hp -= res.counter;
    ev.counter = res.counter;
    ev.died = a.hp <= 0;
    addLog(state, `${PLAYERS[a.owner].name}: ${aName} útočí na ${dName} (−${res.damage}, protiúder −${res.counter})`, fight);
    if (a.hp <= 0) {
      removeUnit(state, a.id);
      addLog(state, `${aName} padl v boji`, fight);
      countStat(state, 'kills', d.owner);
      countStat(state, 'losses', a.owner);
    } else {
      ev.promoted = gainXp(state, a, XP.attack);
    }
    ev.defenderPromoted = gainXp(state, d, XP.defend);
  }
  // výsledné hodnoty, aby přehrání události bylo přesné i s povýšením
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
  spawnUnit(state, type, state.current, city.q, city.r);
  addLog(state, `${PLAYERS[state.current].name}: naverbován ${t.name} (${city.name})`, { by: state.current, at: [city] });
  return true;
}

// Postaví budovu ve vlastním městě. Vrací true/false podle úspěchu.
export function build(state, cityId, building) {
  const city = state.cities.find((c) => c.id === cityId);
  const b = BUILDINGS[building];
  if (!city || !b || city.owner !== state.current || state.winner !== null) return false;
  const cost = buildingCost(state, state.current, building);
  if (hasBuilding(city, building) || state.gold[state.current] < cost) return false;
  state.gold[state.current] -= cost;
  city.buildings = [...(city.buildings || []), building];
  emit(state, { type: 'build', cityId, building });
  addLog(state, `${PLAYERS[state.current].name}: dokončena stavba ${b.name} (${city.name})`, { by: state.current, at: [city] });
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

// ---------- náhodné události ----------

// RNG pro událost je odvozený ze seedu, kola a hráče – stav nemusí nést stav generátoru
// a stejná hra dá stejné události.
function happeningRng(state, player) {
  return createRng((state.seed * 7919 + state.turn * 131 + player * 17 + 12345) >>> 0);
}

// Hodí kostkou na náhodnou událost pro hráče na začátku jeho tahu. Vrací událost nebo null.
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
  // vzpoura jen v obyčejném městě; když hráč žádné nemá, nic se nestane
  const pool = kind === 'revolt' ? cities.filter((c) => !c.capital) : cities;
  if (!pool.length) return null;
  return applyHappening(state, player, kind, rng.pick(pool));
}

// Provede událost daného druhu v daném městě (exportované kvůli testům).
export function applyHappening(state, player, kind, city) {
  const info = HAPPENINGS.kinds[kind];
  const ev = { type: 'happening', kind, player, cityId: city.id, gold: 0, hits: [], suppressed: false };
  const who = PLAYERS[player].name;
  const where = { by: player, at: [city] };
  if (kind === 'harvest') {
    ev.gold = info.gold;
    state.gold[player] += info.gold;
    addLog(state, `${who}: ${info.name} ve městě ${city.name} (+${info.gold} zl.)`, where);
  } else if (kind === 'plague') {
    for (const u of state.units) {
      if (distance(u, city) > 1 || u.hp <= 1) continue;
      u.hp = Math.max(1, u.hp - info.damage);
      ev.hits.push({ unitId: u.id, hp: u.hp });
      if (!where.also) where.also = [];
      where.also.push(u.owner); // o nákaze ví i majitel postižené jednotky
    }
    addLog(state, `${who}: ${info.name} ve městě ${city.name}${ev.hits.length ? ` – nakaženo jednotek: ${ev.hits.length}` : ''}`, where);
  } else if (kind === 'revolt') {
    const g = unitAt(state, city.q, city.r);
    if (g && g.owner === player) {
      ev.suppressed = true;
      addLog(state, `${who}: ${info.name} ve městě ${city.name} – posádka udržela pořádek`, where);
    } else {
      ev.gold = -Math.min(state.gold[player], cityIncome(city, state));
      state.gold[player] += ev.gold;
      addLog(state, `${who}: ${info.name} ve městě ${city.name} – město tento tah neodvedlo daně (${ev.gold} zl.)`, where);
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
      addLog(state, `Konec hry – vítěz: ${PLAYERS[state.winner].name}`);
      recordHistory(state);
      return;
    }
  }
}

// Zápis do kroniky. Bez `where` je záznam veřejný (konec hry…). S `where` = { by, at, also, seen }
// se uloží `seen`: hráči, kteří akci viděli – její původce, hráči z `also` a ti, kdo právě vidí
// některé z polí `at`. Bez mlhy vidí všichni, takže se `seen` neukládá.
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

// Kronika z pohledu hráče (nejstarší první). Záznamy, které hráč neviděl, se slijí do jednoho
// řádku „Akce soupeře v mlze války (N)“ s počtem; po konci hry je vidět všechno.
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
  for (const e of out) if (e.hidden) e.msg = `Akce soupeře v mlze války (${e.count})`;
  return out;
}
