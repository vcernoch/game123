// Wires together game logic, rendering and browser controls.
import {
  createGame, reachable, attackTargets, moveUnit, attack, buyUnit, endTurn,
  unitAt, cityAt, getUnit, incomeOf, previewAttack, tileAt, pathTo, nextActiveUnit, cityInfo,
  cloneState, drainEvents, migrateState, logFor, isUndoableMove, canFortify, fortify, activeUnits, territoryOwner, cityResources, unitSummary, planRoute, setOrder, runOrders, cancelOrder, visibleTiles, exploredTiles, build, unitCost, hasBuilding,
  rankOf, rankMult, buildingCost, unitMove, factionOf, riverDefense, zocTiles, threatTiles, exportGame, importGame, saveFileName,
} from './game.js';
import { createAnimator } from './anim.js';
import { decideTap } from './input.js';
import { createSound, soundFor } from './sound.js';
import { chartSvg, summaryRows } from './stats.js';
import { GAME_VERSION, GAME_DATE } from './version.js';
import { runAITurn } from './ai.js';
import { SHORTCUTS, keyAction, recruitKey } from './keys.js';
import { render, canvasSize, pickHex } from './render.js';
import { key } from './hex.js';
import {
  UNIT_TYPES, TERRAIN, PLAYERS, DIFFICULTY, BUILDINGS, RANKS, FACTIONS, MAP_SIZES, RIVER, HAPPENINGS, FORTIFY, TERRITORY, ECONOMY, RESOURCES,
} from './rules.js';

const SAVE_KEY = 'game123-save';
const PREFS_KEY = 'game123-prefs';
const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const $ = (id) => document.getElementById(id);

const hadSave = !!load();
let state = load() || createGame({ seed: randomSeed() });
let selectedId = null;
let selectedCityId = null;
let hover = null;
let aiRunning = false;
let pending = null;        // touch: target awaiting confirmation by a second tap
let lastPointer = 'mouse'; // type of the last pointer (mouse / touch / pen)
let endArmed = false;      // end-turn reminder: the first press only asks for confirmation
let endArmTimer = null;
let undoStack = [];        // states before undoable moves this turn (memory only)
const sound = createSound();
sound.enabled = loadPrefs().sound !== false;
const anim = createAnimator(
  drawBoard,
  (st, q, r) => visibleTiles(st, 0).has(key(q, r)),
  (ev) => sound.play(soundFor(ev, 0)),
);
let lastWinner = state.winner;
let showThreats = false; // threat overlay, set from the preferences below
try {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) anim.speed = 0;
} catch { /* old browser */ }

// Unit on a tile, only if the player can see it (enemy units in fog are treated as absent).
function seenUnitAt(q, r) {
  const u = unitAt(state, q, r);
  return u && (u.owner === 0 || visibleTiles(state, 0).has(key(q, r))) ? u : null;
}

// The player can't act while the AI is playing or an animation is running.
const busy = () => aiRunning || anim.busy;

function randomSeed() {
  return Math.floor(Math.random() * 1e9);
}

function save() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch { /* no storage */ }
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
  canvas.style.setProperty('--zoom-w', `${Math.round(w)}px`); // zoomed map at natural size
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

const fmt = (x) => (Math.round(x * 10) / 10).toLocaleString('en-US');

// "Veteran ★ · XP 4/7" – rank and progress to the next one.
function rankLine(u) {
  const r = rankOf(u);
  const next = RANKS[r + 1];
  return `${RANKS[r].name} ${RANKS[r].symbol} · XP ${u.xp || 0}${next ? `/${next.xp}` : ''}`;
}

function selectedUnit() {
  return selectedId ? getUnit(state, selectedId) : null;
}

function draw() {
  drawBoard();
  updateHud();
}

// What route to draw: a move this turn (solid), a multi-turn order to the hovered tile (dashed,
// with the number of turns), or the selected unit's current order.
function pathView(u, mine) {
  if (!mine) return {};
  if (hover && !seenUnitAt(hover.q, hover.r)) {
    const near = pathTo(state, u, hover.q, hover.r);
    if (near) return { path: near };
    const far = planRoute(state, u, hover.q, hover.r);
    if (far) return { path: far.path, pathTurns: far.turns };
  }
  if (u.goto) {
    const cur = planRoute(state, u, u.goto.q, u.goto.r);
    if (cur) return { path: cur.path, pathTurns: cur.turns, pathFaint: true };
  }
  return {};
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
    zoc: mine ? zocTiles(state, 0) : null,
    threats: showThreats && state.winner === null ? threatTiles(shown, 0) : null,
    targets: mine ? new Set(attackTargets(state, u).map((t) => t.id)) : null,
    hover,
    ...pathView(u, mine),
  });
}

