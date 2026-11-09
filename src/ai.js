// Jednoduchá AI: útočí, když se to vyplatí, jinak táhne k nejbližšímu cíli a verbuje.
import { distance, key } from './hex.js';
import {
  reachable, attackTargets, previewAttack, moveUnit, attack, buyUnit,
  unitAt, getUnit, tileAt, difficultyOf, visibleTiles, exploredTiles, build, hasBuilding, unitCost, buildingCost, factionOf,
} from './game.js';
import { UNIT_TYPES, TERRAIN } from './rules.js';

// Co AI ví o mapě. Na těžké obtížnosti vidí všechno, jinak jen to, co prozkoumala a vidí.
export function aiKnowledge(state, me) {
  if (difficultyOf(state, me).seesAll) return { sees: () => true, knows: () => true };
  const vis = visibleTiles(state, me);
  const exp = exploredTiles(state, me);
  return { sees: (q, r) => vis.has(key(q, r)), knows: (q, r) => exp.has(key(q, r)) };
}

export function runAITurn(state) {
  const me = state.current;
  recruit(state, me);
  const know = aiKnowledge(state, me);
  const garrisons = assignGarrisons(state, me, know);
  // střelci a katapulty jdou první, ať boj na blízko dokončí oslabené cíle (soustředění palby)
  const ids = state.units
    .filter((u) => u.owner === me)
    .sort((a, b) => UNIT_TYPES[b.type].range - UNIT_TYPES[a.type].range || a.id - b.id)
    .map((u) => u.id);
  for (const id of ids) {
    if (state.winner !== null) return;
    const unit = getUnit(state, id);
    if (!unit) continue;
    if (garrisons.has(id)) {
      holdCity(state, unit, garrisons.get(id));
    } else if (isWounded(unit) && enemiesNear(state, unit, know, 3).length) {
      retreat(state, unit, know);
    } else {
      if (planStrike(state, unit, know)) continue;
      if (tryBestAttack(state, unit)) continue;
      moveTowardsGoal(state, unit);
      const after = getUnit(state, id);
      if (after) tryBestAttack(state, after);
    }
  }
  recruit(state, me);
  buildSomething(state, me);
}

// Najde nejlepší kombinaci „dojdi na pole a zaútoč“. Pozice útočníka ovlivňuje protiúder
// (terén) i dostřel, proto se útok zkusmo vyhodnotí z každého dosažitelného pole.
export function planStrike(state, unit, know = aiKnowledge(state, unit.owner)) {
  const range = UNIT_TYPES[unit.type].range;
  const targets = state.units.filter((u) => u.owner !== unit.owner && know.sees(u.q, u.r));
  if (!targets.length || unit.hasAttacked) return false;
  const spots = [[key(unit.q, unit.r), 0], ...reachable(state, unit)];
  const home = { q: unit.q, r: unit.r };
  let best = null;
  for (const [k] of spots) {
    const [q, r] = k.split(',').map(Number);
    const near = targets.filter((t) => distance(t, { q, r }) <= range);
    if (!near.length) continue;
    unit.q = q; unit.r = r; // zkusmo – hned se vrací zpět
    for (const t of near) {
      const s = scoreAttack(state, unit, t) + TERRAIN[tileAt(state, q, r).terrain].defBonus;
      if (s > 0 && (!best || s > best.s)) best = { s, q, r, t };
    }
    unit.q = home.q; unit.r = home.r;
  }
  if (!best) return false;
  if (best.q !== unit.q || best.r !== unit.r) moveUnit(state, unit.id, best.q, best.r);
  const u = getUnit(state, unit.id);
  return !!u && attack(state, u.id, best.t.id);
}

const WOUNDED = 0.25; // pod tímto podílem životů jednotka ustupuje
const THREAT_RADIUS = 2; // nepřítel tak blízko města = město potřebuje posádku

export const isWounded = (u) => u.hp / UNIT_TYPES[u.type].hp <= WOUNDED;

function enemiesNear(state, unit, know, radius) {
  return state.units.filter((u) => u.owner !== unit.owner && know.sees(u.q, u.r) && distance(u, unit) <= radius);
}

