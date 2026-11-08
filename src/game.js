// Čistá herní logika bez DOM. Stav je obyčejný JSON objekt (dá se uložit).
import { key, neighbors, distance } from './hex.js';
import { generateMap } from './map.js';
import {
  TERRAIN, UNIT_TYPES, PLAYERS, ECONOMY, VISION, DIFFICULTY, BUILDINGS, BUILDING_EFFECTS, RANKS, XP,
} from './rules.js';

export function createGame({
  seed = 1, cols = 14, rows = 10, neutralCities = 4, fog = true, difficulty = 'normal',
} = {}) {
  if (!DIFFICULTY[difficulty]) difficulty = 'normal';
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
    difficulty,
    explored: PLAYERS.map(() => []),
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
  state.events = [];
  PLAYERS.forEach((_, p) => updateExplored(state, p));
  return state;
}

export const STATE_VERSION = 6;

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

export function cityIncome(city) {
  const base = city.capital ? ECONOMY.capitalIncome : ECONOMY.cityIncome;
  return base + (hasBuilding(city, 'market') ? BUILDING_EFFECTS.marketIncome : 0);
}

// Násobitel obrany posádky ve vlastním městě (město + případné hradby).
export function cityDefenseMult(city) {
  return (1 + CITY_DEF_BONUS) * (hasBuilding(city, 'walls') ? 1 + BUILDING_EFFECTS.wallsDefense : 1);
}

// Cena jednotky při verbování v daném městě (kasárna zlevňují).
export function unitCost(city, type) {
  const discount = hasBuilding(city, 'barracks') ? BUILDING_EFFECTS.barracksDiscount : 0;
  return Math.max(1, UNIT_TYPES[type].cost - discount);
}

export function incomeOf(state, player) {
  const base = state.cities.filter((c) => c.owner === player).reduce((sum, c) => sum + cityIncome(c), 0);
  return Math.max(0, base + difficultyOf(state, player).incomeBonus);
}

// Nastavení obtížnosti pro daného hráče (člověk má vždy neutrální hodnoty).
export function difficultyOf(state, player) {
  if (!PLAYERS[player].isAI) return DIFFICULTY.normal;
  return DIFFICULTY[state.difficulty] || DIFFICULTY.normal;
}

// Souhrn pro tooltip města: příjem, bonus obrany posádky (terén + město) a léčení.
export function cityInfo(state, city) {
  const t = TERRAIN[tileAt(state, city.q, city.r).terrain];
  const defMult = (1 + t.defBonus) * cityDefenseMult(city);
  const garrison = unitAt(state, city.q, city.r) || null;
  return {
    income: cityIncome(city),
    defensePct: Math.round((defMult - 1) * 100),
    heal: ECONOMY.healInCity,
    garrison: garrison && garrison.owner === city.owner ? garrison : null,
  };
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
      const stepCost = TERRAIN[t.terrain].cost;
      let cost = cur.cost + stepCost;
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
  addLog(state, `${PLAYERS[unit.owner].name}: ${UNIT_TYPES[unit.type].name} povýšen na ${RANKS[rankOf(unit)].name}`);
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
  let d = UNIT_TYPES[unit.type].def * rankMult(unit) * (1 + TERRAIN[t.terrain].defBonus) * vsMult(unit, attacker);
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
  const def = defenseValue(state, defender, attacker);
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
    addLog(state, `${PLAYERS[unit.owner].name}: dobyto město ${city.name}`);
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
  const ev = { type: 'attack', attackerId: a.id, defenderId: d.id, damage: res.damage, counter: 0, killed: d.hp <= 0, died: false };
  emit(state, ev);
  if (d.hp <= 0) {
    removeUnit(state, d.id);
    addLog(state, `${PLAYERS[a.owner].name}: ${aName} zničil jednotku ${dName}`);
    ev.promoted = gainXp(state, a, XP.attack + XP.kill);
  } else {
    a.hp -= res.counter;
    ev.counter = res.counter;
    ev.died = a.hp <= 0;
    addLog(state, `${PLAYERS[a.owner].name}: ${aName} útočí na ${dName} (−${res.damage}, protiúder −${res.counter})`);
    if (a.hp <= 0) {
      removeUnit(state, a.id);
      addLog(state, `${aName} padl v boji`);
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
  const cost = unitCost(city, type);
  if (state.gold[state.current] < cost || unitAt(state, city.q, city.r)) return false;
  state.gold[state.current] -= cost;
  spawnUnit(state, type, state.current, city.q, city.r);
  addLog(state, `${PLAYERS[state.current].name}: naverbován ${t.name} (${city.name})`);
  return true;
}

// Postaví budovu ve vlastním městě. Vrací true/false podle úspěchu.
export function build(state, cityId, building) {
  const city = state.cities.find((c) => c.id === cityId);
  const b = BUILDINGS[building];
  if (!city || !b || city.owner !== state.current || state.winner !== null) return false;
  if (hasBuilding(city, building) || state.gold[state.current] < b.cost) return false;
  state.gold[state.current] -= b.cost;
  city.buildings = [...(city.buildings || []), building];
  emit(state, { type: 'build', cityId, building });
  addLog(state, `${PLAYERS[state.current].name}: dokončena stavba ${b.name} (${city.name})`);
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