function updateHud() {
  $('turn').textContent = state.turn;
  $('gold').textContent = state.gold[0];
  $('income').textContent = `+${incomeOf(state, 0)}`;
  $('cities').textContent = `${state.cities.filter((c) => c.owner === 0).length} / ${state.cities.length}`;
  $('end-turn').disabled = busy() || state.winner !== null;
  updateEndTurnButton();

  const info = $('info');
  const u = selectedUnit();
  const city = selectedCityId ? state.cities.find((c) => c.id === selectedCityId) : null;
  let html = '';
  if (u) {
    const t = UNIT_TYPES[u.type];
    html += `<h3>${t.name} <span class="tag" style="background:${PLAYERS[u.owner].color}">${PLAYERS[u.owner].name}</span></h3>
      <p>HP ${u.hp}/${t.hp} · Attack ${fmt(t.atk * rankMult(u))} · Defense ${fmt(t.def * rankMult(u))} · Range ${t.range}</p>
      <p>Move ${fmt(u.movesLeft)}/${unitMove(state, u)}${u.fortified ? '' : u.hasAttacked ? ' · already attacked' : ''}</p>
      <p>${rankLine(u)}</p>${t.desc ? `<p class="hint">${t.desc}</p>` : ''}`;
    if (u.goto && u.owner === 0) {
      const r = planRoute(state, u, u.goto.q, u.goto.r);
      html += `<p class="order">➜ Marching to a target${r ? ` · ${r.turns} turn${r.turns === 1 ? '' : 's'}` : ''}</p>`;
      if (!busy()) html += '<button data-cancel-order class="secondary wide-btn">✖ Cancel order</button>';
    }
    if (u.fortified) html += `<p class="fortified">⛨ Fortified: +${Math.round(FORTIFY.defBonus * 100)} % defense until it moves or attacks</p>`;
    if (u.owner === 0 && !busy() && canFortify(state, u)) {
      html += `<button data-fortify class="secondary wide-btn" title="Dig in: +${Math.round(FORTIFY.defBonus * 100)} % defense, ends the unit's turn (F)">⛨ Fortify</button>`;
    }
  }
  if (city) {
    const owner = city.owner === null ? 'neutral' : PLAYERS[city.owner].name;
    const ci = cityInfo(state, city);
    html += `<h3>${city.name}</h3><p>Owner: ${owner}${city.capital ? ' · capital' : ''}</p>
      <p>Income +${ci.income} gold/turn · Garrison defense +${ci.defensePct} % · Healing +${ci.heal}</p>`;
    const res = cityResources(state, city).filter((t) => exploredTiles(state, 0).has(key(t.q, t.r)));
    if (res.length) html += `<p class="resource">Resources: ${res.map((t) => RESOURCES[t.resource].name).join(', ')}</p>`;
    const built = (city.buildings || []).map((b) => `<span class="building">${BUILDINGS[b].symbol} ${BUILDINGS[b].name}</span>`);
    if (built.length) html += `<p>${built.join(' ')}</p>`;
    if (city.owner === 0 && state.current === 0 && !busy()) {
      const blocked = !!unitAt(state, city.q, city.r);
      html += '<h4>Recruit</h4><div class="buy">';
      for (const [type, t] of Object.entries(UNIT_TYPES)) {
        const cost = unitCost(state, city, type);
        const dis = blocked || state.gold[0] < cost ? 'disabled' : '';
        html += `<button data-buy="${type}" ${dis} title="${t.desc ? `${t.desc} · ` : ''}key ${recruitKey(type)}"><span><kbd class="hotkey">${recruitKey(type)}</kbd> ${t.name}</span> <small>${cost} gold</small></button>`;
      }
      html += '</div>';
      if (blocked) html += '<p class="hint">The city is occupied – move the unit out first.</p>';
      const todo = Object.entries(BUILDINGS).filter(([b]) => !hasBuilding(city, b));
      if (todo.length) {
        html += '<h4>Build</h4><div class="buy">';
        for (const [b, info] of todo) {
          const bc = buildingCost(state, 0, b);
          const dis = state.gold[0] < bc ? 'disabled' : '';
          html += `<button data-build="${b}" class="secondary" ${dis}><span>${info.symbol} ${info.name}</span><small>${bc} gold</small><small class="desc">${info.desc}</small></button>`;
        }
        html += '</div>';
      }
    }
  }
  if (!u && !city && hover && !exploredTiles(state, 0).has(key(hover.q, hover.r))) {
    html = '<p>Unexplored territory</p>';
  } else if (!u && !city && hover && tileAt(state, hover.q, hover.r)) {
    const tile = tileAt(state, hover.q, hover.r);
    const t = TERRAIN[tile.terrain];
    const road = tile.road ? ' · road (move cost ½ along roads)' : '';
    const river = tile.rivers && tile.rivers.length ? ` · river (crossing +${RIVER.crossCost} move, defender +${Math.round(RIVER.defBonus * 100)} %)` : '';
    html = `<p>${t.name}${t.passable ? ` · move ${t.cost} · defense +${Math.round(t.defBonus * 100)} %` : ' · impassable'}${road}${river}</p>`;
    if (tile.terrain && t.passable && zocTiles(state, 0).has(key(hover.q, hover.r))) {
      html += '<p class="hint">Enemy zone of control – a unit that steps here must stop</p>';
    }
    if (tile.resource) html += `<p class="resource">${RESOURCES[tile.resource].name}: ${RESOURCES[tile.resource].desc}</p>`;
    const realm = territoryOwner(state, hover.q, hover.r);
    if (realm !== undefined) {
      const whose = realm === null ? 'neutral territory' : realm === 0 ? 'your territory' : `${PLAYERS[realm].name} territory`;
      html += `<p class="hint">${whose[0].toUpperCase()}${whose.slice(1)} – units resting here heal +${TERRITORY.healIdle} (elsewhere +${ECONOMY.healIdle})</p>`;
    }
    const hc = cityAt(state, hover.q, hover.r);
    if (hc) {
      const ci = cityInfo(state, hc);
      html = `<h3>${hc.name}</h3><p>Income +${ci.income} gold/turn · Garrison defense +${ci.defensePct} %</p>` + html;
    }
  }
  if (pending && u) {
    const target = seenUnitAt(pending.q, pending.r);
    if (target && target.owner !== u.owner) {
      const pr = previewAttack(state, u, target);
      html += `<p class="confirm">${riverDefense(state, u, target) ? 'Attack across a river' : 'Attack'}: −${pr.damage}${pr.kills ? ' (destroys)' : ''}, counter −${pr.counter}.<br>Tap the target again to confirm.</p>`;
    } else {
      const far = !reachable(state, u).has(key(pending.q, pending.r)) && planRoute(state, u, pending.q, pending.r);
      html += far
        ? `<p class="confirm">Tap the target again to send the unit there (${far.turns} turns).</p>`
        : '<p class="confirm">Tap the target again to confirm the move.</p>';
    }
  }
  if (!html) {
    const diff = DIFFICULTY[state.difficulty] || DIFFICULTY.normal;
    html = `<p class="hint">Click your unit (blue) or a city.</p>
      <p class="hint">Difficulty: ${diff.name}${state.fog ? '' : ' · no fog'}${state.happenings ? '' : ' · no random events'}</p>
      ${state.factions && state.factions[0] ? `<p class="hint">You: ${factionOf(state, 0).name} · AI: ${factionOf(state, 1).name}</p>` : ''}`;
  }
  if (undoStack.length && !busy() && state.winner === null) {
    html += '<button data-undo class="secondary undo-btn" title="Undo last move (Z)">↶ Undo move</button>';
  }
  info.innerHTML = html;

  $('log').innerHTML = logFor(state, 0).slice(-8).reverse()
    .map((l) => `<li${l.hidden ? ' class="hidden-act"' : ''}><b>${l.turn}.</b> ${l.msg}</li>`).join('');

  const banner = $('banner');
  // end-of-game jingle: once, after the last turn's animation finishes
  if (state.winner === null) lastWinner = null;
  else if (lastWinner === null && !busy()) {
    lastWinner = state.winner;
    sound.play(state.winner === 0 ? 'victory' : 'defeat');
  }
  if (state.winner !== null) {
    banner.hidden = false;
    $('banner-text').textContent = state.winner === 0
      ? `Victory in turn ${state.turn}! You captured the enemy cities.`
      : `Defeat in turn ${state.turn}. The AI captured your cities.`;
    if (!statsShownForEnd) { $('stats-panel').open = true; statsShownForEnd = true; }
  } else {
    banner.hidden = true;
    statsShownForEnd = false;
  }
  updateStats();
}