// Ohrožená vlastní města (viditelný nepřítel do THREAT_RADIUS polí) dostanou posádku:
// buď tam už někdo stojí, nebo nejbližší jednotka, která to stihne v tomto tahu.
// Vrací Map id jednotky -> město.
export function assignGarrisons(state, me, know = aiKnowledge(state, me)) {
  const result = new Map();
  const taken = new Set();
  for (const city of state.cities.filter((c) => c.owner === me)) {
    const threat = state.units.some((u) => u.owner !== me && know.sees(u.q, u.r) && distance(u, city) <= THREAT_RADIUS);
    if (!threat) continue;
    const here = unitAt(state, city.q, city.r);
    if (here && here.owner === me) {
      result.set(here.id, city);
      taken.add(here.id);
      continue;
    }
    if (here) continue; // město drží nepřítel
    let best = null;
    let bestCost = Infinity;
    for (const u of state.units) {
      if (u.owner !== me || taken.has(u.id) || UNIT_TYPES[u.type].siege) continue;
      const cost = reachable(state, u).get(key(city.q, city.r));
      if (cost !== undefined && cost < bestCost) { bestCost = cost; best = u; }
    }
    if (best) {
      result.set(best.id, city);
      taken.add(best.id);
    }
  }
  return result;
}

// Posádka: dojde do města a zůstane v něm; z města normálně útočí (měřeno: pasivní posádka hrála hůř).
function holdCity(state, unit, city) {
  if (unit.q !== city.q || unit.r !== city.r) moveUnit(state, unit.id, city.q, city.r);
  const u = getUnit(state, unit.id);
  if (u) tryBestAttack(state, u);
}

// Zraněná jednotka ustoupí do vlastního města, nebo co nejdál od nepřátel. Útočí jen na jistý zásah.
function retreat(state, unit, know) {
  const here = state.cities.find((c) => c.q === unit.q && c.r === unit.r && c.owner === unit.owner);
  if (!here) {
    const options = reachable(state, unit);
    const enemies = enemiesNear(state, unit, know, 6);
    let bestKey = null;
    let bestScore = -Infinity;
    for (const k of options.keys()) {
      const [q, r] = k.split(',').map(Number);
      const city = state.cities.find((c) => c.q === q && c.r === r);
      if (city && city.owner !== unit.owner) continue; // neustupovat do cizího města
      const minDist = Math.min(...enemies.map((e) => distance(e, { q, r })), 9);
      let s = minDist + TERRAIN[tileAt(state, q, r).terrain].defBonus * 2;
      if (city) s += 10; // vlastní město léčí a brání
      if (s > bestScore) { bestScore = s; bestKey = k; }
    }
    if (bestKey) {
      const [q, r] = bestKey.split(',').map(Number);
      moveUnit(state, unit.id, q, r);
    }
  }
  const u = getUnit(state, unit.id);
  if (u) tryBestAttack(state, u, { safeOnly: true });
}

// Stavby z přebytku zlata: ohrožené město dostane hradby, jinak trh a kasárna (hlavní město napřed).
const RESERVE = 12;
export function buildSomething(state, me) {
  const know = aiKnowledge(state, me);
  const mine = state.cities.filter((c) => c.owner === me).sort((a, b) => b.capital - a.capital);
  for (const city of mine) {
    const threatened = state.units.some((u) => u.owner !== me && know.sees(u.q, u.r) && distance(u, city) <= 3);
    if (threatened && !hasBuilding(city, 'walls') && state.gold[me] >= buildingCost(state, me, 'walls')) {
      build(state, city.id, 'walls');
    }
  }
  for (const b of ['market', 'barracks']) {
    for (const city of mine) {
      if (!hasBuilding(city, b) && state.gold[me] >= buildingCost(state, me, b) + RESERVE) build(state, city.id, b);
    }
  }
}

function scoreAttack(state, unit, target) {
  const p = previewAttack(state, unit, target);
  if (p.dies && !p.kills) return -Infinity;
  let s = p.damage * 2 - p.counter * 1.5 * difficultyOf(state, unit.owner).caution;
  if (p.kills) s += 10;
  // soustředění: raději dorazit oslabený cíl a cennější jednotky
  s += (1 - target.hp / UNIT_TYPES[target.type].hp) * 3;
  s += UNIT_TYPES[target.type].cost / 10;
  return s;
}

