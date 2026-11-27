// Keyboard shortcuts: one table drives both the key handling and the `?` overlay, so they can't
// disagree. Pure module without DOM.
import { UNIT_TYPES, FORCED_MARCH } from './rules.js';

const RECRUIT_TYPES = Object.keys(UNIT_TYPES);

// keys: what is shown in the overlay; match(key, shift) decides whether a keydown belongs to the entry.
export const SHORTCUTS = [
  { keys: 'Tab', text: 'select the next unit that can still act', action: () => ({ type: 'nextUnit' }), match: (k) => k === 'Tab' },
  { keys: 'Enter / E', text: 'end the turn (press twice if units can still act)', action: () => ({ type: 'endTurn', force: false }),
    match: (k, shift) => (k === 'Enter' || k === 'e' || k === 'E') && !shift },
  { keys: 'Shift + Enter', text: 'end the turn right away', action: () => ({ type: 'endTurn', force: true }),
    match: (k, shift) => k === 'Enter' && shift },
  { keys: 'F', text: 'fortify the selected unit', action: () => ({ type: 'fortify' }), match: (k) => k === 'f' || k === 'F' },
  { keys: 'M', text: `forced march: the selected unit gets +${FORCED_MARCH.bonus} move this turn for ${FORCED_MARCH.hpCost} HP, but can't attack or heal`, action: () => ({ type: 'march' }),
    match: (k) => k === 'm' || k === 'M' },
  { keys: 'W', text: 'sentry: the selected unit keeps watch (a wounded one rests until healed) and Tab skips it until an enemy comes near',
    action: () => ({ type: 'sentry' }), match: (k) => k === 'w' || k === 'W' },
  { keys: 'X', text: 'send the selected unit exploring the fog on its own', action: () => ({ type: 'explore' }), match: (k) => k === 'x' || k === 'X' },
  { keys: 'P', text: 'pillage the enemy resource or burn the enemy farm under the selected unit (gold for you, a loss for its owner)', action: () => ({ type: 'pillage' }),
    match: (k) => k === 'p' || k === 'P' },
  { keys: 'R', text: 'repair a pillaged resource of yours under the selected unit (costs a little gold)', action: () => ({ type: 'repair' }),
    match: (k) => k === 'r' || k === 'R' },
  { keys: 'B', text: 'build a road on the tile of your territory under the selected unit (costs a little gold)', action: () => ({ type: 'road' }),
    match: (k) => k === 'b' || k === 'B' },
  { keys: 'H', text: 'fell the forest of your territory under the selected unit (timber gold; the tile becomes plains)', action: () => ({ type: 'fell' }),
    match: (k) => k === 'h' || k === 'H' },
  { keys: 'N', text: 'plant saplings on plains of your territory under the selected unit (costs a little gold; a forest grows in a few rounds)',
    action: () => ({ type: 'plant' }), match: (k) => k === 'n' || k === 'N' },
  { keys: 'K', text: 'build a farm on plains next to your city under the selected unit (costs a little gold; the city grows faster)',
    action: () => ({ type: 'farm' }), match: (k) => k === 'k' || k === 'K' },
  { keys: 'S', text: 'swap places with a neighbouring unit of yours (then tap it; at once if there is only one)', action: () => ({ type: 'swap' }),
    match: (k) => k === 's' || k === 'S' },
  { keys: 'G', text: 'set the rally point of the selected city: units recruited there march to it', action: () => ({ type: 'rally' }),
    match: (k) => k === 'g' || k === 'G' },
  { keys: 'C', text: 'change the focus of the selected city (balanced → commerce → granary → fortress)', action: () => ({ type: 'focus' }),
    match: (k) => k === 'c' || k === 'C' },
  { keys: 'L', text: 'levy a free Warrior in the selected city (size 2+; the city loses a size)', action: () => ({ type: 'levy' }),
    match: (k) => k === 'l' || k === 'L' },
  { keys: 'D', text: 'disband the selected unit (press twice; in an own city it returns some gold)', action: () => ({ type: 'disband' }),
    match: (k) => k === 'd' || k === 'D' },
  { keys: 'A', text: 'change the animation speed (normal → fast → off)', action: () => ({ type: 'animSpeed' }),
    match: (k) => k === 'a' || k === 'A' },
  { keys: 'V', text: 'replay the enemy\'s last turn – what you saw of it (until you end your turn)', action: () => ({ type: 'replay' }),
    match: (k) => k === 'v' || k === 'V' },
  { keys: 'I', text: 'open or close the treasury: where your income comes from and what you are losing', action: () => ({ type: 'treasury' }),
    match: (k) => k === 'i' || k === 'I' },
  { keys: 'T', text: 'show or hide the enemy threat overlay', action: () => ({ type: 'threats' }), match: (k) => k === 't' || k === 'T' },
  { keys: 'Z', text: 'undo the last move (if it revealed nothing)', action: () => ({ type: 'undo' }), match: (k) => k === 'z' || k === 'Z' },
  { keys: `1–${RECRUIT_TYPES.length}`, text: `recruit in the selected city (${RECRUIT_TYPES.map((t, i) => `${i + 1} ${UNIT_TYPES[t].name}`).join(', ')}); without gold or room it orders the unit for the start of a later turn`,
    action: (k) => ({ type: 'recruit', unitType: RECRUIT_TYPES[Number(k) - 1] }),
    match: (k) => /^[1-9]$/.test(k) && Number(k) <= RECRUIT_TYPES.length },
  { keys: 'Esc', text: 'cancel the selection, skip an animation, close this help', action: () => ({ type: 'escape' }), match: (k) => k === 'Escape' },
  { keys: '?', text: 'show or hide this list', action: () => ({ type: 'help' }), match: (k) => k === '?' },
];

// Action for a keydown, or null. Returns e.g. { type: 'recruit', unitType: 'archer' }.
export function keyAction(key, shift = false) {
  const entry = SHORTCUTS.find((s) => s.match(key, shift));
  return entry ? entry.action(key) : null;
}

// Hotkey number for recruiting a unit type ('1'…), for labels on the buttons.
export const recruitKey = (type) => String(RECRUIT_TYPES.indexOf(type) + 1);
