# Development log

Newest entry on top. Format: date – what was done – test status – questions for Vladimír.

## 2026-11-09 – Zone of control
- New rule: a unit that steps onto a tile next to an enemy unit **it can see** must stop there (it can still attack); moving away from a starting tile inside the zone is free. Hidden enemies in the fog have no zone, so a unit stopping never reveals anything. `zocTiles(state, player)` in `game.js`; `searchMoves` doesn't expand from zone tiles, so `reachable`, `pathTo`, `moveUnit`, move orders and the AI all follow the rule automatically. Multi-turn routes (`planRoute`) ignore it – orders stop anyway when an enemy comes into sight.
- UI: reachable tiles in the zone get a small red stop sign; the mouse tooltip says "Enemy zone of control – the move ends here", the tile panel mentions it too. Help text updated.
- State: `state.version` 16 (`zoc`); saved games from before continue without the zone so their rules don't change.
- Tests: +2 logic (zone around a visible enemy, no walking past it, path never crosses the zone, leaving is free, moveUnit + attack after stopping; hidden enemy has no zone, migration). Smoke test selects a horseman near an enemy, hovers a stop tile and checks the tooltip (`artifacts/screenshot-zoc.png`).
- Status: `npm run check` green (54 logic tests + smoke).

## 2026-11-09 – Keyboard shortcuts → v0.11.0
- New `src/keys.js`: one `SHORTCUTS` table drives both the key handling (`keyAction`) and the overlay, so they can't disagree. Added to the structure list in `CLAUDE.md`.
- New: number keys 1–5 recruit the matching unit in the selected city (the numbers are shown on the recruit buttons, hidden on touch screens); `?` (or the "⌨ Keyboard shortcuts" button under "How to play") opens a list of all shortcuts, Esc or `?` closes it. Existing keys (Tab, Enter/E, Shift+Enter, F, Z, Esc) now go through the table; shortcuts with Ctrl/Cmd/Alt are left to the browser.
- Tests: +1 logic (every key maps to the right action, recruit numbers match the unit order, no key claimed twice). Smoke test recruits an archer with key 2 and opens/closes the overlay (`artifacts/screenshot-keys.png`).
- Status: `npm run check` green (52 logic tests + smoke).
- Run summary: phase 5 (own improvements) done – map resources, unit tooltip, keyboard shortcuts. Version 0.11.0. Vladimír will merge `dev` later.

## 2026-11-09 – Unit tooltip
- `unitSummary(state, unit)` in `game.js`: name, owner, HP, effective attack (rank) and defense where the unit stands (rank, terrain, own city / walls, fortify), range, move, rank, fortified / marching, plus the reasons for the defense bonus.
- Hovering any visible unit (own or enemy) shows it in the tooltip on two lines; a city under the unit adds a third line with the city summary. The attack preview still takes priority when the selected unit can attack the hovered one. On touch there is no hover – tapping a unit shows it in the panel as before.
- Tests: +1 logic (values match `defenseValue`, rank and fortify raise them, reasons for terrain / city with walls / fortify). Smoke test hovers an own unit and checks the tooltip (`artifacts/screenshot-unit-tip.png`).
- Status: `npm run check` green (51 logic tests + smoke).

## 2026-11-09 – Map resources
- `RESOURCES` in `rules.js`, `placeResources` in `map.js`, `cityResources()` in `game.js`. Two kinds on tiles near cities:
  - **Gold mine** (gold nuggets): +2 gold per turn for the city whose territory it is in (`cityIncome`).
  - **Horses** (horseshoe): horsemen recruited in that city are 4 gold cheaper (`unitCost`, stacks with barracks and the Horde bonus).
- Placement has its own RNG, so terrain, cities, roads and rivers stay the same for all seeds. For fairness both capitals get exactly one gold mine and one pasture 2 tiles away; each neutral city gets one random resource with a 2 in 3 chance, always clearly inside its own territory. Gold prefers hills, horses plains. Resources follow the city, so capturing a city with a mine is worth more.
- UI: marker in the upper right of the tile (only on explored tiles), hover text with the effect, the city panel lists the resources in its territory. Help text updated.
- State: `state.version` 15 (tiles may have `resource`), old maps have none.
- Tests: +1 logic (resources on passable non-city tiles inside some territory, capitals get one of each on all map sizes, determinism, income and horseman discount, migration).
- Status: `npm run check` green (50 logic tests + smoke).