let statsShownForEnd = false;
let statsKey = '';

// Statistics panel: power chart and summary. Redrawn only on change (updateHud runs often).
function updateStats() {
  if (!$('stats-panel').open) return;
  const h = state.history || [];
  const key = `${h.length}:${state.winner}:${JSON.stringify(state.stats)}:${h.length ? h[h.length - 1].power : ''}`;
  if (key === statsKey) return;
  statsKey = key;
  if (h.length < 2) {
    $('stats').innerHTML = '<p class="hint">The chart appears after a few turns.</p>';
    return;
  }
  const rows = summaryRows(state).map(([label, a, b]) => `<tr><th>${label}</th><td>${a}</td><td>${b}</td></tr>`).join('');
  $('stats').innerHTML = '<h4>Army strength</h4>' + chartSvg(h, { title: 'Army strength over time' })
    + '<h4>Cities</h4>' + chartSvg(h, { metric: 'cities', height: 110, title: 'Cities' })
    + `<table class="stats-table"><tr><th></th><th>${PLAYERS[0].name}</th><th>${PLAYERS[1].name}</th></tr>${rows}</table>`;
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
  const touch = lastPointer === 'touch' || lastPointer === 'pen';
  const act = decideTap(state, { selectedId, pending, viewer: 0, confirm: touch }, hex.q, hex.r);
  pending = null;
  if (act.type === 'none') return;
  if (act.type === 'preview') {
    // touch: show the path / attack estimate and wait for a second tap
    pending = { q: act.q, r: act.r };
    hover = { q: act.q, r: act.r };
    draw();
    return;
  }
  if (act.type === 'attack') {
    const before = cloneState(state);
    attack(state, act.unitId, act.targetId);
    undoStack = [];
    if (!getUnit(state, act.unitId)) selectedId = null;
    if (touch) hover = null;
    afterAction(before);
    return;
  }
  if (act.type === 'goto') {
    const before = cloneState(state);
    const result = setOrder(state, act.unitId, act.q, act.r);
    undoStack = [];
    if (touch) hover = null;
    if (result === 'interrupted') showNotice([], [orderText(getUnit(state, act.unitId), result)]);
    afterAction(before);
    return;
  }
  if (act.type === 'move') {
    const before = cloneState(state);
    moveUnit(state, act.unitId, act.q, act.r);
    // copy: the animation replays events directly on `before`, so it would mutate it
    if (isUndoableMove(before, state, state.events, 0)) undoStack.push(cloneState(before));
    else undoStack = [];
    const c = cityAt(state, act.q, act.r);
    selectedCityId = c ? c.id : null;
    if (touch) hover = null;
    afterAction(before);
    return;
  }
  selectedId = act.unitId;
  selectedCityId = act.cityId;
  if (touch) hover = null;
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

// Shows the tooltip next to the cursor without letting it overflow the window edge.
function placeTip(tip, ev) {
  tip.hidden = false;
  const x = Math.min(ev.clientX + 12, window.innerWidth - tip.offsetWidth - 8);
  const y = Math.min(ev.clientY + 12, window.innerHeight - tip.offsetHeight - 8);
  tip.style.left = `${Math.max(8, x)}px`;
  tip.style.top = `${Math.max(8, y)}px`;
}

function showTooltip(ev, hex) {
  const tip = $('tooltip');
  if (lastPointer !== 'mouse') { tip.hidden = true; return; } // on touch the preview is in the panel
  const sel = selectedUnit();
  const target = hex && seenUnitAt(hex.q, hex.r);
  if (sel && target && sel.owner === state.current && attackTargets(state, sel).includes(target)) {
    const p = previewAttack(state, sel, target);
    tip.textContent = `${riverDefense(state, sel, target) ? 'Attack across a river' : 'Attack'}: −${p.damage}${p.kills ? ' (destroys)' : ''}, counter −${p.counter}`;
    placeTip(tip, ev);
  } else if (target) {
    // any visible unit: its stats; a city under it gets a second line
    const lines = [unitTipText(target)];
    const city = cityAt(state, hex.q, hex.r);
    if (city) lines.push(cityTipText(city));
    tip.textContent = lines.join('\n');
    placeTip(tip, ev);
  } else if (sel && hex && sel.owner === state.current && zocTiles(state, sel.owner).has(key(hex.q, hex.r))
    && reachable(state, sel).has(key(hex.q, hex.r))) {
    tip.textContent = 'Enemy zone of control – the move ends here';
    placeTip(tip, ev);
  } else if (hex && cityAt(state, hex.q, hex.r) && exploredTiles(state, 0).has(key(hex.q, hex.r))) {
    tip.textContent = cityTipText(cityAt(state, hex.q, hex.r));
    placeTip(tip, ev);
  } else {
    tip.hidden = true;
  }
}

function unitTipText(u) {
  const s = unitSummary(state, u);
  const tags = [s.rank !== RANKS[0].name ? s.rank : '', s.fortified ? 'fortified' : '', s.marching ? 'marching' : ''].filter(Boolean);
  return `${PLAYERS[s.owner].name}: ${s.name}${tags.length ? ` (${tags.join(', ')})` : ''} · HP ${s.hp}/${s.maxHp}\n`
    + `Attack ${fmt(s.attack)} · Defense ${fmt(s.defense)}${s.notes.length ? ` (${s.notes.join(', ')})` : ''} · Range ${s.range} · Move ${s.move}`;
}

function cityTipText(city) {
  const ci = cityInfo(state, city);
  const owner = city.owner === null ? 'neutral' : PLAYERS[city.owner].name;
  const gar = ci.garrison ? UNIT_TYPES[ci.garrison.type].name : 'no garrison';
  const bs = (city.buildings || []).map((b) => BUILDINGS[b].name).join(', ');
  return `${city.name} (${owner}): +${ci.income} gold/turn · defense +${ci.defensePct} % · ${gar}${bs ? ` · ${bs}` : ''}`;
}

// After a player action: save and replay what happened (before = state before the action).
async function afterAction(before = null) {
  const events = drainEvents(state);
  save();
  draw();
  if (before && events.length) {
    await anim.play(before, events);
    draw();
  }
}

// End-turn button: shows how many units can still act; while armed it asks for confirmation.
function updateEndTurnButton() {
  const btn = $('end-turn');
  const idle = state.current === 0 && state.winner === null ? activeUnits(state, 0).length : 0;
  if (endArmed && idle) {
    btn.textContent = 'Really end?';
    btn.title = `${idle} unit${idle === 1 ? '' : 's'} can still act – press again to end the turn`;
    btn.classList.add('armed');
  } else {
    btn.textContent = idle ? `End turn · ${idle}` : 'End turn';
    btn.title = idle ? `${idle} unit${idle === 1 ? '' : 's'} can still act (Tab selects them)` : 'End turn (Enter)';
    btn.classList.remove('armed');
  }
}

function disarmEndTurn() {
  endArmed = false;
  clearTimeout(endArmTimer);
}

// force = skip the reminder (test hook)
function doEndTurn(force = false) {
  if (busy() || state.winner !== null) return;
  if (!force && !endArmed && activeUnits(state, 0).length) {
    // first press with units that can still act: ask for a second press within a few seconds
    endArmed = true;
    clearTimeout(endArmTimer);
    endArmTimer = setTimeout(() => { endArmed = false; draw(); }, 4000);
    sound.play('click');
    draw();
    return;
  }
  disarmEndTurn();
  selectedId = null;
  selectedCityId = null;
  $('tooltip').hidden = true;
  pending = null;
  showNotice([]);
  undoStack = [];
  endTurn(state);
  drainEvents(state);
  aiRunning = true;
  draw();
  setTimeout(async () => {
    const before = cloneState(state);
    runAITurn(state);
    const events = drainEvents(state);
    if (state.winner === null) endTurn(state);
    const happened = drainEvents(state).filter((e) => e.type === 'happening' && e.player === 0);
    save();
    await anim.play(before, events);
    // the player's units with move orders walk on
    const beforeOrders = cloneState(state);
    const orders = state.winner === null && state.current === 0 ? runOrders(state, 0) : [];
    const walked = drainEvents(state);
    save();
    if (walked.length) await anim.play(beforeOrders, walked);
    aiRunning = false;
    const stopped = orders.filter((o) => o.result === 'interrupted' || o.result === 'blocked')
      .map((o) => orderText(getUnit(state, o.unitId), o.result));
    showNotice(happened, stopped);
    draw();
  }, 250);
}

// Why a move order stopped, for the banner.
function orderText(unit, result) {
  const name = unit ? UNIT_TYPES[unit.type].name : 'A unit';
  return result === 'interrupted' ? `${name} stopped its march: enemy in sight.` : `${name} can't get through – order cancelled.`;
}

// Banner for a random event that hit the player at the start of the turn (cleared at the next end of turn).
// extra = further messages (stopped move orders) appended to the banner.
function showNotice(happened, extra = []) {
  const el = $('notice');
  if (!happened.length && !extra.length) { el.hidden = true; return; }
  if (!happened.length) {
    el.textContent = extra.join(' ');
    el.className = 'bad';
    el.hidden = false;
    return;
  }
  const ev = happened[0];
  const city = state.cities.find((c) => c.id === ev.cityId);
  const name = HAPPENINGS.kinds[ev.kind].name;
  const place = city ? ` in ${city.name}` : '';
  let text = `${name}${place}`;
  if (ev.kind === 'harvest') text += `: +${ev.gold} gold.`;
  else if (ev.kind === 'plague' && ev.suppressed) text += ', but the infirmary contained it.';
  else if (ev.kind === 'plague') text += ev.hits.length ? `: infected units lost HP (${ev.hits.length}).` : ', but no unit was nearby.';
  else if (ev.suppressed) text += ev.reason === 'temple' ? ', but the temple kept the peace.' : ', but the garrison kept order.';
  else text += `: the city paid no taxes this turn (${ev.gold} gold).`;
  const good = ev.kind === 'harvest' || ev.suppressed;
  if (extra.length) text += ` ${extra.join(' ')}`;
  el.textContent = text;
  el.className = good ? 'good' : 'bad';
  el.hidden = false;
  sound.play(soundFor(ev, 0));
}

// Last choices in the new game dialog (convenience only; the game works without storage).
function loadPrefs() {
  try { return JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; } catch { return {}; }
}

function savePrefs(prefs) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* no storage */ }
}

