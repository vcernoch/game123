# Development log

Newest entry on top. Format: date – what was done – test status – questions for Vladimír.

## 2026-11-24 – Winter camp (v0.46.0)
- **Still open for Vladimír:** more AI opponents and scenarios with their own objectives change the victory rules – they wait for your "more AI yes" / "scenarios yes". `dev` (v0.38.0–v0.46.0) is ahead of `main` (v0.37.0) – please merge it.
- Starting state green (136 logic tests + smoke).
- Phase 21 (the turning year), own improvement. Winter only had one answer – walk home – so a siege or a forward line simply bled 1 HP a turn. Now a unit can dig in for the winter: holding a position costs its turn but not its health.
- `SEASONS.camp` in `rules.js`, winter text mentions it. In `game.js`: `winterCamp` (fortified outside home in winter), `campSaves` (fortifying now would spare frost). `frostLoss` is 0 in a camp; `frostBound` is unchanged, so a camp still doesn't heal. The advisor's frost hint skips fortified units and adds "or fortify it in a winter camp" when the unit can still dig in.
- AI: `makeCamp` in `ai.js` – after the strikes, AI units that would freeze and haven't moved or attacked fortify (≈ 44 camps per game in a 20-game sample).
- UI: the fortify button shows "⛺ winter camp" (and the tooltip explains) when it would spare frost, the unit panel shows "⛺ Winter camp: …" instead of the frost warning, the frost line and the tile panel mention fortifying. Help text updated.
- Balance (20 AI-vs-AI games, default settings with fog, 300 half-turns max): wins 7 : 12, 1 stalemate, ~81 half-turns – in line with earlier samples.
- No state structure change (`state.version` stays 35).
- Test adjusted (not weakened): the winter advisor test expected the text to end with "bring it home." – a unit that can still fortify now gets "… bring it home or fortify it in a winter camp."; the new test checks both endings.
- Tests: +1 logic (camp spares frost but no healing, chronicle counts only the freezing unit, a moved unit can't make camp, no camp outside winter, advisor text and silence for a camp, AI `makeCamp` only for its own unmoved units). Smoke test: the fortify button offers the winter camp, F digs in, the panel shows the camp line, the advisor hint disappears (`artifacts/screenshot-camp.png`).
- Status: `npm run check` green (137 logic tests + smoke).

## 2026-11-23 – Winter advisor (v0.45.0, same run)
- Phase 21, second task of this run (the version was bumped once for the run). Frost is easy to forget until the HP are already gone, and the season badge only says what the season does, not which of your units is at risk.
- In `game.js`: `outsideHome` (not in own territory nor an own city – `frostBound` now uses it), `winterNear` (`'now'` in winter, `'soon'` in the last round before it, else null). `adviseTurn` gets a `frost` hint (❄, order 2.5 – right after wounded units in danger): the most wounded own unit outside home with ≤ `SEASONS.adviseHp` (60 %) HP that can still move and hasn't attacked, not the one the `wounded` hint already names, and not a 1-HP unit (frost can't hurt it). Text "Winter comes next turn – … start bringing it home." / "… is out in the winter cold – it loses 1 HP a turn outside your land; bring it home."; a click selects the unit.
- No state structure change (`state.version` stays 35).
- Tests: +1 logic (no hint two rounds before winter, the most wounded unit first in the last autumn round, the winter text, units without moves skipped, healthy and 1-HP units left alone, own territory is home, no seasons = never). Smoke test: the unit out in the winter cold appears in the advisor.
- Status: `npm run check` green (136 logic tests + smoke).

## 2026-11-23 – Seasons (v0.45.0)
- **Still open for Vladimír:** more AI opponents and scenarios with their own objectives change the victory rules – they wait for your "more AI yes" / "scenarios yes". `dev` (v0.38.0–v0.45.0) is ahead of `main` (v0.37.0) – please merge it.
- Starting state green (133 logic tests + smoke).
- Phase 20 was done, so I opened phase 21 (the turning year, own improvement). Every round played the same from the first turn to the last, so there was no rhythm to a war – no reason to time a campaign or pull a battered army back. Now the year turns.
- `SEASONS` in `rules.js` (`length` 3 rounds, order spring → summer → autumn → winter, `frostMinHp` 1, `aiFrostHp` 0.6). In `game.js`: `seasonAt` (derived from `state.turn`, nothing stored but the option), `seasonKind`, `seasonInfo`, `seasonStarted`, `riverCrossCost`, `frostLoss`, `frostBound`, `harvestGold`. Effects: `stepCost` uses `riverCrossCost` (spring +1, winter 0; bridges unchanged), `riverDefense` is 0 in winter, `cityIncome` adds the autumn harvest (owned, size 2+, calm), `endTurn` skips healing and takes 1 HP from units outside own territory/own cities in winter (never below 1, a chronicle line), and logs "❄ Winter has come: …" (public) on the first round of each season.
- AI: `frostGoals` in `ai.js` – in winter a unit outside its territory with ≤ 60 % HP gets only the nearest own cities as goals (`goalsFor`). Everything else (river costs) the AI gets for free through `stepCost`.
- UI: season badge in the header (tooltip with the effect and turns to the next season), the start-of-turn bar announces a new season (neutral colour), snow veil and flakes on the map in winter, frozen/swollen rivers, reddish forests in autumn, "❄ Winter outside your territory: no healing, −1 HP …" in the unit panel, frost and frozen-river notes in the tile panel, "🍂 Autumn harvest" in the city panel, "Seasons" checkbox in the new game dialog (remembered), "· no seasons" in the game info. Header stats now wrap on narrow screens. Help text updated.
- Balance (20 AI-vs-AI games, Medium, Normal with fog, 300 half-turns max): wins 7 : 10, 3 stalemates, ~86 half-turns (without seasons 6 : 10, 4, ~101) – no side favoured.
- State structure: `state.version` 35 (`seasons` option); migrated games continue without seasons (rules they started with); `stateProblem` validates it; `restartOptions` keeps it.
- Tests adjusted (not weakened): the river test and the city growth test check exact base costs/incomes, so they now start with `seasons: false` (seasons have their own tests); the perks test pinned `STATE_VERSION` to 34 – it now checks `>= 34`, the new test pins 35.
- Tests: +2 logic (season cycle and info, river cost/defense per season and bridges, harvest only for calm owned size-2+ cities in autumn and `incomeOf` agrees, no seasons = no change, restart options, validation, migration; frost outside territory and in enemy land, own territory and cities heal, never below 1, chronicle line, summer heals, season news once per season and public, AI frost goals, real AI-vs-AI games through two winters stay valid). Smoke test: spring badge at start, the end of round 9 brings the winter badge and banner, a unit outside our land shows the frost line (`artifacts/screenshot-winter.png`, `screenshot-winter-mobile.png`), no horizontal scroll on mobile.
- Status: `npm run check` green (135 logic tests + smoke).

