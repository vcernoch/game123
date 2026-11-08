// Propojení logiky, vykreslení a ovládání v prohlížeči.
import {
  createGame, reachable, attackTargets, moveUnit, attack, buyUnit, endTurn,
  unitAt, cityAt, getUnit, incomeOf, previewAttack, tileAt, pathTo, nextActiveUnit, cityInfo,
  cloneState, drainEvents, migrateState, visibleTiles, exploredTiles,
} from './game.js';
import { createAnimator } from './anim.js';
import { runAITurn } from './ai.js';
import { render, canvasSize, pickHex } from './render.js';
import { key } from './hex.js';
import { UNIT_TYPES, TERRAIN, PLAYERS } from './rules.js';

const SAVE_KEY = 'game123-save';
const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const $ = (id) => document.getElementById(id);

let state = load() || createGame({ seed: randomSeed() });
let selectedId = null;
let selectedCityId = null;
let hover = null;
let aiRunning = false;
const anim = createAnimator(drawBoard, (st, q, r) => visibleTiles(st, 0).has(key(q, r)));
try {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) anim.speed = 0;
} catch { /* starý prohlížeč */ }

// Jednotka na poli, jen pokud ji hráč vidí (cizí jednotky v mlze jako by nebyly).
function seenUnitAt(q, r) {
  const u = unitAt(state, q, r);
  return u && (u.owner === 0 || visibleTiles(state, 0).has(key(q, r))) ? u : null;
}

// Hráč nemůže jednat, dokud hraje AI nebo běží animace.
const busy = () => aiRunning || anim.busy;

function randomSeed() {
  return Math.floor(Math.random() * 1e9);
}

function save() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch { /* bez úložiště */ }
}

function load() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    return migrateState(s);
  } catch {
    return null;
  }
}

