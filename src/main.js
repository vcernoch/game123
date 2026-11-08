// Propojení logiky, vykreslení a ovládání v prohlížeči.
import {
  createGame, reachable, attackTargets, moveUnit, attack, buyUnit, endTurn,
  unitAt, cityAt, getUnit, incomeOf, previewAttack, tileAt, pathTo, nextActiveUnit,
} from './game.js';
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
    return s && s.version === 1 ? s : null;
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
  const u = selectedUnit();
  const mine = u && u.owner === state.current && !aiRunning;
  render(ctx, state, {
    selectedId,
    reachable: mine ? reachable(state, u) : null,
    targets: mine ? new Set(attackTargets(state, u).map((t) => t.id)) : null,
    hover,
    path: mine && hover && !unitAt(state, hover.q, hover.r) ? pathTo(state, u, hover.q, hover.r) : null,
  });
  updateHud();
}

function updateHud() {
  $('turn').textContent = state.turn;
  $('gold').textContent = state.gold[0];
  $('income').textContent = `+${incomeOf(state, 0)}`;
  $('cities').textContent = `${state.cities.filter((c) => c.owner === 0).length} / ${state.cities.length}`;
  $('end-turn').disabled = aiRunning || state.winner !== null;

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
    html += `<h3>${city.name}</h3><p>Vlastník: ${owner}${city.capital ? ' · hlavní město' : ''}</p>`;
    if (city.owner === 0 && state.current === 0 && !aiRunning) {
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
  if (!u && !city && hover && tileAt(state, hover.q, hover.r)) {
    const t = TERRAIN[tileAt(state, hover.q, hover.r).terrain];
    html = `<p>${t.name}${t.passable ? ` · pohyb ${t.cost} · obrana +${Math.round(t.defBonus * 100)} %` : ' · neprůchodné'}</p>`;
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
  if (aiRunning || state.winner !== null) return;
  const p = canvasPoint(ev);
  const hex = pickHex(p.x, p.y);
  if (!tileAt(state, hex.q, hex.r)) return;
  const clickedUnit = unitAt(state, hex.q, hex.r);
  const clickedCity = cityAt(state, hex.q, hex.r);
  const sel = selectedUnit();

  if (sel && sel.owner === state.current) {
    if (clickedUnit && clickedUnit.owner !== sel.owner) {
      if (attackTargets(state, sel).includes(clickedUnit)) {
        attack(state, sel.id, clickedUnit.id);
        if (!getUnit(state, sel.id)) selectedId = null;
        afterAction();
        return;
      }
    } else if (!clickedUnit && reachable(state, sel).has(key(hex.q, hex.r))) {
      moveUnit(state, sel.id, hex.q, hex.r);
      selectedCityId = clickedCity ? clickedCity.id : null;
      afterAction();
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

function showTooltip(ev, hex) {
  const tip = $('tooltip');
  const sel = selectedUnit();
  const target = hex && unitAt(state, hex.q, hex.r);
  if (sel && target && sel.owner === state.current && attackTargets(state, sel).includes(target)) {
    const p = previewAttack(state, sel, target);
    tip.textContent = `Útok: −${p.damage}${p.kills ? ' (zničí)' : ''}, protiúder −${p.counter}`;
    tip.hidden = false;
    tip.style.left = `${ev.clientX + 12}px`;
    tip.style.top = `${ev.clientY + 12}px`;
  } else {
    tip.hidden = true;
  }
}

function afterAction() {
  save();
  draw();
}

function doEndTurn() {
  if (aiRunning || state.winner !== null) return;
  selectedId = null;
  selectedCityId = null;
  endTurn(state);
  aiRunning = true;
  draw();
  setTimeout(() => {
    runAITurn(state);
    if (state.winner === null) endTurn(state);
    aiRunning = false;
    save();
    draw();
  }, 350);
}

function newGame() {
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
  if (buyUnit(state, selectedCityId, btn.dataset.buy)) afterAction();
});
window.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter' || ev.key === 'e') doEndTurn();
  if (ev.key === 'Tab') { ev.preventDefault(); selectNextUnit(); }
  if (ev.key === 'Escape') { selectedId = null; selectedCityId = null; draw(); }
});

// Vybere další jednotku, která ještě může jednat (Tab / tlačítko).
function selectNextUnit() {
  if (aiRunning || state.winner !== null) return;
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
  isBusy: () => aiRunning,
  newGame: (seed) => { state = createGame({ seed }); resize(); draw(); },
};

resize();
draw();