## 2026-11-23 – Perks (v0.44.0, same run)
- Phase 20 (renamed "hindsight and veterans"), third task of this run. A promotion only added +15 % to both values, so every Veteran of a type was the same. Now each promotion is a small decision that shapes the unit.
- `PERKS` in `rules.js` (`kinds` drill / pathfinder / medic / lookout, `aiOrder` per unit type). In `game.js`: `perksOf`, `hasPerk`, `perkChoices` (rank − perks learned, so no pending field is needed), `perkOptions`, `perkProblem`, `learnPerk` (own unit, own turn, free, doesn't use the turn; a `perk` event – replayable, never animated – and a chronicle line), `medicBonus`, `perkText`, `perkAttackMult`, `perkSight`. Effects: `attackPower` and `unitSummary` (Drill), `stepCost` (Pathfinder, also against the faction forest cost – the lower one wins), `visibleTiles` (Lookout), `endTurn` healing (Medic: +1 for the medic and own neighbours when they heal at all; medics don't add up). A retrained unit keeps its perks.
- AI: `pickPerk` / `learnPerks` in `ai.js`, at the start of its turn (units promoted while defending) and at its end.
- Advisor: new `perk` hint (★) for a promoted unit with a choice left; a click selects it.
- UI: "★ Choose a perk" buttons in the unit panel, a "Perks: ⚔ Drill, …" line, perk names in the unit tooltip, attack in the panel includes Drill. Help text updated.
- Balance (20 AI-vs-AI games, Normal with fog, 300 half-turns max): wins 11 : 7, 2 stalemates, ~90 half-turns (before: 10 : 8, 2, ~79). The AI mostly picks Drill (Medic and Lookout as second perks).
- State structure: `state.version` 34 (optional `unit.perks`), trivial migration – old Veterans simply get their choice; `stateProblem` validates perks (known, unique, at most one per rank above Recruit).
- Test adjusted (not weakened): the chronicle places test pinned `STATE_VERSION` to 33 – it now checks `>= 33`, the new test pins 34.
- Tests: +3 logic (choice per rank, every reason, Drill attack, free, event + replay + not animated, chronicle, advisor hint, second different perk, Lookout sight ring, validation, migration; Pathfinder step cost, Medic healing incl. no stacking and only own units; AI pick order, real AI games leave no open choice and stay valid, `learnPerks` leaves the player's units alone). Smoke test: a Veteran in the capital shows 4 perk buttons and the advisor hint, Drill is learned by a click without using moves (`artifacts/screenshot-perks.png`).
- Status: `npm run check` green (133 logic tests + smoke).

## 2026-11-23 – Chronicle places (v0.44.0, same run)
- Phase 20, second task of this run (the version was bumped once for the run). The chronicle said "Enemy: Horseman destroyed Warrior", but not where – on a bigger map, or after the unit had moved on, the player had to guess.
- In `game.js`: `addLog` stores the tile of an entry (`q`, `r`) – `where.place`, else the last of `where.at` (the defender of a fight, the city of a recruit or capture, the unit of a promotion); ruins pass their tile as `place`. `logFor` hands the place out only with entries the viewer saw; the merged "Enemy actions in the fog of war" lines never carry one, so nothing leaks.
- UI: a chronicle line with a place shows ⌖ and a pointer; a click scrolls the (zoomed) map to the tile and pulses a yellow ring on it for 1.6 s (`view.ping` in `render.js`). Chronicle text is now escaped (unit names may come from an imported file). Help text updated.
- State structure: `state.version` 33 (optional `q`/`r` on log entries), trivial migration; `stateProblem` now validates the chronicle (array, integer turn, text, known tile for a place).
- Test adjusted (not weakened): the pursuit test pinned `STATE_VERSION` to 32 – it now checks `>= 32`, the new test pins 33.
- Tests: +1 logic (a fight placed on the defender, `logFor` passes the place, fog lines have none while the author sees where, entries without a place, validation, migration). Smoke test: after the enemy kill the "destroyed" line has a place, a click sets the ring on that tile, no fog line carries one (`artifacts/screenshot-ping.png`).
- Status: `npm run check` green (130 logic tests + smoke).

## 2026-11-23 – Replay enemy turn (v0.44.0)
- **Still open for Vladimír:** more AI opponents and scenarios with their own objectives change the victory rules – they wait for your "more AI yes" / "scenarios yes". `dev` (v0.38.0–v0.44.0) is ahead of `main` (v0.37.0) – please merge it.
- Starting state green (127 logic tests + smoke).
- Phase 19 was done, so I opened phase 20 (own improvement). The AI turn plays once; a player who looked away (or plays with animations off) only had the report line and the ✕ marks to guess what happened. Now the enemy's turn can be watched again.
- In `game.js`: `eventTiles` (where an event happens – tiles, `[]` for a secret focus, `null` for bookkeeping without a place), `eventSeen`, `enemyTurnReplay(before, events, viewer)` → `{ before, events, seen }` with a private copy of the state, or null when the viewer saw nothing. Visibility is judged on a replayed copy at the moment of each event, exactly as the animation does – `anim.js` now uses `eventTiles` instead of its own list, so the two can't disagree. No state structure change: the replay lives in memory until the player ends the turn (not saved, so a reload drops it).
- UI: the start-of-turn bar gets a "↺ Replay enemy turn" button (if nothing else is reported it says "The enemy was active in sight (n actions)"), key V (also in the `?` overlay). The replay plays on a copy of the state from before the enemy turn – at normal speed when animations are off – and the map then returns to now; the button turns into "⏹ Skip replay" meanwhile, Esc or a click skips too. Help text updated.
- Tests: +2 logic (an attack on an own unit is seen, the copy is private, a march in the fog isn't, a walk ending in sight is, bookkeeping and focus never count, spawns are judged after they appear, no fog = all seen, key V; real AI turns on 3 seeds: the replayed copy ends in the same units and cities, `seen` within the event count). Smoke test: the banner shows the button, a click starts the replay ("Skip" label, busy), the map returns with the state untouched, V starts it again and Esc skips (`artifacts/screenshot-replay.png`).
- Status: `npm run check` green (129 logic tests + smoke).

## 2026-11-23 – Pursuit (v0.43.0)
- **Still open for Vladimír:** more AI opponents and scenarios with their own objectives change the victory rules – they wait for your "more AI yes" / "scenarios yes". `dev` (v0.38.0–v0.43.0) is ahead of `main` (v0.37.0) – please merge it.
- Starting state green (124 logic tests + smoke).
- Phase 19 (manoeuvre, own improvement), third task. After hit and run gave riders a role, foot soldiers that won a fight were still stuck on their tile, so a broken enemy line closed again for free. Now a warrior or spearman that destroys an adjacent defender can step into the gap.
- `PURSUIT` in `rules.js` (`types` warrior + spearman, `aiHpShare` 0.6). In `game.js`: `isPursuer`, `pursuesInto` (for the preview), `pursuitTile`. `attack` sets `unit.pursuit = {q, r}` on a kill at distance 1 when the freed tile is passable and not a city (a killed garrison still has to be followed up next turn – the same rule as for hit and run). `searchMoves` gives a unit with no moves left exactly that tile at cost 0 while it is free and it is the owner's turn, so `reachable`, `pathTo`, `moveUnit`, the reach highlight and clicking work unchanged. Any move and `endTurn` clear it; the `attack` event carries `pursuit` and `applyEvent` restores it (a `move` clears it). It is optional: the unit doesn't count as "ready" for Tab or the end-turn reminder.
- AI: `pursue` in `ai.js`, after the strikes (next to `withdraw`) – advances when the freed tile is no more exposed than staying, or when a unit with ≥ 60 % HP gets next to a known enemy city it wasn't next to; a garrison never leaves its own city.
- UI: "➜ Pursuit: click the freed tile to advance there for free – or stay where you are" in the unit panel, "can pursue" tag in the tooltip, the attack preview adds "· then it can advance", warrior/spearman descriptions mention it. Help text updated.
- Balance (20 AI-vs-AI games, Normal with fog, 300 half-turns max, my script): wins 10 : 8, 2 stalemates, ~79 half-turns (without pursuit 8 : 9, 3, ~91); 580 pursuit rights, 167 advances. Games end a bit sooner, no side favoured.
- State structure: `state.version` 32 (optional `unit.pursuit`), trivial migration; `stateProblem` validates it (integers, next to the unit).
- Test adjusted (not weakened): the hit and run test pinned `STATE_VERSION` to 31 – it now checks `>= 31`, the new test pins 32.
- Tests: +3 logic (the right after a kill, reach of exactly that tile at cost 0, not "ready", event + replay, the free step and the move replay; no pursuit for archers, horsemen or into a city, a tile taken by a friend, expiry at turn end, only on the owner's turn, validation, migration; AI advances when safe, stays when exposed, presses an enemy city when healthy but not when wounded, 3 real AI-vs-AI games with pursuits and advances). Smoke test: a warrior in the capital kills a weak scout by a click, the panel offers the pursuit and a second click advances into the freed tile.
- Status: `npm run check` green (127 logic tests + smoke).

## 2026-11-23 – Hit and run (v0.42.0)
- **Still open for Vladimír:** more AI opponents and scenarios with their own objectives change the victory rules – they wait for your "more AI yes" / "scenarios yes". `dev` (v0.38.0–v0.42.0) is ahead of `main` (v0.37.0) – please merge it.
- Starting state green (121 logic tests + smoke).
- Phase 19 (manoeuvre, own improvement), second task. Horsemen were just faster warriors: after a strike they stood next to the enemy, exposed to a pile-on. Now fast units can raid – strike and pull back – which gives cavalry and scouts a role of their own; spearmen, zones of control and terrain still check them.
- `SKIRMISH` in `rules.js` (`types` horseman + scout, `moveCost` 1). In `game.js`: `isSkirmisher`, `movesAfterAttack`, `canWithdraw`. `attack` leaves a surviving skirmisher `movesLeft − 1` (a charge after 2 steps leaves 1 to pull back) and sets `unit.raided` when moves remain; `cityForbidden` keeps a raided unit out of foreign cities (no killing a garrison and riding in the same turn); `attackTargets` stays empty (`hasAttacked`). `endTurn` clears `raided`. The `attack` event carries `movesLeft`, so replay restores the kept moves and the flag. `unitSummary.hitAndRun`.
- AI: `withdraw` in `ai.js`, run after the lined-up strikes for every raided unit – moves to the reachable tile with the lowest exposure (enemies that can reach it × wounds − terrain defense; an own city is safe), only when clearly safer (margin 0.25). In 3 AI-vs-AI test games: 51 raids, 39 pull-backs.
- UI: "🏇 Hit and run: 3 move left to pull back – no second attack, no foreign city" in the unit panel, "hit and run" tag in the tooltip, the attack preview adds "· then 3 move to pull back", horseman/scout descriptions mention it. Help text updated.
- Balance (20 AI-vs-AI games, Normal, 300 half-turns max): wins 8 : 11, 1 stalemate, ~74 half-turns (without hit and run 8 : 10, 2, ~75).
- State structure: `state.version` 31 (optional `unit.raided`), trivial migration; `stateProblem` validates it.
- Test adjusted (not weakened): the forced march test pinned `STATE_VERSION` to 30 – it now checks `>= 30`, the new test pins 31.
- Tests: +3 logic (kept moves, no second attack, event + replay, pulling back out of a zone of control, warriors unchanged, flag cleared at turn end; a killed garrison's city is off limits until next turn, one move left = nothing kept, dying attacker, validation, migration; AI `withdraw` to a safer tile, no move without a raid or without danger, 3 real AI-vs-AI games with raids and pull-backs). Smoke test: a horseman in the capital clicks an adjacent enemy, keeps 3 moves and shows the panel line (`artifacts/screenshot-raid.png`).
- Status: `npm run check` green (124 logic tests + smoke).

## 2026-11-22 – Forced march (v0.41.0)
- **Still open for Vladimír:** more AI opponents and scenarios with their own objectives change the victory rules – they wait for your "more AI yes" / "scenarios yes". `dev` (v0.38.0–v0.41.0) is ahead of `main` (v0.37.0) – please merge it.
- Starting state green (119 logic tests + smoke).
- Phase 18 was done, so I opened phase 19 (manoeuvre, own improvement). Movement was fixed per type, so a defender one tile short of a threatened city simply arrived too late. Now a unit can push on at a price – a real trade-off between tempo, HP and striking power.
- `FORCED_MARCH` in `rules.js` (`bonus` 1, `hpCost` 2, `aiHpShare` 0.6). In `game.js`: `forcedMarchProblem` (reason or null: game over, not your turn, already marched, already acted – moved, attacked or spent moves –, too weak), `canForceMarch`, `forceMarch` (+1 move, −2 HP, `unit.marched` and `moved` – so no healing at the end of the turn –, leaves fortify/watch/move order/exploring; replayable `march` event), `marchReach` (reach with a march, nothing changed). `attackTargets` is empty for a marched unit. `endTurn` clears `marched` for the player ending the turn (after healing), so it lives for one turn only. `unitSummary.forcedMarch`.
- AI: `assignGarrisons` – when no unit reaches a threatened unguarded city, it picks a non-siege unit with ≥ 60 % HP that reaches it with a march (`result.marches`); `holdCity` marches first. In 12 AI-vs-AI games (Normal, 300 half-turns max) the situation never came up (0 marches; wins 5 : 7), so it is a rare emergency move – balance is unchanged.
- Advisor: the unguarded-city hint adds "A forced march (🥾) gets your Warrior there in time (−2 HP)." (and `marchUnitId`) when no unit reaches the city normally but one would with a march.
- UI: "🥾 Forced march +1 move · −2 HP · no attack" button in the unit panel (its tooltip counts the extra tiles in reach), key M (also in the `?` overlay), a "🥾 Forced march: …" line on a marched unit, a small boot drawn on it, "forced march" tag in the unit tooltip, a floater when it's seen, step sound. Help text updated.
- State structure: `state.version` 30 (optional `unit.marched`), trivial migration; `stateProblem` validates it.
- Test adjusted (not weakened): the recruit orders test pinned `STATE_VERSION` to 29 – it now checks `>= 29`, and the new test pins 30.
- Tests: +2 logic (every reason, HP and moves, larger reach equals the marched reach, no attack, fortify/watch/order cleared, event + replay + sound, walking to a tile only the march reaches, no healing, flag cleared at turn end, march again next turn, never below 1 HP, validation, migration, key M; AI garrison by march in a real AI turn, no march when wounded or without threat; advisor tip and its absence when a unit reaches the city normally). Smoke test: an archer in the capital marches from the panel – HP 6, move 3, panel line, button gone (`artifacts/screenshot-march.png`).
- Status: `npm run check` green (121 logic tests + smoke).

## 2026-11-22 – Recruit orders (v0.40.0)
- **Still open for Vladimír:** more AI opponents and scenarios with their own objectives change the victory rules – they wait for your "more AI yes" / "scenarios yes". `dev` (v0.38.0–v0.40.0) is ahead of `main` (v0.37.0) – please merge it.
- Starting state green (117 logic tests + smoke).
- Phase 18 (city management, own improvement), third task. When a city couldn't recruit (a few gold short, or a unit standing in it), the player had to remember to come back next turn – and on a busy front a turn often started without the planned recruit. Now the city can take an order.
- In `game.js`: `recruitOrderProblem`, `setRecruitOrder`, `clearRecruitOrder`, `recruitOrderBlocker` ('gold' / 'occupied' / null), `recruitOrderText`, `fillRecruitOrders`. `city.order` holds a unit type. `endTurn` calls `fillRecruitOrders` at the start of the owner's turn after income and random events (so a harvest can pay for it), cities in id order while gold lasts; the purchase goes through `buyUnit` (price at that moment, academy XP, rally point), so the recruit can't act until the next turn – the same as clicking recruit at the turn start. A replayable `order` event comes right before the `spawn`. Any recruit in the city fulfils the order; a captured city loses it (also in replay). The AI doesn't use orders (it recruits directly). Named `recruitOrder…` because `setOrder`/`cancelOrder` already mean move orders.
- UI: in the city panel a recruit button that can't be bought now becomes a dashed "⏳ order" button (it keeps the unit description in its tooltip); the ordered one is highlighted and pressing it again cancels; a "⏳ Ordered: … – waits for gold (x/y)" / "waits until the city tile is free" line with "✖ Cancel order"; number keys order when they can't recruit; a small hourglass left of the size dots on the map; the city tooltip shows the order; the start-of-turn banner says "Archer recruited in … as ordered (−12 gold)". Help text and the shortcut overlay updated.
- State structure: `state.version` 29 (optional `city.order`), trivial migration; `stateProblem` validates it (known type, owned city).
- Tests adjusted (not weakened): the city focus test pinned `STATE_VERSION` to 28 – it now checks `>= 28`, and the new test pins 29. The smoke test read the title of the scout's `data-buy` button in an occupied city, which is now an order button (`data-order`); it reads that one and still checks the scout description.
- Tests: +2 logic (who may order, waiting for gold and for room with texts, bought at the turn start with the right gold, can't act, event order + replay, harvest pays for it, recruiting fulfils it, clearing, several cities with limited gold in id order, capture incl. replay, game over, validation, migration; a 40-turn game against the AI where the player only orders keeps a valid state and buys several units). Smoke test: ordering an archer in the occupied capital, key 1 switches the order, pressing it again cancels, then a real turn end buys the archer and the banner says so (`artifacts/screenshot-order.png`).
- Status: `npm run check` green (119 logic tests + smoke).

## 2026-11-21 – Levy (v0.39.0)
- **Still open for Vladimír:** more AI opponents and scenarios with their own objectives change the victory rules – they wait for your "more AI yes" / "scenarios yes". `dev` (v0.38.0–v0.39.0) is ahead of `main` (v0.37.0) – please merge it.
- Starting state green (115 logic tests + smoke).
- Phase 18 (city management, own improvement), second task. A city's size was only ever income; when the treasury was empty an attacked city had no answer. Now population can be turned into soldiers in an emergency – at a lasting price, since the lost size costs gold every turn and takes 5–7 turns to regrow.
- `LEVY` in `rules.js` (`type` warrior, `minSize` 2, `sizeCost` 1, `aiThreat` 3). In `game.js`: `levyProblem` (reason text or null: game over, not own city / not own turn, unrest, too small, occupied), `canLevy`, `levy` – the city loses a size, growth progress resets, a `levy` event (replayable through the same branch as `grow`) is followed by a normal `spawn`; the warrior is free, raw (no academy XP), can't act this turn and gets the city's rally point order. Chronicle entry.
- AI: `shouldLevy` in `ai.js` – in `recruit` (both calls), when nothing is affordable, the city is empty and grown, and a visible enemy is within 3 tiles. About one levy per AI-vs-AI game (12 games: 12 levies; wins 5 : 5, 2 stalemates – the same split as without it).
- Advisor: the unguarded-city hint adds "No gold to recruit – levy a Warrior there (costs a size)." (and `levy: true`) when the player can't afford any unit and the city can levy.
- UI: "⚑ Levy Warrior · free · −1 size" button under the recruit buttons, shown only in cities of size 2+ (disabled with a reason in the tooltip; a restless city also gets a hint line); key L; a floater "⚑ levy −1 size" when it is seen; help text updated. No state structure change (`state.version` stays 28).
- Test adjusted (not weakened): "repair: the AI walks back …" asserts that at least one repair happens in real AI-vs-AI games on six seeds; repairs are rare (~0.5 per game) and the levies changed those games so none happened. The same assertion now runs on eight seeds (+12, +14).
- Tests: +2 logic (every reason, free, size and growth, income drop, raw warrior that can't act, event order, sound, replay, rally point, no academy XP, game over, key L; AI only in an emergency – no enemy / gold / too small – and a real AI turn levying a defender; advisor text with and without gold). Smoke test: a size-2 capital shows the button, clicking it gives a free warrior and size 1, the button disappears (`artifacts/screenshot-levy.png`).
- Status: `npm run check` green (117 logic tests + smoke).

## 2026-11-21 – City focus (v0.38.0)
- **Still open for Vladimír:** more AI opponents and scenarios with their own objectives change the victory rules – they wait for your "more AI yes" / "scenarios yes". Thanks for merging v0.37.0 into `main`; `dev` now holds only v0.38.0 on top of it.
- Starting state green (113 logic tests + smoke). `dev` was fast-forwarded to the merge commit on `main` first (no force).
- Phase 17 was done, so I opened phase 18 (city management, own improvement). Cities had no decision of their own besides buildings: every city simply grew and paid. Now the player chooses what each city works towards, which makes growth, sieges and frontier cities a trade-off.
- `FOCUS` in `rules.js` (`kinds` balanced / commerce / granary / fortress with `gold`, `growth`, `defBonus`; `aiThreat` 3). In `game.js`: `focusOf`, `cityFocus`, `setFocus` (own city, own turn, free, emits a replayable `focus` event), `focusText`. `cityIncome` adds the focus gold (never below 0; a restless city still pays 0), `growCities` adds the focus growth rate (0 = halted), `growthLeft`/`growthText` follow it ("growth halted: commerce focus"), `cityDefenseMult` multiplies by the fortress bonus (siege engines ignore it like walls, via `defenseValue`). Income and growth are worked out at the owner's turn start, so the focus left at the end of a turn is the one that counts – switching mid-turn gains nothing. A captured city loses its focus (also in replay).
- AI: `pickFocus` / `setFocuses` in `ai.js`, run at the end of the AI turn – fortress with a visible enemy within 3 tiles, balanced while restless or besieged, granary while it can grow, commerce once fully grown.
- Advisor: new low-priority `focus` hint (after build) – a fully grown city not on Commerce, or a Fortress with no visible enemy within 3 tiles.
- UI: "Focus" section with four buttons in the city panel (current one outlined), focus line in the panel and city tooltip, key C cycles it, a small badge right of the size dots on own cities (coin / ear of grain / tower; the AI's focus stays hidden, though a fortress shows in its defense %). Focus events of the AI are not animated. Help text updated.
- Balance (20 AI-vs-AI games, Normal, both sides use focus, 300 half-turns max): wins 9 : 9, 2 stalemates, ~68 half-turns per game (without focus 8 : 11, 1, ~61). Focus share of owned city-turns: commerce 59 %, granary 21 %, fortress 19 %, balanced 2 %.
- State structure: `state.version` 28 (optional `city.focus`, never stored as 'balanced' or on neutral cities), trivial migration; `stateProblem` validates it.
- Tests: +2 logic (commerce income and halted growth, granary halves the wait, fortress defense vs. siege, income floor, who may set it, event + replay + sound, balanced removes the field, capture resets it incl. replay, validation, migration; AI picks per situation, `setFocuses` idempotent, a real 30-turn AI game keeps valid focuses and leaves the player's cities alone; advisor hints and when absent; C key). Smoke test: panel button sets Granary (growth line says 3 turns, no gold spent, `artifacts/screenshot-focus.png`), C cycles to Fortress, Balanced clears it.
- Status: `npm run check` green (115 logic tests + smoke).

## 2026-11-20 – Unrest (v0.37.0)
- **Still open for Vladimír:** more AI opponents and scenarios with their own objectives change the victory rules – they wait for your "more AI yes" / "scenarios yes". `dev` (v0.26.0–v0.37.0) is ahead of `main` (v0.25.0) – please merge it.
- Starting state green (111 logic tests + smoke).
- Phase 17 (living cities, own improvement), third task. Taking an enemy city paid off from the very next turn, so a quick raid on a city was always worth it and garrisons only mattered against a counterattack. Now a conquered city has to be pacified, which rewards leaving a unit inside.
- `UNREST` in `rules.js` (`turns` 4, `garrisonCalm` 2). In `game.js`: `cityUnrest`, `unrestCalm`, `unrestTurnsLeft`, `unrestText`, `calmCities`. Capturing a city from another player sets `city.unrest = 4` (also when the old owner retakes it); a neutral city joins willingly. `cityIncome` is 0 and `growCities` skips the city while restless. At the start of the owner's turn (`endTurn`, before growth and income, so a calmed city pays the same turn) unrest drops by 1, by 2 with an own unit inside: 3 missed incomes without a garrison, 1 with one. The `capture` event carries `unrest`, a new `calm` event (replayable, `boon` sound) and a chronicle entry announce the end.
- AI: `assignGarrisons` keeps a unit that stands in a restless city there even without a threat nearby.
- Advisor: new `unrest` hint (✊, after repair) – an unguarded restless city a unit can walk into this turn, naming the nearest unit.
- UI: a small flame on the roof of a restless city, "✊ Unrest: no income, no growth · calms in N turns (…)" in the city panel and tooltip, growth line "growth halted: unrest", trade line "+1 gold once the unrest ends", the start-of-turn bar says when a city accepted your rule. Help text updated.
- Balance (20 AI-vs-AI games, Medium, 300 half-turns max): wins 6 : 12, 2 stalemates (without unrest 7 : 11, 2); 47 restless captures; about 1 % of owned non-capital city-turns are restless.
- State structure: `state.version` 27 (optional `city.unrest`), trivial migration; `stateProblem` validates it.
- Tests: +2 logic (neutral capture calm, enemy capture with replay, no income/growth, exact turns without and with garrison, pays on the calming turn, calm event/log/replay, enemy inside is no garrison, retaking restarts unrest, game over, texts, validation, migration; advisor hint and when it is absent, AI garrison kept in a real AI turn). Smoke test: a unit walks into an AI city, panel and tooltip show the unrest (`artifacts/screenshot-unrest.png`).
- Status: `npm run check` green (113 logic tests + smoke).

## 2026-11-20 – Trade routes (v0.36.0)
- **Still open for Vladimír:** more AI opponents and scenarios with their own objectives change the victory rules – they wait for your "more AI yes" / "scenarios yes". `dev` (v0.26.0–v0.36.0) is ahead of `main` (v0.25.0) – please merge it.
- Starting state green (108 logic tests + smoke).
- Phase 17 (living cities, own improvement), second task. Roads only made movement cheaper; the road network between cities meant nothing economically, and a raid deep in enemy land could only hit resources. Now roads carry trade, so holding the cities along a road and keeping it clear pays off.
- `TRADE` in `rules.js` (`income` 1). In `game.js`: `tradeRoute(state, city)` → `null` (neutral) / `'hub'` (own capital, also a captured enemy capital) / `'linked'` / `'cut'` / `'none'` – a breadth-first search from the city along road tiles to an own capital; own cities are links, neutral and enemy cities break the chain, a tile with an enemy unit blocks it (`'cut'` = a road exists without the blockers). `cityIncome` adds +1 for a linked city (only with a state; computed, nothing stored). `tradeText`, `cutRoutes`, and for the AI `tradeTargets` / `cutsAt` / `routesCutBy`.
- AI: `blockadeGoals` in `ai.js` – a melee unit (not archers/catapults, not scouts) gets a goal (w 0.85, within 3 tiles) on a known enemy road tile where standing would cut a working route; a route already cut by another unit offers none, so one blockader per route. City goals nearby still win, so blockades happen on roads between cities.
- Advisor: new `trade` hint (🛤, after repair) when visible enemies alone cut a route – it points at the nearest one on the road. A blocker hidden in fog never shows in the advisor. Known limitation: the city panel/income still say "cut" when the blocker is hidden (the caravans don't arrive), which hints that someone is out there – accepted as a feature for now.
- UI: city panel line "🛤 Trade route to the capital: +1 gold" / "Trade route cut: an enemy blocks the road" (red) / "No trade route: no road to the capital" / "Trade hub …" for own cities, also in the city tooltip. Help text updated.
- Balance (20 AI-vs-AI games, Medium, 300 half-turns max): wins 7 : 11, 2 stalemates – the same two as without trade routes (6 : 12, 2). About 60 % of owned non-capital city-turns are linked, ~1 % cut. On the large map seed 5 the game in the "map sizes" test now runs 118 half-turns instead of 50, so that test takes ~5 s instead of ~2 s (the per-turn cost of the trade search is small – profiled).
- No state structure change (`state.version` stays 26).
- Tests: +3 logic (hub/linked/cut/none and texts, income change and its payout at turn start, own units don't block, a built road links again, own city as link vs neutral/enemy city, captured capital is a hub; advisor hint for a visible blocker but not a hidden one, then named once seen; AI blockade goals, archers excluded, one blockader per route, own routes ignored, a real AI turn steps onto the road and cuts it). Smoke test: the capital panel shows the trade hub line.
- Status: `npm run check` green (111 logic tests + smoke).

## 2026-11-19 – City growth (v0.35.0)
- **Still open for Vladimír:** more AI opponents and scenarios with their own objectives change the victory rules – they wait for your "more AI yes" / "scenarios yes". `dev` (v0.26.0–v0.35.0) is ahead of `main` (v0.25.0) – please merge it.
- Starting state green (106 logic tests + smoke).
- Phase 16 was done, so I opened phase 17 (living cities, own improvement). A city gave the same income from the turn it was taken to the end of the game, so holding one longer meant nothing and a siege only mattered at the moment of capture. Now cities grow, sieges hurt and a long-held city is worth more.
- `GROWTH` in `rules.js` (`maxSize` 3, `turns` [5, 7], `income` 1, `captureLoss` 1, `aiGoalBonus` 0.1). In `game.js`: `citySize`, `growthLeft`, `citySieged` (any enemy unit on a neighbouring tile), `growthText`, `growCities` – called in `endTurn` for the player whose turn starts, before income, so a new size pays at once. `cityIncome` adds +1 per size above 1. A captured city drops one size (never below 1) and its progress resets; the `capture` event carries the new size, a new `grow` event (replayable, `boon` sound) and a chronicle entry announce growth. Neutral cities stay at size 1.
- AI: city goals weigh +0.1 per size above 1 (`goalsFor`). No other AI change needed – growth is automatic. Balance: in AI-vs-AI games on Medium cities reach size 2–3 during the game; the extra income is modest (+1/+2 per city).
- UI: dots along the bottom of a city tile (filled = reached size), "Size 2/3 · grows in 4 turns" / "growth halted: enemy at the gates" / "fully grown" in the city panel and tooltip. For cities that aren't yours only the size is shown, so the AI's progress in the fog stays hidden. The start-of-turn bar says "Your Capital grew to size 2 (+1 gold).". Help text updated.
- State structure: `state.version` 26 (`city.size`, `city.growth`), migration gives every city size 1; `stateProblem` validates both.
- Test adjusted (not weakened): `pillageSetup` sets all cities to full size, because the pillage test checks the AI's exact income over 12 turns and growth would otherwise raise it mid-test.
- Tests: +2 logic (sizes after exactly 5 owner's turns, event and chronicle, income, new size pays the same turn, max size, siege halts but own neighbours don't, capture shrinks and resets with replay, texts, validation, migration; two real AI-vs-AI games keep sizes in range with neutral cities at 1 and some city growing, AI goal weight). Smoke test: city tooltip has the size, the city panel shows "Size 1/3 · grows in 5 turns".
- Status: `npm run check` green (108 logic tests + smoke).

## 2026-11-19 – Recruit suggestion (v0.34.0)
- **Still open for Vladimír:** more AI opponents and scenarios with their own objectives change the victory rules – they wait for your "more AI yes" / "scenarios yes". `dev` (v0.26.0–v0.34.0) is ahead of `main` (v0.25.0) – please merge it.
- Starting state green (105 logic tests + smoke).
- Phase 16 (guidance, own improvement), second task. The advisor said "recruit a unit" but not which one; with six types and counters (spearmen vs horsemen, catapults vs garrisons) a newer player had to know the rules by heart.
- `ADVISOR.recruit` in `rules.js` (`range` 6, `siegeRange` 5, `unknownShare` 0.4). `suggestRecruit(state, player, city)` in `game.js` (pure, fog-safe – only visible enemies and explored cities): returns `{ type, reason }` or null (not own, occupied, game over, no gold). In order: Spearman when visible enemy horsemen within 6 tiles are at least half of the enemies there; Catapult for a known enemy city within 5 tiles when the army has no siege unit and fewer than 2 enemies are near (reason names the walls if any); with enemies near an Archer when ≥ 2 melee units and fewer than half as many ranged, else a Warrior; with none near a Scout when ≥ 40 % of the map is unexplored and there is no scout, a Horseman for the nearest known neutral city; else a Warrior. Unaffordable picks are skipped; last resort is the cheapest affordable type.
- UI: the suggested recruit button gets a light outline and ★, a "★ Suggested: Spearman – counters the 1 enemy horseman nearby." line under the buttons. The advisor's recruit hint now names it ("recruit a Spearman in Your Capital (counters …)") and carries `unitType`. Help text updated. No state structure change (`state.version` stays 25).
- Tests adjusted (not weakened): the advisor test's exact recruit text now includes the type and reason; the smoke advisor check matched "recruit a unit in" and now matches "recruit a/an <Type> in <city> (<reason>)."
- Tests: +1 logic (every branch incl. thresholds, plurals, walls, affordability fallbacks, occupied/foreign city, game over, fog: hidden horseman ignored, scout only without a scout, advisor text and `unitType`, no side effects). Smoke test: after the advisor click exactly one suggested button and the suggestion matches the hint (`artifacts/screenshot-advisor.png`).
- Status: `npm run check` green (106 logic tests + smoke).

## 2026-11-18 – Advisor (v0.33.0)
- **Still open for Vladimír:** more AI opponents and scenarios with their own objectives change the victory rules – they wait for your "more AI yes" / "scenarios yes". `dev` (v0.26.0–v0.33.0) is ahead of `main` (v0.25.0) – please merge it.
- Starting state green (103 logic tests + smoke).
- Phase 15 was done, so I opened phase 16 (guidance, own improvement). The game has grown many mechanics and the "How to play" text is a wall; a newer player easily misses an unguarded city or a free kill. Now an advisor points at what matters this turn.
- `ADVISOR` in `rules.js` (`limit` 3, `dangerRange` 3, `woundedShare` 0.4, `buildReserve` 10, `buildOrder`, kinds with icon and order). In `game.js`: `adviseTurn(state, player)` – one hint per kind, sorted by urgency: `undefended` (own city without garrison, nearest visible enemy ≤ 3 tiles), `finish` (preview says the target dies and the attacker survives; weakest target), `wounded` (≤ 40 % HP, can still move, on a tile `threatTiles` marks, not in an own city), `capture` (a known foreign city reachable this turn – enemy capital first; scouts excluded by the normal movement rules), `ruin` (a ruin the player believes in, reachable), `repair` (own pillaged resource, enough gold; names the unit if one stands on it), `recruit` (free own city and enough gold) or else `build` (first affordable building in `buildOrder` that still leaves 10 gold). Fog-safe: only visible enemies, explored cities/ruins. Pure, changes nothing; nothing on the AI's turn or after the game. Max ~8 ms on a large map.
- UI: a collapsible "💡 Advisor" panel under the army list (count in the summary, red/gold borders for urgent hints); a click selects the unit (scrolls the zoomed map like the army list – shared `bringIntoView`) or the city; the open/closed state is a viewer preference in localStorage. Help text updated. No state structure change (`state.version` stays 25).
- Test adjusted (not weakened): the smoke rally-point check computed the flag tile's screen position before clicking the panel button; with the advisor above the city panel the click now scrolls the page, so the test scrolls back and measures the tile again before clicking it.
- Tests: +2 logic (recruit / build with reserve and order / nothing left to build; undefended with garrison, range and fog; sure kill vs healthy enemy and already attacked; wounded thresholds and no enemy; capture by horseman not scout, out of reach; ruin; repair walk-there vs now and no gold; limit and order, AI turn, game over, no side effects, 3 real AI-vs-AI games with well-formed hints). Smoke test: unguarded capital hint first, click selects the city (`artifacts/screenshot-advisor.png`), collapsing is saved and empties the list.
- Status: `npm run check` green (105 logic tests + smoke).

## 2026-11-18 – War timeline (v0.32.0)
- **Still open for Vladimír:** more AI opponents and scenarios with their own objectives change the victory rules – they wait for your "more AI yes" / "scenarios yes". `dev` (v0.26.0–v0.32.0) is ahead of `main` (v0.25.0) – please merge it.
- Starting state green (101 logic tests + smoke).
- Phase 15 (war stories, own improvement), third task. The statistics showed numbers and a chart, but not *how* the war went; now they tell the story.
- `MILESTONES` in `rules.js` (kinds with icon and name, `limit` 60, `keep`, `fallKills` 2, `leadRatio` 1.5, `leadMin` 10). In `game.js`: `addMilestone` (stores `{ turn, kind, player, text, seen }`, `seen` like chronicle entries under fog; when full, the oldest ordinary entry is dropped, first blood / first hero / capital / victory stay), `killMilestones` (first kill of the game; a named hero with 2+ kills that falls – also by a counterattack), first hero of each side in `gainXp` (later heroes are too common to list), captures in `moveUnit` (neutral / enemy city / enemy capital), victory in `checkWinner`. `leadChanges(history)` derives "army pulls ahead" entries from the history (no stored state), `timelineFor(state, viewer)` merges both and hides what the viewer didn't witness until the game ends. `whose()` gives "your" / "the AI's" for the texts. `stateProblem` validates the list.
- UI: "War timeline" section in the statistics between the charts and the hall of fame (turn, side dot, icon, text; capital and victory bold, leads italic; scrolls to the newest entry), small coloured triangles under the strength chart with the story as tooltip (`chartSvg` option `marks`). Help text updated.
- Tuning: in a first version every promotion and every fallen hero was listed – 30–60 entries per game; with "first hero only" and "2+ kills" a typical AI-vs-AI game has 14–19.
- State structure: `state.version` 25 (`milestones`); old games start with an empty timeline.
- Tests: +2 logic (first blood once, famous fallen hero vs. 1-kill hero, counter-kill, only the first hero, neutral capture, capital + victory with exact texts; leads from history incl. tiny armies, fog hiding until game over, merge order, HTML escaping and empty text, chart marks, cap keeps first blood, save/import, 7 bad values, migration, 2 real AI-vs-AI games). Smoke test: after the played-out game the timeline has first blood and ends with "won the war", the chart has markers (`artifacts/screenshot-timeline.png`).
- Status: `npm run check` green (103 logic tests + smoke).

## 2026-11-17 – Inspiration (v0.31.0)
- **Still open for Vladimír:** more AI opponents and scenarios with their own objectives change the victory rules – they wait for your "more AI yes" / "scenarios yes". `dev` (v0.26.0–v0.31.0) is ahead of `main` (v0.25.0) – please merge it.
- Fix first: the starting state was red – the smoke "army panel" check failed because the hero smoke test left rows in the closed panel and reopening it raced the toggle redraw. `updateArmy` now clears the list when the panel is closed (no stale rows flash on reopening either). Separate commit.
- Phase 15 (war stories, own improvement), second task. Heroes had a name but no effect beyond their rank; now they matter on the battlefield, which rewards keeping them alive and at the front of a group.
- `INSPIRE` in `rules.js` (`defBonus` 0.1, `range` 1). In `game.js`: `inspiredBy` (highest-ranked adjacent own named unit, not itself), `inspireBonus`, `inspiredUnits`; `defenseValue` multiplies by it, so attacks, counterattacks, previews and the AI's combat estimates all count it automatically. `previewAttack` returns `inspired`, `unitSummary` adds the note "inspired by Ivo +10 %".
- UI: hero panel line "Inspires 2 units next to it (+10 % defense)", gold chevron badge on the units the selected hero inspires, attack label "· target inspired (defense +10 %)", tooltip note. Help text updated.
- Balance (20 AI-vs-AI games, Medium): average game 21 turns (22 without inspiration), wins 9 : 11; no stalemates.
- No state structure change (`state.version` stays 24).
- Test adjusted (not weakened): "repair: the AI walks back …" needed ≥ 1 AI repair in 3 fixed seeds; with the slightly different battles none of the three repaired any more, so it now plays 6 seeds (the original 3 plus 3, 4, 10) with the same ≥ 1 requirement.
- Tests: +1 logic (unnamed veteran doesn't inspire, hero not itself, enemies not, exact defense multiplier, preview and counter, summary note, no stacking/highest rank, range, real attack equals preview). Smoke test: a spearman next to the selected hero is inspired, panel line, tooltip (`artifacts/screenshot-inspire.png`).
- Status: `npm run check` green (101 logic tests + smoke).

## 2026-11-17 – Heroes and hall of fame (v0.30.0)
- **Still open for Vladimír:** more AI opponents and scenarios with their own objectives change the victory rules – they wait for your "more AI yes" / "scenarios yes". `dev` (v0.26.0–v0.30.0) is ahead of `main` (v0.25.0) – please merge it.
- Phase 14 was done, so I opened phase 15 (war stories, own improvement). Veterans were just a star on a token; now a unit that survives long enough becomes a character you care about, which makes keeping wounded veterans alive (rest, swap, infirmary) feel worth it.
- `HEROES` in `rules.js` (`minRank` 1, `hallSize` 3, 30 invented names). In `game.js`: `unitTitle` ("Aldric (Warrior)"), `heroName` (reproducible from seed and unit id, skips names of living and remembered units, "Aldric II" when all are taken), `nameHero` (called on promotion in `gainXp`, in `spawnUnit` for academy recruits, and in the migration), `rememberHero` (named units that fall or are disbanded go to `state.fallen`), `hallOfFame(state, player)` (named units and anyone with kills, by kills, then XP). `attack` counts `unit.kills` for the killer – also for a defender whose counterattack kills – and the attack/ruin events carry name and kills, so replay is exact. Chronicle: "Warrior promoted to Veteran – now known as Ivo", "Ivo (Warrior) destroyed …". `unitSummary` / `armyOverview` gained `hero` and `kills`. `stateProblem` checks names, kills and `fallen`.
- UI: the gold name before the type in the unit panel, kills on the rank line, name and kills in the tooltip and the army list; "Hall of fame" under the statistics table (`hallOfFameHtml` in `stats.js`, names escaped) – the AI's side reads "Revealed when the game ends" until then, so it doesn't give away its army. Help text updated.
- State structure: `state.version` 24 (`fallen`, optional `unit.name`, `unit.kills`); migration names veterans already in the field.
- Tests: +2 logic (promotion names, kills, log, replay, reproducible names, academy spawn named, fallen and disbanded heroes remembered, counter-kill counted, numeral when names run out; hall of fame order/limit/sides, HTML hiding and escaping, summary and army fields, save/import, bad values, migration, 2 AI-vs-AI games: unique names, only veterans named, `stateProblem` clean). Smoke test: a kill promotes a unit, name in the panel and army list (`artifacts/screenshot-hero.png`); the game-over statistics show the hall of fame with both sides.
- Status: `npm run check` green (100 logic tests + smoke).

## 2026-11-16 – Animation speed (v0.29.0, same run as sentry and wall volley)
- Phase 14, third task of this run. The AI turn always played at one fixed speed; animations could only be skipped per turn (click / Esc) or switched off by the operating system's "reduce motion" setting. Experienced players want them faster, some want none.
- `ANIM_SPEEDS` in `rules.js` (normal ×1, fast ×0.4, off). Pure helpers in `game.js`: `animSpeedOf(id, reducedMotion)` (a valid saved choice wins; otherwise "reduce motion" → off, else normal) and `nextAnimSpeed`. It's a viewer preference stored with the other preferences in localStorage, not game state (`state.version` stays 23).
- UI: a ▶ / ⏩ / ⏸ icon button in the header next to sound, key A (shortcut overlay); switching to off also finishes a running animation. Help text updated. `window.__game.animSpeed()` for tests.
- Tests: +1 logic (order, multipliers, defaults with/without reduce motion, explicit choice wins, broken pref, cycle, key A; the shortcut uniqueness check now also covers W and A). Smoke test: the button switches to fast (icon, speed, saved preference), A to off and back to normal. Checked the header at 390 px: the extra button fits on the first row.
- Status: `npm run check` green (98 logic tests + smoke).

## 2026-11-16 – Wall volley (v0.29.0, same run as sentry)
- Phase 14, second task of this run (the version was bumped once for the run). Walls only helped a garrison that was attacked, so a besieger could sit next to a city for free – in AI-vs-AI games two of 20 matches ended in a 150-turn stalemate this way. Now walls fight back a little.
- `VOLLEY` in `rules.js` (`damage` 2, `range` 1, `minHp` 1). In `game.js`: `volleyTarget` (owned city with walls; enemy units within range above `minHp`; weakest first, then lowest id) and `cityVolleys`, called at the start of `endTurn` for the player ending the turn – one shot per walled city, no counterattack, never below 1 HP (walls harass, they don't kill, so no XP/kill bookkeeping is needed). New replayable `volley` event (`applyEvent` sets the HP), chronicle entry seen by both sides, `turnReport` counts the victim's unit as wounded. `threatTiles` adds +1 on tiles next to a known enemy walled city, so both the T overlay and the AI's danger map (archers and catapults keep out) know about it. Walls' description updated.
- Balance (20 AI-vs-AI games, Medium): 86 volleys; both former 150-turn stalemates now end (average game 20 turns instead of 34), wins 9 : 11.
- UI: the player's own volleys play right after "End turn" (a stone flies on an arc from the city, then a "−2 ▣" floater, `hit` sound); the AI's volleys are appended to the AI-turn animation and report. Help text updated.
- No state structure change (`state.version` stays 23).
- Tests: +2 logic (weakest target, damage, one shot per city, exact event, sound, chronicle, replay, turn report for victim and shooter, silent on the other player's turn, minHp – 2 HP takes 1, 1 HP is skipped for the next target; own units / out of range / no walls / neutral / other player's turn don't shoot, threat overlay +1 only for known enemy walls and not on the city tile, 3 real AI-vs-AI games: volleys only from walled cities of the player ending the turn and never kill). Smoke test: walls + an AI warrior next to the capital, end turn, mid-flight screenshot (`artifacts/screenshot-volley.png`), chronicle line, threat overlay around the AI's walled capital.
- Small fix: the smoke test's "end-turn reminder" comment was lost in the previous commit; restored.
- Status: `npm run check` green (97 logic tests + smoke).

## 2026-11-16 – Sentry (v0.29.0)
- **Still open for Vladimír:** more AI opponents and scenarios with their own objectives change the victory rules – they wait for your "more AI yes" / "scenarios yes". `dev` (v0.26.0–v0.29.0) is ahead of `main` (v0.25.0) – please merge it.
- Phase 13 was done, so I opened phase 14 (command comfort, own improvement). A unit guarding a pass or healing behind the lines had to be skipped by hand every turn (Tab kept returning to it, the end-turn button kept counting it); fortify was the only way to silence it, and it can't be used after moving and never wakes up.
- `SENTRY` in `rules.js` (`radius` 2). In `game.js`: `canSentry`, `sentry`, `checkSentries`, `SENTRY_TEXT`. `unit.sentry` is `'watch'` (healthy) or `'heal'` (wounded – "rest until healed"). Going on watch costs no moves and cancels a move/explore order; the unit can still be clicked and moved. `activeUnits` (Tab, end-turn reminder) skips it, `unitStatus` gives the new army status `sentry` ("on watch", between fortified and done). `runOrders` first calls `checkSentries`: a visible enemy within 2 tiles → `alert`, a resting unit back at full HP → `healed`. Every action that ends fortify also ends the watch (move, swap, attack, fortify, upgrade, move order, explore, pillage, repair, road; also in `applyEvent` replay); `cancelOrder` is the "Wake up" button. `stateProblem` rejects other values. The AI doesn't use it.
- UI: "👁 Sentry" / "👁 Rest until healed" button in the unit panel, key W (shortcut overlay), panel line with "✖ Wake up", a small eye badge on the unit (green-tinted while resting), "on watch" / "resting" in the tooltip of own units, banner lines "Archer on watch spotted an enemy nearby." / "Warrior is fully healed and ready.". Help text updated.
- State structure: `state.version` 23 (optional `unit.sentry`), trivial migration.
- Test adjusted (not weakened): the army overview test's expected `counts` now include the new `sentry: 0` status.
- Tests: +2 logic (watch costs no moves, not twice, Tab/army/summary, quiet turns keep it, an adjacent enemy wakes it as `alert` and it is ready again, keys W; rest until healed wakes as `healed`, a far enemy doesn't wake it, move/attack/fortify/cancel/move order wake it, sentry cancels a move order, replay clears it, who can't – enemy unit, fortified, game over – save/import, bad value, migration). Smoke test: rests a wounded unit with the panel button (Tab moves on, end-turn count drops), W puts the next on watch (`artifacts/screenshot-sentry.png`), after the AI turn the healed unit wakes and the banner says so.
- Status: `npm run check` green (95 logic tests + smoke).

## 2026-11-16 – Road building (v0.28.0, same run as swap places)
- Phase 13 (logistics, own improvement), second task of this run (the version was bumped once for the run, as `CLAUDE.md` asks). Roads came only with the map; now the player can shape the network – e.g. a fast lane from the capital to the front, or through forest and hills where a road helps most (cost 2 → ½).
- `ROADWORK` in `rules.js` (`gold` 4, `aiReserve` 16). In `game.js`: `canBuildRoad(state, unit, { affordable })` (own unit of the current player of any kind, hasn't attacked, a move left, roadless non-city tile in its own territory), `roadLinks` (road tiles / cities next to a tile), `buildRoad` (sets `tile.road` and `tile.roadBuilt`, −4 gold, the unit's turn ends, fortify / orders cleared, chronicle entry). New replayable `road` event (floater "🛤 road built", the `build` sound). Not undoable. A built road is an ordinary road: both sides use it, bridges over rivers appear when both banks have a road.
- AI: `layRoad` at the end of its turn – with at least 16 + 4 gold, one idle unit a turn (moves left, nothing else to do) builds where the road joins its network (next to a road or own city), preferring links between two pieces and costly terrain, never with a visible enemy within 2 tiles. Rare in practice (~1.5 roads per AI-vs-AI game on Medium) – AI units seldom stand idle, which is fine: roads are mostly a player tool.
- UI: "🛤 Build road (4 gold)" button in the unit panel (disabled when short of gold), key B, the tile panel says "built road". Help text and shortcut overlay updated.
- State structure: `state.version` 22 (optional `tile.roadBuilt`), trivial migration.
- Test adjusted (not weakened): the smoke "Same map again" check now also removes built roads (`roadBuilt`) before comparing maps, because road building is a third thing a game may change on its map.
- Tests: +2 logic (gold, turn spent, cheaper step next to the capital, event replay, not undoable, sound, save/import keeps the road, migration, keys B; who can't – no gold, attacked, no moves, not own turn, already a road, in a city, outside own territory; disabled-button case; the AI keeps its reserve, doesn't build next to an enemy, builds otherwise; AI-vs-AI games build roads without going under the reserve). Smoke test: a warrior next to the capital builds a road with the panel button, checks gold, tile and chronicle (`artifacts/screenshot-road.png`).
- Small fix: the unit panel said "already attacked" also after pillage, repair or road building (they end the turn the same way); a unit with no moves left now reads "done for this turn".
- Status: `npm run check` green (93 logic tests + smoke).

## 2026-11-16 – Swap places (v0.28.0)
- **Still open for Vladimír:** more AI opponents and scenarios with their own objectives change the victory rules – they wait for your "more AI yes" / "scenarios yes". `dev` (v0.26.0–v0.28.0) is ahead of `main` (v0.25.0) – please merge it.
- Phase 13 (logistics, own improvement), new task. A wounded unit at the front with a fresh one right behind it could only get out by walking around – often impossible in a narrow pass or next to a river. Now the two can trade tiles.
- In `game.js`: `canSwap` (both own units of the current player, neighbours, both with a move left and not having attacked, scouts never into a foreign city), `swapPartners`, `swapUnits`. Each unit pays the step cost into the other's tile (with any points left a single step is always allowed, as for a normal first step); fortify, move order and explore end for both; chronicle "Warrior and Spearman swapped places". It emits two one-step `move` events marked with `swap` (partner id), so replay, animation, sounds and last-seen markers work unchanged; `isUndoableMove` accepts exactly such a pair, so Z undoes a swap that revealed nothing.
- AI: `relieveWounded` in `ai.js` – a wounded unit with a visible enemy next to it swaps with a healthy (≥ 60 % HP) melee neighbour that is not a garrison and stands on a quieter tile, then retreats from there with what is left of its moves. ~2 swaps per game in 30 AI-vs-AI games on Medium.
- UI: "⇄ Swap places" button in the unit panel (names the partner when there is only one; then it swaps at once), key S. With more partners the panel says "Tap a unit with a blue ring" and the partners get a light-blue dashed ring with two arrows; any other tap or Esc cancels. Picking is an explicit mode, so touch needs no second tap. Help text and shortcut overlay updated.
- No state structure change (`state.version` stays 21).
- Tests: +2 logic (positions, step costs, orders/fortify cleared, log, event replay, undoable only as a marked pair; who can't – no moves, attacked, not neighbours, enemy, not own turn, game over, itself; `decideTap` swap / cancel and normal selection without picking, key S; the AI relieves a wounded warrior with a healthy spearman, but not with a hurt one, a garrison, or without an enemy next to it). Smoke test: three own units, S starts picking (`artifacts/screenshot-swap.png`), a click swaps, Z undoes.
- Status: `npm run check` green (91 logic tests + smoke).

## 2026-11-16 – Rally points (v0.27.0)
- **Still open for Vladimír:** more AI opponents and scenarios with their own objectives change the victory rules – they wait for your "more AI yes" / "scenarios yes". `dev` (v0.26.0–v0.27.0) is ahead of `main` (v0.25.0) – please merge it.
- Phase 12 was done, so I opened phase 13 (logistics, own improvement). Sending every new recruit to the front took a selection and a click each turn; now a city can stream its recruits to a flag.
- In `game.js`: `rallyPath` (cheapest path over explored passable tiles, units ignored), `canRally`, `setRally`, `clearRally`, `rallyTarget` (the flag, or – when an own unit already stands there – the nearest free reachable tile in rings 1–2, in a fixed order). `buyUnit` gives the recruit `goto` to that target; `spawnUnit` got an optional `extra` merged into the unit before the spawn event, so the replayed event carries the order. The recruit has no moves on the turn it is bought, so it walks off via the existing `runOrders` at the start of the next turn (and stops like any order when an enemy is in sight). Capturing a city deletes `city.rally` (also in `applyEvent`). `stateProblem` rejects a flag off the map. The AI doesn't use flags (it moves its own recruits).
- UI: "Rally point" section in the own city panel – "🚩 Set rally point", then a click on a known tile sets it (hovering previews a dashed white route; any other click or Esc cancels); with a flag: "🚩 New units march to the flag N tiles away by themselves", "Move flag" / "✖ Remove". Key G. Red pennant flags drawn on the map for all own rally points, the route for the selected city. Help text and shortcut overlay updated.
- State structure: `state.version` 21 (optional `city.rally`), trivial migration.
- Tests: +2 logic (valid/invalid flag tiles, path shape, recruit gets the order incl. event replay, walks there over turns and arrives, taken flag → neighbour tile, save/import incl. a broken flag, clear, not on the other player's turn, migration; capture removes the flag also on replay, fog: no flag in unexplored land, `decideTap` picking actions, key G). The shortcut test also checks G is claimed once. Smoke test: selects the capital, sets the flag with the panel button and a map click, checks panel text, recruits with key 1, checks the order (`artifacts/screenshot-rally.png`), ends the turn and checks the recruit left the city.
- Status: `npm run check` green (89 logic tests + smoke).

## 2026-11-16 – Repair pillaged resources (v0.26.0)
- **Still open for Vladimír:** more AI opponents and scenarios with their own objectives change the victory rules – they wait for your "more AI yes" / "scenarios yes". Thanks for merging v0.25.0 into `main`; `dev` now only adds v0.26.0 on top.
- Phase 12 (economy war, own improvement), new task. After pillage the victim could only wait 4 turns; now guarding and recovering resources is an active choice: spend a unit's turn and a little gold to get the income back right away.
- `REPAIR` in `rules.js` (`gold` 3). In `game.js`: `canRepair(state, unit, { affordable })`, `repair`. A unit of the current player of any kind (scouts too – no capture involved) that hasn't attacked and has a move left, standing on a pillaged resource in its own territory, pays 3 gold; `pillagedUntil` is removed (income / horse discount back at once), the unit's turn ends, fortify / move order / explore cleared. New `repair` event (replayable incl. the gold, floater "🔧 repaired", new synthesized hammer-and-ring `repair` sound), chronicle entry. Not undoable (extra event). A repaired resource can be pillaged again.
- AI: `repairGoals` in `ai.js` – own resources pillaged for 2+ more rounds within 3 tiles are movement goals (weight 0.9, scouts too; like ruins and pillage goals they don't stop exploring); a unit with nothing to attack or pillage repairs where it stands, before or after moving. 3 repairs in 3 AI-vs-AI test games.
- UI: "🔧 Repair (3 gold)" button in the unit panel (disabled when short of gold), key R (shortcut overlay), the tile panel of an own pillaged resource says a unit standing there can repair it. Help text updated.
- No state structure change (`state.version` stays 20).
- Tests: +2 logic (gold, income and discount return at once, event replay, not undoable, sound, can be pillaged again, scouts can repair; who can't – no gold, attacked, no moves, not own turn, nothing pillaged, enemy territory; orders cleared, key R; AI repairs where it stands, goals only for own resources pillaged long enough and nearby, real AI-vs-AI games repair and never go into debt). Smoke test: the player's pillaged resource is repaired with the panel button, checks gold and chronicle (`artifacts/screenshot-repair.png`).
- Status: `npm run check` green (87 logic tests + smoke).

## 2026-11-15 – Pillage (v0.25.0)
- **Still open for Vladimír:** more AI opponents and scenarios with their own objectives change the victory rules – they wait for your "more AI yes" / "scenarios yes". `dev` (v0.9.0–v0.25.0) is far ahead of `main` (v0.8.0) – please merge it.
- Phase 11 was done, so I opened phase 12 (economy war, own improvement). Resources were only ever a passive bonus; now they are something to raid and to guard, which gives fast units a job besides charging.
- `PILLAGE` in `rules.js` (`gold` 6, `turns` 4). In `game.js`: `isPillaged`, `pillageTurnsLeft`, `canPillage`, `pillage`. A unit of the current player that is not a scout (`noCapture`), hasn't attacked and has a move left, standing on a working resource in another player's territory (not own, not neutral), plunders it: +6 gold, the unit's turn ends (fortify / move order / explore cleared), `tile.pillagedUntil` is set so the owner misses exactly 4 of its own turns (+1 round when the owner moves before the raider in a round). A pillaged gold mine gives no income, pillaged horses give no discount (`cityIncome`, `unitCost`). At the start of a round recovered tiles drop the field. New `pillage` event (replayable, floater "🔥 pillaged +6", synthesized crackle sound for the raider, the `bane` sound for the victim), chronicle entry seen by both sides. The enemy turn report counts pillaged resources ("A resource of yours was pillaged.", red ✕ on the tile).
- AI: `pillageGoals` in `ai.js` – known working enemy resources within 4 tiles are movement goals (weight 0.95, not for scouts; like ruins they don't stop exploring); a unit with nothing to attack pillages where it stands, before or after moving. In 20 AI-vs-AI games on Medium: ~2.75 pillages per game.
- UI: "🔥 Pillage (+6 gold)" button in the unit panel, key P (shortcut overlay), a burning ash marker over the resource on the map, "🔥 Pillaged – out of use, works again in N rounds" in the tile panel, "(🔥 pillaged, N more)" in the city's resource list. Help text updated.
- State structure: `state.version` 20 (optional `tile.pillagedUntil`), trivial migration.
- Test adjusted (not weakened): the smoke "Same map again" check now also strips `pillagedUntil` before comparing maps, because pillage is now a second thing a game changes on its map (the AI raided during the simulated game).
- Tests: +2 logic (gold, lost income and discount, event replay, not undoable, exactly 4 missed incomes for both orders of play, recovery removes the field, turn report and text, who can't – scout, attacked, no moves, not own turn, own/neutral territory, no resource – orders cleared, migration; the AI pillages where it stands, gets goals only for working enemy resources within range, real AI-vs-AI games keep `pillagedUntil` in range). Smoke test: button pillages the AI's gold mine, P its horses, checks gold, chronicle and tile panel (`artifacts/screenshot-pillage.png`).
- Status: `npm run check` green (85 logic tests + smoke).

## 2026-11-15 – Auto-explore (v0.24.0)
- **Still open for Vladimír:** more AI opponents and scenarios with their own objectives change the victory rules – they wait for your "more AI yes" / "scenarios yes". `dev` (v0.9.0–v0.24.0) is far ahead of `main` (v0.8.0) – please merge it.
- Phase 11 (exploration, own improvement), new task. Sending a scout around the fog took a click per turn; now it can be sent once.
- `EXPLORE` in `rules.js`. In `game.js`: `exploreTarget` (Dijkstra over explored tiles only, avoiding foreign cities and visible enemies; score = unexplored tiles in sight from the tile, + 6 for a believed ruin, divided by 1 + cost in turns; deterministic), `canExplore`, `setExplore`, `followExplore` (up to 3 legs a turn, re-picking the target after each leg; if no tile of the route is reachable this turn – e.g. an own unit on the first step – it gets as close as it can). `runOrders` walks exploring units at the start of the turn like move orders; an enemy within 2 tiles ends the order ('interrupted'), so does "nothing left" ('done'). A manual move, fortify and cancel end it; `unitStatus` counts an exploring unit as marching.
- Simulation (warrior / scout, 6 seeds × 3 sizes, no enemies): always ends with 99–100 % of the map explored (scout on Medium in 11–17 turns).
- UI: "🧭 Explore" button in the unit panel (only with fog and something left to find), key X, "Exploring the fog" line with "✖ Stop exploring", small compass badge on the unit, "exploring" in the unit tooltip, banner when a unit stops or has nothing left. Help and shortcut overlay updated.
- State structure: `state.version` 19 (optional `unit.explore`), trivial migration.
- Test adjusted (not weakened): the shortcut test used `x` as an example of an unbound key; it now uses `q`, and `x` joined the "claimed by exactly one entry" check.
- Tests: +2 logic (route over explored tiles only, walking turn by turn on 2 seeds until 'done' with no foreign city ever entered and explored land never shrinking; enemy interrupt, cancel by move/cancel/fortify, not on the AI's turn, a ruin attracts with the bonus and gets looted, nothing without fog, key X, migration). Smoke test: panel button sends the unit (moved, saw new land, panel text), X sends the next one (`artifacts/screenshot-explore.png`).
- Status: `npm run check` green (83 logic tests + smoke).

## 2026-11-14 – Ancient ruins (v0.23.0)
- **Still open for Vladimír:** more AI opponents and scenarios with their own objectives change the victory rules – they wait for your "more AI yes" / "scenarios yes". `dev` (v0.9.0–v0.23.0) is far ahead of `main` (v0.8.0) – please merge it.
- Phase 10 was done, so I opened phase 11 (exploration, own improvement). Exploring the fog had no reward of its own and scouts were only eyes; now there is something to find.
- `RUINS` in `rules.js`. `placeRuins` in `map.js` (own RNG, so terrain, cities, roads, rivers and resources stay the same for all seeds): ruins come in pairs – one nearer each capital, at about the same distance from it – 1 pair on Small, 2 on Medium, 4 on Large; on passable land, not on resources, ≥ 3 from capitals, ≥ 2 from cities, ≥ 3 apart, reachable.
- `exploreRuin` in `game.js`: the first unit (any type, scouts too) to end its move on a ruin explores it. The reward depends only on seed and tile (`ruinKind`): **Treasure** +15 gold (weight 3), **Forgotten drill yard** +3 XP (= Veteran, with the promotion heal; weight 2), **Old map** reveals the land within 4 tiles (weight 2; treasure instead without fog), **Wandering warriors** a free Warrior next to the explorer (weight 2; treasure if no free tile). New `ruin` event (replayable by `applyEvent`, own synthesized "discover" sound, floater "Ruins: +15 gold" etc.), chronicle entry seen only by those who saw it.
- Fog: `tile.ruinGone` lists the players who know a ruin was looted; `ruinBelieved(state, q, r, viewer)` – a ruin looted in the fog keeps showing for the other side until they see that tile again, so nothing leaks. `updateExplored` teaches it.
- AI: `ruinGoals` in `ai.js` – known (believed) ruins within 6 tiles become movement goals (weight 0.9) for all units incl. scouts; a ruin the AI knows is gone is not. Hard AI sees the truth.
- UI: violet disc with broken columns on the tile (top left, resources are top right); the tile panel says "Ancient ruins: …"; help text updated. Looting is not undoable (it's an extra event).
- State structure: `state.version` 18 (`tile.ruin`, `tile.ruinGone`), old maps get no ruins.
- Tests adjusted (rules changed, not weakened): the scout test now allows ruin goals next to explore goals ("scouts only explore (or loot ruins)"); the smoke "Same map again" check now compares maps with looted ruins put back, since looting is the only change a game makes to its map.
- Tests: +4 logic (fair placement on all sizes and seeds, deterministic; each reward incl. both fallbacks, event replay, not undoable, no second loot; looting in the fog: believed by the other side, hidden in the chronicle, learned on sight, AI goal appears/disappears, migration; AI armies loot ruins in real games). Smoke test hovers a ruin, checks the panel, moves a unit onto it, checks the chronicle (`artifacts/screenshot-ruins.png`).
- Status: `npm run check` green (81 logic tests + smoke).

## 2026-11-14 – Army panel (v0.22.0)
- **Still open for Vladimír:** more AI opponents and scenarios with their own objectives change the victory rules – they wait for your "more AI yes" / "scenarios yes". `dev` (v0.9.0–v0.22.0) is far ahead of `main` (v0.8.0) – please merge it.
- Phase 10 (clarity and feedback, own improvement), new task. With a bigger army it was hard to see who still needs orders and where everyone is; Tab only walks through ready units one by one.
- `unitStatus`, `unitWhere`, `armyOverview` and `ARMY_STATUS` in `game.js` (pure): every own unit gets a status – ready (same rule as Tab / `activeUnits`), marching (move order, no moves left), fortified, done – and a place in words ("in Oakford", "2 tiles from Oakford"). Only cities the player has explored are named, so the list never gives away a city in the fog. Rows are sorted ready → marching → fortified → done, then by id.
- UI: a collapsible "Army" panel at the top of the side panel. Its summary shows "5 units · 2 ready" even when closed; open, each row has the unit symbol, name with rank stars, place, HP (red when wounded) and a status badge (ready in gold, done faded). Clicking a row selects the unit (and the city under it); on a phone with the zoomed map the frame scrolls to the unit. Rows are disabled during animations, the list is redrawn only on change. Help text updated.
- No state structure change (`state.version` stays 17).
- Tests: +1 logic (statuses and their order, ready rows = `activeUnits`, enemy units not listed, place texts incl. "1 tile from", a fogged enemy city is never named, without fog it is, empty army, JSON). Smoke test opens the panel with a fortified unit and a wounded, finished veteran, checks rows, order, summary and HP text, clicks a row to select (`artifacts/screenshot-army.png`), then on a 390 px phone with the zoomed Large map checks that picking a unit scrolls it into the frame without horizontal page scroll (`artifacts/screenshot-army-mobile.png`).
- Status: `npm run check` green (77 logic tests + smoke).

## 2026-11-13 – Last-seen markers (v0.21.0)
- **Still open for Vladimír:** more AI opponents and scenarios with their own objectives change the victory rules – they wait for your "more AI yes" / "scenarios yes". `dev` (v0.9.0–v0.21.0) is far ahead of `main` (v0.8.0) – please merge it.
- Phase 10 (clarity and feedback, own improvement), new task. In the fog an enemy that steps out of sight simply vanished, so the player had to remember where it went. Now it leaves a marker.
- `SIGHTINGS` in `rules.js` (`maxAge` 3). `updateSightings(state, viewer, events)` in `game.js` keeps `state.sightings[viewer]`: enemy units in sight are remembered with type, HP and turn; a unit seen walking out of sight (a `move` event whose path leaves the visible tiles) is put on the first fogged tile of its path – where it was last seen heading, never where it really ended; a marker is dropped when its tile is in sight again, when the unit itself is seen again (it moves to the real position), or after 3 turns. `lastSeen`, `lastSeenAt`, `lastSeenText` for drawing and texts. Without fog or after the game ends there are none. Only things the player saw are stored, so nothing leaks (a marker may sit on a still-unexplored tile the unit was seen walking into; the tile stays dark).
- UI: the faded, dashed unit symbol in the owner's light colour with a small "?" badge; hovering it shows "AI: Horseman – last seen here 1 turn ago (HP 8/10)" in the tooltip and the side panel (so it works on touch too). Markers are hidden while the AI turn is animating. Updated after every player action, after the AI turn and after move orders walk on; undo restores them with the state. Help text updated.
- State structure: `state.version` 17 (`sightings`), migration from 16 gives empty markers.
- Tests: +2 logic (marker when our unit walks away, text, aging and forgetting at `maxAge`, walking out of sight puts the marker right after the last visible tile of the path, seeing the tile clears it, seeing the unit replaces it, no own units, no fog / game over gives none, JSON, migration; real AI turns on 3 seeds with the player moving: no marker ever on a tile in sight or older than 3 turns). Smoke test makes an AI horseman step from a visible tile into the fog, checks the single marker, the tooltip and the panel text, and saves `artifacts/screenshot-lastseen.png`.
- Status: `npm run check` green (76 logic tests + smoke).

## 2026-11-13 – Enemy turn report (v0.20.0)
- **Still open for Vladimír:** more AI opponents and scenarios with their own objectives change the victory rules – they wait for your "more AI yes" / "scenarios yes". `dev` (v0.9.0–v0.20.0) is far ahead of `main` (v0.8.0) – please merge it.
- Phase 9 was done, so I opened phase 10 (clarity and feedback, own improvement). The AI turn animates fast and a lot happens around the map; now it's clear afterwards what it cost you.
- `turnReport(before, events, viewer)` in `game.js` (pure): replays the enemy turn's events on a copy of the state from before it and counts own units lost (by type), own units wounded (and still alive), attackers that fell to counterattacks and own cities lost, plus `spots` (tiles of the losses). Only things the player always knows about are counted, so nothing hidden in the fog leaks. `reportText()` makes one sentence ("Enemy turn: you lost Warrior ×2 and the city Oakford. 1 unit was wounded."), `reportIsBad()` decides the colour.
- UI: the existing notice bar below the header shows the report after the AI turn (together with a random event or stopped move orders), red when something was lost, green when only attackers fell; nothing when the enemy didn't touch you. Tiles of the losses get a small red ✕ until the turn ends. `showNotice` was split (`happeningText`). Help text updated.
- No state structure change (`state.version` stays 16); the report and marks live only in memory.
- Tests: +2 logic (losses/wounded/fallen/spots from a staged turn, a wounded-then-destroyed unit counts only as lost, a captured city incl. "your capital", the enemy's own view is empty, texts; real AI turns on 3 seeds: reported losses = actual drop in own units and cities). Smoke test stages an AI horseman killing a unit, checks the red banner and the ✕ mark at 390 px without horizontal scroll, and that ending the turn clears it (`artifacts/screenshot-report.png`).
- Status: `npm run check` green (74 logic tests + smoke).

## 2026-11-12 – Cavalry charge (v0.19.0)
- **Still open for Vladimír:** more AI opponents and scenarios with their own objectives change the victory rules – they wait for your "more AI yes" / "scenarios yes". `dev` (v0.9.0–v0.19.0) is far ahead of `main` (v0.8.0) – please merge it.
- Phase 9 (battlefield tactics, own improvement), new task. `CHARGE` in `rules.js` (`types` ['horseman'], `minMoves` 2, `atkBonus` 0.25, `blockedBy` ['forest']). `movesSpent`, `chargeReady`, `chargeBonus` in `game.js`: a horseman that has spent at least 2 move points this turn before attacking gets +25 % attack; no charge against a defender in forest. Adds to flank and high ground (`1 + flank + high + charge`), never to the counterattack. `previewAttack` returns `charge`, so the real attack, the UI and the AI use the same number. Spearmen keep their double strength against horsemen, so a charge into spears is still a bad idea.
- UI: the attack tooltip / touch confirmation appends "· charge +25 %"; the unit panel shows "charge ready (+25 %)" in orange; the tile panel for forest says "no cavalry charge". Help text updated.
- AI: `planStrike` now sets the tentative `movesLeft` along with the tentative position when it evaluates strike tiles, so it sees the charge bonus of a longer approach (before, previews from other tiles silently assumed no movement spent).
- Smoke test: the AI horsemen now hit harder, so on seed 12345 the passive player lost all units in the first 5 turns and the "Tab selects a unit" step had nothing to select. I changed the starting seed of that section to 54321 (player still has a unit at turn 6); the check itself is unchanged.
- No state structure change (`state.version` stays 16).
- Tests: +2 logic (no charge when fresh or after 1 move point, other types never, not into forest, a real 2-tile move then attack deals the previewed charged damage with no stronger counter, spent after attacking; the AI horseman rides up 2 tiles and strikes with the charge). Smoke test makes the flanking attacker a horseman with 2/4 moves, checks the tooltip and the panel, and saves `artifacts/screenshot-charge.png`.
- Status: `npm run check` green (72 logic tests + smoke).

## 2026-11-12 – High ground (v0.18.0)
- **Still open for Vladimír:** more AI opponents and scenarios with their own objectives change the victory rules – they wait for your "more AI yes" / "scenarios yes". `dev` (v0.9.0–v0.18.0) is far ahead of `main` (v0.8.0) – please merge it.
- Phase 9 (battlefield tactics, own improvement) got a new task. `HIGH_GROUND` in `rules.js` (`atkBonus` 0.2, `terrain` ['hills']). `highGroundBonus` in `game.js`: an attacker standing on hills that attacks a unit not on hills gets +20 % attack – melee and ranged alike. It adds to the flank bonus (`1 + flank + high`) and, like flanking, doesn't boost the counterattack. `previewAttack` returns `high`, so the real attack, the UI and the AI use the same number.
- UI: the attack tooltip / touch confirmation appends "· high ground +20 %"; the tile panel for hills says "high ground (attack +20 % against units below)". Help text updated.
- AI: no special code – `planStrike` evaluates attacks from every reachable tile via `previewAttack` and already liked hills for their defense, so it now picks hilltop strike positions a bit more often.
- Small cleanup: the `RIVER` constant in `rules.js` was separated from its comment by `FLANK`; moved back.
- No state structure change (`state.version` stays 16).
- Tests: +1 logic (bonus only from hills against a unit below, not hills vs. hills, not on the counter, ranged attackers too, stacks with flanking, the real attack deals the previewed damage). Smoke test turns the flanking attacker's tile into hills, checks the tooltip and saves `artifacts/screenshot-highground.png`.
- Status: `npm run check` green (70 logic tests + smoke).

## 2026-11-11 – AI lines up flanking attacks (v0.17.0)
- **Still open for Vladimír:** more AI opponents and scenarios with their own objectives change the victory rules – they wait for your "more AI yes" / "scenarios yes". `dev` (v0.9.0–v0.17.0) is far ahead of `main` (v0.8.0) – please merge it.
- Follow-up to flanking (phase 9). Before, AI melee units moved and attacked one at a time, so the first attacker on a target never had a flank bonus. Now `planStrike(…, { lineUp })` only moves a melee unit into its strike position and returns the plan `{ unitId, targetId, damage }`; `strikeLinedUp` makes the attacks after all units have acted, in plan order, so every strike counts the others standing next to the target.
- To keep focus fire: later plans judge targets by the HP left after the already lined-up hits (`pendingDamage`), skip targets those hits already destroy, and a strike that kills on its own is made at once. If the planned target is gone or the attack no longer pays off, the unit takes its best other attack. Archers, catapults, garrisons and retreating units behave as before.
- A first version without the pending-damage estimate was clearly worse (small 52 : 63, medium 50 : 66) – it spread damage instead of finishing units. Final version, new vs. previous AI, both sides of each seed, Normal, fog: Small 99 : 99, Medium 102 : 96 (100 seeds each), Large 30 : 28 (30 seeds) – neutral to slightly better in AI-vs-AI. Instrumented: average flank per AI melee strike went up by ~3 percentage points; against a human the AI now visibly surrounds a unit before hitting it.
- No state structure change (`state.version` stays 16), no UI change.
- Tests: +2 logic (three AI warriors line up around a tough spearman without attacking, the first strike carries +20 %, then all strike; a lone kill is made right away and a target doomed by lined-up hits isn't picked again).
- Status: `npm run check` green (69 logic tests + smoke).

## 2026-11-11 – Flanking (v0.16.0)
- **Still open for Vladimír:** more AI opponents and scenarios with their own objectives change the victory rules – they wait for your "more AI yes" / "scenarios yes". `dev` (v0.9.0–v0.16.0) is far ahead of `main` (v0.8.0) – please merge it.
- Phase 8 was done, so I opened phase 9 (battlefield tactics, own improvement) in the roadmap.
- `FLANK` in `rules.js` (`perUnit` 0.1, `max` 3). `flankers` / `flankBonus` in `game.js`: every other unit of the attacker's owner standing next to the defender adds +10 % attack, up to +30 %. Works for ranged attackers too (the flankers must be adjacent to the target, not to the archer). The counterattack is not boosted. `previewAttack` returns `flank`, so the real attack, the UI and the AI all use the same number.
- UI: the attack tooltip / touch confirmation says "Flanking attack (+20 %)" (or "Flanking attack across a river …"), and while a target is hovered or awaiting confirmation the flanking units get a small yellow ⚔ badge. Help text updated.
- AI: no special code – it evaluates attacks through `previewAttack`, so it profits from flanks it happens to have; it doesn't yet plan attack order to maximise them (possible follow-up).
- No state structure change (`state.version` stays 16). No existing test needed changing.
- Tests: +1 logic (no bonus alone, enemies and distant units don't count, +10 % per flanker capped at 3, damage never drops and counter never rises with more flankers, ranged attacker, the real attack deals the previewed damage). Smoke test sets up two flankers, checks the tooltip text and saves `artifacts/screenshot-flank.png`.
- Status: `npm run check` green (67 logic tests + smoke).

## 2026-11-10 – Disbanding units (v0.15.0)
- **Still open for Vladimír:** more AI opponents and scenarios with their own objectives change the victory rules – they wait for your "more AI yes" / "scenarios yes". `dev` (v0.9.0–v0.15.0) is far ahead of `main` (v0.8.0) – please merge it.
- Phase 8 had no open task, so I added one (own improvement): disbanding.
- `DISBAND` in `rules.js` (`refundShare` 0.4). `disbandRefund`, `canDisband`, `disbandUnit` in `game.js`: the current player can dismiss an own unit at any time during their turn (also after it has acted). In an own city it returns 40 % of the type's base price, rounded down (warrior 4, horseman 6, catapult 8 …); elsewhere, or in a foreign city, nothing. It frees the city tile for recruiting right away. New `disband` event (replayable; gold is not replayed, as for recruiting and upgrades), a "✖ disbanded +N" floater, a soft falling sound, and a chronicle entry that follows the fog rules.
- UI: "✖ Disband (+N gold)" button at the end of the unit panel; the first press turns it red ("Really disband?"), a second press within 4 s dismisses the unit. Key D does the same; added to the shortcut table / overlay and the help text.
- The AI doesn't disband (it has no upkeep to save and already retrains idle scouts).
- No state structure change (`state.version` stays 16).
- Tests: +3 logic (refund per type and always below the recruit price, removal, log, second disband refused, recruit right after, event replay and sound; no refund outside / in a foreign city; refused on the other player's turn, for an enemy unit, after game over, unknown id; the enemy doesn't see it in the fog), key D in the shortcut test. Smoke test disbands the retrained horseman from the panel: first press asks, second removes it and adds 6 gold (`artifacts/screenshot-disband.png`).
- Status: `npm run check` green (66 logic tests + smoke).

## 2026-11-10 – Unit upgrades (v0.14.0)
- **Still open for Vladimír:** more AI opponents and scenarios with their own objectives change the victory rules – they wait for your "more AI yes" / "scenarios yes". `dev` (v0.9.0–v0.14.0) is far ahead of `main` (v0.8.0) – please merge it.
- Phase 7 was done, so I opened phase 8 (own improvements) in the roadmap.
- `UPGRADES` / `UPGRADE` in `rules.js`: warrior → spearman or horseman, archer → catapult, scout → horseman. Price = recruit price of the new type in that city (barracks, faction and resource discounts apply) − base price of the old type + 2, at least 3.
- `upgradeOptions`, `upgradeCost`, `upgradeUnit` in `game.js`: only a unit of the current player standing in an own city that hasn't moved or attacked this turn (so not a unit recruited this turn; a fortified one may, and loses the fortification). It keeps its XP/rank and its share of HP (rounded up), and its turn ends. New `upgrade` event (replayable, animated with a "⇧ Horseman" floater, promote sound) and a chronicle entry.
- UI: an "Upgrade" block in the unit panel with price and the new type's stats; help text updated.
- AI (`upgradeSomething` in `ai.js`, with gold to spare above its usual reserve): a warrior in a city with a visible enemy horseman within 4 tiles becomes a spearman; a scout in a city with nothing left to explore becomes a horseman. Measured (new vs. previous AI, both sides of each seed, Normal, fog): Small 57 : 62, Medium 60 : 56 (60 seeds each) – neutral within noise, so it adds variety without changing AI strength.
- No state structure change (`state.version` stays 16).
- Tests: +3 logic (price formula, HP share and XP kept, turn ends, replay; refused without gold, after moving, when freshly recruited, outside or in a foreign city, on the other player's turn, wrong path; faction discount; AI upgrades only when it makes sense and has gold; AI vs AI games stay consistent). Smoke test retrains a veteran scout into a horseman from the panel (`artifacts/screenshot-upgrade.png`).
- Status: `npm run check` green (63 logic tests + smoke).

## 2026-11-09 – Map number and "Same map again" → v0.13.0
- **Still open for Vladimír:** more AI opponents and scenarios with their own objectives change the victory rules – they wait for your "more AI yes" / "scenarios yes". `dev` is now v0.13.0, several versions ahead of `main` (v0.8.0) – please merge it.
- Every game already had a seed; now it is visible as the **map number**: the side panel says "Map 123456789 · Difficulty: …". The new game dialog has a "Map" box: an optional map number (empty = random; invalid input is caught by the browser's form check, `pattern` 1–9 digits) and a "This map: N" button that fills in the current one. The same number on the same size always gives the same map, so maps can be shared.
- The game-over banner has **↻ Same map again**: restarts the identical starting game (map, size, factions, difficulty, fog, events).
- `parseSeed(text)` and `restartOptions(state)` in `game.js` (pure). `startNewGame` now keeps a given seed. A save from before factions existed restarts with the current rules (factions picked as for a new game).
- No state structure change. Help text updated.
- Tests: +1 logic (parsing incl. bad inputs; a game played for 6 turns restarts as exactly the fresh game on all sizes; defaults; pre-faction save). Smoke test: "This map" fills the number, an invalid number keeps the dialog open, 4242 starts map 4242, and "Same map again" after the played-out game gives turn 1 of map 7 with the same tiles and the map number in the panel.
- Status: `npm run check` green (60 logic tests + smoke).
- Run summary: phase 7 (own improvements) done – danger-aware AI, scout, map number. Version 0.13.0.

## 2026-11-09 – Scout
- New unit **Scout** (`Sc`, 8 gold): HP 6, attack 1, defense 1, move 3, sight 4. It can't capture: `noCapture` in `UNIT_TYPES`, `cityForbidden()` in `game.js` keeps it out of every foreign (enemy or neutral) city – `searchMoves` doesn't step into or through one, `planRoute` neither, so reach, paths, move orders and the threat overlay all follow automatically. Its own cities are fine.
- It is the 6th unit, so recruit keys 1–5 stay the same and key 6 recruits a scout (the shortcut table and the buttons are generated from `rules.js`). Help text updated.
- AI: wants exactly one scout while more than `SCOUT_WHEN_UNKNOWN` (100) passable tiles are still unexplored – in practice on Large maps on Easy/Normal, never on Hard (it sees everything). A scout's goals are only unexplored tiles; the danger logic treats it as fragile like an archer. Measured (new vs. previous AI, both sides of every seed): Medium 97 : 97 (100 seeds), Large 41 : 37 (40 seeds). A version that also scouted on Medium (share-based threshold) was slightly worse there (93 : 103), so it was dropped.
- No state structure change (a new unit type only).
- Tests: +1 logic (move 3 and sight 4, no entry or passage through a neutral city while a warrior still captures, own city allowed, the AI wants one scout on a large unknown map and only explores with it, not a second one, Hard knows everything). Smoke test recruits a scout with key 6 and checks the button description (`artifacts/screenshot-scout.png`).
- Status: `npm run check` green (59 logic tests + smoke).

## 2026-11-09 – AI weighs danger
- `dangerMap(state, me, know)` in `ai.js`: the threat map (`threatTiles`) seen from the AI's side – how many visible enemies could strike each tile next turn. Computed lazily once per AI turn and recomputed only after an enemy unit falls. `threatTiles` now takes an optional `know` ({ sees, knows }) so the AI can use its own knowledge (Hard sees everything, Normal/Easy respect the fog); the overlay still uses the player's view.
- `dangerPenalty` (weights in `DANGER`): archers and catapults fear any attacker, melee units only a second and further one (a pile-on), wounded units more, and a unit in an own city fears nothing. Used when the AI advances (`moveTowardsGoal`), retreats and picks the tile it strikes from (`planStrike`).
- Measured with a temporary AI-vs-AI script (new vs. previous AI, both sides of every seed, Normal, fog on): Medium 108 : 90 (100 seeds), Small 65 : 54 (60 seeds), Large 29 : 31 (30 seeds). A modest gain; more important for a human player: AI archers no longer walk up to be cut down.
- No state structure change.
- Tests: +1 logic (penalty values, danger map = threat map from the AI side, recomputed after a loss, an archer stays out of reach where the old logic walked in, a Normal AI fears no unseen enemy).
- Status: `npm run check` green (58 logic tests + smoke).

## 2026-11-09 – Threat overlay → v0.12.0
- **Still open for Vladimír:** more AI opponents and scenarios with their own objectives wait for your "more AI yes" / "scenarios yes". `dev` is now several versions ahead of `main` (v0.9.0–v0.12.0) – please merge it.
- `threatTiles(state, player)` in `game.js`: for every enemy unit the player can see, the tiles it could attack next turn (walk with full movement by the normal rules incl. terrain, rivers and our zone of control, then strike within range). Result = number of attackers per tile; only explored passable tiles, so nothing hidden is revealed.
- UI: the ⚠ button next to ♪ in the header or the T key shades threatened tiles red (darker where several enemies reach). The setting is remembered in the preferences. T added to the shortcut table / overlay, help text updated.
- No state structure change.
- Tests: +1 logic (warrior reach = distance 3 also after it has moved, archer reach 4, overlapping counts, mountain wall stops it, hidden enemies and unexplored tiles are never marked). Smoke test toggles with T and with the button (`artifacts/screenshot-threats.png`).
- Status: `npm run check` green (57 logic tests + smoke).
- Run summary: phase 6 (own improvements) done – zone of control, save files, threat overlay. Version 0.12.0.

## 2026-11-09 – Save to file / load from file
- New "Save file" panel in the sidebar: **⬇ Save to file** downloads the game as `hex-realm-turn-N-YYYY-MM-DD.json`, **⬆ Load from file** opens it again (also available in the new game dialog, which doubles as the main menu). Everything stays in the browser – no server.
- `exportGame` / `importGame` / `saveFileName` / `stateProblem` in `game.js`. A file is `{ format: 'hex-realm-save', gameVersion, saved, state }`; a bare state (as in localStorage) is accepted too. Import never throws: it reports invalid JSON, a foreign file, a save from a newer version, an unknown format or damaged contents (bad tiles, units off the map or on one tile, bad gold / current player…) and the current game stays. Older saves are migrated as usual. Pending animation events are not saved.
- No state structure change.
- Tests: +2 logic (export → import round trip incl. continuing the game, file name; broken / foreign / newer / damaged / old files). Smoke test clicks Save, checks the download, loads it back through the file input, tries a broken file and checks the panel at 390 px (`artifacts/screenshot-file.png`).
- Status: `npm run check` green (56 logic tests + smoke).

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