function resize() {
  const { w, h } = canvasSize(state);
  const dpr = window.devicePixelRatio || 1;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.aspectRatio = `${w} / ${h}`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function selectedUnit() {
  return selectedId ? getUnit(state, selectedId) : null;
}

function draw() {
  drawBoard();
  updateHud();
}

function drawBoard() {
  const u = selectedUnit();
  const mine = u && u.owner === state.current && !busy();
  const shown = anim.display || state;
  render(ctx, shown, {
    ...anim.view(),
    visible: visibleTiles(shown, 0),
    explored: exploredTiles(shown, 0),
    viewer: 0,
    selectedId,
    reachable: mine ? reachable(state, u) : null,
    targets: mine ? new Set(attackTargets(state, u).map((t) => t.id)) : null,
    hover,
    path: mine && hover && !seenUnitAt(hover.q, hover.r) ? pathTo(state, u, hover.q, hover.r) : null,
  });
}

function updateHud() {
  $('turn').textContent = state.turn;
  $('gold').textContent = state.gold[0];
  $('income').textContent = `+${incomeOf(state, 0)}`;
  $('cities').textContent = `${state.cities.filter((c) => c.owner === 0).length} / ${state.cities.length}`;
  $('end-turn').disabled = busy() || state.winner !== null;

  const info = $('info');
  const u = selectedUnit();
  const city = selectedCityId ? state.cities.find((c) => c.id === selectedCityId) : null;
  let html = '';
  if (u) {
    const t = UNIT_TYPES[u.type];
    html += `<h3>${t.name} <span class="tag" style="background:${PLAYERS[u.owner].color}">${PLAYERS[u.owner].name}</span></h3>
      <p>Životy ${u.hp}/${t.hp} · Útok ${t.atk} · Obrana ${t.def} · Dosah ${t.range}</p>
      <p>Pohyb ${u.movesLeft}/${t.move}${u.hasAttacked ? ' · už útočil' : ''}</p>`;
  }
  if (city) {
    const owner = city.owner === null ? 'neutrální' : PLAYERS[city.owner].name;
    const ci = cityInfo(state, city);
    html += `<h3>${city.name}</h3><p>Vlastník: ${owner}${city.capital ? ' · hlavní město' : ''}</p>
      <p>Příjem +${ci.income} zl./kolo · Obrana posádky +${ci.defensePct} % · Léčení +${ci.heal}</p>`;
    if (city.owner === 0 && state.current === 0 && !busy()) {
      const blocked = !!unitAt(state, city.q, city.r);
      html += '<div class="buy">';
      for (const [type, t] of Object.entries(UNIT_TYPES)) {
        const dis = blocked || state.gold[0] < t.cost ? 'disabled' : '';
        html += `<button data-buy="${type}" ${dis}>${t.name} <small>${t.cost} zl.</small></button>`;
      }
      html += '</div>';
      if (blocked) html += '<p class="hint">Město je obsazené – nejdřív z něj odejdi jednotkou.</p>';
    }
  }
  if (!u && !city && hover && !exploredTiles(state, 0).has(key(hover.q, hover.r))) {
    html = '<p>Neprozkoumané území</p>';
  } else if (!u && !city && hover && tileAt(state, hover.q, hover.r)) {
    const t = TERRAIN[tileAt(state, hover.q, hover.r).terrain];
    html = `<p>${t.name}${t.passable ? ` · pohyb ${t.cost} · obrana +${Math.round(t.defBonus * 100)} %` : ' · neprůchodné'}</p>`;
    const hc = cityAt(state, hover.q, hover.r);
    if (hc) {
      const ci = cityInfo(state, hc);
      html = `<h3>${hc.name}</h3><p>Příjem +${ci.income} zl./kolo · Obrana posádky +${ci.defensePct} %</p>` + html;
    }
  }
  if (!html) html = '<p class="hint">Klikni na svou jednotku (modrá) nebo město.</p>';
  info.innerHTML = html;

  $('log').innerHTML = state.log.slice(-8).reverse().map((l) => `<li><b>${l.turn}.</b> ${l.msg}</li>`).join('');

  const banner = $('banner');
  if (state.winner !== null) {
    banner.hidden = false;
    banner.textContent = state.winner === 0 ? 'Vítězství! Dobyl jsi nepřátelskou pevnost.' : 'Porážka. AI dobyla tvoje města.';
  } else {
    banner.hidden = true;
  }
}

function canvasPoint(ev) {
  const rect = canvas.getBoundingClientRect();
  const { w, h } = canvasSize(state);
  return { x: ((ev.clientX - rect.left) / rect.width) * w, y: ((ev.clientY - rect.top) / rect.height) * h };
}

function onClick(ev) {
  if (busy()) { anim.skip(); return; }
  if (state.winner !== null) return;
  const p = canvasPoint(ev);
  const hex = pickHex(p.x, p.y);
  if (!tileAt(state, hex.q, hex.r)) return;
  const clickedUnit = seenUnitAt(hex.q, hex.r);
  const clickedCity = exploredTiles(state, 0).has(key(hex.q, hex.r)) ? cityAt(state, hex.q, hex.r) : null;
  const sel = selectedUnit();

  if (sel && sel.owner === state.current) {
    if (clickedUnit && clickedUnit.owner !== sel.owner) {
      if (attackTargets(state, sel).includes(clickedUnit)) {
        const before = cloneState(state);
        attack(state, sel.id, clickedUnit.id);
        if (!getUnit(state, sel.id)) selectedId = null;
        afterAction(before);
        return;
      }
    } else if (!clickedUnit && reachable(state, sel).has(key(hex.q, hex.r))) {
      const before = cloneState(state);
      moveUnit(state, sel.id, hex.q, hex.r);
      selectedCityId = clickedCity ? clickedCity.id : null;
      afterAction(before);
      return;
    }
  }
  selectedId = clickedUnit ? clickedUnit.id : null;
  selectedCityId = clickedCity ? clickedCity.id : null;
  draw();
}

function onMove(ev) {
  const p = canvasPoint(ev);
  const hex = pickHex(p.x, p.y);
  const prev = hover;
  hover = tileAt(state, hex.q, hex.r) ? hex : null;
  if (!prev || !hover || prev.q !== hover.q || prev.r !== hover.r) {
    draw();
    showTooltip(ev, hover);
  }
}

// Zobrazí tooltip u kurzoru, ale nenechá ho přetéct přes okraj okna.
function placeTip(tip, ev) {
  tip.hidden = false;
  const x = Math.min(ev.clientX + 12, window.innerWidth - tip.offsetWidth - 8);
  const y = Math.min(ev.clientY + 12, window.innerHeight - tip.offsetHeight - 8);
  tip.style.left = `${Math.max(8, x)}px`;
  tip.style.top = `${Math.max(8, y)}px`;
}

function showTooltip(ev, hex) {
  const tip = $('tooltip');
  const sel = selectedUnit();
  const target = hex && seenUnitAt(hex.q, hex.r);
  if (sel && target && sel.owner === state.current && attackTargets(state, sel).includes(target)) {
    const p = previewAttack(state, sel, target);
    tip.textContent = `Útok: −${p.damage}${p.kills ? ' (zničí)' : ''}, protiúder −${p.counter}`;
    placeTip(tip, ev);
  } else if (hex && cityAt(state, hex.q, hex.r) && exploredTiles(state, 0).has(key(hex.q, hex.r))) {
    const city = cityAt(state, hex.q, hex.r);
    const ci = cityInfo(state, city);
    const owner = city.owner === null ? 'neutrální' : PLAYERS[city.owner].name;
    const gar = ci.garrison ? UNIT_TYPES[ci.garrison.type].name : 'bez posádky';
    tip.textContent = `${city.name} (${owner}): +${ci.income} zl./kolo · obrana +${ci.defensePct} % · ${gar}`;
    placeTip(tip, ev);
  } else {
    tip.hidden = true;
  }
}

// Po akci hráče: uložit a přehrát, co se stalo (before = stav před akcí).
async function afterAction(before = null) {
  const events = drainEvents(state);
  save();
  draw();
  if (before && events.length) {
    await anim.play(before, events);
    draw();
  }
}

function doEndTurn() {
  if (busy() || state.winner !== null) return;
  selectedId = null;
  selectedCityId = null;
  $('tooltip').hidden = true;
  endTurn(state);
  drainEvents(state);
  aiRunning = true;
  draw();
  setTimeout(async () => {
    const before = cloneState(state);
    runAITurn(state);
    const events = drainEvents(state);
    if (state.winner === null) endTurn(state);
    save();
    await anim.play(before, events);
    aiRunning = false;
    draw();
  }, 250);
}

function newGame() {
  if (busy()) return;
  if (state.winner === null && !confirm('Začít novou hru? Rozehraná hra se ztratí.')) return;
  state = createGame({ seed: randomSeed() });
  selectedId = null;
  selectedCityId = null;
  save();
  resize();
  draw();
}

canvas.addEventListener('click', onClick);
canvas.addEventListener('mousemove', onMove);
canvas.addEventListener('mouseleave', () => { hover = null; $('tooltip').hidden = true; draw(); });
$('end-turn').addEventListener('click', doEndTurn);
$('new-game').addEventListener('click', newGame);
$('next-unit').addEventListener('click', selectNextUnit);
$('info').addEventListener('click', (ev) => {
  const btn = ev.target.closest('button[data-buy]');
  if (!btn || !selectedCityId) return;
  if (!busy() && buyUnit(state, selectedCityId, btn.dataset.buy)) afterAction();
});
window.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter' || ev.key === 'e') doEndTurn();
  if (ev.key === 'Tab') { ev.preventDefault(); selectNextUnit(); }
  if (ev.key === 'Escape') {
    if (busy()) { anim.skip(); return; }
    selectedId = null; selectedCityId = null; draw();
  }
});

// Vybere další jednotku, která ještě může jednat (Tab / tlačítko).
function selectNextUnit() {
  if (busy() || state.winner !== null) return;
  const cur = selectedUnit();
  const next = nextActiveUnit(state, 0, cur && cur.owner === 0 ? cur.id : null);
  selectedId = next ? next.id : null;
  const city = next && cityAt(state, next.q, next.r);
  selectedCityId = city ? city.id : null;
  draw();
}

// Háček pro automatické testy (Playwright).
window.__game = {
  getState: () => state,
  endTurn: doEndTurn,
  nextUnit: selectNextUnit,
  selectedId: () => selectedId,
  isBusy: busy,
  setAnimSpeed: (x) => { anim.speed = x; },
  newGame: (seed) => { state = createGame({ seed }); resize(); draw(); },
};

resize();
draw();