## 2026-11-09 – More buildings (v0.10.0)
- At Vladimír's request, four new city buildings (`BUILDINGS` / `BUILDING_EFFECTS` in `rules.js`):
  - **Watchtower** (15 gold): the city sees 2 tiles farther (`citySight`).
  - **Infirmary** (20 gold): units in the city heal +3 more per turn (`cityHeal`), and plague in that city is contained (no damage).
  - **Temple** (25 gold): +1 gold per turn and the city never revolts, even without a garrison.
  - **Academy** (35 gold): units recruited in the city start with 3 XP, i.e. as Veterans (`spawnUnit` takes the XP, so the spawn event replays exactly).
- Contained plague / revolt events carry `reason` ('infirmary' / 'temple' / 'garrison'); the banner and chronicle say what stopped them.
- Each building has a small marker on the city (tower, sun, red cross, blue star). Help text updated; build buttons are generated from `rules.js` as before.
- AI: after market and barracks, with plenty of gold to spare (cost + 2× reserve) it builds an academy in the capital, temples in other cities and infirmaries. Measured with the temporary AI-vs-AI script (new vs. previous AI, 100 seeds × both sides): 99 of 198 decided games – neutral.
- No state structure change (buildings were already a list per city).
- Tests: +1 logic (sight, income, revolt and plague contained, extra healing, academy recruits are Veterans incl. event replay, cities without an academy recruit Recruits).
- Status: `npm run check` green (49 logic tests + smoke).

## 2026-11-09 – Multi-turn move orders → v0.9.0
- **Question for Vladimír (still open):** more AI opponents / scenarios with their own objectives change the victory rules – say "scenarios yes" or "more AI yes" if you want them. Please also merge `dev` into `main` (v0.9.0).
- `planRoute()` in `game.js`: cheapest route to any known tile using only what the player knows (explored tiles, blocked by enemies the player can see, own units can be walked through) plus the number of turns by the same rules as `reachable()`.
- `setOrder()` stores `unit.goto` and walks right away; `runOrders()` at the start of the player's turn walks each ordered unit to the farthest tile of the route reachable this turn (`followOrder`). The order ends when the unit arrives; it is cancelled when the way is blocked, when an enemy comes within 2 tiles in sight (before or after the step – the player decides), and by any manual move, attack, fortify or "✖ Cancel order".
- UI: hovering a known tile out of reach shows a dashed route with a "N turns" badge, a click (on touch: tap twice) gives the order. A far own city is still selected on click (recruiting); foreign cities can be marched to. The selected unit's current order is drawn faintly, the panel shows "➜ Marching to a target · N turns". Stopped orders are announced in the banner under the header. Help text updated.
- State: `state.version` 14 (optional `unit.goto`).
- Tests: +3 logic (route along neighbouring tiles, the turn estimate matches the real march over several turns, arrival clears the order; interruption by an enemy, cancelling by a manual move and `cancelOrder`, no route through unexplored tiles; tap → goto with touch confirmation, own vs. foreign city). Smoke test hovers a 3-turn target (`artifacts/screenshot-order.png`), gives the order by click and checks the unit walks on after the AI turn.
- Status: `npm run check` green (48 logic tests + smoke).
- Run summary: phase 4 (own improvements) is done – fortify, end-turn reminder, city borders, move orders. Version 0.9.0.

## 2026-11-09 – City borders and territory
- `territoryMap()` / `territoryOwner()` in `game.js`, `TERRITORY` in `rules.js`: every non-water tile up to 2 tiles from a city belongs to the nearest city (ties → lower city id). It only depends on city positions; the owner follows the city.
- Gameplay: a unit resting (not moved) in its own territory outside a city heals +2 instead of +1 (`endTurn`). Small, symmetric, gives borders a purpose and makes falling back home worthwhile; the AI's retreat logic benefits automatically.
- Drawing (`drawBorders` in `render.js`): a light tint of the owner's colour over the realm and a dashed border on edges towards another owner or no territory; neutral cities get a pale dashed border without tint. Dashes so borders can't be mistaken for rivers (solid double lines). Hovering a tile tells whose territory it is and the healing rule. Help text updated.
- No state change (computed from city positions).
- Tests: +1 logic (radius, no water, nearest city, coverage on all map sizes, owner follows the city, healing in vs. outside territory).
- Status: `npm run check` green (45 logic tests + smoke).

