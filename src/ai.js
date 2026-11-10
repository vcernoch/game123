// Simple AI: attacks when it pays off, otherwise moves toward the nearest goal and recruits.
import { distance, key } from './hex.js';
import {
  reachable, attackTargets, previewAttack, moveUnit, attack, buyUnit,
  unitAt, getUnit, tileAt, fortify, difficultyOf, visibleTiles, exploredTiles, build, hasBuilding, unitCost, buildingCost, factionOf,
  threatTiles, cityAt, upgradeOptions, upgradeUnit,
} from './game.js';
import { UNIT_TYPES, TERRAIN } from './rules.js';

// What the AI knows about the map. On hard it sees everything, otherwise only what it has explored and sees.
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
  upgradeSomething(state, me, know);
  const garrisons = assignGarrisons(state, me, know);
  const danger = dangerMap(state, me, know);
  // archers and catapults go first so melee units can finish weakened targets (focus fire)
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
      retreat(state, unit, know, danger.get());
    } else {
      if (planStrike(state, unit, know, danger.get())) continue;
      if (tryBestAttack(state, unit)) continue;
      moveTowardsGoal(state, unit, danger.get());
      const after = getUnit(state, id);
      if (after) tryBestAttack(state, after);
    }
  }
  recruit(state, me);
  buildSomething(state, me);
}

// Finds the best "move to a tile and attack" combination. The attacker's position affects the counterattack
// (terrain) and range, so the attack is tentatively evaluated from every reachable tile.
export function planStrike(state, unit, know = aiKnowledge(state, unit.owner), danger = new Map()) {
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
    unit.q = q; unit.r = r; // tentatively – restored right away
    for (const t of near) {
      const s = scoreAttack(state, unit, t) + TERRAIN[tileAt(state, q, r).terrain].defBonus
        - DANGER.strike * dangerPenalty(state, unit, q, r, danger.get(k) || 0);
      if (s > 0 && (!best || s > best.s)) best = { s, q, r, t };
    }
    unit.q = home.q; unit.r = home.r;
  }
  if (!best) return false;
  if (best.q !== unit.q || best.r !== unit.r) moveUnit(state, unit.id, best.q, best.r);
  const u = getUnit(state, unit.id);
  return !!u && attack(state, u.id, best.t.id);
}

const WOUNDED = 0.25; // below this HP fraction the unit retreats
const THREAT_RADIUS = 2; // an enemy this close to a city = the city needs a garrison

export const isWounded = (u) => u.hp / UNIT_TYPES[u.type].hp <= WOUNDED;

function enemiesNear(state, unit, know, radius) {
  return state.units.filter((u) => u.owner !== unit.owner && know.sees(u.q, u.r) && distance(u, unit) <= radius);
}

// Threatened own cities (a visible enemy within THREAT_RADIUS tiles) get a garrison:
// either a unit already standing there, or the nearest unit that can get there this turn.
// Returns a Map unit id -> city.
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
    if (here) continue; // the enemy holds the city
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

// Garrison: moves into the city and stays; attacks from the city as usual (measured: a passive garrison played worse).
function holdCity(state, unit, city) {
  if (unit.q !== city.q || unit.r !== city.r) moveUnit(state, unit.id, city.q, city.r);
  const u = getUnit(state, unit.id);
  if (u && !tryBestAttack(state, u)) fortify(state, u.id); // nothing to hit – dig in (only works if it hasn't moved)
}

// Danger: how many visible enemies could strike each tile next turn (threatTiles from the AI's point of view).
// Computed lazily and recomputed only after an enemy unit falls, so a turn costs one or a few searches.
export function dangerMap(state, me, know = aiKnowledge(state, me)) {
  let cached = null;
  let enemies = -1;
  return {
    get() {
      const n = state.units.filter((u) => u.owner !== me).length;
      if (!cached || n !== enemies) {
        cached = threatTiles(state, me, { sees: know.sees, knows: () => true });
        enemies = n;
      }
      return cached;
    },
  };
}

