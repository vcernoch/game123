// Jednoduchá AI: útočí, když se to vyplatí, jinak táhne k nejbližšímu cíli a verbuje.
import { distance, key } from './hex.js';
import {
  reachable, attackTargets, previewAttack, moveUnit, attack, buyUnit,
  unitAt, getUnit, tileAt, difficultyOf, visibleTiles, exploredTiles, build, hasBuilding, unitCost,
} from './game.js';
import { UNIT_TYPES, TERRAIN, BUILDINGS } from './rules.js';

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
  const ids = state.units.filter((u) => u.owner === me).map((u) => u.id);
  for (const id of ids) {
    if (state.winner !== null) return;
    const unit = getUnit(state, id);
    if (!unit) continue;
    if (tryBestAttack(state, unit)) continue;
    moveTowardsGoal(state, unit);
    const after = getUnit(state, id);
    if (after) tryBestAttack(state, after);
  }
  recruit(state, me);
  buildSomething(state, me);
}

// Stavby z přebytku zlata: ohrožené město dostane hradby, jinak trh a kasárna (hlavní město napřed).
const RESERVE = 12;
export function buildSomething(state, me) {
  const know = aiKnowledge(state, me);
  const mine = state.cities.filter((c) => c.owner === me).sort((a, b) => b.capital - a.capital);
  for (const city of mine) {
    const threatened = state.units.some((u) => u.owner !== me && know.sees(u.q, u.r) && distance(u, city) <= 3);
    if (threatened && !hasBuilding(city, 'walls') && state.gold[me] >= BUILDINGS.walls.cost) {
      build(state, city.id, 'walls');
    }
  }
  for (const b of ['market', 'barracks']) {
    for (const city of mine) {
      if (!hasBuilding(city, b) && state.gold[me] >= BUILDINGS[b].cost + RESERVE) build(state, city.id, b);
    }
  }
}

function scoreAttack(state, unit, target) {
  const p = previewAttack(state, unit, target);
  if (p.dies && !p.kills) return -Infinity;
  let s = p.damage * 2 - p.counter * 1.5 * difficultyOf(state, unit.owner).caution;
  if (p.kills) s += 10;
  return s;
}

function tryBestAttack(state, unit) {
  const targets = attackTargets(state, unit);
  let best = null;
  let bestScore = 0;
  for (const t of targets) {
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
  const ratio = { warrior: 3, archer: 2, horseman: 2, spearman: 1 + enemyHorse, catapult: state.turn >= 8 ? 1 : 0 };
  const count = {};
  for (const u of state.units) if (u.owner === me) count[u.type] = (count[u.type] || 0) + 1;
  let best = null;
  let bestNeed = Infinity;
  let bestWant = 0;
  for (const [type, want] of Object.entries(ratio)) {
    if (!want || state.gold[me] < unitCost(city, type)) continue;
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

