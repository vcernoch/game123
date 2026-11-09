// Propojení logiky, vykreslení a ovládání v prohlížeči.
import {
  createGame, reachable, attackTargets, moveUnit, attack, buyUnit, endTurn,
  unitAt, cityAt, getUnit, incomeOf, previewAttack, tileAt, pathTo, nextActiveUnit, cityInfo,
  cloneState, drainEvents, migrateState, visibleTiles, exploredTiles, build, unitCost, hasBuilding,
  rankOf, rankMult, buildingCost, unitMove, factionOf, riverDefense,
} from './game.js';
import { createAnimator } from './anim.js';
import { decideTap } from './input.js';
import { createSound, soundFor } from './sound.js';
import { chartSvg, summaryRows } from './stats.js';
import { GAME_VERSION, GAME_DATE } from './version.js';
import { runAITurn } from './ai.js';
import { render, canvasSize, pickHex } from './render.js';
import { key } from './hex.js';
import {
  UNIT_TYPES, TERRAIN, PLAYERS, DIFFICULTY, BUILDINGS, RANKS, FACTIONS, MAP_SIZES, RIVER, HAPPENINGS,
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
let pending = null;        // dotyk: cíl čekající na potvrzení druhým klepnutím
let lastPointer = 'mouse'; // typ posledního ukazatele (mouse / touch / pen)
const sound = createSound();
sound.enabled = loadPrefs().sound !== false;
const anim = createAnimator(
  drawBoard,
  (st, q, r) => visibleTiles(st, 0).has(key(q, r)),
  (ev) => sound.play(soundFor(ev, 0)),
);
let lastWinner = state.winner;
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
  canvas.style.setProperty('--zoom-w', `${Math.round(w)}px`); // přiblížená mapa v přirozené velikosti
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

const fmt = (x) => (Math.round(x * 10) / 10).toLocaleString('cs-CZ');

// "Veterán ★ · XP 4/7" – hodnost a kolik zbývá do další.
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
      <p>Životy ${u.hp}/${t.hp} · Útok ${fmt(t.atk * rankMult(u))} · Obrana ${fmt(t.def * rankMult(u))} · Dosah ${t.range}</p>
      <p>Pohyb ${fmt(u.movesLeft)}/${unitMove(state, u)}${u.hasAttacked ? ' · už útočil' : ''}</p>
      <p>${rankLine(u)}</p>${t.desc ? `<p class="hint">${t.desc}</p>` : ''}`;
  }
  if (city) {
    const owner = city.owner === null ? 'neutrální' : PLAYERS[city.owner].name;
    const ci = cityInfo(state, city);
    html += `<h3>${city.name}</h3><p>Vlastník: ${owner}${city.capital ? ' · hlavní město' : ''}</p>
      <p>Příjem +${ci.income} zl./kolo · Obrana posádky +${ci.defensePct} % · Léčení +${ci.heal}</p>`;
    const built = (city.buildings || []).map((b) => `<span class="building">${BUILDINGS[b].symbol} ${BUILDINGS[b].name}</span>`);
    if (built.length) html += `<p>${built.join(' ')}</p>`;
    if (city.owner === 0 && state.current === 0 && !busy()) {
      const blocked = !!unitAt(state, city.q, city.r);
      html += '<h4>Verbovat</h4><div class="buy">';
      for (const [type, t] of Object.entries(UNIT_TYPES)) {
        const cost = unitCost(state, city, type);
        const dis = blocked || state.gold[0] < cost ? 'disabled' : '';
        html += `<button data-buy="${type}" ${dis} title="${t.desc || ''}">${t.name} <small>${cost} zl.</small></button>`;
      }
      html += '</div>';
      if (blocked) html += '<p class="hint">Město je obsazené – nejdřív z něj odejdi jednotkou.</p>';
      const todo = Object.entries(BUILDINGS).filter(([b]) => !hasBuilding(city, b));
      if (todo.length) {
        html += '<h4>Stavět</h4><div class="buy">';
        for (const [b, info] of todo) {
          const bc = buildingCost(state, 0, b);
          const dis = state.gold[0] < bc ? 'disabled' : '';
          html += `<button data-build="${b}" class="secondary" ${dis}><span>${info.symbol} ${info.name}</span><small>${bc} zl.</small><small class="desc">${info.desc}</small></button>`;
        }
        html += '</div>';
      }
    }
  }
  if (!u && !city && hover && !exploredTiles(state, 0).has(key(hover.q, hover.r))) {
    html = '<p>Neprozkoumané území</p>';
  } else if (!u && !city && hover && tileAt(state, hover.q, hover.r)) {
    const tile = tileAt(state, hover.q, hover.r);
    const t = TERRAIN[tile.terrain];
    const road = tile.road ? ' · silnice (po silnici pohyb ½)' : '';
    const river = tile.rivers && tile.rivers.length ? ` · řeka (přechod +${RIVER.crossCost} pohyb, obránce +${Math.round(RIVER.defBonus * 100)} %)` : '';
    html = `<p>${t.name}${t.passable ? ` · pohyb ${t.cost} · obrana +${Math.round(t.defBonus * 100)} %` : ' · neprůchodné'}${road}${river}</p>`;
    const hc = cityAt(state, hover.q, hover.r);
    if (hc) {
      const ci = cityInfo(state, hc);
      html = `<h3>${hc.name}</h3><p>Příjem +${ci.income} zl./kolo · Obrana posádky +${ci.defensePct} %</p>` + html;
    }
  }
  if (pending && u) {
    const target = seenUnitAt(pending.q, pending.r);
    if (target && target.owner !== u.owner) {
      const pr = previewAttack(state, u, target);
      html += `<p class="confirm">Útok${riverDefense(state, u, target) ? ' přes řeku' : ''}: −${pr.damage}${pr.kills ? ' (zničí)' : ''}, protiúder −${pr.counter}.<br>Klepni na cíl znovu pro potvrzení.</p>`;
    } else {
      html += '<p class="confirm">Klepni na cíl znovu pro potvrzení pohybu.</p>';
    }
  }
  if (!html) {
    const diff = DIFFICULTY[state.difficulty] || DIFFICULTY.normal;
    html = `<p class="hint">Klikni na svou jednotku (modrá) nebo město.</p>
      <p class="hint">Obtížnost: ${diff.name}${state.fog ? '' : ' · bez mlhy'}${state.happenings ? '' : ' · bez náhodných událostí'}</p>
      ${state.factions && state.factions[0] ? `<p class="hint">Ty: ${factionOf(state, 0).name} · AI: ${factionOf(state, 1).name}</p>` : ''}`;
  }
  info.innerHTML = html;

  $('log').innerHTML = state.log.slice(-8).reverse().map((l) => `<li><b>${l.turn}.</b> ${l.msg}</li>`).join('');

  const banner = $('banner');
  // znělka konce hry: jednou, až doběhne animace posledního tahu
  if (state.winner === null) lastWinner = null;
  else if (lastWinner === null && !busy()) {
    lastWinner = state.winner;
    sound.play(state.winner === 0 ? 'victory' : 'defeat');
  }
  if (state.winner !== null) {
    banner.hidden = false;
    $('banner-text').textContent = state.winner === 0
      ? `Vítězství v ${state.turn}. kole! Dobyl jsi nepřátelská města.`
      : `Porážka v ${state.turn}. kole. AI dobyla tvoje města.`;
    if (!statsShownForEnd) { $('stats-panel').open = true; statsShownForEnd = true; }
  } else {
    banner.hidden = true;
    statsShownForEnd = false;
  }
  updateStats();
}

let statsShownForEnd = false;
let statsKey = '';

// Panel statistik: graf síly a souhrn. Překresluje se jen při změně (updateHud běží často).
function updateStats() {
  if (!$('stats-panel').open) return;
  const h = state.history || [];
  const key = `${h.length}:${state.winner}:${JSON.stringify(state.stats)}:${h.length ? h[h.length - 1].power : ''}`;
  if (key === statsKey) return;
  statsKey = key;
  if (h.length < 2) {
    $('stats').innerHTML = '<p class="hint">Graf se objeví po několika kolech.</p>';
    return;
  }
  const rows = summaryRows(state).map(([label, a, b]) => `<tr><th>${label}</th><td>${a}</td><td>${b}</td></tr>`).join('');
  $('stats').innerHTML = '<h4>Síla armád</h4>' + chartSvg(h, { title: 'Síla armád v čase' })
    + '<h4>Počet měst</h4>' + chartSvg(h, { metric: 'cities', height: 110, title: 'Počet měst' })
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
    // dotyk: ukázat trasu / odhad útoku a čekat na druhé klepnutí
    pending = { q: act.q, r: act.r };
    hover = { q: act.q, r: act.r };
    draw();
    return;
  }
  if (act.type === 'attack') {
    const before = cloneState(state);
    attack(state, act.unitId, act.targetId);
    if (!getUnit(state, act.unitId)) selectedId = null;
    if (touch) hover = null;
    afterAction(before);
    return;
  }
  if (act.type === 'move') {
    const before = cloneState(state);
    moveUnit(state, act.unitId, act.q, act.r);
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
  if (lastPointer !== 'mouse') { tip.hidden = true; return; } // na dotyk je náhled v panelu
  const sel = selectedUnit();
  const target = hex && seenUnitAt(hex.q, hex.r);
  if (sel && target && sel.owner === state.current && attackTargets(state, sel).includes(target)) {
    const p = previewAttack(state, sel, target);
    tip.textContent = `Útok${riverDefense(state, sel, target) ? ' přes řeku' : ''}: −${p.damage}${p.kills ? ' (zničí)' : ''}, protiúder −${p.counter}`;
    placeTip(tip, ev);
  } else if (hex && cityAt(state, hex.q, hex.r) && exploredTiles(state, 0).has(key(hex.q, hex.r))) {
    const city = cityAt(state, hex.q, hex.r);
    const ci = cityInfo(state, city);
    const owner = city.owner === null ? 'neutrální' : PLAYERS[city.owner].name;
    const gar = ci.garrison ? UNIT_TYPES[ci.garrison.type].name : 'bez posádky';
    const bs = (city.buildings || []).map((b) => BUILDINGS[b].name).join(', ');
    tip.textContent = `${city.name} (${owner}): +${ci.income} zl./kolo · obrana +${ci.defensePct} % · ${gar}${bs ? ` · ${bs}` : ''}`;
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
  pending = null;
  showNotice([]);
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
    aiRunning = false;
    showNotice(happened);
    draw();
  }, 250);
}

// Pruh s náhodnou událostí, která hráče potkala na začátku tahu (zmizí s dalším koncem tahu).
function showNotice(happened) {
  const el = $('notice');
  if (!happened.length) { el.hidden = true; return; }
  const ev = happened[0];
  const city = state.cities.find((c) => c.id === ev.cityId);
  const name = HAPPENINGS.kinds[ev.kind].name;
  const place = city ? ` ve městě ${city.name}` : '';
  let text = `${name}${place}`;
  if (ev.kind === 'harvest') text += `: +${ev.gold} zlata.`;
  else if (ev.kind === 'plague') text += ev.hits.length ? `: nakažené jednotky ztratily životy (${ev.hits.length}).` : ', ale žádná jednotka nebyla poblíž.';
  else if (ev.suppressed) text += ', ale posádka udržela pořádek.';
  else text += `: město tento tah neodvedlo daně (${ev.gold} zl.).`;
  const good = ev.kind === 'harvest' || ev.suppressed;
  el.textContent = text;
  el.className = good ? 'good' : 'bad';
  el.hidden = false;
  sound.play(soundFor(ev, 0));
}

// Poslední volba v dialogu nové hry (jen pohodlí, hra funguje i bez úložiště).
function loadPrefs() {
  try { return JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; } catch { return {}; }
}

function savePrefs(prefs) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* bez úložiště */ }
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

// zvuk: odemknout AudioContext prvním gestem a přepínač v záhlaví
window.addEventListener('pointerdown', () => sound.unlock(), { once: true });
window.addEventListener('keydown', () => sound.unlock(), { once: true });
function updateSoundButton() {
  $('sound').textContent = sound.enabled ? '♪' : '♪̸';
  $('sound').setAttribute('aria-pressed', String(sound.enabled));
  $('sound').title = sound.enabled ? 'Zvuk zapnutý (klikni pro vypnutí)' : 'Zvuk vypnutý (klikni pro zapnutí)';
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
  $('zoom').textContent = wrap.classList.contains('zoomed') ? 'Oddálit mapu' : 'Přiblížit mapu';
  $('zoom').setAttribute('aria-pressed', wrap.classList.contains('zoomed'));
});
canvas.addEventListener('click', onClick);
canvas.addEventListener('mousemove', onMove);
canvas.addEventListener('mouseleave', () => { hover = null; $('tooltip').hidden = true; draw(); });
$('end-turn').addEventListener('click', doEndTurn);
$('new-game').addEventListener('click', () => newGame());
$('banner-new').addEventListener('click', () => newGame());
$('stats-panel').addEventListener('toggle', () => { statsKey = ''; updateStats(); });
$('next-unit').addEventListener('click', selectNextUnit);
$('info').addEventListener('click', (ev) => {
  const bBtn = ev.target.closest('button[data-build]');
  if (bBtn && selectedCityId && !busy()) {
    if (build(state, selectedCityId, bBtn.dataset.build)) { drainEvents(state); sound.play('build'); afterAction(); }
    return;
  }
  const btn = ev.target.closest('button[data-buy]');
  if (!btn || !selectedCityId) return;
  if (!busy() && buyUnit(state, selectedCityId, btn.dataset.buy)) { sound.play('recruit'); afterAction(); }
});
window.addEventListener('keydown', (ev) => {
  if ($('new-game-dialog').open) return; // klávesy patří dialogu
  if (ev.key === 'Enter' || ev.key === 'e') doEndTurn();
  if (ev.key === 'Tab') { ev.preventDefault(); selectNextUnit(); }
  if (ev.key === 'Escape') {
    if (busy()) { anim.skip(); return; }
    selectedId = null; selectedCityId = null; pending = null; draw();
  }
});

// Vybere další jednotku, která ještě může jednat (Tab / tlačítko).
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

// Háček pro automatické testy (Playwright).
window.__game = {
  getState: () => state,
  endTurn: doEndTurn,
  nextUnit: selectNextUnit,
  selectedId: () => selectedId,
  isBusy: busy,
  version: GAME_VERSION,
  setAnimSpeed: (x) => { anim.speed = x; },
  refresh: () => { resize(); draw(); },
  newGame: (seed, options = {}) => { state = createGame({ seed, ...options }); showNotice([]); resize(); draw(); },
  showNotice: (events) => { showNotice(events); draw(); },
};

$('size-options').innerHTML = Object.entries(MAP_SIZES).map(([id, m]) => `
  <label><input type="radio" name="size" value="${id}" ${id === 'medium' ? 'checked' : ''}> <b>${m.name}</b> <small>${m.cols} × ${m.rows}, ${m.neutralCities + 2} měst – ${m.desc}</small></label>`).join('');

// Volby frakcí v dialogu se generují z rules.js, ať se nové frakce objeví samy.
$('faction-options').innerHTML = Object.entries(FACTIONS).map(([id, f], i) => `
  <label><input type="radio" name="faction" value="${id}" ${i === 0 ? 'checked' : ''}> <b>${f.name}</b> <small>${f.desc}</small></label>`).join('');

$('version').textContent = `v${GAME_VERSION}`;
$('version').title = `Verze ${GAME_VERSION} z ${GAME_DATE}`;

resize();
draw();
// první návštěva (žádná uložená hra): dialog nové hry slouží jako hlavní menu
if (!hadSave) newGame({ firstVisit: true });