// safeOnly: jen útoky, které cíl zničí nebo nedostanou protiúder.
function tryBestAttack(state, unit, { safeOnly = false } = {}) {
  const targets = attackTargets(state, unit);
  let best = null;
  let bestScore = 0;
  for (const t of targets) {
    if (safeOnly) {
      const p = previewAttack(state, unit, t);
      if (!p.kills && p.counter > 0) continue;
    }
    const s = scoreAttack(state, unit, t);
    if (s > bestScore) {
      bestScore = s;
      best = t;
    }
  }
  if (!best) return false;
  return attack(state, unit.id, best.id);
}

// Cíle pohybu: známá cizí města a viditelní nepřátelé. Když žádné nejsou, AI průzkumničí.
export function goalsFor(state, unit, know = aiKnowledge(state, unit.owner)) {
  const goals = [];
  for (const c of state.cities) {
    if (c.owner !== unit.owner && know.knows(c.q, c.r)) goals.push({ q: c.q, r: c.r, w: c.owner === null ? 1 : 1.3 });
  }
  for (const u of state.units) if (u.owner !== unit.owner && know.sees(u.q, u.r)) goals.push({ q: u.q, r: u.r, w: 1.1, enemy: true });
  if (!goals.length) {
    for (const t of Object.values(state.tiles)) {
      if (!know.knows(t.q, t.r) && TERRAIN[t.terrain].passable) goals.push({ q: t.q, r: t.r, w: 0.8, explore: true });
    }
  }
  return goals;
}

function moveTowardsGoal(state, unit) {
  const options = reachable(state, unit);
  if (!options.size) return;
  const know = aiKnowledge(state, unit.owner);
  const goals = goalsFor(state, unit, know);
  if (!goals.length) return;
  const range = UNIT_TYPES[unit.type].range;
  let bestKey = null;
  let bestScore = evalPos(state, unit, unit.q, unit.r, goals, range, know);
  for (const k of options.keys()) {
    const [q, r] = k.split(',').map(Number);
    const s = evalPos(state, unit, q, r, goals, range, know);
    if (s > bestScore) {
      bestScore = s;
      bestKey = k;
    }
  }
  if (bestKey) {
    const [q, r] = bestKey.split(',').map(Number);
    moveUnit(state, unit.id, q, r);
  }
}

function evalPos(state, unit, q, r, goals, range, know) {
  let score = -Infinity;
  for (const g of goals) {
    const d = distance({ q, r }, g);
    const wantDist = g.enemy ? range : 0;
    const s = -Math.abs(d - wantDist) * g.w;
    if (s > score) score = s;
  }
  const t = tileAt(state, q, r);
  score += TERRAIN[t.terrain].defBonus * 0.5;
  // lučištníci nemají rádi těsnou blízkost (viditelných) nepřátel
  if (range > 1) {
    for (const u of state.units) {
      if (u.owner !== unit.owner && know.sees(u.q, u.r) && distance({ q, r }, u) === 1) score -= 1.5;
    }
  }
  return score;
}

// Jakou jednotku AI chce: doplňuje armádu k cílovému poměru typů.
// Vidí-li nepřátelské jezdce, chce víc kopiníků; katapulty až od 8. kola.
export function pickRecruit(state, me, city) {
  const know = aiKnowledge(state, me);
  const enemyHorse = state.units.filter((u) => u.owner !== me && u.type === 'horseman' && know.sees(u.q, u.r)).length;
  const ratio = { warrior: 3, archer: 2, horseman: 2, spearman: 1 + 2 * enemyHorse, catapult: state.turn >= 8 ? 1 : 0 };
  // silné stránky vlastní frakce: zlevněných jednotek chce víc
  const favored = factionOf(state, me).unitDiscount || {};
  for (const type of Object.keys(favored)) ratio[type] += 2;
  const count = {};
  for (const u of state.units) if (u.owner === me) count[u.type] = (count[u.type] || 0) + 1;
  let best = null;
  let bestNeed = Infinity;
  let bestWant = 0;
  for (const [type, want] of Object.entries(ratio)) {
    if (!want || state.gold[me] < unitCost(state, city, type)) continue;
    const need = (count[type] || 0) / want;
    // při shodě vyhrává typ, kterého chceme víc
    if (need < bestNeed || (need === bestNeed && want > bestWant)) { bestNeed = need; best = type; bestWant = want; }
  }
  return best;
}

function recruit(state, me) {
  for (const city of state.cities.filter((c) => c.owner === me)) {
    if (unitAt(state, city.q, city.r)) continue;
    const type = pickRecruit(state, me, city);
    if (type) buyUnit(state, city.id, type);
  }
}

