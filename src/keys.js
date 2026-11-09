// Keyboard shortcuts: one table drives both the key handling and the `?` overlay, so they can't
// disagree. Pure module without DOM.
import { UNIT_TYPES } from './rules.js';

const RECRUIT_TYPES = Object.keys(UNIT_TYPES);

// keys: what is shown in the overlay; match(key, shift) decides whether a keydown belongs to the entry.
export const SHORTCUTS = [
  { keys: 'Tab', text: 'select the next unit that can still act', action: () => ({ type: 'nextUnit' }), match: (k) => k === 'Tab' },
  { keys: 'Enter / E', text: 'end the turn (press twice if units can still act)', action: () => ({ type: 'endTurn', force: false }),
    match: (k, shift) => (k === 'Enter' || k === 'e' || k === 'E') && !shift },
  { keys: 'Shift + Enter', text: 'end the turn right away', action: () => ({ type: 'endTurn', force: true }),
    match: (k, shift) => k === 'Enter' && shift },
  { keys: 'F', text: 'fortify the selected unit', action: () => ({ type: 'fortify' }), match: (k) => k === 'f' || k === 'F' },
  { keys: 'Z', text: 'undo the last move (if it revealed nothing)', action: () => ({ type: 'undo' }), match: (k) => k === 'z' || k === 'Z' },
  { keys: `1–${RECRUIT_TYPES.length}`, text: `recruit in the selected city (${RECRUIT_TYPES.map((t, i) => `${i + 1} ${UNIT_TYPES[t].name}`).join(', ')})`,
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
