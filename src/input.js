// Decides what a tap/click on a tile means. Pure function without DOM so it can be tested.
// On a touch screen (confirm = true) the first tap on a target only shows a preview
// and only a second tap on the same tile performs the action.
import { key } from './hex.js';
import {
  getUnit, unitAt, cityAt, reachable, attackTargets, visibleTiles, exploredTiles,
} from './game.js';

// ctx = { selectedId, pending: {q,r}|null, viewer, confirm }
// Returns one of these actions:
//   { type: 'move', unitId, q, r } | { type: 'attack', unitId, targetId }
//   { type: 'preview', kind: 'move'|'attack', q, r, targetId? }
//   { type: 'select', unitId|null, cityId|null } | { type: 'none' }
export function decideTap(state, ctx, q, r) {
  if (!state.tiles[key(q, r)] || state.winner !== null) return { type: 'none' };
  const { selectedId, pending, viewer = 0, confirm = false } = ctx;
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
  }
  return { type: 'select', unitId: seen ? seen.id : null, cityId: city ? city.id : null };
}
