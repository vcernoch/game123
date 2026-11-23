// Wires together game logic, rendering and browser controls.
import {
  createGame, reachable, attackTargets, moveUnit, attack, buyUnit, endTurn,
  unitAt, cityAt, getUnit, incomeOf, previewAttack, tileAt, pathTo, nextActiveUnit, cityInfo,
  cloneState, drainEvents, migrateState, logFor, turnReport, reportText, reportIsBad, isUndoableMove, canFortify, fortify, canForceMarch, forceMarch, marchReach, canSentry, sentry, SENTRY_TEXT, animSpeedOf, nextAnimSpeed, activeUnits, territoryOwner, cityResources, unitSummary, planRoute, setOrder, runOrders, cancelOrder, visibleTiles, exploredTiles, build, unitCost, hasBuilding,
  rankOf, rankMult, buildingCost, inspiredUnits, unitMove, factionOf, riverDefense, flankers, zocTiles, threatTiles, exportGame, importGame, saveFileName, parseSeed, restartOptions,
  upgradeOptions, upgradeUnit, canDisband, disbandRefund, disbandUnit, chargeReady, movesAfterAttack, pursuesInto,
  updateSightings, lastSeen, lastSeenAt, lastSeenText, armyOverview, ARMY_STATUS, ruinBelieved,
  canExplore, setExplore, canPillage, pillage, isPillaged, pillageTurnsLeft, canRepair, repair,
  rallyPath, setRally, clearRally, swapPartners, swapUnits, canBuildRoad, buildRoad, timelineFor, adviseTurn, suggestRecruit, growthText, tradeText, tradeRoute, unrestText, focusOf, focusText, setFocus, levy, levyProblem, setRecruitOrder, clearRecruitOrder, recruitOrderText,
} from './game.js';
import { createAnimator } from './anim.js';
import { decideTap } from './input.js';
import { createSound, soundFor } from './sound.js';
import { chartSvg, summaryRows, hallOfFameHtml, timelineHtml } from './stats.js';
import { GAME_VERSION, GAME_DATE } from './version.js';
import { runAITurn } from './ai.js';
import { SHORTCUTS, keyAction, recruitKey } from './keys.js';
import { render, canvasSize, pickHex, tileCenter } from './render.js';
import { key } from './hex.js';
import {
  UNIT_TYPES, TERRAIN, PLAYERS, DIFFICULTY, BUILDINGS, RANKS, FACTIONS, MAP_SIZES, RIVER, HAPPENINGS, FORTIFY, FORCED_MARCH, TERRITORY, ECONOMY, RESOURCES, HIGH_GROUND, CHARGE, INSPIRE, RUINS, PILLAGE, REPAIR, ROADWORK, SENTRY, FOCUS, LEVY,
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
let rallyPick = null;      // id of the city whose rally point the player is picking on the map
let swapPick = null;       // id of the unit that is picking a neighbour to swap places with
let lastPointer = 'mouse'; // type of the last pointer (mouse / touch / pen)
let endArmed = false;      // end-turn reminder: the first press only asks for confirmation
let endArmTimer = null;
let disbandArmed = null;   // id of the unit whose Disband button was pressed once (asks for a second press)
let disbandArmTimer = null;
let undoStack = [];        // states before undoable moves this turn (memory only)
let lossMarks = [];        // tiles where the player lost units/cities in the last enemy turn (memory only)
const sound = createSound();
sound.enabled = loadPrefs().sound !== false;
const anim = createAnimator(
  drawBoard,
  (st, q, r) => visibleTiles(st, 0).has(key(q, r)),
  (ev) => sound.play(soundFor(ev, 0)),
);
let lastWinner = state.winner;
let showThreats = false; // threat overlay, set from the preferences below
let reducedMotion = false;
try {
  reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
} catch { /* old browser */ }
let animSpeed = animSpeedOf(loadPrefs().animSpeed, reducedMotion); // see ANIM_SPEEDS
anim.speed = animSpeed.mult;

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

// Escapes text for innerHTML (unit names may come from an imported save file).
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const fmt = (x) => (Math.round(x * 10) / 10).toLocaleString('en-US');

// "Veteran ★ · XP 4/7" – rank and progress to the next one.
function rankLine(u) {
  const r = rankOf(u);
  const next = RANKS[r + 1];
  const kills = u.kills ? ` · ${u.kills} kill${u.kills === 1 ? '' : 's'}` : '';
  return `${RANKS[r].name} ${RANKS[r].symbol} · XP ${u.xp || 0}${next ? `/${next.xp}` : ''}${kills}`;
}

// "Inspires 2 units next to it (+10 % defense)" for a named hero.
function inspireLine(u) {
  if (!u.name) return '';
  const n = inspiredUnits(state, u).length;
  const who = n ? `${n} unit${n === 1 ? '' : 's'} next to it` : 'units next to it';
  return `<p class="inspire">Inspires ${who} (+${Math.round(INSPIRE.defBonus * 100)} % defense)</p>`;
}

// "Attack", "Attack across a river", "Flanking attack +20 %" … for the attack preview.
function attackLabel(attacker, target, preview) {
  let label = riverDefense(state, attacker, target) ? 'Attack across a river' : 'Attack';
  if (preview.flank) label = `${label.replace('Attack', 'Flanking attack')} (+${Math.round(preview.flank * 100)} %)`;
  if (preview.high) label += ` · high ground +${Math.round(preview.high * 100)} %`;
  if (preview.charge) label += ` · charge +${Math.round(preview.charge * 100)} %`;
  if (preview.inspired) label += ` · target inspired (defense +${Math.round(preview.inspired * 100)} %)`;
  const keep = preview.dies ? 0 : movesAfterAttack(state, attacker);
  if (keep > 0) label += ` · then ${fmt(keep)} move to pull back`;
  if (preview.kills && pursuesInto(state, attacker, target)) label += ' · then it can advance';
  return label;
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

// Own units that would flank the hovered attack target of the selected unit (for the ⚔ badges).
function flankView(u) {
  const at = pending || hover; // touch: the target awaiting confirmation
  const target = at && seenUnitAt(at.q, at.r);
  if (!target || !attackTargets(state, u).includes(target)) return null;
  return new Set(flankers(state, u, target).map((f) => f.id));
}

// Rally flags of own cities; the selected city's route to its flag, or – while picking – to the hovered tile.
function rallyView() {
  if (busy()) return {};
  const rallies = state.cities.filter((c) => c.owner === 0 && c.rally).map((c) => ({ ...c.rally, selected: c.id === selectedCityId }));
  const city = state.cities.find((c) => c.id === (rallyPick ?? selectedCityId));
  let rallyLine = null;
  if (city && city.owner === 0) {
    const to = rallyPick !== null ? hover : city.rally;
    rallyLine = to ? rallyPath(state, city, to.q, to.r) : null;
  }
  return { rallies, rallyLine, rallyPicking: rallyPick !== null };
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
    flankers: mine ? flankView(u) : null,
    inspired: u && u.owner === 0 && !busy() ? new Set(inspiredUnits(state, u).map((o) => o.id)) : null,
    swaps: mine && swapPick === u.id ? new Set(swapPartners(state, u).map((o) => o.id)) : null,
    lossMarks: busy() ? null : lossMarks,
    ghosts: busy() ? null : lastSeen(state, 0),
    ...pathView(u, mine),
    ...rallyView(),
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
    html += `<h3>${u.name ? `<span class="hero">${esc(u.name)}</span> ` : ''}${t.name} <span class="tag" style="background:${PLAYERS[u.owner].color}">${PLAYERS[u.owner].name}</span></h3>
      <p>HP ${u.hp}/${t.hp} · Attack ${fmt(t.atk * rankMult(u))} · Defense ${fmt(t.def * rankMult(u))} · Range ${t.range}</p>
      <p>Move ${fmt(u.movesLeft)}/${unitMove(state, u)}${u.fortified ? '' : u.hasAttacked ? (u.movesLeft > 0 ? ' · already attacked' : ' · done for this turn') : ''}${chargeReady(state, u) ? ` · <span class="charge">charge ready (+${Math.round(CHARGE.atkBonus * 100)} %)</span>` : ''}</p>
      <p>${rankLine(u)}</p>${inspireLine(u)}${t.desc ? `<p class="hint">${t.desc}</p>` : ''}`;
    if (u.goto && u.owner === 0) {
      const r = planRoute(state, u, u.goto.q, u.goto.r);
      html += `<p class="order">➜ Marching to a target${r ? ` · ${r.turns} turn${r.turns === 1 ? '' : 's'}` : ''}</p>`;
      if (!busy()) html += '<button data-cancel-order class="secondary wide-btn">✖ Cancel order</button>';
    }
    if (u.explore && u.owner === 0) {
      html += '<p class="order">🧭 Exploring the fog – walks on by itself each turn</p>';
      if (!busy()) html += '<button data-cancel-order class="secondary wide-btn">✖ Stop exploring</button>';
    }
    if (u.owner === 0 && !busy() && canExplore(state, u)) {
      html += '<button data-explore class="secondary wide-btn" title="Walk into the fog by itself each turn until nothing is left or an enemy shows up (X)">🧭 Explore</button>';
    }
    if (u.owner === 0 && !busy() && canPillage(state, u)) {
      html += `<button data-pillage class="secondary wide-btn" title="Plunder this enemy resource: +${PILLAGE.gold} gold, it gives its owner nothing for ${PILLAGE.turns} turns; ends the unit's turn (P)">🔥 Pillage (+${PILLAGE.gold} gold)</button>`;
    }
    if (u.owner === 0 && !busy() && canRepair(state, u, { affordable: false })) {
      const ok = canRepair(state, u);
      html += `<button data-repair class="secondary wide-btn" ${ok ? '' : 'disabled'} title="Rebuild this pillaged resource of yours: it works again right away; costs ${REPAIR.gold} gold and ends the unit's turn (R)">🔧 Repair (${REPAIR.gold} gold)</button>`;
    }
    if (u.owner === 0 && !busy() && canBuildRoad(state, u, { affordable: false })) {
      const ok = canBuildRoad(state, u);
      html += `<button data-road class="secondary wide-btn" ${ok ? '' : 'disabled'} title="Lay a road on this tile of your territory: moving between road tiles costs ½; costs ${ROADWORK.gold} gold and ends the unit's turn (B)">🛤 Build road (${ROADWORK.gold} gold)</button>`;
    }
    if (u.raided && u.movesLeft > 0) {
      html += `<p class="march">🏇 Hit and run: ${fmt(u.movesLeft)} move left to pull back – no second attack, no foreign city</p>`;
    }
    if (u.owner === 0 && unitSummary(state, u).pursuit) {
      html += '<p class="march">➜ Pursuit: click the freed tile to advance there for free – or stay where you are</p>';
    }
    if (u.marched) html += `<p class="march">🥾 Forced march: +${FORCED_MARCH.bonus} move, no attack and no healing this turn</p>`;
    if (u.owner === 0 && !busy() && canForceMarch(state, u)) {
      const extra = marchReach(state, u).size - reachable(state, u).size;
      html += `<button data-march class="secondary wide-btn" title="Push on: +${FORCED_MARCH.bonus} move this turn for ${FORCED_MARCH.hpCost} HP; the unit can't attack and won't heal this turn${extra > 0 ? ` (${extra} more tile${extra === 1 ? '' : 's'} in reach)` : ''} (M)">🥾 Forced march <small>+${FORCED_MARCH.bonus} move · −${FORCED_MARCH.hpCost} HP · no attack</small></button>`;
    }
    if (u.fortified) html += `<p class="fortified">⛨ Fortified: +${Math.round(FORTIFY.defBonus * 100)} % defense until it moves or attacks</p>`;
    if (u.sentry && u.owner === 0) {
      html += `<p class="sentry">${SENTRY_TEXT[u.sentry]}</p>`;
      if (!busy()) html += '<button data-cancel-order class="secondary wide-btn">✖ Wake up</button>';
    }
    if (u.owner === 0 && !busy() && canSentry(state, u)) {
      const heal = u.hp < UNIT_TYPES[u.type].hp;
      html += `<button data-sentry class="secondary wide-btn" title="${heal ? 'Rest here until fully healed' : 'Keep watch here'}; Tab skips the unit until an enemy comes within ${SENTRY.radius} tiles (W)">👁 ${heal ? 'Rest until healed' : 'Sentry'}</button>`;
    }
    if (u.owner === 0 && !busy() && canFortify(state, u)) {
      html += `<button data-fortify class="secondary wide-btn" title="Dig in: +${Math.round(FORTIFY.defBonus * 100)} % defense, ends the unit's turn (F)">⛨ Fortify</button>`;
    }
    if (u.owner === 0 && !busy() && state.current === 0) {
      const partners = swapPartners(state, u);
      if (swapPick === u.id) {
        html += '<p class="order">⇄ Tap a unit with a blue ring to swap places</p><button data-swap class="secondary wide-btn">✖ Cancel swap</button>';
      } else if (partners.length) {
        html += `<button data-swap class="secondary wide-btn" title="Trade tiles with a neighbouring unit of yours – both use one step (S)">⇄ Swap places${partners.length === 1 ? ` with ${UNIT_TYPES[partners[0].type].name}` : ''}</button>`;
      }
    }
    const ups = u.owner === 0 && !busy() ? upgradeOptions(state, u) : [];
    if (ups.length) {
      html += '<h4>Upgrade</h4><div class="buy">';
      for (const o of ups) {
        const nt = UNIT_TYPES[o.type];
        html += `<button data-upgrade="${o.type}" class="secondary" ${o.affordable ? '' : 'disabled'} title="Keeps rank and HP share, ends the unit's turn"><span>⇧ ${nt.name}</span><small>${o.cost} gold</small><small class="desc">HP ${nt.hp} · Attack ${nt.atk} · Defense ${nt.def} · Move ${nt.move}${nt.range > 1 ? ` · Range ${nt.range}` : ''}</small></button>`;
      }
      html += '</div>';
    }
    if (u.owner === 0 && !busy() && canDisband(state, u)) {
      const refund = disbandRefund(state, u);
      const gain = refund ? ` (+${refund} gold)` : '';
      html += disbandArmed === u.id
        ? `<button data-disband class="wide-btn disband armed" title="Press again to dismiss the unit for good (D)">✖ Really disband?${gain}</button>`
        : `<button data-disband class="secondary wide-btn disband" title="${refund ? `Dismiss the unit; in your city it returns ${refund} gold` : 'Dismiss the unit (no gold outside your cities)'} (D)">✖ Disband${gain}</button>`;
    }
  }
  if (city) {
    const owner = city.owner === null ? 'neutral' : PLAYERS[city.owner].name;
    const ci = cityInfo(state, city);
    html += `<h3>${city.name}</h3><p>Owner: ${owner}${city.capital ? ' · capital' : ''}</p>
      <p>Income +${ci.income} gold/turn · Garrison defense +${ci.defensePct} % · Healing +${ci.heal}</p>
      <p class="growth">${sizeText(city)}</p>`;
    if (city.owner === 0 && unrestText(state, city)) html += `<p class="unrest">✊ ${unrestText(state, city)}</p>`;
    if (city.owner === 0) html += `<p class="trade ${tradeRoute(state, city)}">🛤 ${tradeText(state, city)}</p>`;
    if (city.owner === 0 && (state.current !== 0 || busy())) html += `<p class="focus">${focusText(city)}</p>`;
    if (city.owner === 0 && city.order && (state.current !== 0 || busy())) html += `<p class="order recruit-order">⏳ ${recruitOrderText(state, city)}</p>`;
    const res = cityResources(state, city).filter((t) => exploredTiles(state, 0).has(key(t.q, t.r)));
    if (res.length) html += `<p class="resource">Resources: ${res.map((t) => RESOURCES[t.resource].name + (isPillaged(state, t) ? ` (🔥 pillaged, ${pillageTurnsLeft(state, t)} more)` : '')).join(', ')}</p>`;
    const built = (city.buildings || []).map((b) => `<span class="building">${BUILDINGS[b].symbol} ${BUILDINGS[b].name}</span>`);
    if (built.length) html += `<p>${built.join(' ')}</p>`;
    if (city.owner === 0 && state.current === 0 && !busy()) {
      const blocked = !!unitAt(state, city.q, city.r);
      const pick = suggestRecruit(state, 0, city);
      html += '<h4>Recruit</h4><div class="buy">';
      for (const [type, t] of Object.entries(UNIT_TYPES)) {
        const cost = unitCost(state, city, type);
        const star = pick && pick.type === type;
        const label = `<span><kbd class="hotkey">${recruitKey(type)}</kbd> ${t.name}${star ? ' <b class="star">★</b>' : ''}</span>`;
        if (blocked || state.gold[0] < cost) {
          // can't recruit now: the button orders the unit for the start of a later turn instead
          const ordered = city.order === type;
          const tip = `${t.desc ? `${t.desc} · ` : ''}${ordered ? 'Ordered – press again to cancel the order'
            : `${blocked ? 'The city is occupied' : 'Not enough gold'} – order it: it is bought at the start of your turn once there is gold and room`} (key ${recruitKey(type)})`;
          html += `<button data-order="${type}" class="order-btn${ordered ? ' ordered' : ''}${star ? ' suggested' : ''}" aria-pressed="${ordered}" title="${tip}">${label} <small>${cost} gold · ⏳ ${ordered ? 'ordered' : 'order'}</small></button>`;
        } else {
          html += `<button data-buy="${type}" ${star ? ' class="suggested"' : ''} title="${t.desc ? `${t.desc} · ` : ''}key ${recruitKey(type)}">${label} <small>${cost} gold</small></button>`;
        }
      }
      html += '</div>';
      if (city.order) html += `<p class="order recruit-order">⏳ ${recruitOrderText(state, city)}</p><button data-order-cancel class="secondary wide-btn">✖ Cancel order</button>`;
      if (pick) html += `<p class="hint suggest">★ Suggested: ${UNIT_TYPES[pick.type].name} – ${pick.reason}.</p>`;
      if (blocked) html += '<p class="hint">The city is occupied – move the unit out first, or ⏳ order a unit for a later turn.</p>';
      html += levyButton(city);
      html += focusPanel(city);
      html += rallyPanel(city);
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
    const road = tile.road ? ` · ${tile.roadBuilt ? 'built road' : 'road'} (move cost ½ along roads)` : '';
    const river = tile.rivers && tile.rivers.length ? ` · river (crossing +${RIVER.crossCost} move, defender +${Math.round(RIVER.defBonus * 100)} %)` : '';
    const high = HIGH_GROUND.terrain.includes(tile.terrain) ? ` · high ground (attack +${Math.round(HIGH_GROUND.atkBonus * 100)} % against units below)` : '';
    const noCharge = CHARGE.blockedBy.includes(tile.terrain) ? ' · no cavalry charge' : '';
    html = `<p>${t.name}${t.passable ? ` · move ${t.cost} · defense +${Math.round(t.defBonus * 100)} %` : ' · impassable'}${high}${noCharge}${road}${river}</p>`;
    if (tile.terrain && t.passable && zocTiles(state, 0).has(key(hover.q, hover.r))) {
      html += '<p class="hint">Enemy zone of control – a unit that steps here must stop</p>';
    }
    if (tile.resource) html += `<p class="resource">${RESOURCES[tile.resource].name}: ${RESOURCES[tile.resource].desc}</p>`;
    if (tile.resource && isPillaged(state, tile)) {
      const n = pillageTurnsLeft(state, tile);
      html += `<p class="pillaged">🔥 Pillaged – out of use, works again in ${n} round${n === 1 ? '' : 's'}${territoryOwner(state, hover.q, hover.r) === 0 ? ` (a unit of yours standing here can repair it for ${REPAIR.gold} gold)` : ''}</p>`;
    }
    if (ruinBelieved(state, hover.q, hover.r, 0)) html += `<p class="resource ruin">Ancient ruins: ${RUINS.desc}</p>`;
    const realm = territoryOwner(state, hover.q, hover.r);
    if (realm !== undefined) {
      const whose = realm === null ? 'neutral territory' : realm === 0 ? 'your territory' : `${PLAYERS[realm].name} territory`;
      html += `<p class="hint">${whose[0].toUpperCase()}${whose.slice(1)} – units resting here heal +${TERRITORY.healIdle} (elsewhere +${ECONOMY.healIdle})</p>`;
    }
    const hc = cityAt(state, hover.q, hover.r);
    if (hc) {
      const ci = cityInfo(state, hc);
      html = `<h3>${hc.name}</h3><p>Income +${ci.income} gold/turn · Garrison defense +${ci.defensePct} % · ${sizeText(hc)}</p>` + html;
    }
  }
  const ghost = !u && !city && hover && lastSeenAt(state, 0, hover.q, hover.r);
  if (ghost) html += `<p class="hint ghost">${lastSeenText(state, ghost)}</p>`;
  if (pending && u) {
    const target = seenUnitAt(pending.q, pending.r);
    if (target && target.owner !== u.owner) {
      const pr = previewAttack(state, u, target);
      html += `<p class="confirm">${attackLabel(u, target, pr)}: −${pr.damage}${pr.kills ? ' (destroys)' : ''}, counter −${pr.counter}.<br>Tap the target again to confirm.</p>`;
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
      <p class="hint">Map ${state.seed} · Difficulty: ${diff.name}${state.fog ? '' : ' · no fog'}${state.happenings ? '' : ' · no random events'}</p>
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
  updateArmy();
  updateAdvisor();
}

// Rally point part of the own city panel.
function rallyPanel(city) {
  let html = '<h4>Rally point</h4>';
  if (rallyPick === city.id) {
    html += '<p class="confirm">🚩 Click the tile where new units from this city should march. Click elsewhere or press Esc to cancel.</p>';
    return `${html}<button data-rally-cancel class="secondary wide-btn">✖ Cancel</button>`;
  }
  if (city.rally) {
    const path = rallyPath(state, city, city.rally.q, city.rally.r);
    const n = path ? path.length - 1 : 0;
    html += `<p class="order">🚩 New units march to the flag ${n} tile${n === 1 ? '' : 's'} away by themselves</p>`;
    return `${html}<div class="row-btns"><button data-rally class="secondary" title="Pick another tile (G)">🚩 Move flag</button><button data-rally-clear class="secondary">✖ Remove</button></div>`;
  }
  html += '<p class="hint">Set a flag and every unit recruited here walks there on its own.</p>';
  return `${html}<button data-rally class="secondary wide-btn" title="Pick a tile on the map (G)">🚩 Set rally point</button>`;
}

// Levy: a free warrior for a size of the city (L). Disabled with the reason when not possible.
function levyButton(city) {
  if ((city.size || 1) < LEVY.minSize) return ''; // a small city can't levy – no need to show it
  const why = levyProblem(state, city);
  const name = UNIT_TYPES[LEVY.type].name;
  const tip = why ? `Can't levy: ${why}` : `A free ${name} now – the city drops to size ${Math.max(1, city.size - LEVY.sizeCost)} and starts growing anew (L)`;
  return `<button data-levy class="secondary wide-btn levy" ${why ? 'disabled' : ''} title="${tip}">⚑ Levy ${name} <small>free · −${LEVY.sizeCost} size</small></button>`
    + (why === 'the city is in unrest' ? `<p class="hint levy-why">Levy: ${why}.</p>` : '');
}

// Levies a warrior in the selected own city (panel button / L).
function levySelected() {
  if (busy() || !selectedCityId || state.current !== 0) return;
  if (levy(state, selectedCityId)) { undoStack = []; sound.play('recruit'); afterAction(); }
}

// City focus: one button per kind, the current one pressed (C cycles through them).
function focusPanel(city) {
  const now = focusOf(city);
  let html = '<h4>Focus</h4><div class="focus-btns">';
  for (const [id, f] of Object.entries(FOCUS.kinds)) {
    html += `<button data-focus="${id}" class="secondary${id === now ? ' on' : ''}" aria-pressed="${id === now}" title="${f.name}: ${f.desc} (C)">${f.icon} ${f.name}</button>`;
  }
  return `${html}</div><p class="hint focus">${focusText(city)}</p>`;
}

// Sets the selected own city's focus (panel button), or with no id moves on to the next kind (C).
function focusSelected(id = null) {
  const city = state.cities.find((c) => c.id === selectedCityId);
  if (!city || city.owner !== 0 || state.current !== 0 || busy()) return;
  const ids = Object.keys(FOCUS.kinds);
  const next = id || ids[(ids.indexOf(focusOf(city)) + 1) % ids.length];
  if (setFocus(state, city.id, next)) { undoStack = []; drainEvents(state); sound.play('click'); save(); }
  draw();
}

// Starts picking the rally point of the selected own city (G / panel button); pressing again cancels.
function startRallyPick() {
  if (busy() || state.winner !== null || state.current !== 0) return;
  const city = state.cities.find((c) => c.id === selectedCityId);
  if (!city || city.owner !== 0) return;
  rallyPick = rallyPick === city.id ? null : city.id;
  swapPick = null;
  pending = null;
  sound.play('click');
  draw();
}

// Starts picking a neighbour to swap places with (S / panel button). With a single partner it swaps at
// once; pressing again cancels the picking.
function startSwapPick() {
  if (busy() || state.winner !== null || state.current !== 0) return;
  const u = selectedUnit();
  if (swapPick !== null) { swapPick = null; draw(); return; }
  if (!u || u.owner !== 0) return;
  const partners = swapPartners(state, u);
  if (!partners.length) return;
  rallyPick = null;
  pending = null;
  if (partners.length === 1) { doSwap(u.id, partners[0].id); return; }
  swapPick = u.id;
  sound.play('click');
  draw();
}

// Swaps two own units; undoable like a move. The selection stays on the unit that asked for the swap.
function doSwap(unitId, otherId) {
  const before = cloneState(state);
  if (!swapUnits(state, unitId, otherId)) { draw(); return; }
  if (isUndoableMove(before, state, state.events, 0)) undoStack.push(cloneState(before));
  else undoStack = [];
  const u = getUnit(state, unitId);
  const c = cityAt(state, u.q, u.r);
  selectedCityId = c ? c.id : null;
  afterAction(before);
}

let armyKey = '';

// Army panel: every own unit with its status and place; a click selects it. The summary line shows the
// counts even while the panel is closed. Redrawn only on change (updateHud runs on every mouse move).
function updateArmy() {
  const { rows, counts } = armyOverview(state, 0);
  const sum = rows.length ? `${rows.length} unit${rows.length === 1 ? '' : 's'}${counts.ready ? ` · ${counts.ready} ready` : ''}` : 'no units';
  const k = `${$('army-panel').open}:${selectedId}:${busy()}:${JSON.stringify(rows)}`;
  if (k === armyKey) return;
  armyKey = k;
  $('army-count').textContent = sum;
  // a closed panel keeps no rows, so reopening never shows a stale list before the toggle redraw
  if (!$('army-panel').open) { $('army').innerHTML = ''; return; }
  if (!rows.length) { $('army').innerHTML = '<li class="hint">You have no units. Recruit in a city.</li>'; return; }
  $('army').innerHTML = rows.map((r) => {
    const rank = RANKS[r.rank].symbol ? ` ${RANKS[r.rank].symbol}` : '';
    const hurt = r.hp < r.maxHp ? ' hurt' : '';
    return `<li><button type="button" data-army="${r.id}" class="army-row ${r.status}${r.id === selectedId ? ' sel' : ''}"
      aria-pressed="${r.id === selectedId}" ${busy() ? 'disabled' : ''}>
      <span class="sym">${r.symbol}</span>
      <span class="nm">${r.hero ? `${esc(r.hero)} <small class="ty">${r.name}</small>` : r.name}${rank}<small>${r.where}${r.kills ? ` · ${r.kills} ⚔` : ''}</small></span>
      <span class="hp${hurt}">${r.hp}/${r.maxHp}</span>
      <span class="st">${ARMY_STATUS[r.status].label}</span></button></li>`;
  }).join('');
}

let advisorKey = '';

// Advisor panel: hints for this turn. Recomputed only when the game changes (updateHud runs often).
function updateAdvisor() {
  const open = $('advisor-panel').open;
  const k = `${open}:${busy()}:${state.turn}:${state.current}:${state.winner}:${state.gold[0]}:${JSON.stringify(state.units)}:${JSON.stringify(state.cities)}`;
  if (k === advisorKey) return;
  advisorKey = k;
  const tips = busy() ? [] : adviseTurn(state, 0);
  $('advisor-count').textContent = busy() || state.current !== 0 || state.winner !== null ? '' : tips.length ? `${tips.length} hint${tips.length === 1 ? '' : 's'}` : 'nothing urgent';
  if (!open) { $('advisor').innerHTML = ''; return; }
  if (!tips.length) {
    const why = state.winner !== null ? 'The game is over.' : busy() || state.current !== 0 ? 'Waiting for your turn…' : 'Nothing urgent – carry on with your plan.';
    $('advisor').innerHTML = `<li class="hint">${why}</li>`;
    return;
  }
  $('advisor').innerHTML = tips.map((t) => `<li><button type="button" class="tip-row ${t.kind}" data-tip-q="${t.q}" data-tip-r="${t.r}"
    ${t.unitId ? `data-tip-unit="${t.unitId}"` : ''} ${t.cityId ? `data-tip-city="${t.cityId}"` : ''}><span class="ic">${t.icon}</span><span>${esc(t.text)}</span></button></li>`).join('');
}

// A hint was clicked: select its unit or city (or just show its tile) and bring it into view.
function selectFromTip(btn) {
  if (busy()) return;
  const unitId = Number(btn.dataset.tipUnit) || null;
  const cityId = Number(btn.dataset.tipCity) || null;
  if (unitId) { selectFromArmy(unitId); return; }
  pending = null;
  rallyPick = null;
  swapPick = null;
  const city = cityId ? state.cities.find((c) => c.id === cityId) : null;
  const q = Number(btn.dataset.tipQ);
  const r = Number(btn.dataset.tipR);
  const u = unitAt(state, q, r);
  selectedId = u && u.owner === 0 ? u.id : null;
  selectedCityId = city ? city.id : null;
  sound.play('click');
  draw();
  bringIntoView(q, r);
}

// Selects a unit from the army list and brings it into view (also inside the zoomed map on a phone).
function selectFromArmy(id) {
  const u = getUnit(state, id);
  if (busy() || !u || u.owner !== 0) return;
  pending = null;
  rallyPick = null;
  swapPick = null;
  selectedId = u.id;
  const city = cityAt(state, u.q, u.r);
  selectedCityId = city ? city.id : null;
  sound.play('click');
  draw();
  bringIntoView(u.q, u.r);
}

// Scrolls the zoomed map (phone) to a tile and the page to the map if it is off screen.
function bringIntoView(q, r) {
  const wrap = canvas.parentElement;
  if (wrap.classList.contains('zoomed')) {
    const c = tileCenter(q, r);
    const k = canvas.clientWidth / canvasSize(state).w;
    wrap.scrollTo({ left: c.x * k - wrap.clientWidth / 2, top: c.y * k - wrap.clientHeight / 2 });
  }
  const rect = canvas.getBoundingClientRect();
  if (rect.bottom < 0 || rect.top > window.innerHeight) wrap.scrollIntoView({ block: 'nearest' });
}

let statsShownForEnd = false;
let statsKey = '';

// Statistics panel: power chart and summary. Redrawn only on change (updateHud runs often).
function updateStats() {
  if (!$('stats-panel').open) return;
  const h = state.history || [];
  const hall = hallOfFameHtml(state);
  const marks = timelineFor(state, 0);
  const key = `${h.length}:${state.winner}:${JSON.stringify(state.stats)}:${h.length ? h[h.length - 1].power : ''}:${hall}:${marks.length}`;
  if (key === statsKey) return;
  statsKey = key;
  if (h.length < 2) {
    $('stats').innerHTML = '<p class="hint">The chart appears after a few turns.</p>';
    return;
  }
  const rows = summaryRows(state).map(([label, a, b]) => `<tr><th>${label}</th><td>${a}</td><td>${b}</td></tr>`).join('');
  $('stats').innerHTML = '<h4>Army strength</h4>' + chartSvg(h, { title: 'Army strength over time', marks })
    + '<h4>Cities</h4>' + chartSvg(h, { metric: 'cities', height: 110, title: 'Cities' })
    + `<table class="stats-table"><tr><th></th><th>${PLAYERS[0].name}</th><th>${PLAYERS[1].name}</th></tr>${rows}</table>`
    + '<h4>War timeline</h4>' + timelineHtml(state, 0)
    + '<h4>Hall of fame</h4>' + hall;
  // the newest turning point is the interesting one – show the end of a long timeline
  const tl = $('stats').querySelector('.timeline');
  if (tl) tl.scrollTop = tl.scrollHeight;
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
  const act = decideTap(state, { selectedId, pending, viewer: 0, confirm: touch, rallyCityId: rallyPick, swapUnitId: swapPick }, hex.q, hex.r);
  pending = null;
  if (act.type === 'none') return;
  if (act.type === 'swap' || act.type === 'swapCancel') {
    swapPick = null;
    if (touch) hover = null;
    if (act.type === 'swap') doSwap(act.unitId, act.otherId);
    else draw();
    return;
  }
  if (act.type === 'rally' || act.type === 'rallyCancel') {
    if (act.type === 'rally' && setRally(state, act.cityId, act.q, act.r)) { sound.play('fortify'); save(); }
    rallyPick = null;
    swapPick = null;
    if (touch) hover = null;
    draw();
    return;
  }
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
    tip.textContent = `${attackLabel(sel, target, p)}: −${p.damage}${p.kills ? ' (destroys)' : ''}, counter −${p.counter}`;
    placeTip(tip, ev);
  } else if (target) {
    // any visible unit: its stats; a city under it gets a second line
    const lines = [unitTipText(target)];
    const city = cityAt(state, hex.q, hex.r);
    if (city) lines.push(cityTipText(city));
    tip.textContent = lines.join('\n');
    placeTip(tip, ev);
  } else if (hex && lastSeenAt(state, 0, hex.q, hex.r) && !busy()) {
    tip.textContent = lastSeenText(state, lastSeenAt(state, 0, hex.q, hex.r));
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
  const tags = [s.rank !== RANKS[0].name ? s.rank : '', s.fortified ? 'fortified' : '', s.forcedMarch ? 'forced march' : '', s.hitAndRun ? 'hit and run' : '', s.pursuit ? 'can pursue' : '', s.marching ? 'marching' : '', s.exploring ? 'exploring' : '', s.sentry && s.owner === 0 ? (s.sentry === 'heal' ? 'resting' : 'on watch') : ''].filter(Boolean);
  if (s.kills) tags.push(`${s.kills} kill${s.kills === 1 ? '' : 's'}`);
  return `${PLAYERS[s.owner].name}: ${s.hero ? `${s.hero} the ${s.name}` : s.name}${tags.length ? ` (${tags.join(', ')})` : ''} · HP ${s.hp}/${s.maxHp}\n`
    + `Attack ${fmt(s.attack)} · Defense ${fmt(s.defense)}${s.notes.length ? ` (${s.notes.join(', ')})` : ''} · Range ${s.range} · Move ${s.move}`;
}

function cityTipText(city) {
  const ci = cityInfo(state, city);
  const owner = city.owner === null ? 'neutral' : PLAYERS[city.owner].name;
  const gar = ci.garrison ? UNIT_TYPES[ci.garrison.type].name : 'no garrison';
  const bs = (city.buildings || []).map((b) => BUILDINGS[b].name).join(', ');
  return `${city.name} (${owner}): +${ci.income} gold/turn · defense +${ci.defensePct} % · ${gar}${bs ? ` · ${bs}` : ''}\n${sizeText(city)}${city.owner === 0 ? `\n${tradeText(state, city)}` : ''}${city.owner === 0 && unrestText(state, city) ? `\n${unrestText(state, city)}` : ''}${city.owner === 0 ? `\n${focusText(city)}` : ''}${city.owner === 0 && city.order ? `\n⏳ ${recruitOrderText(state, city)}` : ''}`;
}

// City size line: own cities also show their growth progress; for others (the AI's progress is
// hidden in the fog) only the size is shown.
function sizeText(city) {
  return city.owner === 0 ? growthText(state, city) : growthText(state, city).split(' · ')[0];
}

// After a player action: save and replay what happened (before = state before the action).
async function afterAction(before = null) {
  const events = drainEvents(state);
  updateSightings(state, 0, events);
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
  rallyPick = null;
  swapPick = null;
  $('tooltip').hidden = true;
  pending = null;
  showNotice([]);
  undoStack = [];
  const beforeEnd = cloneState(state);
  endTurn(state);
  const volleys = drainEvents(state).filter((e) => e.type === 'volley'); // the player's walls shoot
  aiRunning = true;
  save();
  draw();
  setTimeout(async () => {
    if (volleys.length) await anim.play(beforeEnd, volleys);
    const before = cloneState(state);
    runAITurn(state);
    const events = drainEvents(state);
    if (state.winner === null) endTurn(state);
    const ended = drainEvents(state);
    const happened = ended.filter((e) => e.type === 'happening' && e.player === 0);
    const grew = ended.filter((e) => e.type === 'grow' && e.player === 0)
      .map((e) => `${state.cities.find((c) => c.id === e.cityId).name} grew to size ${e.size} (+1 gold).`);
    grew.push(...ended.filter((e) => e.type === 'order' && e.player === 0)
      .map((e) => `${UNIT_TYPES[e.unitType].name} recruited in ${state.cities.find((c) => c.id === e.cityId).name} as ordered (−${e.cost} gold).`));
    grew.push(...ended.filter((e) => e.type === 'calm' && e.player === 0)
      .map((e) => `${state.cities.find((c) => c.id === e.cityId).name} has accepted your rule and pays taxes again.`));
    events.push(...ended.filter((e) => e.type === 'volley')); // the AI's walls shoot at the end of its turn
    // the report must be made before the animation, which plays the events on top of `before`
    const report = state.winner === null ? turnReport(before, events, 0) : null;
    updateSightings(state, 0, events);
    save();
    await anim.play(before, events);
    // the player's units with move orders walk on
    const beforeOrders = cloneState(state);
    const orders = state.winner === null && state.current === 0 ? runOrders(state, 0) : [];
    const walked = drainEvents(state);
    updateSightings(state, 0, walked);
    save();
    if (walked.length) await anim.play(beforeOrders, walked);
    aiRunning = false;
    const stopped = orders.filter((o) => ['interrupted', 'blocked', 'done', 'alert', 'healed'].includes(o.result))
      .map((o) => orderText(getUnit(state, o.unitId), o.result));
    showNotice(happened, [...grew, ...stopped], report);
    draw();
  }, 250);
}

// Why a move order stopped, for the banner.
function orderText(unit, result) {
  const name = unit ? UNIT_TYPES[unit.type].name : 'A unit';
  if (result === 'done') return `${name} has explored all the land it can reach.`;
  if (result === 'alert') return `${name} on watch spotted an enemy nearby.`;
  if (result === 'healed') return `${name} is fully healed and ready.`;
  return result === 'interrupted' ? `${name} stopped its march: enemy in sight.` : `${name} can't get through – order cancelled.`;
}

// Banner at the start of the player's turn (cleared at the next end of turn): a random event that hit
// the player, what the enemy did to them (report from turnReport) and further messages (stopped move orders).
function showNotice(happened, extra = [], report = null) {
  const el = $('notice');
  if (report) lossMarks = report.spots;
  else if (!happened.length && !extra.length) lossMarks = []; // cleared together with the banner
  const ev = happened[0];
  const parts = [];
  let good = false;
  if (ev) {
    parts.push(happeningText(ev));
    good = ev.kind === 'harvest' || ev.suppressed;
  }
  const rep = report ? reportText(report) : '';
  if (rep) {
    parts.push(rep);
    if (reportIsBad(report)) good = false;
  }
  parts.push(...extra);
  if (!parts.length) { el.hidden = true; return; }
  el.textContent = parts.join(' ');
  el.className = good || (!ev && !extra.length && rep && !reportIsBad(report)) ? 'good' : 'bad';
  el.hidden = false;
  if (ev) sound.play(soundFor(ev, 0));
}

function happeningText(ev) {
  const city = state.cities.find((c) => c.id === ev.cityId);
  const name = HAPPENINGS.kinds[ev.kind].name;
  const place = city ? ` in ${city.name}` : '';
  let text = `${name}${place}`;
  if (ev.kind === 'harvest') text += `: +${ev.gold} gold.`;
  else if (ev.kind === 'plague' && ev.suppressed) text += ', but the infirmary contained it.';
  else if (ev.kind === 'plague') text += ev.hits.length ? `: infected units lost HP (${ev.hits.length}).` : ', but no unit was nearby.';
  else if (ev.suppressed) text += ev.reason === 'temple' ? ', but the temple kept the peace.' : ', but the garrison kept order.';
  else text += `: the city paid no taxes this turn (${ev.gold} gold).`;
  return text;
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
  form.elements.seed.value = '';
  $('seed-current').textContent = `This map: ${state.seed}`;
  dlg.showModal();
}

function startNewGame(options) {
  state = createGame({ ...options, seed: options.seed ?? randomSeed() });
  updateSightings(state, 0);
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
  startNewGame({ ...options, seed: parseSeed(form.elements.seed.value).seed });
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
  updateSightings(state, 0);
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
$('banner-again').addEventListener('click', () => { if (!busy()) startNewGame(restartOptions(state)); });
$('seed-current').addEventListener('click', () => { $('seed-input').value = String(state.seed); });
$('stats-panel').addEventListener('toggle', () => { statsKey = ''; updateStats(); });
$('next-unit').addEventListener('click', selectNextUnit);
$('army-panel').addEventListener('toggle', () => { armyKey = ''; updateArmy(); });
$('advisor-panel').addEventListener('toggle', () => {
  advisorKey = '';
  savePrefs({ ...loadPrefs(), advisor: $('advisor-panel').open });
  updateAdvisor();
});
$('advisor').addEventListener('click', (ev) => {
  const tip = ev.target.closest('button[data-tip-q]');
  if (tip) selectFromTip(tip);
});
$('army').addEventListener('click', (ev) => {
  const row = ev.target.closest('button[data-army]');
  if (row) selectFromArmy(Number(row.dataset.army));
});
$('info').addEventListener('click', (ev) => {
  if (ev.target.closest('button[data-undo]')) { undoMove(); return; }
  if (ev.target.closest('button[data-rally]')) { startRallyPick(); return; }
  if (ev.target.closest('button[data-rally-cancel]')) { rallyPick = null; draw(); return; }
  if (ev.target.closest('button[data-rally-clear]')) {
    if (!busy() && clearRally(state, selectedCityId)) { sound.play('click'); save(); }
    draw();
    return;
  }
  const fBtn = ev.target.closest('button[data-focus]');
  if (fBtn) { focusSelected(fBtn.dataset.focus); return; }
  if (ev.target.closest('button[data-levy]')) { levySelected(); return; }
  const oBtn = ev.target.closest('button[data-order]');
  if (oBtn) { recruitOrderSelected(oBtn.dataset.order); return; }
  if (ev.target.closest('button[data-order-cancel]')) {
    if (!busy() && clearRecruitOrder(state, selectedCityId)) { sound.play('click'); save(); }
    draw();
    return;
  }
  if (ev.target.closest('button[data-swap]')) { startSwapPick(); return; }
  if (ev.target.closest('button[data-fortify]')) { fortifySelected(); return; }
  if (ev.target.closest('button[data-march]')) { marchSelected(); return; }
  if (ev.target.closest('button[data-explore]')) { exploreSelected(); return; }
  if (ev.target.closest('button[data-sentry]')) { sentrySelected(); return; }
  if (ev.target.closest('button[data-pillage]')) { pillageSelected(); return; }
  if (ev.target.closest('button[data-repair]')) { repairSelected(); return; }
  if (ev.target.closest('button[data-road]')) { roadSelected(); return; }
  if (ev.target.closest('button[data-disband]')) { disbandSelected(); return; }
  const uBtn = ev.target.closest('button[data-upgrade]');
  if (uBtn) { upgradeSelected(uBtn.dataset.upgrade); return; }
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
  else if (act.type === 'march') marchSelected();
  else if (act.type === 'explore') exploreSelected();
  else if (act.type === 'sentry') sentrySelected();
  else if (act.type === 'pillage') pillageSelected();
  else if (act.type === 'repair') repairSelected();
  else if (act.type === 'road') roadSelected();
  else if (act.type === 'disband') disbandSelected();
  else if (act.type === 'recruit') recruitSelected(act.unitType);
  else if (act.type === 'help') $('keys-dialog').showModal();
  else if (act.type === 'threats') toggleThreats();
  else if (act.type === 'animSpeed') cycleAnimSpeed();
  else if (act.type === 'rally') startRallyPick();
  else if (act.type === 'focus') focusSelected();
  else if (act.type === 'levy') levySelected();
  else if (act.type === 'swap') startSwapPick();
  else if (act.type === 'escape') {
    if (busy()) { anim.skip(); return; }
    if (swapPick !== null) { swapPick = null; draw(); return; }
    if (rallyPick !== null) { rallyPick = null; draw(); return; }
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
$('advisor-panel').open = loadPrefs().advisor !== false; // the advisor can be collapsed for good

// Animation speed (A / header button): normal → fast → off; remembered in the preferences.
function cycleAnimSpeed() {
  animSpeed = nextAnimSpeed(animSpeed.id);
  anim.speed = animSpeed.mult;
  if (!animSpeed.mult) anim.skip(); // turning animations off also finishes the one running
  savePrefs({ ...loadPrefs(), animSpeed: animSpeed.id });
  updateAnimButton();
}

function updateAnimButton() {
  const b = $('anim-speed');
  b.textContent = animSpeed.icon;
  b.setAttribute('aria-pressed', String(animSpeed.mult > 0));
  b.title = `Animations: ${animSpeed.label} (click or A to change)`;
}
$('anim-speed').addEventListener('click', cycleAnimSpeed);
updateAnimButton();

// Recruits in the selected own city (number keys and the panel buttons).
function recruitSelected(type) {
  if (busy() || !selectedCityId) return;
  if (buyUnit(state, selectedCityId, type)) { undoStack = []; sound.play('recruit'); afterAction(); return; }
  const city = state.cities.find((c) => c.id === selectedCityId);
  if (city && city.order !== type) recruitOrderSelected(type); // can't buy it now: order it instead
}

// Orders a unit in the selected own city for a later turn; ordering the same type again cancels it.
function recruitOrderSelected(type) {
  if (busy() || !selectedCityId || state.current !== 0) return;
  const city = state.cities.find((c) => c.id === selectedCityId);
  if (!city) return;
  const changed = city.order === type ? clearRecruitOrder(state, city.id) : setRecruitOrder(state, city.id, type);
  if (changed) { sound.play('click'); save(); }
  draw();
}

// Selects the next unit that can still act (Tab / button).
function selectNextUnit() {
  if (busy() || state.winner !== null) return;
  pending = null;
  rallyPick = null;
  swapPick = null;
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

// Forced march for the selected unit (M / button in the panel): it stays selected with its larger reach.
function marchSelected() {
  if (busy() || state.winner !== null) return;
  const u = selectedUnit();
  if (!u || u.owner !== 0 || !forceMarch(state, u.id)) return;
  undoStack = [];
  afterAction(null); // the HP loss shows at once; a floater would only repeat the panel
  sound.play('step');
}

// Puts the selected unit on watch (W / button in the panel) and moves on to the next unit that can act.
function sentrySelected() {
  if (busy() || state.winner !== null) return;
  const u = selectedUnit();
  if (!u || u.owner !== 0 || !sentry(state, u.id)) return;
  save();
  sound.play('fortify');
  selectNextUnit();
}

// Pillages the enemy resource under the selected unit (P / button in the panel), animated.
function pillageSelected() {
  if (busy() || state.winner !== null) return;
  const u = selectedUnit();
  if (!u || u.owner !== 0 || !canPillage(state, u)) return;
  const before = cloneState(state);
  pillage(state, u.id);
  undoStack = [];
  afterAction(before);
}

// Repairs the own pillaged resource under the selected unit (R / button in the panel), animated.
function repairSelected() {
  if (busy() || state.winner !== null) return;
  const u = selectedUnit();
  if (!u || u.owner !== 0 || !canRepair(state, u)) return;
  const before = cloneState(state);
  repair(state, u.id);
  undoStack = [];
  afterAction(before);
}

// Lays a road under the selected unit (B / button in the panel).
function roadSelected() {
  if (busy() || state.winner !== null) return;
  const u = selectedUnit();
  if (!u || u.owner !== 0 || !canBuildRoad(state, u)) return;
  const before = cloneState(state);
  buildRoad(state, u.id);
  undoStack = [];
  afterAction(before);
}

// Sends the selected unit exploring (X / button in the panel); it walks right away, animated.
function exploreSelected() {
  if (busy() || state.winner !== null) return;
  const u = selectedUnit();
  if (!u || u.owner !== 0 || !canExplore(state, u)) return;
  const before = cloneState(state);
  const result = setExplore(state, u.id);
  undoStack = [];
  if (result === 'interrupted' || result === 'done') showNotice([], [orderText(getUnit(state, u.id), result)]);
  afterAction(before);
}

// Retrains the selected unit into another type (button in the panel); it stays selected.
function upgradeSelected(type) {
  if (busy() || state.winner !== null) return;
  const u = selectedUnit();
  if (!u || u.owner !== 0) return;
  const before = cloneState(state);
  if (!upgradeUnit(state, u.id, type)) return;
  undoStack = [];
  afterAction(before); // the animation shows "⇧ <type>" and plays the sound
}

// Disbands the selected unit (D / panel button). The first press only arms the button, a second press
// within a few seconds on the same unit dismisses it; the city under it stays selected.
function disbandSelected() {
  if (busy() || state.winner !== null) return;
  const u = selectedUnit();
  if (!u || u.owner !== 0 || !canDisband(state, u)) return;
  clearTimeout(disbandArmTimer);
  if (disbandArmed !== u.id) {
    disbandArmed = u.id;
    disbandArmTimer = setTimeout(() => { disbandArmed = null; draw(); }, 4000);
    sound.play('click');
    draw();
    return;
  }
  disbandArmed = null;
  const before = cloneState(state);
  if (disbandUnit(state, u.id) === false) return;
  undoStack = [];
  selectedId = null;
  pending = null;
  afterAction(before); // the animation shows "✖ disbanded" and plays the sound
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
  rallyPicking: () => rallyPick,
  swapPicking: () => swapPick,
  isBusy: busy,
  version: GAME_VERSION,
  setAnimSpeed: (x) => { anim.speed = x; },
  animSpeed: () => ({ id: animSpeed.id, speed: anim.speed }),
  refresh: () => { resize(); draw(); },
  newGame: (seed, options = {}) => { state = createGame({ seed, ...options }); updateSightings(state, 0); undoStack = []; showNotice([]); resize(); draw(); },
  showNotice: (events) => { showNotice(events); draw(); },
  // shows the enemy-turn banner for events made on top of the state `before`
  showReport: (before, events) => { showNotice([], [], turnReport(before, events, 0)); draw(); },
  lossMarks: () => lossMarks,
  ghosts: () => lastSeen(state, 0),
  // recomputes the last-seen markers after a test changed the state directly
  updateSightings: (events = []) => { updateSightings(state, 0, events); draw(); },
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

updateSightings(state, 0);
resize();
draw();
// first visit (no saved game): the new game dialog acts as the main menu
if (!hadSave) newGame({ firstVisit: true });
