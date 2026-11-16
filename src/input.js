// Decides what a tap/click on a tile means. Pure function without DOM so it can be tested.
// On a touch screen (confirm = true) the first tap on a target only shows a preview
// and only a second tap on the same tile performs the action.
import { key } from './hex.js';
import {
  getUnit, unitAt, cityAt, reachable, attackTargets, visibleTiles, exploredTiles, planRoute, canRally, canSwap,
} from './game.js';

// ctx = { selectedId, pending: {q,r}|null, viewer, confirm, rallyCityId, swapUnitId }
// rallyCityId: the player is picking a rally point for that city – a valid tile sets it
// ({ type: 'rally', cityId, q, r }), any other tap leaves the picking ({ type: 'rallyCancel' }).
// swapUnitId: the player is picking a unit to swap places with – a tap on a neighbour that can swap
// does it ({ type: 'swap', unitId, otherId }), any other tap leaves the picking ({ type: 'swapCancel' }).
// Picking is an explicit mode, so the swap needs no touch confirmation.
// Returns one of these actions:
//   { type: 'move', unitId, q, r } | { type: 'attack', unitId, targetId }
//   { type: 'goto', unitId, q, r } – a multi-turn move order to a known tile out of reach this turn
//   { type: 'preview', kind: 'move'|'attack'|'goto', q, r, targetId? }
//   { type: 'select', unitId|null, cityId|null } | { type: 'none' }
export function decideTap(state, ctx, q, r) {
  if (!state.tiles[key(q, r)] || state.winner !== null) return { type: 'none' };
  const { selectedId, pending, viewer = 0, confirm = false, rallyCityId = null, swapUnitId = null } = ctx;
  if (rallyCityId !== null) {
    const rc = state.cities.find((c) => c.id === rallyCityId);
    return canRally(state, rc, q, r) ? { type: 'rally', cityId: rallyCityId, q, r } : { type: 'rallyCancel' };
  }
  if (swapUnitId !== null) {
    const su = getUnit(state, swapUnitId);
    const other = unitAt(state, q, r);
    return su && su.owner === viewer && canSwap(state, su, other)
      ? { type: 'swap', unitId: su.id, otherId: other.id } : { type: 'swapCancel' };
  }
  const visible = visibleTiles(state, viewer);
  const explored = exploredTiles(state, viewer);
  const other = unitAt(state, q, r);
  const seen = other && (other.owner === viewer || visible.has(key(q, r))) ? other : null;
  const city = explored.has(key(q, r)) ? cityAt(state, q, r) : null;
  const confirmed = !confirm || (pending && pending.q === q && pending.r === r);

  const sel = selectedId ? getUnit(state, selectedId) : null;
  if (sel && sel.owner === viewer && state.current === viewer) {
    if (seen && seen.owner !== sel.owner && attackTargets(state, sel).includes(seen)) {
      return confirmed
        ? { type: 'attack', unitId: sel.id, targetId: seen.id }
        : { type: 'preview', kind: 'attack', q, r, targetId: seen.id };
    }
    if (!seen && reachable(state, sel).has(key(q, r))) {
      return confirmed ? { type: 'move', unitId: sel.id, q, r } : { type: 'preview', kind: 'move', q, r };
    }
    // clicking a far own city still selects it (recruiting); foreign cities can be marched to
    if (!seen && !(city && city.owner === viewer) && planRoute(state, sel, q, r)) {
      return confirmed ? { type: 'goto', unitId: sel.id, q, r } : { type: 'preview', kind: 'goto', q, r };
    }
  }
  return { type: 'select', unitId: seen ? seen.id : null, cityId: city ? city.id : null };
}
