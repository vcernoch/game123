// Replays game events as short animations.
// Logic is unchanged: events are applied one by one to a copy of the state from before the action
// (applyEvent from game.js), and in between only the drawn unit positions move.
import { applyEvent, getUnit } from './game.js';
import { tileCenter } from './render.js';
import { UNIT_TYPES } from './rules.js';

const STEP_MS = 110;    // one movement step
const ATTACK_MS = 300;  // attacker lunge and return
const PAUSE_MS = 160;   // pause on recruit / capture
const FLOAT_MS = 900;   // how long floating text stays

const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t));

// redraw: redraws only the canvas (the HUD isn't rewritten during animation so buttons don't vanish).
// isVisible(state, q, r): whether the player at the screen sees the tile – nothing in fog is animated.
// onShow(ev): called for each visible event when its animation starts (sounds).
export function createAnimator(redraw, isVisible = () => true, onShow = () => {}) {
  const a = {
    display: null,        // state currently being drawn (null = the real state)
    unitPos: new Map(),   // unit id -> {x, y} while moving
    floaters: [],
    speed: 1,             // 0 = no animations
    busy: false,
    skipping: false,
  };
  let loop = null;

  function ensureLoop() {
    if (loop) return;
    const frame = () => {
      redraw();
      if (a.busy || floaterView().length) loop = requestAnimationFrame(frame);
      else { loop = null; redraw(); }
    };
    loop = requestAnimationFrame(frame);
  }

  function floaterView() {
    const now = performance.now();
    const len = FLOAT_MS * Math.max(a.speed, 0.3);
    a.floaters = a.floaters.filter((f) => now - f.start < len);
    return a.floaters.map((f) => ({ ...f, age: (now - f.start) / len }));
  }

  function addFloater(pos, text, color) {
    if (a.speed <= 0 || a.skipping) return;
    a.floaters.push({ x: pos.x, y: pos.y, text, color, start: performance.now() });
  }

  // Progress 0..1 over ms (scaled by speed); finishes immediately when skipping.
  function tween(ms, onT) {
    const dur = ms * a.speed;
    if (dur <= 0 || a.skipping) { onT(1); return Promise.resolve(); }
    return new Promise((resolve) => {
      const start = performance.now();
      const step = () => {
        const t = a.skipping ? 1 : Math.min(1, (performance.now() - start) / dur);
        onT(t);
        if (t < 1) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
  }

  async function animate(ev) {
    const st = a.display;
    if (ev.type === 'move') {
      if (!getUnit(st, ev.unitId)) return;
      for (let i = 1; i < ev.path.length; i++) {
        const from = tileCenter(ev.path[i - 1].q, ev.path[i - 1].r);
        const to = tileCenter(ev.path[i].q, ev.path[i].r);
        await tween(STEP_MS, (t) => a.unitPos.set(ev.unitId, lerp(from, to, ease(t))));
      }
    } else if (ev.type === 'attack') {
      const att = getUnit(st, ev.attackerId);
      const def = getUnit(st, ev.defenderId);
      if (!att || !def) return;
      const ca = tileCenter(att.q, att.r);
      const cd = tileCenter(def.q, def.r);
      let hit = false;
      const onHit = () => {
        hit = true;
        addFloater(cd, ev.killed ? `−${ev.damage} ✖` : `−${ev.damage}`, '#ff6b5b');
        if (ev.counter) addFloater(ca, `−${ev.counter}`, '#ffb347');
      };
      const promo = (pos) => addFloater({ x: pos.x, y: pos.y - 16 }, '★ promotion', '#ffd34d');
      await tween(ATTACK_MS, (t) => {
        a.unitPos.set(ev.attackerId, lerp(ca, cd, Math.sin(Math.PI * t) * 0.4));
        if (t >= 0.5 && !hit) onHit();
      });
      if (!hit) onHit();
      if (ev.promoted && !ev.died) promo(ca);
      if (ev.defenderPromoted && !ev.killed) promo(cd);
    } else if (ev.type === 'capture') {
      const c = st.cities.find((x) => x.id === ev.cityId);
      if (c) addFloater(tileCenter(c.q, c.r), 'Captured!', '#ffe27a');
      await tween(PAUSE_MS * 2, () => {});
    } else if (ev.type === 'spawn') {
      await tween(PAUSE_MS, () => {});
    } else if (ev.type === 'fortify') {
      const u = getUnit(st, ev.unitId);
      if (u) addFloater(tileCenter(u.q, u.r), '⛨ fortified', '#cfe3ff');
      await tween(PAUSE_MS, () => {});
    } else if (ev.type === 'upgrade') {
      const u = getUnit(st, ev.unitId);
      if (u) addFloater(tileCenter(u.q, u.r), `⇧ ${UNIT_TYPES[ev.to].name}`, '#ffd34d');
      await tween(PAUSE_MS, () => {});
    }
  }

  // Replays events on a copy of the `before` state. Returns a Promise that resolves when done.
  a.play = async (before, events) => {
    if (!events.length) return;
    a.display = before;
    a.busy = true;
    ensureLoop();
    for (const ev of events) {
      const shown = eventVisible(a.display, ev);
      // a new unit or capture is shown first, then there's a short wait
      if (ev.type === 'spawn' || ev.type === 'capture') applyEvent(a.display, ev);
      if (shown) {
        onShow(ev);
        await animate(ev);
      }
      if (ev.type !== 'spawn' && ev.type !== 'capture') applyEvent(a.display, ev);
      a.unitPos.clear();
    }
    a.display = null;
    a.busy = false;
    a.skipping = false;
    redraw();
  };

  // An event is worth animating only if it happens at least partly on a visible tile.
  function eventVisible(st, ev) {
    const see = (p) => p && isVisible(st, p.q, p.r);
    if (ev.type === 'move') return ev.path.some(see);
    if (ev.type === 'attack') return see(getUnit(st, ev.attackerId)) || see(getUnit(st, ev.defenderId));
    if (ev.type === 'capture') return see(st.cities.find((c) => c.id === ev.cityId));
    if (ev.type === 'spawn') return see(ev.unit);
    if (ev.type === 'fortify' || ev.type === 'upgrade') return see(getUnit(st, ev.unitId));
    return true;
  }

  a.skip = () => { if (a.busy) a.skipping = true; };
  a.view = () => ({ unitPos: a.unitPos, floaters: floaterView() });
  return a;
}