function newGame({ firstVisit = false } = {}) {
  if (busy()) return;
  const dlg = $('new-game-dialog');
  const form = dlg.querySelector('form');
  const prefs = loadPrefs();
  const diff = DIFFICULTY[prefs.difficulty] ? prefs.difficulty : state.difficulty || 'normal';
  form.elements.difficulty.value = diff;
  form.elements.fog.checked = prefs.fog !== false;
  form.elements.happenings.checked = prefs.happenings !== false;
  form.elements.faction.value = FACTIONS[prefs.faction] ? prefs.faction : 'kingdom';
  form.elements.size.value = MAP_SIZES[prefs.size] ? prefs.size : 'medium';
  $('new-game-warning').hidden = firstVisit || state.winner !== null;
  dlg.showModal();
}

function startNewGame(options) {
  state = createGame({ seed: randomSeed(), ...options });
  undoStack = [];
  showNotice([]);
  selectedId = null;
  selectedCityId = null;
  save();
  resize();
  draw();
}

$('new-game-dialog').addEventListener('close', () => {
  const dlg = $('new-game-dialog');
  if (dlg.returnValue !== 'start') return;
  const form = dlg.querySelector('form');
  const options = {
    difficulty: form.elements.difficulty.value,
    fog: form.elements.fog.checked,
    happenings: form.elements.happenings.checked,
    faction: form.elements.faction.value,
    size: form.elements.size.value,
  };
  savePrefs({ ...loadPrefs(), ...options });
  startNewGame(options);
});
// "Load from file" in the new game dialog (it doubles as the main menu)
$('new-game-dialog').addEventListener('close', () => {
  if ($('new-game-dialog').returnValue === 'load') $('file-input').click();
});

