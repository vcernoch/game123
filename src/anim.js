// Přehrávání herních událostí jako krátkých animací.
// Logika se nemění: události se postupně aplikují na kopii stavu z doby před akcí
// (applyEvent z game.js) a mezi tím se jen posouvají kreslené pozice jednotek.
import { applyEvent, getUnit } from './game.js';
import { tileCenter } from './render.js';

const STEP_MS = 110;    // jeden krok pohybu
const ATTACK_MS = 300;  // výpad a návrat útočníka
const PAUSE_MS = 160;   // pauza u verbování / dobytí
const FLOAT_MS = 900;   // jak dlouho visí plovoucí text

const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t));

// redraw: překreslí jen plátno (HUD se během animace nepřepisuje, aby nemizela tlačítka).
export function createAnimator(redraw) {
  const a = {
    display: null,        // stav, který se právě kreslí (null = skutečný stav)
    unitPos: new Map(),   // id jednotky -> {x, y} během pohybu
    floaters: [],
    speed: 1,             // 0 = bez animací
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

  // Průběh 0..1 po dobu ms (upravenou rychlostí); při přeskočení hned skončí.
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
      await tween(ATTACK_MS, (t) => {
        a.unitPos.set(ev.attackerId, lerp(ca, cd, Math.sin(Math.PI * t) * 0.4));
        if (t >= 0.5 && !hit) onHit();
      });
      if (!hit) onHit();
    } else if (ev.type === 'capture') {
      const c = st.cities.find((x) => x.id === ev.cityId);
      if (c) addFloater(tileCenter(c.q, c.r), 'Dobyto!', '#ffe27a');
      await tween(PAUSE_MS * 2, () => {});
    } else if (ev.type === 'spawn') {
      await tween(PAUSE_MS, () => {});
    }
  }

  // Přehraje události nad kopií stavu `before`. Vrací Promise, který se splní po dokončení.
  a.play = async (before, events) => {
    if (!events.length) return;
    a.display = before;
    a.busy = true;
    ensureLoop();
    for (const ev of events) {
      // nová jednotka a dobytí se nejdřív ukážou, pak se chvíli čeká
      if (ev.type === 'spawn' || ev.type === 'capture') applyEvent(a.display, ev);
      await animate(ev);
      if (ev.type !== 'spawn' && ev.type !== 'capture') applyEvent(a.display, ev);
      a.unitPos.clear();
    }
    a.display = null;
    a.busy = false;
    a.skipping = false;
    redraw();
  };

  a.skip = () => { if (a.busy) a.skipping = true; };
  a.view = () => ({ unitPos: a.unitPos, floaters: floaterView() });
  return a;
}