// How much the unit should fear ending its move on a tile that `attackers` enemies can reach.
// Ranged units and siege engines are fragile up front, wounded units more so; an own city protects.
export function dangerPenalty(state, unit, q, r, attackers) {
  if (!attackers) return 0;
  const type = UNIT_TYPES[unit.type];
  const city = cityAt(state, q, r);
  if (city && city.owner === unit.owner) return 0;
  const fragile = type.range > 1 || type.noCapture ? DANGER.ranged : DANGER.melee;
  const hurt = 1 + (1 - unit.hp / type.hp);
  // one attacker is a fair fight for melee units; each extra one is a pile-on
  const extra = type.range > 1 || type.noCapture ? attackers : attackers - 1;
  return extra > 0 ? extra * fragile * hurt : 0;
}
export const DANGER = { ranged: 1.2, melee: 0.6, strike: 1 };

// A wounded unit retreats to an own city, or as far from enemies as possible. It attacks only when it's safe.
function retreat(state, unit, know, danger = new Map()) {
  const here = state.cities.find((c) => c.q === unit.q && c.r === unit.r && c.owner === unit.owner);
  if (!here) {
    const options = reachable(state, unit);
    const enemies = enemiesNear(state, unit, know, 6);
    let bestKey = null;
    let bestScore = -Infinity;
    for (const k of options.keys()) {
      const [q, r] = k.split(',').map(Number);
      const city = state.cities.find((c) => c.q === q && c.r === r);
      if (city && city.owner !== unit.owner) continue; // don't retreat into a foreign city
      const minDist = Math.min(...enemies.map((e) => distance(e, { q, r })), 9);
      let s = minDist + TERRAIN[tileAt(state, q, r).terrain].defBonus * 2;
      if (city) s += 10; // an own city heals and protects
      s -= (danger.get(k) || 0) * 1.5;
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

// Buildings from surplus gold: a threatened city gets walls, otherwise market and barracks (capital first).
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
  // the later buildings only with plenty of gold to spare, where they make most sense
  const rich = (b) => state.gold[me] >= buildingCost(state, me, b) + 2 * RESERVE;
  const capital = mine.find((c) => c.capital);
  if (capital && !hasBuilding(capital, 'academy') && rich('academy')) build(state, capital.id, 'academy');
  for (const city of mine) {
    if (!city.capital && !hasBuilding(city, 'temple') && rich('temple')) build(state, city.id, 'temple');
  }
  for (const city of mine) {
    if (!hasBuilding(city, 'infirmary') && rich('infirmary')) build(state, city.id, 'infirmary');
  }
}

// Upgrades from surplus gold, only where they clearly help (an upgrade ends the unit's turn):
// a warrior in a city with enemy horsemen in sight nearby becomes a spearman,
// and a scout that has nothing left to explore becomes a horseman.
export const UPGRADE_HORSE_RADIUS = 4;
export function upgradeSomething(state, me, know = aiKnowledge(state, me)) {
  const explored = () => unexploredLand(state, know) <= SCOUT_WHEN_UNKNOWN;
  for (const u of state.units.filter((x) => x.owner === me)) {
    const opts = upgradeOptions(state, u);
    if (!opts.length) continue;
    let want = null;
    if (u.type === 'warrior') {
      const horse = state.units.some((e) => e.owner !== me && e.type === 'horseman' && know.sees(e.q, e.r)
        && distance(e, u) <= UPGRADE_HORSE_RADIUS);
      if (horse) want = 'spearman';
    } else if (u.type === 'scout' && explored()) {
      want = 'horseman';
    }
    const opt = opts.find((o) => o.type === want);
    if (opt && state.gold[me] >= opt.cost + RESERVE) upgradeUnit(state, u.id, want);
  }
}

function scoreAttack(state, unit, target) {
  const p = previewAttack(state, unit, target);
  if (p.dies && !p.kills) return -Infinity;
  let s = p.damage * 2 - p.counter * 1.5 * difficultyOf(state, unit.owner).caution;
  if (p.kills) s += 10;
  // focus: prefer finishing weakened targets and more valuable units
  s += (1 - target.hp / UNIT_TYPES[target.type].hp) * 3;
  s += UNIT_TYPES[target.type].cost / 10;
  return s;
}

// safeOnly: only attacks that destroy the target or take no counterattack.
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

// Movement goals: known foreign cities and visible enemies. If there are none, the AI explores.
// Scouts can't capture, so they only ever explore (and stay put once everything is known).
export function goalsFor(state, unit, know = aiKnowledge(state, unit.owner)) {
  const goals = [];
  if (UNIT_TYPES[unit.type].noCapture) return exploreGoals(state, know);
  for (const c of state.cities) {
    if (c.owner !== unit.owner && know.knows(c.q, c.r)) goals.push({ q: c.q, r: c.r, w: c.owner === null ? 1 : 1.3 });
  }
  for (const u of state.units) if (u.owner !== unit.owner && know.sees(u.q, u.r)) goals.push({ q: u.q, r: u.r, w: 1.1, enemy: true });
  return goals.length ? goals : exploreGoals(state, know);
}

function exploreGoals(state, know) {
  return Object.values(state.tiles)
    .filter((t) => !know.knows(t.q, t.r) && TERRAIN[t.terrain].passable)
    .map((t) => ({ q: t.q, r: t.r, w: 0.8, explore: true }));
}

// Number of passable tiles the AI hasn't explored yet (0 when it sees everything).
export function unexploredLand(state, know) {
  return Object.values(state.tiles).filter((t) => TERRAIN[t.terrain].passable && !know.knows(t.q, t.r)).length;
}

export function moveTowardsGoal(state, unit, danger = new Map()) {
  const options = reachable(state, unit);
  if (!options.size) return;
  const know = aiKnowledge(state, unit.owner);
  const goals = goalsFor(state, unit, know);
  if (!goals.length) return;
  const range = UNIT_TYPES[unit.type].range;
  let bestKey = null;
  const score = (q, r) => evalPos(state, unit, q, r, goals, range, know)
    - dangerPenalty(state, unit, q, r, danger.get(key(q, r)) || 0);
  let bestScore = score(unit.q, unit.r);
  for (const k of options.keys()) {
    const [q, r] = k.split(',').map(Number);
    const s = score(q, r);
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
  // archers dislike being adjacent to (visible) enemies
  if (range > 1) {
    for (const u of state.units) {
      if (u.owner !== unit.owner && know.sees(u.q, u.r) && distance({ q, r }, u) === 1) score -= 1.5;
    }
  }
  return score;
}

export const SCOUT_WHEN_UNKNOWN = 100; // unexplored passable tiles

// Which unit the AI wants: tops up the army toward a target type ratio.
// If it sees enemy horsemen it wants more spearmen; catapults only from turn 8.
export function pickRecruit(state, me, city) {
  const know = aiKnowledge(state, me);
  const enemyHorse = state.units.filter((u) => u.owner !== me && u.type === 'horseman' && know.sees(u.q, u.r)).length;
  // one scout while a lot of land is still unknown – on big maps (never on Hard, which sees everything)
  const scout = unexploredLand(state, know) > SCOUT_WHEN_UNKNOWN ? 1 : 0;
  const ratio = { warrior: 3, archer: 2, horseman: 2, spearman: 1 + 2 * enemyHorse, catapult: state.turn >= 8 ? 1 : 0, scout };
  // own faction's strengths: wants more of the discounted units
  const favored = factionOf(state, me).unitDiscount || {};
  for (const type of Object.keys(favored)) ratio[type] += 2;
  const count = {};
  for (const u of state.units) if (u.owner === me) count[u.type] = (count[u.type] || 0) + 1;
  let best = null;
  let bestNeed = Infinity;
  let bestWant = 0;
  for (const [type, want] of Object.entries(ratio)) {
    if (!want || state.gold[me] < unitCost(state, city, type)) continue;
    if (type === 'scout' && count.scout) continue; // one is enough
    const need = (count[type] || 0) / want;
    // on a tie, the type we want more of wins
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