## 2026-11-09 – End-turn reminder
- `activeUnits(state, player)` in `game.js` (units that can still move or attack, fortified ones excluded); `nextActiveUnit` now uses it, so Tab and the reminder always agree.
- The "End turn" button shows how many units can still act ("End turn · 3"). With idle units the first press (or Enter) only arms it – the button turns orange and reads "Really end?" for 4 s; a second press ends the turn. Shift+Enter ends right away. Fortify a unit (F) to stop being reminded about it.
- Test hook: `window.__game.endTurn()` still ends immediately, `pressEndTurn()` behaves like the button.
- Tests: +1 logic (active units with moves / possible attack / exhausted / fortified, other player's units). Smoke test checks the counter, that the first click only arms the button, and that the second click ends the turn.
- Status: `npm run check` green (44 logic tests + smoke).

## 2026-11-09 – Fortify
- `fortify()` / `canFortify()` in `game.js`, `FORTIFY` in `rules.js`: a unit of the current player that hasn't moved or attacked this turn can dig in. It ends its turn and gets +25 % defense (`defenseValue`) until it moves or attacks; the bonus lasts across turns. Attacking drops the fortification *before* the fight, so it never helps the attacker's counter defense.
- Tab (`nextActiveUnit`) skips fortified units, like sleeping units in other strategy games; clicking still selects them.
- AI: a garrison with nothing to attack fortifies (`holdCity`). Measured with a temporary script (not in the repo), AI with fortify vs. AI without, 100 seeds × both sides: 103 of 199 decided games – neutral, kept for its flavour and so the player sees the AI holding cities.
- UI: "⛨ Fortify" button in the unit panel and key F (then the next unit is selected), small shield next to fortified units, panel line "Fortified …", floater "⛨ fortified" when an AI fortify is visible, synthesized sound `fortify`. Fortifying in the fog is not animated or heard. Help text updated.
- State: `state.version` 13 (optional `unit.fortified`), old saves migrate without change.
- Tests: +2 logic (bonus value, ends the turn, persists, broken by moving and attacking, Tab skips, only current player, event replay, migration; AI garrison digs in). The replay snapshot now includes `fortified`. Smoke test fortifies via the button and the F key (`artifacts/screenshot-fortify.png`).
- Status: `npm run check` green (43 logic tests + smoke).

## 2026-11-09 – Project translated to English (v0.8.0)
- At Vladimír's request the whole project is now in English: in-game texts (UI, help, chronicle, unit/terrain/faction/building names, city names), code comments, test names and messages, and all docs (`CLAUDE.md`, `RULES.md`, `ROADMAP.md`, `LOG.md` incl. history, `README.md`). From now on commits, log entries and reports are in English too.
- Game renamed to **Hex Realm**. Unit symbols on the map are now English initials (W/A/H/S/C). Numbers are formatted with `en-US` (decimal dot).
- No logic or state structure changed (`state.version` stays 12). Saved games keep their old Czech city names and chronicle entries – they are plain strings stored in the save; a new game is fully English.
- Tests: string assertions updated to the English texts (logic test: 'promoted', 'recruited', 'destroyed'; smoke: 'gold/turn', 'Plague', 'river').
- Status: `npm run check` green (41 logic tests + smoke).

## 2026-11-09 – Undo move (v0.7.0)
- **Question for Vladimír (still open):** You answered the question about more AI opponents / scenarios with their own objectives with "no preference" – I take that as no approval yet and am not working on them. Just write "scenarios yes" or "more AI yes".
- The Z key or the "↶ Undo move" button in the panel undoes the last move. Several moves in a row can be undone, but only plain moves that revealed nothing to the player (`isUndoableMove` in `game.js`): no conquest or other event, no newly explored tile, and no foreign unit or foreign city on newly visible tiles. An attack, recruiting, building, a revealing move and ending the turn clear the stack.
- The stack lives only in memory (`main.js`), the game state doesn't change, `state.version` stays 12. Watch out for a trap: the animation plays events directly on top of the "before action" state, so a separate copy of it is stored on the stack (caught by the smoke test).
- "How to play" help updated.
- Tests: +1 logic (a revealing move can't be undone, a move inside explored territory can and the state before it is restored unchanged, a revealed enemy locks the move, conquering a city and attacking can't be undone). The smoke test without fog moves a unit and undoes it with the button and with the Z key (`artifacts/screenshot-undo.png`).
- Status: `npm run check` green (41 logic tests + smoke).

## 2026-11-09 – The chronicle respects the fog of war (v0.6.0)
- **Question for Vladimír (still open):** The remaining phase 3 items – more AI opponents and a campaign/scenarios with their own objectives – change the victory rules, so I won't touch them without your approval (details in the entries below). Also, `dev` has a lot of new stuff since the last merge (v0.4.0–v0.6.0), please merge it into `main`.
- Chronicle entries carry `seen` = the players who saw the action: the originator, the affected player (defender, former owner of a conquered city, owner of a unit hit by plague) and anyone who can see any of the affected tiles at that moment. For combat, visibility is computed before units are lost, so a player always knows about a fallen unit.
- `logFor(state, viewer)` in `game.js` returns the chronicle from a player's point of view; consecutive unseen actions are merged into one line "Enemy actions in the fog of war (N)" (in italics in the UI). Without fog nothing is hidden, and after the game ends everything is revealed. The end of the game is a public entry.
- State structure: `state.version` 12 (optional `seen` on chronicle entries); old entries without `seen` stay public.
- `package-lock.json` had the outdated version 0.4.0 – synced via `npm version`.
- Tests: +1 logic (AI recruiting and building in fog hidden and merged, own actions visible, loss of own unit visible, game end, no fog, migration). The smoke test checks after 5 turns that the chronicle in the UI shows no unseen entry.
- Status: `npm run check` green (40 logic tests + smoke).

## 2026-11-09 – Random events (v0.5.0)
- `HAPPENINGS` in `rules.js`: from round 3, each player has a 15% chance at the start of their turn of an event in a random city of their own:
  - **Bountiful Harvest** (weight 3): +8 gold.
  - **Plague** (weight 2): units in the city and on adjacent tiles (including enemy besiegers) lose 3 HP, but don't die.
  - **Revolt** (weight 2): an ordinary city without its own garrison pays no taxes this turn; with a garrison nothing happens (the capital doesn't revolt). Another reason to keep garrisons in cities.
- `rollHappening()` / `applyHappening()` in `game.js`; the RNG is derived from the seed, round and player, so the state doesn't have to carry generator state and the same game gives the same events. The `happening` event can be replayed (`applyEvent`) and has a sound (new synthesized `boon` / `bane`).
- UI: a bar below the header announces what hit the player at the start of the turn (green = good, red = bad) and disappears at the next end of turn; also an entry in the chronicle ("Plague in the city …" – Czech grammar note, obsolete after translation). The new game dialog has a "Random events" checkbox (remembered); help updated.
- State structure: `state.version` 11 (`happenings`); games in progress from before continue without events so their rules don't change.
- Tests: +2 logic (effect of all three events including a suppressed revolt and the gold cap, event replay; determinism, turning off, no event in round 1, frequency around 15 %, migration). The smoke test triggers a plague and checks the announcement bar (`artifacts/screenshot-happening.png`, width 390 px).
- Status: `npm run check` green (39 logic tests + smoke).

## 2026-11-09 – Rivers (v0.5.0)
- **Question for Vladimír:** I don't have an answer to the question about more AI opponents yet, so I'm not working on it. The next roadmap item "Campaign or scenarios with objectives" would introduce objectives other than conquering all cities (e.g. "hold a city for 15 rounds"), i.e. a change to the victory rules – may I add scenarios with their own objectives as a separate mode alongside the classic game? Until you answer I'm working on my own improvements (written in the roadmap).
- Rivers flow along hex edges (`tile.rivers` = directions to neighbours, stored symmetrically on both tiles). The generator (`buildRivers` in `map.js`) starts a river from Hills/Mountains and runs it "downhill" along edges following the height field until it reaches Water, the edge, another river or the max length. Count: 1 river per ~70 tiles (Small 1, Medium 2, Large 4). Rivers have their own RNG, so terrain, cities and roads stayed the same for all seeds.
- `RIVER` in `rules.js`: crossing costs +1 movement point (`stepCost`), a road on both sides = a bridge with no surcharge. A unit attacked in melee across a river gets +25 % defense (`riverDefense`, only the attacked unit, not the counterattack). The AI takes this into account automatically via `reachable` and `previewAttack`.
- Drawing: a blue double line along the edge, a wooden bridge on roads; darkened in fog. The panel for a tile with a river shows the rules, the attack preview says "Attack across a river". "How to play" help updated.
- State structure: `state.version` 10, old maps load without rivers.
- Tests: +2 logic (rivers symmetric, not over Water, deterministic, enough of them on all sizes; crossing cost, bridge, defender bonus, reach, migration). The smoke test hovers over a river tile on a Large map, checks the description and saves `artifacts/screenshot-rivers.png`.
- Status: `npm run check` green (37 logic tests + smoke).

## 2026-11-08 – Summary of a long run → v0.4.0
- **Question for Vladimír:** The next roadmap task is "More AI opponents". It's a big rework (everything assumes two players) and it changes the victory rules: instead of "the AI loses all its cities" it would be "all opponents lose all their cities". Should the AIs also fight each other, or only you? Until you answer I'm not working on it (RULES.md: changes to victory rules).
- At the request for a "much longer run" I did 10 tasks instead of the usual max 3, each tested and committed separately: AI difficulty, touch controls, buildings, experience, Spearman and Catapult, roads, better AI, factions, main menu with map size, sounds, statistics. Phases 1 and 2 are done; phase 3 has more AI opponents and the campaign left.
- Version 0.4.0 (`state.version` 9). Saved games from all previous versions are converted (migration tests for each step).
- Status: `npm run check` green (35 logic tests + smoke with 10 screenshots in `artifacts/`).

## 2026-11-08 – Statistics and strength chart
- `state.history`: at the start of each round (and at game end) army strength, number of cities and gold of both sides are recorded. `armyPower()` = unit cost weighted by HP and rank.
- `state.stats`: units destroyed and lost, cities conquered.
- New `src/stats.js`: `chartSvg()` produces a line chart as an SVG string (no library), `summaryRows()` a summary table.
- UI: a collapsible "Statistics" panel (can also be opened during the game), opens by itself at game end. The game-over banner shows the round and has a "New game" button. After the game ends, units are no longer drawn as exhausted.
- State structure: `state.version` 9 (`history`, `stats`), old games start collecting statistics from loading.
- Tests: +1 logic (recorded once per round and at game end, destroyed = lost, the winner has conquered cities, chart without NaN even for 0–1 points, migration). The smoke test plays a Small map to the end and checks the banner, the open panel and both charts (`artifacts/screenshot-end.png`).
- Status: `npm run check` green (35 logic tests + smoke).

## 2026-11-08 – Sound effects
- New `src/sound.js`: all sounds are synthesized (oscillators + filtered noise), no recordings or external files. Sounds: step, hit, destruction, promotion, city conquered/lost, building, recruiting, click, victory and defeat jingles.
- `soundFor(event)` maps game events to sounds; the animator has a new `onShow` callback, so only what the player actually sees makes a sound (not AI moves in the fog). A limiter plays the same sound at most once per 90 ms (a skipped animation doesn't trigger a cacophony).
- The `AudioContext` is created only on the first gesture (browser rules); the module can be imported in Node too.
- A ♪ toggle next to the game title; the choice is remembered in localStorage.
- Tests: +1 logic (event mapping, every event from a real game has an existing sound, limiter, playback without AudioContext doesn't crash). The smoke test toggles sound off and back on.
- Status: `npm run check` green (34 logic tests + smoke).

## 2026-11-08 – Main menu and map size
- `MAP_SIZES` in `rules.js`: Small 10×8 (4 cities), Medium 14×10 (6), Large 20×14 (10). `createGame({ size })`.
- On the first visit (no saved game) the new game dialog opens by itself as the main menu (without the game-loss warning). The size options are generated from `rules.js` and remembered.
- The zoomed map on mobile has a natural width based on the map size (CSS variable `--zoom-w`).
- I split the original task "Main menu, choice of map size and number of AIs": more AI opponents is a separate task in the roadmap. The code assumes two players everywhere (turn order, victory, colours, fog, factions), so it needs its own run.
- Tests: +1 logic (all sizes: dimensions, number of cities, connectivity, AI vs AI finishes). The smoke test checks that the menu opens on the first visit (desktop and phone) and saves `screenshot-menu.png` / `screenshot-menu-mobile.png`.
- Status: `npm run check` green (33 logic tests + smoke).

## 2026-11-08 – Factions
- `FACTIONS` in `rules.js` (generic entries, missing = no bonus):
  - **Kingdom**: +1 gold per city, Walls 10 cheaper.
  - **Horde**: Horsemen 4 cheaper and with +1 movement, 5 gold of loot per conquered city.
  - **Forest Folk**: Forest costs 1 movement and gives an extra +25 % defense, Archers 3 cheaper.
- Helpers in `game.js`: `factionOf`, `unitMove`, `buildingCost`, `terrainDefense`; `cityIncome(city, state)` and `stepCost(..., unit)` take the faction into account. **API change:** `unitCost(state, city, type)` (previously `unitCost(city, type)`).
- The player picks a faction in the new game dialog (options generated from `rules.js`), the AI gets a different one based on the seed. The panel shows "You: … · AI: …".
- The AI recruits more of the units its faction gets cheaper and reacts more strongly to visible Horsemen (2 Spearmen per Horseman in the target ratio).
- Balance (temporary script, AI vs AI, 40 seeds × all 6 faction pairings): the Horde with only cheaper Horsemen was at 43 %, with 10 gold loot at 64 %, with 5 gold loot even. Result after all adjustments: Kingdom 56 %, Horde 48 %, Forest Folk 46 % (noise at 160 games is roughly ±4 %).
- State structure: `state.version` 8 (`factions`), old games play without factions.
- Tests: +2 logic (bonuses of each faction including Forest and loot, the AI has a different faction, migration, AI vs AI with all factions).
- Status: `npm run check` green (32 logic tests + smoke). Phases 1 and 2 of the roadmap are done.

## 2026-11-08 – Better AI
- `planStrike()`: the AI tries an attack from every reachable tile and picks the best "move and attack" combination (terrain affects the counterattack).
- Concentration: ranged units and Catapults move first, attack scoring prefers weakened and more expensive targets, so melee finishes off what the ranged units softened up.
- City defense: `assignGarrisons()` – when a visible enemy is within 2 tiles of an own city, a unit stays in it, or the nearest one that can make it goes there. The garrison attacks from the city as usual.
- Retreat: a unit below 25 % HP with an enemy nearby retreats to an own city or as far from enemies as possible, and attacks only on a sure hit.
- Measurement (temporary script, not in the repo): the new AI vs the previous one on 100 seeds × both sides = **118 of 200 wins (59 %)**. Tried and rejected variants: passive garrison (only safe attacks) – much worse (21/60); watching threats within 3 tiles – worse; army cohesion (penalty for exposed tiles) – no effect; retreat from 40 % HP – slightly worse. Hence the chosen thresholds of 2 tiles and 25 %.
- Tests: +3 logic (a threatened empty city gets a garrison and has it after the turn; a badly wounded unit retreats and doesn't attack; a Horseman rides up and finishes off a weakened Warrior).
- Status: `npm run check` green (30 logic tests + smoke).

## 2026-11-08 – Roads
- The map generator builds roads: a minimum spanning tree between all cities, each segment follows the cheapest path through terrain and merges with already built road (`buildRoads` in `map.js`). The map stays deterministic by seed.
- `stepCost()` in `game.js`: a step from road to road costs `ROAD_COST` = 0.5 movement points (otherwise the terrain of the target tile). Path, reach and AI use it automatically.
- Drawing: a brown road from the tile centre to neighbours with a road, so fog darkens it together with the tile. The hover panel shows "road". Movement points are shown including halves.
- I left out rivers (the task said "roads or rivers") and put them in Ideas.
- State structure: `state.version` 7 (`tile.road`); old saved maps load without roads.
- Smoke test: the step that builds a Market now starts in a fresh game – thanks to the faster AI on roads, the passive player in the smoke test gets occupied sooner.
- Tests: +1 logic (roads connect all cities and form one network, only over passable terrain, a road step is cheaper, migration). The path test computes the cost via `stepCost`.
- Status: `npm run check` green (27 logic tests + smoke).

## 2026-11-08 – Spearman and Catapult
- Spearman (12 gold, attack 3, defense 4): `bonusVs: { horseman: 1 }` – double strength against Horsemen in attack, defense and counterattack.
- Catapult (20 gold, attack 6, defense 1, movement 1, range 2, 7 HP): `siege: 0.5` – +50 % against units in cities and ignores Walls (not the base city bonus).
- Combat: new `vsMult()` and internal `attackPower()`; `defenseValue(state, unit, attacker)` takes the attacker into account. Without an attacker it returns the same as before (tooltip, `cityInfo`).
- The AI recruits according to a target army ratio (`pickRecruit`): more Spearmen when it sees enemy Horsemen, Catapults from round 8.
- UI: ability description in the unit panel and in the recruit button tooltip.
- Tests: +3 logic (Spearman vs Horseman in attack and defense and no bonus against a Warrior; Catapult vs a garrison with Walls vs an Archer; the AI answers Horsemen with Spearmen and recruits both new types in simulations).
- Status: `npm run check` green (26 logic tests + smoke).

## 2026-11-08 – Experience and promotion
- `RANKS` and `XP` in `rules.js`: Recruit → Veteran (3 XP) → Elite (7 XP), each rank +15 % attack and defense (counterattack too), promotion heals 3 HP.
- XP: attack +1, destroying the target +1 extra, surviving an attack +1 (defender). `rankOf()`, `rankMult()` and internal `gainXp()` in `game.js`.
- The attack event now carries the resulting HP and XP of both sides, so replay (`applyEvent`) matches exactly, promotion included. The replay test now compares XP too.
- UI: gold stars above the unit, the panel shows the actual attack/defense with bonus and a line "Veteran ★ · XP 4/7"; on promotion a "★ promotion" pops up.
- State structure: `state.version` 6 (`unit.xp`), migration fills in 0.
- Tests: +2 logic (XP for attack/defense/destruction; rank thresholds, attack and defense bonus, promotion with healing and a chronicle entry).
- Status: `npm run check` green (23 logic tests + smoke).

## 2026-11-08 – Buildings in cities
- `BUILDINGS` in `rules.js`: Walls (20 gold, garrison +50 % defense), Market (25 gold, +2 gold per round), Barracks (20 gold, recruiting 3 gold cheaper). The effects are in `BUILDING_EFFECTS` so they can be tuned in one place.
- `build()`, `hasBuilding()`, `unitCost()`, `cityDefenseMult()` in `game.js`; income, defense and recruiting cost take them into account. Buildings stay with the new owner when a city is conquered (so conquest pays off more).
- The AI builds from surplus gold (reserve of 12 for units): a threatened city gets Walls, otherwise Market and Barracks, capital first.
- UI: "Recruit" and "Build" sections in the city panel with cost and description, built buildings as tags; on the map a stone rim (Walls), a coin (Market) and a pennant (Barracks).
- Minor: chronicle messages now read "X recruited (city)" (Czech grammar note, obsolete after translation).
- State structure: `state.version` 5 (`city.buildings`), migration fills in empty buildings.
- Tests: +2 logic (cost, no double building and no building in a foreign city, Market raises income, Walls raise defense and match `cityInfo`, Barracks make recruiting cheaper; the AI builds from surplus; migration). The smoke test builds a Market with the button in the panel (`artifacts/screenshot-city-panel.png`).
- Status: `npm run check` green (21 logic tests + smoke).

## 2026-11-08 – Touch controls
- New `src/input.js` with the pure function `decideTap()`: what a click/tap means (select, move, attack, preview). The mouse acts immediately; touch (pointerType touch/pen) first shows the path or attack estimate in the panel and performs the action only on a second tap on the same tile.
- On narrow screens there is a "Zoom map" button: the map is then 820 px wide and scrolls inside its frame (the page itself doesn't scroll horizontally, checked by the smoke test). A tile is then ~56 px on a phone instead of ~27 px.
- No floating tooltip on touch (it would be in the way of the finger); the preview is in the side panel.
- Fix of an old drawing bug: terrain detail (trees, hills, mountains) overwrote the hex path, so the reach highlight, fog darkening and outline on Forest/Hills/Mountains were drawn only on the last tree/hill.
- Tests: +2 logic (preview → confirm for both move and attack, cancel by tapping elsewhere, an enemy in fog can't be selected). The smoke test now launches a phone with touch (`hasTouch`), zooms the map, selects a unit, checks that the first tap doesn't move and the second does, and saves `artifacts/screenshot-touch.png`.
- Status: `npm run check` green (19 logic tests + smoke).

## 2026-11-08 – AI difficulty selection (run for v0.4.0)
- At Vladimír's request this run is longer than the usual max 3 tasks.
- `DIFFICULTY` in `rules.js`: Easy / Normal / Hard. Changes the AI's starting and per-round gold, its caution when attacking and whether it sees through the fog.
- On Easy and Normal the AI now respects the fog of war: it targets only known cities and visible enemies, otherwise it explores (`aiKnowledge`, `goalsFor` in `ai.js`). The Hard AI sees the whole map as before.
- A "New game" dialog (HTML `<dialog>`) with difficulty and fog options; the last choice is remembered in localStorage. The difficulty is shown in the side panel.
- State structure: `state.version` 4 (`difficulty`), old games get "Normal".
- Tests: +2 logic (gold/income by difficulty, the Normal AI doesn't know the player's city at the start, a 6-game simulation: the Hard AI does better than Easy). The smoke test goes through the dialog (Hard, no fog) and saves `artifacts/screenshot-dialog.png`.
- Balance note: the "Normal" AI is now weaker than before because it no longer cheats. Anyone who wants the original strength has "Hard".
- Status: `npm run check` green (17 logic tests + smoke).

## 2026-11-08 – Version indicator (v0.3.0)
- At Vladimír's request: the header shows the game version next to the title (`v0.3.0`, with the date on mouse hover).
- The version lives in `src/version.js` and must match `package.json` – a new test guards this, and the smoke test checks it actually appears in the header.
- Retroactive numbering: 0.1 foundation, 0.2 path/Tab/city info, 0.3 animations and fog of war. `CLAUDE.md` now says to bump the version in every run.
- Status: `npm run check` green (15 logic tests + smoke).

## 2026-11-08 – Fog of war
- `visibleTiles()`, `updateExplored()`, `exploredTiles()` in `game.js`. Unit sight is in `rules.js` (`sight`: Warrior and Archer 2, Horseman 3), cities 2, Hills +1 (`VISION`).
- Explored tiles are remembered in `state.explored` (array of keys per player, JSON). `createGame({ fog })` can turn fog off; after the game ends the whole map is revealed.
- Drawing: an unexplored tile is dark, an explored but currently invisible one is dimmed, foreign units in fog are not drawn and can't be clicked. The AI turn is animated only where the player can see it.
- State structure: `state.version` 3 (`fog`, `explored`), migration from versions 1 and 2 in `migrateState()`.
- Tests: +1 logic (sight around units, enemy capital hidden at start, explored ⊇ visible and doesn't shrink after moving, no fog / after game end everything visible); the migration test checks that `explored` is computed.
- Status: `npm run check` green (14 logic tests + smoke).
- Known limitations (deliberately left for later, noted in Ideas): the AI still sees the whole map; the chronicle lists AI actions in the fog too; movement reach doesn't account for moving onto a tile with a hidden enemy unit (that tile simply can't be selected, which somewhat gives away that something is there).

## 2026-11-08 – Movement and attack animations
- Actions in `game.js` write events to `state.events` (move with path, attack with damage, recruiting, conquest). `drainEvents()` collects them, `applyEvent()` can replay them on a copy of the state.
- New `src/anim.js`: plays events on a copy of the state from before the action – units walk the path step by step, the attacker lunges, damage numbers pop up over targets, "Conquered!" on conquest. Both the AI turn and player actions are animated.
- Clicking the map or Esc skips the animation; with `prefers-reduced-motion` nothing is animated at all.
- State structure: `state.version` raised to 2 (`events` field). `migrateState()` converts saved version 1 games, so games in progress aren't lost.
- Tests: +3 logic (replaying the events of an AI turn gives exactly the same state as the real turn on 4 seeds, the move event carries the path, version 1 migration). The smoke test runs animations sped up, saves a frame in the middle of the AI turn (`artifacts/screenshot-anim.png`) and checks moving a unit by clicking.
- Status: `npm run check` green (13 logic tests + smoke).

## 2026-11-08 – City income and defense on hover
- `cityInfo()` and `cityIncome()` in `game.js`; the city defense bonus is the constant `CITY_DEF_BONUS` (previously hard-coded 1.25 in `defenseValue`).
- City tooltip (owner, income, garrison defense, garrison) + the same data in the side panel on hover and when a city is selected.
- The tooltip stays inside the window (`placeTip`).
- Tests: +1 logic (sum of city incomes = `incomeOf`, defense percentage = `defenseValue`). The smoke test hovers over its own city, checks the tooltip text and saves `artifacts/screenshot-city.png`.
- Status: `npm run check` green (10 logic tests + smoke).
- Observation: neutral city names in the chronicle are not declined (Czech grammar note, obsolete after translation) – minor thing for later.

## 2026-11-08 – Movement path and "Next unit" (Tab)
- `pathTo()` in `game.js`: the cheapest path to the target; `reachable()` now shares the same search (`searchMoves`), so path and reach can't disagree.
- Hovering over a reachable tile draws a yellow line with an arrow and dots on the intermediate tiles.
- `nextActiveUnit()` + the Tab key and the "Next unit" button: cycles through units that can still move or attack.
- Tests: +2 logic (path over adjacent tiles with cost equal to reach, Tab cycling). The smoke test now presses Tab and hovers over the farthest tile; the screenshot shows the arrow.
- Status: `npm run check` green (9 logic tests + smoke).
- Note for next time: hover doesn't exist on touch devices – it will be good to show the path when confirming a move (task "Touch controls").

## 2026-11-08 – Game foundation
- 14×10 hex map with a terrain generator (deterministic by seed, starting cities always connected).
- 3 unit types, combat with counterattack and terrain bonuses, 6 cities (2 capitals + 4 neutral), gold income, recruiting.
- AI: attacks when it pays off, otherwise heads for cities and units, recruits.
- UI: HUD, unit/city panel, chronicle, tooltip with combat estimate, saving to localStorage.
- Tests: 7 logic (including an AI vs AI simulation), smoke test in headless Chrome + screenshots.
- Status: `npm run check` green.