// ---------- save files ----------

function fileStatus(text, ok) {
  const el = $('file-status');
  el.textContent = text;
  el.className = ok ? 'ok' : 'bad';
  el.hidden = false;
}

function saveToFile() {
  if (busy()) return;
  const blob = new Blob([exportGame(state, GAME_VERSION)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = saveFileName(state);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  fileStatus(`Saved as ${a.download}`, true);
}

// Loads a game from file text; returns true on success. The current game is replaced only if the
// file is valid.
function loadFromText(text) {
  if (busy()) return false;
  const { state: loaded, error } = importGame(text);
  if (error) {
    $('file-panel').open = true;
    fileStatus(error, false);
    return false;
  }
  state = loaded;
  undoStack = [];
  selectedId = null;
  selectedCityId = null;
  lastWinner = state.winner;
  showNotice([]);
  save();
  resize();
  draw();
  fileStatus(`Loaded: turn ${state.turn}`, true);
  return true;
}

$('save-file').addEventListener('click', saveToFile);
$('load-file').addEventListener('click', () => $('file-input').click());
$('file-input').addEventListener('change', async (ev) => {
  const file = ev.target.files && ev.target.files[0];
  ev.target.value = ''; // the same file can be picked again
  if (!file) return;
  if (file.size > 5e6) { $('file-panel').open = true; fileStatus('The file is too big for a saved game.', false); return; }
  loadFromText(await file.text());
});

// sound: unlock AudioContext on the first gesture, plus the header toggle
window.addEventListener('pointerdown', () => sound.unlock(), { once: true });
window.addEventListener('keydown', () => sound.unlock(), { once: true });
function updateSoundButton() {
  $('sound').textContent = sound.enabled ? '♪' : '♪̸';
  $('sound').setAttribute('aria-pressed', String(sound.enabled));
  $('sound').title = sound.enabled ? 'Sound on (click to turn off)' : 'Sound off (click to turn on)';
}
$('sound').addEventListener('click', () => {
  sound.enabled = !sound.enabled;
  savePrefs({ ...loadPrefs(), sound: sound.enabled });
  updateSoundButton();
  sound.play('click');
});
updateSoundButton();

for (const type of ['pointerdown', 'pointermove']) {
  canvas.addEventListener(type, (ev) => { lastPointer = ev.pointerType || 'mouse'; });
}
$('zoom').addEventListener('click', () => {
  const wrap = document.querySelector('.board-wrap');
  wrap.classList.toggle('zoomed');
  $('zoom').textContent = wrap.classList.contains('zoomed') ? 'Zoom out' : 'Zoom map';
  $('zoom').setAttribute('aria-pressed', wrap.classList.contains('zoomed'));
});
canvas.addEventListener('click', onClick);
canvas.addEventListener('mousemove', onMove);
canvas.addEventListener('mouseleave', () => { hover = null; $('tooltip').hidden = true; draw(); });
$('end-turn').addEventListener('click', () => doEndTurn());
$('new-game').addEventListener('click', () => newGame());
$('banner-new').addEventListener('click', () => newGame());
$('stats-panel').addEventListener('toggle', () => { statsKey = ''; updateStats(); });
$('next-unit').addEventListener('click', selectNextUnit);
$('info').addEventListener('click', (ev) => {
  if (ev.target.closest('button[data-undo]')) { undoMove(); return; }
  if (ev.target.closest('button[data-fortify]')) { fortifySelected(); return; }
  if (ev.target.closest('button[data-cancel-order]') && selectedId) { cancelOrder(state, selectedId); save(); draw(); return; }
  const bBtn = ev.target.closest('button[data-build]');
  if (bBtn && selectedCityId && !busy()) {
    if (build(state, selectedCityId, bBtn.dataset.build)) { undoStack = []; drainEvents(state); sound.play('build'); afterAction(); }
    return;
  }
  const btn = ev.target.closest('button[data-buy]');
  if (btn) recruitSelected(btn.dataset.buy);
});
// Shortcut overlay, generated from the same table as the key handling.
$('keys-open').addEventListener('click', () => $('keys-dialog').showModal());
$('keys-list').innerHTML = SHORTCUTS.map((s) => `<dt><kbd>${s.keys}</kbd></dt><dd>${s.text}</dd>`).join('');

window.addEventListener('keydown', (ev) => {
  if ($('new-game-dialog').open) return; // keys belong to the dialog
  if (ev.ctrlKey || ev.metaKey || ev.altKey) return; // leave browser shortcuts alone
  const act = keyAction(ev.key, ev.shiftKey);
  if (!act) return;
  if ($('keys-dialog').open) {
    if (act.type === 'help') $('keys-dialog').close(); // Esc is handled by the dialog itself
    return;
  }
  if (act.type !== 'endTurn' && act.type !== 'escape') ev.preventDefault();
  if (act.type === 'endTurn') doEndTurn(act.force);
  else if (act.type === 'nextUnit') selectNextUnit();
  else if (act.type === 'undo') undoMove();
  else if (act.type === 'fortify') fortifySelected();
  else if (act.type === 'recruit') recruitSelected(act.unitType);
  else if (act.type === 'help') $('keys-dialog').showModal();
  else if (act.type === 'threats') toggleThreats();
  else if (act.type === 'escape') {
    if (busy()) { anim.skip(); return; }
    selectedId = null; selectedCityId = null; pending = null; draw();
  }
});

// Threat overlay on/off (T / ⚠ button); remembered in the preferences.
function toggleThreats() {
  showThreats = !showThreats;
  savePrefs({ ...loadPrefs(), threats: showThreats });
  updateThreatButton();
  draw();
}

function updateThreatButton() {
  $('threats').setAttribute('aria-pressed', String(showThreats));
}
$('threats').addEventListener('click', toggleThreats);
showThreats = loadPrefs().threats === true;
updateThreatButton();

// Recruits in the selected own city (number keys and the panel buttons).
function recruitSelected(type) {
  if (busy() || !selectedCityId) return;
  if (buyUnit(state, selectedCityId, type)) { undoStack = []; sound.play('recruit'); afterAction(); }
}

// Selects the next unit that can still act (Tab / button).
function selectNextUnit() {
  if (busy() || state.winner !== null) return;
  pending = null;
  const cur = selectedUnit();
  const next = nextActiveUnit(state, 0, cur && cur.owner === 0 ? cur.id : null);
  selectedId = next ? next.id : null;
  const city = next && cityAt(state, next.q, next.r);
  selectedCityId = city ? city.id : null;
  draw();
}

// Fortifies the selected unit (F / button in the panel) and moves on to the next unit that can act.
function fortifySelected() {
  if (busy() || state.winner !== null) return;
  const u = selectedUnit();
  if (!u || u.owner !== 0 || !fortify(state, u.id)) return;
  undoStack = [];
  afterAction(null); // no animation needed – the shield appears right away
  sound.play('fortify');
  selectNextUnit();
}

// Undoes the last undoable move (Z key / panel button); the unit stays selected.
function undoMove() {
  if (busy() || !undoStack.length) return;
  const movedId = selectedId;
  state = undoStack.pop();
  pending = null;
  selectedId = getUnit(state, movedId) ? movedId : null;
  const u = selectedUnit();
  const c = u && cityAt(state, u.q, u.r);
  selectedCityId = c ? c.id : null;
  sound.play('click');
  save();
  draw();
}

// Hook for automated tests (Playwright).
window.__game = {
  getState: () => state,
  endTurn: () => doEndTurn(true),
  pressEndTurn: () => doEndTurn(),
  undo: undoMove,
  canUndo: () => undoStack.length > 0,
  nextUnit: selectNextUnit,
  selectedId: () => selectedId,
  isBusy: busy,
  version: GAME_VERSION,
  setAnimSpeed: (x) => { anim.speed = x; },
  refresh: () => { resize(); draw(); },
  newGame: (seed, options = {}) => { state = createGame({ seed, ...options }); undoStack = []; showNotice([]); resize(); draw(); },
  showNotice: (events) => { showNotice(events); draw(); },
  threatsShown: () => showThreats,
  exportText: () => exportGame(state, GAME_VERSION),
  loadText: loadFromText,
};

$('size-options').innerHTML = Object.entries(MAP_SIZES).map(([id, m]) => `
  <label><input type="radio" name="size" value="${id}" ${id === 'medium' ? 'checked' : ''}> <b>${m.name}</b> <small>${m.cols} × ${m.rows}, ${m.neutralCities + 2} cities – ${m.desc}</small></label>`).join('');

// Faction options in the dialog are generated from rules.js so new factions show up automatically.
$('faction-options').innerHTML = Object.entries(FACTIONS).map(([id, f], i) => `
  <label><input type="radio" name="faction" value="${id}" ${i === 0 ? 'checked' : ''}> <b>${f.name}</b> <small>${f.desc}</small></label>`).join('');

$('version').textContent = `v${GAME_VERSION}`;
$('version').title = `Version ${GAME_VERSION} from ${GAME_DATE}`;

resize();
draw();
// first visit (no saved game): the new game dialog acts as the main menu
if (!hadSave) newGame({ firstVisit: true });
