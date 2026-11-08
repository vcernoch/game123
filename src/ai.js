// Jednoduchá AI: útočí, když se to vyplatí, jinak táhne k nejbližšímu cíli a verbuje.
import { distance } from './hex.js';
import {
  reachable, attackTargets, previewAttack, moveUnit, attack, buyUnit,
  unitAt, getUnit, tileAt,
} from './game.js';
import { UNIT_TYPES, TERRAIN } from './rules.js';

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
}

function scoreAttack(state, unit, target) {
  const p = previewAttack(state, unit, target);
  if (p.dies && !p.kills) return -Infinity;
  let s = p.damage * 2 - p.counter * 1.5;
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

function goalsFor(state, unit) {
  const goals = [];
  for (const c of state.cities) if (c.owner !== unit.owner) goals.push({ q: c.q, r: c.r, w: c.owner === null ? 1 : 1.3 });
  for (const u of state.units) if (u.owner !== unit.owner) goals.push({ q: u.q, r: u.r, w: 1.1 });
  return goals;
}

function moveTowardsGoal(state, unit) {
  const options = reachable(state, unit);
  if (!options.size) return;
  const goals = goalsFor(state, unit);
  if (!goals.length) return;
  const range = UNIT_TYPES[unit.type].range;
  let bestKey = null;
  let bestScore = evalPos(state, unit, unit.q, unit.r, goals, range);
  for (const k of options.keys()) {
    const [q, r] = k.split(',').map(Number);
    const s = evalPos(state, unit, q, r, goals, range);
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

function evalPos(state, unit, q, r, goals, range) {
  let score = -Infinity;
  for (const g of goals) {
    const d = distance({ q, r }, g);
    const target = unitAt(state, g.q, g.r);
    const wantDist = target && target.owner !== unit.owner ? range : 0;
    const s = -Math.abs(d - wantDist) * g.w;
    if (s > score) score = s;
  }
  const t = tileAt(state, q, r);
  score += TERRAIN[t.terrain].defBonus * 0.5;
  // lučištníci nemají rádi těsnou blízkost nepřátel
  if (range > 1) {
    for (const u of state.units) {
      if (u.owner !== unit.owner && distance({ q, r }, u) === 1) score -= 1.5;
    }
  }
  return score;
}

function recruit(state, me) {
  const order = ['warrior', 'archer', 'horseman'];
  const myUnits = state.units.filter((u) => u.owner === me).length;
  for (const city of state.cities.filter((c) => c.owner === me)) {
    if (unitAt(state, city.q, city.r)) continue;
    const pick = order[(state.turn + myUnits + city.id) % order.length];
    const type = state.gold[me] >= UNIT_TYPES[pick].cost ? pick : 'warrior';
    buyUnit(state, city.id, type);
  }
}

